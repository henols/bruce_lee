---
phase: quick-260806-q2g
plan: 01
subsystem: docs
tags: [skill-writer, c64-program-recon, reconstruction, correctness-definition]

requires: []
provides:
  - reconstruction.md states behavioural equivalence (scripted replay + checkpoint comparison) as
    the sole definition of correctness, with no competing byte-identity bar
affects: [c64-program-recon]

tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - .claude/skills/c64-program-recon/references/reconstruction.md
    - .claude/skills/c64-program-recon/SKILL.md

key-decisions:
  - "Kept the observation-hazards.md § 7 pointer, reduced to one background sentence ('A full 64K RAM capture is not a comparison surface: never-written RAM drifts continuously, so full-64K identity is impossible in principle'). Rationale below."

patterns-established: []

requirements-completed: [SKILL-RECON-BEHAVIOURAL-ONLY]

coverage:
  - id: D1
    description: "reconstruction.md offers exactly one definition of correctness (behavioural equivalence, cited to CLAUDE.md § Constraints); no byte-comparison recipe, no blockquote claim, no staged-achievement framing anywhere in the file"
    requirement: "SKILL-RECON-BEHAVIOURAL-ONLY"
    verification:
      - kind: other
        ref: "task 1's 11-gate automated <verify> block (grep/md5 counts against measured before/after baselines)"
        status: pass
    human_judgment: false
  - id: D2
    description: "SKILL.md's references table row for reconstruction.md describes the rewritten section's actual coverage; six-row table shape, path cell, and other three Covers items unchanged; exactly two files under .claude/ differ from BASE"
    requirement: "SKILL-RECON-BEHAVIOURAL-ONLY"
    verification:
      - kind: other
        ref: "task 2's 8-gate automated <verify> block, including git diff --name-only BASE..HEAD -- .claude/ scoped to 2 files"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-08-06
status: complete
---

# Quick Task 260806-q2g: Remove byte-identity as a correctness milestone Summary

**Rewrote `c64-program-recon`'s reconstruction reference so behavioural equivalence (scripted replay + checkpoint comparison) is the only stated definition of correctness — no byte-comparison recipe, no staged "first milestone" framing survives.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-08-06 (session start)
- **Completed:** 2026-08-06
- **Tasks:** 2 completed
- **Files modified:** 2

## BASE sha

`a660cfc260411da4b3440da521f26a5275c3126b` — recorded before Task 1's edit, per the plan's precondition check (`git status --porcelain -- .claude/skills/` confirmed clean at that point). Task 2's "exactly two files changed" gate diffs against this sha and passed.

## Accomplishments
- Rewrote `reconstruction.md`'s "Byte-identity is the first milestone" section into "Behavioural equivalence is this project's definition of correctness" — removed the blockquote claim, the `cmp`/`sha256sum` fenced recipe, the "much stronger signal" and "stronger, earlier check" framing, and the "After identity holds..." precondition.
- Kept the SMC/timing-sensitive-raster reorganisation hazard, re-anchored: re-verification now means replaying through the checkpoint set after EACH reorganisation, not a byte comparison.
- Kept the `.claude/CLAUDE.md` § Constraints citation and the "anything not observable at a checkpoint is not verified" consequence, verbatim in substance.
- Retargeted the file's line-8 lead-in so it agrees with what the rewritten section now covers.
- Retargeted `SKILL.md`'s References-table row for `reconstruction.md` from "byte-identity scope" to "behavioural-equivalence correctness bar", leaving its path cell, its other three Covers items, and the six-row table shape untouched.

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite reconstruction.md's correctness section so behavioural equivalence is the only bar** - `9c63239` (docs)
2. **Task 2: Retarget SKILL.md's reconstruction.md reference row, then gate the whole change** - `1d2cfb0` (docs)

**Plan metadata:** committed separately by the orchestrator (this executor does not commit docs artifacts per its constraints).

## Files Created/Modified
- `.claude/skills/c64-program-recon/references/reconstruction.md` - Correctness section rewritten; no byte-comparison recipe or staged-milestone framing remains.
- `.claude/skills/c64-program-recon/SKILL.md` - References row for `reconstruction.md` retargeted to describe the new coverage.

## Before/After Token Counts (measured, not assumed)

| Token in `reconstruction.md` | Before | After (target) | After (actual) |
|---|---|---|---|
| `milestone` (case-insensitive) | 2 | 0 | 0 |
| `sha256sum`, `\bcmp\b` | 1, 1 | 0 | 0 |
| fenced-block delimiters `^```` | 16 | 14 | 14 |
| blockquote lines `^>` | 1 | 0 | 0 |
| `identity` (case-insensitive) | 5 | <= 1 | 1 |
| `reorganis` | 3 | >= 2 | 3 |
| `timing-sensitive raster` | 1 | >= 1 | present |
| `CLAUDE.md` | 1 | >= 1 | present |

All 11 of Task 1's gates and all 8 of Task 2's gates PASS. `observation-hazards.md` hashes to `1f006c10ba40a337a3b0731fca8ae977` — byte-for-byte unchanged, confirmed both before and after.

## Delegated judgement call: the § 7 pointer

The plan left one decision to the executor: whether to keep or drop the `observation-hazards.md` § 7 pointer in the rewritten section, and it required recording the reasoning either way.

**Decision: kept**, reduced to a single closing sentence with no heading of its own:

> A full 64K RAM capture is not a comparison surface: never-written RAM drifts continuously, so full-64K identity is impossible in principle (`observation-hazards.md` § 7).

**Reasoning:**
- The plan's constraint was that the pointer must land in at most one sentence, as background only, without implying a comparison was hoped for and without reading as a caveat on a claim that no longer exists. The original draft used "not a comparison surface **either**", which implicitly referenced the just-removed byte-comparison claim as its antecedent — exactly the caveat-on-a-deleted-claim failure mode the plan warned against. That word was removed so the sentence now stands alone as a plain fact about RAM capture, not a qualifier on anything upstream.
- § 7 is a *negative* claim (RAM comparison is impossible in principle) that positively reinforces behavioural-only correctness rather than competing with it — the same reason the plan's `<planning_notes>` gave for treating it as safe to keep.
- Reachability of `observation-hazards.md` does not depend on this pointer either way: `SKILL.md` line 152's References row and line 172's Troubleshooting row (`Two captures of the same checkpoint differ | Expected. Full-64K identity is impossible in principle...`) already route a reader there. Keeping the sentence in `reconstruction.md` is a convenience for someone already reading that file, not a load-bearing link.
- The `identity` gate (`<= 1` occurrence) was written by the planner specifically to accommodate this optional pointer; keeping it exercises that headroom rather than leaving it unused, and the final count came in at exactly 1.

## Decisions Made
- Kept the § 7 pointer (see above) rather than dropping it, after tightening its wording to remove the word "either", which was the one part of the first draft that read as a caveat on the removed claim.
- No other judgement calls arose — the two edits were otherwise a direct, literal application of the plan's Edit A / Edit B instructions.

## Deviations from Plan

None - plan executed exactly as written. The only in-flight adjustment was the self-caught wording fix on the § 7 sentence (removing "either") before running the verify gates, which is part of the plan's own explicit judgement call rather than a deviation from it.

## Issues Encountered

One initial draft of the § 7 sentence used "not a comparison surface **either**", which on review read as an implicit reference to the removed byte-comparison claim (a caveat-on-a-deleted-claim shape the plan explicitly prohibited). Caught and corrected before running any verify gate — no gate ever ran against the flawed wording.

## Full rewritten section (for review without reconstructing the diff)

```markdown
## Behavioural equivalence is this project's definition of correctness

**Correctness here means scripted replay plus comparison at checkpoints — nothing else**
(`.claude/CLAUDE.md` § Constraints). A reconstruction is right when driving it through the
checkpoint set produces the same observable behaviour as the original. **Anything not observable
at a checkpoint is not verified** — the constraint's own conclusion, and the reason checkpoint
design is part of the reconstruction work rather than something to bolt on afterwards.

**That bar is what buys you the freedom to rename routines, reorganise files, replace constants
with symbols and add macros** (`.planning/REQUIREMENTS.md` § Out of Scope makes the same
argument). **But** reorganising changes addresses, which breaks self-modifying code and
timing-sensitive raster routines. Replay through the checkpoint set after EACH reorganisation, not
at the end of several: one changed address per failing replay is a short diagnosis, ten is a
bisect.

A full 64K RAM capture is not a comparison surface: never-written RAM drifts continuously, so
full-64K identity is impossible in principle (`observation-hazards.md` § 7).
```

The line-8 lead-in was also retargeted, from "the shape of the source and the verification
milestone" to "the shape of the source and what makes a reconstruction correct."

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

`c64-program-recon`'s reconstruction guidance is now internally consistent with `.claude/CLAUDE.md`
§ Constraints and `.planning/REQUIREMENTS.md` § Out of Scope. No follow-up work identified; this
was a self-contained two-file documentation correction.

## Self-Check: PASSED

- FOUND: `.claude/skills/c64-program-recon/references/reconstruction.md`
- FOUND: `.claude/skills/c64-program-recon/SKILL.md`
- FOUND: `.planning/quick/260806-q2g-remove-byte-identity-as-a-correctness-mi/260806-q2g-SUMMARY.md`
- FOUND commit `9c63239` in `git log --oneline`
- FOUND commit `1d2cfb0` in `git log --oneline`

---
*Phase: quick-260806-q2g*
*Completed: 2026-08-06*
