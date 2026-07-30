---
phase: quick-260730-jty
plan: 01
subsystem: infra
tags: [vice, mcp, bash, node-test, supervisor, crash-recovery, session-identity]

requires:
  - phase: 01-recovery-provenance
    provides: tools/vice.mjs's transport seam (call()/withReconnect()) and tools/recover.mjs's capture pipeline that this plan hardens
provides:
  - Host-only VICE crash supervisor (tools/vice-supervisor.sh) with respawn/backoff/crash-loop give-up and per-crash evidence logs
  - A restart "epoch" file contract shared between the host supervisor and the container-side harness
  - Session-identity checking in tools/vice.mjs (readEpoch/beginSession/assertSameMachine/MachineRestartedError)
  - Void-the-run behaviour in tools/recover.mjs so a detected restart never yields a silently-wrong capture
affects: [01-recovery-provenance, any future phase depending on recovery capture reliability]

tech-stack:
  added: []
  patterns:
    - "Host-to-container signalling via a plain, atomically-written JSON file on the bind mount instead of a new port/socket/IPC channel"
    - "Cheap synchronous file-read identity check performed first, MCP-based checkpoint-presence probe only as a fallback after a detected reconnect"
    - "Void-not-resume: on unprovable identity, rename artifacts to *.VOID-<timestamp> plus a sibling *.VOID.json evidence note rather than retry/reset automatically"

key-files:
  created:
    - tools/vice-supervisor.sh
  modified:
    - tools/vice.mjs
    - tools/recover.mjs
    - tools/recover.test.mjs
    - .gitignore
    - .planning/STATE.md

key-decisions:
  - "Epoch channel is a plain file on the existing bind mount, not a new port/socket/IPC mechanism -- the container already has read access to it and needs nothing else."
  - "No new checkpoints are armed as identity sentinels; the checkpoint-fallback probe reuses checkpoints the harness already arms for its own reasons, because checkpoint work is itself one of the two leading crash suspects in STATE.md's HAZARD CANDIDATE entry."
  - "A reconnect whose identity cannot be proven (no epoch file AND no armed checkpoint to probe) is treated as void, not as fine -- captures are cheap to re-run and a wrong dump is not."
  - "reconnectCount is 'consumed' (reset to 0) by assertSameMachine() so a later, unrelated identity check in the same session doesn't re-trigger a checkpoint probe against an id the current stage has already legitimately deleted."

requirements-completed: [D-1, D-2, D-3, D-4, D-5, D-6]

coverage:
  - id: D1
    description: "Host-only respawn supervisor (tools/vice-supervisor.sh): launch, respawn loop, exponential backoff, crash-loop give-up, per-crash evidence log with decoded exit status/signal, epoch file, executable + gitignored"
    requirement: "D-1"
    verification:
      - kind: unit
        ref: "bash -n tools/vice-supervisor.sh && test -x tools/vice-supervisor.sh"
        status: pass
      - kind: integration
        ref: "manual respawn-loop + crash-loop give-up run against a fake VICE_BIN (3 restarts, VICE_CRASH_WINDOW_S=60, VICE_MAX_RESTARTS=3) -- exit 4, crashes.log has 3 decoded entries"
        status: pass
    human_judgment: false
  - id: D2
    description: "Container guard: refuses to run inside this devcontainer, naming every signal that fired, with a testing-only escape hatch"
    requirement: "D-2"
    verification:
      - kind: integration
        ref: "bash tools/vice-supervisor.sh --dry-run (no ALLOW_CONTAINER) -> rc=2, stderr names /.dockerenv, CONTAINER_WORKSPACE_PATH, and the /proc/1/cgroup match"
        status: pass
    human_judgment: false
  - id: D3
    description: "Container-side restart detection: assertSameMachine()'s epoch-changed / epoch-absent / checkpoint-present / checkpoint-missing / unprovable-reconnect / no-reconnect-no-mcp-call paths; capture() gated at three points; recover() voids and never auto-resets/reboots/resumes"
    requirement: "D-3"
    verification:
      - kind: unit
        ref: "tools/recover.test.mjs -- 6 assertSameMachine tests + 3 readEpoch tests"
        status: pass
    human_judgment: false
  - id: D4
    description: "Evidence collection: per-crash x64sc log + decoded exit status/signal + crashes.log line (supervisor side); lastToolCall() recorded into voidRun()'s evidence note (harness side)"
    requirement: "D-4"
    verification:
      - kind: unit
        ref: "tools/recover.test.mjs -- voidRun tests (renames + VOID.json note content)"
        status: pass
      - kind: integration
        ref: "manual respawn-loop run: crashes.log holds one decoded entry per death with last ~20 log lines"
        status: pass
    human_judgment: false
  - id: D5
    description: "Recovery wording in tools/vice.mjs and tools/recover.mjs names tools/vice-supervisor.sh; STATE.md records supervision + evidence collection with the HAZARD CANDIDATE entry left intact; no recovery/**/NOTES.md invented"
    requirement: "D-5"
    verification:
      - kind: unit
        ref: "grep -c 'vice-supervisor.sh' tools/vice.mjs (7) and tools/recover.mjs (2); grep 'HAZARD CANDIDATE' .planning/STATE.md"
        status: pass
    human_judgment: false
  - id: D6
    description: "node --test tools/recover.test.mjs green, extended with epoch-changed / epoch-absent / checkpoint-disappeared / checkpoint-present / unprovable / no-reconnect cases plus voidRun, existing captureImage/assembleChunks tests untouched"
    requirement: "D-6"
    verification:
      - kind: unit
        ref: "tools/recover.test.mjs (all 18 tests)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-30
status: complete
---

# Quick Task 260730-jty: Host-Side VICE Crash Supervision Summary

**Host-only respawn supervisor for x64sc plus a restart-epoch file that `tools/vice.mjs`/`tools/recover.mjs` now check before trusting any reconnect, voiding (not resuming) any capture whose emulator identity can't be proven.**

## Performance

- **Duration:** ~25 min (1cf38a7 at 14:33:45Z through 6694cb1 at 14:45:09Z)
- **Started:** 2026-07-30T14:20Z (approx, reading phase)
- **Completed:** 2026-07-30T14:45:09Z
- **Tasks:** 3/3
- **Files modified:** 6 (tools/vice-supervisor.sh created; tools/vice.mjs, tools/recover.mjs, tools/recover.test.mjs, .gitignore, .planning/STATE.md modified)

## Accomplishments

- `tools/vice-supervisor.sh`: a HOST-ONLY bash supervisor with a multi-signal container guard (refuses in this devcontainer, exit 2, names every signal that fired), a respawn loop with exponential backoff and a crash-loop give-up threshold (exit 4), per-crash timestamped logs with decoded exit status/signal, a `crashes.log` line per death, and an atomically-written `epoch.json` that increments on every spawn (`--dry-run` writes exactly one record without spawning anything, for in-container verification).
- `tools/vice.mjs`: a new session-identity section — `readEpoch()` (never throws, treats the epoch file as untrusted input), `beginSession()`/`sessionReconnects()`/`lastToolCall()`, `MachineRestartedError`, and `assertSameMachine()` implementing the full epoch-changed / epoch-absent / checkpoint-present / checkpoint-missing / unprovable / no-reconnect decision tree. `withReconnect()` now tracks the reconnect count and last tool call attempted; `call()` runs a cheap, zero-MCP-traffic epoch check immediately after any reconnect-requiring call, throwing `MachineRestartedError` at the earliest possible point on a changed epoch. The `DENY_LIST` check remains the first statement in `call()`, and only transport failures are retried — both untouched.
- `tools/recover.mjs`: tracks the harness's own armed checkpoints in a module-level `Set` (the only identity signal available with no supervisor running); `capture()` now runs `assertSameMachine()` at three gates (before arming, immediately after the trigger-wait, and before the dump is declared good); `recover()` threads one session through the whole procedure and, on a detected restart, calls the new `voidRun()` (renames existing artifacts to `*.VOID-<timestamp>` plus a sibling `*.VOID.json` evidence note) and rethrows — never resetting, rebooting, or resuming automatically. `reproduce()` needed no changes: it has no try/catch, so a voided run's error propagates straight through it rather than reaching the hash comparison.
- `tools/recover.test.mjs`: 12 new `node:test` cases (readEpoch × 3, assertSameMachine × 6 covering every `<behavior>` bullet including epoch-changed/epoch-absent/checkpoint-disappeared, voidRun × 2) alongside the existing 6 `assembleChunks`/`captureImage` tests — all 18 green.
- Recovery wording in both files now names `tools/vice-supervisor.sh` and explains it's host-only, dropping a dangling reference to a `recovery/*/NOTES.md` that doesn't exist; the `RECONNECT_ATTEMPTS` comment explains why a now-succeeding retry needs the identity check added alongside it.
- `.planning/STATE.md` records the new supervision + evidence-collection capability without touching the existing unconfirmed HAZARD CANDIDATE entry.

## Task Commits

Each task was committed atomically:

1. **Task 1: Host-only VICE supervisor — container guard, crash-loop give-up, evidence logs, epoch file** - `1cf38a7` (feat)
2. **Task 2: Container-side restart detection — void the run, never auto-resume** - `8c326e9` (feat)
3. **Task 3: Point every recovery instruction at the supervisor, and record it in STATE.md** - `6694cb1` (docs)

**Plan metadata:** (STATE.md left uncommitted for the orchestrator per execution instructions; no separate metadata commit made by this executor.)

## Files Created/Modified

- `tools/vice-supervisor.sh` - Host-only respawn supervisor: container guard, epoch file, respawn/backoff/crash-loop give-up, per-crash evidence logs
- `tools/vice.mjs` - Session-identity section (readEpoch/beginSession/assertSameMachine/MachineRestartedError), reconnect tracking in withReconnect(), epoch fast-path in call(), recovery wording pointing at the supervisor
- `tools/recover.mjs` - Armed-checkpoint tracking, three assertSameMachine() gates in capture(), session-threaded recover(), voidRun(), recovery wording pointing at the supervisor
- `tools/recover.test.mjs` - 12 new node:test cases for readEpoch/assertSameMachine/voidRun
- `.gitignore` - `.vice-supervisor/` (host-side crash logs and epoch file, regenerated per supervisor start)
- `.planning/STATE.md` - New Blockers/Concerns entry recording supervision + evidence collection (HAZARD CANDIDATE entry left intact); `last_updated`/`last_activity_desc` refreshed

## Decisions Made

- Epoch channel is a plain JSON file on the existing bind mount (`.vice-supervisor/epoch.json`), not a new port/socket/IPC mechanism — the container already reads the bind mount and needs nothing else.
- No new checkpoints are armed purely to probe identity; the checkpoint-fallback only reuses checkpoints the harness already arms for its own reasons (boot gates, the dump trigger), since checkpoint work is itself one of the two leading crash suspects recorded in STATE.md's HAZARD CANDIDATE entry.
- `assertSameMachine()` "consumes" (resets) the module-level reconnect counter after each check, so a later, unrelated identity check in the same session doesn't spuriously re-trigger a checkpoint probe against a checkpoint id the current stage has already legitimately deleted.
- On an unprovable identity (no epoch file and no armed checkpoint to probe after a reconnect), the run is voided rather than trusted — captures are cheap to repeat and a silently-wrong 64K dump is strictly worse than a loud failure.

## Deviations from Plan

None — plan executed exactly as written. All six `<behavior>` bullets, the three `assertSameMachine()` gate points, the crash-loop give-up mechanics, and the D-5 wording pass were implemented as specified; no Rule 1-4 deviations were needed.

## Issues Encountered

- An initial draft of the respawn loop's crash-evidence comment accidentally used `//` (C-style) instead of `#` (bash) for one comment line inside the loop, which would have been a syntax error; caught and fixed before the first `bash -n` check, then verified with a live respawn-loop test against a fake `VICE_BIN` script (3 forced crashes, crash-loop give-up at `VICE_MAX_RESTARTS=3`, confirmed `crashes.log` had one decoded entry per death and `epoch.json` incremented each spawn).
- A synthetic SIGTERM-cleanup test using a bash-script stand-in for `x64sc` (which internally ran `sleep 60`) left an orphaned `sleep` process after the supervisor's own child received SIGTERM — an artifact of the two-process test double (bash wrapper forking `sleep`), not of the supervisor's logic: the real `x64sc` is spawned directly as a single process (`"$VICE_BIN" "${VICE_ARGS_ARR[@]}" &`), so this two-layer signal-forwarding gap does not apply to production use. The stray test process was killed and confirmed gone before moving on; no code change was needed.

## User Setup Required

None required to complete this quick task. However, the plan's `user_setup` block documents that the human should switch to running `tools/vice-supervisor.sh` from the HOST workspace (`/home/henrik/dev/henrik/git/bruce_lee/tools/vice-supervisor.sh`) instead of launching `x64sc` by hand going forward — this cannot be verified from inside the container and is the subject of the plan's `<human_verification>` section (guard sanity, normal start, restart detection, void-behaviour end-to-end, crash-loop give-up, evidence-log contents), none of which this executor could run itself.

## Next Phase Readiness

- Phase 1 (recovery-provenance) plans 01-02 through 01-04, which need substantial live emulator time plus a human-driven play-through, now have both a self-healing host process AND a harness that will refuse to silently trust a machine it can't prove is the same one — closing the "supervision without detection" gap identified in this task's objective.
- The still-unconfirmed `vice_run_until`/`vice_execution_run` crash hypothesis in STATE.md's HAZARD CANDIDATE entry is untouched; the new `.vice-supervisor/crashes.log` evidence trail is what should eventually confirm or kill it, once the host supervisor has been run for real (this container could not exercise x64sc itself).
- Recommended before resuming Phase 1 emulator-heavy work: the user runs the six `<human_verification>` steps from the plan on the host (guard sanity, normal start, restart detection epoch bump, void-behaviour end-to-end, crash-loop give-up, evidence-log contents) to confirm the supervisor's actual runtime behaviour, which no amount of in-container testing can substitute for.

## Self-Check: PASSED

All claimed files exist (`tools/vice-supervisor.sh`, `tools/vice.mjs`, `tools/recover.mjs`,
`tools/recover.test.mjs`, `.gitignore`, `.planning/STATE.md`, this SUMMARY) and all three task
commit hashes (`1cf38a7`, `8c326e9`, `6694cb1`) are present in `git log`.

---
*Phase: quick-260730-jty*
*Completed: 2026-07-30*
