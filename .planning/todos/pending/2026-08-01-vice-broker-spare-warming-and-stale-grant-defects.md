---
created: 2026-08-01T18:40:00.000Z
updated: 2026-08-04T00:00:00.000Z
title: Five VICE broker/proxy defects — parallel spare warming kills x64sc, grants outlive their process, proxy caches a dead grant for the session's life, and (found 2026-08-04) the new TypeScript broker never grants from its own warm floor at all
area: tooling
severity: major
files:
  - tools/vice-broker.sh
  - tools/vice-supervisor.sh
  - .claude/mcp/vice/vice-broker.mts
  - .claude/mcp/vice/broker-launch.mts
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

## Defect 5 — the new TypeScript broker never grants from its own warm floor (found 2026-08-04, `01.6.2-10-PLAN.md`)

Found while building `01.6.2`'s test disposition ledger (plan 10), not by live host debugging like
Defects 1–4 above — but it belongs in this file because it is squarely inside "spare warming and
stale grants," and Phase 01.6.2.1's criterion M already tracks this file as its four-defect list.

`vice-broker.mts`'s `handleAcquire()` — the function every `acquire` control-plane request
resolves through — never consults `maintainWarmFloor()`'s own warm pool at all. Confirmed by
reading `handleAcquire()`'s full body and by grepping every `state.grants.set()` call site in the
module (exactly one hit, immediately following a freshly-spawned `acquirePortAndLaunch()` result,
with no branch that promotes an existing `state.instances` entry in state `ready` into a grant).
`maintainWarmFloor()` itself is correctly built and tested (`broker-launch.test.ts`) — it launches
and promotes instances to `ready` exactly as designed — but nothing ever consumes them. Every
acquisition is a fresh cold launch, every time, regardless of how many warm instances are sitting
ready.

**Consequence:** the whole latency optimisation the warm floor exists to provide (an acquire
served instantly from a pre-warmed instance, avoiding the emulator's own boot time) does not
happen in the current implementation. This is a distinct issue from Defects 1–3 above (which are
about a stale/dead record being wrongly trusted); this is the pool never being read from at all.

**Not fixed by `01.6.2-10-PLAN.md`:** that plan's own declared scope is a test-file ledger plus the
`.planning/phases/01.6.2-the-one-process-host-broker/01.6.2-VALIDATION.md` artifact — wiring
`handleAcquire()` onto the warm floor is a change to broker acquire logic, outside that scope, and
arguably an architectural decision (which instance to hand out, and what happens if none is ready)
rather than a mechanical port. Recorded in that plan's own test disposition ledger, Class H, against
the retiring `grant_from_spare()`-specific tests (`vice-broker.test.mjs` rows 24, 39, 44, 45).

**Suggested fix:** `handleAcquire()` should check `state.instances` for an entry in state `ready`
before calling `acquirePortAndLaunch()`, re-probing it live at grant time (matching the bash
original's `grant_from_spare()` — read-a-record-is-bookkeeping, a probe-that-answers-now is
evidence, per the 2026-08-01 incident this file's own Defect 3 already documents) rather than
trusting the recorded `ready` state alone.

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
