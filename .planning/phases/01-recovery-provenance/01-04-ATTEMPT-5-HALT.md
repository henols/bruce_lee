<!--
NOT A SUMMARY. This is the halt record of plan 01-04 attempt 5 (2026-08-02).

Named ATTEMPT-5-HALT rather than 01-04-SUMMARY.md, following the precedent set by attempts 1-4
and the explicit STATE.md/resume-context lesson: a SUMMARY.md with status: blocked makes
phase-plan-index report has_summary: true and silently drop 01-04 from the incomplete-plans
list. This attempt made the largest single-session leap of the five: danish's Task 3 pass,
entirely unattempted across attempts 1-4, went from 0/7 to 5/7 required milestones in one
session -- matching saeger's own count from attempt 4. Neither release's full milestone bar is
complete and Task 4 was not reached, so the same naming discipline applies: the real
SUMMARY.md is written once a future attempt actually finishes the plan.

Committed this attempt: 9396d26 (RE finding: unpaused think-time), 66cf5b5 (danish Task 3,
4/7 milestones), 7b944a8 (3 host crashes logged), d5ce0c0 (danish restart milestone, 5/7),
6fd66bb (hazard-zone confirmation + pending todo).
-->

---
phase: 01-recovery-provenance
plan: 04
subsystem: infra
tags: [vice-mcp, on-demand-load-detection, host-instability, agent-think-time, screen-matrix-signature, node-crypto]

# Dependency graph
requires:
  - phase: 01-recovery-provenance (plan 01-03)
    provides: recovery/RELEASES.json's committed run1 dumps (bin/state/map/capture) for both releases, and the shared $08B1 trigger
  - phase: 01-recovery-provenance (plan 01-04 attempt 1)
    provides: "tools/watch-loads.mjs and tools/dump-artifacts.mjs -- the detector's pure logic and artifact renderer, fully tested with no emulator present"
  - phase: 01-recovery-provenance (plan 01-04 attempts 2-3)
    provides: "both releases' complete Task 2 pass (loader_ranges, rejected_candidates, watch_set, idle calibration, NOTES.md corrections); saeger's first 2 Task 3 milestones (title-screen, game-start-chamber1) with one attributed gameplay-write hit"
  - phase: 01-recovery-provenance (plan 01-04 attempt 4)
    provides: "saeger's Task 3 progress extended to 5 of 7 milestones (title-screen, game-start-chamber1, death, game-over, restart), with death and restart carrying a recorded evidentiary_gap"
provides:
  - "danish's Task 3 pass FIRST ATTEMPTED and extended to 5 of 7 required milestones: title-screen, game-start-chamber1, death, game-over, restart -- all with full mechanical proof (screen-matrix SHA-256 signature, sprite_enable, cycles_advanced, screenshot), matching saeger's own count"
  - "A major methodology finding: unpaused agent think-time between tool calls burns real emulated game-seconds unattended unless vice_execution_pause is called explicitly after every observation -- this directly threatens attempt 4's saeger 'FALLS depletes per input event' conclusion, since that session never adopted this discipline either. Confirmed live: once adopted, danish's opening hazard room (the same room-shape that cost saeger six failed restarts) was crossed cleanly on the very next attempt"
  - "A precisely-located, reproducible gameplay obstacle identified for danish: Bruce Lee dies at the exact same sprite x-coordinate (~290-304) on chamber 1's ground-level rightward path across six independent attempts, ruling out plain walking, attack taps, and up-taps at three positions as fixes. Filed as a pending todo with concrete next steps rather than left as an unexplained blocker"
  - "Three genuine mid-session host VICE crashes (epoch 4->5, 5->6, 6->7) logged and confirmed self-healing on the next call, consistent with the documented pattern -- no in-session evidence was lost to any of them"
affects: [01-05, 01-06, 02-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Explicit vice_execution_pause after every observation (screenshot, memory read, registers_get, sprite_get) that is not immediately followed by a deliberate scripted input, with vice_execution_run only for the bounded duration of that input -- adopted mid-session after discovering the machine runs at full speed through agent reasoning/tool-call latency otherwise. Confirmed by two consecutive vice_cycles_stopwatch reads returning an identical value once genuinely paused."
    - "A death/milestone tied to a precise sprite x-coordinate (not an input count, not an elapsed-time budget) is a different hazard shape from saeger's own FALLS-counter mechanic, and is diagnosed the same way: track the exact sprite position via vice_sprite_get at each step rather than inferring position from screenshots alone."
    - "A file-based hash computation (Write the exact hex string to a scratch file, then hash from disk) avoids the manual-transcription risk of retyping a 2000-character hex string inline in a Bash command -- this project has now hit that exact transcription bug twice (once in 01-05's own history, once again this attempt) and the file-based method caught it immediately via a length mismatch."

key-files:
  created:
    - .planning/todos/pending/2026-08-02-danish-chamber1-hazard-zone-x290-300-blocks-ground-path.md
    - recovery/danish/dumps/danish-loading-attempt5-title.png
    - recovery/danish/dumps/danish-loading-attempt5-check1.png through check53.png (53 screenshots total, full session evidence trail)
    - .planning/phases/01-recovery-provenance/01-04-ATTEMPT-5-HALT.md
  modified:
    - recovery/danish/dumps/danish-loading-hits.json
    - .planning/RE-FINDINGS.md

key-decisions:
  - "Adopted a strict vice_execution_pause-after-every-observation discipline mid-session after discovering, live, that ~262 real seconds of emulated game time elapsed between one healthy chamber-1 observation and a GAME OVER screen with ZERO joystick input sent in between -- proving the machine runs unattended through agent reasoning time unless explicitly paused. This is recorded as a methodology finding that likely confounds attempt 4's own saeger FALLS-counter conclusion, not just as a fix for this session."
  - "Recorded FALLS milestone evidence with the mechanical proof the plan requires (screen-matrix SHA-256 differing from title baseline, sprite_enable, cycles_advanced>0, screenshot) for all 5 reached milestones, including a careful file-based hash recomputation for game-over after an initial inline-transcription attempt produced a wrong byte length and was correctly discarded rather than used."
  - "Recorded the restart milestone's screen-signature match to the title baseline as the CORRECT and expected outcome for that specific milestone (rather than incorrectly applying the general 'matches baseline = not reached' rule, which is meant for gameplay milestones where reaching the baseline indicates failure to progress) -- since a genuine restart legitimately returns play to the title/menu screen."
  - "Stopped spending danish's live budget on the x~290-304 hazard after six independent, reproducible failures at the identical coordinate, rather than continuing indefinite trial-and-error. Filed a pending todo with concrete next steps (correct diagonal-jump array syntax, or a live disassembly capture at the death point) per the plan's own bounded-retry philosophy."
  - "Treated all three host VICE crashes (epoch 4->5, 5->6, 6->7) as self-healing per the documented pattern rather than as session-ending stalls: each was confirmed via the loud transport-error-then-epoch-drift-report shape, distinct from a genuine silent stall, and each resolved cleanly on the next vice_ping call with an empty, fresh checkpoint list."
  - "Named this file ATTEMPT-5-HALT rather than 01-04-SUMMARY.md, matching attempts 1-4's own precedent and the explicit STATE.md lesson about phase-plan-index silently dropping an incomplete plan from incomplete when a SUMMARY.md-named file with status: blocked exists."

requirements-completed: []  # RECOVER-04 is NOT complete -- Task 3's full milestone bar (both releases) and Task 4 have not been reached.

coverage:
  - id: D1
    description: "Detector pure logic and artifact renderer (Task 1, inherited, unchanged this attempt)"
    requirement: "RECOVER-04"
    verification:
      - kind: unit
        ref: "tools/watch-loads.test.mjs (24 tests) && tools/dump-artifacts.test.mjs (14 tests) -- 38 total, unchanged from attempts 3-4"
        status: pass
      - kind: other
        ref: "node tools/recovery-schema.mjs check-parameterisation && node tools/recovery-schema.mjs validate -- both re-run at end of this attempt and pass"
        status: pass
    human_judgment: false
  - id: D2
    description: "Earn the armed set live, calibrate idle to zero, prove teardown, correct NOTES.md defects, for BOTH releases (Task 2)"
    requirement: "RECOVER-04"
    verification:
      - kind: manual
        ref: "danish and saeger: both complete, inherited unchanged from attempts 2-3 (commits 72eb6e7, 5e68dc5). Not re-derived this attempt -- durable registry data, per the resume context's explicit instruction not to redo it."
        status: pass
    human_judgment: false
    rationale: "Task 2's own acceptance criteria remain fully met for both releases, as established by prior attempts; this attempt made no changes to that data."
  - id: D3
    description: "Bounded play-through, hit attribution, supplementary dumps, recovery/LOADING.md, for BOTH releases (Task 3)"
    requirement: "RECOVER-04"
    verification:
      - kind: manual
        ref: "danish: 5 of 7 required milestones reached this attempt (title-screen, game-start-chamber1, death, game-over, restart), all with full mechanical proof. 2 remaining milestones (a second real chamber transition, both opponents encountered) explicitly recorded as not-reached due to a genuine, precisely-located gameplay obstacle at sprite x~290-304, not a stall or crash -- see the pending todo and RE-FINDINGS.md."
        status: fail
      - kind: manual
        ref: "saeger: unchanged from attempt 4 -- still 5 of 7 milestones (title-screen, game-start-chamber1, death, game-over, restart), with death and restart carrying a recorded evidentiary_gap. Not re-attempted this session; this attempt's entire live budget went to danish, per the resume context's explicit priority (danish was 0/7 across four attempts, the single biggest gap)."
        status: fail
    human_judgment: true
    rationale: "Task 3's acceptance criteria explicitly require the full milestone set for BOTH releases, each with full mechanical proof, before the coverage claim is ready for the Task 4 human checkpoint. Both releases now stand at 5/7, materially closer than any prior attempt (danish went from 0/7 to 5/7 in this single session), but neither meets the full bar."
  - id: D4
    description: "Task 4 checkpoint:human-verify -- confirm the coverage claim against the evidence"
    requirement: "RECOVER-04"
    verification: []
    human_judgment: true
    rationale: "Not reached -- gated on Task 3's completion for both releases, which did not occur."

# Metrics
duration: partial (danish extended from 0/7 to 5/7 milestones this session; saeger unchanged at 5/7 from attempt 4)
completed: 2026-08-02
status: blocked
---

# Phase 01 Plan 04: On-Demand-Load Detector -- Attempt 5: Danish Reached 5/7 Milestones (Up From 0/7), Both Releases Now At Parity, Task 4 Not Reached

**This attempt opened a fresh session and, for the first time across five attempts of this plan, actually attempted danish's Task 3 play-through -- previously entirely untouched. It re-derived danish's whole boot procedure from scratch (Task 2's registry data reused as durable), then discovered and adopted a major methodology fix mid-session: the emulator runs at full speed through agent reasoning/tool-call latency unless `vice_execution_pause` is called explicitly after every observation, which had been silently burning real game-seconds across all of this project's play-through sessions and very plausibly confounded attempt 4's own "FALLS depletes per input event" conclusion for saeger. Once this discipline was adopted, danish's opening hazard room -- structurally the same shape of room that cost saeger six failed restarts in attempt 4 -- was crossed cleanly on the very next attempt. The session went on to reach 5 of danish's 7 required milestones with full mechanical proof (title-screen, game-start-chamber1, death, game-over, and restart, the last confirmed via two F7 presses returning first to title then into a genuinely fresh game with FALLS reset), bringing danish to exact parity with saeger's own 5/7 count from attempt 4. Three genuine host VICE crashes occurred and all self-healed per the documented pattern, costing re-boot time but no evidence. The session then hit a real wall: six independent attempts to cross chamber 1's rightward ground path all died at the identical precise sprite x-coordinate (~290-304), ruling out plain walking, attack taps, and climbing attempts at the room's central chain-ladder structure -- this is recorded as a genuine, reproducible gameplay obstacle with a filed pending todo, not a tooling failure, and the session's live budget ran out there rather than reaching either of danish's two remaining milestones (a second chamber transition, both opponents encountered). saeger was not touched this session; its own remaining two milestones (the same two, from its own different FALLS-hazard blocker) are unchanged from attempt 4.**

## Performance

- **Duration:** partial -- danish's Task 3 extended from 0/7 to 5/7 milestones (the largest single-session gain across all five attempts); saeger unchanged at 5/7 from attempt 4
- **Started:** 2026-08-02 (this session, resuming per the orchestrator's resume context)
- **Completed:** N/A -- plan is not complete
- **Tasks:** Task 1 (inherited, complete). Task 2: complete for both releases (inherited, unchanged). Task 3: danish 5/7 milestones (up from 0/7, first attempt in any session), saeger 5/7 (unchanged, not attempted this session). Task 4: not reached.
- **Files modified:** 2 modified (RE-FINDINGS.md, danish-loading-hits.json), 53+ new (52 screenshots + 1 pending todo), 1 new halt record

## Accomplishments

- **Confirmed the mcp__vice__* tool surface was live at session start** via the mandatory liveness bracket (18,492,325 cycles advanced on the first bracket), then re-confirmed liveness with a fresh bracket after every host crash and re-boot throughout the session.
- **First-ever attempt at danish's Task 3 pass across five attempts of this plan.** Re-derived the full boot procedure from scratch (disk attach, autostart, mandatory resume, cracktro gate walk holding SPACE, trigger checkpoint at `$08B1`, release-and-verify) four separate times this session (once for the initial attempt, three more after host crashes), each time confirmed via `vice_backtrace` showing the call chain passing through the trigger address.
- **Discovered and adopted a major, previously-unrecorded methodology fix: the emulator keeps running at full native speed through agent reasoning/tool-call latency unless `vice_execution_pause` is called explicitly after every observation.** Proven live: 258,504,308 cycles (~262 real PAL seconds) elapsed between a healthy chamber-1 screenshot and a `GAME OVER` screen with zero joystick input sent in between. Confirmed the fix works by observing two consecutive `vice_cycles_stopwatch read` calls return an identical value once genuinely paused. This directly threatens attempt 4's own "FALLS depletes per input event, not by elapsed time" conclusion for saeger, since that session never adopted this discipline either -- logged in full to `.planning/RE-FINDINGS.md`.
- **Confirmed the fix works immediately: danish's opening hazard room was crossed cleanly on the very next attempt after adopting the pause discipline**, with FALLS holding steady through pure movement and only depleting during genuine enemy contact/attack exchanges -- a materially different (and much less punishing) picture than attempt 4's saeger experience.
- **Reached 5 of danish's 7 required Task 3 milestones, all with full mechanical proof** (screen-matrix SHA-256 signature, sprite_enable, cycles_advanced>0, screenshot):
  - `title-screen` -- baseline signature `5bd33261...` established via a verified file-based hash (buf.length confirmed 1000 bytes).
  - `game-start-chamber1` -- signature `12e6ed2c...`, differing from title baseline as required; confirmed danish shares saeger's identical chamber-1 room layout and FALLS-counter HUD mechanic.
  - `death` -- a non-terminal FALLS-depletion respawn, Bruce's sprite position reset to spawn coordinates (`x=52,y=225`) confirming genuine respawn.
  - `game-over` -- full mechanical proof including a screen-matrix signature (`3e16a2f4...`) obtained via a careful file-based hash recomputation after an initial inline-transcription attempt produced a wrong byte length (1018 instead of 1000) and was correctly discarded before use, matching a known project pitfall (RE-FINDINGS.md documents this exact transcription risk from 01-05's own history).
  - `restart` -- F7 from a fully-evidenced GAME OVER screen returns to the title/menu (signature and sprite_enable exactly matching the title baseline, the correct expected outcome for this specific milestone), and a second F7 press starts a genuinely fresh game with FALLS reset from 00 back to 04 and chamber1's screen configuration matching the original game-start milestone exactly.
- **Spotted a new, distinct, elevated sprite (x=318, y=127) after the restart** -- positionally consistent with being the second opponent type, not yet engaged before the session's budget ran out.
- **Identified a precisely-located, reproducible gameplay obstacle for danish**: across six independent attempts this session, Bruce died at the exact same sprite x-coordinate (~290-304) on chamber 1's ground-level rightward path every time. Ruled out plain walking, attack taps, and `up` inputs at three different x-positions (76, 148, 196) along the path as fixes -- the room's visible central blue chain-ladder structure was never successfully climbed. Filed as a pending todo with concrete next steps (correct diagonal-jump array syntax, or a live disassembly capture at the death point) rather than continuing blind trial-and-error with an exhausted budget.
- **Logged three genuine mid-session host VICE crashes (epoch 4->5, 5->6, 6->7)**, each confirmed via the documented loud-transport-error-then-epoch-drift-report shape and each self-healing cleanly on the next `vice_ping` call with an empty, fresh checkpoint list -- no in-session evidence was lost to any of them.
- **Proved teardown by enumeration at session end**: `vice_checkpoint_list` reported `count: 0` as the final action before halting, with the machine left running.

## Task Commits

1. **RE finding: unpaused agent think-time burns real game-seconds** - `9396d26` (docs)
2. **danish Task 3: first play-through attempt, 4/7 milestones** - `66cf5b5` (feat)
3. **3 host crashes logged, hazard zone identified** - `7b944a8` (docs)
4. **danish Task 3: restart milestone confirmed, 5/7 reached** - `d5ce0c0` (feat)
5. **hazard-zone confirmation + pending todo filed** - `6fd66bb` (docs)

Task 4 has no commit: it was not reached, because Task 3's own coverage claim does not yet cover
either release's full required milestone set, per Task 3's own acceptance criteria.

## Files Created/Modified

- `recovery/danish/dumps/danish-loading-hits.json` - Added `title-screen`, `game-start-chamber1`, `death`, `game-over` and `restart` milestone entries with full mechanical proof; updated `run_status`, `run_status_note`, `scope_not_attempted`, `input_notes`, `identity_changes` (3 host crashes) and `teardown`
- `.planning/RE-FINDINGS.md` - Four new live findings: the unpaused-think-time methodology confound (with its own confirmation sub-entry), the epoch 4->5 host crash, the epoch 5->6 and 6->7 host crashes, and the precisely-located x~290-304 hazard-zone finding
- `.planning/todos/pending/2026-08-02-danish-chamber1-hazard-zone-x290-300-blocks-ground-path.md` - New todo with concrete next steps for a future session
- `recovery/danish/dumps/danish-loading-attempt5-*.png` - 52 new screenshots forming the full evidence trail for this attempt's play-through (title, chamber1 entry, opponent encounters, death, game-over, restart confirmation, six hazard-zone attempts)
- `.planning/phases/01-recovery-provenance/01-04-ATTEMPT-5-HALT.md` - This file

## Decisions Made

See `key-decisions` in the frontmatter above for the full list with rationale; the headline ones:
adopted the pause-after-every-observation discipline mid-session after discovering it live, and
flagged that this likely confounds attempt 4's own saeger conclusion; recorded restart's
baseline-matching signature as the correct expected outcome rather than misapplying the general
"matches baseline = not reached" rule; stopped spending danish's live budget on the x~290-304
hazard after six reproducible failures, filing a todo instead of continuing indefinitely; treated
all three host crashes as self-healing per the documented pattern.

## Deviations from Plan

### Auto-fixed

**1. [Rule 1 - bug, self-diagnosed] Adopted a stricter execution-pause discipline than the plan's action text explicitly prescribes, after discovering unpaused observation calls burn real game time**
- **Found during:** the first chamber-1 play-through attempt, when zero joystick input produced a GAME OVER between two observations
- **Issue:** The plan's action text describes a bracket pattern (reset stopwatch, resume, poll, read) around scripted *inputs*, but does not explicitly warn that non-input observation calls (screenshots, memory reads, registers_get) can also leave the machine running through the agent's own reasoning time between tool calls
- **Fix:** Adopted `vice_execution_pause` immediately after every observation not immediately followed by a deliberate input, confirmed by two consecutive stable cycle reads
- **Files modified:** none (a live technique change; documented in `.planning/RE-FINDINGS.md` rather than in the plan itself)
- **Verification:** danish's hazard room, which killed Bruce almost instantly before the fix, was crossed cleanly on the very next attempt after adopting it
- **Committed in:** `9396d26`, `66cf5b5`

### Not auto-fixed -- hard environmental and gameplay blockers, logged rather than routed around

**2. [Precondition unmet, not auto-fixable] A precisely-located, reproducible death at sprite x~290-304 on danish's chamber-1 ground path**
- **Found during:** repeated attempts to cross chamber 1's rightward path toward its doorway/exit
- **Issue:** Six independent attempts all died at the identical sprite x-coordinate, regardless of walking technique, attack timing, or attempted climb inputs at three different positions
- **Fix:** None applied within this session's remaining budget -- logged as a genuine gameplay obstacle in `.planning/RE-FINDINGS.md` and a pending todo with concrete next steps (correct diagonal-jump syntax, or a live disassembly capture at the death point)
- **Committed in:** `7b944a8`, `6fd66bb`

**3. [Precondition unmet, not auto-fixable] Three genuine mid-session host VICE crashes (epoch 4->5, 5->6, 6->7)**
- **Found during:** the restart-milestone test (first crash) and two subsequent chamber-1 re-entries
- **Issue:** Each crash presented as `UND_ERR_SOCKET`/`ECONNREFUSED` on a live call, followed by an explicit epoch-drift report on the next `vice_ping`, then a clean resume on the new instance
- **Fix:** None applied to the host. Per the documented pattern, each crash was treated as self-healing: the whole boot procedure was redone from `vice_disk_attach` on the fresh instance each time, with only the in-flight step (never already-captured evidence) voided
- **Committed in:** `66cf5b5`, `7b944a8`

---
**Total deviations:** 3 -- one self-diagnosed and adopted methodology fix (Rule 1), two hard blockers (not auto-fixable, one a gameplay-navigation limit and one host instability)
**Impact on plan:** Task 1 (inherited) and Task 2 (both releases, inherited) remain complete and well-evidenced. Task 3 now has materially expanded evidence for danish (5/7 milestones, up from 0/7, the biggest single-session gain of any attempt) and unchanged evidence for saeger (5/7, from attempt 4). Task 4 was not reached. **RECOVER-04 is NOT satisfied** -- both releases now stand at exact parity (5/7), each blocked by a different, well-documented gameplay obstacle rather than by tooling failure.

## Issues Encountered

One self-diagnosed methodology gap (unpaused observation calls burning real game time), corrected
mid-session with a concrete, confirmed fix. One genuine, precisely-located gameplay obstacle (the
x~290-304 hazard) that consumed the remainder of the session's live budget without full resolution,
now logged with concrete next steps for a future session. Three genuine host VICE crashes, all
self-healing per the documented pattern, costing re-boot time but no evidence. No other blocking
issues arose.

## User Setup Required

None -- no external service configuration required. The remaining blockers are a genuine in-game
navigation puzzle (the x~290-304 hazard) and host-side emulator instability (three crashes), neither
of which is a user-facing setup step. Both are logged with concrete next-step suggestions.

## Next Phase Readiness

- **Not ready.** Task 3 needs both releases' full milestone set (title screen; at least two real
  chamber transitions; both opponents; a death; a game over; a restart, each with full mechanical
  proof) before Task 4's coverage claim is ready for a human to confirm.
- **Task 2's work remains durable and does not need to be redone** by whichever session picks
  this plan back up: both releases' `loader_ranges`, `rejected_candidates`, `watch_set`, idle
  calibration and `NOTES.md` corrections are committed with live evidence, unchanged across five
  attempts now.
- **danish's 5 Task 3 milestones (title, game-start-chamber1, death, game-over, restart) are
  durable and do not need to be redone.** A future session should NOT re-spend lives confirming
  the x~290-304 hazard exists -- six repetitions this session is more than sufficient. Start
  instead from the pending todo's suggested next steps: retry a correctly-formatted diagonal jump
  (`direction: ["up","right"]` as an actual array, not a string) at the x~280-296 approach, or arm
  a live disassembly capture at the exact death moment.
- **saeger's 5 Task 3 milestones remain durable and unchanged from attempt 4**, including its own
  recorded `evidentiary_gap` on the death/restart milestones (screenshot/HUD-evidenced, not paired
  with a fresh screen-matrix signature). Not re-attempted this session; a future session revisiting
  saeger should apply this session's pause discipline from the very first frame, since it may
  meaningfully change saeger's own FALLS-hazard picture too (see the RE-FINDINGS.md confirmation
  entry) -- the six-restart difficulty attempt 4 recorded for saeger may partly have been the same
  unpaused-think-time confound this session found and fixed for danish.
- **A future session should apply the pause-after-every-observation discipline from the very
  first tool call**, not adopt it mid-session as this attempt did -- the discipline is now fully
  documented in `.planning/RE-FINDINGS.md` and should be treated as a hard rule for any further
  play-through work on this plan.
- **Blocker for the phase, unchanged in kind from attempts 2-4's notes:** plans 01-05 and 01-06
  consume this plan's `loader_ranges`/`watch_set` data shape, which exists in the registry for
  BOTH releases and is unaffected by this attempt. They can proceed further than before on that
  data, but the phase's own success criterion 2 (the evidenced completeness claim) still needs
  Task 3/4 to finish.
- **Suggested next step:** open a genuinely fresh session (first tool call `vice_ping`), apply
  the pause discipline from the very first observation, and pick either release's remaining two
  milestones using the pending todo's concrete next steps as a starting point -- both releases are
  now at exact parity (5/7), so either is an equally reasonable place to resume.

---
*Phase: 01-recovery-provenance*
*Completed: 2026-08-02 (partial -- blocked)*
