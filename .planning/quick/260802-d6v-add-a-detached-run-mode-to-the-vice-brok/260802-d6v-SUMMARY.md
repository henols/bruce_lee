---
phase: quick-260802-d6v
plan: 01
subsystem: infra
tags: [bash, vice-broker, setsid, daemon, signal-handling]

requires: []
provides:
  - "vice-broker.sh start --detach: re-execs the broker under setsid, leaving the invoking
    terminal's session and process group, appending stdout/stderr to VICE_BROKER_LOG, and
    printing the daemon's pid and log path before returning"
  - "A foreground start (no --detach) warns loudly on stderr naming Ctrl-C, other agents'
    live sessions, and --detach as the remedy"
  - "--detach rejected with exit 1 on stop, on status, and in combination with --once"
  - "stop still terminates a detached broker and reaps every instance it tracked, proven by
    a real test rather than asserted in prose"
affects: [vice-broker.sh, vice-supervisor.sh, vice-mcp maintenance work]

tech-stack:
  added: []
  patterns:
    - "Two independent recursion guards for a self-re-exec: an env marker consumed at parse
      time (VICE_BROKER_DETACHED_CHILD) plus filtering the triggering flag out of the
      relaunch argv -- either alone is sufficient, both exist because they fail differently."
    - "A daemon's own stdio release for detachment: redirect stdin from /dev/null and
      stdout/stderr appended (>>, never >) to a log, backgrounded under setsid without
      --fork so $! is the authoritative pid."

key-files:
  created: []
  modified:
    - .claude/mcp/vice/resources/vice-broker.sh
    - .claude/mcp/vice/vice-broker.test.mjs
    - .planning/todos/completed/2026-08-02-vice-broker-has-no-detached-run-mode.md

key-decisions:
  - "The reap-on-signal contract (broker_shutdown(), cmd_stop()) was left byte-unchanged on
    purpose -- this task changes WHICH SIGNALS CAN REACH the broker, never what it does
    when one arrives."
  - "No short -d form for --detach (the existing -* catch-all already errors cleanly), and
    --detach does not refuse to start when a broker is already recorded -- both discretion
    calls the plan pre-authorized."
  - "Fixed a pre-existing latent bug found while implementing Task 1: usage()'s heredoc was
    unquoted (<<USAGE), so backticks and $-expansions in its literal help text were
    evaluated by bash whenever --help actually ran (never previously exercised by a test).
    Quoted the delimiter (<<'USAGE') so the text prints literally -- a Rule 3 blocking fix,
    since my own --help test could not pass otherwise."

patterns-established:
  - "Detach tests use t.after(() => reapDetached(dir, ref)) registered before anything that
    can throw, with an explicit { timeout: 30000 }, killing by recorded pid with a
    broker.json-pid fallback, and asserting the pid is gone -- the mandatory cleanup shape
    for any future test that starts a genuinely detached, long-lived process."

requirements-completed: [TODO-BROKER-DETACH]

coverage:
  - id: D1
    description: "start --detach re-execs under setsid, returns promptly, prints pid + log path"
    requirement: "TODO-BROKER-DETACH"
    verification:
      - kind: integration
        ref: "vice-broker.test.mjs#start --detach: the promise resolves promptly, announces a live pid and log path, the child does not recurse, and a second run appends"
        status: pass
    human_judgment: false
  - id: D2
    description: "Detached daemon is a genuine session leader (ps -o sid= differs from the caller's)"
    requirement: "TODO-BROKER-DETACH"
    verification:
      - kind: integration
        ref: "vice-broker.test.mjs#start --detach: the detached daemon is a genuine session leader, in a DIFFERENT session than the test runner"
        status: pass
    human_judgment: false
  - id: D3
    description: "Foreground start warns on stderr naming Ctrl-C, other agents' sessions, and --detach"
    requirement: "TODO-BROKER-DETACH"
    verification:
      - kind: integration
        ref: "vice-broker.test.mjs#start (foreground, no --detach): warns on stderr naming Ctrl-C, other agents' sessions, and --detach, before it starts polling"
        status: pass
    human_judgment: false
  - id: D4
    description: "--detach refused with exit 1 on stop, on status, and combined with --once"
    requirement: "TODO-BROKER-DETACH"
    verification:
      - kind: unit
        ref: "vice-broker.test.mjs#--detach with --once exits 1 and stderr names both flags, for both the explicit 'start' spelling and the bare-subcommand spelling"
        status: pass
      - kind: unit
        ref: "vice-broker.test.mjs#--detach is refused on 'stop' and on 'status', each naming 'start' as the only valid subcommand"
        status: pass
    human_judgment: false
  - id: D5
    description: "stop still reaps a detached broker (terminates it, purges protocol state), and the log survives the purge"
    requirement: "TODO-BROKER-DETACH"
    verification:
      - kind: integration
        ref: "vice-broker.test.mjs#stop reaps a detached broker: this is the reap-on-signal contract proven against a detached broker, not asserted in prose -- and the log survives the purge"
        status: pass
    human_judgment: false
  - id: D6
    description: "Recursion cannot occur -- two independent guards, proven by the absence of the parent-only announcement in the child's own log"
    requirement: "TODO-BROKER-DETACH"
    verification:
      - kind: integration
        ref: "vice-broker.test.mjs#start --detach: the promise resolves promptly, announces a live pid and log path, the child does not recurse, and a second run appends"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-08-02
status: complete
---

# Quick Task 260802-d6v: Detached run mode for the VICE broker Summary

**Added `start --detach` (setsid re-exec, session-leader detachment, append-only log) plus a loud foreground Ctrl-C warning to `vice-broker.sh`, closing the major defect where any signal to the broker's terminal destroyed every live session's emulator instance.**

## Performance

- **Duration:** ~15 min (commits span 09:49–09:55 UTC, plan authored 09:42 UTC)
- **Started:** 2026-08-02T09:42:54Z
- **Completed:** 2026-08-02T09:55:31Z
- **Tasks:** 3
- **Files modified:** 3 (`vice-broker.sh`, `vice-broker.test.mjs`, the archived todo)

## Accomplishments

- `start --detach` re-execs the broker under `setsid`, leaving the invoking terminal's
  session and process group entirely, appends stdout/stderr to `VICE_BROKER_LOG`
  (default `<pool dir>/broker.log`, append-only, matches no protocol glob, survives
  `purge_protocol_state()`), and prints the daemon's pid and log path before returning.
- Two independent recursion guards protect against an unbounded host-side fork: the
  `VICE_BROKER_DETACHED_CHILD` env marker consumed at parse time, and `--detach` filtered
  out of the relaunch argv. Proven behaviourally — the parent-only announcement string is
  asserted absent from the detached child's own log.
- A foreground `start` (no `--detach`) now warns loudly on stderr, naming Ctrl-C, other
  agents' live sessions dying, and `--detach` as the remedy.
- `--detach` is refused with exit 1 on `stop`, on `status`, and combined with `--once`.
- `stop` still terminates a detached broker and reaps every instance it tracked — proven by
  a test that starts a real detached broker and confirms `broker.json`'s own recorded pid
  matches the pid the parent printed (which also confirms `setsid` did not fork out from
  under `$!`).
- The reap-on-signal contract (`broker_shutdown()`, `cmd_stop()`, the
  `trap broker_shutdown EXIT HUP INT TERM` line) is byte-unchanged, confirmed via `git diff`
  against the pre-task baseline showing zero lines touched in either function body.
- The originating todo is archived to `completed/` with its stale `files:` frontmatter
  (`tools/vice-broker.sh`, `tools/vice-supervisor.sh` — gitignored generated copies with no
  git history) corrected to the tracked canonical script and its test file.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the --detach flag, its two rejections, the recursion marker's consumption, the VICE_BROKER_LOG knob and the usage documentation** - `7c5a700` (feat)
2. **Task 2: Re-exec under setsid between drop_dead_instance_records and the trap install, and add the foreground Ctrl-C warning** - `a85a503` (feat)
3. **Task 3: Prove stop still reaps a detached broker, run the full sweep, and archive the todo with its stale files: path corrected** - `7bc9712` (test)

_No TDD RED/GREEN split was used — each task's tests and implementation landed together per the plan's `tdd="true"` task type, which in this plan meant "tests plus implementation in one task commit," not a separate test-then-code cycle._

## Files Created/Modified

- `.claude/mcp/vice/resources/vice-broker.sh` - Added `--detach` flag parsing, the
  `VICE_BROKER_DETACHED_CHILD` recursion-guard consumption, the `--detach`+`--once`/`stop`/`status`
  rejections, the `VICE_BROKER_LOG` config knob, the `usage()` documentation for both, the
  `ORIGINAL_ARGV` capture, the `setsid` re-exec block in `cmd_start()`, and the foreground
  Ctrl-C warning. Also fixed a pre-existing unquoted-heredoc bug in `usage()`.
- `.claude/mcp/vice/vice-broker.test.mjs` - Added `startDetached()`/`reapDetached()` shared
  test helpers and seven new tests covering the parse surface, the re-exec's correctness,
  the foreground warning, and `stop`'s reap of a detached broker.
- `.planning/todos/completed/2026-08-02-vice-broker-has-no-detached-run-mode.md` - Archived
  from `pending/`; `files:` frontmatter corrected, prose left byte-unchanged.

## Decisions Made

- The reap-on-signal contract stays exactly as `260801-qpq` designed it — this task is a
  deployment-shape change (which signals reach the broker), never a shutdown-policy change
  (what it does when one arrives). Verified structurally (`git diff` shows zero touched lines
  in `broker_shutdown()`/`cmd_stop()`) and behaviourally (Task 3's test starts a real detached
  broker and proves `stop` still reaps it).
- No short `-d` form for `--detach`, and `--detach` does not add an already-running-broker
  guard — both were pre-authorized discretion calls in the plan's `<constraints>`, not
  independently decided here.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed unquoted heredoc in `usage()` that broke `--help`**
- **Found during:** Task 1, while adding the `--help` documentation test
- **Issue:** `usage()`'s heredoc was `cat <<USAGE` (unquoted delimiter), so bash performed
  command substitution and variable expansion inside its literal help text. Every backtick
  in the existing prose (e.g. `` `stop` ``, `` `start` ``) was interpreted as a command
  substitution, and `"$VICE_BROKER_PROBE_CMD" "$port"` was expanded against `set -u` before
  those variables exist at that point in the script — both causing `--help` to exit non-zero
  with `command not found` / `unbound variable` errors instead of printing text. This was a
  pre-existing latent bug (confirmed via `git stash` against the unmodified tree at the same
  commit) that no prior test had ever triggered, because no test invoked `--help` via real
  bash execution before this task's own `<behavior>` requirement to do so.
- **Fix:** Quoted the heredoc delimiter (`cat <<'USAGE'`), so all `` ` `` and `$` in the help
  text print literally. No functional change to any other subcommand.
- **Files modified:** `.claude/mcp/vice/resources/vice-broker.sh`
- **Verification:** `bash vice-broker.sh --help` now exits 0 and prints the full usage text;
  the new `--help` test passes.
- **Committed in:** `7c5a700` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The fix was necessary for the plan's own Task 1 `<behavior>` requirement
("`--help` output names `--detach` and `VICE_BROKER_LOG`") to be testable at all. No scope
creep — the fix is a one-line delimiter change with no effect on any subcommand's runtime
behavior.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The detached run mode is in place and tested; a future session can run
  `tools/vice-broker.sh start --detach` on the HOST to avoid the foreground-Ctrl-C blast
  radius that halted plan 01-04.
- Out of scope, unresolved, and explicitly not this task's concern: the `$07DE` silent host
  stall blocking 01-04 (needs `/gsd-debug` and live emulator work), and Defect 4 (the proxy
  caching a dead grant with no re-request path) in
  `.planning/todos/pending/2026-08-01-vice-broker-spare-warming-and-stale-grant-defects.md`.
- The deployed copy at `tools/vice-broker.sh` (gitignored) will pick up these changes the
  next time any `.claude/mcp/vice/*.mjs` entry point triggers `install-resources.mjs`'s
  copy-if-missing check — no manual action needed, but also not automatically refreshed if
  a stale copy already exists there.

---
*Phase: quick-260802-d6v*
*Completed: 2026-08-02*

## Self-Check: PASSED

- FOUND: `.claude/mcp/vice/resources/vice-broker.sh`
- FOUND: `.claude/mcp/vice/vice-broker.test.mjs`
- FOUND: `.planning/todos/completed/2026-08-02-vice-broker-has-no-detached-run-mode.md`
- FOUND: `.planning/quick/260802-d6v-add-a-detached-run-mode-to-the-vice-brok/260802-d6v-SUMMARY.md`
- CONFIRMED GONE: `.planning/todos/pending/2026-08-02-vice-broker-has-no-detached-run-mode.md`
- FOUND commit: `7c5a700`
- FOUND commit: `a85a503`
- FOUND commit: `7bc9712`
