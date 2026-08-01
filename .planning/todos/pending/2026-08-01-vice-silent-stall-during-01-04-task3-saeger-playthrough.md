---
category: tooling
priority: major
date: 2026-08-01
source: 01-04 Task 3 (saeger play-through, same session as Task 2's three crashes)
---

# A fourth host VICE incident in one session: a genuine silent stall during Task 3's play-through

## Problem

The same session that hit three crash/respawn incidents during Task 2 (see
`2026-08-01-vice-crashes-three-times-during-sustained-execution-01-04-task2-saeger.md`) hit a
**fourth, distinct** incident during Task 3's play-through, on the same epoch-11 instance that had
just successfully completed all of Task 2 without issue.

After capturing one attributed `gameplay-write` hit on `$DD00` (a legitimate graphics-mode-setup
store at `$07DB`, part of the title-to-chamber-1 transition) and sending one `vice_joystick_tap`
(direction: right, 90 frames) to move Bruce Lee, three independent `cycles_stopwatch reset ->
execution_run -> ping xN -> read` brackets all measured **exactly 0 cycles**, while `vice_ping`
continuously reported `execution:"running"` throughout, with no epoch-drift error at any point
(unlike the three earlier crash/respawn incidents, `vice_ping`'s `version`/`machine` fields never
changed — this is the *same* instance, not a new one). `vice_registers_get` returned an identical
`PC:2014` across three separate reads, including one immediately after an explicit
`vice_execution_pause`.

This matches `.planning/STATE.md`'s own prior-documented "silent stall" hazard
(`vice_ping`'s `execution` field is NOT a liveness signal) almost exactly, confirming it recurs
even on a freshly-booted, previously-healthy instance mid-session, not just after a stale/reused
grant.

## What worked despite the stall

`vice_checkpoint_list` and `vice_checkpoint_delete` both remained reliable — teardown was proven
(two checkpoints deleted individually, enumeration confirmed `count:0`).

## Consequence for this plan

01-04's Task 3 play-through was halted after only 2 of saeger's required milestones (title
screen, game start/chamber 1) and before danish's play-through could begin. Per the plan's own
instruction, no further play input was attempted once the pattern was confirmed twice more (three
brackets total). See `.planning/RE-FINDINGS.md` for the full live evidence.

## Open question this todo exists to flag

Four distinct incidents in roughly 30-40 minutes of continuous live work, split between two
shapes (loud crash/respawn x3, silent stall x1) — both self-diagnosable only via a cycle
bracket, neither visible to `vice_ping` alone. Worth investigating host-side whether these are the
same underlying `x64sc` instability (GPU/OpenGL/PulseAudio, per the already-root-caused spare-
warming defect) manifesting two different ways under sustained load, or two genuinely separate
defects. Until root-caused, any live-emulator plan should budget for BOTH failure shapes recurring
multiple times per session, and should treat every "running" status as requiring independent
cycle-bracket confirmation before trusting a "no hit yet" read as meaningful.

## Suggested next step

Same as the sibling todo: host-side investigation of `x64sc` crash/hang logs if the supervisor's
per-incident evidence collection captured anything for this stall (no PID change means no new
spawn event to look for — the *existing* process may have wedged, worth checking for e.g. a
deadlocked GTK/OpenGL event loop rather than a crash).
