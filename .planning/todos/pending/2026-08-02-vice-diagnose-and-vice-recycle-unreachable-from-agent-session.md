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
