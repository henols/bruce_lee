---
phase: quick-260730-u9w
plan: 01
subsystem: infra
tags: [vice, mcp, refactor, node-test, checkpoint-sync]

requires:
  - phase: quick-260730-ryz
    provides: vice-session/SKILL.md as a usage-only guide (INTERNALS.md deliberately deleted at 61fa835)
provides:
  - .claude/skills/vice-session/scripts/vice-sync.mjs — the checkpoint-synchronisation primitives, reusable outside tools/recover.mjs
  - a durable, self-extending node:test gate keeping module names out of SKILL.md
affects: [phase3-verification-harness, c64-ram-capture-skill]

tech-stack:
  added: []
  patterns:
    - "vice.mjs (resilient transport) / vice-probe.mjs (fragile liveness probe) / vice-sync.mjs (checkpoint synchronisation) are three structurally isolated modules by deliberate design; each documents in its own header why it must not be merged with the others."
    - "A singleton tracker object (track/untrack/ids/clear) over a bare Set, so two independent call sites (runToCheckpoint() and a hand-rolled arm/wait/delete) can write through one door."
    - "Directory-enumerating node:test gate instead of a hardcoded name list, so a future file is covered automatically rather than needing a test-file update."

key-files:
  created:
    - .claude/skills/vice-session/scripts/vice-sync.mjs
    - .claude/skills/vice-session/scripts/skill-docs.test.mjs
  modified:
    - tools/recover.mjs
    - .claude/skills/vice-session/SKILL.md

key-decisions:
  - "Checkpoint-synchronisation primitives (reset, readCheckpoint, waitCheckpointHit, runToCheckpoint, screenshot, addrNum, hex4, POLL_WINDOWS_MS, PING_INTERVAL_MS, armedCheckpoints) moved verbatim into a new sibling module vice-sync.mjs rather than into vice.mjs or a new skill — third structurally-isolated concern, same precedent vice-probe.mjs already set."
  - "armedCheckpoints became a singleton tracker object (track/untrack/ids/clear) instead of exporting a bare Set, so recover.mjs's capture() (which hand-rolls its own arm/wait/delete) and the new module's runToCheckpoint() write through one shared door; ids() returns a plain array for assertSameMachine's injected parameter."
  - "The module-leak gate replaces a one-shot grep from a prior plan with a directory-enumerating node:test, kept strictly one-directional — no companion maintainer document exists to check names against, since INTERNALS.md was deleted by developer decision and must not return in any form."
  - "SKILL.md's copy-this-skill paragraph corrected to instruct copying the sibling devcontainer-host-path skill alongside vice-session, without naming any module, function, or import path — the guide's usage-only voice is preserved."

patterns-established:
  - "Rationale for an internal module lives only in that module's own header comment, never in a separate maintainer document, in skills that ship a usage-only SKILL.md."

requirements-completed: [QUICK-260730-u9w]

coverage:
  - id: D1
    description: "vice-sync.mjs exports the ten synchronisation symbols (reset, readCheckpoint, waitCheckpointHit, runToCheckpoint, screenshot, addrNum, hex4, POLL_WINDOWS_MS, PING_INTERVAL_MS, armedCheckpoints) and recover.mjs imports rather than redefines them"
    requirement: "QUICK-260730-u9w"
    verification:
      - kind: unit
        ref: "module smoke check (inline node --input-type=module script) — MODULE-SMOKE-OK"
        status: pass
      - kind: other
        ref: "grep-based export/no-duplication/resume-count gates from PLAN.md's <verify> block"
        status: pass
    human_judgment: false
  - id: D2
    description: "node --test tools/recover.test.mjs still reports 27 passing, 0 failing — no behaviour change from the move"
    requirement: "QUICK-260730-u9w"
    verification:
      - kind: unit
        ref: "tools/recover.test.mjs (27 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "durable skill-docs.test.mjs gate enumerates scripts/ and fails if any module but vice.mjs is named in SKILL.md; RED/GREEN proved once by a reverted experiment"
    requirement: "QUICK-260730-u9w"
    verification:
      - kind: unit
        ref: "skill-docs.test.mjs (3 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "SKILL.md's copy-this-skill paragraph no longer claims self-sufficiency; instructs copying the sibling devcontainer-host-path skill, naming no module or import path"
    verification: []
    human_judgment: true
    rationale: "Prose-quality judgment (does the paragraph read like the rest of the usage guide, and does the new module header read as a complete rationale record) — the plan's own <human-check> calls for a human read, not an automatable check."

duration: 10min
completed: 2026-07-30
status: complete
---

# Quick Task 260730-u9w: Extract checkpoint-sync primitives into vice-session Summary

**Moved the ten checkpoint-synchronisation primitives (reset/readCheckpoint/waitCheckpointHit/runToCheckpoint/screenshot/addrNum/hex4/poll schedule/armedCheckpoints tracker) out of `tools/recover.mjs` into a new sibling module `vice-session/scripts/vice-sync.mjs`, and replaced a one-shot plan-embedded grep with a durable, directory-enumerating `node:test` gate that keeps module names out of `SKILL.md`.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-30T22:09:00Z
- **Completed:** 2026-07-30T22:20:01Z
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `.claude/skills/vice-session/scripts/vice-sync.mjs` created as the project's third structurally-isolated vice-session module (alongside `vice.mjs`'s resilient transport seam and `vice-probe.mjs`'s fragile liveness probe), carrying its own complete rationale — why it's a third module, the three measurements that shaped it, the three invariants a maintainer must not break, and where `tryHostPaths` comes from.
- `tools/recover.mjs` shrank by ~180 lines: it now imports the ten synchronisation symbols instead of defining them, while keeping its full Bruce-Lee-specific exported surface (`boot`, `capture`, `recover`, `reproduce`, `findEntry`, `voidRun`, `classifyRuns`, `assembleChunks`, `captureImage`, `captureBaseline`, `captureDecayReference`, `snapshotName`, `VOLATILE_RANGES`, plus a re-exported `reset`).
- The `vice_execution_run` resume count split exactly as measured: 2 call sites now in `vice-sync.mjs` (the single resume plus the not-our-checkpoint resume), 3 remaining in `recover.mjs` (two in `boot()`, one in `captureDecayReference()`) — 5 total, unchanged.
- `armedCheckpoints` is now one singleton tracker (`track`/`untrack`/`ids`/`clear`) written by both `runToCheckpoint()` in the new module and `capture()`'s hand-rolled arm/wait/delete in `recover.mjs`, and read as an array by `assertSameMachine`'s injected parameter.
- `skill-docs.test.mjs` added: enumerates every `.mjs` in `scripts/` from its own file location, asserts the list is non-empty and includes `vice-sync.mjs`, and fails if any module but the documented entry point `vice.mjs` is named in `SKILL.md`. Proved its failure direction once via a temporary edit to `SKILL.md` (immediately reverted, not committed) before writing the real fix.
- `SKILL.md`'s copy-this-skill paragraph corrected: no longer claims the directory is self-sufficient (it depends on the sibling `devcontainer-host-path` skill on its mandatory import path), now instructs copying both skills together, naming no module, function, or import path.

## Task Commits

Each task was committed atomically:

1. **Task 1: Move the synchronisation primitives into vice-sync.mjs and rewire recover.mjs** - `adb485e` (refactor)
2. **Task 2: Make the SKILL.md module-leak gate durable, and correct the one false sentence in SKILL.md** - `9424395` (test)

## Files Created/Modified

- `.claude/skills/vice-session/scripts/vice-sync.mjs` - new module: checkpoint-synchronisation primitives, moved verbatim from `tools/recover.mjs`, with a complete rationale header
- `tools/recover.mjs` - imports the ten synchronisation symbols instead of defining them; tracker call sites updated to `track`/`untrack`/`ids()`
- `.claude/skills/vice-session/scripts/skill-docs.test.mjs` - new durable node:test gate enumerating `scripts/` and checking `SKILL.md` for leaked module names
- `.claude/skills/vice-session/SKILL.md` - copy-this-skill paragraph corrected (2 lines changed)

## Decisions Made

- `vice-sync.mjs` is a peer of `vice.mjs` and `vice-probe.mjs`, not folded into either — same "must never be merged" precedent `vice-probe.mjs`'s own header already documents for itself, extended to a third concern.
- `armedCheckpoints` exported as a singleton tracker object rather than a bare `Set`, matching the todo's explicit resolution: both `runToCheckpoint()` and `recover.mjs`'s hand-rolled `capture()` path must register ids in the same place.
- No maintainer document created or referenced anywhere — `INTERNALS.md` stays deleted per prior developer decision; all rationale lives in `vice-sync.mjs`'s own header comment.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' `<action>` instructions were followed literally: Task 1 was a pure code move with all comments preserved verbatim and no bodies/signatures/error messages changed; Task 2 wrote the RED test first, proved its failure direction via a reverted experiment, then made the GREEN fix to `SKILL.md`.

## Issues Encountered

None. All automated `<verify>` gates in both tasks passed on first run, including the exact-count gates (2/3 split of `vice_execution_run` call sites) and the rationale-preservation gate (every measured number and recorded incident comment verified present in the new module verbatim).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Layer A (checkpoint synchronisation) now lives in `vice-session`, ready for the queued `c64-ram-capture` skill (layer B, per `.planning/todos/pending/extract-sync-primitives-to-vice-session.md`) to import without pulling in the Bruce-Lee-specific `tools/recover.mjs`.
- Phase 3's verification harness (replay + checkpoint comparison) can reuse `vice-sync.mjs` directly — the same primitives this recovery tool depends on.
- No live VICE run was required or attempted for this task; every gate is emulator-free by design, consistent with the plan's stated constraint.

---
*Phase: quick-260730-u9w*
*Completed: 2026-07-30*

## Self-Check: PASSED

- FOUND: .claude/skills/vice-session/scripts/vice-sync.mjs
- FOUND: .claude/skills/vice-session/scripts/skill-docs.test.mjs
- FOUND: adb485e (Task 1 commit)
- FOUND: 9424395 (Task 2 commit)
