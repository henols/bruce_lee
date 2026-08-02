---
title: A restarted broker reaps every instance and lets the existing epoch check void the sessions — no reconnect protocol needed
trigger_condition: The TCP control plane from .planning/notes/broker-control-plane-over-tcp.md is actually being built, i.e. the lease has moved from a file's mtime into a connection's lifetime
planted_date: 2026-08-02
---

# Broker restart is a void event, not a resync event

## The problem it solves

Once the lease **is** the TCP connection, the file that recorded "this grant is held" stops
existing. That is the entire point — it retires `startHeartbeat()`, `file_mtime_epoch()`,
`lease_is_stale()`, `sweep_grants()` and the 180 s TTL in one move, and makes release
kill-proof instead of best-effort.

It also removes the thing that let a restarted broker reconcile. Today `sweep_grants()` walks
`grants/` on disk and can tell what is still held. A broker that restarts with in-memory-only
leases sees zero connections and concludes every emulator is free — free to grant a live one to
a second proxy while the first is still mid-capture on it. Two sessions, one emulator, neither
aware.

## The resolution — and why it needs no new mechanism

The obvious fix is a reconnect protocol: proxies keep their grant id, present it on reconnect,
broker holds a startup grace window before reallocating. That works, and it is roughly thirty
lines, but it is *not the decided direction* and should not be built by reflex.

The decided direction is that a broker restart voids every session, and the machinery for that
already exists end to end:

1. **Broker restart reaps all instances.** `reap_all_instances()` is already written and
   already called on shutdown paths in `resources/vice-broker.sh`.
2. **Reaping bumps every supervisor's epoch.** `vice-supervisor.sh`'s `write_epoch()` increments
   `epoch.json` on every respawn, per instance.
3. **Every in-flight session already checks that.** `assertSameMachine()` in `vice.mjs` compares
   the baseline epoch against the current one and throws `MachineRestartedError` — the project's
   existing "this run is void, re-run it" discipline.

So the correct behaviour falls out of three mechanisms that are all present today. What has to
be *built* is the guarantee that restart always reaps, plus the MCP-facing message: report that
the session must be restarted, or acquire a fresh emulator where that is possible.

## Why this shape and not the reconnect protocol

It is the same rule the project already applies to a restarted emulator, rather than a second,
parallel notion of "recoverable". Adding a resync path would mean a session could survive a
broker restart in some circumstances and not others, and the project's whole verification stance
is that an unproven identity is treated exactly like a changed one — see `assertSameMachine()`'s
D-3/D-4 comments: *"Unproven is not the same as fine."*

The tolerance decision behind this is explicit and was made in the originating
`/gsd-explore` session: broker death takes the session with it, and that is accepted.

## Watch for

- **Reap must be unconditional on startup**, not only on clean shutdown. A broker killed with
  SIGKILL never runs its shutdown path, so the *next* start is the only place the guarantee can
  be enforced. A start that adopts orphaned instances without reaping them reintroduces the
  double-grant hazard this seed exists to close.
- **The reap must reach instances the new broker has no record of.** If protocol state is
  discarded along with the file-based lease, "reap everything" has to be derived from ports
  and process ancestry, not from a registry the restart just lost.
