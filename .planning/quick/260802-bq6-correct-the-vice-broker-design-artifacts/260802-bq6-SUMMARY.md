---
phase: quick-260802-bq6
plan: 01
subsystem: tooling
tags: [vice-broker, documentation, provenance-correction, re-findings]

requires:
  - phase: quick-260801-vqd
    provides: "the VICE broker Node-rewrite design note (lifecycle-decisions.md) whose Decision 4 this task retracts"
  - phase: quick-260801-qpq
    provides: "the shutdown/reap-on-signal contract this task's host run validated live for the first time"
provides:
  - "vice-broker-lifecycle-decisions.md corrected: Decision 4 visibly retracted with both the withdrawn and corrected wave-width tables; Decision 5.4 elevated to the binding constraint on wave width; Decision 3 strengthened; a new host-validation-passed section; a new foreground-fragility subsection scoping a detached run mode into the rewrite"
  - "STATE.md's 260801-qpq row updated from 'host validation still outstanding' to 'PASSED 2026-08-02'"
  - "five new dated RE-FINDINGS.md entries (boot measurement, supersession, (0s) display defect, host-validation-passed, defect-4 reproduction), zero deletions"
  - "the grant-timeout todo downgraded to severity: minor with a corrected body"
  - "spike 005 elevated to the binding open question on wave width, still NOT RUN / driverless, with a new 'at least 4' data point"
  - "three new area:tooling todos: atomic-write temp-file leak, no detached run mode, (0s) boot-time log rounding"
affects: [vice-broker-rewrite, phase-01-recovery-provenance]

tech-stack:
  added: []
  patterns: ["measurement supersedes assumption via visible retraction, never silent deletion"]

key-files:
  created:
    - .planning/todos/pending/2026-08-02-broker-atomic-write-temp-files-leak-into-the-pool-dir.md
    - .planning/todos/pending/2026-08-02-vice-broker-has-no-detached-run-mode.md
    - .planning/todos/pending/2026-08-02-broker-boot-time-log-rounds-sub-second-to-zero.md
  modified:
    - .planning/notes/vice-broker-lifecycle-decisions.md
    - .planning/STATE.md
    - .planning/RE-FINDINGS.md
    - .planning/todos/pending/2026-08-01-raise-grant-poll-timeout-to-match-measured-tool-call-budget.md
    - .planning/spikes/005-concurrent-x64sc-ceiling/README.md

key-decisions:
  - "Decision 4 (the 25s grant timeout is the real cap on wave width) is retracted, not deleted — the withdrawn conclusion, its table, and the measurement that overturned it all stay visible in one place, because the withdrawn version is committed and may already be quoted elsewhere."
  - "VICE_BROKER_MAX (Decision 5.4) and spike 005 are now the binding constraint on wave width; the grant timeout never was, once boot measured sub-second instead of the assumed ~8s."
  - "The reap-everything-on-signal shutdown contract (260801-qpq) stays exactly as designed; the newly-filed defect is the foreground-only deployment shape, not the contract, and every artifact touching this says so explicitly to prevent a future session reversing a deliberate decision."

requirements-completed: [QUICK-260802-bq6]

coverage: []

duration: 55min
completed: 2026-08-02
status: complete
---

# Phase quick-260802-bq6 Plan 01: Correct the VICE broker design artifacts against live 2026-08-02 host measurements Summary

**Retracted Decision 4's ~8s-boot-based grant-timeout conclusion after a live host measurement found boot sub-second, promoted `VICE_BROKER_MAX`/spike 005 to the binding constraint on wave width, and recorded qpq's first-ever host validation pass — across the design note, STATE.md, five RE-FINDINGS entries, and three new todos.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-08-02T07:57:00Z
- **Completed:** 2026-08-02T08:52:00Z
- **Tasks:** 3
- **Files modified:** 5 modified, 3 created (8 total)

## Accomplishments

- Corrected `vice-broker-lifecycle-decisions.md`: a 2026-08-02 correction banner with the measured
  port table and poll-quantisation caveat; Decision 4 visibly RETRACTED with the withdrawn version,
  its original table, the corrected four-row table, and the corrected conclusion all in one place;
  Decision 4's priority lowered from "the thing to do first"; Decision 5.4 elevated to the binding
  open question with the new "at least 4" concurrent-instance data point; Decision 3 strengthened;
  a new host-validation-passed section recording qpq's first live confirmation; a new
  foreground-fragility subsection scoping a detached run mode into the rewrite while explicitly
  protecting the reap-on-signal contract from reversal; the "not yet measured" boot-time bullet
  closed out; Related section links the three new todos and RE-FINDINGS.md.
- Un-staled `STATE.md`'s `260801-qpq` row: replaced "host validation still outstanding" with
  "host validation PASSED 2026-08-02" plus its evidence clause, leaving the rest of the row intact.
- Appended five 2026-08-02 entries to `RE-FINDINGS.md`, append-only, all landing before the
  `## Corrections to earlier entries` heading: the boot measurement (confirmation, HIGH/MEDIUM
  split), the supersession of the 2026-08-01 grant-poll entry (correction), the `(0s)` display
  defect (hazard), the host-validation pass (confirmation), and defect 4's second reproduction
  (hazard, second sighting).
- Downgraded the grant-timeout todo from `severity: major` to `minor`, rewrote its title and body
  to state the measured boot time and the corrected ~36-agent implied cap, and removed both the
  "widens waves now" claim and the "worth doing first" priority framing.
- Elevated spike 005's README to name itself the binding open question on wave width, added the
  dated "at least 4" data point with its serialised/idle caveat, and corrected its third possible
  outcome so it no longer credits the grant timeout with the wave-width cap. Verdict stays
  `NOT RUN`; directory stays driverless (one file).
- Filed three new `area: tooling` todos dated 2026-08-02: the `.broker.*` atomic-write temp-file
  leak, the foreground-only broker with no detached run mode (with the reap contract explicitly
  protected from reversal in two places), and the `(0s)` boot-time log rounding defect.

## Task Commits

Each task was committed atomically:

1. **Task 1: Correct the design note's retracted conclusion, and un-stale the qpq STATE row** -
   `cc39812` (docs)
2. **Task 2: Append five 2026-08-02 entries to RE-FINDINGS.md, append-only** - `cb6255f` (docs)
3. **Task 3: Downgrade the timeout todo, elevate spike 005, file three new todos** - `1fb059a`
   (docs)

_Note: this is a documentation-only quick task — every commit is `docs`, no `feat`/`fix`/`test`
commits apply._

## Files Created/Modified

- `.planning/notes/vice-broker-lifecycle-decisions.md` - Correction banner, retracted Decision 4,
  elevated Decision 5.4, strengthened Decision 3, new host-validation and foreground-fragility
  sections, updated "not yet measured" list and Related links.
- `.planning/STATE.md` - `260801-qpq` row's stale validation clause replaced with the pass.
- `.planning/RE-FINDINGS.md` - Five 2026-08-02 entries appended before the corrections heading.
- `.planning/todos/pending/2026-08-01-raise-grant-poll-timeout-to-match-measured-tool-call-budget.md`
  - Downgraded to `minor`, corrected body, same filename preserved for existing cross-references.
- `.planning/spikes/005-concurrent-x64sc-ceiling/README.md` - Elevated to the binding open
  question; new dated data point; corrected outcome bullet.
- `.planning/todos/pending/2026-08-02-broker-atomic-write-temp-files-leak-into-the-pool-dir.md`
  (new) - The `.broker.XXXXXX` temp-file leak in `write_json_atomic()`.
- `.planning/todos/pending/2026-08-02-vice-broker-has-no-detached-run-mode.md` (new) - The
  foreground-only deployment shape, with the reap contract explicitly protected from reversal.
- `.planning/todos/pending/2026-08-02-broker-boot-time-log-rounds-sub-second-to-zero.md` (new) -
  The integer-division `(0s)` rendering defect that let the ~8s assumption go unchallenged.

## Decisions Made

- Retracted rather than deleted Decision 4's original conclusion, per the plan's explicit
  instruction: a committed, possibly-quoted claim needs its withdrawal visible in the same place
  as the claim, not a silent rewrite that erases the record of what was believed and why.
- Kept the grant-timeout todo at its original filename despite its content changing substantially,
  since the note, the spike and RE-FINDINGS all cite that filename directly.
- Treated the foreground-fragility item as a new, undated (5.5-avoiding) subsection under Decision
  5 rather than a fifth numbered defect, per the plan's instruction that the defect count of four
  maps to the existing defects todo and must not drift.

## Deviations from Plan

None - plan executed exactly as written. All gates specified in each task's `<verify>` block were
run and passed before committing; no auto-fixes, no architectural questions, no scope changes.

## Issues Encountered

The sandboxed Bash tool refused several multi-clause verification commands (chained `for` loops,
piped `git diff | grep | grep` combinations) as "too complex to verify it stays inside the
worktree." Every such gate was broken into discrete single-purpose commands (one `grep -qF` check
per substring, diffs saved to the scratchpad directory before filtering) with identical net
verification coverage — no gate was skipped or weakened as a result, just executed in smaller
steps. One genuine authoring mistake was caught by a gate on the first pass: two required-string
checks (`not confirmed by the user`, `MCP-Tools: Handling tools/ca`) initially failed because the
literal string was split across a Markdown line wrap in the source; both were fixed by joining the
wrapped text onto a single physical line, then the gates re-run and confirmed green.

## User Setup Required

None - no external service configuration required. This is a documentation-only change; no code,
no config, and nothing under `.claude/` or `.vice-supervisor/` was read or touched.

## Next Phase Readiness

The VICE broker Node-rewrite design (`vice-broker-lifecycle-decisions.md`) now reflects measured
reality rather than an 8x-wrong assumption, and its own `/gsd-discuss-phase` pass (noted in the
document's Scope section) can proceed against the corrected Decision 4, the elevated Decision 5.4,
and the newly-scoped foreground-fragility item without re-deriving any of this. Spike 005 remains
the single open experiment a human still needs to run on the host before `VICE_BROKER_MAX` can be
set from measurement rather than from an unverified default. No blockers introduced by this task.

---
*Phase: quick-260802-bq6*
*Completed: 2026-08-02*
