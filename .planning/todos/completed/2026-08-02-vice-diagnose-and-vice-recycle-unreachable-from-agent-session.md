---
category: tooling
priority: major
date: 2026-08-02
source: 01.3-05 (bounded trigger hunt), first live tool calls of the session
---

# `vice_diagnose` and `vice_recycle` are unreachable from this agent session's own tool surface, even though the running proxy's code has both fully wired

## Problem

Phase 01.3 plans 01.3-01 and 01.3-02 added two proxy-local synthetic MCP tools, `vice_recycle` and
`vice_diagnose`, to `.claude/mcp/vice/vice-proxy.mjs`. Both are fully wired: `handleToolsList()`
concatenates `RECYCLE_TOOL`/`DIAGNOSE_TOOL` onto the manifest-derived tool array, and
`handleToolsCall()` dispatches on `name === RECYCLE_TOOL.name` / `name === DIAGNOSE_TOOL.name`
before any forwarding logic runs. `node --test .claude/mcp/vice/*.test.mjs` passes 268/268,
including the structural tests that assert both tools appear in a live `tools/list` response and
are absent from `tools-manifest.json`.

None of that reaches this agent session. Plan 01.3-05 (the bounded trigger hunt) needs both tools
for every attempt — `vice_diagnose` for the verdict, `vice_recycle` for in-place recovery from a
genuine wedge — and neither was reachable, before a single attempt could be run.

## What was checked

- `mcp__vice__vice_ping`, a normal named per-tool function, works and returns a real result: the
  session's connection to `vice-proxy.mjs` is live and healthy.
- No named `mcp__vice__vice_diagnose` or `mcp__vice__vice_recycle` function exists in this session,
  and a tool-schema search for either name (or for the older, already-proven `vice_result_continue`)
  finds nothing.
- This session does expose two generic tools, `tools_list` and `tools_call` (both under the
  `mcp__vice__` prefix). Using them as a fallback:
  - `tools_list` returns a flat 64-tool set that **includes `vice_disk_list`** (which must never
    appear in any `tools/list` response — this is exactly what layers 2 and 3 of the four-layer
    deny-list guard exist to prevent) and includes **none** of the three proxy-local synthetic
    tools (`vice_result_continue`, `vice_recycle`, `vice_diagnose`).
  - `tools_call({name:"vice_ping"})` succeeds normally.
  - `tools_call({name:"vice_recycle"})`, `tools_call({name:"vice_diagnose"})` and
    `tools_call({name:"vice_result_continue"})` all three fail identically:
    `vice-proxy: the host VICE MCP server ... rejected this call: Tool not found` — this is the
    exact wording `aliveButFailedMessage()` emits when the **real x64sc host** rejects a forwarded
    call, meaning the literal tool name was forwarded straight to the host rather than intercepted
    proxy-side.
- Ruled out a stale-file/stale-process explanation directly: the running `vice-proxy.mjs` process's
  cwd (`/proc/<pid>/cwd`) is `/workspaces/bruce_lee` (the main workspace checkout, not this
  worktree); `grep -c "DIAGNOSE_TOOL\|RECYCLE_TOOL" .claude/mcp/vice/vice-proxy.mjs` there returns 6
  hits at the identical line numbers as this worktree's own copy, and the file's mtime predates the
  running process's start time (derived from `/proc/<pid>/stat` against `/proc/uptime`). The process
  loaded fully-wired code. The code is not the problem.

## Leading hypothesis (not confirmed further — this is where the investigation stopped, per D-11)

This session's set of directly-callable named `mcp__vice__vice_*` tool functions looks like it was
generated from a snapshot that structurally cannot include proxy-local synthetic tools —
consistent with the project's own Key Finding 3 (`01.3-RESEARCH.md`), which confirms
`tools-manifest.json` never contains them by design (`refresh-manifest.mjs` only ever writes real,
forwardable host tools straight from the live host's own `serverInfo()` handshake). If whatever
harness mechanism generates this session's per-tool function stubs reads that manifest file rather
than issuing a live `tools/list` JSON-RPC call through `vice-proxy.mjs`'s own `handleToolsList()`,
it would produce exactly this result — and would do so for every proxy-local synthetic tool this
project ever adds, not just the three checked here. This is a harness/session tool-discovery
question, outside this project's own tree, so it was not pursued further.

## Consequence

Plan 01.3-05 could not run a single live attempt this session. Recorded honestly in
`01.3-TRIGGER-HUNT.md` as a 0/6 denominator with the reason, per the plan's own explicit
"if the emulator cannot be reached at all... record that as the outcome, name it, and stop"
contingency — generalized here from broker-absence to this synthetic-tool-unreachability shape,
which the plan text does not name explicitly but which blocks the hunt identically.

## Suggested next step

Before re-dispatching plan 01.3-05 (or any future plan that depends on a proxy-local synthetic
tool), confirm from a fresh session whether `vice_diagnose`/`vice_recycle` are reachable — either
as named functions or via a `tools/list` call that is confirmed to route through
`handleToolsList()` rather than a static manifest snapshot. If the harness supports refreshing its
tool-discovery cache independently of restarting `vice-proxy.mjs` itself, that is the fix to try
first, since the running process's own code was already confirmed correct and current.

## RESOLVED 2026-08-04 (quick task 260804-dbf)

This todo's own "Suggested next step" was to confirm from a fresh session whether the two tools
are reachable. Done, in a session dated 2026-08-04:

| Check | 2026-08-02 | 2026-08-04 |
|---|---|---|
| Named `mcp__vice__vice_diagnose` exists in the session tool surface | absent | **present** |
| Named `mcp__vice__vice_recycle` exists | absent | **present** |
| The call is intercepted proxy-side rather than forwarded | **no** — host replied `Tool not found` | **yes** |

**The error shape is the load-bearing evidence, and it is this todo's own diagnostic.** On
2026-08-02 the reply was `vice-proxy: the host VICE MCP server ... rejected this call: Tool not
found`, which this todo correctly read as proof that the literal tool name had been forwarded to
the host instead of intercepted. Calling `mcp__vice__vice_diagnose` on 2026-08-04 instead returns:

```
vice-proxy: the on-demand VICE broker has never been started on this host -- no broker.json
record exists at all. Start it on the host with: .../tools/vice-launcher.sh
```

That message is proxy-local and tool-specific. Only `handleToolsCall()` dispatching on
`DIAGNOSE_TOOL.name` before any forwarding logic can produce it — a forwarded call cannot, because
the host has no such tool to report a broker state for. So both halves are now true: the harness
generates named stubs for proxy-local synthetic tools, **and** the proxy intercepts them.

The leading hypothesis recorded above — that the session's tool stubs were generated from a
`tools-manifest.json` snapshot that structurally cannot contain synthetic tools — is therefore no
longer the operative situation, whatever changed in the harness. It is left unedited above as the
record of what was true on 2026-08-02.

### Not verified

That `vice_diagnose` returns a **correct verdict**. The host broker is not running in this session,
so no cycle bracket could be measured and no five-state verdict was exercised. Reachability and
proxy-side interception are proven; behaviour is not. A session with the broker up should confirm
the verdict path before anything depends on it.

### Also unresolved, and deliberately not folded in here

This todo separately recorded that `tools_list` returned a flat 64-tool set that **included
`vice_disk_list`**, which the four-layer deny-list guard exists to prevent. That was not re-tested
on 2026-08-04 — `tools_list` was skipped as too verbose for the question at hand — so it stays an
open claim. It is a deny-list-guard question, not a synthetic-tool-reachability one, and should not
be treated as closed by this resolution.

**Evidence:** live tool call in this container, 2026-08-04, compared against the verbatim error
wording recorded in this todo on 2026-08-02.
**Confidence:** HIGH for reachability and interception. The unverified verdict path and the
`vice_disk_list` leak are named above rather than assumed.
