# Spike Manifest

## Idea

Promote the four MEDIUM, load-bearing findings about Claude Code's stdio-MCP lifecycle to HIGH
confidence (or correct them) before Phase 01.2 builds the on-demand host broker and per-session
leasing on top of them. The design in `.planning/notes/vice-mcp-selector-design.md` rests on twelve
researched facts; eight are HIGH from docs, four are MEDIUM and unverified. If any of the four is
wrong, 01.2 changes *shape* rather than needing a patch — most acutely the shutdown grace window,
which decides whether automatic lease release on session end is achievable at all or whether release
becomes sweeper-only.

The instrument is a throwaway echo proxy: a stdio MCP server that talks to nothing, exposes one
trivial tool, and appends a timestamped, pid-tagged JSONL line on every lifecycle event. It is
registered through a scratch `--mcp-config` under `--strict-mcp-config`, so the project's real
`.mcp.json` and the real `vice` proxy are never touched.

Spike source: `.planning/todos/pending/spike-stdio-mcp-proxy-lifecycle.md` (11 observation rows).
Gates: **Phase 01.2 — On-Demand Broker and Per-Session Leasing**.

## Requirements

Design decisions that emerged during spiking. Non-negotiable for the Phase 01.2 build.

- **Measurement is headless-CLI-based; the extension gap is documented, not closed.** Every finding
  records whether it was observed in `claude -p` print mode only, and therefore whether it could
  differ under the VS Code extension. Chosen deliberately over blocking on manual IDE cross-checks.
  (User choice, 2026-07-31.)
- **The real `.mcp.json` is never modified by a spike.** All registration goes through a scratch
  config file plus `--strict-mcp-config`. A spike must not be able to break this session's own
  emulator access.
- **The teardown trigger the proxy keys on must be whatever was actually observed, not the
  documented ladder.** The first probe already showed SIGINT arriving first with stdin never closing
  — a release handler wired only to stdin `end`/`close` would never have fired.
- **Every row of the source todo gets a recorded observation with the command used and the raw log
  excerpt.** A finding without its log excerpt is not a finding.
- **Findings that contradict the design note are written back into the note in the same change.**
  A stale design note is worse than no design note.
- **Release must be wired to BOTH signal handlers and stdin `end`/`close`.** Measured in spike 002:
  a graceful ending delivers SIGINT and never closes stdin; abrupt client death closes stdin and never
  signals. Each path fires only one of the two, so either handler alone misses an entire class of
  session ending.
- **Nothing but one synchronous filesystem operation goes in the shutdown handler.** The graceful
  window is ~490ms (spike 002, three identical runs). `unlinkSync` uses ~0.1ms of it; a host round trip
  would not reliably fit.
- **SIGINT must be treated as a teardown trigger, not ignored as a user Ctrl-C.** It is the *first*
  signal every graceful teardown delivers.
- **The lease records `CLAUDE_CODE_SESSION_ID` as diagnostic metadata.** Spike 001 found the client
  exports it (plus `CLAUDE_PID`) into the MCP server's environment. It is not the lease *key* — one
  subprocess per session means process identity already is session identity — but it makes "who holds
  this instance" answerable.

## Spikes

| # | Name | Type | Validates | Verdict | Tags |
|---|------|------|-----------|---------|------|
| 001 | echo-proxy-lifecycle-harness | standard | Given an instrumented echo proxy in a scratch `--strict-mcp-config`, when two concurrent sessions run and one spawns a subagent and a `worktree`-isolated agent, then the log shows exactly one pid per session, no additional pid for subagents or worktree agents, and a spawn line before any `tools/call` | **VALIDATED** ✓ | mcp, lifecycle, harness, process-identity |
| 002 | shutdown-grace-window | standard | Given a shutdown handler that busy-writes 10ms progress markers, when a session ends gracefully and when it is killed abruptly, then the log yields the real signal order and the number of ms of synchronous work that completes before death — proving or refuting that a synchronous `unlinkSync` release lands | **VALIDATED** ✓ | mcp, lifecycle, shutdown, leasing, design-critical |
| 003 | timeout-budgets | standard | Given handlers that sleep in increasing increments, when `initialize` and `tools/call` are delayed and a session sits idle past 30 minutes, then the log shows where the startup and tool-call budgets cut off and whether anything reaps an idle proxy | PENDING | mcp, lifecycle, timeouts |
| 004 | large-response-chunking | standard | Given a tool returning a payload over ~25K tokens, when a session calls it, then the observed truncation/spill behaviour decides whether chunking must live in the proxy for 64K RAM reads | PENDING | mcp, output-limits, chunking |
