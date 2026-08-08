---
created: 2026-08-08T00:00:00.000Z
title: Hunt for inherited trainers in both cracked releases — signatures, not just the diff
area: re
severity: major
files:
  - .planning/REQUIREMENTS.md
  - .planning/notes/cheat-policy-and-build-time-switch.md
  - recovery/PROVENANCE.md
  - recovery/PROVENANCE.prose.md
---

## Problem

The rebuild reproduces what the recovered image contains. If either cracked release carries a
**trainer** — a cracker-added gameplay alteration such as unlimited lives or collision
disabled — the rebuild inherits it silently, and the game does not play as Datasoft shipped
it. Nothing in the pipeline currently looks for one.

`RECOVER-06` gives every byte range a provenance verdict (original / cracker-modified /
uncertain), but the verdict stops at *who wrote it*. It does not say **what a cracker-modified
range does**, so a trainer and a relocated loader stub carry the same label.

**And the diff cannot close this on its own.** A two-release comparison only surfaces a trainer
that one cracker added and the other did not. If danish and saeger share an ancestor — which is
exactly what `RECOVER-07` is still open to determine — a shared trainer produces **no diff at
all**, and a clean diff would be misread as proof of absence.

This is why `MAP-06` commissions an active signature hunt rather than diff classification
alone. Decision and reasoning: `.planning/notes/cheat-policy-and-build-time-switch.md`.

## What to do

Two passes. The first rides existing work; the second is the one that closes the blind spot.

### Pass 1 — classify what the diff already found

For every range the provenance ledger marks cracker-modified, add a **function** verdict
alongside the existing origin verdict:

- `loader` — raw-sector loading, decrunch, relocation, drive code
- `cracktro` — intro, scroller, music, the crack's own presentation
- `gameplay` — anything that reads or writes game state
- `unknown` — not yet attributed

Only `gameplay` and `unknown` proceed to Pass 2's scrutiny. `loader` and `cracktro` are already
out of scope per `REQUIREMENTS.md` § Out of Scope (*"Documenting the crackers' loaders and
cruncher as subjects"*) and per the pending
`2026-08-02-strip-cracktro-and-cruncher-code-from-the-re-scope` todo.

### Pass 2 — hunt signatures, independent of the diff

Run against the canonical image once `MAP-01`'s coverage map exists, so "never executed" is a
real answer rather than a guess.

1. **Writes to the lives counter from an unexpected site.** `$0028` is the lives counter, and
   its known legitimate writer is `$1826` (`DEC $28`), with a read at `$1774` feeding the
   `FALLS` HUD digit. Search every addressing form that can reach it — `STA $28` / `STA $0028`,
   and the indexed forms (`STA $0000,X` and `STA $0000,Y` with the index landing on `$28`),
   since attempt 7's search for `$0104`'s writer missed it precisely by checking absolute mode
   only. Any writer that is not `$1826` is a trainer candidate.
2. **The same sweep for the other consequence counters** once the memory map names them —
   score, timer, opponent health. A trainer that freezes a value is an `LDA #imm / STA` where
   the original had a `DEC` or `INC`.
3. **Armed but never reached.** Cross-reference the coverage map: code that is jumped to from a
   patched region but never executes during full gameplay coverage is either dead crack
   scaffolding or a trainer waiting on a trigger. Both need a verdict; neither should be
   reproduced without one.
4. **Trigger scanners.** Trainers of this era commonly key off a keypress at the title screen
   or during play. Look for reads of `$DC00`/`$DC01`/`$00CB` in code that is not the game's own
   input handler, and for comparisons against key codes in a region the ledger already marks
   cracker-modified.
5. **`NOP` sleds and branch inversions over game logic.** The cheapest trainer is a patched-out
   check: `EA EA EA` where a `JSR`/`DEC` was, or a `BEQ`↔`BNE` flip on a collision or
   life-decrement test. These show as diffs of a few bytes inside otherwise-original code —
   the pattern most easily dismissed as noise, and the one that matters most.

### Recording the result

Every candidate found gets a verdict — trainer, or explained-as-something-else — with the
evidence, in the provenance ledger. **A negative is a result**: "no trainer found, by these five
signatures, at this coverage level" is what `MAP-06` needs to be satisfiable at all, and it must
state its own limits rather than reading as proof of absence.

Anything confirmed as a trainer goes to `BUILD-08` — documented, and behind a conditional-assembly
switch that is off in the default build.

## Depends on

- **`RECOVER-07`** — the ancestry verdict sets how much the diff is worth here. Shared ancestor
  means Pass 2 is the only detector; genuinely independent cracks mean Pass 1 is a real backstop.
  **Do not run Pass 1 alone and treat a clean result as an answer while `RECOVER-07` is open.**
- **`MAP-01`** — the coverage map, for signature 3.
- **`MAP-04`** — the memory map, for signature 2's counter addresses.

## Related

- `MAP-06`, `BUILD-08` in `.planning/REQUIREMENTS.md`
- `.planning/notes/cheat-policy-and-build-time-switch.md`
- `.planning/phases/01-recovery-provenance/01-04-ATTEMPT-7-HALT.md` — where `$0028` and `$1826`
  were established live
