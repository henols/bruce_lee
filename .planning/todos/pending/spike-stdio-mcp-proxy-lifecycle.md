---
title: Spike — confirm stdio MCP proxy lifecycle with a throwaway echo proxy before building vice-mcp-selector
date: 2026-07-31
priority: high
---

# Spike: prove the lifecycle assumptions, cheaply, before the real proxy exists

The `vice-mcp-selector` design (`.planning/notes/vice-mcp-selector-design.md`) rests on twelve
researched facts about Claude Code's MCP handling. Eight are HIGH confidence from docs. Four are
MEDIUM and **load-bearing** — if any is wrong, the design changes shape rather than needing a patch.

A ~50-line echo proxy answers all of them in one sitting. It does not need to talk to VICE at all:
it registers as a temporary `.mcp.json` entry, exposes one trivial tool, and writes a timestamped
append-only log line on every lifecycle event (`spawn`, `initialize`, `tools/list`, `tools/call`,
`stdin EOF`, `SIGTERM`, `exit`) tagged with its own pid.

Run it with `--strict-mcp-config` pointing at a scratch config so the real project `.mcp.json` is
untouched.

## What each observation decides

| Question | Observation | Decides |
|---|---|---|
| One subprocess per session? | Open two sessions in the same project; count distinct pids in the log | Whether the lease key can be the process. If sessions share a process, the whole exclusivity model collapses |
| Do subagents spawn their own? | From one session, spawn a subagent that calls the echo tool; check whether a second pid appears | Confirms finding 5, the correction now applied to `.planning/seeds/vice-pool-contention-and-starvation.md`, and the intra-session-parallelism fork |
| Worktree agents too? | Same, with `isolation: "worktree"` | Whether GSD executor waves share one instance |
| Eager or lazy spawn? | Start a session, call nothing, check for a `spawn` line with no `tools/call` | Whether leasing must be deferred to first call to avoid burning an instance per session |
| Is there an idle timeout? | Leave a session open and idle well past 30 minutes; watch for `SIGTERM`/`exit` | Whether a long documentation session silently loses its lease mid-session (MEDIUM, unverified) |
| Cleanup on graceful exit? | End the session normally; confirm a cleanup line lands after `stdin EOF` | Whether automatic release actually works |
| Cleanup on abrupt death? | Close the VS Code window / `kill -9` the session; check whether cleanup ran | Confirms the TTL sweeper is mandatory, not optional |
| Startup timeout budget | Have the proxy sleep N seconds before answering `initialize`; find where it is dropped | The real upstream-connect budget, vs the unconfirmed `MCP_TIMEOUT` default |
| Large-response handling | Return a >25K-token payload | Whether chunking must live in the proxy for 64K RAM reads |
| **How long is the shutdown grace window really?** | Have the handler write a marker, then busy-wait in ~100ms increments writing progress lines, and see how far it gets before SIGKILL | Whether a synchronous `unlinkSync` release reliably completes. If the window is shorter than assumed, release has to be even cheaper — or become sweeper-only |
| **First-call latency budget** | Have the tool handler sleep in increasing increments and find where `MCP_TOOL_TIMEOUT` cuts it off | The budget available to the *cold* path only — see the note below |

Two of these were added after the design shifted from a fixed pre-launched pool to an on-demand host
broker (see the design note).

**The grace-window row is the one that can still invalidate the design.** If the real window is
shorter than a synchronous `unlinkSync`, automatic release on session end is not achievable and
release becomes sweeper-only — a different design, not an adjustment.

**The latency row was downgraded by warm spares.** With the broker holding K boot-fresh instances
ready, cold start no longer sits on the common path, so this measurement now bounds only the cold
cases: the first call after the broker starts, and parallel waves that exceed K. Still worth
measuring — it sets the "warming, retry" threshold — but it can no longer reshape the design.

## Done when

Each row above has a recorded observation with the command used and the raw log excerpt, and the
four MEDIUM findings in the design note are re-tagged HIGH or corrected. Anything that contradicts
the design note gets written back there in the same change — a stale note is worse than no note.

## Why high priority

It gates the phase that replaces the emulator access layer, and every phase from 2 onward drives
VICE. Building the real proxy first and discovering the lifecycle is different means rewriting it,
not adjusting it.
