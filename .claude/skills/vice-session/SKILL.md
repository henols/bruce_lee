---
name: vice-session
description: Drive the host's VICE emulator from this container — acquire a leased session, discover and call the vice_* tools, inspect C64 memory and machine state. Use for any emulator, VICE, x64sc, C64 debugging, memory-inspection, checkpoint or snapshot task, and whenever a vice_* tool is needed.
---

# Driving VICE from this container

```bash
node .claude/skills/vice-session/vice.mjs session acquire        # lease an instance, start a session
node .claude/skills/vice-session/vice.mjs ping                   # server version, machine, execution state
node .claude/skills/vice-session/vice.mjs tools                  # every vice_* tool, one line each
node .claude/skills/vice-session/vice.mjs tools NAME              # a tool's full input schema
node .claude/skills/vice-session/vice.mjs call TOOL '{"k":"v"}'   # invoke any vice_* tool, print its JSON result
node .claude/skills/vice-session/vice.mjs session status          # read-only session report, no emulator touched
node .claude/skills/vice-session/vice.mjs session release         # free the lease, end the session
```

No `mcp__vice__*` tool is available in this project. `.claude/skills/vice-session/vice.mjs`
is the only route to the emulator — the deny-list, restart detection and pool
leases all live in that one seam, and a direct MCP call would bypass every
one of them.

## Self-contained for the container side only

This skill directory (`repo-root.mjs`, `vice.mjs`, `vice-pool.mjs`,
`vice-session.mjs`, `vice-pool.test.mjs`) is everything needed for the
CONTAINER half of driving VICE, and can be copied into another project as a
unit. But the HOST half — `tools/vice-supervisor.sh`, `tools/vice-pool.sh`
and `tools/lib/container-guard.sh` — deliberately remains in `tools/` at the
repo root, not in this directory, and **must be copied alongside this skill**
for restart detection and the instance pool to work at all. Copying only
this directory gets you a client with nothing to talk to.

The invariant that makes the two halves work together: the shell scripts
resolve the repo root one level up from `tools/`
(`REPO_ROOT="$(cd "$(dirname "$SELF_PATH")/.." && pwd)"`); the Node modules
here resolve it via `repo-root.mjs` — `CONTAINER_WORKSPACE_PATH` when it
contains the caller, otherwise the nearest ancestor with a `.git` entry. Both
must land on the same `.vice-supervisor` directory, or restart detection
silently stops working with no error anywhere. `tools/vice-supervisor.sh
--print-paths` and `tools/vice-pool.sh --print-paths` print the resolved
paths (no side effects) so this can be checked directly.

## Sessions

Acquire a session at the start of emulator work, release it at the end. The
session lives in a **file**, not the shell, so it survives across separate
commands — a shell's environment does not persist between Bash invocations,
but a file does. With no session acquired, every command still works
against the default instance; acquiring one is optional, not required.

## Discovering tools

Removing the MCP registration removes the typed tool schemas Claude Code
used to read automatically. Use `tools` instead:

```bash
node .claude/skills/vice-session/vice.mjs tools           # every tool: name + one-line description
node .claude/skills/vice-session/vice.mjs tools memory    # every tool whose name contains "memory"
node .claude/skills/vice-session/vice.mjs tools vice_memory_read   # full input schema: params, types, required, enum/default
```

## `vice_disk_list` is forbidden, always

Never call `vice_disk_list`, under any circumstance — not to test the
deny-list live, not "just to check". It crashes the shared host VICE MCP
server and recovery needs a manual host-side restart.
`.claude/skills/vice-session/vice.mjs` refuses it before any request is even
sent, and `tools` renders it FORBIDDEN rather than as a callable option.

## Every state-reading call pauses the machine

`vice_registers_get`, `vice_checkpoint_list`, and every other state-reading
call **pauses the emulator and does not resume it**. `vice_ping` is the one
exception — measured non-pausing. A poll/wait loop that reads state
repeatedly without re-resuming will crawl to a fraction of real speed; write
it as read → `vice_execution_run` → wait, not read → wait → read.

## Snapshot names carry the instance's port

`vice_snapshot_save` takes only a `name`, not a path, and writes into a
**shared host directory** — two instances saving the same run label would
silently overwrite each other. Prefix every snapshot name with the leased
instance's port, unconditionally, the same way `tools/recover.mjs`'s
`snapshotName(port, releaseId, runLabel)` already does.

## Pool commands (host-only)

```bash
tools/vice-pool.sh start 3      # HOST-ONLY -- launch N supervised instances
tools/vice-pool.sh status
tools/vice-pool.sh stop
```

These run on the host workspace, never in this container.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `session ... expired at ... -- refusing to fall back to the default instance silently` | `node .claude/skills/vice-session/vice.mjs session release` then `session acquire` again. |
| `transport error` / `ECONNREFUSED` / timed out after retries | The host VICE MCP server is down or unreachable from this container. Recovery is host-side (`tools/vice-supervisor.sh`); this container cannot restart it. |
| `acquire: no free instance within Nms -- every candidate port is held` | Every pooled instance is leased. Wait, or check `tools/vice-pool.sh status` (host-only) for a leak. |
| `the emulator restarted since this session was acquired -- epoch changed from X to Y` | The host respawned VICE mid-session. This session's results are suspect: `session release` then `session acquire` and redo the affected work. |
| A session lease that nobody released | `session status` reports time-to-expiry; a session lease self-frees on TTL expiry even if nobody explicitly releases it, so a leaked one is not permanent. |
