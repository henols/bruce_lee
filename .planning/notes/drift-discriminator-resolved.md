---
title: The RAM-drift discriminator is resolved — three non-tunable clauses, and where each one's honest edge is
date: 2026-07-31
context: /gsd-explore session on the "Hamming-1 rule is slightly too tight" open gap, which turned out to have been closed by plan 01-01 mid-conversation
---

# The drift discriminator is resolved

## What the gap was

`.planning/STATE.md`'s Phase 1 entry recorded an **open gap**: the reproducibility rule
accepted a byte-difference as RAM drift only at Hamming distance exactly 1, and one 2-bit
byte (`$FDD9`) that was provably inside a power-on pattern block still failed. The rule was
"slightly too tight." The fix was framed as a design decision between *structural
never-written detection* and *an N-run agreement rule*, and explicitly **not** to be resolved
by widening the threshold — widening is threshold-tuning, and tuning until green is how false
confidence gets manufactured (the same reasoning that had already rejected a block-fill
heuristic scoring 134/137).

## What actually resolved it

**Plan 01-01 closed it**, in `tools/recover.mjs`. Drift is now accepted via three
independently-justified clauses, *none of them a tunable number*:

| Clause | Form | Why it is not a threshold |
|---|---|---|
| volatile scratch | `VOLATILE_RANGES` in `ram-compare.mjs` | structural: `$00-$01` are 6510 port registers, `$0100-$01FF` is dead stack frames, `$0200-$03FF` is KERNAL work area the game does not own |
| `inPowerOnPatternBlock` | every one of the 15 neighbouring bytes must be **exactly** `$00` or `$FF` | binary, not a percentage — this is what rehabilitated the previously-rejected block heuristic |
| `sharesSingleBitDriftOrigin` | exhaustive over all **256** candidate origins: could every observed value have come from one origin with ≤1 flip per run? | a complete search, not a heuristic or a search cutoff |

The third clause is the one that dissolves the original gap, and it does so by fixing the
**reference point** rather than the threshold. The pairwise rule compared two equally-drifted
samples against *each other*; drift accumulates independently per run, so two *different*
single-bit flips from a common origin read as a 2-bit difference. The right question is
whether a shared origin exists.

## Independent corroboration

An offline probe over the three retained dumps (`recovery/danish/dumps/danish-gameentry-run{1,2,3}.bin`,
no emulator involved) reached the same diagnosis before the 01-01 code was read. Under the old
pairwise rule those dumps produce 2 failing addresses; both are explained by the shared-origin
reframe. The module's own comment cites the same address the probe surfaced:

> Measured at `$DD0C`: run1=`$00`, run2=`$04`, run3=`$10` — each a single-bit drift from a
> common `$00`, yet `$04` vs `$10` is two bits apart, so the pairwise rule called it a real
> divergence.

Two routes to the same conclusion is the useful part; treat the probe as corroboration, not as
a separate finding.

## Where each clause's honest edge is

Measured on the retained dumps — both flagged addresses are cleared by **both** clauses
independently, which is the design working rather than one clause stretching:

| addr | values across 3 runs | shared origins found | inside power-on block |
|---|---|---|---|
| `$DD0C` | `00 04 10` | `$00` | yes |
| `$DA7B` | `00 00 0a` | `$02`, `$08` | yes |

**The permissive edge worth knowing:** `$DA7B` has no shared origin among the *observed*
values — it needs origin `$08` or `$02`, neither of which any run actually held. With N=3 and
two runs agreeing, the clause can bridge a 2-bit spread by positing an unobserved origin. That
is physically well-motivated (weak DRAM cells drift consistently, so the same cell flipping in
2 of 3 runs is more likely than one run flipping two bits), and here it is independently
backed by the binary block test. But the permissiveness is real and grows with fewer runs, so
it belongs recorded next to the code the way the module already records its other honest limit.

A per-bit-majority formulation (each run vs the consensus of N, threshold still exactly 1 bit)
is *stricter* than shared-origin — it rejects `$DA7B`. It was considered and is not what
landed, because majority is an estimate of the origin whereas the exhaustive search is not.

## Current measured state

`classifyRunSet` over the three retained dumps: `ok: true`, **0 program mismatches**,
65140 stable / 396 unstable bytes. By zone:

| zone | unstable bytes |
|---|---|
| `$0000-$0001` 6510 port registers | 1 |
| `$0002-$00FF` zero page | 0 |
| `$0100-$01FF` stack page | 24 |
| `$0200-$03FF` KERNAL work area | 187 |
| **`$0400-$CB66` program image** | **0** |
| `$CB67-$FFFF` upper RAM | 184 |

Zero unstable bytes in the program image across three independent cold boots. The drift lives
entirely in scratch and in upper RAM the game does not use. Note the zone table is *reporting
only* — the verdict itself carries no per-release address knowledge, so narrowing the reported
image did not make the contract vacuous.

## What this closes and what it does not

- **Closed:** the "Hamming-1 is too tight" gap, and the design decision it was waiting on.
  Neither of the two options originally named was chosen; a third (fix the reference point) made
  the choice unnecessary.
- **Still unexplored:** proving *structurally* which addresses the program writes, rather than
  inferring never-written status from the power-on pattern. A dual-sentinel prefill would do it
  (`memory_fill` with pattern P, boot, capture; repeat with `~P`; addresses that differ were
  never written). Its motivation is now weak — the program image already shows 0 unstable bytes —
  so it was deliberately **not** captured as a todo or a seed. Revisit only if the program image
  ever shows unstable bytes, or if a release other than `danish` disagrees.

See [[reusable-capture-harness-seam]] for the layering this code sits in, and
[[move-drift-classification-into-ram-compare]] for the seam work this note surfaced.
