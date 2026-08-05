---
type: defect
severity: minor
area: vice-mcp-tests
files:
  - .claude/mcp/vice/vice-proxy.test.ts
found: 2026-08-05
found_by: quick-260805-fix-epoch-and-flake, during its own three-run verification of an unrelated flake fix (broker-kill.test.ts)
---

# `vice-proxy.test.ts` was cancelled once under full-suite load with "Promise resolution is still pending but the event loop has already resolved"

**Not one of this task's two assigned defects** -- filed as a new, previously-unreported
observation rather than fixed inline, per this project's own scope-boundary rule (only auto-fix
issues directly caused by the current task's changes).

## What happened

Running the full suite (`node --test '.claude/mcp/vice/'*.test.ts`, 27 files) three times in a
row to verify the banner-ordering flake fix (see the sibling todo,
`2026-08-05-broker-kill-banner-ordering-test-is-flaky-under-full-suite-load.md`):

- **Run 1:** `tests 423 / pass 417 / fail 0 / cancelled 1 / todo 5`, with a top-level failure:
  ```
  ✖ .claude/mcp/vice/vice-proxy.test.ts (113293.016669ms)
    'Promise resolution is still pending but the event loop has already resolved'
  ```
  The `⚠` markers on `vice-proxy.test.ts`, `vice-sync.test.ts` and `vice.test.ts` together, and
  the reduced total (423 vs. the expected 444 once this task's own 2 new tests are counted),
  suggest the cancellation in `vice-proxy.test.ts` prevented `vice-sync.test.ts` and
  `vice.test.ts` -- both later in the glob's alphabetical order -- from completing their own
  runs, not just `vice-proxy.test.ts` itself.
- **Run 2:** `tests 444 / pass 439 / fail 0 / cancelled 0 / todo 5` -- clean, full expected count.
- **Run 3:** `tests 444 / pass 439 / fail 0 / cancelled 0 / todo 5` -- clean, full expected count.

Two clean runs immediately after the one cancelled run, with byte-identical code, strongly
suggests this is an environment/resource-load flake (27 test files' worth of real spawned
children, real TCP servers and real sockets, all running concurrently under `node --test`'s
default per-file concurrency) rather than a logic bug in a specific assertion -- the same general
failure *class* the sibling banner-ordering todo already documents ("the third concurrency-shaped
problem found in this suite this week"), but a different symptom (a whole file failing to settle
its event loop, rather than one assertion racing a specific pair of writes) and a different file.

## Why this is filed rather than fixed here

This task's remit was exactly two filed defects (the epoch-drift/replacement-message wording, and
the broker-kill.test.ts banner-ordering flake). `vice-proxy.test.ts`'s own two new tests added by
this same task (the equal-epoch/same-port `machineReplacedMessage()` test, and the
stale-epoch-persists-null `finaliseIncidentRecord()` test) were verified clean in isolation, in
combination with `incident-record.test.ts`, and via `--test-name-pattern` targeting exactly the
two new tests -- all passing, all before this cancellation was first observed. The cancellation
was ONLY seen in a full 27-file concurrent run, never in any narrower run, which is consistent
with a resource-contention flake rather than a defect in the new tests' own logic -- but that is
an inference from absence, not a diagnosis. A genuine root-cause investigation (which specific
test in `vice-proxy.test.ts` leaves a handle/socket/timer open under load, or whether it is
`node --test`'s own per-file worker accounting under contention) is out of scope for this task.

## Fix direction for whoever picks this up

- Re-run the full suite several times (5-10) to establish a baseline flake rate -- this task only
  had 1-in-3.
- If it reproduces, bisect by running progressively larger subsets of the 27 files together
  (rather than the whole glob) to find the minimum concurrent set that reproduces it -- this
  narrows whether it's `vice-proxy.test.ts` in isolation under CPU pressure, or a genuine
  resource collision with a SPECIFIC other file (e.g. two files independently reserving what
  they each believe is a free ephemeral port, or file-descriptor exhaustion from ~27 files' worth
  of real child processes and TCP listeners all live at once).
- `node --test`'s own diagnostics (`--test-reporter=tap`, or running with
  `NODE_DEBUG=stream,net`) may narrow which specific handle stays open.
- Same discipline as the sibling banner-ordering fix: prefer a causal fix (find and close the
  actual leaked handle) over widening a timeout or retrying -- a retried assertion here would
  hide the same class of problem the sibling todo already refused to paper over.
