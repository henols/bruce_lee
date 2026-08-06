# `recovery/LOADING.md` -- the on-demand-load detection record

This document is the absence-as-evidence record: per release, the armed set with its justification, the idle calibration result, the coverage reached with a mechanical arrival proof per milestone, the states not reached, the attributed hits, and the teardown enumeration. Every measurement below was fetched by the executing agent's own `mcp__vice__*` tool calls; `.claude/skills/c64-ram-capture/scripts/watch-loads.mjs` and `.claude/skills/c64-ram-capture/scripts/dump-artifacts.mjs` hold only the pure logic that resolves, attributes, orders and renders it -- neither module contacted the emulator.

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
| title-screen | yes | 5bd33261ae91e055be878de2312fe97ec2dd82ef2b4607dc2bae59ea6adc8315 | 18492325 | 0 | recovery/danish/dumps/danish-loading-attempt5-title.png |
| game-start-chamber1 | yes | 12e6ed2ca8abf272ea3dc291aa9b1ac2ad26f3da540e773a264a20a658e6c836 | 80063552 | 0 | recovery/danish/dumps/danish-loading-attempt5-check1.png |
| death | yes |  | 81041688 | 0 | recovery/danish/dumps/danish-loading-attempt5-check18.png |
| game-over | yes | 3e16a2f4e4cbab1cc9080d704b94ec83a02af19ab45af702e8c131bcfb0c6e73 | 106083432 | 0 | recovery/danish/dumps/danish-loading-attempt5-check22.png |
| restart | yes | 5bd33261ae91e055be878de2312fe97ec2dd82ef2b4607dc2bae59ea6adc8315 | 226358495 | 0 | recovery/danish/dumps/danish-loading-attempt5-check46.png |

### States not reached

- A second real chamber transition for danish -- across SIX independent attempts this session (spanning three re-boots after host crashes and one fresh restart), Bruce died at the exact same sprite x-coordinate (~290-304) on the ground-level rightward path every single time, always transitioning to a PLAYER-1/GAME-OVER interstitial rather than a new room. Not yet root-caused: attempts included plain walking, walking-then-attacking, and an 'up' input partway along the path, none of which changed the outcome. The room's central blue chain-ladder structure was never successfully climbed -- 'up' input tried at three different x-positions (76, 148, 196) along the path produced only continued forward walking or a duck animation, never ascent -- so a vertical route to the room's exit, if one exists, was never located. A diagonal-jump attempt failed on a tool-parameter format error (direction passed as a string instead of an array) and was not successfully retried before the session's budget ran out.
- Both opponents encountered for danish -- one green ground-level enemy was repeatedly encountered (contact/attack exchanges observed via FALLS depletion and screenshots), and the static white/domed object on the pedestal appears to be scenery rather than an active opponent (never observed to move across many observations, across two separate game sessions). A new, distinct, elevated sprite (x=318,y=127) appeared after this session's restart -- positionally consistent with being the second opponent type -- but was not engaged before the session's live budget ran out.

### Attributed hits

(no hits recorded above the idle floor)

### Supplementary dumps

None -- no hit was classified `load-candidate` for this release.

### Hand-off to plan 02-02

The registry's `watch_set` entries for this release are the re-armable specification: plan 02-02's own executing agent re-arms the same set by issuing the same `mcp__vice__vice_checkpoint_add` calls during Phase 2's exhaustive all-chambers trace, and interprets what it observes with this module's pure `attributeAddress`, `reportHits` and `classifyHit` functions. This is a hand-off of data and procedure, not an executable -- plan 02-02's own plan text should describe agent-performed arming with acceptance criteria over a committed record rather than over an exit code. A late hit there reopens this document.

### Input sequence notes

Task 2: boot danish, walk the $0900 cracktro gate holding SPACE (matrix), release at the $08B1 trigger checkpoint. Task 3 (attempt 5, this session): F7 held 10 frames from title to start a 1-player game; vice_joystick_tap(right, 30-90 frames) repeatedly to cross chamber 1's opening room rightward, vice_joystick_tap(right, fire:true, 20-40 frames) attacks near enemy contact (this was also the technique that reliably unblocked Bruce's first steps away from the starting pole); vice_joystick_set(right) then vice_joystick_set(center) tested once (caused a fall, reverted to joystick_tap thereafter); vice_joystick_tap(up, 60-90 frames) tried at three x-positions to test climbing (no ascent observed at any of them). Strict discipline adopted mid-session and held for the remainder: vice_execution_pause immediately after every screenshot/memory-read/registers observation, vice_execution_run only for the bounded duration of the next scripted input -- see RE-FINDINGS.md 2026-08-02 entries.

Per D-12 this is plain notes, not a `verify/scripts/` artifact -- VERIFY-01 in Phase 3 owns the real input-script format; these notes are a seed for it, not a pre-empting specification.

### Teardown proof

Checkpoints remaining after teardown, from an explicit `mcp__vice__vice_checkpoint_list` enumeration: **0** (enumerated at post-idle-calibration (Task 2), via an explicit mcp__vice__vice_checkpoint_list call after deleting checkpoints 1, 174, 175, 176 individually by checkpoint_num. Re-confirmed count:0 three more times this session (2026-08-02) after each of the three host crashes and again at session end, via explicit mcp__vice__vice_checkpoint_list calls after deleting checkpoints 1 and 2 by checkpoint_num each time -- final enumeration at session end confirmed count:0 with the machine left running (execution_run issued last).).

### Identity changes

- {"when":"attempt 5, 2026-08-02, immediately after capturing the game-over milestone's full mechanical evidence and issuing vice_execution_run + vice_keyboard_matrix(F7) to test the restart milestone","what":"epoch 4 -> 5 (new pid 32923, spawned_at 2026-08-02T10:37:31Z). vice_execution_pause failed with UND_ERR_SOCKET naming a specific stale lease, the next vice_ping reported the epoch drift explicitly, and the call after that succeeded normally (execution:\"paused\", a fresh boot). vice_checkpoint_list on the new instance immediately returned count:0.","action":"voided only the in-flight restart-test step; the game-over milestone's evidence (screen signature, sprite_enable, registers, cycles_advanced) had already been read successfully on the prior confirmed-live epoch-4 instance with no crash indicator in between, so it stands unchanged. The whole boot procedure was redone from vice_disk_attach on the new epoch-5 instance to continue the play-through."}
- {"when":"attempt 5, same session, ~10 minutes later, immediately after re-booting on the epoch-5 instance and re-entering chamber1 (Bruce back at spawn x=52,y=225, FALLS 04), attempting a fire+right attack tap near the pole","what":"epoch 5 -> 6 (new pid 113631, spawned_at 2026-08-02T10:43:40Z). Same shape: UND_ERR_SOCKET then ECONNREFUSED on the tap/pause calls, then the next vice_ping reported the epoch drift explicitly, then the call after that succeeded (execution:\"paused\", fresh boot).","action":"voided the whole in-progress chamber1 re-entry (nothing had been captured as evidence yet on this leg -- only a screenshot at spawn with FALLS 04, no new milestone reached). Redid the full boot from vice_disk_attach on the new epoch-6 instance."}
- {"when":"attempt 5, same session, ~10 minutes later, near sprite x=76 on the last (4th) life while re-approaching the x~290-300 hazard zone that had killed Bruce twice already at that same location","what":"epoch 6 -> 7 (new pid 259402, spawned_at 2026-08-02T10:54:50Z). Same three-call shape as the prior two occurrences.","action":"voided the in-progress approach (no new milestone evidence lost). Redid the full boot from vice_disk_attach on the new epoch-7 instance. Three host crashes in roughly 20 minutes of continuous live work this session -- matching the historical rate recorded during saeger's attempt-4 boot."}

## Release: saeger

**Load-event count:**

1

> **⚠ THIS IS A PARTIAL RESULT, NOT A COMPLETED COVERAGE CLAIM.** The count above (`1`) reflects genuinely attributed hits from the portion of the play-through that did complete before this run was blocked -- it is not evidence that no further load events exist beyond what was reached. ATTEMPT 4 (2026-08-01, a genuinely fresh session, first tool call vice_ping): re-derived the whole saeger boot from scratch (Task 2's registry data reused as durable, not re-derived) and reached 5 of 7 required milestones with real evidence -- title-screen and game-start/chamber-1 (inherited from attempt 3, durable, unchanged), plus THIS session newly reached a death (FALLS-counter depletion causing a non-terminal respawn-in-place, screenshot-evidenced), a game over (full mechanical evidence: screenshot + screen-matrix signature + sprite_enable + registers), and a restart (F7 after game-over resumed active play with the FALLS counter reset to its initial value, screenshot-evidenced). IMPORTANT EVIDENTIARY GAP, recorded honestly rather than glossed over: only the game-over milestone has a full screen-matrix SHA-256 signature paired with its screenshot this session -- the death and restart milestones are evidenced by screenshot plus the HUD's own visible FALLS/1UP/GAME OVER text, but a screen-matrix signature was not separately captured at those exact moments before the session's stall. Two harder milestones were NOT reached despite six separate restart-from-title attempts: a second real chamber transition (the chamber-1 opening area has a fast-depleting FALLS hazard counter -- see .planning/RE-FINDINGS.md -- that killed Bruce Lee in roughly 4 input events regardless of direction, before enough distance could be covered to find the room's exit) and a clean, distinctly-evidenced both-opponents encounter (the green enemy visibly despawned after one punch and Bruce Lee was later found lying prone adjacent to both the green and white opponents near the pedestal, but no dedicated collision-attribution capture was taken). The session then hit a SECOND genuine silent stall (see .planning/RE-FINDINGS.md and the new todo cross-referencing attempt 3's identical-PC stall) while attempting one more clean death/restart capture pass with paired memory reads -- two independent 0-cycle brackets, vice_ping continuously "running", PC frozen at $07DE (the identical address attempt 3's own stall froze at) including immediately after an explicit vice_execution_pause. Per this project's rule and this plan's own instruction, no further play input was attempted once confirmed twice. This halted the session before danish's Task 3 play-through (still entirely unattempted in any session to date) could begin at all, and before saeger's remaining 2 milestones or the death/restart signature gap could be closed.

**Route:** the executing agent's own `mcp__vice__*` tool calls -- machine C64SC, video standard PAL, VICE server version 3.10.

### Armed set

| Sentinel | Kind | Tier | Type | Range | Reason | Evidence | Idle hits |
|---|---|---|---|---|---|---|---|
| loader:$0340-$03A0 | loader-reentry | stopping | exec | $0340-$03A0 | cassette-buffer / Datasette-buffer region (TBUFFR, $033C-$03FB per the C64 memory map), a classic loader-stub location; holds stale $01-byte data at steady state (not the power-on $00/$FF pattern), i.e. leftover raw-sector-loader scratch never reclaimed by the game. Wider than danish's analogous finding ($0340-$035E): saeger's uncrunched loader leaves a larger scratch footprint, $0340-$03A0 (97 bytes). | Live disassembly and a precise 192-byte vice_memory_read($02F0, size:192) spanning $02F0-$03AF: $0340-$03A0 reads as the single repeated byte $01 throughout (disassembles as ORA ($01,X) at every boundary checked), with $03A1 onward reading ordinary $00 filler. | 0 |
| reg:$DD00 | register | counting | write | $DD00-$DD00 | CIA2 port A -- VIC-II bank-select bits plus bit-banged serial-bus lines a KERNAL-bypassing raw-sector loader toggles directly; the primary on-demand-load sentinel. | c64-memory-mapping skill memmap: $DD00 bits 0-1 select the VIC bank; bits 3-5 are the serial bus ATN OUT/CLOCK OUT/DATA OUT lines. Live read at steady state: $DD00 = $C1 (%11000001) -> VIC bank 2 ($8000-$BFFF), matching the $D018=$31 screen-base decode used for the counting-tier probe below. | 1 |

### Idle calibration

Cycles advanced during the no-input idle window: **51563549**.

| Sentinel | Tier | Range | Idle hits |
|---|---|---|---|
| loader:$0340-$03A0 | stopping | $0340-$03A0 | 0 |
| reg:$DD00 | counting | $DD00-$DD00 | 1 |

### Counting-tier probe

Observed hit count: 432. Execution stopped during the probe: false.

### Coverage reached

| Milestone | Reached | Screen signature | Cycles advanced | Retries | Screenshot |
|---|---|---|---|---|---|
| title-screen | yes | 4797375c21d2cb1ec44d2713f14a68e778442d1a153cc10fc9c202b60010c2bd | 51563549 | 0 | recovery/saeger/dumps/saeger-loading-01-title.png |
| game-start-chamber1 | yes | 6b0010cecea54728fecb6b35d09bf80a41f4a741be6fb17b73898a22165f1f42 | 24071261 | 0 | recovery/saeger/dumps/saeger-loading-02-postf7.png |
| death | yes | 170ceb758bc23c12f8904ff9f91af34ac7892bbbcc2ffdba5e8c369825aea269 | 79390584 | 0 | recovery/saeger/dumps/saeger-loading-attempt6-death-falls00.png |
| game-over | yes | 5bd33261ae91e055be878de2312fe97ec2dd82ef2b4607dc2bae59ea6adc8315 | 22595389 | 0 | recovery/saeger/dumps/saeger-loading-attempt4-check4.png |
| restart | yes | bc914a06db575c7acda78fe4060a7b2ca7c60eb9caf36bf0584c9cad22ccedfc | 5837832 | 0 | recovery/saeger/dumps/saeger-loading-attempt6-restart-check.png |

### States not reached

- A second real chamber transition (beyond entering chamber 1) -- six separate restart-from-title attempts in attempt 4 died in chamber 1's opening area, originally attributed to the FALLS hazard-counter mechanic. Attempt 6 (2026-08-06) reframed FALLS as an ordinary lives counter (see RE-FINDINGS.md) and, with disciplined pausing, walked Bruce cleanly from spawn to sprite x=244 (the doorway) three separate times across three lives -- but each time died shortly after, once from an unidentified hazard near x=244 itself and once at sprite x=300, CONFIRMING for saeger the identical x~290-304 death coordinate danish recorded across six independent attempts of its own. This is now a cross-release, shared-game-code hazard, not a release-specific or FALLS-specific one. Two diagonal-jump `direction` syntaxes for `vice_joystick_tap` (a genuine array `["up","right"]`, and the hyphenated/concatenated strings `"up-right"`/`"upright"`) were tried and rejected identically (`Invalid direction`) -- see RE-FINDINGS.md 2026-08-06. Not a stall or crash -- a genuine, now cross-confirmed, gameplay-navigation limit not yet overcome by either release.
- A clean, dedicated both-opponents-encountered capture -- the green enemy visibly despawned from the screen after one punch (attempt4-check6.png vs check7.png) and Bruce Lee was later found lying prone adjacent to both the green and white opponents near the pedestal (attempt4-check11.png), but no collision was captured with a dedicated PC/backtrace/disassembly attribution the way the $DD00 gameplay-write hit was. Recorded as suggestive visual evidence, not as a fully mechanically-proven milestone. Attempt 6 did not add a dedicated capture either -- its live budget went to closing the death/restart evidentiary gaps (the session's prescribed priority) and to the x~290-304 cross-release corroboration above.

### Attributed hits

| Cycle | Address | Sentinel | Tier | Classification | Evidence |
|---|---|---|---|---|---|
| 24071261 | $DD00 | reg:$DD00 | counting | gameplay-write | $07D9: LDA #$01 / $07DB: STA $DD00 / $07DE: LDA #$38 / $07E0: STA $D018 -- reasserts VIC bank 2 (bits 0-1 = 01, unchanged from $C1's own bank-2 selection) while clearing the CIA2 port A's other bits, immediately followed by a new $D018 charset/screen-base value. Part of a room/chamber graphics-mode-setup routine invoked during the title-to-chamber-1 transition (and again on later room draws, per the counting-tier hit count climbing from the idle floor of 1 to 5 during this transition, then to a fresh 1 on the freshly re-armed checkpoint after one vice_joystick_tap move). |

### Supplementary dumps

None -- no hit was classified `load-candidate` for this release.

### Hand-off to plan 02-02

The registry's `watch_set` entries for this release are the re-armable specification: plan 02-02's own executing agent re-arms the same set by issuing the same `mcp__vice__vice_checkpoint_add` calls during Phase 2's exhaustive all-chambers trace, and interprets what it observes with this module's pure `attributeAddress`, `reportHits` and `classifyHit` functions. This is a hand-off of data and procedure, not an executable -- plan 02-02's own plan text should describe agent-performed arming with acceptance criteria over a committed record rather than over an exit code. A late hit there reopens this document.

### Input sequence notes

Task 2: boot saeger, queue a PETSCII SPACE (mcp__vice__vice_keyboard_petscii, data:[32]) into the KERNAL keyboard buffer only after vice_backtrace confirmed the call chain was inside the $08F4 gate's own JSR $FFE4 (called_from $08F6), release at the $08B1 trigger checkpoint. Task 3 (attempt 4, partial): held F7 (vice_keyboard_matrix, 10 frames) at the title screen to begin a 1-player game, reaching chamber 1; sent one vice_joystick_tap(direction:right, duration_frames:60) then one vice_joystick_tap(direction:right, duration_frames:90) to move Bruce Lee, which produced the one attributed $DD00 hit above; no further input was sent once the silent stall was confirmed. Task 3 (attempt 6, 2026-08-06, closing the death/restart evidentiary gaps): F7 hold via keyboard_matrix hold_frames proved unreliable this session (repeated attempts at 10/15/30/60 frames left the machine on the title screen); switched to an explicit vice_keyboard_matrix(key:F7, pressed:true) immediately followed by vice_execution_run/ping/vice_execution_pause/vice_keyboard_matrix(key:F7, pressed:false), which registered reliably every time it was tried (both to start a fresh game from title and to restart directly from GAME OVER). Movement used vice_joystick_tap(direction:right, duration_frames:30-60) for plain walking and vice_joystick_tap(direction:right, fire:true, duration_frames:30) for the punch-attack that both advances Bruce past a blocking enemy and depletes the enemy's own health; repeated fire+right taps against chamber1's green ground enemy produced the full FALLS 04->03->02->01->00 depletion sequence and the terminal GAME OVER, each transition captured with a paired vice_memory_read of the screen matrix in the same paused instant as its confirming screenshot.

Per D-12 this is plain notes, not a `verify/scripts/` artifact -- VERIFY-01 in Phase 3 owns the real input-script format; these notes are a seed for it, not a pre-empting specification.

### Teardown proof

Checkpoints remaining after teardown, from an explicit `mcp__vice__vice_checkpoint_list` enumeration: **0** (enumerated at post-idle-calibration (Task 2), via an explicit mcp__vice__vice_checkpoint_list call after deleting checkpoints 1 and 2 individually by checkpoint_num; a second explicit mcp__vice__vice_checkpoint_list call after re-arming and tearing down the counting-tier probe's own checkpoint (checkpoint_num 1, re-used after the calibration checkpoints were deleted) also confirmed count:0. A third enumeration (attempt 3, Task 3, post-stall) confirmed count:0 again after deleting the two checkpoints (loader-reentry + $DD00, re-armed as checkpoint_num 1 and 3) that were live during the play-through -- vice_checkpoint_list and vice_checkpoint_delete both remained reliable throughout that silent stall, unlike vice_registers_get/vice_execution_pause/the cycle-advancement path. A FOURTH and final enumeration (attempt 4, this session, post-SECOND-stall) confirmed count:0 again after deleting checkpoints 1 (loader-reentry) and 2 ($DD00 counting) -- checkpoint management remained reliable through this session's stall too, matching the same pattern.).

### Identity changes

- {"when":"immediately after vice_autostart + vice_execution_run on saeger.d64, mid-boot, several non-pausing vice_ping polls in","what":"epoch 8 -> 9 (pid 827101 -> 944178). Proxy surfaced UND_ERR_SOCKET then ECONNREFUSED on two vice_ping calls, then a distinct epoch-drift error on the third naming both epoch numbers. A fresh cycles_stopwatch bracket on the new epoch-9 instance measured 13,501,532 cycles -- genuinely live.","action":"treated everything since the last confirmed-good point (the danish liveness bracket) as void; redid vice_disk_attach/vice_autostart/vice_execution_run from scratch on the epoch-9 instance"}
- {"when":"~8 minutes later, immediately after a clean counting-tier probe on the epoch-9 instance (45,519,518 cycles, non-stopping checkpoint hit_count 2513)","what":"epoch 9 -> 10 (pid 944178 -> 1056804). Same error shape: UND_ERR_SOCKET then ECONNREFUSED on vice_checkpoint_add, then epoch-drift confirmed on the next vice_ping. Fresh bracket on epoch-10: 19,017,687 cycles.","action":"voided the epoch-9 probe result and the not-yet-armed calibration checkpoints; redid the full boot from vice_disk_attach on the epoch-10 instance"}
- {"when":"during a single boot attempt on the epoch-10 instance that had already run ~498,181,326 cycles (per two vice_cycles_stopwatch reads) with the armed $08B1 trigger checkpoint still at hit_count 0","what":"epoch 10 -> 11 (pid 1056804 -> 1110262), surfaced the same way (vice_execution_pause/vice_registers_get/vice_backtrace all failed with UND_ERR_SOCKET/ECONNREFUSED, then vice_ping reported the epoch drift). Fresh bracket on epoch-11: 12,312,150 cycles.","action":"logged .planning/todos/pending/2026-08-01-vice-crashes-three-times-during-sustained-execution-01-04-task2-saeger.md; voided the entire stuck boot attempt; did a clean vice_disk_detach + vice_machine_reset(hard, run_after:false) before redoing the boot on the epoch-11 instance -- the boot that ultimately succeeded and produced every result below"}

