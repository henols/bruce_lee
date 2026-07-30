#!/usr/bin/env node
// The reproducibility verdict over two RAM captures -- a property of the two
// byte images, provable without an emulator. Keeping this module emulator-free
// (no imports at all) is what lets the reproducibility rule be tested
// exhaustively in-process, rather than only against live hardware.

/**
 * Volatile scratch: not part of any program image, and not evidence.
 *
 * $0100-$01FF is the 6502 stack page -- bytes below the live stack pointer are
 * dead frames from calls that already returned, so their contents are
 * meaningless leftovers. $0200-$03FF is the KERNAL's work area and BASIC input
 * buffer, which this game does not own; it holds whatever the KERNAL's own boot
 * left there.
 *
 * Excluded from the reproducibility assertion, but RECORDED with a reason --
 * never silently dropped.
 */
export const VOLATILE_RANGES = [
  { start: 0x0000, end: 0x0001, reason: "6510 on-chip I/O port registers (DDR + port), not RAM -- reading them returns live CPU/banking state, not stored data" },
  { start: 0x0100, end: 0x01ff, reason: "6502 stack page; bytes below the live SP are dead call frames" },
  { start: 0x0200, end: 0x03ff, reason: "KERNAL work area / BASIC input buffer; not owned by the game" },
];

const inRanges = (addr, ranges) => ranges.some((r) => addr >= r.start && addr <= r.end);
const popcount = (x) => { let n = 0; while (x) { n += x & 1; x >>= 1; } return n; };

/**
 * Decide reproducibility over the PROGRAM IMAGE, using only the two captures.
 *
 * Why not all 64K: never-written RAM drifts continuously while the machine
 * runs. Measured three ways -- 994 bytes between two 20s idle runs with no disk
 * and no game; 1014 on a repeat; and 993 between two back-to-back "baseline"
 * captures with the machine never deliberately run. Full 64K byte-identity is
 * unachievable in principle here.
 *
 * Why no baseline: a power-on baseline was tried and REFUTED. mode:"hard"
 * reports "Machine power cycled" but does not restore pristine RAM once the
 * machine has run (real hardware behaves the same -- reset does not clear
 * DRAM), and the drift accumulates during the capture itself, so no stable
 * reference exists at any point. Address-set exclusion was also refuted: drift
 * is stochastic PER RUN, and an idle control yielding 1014 drift-prone
 * addresses covered only 2 of 137 real diffs.
 *
 * What works is a property of the VALUE, not of the address or a block
 * threshold: drift flips INDIVIDUAL BITS. Measured on two real captures, all
 * 137 differing bytes outside volatile scratch had Hamming distance exactly 1.
 * A program writing genuinely different data differs in ~4 bits on average, so
 * a multi-bit difference is a real divergence and FAILS. This keeps the
 * contract falsifiable rather than vacuous.
 *
 * Honest limit, recorded rather than hidden: a genuine program divergence that
 * happens to differ in exactly one bit would be misclassified as drift (~3% for
 * random byte pairs). Every drift candidate is therefore COUNTED AND RETURNED,
 * never silently swallowed, so the caller can inspect them and a reviewer can
 * see how large that set is.
 */
export function classifyRuns({ runA, runB, volatileRanges = VOLATILE_RANGES }) {
  if (runA.length !== 65536 || runB.length !== 65536) {
    throw new Error("classifyRuns: both images must be exactly 65536 bytes");
  }
  const programMismatches = [];
  const decayCandidates = [];
  let identical = 0, volatileDiffs = 0;
  for (let i = 0; i < 65536; i++) {
    if (runA[i] === runB[i]) { identical++; continue; }
    if (inRanges(i, volatileRanges)) { volatileDiffs++; continue; }
    const bits = popcount(runA[i] ^ runB[i]);
    const rec = { addr: i, a: runA[i], b: runB[i], bits };
    if (bits === 1) decayCandidates.push(rec);
    else programMismatches.push(rec);
  }
  return {
    ok: programMismatches.length === 0,
    identicalBytes: identical,
    programMismatches,
    decayCandidates,
    volatileDiffs,
    volatileRanges,
  };
}
