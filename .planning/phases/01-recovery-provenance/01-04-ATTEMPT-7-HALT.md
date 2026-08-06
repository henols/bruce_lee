<!--
NOT A SUMMARY. This is the halt record of plan 01-04 attempt 7 (2026-08-06), the first
cheat-assisted round, run on the developer's explicit 2026-08-06 approval to use the
community-published unlimited-lives cheat conditional on documentation.

Named ATTEMPT-7-HALT rather than 01-04-SUMMARY.md, following the precedent set by attempts 1-6
and the explicit STATE.md/resume-context lesson: a SUMMARY.md with status: blocked makes
phase-plan-index report has_summary: true and silently drop 01-04 from the incomplete-plans
list. This attempt verified the cheat's real address (the published one was wrong), applied it
successfully to both releases, and made a genuine disassembly-level attribution pass on the
death-check code path -- but did NOT get past the x~290-304 hazard that has now blocked seven
consecutive attempts, and did not reach Task 4. The same naming discipline applies: the real
SUMMARY.md is written once a future attempt actually finishes the plan.

Committed this attempt: 7268deb (verify $1560 wrong, find $0028), 6cd5233 (trace death-check code
path, rule out ladder/jump again), 2f4dd91 (cross-release confirm $0028 for saeger, attempt_7_note
in both hit logs).
-->

---
phase: 01-recovery-provenance
plan: 04
subsystem: infra
tags: [vice-mcp, cheat-assisted, memory-differential, disassembly-attribution, gameplay-hazard, wedge-hazard]

# Dependency graph
requires:
  - phase: 01-recovery-provenance (plan 01-03)
    provides: recovery/RELEASES.json's committed run1 dumps (bin/state/map/capture) for both releases, and the shared $08B1 trigger
  - phase: 01-recovery-provenance (plan 01-04 attempt 1)
    provides: "the detector's pure logic and artifact renderer, fully tested with no emulator present"
  - phase: 01-recovery-provenance (plan 01-04 attempts 2-3)
    provides: "both releases' complete Task 2 pass (loader_ranges, rejected_candidates, watch_set, idle calibration, NOTES.md corrections)"
  - phase: 01-recovery-provenance (plan 01-04 attempts 4-6)
    provides: "danish and saeger each at 5 of 7 required Task 3 milestones, both fully evidenced; the x~290-304 hazard cross-confirmed as shared game code"
  - source: ".planning/RE-FINDINGS.md 2026-08-03 entry"
    provides: "the unverified $1560 (POKE 5472,99) community cheat hypothesis, graded MEDIUM, never executed"
  - source: "developer approval, 2026-08-06"
    provides: "explicit permission to use the unlimited-lives cheat to get past the hazard, conditional on documentation"
provides:
  - "a live differential proof that $1560 is NOT the lives counter on either cracked release -- the community cheat's own caveat ('on a cracked release with a relocating loader it may not hold') confirmed true"
  - "the real address, $0028 (zero page), found by two independent before/after vice_memory_compare(mode:snapshot) differentials across confirmed deaths, corroborated by disassembly at its write site ($1826: DEC $28 / BMI $188E) and a read site ($1774: LDA $28, feeding the FALLS HUD digit)"
  - "$0028 cross-confirmed on saeger too, by the same live method, generalising the finding to both releases"
  - "the cheat applied and verified working end-to-end on both releases: vice_memory_write($0028, 99) persists through a real death (decrements normally, HUD updates), and needs re-applying after every fresh F7 game-start (confirmed live: $0028 resets to 04 on game-start)"
  - "a partial disassembly-level attribution of the death-check code path: $1826 (DEC $28) is gated by $1818's check of a stack-page byte ($0104), reached via $2D55's per-object-slot hit-confirmation dispatcher when Bruce's own slot (X=0) satisfies a chain of animation-state conditions -- the writer of $0104 itself is not yet found"
  - "a live-logged wedge hazard: lingering at the x~290-304 death coordinate under the cheat wedged host VICE twice this session; both recovered via vice_recycle with full incident records"
  - "a clean negative on 'does the cheat unblock the hazard': it does not. Unlimited lives removed the game-over consequence but did not change the underlying survival problem at x~290-304 -- this is a gameplay/attribution puzzle, not a lives-exhaustion problem"
affects: [01-05, 01-06, 02-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A community-published cheat address for 'the original program' is a hypothesis, not a fact, on a cracked release with a relocating loader -- confirmed false for $1560 on both danish and saeger this attempt, exactly the caveat the 2026-08-03 finding itself flagged as untested."
    - "vice_memory_compare(mode: snapshot) against a vice_snapshot_save taken immediately before a confirmed gameplay event is a fast, reliable way to locate an unknown counter/flag address: two independent differentials (not one) are needed to rule out a coincidentally-matching neighbour address."
    - "A fresh F7 game-start resets $0028 to its initial value (04) even when the prior game's value was cheat-mutated -- the cheat write must be re-applied after every game-start, not only once per session."
    - "Lingering at a screen position across multiple no-input observation cycles, under the cheat, correlated twice with host VICE wedging (0-cycle brackets) at the exact x~290-304 hazard coordinate -- not yet reproduced under stock (non-cheat) play, so not yet established as cheat-specific versus a pre-existing emulator sensitivity at that screen column."

key-files:
  created:
    - recovery/danish/dumps/danish-loading-attempt7-cheat-*.png (18 screenshots: title/gate verification, the $1560 negative differential, the $0028 positive differential across two deaths, the cheat-applied confirmation, multiple hazard-approach attempts, two death-moment captures with full sprite/PC/backtrace context, and a wedge-recovery idle-check)
    - recovery/saeger/dumps/saeger-loading-attempt7-cheat-*.png (4 screenshots: title screen before/after the gate release, the cheat-applied state, and the confirming post-death check)
    - .planning/phases/01-recovery-provenance/01-04-ATTEMPT-7-HALT.md
  modified:
    - .planning/RE-FINDINGS.md (four new entries: the $1560 negative / $0028 positive discovery, the wedge hazard, the death-check code-path trace, and the saeger cross-release confirmation)
    - recovery/danish/dumps/danish-loading-hits.json (added attempt_7_note)
    - recovery/saeger/dumps/saeger-loading-hits.json (added attempt_7_note)

key-decisions:
  - "Verified the cheat address live before trusting it, per the plan's own explicit instruction. This caught a real error: the published $1560 does not hold on either cracked release. Locating the real address ($0028) by live differential is worth more than the cheat itself, exactly as the plan predicted."
  - "Applied the cheat via vice_memory_write, never a BASIC POKE, per the plan's explicit instruction, and confirmed live that it needs re-applying after every fresh game-start rather than assuming persistence."
  - "Prioritised verifying the cheat address for BOTH releases (cheap, since both share original game code per plan 01-03) over spending equal live-play budget pushing saeger's own hazard approach a second time, since danish's own extensive pushes already established the cheat does not unblock the hazard -- re-deriving the identical negative on saeger would not have added information proportional to its cost."
  - "Stopped pursuing the hazard once the pattern (many varied techniques, all failing at the same coordinate, plus two wedges) made further blind trial-and-error a worse use of remaining budget than documenting what was found, per the plan's own autonomy contract: 'a verified address, a documented hazard-passing technique, or a clean negative on the cheat is a good outcome. Manufacturing a milestone is not.'"
  - "Made a real (if incomplete) disassembly attribution pass on the death-check code path rather than only trial-and-error input, per the developer's own suggested next step from attempt 6's notes. Logged the partial result (the gate condition found; its ultimate trigger not yet found) rather than either omitting it or overstating it as complete."
  - "Named this file ATTEMPT-7-HALT rather than 01-04-SUMMARY.md, matching attempts 1-6's own precedent and the explicit STATE.md lesson about phase-plan-index silently dropping an incomplete plan from incomplete when a SUMMARY.md-named file with status: blocked exists."

requirements-completed: []  # RECOVER-04 is NOT complete -- Task 3's full milestone bar (both releases) and Task 4 have not been reached.

coverage:
  - id: D1
    description: "Detector pure logic and artifact renderer (Task 1, inherited, unchanged this attempt)"
    requirement: "RECOVER-04"
    verification:
      - kind: unit
        ref: "Not re-run this attempt -- no changes to tools/*.mjs or the relocated .claude/skills/*/scripts/*.mjs pipeline. Durable per every prior halt record's own instruction not to redo it."
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
        ref: "danish: unchanged at 5 of 7 required milestones (title-screen, game-start-chamber1, death, game-over, restart), all with full mechanical proof from attempt 5. This attempt made roughly fifteen additional live pushes at the second-chamber-transition milestone, under the cheat, using plain walking, fire+right attacks, stationary punches, ladder-climb attempts at three x-positions, jump attempts at two x-positions, and continuous joystick_set holds -- all died at or near the recorded x~290-304 coordinate, none reached a new room. Two of these pushes also produced host VICE wedges when the death was left to idle at that coordinate; both recovered via vice_recycle."
        status: fail
      - kind: manual
        ref: "saeger: unchanged at 5 of 7 required milestones. This attempt's saeger work was limited to booting the release and cross-confirming the $0028 cheat address (one death, one cheat-write verification cycle); no push toward the second-chamber-transition milestone was attempted this session, per the decision to concentrate live budget on danish's more extensively pushed hazard."
        status: fail
    human_judgment: true
    rationale: "Task 3's acceptance criteria require the full milestone set for BOTH releases, each with full mechanical proof. Both stand at 5/7, unchanged in count from attempt 6. The cheat is now verified working and does not, by itself, unblock the remaining two milestones -- the underlying problem is gameplay/attribution, not lives-exhaustion."
  - id: D4
    description: "Task 4 checkpoint:human-verify -- confirm the coverage claim against the evidence"
    requirement: "RECOVER-04"
    verification: []
    human_judgment: true
    rationale: "Not reached -- gated on Task 3's completion for both releases, which did not occur."

# Metrics
duration: partial (cheat address verified and cross-confirmed on both releases; hazard survived the cheat; both releases remain at 5/7 milestones)
completed: 2026-08-06
status: blocked
---

# Phase 01 Plan 04: On-Demand-Load Detector -- Attempt 7: Cheat Address Verified ($0028, Not $1560), Hazard Survives Unlimited Lives, Both Releases Still 5/7, Task 4 Not Reached

**This was the first cheat-assisted attempt, run on the developer's explicit 2026-08-06 approval to use the unlimited-lives cheat to get past the hazard that has now blocked seven consecutive attempts, conditional on documentation. The attempt's most important result is a correction: the community-published cheat address (`$1560`, from `POKE 5472,99`) was never executed against a live capture before this attempt, and a live differential test proves it is WRONG for both cracked releases -- exactly the caveat the finding's own text flagged as untested ("on a cracked release with a relocating loader it may not hold"). The real address, `$0028` (zero page), was located by two independent before/after `vice_memory_compare(mode: snapshot)` differentials across confirmed deaths, corroborated by disassembly at its write site (`$1826: DEC $28 / BMI $188E`, the death-and-game-over check) and a read site (`$1774: LDA $28`, feeding the FALLS HUD digit). The cheat was applied via `vice_memory_write` (never a BASIC `POKE`), confirmed to persist through a real death, confirmed to need re-applying after every fresh game-start, and cross-confirmed working identically on saeger. Despite unlimited lives, the x~290-304 hazard that has blocked every prior attempt survived: roughly fifteen varied techniques (plain walking, attacking, stationary punching, ladder-climbing, jumping, held-joystick approaches) all ended in death at or near the same coordinate, and lingering there under the cheat wedged host VICE twice. A partial disassembly attribution pass traced the death-check code path (`$1826`/`$1818`/`$2D55`) to a gating condition on a stack-page byte (`$0104`) whose own writer was not found. Neither release's Task 3 milestone count moved past 5/7, and Task 4 was not reached.**

## Performance

- **Duration:** partial -- cheat address verified and cross-confirmed on both releases with full documentation; the hazard itself survived unlimited lives, so neither release's milestone count changed
- **Started:** 2026-08-06 (this session)
- **Completed:** N/A -- plan is not complete
- **Tasks:** Task 1 (inherited, complete). Task 2: complete for both releases (inherited, unchanged). Task 3: both releases unchanged at 5/7 milestones. Task 4: not reached.
- **Files modified:** 2 hit-log JSON files (attempt_7_note added), 1 RE-FINDINGS.md (four new entries), 22 new screenshots, 1 new halt record
- **Commits:** 3 (7268deb, 6cd5233, 2f4dd91)

## Accomplishments

- **Verified `vice_diagnose` reported `live` at session start**, and used the wedge-triage skill's two-consecutive-zero-cycle-bracket protocol throughout, recovering cleanly from three genuine wedges/crashes this session (one crash-and-respawn during initial boot, two wedges while lingering at the hazard coordinate under the cheat) via `vice_recycle` with full incident records, per protocol.
- **Live-tested the `$1560` community cheat hypothesis for the first time in this project's history**, per the developer's own explicit instruction to verify before relying on it. Read `$1560` at FALLS=04, triggered a real death (FALLS 04->03), re-read `$1560` -- unchanged at `$D0`. **Negative result, confirmed.**
- **Located the real FALLS/lives-counter address, `$0028`**, by two independent `vice_snapshot_save`/`vice_memory_compare(mode:snapshot)` differentials across the next two deaths (FALLS 03->02, then 02->01): `$0028` decremented by exactly 1 both times, while a superficially-matching second candidate (`$0048`) matched only once and was ruled out by the second differential.
- **Corroborated `$0028` with live disassembly**, via `vice_memory_search` for the `DEC $28` and `LDA $28` opcode patterns: `$1826: DEC $28 / BMI $188E` is the death-and-game-over-check, and `$1774: LDA $28 / CMP #$05 / ...` reads it back for the HUD digit.
- **Applied the cheat via `vice_memory_write($0028, 99)`**, confirmed it persists through a real death (decrements normally to 98, HUD updates to show 98), and confirmed live that it needs **re-applying after every fresh F7 game-start** (a fresh game resets `$0028` to `04`, observed directly).
- **Cross-confirmed the entire finding on saeger**, booting via saeger's own documented `$08F4`/`JSR $FFE4` gate-timing procedure (queuing `vice_keyboard_petscii` only after `vice_backtrace` confirmed the call chain was inside the gate loop, exactly as saeger's own `NOTES.md`/hit-log `technique_note` records). `$0028` already read `04` at saeger's title screen; after the cheat write and a real death, it read back `98` with the HUD confirming.
- **Traced the death-check code path from `$1826` backward through two call layers** (`$1818` and `$2D55`), establishing that the decrement is gated behind Bruce's own per-object animation-state slot in a shared hit-confirmation dispatcher, and behind a nonzero check on a stack-page byte (`$0104`) whose writer was not located (a store-watch on it recorded zero hits across four confirmed decrements, ruling out "a fresh store immediately precedes every decrement" and leaving two open possibilities, both logged).
- **Made roughly fifteen distinct live attempts to pass the x~290-304 hazard under the cheat**: plain walking (occasionally succeeded in reaching the coordinate without dying, but not in passing it), fire+right attacks, stationary center+fire punches from short range, `up` taps at the mid-room chain-ladder (three x-positions, no ascent, matching six prior attempts' own findings) and at the door itself (no jump observed), and continuous `joystick_set`-held approaches. **All ended in death at or very near the same coordinate.** This is a clean negative: unlimited lives removed the game-over consequence but did not change the underlying survival problem.
- **Discovered and logged a wedge hazard specific to lingering at the death coordinate under the cheat**: twice this session, letting Bruce's sprite sit at `x=300,y=225` across several no-input observation cycles preceded a genuine `vice_diagnose`-confirmed wedge (two independent zero-cycle brackets each time). Both recovered via `vice_recycle`; the causal link to the cheat specifically (versus ordinary play simply never lingering there) is not yet established and is logged as an open question.
- **Logged every finding at discovery**, per project rule, in four dated `RE-FINDINGS.md` entries with `Evidence:`/`Confidence:` fields: the `$1560` negative / `$0028` positive discovery (HIGH), the wedge hazard (MEDIUM), the death-check code-path trace (MEDIUM), and the saeger cross-release confirmation (HIGH).
- **Documented the cheat per the developer's explicit condition** in both `danish-loading-hits.json` and `saeger-loading-hits.json`: a new `attempt_7_note` field in each stating what was written, why, that the developer approved it 2026-08-06 on condition of documentation, and the provenance boundary (no RAM capture from this round feeds the canonical image or any byte-provenance claim; none of this round's screenshots are registered milestone evidence or a stock-play baseline).
- **Never touched the existing 5/7 stock milestones for either release.** Every artifact produced this attempt uses the `attempt7-cheat-` filename prefix, so the filename alone discloses the cheat-assisted provenance, exactly per the developer's documentation requirement.

## Task Commits

1. **verify $1560 wrong, find real FALLS counter at $0028** - `7268deb` (docs)
2. **trace death-check code path; rule out ladder-climb and jump again** - `6cd5233` (docs)
3. **cross-release confirm $0028 for saeger; attempt_7_note in both hit logs** - `2f4dd91` (docs)

Task 4 has no commit: it was not reached, because Task 3's own coverage claim does not yet cover
either release's full required milestone set, per Task 3's own acceptance criteria.

## Files Created/Modified

- `recovery/danish/dumps/danish-loading-attempt7-cheat-*.png` - 18 new screenshots: the $1560 negative-differential proof, the $0028 positive-differential proof across two deaths, the cheat-applied confirmation, multiple hazard-approach attempts with full sprite-position tracking, two death-moment captures with PC/backtrace/sprite context, and a wedge-recovery idle-check
- `recovery/saeger/dumps/saeger-loading-attempt7-cheat-*.png` - 4 new screenshots: title screen (before and after gate release), the cheat-applied state, and the confirming post-death check
- `recovery/danish/dumps/danish-loading-hits.json` - added `attempt_7_note`
- `recovery/saeger/dumps/saeger-loading-hits.json` - added `attempt_7_note`
- `.planning/RE-FINDINGS.md` - four new dated entries (see Accomplishments)
- `.planning/phases/01-recovery-provenance/01-04-ATTEMPT-7-HALT.md` - this file

## Decisions Made

See `key-decisions` in the frontmatter above for the full list with rationale; the headline ones:
verified the cheat address live before trusting it (caught a real error); applied the cheat via
`vice_memory_write` only, confirmed it needs re-applying per game-start; concentrated live budget
on danish's more extensively pushed hazard rather than re-deriving an identical negative on
saeger; stopped the hazard push once the pattern of failures plus two wedges made further blind
trial-and-error a worse use of remaining budget than documenting what was found; made a real (if
incomplete) disassembly attribution pass per the developer's own suggested next step.

## Deviations from Plan

### Not auto-fixed -- a hard, cross-release gameplay blocker, unaffected by the cheat, logged rather than routed around

**1. [Precondition unmet, not auto-fixable] the x~290-304 hazard survives unlimited lives on danish; saeger not re-attempted**
- **Found during:** roughly fifteen live attempts this session to pass the recorded cross-release hazard coordinate under the `$0028=99` cheat
- **Issue:** every technique tried (plain walking, attacking, stationary punching, ladder-climbing, jumping, held-joystick holds) ended in death at or very near sprite `x=300,y=225`; two of these attempts additionally wedged host VICE while Bruce's death-state sprite was left idling at that coordinate
- **Fix:** none applied within this session's remaining budget -- logged as a clean negative (cheat verified working, hazard unaffected) in `.planning/RE-FINDINGS.md` and in both hit logs' `attempt_7_note`, plus a partial disassembly attribution of the death-check code path as a concrete starting point for a future session
- **Committed in:** `6cd5233`, `2f4dd91`

---
**Total deviations:** 1 -- a hard gameplay blocker (not auto-fixable, now further characterised: survives unlimited lives, has a partially-traced code path, and correlates with a wedge hazard under sustained cheat-assisted lingering)
**Impact on plan:** Task 1 (inherited) and Task 2 (both releases, inherited) remain complete and well-evidenced. Task 3 is unchanged at 5/7 for both releases. Task 4 was not reached. **RECOVER-04 is NOT satisfied.** The cheat itself is now verified, documented, and durable for a future session to reuse without re-deriving it -- but it does not, by itself, resolve the phase's remaining blocker.

## Issues Encountered

One crash-and-respawn during initial boot (epoch 1->2, self-healed per the documented pattern,
voided and redone). Two genuine wedges (confirmed via `vice_diagnose`, both while lingering at the
death coordinate under the cheat), both recovered via `vice_recycle` with full incident records at
`.planning/incidents/`. No other tooling hazards this session. The hazard itself is understood as a
real gameplay/attribution problem, not a tooling failure -- it survived the removal of the
game-over consequence entirely.

## User Setup Required

None -- no external service configuration required. The remaining blocker is a genuine in-game
survival puzzle shared by both releases' game code, unaffected by the developer-approved cheat.

## Next Phase Readiness

- **Not ready.** Task 3 needs both releases' full milestone set before Task 4's coverage claim is
  ready for a human to confirm.
- **The cheat is now a durable, documented, reusable tool for a future session**: `$0028=99`,
  applied via `vice_memory_write`, re-applied after every F7 game-start, verified working
  identically on both releases. A future session does not need to re-derive or re-verify this.
- **The x~290-304 hazard is now known to survive unlimited lives.** A future session should not
  expect more lives alone to solve it. The concrete next investigative step, per this attempt's
  own partial disassembly trace: arm an **exec** checkpoint at `$1826` itself (not a store-watch on
  `$28`, which fires one step later) and read `$95`, `$BF`, `$CE`, `$D1` at offset 0 (Bruce's own
  object slot) on the pass immediately before it fires, to see which of the four gating conditions
  in `$2D55`'s dispatcher just became true, correlated against sprite/enemy state at that exact
  frame. A future session should also search indexed-addressing opcode forms (`STA $0100,X` = `9D
  00 01`, `STA $0100,Y`) for `$0104`'s writer, which this attempt's absolute-mode search did not
  cover.
- **The wedge-while-lingering-under-the-cheat correlation is unconfirmed as cheat-specific.** A
  future session with budget to spare could test whether the identical lingering-at-`x=300`
  sequence wedges under **stock** (non-cheat) play too, which would mean the hazard's own code path
  is what stresses the emulator rather than the cheat.
- **Blocker for the phase, unchanged in kind from attempts 2-6's notes:** plans 01-05 and 01-06
  consume this plan's `loader_ranges`/`watch_set` data shape, which exists in the registry for
  BOTH releases and is unaffected by this attempt. They can proceed further than before on that
  data, but the phase's own success criterion 2 (the evidenced completeness claim) still needs
  Task 3/4 to finish.
- **Suggested next step:** a future session should open with the `$1826` exec-checkpoint
  attribution pass above rather than another round of input-technique trial and error -- eight
  total attempts (six danish, one saeger, plus this one on both) without a stock-play fix, and
  now one attempt where unlimited lives *also* failed to get past it, is a strong signal that the
  remaining unknown is mechanical (a specific game-state condition) rather than a matter of
  finding the right joystick input.

---
*Phase: 01-recovery-provenance*
*Completed: 2026-08-06 (partial -- blocked)*
