// Project-level coverage of the RUN-SET reproducibility rule in recover.mjs.
//
// The byte-assembly and pairwise-comparison contracts are tested in the
// c64-ram-capture skill. What lives here is the part that is specific to this
// project's gate: a byte is only called stable when it agrees across N >= 3
// captures, and a pairwise multi-bit finding is re-adjudicated against the whole
// run set before it is called a real divergence.
//
// These tests exist to keep that rule FALSIFIABLE. Every relaxation below is
// paired with a case proving a genuine divergence still fails.
import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyRunSet } from "./recover.mjs";

// 0x33 is neither $00 nor $FF, so a buffer full of it reads as "program-like"
// to the power-on-pattern clause. That keeps these cases honest: a divergence
// here cannot be excused as never-written RAM.
const programLike = () => Buffer.alloc(65536, 0x33);
const patternLike = () => {
  const b = Buffer.alloc(65536);
  for (let i = 0; i < 65536; i++) b[i] = (i >> 2) % 2 ? 0xff : 0x00;
  return b;
};
const at = (bufs, addr, values) => bufs.forEach((b, i) => { b[addr] = values[i]; });

test("classifyRunSet: refuses fewer than 3 captures outright", () => {
  const r = [programLike(), programLike()];
  assert.throws(() => classifyRunSet(r), /at least 3/);
});

test("classifyRunSet: refuses a capture that is not 65536 bytes", () => {
  assert.throws(
    () => classifyRunSet([programLike(), programLike(), Buffer.alloc(100)]),
    /65536/
  );
});

test("classifyRunSet: three identical captures pass with nothing unstable", () => {
  const r = classifyRunSet([programLike(), programLike(), programLike()]);
  assert.equal(r.ok, true);
  assert.equal(r.stableBytes, 65536);
  assert.equal(r.unstableBytes, 0);
});

test("classifyRunSet: NOT VACUOUS -- a real divergence in program-like memory fails", () => {
  const bufs = [programLike(), programLike(), programLike()];
  at(bufs, 0x5000, [0x00, 0x00, 0xff]); // 8 bits, no shared 1-bit origin
  const r = classifyRunSet(bufs);
  assert.equal(r.ok, false, "an 8-bit divergence must fail or the gate proves nothing");
  assert.equal(r.programMismatches.length, 1);
  assert.equal(r.programMismatches[0].addr, 0x5000);
});

test("classifyRunSet: a 4-bit spread with no shared single-bit origin still fails", () => {
  const bufs = [programLike(), programLike(), programLike()];
  at(bufs, 0x5000, [0x00, 0x00, 0x0f]);
  const r = classifyRunSet(bufs);
  assert.equal(r.ok, false);
  assert.equal(r.reclassifiedAsDrift.length, 0);
});

test("classifyRunSet: independent single-bit drift from one origin is drift, not divergence", () => {
  // The $DD0C case, measured live: 00 / 04 / 10. Each is one bit from $00, but
  // 04 vs 10 is two bits apart, so the pairwise rule alone called it a real
  // divergence. The run-set rule must see the shared origin.
  const bufs = [programLike(), programLike(), programLike()];
  at(bufs, 0x5000, [0x00, 0x04, 0x10]);
  const r = classifyRunSet(bufs);
  assert.equal(r.ok, true);
  assert.equal(r.reclassifiedAsDrift.length, 1);
  assert.equal(r.reclassifiedAsDrift[0].sharedOrigin, true);
  assert.deepEqual(r.reclassifiedAsDrift[0].values, [0x00, 0x04, 0x10]);
});

test("classifyRunSet: a byte inside a pure power-on pattern block is drift", () => {
  // The $DA7B case: 00 / 00 / 0a, surrounded entirely by $00 and $FF.
  const bufs = [patternLike(), patternLike(), patternLike()];
  at(bufs, 0x9000, [0x00, 0x00, 0x0a]);
  const r = classifyRunSet(bufs);
  assert.equal(r.ok, true);
  assert.equal(r.reclassifiedAsDrift.length, 1);
  assert.equal(r.reclassifiedAsDrift[0].patternBlock, true);
});

test("classifyRunSet: the pattern-block test is binary, not a percentage", () => {
  // One neighbour that is neither $00 nor $FF disqualifies the block. This is
  // the guard against reintroducing a tunable "90% of the block" threshold.
  const bufs = [patternLike(), patternLike(), patternLike()];
  bufs.forEach((b) => { b[0x9004] = 0x33; });
  at(bufs, 0x9000, [0x00, 0x00, 0x0f]); // 4 bits: no shared origin either
  const r = classifyRunSet(bufs);
  assert.equal(r.ok, false, "a single non-pattern neighbour must disqualify the block");
});

test("classifyRunSet: volatile scratch divergence never reaches the verdict", () => {
  const bufs = [programLike(), programLike(), programLike()];
  at(bufs, 0x0150, [0x00, 0xff, 0x0f]); // stack page
  at(bufs, 0x0300, [0x00, 0xff, 0x0f]); // KERNAL work area
  at(bufs, 0x0000, [0x00, 0xff, 0x0f]); // 6510 port register
  const r = classifyRunSet(bufs);
  assert.equal(r.ok, true);
  assert.equal(r.programMismatches.length, 0);
});

test("classifyRunSet: every pair is compared, not just consecutive ones", () => {
  const bufs = [programLike(), programLike(), programLike()];
  at(bufs, 0x5000, [0x00, 0x33, 0xff]); // run1 vs run3 is the telling pair
  const r = classifyRunSet(bufs);
  assert.equal(r.pairs.length, 3, "3 captures produce 3 pairs");
  assert.equal(r.ok, false);
});

test("classifyRunSet: unstable bytes are counted even when reclassified as drift", () => {
  const bufs = [patternLike(), patternLike(), patternLike()];
  at(bufs, 0x9000, [0x00, 0x00, 0x0a]);
  const r = classifyRunSet(bufs);
  assert.equal(r.unstableBytes, 1, "drift is excluded from the verdict but never uncounted");
  assert.equal(r.stableBytes, 65535);
});
