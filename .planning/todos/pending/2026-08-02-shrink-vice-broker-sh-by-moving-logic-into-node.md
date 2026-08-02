---
created: 2026-08-02T15:23:47.411Z
rescoped: 2026-08-02
title: Move vice-broker.sh's logic into Node — the enabling step for a TCP control plane, if the host can run node
area: tooling
severity: major
files:
  - .claude/mcp/vice/resources/vice-broker.sh:1-1838
  - .claude/mcp/vice/vice-broker-client.mjs
  - .claude/mcp/vice/vice-broker.test.mjs
  - .claude/mcp/vice/resources/lib/container-guard.sh
  - .claude/mcp/vice/install-resources.mjs
---

## Re-scoped 2026-08-02 — this is no longer a file-size cleanup

Filed originally as `minor`: *"1,838 lines of bash is too much bash."* A `/gsd-explore` session
on the broker's communication channels raised the stakes, and this is now the **enabling step
for a TCP control plane** (`.planning/notes/broker-control-plane-over-tcp.md`).

What changed:

- **The Node move is a prerequisite, not a preference.** The target design replaces the
  file-messaging protocol with one TCP connection per proxy, where the connection's lifetime
  *is* the lease. A bash socket server forks a subshell per connection and loses the in-process
  `in_flight` flag that is the only thing preventing a repeat of the 2026-08-01
  triple-`x64sc`-launch outage (see `process_requests()`'s own comment on that race). A
  single-threaded event loop holds that invariant better than the current poll does. Bash
  cannot get there; Node can.
- **The host-`node` question stops being a nice-to-have gate.** Below it is written as "if the
  host does not have node, this todo is dead." Under the re-scope, a negative answer kills the
  control-plane design too, not just this cleanup. **Ask it first.**
- **The severity is `major` because two other open todos are paying interest on this.**
  `2026-08-01-make-the-broker-cross-project-via-shared-home-dir-state.md` and
  `2026-08-01-vice-broker-spare-warming-and-stale-grant-defects.md` both edit exactly the
  spare-state / grant-lifetime logic that this relocates.

What is unchanged: the analysis below of which functions are shell-shaped and which are
program-shaped is still exactly right, and the sequencing note at the bottom (fix the four
defects *first*) still holds.

Related: `.planning/seeds/broker-restart-reaps-and-voids.md` covers what a restarted broker must
do once the lease no longer has a file backing it.

**Not blocked by, but blocked alongside:**
`2026-08-02-vice-diagnose-and-vice-recycle-unreachable-from-agent-session.md`. The control plane's
whole purpose is to carry non-emulator commands (recycle a frozen instance, ask for host state,
release). Those surface to the agent as proxy-local synthetic tools — the exact category that is
currently written, tested and *unreachable*. A new transport does not make them reachable;
whatever routes around `vice-proxy.mjs` routes around this too. Fix that, or the control plane
lands with no consumer.

## Problem

`vice-broker.sh` is **1,838 lines / 86 KB of bash** — the single largest implementation file
in the whole `mcp__vice__` tree, larger than `vice-proxy.mjs` (71 KB) and more than triple
its own sibling `vice-pool.sh` (611 lines). Its test file is 102 KB.

What lives in there is not shell-shaped work. Reading the function list, most of it is
program logic that bash makes harder than it needs to be:

- JSON handling done by hand — `json_escape`, `write_json_atomic`, `extract_id_field`,
  `read_spare_field`, `read_instance_field` are a hand-rolled JSON reader/writer.
- A state machine — `launching` → `ready` spare states, `grant_from_spare`, `deny`,
  `process_requests`, `maintain_spares`, `sweep_grants`, `teardown`.
- Bookkeeping and arithmetic — `count_ready`, `count_total`, `count_launching`,
  `next_free_port`, `port_is_blocked`, `block_port`, `lease_is_stale`, `file_mtime_epoch`.
- Validation — `is_valid_request_id`, whose regex must stay byte-identical to
  `REQUEST_ID_PATTERN` in `vice-broker-client.mjs`. There is already a parity test whose
  entire job is to stop those two implementations of one rule from drifting.

Genuinely shell-shaped work is a much smaller set: process launch/signalling
(`launch_instance`, `signal_recorded_pid`, `reap_all_instances`), the daemon loop
(`cmd_start`, `sleep_ms`, traps), `port_in_use`, and the host `curl` probe.

The two adjacent open todos both pay this tax rather than reduce it:
`2026-08-01-make-the-broker-cross-project-via-shared-home-dir-state.md` (rewrites state
paths inside it) and `2026-08-01-vice-broker-spare-warming-and-stale-grant-defects.md`
(four defects, three of them in exactly the spare-state / grant-lifetime logic above).

## Solution

**Investigate first — this is gated on one fact that cannot be checked from the container.**

`vice-broker.sh` is HOST-ONLY by design: it launches `x64sc`, its windows and its MCP
listeners, all of which live on the host, and `lib/container-guard.sh` makes it *refuse* to
run inside the devcontainer. The `.mjs` files in `.claude/mcp/vice/` are the container-side
halves. So there is no existing "host-side Node" precedent to copy — `vice-pool.sh` +
`vice-pool.mjs` is a host/container *split*, not a thin-shell/fat-node split.

**Blocking question: does the host have a usable `node` on PATH?** Nothing in the repo can
answer that. If it does not, this todo is dead and should be closed with that reason
recorded.

Note this is *not* blocked by the "no script may open its own connection to VICE" rule.
That rule governs container-side code reaching the emulator behind the tools' back. The
broker is the host-side mechanism that *grants* that access; it is the sanctioned route,
not a bypass. A host-side `vice-broker.mjs` would sit exactly where the `.sh` sits now.

If the host does have node, the shape to aim for:

1. Keep `vice-broker.sh` as a **thin host entry point** — the container guard, the daemon
   loop and signal traps, `launch_instance`/`signal_recorded_pid`, `port_in_use`, and the
   `curl` probe. Everything that actually touches host processes.
2. Move to a new host-side `vice-broker.mjs`: all JSON read/write, request-id validation,
   spare state transitions, port allocation and blocking, lease staleness, grant sweeping,
   `count_*`, and the decision logic in `process_requests` / `maintain_spares`.
3. **Delete the duplicated request-id regex** — import `REQUEST_ID_PATTERN` from
   `vice-broker-client.mjs` so the parity test becomes unnecessary rather than merely
   passing.
4. Keep `--once` and `VICE_BROKER_PROBE_CMD` as-is. They are the seams every test in
   `vice-broker.test.mjs` drives; the refactor is only worth doing if that 102 KB suite
   keeps passing across it, which is also the cheapest available proof of equivalence.
5. `install-resources.mjs` deploys `resources/` to the gitignored `tools/` — a new `.mjs`
   under `resources/` has to be added to whatever that script copies, or the deployed
   broker breaks with a missing-module error.

Sequencing: do this **after** the four spare-warming/grant-lifetime defects are fixed, not
before. Fixing known bugs and relocating the code that holds them in one move makes it
impossible to tell which change caused a regression.
