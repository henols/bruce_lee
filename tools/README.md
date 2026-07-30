# VICE MCP setup

Everything in this project that touches the emulator goes through a VICE instance
running **on the host**, exposed over HTTP as an MCP server. This document covers
getting that server built, launched, and wired into Claude Code.

The container never launches VICE. It only talks to it.

---

## 1. You need a custom VICE build

**Stock VICE will not work.** There is no `-mcpserver` flag in an upstream VICE
release, and no distro package provides one. The MCP server is a fork that embeds
the server inside the emulator itself:

> **https://github.com/barryw/vice-mcp**

Build it on the **host**, not in the devcontainer.

### Dependencies

Debian / Ubuntu:

```bash
apt install build-essential autoconf automake pkg-config \
            libmicrohttpd-dev libgtk-3-dev xa65 flex byacc \
            dos2unix libglew-dev libevdev-dev libcurl4-openssl-dev libpulse-dev
```

The last five are not in upstream's list but the build needs them on Debian
trixie, each failing partway through the build rather than at configure time
([upstream issue #8](https://github.com/barryw/vice-mcp/issues/8)).

macOS — upstream's list, not exercised here:

```bash
brew install autoconf automake pkg-config libmicrohttpd gtk+3 xa lame
```

### Build

```bash
git clone https://github.com/barryw/vice-mcp
cd vice-mcp/vice
./autogen.sh
mkdir build && cd build
../configure --enable-mcp-server --enable-gtk3ui
make -j$(nproc)
```

`--enable-mcp-server` is the flag that matters — without it you get a normal VICE
with no MCP surface. Install it, or put the resulting `x64sc` on your `PATH`.

Confirm the build has the flag before going further:

```bash
x64sc -help | grep mcpserver
```

If that prints nothing, the configure flag did not take effect and nothing below
will work.

---

## 2. Launching it

### Preferred: the supervisor

```bash
<host workspace>/tools/vice-supervisor.sh
```

The VICE MCP server has crashed repeatedly during checkpoint work, and each death
used to hard-block every emulator task until someone noticed. [`vice-supervisor.sh`](vice-supervisor.sh)
respawns `x64sc` when it dies, captures each crash's stderr and exit status as
evidence, and records a restart "epoch" the container-side harness reads to detect
that a restart happened. See [Restart detection](#4-restart-detection) below.

`Ctrl-C` stops it cleanly, terminating the child rather than orphaning it.

The script is **host-only** and refuses to run inside a container. To see the
guard's verdict without launching anything:

```bash
tools/vice-supervisor.sh --check-container   # exit 0 on a host, 3 in a container
tools/vice-supervisor.sh --help              # all env overrides and exit codes
```

### Bare, without supervision

```bash
x64sc -mcpserver -mcpserverhost 0.0.0.0
```

Equivalent for a single run, but a crash then stays dead until you restart it by
hand, and the crash evidence is lost.

---

## 3. Wiring it into Claude Code

**`.mcp.json` registers no server, on purpose.**
[`.claude/skills/vice-session/vice.mjs`](../.claude/skills/vice-session/vice.mjs)
is the *only* route from this container to the emulator (D-5) — every safety
mechanism this project has built (the `vice_disk_list` deny-list, restart/
epoch detection, pool leases) lives inside that one seam, and a direct
`mcp__vice__*` tool call bypasses every one of them completely. Registering
the server in `.mcp.json` would hand agents a second, unguarded path to the
same emulator, so the registration was removed rather than left as an
"advisory only" convention.

**Layout note:** `vice.mjs`, `vice-pool.mjs`, `vice-session.mjs` and their
test file moved from this directory into
[`.claude/skills/vice-session/`](../.claude/skills/vice-session/SKILL.md) so
the `vice-session` skill is self-contained and exportable, matching every
other skill in this project (`acme-build/acme.mjs`,
`devcontainer-host-path/hostpath.mjs`). The HOST-side launchers —
`tools/vice-supervisor.sh`, `tools/vice-pool.sh` and
`tools/lib/container-guard.sh` — deliberately **stayed here**: only the
container-side client half of this setup is a "skill" an agent invokes;
launching and supervising `x64sc` is a host operation with no analogue
inside the container. `tools/recover.mjs` (and its test file) also stayed,
importing the moved modules via the same cross-tree path
`devcontainer-host-path/hostpath.mjs` already used.

```json
{
  "mcpServers": {}
}
```

This takes effect only when the MCP client reloads (restart Claude Code, or
whatever picked up `.mcp.json` originally) — editing the file mid-session
does not retroactively revoke a connection already established.

**One-step revert**, if a future need genuinely requires the direct MCP
route back: paste this into `.mcp.json` in place of the empty object above,
then restart the MCP client.

```json
{
  "mcpServers": {
    "vice": {
      "type": "http",
      "url": "http://host.docker.internal:6510/mcp"
    }
  }
}
```

Transport is plain HTTP POST to `/mcp`. Two details in that block are
load-bearing.

### `-mcpserverhost 0.0.0.0` is mandatory from a devcontainer

VICE's MCP server binds **`127.0.0.1:6510`** by default. That is the host's own
loopback interface, which a container cannot reach — the connection is refused
before it leaves the container. `-mcpserverhost 0.0.0.0` makes it listen on all
interfaces so the container can connect at all.

This also means the emulator is reachable from anything else that can route to
your machine, with no authentication by default. On a trusted network that is
usually fine; on an untrusted one, it is not. To require a bearer token, pass
VICE's `-mcpservertoken` through the supervisor:

```bash
VICE_ARGS="-mcpserver -mcpserverhost 0.0.0.0 -mcpservertoken <secret>" \
  tools/vice-supervisor.sh
```

Clients then need an `Authorization: Bearer <secret>` header, which this repo's
`.mcp.json` does not currently send.

If your MCP client runs on the **host** rather than in a container, you do not need
this — the default `127.0.0.1` bind works, and `http://127.0.0.1:6510/mcp` is the URL.

### `host.docker.internal` is how the container finds the host

Provided by this line in [`.devcontainer/devcontainer.json`](../.devcontainer/devcontainer.json):

```json
"runArgs": ["--add-host=host.docker.internal:host-gateway"]
```

Without it the name does not resolve and every call fails at DNS.

### Verify the connection

```bash
node .claude/skills/vice-session/vice.mjs ping        # -> VICE 3.10 (C64SC) -- paused [port 6510, http://...]
```

If the host is down or unreachable, `ping` is the wrong first check — it
touches the network and can take up to ~50s to fail through the retry
budget. Check `node .claude/skills/vice-session/vice.mjs session status` first: it is a **pure
file read**, makes no MCP call at all, and works (or reports "no active
session") even with the host completely down. See
[§6, Sessions](#6-sessions-and-tool-discovery) below.

Or without the harness:

```bash
curl -sS http://host.docker.internal:6510/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/call",
           "params":{"name":"vice_ping","arguments":{}}}'
```

---

## 4. Restart detection

A supervisor that silently respawns VICE would turn a loud failure into a quiet,
wrong one.
[`.claude/skills/vice-session/vice.mjs`](../.claude/skills/vice-session/vice.mjs)
retries transport failures and redoes the
MCP handshake — so after a respawn it would happily reconnect to a **brand-new,
blank machine** (no disk attached, no checkpoints, CPU halted) and keep reading
empty RAM into a dump that looks plausible and is garbage.

So the two halves work together:

- The supervisor writes `.vice-supervisor/epoch.json` on every spawn — a counter
  plus a timestamp. The workspace is a host bind mount, so the container reads that
  exact file. No extra port, socket, or protocol.
- `capture()` records the epoch at the start of a run and re-checks it at three
  gates. A changed epoch means a different machine: the run is **voided**, partial
  artifacts are renamed to `*.VOID-<timestamp>` with an evidence note, and it never
  auto-reboots or auto-resumes. Re-running a capture is cheap; a wrong dump is not.
- With no supervisor running there is no epoch file, which is not an error — the
  harness falls back to probing `vice_checkpoint_list` for a checkpoint it armed
  itself.

`.vice-supervisor/` is gitignored: crash logs and epochs are local machine state.

---

## 5. Running a pool of instances

### Why a pool exists

Every state-reading `vice_*` call **pauses the emulator and does not resume it**
(see `.planning/STATE.md`'s pause-on-read finding). A poll/wait loop that keeps
re-resuming sustains close to full PAL speed; one that doesn't drops to roughly
**0.7% duty cycle**. Either way, the bottleneck is MCP round-trip latency, not
host CPU — the emulated CPU is idle almost the entire time waiting on the
network round trip. That means N instances interleave with near-linear
scaling: running three captures "in parallel" costs roughly the same wall time
as one, because none of them are CPU-bound against each other.

The other motivation is crash isolation. Six host VICE MCP outages happened in
one session (see STATE.md's HOST INSTABILITY entry); with a single instance,
every emulator task blocks on that one process. A pool means losing or killing
one instance never disturbs the others.

### `start` / `stop` / `status`

```bash
tools/vice-pool.sh start 3      # launch 3 supervised instances: 6510, 6511, 6512
tools/vice-pool.sh status       # per-instance port, pid liveness, epoch, lease
tools/vice-pool.sh stop         # SIGTERM every instance (identity-checked), clear the registry
```

Like `vice-supervisor.sh`, this is **host-only** and refuses to run inside the
container:

```bash
tools/vice-pool.sh --check-container   # exit 0 on a host, 3 in a container
tools/vice-pool.sh --help              # all env overrides and exit codes
```

Instance *i* gets port `VICE_POOL_BASE_PORT + i` (default base port **6510**),
so instance 0 is always the same port the single-instance workflow and
[`.mcp.json`](../.mcp.json) already use — starting a pool never breaks the
existing interactive setup, and stopping a pool leaves nothing behind that
would change how the default instance is reached.

### The registry: the host→container channel

`vice-pool.sh` writes `<pool dir>/registry.json` atomically (temp file + `mv`)
on the same bind mount `epoch.json` already uses — no new port, socket, or
protocol.
[`.claude/skills/vice-session/vice-pool.mjs`](../.claude/skills/vice-session/vice-pool.mjs)
reads it, validating every port as an untrusted, host-written field (same
posture as `readEpoch()`), and derives each instance's URL and epoch-file
path from the **validated port only** — never from a path string read out of
the file.

### Leases: one instance, one caller, at a time

Two container-side processes racing for the same pool must never both get the
same busy instance.
[`.claude/skills/vice-session/vice-pool.mjs`](../.claude/skills/vice-session/vice-pool.mjs)'s
`acquire()` takes
an atomic lease (a `linkSync` of a fully-written temp file — `link` fails
`EEXIST` if the name is taken, and never publishes a half-written lease) on
the **highest free port**, so batch/harness leases drift away from 6510 and
leave the interactive instance free when possible.

The policy is **blocking with a timeout**, not fail-fast and not wait-forever:
a capture run is long, and `reproduce` is two of them back to back, so failing
the instant every instance is busy would make routine work flaky — but waiting
forever would hide a leaked lease. `acquire()` polls until a port frees up or
the timeout elapses, then throws an error naming every port's holder pid, host
and age.

```
VICE_POOL_ACQUIRE_TIMEOUT_MS   how long to wait for a free instance (default 120000)
VICE_POOL_LEASE_MAX_AGE_MS     a lease older than this is reclaimed regardless of holder (default 3600000)
```

A lease held by a pid on **this same host** that's confirmably dead is also
reclaimed. A lease held on a *different* host is never pid-reclaimed — a
supervisor pid (written on the host) and a container pid live in different pid
namespaces, so comparing them is meaningless and could match an unrelated
local process; only age can reclaim a cross-host lease.

With **no pool running at all**, `acquire()` returns the single default
instance — port 6510, the default endpoint, the same non-port-scoped epoch
file as always — with no lease file written. This is not a fallback path
bolted on afterward; it's the same code path a pooled acquire takes, just with
nothing to lease. `node tools/recover.mjs recover danish` behaves exactly as
it always has, with zero configuration.

### Snapshot names carry their instance's port

`vice_snapshot_save` takes only a `name`, not a path, and writes into a
**shared host directory** (`~/.config/vice/mcp_snapshots/`) — so two instances
saving a snapshot under the same run label would silently overwrite each
other. `tools/recover.mjs`'s `snapshotName(port, releaseId, runLabel)` prefixes
every name with `p<port>_`, **unconditionally** — including the port-6510
fallback — so a name never depends on whether a pool happened to be running.

### One caveat: don't run both a bare supervisor and a pool on 6510

A plain `tools/vice-supervisor.sh` (no pool involved) writes its epoch to the
non-port-scoped `.vice-supervisor/epoch.json`. If a pool is *also* running and
something leases port 6510 from it, that lease's epoch path is the *pooled*
`.vice-supervisor/6510/epoch.json` instead — which the bare supervisor never
writes. A lease on 6510 in that mixed setup would find no epoch file at that
path and fall back to the checkpoint-presence probe. Run either a bare
supervisor **or** a pool, not both, to avoid this.

### Interactive use reaches a pooled instance through a session, not `.mcp.json`

The pool is a container-side, harness-driven concept, and (as covered in
§3 above) `.mcp.json` no longer registers a server at all — Claude Code has
no direct MCP connection to repoint at a leased instance in the first place.
`tools/recover.mjs`'s own CLI acquires and redirects a `kind:"process"` lease
for the duration of the verb it's running; **interactive** use reaches a
pooled instance through a `kind:"session"` lease instead — see §6 below.

---

## 6. Sessions and tool discovery

### Why a session exists

The agent's shell environment does not persist between separate Bash
invocations, so a lease taken by one command is invisible to the next one —
each `node .claude/skills/vice-session/vice.mjs ...` call is a brand-new
process with no memory of anything an earlier call `export`ed. A session
solves this by living in a **file** instead: `.vice-supervisor/session.json`
by default, or wherever `VICE_SESSION_FILE` points (set it to give two
concurrent workstreams each their own session, without stepping on each
other).

```bash
node .claude/skills/vice-session/vice.mjs session acquire [--ttl-min N]   # lease an instance, start a session
node .claude/skills/vice-session/vice.mjs session status                  # read-only report, no emulator touched
node .claude/skills/vice-session/vice.mjs session release                 # free the lease, delete the session file
```

Every later `ping`/`call` invocation resolves the active session automatically
— nothing to re-specify. With **no session acquired**, everything works
exactly as it always has, against the default port-6510 instance, zero
configuration required.

### Default TTL and refresh-on-use

A session defaults to a 30-minute TTL (`VICE_SESSION_TTL_MS` to change it
globally, `--ttl-min N` at acquire time for one session). Every successful
resolution pushes the TTL forward to `now + ttl`, on both the lease and the
session file — a session in continuous use never approaches its own expiry.
An **expired** session refuses rather than silently falling back to the
default instance; the error names both recovery verbs (`session release`
then `session acquire`).

### Two lease kinds, side by side

| | `kind:"process"` (`tools/recover.mjs`) | `kind:"session"` (`.claude/skills/vice-session/vice.mjs session acquire`) |
|---|---|---|
| Holder | One long-running process, alive for the whole verb | A short-lived CLI invocation that **exits** the instant `acquire` returns |
| Reclaimed by | Same-host pid death, or `maxLeaseAgeMs` | TTL expiry (`expires_at`) **only** |
| Why | The holder process dying really does mean the lease is abandoned | Pid-liveness would reclaim the lease within milliseconds of every successful acquire — the process that "holds" it is already gone by the time anyone could use it |

Both kinds share one lease namespace on disk — a port leased one way cannot
be taken the other way while it's held.

### Discovering tools without the MCP registration

Removing `.mcp.json`'s server registration (§3) also removes the typed tool
schemas Claude Code used to read automatically.
`.claude/skills/vice-session/vice.mjs tools` replaces that:

```bash
node .claude/skills/vice-session/vice.mjs tools                    # every tool: name + one-line description
node .claude/skills/vice-session/vice.mjs tools memory              # every tool whose name contains "memory"
node .claude/skills/vice-session/vice.mjs tools vice_memory_read    # full input schema: params, types, required, enum/default
node .claude/skills/vice-session/vice.mjs tools --json              # the raw tools/list result
```

`vice_disk_list` never appears in any of these, including `--json` —
`serverInfo()` strips DENY_LIST tools before the payload reaches a formatter.
The prohibition is enforced in two independent places: discovery removes the
tool, and `call()` refuses it before a request is serialised even if the name
is obtained some other way.
