---
created: 2026-08-01T11:58:08.217Z
title: Make the broker cross-project via shared home-dir state
area: tooling
severity: minor
files:
  - .claude/mcp/vice/resources/vice-broker.sh
  - .claude/mcp/vice/vice-proxy.mjs
  - .claude/mcp/vice/vice-broker-client.mjs
  - .planning/phases/01.2-on-demand-broker-and-per-session-leasing/01.2-REVIEW.md
---

> **SPLIT 2026-08-02 — two of these landed in milestone v1.1; the rest stays here.**
>
> - **CR-01 (the missing singleton guard) → Phase 01.6, criterion 11. REQUIRED.** This todo's own
>   argument — *"fixing CR-01 and going cross-project are the same piece of work, not two"* — is
>   accepted, but the blocker half does not wait for the convenience half. Under a TCP control
>   plane a listener on a well-known port cannot bind twice, so `EADDRINUSE` is close to a free
>   singleton guard; 01.6 tests that rather than assuming it. The unexplained port-6510 teardown
>   in `01.2-CRITERION-13-EVIDENCE.md` §5/§7 goes with it.
> - **Cross-project reach → Phase 01.6, criterion 12. OPTIONAL** (developer, 2026-08-02: *"we might
>   get that for free with the new system. If we don't get it it can be ignored."*). TCP is not
>   workspace-scoped, so only the bootstrap `broker.json` still is — the question shrinks to
>   whether one file moves to `~/.vice-broker/`.
> - **Everything else stays in this todo**: ownership metadata, the `manually_started` never-reap
>   marker, the reaper rule, and D-1.2-D's `0600`/uid-parity posture under a `$HOME` path. Deferred
>   because 01.6 is about to relocate the state paths this rewrites, and doing both at once makes a
>   regression impossible to attribute.
>
> Do not re-plan the CR-01 work from this file — read Phase 01.6's criteria 11 and 12 in
> `.planning/ROADMAP.md`, and `.planning/notes/v1.1-todo-coverage.md` for the disposition.

## Problem

The Phase 01.2 broker is **workspace-scoped by construction**. All coordination state lives in
`<repo-root>/.vice-supervisor/` — `broker.json`, `broker-instances.json`, `requests/`, `grants/`,
`leases/`, `spares/` — with the root resolved by `repo-root.sh`. A second project checked out
elsewhere cannot see any of it, so it cannot request, be granted, or lease an instance. Today the
only way to use the emulator from another project is to run a second broker, which is both wasteful
(two spare pools, two sets of emulators) and unsafe (see CR-01 below).

Two things need solving, and they are coupled:

**1. Cross-project reach.** Coordination state has to move somewhere every project can see —
`~/.vice-broker/` or similar — so one broker serves N projects. That drags several 01.2 decisions
back onto the table:

- **D-1.2-D** (registry stays `0600`, uid parity as a named precondition) was reasoned about a
  workspace-local file. A home-directory file shared across projects has a different threat surface.
- **D-1.2-I** deliberately gave the broker its own `broker-instances.json` rather than reusing
  `vice-pool.sh`'s `registry.json`, so that `vice-pool.mjs`'s `acquire()` could never hand out a
  broker-owned instance and break kill-never-recycle. Whatever lands in `$HOME` must preserve that
  separation, not quietly recreate the shared-writer problem at a new path.
- Port allocation becomes genuinely global. The band is already contended: during the 01.2
  checkpoint the broker correctly refused port 6511 because **VS Code holds `127.0.0.1:6511`**. With
  N projects drawing from one band, "refuse and advance" needs to stay correct under concurrency.

**2. Orphan reaping that spares the manually started emulator.** The reaper must kill processes
whose owner is gone while never touching an emulator a human started by hand. Nothing in the current
model distinguishes them — every instance in `broker-instances.json` is broker-owned by definition,
so there is no "not mine, leave it" case to express yet. Note the precedent already exists in the
opposite direction: stopping the broker deliberately leaves *granted* instances running
(`01.2-CRITERION-13-EVIDENCE.md` § 9, verified by a live `vice_ping` after broker shutdown), because
the broker stopping is a different event from a session ending. The reaper needs the same kind of
explicit ownership distinction, made structural rather than remembered.

### Why this is worth doing — it already cost real time

During the 01.2 criterion-13 checkpoint, orphaned state made a **fresh `./tools/vice-broker.sh
start 2` print nothing at all**, three times running. The broker was healthy; it had adopted two
pre-existing spares already in state `ready` (from 08:08 and 09:48, both older than the broker
process itself), so `count_ready()` already equalled `spares_target` and it launched nothing — and
since neither spare was in state `launching`, there was no `launching -> ready` line either. Those
two messages are the only stdout the `start` path emits, so the console stayed silent.

Compounding it: a **live** proxy (pid 842411, session `cf44d872-…`) from an earlier Claude Code
session had held a lease on port 6520 since 08:39 and was still refreshing it, so the phantom lease
never aged out. Five `vice-proxy.mjs` processes were running, each with a live Claude Code parent.
Recovery took a full `stop` + `pkill -TERM -f 'vice-supervisor\.sh'` + moving `.vice-supervisor/`
aside. A working reaper would have made this a non-event.

### Related code-review finding

`01.2-REVIEW.md` **CR-01** (blocker, independently verified): `vice-broker.sh start` has **no
singleton guard** — `cmd_start()` goes straight from timestamp to `write_broker_json` and the poll
loop. Two concurrently-running brokers can race in `grant_from_spare()`, whose read-then-remove is
not atomic across processes, and hand the same ready spare to two different sessions — violating the
per-session isolation the phase exists to guarantee.

Cross-project sharing makes CR-01 strictly worse (N projects, N tempting brokers), but it also makes
the fix natural: a shared home-directory state file is exactly where a cross-project advisory lock
belongs. Fixing CR-01 and going cross-project are the same piece of work, not two.

Also unresolved and possibly connected: `01.2-CRITERION-13-EVIDENCE.md` § 5/§ 7 record an
**unexplained port-6510 teardown at ~11:00** as NOT CAPTURED — no `crashes.log` entry, and the
retained broker console did not reach back far enough. A second broker adopting state is exactly
what that would look like. Worth revisiting once a singleton guard exists.

## Solution

TBD in detail, but the shape is fairly clear:

- Move coordination state to a project-independent root (`~/.vice-broker/`), keeping the broker's
  own registry separate from `vice-pool.sh`'s `registry.json` per D-1.2-I.
- Add per-instance **ownership metadata**: which broker/project/session launched it, plus an
  explicit `manually_started` (never-reap) marker so "leave the hand-started emulator alone" is a
  structural property rather than something the reaper has to infer.
- Make the singleton guard an advisory lock on the shared state file — this closes CR-01 as a side
  effect rather than as a separate patch.
- Reaper rule: an instance is reapable when its recorded owner is provably gone (proxy pid dead /
  lease stale past TTL / broker that launched it no longer heartbeating) **and** it carries no
  never-reap marker.
- Revisit D-1.2-D's `0600` + uid-parity posture for a `$HOME` path, and confirm port-band
  contention still behaves under multiple concurrent projects (6511/VS Code is a live example).
