---
category: tooling
priority: major
date: 2026-08-01
source: 01-04 Task 3 attempt 4 (saeger play-through, a FRESH session/instance, not a continuation of attempt 3)
---

# A second genuine silent stall, in a brand-new session, froze at the identical PC as attempt 3's stall

## Problem

Attempt 4 of plan 01-04 opened a genuinely fresh session (first tool call `vice_ping`, confirming
a boot-fresh instance grant per the project's per-session access model) and re-derived saeger's
whole boot procedure from scratch rather than trusting anything from attempt 3. Task 2's earned
data was reused (durable registry data), but the live emulator work — boot, gate walk, F7,
chamber 1, death/game-over/restart cycles, and the `$DD00` attribution capture — was redone live
this session and succeeded cleanly, reproducing attempt 3's `$07DB: STA $DD00` gameplay-write
attribution exactly.

Immediately after that attribution capture (a stopping checkpoint on `$DD00`'s store, which
mechanically parks the machine at `PC:2014` / `$07DE`, the instruction right after the store) and
after tearing down and re-arming the earned watch set for one more clean death/restart evidence
pass, the machine stopped responding to further play input:

- A screenshot came back **solid blue with no text** — a state not seen at any other point this
  session (not the title screen, not chamber 1, not game over).
- Two independent `cycles_stopwatch reset -> execution_run -> ping xN -> read` brackets both
  measured **exactly 0** cycles, while `vice_ping` continuously reported `execution:"running"`.
- `vice_registers_get` returned `PC:2014` both times, including immediately after an explicit
  `vice_execution_pause`.

**`PC:2014` is the identical program counter recorded for attempt 3's own stall** in
`2026-08-01-vice-silent-stall-during-01-04-task3-saeger-playthrough.md`. Both incidents are two
sessions apart (different instance grants, different boot-from-scratch runs, same disk image and
same play technique), yet froze at the exact same address.

## What worked despite the stall

`vice_checkpoint_add`, `vice_checkpoint_delete` and `vice_checkpoint_list` all continued to return
successful, self-consistent responses (add succeeded, list showed both entries at `hit_count:0`)
even while the CPU itself was frozen — consistent with attempt 3's finding that checkpoint
bookkeeping survives this stall shape while `vice_registers_get`/execution/cycle-advancement do
not.

## Open question this todo exists to flag

With N=2, both saeger stalls in this project occurred shortly after a stopping checkpoint had
paused the machine at or very near `$07DE` (the instruction following the `chamber-1-entry`
`STA $DD00` graphics-mode-setup store) and execution was then resumed to continue play. This may
be:

1. Coincidence — both sessions happened to use the same `$DD00`-attribution technique at a similar
   point in the play-through, and the stall is unrelated to that address.
2. A real trigger — something about resuming from a checkpoint sitting on this specific
   instruction, or about the graphics-mode-setup code path itself (VIC bank/screen-base rewrite
   during a raster-sensitive moment), causes `x64sc` to wedge.

Not established either way. A future session repeating the same `$DD00`-attribution-then-resume
technique should watch for a third occurrence at the same PC as a real signal, not noise.

## Suggested next step

Same as the sibling todo: host-side investigation of `x64sc`'s own state/logs at the moment of
the freeze, specifically checking whether a raster IRQ or VIC register write near `$D018`/`$DD00`
correlates with a wedged event loop. If a third instance of this exact PC recurs, escalate from
"worth flagging" to "worth root-causing before further live play-through work on this room."
