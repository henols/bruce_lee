---
created: 2026-08-02T09:10:00.000Z
title: The broker's boot-time log rounds every sub-second boot down to (0s), hiding the true measurement
area: tooling
severity: minor
files:
  - tools/vice-broker.sh
---

## Problem

`maintain_spares()` computes elapsed boot seconds with integer division —
`elapsed_s=$((elapsed_ns / 1000000000))` — so every sub-second boot renders as `(0s)`. All four
launches in the 2026-08-02 host run logged this way (`vice-broker: port 6540 launching -> ready
(0s)`, and the same for the other three ports), even though the broker's own spare records held
full nanosecond `launched_at`/`ready_at` precision one directory away.

The cost: the only human-readable boot figure anywhere in the system rounds a real, precisely
measured value down to zero, which reads as "instant, or unmeasured" rather than as a number. That
is why an ~8x-wrong ~8s boot assumption went unchallenged long enough to reach a design note, a
todo and a spike — nobody had a contradicting number to look at, because the number that existed
displayed as nothing.

## Solution

Print milliseconds, or a fixed-point seconds figure, computed from the same nanosecond
`launched_at`/`ready_at` fields already being written — not integer-divided seconds. Wherever the
figure is surfaced, mention the poll-quantisation caveat (passes run every
`VICE_BROKER_POLL_MS=500`, so the figure is an upper bound, not an exact boot time) so a printed
number is never mistaken for a precise boot time.

## Cross-reference

- `.planning/RE-FINDINGS.md` — the 2026-08-02 entry recording this rendering defect and its
  integer-division cause.
- `.planning/notes/vice-broker-lifecycle-decisions.md` — the 2026-08-02 correction section, whose
  entire premise this display defect obscured for a day.
