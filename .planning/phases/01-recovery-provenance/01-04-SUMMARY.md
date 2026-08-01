---
phase: 01-recovery-provenance
plan: 04
subsystem: infra
tags: [vice-mcp, on-demand-load-detection, node-test, sha256, node-crypto]

# Dependency graph
requires:
  - phase: 01-recovery-provenance (plan 01-03)
    provides: recovery/RELEASES.json's committed run1 dumps (bin/state/map/capture) for both releases, and the shared $08B1 trigger
provides:
  - "tools/watch-loads.mjs and tools/dump-artifacts.mjs: the detector's pure logic and the artifact renderer, both fully tested with no emulator present"
  - "A logged, unresolved blocker: mcp__vice__* tools were entirely absent from this executor's tool schema, so Tasks 2-4 (all live emulator work) could not run"
affects: [01-05, 01-06, 02-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-tier sentinel model: stopping-tier loader-reentry checkpoints vs counting-tier never-populated-range/register checkpoints, resolved from registry+manifest data rather than hardcoded"
    - "Agent-fetches-observations, pure-module-renders-artifact: the only shape a 65536-byte binary artifact can take under the mcp__vice__*-only rule"

key-files:
  created:
    - tools/watch-loads.mjs
    - tools/watch-loads.test.mjs
    - tools/dump-artifacts.mjs
    - tools/dump-artifacts.test.mjs
    - .planning/todos/pending/2026-08-01-vice-mcp-tools-absent-from-executor-tool-schema.md
  modified: []

key-decisions:
  - "Task 1 (pure logic, no emulator dependency) was executed and committed in full; Tasks 2-4 (all live mcp__vice__* work) were halted rather than worked around, because the required tools were absent from this session's tool schema -- not merely a live-state problem `vice_ping` could diagnose, but a structural absence matching the tools:-frontmatter MCP-stripping bug the harness's own documentation names for a different server."
  - "No fallback route to the emulator was attempted (no direct HTTP/fetch, no broker-state reading) -- the project's hard rule forbids it, and STATE.md records a prior instance of exactly this workaround being discarded unmerged."

requirements-completed: []  # RECOVER-04 is NOT complete -- Tasks 2-4 (which earn and exercise the detector live) did not run.

coverage:
  - id: D1
    description: "Detector pure logic (WATCH_SET, attributeAddress, reportHits, idleGate, classifyHit, screenSignature, readHitLog/validateHitLog/recordWatchSet/renderLoading) and the artifact renderer (assembleImage, sha256Buffer, vicBank, screenBase, buildChipState, buildRangeManifest, writeDumpSet), both proven with no emulator present"
    requirement: "RECOVER-04"
    verification:
      - kind: unit
        ref: "tools/watch-loads.test.mjs (21 tests) && tools/dump-artifacts.test.mjs (14 tests)"
        status: pass
      - kind: other
        ref: "node tools/recovery-schema.mjs check-parameterisation && node tools/recovery-schema.mjs validate"
        status: pass
    human_judgment: false
  - id: D2
    description: "Earn the armed set live, calibrate idle to zero, prove teardown, correct the two NOTES.md defects (Task 2)"
    requirement: "RECOVER-04"
    verification: []
    human_judgment: true
    rationale: "Not executed. Blocked: mcp__vice__* tools were absent from this executor's tool schema for the entire session -- Task 2's own precondition (a live mcp__vice__vice_ping) could not even be checked, since no such tool existed to call."
  - id: D3
    description: "Bounded play-through, hit attribution, supplementary dumps, recovery/LOADING.md (Task 3)"
    requirement: "RECOVER-04"
    verification: []
    human_judgment: true
    rationale: "Not executed -- depends on Task 2's earned watch_set, which was never produced for the same reason."

# Metrics
duration: partial (halted at Task 2's precondition)
completed: 2026-08-01
status: blocked
---

# Phase 01 Plan 04: On-Demand-Load Detector -- Task 1 Complete, Tasks 2-4 Blocked

**Detector pure logic and artifact renderer built and fully tested (35 tests, no emulator present); Tasks 2-4 could not run because `mcp__vice__*` tools were entirely absent from this executor's tool schema for the whole session.**

## Performance

- **Duration:** partial -- halted at Task 2's `<precondition>` before any live emulator work was attempted
- **Started:** 2026-08-01 (session start)
- **Completed:** N/A -- plan is not complete
- **Tasks:** 1 of 3 executable tasks complete (Task 4 is a human checkpoint gated on Task 3, also not reached)
- **Files modified:** 5 (4 new `tools/` files, 1 new todo)

## Accomplishments

- **Task 1 done in full.** `tools/watch-loads.mjs` (`WATCH_SET`, `attributeAddress`, `reportHits`, `idleGate`, `classifyHit`, `screenSignature`, `readHitLog`, `validateHitLog`, `recordWatchSet`, `renderLoading`, plus a `resolve|attribute|report|check-idle|signature|render` CLI) and `tools/dump-artifacts.mjs` (`assembleImage`, `sha256Buffer`, `vicBank`, `screenBase`, `buildChipState`, `buildRangeManifest`, `writeDumpSet`, plus an `assemble|chip-state|manifest|write-set` CLI) are written, committed, and pass every stated acceptance criterion.
- **`vicBank`/`screenBase`/`buildChipState`'s derivations were verified against real committed data**, not just synthetic fixtures: given `recovery/danish/dumps/danish-gameentry-run1.state.json`'s own recorded `dd00_raw`/`d018_raw` (193/49), the pure functions reproduce that same file's recorded `vic_bank` (2), `screen_base` (35840) and `charset_base` (32768) exactly -- and the same holds for `saeger`'s run1 sidecar, proving the formula is generic rather than release-specific.
- **The import-purity guard test is in place and passing**: it reads both new modules' source, strips comments, extracts every import specifier, and asserts each one is a `node:` built-in or a sibling file inside `tools/` -- the mechanical, guard-removal-sensitive proof that neither module can reach the emulator (T-01-25).
- **Tasks 2-4 (all live emulator work) were halted, not worked around.** See "Deviations from Plan" and the new todo below.

## Task Commits

1. **Task 1: The detector's pure logic and the artifact renderer, pinned by tests that run with no emulator** - `ffb9a64` (feat)

Tasks 2, 3 and 4 have no commits: they were never started, because Task 2's `<precondition>` --
"This session holds a live emulator instance: `mcp__vice__vice_ping` returns an ok status" -- could
not even be evaluated. There was no `mcp__vice__vice_ping` tool, or any `mcp__vice__*` tool, in
this executor's tool schema at any point in the session.

## Files Created/Modified

- `tools/watch-loads.mjs` - Two-tier sentinel resolution, address attribution, hit ordering, idle gate, hit classification, screen-matrix signature, `LOADING.md` renderer, and the CLI wrapping all of it
- `tools/watch-loads.test.mjs` - 21 `node:test` cases, including two against real committed sidecars and the import-purity guard
- `tools/dump-artifacts.mjs` - Chunk assembly with contiguity/total-length assertions, chip-state and range-manifest derivation, four-file dump-set writer
- `tools/dump-artifacts.test.mjs` - 14 `node:test` cases, including two against real committed sidecars
- `.planning/todos/pending/2026-08-01-vice-mcp-tools-absent-from-executor-tool-schema.md` - New todo logging the tool-availability quirk, per the CLAUDE.md instruction to log VICE MCP quirks as a todo rather than trying to fix them from inside a plan executor

## Decisions Made

- **Halt rather than route around the missing tools.** `.claude/CLAUDE.md`'s hard rule states plainly: "If a design needs a Node process to reach VICE, the design is dead — say so and replan." The absence of the sanctioned tools is a stronger version of that same signal, and `.planning/STATE.md` already records one prior instance of an executor building an unsanctioned `fetch()` bypass when told to route around this exact constraint -- that work was discarded unmerged. Repeating it here, even under time pressure, would be the same mistake with more context available to prevent it.
- **Task 1's design and code are unaffected by the blocker** and are a complete, independently useful deliverable: they are exactly what Task 2/3 will call once live access is restored, and their test suite (35 tests total) already proves the logic against real committed evidence.

## Deviations from Plan

### Not auto-fixed -- a hard environmental blocker, logged rather than routed around

**1. [Precondition unmet, not auto-fixable] `mcp__vice__*` tools absent from this executor's tool schema**
- **Found during:** Task 2's `<precondition>` check, before any action was taken
- **Issue:** Task 2 requires `mcp__vice__vice_ping` to return an `ok` status as its first precondition check. This executor's tool schema for the entire session contained exactly `Read`, `Write`, `Edit`, `Bash`, `Skill` -- no `mcp__vice__*` tool of any kind was present to even attempt the call. This is very likely the same class of bug the harness's own `documentation_lookup` guidance names for a different MCP server (Context7): "upstream bug anthropics/claude-code#13898 strips MCP tools from agents with a `tools:` frontmatter restriction." Unlike Context7, VICE has no sanctioned CLI fallback -- building one would itself be the prohibited second route to the emulator.
- **Fix:** None applied. Per the executor's own protocol, an unmet `<precondition>` is never auto-approved and must halt with a `checkpoint:human-verify`/`human-action` report rather than a partial commit. Logged as a todo (`2026-08-01-vice-mcp-tools-absent-from-executor-tool-schema.md`) per `.claude/CLAUDE.md`'s instruction to log VICE MCP quirks rather than fix them from inside a plan executor.
- **Files modified:** none (Task 2/3's files were never touched)
- **Verification:** N/A -- nothing to verify; the tool call itself does not exist to attempt
- **Committed in:** N/A (no code change; the todo file is committed alongside this SUMMARY)

---

**Total deviations:** 1, a hard blocker (not one of Rules 1-4's auto-fixable categories)
**Impact on plan:** Task 1 (1 of 3 executable tasks, plus its own full test suite) is complete and unaffected. Tasks 2-4 (the live-emulator earn/play/attribute/checkpoint work that RECOVER-04 actually needs to be considered proven) did not run at all. **RECOVER-04 is NOT satisfied by this plan as executed** -- only its pure-logic substrate is.

## Issues Encountered

- See "Deviations from Plan" above -- the entire issue this session encountered was the absent `mcp__vice__*` tool schema. No other issues arose; Task 1's code, once written, passed its full test suite and the registry validator on the first run (after fixing one test-fixture bug in `dump-artifacts.test.mjs`'s own `chunkOf` helper, caught immediately by the test run itself).

## User Setup Required

None - no external service configuration required. This is a harness/tool-access issue, not a user-facing setup step; see the new todo for the diagnostic and remediation directions.

## Next Phase Readiness

- **Not ready.** This plan's own Task 4 is a `checkpoint:human-verify` gated on Task 3's output, and Task 3 depends on Task 2's earned `watch_set` -- neither exists. Re-running Tasks 2-4 (ideally in a fresh session first verified to actually expose `mcp__vice__*` tools, per the new todo's "Solution" section) is required before this plan, and therefore RECOVER-04, can be considered done.
- Task 1's `tools/watch-loads.mjs` and `tools/dump-artifacts.mjs` are ready to be called by whichever session picks Tasks 2-4 back up; nothing about them needs to change for that resumption.
- **Blocker for the phase:** plans 01-05 and 01-06 (per `.planning/STATE.md`'s replan note) consume this plan's `loader_ranges`/`watch_set` data shape, which does not yet exist in the registry. They should not proceed past whatever they can do without it until this plan's Tasks 2-4 land.

---
*Phase: 01-recovery-provenance*
*Completed: 2026-08-01 (partial -- blocked)*
