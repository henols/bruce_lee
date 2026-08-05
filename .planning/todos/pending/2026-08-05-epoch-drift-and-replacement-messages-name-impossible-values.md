---
type: defect
severity: minor
area: vice-mcp
files:
  - .claude/mcp/vice/vice-proxy.ts
found: 2026-08-05
found_by: orchestrator, on the first successful forwarded call after the control-host dial fix
---

# Two proxy diagnostics name values that cannot be right

Both surfaced on a single `vice_ping`, immediately after `ac5e079`/`502b4a8` restored control-plane
connectivity. Neither blocks work — the retry succeeded and returned
`{"status":"ok","version":"3.10","machine":"C64SC","execution":"paused"}` — but both mislead a reader,
which is the same defect class as the mis-attributing "dead or hung" message just fixed.

## 1. Epoch drift reported with identical old and new values

> vice-proxy: epoch drift detected ... the host VICE MCP server's epoch **changed from 1 to 1**, pid
> 2736259, spawned_at 2026-08-05T08:40:05.589Z

`1 → 1` is not a change. Either the comparison fires on something other than inequality, or the
message interpolates the wrong variable (e.g. printing the new value twice instead of the baseline).

**Why it matters beyond cosmetics:** this message *voids the run in flight* — it instructs the caller
that "any work done since the previous call may have hit a different, freshly-booted machine and
should be redone." A false drift report therefore discards good work. Worth establishing whether the
drift detection itself is over-firing or only its wording is wrong, because those have very different
consequences.

Note the surrounding context was legitimate: the broker connection *was* gone
(`openBrokerControl: session already closed`) and a replacement instance *was* adopted, so a fresh
machine genuinely was in play. The suspect part is specifically the epoch pair, which should have
shown two different numbers if a real epoch change occurred — or no drift message at all if the
epoch was genuinely unchanged and the replacement was the only event.

## 2. The replacement and the "old" instance are named with the same port

> A replacement instance (**port 6603**) has already been acquired and adopted for this session -- the
> machine was REPLACED, the replacement is a FRESH emulator, and all prior state on the **old instance
> (port 6603)** is GONE.

One port cannot be both. Either the old port is not being captured before the replacement overwrites
it, or the same variable is interpolated into both slots. A reader trying to reconcile "which
instance did I lose" gets a contradiction.

## Fix direction

Assert on the *message* in both cases, not only on the control flow: a test that pins "the drift
message names two DIFFERENT epochs" and "the replacement message names two DIFFERENT ports" would
have caught both, and is the same shape as the `brokerControlUnreachableMessage()` test added in
`502b4a8` (which asserts both the presence of the right wording and the absence of the wrong).

## THIRD independent confirmation, 2026-08-05 (Phase 01.4 plan 04)

A deliberate `vice_recycle` — issued as a planned criterion-1 verification against a healthy instance,
not as an incident — again reported the epoch as **`1 -> 1`**, with readiness `ECONNREFUSED` at return
and a genuinely fresh pid (3362603) observed on the following `vice_ping`. The machine really was
replaced; the epoch text still did not move.

That makes three sightings from **two different code paths** (the broker-connection-gone path and the
deliberate-recycle path), so this is not a one-off race in a single caller. It also means the recycle
path reproduces it **on demand**, which is the cheapest possible reproduction for whoever fixes it:
recycle a healthy instance and read the message.

Note the contrast that isolates the defect: `vice_diagnose` on the same session reported `epoch changed
from 1 to 2` — a correct, moving pair — so the epoch *mechanism* works and it is specifically the
message construction (or the point at which it samples) that is wrong.
