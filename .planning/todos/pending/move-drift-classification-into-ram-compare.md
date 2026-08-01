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
