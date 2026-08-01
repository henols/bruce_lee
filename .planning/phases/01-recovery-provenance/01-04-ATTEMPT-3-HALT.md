<!--
NOT A SUMMARY. This is the halt record of plan 01-04 attempt 3 (2026-08-01).

Named ATTEMPT-3-HALT rather than 01-04-SUMMARY.md, following the precedent set by attempts 1
and 2 and the explicit STATE.md/resume-context lesson: a SUMMARY.md with status: blocked makes
phase-plan-index report has_summary: true and silently drop 01-04 from the incomplete-plans
list. This attempt made real, substantial progress -- Task 2 is now complete for BOTH releases
for the first time, and Task 3 earned genuine (if partial) evidence for saeger -- but did NOT
complete Task 3's full milestone bar or reach Task 4, so the same naming discipline applies: the
real SUMMARY.md is written once a future attempt actually finishes the plan.

Committed this attempt: 5e68dc5 (Task 2, saeger), a52c550 (Task 3, partial, both releases).
-->

---
phase: 01-recovery-provenance
plan: 04
subsystem: infra
tags: [vice-mcp, on-demand-load-detection, host-instability, node-test, sha256, node-crypto]

# Dependency graph
requires:
  - phase: 01-recovery-provenance (plan 01-03)
    provides: recovery/RELEASES.json's committed run1 dumps (bin/state/map/capture) for both releases, and the shared $08B1 trigger
  - phase: 01-recovery-provenance (plan 01-04 attempt 1)
    provides: "tools/watch-loads.mjs and tools/dump-artifacts.mjs -- the detector's pure logic and artifact renderer, fully tested with no emulator present"
  - phase: 01-recovery-provenance (plan 01-04 attempt 2)
    provides: "danish's complete Task 2 pass (loader_ranges, idle calibration, IRQ reconnaissance, NOTES.md corrections, teardown)"
provides:
  - "saeger's complete Task 2 pass: loader_ranges (1 accepted, wider than danish's analogous range), rejected_candidates (3, including a new BASIC/KERNAL-vector-table candidate found by this attempt's wider live window), idle calibration passing at 0 stopping-tier hits over 51.5M cycles, counting-tier probe proven, teardown proven by enumeration, NOTES.md corrected with a fully-spelled-out reproduction procedure"
  - "saeger's partial Task 3 pass: 2 of 7 required milestones reached with full evidence (title screen, game start/chamber 1), one attributed gameplay-write hit with live PC/backtrace/disassembly"
  - "A real bug fix in tools/watch-loads.mjs's renderLoading, found live: the blocked-run warning hardcoded 'the count above is 0', which misrendered saeger's genuine non-zero partial count. Now distinguishes a zero-count block from a non-zero partial-result block."
  - "Two new logged host VICE hazards: a repo-relative vice_disk_attach path failure, and a fourth-incident silent stall distinct from the session's three crash/respawn incidents"
affects: [01-05, 01-06, 02-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "renderLoading's blocked-run warning now branches on count===0 vs count>0, rendering 'NOT AN EVIDENCED ZERO' only for a genuine zero and 'PARTIAL RESULT, NOT A COMPLETED COVERAGE CLAIM' when a blocked run still carries genuine attributed hits -- a blocked run is not always a zero run"
    - "Live-derive candidate loader ranges via a precise multi-byte vice_memory_read spanning suspected boundaries, not just instruction-decode disassembly at the two ends -- this is what surfaced saeger's wider $0340-$03A0 range and the separate $0302-$0327 BASIC/KERNAL vector-table candidate, neither of which instruction-boundary disassembly alone would have delineated precisely"
    - "Confirm vice_backtrace shows the call chain passing through the cracktro's own gate-polling JSR before queuing a KERNAL-buffer keypress -- queuing too early gets silently consumed by BASIC's own input-line editor (CHRIN via IMAIN), the kernal-buffer-delivery analogue of the matrix-delivery early-press hazard danish's NOTES.md already documented"

key-files:
  created:
    - .planning/todos/pending/2026-08-01-vice-crashes-three-times-during-sustained-execution-01-04-task2-saeger.md
    - .planning/todos/pending/2026-08-01-vice-silent-stall-during-01-04-task3-saeger-playthrough.md
    - recovery/saeger/dumps/saeger-loading-01-title.png
    - recovery/saeger/dumps/saeger-loading-02-postf7.png
    - .planning/phases/01-recovery-provenance/01-04-ATTEMPT-3-HALT.md
  modified:
    - recovery/RELEASES.json
    - recovery/saeger/NOTES.md
    - recovery/saeger/dumps/saeger-loading-hits.json
    - recovery/danish/dumps/danish-loading-hits.json
    - recovery/LOADING.md
    - tools/watch-loads.mjs
    - tools/watch-loads.test.mjs
    - .planning/RE-FINDINGS.md

key-decisions:
  - "Redid the saeger boot sequence from scratch FOUR times this session, once per host VICE incident (three loud crash/respawn epoch changes -- 8->9, 9->10, 10->11 -- plus recovery from a stuck boot on the third), per the project's identity-change rule: every measurement taken before a detected crash is void, never trusted as a resumable state."
  - "On the fourth (successful) boot, diagnosed and fixed a genuine technique bug rather than retrying blindly: a PETSCII SPACE queued immediately after autostart was landing in BASIC's own input-line editor (confirmed via vice_backtrace showing $A483/IMAIN) rather than the cracktro's $08F4 gate, because the boot had not yet reached the gate. Fix: confirm via vice_backtrace that the call chain passes through the gate's own JSR $FFE4 (called_from $08F6) before queuing."
  - "Verified saeger's candidate loader-range window live rather than inheriting danish's boundaries by analogy, per the resume context's explicit instruction. This surfaced a genuinely wider accepted range ($0340-$03A0 vs danish's $0340-$035E) and one additional rejected candidate (the BASIC/KERNAL RAM vector table at $0302-$0327, also $01-filled but structurally never dereferenced since HIRAM=0 here too)."
  - "Halted Task 3's play-through after 2 milestones on a genuine, twice-confirmed silent stall (0 cycles across three brackets, no epoch change, PC frozen through an explicit pause) rather than continuing to poll or attempting a host restart, per the plan's explicit instruction for exactly this situation."
  - "Fixed tools/watch-loads.mjs's renderLoading rather than leaving a misleading rendered claim: the pre-existing blocked-run warning hardcoded 'the count above is 0,' which would have rendered saeger's genuine 1-hit partial result as if it were an unevidenced zero. Added a distinct partial-result branch and a covering test (38 tests total, up from 37)."
  - "Named this file ATTEMPT-3-HALT rather than 01-04-SUMMARY.md, matching attempts 1 and 2's own precedent: an incomplete plan's SUMMARY.md with status: blocked causes phase-plan-index to silently drop 01-04 from incomplete."

requirements-completed: []  # RECOVER-04 is NOT complete -- Task 3's full milestone bar (both releases) and Task 4 have not been reached.

coverage:
  - id: D1
    description: "Detector pure logic and artifact renderer (Task 1, inherited), plus the renderLoading blocked/partial-result fix (this attempt)"
    requirement: "RECOVER-04"
    verification:
      - kind: unit
        ref: "tools/watch-loads.test.mjs (24 tests) && tools/dump-artifacts.test.mjs (14 tests) -- 38 total, up from 37"
        status: pass
      - kind: other
        ref: "node tools/recovery-schema.mjs check-parameterisation && node tools/recovery-schema.mjs validate"
        status: pass
    human_judgment: false
  - id: D2
    description: "Earn the armed set live, calibrate idle to zero, prove teardown, correct NOTES.md defects, for BOTH releases (Task 2)"
    requirement: "RECOVER-04"
    verification:
      - kind: manual
        ref: "danish: complete (inherited from attempt 2, commit 72eb6e7) -- unchanged this attempt"
        status: pass
      - kind: manual
        ref: "saeger: loader_ranges (1 accepted range with live disassembly + precise byte-read evidence, 3 rejected candidates with live disassembly and reasons), idle calibration (51,563,549 cycles advanced, loader-reentry sentinel at 0 hits), counting-tier probe (432 hits, non-stopping, 16,182,609 cycles), teardown proven by enumeration (0 remaining), NOTES.md corrected with a fully-spelled-out reproduction procedure"
        status: pass
    human_judgment: false
    rationale: "Task 2's own acceptance criteria are fully met for both releases as of this attempt -- the first time this has been true for this plan."
  - id: D3
    description: "Bounded play-through, hit attribution, supplementary dumps, recovery/LOADING.md, for BOTH releases (Task 3)"
    requirement: "RECOVER-04"
    verification:
      - kind: manual
        ref: "saeger: 2 of 7 required milestones reached with full evidence (title-screen, game-start/chamber-1); 1 hit attributed (gameplay-write, $DD00, live PC/backtrace/disassembly); remaining milestones (a second real chamber transition, both opponents, a death, a game over, a restart) explicitly recorded as not-reached due to a genuine silent host stall, not attempted further"
        status: fail
      - kind: manual
        ref: "danish: not attempted in any session to date (no live budget remained after saeger's Task 2 pass and partial Task 3 pass consumed this session's live-emulator time across four host VICE incidents)"
        status: fail
    human_judgment: true
    rationale: "Task 3's acceptance criteria explicitly require the full milestone set for BOTH releases before the coverage claim is ready for the Task 4 human checkpoint. Neither release meets that bar yet. The partial evidence gathered is genuine and committed, not fabricated, but it does not satisfy Task 3 as written."
  - id: D4
    description: "Task 4 checkpoint:human-verify -- confirm the coverage claim against the evidence"
    requirement: "RECOVER-04"
    verification: []
    human_judgment: true
    rationale: "Not reached -- gated on Task 3's completion, which did not occur."

# Metrics
duration: partial (halted mid-Task-3, after Task 2 completed for both releases)
completed: 2026-08-01
status: blocked
---

# Phase 01 Plan 04: On-Demand-Load Detector -- Attempt 3: Task 2 Complete For Both Releases, Task 3 Partial (saeger 2/7 milestones), Task 4 Not Reached

**Task 2 is now complete and genuinely evidenced for BOTH releases for the first time across three attempts -- attempt 2 left saeger blocked on a host stall; this attempt earned saeger's full Task 2 pass live, across four separate emulator instances after three mid-session host VICE crashes. Task 3 then began well (saeger reached 2 of 7 required milestones with full evidence, including one attributed gameplay-write hit) before a fourth, distinct host VICE incident -- a genuine SILENT stall, not a crash -- halted the play-through. Danish's own Task 3 pass never started this session; there was no live budget left after saeger's four-instance Task 2 derivation and partial Task 3 attempt. Task 4 was not reached.**

## Performance

- **Duration:** partial -- Task 2 completed in full for both releases; Task 3 partial for saeger, not started for danish
- **Started:** 2026-08-01 (this session, resuming per the orchestrator's resume context)
- **Completed:** N/A -- plan is not complete
- **Tasks:** Task 1 (inherited, complete). Task 2: complete for both releases (danish inherited, saeger earned this session). Task 3: partial (saeger 2/7 milestones, danish not attempted). Task 4: not reached.
- **Files modified:** 9 across two commits (5 new, 4 modified in the Task 2 commit; 9 changed, 3 new in the Task 3 commit -- see each commit's own file list)

## Accomplishments

- **Confirmed the mcp__vice__* tool surface was live and worked entirely through it**, per the resume context's instruction -- no fallback route was attempted at any point, across four separate emulator instances and two distinct incident types.
- **Earned saeger's Task 2 pass in full**, live, across four emulator instances (epoch 8/9/10/11) after three mid-session crash/respawn incidents. Diagnosed and fixed a genuine technique bug on the fourth attempt (a keypress queued before the boot reached the cracktro's gate was being consumed by BASIC's own input-line editor instead) rather than retrying blindly.
- **Verified saeger's candidate loader-range window live rather than by analogy to danish**, per the resume context's explicit instruction. A precise 192-byte `vice_memory_read` (not just instruction-boundary disassembly) established the accepted range as genuinely wider than danish's ($0340-$03A0, 97 bytes, vs danish's $0340-$035E, 31 bytes) and surfaced a new rejected candidate danish's session never encountered: the standard BASIC/KERNAL RAM vector table at $0302-$0327, also reading as the same telltale $01 fill but structurally never dereferenced by this KERNAL-banked-out, machine-language-only game.
- **Passed saeger's idle calibration**: the loader-reentry sentinel registered 0 hits over 51,563,549 genuinely-advanced cycles; the counting-tier probe confirmed non-stopping accumulation (432 hits over 16,182,609 cycles, execution never paused).
- **Proved teardown by enumeration** every time checkpoints were armed this session, on both releases, across every instance -- never trusted from a delete call's own return value.
- **Corrected saeger/NOTES.md** with the same accepted/rejected/idle-calibration section danish's file already carries, plus a fully-spelled-out ordered "Reproducing this dump" call list (the prior version referenced danish's list by description rather than naming its own calls, which would not have met the plan's own "at least six ordered mcp__vice__ calls" acceptance bar on inspection).
- **Began Task 3's play-through for saeger and reached 2 genuine milestones.** Held F7 to start a 1-player game from the title screen, landing in chamber 1 -- confirmed both mechanically (screen signature differs from the title baseline; sprite_enable changed 31->19) and visually (a screenshot showing the HUD, Bruce Lee, an opponent, platforms and an obstacle, not the title screen).
- **Attributed a real hit rather than reporting an unattributed count.** One `vice_joystick_tap` move produced a `$DD00` write above the idle floor; re-armed as a stopping checkpoint, captured live PC ($07DB), backtrace, and disassembly (`LDA #$01 / STA $DD00 / LDA #$38 / STA $D018` -- a graphics-mode-setup store during room-draw, reasserting the same VIC bank already in use), and classified it `gameplay-write` on that evidence.
- **Found and fixed a real bug in the detector's own renderer**, discovered live while writing this attempt's `recovery/LOADING.md`: `renderLoading`'s blocked-run warning hardcoded "the count above is `0`," which would have misrendered saeger's genuine 1-hit partial result as an unevidenced zero. Fixed to branch on whether the count is actually zero, added a covering test (38 tests total, up from 37), and re-verified the whole suite still passes.
- **Recognized and honestly recorded a fourth host VICE incident, distinct in kind from the first three.** After the three loud crash/respawn incidents in Task 2 (epoch changes, self-healing), Task 3 hit a genuine SILENT stall: three independent cycle brackets all measured exactly 0 cycles while `vice_ping` continuously reported `"running"` with no epoch change at all (the same instance, not a respawn) -- distinguishing it required noticing that `vice_registers_get` returned an identical PC across all three, including immediately after an explicit `vice_execution_pause`. Per the plan's own instruction for exactly this situation, no further play input was attempted once confirmed twice.

## Task Commits

1. **Task 2 (saeger): earn the loader-range set live, closing the last blocked half** - `5e68dc5` (feat)
2. **Task 3 (partial, both releases): saeger's 2-milestone play-through, one attributed hit, the renderLoading fix, and an honest partial `recovery/LOADING.md`** - `a52c550` (feat)

Task 4 has no commit: it was not reached, because Task 3's own coverage claim does not yet cover
either release's full required milestone set, per Task 3's own acceptance criteria.

## Files Created/Modified

- `recovery/RELEASES.json` - saeger gained `loader_ranges` (1 entry, `idle_hits: 0`), `rejected_candidates` (3 entries), `watch_set` (171-entry resolution for plan 02-02's hand-off)
- `recovery/saeger/NOTES.md` - Added the accepted/rejected-ranges/idle-calibration section; rewrote "Reproducing this dump" as a fully-spelled-out 11-step ordered `mcp__vice__` call list
- `recovery/saeger/dumps/saeger-loading-hits.json` - Replaced the BLOCKED placeholder from attempt 2 with the genuinely earned Task 2 result, plus Task 3's partial milestone/hit data and an honest `run_status: "blocked"` note describing exactly where Task 3 stopped and why
- `recovery/danish/dumps/danish-loading-hits.json` - Added a `run_status`/`scope_not_attempted` note clarifying Task 3 was never attempted for this release, distinct from a completed zero-milestone result
- `recovery/LOADING.md` - Rendered from both hit logs: danish's section correctly states Task 3 was not attempted; saeger's states the 2 reached milestones, the 1 attributed hit, and the honest partial-result warning
- `tools/watch-loads.mjs` - Fixed `renderReleaseSection`'s blocked-run warning to branch on whether the count is genuinely zero
- `tools/watch-loads.test.mjs` - One new test covering the fixed branch (38 tests total)
- `.planning/RE-FINDINGS.md` - Four new live findings: a repo-relative `vice_disk_attach` path failure, the three-crash epoch-drift pattern (with its second occurrence merged into the same entry), and the fourth-incident silent stall
- `.planning/todos/pending/2026-08-01-vice-crashes-three-times-during-sustained-execution-01-04-task2-saeger.md` - New todo
- `.planning/todos/pending/2026-08-01-vice-silent-stall-during-01-04-task3-saeger-playthrough.md` - New todo
- `recovery/saeger/dumps/saeger-loading-01-title.png`, `saeger-loading-02-postf7.png` - New milestone screenshots

## Decisions Made

See `key-decisions` in the frontmatter above for the full list with rationale; the headline ones:
redid saeger's boot four times rather than trusting any post-crash state as a continuation;
diagnosed the early-keypress hazard rather than retrying blindly; verified saeger's candidate
window live rather than by analogy; fixed the `renderLoading` bug rather than shipping a
misleading partial-result rendering; halted on the silent stall rather than continuing to poll.

## Deviations from Plan

### Auto-fixed

**1. [Rule 1 - bug] `renderLoading`'s blocked-run warning hardcoded a zero count that is not always true**
- **Found during:** rendering `recovery/LOADING.md` for saeger's genuinely-partial (non-zero) result
- **Issue:** The warning text asserted "the count above is `0`" unconditionally whenever `run_status === "blocked"`, which was accurate for attempt 2's saeger record (a genuine zero) but wrong for this attempt's saeger record (1 genuine attributed hit)
- **Fix:** Branch on `count === 0` vs `count > 0`, rendering a distinct "PARTIAL RESULT, NOT A COMPLETED COVERAGE CLAIM" warning for the non-zero case
- **Files modified:** `tools/watch-loads.mjs`, `tools/watch-loads.test.mjs`
- **Verification:** `node --test tools/watch-loads.test.mjs tools/dump-artifacts.test.mjs` -- 38/38 pass
- **Committed in:** `a52c550`

### Not auto-fixed -- hard environmental blockers, logged rather than routed around

**2. [Precondition unmet, not auto-fixable] Three mid-session host VICE crash/respawn incidents during Task 2**
- **Found during:** saeger's Task 2 boot/derivation, three separate times
- **Issue:** The host VICE instance crashed and was auto-replaced three times (epoch 8->9, 9->10, 10->11), each self-surfaced by the proxy as a loud epoch-drift error
- **Fix:** None applied to the host; per the project's rule, every measurement before each detected crash was voided and the whole boot sequence was redone from scratch on the new instance. Logged as `.planning/todos/pending/2026-08-01-vice-crashes-three-times-during-sustained-execution-01-04-task2-saeger.md`
- **Committed in:** `5e68dc5`

**3. [Precondition unmet, not auto-fixable] A fourth, distinct incident: a genuine silent stall during Task 3's play-through**
- **Found during:** Task 3's saeger play-through, after 2 milestones and 1 attributed hit
- **Issue:** Three independent `cycles_stopwatch` brackets all measured exactly 0 cycles while `vice_ping` continuously reported `"running"` with no epoch change (the same instance, not a crash/respawn) -- `vice_registers_get` returned an identical PC across all three, including one taken immediately after an explicit `vice_execution_pause`
- **Fix:** None applied. Per the plan's own instruction for this exact situation, no further play input was attempted once confirmed twice; the stall was recorded honestly in the hit log and `recovery/LOADING.md` rather than treated as a completed result. Logged as `.planning/todos/pending/2026-08-01-vice-silent-stall-during-01-04-task3-saeger-playthrough.md`
- **Committed in:** `a52c550`

---
**Total deviations:** 3 -- one auto-fixable bug (Rule 1), two hard blockers (not auto-fixable)
**Impact on plan:** Task 1 (inherited) and Task 2 (both releases, complete for the first time) are done and well-evidenced. Task 3 has genuine partial evidence for saeger (2/7 milestones, 1 attributed hit) and no evidence yet for danish. Task 4 was not reached. **RECOVER-04 is NOT satisfied** -- the armed-set-and-idle-calibration half of the requirement is now solid for both releases, but the play-through-and-attribution half needs both releases' full milestone set before the coverage claim is ready for a human to confirm.

## Issues Encountered

Four host VICE incidents in one session, two distinct shapes: three loud crash/respawn events
(epoch changes, self-healing on the next call) during Task 2, and one genuine silent stall (no
epoch change, `vice_ping` staying green while nothing advances) during Task 3. Both shapes are
now logged with live evidence in `.planning/RE-FINDINGS.md` and as pending todos. No other
blocking issues arose; every acceptance criterion this session did complete (saeger's full Task 2
pass, the two Task 3 milestones, the `renderLoading` fix) passed on the first or second attempt.

## User Setup Required

None -- no external service configuration required. This is host-side emulator instability, not a
user-facing setup step; see the two new todos for the full incident records. Both incident types
self-heal or remain diagnosable from inside the container (checkpoint enumeration stayed reliable
throughout), so no manual host intervention is strictly required before a fresh session retries --
but the recurrence rate (four incidents in roughly 40-50 minutes of live work) is real and a
fresh session should budget for it rather than assume this attempt was unlucky.

## Next Phase Readiness

- **Not ready.** Task 3 needs both releases' full milestone set (title screen; at least two real
  chamber transitions; both opponents; a death; a game over; a restart) before Task 4's coverage
  claim is ready for a human to confirm.
- **Task 2's work is durable and does not need to be redone** by whichever session picks this
  plan back up: both releases' `loader_ranges`, `rejected_candidates`, `watch_set`, idle
  calibration and NOTES.md corrections are committed with live evidence.
- **saeger's 2 Task 3 milestones and its 1 attributed hit are also durable** and do not need to be
  redone -- a future session should resume saeger's play-through from where it stalled (chamber 1,
  per `saeger-loading-02-postf7.png`) rather than restarting from the title screen, though there is
  no committed snapshot to reload from (per D-07, snapshots are host-side only and not committed;
  a future session would need to re-walk the boot + F7 sequence, which is now a known-working,
  fully-documented procedure).
- **danish's Task 3 pass has not started in any session to date** and needs the full milestone set
  from scratch.
- **Blocker for the phase, unchanged in kind from attempt 2's note:** plans 01-05 and 01-06 consume
  this plan's `loader_ranges`/`watch_set` data shape, which now exists in the registry for BOTH
  releases (an improvement over attempt 2's state, where only danish's existed). They can proceed
  further than before, but the phase's own success criterion 2 (the evidenced completeness claim)
  still needs Task 3/4 to finish.
- **Suggested next step:** open a genuinely fresh session (first tool call `vice_ping`, so a
  fresh boot-fresh instance is granted) before resuming this plan, and budget for BOTH incident
  shapes (loud crash/respawn and silent stall) recurring more than once -- this session hit four
  incidents in under an hour of live work, which is a real rate rather than a fluke to plan around
  once and forget.

---
*Phase: 01-recovery-provenance*
*Completed: 2026-08-01 (partial -- blocked)*
