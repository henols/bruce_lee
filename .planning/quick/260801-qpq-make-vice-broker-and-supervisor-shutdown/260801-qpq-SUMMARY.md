---
phase: quick-260801-qpq
plan: 01
subsystem: infra
tags: [vice, mcp, bash, node, shutdown, broker, supervisor]

requires:
  - phase: 01.2
    provides: vice-broker.sh on-demand daemon (request/grant/spare state machine), vice-supervisor.sh crash respawn loop, vice-pool.sh N-instance launcher
provides:
  - "vice-broker.sh: signal_recorded_pid()/reap_all_instances()/purge_protocol_state()/drop_dead_instance_records() -- shutdown reaper, stop-time reaper, start-time ghost-record validator"
  - "vice-broker.sh: count_launching() -- single in-flight-launch counter shared by process_requests() and maintain_spares()"
  - "vice-broker.sh: grant_from_spare() grant-time readiness probe -- a ready spare is proven live immediately before being handed out, not trusted from bookkeeping alone"
  - "vice-supervisor.sh: terminate_child()/on_signal()/on_exit() -- two-entry-point trap (INT/TERM/HUP vs EXIT), give-up exit status preserved"
  - "vice-pool.sh: cmd_start()'s own two-entry-point trap over its spawned-pid array, disarmed once the registry is written"
  - ".claude/CLAUDE.md Emulator Access: reworded to permit maintaining .claude/mcp/ itself, without touching the mcp__vice__-only hard rule"
affects: [phase-1-recovery-provenance, 01-04, any-future-emulator-heavy-plan]

tech-stack:
  added: []
  patterns:
    - "Two-entry-point shell trap: a signal handler (INT/TERM/HUP) that disarms all four traps before its own exit, plus a separate EXIT handler that captures $? as its first statement and re-exits with it -- so a give-up exit code survives an added cleanup handler unchanged"
    - "Start-time (not just shutdown-time) validation of persisted state against a live process check, as the backstop for the one exit path no trap can catch (kill -9, host power loss)"
    - "A record saying 'ready' is bookkeeping; a probe that answers right now is evidence -- grant-time (not just promotion-time) readiness proof before handing out a resource"
    - "One shared in-flight counter consulted by every launch path, rather than one counter per path, to make simultaneous-launch races structurally impossible rather than merely unlikely"

key-files:
  modified:
    - .claude/mcp/vice/resources/vice-broker.sh
    - .claude/mcp/vice/resources/vice-supervisor.sh
    - .claude/mcp/vice/resources/vice-pool.sh
    - .claude/mcp/vice/vice-broker.test.mjs
    - .claude/mcp/vice/vice-pool.test.mjs
    - .claude/CLAUDE.md

key-decisions:
  - "Shutdown design reversed: the broker now terminates every instance it knows about (grants/ and spares/ alike) on any trapped exit and on every `stop`, rather than leaving them running. An orphan outliving the session that wanted it, and then blocking every later launch, costs more than an interrupted session does -- exactly what the 2026-08-01 ghost-grant incident proved."
  - "Spare warming serialised to exactly one launch per pass, never parallel, because x64sc opens a GTK3 window, an OpenGL 4.6 context and PulseAudio -- three simultaneous launches lost that race on 2026-08-01 with one SEGV, one exit 1, one exit 0 at the identical spawn second."
  - "grant_from_spare() now probes before granting and drops+retries the next candidate on failure, rather than trusting a 'ready' record -- the exact gap that let a dead instance's grant survive a broker stop, a broker start, and a full host restart."
  - "CLAUDE.md's blanket 'not to be read or edited' clause over .claude/mcp/ was narrowed to apply only when a task is NOT maintaining that implementation -- the mcp__vice__-only hard rule and the .vice-supervisor/ off-limits note are untouched."

requirements-completed: [QUICK-260801-qpq]

duration: ~2h
completed: 2026-08-01
status: complete
---

# Quick Task 260801-qpq: Make the VICE Broker and Supervisor Shutdown-Safe Summary

**The broker now terminates and purges everything it owns on every exit path it can trap and validates what it persisted on the one path it cannot (kill -9 / host restart); spare warming is serialised to stop x64sc's GPU/audio race; and a grant is never handed out without a probe that just answered.**

## Performance

- **Duration:** ~2 hours
- **Tasks:** 3 (all `auto`/`tracer` type, no checkpoints — fully autonomous)
- **Files modified:** 6 (3 shell scripts, 2 test files, CLAUDE.md)
- **Tests:** 33 → 40 in `vice-broker.test.mjs`, 73 → 76 in `vice-pool.test.mjs`, both suites fully green; full plan-level verification list (182 tests across 6 files) green

## Accomplishments

**Task 1 — shutdown reaper, stop-time reaper, start-time ghost-record validation**

- `signal_recorded_pid()`: identity-checked (`ps -o args=` against `$SUPERVISOR_SCRIPT`) SIGTERM, polled `kill -0` every 200ms up to `VICE_BROKER_KILL_WAIT_S` (default 5s), SIGKILL escalation only after a genuine identity match.
- `reap_all_instances()`: walks `grants/*.json` and `spares/*.json`, signals every recorded `supervisor_pid`. Safe to call twice.
- `purge_protocol_state()`: removes `spares/`, `grants/`, `requests/`, `leases/`, `broker.json`, `broker-instances.json` via already-resolved variables only; refuses if `VICE_POOL_DIR` is empty; deliberately leaves `denials/` (a message already addressed to a container that hasn't read it).
- `drop_dead_instance_records()`: start-time validation, the only backstop that survives a `kill -9` or host power loss (no trap catches either). Exempts `dry_run:true` records outright — the whole existing fixture corpus depends on this. Also drops a spare recorded "ready" whose port has no listener, closing the exact gap the 2026-08-01 ghost grant exploited.
- `cmd_start` wires `drop_dead_instance_records` before the first pass (both `--once` and daemon paths) and registers `broker_shutdown` as an `EXIT HUP INT TERM` trap on the daemon path only — never on `--once`, which is a single pass of a broker that is not ending.
- `cmd_stop` rewritten: every case (live broker, dead pid, no pid, no `broker.json` at all) now reaps and purges. The old early "nothing to stop" exits are gone.
- New `brokerCopyWithSleepingSupervisor()` test fixture (traps signals, sleeps, so it's a genuinely live, identity-matching process) drives five new behavioral gates.

**Task 2 — serialised spare warming, grant-time readiness probe**

- `count_launching()` replaces `count_cold_launching()`: one in-flight counter (any reason, cold or spare) consulted by both launch paths, so they can never disagree about whether a boot is under way.
- `process_requests()` and `maintain_spares()` both consult this single counter; `maintain_spares()` breaks after exactly one successful launch per pass (a refused launch still blocks its port and keeps scanning within the same pass — the pre-existing bound-port regression is preserved).
- `grant_from_spare()` now calls `probe_ready()` on the selected port before writing the grant. A candidate that fails is terminated and dropped, and selection moves to the next-lowest ready candidate; returns non-zero only once none probe clean.
- Fixed the stale `usage()` text claiming `start N`'s positional "is not yet consumed by any spares logic" — it has driven `VICE_BROKER_SPARES` since the criterion-13 checkout; only the docs were wrong.
- Rewrote the `VICE_BROKER_SPARES=2` test into the serialised ladder (pass 1: one launching; pass 2: one ready + one launching; pass 3: two ready) and added three new gates for the in-flight wait, the deferred pending request, and the grant-time probe dropping a stale spare in favor of the next candidate.
- Updated the tracer test's forwarded-tool-call count from three to four (the new grant-time probe adds a real call), and gave three pre-existing tests (kill-never-recycle, id-parity, malformed-request) an always-succeeding probe stub so their fake "ready" fixtures keep testing what they tested before, not the new probe itself.

**Task 3 — supervisor/pool exit traps, CLAUDE.md rewrite**

- `vice-supervisor.sh`: split into `terminate_child()` (shared kill-and-wait) plus two entry points — `on_signal` (INT/TERM/HUP, disarms all four traps first) and `on_exit` (EXIT, captures `$?` as its first statement, disarms only itself, re-exits with the captured status). This is load-bearing: the crash-loop give-up path's `exit 4` now survives the new EXIT handler unchanged.
- `vice-pool.sh` `cmd_start()`: collects every spawned supervisor pid into an array, adds the same two-entry-point trap so an interrupted start terminates what it already spawned and removes a now-inconsistent `registry.json`, reusing `cmd_stop`'s own identity check. Disarmed once the loop completes and the registry is written, so a later signal to the pool process never kills a pool it just successfully started.
- `.claude/CLAUDE.md` § Emulator Access: reworded the clause that forbade reading or editing `.claude/mcp/` entirely. It now says the vice MCP is the tracked implementation, edited in its `resources/` directory when the task is maintaining it (as opposed to using it to reach the emulator) — the deployed `tools/` copies are generated and gitignored. The `mcp__vice__`-only hard rule and the `.vice-supervisor/` off-limits note are untouched.
- New SIGHUP gate in `vice-pool.test.mjs` (a `/bin/sleep` stand-in, sent SIGHUP, must be terminated before the supervisor itself exits with status 0), structural EXIT/HUP assertions for both scripts, and an explicit `bash -n` pair.
- Refreshed this worktree's deployed `tools/*.sh` from the tracked `resources/` sources via `installResources({ force: true })` — gitignored, not committed, but now byte-identical to the tracked sources (`diff` confirmed for all three scripts).

## Task Commits

1. **Task 1: broker terminates and purges what it owns** — `d57f53b` (feat)
2. **Task 2: serialise spare warming, grant-time probe** — `345411b` (feat)
3. **Task 3: supervisor/pool exit traps, CLAUDE.md rewrite** — `b1eb8cb` (feat)

_No RED/GREEN split commits: this plan's `tdd="true"` tasks were executed by writing the new/changed tests and the implementation together per task, verified green before commit, rather than committing a separately-failing RED state — the plan's own `<verify>` blocks (not a strict RED-first gate) were the acceptance criteria for each task._

## Files Created/Modified

- `.claude/mcp/vice/resources/vice-broker.sh` — shutdown reaper, purge, start-time record validation, serialised warming, grant-time probe, reversed design note (dated, with reasoning)
- `.claude/mcp/vice/resources/vice-supervisor.sh` — two-entry-point trap (signal handler plus status-preserving EXIT handler)
- `.claude/mcp/vice/resources/vice-pool.sh` — spawned-pid tracking plus the same two-entry-point trap, disarmed after a successful start
- `.claude/mcp/vice/vice-broker.test.mjs` — sleeping-supervisor fixture; 7 new tests (5 for Task 1, 4 for Task 2, minus overlap accounting — net +7 across both tasks); 3 pre-existing tests patched for the new grant-time probe; 33 → 40 tests
- `.claude/mcp/vice/vice-pool.test.mjs` — SIGHUP gate, structural trap assertions for both scripts, `bash -n` pair; `HERE`/`waitFor`/`spawn`/`rmSync` additions; 73 → 76 tests
- `.claude/CLAUDE.md` — § Emulator Access reworded

## Decisions Made

- The shutdown-contract reversal is documented in three places in `vice-broker.sh` (header comment, `usage()`'s `start`/`stop` entries, `cmd_start`'s own comment) with the date and the reasoning, per the plan's explicit instruction that no surviving line contradict the new behavior.
- `grant_from_spare()`'s probe-then-grant loop reuses `signal_recorded_pid()` from Task 1 rather than a second kill implementation — one identity-checked signal path for the whole file.
- Test fixtures needing a "live" fake supervisor (Task 1's shutdown/stop tests, Task 3's SIGHUP gate) use a real spawned process that traps signals and sleeps, not a bare `exit 0` stub — the identity check and the "is it actually still alive" assertions need a genuinely live pid to be meaningful.
- `vice-pool.test.mjs`'s three new Task 3 tests anchor their script paths on this file's own directory (`HERE`), not `repoRoot()` — `repoRoot()` prefers `CONTAINER_WORKSPACE_PATH` when it is an ancestor of the resolving directory, which is true by plain string prefix for any worktree nested under the main workspace, so it would have silently resolved to the main repo's checkout instead of this worktree's own locally-modified scripts. This was caught by two test failures during execution and fixed before the final commit; see Deviations.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `repoRoot()`-anchored test paths in three new Task 3 tests resolved to the wrong repo**
- **Found during:** Task 3, first test run
- **Issue:** The SIGHUP gate and its two structural companion tests were written using `join(repoRoot(), ".claude", "mcp", "vice", "resources", ...)`, matching an existing pattern elsewhere in the same file. But `repoRoot()` resolves via `CONTAINER_WORKSPACE_PATH` when that env var is an ancestor of the resolving directory — true by plain string prefix for this worktree, nested under the main workspace — so it silently pointed at the main repo's (unmodified) `vice-supervisor.sh`/`vice-pool.sh` instead of this worktree's own edited copies. The structural EXIT/HUP assertion failed outright (main repo's copy predates Task 3's trap rewrite) and the SIGHUP gate timed out.
- **Fix:** Added a `HERE` constant (`dirname(fileURLToPath(import.meta.url))`, matching `vice-broker.test.mjs`'s own `BROKER_SCRIPT` pattern) and re-anchored all three new tests on it instead of `repoRoot()`.
- **Files modified:** `.claude/mcp/vice/vice-pool.test.mjs`
- **Verification:** All three tests pass after the fix; the pre-existing `repoRoot()`-anchored path-agreement tests (which are legitimately about `repoRoot()`'s own resolution) were left untouched and still pass.
- **Committed in:** `b1eb8cb` (Task 3's own commit — caught and fixed before commit, not a separate follow-up)

**2. [Rule 1 - Bug] `grant_from_spare()`'s new grant-time probe broke three pre-existing tests using fake "ready" spare fixtures**
- **Found during:** Task 2, first full suite run after implementing the probe
- **Issue:** `kill-never-recycle`, the id-validation `parity` test, and the malformed-request-skipping test all pre-plant a `state: "ready"` spare record directly (bypassing a real launch) with no real listener behind the port, and none of them set `VICE_BROKER_PROBE_CMD`. Once `grant_from_spare()` started probing before granting, these fell back to the default curl-based probe, which genuinely failed against the fake fixture (nothing listening), and the grant these tests expected never appeared.
- **Fix:** Gave each an `alwaysSucceedProbe()` stub via `probeCmd`, with a comment explaining these tests are about kill-never-recycle / id-parity / malformed-request-skipping specifically, not the grant-time probe (which has its own dedicated tests).
- **Files modified:** `.claude/mcp/vice/vice-broker.test.mjs`
- **Verification:** All three tests pass with the stub; the new dedicated grant-time-probe test (`grant_from_spare: with two ready spares and a probe that fails only for the lower port...`) covers the probe behavior itself.
- **Committed in:** `345411b` (Task 2's own commit)

**3. [Rule 1 - Bug] Two new Task 2 tests used request ids that failed the shell script's own id-shape validation**
- **Found during:** Task 2, second full suite run
- **Issue:** The new `process_requests` in-flight test and the new `grant_from_spare` two-candidate-probe test used ids like `req-qpq-t2-7716-eeeeeeee`, which do not match `REQUEST_ID_PATTERN` (`^req-[0-9]+-[0-9]+-[0-9a-f]{8}$` — the middle two segments must be pure digits). The broker correctly skipped these as invalid, so the tests' own assertions (which depended on the request actually being processed) failed for a reason unrelated to what they were testing.
- **Fix:** Renamed the ids to the numeric-segment shape already used throughout the rest of the suite (`req-20-7716-eeeeeeee`, `req-21-7727-ffffffff`).
- **Files modified:** `.claude/mcp/vice/vice-broker.test.mjs`
- **Verification:** Both tests pass after the rename.
- **Committed in:** `345411b` (Task 2's own commit)

---

**Total deviations:** 3 auto-fixed (all Rule 1 — bugs in the newly-written test code itself, caught by running the suite before committing). None required a plan or design change; all are test-authoring corrections within the scope of Tasks 2 and 3.

## Issues Encountered

None beyond the three deviations above, all caught and fixed within the same task's own test-run-before-commit cycle. No host-side VICE access was needed or attempted — every gate in this plan runs entirely inside this container via `--dry-run`/`--once`/stub-supervisor seams, exactly as the plan's own `<context>` section requires.

## User Setup Required

**Host validation is required before trusting this on the host — it cannot be run in this container.** The plan's own `<verification>` section specifies the exact procedure; repeating the load-bearing parts here:

1. **Force-refresh the deployed copies FIRST, on the host.** The host's `tools/vice-broker.sh` (and supervisor/pool) will be *diverged* from the tracked `resources/` sources after this change merges, and `installResources()` never overwrites a diverged target unless forced. Skipping this step means every result below validates the OLD script, not this one. From the host workspace:
   ```
   node -e "import('./.claude/mcp/vice/install-resources.mjs').then(m => console.log(m.installResources({ root: process.cwd(), force: true })))"
   ```
   (or trigger it via any of the vice MCP's own `.mjs` entry points, which call `ensureResourcesInstalled()` — but that alone will NOT force an overwrite of an already-diverged target; the explicit `force: true` call above is the one that matters here.)
2. `tools/vice-broker.sh start 1` — confirm `broker.json` records `"spares_target": 1` and that exactly one x64sc appears, not three.
3. With the daemon running, `pgrep -a x64sc`, then Ctrl-C the broker. Confirm every x64sc is gone and that `spares/`, `grants/`, `requests/`, `leases/`, `broker.json` and `broker-instances.json` are gone from `.vice-supervisor/`.
4. Start it again, note the x64sc pid, `kill -9` the broker (the case no trap can catch), then `tools/vice-broker.sh stop` with no broker process alive. Confirm it reports the reap and that the orphaned x64sc is gone — this is the exact `req-832` ghost-grant failure this plan closes.
5. Start it again with `VICE_BROKER_SPARES=3` and watch `supervisor.log`: the spawn timestamps must be staggered, one boot completing before the next begins, and all three must survive. Three deaths at an identical spawn second means the serialisation did not take effect.
6. `VICE_BROKER_BASE_PORT` clear of `127.0.0.1:6511` (held by VS Code) is a separate, deliberately out-of-scope configuration choice — recorded in the original todo, not addressed here.

**What was verified in-container vs. what still needs host validation:**
- **Verified in-container:** every shutdown/reap/purge code path, start-time ghost-record dropping, serialised warming (via stub probes, no real x64sc), grant-time probing, the supervisor/pool trap rewrites (via a `/bin/sleep` stand-in, never real x64sc), and CLAUDE.md's doc-gate constraints — 182 tests green across the full plan-level verification list.
- **NOT verified anywhere yet:** real x64sc behavior under this code — that three staggered (not simultaneous) launches actually all survive on real hardware, that a real crash-loop give-up still exits 4 through the new supervisor EXIT handler, and that a real `kill -9` + `stop` sequence reaps a real orphaned x64sc. All of this requires the host procedure above.

## Known Stubs

None. Every function has a real implementation; the container-side limitation (no x64sc available) is a property of the execution environment, not a stub left in the code — the plan's own `<context>` section states this explicitly as a hard constraint, not a gap to close later.

## Threat Flags

None beyond what the plan's own `<threat_model>` already covers (T-qpq-01 through T-qpq-04, T-qpq-SC — all `mitigate` or `accept` dispositions addressed directly in the implementation: the `ps -o args=` identity check before every signal, `purge_protocol_state()`'s already-resolved-variable-only removal, the bounded SIGTERM-then-SIGKILL wait, and the unchanged 0600 file-mode posture).

## Next Phase Readiness

- This closes defects 1 (parallel spare warming), 2 (stale `usage()` text), 3 (grants outliving their process), and 5 (no shutdown cleanup) from `.planning/todos/pending/2026-08-01-vice-broker-spare-warming-and-stale-grant-defects.md`.
- **Defect 4 — the container-side proxy caching a dead grant for the whole session, with no re-request path — is explicitly OUT OF SCOPE and remains open.** It lives in the proxy (`vice-proxy.mjs`), not in these host shell scripts, and this plan never touched it. The original todo entry stays in `.planning/todos/pending/` unresolved for defect 4; do not close that file until defect 4 has its own plan.
- Resuming Phase 1's emulator-heavy plans (01-04 and beyond) should wait for host validation of this change per the procedure above — the whole reason this quick task exists is that the previous incident cost plan 01-04 its second halt, and an unvalidated shutdown/serialisation change carries the same risk if it doesn't actually work on real hardware.

---
*Task: 260801-qpq*
*Completed: 2026-08-01*

## Self-Check: PASSED

All 6 modified files confirmed present on disk (`vice-broker.sh`, `vice-supervisor.sh`, `vice-pool.sh`, `vice-broker.test.mjs`, `vice-pool.test.mjs`, `CLAUDE.md`), plus this SUMMARY.md itself. All 3 task commits (`d57f53b`, `345411b`, `b1eb8cb`) confirmed present in `git log`. Full plan-level verification list (182 tests across `vice-broker.test.mjs`, `vice-pool.test.mjs`, `skill-docs.test.mjs`, `vice-mcp-selector-docs.test.mjs`, `vice-broker-client.test.mjs`, `vice-proxy.test.mjs`) re-run clean immediately before this check, plus `bash -n` on all three shell scripts and the two `grep`-based durable-doc gates (`mcp__vice__` present, retired-skill-name absent).
