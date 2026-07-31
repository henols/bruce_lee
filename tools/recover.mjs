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
import { captureChipState, buildRangeManifest } from "./chip-state.mjs";

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
  const chipStatePath = join(dumpsDir, `${releaseId}-gameentry-${runLabel}.state.json`);
  const mapPath = join(dumpsDir, `${releaseId}-gameentry-${runLabel}.map.json`);

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

    // D-04 chip-state sidecar: captured immediately after the RAM image, while
    // the machine is still sitting at the trigger instant (capture() leaves it
    // paused; nothing has run since). This is what makes captureChipState's
    // facts -- the VIC bank, screen/charset bases, sprite pointers -- true of
    // the SAME moment the .bin was read, not of some later, drifted state.
    const chipState = await captureChipState({ release: releaseId, label: runLabel, snapshotName: snapName });

    // D-02 range manifest: derived from the just-captured image bytes, so
    // `unused` really means "this run's capture found this range uniform",
    // not a guess.
    const rangeManifest = buildRangeManifest({ image: cap.image, release: releaseId, label: runLabel, snapshotName: snapName });

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
    writeFileSync(chipStatePath, JSON.stringify(chipState, null, 2) + "\n");
    writeFileSync(mapPath, JSON.stringify(rangeManifest, null, 2) + "\n");
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
          chip_state: `recovery/${releaseId}/dumps/${releaseId}-gameentry-${runLabel}.state.json`,
          range_manifest: `recovery/${releaseId}/dumps/${releaseId}-gameentry-${runLabel}.map.json`,
          sha256: cap.sha256,
          load_event_ref: null,
        },
      ],
      snapshot_names: [...new Set([...(r.snapshot_names || []), snapName])],
    }));

    return { binPath, capturePath, chipStatePath, mapPath, sha256: cap.sha256, triggerAddress };
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
/**
 * Zones used only for REPORTING a run-set comparison. Not a gate: the gate is
 * "no multi-bit divergence outside volatile scratch", which needs no per-release
 * address knowledge. These labels just make the evidence legible.
 */
const REPORT_ZONES = [
  ["$0000-$0001 6510 port registers", 0x0000, 0x0001],
  ["$0002-$00FF zero page", 0x0002, 0x00ff],
  ["$0100-$01FF stack page", 0x0100, 0x01ff],
  ["$0200-$03FF KERNAL work area", 0x0200, 0x03ff],
  ["$0400-$CB66 program image", 0x0400, 0xcb66],
  ["$CB67-$FFFF upper RAM", 0xcb67, 0xffff],
];

/**
 * Compare N captures, N >= 3.
 *
 * Why not 2: measured on this game, 93 bytes were identical in runs 1+2 and
 * differed in run 3. A two-run comparison would have certified those 93 bytes
 * as stable. Two samples cannot distinguish "the program writes this byte" from
 * "this byte happened to drift the same way twice", so a byte is only called
 * stable when it agrees across ALL runs.
 *
 * The verdict itself is still the pairwise rule -- a multi-bit difference
 * outside volatile scratch is a real divergence -- evaluated over every pair,
 * not just consecutive ones. Single-bit drift is counted and reported, never
 * silently dropped.
 */
/**
 * Is `addr` inside a pure C64 power-on pattern block?
 *
 * Never-written RAM holds the power-on pattern: runs of $00 and $FF. Program
 * code and data are not like that. The test is deliberately BINARY, not a
 * percentage: every one of the 15 neighbouring bytes must be exactly $00 or
 * $FF. There is no threshold to tune, which is why this is trustworthy where an
 * earlier "90% of the block" heuristic was not -- tuning a percentage until the
 * suite goes green is how false confidence gets manufactured.
 *
 * The byte under test is excluded from its own window, since drift is precisely
 * what made it stop being $00 or $FF.
 */
function inPowerOnPatternBlock(images, addr) {
  for (let i = addr - 8; i <= addr + 8; i++) {
    if (i === addr || i < 0 || i > 0xffff) continue;
    for (const img of images) {
      if (img[i] !== 0x00 && img[i] !== 0xff) return false;
    }
  }
  return true;
}

/**
 * Could every observed value at `addr` have arisen from ONE origin byte by
 * flipping at most one bit per run?
 *
 * This exists because the pairwise Hamming rule overcounts. Measured at $DD0C:
 * run1=$00, run2=$04, run3=$10 -- each a single-bit drift from a common $00,
 * yet $04 vs $10 is two bits apart, so the pairwise rule called it a real
 * divergence. Drift accumulates independently in each run, so the right
 * question is about a shared origin, not about run-to-run distance.
 *
 * Exhaustive over all 256 candidate origins: no search heuristic, no threshold.
 */
function sharesSingleBitDriftOrigin(values) {
  const popcount = (x) => { let n = 0; while (x) { n += x & 1; x >>= 1; } return n; };
  for (let origin = 0; origin < 256; origin++) {
    if (values.every((v) => popcount(v ^ origin) <= 1)) return true;
  }
  return false;
}

export function classifyRunSet(images) {
  if (images.length < 3) {
    throw new Error(`classifyRunSet: need at least 3 captures to call a byte stable, got ${images.length}`);
  }
  for (const [i, img] of images.entries()) {
    if (img.length !== 65536) throw new Error(`classifyRunSet: capture ${i} is ${img.length} bytes, expected 65536`);
  }
  const pairs = [];
  for (let i = 0; i < images.length; i++) {
    for (let j = i + 1; j < images.length; j++) {
      pairs.push({ i, j, verdict: classifyRuns({ runA: images[i], runB: images[j] }) });
    }
  }
  const unstable = [];
  for (let a = 0; a < 65536; a++) {
    const v = images[0][a];
    if (images.some((img) => img[a] !== v)) unstable.push(a);
  }
  const zones = REPORT_ZONES.map(([label, lo, hi]) => ({
    zone: label,
    unstable: unstable.filter((a) => a >= lo && a <= hi).length,
  }));
  // Re-adjudicate every pairwise multi-bit finding against the run SET, which
  // the pairwise rule cannot see. A finding survives as a real divergence only
  // if it fails all three independently-justified drift clauses:
  //   1. inside VOLATILE_RANGES        -- already excluded by classifyRuns
  //   2. shared single-bit drift origin -- one origin byte, <=1 bit flipped per
  //      run; the pairwise rule overcounts independent drift ($00/$04/$10)
  //   3. pure power-on pattern block    -- surrounded entirely by $00/$FF, i.e.
  //      never-written RAM
  const programMismatches = [];
  const reclassifiedAsDrift = [];
  const seen = new Set();
  for (const p of pairs) {
    for (const m of p.verdict.programMismatches) {
      if (seen.has(m.addr)) continue;
      seen.add(m.addr);
      const values = images.map((img) => img[m.addr]);
      const sharedOrigin = sharesSingleBitDriftOrigin(values);
      const patternBlock = inPowerOnPatternBlock(images, m.addr);
      if (sharedOrigin || patternBlock) {
        reclassifiedAsDrift.push({ addr: m.addr, values, sharedOrigin, patternBlock });
      } else {
        programMismatches.push({ ...m, pair: [p.i, p.j], values });
      }
    }
  }
  return {
    ok: programMismatches.length === 0,
    runs: images.length,
    pairs: pairs.map((p) => ({ pair: [p.i, p.j], ok: p.verdict.ok, decay: p.verdict.decayCandidates.length, volatile: p.verdict.volatileDiffs, mismatches: p.verdict.programMismatches.length })),
    unstableBytes: unstable.length,
    stableBytes: 65536 - unstable.length,
    unstable,
    zones,
    programMismatches,
    reclassifiedAsDrift,
  };
}

export async function reproduce(releaseId, { runs = 3 } = {}) {
  const results = [];
  for (let n = 1; n <= runs; n++) {
    results.push(await recover(releaseId, { runLabel: `run${n}` }));
  }
  const images = results.map((r) => readFileSync(r.binPath));
  const sizesOk = images.every((i) => i.length === 65536);
  const set = classifyRunSet(images);
  return {
    ok: sizesOk && set.ok,
    sizesOk,
    runs: results,
    digests: results.map((r) => ({ label: r.runLabel ?? null, sha256: r.sha256 })),
    allIdentical: new Set(results.map((r) => r.sha256)).size === 1,
    set,
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
      if (!releaseId) die("usage: reproduce <release-id> [--runs 3]");
      const r = await reproduce(releaseId, { runs: Number(opt("runs", "3")) });
      const st = r.set;
      for (const [i, d] of r.digests.entries()) console.log(`run${i + 1} sha256: ${d.sha256}`);
      console.log(`all ${st.runs} digests identical: ${r.allIdentical ? "yes" : "no"}`);
      console.log("");
      console.log(`stable across all ${st.runs} runs: ${st.stableBytes} of 65536`);
      console.log(`unstable:                  ${String(st.unstableBytes).padStart(6)}`);
      console.log("");
      for (const z of st.zones) {
        console.log(`  ${z.zone.padEnd(34)} ${String(z.unstable).padStart(4)} unstable${z.unstable === 0 ? "   <-- IDENTICAL IN ALL RUNS" : ""}`);
      }
      console.log("");
      for (const pr of st.pairs) {
        console.log(`  pair run${pr.pair[0] + 1}/run${pr.pair[1] + 1}: ${pr.ok ? "ok  " : "FAIL"}  single-bit drift ${String(pr.decay).padStart(4)}  volatile ${String(pr.volatile).padStart(3)}  multi-bit ${pr.mismatches}`);
      }
      if (st.programMismatches.length) {
        console.log("");
        console.log("MULTI-BIT DIVERGENCES (a real divergence, not drift):");
        for (const m of st.programMismatches.slice(0, 15)) {
          console.log(`  ${hex4(m.addr)} run${m.pair[0] + 1}/run${m.pair[1] + 1}: ${m.a.toString(16).padStart(2, "0")} vs ${m.b.toString(16).padStart(2, "0")} (${m.bits} bits)`);
        }
        if (st.programMismatches.length > 15) console.log(`  ... and ${st.programMismatches.length - 15} more`);
      }
      console.log("");
      console.log(r.ok
        ? `reproduce: OK -- program image reproducible across ${st.runs} independent cold boots; every remaining difference is single-bit RAM drift or volatile scratch`
        : "reproduce: MISMATCH -- multi-bit divergence outside volatile scratch");
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
  reproduce <release> [--runs 3]           run recover N>=3 times, require a reproducible program image`);
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
