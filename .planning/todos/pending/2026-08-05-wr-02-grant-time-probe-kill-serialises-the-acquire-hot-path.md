---
type: defect
severity: low
area: vice-mcp
files:
  - .claude/mcp/vice/vice-broker.mts
found: 2026-08-05
found_by: 01.6.2.1-REVIEW.md (WR-02), deferred with reasoning by 01.6.2.1-07-PLAN.md (gap closure for CR-01)
---

# selectWarmInstance()'s grant-time probe failure awaits the identity-verified kill per candidate, serialising the acquire hot path

## The finding

`selectWarmInstance()`'s drop path (`vice-broker.mts`), reached when a grant-time re-probe fails for
a ready candidate, `await`s `deps.kill(...)` (`verifiedKill()`) before the walk continues to the next
candidate. `verifiedKill()` issues SIGTERM and then polls every 200ms up to the configured
`VICE_BROKER_KILL_WAIT_S` (default 5s) before escalating to SIGKILL and returning. If a candidate's
probe fails because the underlying process has genuinely wedged (not merely booting slowly), the
acquiring request now waits up to ~5 seconds *per dead candidate* before the walk can move on to the
next `ready` record or fall through to a cold launch — turning what the warm floor exists to make a
fast, in-memory grant into a multi-candidate, multi-second serial teardown on the hot path of a
single request.

This is the opposite posture from `handleRelease()`, which fires `verifiedKill()` fire-and-forget
from the control listener's close handler's own perspective specifically so a release never blocks
its caller.

## Why this is bounded and not urgent today

- The warm floor defaults to 1 (D-06), so in the normal case there is at most ONE ready candidate to
  walk through in the first place — there is no "multiple wedged candidates in a row" scenario to
  serialise against at the default configuration.
- The worst case (one wedged candidate, one ~5s kill-wait) sits comfortably inside the acquire
  deadline P-08 raised from 25s to ~120s (`CONTROL_ACQUIRE_TIMEOUT_MS`), so it will not time out the
  caller.
- This finding only actually bites a host deliberately configured to a warm floor above 1
  (`VICE_BROKER_WARM_FLOOR` set above the default) — not this project's current default anywhere.

## Fix options (both recorded here, neither applied yet)

1. **Make the kill fire-and-forget**, matching `handleRelease()`'s own posture — the walk continues
   to the next candidate immediately, without waiting for `verifiedKill()`'s own resolution. This
   needs the grant-time-probe-failure log line's own ordering re-examined: that line currently reads
   the kill's RESOLVED outcome (`kill stage: ${killStage}`) to word its own message, and a
   fire-and-forget kill would need the log line decoupled from the kill's resolution (e.g. logged
   before the kill settles, without naming the stage, or logged separately once the kill's promise
   settles asynchronously).
2. **Cap how many failed candidates a single acquire will wait through** before falling back to a
   cold launch regardless of how many `ready` records remain unvisited. This preserves today's log
   ordering exactly (the kill stage is still awaited and named for whichever candidates ARE walked)
   and only matters on a host deliberately configured to a warm floor above 1 — the one circumstance
   where this bound actually bites.

## Why deferred rather than fixed in 01.6.2.1-07

01.6.2.1-07 is a gap-closure plan for two CRITICAL findings (CR-01's concurrent-acquire race and its
cross-session-kill blast radius). WR-02 is a pre-existing, bounded, low-severity Warning the code
review itself flagged as lower priority than those two Critical findings, and fixing it now risks
destabilising the existing grant-time-probe-failure log-ordering test for a bound that does not
currently bite at this project's own default warm floor. Whoever next configures a warm floor above 1
(the one circumstance where this bound actually bites) has both fix options and the reasoning already
written down here, rather than just the bare finding.
