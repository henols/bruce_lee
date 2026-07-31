---
title: Emulator access moves to a per-session stdio MCP proxy — and the Claude Code mechanics that decide its shape
date: 2026-07-31
context: /gsd-explore on removing the non-functional vice-session skill and replacing it with a vice-mcp-selector skill; includes two rounds of researched Claude Code MCP behaviour that constrain the design
---

# The `vice-session` skill is being replaced by a per-session MCP proxy

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

One **static** `.mcp.json` entry, committed once by hand, never rewritten:

```json
{ "mcpServers": { "vice": {
    "command": "node",
    "args": [".claude/skills/vice-mcp-selector/scripts/vice-proxy.mjs"] } } }
```

`vice-proxy.mjs` is simultaneously an MCP **server** (JSON-RPC over stdin/stdout to Claude Code)
and an MCP **client** (streamable HTTP to `http://host.docker.internal:<port>/mcp`). Claude Code
spawns one copy per session. It answers `initialize` and `tools/list` immediately, and on the
first real `tools/call` it reads the pool registry, claims a free instance, writes a lease, and
forwards that call and all later ones to that port.

Tools surface as `mcp__vice__memory_read` — a stable name, independent of which physical emulator
is behind it.

### What this buys

| Property | How the proxy delivers it |
|---|---|
| Stable tool names | One server name forever; no `vice_1`/`vice_2` variants leaking into agent definitions or docs |
| Approval survives | A server's `url` change re-triggers `.mcp.json` approval. A stdio entry has no `url`, and the file is never rewritten, so approval is granted once |
| Exclusivity is structural | A session cannot reach another instance because no tool for it exists. The "must select first" rule becomes a property of the wiring, not a convention |
| Release is automatic | Process lifetime *is* lease lifetime. Claude closes stdin at session end; the proxy releases on the way out |
| Single chokepoint for hazards | `vice_disk_list` can be refused at the proxy instead of remembered as a rule; the epoch can be re-checked on every call so a host restart fails loudly instead of silently returning blank-machine reads |

The last row matters most. Three of this project's live memory entries exist because a rule had to
be remembered rather than enforced. A proxy converts them into code.

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
- **(9) kills the env-var variant too**, independently of whether expansion works in `url`: env
  vars come from shared workspace settings, so every extension-launched session would resolve the
  same port. It cannot produce exclusivity.
- **(4)+(5) make the lease key the proxy process itself.** The initial research verdict claimed the
  key "must be session ID, not process ID," fearing release at first subagent exit — but by its own
  finding (5) nothing exits when a subagent finishes. One process per session, subagents ride it,
  so process identity *is* session identity. Record a session id in the lease as diagnostic
  metadata ("who holds 6511"), not as the key.
- **(6) argues for lazy leasing.** Eager spawn means a proxy that claims on startup burns an
  instance for every session, including ones that never touch the emulator. Enumerate tools without
  leasing (enumeration needs no exclusivity); claim on first `tools/call`.
- **(7) makes "never throw" a hard requirement.** The proxy must catch everything and always answer
  in MCP frames. A crashed proxy is unrecoverable for the rest of the session.
- **(7) also inverts the fragility argument in the proxy's favour.** The fragile component here is
  the host emulator, not a local Node process — see the pool's own note of six outages in one
  session (`tools/vice-pool.sh:33`). Registering the emulator's HTTP endpoint directly makes
  emulator death present as *MCP server death*, and the tools vanish. A live proxy turns it into a
  tool call returning a clean, handleable error, and can re-lease a healthy instance.
- **(8) keeps the TTL sweeper alive.** The graceful path releases; the SIGKILL path does not. The
  existing `leases/` directory and the old skill's `--ttl-min` idea stop being the primary
  mechanism and become the crash-recovery mechanism.
- **(12) puts chunking at the proxy.** A 64K RAM read is exactly the shape that trips the output
  limit.

## The unresolved fork: does the pool buy parallelism, or only isolation?

Finding (5) has a consequence that cuts against the pool's stated rationale.

`tools/vice-pool.sh:33` justifies the pool partly as throughput: *"N instances interleave and
scaling is near-linear."* That assumed several actors could each hold an instance. But if subagents
and worktree executors all share one session process — and therefore one proxy, and therefore one
lease — then **a parallel wave inside a single session cannot use more than one emulator.** The
pool would serve concurrent *sessions* (separate windows/terminals) and nothing else.

This is a genuine architectural fork:

| | Per-session proxy (one `vice` entry) | N registered servers (`vice-1..vice-N`) |
|---|---|---|
| Tool names | Stable | Instance-specific, leak into agent defs |
| Exclusivity | Structural | Advisory; needs a `PreToolUse` hook to enforce |
| Approval churn | None | Re-prompts whenever a port moves |
| Intra-session parallel emulator work | **Impossible** — one proxy, no way to tell subagents apart | **Possible** — different subagents told to use different server names |
| Hazard chokepoint | Yes | No |

MCP gives the proxy no way to distinguish which subagent is calling, so the middle row is not a
detail to engineer around — it is a property of the transport.

Whether that loss matters depends on a constraint already in `ROADMAP.md`:

> **VICE is a single shared host instance reached only over MCP** — `parallelization: true` does
> **not** extend to emulator work. Any two plans that both drive VICE must be serialised.

If that constraint stands, the proxy's limitation is not a cost — it *enforces* the constraint
structurally, which is strictly better than documenting it. If the pool exists to **lift** that
constraint and get genuinely parallel emulator work across a wave of executors, the proxy blocks
the goal and the N-server design is the right answer despite its costs.

**This is the first question the implementing phase must answer.** It is not settled by this note.

## Related open policy question

`.planning/seeds/vice-pool-contention-and-starvation.md` holds the starvation question ("a busy
holder never yields"). The proxy resolves that seed's *blocker* for free — the single shared
`session.json` that made actor #2 fail instantly stops existing, because each proxy process holds
its own lease. The seed's actual policy question survives untouched, and its actor-class analysis
needed correcting against finding (5); see the correction appended to that file.
