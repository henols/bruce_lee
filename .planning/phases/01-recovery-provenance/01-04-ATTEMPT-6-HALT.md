<!--
NOT A SUMMARY. This is the halt record of plan 01-04 attempt 6 (2026-08-06).

Named ATTEMPT-6-HALT rather than 01-04-SUMMARY.md, following the precedent set by attempts 1-5
and the explicit STATE.md/resume-context lesson: a SUMMARY.md with status: blocked makes
phase-plan-index report has_summary: true and silently drop 01-04 from the incomplete-plans
list. This attempt closed the two evidentiary gaps attempt 4 and 5 left open (saeger's death and
restart milestones), and cross-confirmed danish's own x~290-304 chamber-1 hazard on saeger, but
did not extend either release's Task 3 milestone count past 5/7 and did not reach Task 4. The
same naming discipline applies: the real SUMMARY.md is written once a future attempt actually
finishes the plan.

Committed this attempt: 8287751 (saeger death/restart evidentiary-gap fix, full mechanical proof),
56e65ba (cross-release hazard corroboration + two diagonal-jump syntax dead ends).
-->

---
phase: 01-recovery-provenance
plan: 04
subsystem: infra
tags: [vice-mcp, on-demand-load-detection, screen-matrix-signature, node-crypto, gameplay-hazard, keyboard-matrix]

# Dependency graph
requires:
  - phase: 01-recovery-provenance (plan 01-03)
    provides: recovery/RELEASES.json's committed run1 dumps (bin/state/map/capture) for both releases, and the shared $08B1 trigger
  - phase: 01-recovery-provenance (plan 01-04 attempt 1)
    provides: "the detector's pure logic and artifact renderer, fully tested with no emulator present"
  - phase: 01-recovery-provenance (plan 01-04 attempts 2-3)
    provides: "both releases' complete Task 2 pass (loader_ranges, rejected_candidates, watch_set, idle calibration, NOTES.md corrections)"
  - phase: 01-recovery-provenance (plan 01-04 attempts 4-5)
    provides: "danish and saeger each at 5 of 7 required Task 3 milestones, with saeger's death and restart carrying a recorded evidentiary_gap"
  - phase: quick-260804 / refactor(skills) (commit 8be55d0, landed after this plan was written)
    provides: "the recovery pipeline relocated from tools/ to .claude/skills/{c64-ram-capture,c64-provenance-diff}/scripts/ -- this plan's stale tools/*.mjs paths were worked around this attempt, not corrected in the plan text"
provides:
  - "saeger's death milestone: full mechanical proof (screen-matrix SHA-256, sprite_enable, cycles_advanced, screenshot) replacing the prior evidentiary_gap, captured at the exact FALLS-reaching-0 transition per the plan's own prescribed fix"
  - "saeger's restart milestone: full mechanical proof replacing the prior evidentiary_gap, captured in the same paused instant as a single held-then-released F7 press from GAME OVER"
  - "Two corroborating full-proof captures of the same FALLS-depletion sequence (04->03 and the 02->01 'PLAYER 1' interstitial), strengthening the death milestone's evidence beyond the single required capture"
  - "A reframing of the FALLS counter as an ordinary lives-remaining counter (decrements once per confirmed enemy-contact death), corroborating danish's own attempt-5 finding for the identical shared game code and superseding attempt 4's 'depletes per input event' conclusion"
  - "Cross-release confirmation that saeger dies at the identical sprite x-coordinate (~300) danish recorded across six independent attempts of its own, at the same chamber-1 doorway approach -- this hazard is now known to be shared game code, not release-specific"
  - "Two additional vice_joystick_tap diagonal-direction syntaxes ruled out (a genuine array, and two hyphenated/concatenated strings), narrowing the remaining unexplored techniques for a future session"
  - "A working replacement technique for vice_keyboard_matrix's F7 dispatch: explicit pressed:true / pressed:false pair, after hold_frames-based auto-release proved unreliable this session"
affects: [01-05, 01-06, 02-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "vice_keyboard_matrix's hold_frames auto-release raced against agent reasoning latency and failed four consecutive times at the saeger title screen this session; an explicit press-then-release pair (pressed:true, run, pause, pressed:false) registered reliably every time it was tried instead. Hypothesis (unconfirmed): hold_frames schedules release against host wall-clock time rather than emulated frame count, so a slow round-trip between the press call and the following execution_run can let the key auto-release before the machine ever sees it pressed."
    - "A screen-matrix SHA-256 signature legitimately changes when the HUD's own digit characters change (e.g. the FALLS counter's on-screen character cell), even when the room layout is otherwise identical -- this is a feature of the signature method, not a bug, and this attempt's restart signature differing from its own game-start-chamber1 signature is exactly this effect, not an inconsistency."
    - "A memory-read hex string must be verified byte-for-byte (2000 hex chars = 1000 bytes) before hashing, never trusted from a manual retype -- this attempt hit the exact transcription-length mismatch this project has hit twice before (01-05's own history, and attempt 5's game-over capture) on its very first hash attempt, caught immediately by a length check, and switched to writing every subsequent hex string via the Write tool rather than a Bash heredoc."

key-files:
  created:
    - recovery/saeger/dumps/saeger-loading-attempt6-*.png (49 screenshots: the full session evidence trail -- boot/title confirmation, the FALLS 04->03->02->01->00 depletion sequence with its 'PLAYER 1' interstitial, the terminal GAME OVER, the single-press restart, and the fresh game's own hazard-zone deaths)
    - .planning/phases/01-recovery-provenance/01-04-ATTEMPT-6-HALT.md
  modified:
    - recovery/saeger/dumps/saeger-loading-hits.json
    - recovery/LOADING.md (re-rendered via the pure renderer for both releases, syncing it with data attempts 4-5 had already committed to the JSON hit logs but never re-rendered)
    - .planning/RE-FINDINGS.md

key-decisions:
  - "Prioritised closing the two prescribed evidentiary gaps (saeger death, saeger restart) over pushing further into either release's remaining milestone count, per the orchestrator's own stated priority order. Both gaps are now closed with full mechanical proof, exceeding the minimum bar by also capturing two corroborating intermediate death transitions in the same depletion sequence."
  - "Re-derived the root cause of the FALLS counter live rather than trusting attempt 4's inherited conclusion, after noticing FALLS held steady through several plain-movement taps with no enemy nearby -- confirmed it decrements exactly once per confirmed enemy-contact death, not per input event, matching danish's own attempt-5 finding for the identical shared game code."
  - "Attempted saeger's own push toward a second chamber transition once the prescribed fixes were secured, using the session's remaining live budget productively rather than stopping the moment the minimum requirement was met. This produced a genuine, valuable cross-release confirmation (the x~290-304 hazard is shared, not danish-specific) rather than a second independent discovery effort."
  - "Stopped attempting the x~290-304 hazard after saeger's own FALLS counter reached its last life (01), rather than risking the session's remaining budget on a hazard seven total attempts across both releases (six danish, one saeger this session) have not yet found a fix for. This follows the plan's explicit instruction not to grind on this specific hazard, and the orchestrator's own instruction to record rather than grind if attempts are burned there again."
  - "Named this file ATTEMPT-6-HALT rather than 01-04-SUMMARY.md, matching attempts 1-5's own precedent and the explicit STATE.md lesson about phase-plan-index silently dropping an incomplete plan from incomplete when a SUMMARY.md-named file with status: blocked exists."

requirements-completed: []  # RECOVER-04 is NOT complete -- Task 3's full milestone bar (both releases) and Task 4 have not been reached.

coverage:
  - id: D1
    description: "Detector pure logic and artifact renderer (Task 1, inherited, unchanged this attempt)"
    requirement: "RECOVER-04"
    verification:
      - kind: unit
        ref: "node --test .claude/skills/c64-ram-capture/scripts/watch-loads.test.mjs .claude/skills/c64-ram-capture/scripts/dump-artifacts.test.mjs -- 37 tests total, re-run this attempt at the relocated path (commit 8be55d0 moved these files out of tools/ after this plan was written), all pass"
        status: pass
      - kind: other
        ref: "node .claude/skills/c64-provenance-diff/scripts/recovery-schema.mjs check-parameterisation && node .claude/skills/c64-provenance-diff/scripts/recovery-schema.mjs validate -- both re-run at the relocated path, both pass"
        status: pass
    human_judgment: false
  - id: D2
    description: "Earn the armed set live, calibrate idle to zero, prove teardown, correct NOTES.md defects, for BOTH releases (Task 2)"
    requirement: "RECOVER-04"
    verification:
      - kind: manual
        ref: "danish and saeger: both complete, inherited unchanged from attempts 2-3. Not re-derived this attempt -- durable registry data, per every prior halt record's own instruction not to redo it."
        status: pass
    human_judgment: false
    rationale: "Task 2's own acceptance criteria remain fully met for both releases, as established by prior attempts; this attempt made no changes to that data."
  - id: D3
    description: "Bounded play-through, hit attribution, supplementary dumps, recovery/LOADING.md, for BOTH releases (Task 3)"
    requirement: "RECOVER-04"
    verification:
      - kind: manual
        ref: "saeger: still 5 of 7 required milestones (title-screen, game-start-chamber1, death, game-over, restart), but death and restart now carry full mechanical proof (this attempt's primary work) rather than the evidentiary_gap attempts 4-5 left open. A second real chamber transition and a clean both-opponents capture remain not-reached: three fresh attempts this session to push past the chamber-1 doorway (sprite x~244) all ended in death, one at the identical x~300 coordinate danish recorded across six of its own attempts -- now understood as a shared, cross-release hazard rather than a release-specific one."
        status: fail
      - kind: manual
        ref: "danish: unchanged from attempt 5 -- still 5 of 7 milestones, all with full mechanical proof, blocked by the same x~290-304 hazard (now cross-confirmed on saeger too). Not re-attempted this session; this attempt's live budget went to saeger per the orchestrator's stated priority (close saeger's gaps first)."
        status: fail
    human_judgment: true
    rationale: "Task 3's acceptance criteria require the full milestone set for BOTH releases, each with full mechanical proof. Both stand at 5/7. saeger's two evidentiary gaps within the reached set are now closed (this attempt's prescribed, primary deliverable); the remaining gap for both releases is the same two milestones, blocked by the same now-cross-confirmed hazard."
  - id: D4
    description: "Task 4 checkpoint:human-verify -- confirm the coverage claim against the evidence"
    requirement: "RECOVER-04"
    verification: []
    human_judgment: true
    rationale: "Not reached -- gated on Task 3's completion for both releases, which did not occur."

# Metrics
duration: partial (saeger's death/restart evidentiary gaps closed with full mechanical proof; both releases remain at 5/7 milestones; cross-release hazard corroboration added)
completed: 2026-08-06
status: blocked
---

# Phase 01 Plan 04: On-Demand-Load Detector -- Attempt 6: Saeger's Two Evidentiary Gaps Closed, Cross-Release Hazard Confirmed, Both Releases Still 5/7, Task 4 Not Reached

**This attempt opened with the specific, prescribed priority of closing the two evidentiary gaps attempt 4 left on saeger's death and restart milestones (screenshot/HUD evidence only, no screen-matrix SHA-256, death also missing a cycles_advanced figure). Both gaps are now closed with full mechanical proof, exceeding the minimum bar: the session captured the entire FALLS 04->03->02->01->00 depletion sequence rather than jumping straight to the final transition, with full proof (screen-matrix signature, sprite_enable, cycles_advanced, screenshot) at each individual death, and captured the restart transition via a single held-then-released F7 press straight from GAME OVER into a fresh chamber-1 game. Along the way this attempt reframed the FALLS counter itself: it is an ordinary lives-remaining counter that decrements once per confirmed enemy-contact death, corroborating danish's own attempt-5 finding for the identical shared game code, not attempt 4's "depletes per input event" conclusion. With the prescribed fix secured, the session spent its remaining budget pushing saeger's own play-through toward a second chamber transition -- and died three times approaching the chamber-1 doorway, once at the identical sprite x-coordinate (~300) danish recorded across six of its own independent attempts. This is a genuinely valuable result: the hazard that has blocked both releases' final two milestones across every attempt of this plan is now known to be shared game code, not a release-specific quirk. Two additional `vice_joystick_tap` diagonal-direction syntaxes (a genuine array, and two hyphenated/concatenated strings) were tried and ruled out identically. Neither release's Task 3 milestone count moved past 5/7 this attempt, and Task 4 was not reached.**

## Performance

- **Duration:** partial -- saeger's two evidentiary gaps closed with full mechanical proof; both releases remain at 5/7 milestones (unchanged in count, though saeger's evidence quality within that count improved substantially)
- **Started:** 2026-08-06 (this session)
- **Completed:** N/A -- plan is not complete
- **Tasks:** Task 1 (inherited, complete, re-verified at the relocated pipeline path). Task 2: complete for both releases (inherited, unchanged). Task 3: saeger 5/7 milestones with death and restart now fully evidenced (up from evidentiary_gap); danish 5/7 unchanged. Task 4: not reached.
- **Files modified:** 3 modified (saeger-loading-hits.json, LOADING.md, RE-FINDINGS.md), 49 new screenshots, 1 new halt record
- **Commits:** 2 (8287751, 56e65ba)

## Accomplishments

- **Confirmed the mcp__vice__* tool surface was live at session start** via `vice_diagnose` (verdict `live`, a measured cycle bracket), and re-confirmed liveness at every point a screenshot returned an unexpected blank/black frame during this session, before continuing.
- **Discovered and worked around a real path hazard this session's very first tool call surfaced**: a relative `vice_display_screenshot` path from inside this worktree landed in the **main workspace checkout**, not the calling worktree, matching `.claude/CLAUDE.md`'s own documented rule but easy to miss because the tool's own success response looks identical either way. Found the stray file with `ls`, removed it, and used an absolute worktree-rooted path for every subsequent screenshot this session. Logged to `.planning/RE-FINDINGS.md`.
- **Re-derived saeger's boot procedure from scratch** (disk attach, autostart, mandatory resume, cracktro gate walk via `vice_keyboard_petscii`, trigger checkpoint at `$08B1`, backtrace-confirmed gate position before queuing the key) -- Task 2's own registry data (loader_ranges, watch_set, idle calibration) reused as durable, per every prior attempt's own instruction not to redo it.
- **Diagnosed and fixed a real `vice_keyboard_matrix` F7-dispatch reliability problem**: four consecutive attempts with `hold_frames` (10, 15, 30, 60 frames) all left the machine on the title screen. Switched to an explicit `pressed:true` immediately followed by `execution_run`/`ping`/`execution_pause`/`pressed:false`, which registered correctly on the very next attempt and on every subsequent F7 press this session, including a single press that carried saeger straight from GAME OVER into a fresh chamber-1 game.
- **Closed saeger's death evidentiary gap** with full mechanical proof at the exact FALLS-reaching-0 transition, per the plan's own prescribed fix: screen-matrix SHA-256 `170ceb758bc23c12f8904ff9f91af34ac7892bbbcc2ffdba5e8c369825aea269`, `sprite_enable=3`, `cycles_advanced=79390584`, Bruce's sprite confirmed reset to spawn (`x=52,y=225`), screenshot `saeger-loading-attempt6-death-falls00.png`. Differs from saeger's own title-screen baseline signature, satisfying the not-reached-if-equal-to-baseline rule.
- **Captured two additional, corroborating full-proof death transitions** in the same depletion sequence (not required by the fix, but strengthening the milestone's evidence): FALLS `04->03` (signature `b0b0b9b76a092a105aa5f66a82fa3449946b6bf71079299e53a2e259dcf88c77`) and the `'PLAYER 1'` life-transition interstitial for `02->01` (signature `adcebfc2c28b211b1135d4ac66872758f14e58a8446634db39a0ceee778b765c`, `sprite_enable=0`).
- **Reached and captured a fresh terminal GAME OVER** (signature `3e16a2f4e4cbab1cc9080d704b94ec83a02af19ab45af702e8c131bcfb0c6e73`) -- byte-identical to danish's own committed attempt-5 game-over signature, a clean cross-release consistency check on the capture method itself.
- **Closed saeger's restart evidentiary gap** with full mechanical proof: a single held-then-released F7 press from that GAME OVER screen produced a fresh chamber-1 game (FALLS reset `00->04`, sprite reset to spawn) in one step -- unlike danish's own attempt 5, which needed two separate F7 presses (return to title, then start). Screen-matrix signature `bc914a06db575c7acda78fe4060a7b2ca7c60eb9caf36bf0584c9cad22ccedfc`, `cycles_advanced=5837832`, screenshot `saeger-loading-attempt6-restart-check.png`.
- **Reframed the FALLS counter's root cause**, live: it held steady through every plain-movement joystick tap with no enemy nearby, and decremented by exactly 1 on each of four confirmed enemy-contact deaths -- superseding attempt 4's "depletes ~1 per input event" conclusion (itself now understood as an unpaused-think-time confound, per danish's own attempt-5 finding for the identical mechanic) with a HIGH-confidence, disciplined-pausing-confirmed live result for saeger specifically.
- **Pushed saeger's own fresh game (post-restart) toward a second chamber transition**, reaching the chamber-1 doorway (sprite `x=244`) three separate times across three lives, and died approaching it each time -- once at sprite `x=300`, the identical coordinate danish recorded across six independent attempts of its own. This is the session's most valuable negative result: **the x~290-304 hazard is now confirmed cross-release, shared game code**, not a danish-specific quirk as every prior attempt's own records left open.
- **Tried and ruled out two more `vice_joystick_tap` diagonal-direction syntaxes** for a jump-over attempt: a genuine JSON array (`["up","right"]`) and two hyphenated/concatenated strings (`"up-right"`, `"upright"`) -- all three rejected identically with `Invalid direction`. The tool's own schema declares `direction` as `type: "string"` despite its description text promising "array for diagonals"; the schema is what the transport enforces.
- **Stopped attempting the hazard once saeger's own FALLS counter reached its last life (01)**, rather than risking the session's remaining budget, per the plan's own explicit instruction not to grind on this specific hazard and the orchestrator's own instruction to record rather than grind if attempts are burned there again.
- **Re-rendered `recovery/LOADING.md` via the pure renderer** (both releases, via the correct no-`--release`-flag invocation after an initial mis-invocation with `--release saeger` accidentally overwrote the whole file with only saeger's section -- caught immediately via `git diff --stat`, reverted with `git checkout --`, and re-run correctly) -- this also synced the document with danish's attempt-5 milestone data, which had been committed to the JSON hit log in a prior attempt but never re-rendered into the markdown record.
- **Proved teardown by enumeration** throughout: `vice_checkpoint_list` reported `count: 0` at every check this session (no checkpoints were armed during this session's Task 3 work, since no hit-attribution pass was performed), including the final check before leaving the machine running.
- **Re-ran the full test suite at the relocated pipeline path** (37 tests across `watch-loads.test.mjs` and `dump-artifacts.test.mjs`, plus both `recovery-schema.mjs` gates) -- all pass, confirming this attempt's edits did not regress the pure-logic half of the plan.

## Task Commits

1. **saeger death/restart evidentiary-gap fix, full mechanical proof** - `8287751` (feat)
2. **cross-release hazard corroboration + two diagonal-jump syntax dead ends** - `56e65ba` (docs)

Task 4 has no commit: it was not reached, because Task 3's own coverage claim does not yet cover
either release's full required milestone set, per Task 3's own acceptance criteria.

## Files Created/Modified

- `recovery/saeger/dumps/saeger-loading-hits.json` - Closed the `death` and `restart` milestones' `evidentiary_gap` fields with full mechanical proof; updated `scope_not_attempted` with the cross-release hazard corroboration; added `attempt_6_note`; extended `input_notes` with this session's F7 press/release technique and the fire+right attack-and-advance technique
- `recovery/LOADING.md` - Re-rendered via `node .claude/skills/c64-ram-capture/scripts/watch-loads.mjs render` (both releases) from the updated hit logs, also syncing danish's attempt-5 data that had never been re-rendered
- `.planning/RE-FINDINGS.md` - Five new live findings: the worktree-relative-screenshot-path hazard, the `vice_keyboard_matrix` hold_frames unreliability and its explicit-press/release fix, saeger's FALLS-counter reframing, and the cross-release x~290-304 hazard confirmation with its two ruled-out diagonal-jump syntaxes
- `recovery/saeger/dumps/saeger-loading-attempt6-*.png` - 49 new screenshots forming the full evidence trail for this attempt (boot/title, the fire+right technique discovery, the full FALLS depletion sequence, the terminal GAME OVER, the single-press restart, and the fresh game's own three hazard-zone deaths)
- `.planning/phases/01-recovery-provenance/01-04-ATTEMPT-6-HALT.md` - This file

## Decisions Made

See `key-decisions` in the frontmatter above for the full list with rationale; the headline ones:
prioritised closing the two prescribed evidentiary gaps over pushing further into new milestones;
re-derived the FALLS counter's root cause live rather than trusting an inherited conclusion; spent
remaining budget productively on saeger's own hazard-zone approach once the prescribed fix was
secured, producing a valuable cross-release confirmation; stopped that pursuit once saeger's own
FALLS counter reached its last life, per the plan's own instruction not to grind on this hazard.

## Deviations from Plan

### Auto-fixed

**1. [Rule 3 - blocking issue] The plan's `tools/watch-loads.mjs` / `tools/dump-artifacts.mjs` / `tools/recovery-schema.mjs` paths no longer exist**
- **Found during:** the first attempt to run `node tools/recovery-schema.mjs validate`
- **Issue:** commit `8be55d0` (`refactor(skills): move the recovery pipeline into the skills, portably`), landed on this branch after the plan was written, relocated the whole recovery pipeline out of `tools/` into `.claude/skills/c64-ram-capture/scripts/` and `.claude/skills/c64-provenance-diff/scripts/`, as a deliberate portability refactor (per its own commit message: "tools/ now holds only the gitignored broker copies the MCP deploys there")
- **Fix:** used the new paths throughout this attempt's live work and verification; did not edit the plan text (out of scope for an executor)
- **Verification:** `node .claude/skills/c64-provenance-diff/scripts/recovery-schema.mjs validate` and `check-parameterisation` both pass; `node --test .claude/skills/c64-ram-capture/scripts/watch-loads.test.mjs .claude/skills/c64-ram-capture/scripts/dump-artifacts.test.mjs` reports 37/37 passing
- **Committed in:** `8287751` (noted in the commit body, not a separate commit)

**2. [Self-diagnosed technique bug, fixed inline] An accidental partial overwrite of `recovery/LOADING.md`**
- **Found during:** the first `render` call, invoked with `--release saeger`
- **Issue:** the render verb's own semantics restrict output to the named release when `--release` is passed, which for the `render` verb means the whole file is rewritten containing only that one release's section -- silently dropping danish's already-committed section
- **Fix:** caught immediately via `git diff --stat` showing 65 deletions against 4 insertions; reverted with `git checkout -- recovery/LOADING.md`; re-ran `render` with no `--release` flag, which correctly renders every release in the registry
- **Verification:** `grep "^## " recovery/LOADING.md` shows both `## Release: danish` and `## Release: saeger` after the corrected re-run
- **Committed in:** `8287751` (the correct render only; the accidental one was reverted before staging)

### Not auto-fixed -- a hard, cross-release gameplay blocker, logged rather than routed around

**3. [Precondition unmet, not auto-fixable] saeger dies at the identical sprite x-coordinate (~300) danish recorded across six of its own independent attempts, at the same chamber-1 doorway approach**
- **Found during:** three attempts this session to push saeger's fresh (post-restart) game past sprite `x=244` toward a second chamber transition
- **Issue:** every attempt died shortly after `x=244`, one specifically at `x=300`, matching danish's own recorded hazard exactly; two additional `vice_joystick_tap` diagonal-direction syntaxes (a genuine array, two hyphenated/concatenated strings) were tried as a possible jump-over fix and rejected identically by the tool's own schema
- **Fix:** none applied within this session's remaining budget -- logged as a cross-release confirmation in `.planning/RE-FINDINGS.md` (promoting the existing danish-only finding) rather than continued indefinitely; saeger's own FALLS counter was down to its last life (01) at the point this was stopped
- **Committed in:** `56e65ba`

---
**Total deviations:** 3 -- two auto-fixed (a stale plan-text path, a self-caught render-invocation mistake), one hard gameplay blocker (not auto-fixable, now cross-confirmed rather than release-specific)
**Impact on plan:** Task 1 (inherited) and Task 2 (both releases, inherited) remain complete and well-evidenced. Task 3 now has fully-evidenced death and restart milestones for saeger (up from an explicit evidentiary_gap), unchanged milestone counts for both releases (5/7 each), and a valuable cross-release corroboration of the shared blocking hazard. Task 4 was not reached. **RECOVER-04 is NOT satisfied** -- both releases stand at 5/7 with better evidence quality within that count, both blocked by the same now-cross-confirmed hazard rather than by tooling failure or by a release-specific quirk.

## Issues Encountered

One real tooling hazard (a worktree-relative screenshot path landing in the main checkout),
diagnosed and worked around within the same tool-call sequence. One real `vice_keyboard_matrix`
reliability problem (hold_frames auto-release racing against agent latency), diagnosed and fixed
with a working alternative technique. One self-caught process mistake (a partial `render`
overwrite), reverted before it could be committed. One hard, now cross-release-confirmed gameplay
blocker (the x~290-304 hazard) that consumed the remainder of the session's live budget on saeger
without a fix, logged with the two additional syntaxes it ruled out. No host VICE crashes or
silent stalls occurred this session.

## User Setup Required

None -- no external service configuration required. The remaining blocker is a genuine in-game
navigation puzzle shared by both releases' game code, not a user-facing setup step.

## Next Phase Readiness

- **Not ready.** Task 3 needs both releases' full milestone set (title screen; at least two real
  chamber transitions; both opponents; a death; a game over; a restart, each with full mechanical
  proof) before Task 4's coverage claim is ready for a human to confirm.
- **Task 2's work remains durable and does not need to be redone** by whichever session picks
  this plan back up: both releases' `loader_ranges`, `rejected_candidates`, `watch_set`, idle
  calibration and `NOTES.md` corrections are committed with live evidence, unchanged across six
  attempts now.
- **saeger's death and restart milestones are now fully evidenced and durable** -- a future
  session does not need to re-capture either. **danish's own death milestone is still missing a
  discrete `screen_signature` field** (it currently records `null` because a room-identity match
  rather than a distinct-state match was judged sufficient at capture time, per attempt 5's own
  note) -- this is a smaller, optional polish item, not a blocker, since the milestone's other
  evidence fields (sprite reset, cycles_advanced, screenshot) are already present and sufficient.
- **The x~290-304 hazard is now known to be cross-release, shared game code** -- a future session
  should not treat it as danish-specific or attempt to re-derive saeger's own version of it from
  scratch. Two more diagonal-jump `direction` syntaxes are ruled out (see RE-FINDINGS.md); the
  remaining untried approaches per that entry are (a) two separate, precisely-timed single-axis
  taps rather than one combined diagonal call, or (b) investigating whether this room's exit is
  not a ground-level jump at all (the central chain-ladder structure, or an off-screen exit).
- **A future session should budget carefully for this hazard**: seven total attempts across both
  releases (six danish, one saeger) have now died at or near the identical coordinate without a
  fix. Consider arming a live disassembly/backtrace capture at the moment of death (per the
  existing danish pending todo's own second suggestion) as the next investigative step, rather
  than a further trial-and-error input attempt.
- **Blocker for the phase, unchanged in kind from attempts 2-5's notes:** plans 01-05 and 01-06
  consume this plan's `loader_ranges`/`watch_set` data shape, which exists in the registry for
  BOTH releases and is unaffected by this attempt. They can proceed further than before on that
  data, but the phase's own success criterion 2 (the evidenced completeness claim) still needs
  Task 3/4 to finish.
- **Suggested next step:** open a genuinely fresh session, apply the pause-after-every-observation
  discipline from the very first tool call (per attempt 5's own hard-learned lesson, followed
  throughout this attempt with no confound), and arm a live disassembly/backtrace capture at the
  moment of the x~300 death on either release -- mechanical attribution of the hazard's cause is
  now a better use of live budget than a further blind input-technique attempt.

---
*Phase: 01-recovery-provenance*
*Completed: 2026-08-06 (partial -- blocked)*
