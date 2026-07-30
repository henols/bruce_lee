// node:test coverage of tools/recover.mjs's byte-assembly contract. Drives
// captureImage with a stub `call` so every behaviour below is proven without
// touching the emulator -- a deliberate, recorded deviation from
// 01-VALIDATION.md's "no test framework" line: node:test ships with Node and
// costs nothing to adopt, and this is the one place in Phase 1 where a silent
// bug corrupts every downstream provenance verdict rather than producing a
// visible failure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assembleChunks, captureImage, voidRun, classifyRuns, VOLATILE_RANGES } from "./recover.mjs";
import { beginSession, assertSameMachine, readEpoch, MachineRestartedError } from "./vice.mjs";

const tmpEpochDir = () => mkdtempSync(join(tmpdir(), "vice-epoch-"));

function syntheticChunks(chunkSize) {
  const chunks = [];
  for (let addr = 0; addr < 65536; addr += chunkSize) {
    const size = Math.min(chunkSize, 65536 - addr);
    const data = Buffer.alloc(size);
    for (let i = 0; i < size; i++) data[i] = (addr + i) & 0xff;
    chunks.push({ start: addr, data });
  }
  return chunks;
}

test("assembleChunks: ascending and descending chunk order produce equal SHA-256", () => {
  const chunks = syntheticChunks(4096);
  const ascending = assembleChunks(chunks);
  const descending = assembleChunks([...chunks].reverse());
  const hashOf = (buf) => createHash("sha256").update(buf).digest("hex");
  assert.equal(hashOf(ascending), hashOf(descending));
  assert.equal(ascending.length, 65536);
});

test("assembleChunks: throws when a chunk is shorter than its requested/claimed size, no image returned", () => {
  // A chunk claiming to cover [0, 100) but only supplying 50 bytes should
  // still fail the "every address 0x0000-0xFFFF covered" check, since the
  // remaining 50 bytes of its claimed span are never actually written.
  assert.throws(() => {
    assembleChunks([{ start: 0, data: Buffer.alloc(50) }, { start: 100, data: Buffer.alloc(65436) }]);
  });
});

test("assembleChunks: throws when two chunks overlap", () => {
  const a = { start: 0, data: Buffer.alloc(10) };
  const b = { start: 5, data: Buffer.alloc(10) };
  assert.throws(() => assembleChunks([a, b]), /overlapping chunk/);
});

test("assembleChunks: throws when the union of chunks leaves an address uncovered", () => {
  assert.throws(
    () => assembleChunks([{ start: 0, data: Buffer.alloc(100) }]),
    /is not covered by any chunk/
  );
});

test("assembleChunks: a 16-byte window straddling a chunk boundary equals the tail+head concatenation", () => {
  const chunks = syntheticChunks(4096);
  const image = assembleChunks(chunks);
  const boundary = 4096;
  const window = image.subarray(boundary - 8, boundary + 8);
  const lowerTail = chunks[0].data.subarray(chunks[0].data.length - 8);
  const upperHead = chunks[1].data.subarray(0, 8);
  assert.deepEqual(window, Buffer.concat([lowerTail, upperHead]));
});

test("captureImage: propagates a stub call's failure on the third chunk and returns no buffer", async () => {
  let calls = 0;
  const stubCall = async (toolName, args) => {
    calls++;
    assert.equal(toolName, "vice_memory_read");
    assert.equal(args.bank, "ram");
    if (calls === 3) throw new Error("stub: simulated transport failure on chunk 3");
    const size = args.size;
    return { data_hex: Buffer.alloc(size).toString("hex") };
  };
  await assert.rejects(
    captureImage({ call: stubCall, ranges: [{ start: 0, end: 0xffff }], chunkSize: 4096 }),
    /simulated transport failure/
  );
});

test("captureImage: throws when a chunk's decoded byte length is short of its requested size", async () => {
  const stubCall = async (_toolName, args) => {
    // Always return one byte fewer than requested.
    return { data_hex: Buffer.alloc(args.size - 1).toString("hex") };
  };
  await assert.rejects(
    captureImage({ call: stubCall, ranges: [{ start: 0, end: 0xffff }], chunkSize: 4096 }),
    /requested 4096 bytes, got 4095/
  );
});

// -------------------------------------------------------- readEpoch (D-3, D-6)
//
// tools/vice-supervisor.sh runs on the HOST and cannot be exercised here, but
// readEpoch() is the container-side half of the contract and is fully
// testable against a temp file standing in for the supervisor's epoch.json.

test("readEpoch: absent file reports present:false without throwing", () => {
  const e = readEpoch(join(tmpEpochDir(), "epoch.json"));
  assert.equal(e.present, false);
  assert.equal(e.epoch, null);
});

test("readEpoch: malformed JSON reports present:false without throwing (T-jty-01)", () => {
  const p = join(tmpEpochDir(), "epoch.json");
  writeFileSync(p, "{not valid json");
  const e = readEpoch(p);
  assert.equal(e.present, false);
});

test("readEpoch: a well-formed epoch.json round-trips epoch/pid/spawned_at", () => {
  const p = join(tmpEpochDir(), "epoch.json");
  writeFileSync(p, JSON.stringify({ epoch: 4, spawned_at: "2026-01-01T00:00:00Z", pid: 123 }));
  const e = readEpoch(p);
  assert.equal(e.present, true);
  assert.equal(e.epoch, 4);
  assert.equal(e.spawned_at, "2026-01-01T00:00:00Z");
  assert.equal(e.pid, 123);
});

// --------------------------------------------------- assertSameMachine (D-3, D-6)
//
// Every bullet in the plan's <behavior> block, driven with a temp epoch file
// (mkdtemp under os.tmpdir()) and a stub `call` returning a synthetic
// `{ checkpoints: [...] }`, exactly like the existing `{ call: stubCall }`
// injection pattern used for captureImage above.

test("assertSameMachine: baseline epoch present, later read shows a DIFFERENT epoch -> MachineRestartedError, run void (epoch-changed)", async () => {
  const epochPath = join(tmpEpochDir(), "epoch.json");
  writeFileSync(epochPath, JSON.stringify({ epoch: 1 }));
  const session = beginSession({ epochPath });
  assert.equal(session.baseline.present, true);
  assert.equal(session.baseline.epoch, 1);

  writeFileSync(epochPath, JSON.stringify({ epoch: 2 })); // the emulator "restarted"
  await assert.rejects(
    assertSameMachine(session, { where: "test:epoch-changed", armedCheckpoints: [] }),
    MachineRestartedError
  );
});

test("assertSameMachine: epoch file absent at session start is not an error -- capture proceeds with no reconnect (epoch-absent)", async () => {
  const session = beginSession({ epochPath: join(tmpEpochDir(), "epoch.json") });
  assert.equal(session.baseline.present, false);
  let called = false;
  const stubCall = async () => { called = true; return { checkpoints: [] }; };
  await assert.doesNotReject(
    assertSameMachine(session, { where: "test:no-supervisor", armedCheckpoints: [], reconnected: false, call: stubCall })
  );
  assert.equal(called, false, "no supervisor, no reconnect -- must not make any MCP call");
});

test("assertSameMachine: epoch absent, a reconnect happened, and the harness's own armed checkpoint is MISSING from vice_checkpoint_list -> MachineRestartedError (checkpoint-disappeared)", async () => {
  const session = beginSession({ epochPath: join(tmpEpochDir(), "epoch.json") });
  const stubCall = async (toolName) => {
    assert.equal(toolName, "vice_checkpoint_list");
    return { checkpoints: [{ checkpoint_num: 99 }] }; // id 5 is not in this list
  };
  await assert.rejects(
    assertSameMachine(session, { where: "test:checkpoint-missing", armedCheckpoints: [5], reconnected: true, call: stubCall }),
    MachineRestartedError
  );
});

test("assertSameMachine: epoch absent, a reconnect happened, and the armed checkpoint IS still present -> pass, same machine", async () => {
  const session = beginSession({ epochPath: join(tmpEpochDir(), "epoch.json") });
  const stubCall = async () => ({ checkpoints: [{ checkpoint_num: 5 }, { checkpoint_num: 7 }] });
  await assert.doesNotReject(
    assertSameMachine(session, { where: "test:checkpoint-present", armedCheckpoints: [5], reconnected: true, call: stubCall })
  );
});

test("assertSameMachine: a reconnect happened and NOTHING can prove sameness (no epoch, no armed checkpoint) -> void, no MCP call wasted", async () => {
  const session = beginSession({ epochPath: join(tmpEpochDir(), "epoch.json") });
  let called = false;
  const stubCall = async () => { called = true; return { checkpoints: [] }; };
  await assert.rejects(
    assertSameMachine(session, { where: "test:unprovable", armedCheckpoints: [], reconnected: true, call: stubCall }),
    /identity could not be proven/
  );
  assert.equal(called, false, "nothing to probe with -- must not call vice_checkpoint_list");
});

test("assertSameMachine: no reconnect and no epoch change -> pass, and no extra MCP call is made", async () => {
  const epochPath = join(tmpEpochDir(), "epoch.json");
  writeFileSync(epochPath, JSON.stringify({ epoch: 1 }));
  const session = beginSession({ epochPath });
  let called = false;
  const stubCall = async () => { called = true; return { checkpoints: [] }; };
  await assert.doesNotReject(
    assertSameMachine(session, { where: "test:stable", armedCheckpoints: [1, 2, 3], reconnected: false, call: stubCall })
  );
  assert.equal(called, false, "epoch alone resolves this -- the checkpoint probe only runs after a reconnect");
});

// ------------------------------------------------------------ voidRun (D-3, D-4, D-6)

test("voidRun: renames existing artifacts to *.VOID-<timestamp> and writes a sibling evidence note", () => {
  const dir = tmpEpochDir();
  const binPath = join(dir, "danish-gameentry-run1.bin");
  const capturePath = join(dir, "danish-gameentry-run1.capture.json");
  writeFileSync(binPath, Buffer.from([1, 2, 3]));
  writeFileSync(capturePath, "{}");

  const { voidedArtifacts, notePath } = voidRun({
    binPath,
    capturePath,
    reason: "test: emulator restarted mid-capture",
    baselineEpoch: 1,
    currentEpoch: 2,
  });

  assert.equal(existsSync(binPath), false, "original bin path must no longer exist under its old name");
  assert.equal(existsSync(capturePath), false, "original capture path must no longer exist under its old name");
  assert.equal(voidedArtifacts.length, 2);
  for (const p of voidedArtifacts) {
    assert.match(p, /\.VOID-/);
    assert.equal(existsSync(p), true);
  }
  assert.equal(existsSync(notePath), true);
  const note = JSON.parse(readFileSync(notePath, "utf8"));
  assert.equal(note.reason, "test: emulator restarted mid-capture");
  assert.equal(note.baseline_epoch, 1);
  assert.equal(note.current_epoch, 2);
  assert.equal(note.voided_artifacts.length, 2);
});

test("voidRun: artifacts that do not exist are a silent no-op (nothing renamed, no error)", () => {
  const dir = tmpEpochDir();
  const binPath = join(dir, "does-not-exist.bin");
  const capturePath = join(dir, "does-not-exist.capture.json");

  const { voidedArtifacts } = voidRun({ binPath, capturePath, reason: "test: nothing was ever written" });
  assert.deepEqual(voidedArtifacts, []);
  assert.equal(existsSync(binPath), false);
  assert.equal(existsSync(capturePath), false);
});

// ---------------------------------------------------------------------------
// classifyRuns: the reproducibility contract for the PROGRAM IMAGE.
//
// Full 64K byte-identity is unachievable here -- never-written RAM drifts while
// the machine runs (measured 994 / 1014 / 993 bytes across three independent
// controls, with no game involved). A power-on baseline and address-set
// exclusion were both tried and refuted; the surviving discriminator is a
// property of the VALUE: drift flips individual bits, so a multi-bit difference
// is a real divergence.
//
// The danger is VACUITY. These tests exist to keep the contract falsifiable.

const flat = (v) => Buffer.alloc(65536, v);

test("classifyRuns: identical captures pass", () => {
  const a = flat(0xaa), b = flat(0xaa);
  const r = classifyRuns({ runA: a, runB: b });
  assert.equal(r.ok, true);
  assert.equal(r.identicalBytes, 65536);
  assert.equal(r.programMismatches.length, 0);
});

test("classifyRuns: NOT VACUOUS -- a multi-bit difference fails", () => {
  const a = flat(0xaa), b = flat(0xaa);
  b[0x5000] = 0x55; // 0xAA ^ 0x55 = 0xFF -> 8 bits
  const r = classifyRuns({ runA: a, runB: b });
  assert.equal(r.ok, false, "a real program divergence must fail, or the contract proves nothing");
  assert.equal(r.programMismatches.length, 1);
  assert.equal(r.programMismatches[0].bits, 8);
});

test("classifyRuns: a two-bit difference still fails (only 1 bit is drift)", () => {
  const a = flat(0x00), b = flat(0x00);
  b[0x4000] = 0x03;
  const r = classifyRuns({ runA: a, runB: b });
  assert.equal(r.ok, false);
  assert.equal(r.programMismatches[0].bits, 2);
});

test("classifyRuns: single-bit drift is recorded, not failed, and never swallowed", () => {
  const a = flat(0xff), b = flat(0xff);
  b[0x9000] = 0xfe; // one bit
  const r = classifyRuns({ runA: a, runB: b });
  assert.equal(r.ok, true);
  assert.equal(r.decayCandidates.length, 1, "drift candidates must be returned for inspection");
  assert.equal(r.decayCandidates[0].addr, 0x9000);
  assert.equal(r.decayCandidates[0].bits, 1);
});

test("classifyRuns: volatile scratch ($0100-$03FF) is excluded and counted", () => {
  const a = flat(0x00), b = flat(0x00);
  b[0x0150] = 0xff; // stack page, 8 bits -- must NOT fail
  b[0x0300] = 0xff; // KERNAL work area
  const r = classifyRuns({ runA: a, runB: b });
  assert.equal(r.ok, true);
  assert.equal(r.volatileDiffs, 2);
  assert.equal(r.programMismatches.length, 0);
});

test("classifyRuns: rejects images that are not exactly 65536 bytes", () => {
  assert.throws(() => classifyRuns({ runA: Buffer.alloc(100), runB: flat(0) }), /65536/);
});
