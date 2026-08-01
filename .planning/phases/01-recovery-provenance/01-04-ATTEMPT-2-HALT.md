<!--
NOT A SUMMARY. This is the halt record of plan 01-04 attempt 2 (2026-08-01).

Named ATTEMPT-2-HALT rather than 01-04-SUMMARY.md deliberately, following the precedent set by
attempt 1's own halt record and the lesson recorded in .planning/STATE.md: "01-04-SUMMARY.md
exists with status: blocked and empty requirements-completed, which makes phase-plan-index report
has_summary: true and drop 01-04 from incomplete... must be removed or renamed before re-dispatch."
This attempt made real, substantial live progress -- unlike attempt 1, which made none -- but did
NOT complete Tasks 3-4, so the same naming discipline applies: the real SUMMARY.md is written once
a future attempt actually finishes the plan.

Task 1 was already complete and committed before this attempt started (ffb9a64, c5b92f8, merge
64da66e -- see attempt 1's own halt record, renamed 01-04-ATTEMPT-1-HALT.md, for its detail).
Task 2 is substantially complete for danish and explicitly blocked for saeger. Tasks 3 and 4 were
not attempted, because Task 3's own precondition requires both releases' watch_set to be earned,
and reliable milestone/hit attribution needs a working vice_registers_get, which this session's
host-side stall left unreliable for the rest of the session.

Committed this attempt: 72eb6e7 (feat).
-->

---
phase: 01-recovery-provenance
plan: 04
subsystem: infra
tags: [vice-mcp, on-demand-load-detection, irq-reconnaissance, node-test, sha256, node-crypto]

# Dependency graph
requires:
  - phase: 01-recovery-provenance (plan 01-03)
    provides: recovery/RELEASES.json's committed run1 dumps (bin/state/map/capture) for both releases, and the shared $08B1 trigger
  - phase: 01-recovery-provenance (plan 01-04 attempt 1)
    provides: "tools/watch-loads.mjs and tools/dump-artifacts.mjs -- the detector's pure logic and artifact renderer, fully tested with no emulator present"
provides:
  - "danish's earned loader_ranges (1 accepted, 3 rejected with live disassembly evidence), a passing idle calibration on a small earned watch_set, a proven-working counting-tier probe, and real IRQ-path + main-loop reconnaissance evidence"
  - "A renderLoading enhancement (run_status: \"blocked\") that flags an unevidenced zero instead of letting it render as a clean null result -- directly closes a false-confidence gap this plan exists to prevent"
  - "A logged, unresolved blocker: a genuine host-side VICE stall (vice_registers_get frozen, then zero cycles advancing at all) discovered mid-session, which halted saeger's Task 2 pass and all of Task 3"
affects: [01-05, 01-06, 02-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Small, earned, reproducible live checkpoint set (1-4 checkpoints) plus pause -> vice_registers_get -> vice_backtrace -> vice_disassemble -> resume reconnaissance, replacing the plan's literal \"arm every WATCH_SET-resolved sentinel\" design after a mid-run developer correction -- avoids the 174-checkpoint bombardment failure the reverted prior attempt hit"
    - "IRQ-path reconnaissance: resolve the live hardware IRQ vector via $01 (bank state) then $FFFE/$FFFF or $0314/$0315 depending on HIRAM, disassemble the handler, and follow any indirect dispatch it performs -- the main loop and the IRQ handler are two separate places game logic (and a load call) can live, and covering only one is a coverage hole the LOADING.md record must not paper over"
    - "A blocked-but-not-found run is recorded and rendered distinctly from a genuine evidenced zero (run_status: \"blocked\" + run_status_note), so a reader of LOADING.md cannot mistake an unattempted measurement for a null result earned by proof of execution"

key-files:
  created:
    - recovery/LOADING.md
    - recovery/danish/dumps/danish-loading-hits.json
    - recovery/saeger/dumps/saeger-loading-hits.json
    - .planning/todos/pending/2026-08-01-vice-registers-frozen-after-reset-during-01-04-task2.md
    - .planning/phases/01-recovery-provenance/01-04-ATTEMPT-2-HALT.md
  modified:
    - recovery/RELEASES.json
    - recovery/danish/NOTES.md
    - recovery/saeger/NOTES.md
    - tools/watch-loads.mjs
    - tools/watch-loads.test.mjs

key-decisions:
  - "Mid-run technique correction, from the developer via the coordinator (three steering messages), replaced Task 2 Step 3's literal instruction (arm all WATCH_SET-resolved sentinels -- 173 for danish, 169 for saeger) with a small, earned, reproducible live set (the loader-reentry stopping sentinel + the $DD00 counting sentinel, 2 checkpoints) plus pause-and-follow reconnaissance for evidence-gathering. All 173 over-armed danish checkpoints were torn down (proven by enumeration) before the small set was re-armed. This is a deliberate, developer-directed departure from the plan's literal Task 2 Step 3 text; the plan's INTENT (earn the set, calibrate idle, prove teardown, record absence as evidence) is preserved."
  - "recovery/RELEASES.json's watch_set field for danish still carries the full 173-entry WATCH_SET resolution as DATA (for plan 02-02's D-11 hand-off), but only 2 of those entries were live-armed and idle-calibrated THIS run -- documented explicitly in the hit log's watch_set_note so a reader does not conflate \"resolved\" with \"armed and proven\"."
  - "A fourth developer steering message (read the IRQ-interrupted PC off the stack frame rather than trusting an arbitrary pause) was acknowledged and was about to be exercised as a repeated-sampling profiler when the host-side stall first appeared (vice_registers_get froze while attempting exactly this). The technique itself is sound and recorded for a future session; it could not be carried through to a distribution of samples this session."
  - "saeger's Task 2 is recorded as BLOCKED, not as a completed zero-entry resolution -- loader_ranges/rejected_candidates/watch_set are empty arrays (matching the schema's field-set requirement) but the hit log's run_status: \"blocked\" field and LOADING.md's rendered warning make unmistakable that this is an absence of measurement, not a null result."
  - "Named this file ATTEMPT-2-HALT rather than 01-04-SUMMARY.md, per the precedent and the explicit STATE.md lesson from attempt 1's own halt: an incomplete plan's SUMMARY.md with status: blocked causes phase-plan-index to silently drop 01-04 from the incomplete-plans list."

requirements-completed: []  # RECOVER-04 is NOT complete -- Task 2 is only half-done (danish only) and Tasks 3-4 did not run.

coverage:
  - id: D1
    description: "Detector pure logic and artifact renderer (Task 1, inherited from attempt 1) plus a new renderLoading enhancement for blocked-run flagging (this attempt)"
    requirement: "RECOVER-04"
    verification:
      - kind: unit
        ref: "tools/watch-loads.test.mjs (23 tests) && tools/dump-artifacts.test.mjs (14 tests) -- 37 total, up from 35"
        status: pass
      - kind: other
        ref: "node tools/recovery-schema.mjs check-parameterisation && node tools/recovery-schema.mjs validate"
        status: pass
    human_judgment: false
  - id: D2
    description: "Earn the armed set live, calibrate idle to zero, prove teardown, correct the two NOTES.md defects (Task 2)"
    requirement: "RECOVER-04"
    verification:
      - kind: manual
        ref: "danish: loader_ranges (1 accepted range with live post-trigger disassembly evidence, 3 rejected candidates with live disassembly and reasons), counting-tier probe (432 hits, non-stopping, 27,189,792 cycles advanced), small watch_set idle-calibrated (24,396,568 cycles advanced, both sentinels at 0 hits), teardown proven by enumeration (0 remaining), both NOTES.md defects corrected at their source"
        status: pass
      - kind: manual
        ref: "saeger: not attempted to completion -- boot never left its pre-loader state; recorded as blocked with a genuine teardown enumeration for the one checkpoint that was armed"
        status: fail
    human_judgment: true
    rationale: "danish's Task 2 work meets every stated acceptance criterion with live evidence. saeger's does not: recovery/RELEASES.json's loader_ranges/rejected_candidates/watch_set for saeger are empty because the live derivation could not be attempted, not because none were found. Task 2's acceptance criteria explicitly require non-empty loader_ranges/rejected_candidates for BOTH releases, so Task 2 as a whole is incomplete."
  - id: D3
    description: "Bounded play-through, hit attribution, supplementary dumps, recovery/LOADING.md (Task 3)"
    requirement: "RECOVER-04"
    verification: []
    human_judgment: true
    rationale: "Not executed -- Task 3's own precondition requires both releases' loader_ranges/watch_set earned with idle_hits of zero, which saeger does not have. Even setting that aside, reliable milestone-boundary and hit-attribution work needs a working vice_registers_get, which this session's host-side stall left frozen/unreliable for the remainder of the session."

# Metrics
duration: partial (halted mid-Task-2, after danish completed and saeger's boot stalled)
completed: 2026-08-01
status: blocked
---

# Phase 01 Plan 04: On-Demand-Load Detector -- Attempt 2: Danish's Task 2 Complete, Saeger Blocked, Tasks 3-4 Not Reached

**Task 1 (inherited) and danish's full Task 2 (loader-range derivation, counting-tier probe, small earned watch_set, idle calibration, IRQ-path + main-loop reconnaissance, NOTES.md corrections, teardown) are complete and committed with real live evidence. saeger's Task 2 pass and all of Task 3 could not be attempted because of a genuine host-side VICE stall discovered mid-session -- not a scope or design problem, a live-instability blocker matching this project's own documented "host VICE has crashed repeatedly" risk, manifesting this time as a frozen `vice_registers_get` response and then zero genuine cycle advancement, rather than a connection failure.**

## Performance

- **Duration:** partial -- Task 2 completed for danish, then halted partway through saeger's pass
- **Started:** 2026-08-01 (this session, resuming at Task 2 per the orchestrator's resume context)
- **Completed:** N/A -- plan is not complete
- **Tasks:** Task 1 (inherited, complete). Task 2: danish complete, saeger blocked. Tasks 3-4: not started.
- **Files modified:** 9 (5 new, 4 modified)

## Accomplishments

- **Confirmed the mcp__vice__* tool surface is live** as the resume context instructed (`vice_ping` → `status:"ok", version:"3.10", machine:"C64SC"`) before any file-changing work, and worked entirely through it -- no fallback route was attempted at any point, including after the stall was discovered.
- **Course-corrected mid-run on developer instruction.** This task initially followed the plan's literal Step 3 text and armed all 173 `WATCH_SET`-resolved sentinels for danish as live checkpoints -- exactly reproducing the 174-checkpoint bombardment failure the reverted prior attempt hit. The developer sent three steering messages via the coordinator correcting the technique (small earned set + pause-and-follow reconnaissance, not a broad net); all 173 over-armed checkpoints were torn down (proven empty by enumeration) and replaced with a 2-checkpoint earned set before any further live work.
- **Earned danish's loader_ranges live.** Booted danish, walked the `$0900` cracktro gate (holding SPACE via the keyboard matrix, released at the `$08B1` trigger checkpoint -- confirmed via backtrace showing `$08B1` in the call chain, since `vice_registers_get` had not yet frozen at this point). Evaluated all four candidate ranges named in `danish/NOTES.md` with live post-trigger disassembly: accepted `$0340-$035E` (decodes as the single repeated byte `$01`, consistent with stale loader scratch), rejected `$0900-$0905` (self-modified by the game into an ordinary zero-page wait loop), rejected `$08F5-$08FA` (confirmed as the exact `.planning/STATE.md` defect -- the title dispatcher's own permanent joystick poll), and rejected `$0D30-$0D82` (ordinary title-screen animation/object-dispatch logic).
- **Proved the counting tier can count without stopping** -- a non-stopping store checkpoint on the screen matrix accumulated 432 hits while `cycles_advanced` reached 27,189,792 and execution never paused. No fallback to a stopping-checkpoint-with-ignore-count was needed.
- **Armed the small final set and passed idle calibration**: the loader-reentry stopping sentinel and the `$DD00` counting sentinel both registered exactly 0 hits across a 24,396,568-cycle no-input idle window. `node tools/watch-loads.mjs check-idle --release danish --json` confirms the gate passes.
- **Gathered real IRQ-path reconnaissance**, per the developer's second/third/fourth steering messages: confirmed `$01`'s HIRAM bit is 0 at this instant (KERNAL banked out), so the live hardware vector is `$FFFE/$FFFF` (not `$0314`); disassembled the resulting dispatcher at `$1103` (register-save prologue, indirect dispatch through `$0408/$0409`); followed the per-frame raster-split chain it dispatches to (`$1574` writes VIC registers, self-modifies `$0408/$0409` to chain to `$1574`'s next stage `$152C`, which decrements the same zero-page timers `$48/$49/$4A` the main-loop title dispatcher polls). This is real, load-bearing evidence that the armed/reconnoitred set covers both the main loop and the IRQ path, as the developer's steering required, and it is recorded in the hit log rather than left to live only in conversation.
- **Armed small structural instrumentation** (2 write-watches, 4 bytes total, on `$0314-$0315` and `$FFFE-$FFFF`) per the developer's suggestion, as diagnostic instrumentation separate from the two-tier `watch_set` model. One incidental hit on `$0314-$0315` was investigated and found to write the same value already present (an incidental blanket byte-stamp, not a vector install); the hardware vector itself never changed during the idle window.
- **Proved teardown by enumeration** for every checkpoint armed this session on both releases (danish's 4-checkpoint small set, plus the 173-checkpoint over-arm that was corrected mid-run, plus saeger's single trigger checkpoint) -- every teardown ends in an explicit `vice_checkpoint_list` reporting `count: 0`, never trusted from a delete call's own return value.
- **Corrected both NOTES.md files' two live defects.** danish's `$08F5/$08F7`-grouped-with-animation-phases paragraph now states the corrected finding with quoted disassembly, and both files' "Reproducing this dump" sections now name the ordered `mcp__vice__*` call sequence instead of the deleted `tools/recover.mjs` command (verified: `grep -rn 'recover\.mjs'` over both files now returns no matches).
- **Closed a false-confidence gap in the renderer itself.** When saeger's boot stalled, `renderLoading` would otherwise have rendered saeger's `0` load-event count identically to danish's genuinely earned `0` -- exactly the "zero found" false confidence this plan exists to prevent. Added a `run_status: "blocked"` field the renderer now surfaces as a prominent warning (`⚠ THIS IS NOT AN EVIDENCED ZERO`), with two new tests (37 total, up from 35) covering both the flagged and the ordinary path.
- **Discovered and logged a genuine host-side VICE quirk mid-session**, rather than working around it: `vice_registers_get` began returning a byte-for-byte identical stale snapshot across an explicit resume, a checkpoint delete, a soft reset, a hard reset, and a single explicit step -- while `vice_ping`'s running/paused field, `vice_backtrace`'s frame count, and `vice_vicii_get_state` all continued to reflect genuine state changes. Switching to `saeger.d64` and re-attempting its boot showed the same pattern escalate to genuine zero cycle advancement (two independent `vice_cycles_stopwatch` brackets), confirmed on a second disk image. No host restart was attempted, per the project's hard rule; the incident is logged at `.planning/todos/pending/2026-08-01-vice-registers-frozen-after-reset-during-01-04-task2.md`.

## Task Commits

1. **Task 2 (danish complete, saeger blocked): earn the loader-reentry watch set live, IRQ/main-loop reconnaissance, correct both NOTES.md defects** - `72eb6e7` (feat)

Task 3 and Task 4 have no commits: they were not started, because Task 3's own `<precondition>` --
"Task 2's earned watch set is committed: `recovery/RELEASES.json` carries a non-empty
`loader_ranges` with `idle_hits` of zero and a `watch_set` for both releases" -- is not met for
saeger, and the host-side stall would have made reliable milestone/attribution work impossible
for danish's own play-through even if it had been attempted.

## Files Created/Modified

- `recovery/LOADING.md` - Rendered absence-as-evidence record for both releases; danish's section is a genuinely evidenced zero with full armed-set/idle-calibration/IRQ-reconnaissance detail, saeger's section carries the new blocked-run warning
- `recovery/danish/dumps/danish-loading-hits.json` - New boundary artifact: danish's Task 2 armed set, idle calibration, counting-tier probe, IRQ-path reconnaissance evidence, structural vector-watch results, and teardown enumeration
- `recovery/saeger/dumps/saeger-loading-hits.json` - New boundary artifact: saeger's blocked run, with `run_status: "blocked"`, the identity/stall evidence, and a genuine (not fabricated) teardown enumeration for the one checkpoint that was armed
- `recovery/RELEASES.json` - danish gained `loader_ranges` (1 entry, `idle_hits: 0`), `rejected_candidates` (3 entries), `watch_set` (173-entry full resolution, data for 02-02's hand-off); saeger gained the same three fields as empty arrays (blocked, not a completed zero-entry resolution)
- `recovery/danish/NOTES.md` - Corrected the `$08F5/$08F7` misclassification paragraph with live disassembly and the STATE.md defect cross-reference; rewrote "Reproducing this dump" as an ordered `mcp__vice__*` call sequence
- `recovery/saeger/NOTES.md` - Rewrote "Reproducing this dump" the same way; removed three other `tools/recover.mjs` mentions (in historical bug-fix narrative) that would otherwise still trip the "no dead command name" acceptance check
- `tools/watch-loads.mjs` - Added `run_status`/`run_status_note` handling to `renderReleaseSection` (additive; existing behavior unchanged when the field is absent)
- `tools/watch-loads.test.mjs` - Two new tests for the blocked-run rendering path (37 tests total)
- `.planning/todos/pending/2026-08-01-vice-registers-frozen-after-reset-during-01-04-task2.md` - New todo logging the host-side VICE quirk, per `.claude/CLAUDE.md`'s instruction to log VICE MCP quirks as a todo rather than fix them from inside a plan executor

## Decisions Made

- **Course-corrected on a direct developer instruction rather than defending the plan's literal text.** The plan's Task 2 Step 3 says to arm every `WATCH_SET`-resolved sentinel; the developer's steering (via the coordinator, mid-run) explicitly identified this as the exact failure mode of the reverted prior attempt and specified a different technique. Deviation Rule 4 (architectural change) applies, but the direction came from the developer, not from my own judgement call -- documented here rather than silently substituted.
- **Kept the full 173-entry `WATCH_SET` resolution as registry data** (for plan 02-02's D-11 hand-off) while only live-arming a 2-entry subset this run, and said so explicitly in the hit log's `watch_set_note` -- a reader must not conflate "resolved" with "armed and idle-calibrated."
- **Recorded saeger's empty `loader_ranges`/`rejected_candidates`/`watch_set` as BLOCKED, not as a completed empty result**, via the new `run_status: "blocked"` field and the renderer's warning. This is a direct application of the plan's own stated prohibition: "MUST NOT report a load-event count — least of all a zero — as evidence from a run whose emulator was not proven to be executing."
- **Did not attempt to restart or otherwise route around the host-side stall.** `.claude/CLAUDE.md` and `.planning/STATE.md` both already document repeated host VICE instability and state plainly that the container cannot restart the host and should not try. Once the pattern was independently confirmed on a second disk image, further `vice_execution_run`/`vice_machine_reset` cycles were stopped.
- **Named this file `ATTEMPT-2-HALT.md` rather than `01-04-SUMMARY.md`**, matching attempt 1's own precedent and the specific `.planning/STATE.md` lesson about `phase-plan-index` silently dropping an incomplete plan from `incomplete` when a `SUMMARY.md`-named file with `status: blocked` exists.

## Deviations from Plan

### Auto-fixed / developer-directed

**1. [Rule 4 - architectural, developer-directed] Replaced Task 2 Step 3's "arm every resolved sentinel" design with a small earned set + reconnaissance**
- **Found during:** Task 2, immediately after arming all 173 danish sentinels per the plan's literal text
- **Issue:** Arming 173 individual live checkpoints reproduces the exact 174-checkpoint bombardment failure the reverted prior attempt hit (`.planning/STATE.md`), and is fragile against host instability (each arm is a network round-trip to a host that has crashed repeatedly on `vice_execution_run` in this project)
- **Fix:** Tore down all 173 over-armed checkpoints (proven empty by enumeration), then armed only the loader-reentry stopping sentinel and the `$DD00` counting sentinel live, using pause -> `vice_registers_get` -> `vice_backtrace` -> `vice_disassemble` -> resume for all further reconnaissance and evidence-gathering
- **Files modified:** `recovery/RELEASES.json`, `recovery/danish/dumps/danish-loading-hits.json`
- **Verification:** `node tools/watch-loads.mjs check-idle --release danish --json` passes with the small set; `vice_checkpoint_list` confirmed empty after every teardown
- **Committed in:** `72eb6e7`

**2. [Rule 2 - missing correctness functionality] `renderLoading` did not distinguish a blocked run from a genuine zero**
- **Found during:** rendering `recovery/LOADING.md` for saeger's blocked run
- **Issue:** Without a distinguishing signal, saeger's unattempted `0` load-event count would render identically to danish's genuinely earned `0` -- exactly the false-confidence failure mode T-01-15/the plan's first prohibition names
- **Fix:** Added a `run_status: "blocked"` + `run_status_note` field pair the renderer surfaces as a prominent warning; two new tests cover both paths
- **Files modified:** `tools/watch-loads.mjs`, `tools/watch-loads.test.mjs`
- **Verification:** `node --test tools/watch-loads.test.mjs tools/dump-artifacts.test.mjs` -- 37/37 pass
- **Committed in:** `72eb6e7`

### Not auto-fixed -- a hard environmental blocker, logged rather than routed around

**3. [Precondition unmet, not auto-fixable] Host-side VICE stall: `vice_registers_get` frozen, then genuine zero cycle advancement**
- **Found during:** Task 2, danish's IRQ-handler-entry reconnaissance (profiling the main loop via the interrupted-PC-on-the-stack technique the developer's fourth steering message described)
- **Issue:** `vice_registers_get` began returning a byte-for-byte identical snapshot across an explicit resume, a checkpoint delete, a soft reset, a hard reset, and a single explicit step, while `vice_ping`/`vice_backtrace`/`vice_vicii_get_state` continued to reflect genuine state changes. Switching to `saeger.d64` showed the pattern escalate: two independent `vice_cycles_stopwatch reset -> run -> poll -> read` brackets both measured exactly 0 cycles advanced despite `vice_ping` continuously reporting `execution:"running"`
- **Fix:** None applied. Per `.claude/CLAUDE.md` ("Host VICE has crashed repeatedly in this project... If the host dies, report it — do not try to restart it from the container") and this executor's own protocol, this is logged as a todo rather than fixed from inside a plan executor, and no further host restart or reset was attempted once the pattern was confirmed twice
- **Files modified:** `.planning/todos/pending/2026-08-01-vice-registers-frozen-after-reset-during-01-04-task2.md` (new), `recovery/saeger/dumps/saeger-loading-hits.json` (records the blocked state honestly)
- **Verification:** N/A -- the incident is the finding
- **Committed in:** `72eb6e7`

---
**Total deviations:** 3 -- two developer-directed/auto-fixable (Rules 4 and 2), one a hard blocker (not auto-fixable)
**Impact on plan:** Task 1 (inherited) and danish's full Task 2 pass are complete and well-evidenced. saeger's Task 2 pass, and all of Task 3 and Task 4, could not be completed this session. **RECOVER-04 is NOT satisfied** -- danish's half of the detector is earned and calibrated, but the requirement needs both releases played through with an attributed result, which did not happen.

## Issues Encountered

- See "Deviations from Plan" #3 above -- the dominant issue this session encountered, after otherwise-successful work on danish, was the host-side VICE stall. No other blocking issues arose; every acceptance criterion this session did complete (danish's loader-range derivation, the counting-tier probe, idle calibration, both NOTES.md corrections, teardown enumeration, the schema validator) passed on the first or second attempt.

## User Setup Required

None -- no external service configuration required. This is a host-side emulator instability issue, not a user-facing setup step; see the new todo for the full incident record and a suggested diagnostic for a future session (open a fresh session so a fresh instance is granted, per the project's per-session boot-fresh access model, and check whether the same freeze recurs immediately).

## Next Phase Readiness

- **Not ready.** Task 3 depends on Task 2's earned `watch_set` for BOTH releases (saeger's is empty/blocked), and Task 4 is gated on Task 3.
- **danish's Task 2 work is durable and does not need to be redone** by whichever session picks this plan back up: `loader_ranges`, `rejected_candidates`, the idle calibration, and the IRQ-path reconnaissance are all committed with live evidence. A fresh session's Task 2 pass need only cover saeger.
- **Blocker for the phase, updated:** plans 01-05 and 01-06 (per `.planning/STATE.md`'s replan note) consume this plan's `loader_ranges`/`watch_set` data shape. danish's half now exists in the registry; saeger's does not yet. They should not proceed past whatever they can do with danish-only data until this plan's saeger pass and Tasks 3-4 land.
- **Suggested next step:** open a genuinely fresh session (first tool call is `vice_ping`, so a fresh boot-fresh instance is granted) before resuming this plan, and re-verify the todo's diagnostic question (does `vice_registers_get` work correctly from a clean start?) before committing to a full saeger + play-through pass.

---
*Phase: 01-recovery-provenance*
*Completed: 2026-08-01 (partial -- blocked)*
