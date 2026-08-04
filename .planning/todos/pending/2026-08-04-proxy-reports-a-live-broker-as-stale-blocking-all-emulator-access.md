---
type: defect
severity: blocker
area: vice-mcp
files:
  - .claude/mcp/vice/vice-broker-client.ts
  - .claude/mcp/vice/vice-proxy.ts
found: 2026-08-04
found_by: orchestrator, driving the emulator after the developer started the host launcher
---

# The proxy reports a demonstrably live broker as stale, refusing every forwarded call

`mcp__vice__vice_ping` fails with:

> vice-proxy: the on-demand VICE broker appears to be dead or hung (pid 2016020) -- its last
> recorded heartbeat is older than the stale threshold.

**The broker is alive.** Evidence, gathered in the same minutes as the two failed pings:

| Fact | Value |
|---|---|
| `heartbeat_at` observed advancing | `19:57:24` → `19:59:24` → `20:01:24` (60 s cadence, same pid 2016020) |
| `written_by` | `vice-broker.mjs` |
| `node_version` | `v22.22.0` |
| Spares actually spawned | 3 — `.vice-supervisor/6600`, `6601`, `6602`, each with an `epoch.json` naming a real `x64sc` pid and `-mcpserverport` args |
| Heartbeat age at the *second* ping | ~15 s |
| `BROKER_STALE_MS` | **180000** (`vice-broker-client.ts:132`) |

A 15-second-old heartbeat against a 180-second threshold must evaluate `alive`
(`vice-broker-client.ts:152`: `Date.now() - heartbeatMs > BROKER_STALE_MS ? "stale" : "alive"`).
It returned `stale` twice, with fresh heartbeats both times.

## Hypotheses ruled OUT (do not re-spend time on these)

- **Not a timing transient.** Two pings, one at ~115 s heartbeat age and one at ~15 s. Both `stale`.
- **Not a cached negative.** `vice-proxy.ts` documents the opposite as a deliberate invariant —
  *"There is no cached probe verdict, no sticky 'last known unreachable' flag"*, and
  *"never cache a negative result (criterion 6)"* at lines ~485-501, 545, 1228, 1429.
- **Not a threshold regression from today's work.** `BROKER_STALE_MS` was last changed in
  `cdb566a` (01.6.1-05), not by 01.6.2.1. The running proxy's code at its start commit (`912af01`)
  and the current working tree are **identical** on lines 130/132/152.
- **Not a competing record.** A filesystem-wide search found exactly **one**
  `*vice-supervisor*/broker.json` — `/workspaces/bruce_lee/.vice-supervisor/broker.json` — and it is
  the live, advancing one.
- **Not gross clock skew.** Container `date` ran ~10-11 s ahead of the host-written `heartbeat_at`
  across three samples, nowhere near 180 s.

## The strongest remaining lead

**The running proxy process predates the broker by more than six hours.** `ps -eo lstart` shows
`node .claude/mcp/vice/vice-proxy.ts` processes started at 06:21, 07:07, 10:30, 12:06 and **13:23**;
the broker started at **19:56**. `vice-broker-client.ts` *was* modified later the same day by
01.6.2.1 plan 04 (acquire deadline 25 000 → 120 000 ms, and the never-started fail-fast bound
re-anchored from *half the acquire deadline* to an absolute value), and `.mcp.json`'s vice `timeout`
went 60 000 → 150 000 in the same commit. The running process loaded none of that.

So the next diagnostic step is: **restart the vice MCP server (or the session) and re-ping.** If a
freshly-started proxy reports `alive`, the defect is that a long-lived proxy cannot see a broker that
starts after it — which is a *real* operational bug (the broker is on-demand by design, so it will
routinely start mid-session), not merely a stale-process artifact. If a fresh proxy *also* reports
`stale`, the bug is in the liveness comparison itself and the 05:43 host deploy becomes the suspect.

Note the pre-plan-04 fail-fast bound was **half the acquire deadline = 12 500 ms**. A bound of
12 500 ms against a **60 s** heartbeat cadence can essentially never be satisfied — the record is
older than 12.5 s for 47 of every 60 seconds. Worth checking whether that bound, not
`BROKER_STALE_MS`, is what the running proxy is actually applying; the plan-04 notes flag exactly
this self-loosening-fraction shape as a defect they found and fixed.

## Impact

**Total loss of emulator access from an affected session, while a healthy broker with three warm
spares sits idle.** This blocks every live-verification item in Phase 01.8's HV register except
HV-01 (which was closable by reading the record directly, no forwarded call needed).

## Separate but related: the host deploy is stale

`tools/vice-broker.mjs` and `tools/broker-launch.mjs` **differ** from committed
`.claude/mcp/vice/resources/`, and the host copies are dated **Aug 4 05:43** — hours before
01.6.2.1 merged. The live record proves it: `"spares_target": 3`, the pre-rename key *and* the
pre-change default, where 01.6.2.1 renamed it to `warm_floor` and changed the default to 1.

**Consequence:** any live verification performed right now exercises the **pre-01.6.2.1** broker.
Live-verifying 01.6.2.1's five lifecycle-policy changes requires re-running the installer to
refresh `tools/`, **and** restarting the broker so it loads the new code. The restart kills the three
warm spares and any granted instance, so it is the developer's call, not an incidental step.
