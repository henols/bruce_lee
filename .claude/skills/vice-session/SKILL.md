---
name: vice-session
description: Drive the host's VICE emulator from this container — start a session, discover and call the vice_* tools, inspect C64 memory and machine state. Use for any emulator, VICE, x64sc, C64 debugging, memory-inspection, checkpoint or snapshot task, and whenever a vice_* tool is needed.
---

# Driving VICE from this container

```bash
node .claude/skills/vice-session/scripts/vice.mjs session acquire --ttl-min 30   # lease an instance and start a session (override the lease length with --ttl-min N)
node .claude/skills/vice-session/scripts/vice.mjs ping                            # server version, machine, execution state
node .claude/skills/vice-session/scripts/vice.mjs tools                           # every vice_* tool, one line each
node .claude/skills/vice-session/scripts/vice.mjs tools NAME                      # a tool's full input schema
node .claude/skills/vice-session/scripts/vice.mjs call TOOL '{"k":"v"}'           # invoke any vice_* tool, print its JSON result
node .claude/skills/vice-session/scripts/vice.mjs session status                  # this session's instance, port and expiry
node .claude/skills/vice-session/scripts/vice.mjs session release                 # free the lease, end the session
node .claude/skills/vice-session/scripts/vice.mjs pool status                     # launched/alive/leased/supervised per instance
```

Every emulator call goes through this script — there is no `mcp__vice__*` tool
in this project.

## Copying this skill elsewhere

This skill directory is self-sufficient and can be copied into another
project as one unit.

```bash
node .claude/skills/vice-session/scripts/vice.mjs install          # status of the deployed host-side scripts, no changes made
node .claude/skills/vice-session/scripts/vice.mjs install --force  # restore them
```

## Sessions

Acquire a session at the start of emulator work, release it at the end. It
survives across separate Bash calls, so a later command finds it without
re-acquiring. It is optional — every command works without one. `session
acquire` and `session status` both print the instance's port and the
expiry.

## Finding a tool

```bash
node .claude/skills/vice-session/scripts/vice.mjs tools           # every tool: name + one-line description
node .claude/skills/vice-session/scripts/vice.mjs tools memory    # every tool whose name contains "memory"
node .claude/skills/vice-session/scripts/vice.mjs tools vice_memory_read   # full input schema: params, types, required, enum/default
```

Add `--json` to any of these for machine-readable output.

## Calling a tool

`call` takes a tool name and a JSON argument object, and prints the JSON
result:

```bash
node .claude/skills/vice-session/scripts/vice.mjs call vice_memory_read '{"address":"$0400","length":40}'
```

## Polling while the machine runs

State-reading calls stop the machine, so write a wait loop as read →
`vice_execution_run` → wait — never read → wait → read. Use `vice_ping` for
the waiting step, since it reports state without stopping the machine. A
loop written this way runs the machine at full speed.

## Naming snapshots

`vice_snapshot_save` takes a name, not a path, and every instance writes
into the same host directory. Prefix each name with the active instance's
port — `session acquire`/`session status` printed it.

## Reading a disk

To inspect a disk's contents, parse the `.d64` bytes directly, or call
`vice_disk_read_sector` for the emulated drive's own view.

## Running several instances

```bash
tools/vice-pool.sh start 3      # HOST-ONLY -- launch N supervised instances
tools/vice-pool.sh status
tools/vice-pool.sh stop
```

These run on the host workspace, never in this container. If `tools/vice-pool.sh`
is not present yet, `vice.mjs install` puts it there.

`node .claude/skills/vice-session/scripts/vice.mjs pool status` is the
container-side view: it reports launched/alive/leased/supervised per
instance plus a diagnosis line — run it whenever an instance's usability is
in question.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Session-expired refusal message | `node .claude/skills/vice-session/scripts/vice.mjs session release`, then `session acquire` again. |
| `transport error` / `ECONNREFUSED` / timed out after retries | The host emulator is not reachable from this container; restart it on the host, then retry. |
| `acquire: no free instance` message | Read the per-candidate reason it prints (`no answer` = not running, `leased by pid ...` = busy); wait and retry, or run `pool status`. |
| `pool status` reports an instance as not alive | Follow the fix in its diagnosis line; `session acquire` already skips unusable instances on its own, so no action is needed to keep working. |
| The mid-session restart message (`... since this session was acquired`) | `session release`, then `session acquire`, then redo the affected work. |
| A session nobody released | `session status` prints time to expiry; it frees itself, so nothing to clean up. |

Running the script with no command prints the full usage, including the
environment variables that override the endpoint, the timeout and the
session TTL.
