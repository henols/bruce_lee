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
            libmicrohttpd-dev libgtk-3-dev xa65 flex byacc
```

macOS:

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

Transport is plain HTTP POST to `/mcp`. This repo's [`.mcp.json`](../.mcp.json):

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

Two details in there are load-bearing.

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
node tools/vice.mjs ping        # -> VICE 3.10 (C64SC) -- paused
```

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
wrong one. [`tools/vice.mjs`](vice.mjs) retries transport failures and redoes the
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

## 5. Hazards

**Never call `vice_disk_list`.** It crashes the host MCP server, and recovery costs
a VICE restart. [`tools/vice.mjs`](vice.mjs) enforces this with a deny-list checked
before any request is serialised, so no caller can reach it even indirectly. Parse
`.d64` bytes directly in Python instead, or use `vice_disk_read_sector`.

**`vice_run_until`'s `cycles` argument is documented as "not yet implemented"** in
its own live schema — it is not a timeout and gives no protection against hanging
on a misidentified address. Use bounded `vice_execution_step` batches instead, and
rely on the client-side abort timeout in `vice.mjs`.

**VICE is a single shared instance.** Emulator work cannot be parallelised across
plans even when the plans themselves are marked parallel.

**Crash logs are evidence.** The root cause of the outages is still unconfirmed.
When VICE dies, `.vice-supervisor/crashes.log` and `.vice-supervisor/logs/x64sc-*.log`
hold the exit status, signal, and final output — check them before restarting, as
that is the data that can eventually confirm or kill the current hypothesis.
