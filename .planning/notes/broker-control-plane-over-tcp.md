---
title: Split the broker into a TCP control plane and leave the emulator data plane alone — files shrink to one bootstrap record
date: 2026-08-02
context: /gsd-explore session that started as "does the MCP talk to the broker over a socket or the filesystem?" and turned into a design for replacing the file-messaging protocol
---

# The broker control plane, over TCP

## The question that started it

*Is the restart/investigate machinery talking to the broker over a socket, or over the filesystem?*

Both channels exist, and the split is clean.

**Container → broker/supervisor: filesystem only.** Everything in
`.claude/mcp/vice/vice-broker-client.mjs` is `readFileSync`/`writeFileSync` + `renameSync`
against the `.vice-supervisor/` bind mount — `requests/<id>.json` out; `grants/`, `denials/`,
`recycle-acks/`, `broker.json` in; `leases/<id>` as the claim. The host half,
`resources/vice-broker.sh`, is a 500 ms polling shell loop over the same directory. No port,
no socket. Its own header comment: *"deliberately not a new channel."*

**Container → emulator: socket.** `rpc()` in `vice.mjs:163` is a `fetch` POST of JSON-RPC to
`http://host.docker.internal:<port>/mcp`. That is the only socket the container opens.

Per capability:

| Capability | Channel today |
|---|---|
| Restart detection (epoch) | Filesystem. `readEpoch()` is a sync read of the per-instance `epoch.json`, written atomically by `vice-supervisor.sh`'s `write_epoch()`. The doc comment is explicit: *"the whole point of the epoch check is that it costs zero MCP traffic."* |
| `vice_diagnose` | Mixed, ordered filesystem-first. Verdict 1 `restarted` is an epoch comparison at **zero emulator calls** (D-14). Verdicts 2–5 (`checkpoint_trap`, `wedged`, `stale_read_path`, `live`) all ride the socket. |
| `vice_recycle` | Filesystem. `writeRecycleRequest()` → `requests/<id>.json` with `op:"recycle"` → poll `recycle-acks/`. It has to be — the container cannot restart the host emulator over the socket. |

The organizing principle: **the file channel carries the emulator's *existence*, the socket
carries its *state***, and `epoch.json` is the bridge that makes an existence change visible
without spending a state call.

## The proposed shape

Three tiers instead of two:

1. **Bootstrap — one file.** `broker.json` (which already carries `pid` and `heartbeat_at`)
   gains a port and becomes the discovery record. Read once.
2. **Control plane — TCP to the broker.** Acquire, release, recycle/restart a frozen
   emulator, ask host-side state questions. One connection per proxy, held for the session's
   lifetime.
3. **Data plane — unchanged.** The proxy still dials the emulator directly at the granted
   port, exactly as today. The broker is never in the emulator path.

## What this fixes

- **The lease is the connection.** Today the lease is one file doing three jobs — existence
  is the claim, mtime is the heartbeat, unlink is the release — propped up by
  `startHeartbeat()`'s 60 s timer on the container side and `file_mtime_epoch()` /
  `lease_is_stale()` / `sweep_grants()` against a 180 s TTL on the host side. And the release
  is best-effort: `vice-broker-client.mjs:238` is one attempted `unlinkSync` and nothing else,
  because the measured graceful-shutdown window is ~490 ms. SIGKILL the proxy and the release
  never happens; the emulator is stranded for the full 180 s. A TCP connection makes all of
  that one thing — kernel-enforced, kill-proof, immediate. Heartbeat timer, mtime semantics,
  TTL tuning and the sweep all retire together.
- **Liveness stays answerable without a connection.** Because `broker.json` remains the
  bootstrap record, `readBrokerLiveness()` keeps distinguishing never_started / stale / alive.
  ECONNREFUSED is never ambiguous. This is the objection that bootstrap-by-file kills.
- **Concurrency gets safer, not riskier.** A bash socket server forks a subshell per
  connection and loses the in-process `in_flight` flag that is the only thing preventing a
  repeat of the 2026-08-01 triple-`x64sc`-launch outage (see `process_requests()`'s own
  comment). A single-threaded Node event loop holds that invariant *better* than the current
  poll does. This is why the control plane and the bash→Node move are one piece of work, not
  two.
- **Grant latency.** 500 ms poll → immediate. Minor next to a cold `x64sc` boot, but free.

## The tolerance decision (explicit)

Broker death is **survivable today**: after the grant the proxy's only broker dependency is
`touchLease`, a file write whose failure is a silent no-op (`vice-proxy.mjs:2156`), and the
emulator is a separate `nohup`'d process under its own supervisor. Kill the broker mid-session
and the proxy keeps working.

**This design gives that up deliberately.** Broker death drops the control connection and the
session is void. That is accepted, not overlooked: the MCP reports that the session must be
restarted, or acquires a fresh emulator where it can.

The consequence worth being precise about is broker **restart**, not broker death. With the
lease living in a connection, a restarted broker sees zero connections and would conclude every
emulator is free — free to hand a live one to a second proxy while the first is mid-capture.
The resolution does not need a new protocol: **broker restart reaps all instances**
(`reap_all_instances()` already exists), which bumps every supervisor's epoch, which every
in-flight session already detects through `assertSameMachine()`'s existing epoch comparison and
reports as void. Same discipline the project already applies to a restarted emulator. See
`.planning/seeds/broker-restart-reaps-and-voids.md`.

## Two blockers, neither of them transport

1. ~~**Does the host have `node` on PATH?**~~ **ANSWERED 2026-08-02: yes.** Developer-confirmed;
   the container cannot verify it by construction. The architecture's prerequisite is met.
   What remains is mechanical — the host's `node` version is still unrecorded, and this repo has
   no host-side Node precedent, so the shell→Node call boundary and its deployment are first-time
   work. Scheduled as Phase 01.6, criterion 1.
2. **The tool surface routes around the proxy.**
   `.planning/todos/pending/2026-08-02-vice-diagnose-and-vice-recycle-unreachable-from-agent-session.md`
   (priority `major`) records that `vice_diagnose` and `vice_recycle` are fully wired and
   268/268 green, yet unreachable from the agent session — which sees a flat 64-tool list that
   *includes* `vice_disk_list` and excludes all three proxy-local synthetic tools. Whatever
   routes around `vice-proxy.mjs` will route around a TCP control plane in exactly the same
   way. Moving these capabilities onto a new transport does not make them reachable.

## What stays on the filesystem regardless

- `epoch.json` — supervisor → container, a different pair from proxy ↔ broker, and the whole
  point is that it costs zero calls.
- `broker.json` — the bootstrap and liveness record.
- Anything the broker needs to survive its own restart, to whatever extent that is kept at all
  given the tolerance decision above.

## Not a violation of the hard rule

CLAUDE.md's rule governs container-side code reaching **the emulator** behind the tools' back.
The broker is the host-side mechanism that *grants* that access — the sanctioned route, not a
bypass — and under this design the emulator data plane is untouched. A host-side
`vice-broker.mjs` sits exactly where the `.sh` sits now. The existing shrink-broker todo makes
the same finding independently.
