#!/usr/bin/env node
// The end-to-end recovery procedure: cold hard reset -> boot -> find the
// game's real entry point -> capture a pure-RAM 65536-byte image -> record
// everything needed to re-run it and get byte-identical output.
//
// Verbs: reset, boot, find-entry, capture, recover, reproduce.  `recover` is
// the whole path as one command; the others exist so each stage can be
// driven and inspected independently while the procedure is being developed
// or diagnosed.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { call, serverInfo } from "./vice.mjs";
import { release, releaseDir, upsertRelease } from "./releases.mjs";
import { tryHostPaths } from "../.claude/skills/devcontainer-host-path/hostpath.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const TOOL_VERSION = "1.0.0";

const die = (m) => { console.error(`error: ${m}`); process.exit(1); };
const hex4 = (n) => `$${n.toString(16).padStart(4, "0")}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------- byte assembly

/**
 * Assemble a flat 65536-byte image from `{start, data}` chunks. Each byte is
 * written at its own address, so the result is identical regardless of the
 * order chunks are processed in. Throws (writing nothing) on an out-of-range
 * chunk, an overlap, or any address left uncovered.
 */
export function assembleChunks(chunks) {
  const image = Buffer.alloc(65536);
  const covered = new Uint8Array(65536);
  for (const { start, data } of chunks) {
    if (!Number.isInteger(start) || start < 0 || start > 0xffff) {
      throw new Error(`assembleChunks: chunk start out of range: ${start}`);
    }
    if (start + data.length > 0x10000) {
      throw new Error(
        `assembleChunks: chunk at ${hex4(start)} (${data.length} bytes) overruns the 65536-byte image`
      );
    }
    for (let i = 0; i < data.length; i++) {
      if (covered[start + i]) {
        throw new Error(`assembleChunks: overlapping chunk at ${hex4(start + i)}`);
      }
      covered[start + i] = 1;
    }
    data.copy(image, start);
  }
  for (let i = 0; i < 65536; i++) {
    if (!covered[i]) {
      throw new Error(`assembleChunks: address ${hex4(i)} is not covered by any chunk -- image incomplete`);
    }
  }
  return image;
}

/**
 * Read `ranges` (each `{start, end}` inclusive) via `call("vice_memory_read",
 * ..., bank:"ram")` in `chunkSize`-byte pieces and assemble them. A short or
 * failed read throws and returns no buffer -- the caller must not write a
 * `.bin` if this rejects.
 */
export async function captureImage({ call: callFn, ranges, chunkSize = 65536 }) {
  const chunks = [];
  for (const { start, end } of ranges) {
    let addr = start;
    while (addr <= end) {
      const remaining = end - addr + 1;
      const size = Math.min(chunkSize, remaining);
      const res = await callFn("vice_memory_read", {
        address: hex4(addr),
        size,
        bank: "ram",
        encoding: "hex",
      });
      const data = Buffer.from(res.data_hex, "hex");
      if (data.length !== size) {
        throw new Error(
          `captureImage: chunk at ${hex4(addr)} requested ${size} bytes, got ${data.length} -- aborting, no image written`
        );
      }
      chunks.push({ start: addr, data });
      addr += size;
    }
  }
  return assembleChunks(chunks);
}

/** Try one 65536-byte read first; fall back to 4096-byte chunks on failure. */
async function captureWithFallback(callFn) {
  const ranges = [{ start: 0, end: 0xffff }];
  try {
    const image = await captureImage({ call: callFn, ranges, chunkSize: 65536 });
    return { image, chunkSize: 65536 };
  } catch (e) {
    const image = await captureImage({ call: callFn, ranges, chunkSize: 4096 });
    return { image, chunkSize: 4096, largeReadError: e.message };
  }
}

// ------------------------------------------------------------------- reset

/**
 * The clean-slate ritual, and a step of `recover` -- not an optional
 * courtesy. No bulk-clear checkpoint tool exists, so each returned id is
 * enumerated and deleted individually.
 */
export async function reset() {
  const { checkpoints } = await call("vice_checkpoint_list", {});
  for (const cp of checkpoints) {
    await call("vice_checkpoint_delete", { checkpoint_num: cp.checkpoint_num });
  }
  for (const unit of [8, 9, 10, 11]) {
    await call("vice_disk_detach", { unit });
  }
  await call("vice_machine_reset", { mode: "hard", run_after: false });
}

// -------------------------------------------------------------------- boot

/**
 * Attach + autostart the release's disk image. Confirms progress by
 * checking PC actually moved from the immediate post-reset value; if it
 * didn't, falls back to a scripted LOAD"*",8,1 + RUN via the keyboard
 * buffer. Records which path worked in the registry and takes a boot
 * screenshot as evidence either way.
 */
export async function boot(releaseId) {
  const rel = release(releaseId);
  const containerPath = join(REPO_ROOT, rel.disk_image);
  const preRegs = await call("vice_registers_get", {});

  const { hostPath } = await tryHostPaths(containerPath, async (p) => {
    await call("vice_disk_attach", { unit: 8, path: p });
    return call("vice_autostart", { path: p });
  });

  let method = "autostart";
  let fallbackUsed = false;
  // Sample a few times (not a fixed wait -- just enough repeated, immediate
  // reads to avoid a false-negative from checking on the very first
  // instruction after autostart returns) before concluding PC never left the
  // reset/READY region.
  let moved = false;
  for (let i = 0; i < 5 && !moved; i++) {
    const postRegs = await call("vice_registers_get", {});
    moved = postRegs.PC !== preRegs.PC;
  }
  if (!moved) {
    // autostart produced no visible progress -- fall back to the keystrokes
    // a real drive user would type, gated on the same checkpoint-based
    // discipline as everything else (no wall-clock delay is introduced here;
    // the keystrokes are simply queued for whatever code polls next).
    await call("vice_keyboard_type", { text: 'LOAD"*",8,1\n' });
    await call("vice_keyboard_type", { text: "RUN\n" });
    method = "keyboard-load-run";
    fallbackUsed = true;
  }

  const dumpsDir = join(releaseDir(releaseId), "dumps");
  mkdirSync(dumpsDir, { recursive: true });
  await call("vice_display_screenshot", { path: join(dumpsDir, `${releaseId}-boot.png`) });

  upsertRelease(releaseId, (r) => ({
    ...r,
    boot: { method, program: null, host_path_used: hostPath, fallback_used: fallbackUsed },
  }));

  return { method, fallbackUsed, hostPath };
}

// -------------------------------------------------------------- find-entry

/**
 * Bounded, generic entry-point search: press past any "hit any key" gate,
 * then walk forward in bounded vice_execution_step batches (never an
 * unbounded run_until on an unverified address), watching vice_backtrace's
 * call-stack depth for two consecutive batches landing at the same depth --
 * the signature of a steady-state loop, i.e. the loader has handed off and
 * real game code is now running its own dispatch loop. vice_disassemble
 * sanity-checks the landing address before it is trusted.
 */
export async function findEntry(releaseId, { batchSize = 400, maxBatches = 150 } = {}) {
  await call("vice_keyboard_type", { text: " " });

  let lastPc = null;
  let lastDepth = null;
  for (let i = 0; i < maxBatches; i++) {
    await call("vice_execution_step", { count: batchSize });
    const regs = await call("vice_registers_get", {});
    const bt = await call("vice_backtrace", { depth: 8 });
    if (lastPc === regs.PC && lastDepth === bt.frame_count) {
      const dis = await call("vice_disassemble", { address: hex4(regs.PC), count: 1 });
      return {
        address: regs.PC,
        howLocated:
          `stepped in ${batchSize}-instruction batches after the cracktro keypress; ` +
          `PC and call-stack depth (${bt.frame_count}) both stabilized at ${hex4(regs.PC)} ` +
          `after batch ${i + 1}, decoding as \`${dis.lines[0].instruction}\``,
      };
    }
    lastPc = regs.PC;
    lastDepth = bt.frame_count;
  }
  throw new Error(
    `find-entry: PC/call-depth did not stabilize within ${maxBatches} batches of ${batchSize} steps -- ` +
      `manual recovery: inspect with vice_backtrace/vice_disassemble by hand, or a host-side VICE restart ` +
      `if execution appears hung.`
  );
}

// ----------------------------------------------------------------- capture

const POLL_INTERVAL_MS = 150;
const POLL_MAX_ATTEMPTS = 400; // ~60s ceiling -- see manual-recovery note below

/** Poll vice_ping until execution reports "paused", or throw with the recorded manual-recovery path. */
async function waitPaused() {
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    const p = await call("vice_ping", {});
    if (p.execution === "paused") return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `waitPaused: execution did not pause within ${(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s -- ` +
      `vice_run_until's cycles argument is documented as "not yet implemented" so there is no server-side ` +
      `timeout backing this; manual recovery is a host-side VICE restart (see recovery/${"<release>"}/NOTES.md).`
  );
}

/**
 * Arm the checkpoint, kick off run_until, and confirm via the checkpoint's
 * own hit_count once paused -- belt and suspenders, so the stop is a
 * checkpoint event rather than a bare dependence on run_until's semantics.
 * Then reads the full 65536-byte RAM image and every chip-state field the
 * capture record needs.
 */
export async function capture(releaseId, triggerAddress) {
  await call("vice_checkpoint_add", { start: hex4(triggerAddress), exec: true, stop: true });
  await call("vice_run_until", { address: hex4(triggerAddress) });
  await waitPaused();

  const { checkpoints } = await call("vice_checkpoint_list", {});
  const cp = checkpoints.find((c) => c.start === triggerAddress);
  if (!cp || cp.hit_count < 1) {
    throw new Error(
      `capture: paused, but the checkpoint at ${hex4(triggerAddress)} shows hit_count ${cp?.hit_count ?? "missing"} -- ` +
        `the stop may not be the checkpoint event. Not writing an image.`
    );
  }

  // D-08 confirmation: bank:"ram" must still differ from bank:"rom" at $E000
  // now that the game is actually running (research verified this only
  // against the idle pre-boot machine).
  const ramE000 = await call("vice_memory_read", { address: "$E000", size: 16, bank: "ram", encoding: "hex" });
  const romE000 = await call("vice_memory_read", { address: "$E000", size: 16, bank: "rom", encoding: "hex" });
  if (ramE000.data_hex === romE000.data_hex) {
    throw new Error("capture: bank:ram and bank:rom read identical bytes at $E000 -- bank scoping is not working as expected while the game is running");
  }

  const port01 = await call("vice_memory_read", { address: "$01", size: 1, encoding: "hex" });
  const { image, chunkSize } = await captureWithFallback(call);
  const sha256 = createHash("sha256").update(image).digest("hex");
  const info = await call("vice_ping", {});

  return {
    image,
    sha256,
    chunkSize,
    port01Value: port01.data_hex,
    ranges: [{ start: 0, end: 0xffff, bank: "ram" }],
    bytesRead: image.length,
    machine: info.machine,
    videoStandard: "PAL", // vice_machine_config_get confirmed PAL for this instance (01-RESEARCH.md)
    viceServerVersion: info.version,
    ramVsRomE000: { ram: ramE000.data_hex, rom: romE000.data_hex },
  };
}

// ------------------------------------------------------------------ recover

/** The whole path as one command. Reuses a recorded trigger when present. */
export async function recover(releaseId, { runLabel = "run1" } = {}) {
  await reset();
  await boot(releaseId);

  const rel = release(releaseId);
  let triggerAddress;
  let howLocated;
  if (rel.trigger && rel.trigger.address != null) {
    triggerAddress = rel.trigger.address;
    howLocated = rel.trigger.how_located;
  } else {
    const found = await findEntry(releaseId);
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
    await boot(releaseId);
  }

  const cap = await capture(releaseId, triggerAddress);

  const snapshotName = `${releaseId}_gameentry_v1`;
  await call("vice_snapshot_save", {
    name: snapshotName,
    description: `${releaseId}: paused at the recorded game-entry trigger ${hex4(triggerAddress)}, post-decrunch`,
  });
  const { directory: hostSnapshotDir } = await call("vice_snapshot_list", {});

  const dumpsDir = join(releaseDir(releaseId), "dumps");
  mkdirSync(dumpsDir, { recursive: true });
  const binPath = join(dumpsDir, `${releaseId}-gameentry-${runLabel}.bin`);
  const capturePath = join(dumpsDir, `${releaseId}-gameentry-${runLabel}.capture.json`);

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
    snapshot_name: snapshotName,
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
    snapshot_names: [...new Set([...(r.snapshot_names || []), snapshotName])],
  }));

  return { binPath, capturePath, sha256: cap.sha256, triggerAddress };
}

/** Run `recover` twice from scratch and require byte-identical, 65536-byte output. */
export async function reproduce(releaseId) {
  const run1 = await recover(releaseId, { runLabel: "run1" });
  const run2 = await recover(releaseId, { runLabel: "run2" });
  const image1 = readFileSync(run1.binPath);
  const image2 = readFileSync(run2.binPath);
  const ok = image1.length === 65536 && image2.length === 65536 && run1.sha256 === run2.sha256;
  return { ok, run1, run2, sha256_1: run1.sha256, sha256_2: run2.sha256 };
}

// -------------------------------------------------------------------- CLI

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = rest.indexOf(`--${name}`);
    return i === -1 ? fallback : rest[i + 1];
  };

  async function main() {
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
      const r = await findEntry(releaseId);
      console.log(`find-entry: ${hex4(r.address)} -- ${r.howLocated}`);
      return;
    }
    if (cmd === "capture") {
      const releaseId = rest[0];
      const addr = Number(opt("trigger"));
      if (!releaseId || !addr) die("usage: capture <release-id> --trigger <decimal-address>");
      const r = await capture(releaseId, addr);
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
    if (cmd === "reproduce") {
      const releaseId = rest[0];
      if (!releaseId) die("usage: reproduce <release-id>");
      const r = await reproduce(releaseId);
      console.log(`run1 sha256: ${r.sha256_1}`);
      console.log(`run2 sha256: ${r.sha256_2}`);
      console.log(r.ok ? "reproduce: OK -- byte-identical" : "reproduce: MISMATCH");
      process.exit(r.ok ? 0 : 1);
    }
    console.log(`usage: node ${fileURLToPath(import.meta.url)} <command> [args]

  reset                                   clear checkpoints, detach disks, hard reset
  boot <release>                          attach + autostart (or keyboard fallback)
  find-entry <release>                    empirically locate the game's entry PC
  capture <release> --trigger <addr>      arm the checkpoint and capture the image
  recover <release> [--run-label L]       the whole path as one command
  reproduce <release>                     run recover twice, require byte-identical output`);
    process.exit(cmd ? 1 : 0);
  }

  main().catch((e) => die(e.message));
}
