---
name: vice-session
description: Drive the host's VICE emulator from this container — acquire a leased session, discover and call the vice_* tools, inspect C64 memory and machine state. Use for any emulator, VICE, x64sc, C64 debugging, memory-inspection, checkpoint or snapshot task, and whenever a vice_* tool is needed.
---

# Driving VICE from this container

```bash
node .claude/skills/vice-session/scripts/vice.mjs session acquire        # lease an instance, start a session
node .claude/skills/vice-session/scripts/vice.mjs ping                   # server version, machine, execution state
node .claude/skills/vice-session/scripts/vice.mjs tools                  # every vice_* tool, one line each
node .claude/skills/vice-session/scripts/vice.mjs tools NAME              # a tool's full input schema
node .claude/skills/vice-session/scripts/vice.mjs call TOOL '{"k":"v"}'   # invoke any vice_* tool, print its JSON result
node .claude/skills/vice-session/scripts/vice.mjs session status          # read-only session report, no emulator touched
node .claude/skills/vice-session/scripts/vice.mjs session release         # free the lease, end the session
node .claude/skills/vice-session/scripts/vice.mjs pool status             # launched/alive/leased/supervised per instance
```

No `mcp__vice__*` tool is available in this project. `.claude/skills/vice-session/scripts/vice.mjs`
is the only route to the emulator — the deny-list, restart detection and pool
leases all live in that one seam, and a direct MCP call would bypass every
one of them.

## Copying this skill elsewhere

This skill directory is self-sufficient and can be copied into another
project as one unit.

```bash
node .claude/skills/vice-session/scripts/vice.mjs install          # status of the deployed host-side scripts, no changes made
node .claude/skills/vice-session/scripts/vice.mjs install --force  # restore them
```

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
node .claude/skills/vice-session/scripts/vice.mjs tools           # every tool: name + one-line description
node .claude/skills/vice-session/scripts/vice.mjs tools memory    # every tool whose name contains "memory"
node .claude/skills/vice-session/scripts/vice.mjs tools vice_memory_read   # full input schema: params, types, required, enum/default
```

## `vice_disk_list` is forbidden, always

It crashes the shared host VICE MCP server, and recovery costs a host-side
restart. Two independent layers keep it out of reach: `tools` never lists it
(`serverInfo()` strips it from discovery), and `call()` refuses it before a
request is serialised. Never reach for it by name anyway — not to test the
guard, not "just to check". Read `.d64` bytes directly, or use
`vice_disk_read_sector`.

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

These run on the host workspace, never in this container. `tools/vice-pool.sh`
is deployed automatically from this skill's `resources/` the first time any
`.mjs` file here runs — a fresh clone has no `tools/` scripts until then.

## Four questions, four mechanisms

"The registry says this port exists" is not the same as "this port is
usable right now" — a pool answers four SEPARATE questions, never collapsed
into one:

| Question | Answered by |
|---|---|
| LAUNCHED | `registry.json` (written by `tools/vice-pool.sh start`, host-only) |
| ALIVE | a real `vice_ping` this instant (`vice-probe.mjs`'s `probeAll()`) — never assumed from LAUNCHED |
| FREE | the instance's lease file (`leaseInfo()`) — an instance can be alive-but-leased, which is not the same as dead |
| SUPERVISED | that instance's own `epoch.json` (`readEpoch()`) — present/absent, and whether it has moved since a prior observation |

`acquire()` probes ALIVE before leasing anything, so a registered-but-dead
instance is skipped rather than handed out. `node .claude/skills/vice-session/scripts/vice.mjs pool status`
prints all four per instance, container-side, plus a diagnosis; run it any
time liveness (not just launch/lease/supervision state) needs checking.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `session ... expired at ... -- refusing to fall back to the default instance silently` | `node .claude/skills/vice-session/scripts/vice.mjs session release` then `session acquire` again. |
| `transport error` / `ECONNREFUSED` / timed out after retries | The host VICE MCP server is down or unreachable from this container. Recovery is host-side (`tools/vice-supervisor.sh`, deployed from this skill's `resources/` — see above); this container cannot restart it. |
| `acquire: no free instance within Nms -- every candidate rejected: ...` | Read the per-candidate reasons in the message: "no answer" means dead (see the next two rows), "leased by pid ... " means busy — wait, or check `pool status`/`tools/vice-pool.sh status` for a leak. |
| A registered instance that does not answer (`pool status` shows `alive:no`) | LAUNCHED does not imply ALIVE. `acquire()` already skips it automatically; `pool status`'s diagnosis says whether it's unsupervised, unproven, a dead supervisor, or mid-respawn — follow that fix directly rather than guessing. |
| `pool status` diagnosis says `DEAD SUPERVISOR` (epoch unchanged across two probes on a dead port) | The host-side supervisor for that instance died too — a live one would have respawned VICE and bumped the epoch. Restart it on the HOST (`tools/vice-supervisor.sh`, deployed from this skill's `resources/`); this container cannot. |
| `the emulator restarted since this session was acquired -- epoch changed from X to Y` | The host respawned VICE mid-session. This session's results are suspect: `session release` then `session acquire` and redo the affected work. |
| A session lease that nobody released | `session status` reports time-to-expiry; a session lease self-frees on TTL expiry even if nobody explicitly releases it, so a leaked one is not permanent. |
