# `recovery/LOADING.md` -- the on-demand-load detection record

This document is the absence-as-evidence record: per release, the armed set with its justification, the idle calibration result, the coverage reached with a mechanical arrival proof per milestone, the states not reached, the attributed hits, and the teardown enumeration. Every measurement below was fetched by the executing agent's own `mcp__vice__*` tool calls; `tools/watch-loads.mjs` and `tools/dump-artifacts.mjs` hold only the pure logic that resolves, attributes, orders and renders it -- neither module contacted the emulator.

## Release: danish

**Load-event count:**

0

**Route:** the executing agent's own `mcp__vice__*` tool calls -- machine C64SC, video standard PAL, VICE server version 3.10.

### Armed set

| Sentinel | Kind | Tier | Type | Range | Reason | Evidence | Idle hits |
|---|---|---|---|---|---|---|---|
| loader:$0340-$035E | loader-reentry | stopping | exec | $0340-$035E | cassette-buffer region, a classic loader-stub location; holds stale $01-byte data at steady state, i.e. leftover raw-sector-loader scratch never reclaimed by the game | Live disassembly at steady state (post-$08B1 trigger), both boundaries: $0340: 01 01 ORA ($01,X) [repeats through $034A] and $0356: 01 01 ORA ($01,X) [repeats through $0360] -- the whole range decodes as the single repeated byte $01. | 0 |
| reg:$DD00 | register | counting | write | $DD00-$DD00 | CIA2 port A -- VIC-II bank-select bits plus bit-banged serial-bus lines a KERNAL-bypassing raw-sector loader toggles directly; the primary on-demand-load sentinel. | c64-memory-mapping skill memmap: $DD00 bits 0-1 select the VIC bank; bits 3-5 are the serial bus ATN OUT/CLOCK OUT/DATA OUT lines. | 0 |

### Idle calibration

Cycles advanced during the no-input idle window: **24396568**.

| Sentinel | Tier | Range | Idle hits |
|---|---|---|---|
| loader:$0340-$035E | stopping | $0340-$035E | 0 |
| reg:$DD00 | counting | $DD00-$DD00 | 0 |

### Counting-tier probe

Observed hit count: 432. Execution stopped during the probe: false.

### Coverage reached

| Milestone | Reached | Screen signature | Cycles advanced | Retries | Screenshot |
|---|---|---|---|---|---|

### States not reached

(nothing recorded as not reached -- if this looks wrong, the record is incomplete, not the coverage)

### Attributed hits

(no hits recorded above the idle floor)

### Supplementary dumps

None -- no hit was classified `load-candidate` for this release.

### Hand-off to plan 02-02

The registry's `watch_set` entries for this release are the re-armable specification: plan 02-02's own executing agent re-arms the same set by issuing the same `mcp__vice__vice_checkpoint_add` calls during Phase 2's exhaustive all-chambers trace, and interprets what it observes with this module's pure `attributeAddress`, `reportHits` and `classifyHit` functions. This is a hand-off of data and procedure, not an executable -- plan 02-02's own plan text should describe agent-performed arming with acceptance criteria over a committed record rather than over an exit code. A late hit there reopens this document.

### Input sequence notes

Task 2 only: boot danish, walk the $0900 cracktro gate holding SPACE (matrix), release at the $08B1 trigger checkpoint. No gameplay input issued yet -- see Task 3 for the play-through.

Per D-12 this is plain notes, not a `verify/scripts/` artifact -- VERIFY-01 in Phase 3 owns the real input-script format; these notes are a seed for it, not a pre-empting specification.

### Teardown proof

Checkpoints remaining after teardown, from an explicit `mcp__vice__vice_checkpoint_list` enumeration: **0** (enumerated at post-idle-calibration, via an explicit mcp__vice__vice_checkpoint_list call after deleting checkpoints 1, 174, 175, 176 individually by checkpoint_num).

## Release: saeger

**Load-event count:**

0

> **⚠ THIS IS NOT AN EVIDENCED ZERO.** The count above is `0` only because no live emulator work reached completion for this release this run -- it is a bare absence of attempted measurement, not a null result earned by an idle calibration on a machine proven to have executed. Boot never progressed past its pre-loader state for saeger.d64 this session; two independent vice_cycles_stopwatch reset->run->poll->read brackets both measured exactly 0 cycles advanced despite vice_ping reporting execution:"running" throughout. See .planning/todos/pending/2026-08-01-vice-registers-frozen-after-reset-during-01-04-task2.md for the full incident record.

**Route:** the executing agent's own `mcp__vice__*` tool calls -- machine C64SC, video standard PAL, VICE server version 3.10.

### Armed set

| Sentinel | Kind | Tier | Type | Range | Reason | Evidence | Idle hits |
|---|---|---|---|---|---|---|---|

### Idle calibration

Cycles advanced during the no-input idle window: **0**.

| Sentinel | Tier | Range | Idle hits |
|---|---|---|---|

### Counting-tier probe

Observed hit count: unrecorded. Execution stopped during the probe: unrecorded.

### Coverage reached

| Milestone | Reached | Screen signature | Cycles advanced | Retries | Screenshot |
|---|---|---|---|---|---|

### States not reached

(nothing recorded as not reached -- if this looks wrong, the record is incomplete, not the coverage)

### Attributed hits

(no hits recorded above the idle floor)

### Supplementary dumps

None -- no hit was classified `load-candidate` for this release.

### Hand-off to plan 02-02

The registry's `watch_set` entries for this release are the re-armable specification: plan 02-02's own executing agent re-arms the same set by issuing the same `mcp__vice__vice_checkpoint_add` calls during Phase 2's exhaustive all-chambers trace, and interprets what it observes with this module's pure `attributeAddress`, `reportHits` and `classifyHit` functions. This is a hand-off of data and procedure, not an executable -- plan 02-02's own plan text should describe agent-performed arming with acceptance criteria over a committed record rather than over an exit code. A late hit there reopens this document.

### Input sequence notes

One PETSCII SPACE (mcp__vice__vice_keyboard_petscii, data:[32]) was queued for saeger's kernal-buffer gate delivery per recovery/RELEASES.json's boot.gates entry, but the boot never progressed far enough for the gate to matter.

Per D-12 this is plain notes, not a `verify/scripts/` artifact -- VERIFY-01 in Phase 3 owns the real input-script format; these notes are a seed for it, not a pre-empting specification.

### Teardown proof

Checkpoints remaining after teardown, from an explicit `mcp__vice__vice_checkpoint_list` enumeration: **0** (enumerated at checkpoint_list and checkpoint_delete remained reliable throughout the stall (unlike registers_get and the cycle-advancement path), so the one trigger checkpoint armed at $08B1 for saeger was deleted by its checkpoint_num and confirmed by an explicit mcp__vice__vice_checkpoint_list reporting count:0, after the decision to halt further live investigation. This IS a genuine empty-enumeration proof, taken specifically to avoid leaving an armed checkpoint behind even though the rest of this release's Task 2 work could not be completed.).

### Identity changes

- {"when":"after switching from danish.d64 to saeger.d64 mid-session","what":"vice_registers_get had already frozen (see the danish hit log and the linked todo); vice_cycles_stopwatch subsequently confirmed genuine zero cycle advancement across two independent brackets on saeger.d64 too -- the stall widened from one tool (vice_registers_get) to the whole execution-advancement path","action":"halted all further live emulator work for this session rather than retrying into a believed-good answer"}

