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
- **(6)+(12) put cold start on the first tool call.** `x64sc` launch + C64 boot + MCP-ready is
  seconds. Because acquisition is deferred past `initialize`, the wait lands against
  `MCP_TOOL_TIMEOUT`, not the startup timeout. The first call either completes inside budget or
  returns an explicit "warming, retry" — never a silent hang.
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
3. **What is the broker's own lifecycle?** Something has to start it, and it must survive host VICE
   restarts. If it must be started by hand, the "no host-side helpers" ergonomics regress relative
   to a pool that was also started by hand — this is a wash, but it should be a deliberate wash.
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
