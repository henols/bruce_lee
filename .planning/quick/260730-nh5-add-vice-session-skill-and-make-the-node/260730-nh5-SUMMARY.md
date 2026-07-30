---
status: complete
quick_id: 260730-nh5
date: 2026-07-30
commits:
  - 4f768ce
  - ac642bc
  - 3d814a4
authored_by: orchestrator
---

# Quick Task 260730-nh5 — Summary

**Task:** Add VICE session skill and make the Node seam the only path to the emulator.

## Provenance of this file

The gsd-executor completed and committed all three plan tasks, then terminated on an
API error (`Connection closed mid-response`) before writing its own SUMMARY. This
summary was authored by the orchestrator from the committed state plus independent
verification — it is not the executor's own report. Everything claimed below was
re-checked directly rather than taken from the executor's output.

## What shipped

| Commit | Task |
|--------|------|
| `4f768ce` | Session file + `kind:"session"` lease, end-to-end through the CLI |
| `ac642bc` | TTL refresh-on-use, cross-invocation epoch guard, tool-discovery verb |
| `3d814a4` | `vice-session` skill, empty `.mcp.json`, session workflow docs |

**New:** `tools/vice-session.mjs`, `tools/vice-session.test.mjs`,
`.claude/skills/vice-session/SKILL.md`
**Modified:** `tools/vice.mjs` (session verbs, session-aware `ping`/`call`, `tools`
discovery verb), `tools/vice-pool.mjs` (session lease kind, session-first
`isReclaimable`), `.mcp.json` (emptied), `tools/README.md` (§6 Sessions and tool
discovery)

## Verified independently

- **60/60 tests pass** across `recover.test.mjs`, `vice-pool.test.mjs`,
  `vice-session.test.mjs`.
- **`DENY_LIST` intact** — `vice_disk_list` still refused before serialisation.
- **Backwards compatibility** — with no session file and no registry,
  `session status` reports `no active session (session file absent)` and the
  transport falls back to port 6510. No error, zero config, as before.
- **Cross-process session handover** — `session acquire` in one process is read
  correctly by `session status` in a *separate* process. This is the whole point of
  the file-based design: shell env does not survive between the agent's Bash calls.
- **TTL refresh-on-use is live** — the recorded expiry advanced between two
  consecutive invocations (`…34.535Z` → `…34.589Z`), confirming the timestamp is
  rewritten on each use rather than fixed at acquire time.
- **Session-resolved endpoint appears in failures** — with VICE down, the error
  reads `failed after 5 transport attempts against http://host.docker.internal:6510/mcp
  (port 6510)` and directs the reader to run `tools/vice-supervisor.sh` on the host.
  The endpoint is named from the resolved session, not a hardcoded default.

## Not verified — needs a live emulator

The host VICE MCP server was **down for the entire execution window** (connect
refused; the host supervisor process itself was no longer running, epoch frozen at 3
with no crash-log entry past epoch 2). The plan anticipated this with a two-branch
live probe and the refused branch was taken.

Consequently these remain unexercised against a real server:

- `tools/vice.mjs tools` — the discovery verb's actual schema rendering. It fails
  cleanly when the server is absent, but its output format has never been seen.
- A read-only `call` through a session against a live instance.
- Whether the discovery output is genuinely sufficient for an agent to compose a
  correct tool call without the MCP schemas — the stated justification for removing
  the registration. **This is the load-bearing unknown of this task.**

Run these once the supervisor is back up on the host.

## Consequence to be aware of

`.mcp.json` is now `{"mcpServers": {}}`. The `vice_*` MCP tools disappear from the
agent's surface at the next MCP client reload. Until that reload the old tools may
still appear and still work — they simply bypass every guard, which is the situation
this task exists to end. The exact JSON to restore the registration is documented in
`tools/README.md` §3; it is a one-step revert.
