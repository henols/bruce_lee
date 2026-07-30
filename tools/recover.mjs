#!/usr/bin/env node
// The end-to-end recovery procedure: cold hard reset -> boot -> find the
// game's real entry point -> capture a pure-RAM 65536-byte image -> record
// everything needed to re-run it and get byte-identical output.
//
// Verbs: reset, boot, find-entry, capture, recover, reproduce.  `recover` is
// the whole path as one command; the others exist so each stage can be
// driven and inspected independently while the procedure is being developed
// or diagnosed.
//
// This file holds only layer C: registry reads, the crack-specific gate
// walk, the `recovery/<id>/dumps/` layout, the CLI and the lease. The
// reproducible-RAM-capture surface (layer B -- what makes a dump trustworthy
// and reproducible, with no concept of a release) lives in the
// `c64-ram-capture` skill and is imported below.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { call, beginSession, MachineRestartedError, useInstance, activeInstance } from "../.claude/skills/vice-session/scripts/vice.mjs";
import { acquire } from "../.claude/skills/vice-session/scripts/vice-pool.mjs";
import { release, releaseDir, upsertRelease } from "./releases.mjs";
import {
  addrNum,
  hex4,
  runToCheckpoint,
  reset as syncReset,
  screenshot,
} from "../.claude/skills/vice-session/scripts/vice-sync.mjs";
import {
  attachAndStart,
  findEntry,
  capture,
  voidRun,
  snapshotName,
  captureBaseline,
  captureDecayReference,
  classifyRuns,
} from "../.claude/skills/c64-ram-capture/scripts/ram-capture.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const TOOL_VERSION = "1.0.0";

const die = (m) => { console.error(`error: ${m}`); process.exit(1); };

// `reset` is re-exported unchanged from vice-sync.mjs: the `reset` CLI verb
// and `recover()` both call it, and this file keeps it as part of its
// exported surface.
export const reset = syncReset;

// -------------------------------------------------------------------- boot

/**
 * Attach + autostart the release's disk image via layer B's generic
 * `attachAndStart`, then walk whatever input gates that release's crack puts
 * in front of the game (a cracktro "hit any key" prompt, typically). Each
 * gate is a registry-declared {address, key} pair: we run to the address the
 * crack polls the key at -- so the press lands at a deterministic point in
 * EMULATED time rather than whenever wall-clock got there -- then press via
 * the keyboard MATRIX, because crack loaders poll $DC00/$DC01 directly and
 * never see the KERNAL buffer.
 *
 * Gates live in the registry, not here: no release identifier appears in this
 * control flow, so a third release is one more registry entry. The held key
 * is released later, by the capture layer, at the trigger checkpoint -- see
 * `c64-ram-capture`'s `capture()` for the other half of that contract.
 */
export async function boot(releaseId) {
  const rel = release(releaseId);
  const containerPath = join(REPO_ROOT, rel.disk_image);

  const { hostPath, method, fallbackUsed } = await attachAndStart({ diskPath: containerPath });

  // Walk the crack's input gates, each one checkpoint-gated.
  const gates = rel.boot?.gates ?? [];
  const gatesWalked = [];
  const heldKeys = [];
  for (const g of gates) {
    const addr = addrNum(g.address);
    const hit = await runToCheckpoint(addr, `gate ${g.note || g.key}`);
    // Press and HOLD -- do not release here, and do not time the release.
    //
    // Two delivery mechanisms were measured, and neither works alone:
    //   execution_run + sleep(300ms) -- the crack DOES see the key, but the
    //     release lands on a different CPU cycle every run. Measured cost: 264
    //     of 65536 bytes differing between two runs, including $0049, the very
    //     byte the trigger routine reads, plus the whole stack page.
    //   execution_step(fixed count)  -- cycle-identical, but the crack NEVER
    //     sees the key (verified: the machine sat at $0900 for 150s). Stepping
    //     does not deliver a held matrix key on this server.
    //
    // So: hold the key and let the RELEASE be gated on a program event rather
    // than on elapsed time. The trigger checkpoint is already such an event, so
    // the key is released there, immediately before any memory is read (see
    // capture()'s releaseKeys). Nothing in this path measures time.
    await call("vice_keyboard_matrix", { key: g.key, pressed: true });
    heldKeys.push(g.key);
    gatesWalked.push({ address: hex4(addr), key: g.key, hit_count: hit.hitCount });
  }

  const shotHost = await screenshot(join(releaseDir(releaseId), "dumps", `${releaseId}-boot.png`));

  upsertRelease(releaseId, (r) => ({
    ...r,
    boot: {
      ...(r.boot || {}),
      method,
      program: null,
      host_path_used: hostPath,
      fallback_used: fallbackUsed,
      screenshot_host_path: shotHost,
      gates_walked: gatesWalked,
      keys_held_into_capture: heldKeys,
    },
  }));

  return { method, fallbackUsed, hostPath, gatesWalked, heldKeys };
}

// ------------------------------------------------------------------ recover

/**
 * The whole path as one command. Reuses a recorded trigger when present.
 *
 * beginSession() runs before reset(), so the baseline epoch is captured
 * before the machine is touched at all, and the resulting session is
 * threaded into capture() -- the identity check spans the whole recovery
 * procedure, not just the final capture stage.
 *
 * If a MachineRestartedError surfaces anywhere in this procedure, the run is
 * voided (see voidRun() above) and a wrapping error is thrown. This function
 * NEVER auto-resets, auto-reboots or auto-resumes after a detected restart
 * (D-3) -- the caller re-runs `recover` from a clean state instead.
 */
export async function recover(releaseId, { runLabel = "run1" } = {}) {
  const session = beginSession();
  const dumpsDir = join(releaseDir(releaseId), "dumps");
  const binPath = join(dumpsDir, `${releaseId}-gameentry-${runLabel}.bin`);
  const capturePath = join(dumpsDir, `${releaseId}-gameentry-${runLabel}.capture.json`);

  try {
    await reset();
    let booted = await boot(releaseId);

    const rel = release(releaseId);
    let triggerAddress;
    let howLocated;
    if (rel.trigger && rel.trigger.address != null) {
      triggerAddress = rel.trigger.address;
      howLocated = rel.trigger.how_located;
    } else {
      const found = await findEntry();
      triggerAddress = found.address;
      howLocated = found.howLocated;
      upsertRelease(releaseId, (r) => ({
        ...r,
        trigger: { kind: "pc-exec-checkpoint", address: triggerAddress, how_located: howLocated },
      }));
      // findEntry already consumed the keypress and stepped past the gate, so
      // the checkpoint we're about to arm in capture() would never re-fire in
      // *this* run (we're already past it). Re-run from a clean boot so the
      // checkpoint/run_until path -- the one `reproduce` will use every time
      // -- is exercised for real, not skipped on the discovery run.
      await reset();
      booted = await boot(releaseId);
    }

    // Hand capture() the keys boot() left held so it can drop them at the
    // trigger -- a program event, hence the same cycle every run. Also hand
    // it this run's session, so capture()'s three identity gates compare
    // against the epoch this procedure started with, not a fresh one.
    const cap = await capture(triggerAddress, { releaseKeys: booted.heldKeys ?? [], session });

    // Per-run name: vice_snapshot_save REFUSES to overwrite an existing name and
    // the tool surface has no snapshot_delete, so a fixed name makes the second
    // run of `reproduce` fail. Still explicit and never "snapshot.vsf". Namespaced
    // by the LEASED instance's port (D-4), unconditionally -- vice_snapshot_save
    // writes into a shared host directory with no path argument, so two
    // instances saving the same run label would otherwise silently overwrite
    // each other.
    const instancePort = activeInstance().port;
    const snapName = snapshotName(instancePort, releaseId, runLabel);
    let snapshotSaved = true;
    let snapshotNote = null;
    try {
      await call("vice_snapshot_save", {
        name: snapName,
        description: `${releaseId}: paused at the recorded game-entry trigger ${hex4(triggerAddress)}, post-decrunch`,
      });
    } catch (e) {
      // The snapshot is a HOST-SIDE CONVENIENCE ONLY (see the D-07 correction:
      // its bytes cannot be exported into this container and it is not a
      // committed artifact). Reproducibility runs through the recorded
      // procedure, not through this blob -- so a snapshot failure must never
      // discard an otherwise-good 64K capture.
      snapshotSaved = false;
      snapshotNote = e.message;
      console.error(`warn: snapshot "${snapName}" not saved (capture is unaffected): ${e.message}`);
    }
    let hostSnapshotDir = null;
    try {
      ({ directory: hostSnapshotDir } = await call("vice_snapshot_list", {}));
    } catch (e) {
      console.error(`warn: could not read snapshot directory: ${e.message}`);
    }

    mkdirSync(dumpsDir, { recursive: true });

    writeFileSync(binPath, cap.image);
    const captureRecord = {
      release: releaseId,
      run_label: runLabel,
      trigger_kind: "pc-exec-checkpoint",
      trigger_address: hex4(triggerAddress),
      how_located: howLocated,
      port01_value: cap.port01Value,
      ranges: cap.ranges,
      chunk_size: cap.chunkSize,
      bytes_read: cap.bytesRead,
      sha256: cap.sha256,
      instance_port: instancePort,
      pooled: activeInstance().pooled,
      snapshot_name: snapName,
      snapshot_saved: snapshotSaved,
      snapshot_note: snapshotNote,
      host_snapshot_dir: hostSnapshotDir,
      vice_server_version: cap.viceServerVersion,
      machine: cap.machine,
      video_standard: cap.videoStandard,
      captured_at: new Date().toISOString(),
      tool_version: TOOL_VERSION,
      ram_vs_rom_e000: cap.ramVsRomE000,
    };
    writeFileSync(capturePath, JSON.stringify(captureRecord, null, 2) + "\n");

    upsertRelease(releaseId, (r) => ({
      ...r,
      dumps: [
        ...r.dumps.filter((d) => d.label !== runLabel),
        {
          label: runLabel,
          kind: "gameentry",
          bin: `recovery/${releaseId}/dumps/${releaseId}-gameentry-${runLabel}.bin`,
          capture_record: `recovery/${releaseId}/dumps/${releaseId}-gameentry-${runLabel}.capture.json`,
          chip_state: null,
          range_manifest: null,
          sha256: cap.sha256,
          load_event_ref: null,
        },
      ],
      snapshot_names: [...new Set([...(r.snapshot_names || []), snapName])],
    }));

    return { binPath, capturePath, sha256: cap.sha256, triggerAddress };
  } catch (e) {
    if (e instanceof MachineRestartedError) {
      voidRun({
        binPath,
        capturePath,
        reason: e.message,
        baselineEpoch: e.baselineEpoch,
        currentEpoch: e.currentEpoch,
        lastToolCall: e.lastToolCall,
      });
      throw new Error(
        `recover(${releaseId}, run-label ${runLabel}): the emulator restarted mid-capture -- this run is ` +
          `VOID. Nothing was reset, rebooted or resumed automatically; re-run ` +
          `\`node tools/recover.mjs recover ${releaseId} --run-label ${runLabel}\` from a clean state once ` +
          `the emulator is stable. (${e.message})`
      );
    }
    throw e;
  }
}

/** Run `recover` twice from scratch and require byte-identical, 65536-byte output. */
export async function reproduce(releaseId) {
  const run1 = await recover(releaseId, { runLabel: "run1" });
  const run2 = await recover(releaseId, { runLabel: "run2" });
  const image1 = readFileSync(run1.binPath);
  const image2 = readFileSync(run2.binPath);
  const sizesOk = image1.length === 65536 && image2.length === 65536;
  const cls = classifyRuns({ runA: image1, runB: image2 });
  return {
    ok: sizesOk && cls.ok,
    identical: run1.sha256 === run2.sha256,
    sizesOk,
    run1, run2,
    sha256_1: run1.sha256,
    sha256_2: run2.sha256,
    classification: cls,
  };
}

// -------------------------------------------------------------------- CLI

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = rest.indexOf(`--${name}`);
    return i === -1 ? fallback : rest[i + 1];
  };

  async function runCommand() {
    if (cmd === "reset") {
      await reset();
      console.log("reset: checkpoints cleared, disks detached, hard reset done");
      return;
    }
    if (cmd === "boot") {
      const releaseId = rest[0];
      if (!releaseId) die("usage: boot <release-id>");
      const r = await boot(releaseId);
      console.log(`boot: ${r.method}${r.fallbackUsed ? " (fallback used)" : ""} via ${r.hostPath}`);
      return;
    }
    if (cmd === "find-entry") {
      const releaseId = rest[0];
      if (!releaseId) die("usage: find-entry <release-id>");
      const r = await findEntry();
      console.log(`find-entry: ${hex4(r.address)} -- ${r.howLocated}`);
      return;
    }
    if (cmd === "capture") {
      const releaseId = rest[0];
      const addr = Number(opt("trigger"));
      if (!releaseId || !addr) die("usage: capture <release-id> --trigger <decimal-address>");
      const r = await capture(addr);
      console.log(`capture: ${r.bytesRead} bytes, sha256 ${r.sha256}`);
      return;
    }
    if (cmd === "recover") {
      const releaseId = rest[0];
      if (!releaseId) die("usage: recover <release-id> [--run-label run1]");
      const runLabel = opt("run-label", "run1");
      const r = await recover(releaseId, { runLabel });
      console.log(`recover: wrote ${r.binPath} (sha256 ${r.sha256})`);
      return;
    }
    if (cmd === "baseline") {
      const r = await captureBaseline({ outDir: join(REPO_ROOT, "recovery", "machine") });
      console.log(`baseline: wrote ${r.path} (sha256 ${r.sha256})`);
      return;
    }
    if (cmd === "decay-reference") {
      const r = await captureDecayReference({ outDir: join(REPO_ROOT, "recovery", "machine"), runMs: Number(opt("run-ms", "20000")) });
      console.log(`decay-reference: ${r.count} drift-prone addresses over a ${r.runMs / 1000}s idle run`);
      return;
    }
    if (cmd === "reproduce") {
      const releaseId = rest[0];
      if (!releaseId) die("usage: reproduce <release-id>");
      const r = await reproduce(releaseId);
      const c = r.classification;
      console.log(`run1 sha256: ${r.sha256_1}`);
      console.log(`run2 sha256: ${r.sha256_2}`);
      console.log(`full 64K identical: ${r.identical ? "yes" : "no"}`);
      console.log("");
      console.log(`identical bytes:            ${c.identicalBytes} of 65536`);
      console.log(`volatile scratch diffs:     ${c.volatileDiffs}  (excluded: $0100-$03FF stack + KERNAL work area)`);
      console.log(`single-bit drift candidates:${String(c.decayCandidates.length).padStart(4)}  (recorded, not failed -- RAM drift signature)`);
      console.log(`PROGRAM-IMAGE mismatches:   ${String(c.programMismatches.length).padStart(4)}  (multi-bit: a real divergence)`);
      for (const m of c.programMismatches.slice(0, 15)) {
        console.log(`  MISMATCH ${hex4(m.addr)} run1=${m.a.toString(16).padStart(2, "0")} run2=${m.b.toString(16).padStart(2, "0")} (${m.bits} bits)`);
      }
      if (c.programMismatches.length > 15) console.log(`  ... and ${c.programMismatches.length - 15} more`);
      console.log("");
      console.log(r.ok
        ? "reproduce: OK -- program image byte-identical; all remaining diffs are single-bit RAM drift"
        : "reproduce: MISMATCH -- multi-bit differences found in the program image");
      // Set exitCode rather than calling process.exit() (which would skip
      // main()'s `finally` below and leak the lease): exitCode lets the
      // event loop drain normally, running the release, and the process
      // still exits with this code once nothing else is pending.
      process.exitCode = r.ok ? 0 : 1;
      return;
    }
    console.log(`usage: node ${fileURLToPath(import.meta.url)} <command> [args]

  reset                                   clear checkpoints, detach disks, hard reset
  boot <release>                          attach + autostart (or keyboard fallback)
  find-entry <release>                    empirically locate the game's entry PC
  capture <release> --trigger <addr>      arm the checkpoint and capture the image
  recover <release> [--run-label L]       the whole path as one command
  reproduce <release>                     run recover twice, require byte-identical output`);
    process.exitCode = cmd ? 1 : 0;
  }

  /**
   * Acquire a lease once at the CLI entry point (D-4, D-5) -- NOT inside the
   * exported functions above, so programmatic callers (and the test suite)
   * never trigger a lease/registry lookup they didn't ask for. One lease
   * spans the WHOLE verb, including both recover() calls inside
   * `reproduce`: that is required, not incidental, since the two runs must
   * execute on the same machine for the epoch identity check
   * (assertSameMachine) to mean anything. Released in `finally` so it runs
   * whether the verb succeeded, threw, or merely set process.exitCode.
   *
   * This is deliberately a DEFAULT `kind:"process"` lease (see
   * `vice-pool.mjs`'s `acquire()`), with pid-based reclaim in
   * `isReclaimable()`, because its holder is ONE long-running process that
   * lives for the entire verb -- if this process dies mid-`recover`, its pid
   * is confirmably gone and the lease should free up. That is the opposite
   * situation from `tools/vice.mjs session acquire` (D-2): an interactive
   * session's holder process EXITS the instant the acquire command returns,
   * so pid-liveness would reclaim it immediately; a session is therefore a
   * `kind:"session"` lease, reclaimed by TTL expiry only, never by pid.
   * Cross-reference `isReclaimable()` for where both rules are enforced.
   */
  async function main() {
    const lease = await acquire();
    useInstance(lease);
    try {
      await runCommand();
    } finally {
      await lease.release();
    }
  }

  main().catch((e) => die(e.message));
}
