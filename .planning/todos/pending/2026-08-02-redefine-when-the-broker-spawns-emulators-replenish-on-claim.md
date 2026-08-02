---
created: 2026-08-02T17:25:36.280Z
title: Redefine when the broker spawns emulators — replenish on claim only at zero, on release only below the floor
area: tooling
severity: minor
files:
  - .claude/mcp/vice/resources/vice-broker.sh:1363-1440 (maintain_spares)
  - .claude/mcp/vice/resources/vice-broker.sh:1149 (grant_from_spare)
  - .claude/mcp/vice/resources/vice-broker.sh:509-518 (VICE_BROKER_SPARES default and CLI override)
  - .claude/mcp/vice/resources/vice-broker.sh:1409-1412 (one-boot-in-flight serialisation guard)
  - .claude/mcp/vice/resources/vice-pool.sh
  - .claude/mcp/vice/vice-pool.mjs
---

## Problem

The broker's spawn policy is wrong. Today `maintain_spares()` owns a single invariant —
`ready_spares == VICE_BROKER_SPARES` (default 3) — and re-warms toward it after *every*
event. Claim one instance out of three and the broker immediately launches a replacement to
get back to three ready, so total live instances grow as `N + outstanding_leases`. On a host
where x64sc takes a GTK3 window, an OpenGL 4.6 context and a PulseAudio device per instance,
that headroom is spent for nothing.

The wanted policy replenishes lazily on the claim side and only to a floor on the release
side, which caps the pool at roughly `N + 1` instead of `N + leases`.

### Wanted behaviour, as specified

Two rules, derived from the two worked examples below. `ready` = warm and grantable,
`leased` = handed out, `total` = ready + leased + launching.

- **R1 — on claim/grant:** after handing an instance out, launch a replacement **only if zero
  ready remain**. While `ready >= 1`, hand out and do nothing else.
- **R2 — on release/return:** always kill the returned instance (kill-never-recycle stays as
  it is). Then launch a replacement **only if `total < N`**. Never overshoot `N`.
- **At rest** (no outstanding leases) the pool holds exactly `N` ready.

**Worked example, N = 1** (`VICE_BROKER_SPARES=1`):

| Event | ready | leased | total | Action |
|---|---|---|---|---|
| start | 1 | 0 | 1 | warm 1 |
| claim #1 | 0 | 1 | 1 | ready hit 0 → launch 1 → ready 1, total 2 |
| return #1 | 1 | 0 | 1 | kill returned; total 1, not below floor → no relaunch |

The user's phrasing "when an emulator is given back it shall be taken down and started again"
and "when the last emulator is given back it shall be taken down, no new emulator needs to be
started" are the same rule seen twice: the replacement was already started at *claim* time,
so the return is a pure kill. What the next requester gets is always a fresh instance.

**Worked example, N = 3** (`VICE_BROKER_SPARES=3`):

| Event | ready | leased | total | Action |
|---|---|---|---|---|
| start | 3 | 0 | 3 | warm 3 |
| claim #1 | 2 | 1 | 3 | nothing more |
| claim #2 | 1 | 2 | 3 | nothing more |
| claim #3 | 0 | 3 | 3 | ready hit 0 → launch 1 → ready 1, total 4 |
| return #1 | 1 | 2 | 3 | kill returned; total 3, at floor → no relaunch |
| return #2 | 1 | 1 | 2 | kill returned; total 2 < 3 → launch 1 → ready 2, total 3 |
| return #3 | 2 | 0 | 2 | kill returned; total 2 < 3 → launch 1 → ready 3, total 3 |

Both examples are satisfied by R1 + R2 and by nothing simpler. In particular, `ready == N`
(today's rule) contradicts the N=3 claim rows, and `total == N` alone contradicts the N=1
claim row.

## Solution

Replace the single `ready_spares == N` target in `maintain_spares()` with the two-rule policy.
Concretely:

1. Split the one invariant into a **claim-side trigger** (`ready == 0` → warm exactly one) and
   a **release-side floor** (`total < N` → warm exactly one). `maintain_spares()` currently
   owns both the target and the `total <= VICE_BROKER_MAX` ceiling in one loop precisely so
   they cannot drift; keep that single-owner property when splitting, or the drift the comment
   at line 63 warns about comes straight back.

2. Resolve the collision with the serialisation guard at
   [vice-broker.sh:1409-1412](.claude/mcp/vice/resources/vice-broker.sh#L1409) — a pass returns
   early when any boot is in flight, which is what keeps concurrent x64sc launches from
   segfaulting the host. R1 says "launch immediately when ready hits zero", and those two
   cannot both win. Deferring R1's launch to the next pass is almost certainly correct (the
   measured tool-call budget is >=150s, comfortably over a cold boot), but it must be a
   decision on record, not an accident of ordering.

3. **`VICE_BROKER_SPARES` changes meaning** — from "ready-spares target" to "pool floor on
   total instances". Every doc string, the `usage()` text, the env-var table at
   [vice-broker.sh:248-261](.claude/mcp/vice/resources/vice-broker.sh#L248), and the header
   comment at line 63 assert the old semantics. Renaming the knob is worth considering; leaving
   the name while silently changing the meaning is the failure mode Defect 2 of the
   cross-referenced todo already cost a live debugging session.

4. Extend `vice-broker.test.mjs` and `vice-pool.test.mjs` with the two tables above as
   literal fixtures — each row is a state assertion, and the N=1 and N=3 sequences are exactly
   the cases where the wrong rule looks right.

**Open question to settle during implementation:** whether the `total < N` floor counts
`launching` instances. Counting them prevents a burst of returns from stacking several
simultaneous boots (the known-fatal case); not counting them refills faster. The tables above
assume `launching` counts toward `total`.

## Cross-reference

`.planning/todos/pending/2026-08-01-vice-broker-spare-warming-and-stale-grant-defects.md`
covers the same function from a different angle: its Defect 1 is *parallel* warming
segfaulting x64sc, fixed by the one-boot-in-flight guard this todo has to work around. This
todo is about **when** replenishment is triggered at all, not about how many boots run at once.
Its Defect 3 (grants outliving their process) also matters here — a stale grant inflates the
`total` count that R2's floor test reads, so an unreaped record makes the broker under-warm.
