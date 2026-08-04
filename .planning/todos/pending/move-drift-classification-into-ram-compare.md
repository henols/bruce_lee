---
title: Decide whether the N-run drift classification belongs in ram-compare.mjs or stays project-gate logic
date: 2026-07-31
priority: medium
---

> **STALE 2026-08-01.** Its target no longer exists: `ram-compare.mjs` was deleted with the rest
> of `c64-ram-capture/scripts/` in `db9eed3`, because those scripts reached the emulator outside
> the `mcp__vice__*` tools. The drift knowledge it carried — volatile ranges, single-bit drift vs
> multi-bit divergence — now lives as instructions in `c64-ram-capture/SKILL.md`. Rewrite this
> todo against that, or close it.

# Resolve where the run-set drift classification lives

**This todo is a decision, not a move.** Do not start by relocating code — plan 01-01 made a
deliberate, documented choice to keep this logic in `tools/recover.mjs`, and that choice has a
real argument behind it. Either confirm it and write down why, or reverse it. What is not
acceptable is leaving the tension undocumented, because the two skills' layering was the whole
point of [[reusable-capture-harness-seam]] and the two quick tasks that acted on it.

See [[drift-discriminator-resolved]] for what this code actually does.

## The tension

Four symbols in `tools/recover.mjs` are pure functions over byte images:

| Symbol | Location (at time of writing) |
|---|---|
| `REPORT_ZONES` | `tools/recover.mjs:283` |
| `inPowerOnPatternBlock(images, addr)` | `tools/recover.mjs:319` |
| `sharesSingleBitDriftOrigin(values)` | `tools/recover.mjs:341` |
| `classifyRunSet(images)` | `tools/recover.mjs:349` |

Plus `tools/recover.test.mjs` (120 lines), which covers exactly that surface.

**The case for moving them to `.claude/skills/c64-ram-capture/scripts/ram-compare.mjs`:** they
meet the layer-B criterion the original seam analysis set out — no concept of a release, no
`recovery/` layout, no registry, no emulator. `classifyRunSet` takes an array of buffers and
returns a verdict. `ram-compare.mjs` is deliberately import-free precisely so this class of logic
can be tested exhaustively in-process, and these four symbols have the same property. Leaving
them in layer C means the reproducibility rule is split across two files in two layers, and
`recover.mjs` grew back from 422 lines with logic that has nothing to do with releases.

**The case for leaving them (01-01's position),** stated in `tools/recover.test.mjs`'s own header:

> The byte-assembly and pairwise-comparison contracts are tested in the c64-ram-capture skill.
> What lives here is the part that is specific to this project's gate: a byte is only called
> stable when it agrees across N >= 3 captures, and a pairwise multi-bit finding is
> re-adjudicated against the whole run set before it is called a real divergence.

That is a coherent line: the skill offers a *capability* (compare two captures), and this project
layers its own *policy* on top (N≥3, these three clauses, this is what we accept as drift). Policy
belongs to the project. Under that reading nothing is misplaced.

## What resolving it actually requires

Pick which of these two is true, and note that the skill's own advertised scope is evidence:

- `c64-ram-capture`'s `SKILL.md` description currently promises "prove **two** captures are
  equivalent under RAM drift." If the real, load-bearing rule is N≥3 — and 01-01 measured that
  **93 bytes were identical in runs 1+2 yet differed in run 3**, so two runs are demonstrably
  insufficient to call a byte stable — then the skill is advertising the weaker half of its own
  capability while the trustworthy half sits outside it. That argues for moving the code *and*
  updating the description.
- If instead the N and the clause set are genuinely project policy that another consumer of this
  skill would legitimately choose differently, leave the code and instead make
  `classifyRunSet`'s docstring say so explicitly — that it is deliberately layer C, and why.

A middle option worth weighing: move `inPowerOnPatternBlock` and `sharesSingleBitDriftOrigin`
(pure value/pattern predicates, no policy in them — they answer "could this be drift?") into
`ram-compare.mjs` and export them, while `classifyRunSet` stays in `recover.mjs` as the policy
that composes them and picks N. That splits along the actual capability/policy line rather than
along file convenience.

## Constraints if the move happens

- `ram-compare.mjs` must stay **import-free**. Its header states that having no imports at all is
  what lets the reproducibility rule be tested exhaustively in-process rather than only against
  live hardware. Nothing moved in may introduce an import.
- **Do not duplicate.** `classifyRuns` already lives in `ram-compare.mjs` and `recover.mjs`
  imports it; whatever moves must move, not get copied.
- **Do not merge the two test files blindly.** They are split along a stated boundary. If the code
  moves, the tests move with the code it covers, and the header rationale in each file must be
  updated to match the new boundary rather than left describing the old one.
- **No `INTERNALS.md`, and no module names in either `SKILL.md`** beyond the documented entry
  points. The module-leak gates (`skill-docs.test.mjs` in both skills) enforce this — if a new
  module appears under `scripts/`, the gate covers it automatically.
- **No behaviour change.** The gate must still return `ok: true` with 0 program mismatches over
  the three retained dumps in `recovery/danish/dumps/`, and both test suites must still pass at
  their current counts.
- If `SKILL.md`'s description changes, keep it scoped so it does not fire on every prompt in this
  repo — it must not match "annotate this listing" (`c64-memory-mapping`) or "assemble this
  source" (`acme-build`).

## RETARGETED 2026-08-04 (quick task 260804-dbf) — NOT closed, because a real gap surfaced

This todo was queued for closure as "STALE, target deleted". **It must not be closed.** The tension
it described did dissolve, but it dissolved by *both* sides being deleted, and one of them took a
load-bearing rule with it that now exists in no code at all.

### Both sides of the original tension are gone

| Original location | Fate |
|---|---|
| `.claude/skills/c64-ram-capture/scripts/ram-compare.mjs` (the proposed destination) | deleted in `db9eed3` with the rest of that `scripts/` dir — those scripts reached the emulator outside `mcp__vice__*` |
| `tools/recover.mjs` (where the four symbols lived, and 01-01's documented choice) | deleted in `d963c5b`, *"delete the legacy VICE driver tooling from tools/"* |

So `REPORT_ZONES`, `inPowerOnPatternBlock`, `sharesSingleBitDriftOrigin` and `classifyRunSet` — plus
`tools/recover.test.mjs`'s 120 lines covering exactly that surface — are all gone. A grep for any of
those four symbols across the repo now returns **only prose**: `recovery/*/NOTES.md`, two planning
notes, and todos. No code.

### What replaced part of it, on 2026-08-04

Commits `0db0127` and `e1b55c1` added `.claude/skills/c64-ram-capture/scripts/compare.mjs` — pure
logic over committed captures, no emulator contact, so it does not repeat the violation that deleted
its predecessor. It provides `compare` (pairwise), `floor` (union of differing addresses across N
captures) and `digest`. That change also **corrected** the classification: `$D000-$DFFF` is now
volatile because it is I/O rather than RAM, and `$FAD8`/`$FC51` are documented as known-unexplained
RAM-under-KERNAL-ROM rather than treated as failures.

### The actual open item now

**The N≥3 stability gate is missing.** `compare.mjs` answers "how do these two differ?" and "what is
the union across a set?" — it does **not** implement the rule `classifyRunSet` carried: *a byte is
only called stable when it agrees across N ≥ 3 captures, and a pairwise multi-bit finding is
re-adjudicated against the whole run set before it is called a real divergence.*

That rule is not a preference. This todo already records the measurement that forces it: **93 bytes
were identical in runs 1+2 yet differed in run 3.** Two captures are demonstrably insufficient to
call a byte stable, and `floor` reporting a union is not the same as a verdict that re-adjudicates
multi-bit findings against the set.

So the question this todo posed — capability or policy — is still live, but with the options changed:

1. Port the N≥3 adjudication into `compare.mjs` as a fourth verb (e.g. `stable <a> <b> <c> …`),
   making the skill's advertised scope true.
2. Re-establish it as project-gate policy somewhere in `tools/`, and say explicitly in
   `compare.mjs` that it deliberately stops at pairwise-plus-floor and why.

Option 1 is now better supported than when this todo was written: the skill's own `SKILL.md`
description still promises *"prove **two** captures are equivalent"*, which this todo already flagged
as advertising the weaker half of the capability. The half that is trustworthy under the project's
own measurement is the N≥3 half, and it currently exists nowhere.

### Constraints carried forward

- Whatever holds it must not contact the emulator. `compare.mjs` is currently import-free apart from
  `node:` built-ins; keep that property, which is what lets the rule be tested exhaustively
  in-process.
- Do not re-derive the rule from scratch. See [[drift-discriminator-resolved]] and
  `.planning/notes/reusable-capture-harness-seam.md`; a prior quick task,
  `260731-84f-resolve-where-the-n-run-drift-classifica`, already attempted this decision — read it
  before re-deciding.
- Related and still open: `correct-stale-drift-gap-notes`.

**Evidence:** `git log --diff-filter=D` for both deleted files; a repo-wide symbol grep returning
prose only; `compare.mjs` read directly and run against
`recovery/danish/dumps/danish-gameentry-run{1,2,3}.bin`.
**Confidence:** HIGH that the code is absent. The choice between options 1 and 2 is undecided and
deliberately left so — this todo is a decision, not a move, and that has not changed.
