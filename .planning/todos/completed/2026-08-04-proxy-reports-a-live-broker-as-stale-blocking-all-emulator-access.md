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

**Carried forward, NOT closed by this todo's resolution below** -- moved to its own file,
`.planning/todos/pending/2026-08-05-host-tools-deploy-is-stale-relative-to-committed-resources.md`,
so it survives this file's own archival to `completed/` rather than reading as fixed alongside
the dial-address defect this file actually resolves.

## RESOLVED 2026-08-05 (quick-260805-9ha)

**The dial-address defect (this file's main subject) is fixed. The mis-attributing message is
fixed alongside it, as this file's own text already argued it should be.**

**What changed, on the CONSUMER side only** -- `broker.json`'s own `control_host` record is
deliberately UNCHANGED; the fix belongs on the side that reads it, exactly as this file's own
"Fix direction" section argued:

- `vice-broker-client.ts` gained `classifyConnectHost()`/`resolveControlTarget()`, placed above the
  `BROKER-CONTROL-CLIENT REGION START` marker and consumed by BOTH existing connect sites
  (`acquireOverControlPlane()`, `openBrokerControl()`). Precedence: a new env var,
  `VICE_BROKER_CONTROL_DIAL_HOST` (deliberately NOT a homonym of the existing
  `VICE_BROKER_CONTROL_HOST`, which is the broker's own BIND host on the host side), otherwise
  `vice.ts`'s `mcpHost()` -- the module tree's single definition of the container-visible host
  alias, already used correctly by the DATA plane. `broker.json`'s `control_host` is never read as
  a dial target again; it survives only as diagnostic text. A resolved host that classifies as a
  wildcard bind (`0.0.0.0`, `::`, etc., matched structurally) is refused BEFORE any connect is
  attempted, naming the address and port.
- `vice-proxy.ts`'s `ensureBrokerLease()` no longer collapses every `openBrokerControl()` failure
  into the dead-or-hung message. Only `never_started`/`stale` (a genuine liveness re-read) still
  route there; every other failure kind reaches a new `brokerControlUnreachableMessage()` that
  names the resolved address and port and states plainly that the heartbeat is fresh -- the exact
  "I could not reach the control plane at `<addr>:<port>`" wording this file's own "Fix direction"
  section asked for.
- Every control-plane test across `vice-broker-client.test.ts`, `vice-proxy.test.ts`,
  `broker-e2e.test.ts` and `broker-kill.test.ts` now names its own in-container listener explicitly
  (`VICE_BROKER_CONTROL_DIAL_HOST`/`VICE_MCP_HOST` set to `127.0.0.1`, or the two pre-existing
  `eth0` tests left as they were) -- no test dials the real bridge alias.

**Full suite green, generated tree unchanged:** `node --test '.claude/mcp/vice/'*.test.*`,
406/406 non-todo tests; `node .claude/mcp/vice/build.ts` then `git status --porcelain --
.claude/mcp/vice/resources/` empty, proving nothing host-bound was touched by mistake (this
change touches none of `build.ts`'s seven `HOST_BOUND_ARTIFACTS`).

**Evidence:** direct read of every file this fix touches, plus the live evidence this file's own
"ROOT CAUSE" section already recorded (no in-container listener on the control port; a healthy
broker with three warm spares idle while every forwarded call failed). See
`.planning/RE-FINDINGS.md`'s 2026-08-05 entries for the two reusable lessons this incident yields.
**Confidence:** HIGH.
