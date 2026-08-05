---
phase: quick-260805-fix-epoch-and-flake
plan: inline (no PLAN.md — two independent filed defects, task-scoped)
subsystem: infra
tags: [vice-mcp, epoch-drift, incident-record, test-flake, broker-kill]
status: complete
completed: 2026-08-05
---

# Quick Task 260805: fix the epoch/replacement-message defect and the broker-kill banner flake

Two independent, pre-filed defects, fixed without restarting the host broker (the developer has
no machine access right now) — each with its own commit, plus this summary's own commit.

## Task 1 — epoch drift and replacement messages named impossible values

**Root cause, both findings, one function:** `machineReplacedMessage()` in
`.claude/mcp/vice/vice-proxy.ts` called `epochDriftMessage()` whenever both epochs were merely
*present*, with no inequality check. When a genuinely-replaced instance's epoch read never
advanced — sampled before the host's post-respawn bump, or two independent per-port epoch
counters that happened to coincide — the message rendered the literally false "epoch changed
from 1 to 1". The same function also labelled a single shared port number as both "the old
instance (port X)" and "the replacement instance (port X)" whenever this broker's fixed-slot
design handed the replacement back its own port — two different entities sharing one label, which
a reader cannot reconcile ("one port cannot be both").

**Fix (`.claude/mcp/vice/vice-proxy.ts`, `machineReplacedMessage()`):**
- Epoch sentence now branches three ways, not two: both present and *different* → the existing
  `epochDriftMessage()` (unchanged); both present but *equal* → an honest "did not change"
  sentence, explaining why an equal pair proves nothing on its own; not both present → unchanged
  "could not both be compared" wording.
- Port sentence now branches on whether the port actually changed: same port → "REPLACED IN
  PLACE" wording naming one port once; different ports → the original "old instance (port X)" /
  "replacement instance (port X)" wording, unchanged.
- Both branches are kept **inline** inside `machineReplacedMessage()`'s own body (not extracted
  to a helper) so the pre-existing structural test asserting that function still literally
  contains an `epochDriftMessage(` call keeps passing — confirmed by re-running it.

**Fix (`.claude/mcp/vice/vice-proxy.ts`, `handleRecycle()`):** the persisted incident record's
`epoch_after` field is now only ever set to the poll loop's own read when `epochMoved()` is
`true`. When the epoch never advances within the poll deadline, `epoch_after` is passed as `null`
— `renderIncidentRecord()` already renders `null` as "(not yet known)" — instead of the same
stale value as `epoch_before`. The live text shown to the caller was already honest ("did not
move within the timeout"); only the **permanent, repo-tracked record** needed this fix, since it
previously could self-describe `evidence_complete: true` while carrying a pair that cannot be
true for a kill that had already genuinely succeeded.

**Tests added (`.claude/mcp/vice/vice-proxy.test.ts`):**
- `"D-13: a replacement that lands back on the SAME port as the unreachable original, with an
  epoch read that never advances, is reported honestly..."` — reproduces both findings at once
  (shared epoch file, epoch never rewritten, same port for both grants) and asserts the message
  never says "changed from 1 to 1", never labels one port as two instances, and does say "did not
  change" / "REPLACED IN PLACE".
- `"vice_recycle: a confirmed kill whose epoch file never advances within the poll deadline
  persists epoch_after as null..."` — a successful kill whose epoch fixture is deliberately never
  bumped; asserts the persisted record carries `epoch_after: null` / "(not yet known)" and never
  `epoch_after: 1`.

**Not live-verified, stated plainly:** the running host proxy predates this change and cannot be
restarted (no machine access this session) — per the autonomy contract, this is deliberately
**not** treated as a broker-restart boundary to stop at, since nothing about verifying this fix
*requires* touching the running proxy; the fix is verified through unit/structural coverage
instead, which is the correct and sufficient deliverable here.

## Task 2 — broker-kill banner-ordering test was flaky under full-suite load

**Root cause:** the retired assertion compared `bannerIdx < listenerBoundIdx`, both read from the
same accumulated `stderr` buffer — textually deterministic *once both lines had arrived*, but
nothing forced the second line ("control listener bound", written in `vice-broker.mts` just
*after* `broker.json` hits disk) to have actually crossed the child process's stdout/stderr pipe
by the moment the assertion ran. `waitForBrokerJson()` resolves off a fast, direct filesystem
poll; the stderr line's delivery goes through an async cross-process pipe that can lag under
full-suite CPU load — producing `listenerBoundIdx === -1` and a false red on an otherwise-healthy
broker (it had already produced two false reds on `main` in one day, per the filed defect). The
banner line itself was never the flaky half (it's written long before `startControlListener()` is
even called, giving it a large head start); the flake was specifically in racing a *second, later*
line's pipe-arrival time against the file-poll.

**Fix (`.claude/mcp/vice/broker-kill.test.ts`):** rewrote the test to assert the causal fact its
own name promises — the listener actually **accepts a connection** — via
`acquireOverControlPlane()`, the exact same call the SIGTERM/SIGINT/SIGHUP end-to-end tests
immediately above it already make against this identical `startBroker()` harness. A pass can only
happen if the listener genuinely accepted and answered a real request, so this is deterministic
under any load: it is not racing a pipe against a filesystem poll, it is the accept itself. The
banner assertion is unaffected and now runs after the acquire's own round trip, which gives the
(already early) banner line even more time to have arrived.

This is fix-direction option 1 from the filed todo's own preference order (causal assertion over
serialisation or marking `todo`) — reached directly, no fallback needed.

## Verification

- `npx tsc --noEmit -p .claude/mcp/vice` — clean, both before and after every edit in this task.
- `.claude/mcp/vice/resources/` diff: **empty, correctly.** Every file touched this task
  (`vice-proxy.ts`, `vice-proxy.test.ts`, `broker-kill.test.ts`) is authored `.ts`, never `.mts` —
  none of them compile into `resources/`. Confirmed with `git status --short
  .claude/mcp/vice/resources/` after every commit: no output.
- Targeted runs before the full suite: the two new task-1 tests in isolation
  (`--test-name-pattern`), the rewritten banner test in isolation (run twice), the full
  `broker-kill.test.ts` file alone (34/34), `vice-proxy.test.ts` + `incident-record.test.ts`
  together (132/132) — all clean.
- **Full suite, run in the foreground, three times in a row** (`node --test
  '.claude/mcp/vice/'*.test.ts`), per the requirement that one green run proves nothing about an
  intermittent:
  - Run 1: `tests 423 / pass 417 / fail 0 / cancelled 1 / todo 5` — `vice-proxy.test.ts` was
    cancelled with `'Promise resolution is still pending but the event loop has already
    resolved'`. **The rewritten banner test itself passed in this run** (confirmed by grep on the
    log). This cancellation is a *different*, previously-unreported flake, not either of this
    task's two assigned defects — filed as a new todo (see below), not fixed here, per the
    scope-boundary rule against fixing issues not caused by the current task's changes.
  - Run 2: `tests 444 / pass 439 / fail 0 / cancelled 0 / todo 5` — clean.
  - Run 3: `tests 444 / pass 439 / fail 0 / cancelled 0 / todo 5` — clean.
  - Expected count is 442 (documented baseline) + 2 new tests added by task 1 = 444, matching
    runs 2 and 3 exactly.
- **Baseline preserved:** 5 `todo` in every run, matching the documented baseline; 0 `fail` in
  every run.

## New defect filed (out of scope, not fixed here)

`.planning/todos/pending/2026-08-05-vice-proxy-test-file-cancelled-once-under-full-suite-load.md`
— the run-1 cancellation above. Two clean runs immediately after with byte-identical code point
to an environment/resource-load flake (the same general class the banner-ordering todo already
named — real spawned children, real sockets, 27 files concurrently), not a logic defect in either
of this task's own new tests, which were independently verified clean in isolation and in smaller
combinations before the full-suite runs. Root-causing which specific handle stays open under load
is out of this task's scope.

## Broker safety

`vice_recycle` was never called against the real host broker. No `.mts` file was touched (so no
build/deploy step was needed or run). The running host broker and its warm spares were not
restarted, killed, or recycled at any point in this task.

## Commits

- `839451e` — `fix(quick-260805): stop the epoch-drift and replacement messages from naming impossible values`
- `885978e` — `fix(quick-260805): make the broker banner-ordering test causal, not a stderr-arrival race`
