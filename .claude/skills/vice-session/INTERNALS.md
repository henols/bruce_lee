# vice-session — maintainer notes

This records how the skill is built, for whoever maintains it. Nothing here
is needed to use the skill — see `SKILL.md` for that.

## Self-contained for both halves

This skill directory carries BOTH halves of driving VICE and can be copied
into another project as a single unit — copying it alone is now sufficient.
The CONTAINER half is the Node modules in this skill's `scripts/` directory
(`repo-root.mjs`, `vice.mjs`, `vice-pool.mjs`, `vice-probe.mjs`,
`vice-session.mjs`, `vice-pool.test.mjs`, `install-resources.mjs`). The HOST half —
`vice-supervisor.sh`, `vice-pool.sh` and `lib/container-guard.sh` — lives
tracked in `.claude/skills/vice-session/resources/`, and is deployed automatically into `tools/` at the
repo root the FIRST TIME any of this skill's `.mjs` files runs (`ensureResourcesInstalled()`,
triggered from `repo-root.mjs`). `tools/` holds disposable, gitignored
deployed copies — not a second tracked copy that could drift out of sync
with `resources/`. An existing deployed copy is **never overwritten
automatically**, whatever its contents; run
`node .claude/skills/vice-session/scripts/vice.mjs install` for a per-entry status
report (missing/present/diverged) with no side effects, or
`... install --force` to deliberately restore every entry from `resources/`.

The invariant that makes the two halves work together: the shell scripts
(from EITHER `resources/` or their deployed `tools/` copy) resolve the repo
root via `resources/lib/repo-root.sh`'s `resolve_repo_root()`; the Node
modules resolve it via `repo-root.mjs`'s `repoRoot()`. Both follow the same
ladder — `CONTAINER_WORKSPACE_PATH` when it contains the caller, otherwise
the nearest ancestor with a `.git` entry, otherwise `CONTAINER_WORKSPACE_PATH`
regardless, otherwise a location-shaped last resort — and must land on the
same `.vice-supervisor` directory, or restart detection silently stops
working with no error anywhere. `--print-paths` on either script, from
either location, prints the resolved paths (no side effects) so this can be
checked directly — `resources/vice-supervisor.sh --print-paths` and
`tools/vice-supervisor.sh --print-paths` must always agree.

## Routing and enforcement

No `mcp__vice__*` tool is available in this project. `.claude/skills/vice-session/scripts/vice.mjs`
is the only route to the emulator — the deny-list, restart detection and pool
leases all live in that one seam, and a direct MCP call would bypass every
one of them.

## `vice_disk_list` is forbidden, always

It crashes the shared host VICE MCP server, and recovery costs a host-side
restart. Two independent layers keep it out of reach: `tools` never lists it
(`serverInfo()` strips it from discovery), and `call()` refuses it before a
request is serialised. Never reach for it by name anyway — not to test the
guard, not "just to check". Read `.d64` bytes directly, or use
`vice_disk_read_sector`.

## Snapshot naming implementation

`vice_snapshot_save` takes only a `name`, not a path, and writes into a
**shared host directory** — two instances saving the same run label would
silently overwrite each other. Prefix every snapshot name with the leased
instance's port, unconditionally, the same way `tools/recover.mjs`'s
`snapshotName(port, releaseId, runLabel)` already does.

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

## Troubleshooting internals

The symptom/fix table in `SKILL.md` intentionally hides these mechanics from
a caller; they are recorded here for whoever maintains the pool and
supervision layers.

| Symptom | Underlying mechanism |
|---|---|
| Session-expired refusal | The session file's TTL lapsed; the seam refuses to fall back to the default instance silently rather than risk operating against the wrong port. |
| `transport error` / `ECONNREFUSED` / timed out after retries | The host VICE MCP server is down or unreachable from this container. Recovery is host-side (`tools/vice-supervisor.sh`, deployed from this skill's `resources/`); this container cannot restart it. |
| `acquire: no free instance` | Every candidate was rejected; the message lists each one's reason ("no answer" = dead, "leased by pid ..." = busy). |
| `pool status` shows `alive:no` | LAUNCHED does not imply ALIVE. `acquire()` already skips it automatically; `pool status`'s diagnosis says whether it's unsupervised, unproven, a dead supervisor, or mid-respawn. |
| `pool status` diagnosis says `DEAD SUPERVISOR` | `epoch` unchanged across two probes on a dead port — the host-side supervisor for that instance died too; a live one would have respawned VICE and bumped the epoch. Restart it on the HOST. |
| `the emulator restarted since this session was acquired -- epoch changed from X to Y` | The host respawned VICE mid-session; this session's results are suspect. |
| A session lease that nobody released | `session status` reports time-to-expiry; a session lease self-frees on TTL expiry even if nobody explicitly releases it. |
