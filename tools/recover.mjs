#!/usr/bin/env node
// The end-to-end recovery procedure: cold hard reset -> boot -> find the
// game's real entry point -> capture a pure-RAM 65536-byte image -> record
// everything needed to re-run it and get byte-identical output.
//
// Verbs: reset, boot, find-entry, capture, recover, reproduce.  `recover` is
// the whole path as one command; the others exist so each stage can be
// driven and inspected independently while the procedure is being developed
// or diagnosed.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { call, serverInfo, beginSession, assertSameMachine, MachineRestartedError, lastToolCall } from "./vice.mjs";
import { release, releaseDir, upsertRelease } from "./releases.mjs";
import { tryHostPaths } from "../.claude/skills/devcontainer-host-path/hostpath.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const TOOL_VERSION = "1.0.0";

const die = (m) => { console.error(`error: ${m}`); process.exit(1); };

// Checkpoints the harness itself armed for its own reasons (a boot gate, the
// dump trigger), tracked here so assertSameMachine()'s checkpoint-fallback
// probe (D-3) has something to check when no supervisor epoch file exists --
// the ONLY identity signal available in that case. This costs no NEW
// checkpoints: arming a sentinel checkpoint purely for identity-probing was
// rejected because checkpoint work is itself one of the two leading crash
// suspects recorded in STATE.md's HAZARD CANDIDATE entry. Added on
// vice_checkpoint_add success, removed on successful vice_checkpoint_delete.
const armedCheckpoints = new Set();
const hex4 = (n) => `$${addrNum(n).toString(16).toUpperCase().padStart(4, "0")}`;

/**
 * Normalise an address to a number, accepting either a number or a string in
 * "$08B1" / "08B1" / "0x08B1" form. Addresses cross a JSON boundary (the
 * registry stores them as "$08B1" strings for human readability) and a raw
 * hex4() over a string silently produces "$$08B1", which VICE rejects with
 * "invalid hex address" -- so every address entering a vice_* call goes
 * through here first.
 */
function addrNum(a) {
  if (typeof a === "number") return a;
  if (typeof a === "string") {
    const s = a.trim().replace(/^\$/, "").replace(/^0x/i, "");
    const n = parseInt(s, 16);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(`addrNum: cannot interpret ${JSON.stringify(a)} as an address`);
}

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
  // Any checkpoint id tracked from a PRIOR run in this same process (e.g.
  // reproduce()'s second recover() call) is no longer valid once we're about
  // to delete every checkpoint the server knows about -- clear it here so a
  // later assertSameMachine() probe never gets tripped up by a stale id.
  armedCheckpoints.clear();
  const { checkpoints } = await call("vice_checkpoint_list", {});
  for (const cp of checkpoints) {
    // Never delete a checkpoint VICE marked `temporary`: those are created and
    // auto-reaped by vice_run_until, so by the time we enumerate them the id
    // may already be gone, and deleting a stale id is one of the two leading
    // suspects for the host-server crashes recorded in STATE.md. Leave them to
    // the hard reset, which clears them anyway.
    if (cp.temporary) continue;
    try {
      await call("vice_checkpoint_delete", { checkpoint_num: cp.checkpoint_num });
    } catch (e) {
      console.error(`warn: checkpoint_delete ${cp.checkpoint_num} failed (continuing): ${e.message}`);
    }
  }
  for (const unit of [8, 9, 10, 11]) {
    try {
      await call("vice_disk_detach", { unit });
    } catch (e) {
      console.error(`warn: disk_detach unit ${unit} failed (continuing): ${e.message}`);
    }
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
/**
 * VICE writes screenshots itself, on the HOST -- so the path handed to
 * vice_display_screenshot must be a host path, exactly like the one handed to
 * vice_disk_attach. Passing the container path silently fails with
 * "Failed to save screenshot".
 */
async function screenshot(containerPath) {
  mkdirSync(dirname(containerPath), { recursive: true });
  const { hostPath } = await tryHostPaths(containerPath, (p) =>
    call("vice_display_screenshot", { path: p })
  );
  return hostPath;
}

/**
 * Arm an exec checkpoint at `addr`, resume, and wait for the machine to stop
 * ON THAT CHECKPOINT -- verified via its own hit_count, not inferred from the
 * mere fact that execution paused. Returns the checkpoint id so the caller can
 * delete it; leaving stale checkpoints armed would contaminate the next stage.
 *
 * This is the project's one synchronisation primitive. Every wait in this file
 * is a checkpoint hit, never an elapsed duration -- a duration cannot be
 * re-armed, and success criterion 1's byte-identical claim depends on the stop
 * point being re-armable.
 */
async function readCheckpoint(cpId, addr) {
  const { checkpoints } = await call("vice_checkpoint_list", {});
  return checkpoints.find((c) => c.checkpoint_num === cpId) ||
         checkpoints.find((c) => addrNum(c.start) === addr);
}

/**
 * Wait for a checkpoint using exactly ONE resume.
 *
 * `vice_execution_run` is the call this host server dies on -- six outages in
 * one session, the last three all on that call -- so the resume count is the
 * risk we minimise. The lever is a measurement from the speed trials:
 * `vice_ping` does NOT pause the machine (ping-polling sustained 986,693
 * cycles/s against 991,569 for a completely quiet machine), whereas
 * `vice_checkpoint_list` does. So we can watch progress with ping, for free,
 * and resume only once instead of once per window -- an ~8x cut in the
 * offending call.
 *
 * Order matters and is the fix for an earlier bug: check hit_count BEFORE
 * resuming (the machine is often already stopped on the checkpoint, and blindly
 * resuming would run straight past the dump point), then resume, then wait for
 * `paused`, then CONFIRM via hit_count that the stop was actually this
 * checkpoint rather than something else.
 */
async function waitCheckpointHit(cpId, addr, label) {
  // Already fired? Then we are standing on the trigger -- never resume past it.
  const pre = await readCheckpoint(cpId, addr);
  if (pre && pre.hit_count >= 1) return pre;

  await call("vice_execution_run", {}); // the single resume
  const budgetMs = POLL_WINDOWS_MS.reduce((a, b) => a + b, 0);
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    await sleep(PING_INTERVAL_MS);
    const p = await call("vice_ping", {}); // does not pause the machine
    if (p.execution !== "paused") continue;
    const cp = await readCheckpoint(cpId, addr);
    if (cp && cp.hit_count >= 1) return cp;
    // Paused for some other reason: resume and keep waiting. Rare, and we
    // deliberately do not treat a bare pause as the trigger.
    await call("vice_execution_run", {});
  }
  // Deadline passed -- one last read before giving up, in case the checkpoint
  // fired between the final ping and now.
  const last = await readCheckpoint(cpId, addr);
  if (last && last.hit_count >= 1) return last;

  throw new Error(
    `waitCheckpointHit(${label} ${hex4(addr)}): checkpoint never fired within ${budgetMs / 1000}s. ` +
      `vice_run_until's cycles argument is documented as "not yet implemented" so there is no ` +
      `server-side timeout backing this. Recovery is a HOST-SIDE restart, which this container ` +
      `cannot perform -- run tools/vice-supervisor.sh on the HOST; it restarts x64sc automatically ` +
      `and logs the crash for the still-open root-cause investigation (see .planning/STATE.md).`
  );
}

async function runToCheckpoint(addr, label) {
  const added = await call("vice_checkpoint_add", { start: hex4(addr), exec: true, stop: true });
  const id = added.checkpoint_num ?? added.checkpoint?.checkpoint_num;
  if (id != null) armedCheckpoints.add(id);
  // No resume here: waitCheckpointHit owns the single resume, so that the
  // vice_execution_run count stays at exactly one per wait.
  const cp = await waitCheckpointHit(id, addr, label);
  if (id != null) {
    await call("vice_checkpoint_delete", { checkpoint_num: id });
    armedCheckpoints.delete(id);
  }
  return { id, hitCount: cp.hit_count };
}

/**
 * Attach + autostart the release's disk image, then walk whatever input gates
 * that release's crack puts in front of the game (a cracktro "hit any key"
 * prompt, typically). Each gate is a registry-declared {address, key} pair:
 * we run to the address the crack polls the key at -- so the press lands at a
 * deterministic point in EMULATED time rather than whenever wall-clock got
 * there -- then press via the keyboard MATRIX, because crack loaders poll
 * $DC00/$DC01 directly and never see the KERNAL buffer.
 *
 * Gates live in the registry, not here: no release identifier appears in this
 * control flow, so a third release is one more registry entry.
 */
export async function boot(releaseId) {
  const rel = release(releaseId);
  const containerPath = join(REPO_ROOT, rel.disk_image);
  const preRegs = await call("vice_registers_get", {});

  const { hostPath } = await tryHostPaths(containerPath, async (p) => {
    await call("vice_disk_attach", { unit: 8, path: p });
    return call("vice_autostart", { path: p });
  });

  // autostart only *arms* the load; the CPU is still halted from the hard
  // reset (reset uses run_after:false deliberately, so attach happens against
  // a stopped machine). Without this the loader never executes at all.
  await call("vice_execution_run", {});

  let method = "autostart";
  let fallbackUsed = false;
  let moved = false;
  for (let i = 0; i < 5 && !moved; i++) {
    const postRegs = await call("vice_registers_get", {});
    moved = postRegs.PC !== preRegs.PC;
  }
  if (!moved) {
    await call("vice_keyboard_type", { text: 'LOAD"*",8,1\n' });
    await call("vice_keyboard_type", { text: "RUN\n" });
    await call("vice_execution_run", {});
    method = "keyboard-load-run";
    fallbackUsed = true;
  }

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
      `inspect with vice_backtrace/vice_disassemble by hand. If execution appears hung, recovery is a ` +
      `HOST-SIDE restart, which this container cannot perform -- run tools/vice-supervisor.sh on the ` +
      `HOST; it restarts x64sc automatically and logs the crash as evidence.`
  );
}

// ----------------------------------------------------------------- capture

// Each poll cycle is: read state (which PAUSES the machine), resume, then let
// it run for one window. The window is not idle waiting -- it is the only
// interval in which the emulated CPU actually advances, so a short window
// starves the machine and the trigger appears to "never fire". A KERNAL cold
// boot plus a turbo-loader disk load needs tens of emulated seconds.
//
// Progressively longer run windows, in ms. Rationale, and it is not just about
// speed: a `stop:true` checkpoint halts the machine exactly at the trigger
// whether we notice 2 seconds later or 30, so POLLING FREQUENCY HAS NO EFFECT
// ON WHERE THE MACHINE STOPS. Polling rarely is therefore strictly better --
// identical determinism, an order of magnitude fewer monitor enter/exit
// transitions. That matters because the host server has dropped its connection
// five times in one session, always during a monitor transition
// (`vice_execution_run` or checkpoint work), so transition count is the one
// risk factor we control. This schedule spans ~150s of emulated running in 8
// round-trips instead of ~60.
const POLL_WINDOWS_MS = [3000, 6000, 12000, 20000, 25000, 28000, 28000, 28000];
// How often to ask `vice_ping` whether the machine has stopped yet. Ping is
// free (it does not pause the machine), so this only costs a round-trip.
const PING_INTERVAL_MS = 1000;

// NOTE: a `waitPaused()` helper used to live here, polling vice_ping until
// execution reported "paused". It is deliberately DELETED, not kept "just in
// case". It was wrong in a way that produced a silently-wrong capture point:
// the machine is normally ALREADY paused when we arm a checkpoint (every
// checkpoint stop leaves it paused, and every state read pauses it), so the
// poll returned instantly without any transition having occurred, and the
// caller then read hit_count 0 and either refused or captured from the wrong
// place. Wait on the checkpoint's own hit_count instead -- see
// waitCheckpointHit above. Do not reintroduce a paused-poll.

/**
 * Arm the checkpoint, kick off run_until, and confirm via the checkpoint's
 * own hit_count once paused -- belt and suspenders, so the stop is a
 * checkpoint event rather than a bare dependence on run_until's semantics.
 * Then reads the full 65536-byte RAM image and every chip-state field the
 * capture record needs.
 */
export async function capture(releaseId, triggerAddress, { releaseKeys = [], session } = {}) {
  // capture() starts its own session when none is passed, so the standalone
  // `capture` CLI verb (not just `recover`) is covered by identity checking
  // too (D-3).
  const activeSession = session || beginSession();

  // Cheap, epoch-only check BEFORE arming anything: if a restart already
  // happened earlier in this run (reset/boot), catch it now rather than
  // arming a checkpoint against a machine that was never verified.
  await assertSameMachine(activeSession, {
    where: "capture:before-arm",
    armedCheckpoints: [...armedCheckpoints],
  });

  const addr = addrNum(triggerAddress);
  const added = await call("vice_checkpoint_add", { start: hex4(addr), exec: true, stop: true });
  const cpId = added.checkpoint_num ?? added.checkpoint?.checkpoint_num;
  if (cpId != null) armedCheckpoints.add(cpId);
  // Deliberately NOT using vice_run_until here, despite the plan's
  // "belt and suspenders" instruction. run_until creates its OWN temporary
  // checkpoint at the same address; we observed two live checkpoints at $08B1
  // (one temporary) after a failed attempt, and both host-server crashes so far
  // happened during checkpoint+run_until work. A plain armed checkpoint plus
  // execution_run is strictly simpler, is still a signal rather than a
  // duration, and avoids the duplicate-checkpoint collision entirely.
  // Wait on the checkpoint's own hit_count, never on "is execution paused" --
  // the machine is usually already paused when we arm, so a paused-poll would
  // return instantly and we would capture from the wrong point (or refuse).
  const cp = await waitCheckpointHit(cpId, addr, "dump trigger");

  // The long wait above is where a host-server outage is most likely to have
  // landed (D-3) -- check identity immediately, passing the still-armed
  // trigger checkpoint id as the fallback-probe target (it isn't deleted
  // until just below, so it's still a valid id to probe with here).
  await assertSameMachine(activeSession, {
    where: "capture:after-trigger-wait",
    armedCheckpoints: [...armedCheckpoints],
  });

  // Release any key boot() left held, NOW -- at the trigger, which is a program
  // event and therefore the same CPU cycle on every run. This is what makes the
  // dump reproducible: a timed release drifts, a checkpoint-gated one does not.
  // Doing it before any memory read also means the captured image has no key
  // artificially held down in the CIA state.
  for (const k of releaseKeys) {
    try { await call("vice_keyboard_matrix", { key: k, pressed: false }); }
    catch (e) { console.error(`warn: could not release held key ${k}: ${e.message}`); }
  }

  if (cpId != null) {
    try {
      await call("vice_checkpoint_delete", { checkpoint_num: cpId });
      armedCheckpoints.delete(cpId);
    }
    catch (e) { console.error(`warn: could not delete trigger checkpoint ${cpId}: ${e.message}`); }
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

  // The "before any dump is declared good" gate (D-3): the read above is the
  // last thing that touches the machine before the image is trusted and
  // handed back to the caller.
  await assertSameMachine(activeSession, {
    where: "capture:before-declare-good",
    armedCheckpoints: [...armedCheckpoints],
  });

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

/**
 * Rename any artifact that exists to `<name>.VOID-<ISO timestamp>` so it can
 * never be mistaken for a valid capture, and write a sibling `<name>.VOID.json`
 * evidence note recording why, the baseline/observed epochs, the last tool
 * call attempted, and when -- so a voided run is itself evidence, not just a
 * discarded one (D-3, D-4). Missing artifacts are a silent no-op: capture()
 * can fail before either file was ever written.
 *
 * Deliberately NOT a reset/reboot/resume of any kind (D-3): captures are
 * deterministic and cheap to repeat, and a wrong dump is not something to
 * paper over automatically.
 */
export function voidRun({ binPath, capturePath, reason, baselineEpoch, currentEpoch, lastToolCall: lastCall } = {}) {
  if (!binPath && !capturePath) {
    return { voidedArtifacts: [], notePath: null };
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const voidedArtifacts = [];
  for (const p of [binPath, capturePath]) {
    if (!p || !existsSync(p)) continue;
    const voidPath = `${p}.VOID-${ts}`;
    renameSync(p, voidPath);
    voidedArtifacts.push(voidPath);
  }
  const notePath = `${binPath || capturePath}.VOID.json`;
  writeFileSync(
    notePath,
    JSON.stringify(
      {
        reason: reason ?? null,
        baseline_epoch: baselineEpoch ?? null,
        current_epoch: currentEpoch ?? null,
        last_tool_call: lastCall ?? lastToolCall(),
        voided_artifacts: voidedArtifacts,
        voided_at: new Date().toISOString(),
      },
      null,
      2
    ) + "\n"
  );
  return { voidedArtifacts, notePath };
}

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
      booted = await boot(releaseId);
    }

    // Hand capture() the keys boot() left held so it can drop them at the
    // trigger -- a program event, hence the same cycle every run. Also hand
    // it this run's session, so capture()'s three identity gates compare
    // against the epoch this procedure started with, not a fresh one.
    const cap = await capture(releaseId, triggerAddress, { releaseKeys: booted.heldKeys ?? [], session });

    // Per-run name: vice_snapshot_save REFUSES to overwrite an existing name and
    // the tool surface has no snapshot_delete, so a fixed name makes the second
    // run of `reproduce` fail. Still explicit and never "snapshot.vsf".
    const snapshotName = `${releaseId}_gameentry_${runLabel}`;
    let snapshotSaved = true;
    let snapshotNote = null;
    try {
      await call("vice_snapshot_save", {
        name: snapshotName,
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
      console.error(`warn: snapshot "${snapshotName}" not saved (capture is unaffected): ${e.message}`);
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
      snapshot_name: snapshotName,
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
      snapshot_names: [...new Set([...(r.snapshot_names || []), snapshotName])],
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
