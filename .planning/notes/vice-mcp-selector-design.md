---
title: Emulator access moves to a per-session stdio MCP proxy over an on-demand host broker
date: 2026-07-31
context: /gsd-explore on removing the non-functional vice-session skill and replacing it with a vice-mcp-selector skill; includes two rounds of researched Claude Code MCP behaviour that constrain the design, and a mid-conversation shift from a fixed pre-launched pool to launch-on-demand
---

# The `vice-session` skill is being replaced by a per-session MCP proxy over an on-demand broker

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

Session end closes the proxy's stdin, then SIGTERM, then SIGKILL, with short grace periods between
steps. A handler on stdin `end`/`close` plus `process.on('SIGTERM')` does run on that path.

**Hard constraint: release must be one synchronous local filesystem operation.** `unlinkSync` on a
lease file — never an `await fetch(...)`. The grace window is on the order of a second, and an async
network round-trip in a shutdown handler is exactly what gets SIGKILLed halfway. Anything requiring
host action (actually stopping `x64sc`) **cannot happen in the handler at all** — the proxy marks
the lease released and the broker, which outlives it, does the teardown.

**The SIGKILL path gets nothing.** With a fixed pool that leaked a lease file. With on-demand launch
it leaks an orphaned `x64sc` eating host RAM, so the host-side sweeper is mandatory rather than
hygiene. Only the host can kill host processes, which is another reason the broker must exist.

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
6. **Session end** — `unlinkSync(leases/<id>)` in the shutdown handler. One syscall, nothing awaited.
7. **Broker** notices the lease is gone, kills that `x64sc` by the pid it recorded (identity-verified,
   never a name match — the existing `stop` path already does this), removes the grant.
8. **Crash** — the lease file survives but its mtime stops advancing; the broker sweeps it on TTL and
   runs *the same teardown as step 7*.

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

## Instance handles: the resolution to the parallelism fork

`tools/vice-pool.sh:33` justifies a pool partly on throughput — *"N instances interleave and scaling
is near-linear."* That assumed several actors could each hold an instance. Researched finding 5
below says they cannot: subagents and worktree executors share their parent session's MCP
connections, and **MCP gives the proxy no way to tell which subagent is calling.** One session, one
proxy, one emulator — a parallel executor wave would serialise.

The fix is to stop trying to infer the caller and make it explicit. **The proxy exposes instance
handles:** `mcp__vice__instance_open` returns a handle, and every tool takes it as a **required**
parameter once more than one is open. A plan tells each executor which handle it owns. The proxy
does not need to know who is calling because the caller carries its identity in the arguments.

Under a fixed pool that is a rationing scheme with a hard cap. Under on-demand launch it is simply
"open another one." This is what makes genuinely parallel emulator work reachable while keeping a
single stable tool surface.

Two guardrails the implementation must honour:

- The handle parameter is **optional while exactly one instance is open, required beyond that**.
  Optional-always invites an agent to omit it and silently clobber a sibling's emulator.
- Handles, not ports, are the naming key for snapshots. The old convention of prefixing snapshot
  names with the port breaks once ports are recycled across sessions.

## Researched Claude Code mechanics (two rounds, 2026-07-31)

These are the facts the design rests on. Confidence tags are the researcher's.

| # | Finding | Confidence |
|---|---|---|
| 1 | MCP server definitions are read **once at session start**. A running session cannot load a newly-added server; `/mcp` only reconnects/authenticates already-loaded ones — there is no "add" flow | HIGH |
| 2 | Per-session config is possible only via `claude --mcp-config <file> --strict-mcp-config` at launch | HIGH |
| 3 | The **VS Code extension cannot pass those flags**. Its settings control extension behaviour, not CLI flags into the session. No documented escape hatch | HIGH |
| 4 | Stdio MCP servers are spawned as **one subprocess per session**. Two concurrent sessions in one project → two subprocesses. No daemon, no multiplexing | HIGH |
| 5 | **Subagents spawn no new subprocess.** They are additional model loops in the same session process; their MCP calls route over the parent's already-initialised connections. `isolation: "worktree"` swaps the filesystem view, not the MCP wiring. Nested subagents follow the same rule | HIGH |
| 6 | Spawn is **eager**, at session start — not lazy on first tool call | HIGH |
| 7 | Stdio servers are **not auto-reconnected** if they die mid-session. HTTP/SSE reconnect with backoff; stdio stays dead | HIGH |
| 8 | Termination ladder is stdin EOF → SIGTERM → SIGKILL with short grace periods. Graceful cleanup runs; abrupt client death (killed window, crash) gets **no** cleanup | MEDIUM |
| 9 | `${VAR}`/`${VAR:-default}` expansion is documented for `.mcp.json` `command`/`args`; **undocumented for `url`** | MEDIUM |
| 10 | Project-scope servers need approval; `enableAllProjectMcpServers` / `enabledMcpjsonServers` / `disabledMcpjsonServers` control it. Changing a `url` invalidates prior approval | HIGH |
| 11 | Plugin-bundled MCP servers get the longer `mcp__plugin_<plugin>_<server>__*` prefix — visible in this repo's own agent definitions, which list both `mcp__context7__*` and `mcp__plugin_context7_context7__*` | MEDIUM |
| 12 | No documented tool-count or proxy-specific limits. `MCP_TIMEOUT`, `MCP_TOOL_TIMEOUT`, `MAX_MCP_OUTPUT_TOKENS` exist; responses over ~25K tokens spill to disk | MEDIUM |

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
  ("who holds 6511"), not as the key.
- **(5) also creates the parallelism problem** that instance handles solve, above.
- **(6) requires deferred acquisition.** Eager spawn means a proxy that requests an emulator on
  startup launches one for every session, including sessions that never touch VICE. Enumerate tools
  without an emulator (from a manifest, or a schema baked in at build time); request on first
  `tools/call`.
- **(6)+(12) would put cold start on the first tool call** — `x64sc` launch + C64 boot + MCP-ready is
  seconds, and because acquisition is deferred past `initialize`, the wait lands against
  `MCP_TOOL_TIMEOUT` rather than the startup timeout. **Warm spares move it off that path**; see
  below. The cold path still needs an explicit "warming, retry" rather than a silent hang, but it is
  no longer the common case.
- **(7) makes "never throw" a hard requirement.** The proxy must catch everything and always answer
  in MCP frames. A crashed proxy is unrecoverable for the rest of the session.
- **(8) makes the host sweeper mandatory** — see the shutdown section.
- **(12) puts chunking at the proxy.** A 64K RAM read is exactly the shape that trips the output
  limit.

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
- `.planning/todos/pending/spike-stdio-mcp-proxy-lifecycle.md` — the echo-proxy spike that promotes
  findings 8 and 12 from MEDIUM before any of this is built.
- `WINDOWS.md` window #1 — the unverified host-side multi-instance launch.
