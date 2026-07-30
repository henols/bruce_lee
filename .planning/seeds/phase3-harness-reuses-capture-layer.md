---
title: Phase 3's verification harness is the second consumer of the capture layer
trigger_condition: Phase 3 (Verification Harness & Original Baselines) starts planning
planted_date: 2026-07-30
---

# Phase 3 reuses layers A + B, registry-free

ROADMAP **Phase 3 — Verification Harness & Original Baselines** does replay + checkpoint
comparison against the rebuild. That is the same machinery as recovery: drive the emulator to
a deterministic stop point, read RAM, compare two runs, decide whether a difference is real.

It is the second in-repo consumer of layers A and B from
[[reusable-capture-harness-seam]] — and unlike recovery it has **no release registry at all**.
Its inputs are a `.prg` from the ACME build and a set of checkpoints, not a
`recovery/RELEASES.json` entry.

## Why this is a seed and not just a todo

It is the reason layer B must take plain paths rather than a release id. If the extraction
lands before Phase 3 starts, that constraint is already satisfied and Phase 3 imports a
tested module. If Phase 3 starts first, the likely outcome is a *parallel* harness that
re-derives `classifyRuns`, the drift rule, and the single-resume wait — and then the two
copies disagree about what counts as a real divergence.

## When this fires, check

- Does layer B still expose `classifyRuns` / `VOLATILE_RANGES` without a release concept?
  The Hamming-distance-1 drift rule applies verbatim to rebuild-vs-original comparison.
- Does `capture()` take a trigger address and an output path, nothing more?
- Are the `assertSameMachine` epoch gates reusable for a replay run, or do they assume a
  single long capture? A replay may span many checkpoints, so identity checking may need to
  be per-checkpoint rather than three fixed gates.
- `VOLATILE_RANGES` was derived for a post-decrunch game-entry dump. Verify the same
  exclusions are right when comparing a running rebuild — the stack page contents at an
  arbitrary gameplay checkpoint are a different question from at a single entry point.
