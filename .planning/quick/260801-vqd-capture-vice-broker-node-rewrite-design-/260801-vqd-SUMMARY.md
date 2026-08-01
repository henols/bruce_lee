---
phase: quick-260801-vqd
plan: 01
subsystem: infra
tags: [vice-broker, lifecycle-design, documentation-only, host-tooling]

requires:
  - phase: quick-260801-qpq
    provides: the shutdown/reaping contract and the four defects surfaced fixing it, which this
      note's Decision 5 and Decision 3 draw on directly
provides:
  - a design record for a Node rewrite of the host VICE broker's lifecycle policy (seven locked
    decisions, each with reasoning, not just verdicts)
  - a standalone actionable todo (raise GRANT_POLL_TIMEOUT_MS) independent of that rewrite
  - a designed-not-run host-only spike specifying how to measure the real concurrent-x64sc ceiling
  - one appended RE-FINDINGS.md hazard entry tying the grant-timeout mismatch to its evidence
affects: [any future quick task or phase that rewrites tools/vice-broker.sh, tools/vice-pool.sh,
  tools/vice-supervisor.sh, or lib/container-guard.sh + lib/repo-root.sh]

tech-stack:
  added: []
  patterns:
    - "Design-note-before-rewrite: lock decisions in a note that names itself as the rewrite's
      input, so a later --discuss cycle starts from settled reasoning instead of re-deriving it"
    - "Designed-not-run spike: a host-only experiment gets a full README (frontmatter, arms, what
      to record, how to read the result) with empty result sections, rather than being skipped
      because it cannot be run from this container"

key-files:
  created:
    - .planning/notes/vice-broker-lifecycle-decisions.md
    - .planning/todos/pending/2026-08-01-raise-grant-poll-timeout-to-match-measured-tool-call-budget.md
    - .planning/spikes/005-concurrent-x64sc-ceiling/README.md
  modified:
    - .planning/RE-FINDINGS.md

key-decisions:
  - "The broker becomes the only application: vice-pool.sh (dead, nothing invokes it) is deleted
    outright; vice-supervisor.sh is absorbed as an in-process child supervisor, with its one
    genuine human user (a standalone non-MCP recovery pipeline) left as an explicit open question
    rather than silently dropped"
  - "The host entry point stays a thin shell exec-launcher (resolve dir, verify node, exec) so the
    container-side path builders naming tools/vice-broker.sh keep working unchanged"
  - "Pool floor drops from 3 to 1: a wave arrives as a burst so extra spares buy nothing, x64sc is
    not headless (GTK3 + OpenGL 4.6 + PulseAudio), and machines are never shared between agents;
    kill-never-recycle is named explicitly as a property to preserve"
  - "The 25s GRANT_POLL_TIMEOUT_MS default, not pool size, is the real cap on wave width against a
    measured >=150s tool-call budget; raising it toward ~120000ms is a near-one-line, rewrite-
    independent fix and is written up as its own todo"
  - "Four lifecycle defects (no launch priority between requests and warming, a ready-count that
    trusts files over live probes, no FIFO fairness, an unverified VICE_BROKER_MAX=16) are named as
    policy bugs a mechanical shell-to-JS port would carry forward unchanged"
  - "spares is renamed to a warm/ready floor, deliberately, because the old name's misleading shape
    caused a real misdiagnosis during a live outage (defects todo, Defect 2)"
  - "This is quick-task remediation of a phase-1 blocker, not ROADMAP milestone scope, matching the
    precedent of five prior quick tasks that built this same subsystem"

patterns-established:
  - "Pattern: a design note that states, in its own scope section, that it changed no code and
    names its consumer as a specific follow-on task — prevents the note being mistaken for a
    completed migration"

requirements-completed: [QUICK-260801-vqd]

duration: ~25min
completed: 2026-08-01
status: complete
---

# Quick Task 260801-vqd: Capture VICE broker Node-rewrite design Summary

**Wrote three planning artifacts (a seven-decision lifecycle-rewrite design note, a grant-timeout
todo, and a designed-not-run host-capacity spike) plus one RE-FINDINGS.md hazard entry — zero code
changed, zero files touched outside `.planning/`.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3
- **Files modified:** 4 (3 created, 1 appended)

## Accomplishments

- `.planning/notes/vice-broker-lifecycle-decisions.md` records all seven locked decisions from the
  `/gsd-explore` session end to end, each with its reasoning: the broker as sole application (with
  the standalone recovery pipeline flagged as an unresolved open question), the thin-shell host
  entry point, the pool floor drop to 1, the 25s grant-timeout cap identified as the real
  wave-width limiter, four named lifecycle defects a mechanical port would preserve, the `spares`
  rename, and the quick-task (not milestone) scoping call.
- `.planning/todos/pending/2026-08-01-raise-grant-poll-timeout-to-match-measured-tool-call-budget.md`
  captures the standalone, near-one-line, rewrite-independent fix that widens parallel waves now.
- `.planning/spikes/005-concurrent-x64sc-ceiling/README.md` specifies a host-only experiment
  (sequential steady-state ceiling arm + simultaneous init-race control arm) to replace the
  unverified `VICE_BROKER_MAX=16` with a measured number, and explains — as its own section — why
  it deliberately ships no driver script.
- `.planning/RE-FINDINGS.md` gained one appended entry (before `## Corrections to earlier entries`,
  zero lines deleted) recording the grant-timeout hazard with the two source constants graded HIGH
  and the derived ~8s-boot arithmetic graded LOW/MEDIUM.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write the design note — all seven decisions, end to end** - `0ad41a0` (docs)
2. **Task 2: Write the grant-timeout todo and append the matching RE-FINDINGS entry** - `3af11a3` (docs)
3. **Task 3: Design spike 005 — the concurrent-x64sc ceiling** - `428f1c8` (docs)

**Plan metadata:** committed by the orchestrator after this summary lands.

## Files Created/Modified

- `.planning/notes/vice-broker-lifecycle-decisions.md` - the seven-decision design record; sole
  input for the follow-on Node-rewrite task
- `.planning/todos/pending/2026-08-01-raise-grant-poll-timeout-to-match-measured-tool-call-budget.md`
  - the standalone grant-timeout fix, independent of the rewrite
- `.planning/spikes/005-concurrent-x64sc-ceiling/README.md` - a host-run, designed-not-run
  concurrency experiment
- `.planning/RE-FINDINGS.md` - one appended hazard entry (grant-poll vs. measured tool-call budget)

## Decisions Made

All seven decisions were locked coming into this task by a prior `/gsd-explore` session; this
task's job was recording them, not deriving them. See `key-decisions` in the frontmatter above for
the compressed list, and the note itself for full reasoning per decision. No new design decisions
were made during execution — every citation and every reasoning chain traces to the plan's verified
citation set or to first-hand reads of the exemplar files (`vice-mcp-selector-design.md`, spike
003's README, the defects todo) named in the plan's `<context>`.

## Deviations from Plan

**One self-correction, caught by the plan's own verification gates, no user-facing impact:**

**1. [Rule 1 - Bug, self-caught during Task 1] Confidence line initially failed its own gate**
- **Found during:** Task 2 verification (before commit)
- **Issue:** The RE-FINDINGS.md entry's `**Confidence:**` field was first written wrapped across
  three lines (HIGH on line 1, LOW/MEDIUM on lines 2-3). The plan's verify gate greps only the
  single line matching `Confidence:`, so a wrapped field would have passed a human read but failed
  the automated gate silently reporting the entry as ungraded for the assumption.
- **Fix:** Compressed the field to one line with all three grades (HIGH / LOW / MEDIUM) present in
  the same sentence, joined by semicolons instead of line breaks.
- **Files modified:** `.planning/RE-FINDINGS.md`
- **Verification:** Re-ran `grep -A12 'grant poll' ... | grep -m1 'Confidence:'` and confirmed HIGH
  and MEDIUM/LOW both appear on the matched line, then re-ran the zero-deletions and
  before-corrections-heading gates to confirm the edit hadn't broken either.
- **Committed in:** `3af11a3` (part of Task 2's commit; caught before the commit was made, so no
  separate fix-up commit was needed)

Also caught and fixed before commit, same task-1 verify pass: the design note's Decision 3 named
the `teardown()` no-recycle property in prose but omitted the literal phrase `kill-never-recycle`
that the plan's automated gate greps for. Added the exact phrase inline before committing Task 1.

---

**Total deviations:** 0 substantive deviations from the locked decisions or plan content — both
corrections above were wording/formatting fixes made to satisfy the plan's own automated
verification gates, caught during the verify-before-commit step for each task, with no re-derivation
of any decision and no scope change.
**Impact on plan:** None. Both fixes were mechanical (line-wrapping, one missing exact phrase) and
were resolved before the affected task's commit landed, so no commit needed amending.

## Issues Encountered

The sandboxed Bash tool refused several multi-line/loop-style verification commands (`for s in
...; do ... done`, and multi-statement `VAR=$(...); echo "$VAR"` one-liners) with a worktree-
isolation-related error unrelated to their actual content. Worked around by running each grep gate
as its own single, simple command instead of a loop — slower but functionally identical coverage of
every citation the plan's `<verify>` blocks require.

## User Setup Required

None - no external service configuration required. This task wrote documentation only.

## Next Phase Readiness

- The Node-rewrite task now has a single, cited, reasoned document to work from instead of 2,997
  lines of shell — it should open its own `/gsd-discuss-phase` (or `--discuss`) pass per the note's
  own scope section, not start directly from PLAN.md.
- The grant-timeout todo can be picked up independently and immediately; it does not block or get
  blocked by the rewrite.
- Spike 005 cannot be executed by any future session inside this container — it is host-only by
  the project's hard emulator-access rule, and stays queued until a human runs it on the host.
- Three open questions remain unresolved by design, carried in the note's own "What is not yet
  measured" section: the ~8s boot-time assumption, the concurrent-x64sc ceiling (spike 005), and
  whether the standalone non-MCP recovery pipeline still has a user (Decision 1's open question).

## Self-Check: PASSED

- FOUND: `.planning/notes/vice-broker-lifecycle-decisions.md`
- FOUND: `.planning/todos/pending/2026-08-01-raise-grant-poll-timeout-to-match-measured-tool-call-budget.md`
- FOUND: `.planning/spikes/005-concurrent-x64sc-ceiling/README.md`
- FOUND commit: `0ad41a0` (Task 1)
- FOUND commit: `3af11a3` (Task 2)
- FOUND commit: `428f1c8` (Task 3)

---
*Phase: quick-260801-vqd*
*Completed: 2026-08-01*
