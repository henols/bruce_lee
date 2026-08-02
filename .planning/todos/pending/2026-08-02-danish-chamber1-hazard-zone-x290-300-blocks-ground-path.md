# danish chamber 1's ground-level rightward path dies at sprite x~290-304 every time

**Filed:** 2026-08-02, during 01-04 attempt 5's danish Task 3 play-through
**Priority:** blocks the remaining 2/7 milestones for danish (a second chamber transition, both
opponents encountered) -- see `.planning/RE-FINDINGS.md` 2026-08-02 entry for full detail.

## Problem

Across six independent attempts this session, walking Bruce Lee rightward along chamber 1's
ground floor from the starting pole reaches almost exactly sprite `x=296-304` before an immediate
death, regardless of enemy encounters or attacks along the way. Three techniques were tried and
ruled out:

1. Plain `right` taps through the zone -- always died.
2. `right`+`fire` attack taps at the same zone -- always died.
3. `up` taps at three different x-positions (76, 148, 196) to test whether the room's visible
   central blue chain-ladder is climbable -- produced only continued walking or a duck animation,
   never ascent.

A fourth technique -- a diagonal jump via `vice_joystick_tap({ direction: ["up","right"] })` --
was attempted once but failed on a tool-parameter format error (the direction was passed as a
JSON string `"[\"up\",\"right\"]"` instead of an actual array) and was not successfully retried.

## Suggested next steps, in priority order

1. **Retry the diagonal jump with correct array syntax** (`direction: ["up","right"]` as an actual
   array parameter) exactly at the x~280-296 approach to the hazard zone. A jump-over is the most
   likely fix for a "precise x-coordinate kill" shape, consistent with a pit/trap/spike hazard at
   that exact location rather than a random enemy encounter.
2. **If that fails, arm a live disassembly/backtrace capture at the moment of death** (a stopping
   checkpoint just before the kill, or a paused-state read right as it happens) to identify the
   exact code path and hazard type mechanically, rather than continuing blind trial-and-error.
3. **The central chain-ladder's climb point, if one exists, was never found.** It may require
   a jump onto it rather than a simple directional approach from the ground, or it may not be
   climbable at all and the room's exit is elsewhere entirely (worth checking whether the room
   scrolls, or whether there's an exit off the left/bottom of the visible screen not yet explored).

## Context

danish's Task 3 pass reached 5 of 7 required milestones this session (title-screen,
game-start-chamber1, death, game-over, restart), the first progress on this release across five
attempts of plan 01-04. saeger independently reached the same 5/7 count in attempt 4, blocked by
its own different hazard (a FALLS-counter depletion mechanic, later partially reframed by this
session's think-time-pause discipline finding -- see RE-FINDINGS.md). Both releases now need the
same two remaining milestones (second chamber transition, both opponents) to complete Task 3.
