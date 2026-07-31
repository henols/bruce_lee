---
title: STATE.md still calls the drift-discriminator gap open after plan 01-01 closed it
date: 2026-07-31
priority: medium
---

# Correct two stale STATE.md entries about the drift gap

Plan 01-01 closed the "Hamming-1 rule is slightly too tight" gap. Two STATE.md entries still
describe it as unresolved, so the project's own state file now contradicts the code it
describes. Both are wrong in a way that would mislead whoever reads STATE.md next — including a
future planner deciding what Phase 1 still owes.

See [[drift-discriminator-resolved]] for the measured evidence behind the correction.

## What to change

**1. The Phase 1 decision entry** (currently around `.planning/STATE.md:86`) ends with:

> **Open gap:** one 2-bit drift byte (`$FDD9`, provably inside a power-on pattern block) still
> fails, so the Hamming-1 rule is slightly too tight — the fix is a design decision (structural
> never-written detection vs an N-run agreement rule), deliberately not resolved by widening the
> threshold.

That gap is closed. Two things in this sentence are now actively misleading:

- It presents a **binary choice** ("structural never-written detection vs an N-run agreement
  rule") that was never taken. What landed is a third option: fix the *reference point*, not the
  threshold. `sharesSingleBitDriftOrigin` asks whether all observed values could share one origin
  with ≤1 flip per run, searched exhaustively over all 256 origins.
- It records the power-on-pattern block heuristic as **REJECTED** for being threshold-tunable.
  01-01 revived it as `inPowerOnPatternBlock` in a **binary** form — every one of the 15
  neighbouring bytes must be exactly `$00` or `$FF`, with the byte under test excluded from its
  own window. The rejection reasoning was about the *percentage*, and the percentage is gone. The
  entry should say the heuristic was rehabilitated by being made binary, not leave it reading as
  rejected.

Keep the entry's core claim — the discriminator is a property of the VALUE, not the address —
that part is still exactly right and is why the fix worked.

**2. The Session Continuity note** (currently around `.planning/STATE.md:137`) says of the
`$D588` mismatch: "that design gap remains open." Written before 01-01 landed. It should say the
gap was subsequently closed, and drop the implication that a `MISMATCH` verdict is the expected
current state — the gate now passes.

## Do not overcorrect

- **Do not claim full 64K byte-identity.** Criterion 1 was deliberately redefined (developer-approved)
  from 64K identity to *program-image* identity, because never-written RAM drifts continuously —
  proven with no game involved. That redefinition stands and is not what this todo revisits.
- **Do not delete the honest-limit language.** The three clauses each have an edge, and one is
  worth carrying: `sharesSingleBitDriftOrigin` can posit an **unobserved** origin. Measured at
  `$DA7B` (`00 00 0a` across three runs), the only shared origins are `$02` and `$08` — neither
  value any run actually held. It is independently backed by the block test there, but the
  permissiveness is real and grows as N shrinks.
- **Do not describe the zone table as an exclusion.** `$0400-$CB66 program image` /
  `$CB67-$FFFF upper RAM` are *reporting labels only*. The verdict carries no per-release address
  knowledge, which is precisely what keeps it from being vacuous. An entry implying the gate
  excludes `$CB67-$FFFF` would misrepresent the contract as weaker than it is.

## Verification

The claim being recorded is checkable offline, with no emulator: `classifyRunSet` over the three
retained dumps in `recovery/danish/dumps/` returns `ok: true`, 0 program mismatches, and 0
unstable bytes in `$0400-$CB66`. Quote the measured numbers rather than asserting the gate
passes.
