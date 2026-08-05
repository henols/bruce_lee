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

## ROOT CAUSE — found 2026-08-05, pointed at by the developer

**The broker records its *bind* address into a field the container-side client consumes as a *connect*
address.** `0.0.0.0` is a valid bind target and a meaningless connect target: dialing it from inside
the container reaches the container's own network stack, where nothing listens
(`ss -ltn` shows no listener on 19510 in-container). The connection cannot succeed, and the failure
surfaces under the misleading "heartbeat older than the stale threshold" wording.

| Where | What it does |
|---|---|
| `vice-broker.mts:782` | writes `control_host: listener.host` — i.e. **`0.0.0.0`**, the bind address |
| `vice-broker-client.ts:219`, `:701` | reads `control_host` **verbatim** and connects to it |
| `.devcontainer/devcontainer.json:16-17` | `--add-host=host.docker.internal:host-gateway` → `172.17.0.1` — **the dedicated route out of the container** |
| `vice.ts:32` | the **data plane already gets this right**: `http://host.docker.internal:6510/mcp` |
| `broker-control.mts:16-20` | **documents the exact rule being broken**: *"Bind: 0.0.0.0 explicitly, never 127.0.0.1 — host.docker.internal is the bridge address, not loopback, so a loopback-only listener is structurally unreachable from the container"* |

So the **bind** half of that documented rule was implemented and the **connect** half was not. The
asymmetry is the trap: `control_host` has two consumers with two different correct answers — the
host-side tooling runs on the host, where the recorded bind address is fine, while the container-side
proxy must cross the bridge. One field cannot serve both.

**Fix direction:** the container-side client must not treat `control_host` as a dialable address. It
should resolve the host as `host.docker.internal` (with an env override for symmetry with
`VICE_MCP_URL`/`VICE_MCP_HOST`), exactly as `vice.ts` already does for the data plane — and ideally
reject `0.0.0.0`/`127.0.0.1`/`localhost` loudly rather than attempting a doomed connect, so this
failure can never again present as a liveness verdict. Note `containerpath` already performs
host-alias rewriting for URL fields (`containerpath.test.ts` exercises
`alias: "host.docker.internal"`), so the machinery exists and this path simply bypasses it.

## Correction to an earlier diagnosis in this same file

An earlier revision named *"the running proxy process predates the broker by six hours"* as the
strongest lead and proposed a proxy restart as the decisive experiment. **That was wrong** and is
retained here as a correction rather than deleted, because it is the more instructive record: the
proxy's age is real (processes at 06:21…13:23 versus a 19:56 broker) but causally irrelevant, and a
restart would not have fixed anything. The stale-`BROKER_STALE_MS` and 12 500 ms fail-fast-bound
theories were both dead ends.

**Why the threshold theories were doomed, stated precisely:** `broker.json` is read from the *shared
filesystem*, not over the control connection, so the freshness computation had a perfectly good
timestamp and would have returned `alive`. The failure is one layer later — the **connect** to
`0.0.0.0:19510`. What made this hard to see is that a connect failure is *reported* with the
heartbeat/stale-threshold wording, so the error message names a cause that had already been satisfied.
**That mis-attributing message is itself a defect worth fixing alongside the address bug:** it cost
this session roughly a dozen tool calls chasing a threshold that was never exceeded, and it will
mislead the next reader the same way. An "I could not reach the control plane at `<addr>:<port>`"
message would have made the real cause obvious on the first ping.

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
