---
created: 2026-08-01T18:40:00.000Z
title: Four VICE broker/proxy defects found while unblocking plan 01-04 — parallel spare warming kills x64sc, grants outlive their process, proxy caches a dead grant for the session's life
area: tooling
severity: major
files:
  - tools/vice-broker.sh
  - tools/vice-supervisor.sh
---

## Context

Plan 01-04 attempt 2 halted on a host VICE stall. Recovering from it took roughly two
hours of host-side debugging and surfaced four separate defects. The emulator binary was
never at fault: a hand-run `x64sc -mcpserver -mcpserverhost 0.0.0.0 -mcpserverport 6520`
came up perfectly every time — VICE 3.10, 64 MCP tools registered, bound correctly.

## Defect 1 — parallel spare warming is unsurvivable for x64sc (root cause of the outage)

`VICE_BROKER_SPARES` defaults to **3**, so `vice-broker.sh start` warms three instances
**simultaneously**. All three die. From one `supervisor.log`, three instances spawned at
the identical second and each lost the race differently:

| Port | Log timestamp | Outcome |
|---|---|---|
| 6510 | `x64sc-20260801-123400.log` | **SEGV** (status 139) |
| 6512 | `x64sc-20260801-123400.log` | exit 1 |
| 6513 | `x64sc-20260801-123400.log` | exit 0 |

Cause: **x64sc is not headless.** Its own startup log shows it opening a GTK3 window, taking
an **OpenGL 4.6 context**, and opening **PulseAudio**. Several instances doing that in the
same instant contend on GPU context and sound device; a failed OpenGL init segfaults rather
than exiting cleanly. `VICE_BROKER_SPARES=1` launches one at a time and works.

**Suggested fix:** serialise `maintain_spares()` launches — one spawn per pass, or a probe-gated
sequential loop. Warming N spares in parallel is not safe for this emulator on this host.

## Defect 2 — CORRECTED: `start [N]` works; only the usage text is stale

**This was reported wrong and is retained as the correction.** The original claim was that
`./vice-broker.sh start 2` silently ignores its argument. It does not — `vice-broker.sh:394-396`
assigns `VICE_BROKER_SPARES="$N_ARG"` when a positional is given, with three passing tests, and
the comment there describes this exact bug as already fixed.

The error came from reading the script's `usage()` text, which still claims *"it is not yet
consumed by any spares logic in this version"* — stale prose describing a defect that was
repaired without updating the docs. Acting on it, the orchestrator told the developer that
`start 1` would be ignored and to use the env var instead. Harmless in effect (both routes
work) but the reasoning was wrong.

**Remaining real defect:** the usage text contradicts the code and must be corrected. A stale
`usage()` is not cosmetic — it is what an operator reads under pressure, and here it sent
a debugging session down a wrong branch during a live outage.

## Defect 3 — grants outlive their process and survive broker restart

`broker-instances.json` / `grants/` persisted a `state granted` record for
`req-832-1785608443993-9c3df302` on port 6512 whose x64sc (pid 1634866) was long dead.
It survived a broker `stop`, a broker `start`, and a full host restart. While it stood, the
broker reported *"granted request … (from ready spare)"* and launched nothing, because it
believed the port was already serving a session. `pgrep -a x64sc` showed no process at all.

Recovery required moving `grants/`, `requests/`, `leases/`, `spares/` and
`broker-instances.json` aside by hand. Nothing in the tooling detects or reaps this.

**Suggested fix:** validate a grant's liveness before honouring it — the epoch record already
carries the pid; a `kill -0` or a port probe at load time would catch it. Relatedly, a "ready"
spare should never be grantable without a successful readiness probe.

## Defect 4 — the proxy caches a dead grant for the whole session, with no re-request path

Once the container-side proxy holds a grant, it keeps presenting it forever. After the host
was fully repaired — broker healthy (`pid 496227, heartbeat 0s`), one live x64sc on 6510,
zero stale grant records — `mcp__vice__vice_ping` from the same session **still** returned the
`req-832` / port 6512 `ECONNREFUSED` error. Every subsequent call did too.

**Consequence: a session whose granted instance dies is permanently dead for emulator work.**
No amount of host-side repair recovers it; the only remedy is a brand-new Claude Code session.
For this project that means losing an executor's accumulated context mid-plan, which is
expensive — plan 01-04 has now been halted twice, once for this.

**Suggested fix:** on `ECONNREFUSED` against a held grant, drop the lease and re-request once
before surfacing an error. The current message correctly tells the human to look at the host,
but it is misleading when the host is already fine and the stale state is entirely container-side.

## Also observed

- `127.0.0.1:6511` is held by **VS Code**, inside the broker's default 6510–6512 band. It is
  loopback-only so the container could never reach it, but the broker will refuse to launch on
  a bound port. Worth moving `VICE_BROKER_BASE_PORT` clear of the range VS Code uses.
- `vice-supervisor.sh --check-container` correctly reported `verdict: HOST`. The container
  guard is not implicated and behaved well.

## Cross-reference

See also `.planning/todos/pending/2026-08-01-vice-registers-frozen-after-reset-during-01-04-task2.md`
for the stall that started this, and STATE.md's Blockers/Concerns entry recording that
`vice_ping`'s `execution` field is **not** a liveness signal — it reported `"running"` while
`vice_cycles_stopwatch` measured exactly 0 cycles elapsed.
