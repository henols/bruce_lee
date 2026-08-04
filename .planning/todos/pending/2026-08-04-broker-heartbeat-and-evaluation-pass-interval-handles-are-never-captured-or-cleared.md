---
created: 2026-08-04T00:00:00.000Z
title: vice-broker.mts's heartbeat and evaluation-pass setInterval handles are never captured or cleared — blocks any future in-process test harness
area: infra
severity: minor
files:
  - .claude/mcp/vice/vice-broker.mts:595-632
---

## Why this is filed rather than fixed

A developer decision at 01.6.2's gap-closure planning gate (2026-08-03/04, the four plans that
became `01.6.2-12` through `01.6.2-15`) scoped that gap-closure work to the four verification-report
gaps (CR-01, CR-02, the recycle-ledger correction, WR-01) plus two of the four review warnings
(WR-01, WR-03). This defect is `01.6.2-REVIEW.md`'s **WR-04**, one of the two review warnings that
decision left open deliberately — not an oversight, and not something anyone attempted to fix as
part of that gap closure. This todo is the durable record of that deliberate exclusion, filed
because the phase's own artifacts (`01.6.2-REVIEW.md`, `01.6.2-VERIFICATION.md`) are archived at
milestone completion and a defect recorded only inside one of them is a defect lost at that
boundary.

## File and region

`.claude/mcp/vice/vice-broker.mts`, inside `run()`, currently around lines 595–632 — the two
`setInterval(...)` calls that drive the heartbeat refresh and the periodic `runBrokerPass` tick.

## Current behaviour, and why it is wrong

Both `setInterval` calls' return values (the interval handles `NodeJS.Timeout` would normally give
you) are discarded — not assigned to any variable, not stored on `state` or any other object
reachable from `shutdown()`/`registerShutdownHandlers()` (`.claude/mcp/vice/broker-kill.mts`). Two
long-lived, recurring timers are therefore created with no way for any later code, in this process
or a caller of `run()`, to ever call `clearInterval()` on either of them.

## Consequence, evaluable without the review report

In the real, deployed broker process this is harmless: every catchable teardown path
(`shutdown()`, an uncaught exception, a normal exit) ends by calling `process.exit()`, which tears
down the whole process — including both intervals — regardless of whether they were ever explicitly
cleared. Nothing observable breaks today.

The consequence is forward-looking: any future caller that imports and invokes `run()`
**programmatically**, rather than launching the emitted artifact as a subprocess — for example an
in-process integration test harness that wants to start a broker, exercise it, and then stop it
cleanly without killing the whole Node process the test runner itself is using — has no way to stop
these two loops short of terminating the entire process. That forecloses a class of test
infrastructure (in-process broker start/stop) that would otherwise be strictly cheaper than the
current subprocess-spawning `broker-e2e.test.ts` pattern.

## Proposed fix

Capture both `setInterval(...)` return values into local variables (or fields on a returned handle
object), and call `clearInterval()` on both inside `shutdown()`'s teardown sequence
(`.claude/mcp/vice/broker-kill.mts`), guarded the same way the existing `process.exit()` call is
guarded by `usingRealProcess` — so real-process behaviour (which relies on `process.exit()` reclaiming
everything, and must keep doing exactly that) is completely unchanged, while a future in-process
caller gains a clean, exit-free way to stop both loops.

## Untested today, and what a test would assert

No existing test names either interval or exercises stopping `run()` without process exit
(confirmed by `01.6.2-REVIEW.md`'s own WR-04 finding). A test for this fix would assert: after
calling `run()` in-process (not as a subprocess) and then invoking the new clean-stop path, both
`setInterval` timers are provably no longer firing (e.g. no further heartbeat write and no further
`runBrokerPass` tick observed after a short wait), and the real-process exit path
(`usingRealProcess: true`) still calls `process.exit()` exactly as before, unaffected by the new
guarded `clearInterval()` calls.
