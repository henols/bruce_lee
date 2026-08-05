---
type: defect
severity: minor
area: vice-mcp-tests
files:
  - .claude/mcp/vice/broker-kill.test.ts
found: 2026-08-05
found_by: orchestrator, during 01.6.2.1/01.6.3/01.4 verification runs
---

# `broker-kill.test.ts`'s banner-ordering test fails intermittently under full-suite load

**The test:** "end-to-end: the broker prints its start-time banner on stderr before broker.json (and
therefore before the listener accepts)".

**Behaviour:** fails occasionally in a full-suite run (`node --test '.claude/mcp/vice/'*.test.*`),
passes reliably in isolation. Measured 2026-08-05: **34/34 pass** running `broker-kill.test.ts` alone,
immediately after a full-suite run in which it was the sole failure; the very next full-suite run was
**442/437/0 fail**.

**Why it is worth fixing rather than tolerating.** It has produced a **false red on `main`** at least
twice in one day's verification work — once during 01.6.3 wave 4's close-out and once during 01.4
wave 2's merge. Each time it costs an isolation re-run plus a full-suite re-run to disprove, and, worse,
it trains the reader to reach for "probably the flake" when a genuine regression appears in the same
position. That is the expensive failure mode: a suite whose reds are sometimes meaningless is a suite
nobody reads carefully.

**It is the third concurrency-shaped problem found in this suite this week**, and the other two were
real and fixable:
1. `build()` writing non-atomically into a shared `resources/` (fixed, quick-260804-o09).
2. `build()`'s staging dir sitting inside a directory other tests walk recursively (fixed, same task's
   follow-up — a race the first fix introduced).

This one is different in kind: it asserts an **ordering between two side effects of a real spawned
subprocess** — a stderr write and a file write. Under load the observer can sample after both have
happened, or the writes can interleave differently, without anything being wrong with the broker.

## Fix direction

Prefer making the assertion **causal rather than temporal**. Options, in rough order of preference:

1. **Assert the invariant that actually matters** — that the banner is on stderr *before the listener
   accepts a connection* — by observing the accept, not by comparing wall-clock arrival of two writes.
   The test's own name says this is the real property ("and therefore before the listener accepts").
2. **Serialise just this test** away from the load that perturbs it, the way the build-calling tests
   were addressed, if the ordering genuinely cannot be observed causally.
3. If neither is achievable, mark it `todo` with the reason rather than leaving a known-flaky assertion
   green-most-of-the-time — an honest skip beats an unreliable pass.

**Do not** simply widen a timeout or retry the assertion: that hides the sampling problem instead of
removing it, and leaves the same false-red cost in place.
