---
phase: quick-260730-p5x
plan: 01
subsystem: infra
tags: [vice-mcp, mcp, health-check, liveness-probe, node-http, node-test]

# Dependency graph
requires:
  - phase: quick-260730-mef
    provides: registry.json / leases / per-instance epoch.json coordination layer
  - phase: quick-260730-nh5
    provides: vice-session skill's session/pool layer and CLI seam
provides:
  - vice-probe.mjs -- single-shot, short-timeout, no-retry vice_ping liveness check, structurally isolated from the resilient transport seam
  - acquire() that probes before leasing, so a registered-but-dead instance is never handed out
  - poolHealth() -- launched/alive/leased/supervised as four separate fields per instance, plus a D-4 dead-supervisor-vs-respawning diagnosis
  - `pool status` CLI verb and a pure formatPoolHealth() formatter
  - tools/vice-pool.sh cmd_status pointer to container-side liveness
affects: [vice-session skill, any future phase driving VICE through a pool]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Deliberately-fragile counterpart module pattern: a health-check path that takes NO static import of the resilient/retrying seam it sits beside, so the two can never be accidentally merged."
    - "Four-questions-as-separate-fields: launched/alive/free/supervised kept as distinct typed fields through the whole pipeline (probe -> health record -> formatter -> CLI), never collapsed into one boolean or string."
    - "Diagnosis-with-a-fix, not just a finding: D-4's dead-supervisor/respawning/unproven verdicts each state what to do next, and explicitly refuse to manufacture certainty via a tuned staleness threshold when the evidence is genuinely ambiguous."

key-files:
  created:
    - .claude/skills/vice-session/vice-probe.mjs
  modified:
    - .claude/skills/vice-session/vice-pool.mjs
    - .claude/skills/vice-session/vice.mjs
    - .claude/skills/vice-session/vice-pool.test.mjs
    - .claude/skills/vice-session/SKILL.md
    - tools/vice-pool.sh

key-decisions:
  - "probeInstance()/probeAll() are a brand-new module with zero static dependency on tools/vice.mjs's transport seam -- the only way to guarantee the ~50s reconnect ladder can never leak into a health check."
  - "acquire()'s per-poll-cycle probe pass runs before any lease attempt and skips non-answering candidates entirely; the resulting error on exhaustion names each candidate's own reason (no answer + cause + supervision verdict, leased by whom, or lost the race) instead of a bare 'held' list."
  - "poolHealth()'s D-4 diagnosis takes an optional `previous` health snapshot to distinguish 'unproven from one probe' from 'epoch unchanged -> dead supervisor' from 'epoch advanced -> respawning' -- no staleness timer, since a tuned threshold would manufacture false certainty the project explicitly rejects elsewhere."
  - "Pre-existing tests were updated MECHANICALLY ONLY: `probe: false` added to every synthetic-registry acquire() call, `VICE_POOL_PROBE: \"0\"` added to every CLI env block that drives `session acquire` -- no assertion, fixture, or expected value changed anywhere."

requirements-completed: [D-1, D-2, D-3, D-4, D-5, D-6, D-7]

coverage:
  - id: D1
    description: "vice-probe.mjs: single-shot, short-timeout, no-ladder vice_ping liveness check with no static dependency on the resilient transport seam"
    requirement: D-3
    verification:
      - kind: unit
        ref: ".claude/skills/vice-session/vice-pool.test.mjs#probeInstance/probeAll tests (alive stub, ECONNREFUSED, timeout, HTTP 500, non-ping 200, 4-way concurrency, real dead-endpoint timing)"
        status: pass
      - kind: other
        ref: "node -e import-graph check confirming no `import ... vice.mjs` line in vice-probe.mjs"
        status: pass
    human_judgment: false
  - id: D2
    description: "acquire() probes before leasing; a dead candidate is skipped, never returned; the exhaustion error names every candidate's own rejection reason"
    requirement: D-2
    verification:
      - kind: unit
        ref: ".claude/skills/vice-session/vice-pool.test.mjs#'a two-port registry with only one live stub returns the LIVE port', 'every candidate dead rejects with a per-candidate reason', 'a candidate that is alive but leased is reported as LEASED, not dead'"
        status: pass
    human_judgment: false
  - id: D3
    description: "poolHealth() answers launched/alive/leased/supervised as four separate fields per instance, with a D-4 dead-supervisor-vs-respawning diagnosis"
    requirement: D-1
    verification:
      - kind: unit
        ref: ".claude/skills/vice-session/vice-pool.test.mjs#poolHealth tests and diagnose() D-4 branch tests (no-epoch, unproven, DEAD SUPERVISOR, respawning)"
        status: pass
    human_judgment: false
  - id: D4
    description: "`pool status` CLI verb and formatPoolHealth() surface all four answers container-side; tools/vice-pool.sh points at it for actual liveness; SKILL.md documents the four questions and two new failure modes"
    requirement: D-5
    verification:
      - kind: unit
        ref: ".claude/skills/vice-session/vice-pool.test.mjs#formatPoolHealth tests and CLI 'pool status' test (expired session present, completes under 3s)"
        status: pass
      - kind: other
        ref: "VICE_POOL_DIR=$(mktemp -d) node .claude/skills/vice-session/vice.mjs pool status"
        status: pass
    human_judgment: false
  - id: D5
    description: "Zero-config port 6510 behaviour, deny-list enforcement, retry-classification, and all lease/session/TTL semantics unchanged; all 63 pre-existing tests still pass unmodified in intent"
    requirement: D-7
    verification:
      - kind: unit
        ref: "node --test .claude/skills/vice-session/vice-pool.test.mjs tools/recover.test.mjs (87 pass, 0 fail: 63 pre-existing + 24 new)"
        status: pass
      - kind: other
        ref: "node .claude/skills/vice-session/vice.mjs ping against the down default endpoint -- confirmed unchanged ~50s reconnect ladder and identical host-restart guidance"
        status: pass
    human_judgment: false

duration: 13min
completed: 2026-07-30
status: complete
---

# Quick Task 260730-p5x: Pool Discovers Live Instances by Ping Probe Summary

**A new deliberately-fragile `vice_ping` probe module makes `acquire()` skip dead candidates instead of handing them out, and a `pool status` CLI verb reports launched/alive/leased/supervised as four separate answers with a dead-supervisor-vs-respawning diagnosis.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-07-30T18:18:05Z
- **Completed:** 2026-07-30T18:31:30Z
- **Tasks:** 3
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments

- `vice-probe.mjs`: `probeInstance()`/`probeAll()` -- one `initialize` + `tools/call(vice_ping)` sequence per candidate, a single shared `AbortSignal.timeout`, no retry/backoff, never throws, and structurally cannot reach a forbidden tool (`PROBE_TOOL` is a hardcoded constant, not a parameter). Proven against the real, currently-down default VICE endpoint: a verdict lands in single-digit milliseconds, not the ~50s the resilient reconnect ladder would cost.
- `acquire()` now probes every candidate once per poll cycle, before any lease attempt, and only tries to lease ports that answered -- a registered-but-dead instance is skipped, never returned. The exhaustion error lists each candidate's own reason (no answer + cause + supervision verdict, leased by whom, or lost the race) instead of a bare "held" list.
- `poolHealth()` builds one record per candidate instance with `launched`, `alive` (+ reason), `lease` (from a new `leaseInfo()`), and `epoch`/supervised as four genuinely separate fields, plus a `diagnosis` string implementing D-4's dead-supervisor-vs-respawning-vs-unproven distinction (fed by an optional prior snapshot, never a tuned staleness timer).
- `pool status` CLI verb (skips session resolution, like `session` itself) plus a pure `formatPoolHealth()` formatter; `tools/vice-pool.sh`'s `cmd_status` now points at it for actual VICE liveness (the shell side only ever saw supervisor-pid liveness).
- `SKILL.md` documents the four questions/four mechanisms and two new troubleshooting rows (registered-but-dead instance, `DEAD SUPERVISOR` diagnosis).

## Task Commits

1. **Task 1: The probe** - `839a650` (feat)
2. **Task 2: Probing acquire() plus the four-question health model** - `398b754` (feat)
3. **Task 3: Surface the four answers** - `acf0a83` (feat)

## Files Created/Modified

- `.claude/skills/vice-session/vice-probe.mjs` - new module: `PROBE_TOOL`, `DEFAULT_PROBE_TIMEOUT_MS`, `probeInstance()`, `probeAll()`
- `.claude/skills/vice-session/vice-pool.mjs` - `leaseInfo()`, `diagnose()`, `poolHealth()`, `formatPoolHealth()`, reworked `acquire()` with `probe`/`probeTimeoutMs` options
- `.claude/skills/vice-session/vice.mjs` - new `pool status` CLI verb; `pool` added to the session-resolution skip list; usage text updated
- `.claude/skills/vice-session/vice-pool.test.mjs` - 24 new tests (9 probe, 12 acquire/poolHealth/diagnose, 3 formatter/CLI); 28 mechanical edits to pre-existing tests (`probe: false` / `VICE_POOL_PROBE: "0"`)
- `.claude/skills/vice-session/SKILL.md` - `pool status` documented, four-questions table, two new troubleshooting rows
- `tools/vice-pool.sh` - `cmd_status` appends a pointer line to container-side `pool status` for actual liveness

## Decisions Made

- The probe module takes zero static dependency on `tools/vice.mjs` (the transport seam) -- this is the structural guarantee that the resilient retry path can never leak into the probe, not just a convention documented in a comment.
- `acquire()`'s deadline error message wording changed (`"every candidate rejected: ..."` replacing `"every candidate port is held: ..."`) since the new per-candidate reasons distinguish "no answer" from "leased" from "lost the race" -- no pre-existing test asserted on the old exact wording, only on port numbers/pids appearing via regex, so this was safe to change.
- D-4's diagnosis takes an optional `previous` poolHealth() snapshot rather than a wall-clock staleness threshold, matching the project's established rejection of "tuning until green manufactures false confidence" (see `.planning/STATE.md`'s block-fill-heuristic entry for the general pattern).
- `describeAcquireRejection()` reuses the existing `describeHolder()` renderer for the "leased" branch rather than duplicating lease-formatting logic, keeping exactly one place that renders a lease record for a human.

## Deviations from Plan

### Auto-fixed Issues

None - Rules 1/2/3 auto-fixes. Plan executed as written for all three tasks.

### Noted, not a deviation

**1. Task 2's second `<verify>` grep pattern didn't match this environment's Node test-runner output.**
- **Found during:** Task 2 verification
- **Issue:** The plan's `grep -E '^# (pass|fail)'` expects a TAP-style `# pass`/`# fail` summary prefix. This container's Node (v24.18.1) default test reporter prints `ℹ pass`/`ℹ fail` instead.
- **Resolution:** Not a code bug -- confirmed the actual pass/fail counts directly (`node --test ... | grep -E '^ℹ (tests|pass|fail)'` → `tests 87 / pass 87 / fail 0`), satisfying the substantive requirement ("pass count at least 63 plus new tests and fail count 0"). No source change was needed or made; this is purely a reporter-prefix difference in the verification command itself.

## Issues Encountered

None beyond the reporter-prefix note above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The pool's four questions (launched/alive/leased/supervised) are now answerable in one command (`pool status`) and enforced automatically by `acquire()` -- the next time the host supervisor dies mid-session, this should surface as a clear diagnosis rather than a ~50s reconnect-then-fail.
- `vice-probe.mjs` and `poolHealth()`/`leaseInfo()` are exported and ready for `tools/recover.mjs` or any future harness code to call directly if a pre-flight liveness check is ever needed before a long capture run (not wired in yet -- out of scope for this task).
- No blockers. The host VICE MCP server is still down (unrelated, pre-existing -- see `.planning/STATE.md`'s HARD BLOCKER entry); this task's tests and the real-endpoint timing proof both worked correctly against that exact down state.

---
*Phase: quick-260730-p5x*
*Completed: 2026-07-30*

## Self-Check: PASSED

All 7 claimed files verified present on disk; all 3 task commit hashes (839a650, 398b754, acf0a83) verified present in git log.
