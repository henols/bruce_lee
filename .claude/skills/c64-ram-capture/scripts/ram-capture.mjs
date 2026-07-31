#!/usr/bin/env node
// This is the skill's single documented entry point -- capture a running
// C64's full 64K RAM as a verified flat image, and prove two captures are
// equivalent under RAM drift. It knows nothing about releases, disk
// registries or any `recovery/` directory layout; every path and namespace
// comes in as an argument.
//
// Why this is a separate SKILL rather than more of `vice-session`:
// `vice-session` owns how to reach the emulator, survive it and synchronise
// with it; this owns what makes a dump TRUSTWORTHY and REPRODUCIBLE. Naming
// note: "RAM", not "memory" -- `c64-memory-mapping` already exists and does
// something completely different (address lookup and disassembly
// annotation), so a `c64-memory-capture` sibling would be a confusing pair.
//
// Two sibling-skill dependencies, and copying this skill means copying all
// three: layer A's synchronisation primitives plus the transport/session
// seam from `vice-session`, and host-path translation from
// `devcontainer-host-path` (VICE attaches disks and writes screenshots on the
// HOST, so a container path silently fails). Address normalisation and the
// checkpoint wait come from layer A and must NEVER be hand-rolled here -- the
// deleted paused-poll helper (see vice-sync.mjs's own header) is the bug that
// happens when a primitive drifts from the rationale that shaped it.
//
// The three identity gates in capture() (`before-arm`, `after-trigger-wait`,
// `before-declare-good`) and the rule that a detected restart NEVER triggers
// an automatic reset, reboot or resume (D-3): captures are deterministic and
// cheap to repeat, and a wrong dump is not something to paper over
// automatically.
//
// The `bank:"ram"` vs `bank:"rom"` disagreement check at $E000 is a HARD
// ERROR, not a warning (D-08 confirmation): research verified bank scoping
// only against the idle pre-boot machine, so it is re-confirmed here while
// the game is actually running, and a dump taken with broken bank scoping is
// not a RAM image at all.
//
// Key-release rule: the caller presses and HOLDS a gate key, and this layer
// releases it AT the trigger checkpoint -- a program event, therefore the
// same CPU cycle every run -- before any memory is read. The other half of
// that contract is the caller's gate walk (`tools/recover.mjs`'s `boot()`).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { call, beginSession, assertSameMachine, serverInfo, readEpoch, lastToolCall } from "../../vice-mcp-selector/scripts/vice.mjs";
import { addrNum, hex4, waitCheckpointHit, armedCheckpoints } from "../../vice-mcp-selector/scripts/vice-sync.mjs";
import { tryHostPaths } from "../../devcontainer-host-path/scripts/hostpath.mjs";

export { classifyRuns, VOLATILE_RANGES } from "./ram-compare.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Namespace a snapshot name by the instance PORT that produced it (D-4).
 * `vice_snapshot_save` accepts only a name, not a path, and writes into a
 * SHARED host directory (`~/.config/vice/mcp_snapshots/`) with no
 * overwrite-safe alternative -- N instances saving under the same name would
 * silently clobber each other's snapshots. Applied UNCONDITIONALLY, including
 * the port-6510 fallback: a conditional prefix would mean the same run
 * produces a different name depending on whether a pool happened to be
 * running, defeating the point of an unambiguous host-side name.
 */
export function snapshotName(port, namespace, runLabel) {
  return `p${port}_${namespace}_gameentry_${runLabel}`;
}

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
export async function captureWithFallback(callFn) {
  const ranges = [{ start: 0, end: 0xffff }];
  try {
    const image = await captureImage({ call: callFn, ranges, chunkSize: 65536 });
    return { image, chunkSize: 65536 };
  } catch (e) {
    const image = await captureImage({ call: callFn, ranges, chunkSize: 4096 });
    return { image, chunkSize: 4096, largeReadError: e.message };
  }
}

// -------------------------------------------------------------------- boot

/**
 * Attach + autostart the given disk image. Confirms progress by checking PC
 * actually moved from the immediate post-reset value; if it didn't, falls
 * back to a scripted LOAD"*",8,1 + RUN via the keyboard buffer. This is the
 * generic half of a boot sequence -- it takes no release identifier and does
 * not take a screenshot or write to any registry; the caller owns whatever
 * comes after (gate walks, provenance screenshots, registry writes).
 */
export async function attachAndStart({ diskPath }) {
  const preRegs = await call("vice_registers_get", {});

  const { hostPath } = await tryHostPaths(diskPath, async (p) => {
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
export async function findEntry({ batchSize = 400, maxBatches = 150 } = {}) {
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

/**
 * Arm the checkpoint, kick off run_until, and confirm via the checkpoint's
 * own hit_count once paused -- belt and suspenders, so the stop is a
 * checkpoint event rather than a bare dependence on run_until's semantics.
 * Then reads the full 65536-byte RAM image and every chip-state field the
 * capture record needs.
 */
export async function capture(triggerAddress, { releaseKeys = [], session } = {}) {
  // capture() starts its own session when none is passed, so the standalone
  // `capture` CLI verb (not just `recover`) is covered by identity checking
  // too (D-3).
  const activeSession = session || beginSession();

  // Cheap, epoch-only check BEFORE arming anything: if a restart already
  // happened earlier in this run (reset/boot), catch it now rather than
  // arming a checkpoint against a machine that was never verified.
  await assertSameMachine(activeSession, {
    where: "capture:before-arm",
    armedCheckpoints: armedCheckpoints.ids(),
  });

  const addr = addrNum(triggerAddress);
  const added = await call("vice_checkpoint_add", { start: hex4(addr), exec: true, stop: true });
  const cpId = added.checkpoint_num ?? added.checkpoint?.checkpoint_num;
  if (cpId != null) armedCheckpoints.track(cpId);
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
    armedCheckpoints: armedCheckpoints.ids(),
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
      armedCheckpoints.untrack(cpId);
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
    armedCheckpoints: armedCheckpoints.ids(),
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

// -------------------------------------------------------------------- void

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

// --------------------------------------------------------------- machine/*

/**
 * Capture the deterministic power-on RAM baseline: hard reset with the CPU left
 * halted so the KERNAL never runs and cannot clear anything. Verified stable --
 * two consecutive cold resets read byte-identical 64K.
 */
export async function captureBaseline({ outDir } = {}) {
  if (!outDir) {
    throw new Error("captureBaseline: outDir is required -- the caller must say where poweron.bin/.json go");
  }
  // MUST be the first emulator action after a fresh emulator process starts.
  //
  // `mode:"hard"` reports "Machine power cycled" but does NOT restore pristine
  // RAM once the machine has been running -- exactly like real hardware, where
  // reset does not clear DRAM. Measured: two baselines captured back-to-back in
  // one epoch, after the game had run, differed by 2551 bytes. A baseline taken
  // mid-epoch is therefore NOT a power-on baseline and must not be treated as
  // one. The epoch is recorded below so a stale baseline can be rejected rather
  // than silently believed.
  await call("vice_machine_reset", { mode: "hard", run_after: false });
  const { image, chunkSize } = await captureWithFallback(call);
  if (image.length !== 65536) throw new Error(`captureBaseline: got ${image.length} bytes, expected 65536`);
  mkdirSync(outDir, { recursive: true });
  const sha = createHash("sha256").update(image).digest("hex");
  writeFileSync(join(outDir, "poweron.bin"), image);
  const info = await serverInfo().catch(() => null);
  const epoch = readEpoch()?.epoch ?? null;
  writeFileSync(
    join(outDir, "poweron.json"),
    JSON.stringify({
      sha256: sha,
      bytes: image.length,
      chunk_size: chunkSize,
      epoch,
      captured_at: new Date().toISOString(),
      server: info?.serverInfo ?? null,
      caveat: "Valid ONLY if captured as the first emulator action of this epoch. A hard reset does not restore pristine RAM once the machine has run (measured: 2551 bytes of drift between two mid-epoch baselines).",
    }, null, 2) + "\n"
  );
  return { sha256: sha, path: join(outDir, "poweron.bin"), epoch };
}

/**
 * Build the decay-prone address set empirically: cold-reset the machine, let it
 * run untouched for `runMs`, dump, twice, and record every address that differs.
 * No disk is attached and no key is pressed, so nothing a program did can be
 * confused with drift -- any difference is an emulator-level effect.
 *
 * Two samples under-cover a stochastic effect, so this is a floor, not a
 * complete set. Residual drift therefore surfaces as a reported mismatch rather
 * than being silently absorbed -- which is the honest failure direction.
 */
export async function captureDecayReference({ outDir, runMs = 20000 } = {}) {
  if (!outDir) {
    throw new Error("captureDecayReference: outDir is required -- the caller must say where decay-prone.json goes");
  }
  const grab = async () => {
    await call("vice_machine_reset", { mode: "hard", run_after: false });
    await call("vice_execution_run", {});
    await sleep(runMs);
    await call("vice_execution_pause", {});
    const { image } = await captureWithFallback(call);
    return image;
  };
  const a = await grab();
  const b = await grab();
  const addresses = [];
  for (let i = 0; i < 65536; i++) if (a[i] !== b[i]) addresses.push(i);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "decay-prone.json"),
    JSON.stringify({
      note: "Addresses that differed between two identical idle runs (cold reset, no disk, no keypress). An emulator-level drift floor, not a complete set -- the effect is stochastic.",
      run_ms: runMs,
      count: addresses.length,
      captured_at: new Date().toISOString(),
      addresses,
    }, null, 2) + "\n"
  );
  return { count: addresses.length, runMs };
}
