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

**`.mcp.json` now registers exactly one server: `vice`. This resolves
decision D-5, it does not reverse it.**

D-5's original reasoning stands and stays visible here rather than being
erased: a direct `mcp__vice__*` registration pointed at the host's HTTP
endpoint would bypass the deny-list, restart/epoch detection and lease
discipline that used to live only inside
[`.claude/mcp/vice/vice.mjs`](../.claude/mcp/vice/vice.mjs)'s
seam — which is exactly why `.mcp.json` was left empty for as long as it
was.

What changed (Phase 01.1): those mechanisms now live *inside the registered
process itself*. `.mcp.json`'s `vice` entry is a `command`/`args` (stdio)
registration whose `command` is
[`.claude/mcp/vice/vice-proxy.mjs`](../.claude/mcp/vice/vice-proxy.mjs)
— a stdio MCP server that imports the same `vice.mjs` transport module
(`call()`, its retry ladder, the `vice_disk_list` deny-list, epoch checking)
and delegates every forwarded `tools/call` through it. Registering that
process does not create a second, unguarded path to the emulator; it makes
the existing guarded seam the thing Claude Code actually talks to, instead
of an unregistered script sitting beside an unguarded direct route. D-5's
concern — "don't hand agents a second path that skips the guard" — is
satisfied by construction: there is no longer any registered path that
skips it.

**Layout note:** `vice.mjs`, `vice-pool.mjs`, `vice-session.mjs`, `vice-sync.mjs`,
`vice-probe.mjs`, `repo-root.mjs`, `install-resources.mjs` and their test
files live in
[`.claude/mcp/vice/`](../.claude/mcp/vice/) —
originally moved out of this directory into a `vice-session` skill, then
relocated into `vice-mcp-selector` (plan 01.1-04) once that skill became
the registered, agent-facing route and `vice-session` was retired, and
relocated a third time (quick-260731-p8a) out of the skills tree entirely.
This module tree is **not skill content**: `.mcp.json` runs the proxy
directly, three `tools/` CLIs and the `c64-ram-capture` skill import the
transport as a library, and `.gitignore` tracks its `resources/` as a
source of truth — none of that is a "skill" relationship, so a directory
that says "MCP server" now separates the implementation from the skill
declaration. `vice-mcp-selector` retains only its `SKILL.md` (the
usage-only guide agents read); its former `scripts/` and `resources/`
subdirectories are gone from that location. Every OTHER skill in this
project still keeps its executable `.mjs` modules in its own `scripts/`
subdirectory — `acme-build/scripts/acme.mjs` and
`devcontainer-host-path/scripts/hostpath.mjs` are unaffected by this move.
The HOST-side launchers —
`vice-supervisor.sh`, `vice-pool.sh` and `lib/container-guard.sh` — live
tracked in this same directory's
[`resources/`](../.claude/mcp/vice/resources/), not here:
`tools/vice-supervisor.sh`, `tools/vice-pool.sh` and `tools/lib/container-guard.sh`
are **gitignored, disposable deployed copies**, regenerated automatically by
`install-resources.mjs` the first time any `.claude/mcp/vice/` `.mjs` entry
points runs — including `vice-proxy.mjs` itself, every time a Claude Code
session starts the registered server. A fresh clone has no `tools/` scripts
at all until that first run; the deploy-on-first-use trigger fires from
`repo-root.mjs`'s own module body, not from any particular CLI verb, so
there is no shell command required to materialise them. The reason the
second TRACKED copy went away: two tracked copies of one script drift
apart, and the drift is invisible until the host happens to run the stale
one — keeping exactly one tracked source of truth (`resources/`) makes that
class of bug structurally impossible. An existing deployed copy is never
overwritten automatically, whatever its contents; `node
.claude/mcp/vice/vice.mjs install --force` is the
one command that refreshes a copy that has been hand-edited (the
resource-deployment verb, not an emulator-reaching one — see
[Troubleshooting](../.claude/skills/vice-mcp-selector/SKILL.md) in the
skill's own guide for when to reach for it). `tools/recover.mjs` (and its
test file) also stayed, importing the relocated modules via the same
cross-tree path `devcontainer-host-path/scripts/hostpath.mjs` already used.

```json
{
  "mcpServers": {
    "vice": {
      "command": "node",
      "args": [".claude/mcp/vice/vice-proxy.mjs"]
    }
  }
}
```

No `url` field, no `type` field, no `env` block — the absence of `url` is
load-bearing, not an omission. A server's `url` changing invalidates prior
project-scope MCP approval; a stdio entry has none to change, so approval
granted once for this exact `command`/`args` pair survives indefinitely, as
long as nothing in the repo rewrites this file at runtime (nothing does).

This takes effect only when a **new** Claude Code session starts — MCP
server definitions are read once at session start, so the session that adds
this entry cannot load it itself. Project-scope servers also require
approval on first use in a session; the session making this edit is not the
session that grants that approval either. Both of these are the same fact
from two angles: expect the entry to do nothing until the *next* session,
not this one.

The proxy still forwards to VICE's HTTP endpoint underneath — that
underlying transport, and how VICE itself is launched and reached on the
host, are unchanged by this registration and covered in full below.

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

A plain HTTP round trip needs no project code at all:

```bash
curl -sS http://host.docker.internal:6510/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/call",
           "params":{"name":"vice_ping","arguments":{}}}'
```

From inside a Claude Code session, the equivalent check is a call to the
`mcp__vice__ping` tool — no shell command, no harness invocation. See
[§6, Tool discovery](#6-tool-discovery) below for how that tool (and every
other `mcp__vice__*` tool) gets in front of the agent in the first place.

---

## 4. Restart detection

A supervisor that silently respawns VICE would turn a loud failure into a quiet,
wrong one.
[`.claude/mcp/vice/vice.mjs`](../.claude/mcp/vice/vice.mjs)
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
[`.claude/mcp/vice/vice-pool.mjs`](../.claude/mcp/vice/vice-pool.mjs)
reads it, validating every port as an untrusted, host-written field (same
posture as `readEpoch()`), and derives each instance's URL and epoch-file
path from the **validated port only** — never from a path string read out of
the file.

### Leases: one instance, one caller, at a time

Two container-side processes racing for the same pool must never both get the
same busy instance.
[`.claude/mcp/vice/vice-pool.mjs`](../.claude/mcp/vice/vice-pool.mjs)'s
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

### Interactive (agent-facing) use takes no pool lease at all

The pool is a container-side, harness-driven concept for `tools/recover.mjs`'s
own batch pipeline — it has nothing to do with how Claude Code reaches the
emulator. As of Phase 01.1 (§3 above), `.mcp.json` registers
`vice-proxy.mjs`, which forwards every `mcp__vice__*` call to the FIXED
port from decision D-A (6510, the single supervised instance) — it never
leases a pooled instance and never redirects. `tools/recover.mjs`'s own CLI
still acquires and redirects a `kind:"process"` lease for the duration of
the verb it's running, exactly as before; that machinery is entirely
internal to the standalone batch pipeline and is not part of the
agent-facing path at all. See §6 below for how an agent actually discovers
and calls tools.

---

## 6. Tool discovery

Everything an agent needs to reach the emulator is covered by the two
subsections below. There is no session CLI and no discovery command for an
agent to invoke here — `mcp__vice__*` tool calls are the only route, exactly
as [`vice-mcp-selector/SKILL.md`](../.claude/skills/vice-mcp-selector/SKILL.md)
states.

### Discovering tools: `mcp__vice__*`, backed by a committed snapshot

`.mcp.json`'s `vice` entry (§3) is what puts typed tool schemas back in front
of an agent, automatically, as real `mcp__vice__*` tools — no CLI discovery
command needed at all. That only works, though, because
[`vice-proxy.mjs`](../.claude/mcp/vice/vice-proxy.mjs)
answers `tools/list` from a **committed on-disk snapshot**,
[`tools-manifest.json`](../.claude/mcp/vice/tools-manifest.json),
not from a live call to the host. A pure file read can't hang, can't fail
open, and can't make a fresh Claude Code session's startup depend on whether
the emulator happens to be up (see 01.1-RESEARCH.md decision D-C) —
important given how often this project's own history shows the host down.

The cost of that is that the snapshot has to be refreshed by hand, on
purpose, against a running host:

```bash
node .claude/mcp/vice/refresh-manifest.mjs
```

This is the **only** thing that writes `tools-manifest.json`. It calls the
host's own `tools/list`, strips `vice_disk_list` (redundant with the
proxy's own read-time filter below, but no reason to skip it), and writes
the result with a `generated_at` timestamp. Run it once against a live host
**before** starting the session that needs `mcp__vice__*` tools to appear —
a fresh clone's committed snapshot has `generated_at: null` and an empty
`tools` array on purpose, precisely so nobody mistakes a hand-populated
placeholder for a real one. If the host is unreachable, it exits non-zero
and leaves the existing snapshot untouched rather than writing something
partial or empty over a good one.

`VICE_TOOLS_MANIFEST` overrides the snapshot path for both the proxy and the
refresh script, if you ever need to point either at a non-default location.

`vice_disk_list` never appears in the result, from either program: the
refresh script's own host call strips it before writing, and the proxy
re-filters the snapshot again at read time — a snapshot generated by any
other means still can't leak it. The prohibition is enforced in two
independent places at the call boundary too: `tools/call` refuses it before
any request is serialised, even if the name is obtained some other way.

### Programmatic seam: two library consumers that are not the proxy

`tools/recover.mjs` and the `c64-ram-capture` skill's pipeline import
`vice.mjs`/`vice-sync.mjs` directly, as a library — `node tools/recover.mjs
...`, invoked from a shell, exactly as it always has been. This is
deliberate and unchanged by the proxy's arrival: criterion 8's retirement is
of the *documented, agent-facing* route to the emulator, not of the
transport module itself, which both of these standalone pipelines still
need as their only way to reach VICE. Neither pipeline is something an
agent is ever instructed to invoke as a substitute for `mcp__vice__*` tool
calls — they are Phase 1's own recovery/capture tooling, run by a human or
by an agent executing a *documented, specific plan step* that names
`tools/recover.mjs` by task, not a general-purpose emulator-access
shortcut. If a document ever tells an agent to reach for this module as a
generic alternative to `mcp__vice__*`, that is the regression
`vice-mcp-selector-docs.test.mjs` exists to catch.
