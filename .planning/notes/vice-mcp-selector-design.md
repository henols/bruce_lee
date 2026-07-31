---
title: Emulator access moves to a per-session stdio MCP proxy over an on-demand host broker
date: 2026-07-31
context: /gsd-explore on removing the non-functional vice-session skill and replacing it with a vice-mcp-selector skill; includes two rounds of researched Claude Code MCP behaviour that constrain the design, and a mid-conversation shift from a fixed pre-launched pool to launch-on-demand
---

# The `vice-session` skill is being replaced by a per-session MCP proxy over an on-demand broker

## Phasing: what ships when, and why in that order

The design below is the destination, not one deliverable. It is split so that the part carrying
value ships without waiting on the part carrying risk.

| | Phase 1.1 — Tool-Mediated Access | Phase 1.2 — Broker & Leasing | Seed — Instance handles |
|---|---|---|---|
| Scope | Diagnose the current failure, remove `vice-session`, one static `.mcp.json` entry, stdio proxy forwarding to a **fixed** host port, hazards enforced in code, three-state diagnostics | Host broker daemon, request/grant/lease protocol, on-demand launch, kill-on-release, N warm spares under a ceiling, TTL sweeper | Multiple concurrent emulators per session, addressed by handle |
| Depends on unverified findings? | **No** | ~~Yes — 4, 5, 7, 8~~ **Findings 4, 5 and 8 are now measured; 8 was corrected** | ~~Yes — 5~~ **5 is now measured** |
| Gated by the spike? | No | ~~**Yes**~~ **Gate cleared 2026-07-31** — see `.planning/spikes/` | — |
| Changes the reset ritual? | No | Yes, narrows it | No |

**Why 1.1 is immune.** Without leasing, it does not matter how many subprocesses exist per session,
whether subagents share connections, or how long the shutdown grace window is. Every proxy forwards
to the same fixed port, and several proxies sharing one emulator is exactly the status quo. Every
MEDIUM finding could be wrong and 1.1 would still be correct.

**Why that ordering is worth the extra phase.** Most of the value here is not concurrency — it is
that the emulator stops being reached through `Bash` and the hazards stop being advisory. Both land
in 1.1. Concurrency and fresh-boot isolation are real wins, but they are the parts that need a
daemon, a sweeper, and four measured assumptions.

**1.1 opens by diagnosing the existing failure**, not by building. The claim that `vice-session` does
not work has never been diagnosed — only asserted and accepted. If the underlying cause is that the
host emulator is unreachable from this container at all, the proxy fails identically, and 1.1 surfaces
that at the lowest possible investment rather than after a broker exists.

**Instance handles moved out to a seed.** No plan needs parallel emulator work today — `ROADMAP.md`
explicitly serialises it — so building the mechanism now would be speculative scope resting on the
finding with the weakest support. The design is recorded in
`.planning/seeds/vice-instance-handles-for-parallel-emulator-work.md` with a trigger condition.

## What is wrong today

`.claude/skills/vice-session/` exposes no MCP tools at all. Every emulator call is a bespoke
JSON-RPC proxy invoked as a shell command — `node .../vice.mjs call TOOL '{...}'` — POSTing to
`http://host.docker.internal:6510/mcp` (`vice.mjs:25`). `.mcp.json` is deliberately empty, and
`tools/vice-pool.sh:81` states the choice outright: *"`.mcp.json` is not touched."*

The consequence is that the emulator is reached through `Bash`, not through tools. No schemas, no
tool-name completion, argument JSON hand-assembled per call, and every hazard (`vice_disk_list`,
epoch drift, pause-on-read) enforced only by documentation and memory that a session may or may
not have loaded.

## The chosen shape

Three components:

**1. A static `.mcp.json` entry**, committed once by hand, never rewritten:

```json
{ "mcpServers": { "vice": {
    "command": "node",
    "args": [".claude/skills/vice-mcp-selector/scripts/vice-proxy.mjs"] } } }
```

**2. `vice-proxy.mjs`** — simultaneously an MCP **server** (JSON-RPC over stdin/stdout to Claude
Code, which spawns one copy per session) and an MCP **client** (streamable HTTP to
`http://host.docker.internal:<port>/mcp`). It answers `initialize` and `tools/list` immediately;
on the first real `tools/call` it requests an emulator, then forwards that call and all later ones.

**3. A host-side broker daemon** that owns emulator lifecycle: it watches a request directory on the
shared bind mount, launches `x64sc` on demand, writes back the assigned port, tears the instance
down when its session ends, and sweeps orphans.

Tools surface as `mcp__vice__memory_read` — a stable name, independent of which physical emulator
is behind it.

### Why a broker, and why it isn't a new concept

The proxy runs **inside** the container; `x64sc` runs on the **host**, and `tools/vice-pool.sh`
refuses to run in a container on purpose (`lib/container-guard.sh`). A container-side process
cannot launch a host process. So on-demand launch requires a host-side agent, and communication
goes over the same shared bind mount that `epoch.json` and `registry.json` already use — no new
port, socket, or IPC mechanism, matching the existing design decision D-2.

This is an extension of what exists rather than a new pattern:
`vice-supervisor.sh:350` is **already** a long-lived daemon — `while true` with backoff and a
`trap cleanup INT TERM`. A broker is that same loop with a request queue instead of a fixed port.

### Why on-demand beats the fixed pre-launched pool

| | Fixed pool (3 pre-launched) | On-demand broker |
|---|---|---|
| Idle host cost | 3 idle `x64sc` processes | 1 idle broker |
| Concurrency cap | Configured `VICE_POOL_SIZE` | Host RAM |
| Starting machine state | Long-lived, shared, carries prior sessions' state | Fresh power-on every time |
| Reset ritual needed? | Yes — mandated by `ROADMAP.md` | **No** — contamination is structurally impossible |
| Validated? | **No** — see below | N/A, being built |

The middle rows are the real prize. `ROADMAP.md`'s standing constraints currently require that every
plan touching VICE "open with the reset/clear-checkpoints/reload ritual before trusting emulator
state." That ritual exists *because* instances are long-lived and shared. A freshly launched
emulator is a known-clean power-on state, so on-demand launch retires the ritual rather than
automating it — and that touches every phase from 2 onward.

Nothing proven is being discarded by the switch. Broken window **#1** in `WINDOWS.md` records that
the real multi-instance host launch was never actually verified — that check ran container-only,
where `x64sc` does not exist. The fixed pool's central claim is unvalidated, so this is not a
rewrite of working code.

### What it buys over registering the emulator's HTTP endpoint directly

| Property | How the proxy delivers it |
|---|---|
| Stable tool names | One server name forever; no `vice_1`/`vice_2` variants leaking into agent definitions or docs |
| Approval survives | A server's `url` change re-triggers `.mcp.json` approval. A stdio entry has no `url`, and the file is never rewritten, so approval is granted once |
| Exclusivity is structural | A session cannot reach another session's emulator because no tool for it exists |
| Release is automatic | Process lifetime *is* lease lifetime — see the shutdown constraint below |
| Single chokepoint for hazards | `vice_disk_list` refused at the proxy instead of remembered as a rule; the epoch re-checked on every call so a host restart fails loudly instead of silently returning blank-machine reads |
| Survives emulator death | A dead HTTP MCP server makes tools *vanish* mid-session and stdio servers are never auto-reconnected. A live proxy turns emulator death into a tool call returning a clean, handleable error, and can request a replacement |

The hazard row matters most: three of this project's live memory entries exist because a rule had to
be remembered rather than enforced. A proxy converts them into code.

## Shutdown: what the handler can and cannot do

**Measured 2026-07-31 by spike 002** (`.planning/spikes/002-shutdown-grace-window/`), which replaced
the guesses this section previously carried. There are **two** teardown paths, they fire **different**
handlers, and they are the opposite way round from what was assumed.

| Ending | Trigger the proxy sees | Budget | Ends how |
|---|---|---|---|
| Print mode; stdin closed; client SIGTERMed | **SIGINT**, then SIGTERM +100ms | **~490ms** to SIGKILL | killed; exit handler never runs |
| Client SIGKILLed (crash, killed window) | **`stdin_end` → `stdin_close`** (the pipe closes) | **unbounded** | normal exit, code 0 |

**Release must be wired to both `SIGINT`/`SIGTERM` and stdin `end`/`close`.** This is the correction
with the most direct effect on implementation. A graceful ending never closes stdin, and an abrupt one
never signals — so a handler on stdin alone (what this section used to describe first) would miss
*every* graceful shutdown, and a signals-only handler would miss every abrupt one. **`SIGINT` must be
treated as a teardown trigger, not ignored as a user Ctrl-C**: it is the first signal every graceful
teardown delivers, and ignoring it burns 100ms of a 490ms budget.

**Hard constraint, unchanged and now quantified: release must be one synchronous local filesystem
operation.** `unlinkSync` on a lease file — never an `await fetch(...)`. Measured cost of the unlink:
**0.065–0.171ms** against the ~490ms window, roughly 3000× inside budget. The window is about half the
"order of a second" previously assumed, which is still ample for one syscall and still rules out a
network round trip. Anything requiring host action (actually stopping `x64sc`) **cannot happen in the
handler at all** — the proxy marks the lease released and the broker, which outlives it, does the
teardown.

**~~The SIGKILL path gets nothing.~~ Wrong — it is the best-case path.** When the client is SIGKILLed
the pipe closes, the proxy observes `stdin_end`, releases the lease, and exits normally with no
deadline at all (8000ms of synchronous work completed in the test). A killed VS Code window does not
leak a lease.

**The host-side sweeper is still mandatory, for different reasons.** Not abrupt client death, which is
now covered. What remains uncovered: the **proxy itself** being SIGKILLed (which happens ~490ms into
every graceful teardown — after its chance, but fatal to a proxy that blocked on something else);
container or host death, where nothing in-process runs; and a proxy wedged with a blocked event loop,
where neither handler ever fires. Only the host can kill host processes, which is still a reason the
broker must exist.

## The broker protocol: files on the shared bind mount

File IPC is the only channel available — the container cannot signal a host process any other way —
and it is the channel `epoch.json` and `registry.json` already use (design decision D-2).

Verified properties of this boundary (2026-07-31, in-container):

| Property | Value | Consequence |
|---|---|---|
| Container identity | `uid=1000(vscode) gid=1000(vscode)` | — |
| Workspace ownership | `1000:1000` | The host's `henrik` is also uid 1000, so **either side can create and unlink the other's files**. This is the risk that would silently break file IPC; it is clear |
| Mount type | `/dev/nvme0n1p4[/henrik/dev/henrik/git/bruce_lee]`, **ext4** — a real bind mount, not gRPC-FUSE/virtiofs | Same inodes both sides, so `inotify` works across the boundary |
| `registry.json` mode | `0600` | Fine while both sides are uid 1000; breaks if the broker ever runs as a different host user. Decide this deliberately rather than inherit it |

**Poll as the contract, inotify as an optional accelerator.** The mount type is a property of this
host, not of the design — a macOS/Windows host would not have it. `acquire()` already polls at
500ms, so the latency floor is acceptable without watching.

**The broker needs no path translation.** It runs on the host and resolves the repo root itself via
`lib/repo-root.sh`. Only file *contents* naming paths (attaching a `.d64`) go through the
`devcontainer-host-path` skill.

### Layout

Everything lives under the **existing** `.vice-supervisor/` directory — already gitignored
(`.gitignore:76`), already on the bind mount, already holding a `leases/` folder and the per-port
supervisor dirs. The protocol adds files to a directory that exists, rather than introducing a new
location, a new mount, or a new gitignore entry.

```
.vice-supervisor/
  broker.json           host writes  — liveness: pid, started_at, heartbeat mtime
  registry.json         host writes  — existing; what is currently launched
  requests/<id>.json    proxy writes — {op, proxy_pid, created_at}
  grants/<id>.json      host writes  — {port, epoch, x64sc_pid, granted_at}
  denials/<id>.json     host writes  — {reason} when a launch fails
  leases/<id>           proxy writes — lease, heartbeat, AND release signal   (dir exists today)
  <port>/               host writes  — existing per-port epoch.json + logs; still per-port, since
                                       an on-demand x64sc still binds one
```

Every write is tmp-file + `rename()` in the same directory — never in place, or a poller reads a
half-written file. The pool already writes `registry.json` atomically, so the idiom exists.

### Lifecycle

1. **Proxy startup** — nothing. Acquisition is deferred (finding 6) so a session that never touches
   VICE never launches an emulator.
2. **First `tools/call`** — proxy writes `requests/<id>.json`, creates `leases/<id>`, then polls for
   `grants/<id>.json` or `denials/<id>.json`.
3. **Broker loop** — scans `requests/`, launches `x64sc`, writes `grants/<id>.json`, removes the
   request.
4. **Proxy** reads the grant, connects to the port, forwards the pending call.
5. **Steady state** — proxy touches `leases/<id>` on every call *and* on an interval timer. The
   timer matters: touch-on-call alone would let a session that is merely thinking look abandoned.
   **Measured (16):** a 40-minute idle session is never reaped by the client, and a 60s interval timer
   held its cadence to ±0.1s across 39 ticks — so the timer's only job is keeping the *broker's* TTL
   sweeper away from a thinking session, not surviving anything the client does.
6. **Session end** — `unlinkSync(leases/<id>)` in the shutdown handler, wired to **both** `SIGINT`/
   `SIGTERM` **and** stdin `end`/`close` (spike 002: each ending fires only one of the two). One
   syscall, nothing awaited, ~0.1ms of a ~490ms window.
7. **Broker** notices the lease is gone, kills that `x64sc` by the pid it recorded (identity-verified,
   never a name match — the existing `stop` path already does this), removes the grant.
8. **Client crash / killed window** — *measured to take step 6's path, not this one.* The pipe closes,
   the proxy sees `stdin_end`, and it releases and exits normally with no deadline. The lease does
   **not** leak. **What actually reaches the TTL sweeper:** the proxy itself being killed, container or
   host death, or a proxy wedged with a blocked event loop. In those cases the lease file survives with
   a frozen mtime and the broker sweeps it, running *the same teardown as step 7*.

### Why release is a delete, not a write

This is the load-bearing choice. Two constraints otherwise fight: the shutdown handler must do one
cheap synchronous operation (finding 8), and only the host can kill a host process. Making the lease
file's **absence** the release signal satisfies both — the proxy never writes at shutdown, it only
unlinks, and the host does all teardown.

One file then does three jobs: its existence is the lease, its mtime is the heartbeat, its removal is
the release.

The property that follows: **there is exactly one teardown path.** Graceful release and TTL sweep
differ only in latency, converging on the same broker code. The rarely-exercised crash path *is* the
common path, rather than a separate branch that rots untested.

`broker.json` closes the last gap — it lets the proxy distinguish "no broker is running, start it on
the host" from "still launching," instead of polling until the tool timeout with no diagnosis.

## Warm spares: hiding cold start without rebuilding the pool

The broker keeps **N boot-fresh, never-used instances ready at all times**, where `N` is the count
passed at launch and defaults to **3**. A `tools/call` needing an emulator is handed a ready spare
immediately, and the broker warms a replacement in the background. Cold start moves off the request
path and becomes a background cost.

**Invariant:** `ready_spares == N`, subject to `total_instances <= MAX` — re-evaluated after every
grant and every teardown.

`MAX` defaults to **16**, matching the range `vice-pool.sh` already accepts. The CLI mirrors the
existing interface — `vice-broker.sh start [N]`, default 3, range 1..16 — so `tools/vice-pool.sh
start 3` muscle memory carries over unchanged.

### What N means, and what it does not

`N` counts **ready spares, not total processes**. Total is `leased + N`, until the ceiling:

| Leased | Total procs | Ready | Acquisition |
|---|---|---|---|
| 0 | 3 | 3 | instant |
| 2 | 5 | 3 | instant |
| 3 | 6 | 3 | instant |
| 13 | 16 | 3 | instant |
| 16 | 16 | 0 | cold path — "warming, retry" |

This was a deliberate choice over the alternative reading (at least N processes *in total*), which
caps idle cost at the old pool's level but runs out of spares at N concurrent sessions — exactly when
contention is highest, and precisely the case spares exist to fix.

A useful consequence at the default: **N=3 covers a three-way parallel wave instantly.** A session
opening three instance handles takes all three spares and the broker warms three more, so the common
GSD executor fan-out never pays a boot. Waves wider than N pay cold launches for the excess, so a
plan expecting more can raise N at broker start.

The ceiling is what keeps this bounded. Unbounded `leased + N` growth would make host RAM the only
limit, with nothing warning before it is hit.

### The discipline that makes it safe

**A released instance is killed, never returned to the spare slot.** On-demand beat the fixed pool
because a newly launched emulator is a known-clean power-on state — which is what retires the reset
ritual. A warm spare preserves that property only while it has never been used. Recycling released
instances back into the spare set rebuilds the fixed pool, reintroduces cross-session contamination,
and keeps none of the benefit. This is the one rule that must not be relaxed for efficiency.

**"Ready" means MCP-ready, not launched.** A TCP accept can occur before the C64 has finished
booting, so advertising a spare on `port_in_use()` alone would hand out a half-ready machine — and
that failure presents as a flaky emulator rather than as a race, which is the expensive kind of bug
in this project. Spares therefore carry explicit `launching` → `ready` states, only `ready` ones are
grantable, and readiness is proven by an actual MCP round-trip, not a socket probe.

### What it costs and what it keeps

At the default, three idle `x64sc` processes while the broker runs — the same idle cost as the old
fixed pool. That cost is being paid back deliberately, in exchange for guaranteed instant
acquisition. What on-demand still keeps, and what the fixed pool never had:

- **No state contamination.** Every granted instance is boot-fresh and single-use.
- **Total is not capped at N.** The old pool's 3 meant *three sessions, ever*. Here 3 is the ready
  floor and up to 13 sessions can be leased simultaneously beneath the 16 ceiling.

The steady-state cost is churn rather than idle: kill-on-release means every session end triggers a
background boot to refill the spare set. Cheap, but constant, and worth seeing in the broker log
rather than discovering as mystery host load.

Broker startup begins warming immediately, so "start the broker on the host" implies "and it is ready
within a few seconds" rather than "and the next call still pays for a boot."

## Broker-absent reporting

The broker is started by hand on the host. Nothing auto-starts it, and nothing needs to — the proxy
reports the situation as an actionable tool result and the next call succeeds once it is running.

Three rules make this work rather than annoy:

**1. Report, never exit.** Finding 7 — a dead stdio server is never reconnected — means a proxy that
exits on "no broker" costs the session its emulator access for good. The proxy stays alive, answers
in MCP frames, and re-checks liveness per call. It must not cache a negative result, so the call
after the user starts the broker just works, with no session restart.

**2. Carry the host path.** The command is run on the host, so `tools/vice-broker.sh start` is the
wrong string to emit — it must be the translated absolute host path, computed by the proxy via the
`devcontainer-host-path` skill's `hostpath.mjs`.

**3. Three states, three messages.** They have three different fixes, and one generic
"broker unavailable" sends the reader to the wrong one two times out of three:

| State | Detection | Message |
|---|---|---|
| Never started | `broker.json` absent | Start it, quoting the host path |
| Dead or hung | `broker.json` present, mtime stale | Restart it; include the recorded pid so it can be checked on the host |
| Alive, launch failed | `denials/<id>.json` written | Relay the broker's own reason verbatim — missing `x64sc`, port already bound, no display |

Two properties specific to an agent audience:

- **The message must forbid routing around it.** An agent that hits "broker not running" is otherwise
  quite likely to reach for the old `vice.mjs` scripts as a workaround — the exact path being
  removed. State explicitly that this is the only route and that the correct action is to stop and
  ask the human.
- **Fail fast, do not wait out the timeout.** Blocking on a poll loop hoping the broker appears is
  pointless before anyone has been told to act, and it converts a clear diagnosis into an opaque
  tool timeout.

This is the same channel the epoch hazard should use: a mid-session host restart becomes a loud,
actionable tool result instead of silent blank-machine reads.

## Instance handles: deferred to a seed

MCP gives the proxy no way to tell which subagent is calling (finding 5), so parallel emulator work
inside one session needs the *caller* to carry its own identity — an `instance_open` handle passed as
a tool argument. That design is recorded, with its guardrails and trigger condition, in
`.planning/seeds/vice-instance-handles-for-parallel-emulator-work.md`.

It is deliberately out of scope for both 1.1 and 1.2: nothing needs parallel VICE access today, and it
rests on the finding with the weakest independent support. Verify finding 5 first-hand before building
on it.

## Researched Claude Code mechanics (two rounds, 2026-07-31)

These are the facts the design rests on. Confidence tags were originally the researcher's. Rows marked
**MEASURED** were verified first-hand by the lifecycle spike set (`.planning/spikes/`, 2026-07-31) and
carry an observation instead of a citation. **Two rows were corrected rather than confirmed — 8 and
12 — and rows 13–15 are new.** Findings 1, 2, 3, 9, 10 and 11 were outside the spike's scope and keep
their original tags.

| # | Finding | Confidence |
|---|---|---|
| 1 | MCP server definitions are read **once at session start**. A running session cannot load a newly-added server; `/mcp` only reconnects/authenticates already-loaded ones — there is no "add" flow | HIGH |
| 2 | Per-session config is possible only via `claude --mcp-config <file> --strict-mcp-config` at launch | HIGH |
| 3 | The **VS Code extension cannot pass those flags**. Its settings control extension behaviour, not CLI flags into the session. No documented escape hatch | HIGH |
| 4 | Stdio MCP servers are spawned as **one subprocess per session**. Two concurrent sessions in one project → two subprocesses. No daemon, no multiplexing | **MEASURED** (spike 001 e2: 2 concurrent sessions → 2 pids, 2 distinct session ids) |
| 5 | **Subagents spawn no new subprocess.** They are additional model loops in the same session process; their MCP calls route over the parent's already-initialised connections. `isolation: "worktree"` swaps the filesystem view, not the MCP wiring. Nested subagents follow the same rule | **MEASURED** (spike 001 e3: 1 pid, 2 calls; e4b: a worktree agent reported cwd `.claude/worktrees/agent-…` while sharing the parent's single pid). Nested subagents were *not* tested |
| 6 | Spawn is **eager**, at session start — not lazy on first tool call | **MEASURED** (spike 001 e1: full `spawn → initialize → tools/list` with zero tool calls) |
| 7 | Stdio servers are **not auto-reconnected** if they die mid-session. HTTP/SSE reconnect with backoff; stdio stays dead | HIGH (not directly tested; spike 003 g1 corroborates the *consequence* — a proxy that hit `EPIPE` survived only because of its never-throw handler) |
| 8 | ~~Termination ladder is stdin EOF → SIGTERM → SIGKILL with short grace periods. Graceful cleanup runs; abrupt client death gets **no** cleanup~~ **CORRECTED.** There are **two** ladders, and they fire *different* handlers. **Graceful** (print mode, stdin closed, or client SIGTERMed): **SIGINT** → SIGTERM +100ms → SIGKILL at **~490ms**; stdin is **never** closed, and the exit handler never runs. **Abrupt client death (SIGKILL):** no signal at all — the pipe closes, so `stdin_end`/`stdin_close` fire, and the proxy has **unbounded** time and exits normally | **MEASURED** (spike 002 f1–f6; 490ms reproduced 3/3, 8000ms of work completed on the abrupt path) |
| 9 | `${VAR}`/`${VAR:-default}` expansion is documented for `.mcp.json` `command`/`args`; **undocumented for `url`** | MEDIUM |
| 10 | Project-scope servers need approval; `enableAllProjectMcpServers` / `enabledMcpjsonServers` / `disabledMcpjsonServers` control it. Changing a `url` invalidates prior approval | HIGH |
| 11 | Plugin-bundled MCP servers get the longer `mcp__plugin_<plugin>_<server>__*` prefix — visible in this repo's own agent definitions, which list both `mcp__context7__*` and `mcp__plugin_context7_context7__*` | MEDIUM |
| 12 | ~~responses over ~25K tokens spill to disk~~ **CORRECTED — the threshold is about half that.** The inline ceiling is between **40KB and 60KB** of text (~10–15K tokens): 40KB arrives whole, 60KB spills. Crossing it is **never silent** — an explicit `Error: result (N characters …) exceeds maximum allowed tokens. Output has been saved to <path>` and the spilled file is **byte-complete**. `MAX_MCP_OUTPUT_TOKENS` **does** govern the threshold; `MCP_TOOL_TIMEOUT` **does** cut a call short and reports it cleanly to the model | **MEASURED** (spike 004 h1/h2) |
| 13 | **The client exports its own identity into every MCP server's environment**: `CLAUDE_CODE_SESSION_ID` (distinct per session), `CLAUDE_PID`, `CLAUDE_PROJECT_DIR`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_EFFORT` | **MEASURED** (spike 001, new finding) |
| 14 | **A slow handshake costs turns, not the session.** There is no client-side startup timeout that drops a server: a proxy that took 10s to answer `initialize` was still asked for `tools/list` and its tool was called successfully on the *next* turn of the same session. `MCP_TIMEOUT` did **not** change this. In print mode the session simply ends after one turn, which makes a slow start *look* like a ~3.5s timeout that does not exist | **MEASURED** (spike 003 g1/g1b/g1c/g1d, new finding) |
| 15 | **The default tool-call budget is ≥150s.** Calls blocked for 30s, 90s and 150s all returned real results | **MEASURED** (spike 003 g2, new finding) |
| 16 | **Nothing reaps an idle proxy.** A session held open and idle for **40.1 minutes** produced 39 heartbeats at a 60.1s interval with zero drift and **no signal of any kind**; teardown came only when the driver closed stdin, following the same graceful ladder as a 4-second-old session. Neither the CLI nor Node imposes an idle timeout | **MEASURED** (spike 003 g3, new finding — closes the "long session silently loses its lease" risk) |

### What each finding forces

- **(1)(2)(3) kill the per-session-`.mcp.json` idea.** It works only if every session is launched
  from a terminal with explicit flags. Not worth abandoning the extension for.
- **(9) kills the env-var variant too**, independently of whether expansion works in `url`: env vars
  come from shared workspace settings, so every extension-launched session resolves the same port.
  It cannot produce exclusivity.
- **(4)+(5) make the lease key the proxy process itself.** The initial research verdict claimed the
  key "must be session ID, not process ID," fearing release at first subagent exit — but by its own
  finding (5) nothing exits when a subagent finishes. One process per session, subagents ride it, so
  process identity *is* session identity. Record a session id in the lease as diagnostic metadata
  ("who holds 6511"), not as the key. **(13) makes that metadata trivial** — the client hands the
  proxy `CLAUDE_CODE_SESSION_ID` and `CLAUDE_PID` in its environment, so "who holds this instance" is
  two `process.env` reads rather than a guess.
- **(5) also creates the parallelism problem** that instance handles solve, above.
- **(6) requires deferred acquisition.** Eager spawn means a proxy that requests an emulator on
  startup launches one for every session, including sessions that never touch VICE. Enumerate tools
  without an emulator (from a manifest, or a schema baked in at build time); request on first
  `tools/call`.
- **(6)+(15) put cold start on the first tool call, with far more room than feared.** `x64sc` launch +
  C64 boot + MCP-ready is seconds, and because acquisition is deferred past `initialize`, the wait
  lands against `MCP_TOOL_TIMEOUT` — measured at **≥150s by default** (15). Warm spares are therefore
  a latency optimisation, **not** a correctness requirement: even a fully cold launch fits the budget
  with two orders of magnitude to spare. The cold path still needs an explicit "warming, retry" rather
  than a silent hang, and `MCP_TOOL_TIMEOUT` is confirmed as the lever that sets that threshold.
- **(14) removes the startup-timeout worry entirely.** There is no client-side deadline on the
  handshake, and a late-initialising server is used normally on a later turn. Answering `initialize`
  and `tools/list` from a manifest is still right — a first turn without tools is a real cost — but it
  is no longer load-bearing for *session* correctness.
- **(7) makes "never throw" a hard requirement.** The proxy must catch everything and always answer
  in MCP frames. A crashed proxy is unrecoverable for the rest of the session. **Corroborated in
  practice:** a proxy in spike 003 hit `write EPIPE` when the client hung up mid-handshake, and only
  its `uncaughtException` handler kept it alive to log the fact.
- **(8) forces release to be wired to BOTH signals and stdin, and keeps the sweeper mandatory for
  different reasons than first thought.** Graceful teardown arrives as **SIGINT** and never closes
  stdin; abrupt client death closes stdin and never signals. A handler on only one of those misses an
  entire class of ending. The window on the graceful path is **~490ms**, and `unlinkSync` uses ~0.1ms
  of it, so release-on-session-end is safe. Abrupt client death is now the *best* case — unbounded
  time, clean exit — so it is no longer the sweeper's justification. What still needs the sweeper: the
  proxy itself being SIGKILLed, container or host death, and a wedged event loop where no handler
  runs. See the corrected shutdown section.
- **(12) puts chunking at the proxy**, and sizes it: a 64K RAM read is ~192KB as hex, against a
  measured **40–60KB** inline ceiling. **32KB chunks** leave headroom across the whole bracket. Not
  because spill loses data (it does not — the file is byte-complete) but because the spill path is
  unusable as transport: the proxy cannot predict the path, the agent cannot easily consume a 192KB
  file, and the model retries the oversized call in the meantime — each retry being a real forwarded
  emulator call.

## Open questions for the implementing phase

1. **Does the broker replace `vice-pool.sh` or wrap it?** The pool script's per-port supervisor
   directories, epoch files, and identity-verified kills are all reusable; the fixed-N `start`
   subcommand is what becomes obsolete.
2. **Is the reset ritual actually retired, or only weakened?** Fresh-boot removes cross-*session*
   contamination. It does not remove contamination *within* a session that reuses one emulator
   across several plans. The constraint may narrow rather than disappear.
3. ~~What is the broker's own lifecycle?~~ **Resolved** — the broker is started by hand on the host,
   and the proxy's job is to say so, precisely, at the moment it matters. See "Broker-absent
   reporting" below. No auto-start machinery, no launch-agent, no supervisor-of-the-supervisor.
6. **Does `registry.json` stay `0600`?** It works only while broker and proxy share uid 1000. Either
   widen the mode or record uid-parity as a stated precondition of the whole design.
7. **What is the request-id scheme?** It must not reuse a value across sessions, since grants and
   leases are keyed by it and ports are recycled. It is also the natural snapshot-name prefix, now
   that port-prefixing breaks under on-demand launch.
4. **Does `vice-mcp-selector` absorb the pause-on-state-read polling discipline?** The proxy sees
   every call, so it could enforce read → run → poll-with-ping ordering rather than documenting it.
5. **How does the epoch check interact with intentional fresh boots?** A blank machine is now the
   *expected* start state, so the epoch's job narrows to detecting a restart *mid-session*.

## Related

- `.planning/seeds/vice-pool-contention-and-starvation.md` — the starvation policy question. The
  proxy resolves that seed's *blocker* for free (the single shared `session.json` that made actor #2
  fail instantly stops existing), and on-demand launch makes its cap question mostly moot. Its
  actor-class analysis needed correcting against finding (5); the correction is appended there.
- `.planning/spikes/` — **the echo-proxy spike set, run 2026-07-31, which closes this note's gate on
  Phase 1.2.** Four spikes: 001 process identity and spawn timing, 002 the shutdown grace window
  (the design-critical one), 003 timeout budgets, 004 output limits. Findings 8 and 12 were
  **corrected**, not merely promoted; 4, 5, 6 confirmed; 13, 14, 15 are new. `MANIFEST.md` carries the
  requirements that emerged, `CONVENTIONS.md` the method. The originating todo is in
  `.planning/todos/completed/`.
- `WINDOWS.md` window #1 — the unverified host-side multi-instance launch.
