---
phase: 01-recovery-provenance
plan: 02
subsystem: recovery
tags: [d64, vic-ii, sid, cia, chip-state, schema-validation, node-test, provenance]

# Dependency graph
requires:
  - phase: 01-01
    provides: "The proven capture procedure, recovery/RELEASES.json registry, tools/recover.mjs and the three danish game-entry dumps"
provides:
  - "Chip-state sidecar (`.state.json`) — raw VIC-II/SID/CIA1/CIA2 register reads plus the derived facts that are not in RAM"
  - "Range manifest (`.map.json`) — gapless, overlap-free classification of all 65536 addresses, currently `ranges-only`"
  - "Direct `.d64` byte parser replacing the forbidden `vice_disk_list` entirely"
  - "Runnable schema invariant: `validate`, `validate --final`, `check-parameterisation`"
  - "Directory + BAM evidence for both cracked releases, with PROJECT.md's faked-directory claim empirically refuted"
affects: [01-03, 01-04, 01-05, 01-06, verification-harness, disassembly]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A recovered release is an artifact *set* (.bin + .capture.json + .state.json + .map.json), enforced mechanically rather than by convention"
    - "Release identity resolves through recovery/RELEASES.json — never a conditional on a release id in tools/"
    - "Gate-has-teeth proof: --final is asserted to FAIL now, so the end-of-phase gate cannot be silently vacuous"

key-files:
  created:
    - tools/chip-state.mjs
    - tools/d64-parse.mjs
    - tools/d64-parse.test.mjs
    - tools/recovery-schema.mjs
    - recovery/danish/DIRECTORY.md
    - recovery/danish/DIRECTORY.json
    - recovery/saeger/DIRECTORY.md
    - recovery/saeger/DIRECTORY.json
  modified:
    - tools/recover.mjs
    - recovery/RELEASES.json

key-decisions:
  - "Sprite pointer bytes are read via vice_memory_read at screen base + $3F8; vice_sprite_get is used only for position/mode flags, which is all it can report"
  - "PROJECT.md's 'faked directories — 0-block BRUCE LEE entries pointing at bogus track/sector' claim is recorded as REFUTED rather than silently reconciled"
  - "`unclassified` added as an explicitly transient sixth range kind, rejected by validate --final so it cannot survive the phase"

patterns-established:
  - "Artifact-set completeness: validate fails when any member of a dump's set is missing for a dump listed in the registry"
  - "Deny-list enforcement in code: check-parameterisation greps tools/ for direct vice_disk_list calls, so the hazard is machine-enforced not memory-enforced"
  - "Refutation over reconciliation: a disagreement between prose assumptions and disk bytes is written down with its evidence, not quietly resolved"

requirements-completed: [RECOVER-01, RECOVER-02]

coverage:
  - id: D1
    description: "Chip-state sidecar records raw VIC-II/SID/CIA registers plus derived VIC bank, screen/charset base, eight sprite pointers and their resolved data addresses, $01 port and CPU registers"
    requirement: RECOVER-02
    verification:
      - kind: other
        ref: "node -e inspect of recovery/danish/dumps/danish-gameentry-run1.state.json — keys: registers, sprites, cpu, derived; derived.vic_bank=2, screen_base=35840, charset_base=32768, 8 sprite_pointers + 8 sprite_data_addresses"
        status: pass
    human_judgment: false
  - id: D2
    description: "Range manifest declares image_bytes 65536, offset_equals_address true, and a ranges array covering $0000-$FFFF with no gap and no overlap"
    requirement: RECOVER-02
    verification:
      - kind: other
        ref: "node -e gap/overlap scan of danish-gameentry-run1.map.json — 345 ranges, gaps:0, overlaps:0, ends_at:65535"
        status: pass
    human_judgment: false
  - id: D3
    description: "Both .d64 directories parsed directly from disk bytes (BAM t18/s0, chain from t18/s1), never via vice_disk_list"
    requirement: RECOVER-01
    verification:
      - kind: unit
        ref: "tools/d64-parse.test.mjs — 17 checks pass (track/sector offset arithmetic, directory-chain walk, suspicious-entry detector fires against a synthetic defect)"
        status: pass
      - kind: other
        ref: "grep: tools/recovery-schema.mjs:279 DENY_LIST_CALL_PATTERN blocks direct vice_disk_list calls under tools/"
        status: pass
    human_judgment: false
  - id: D4
    description: "Runnable schema invariant: validate exits 0, check-parameterisation exits 0 over 7 scanned files, validate --final exits 1 while manifests remain ranges-only"
    requirement: RECOVER-02
    verification:
      - kind: other
        ref: "node tools/recovery-schema.mjs validate (exit 0) && check-parameterisation (exit 0) && ! validate --final (exit 1, 8 errors) — the plan's exact <automated> gate"
        status: pass
    human_judgment: false
  - id: D5
    description: "PROJECT.md's faked-directory claim refuted for both releases with three independent evidence lines each (block count, walkable sector chain matching BAM free-counts, pointed-to sector being the documented BASIC stub)"
    requirement: RECOVER-01
    verification: []
    human_judgment: true
    rationale: "This overturns a recorded project assumption and reassigns confidence on the provenance narrative. A human should confirm the reasoning before downstream plans (01-05, 01-06) build a provenance verdict on it."

# Metrics
duration: 22min
completed: 2026-07-31
status: complete
---

# Phase 01 Plan 02: Per-Dump Artifact Set & Directory Evidence Summary

**Chip-state and range-manifest sidecars wired so no capture can land without them, a direct `.d64` byte parser that retires `vice_disk_list` entirely, and a three-verb schema validator that proves its own end-of-phase gate still fails**

## Performance

- **Duration:** ~22 min (executor), plus orchestrator close-out
- **Started:** 2026-07-31T05:48:11Z
- **Completed:** 2026-07-31T06:10:33Z (executor died post-write/pre-commit; closed out by orchestrator at 06:35Z)
- **Tasks:** 3
- **Files modified:** 22 (14 created, 8 modified)

## Accomplishments

- **The artifact set is now the unit, mechanically.** `tools/chip-state.mjs` writes a `.state.json` sidecar and a `.map.json` range manifest, and `recover()` calls `captureChipState` so a dump cannot land without them. `recovery-schema.mjs validate` fails when any member of a dump's set is missing for a dump listed in the registry.
- **`vice_disk_list` is now retired in code, not just in policy.** `tools/d64-parse.mjs` parses BAM (t18/s0) and the directory chain (from t18/s1) straight from the image bytes, and `check-parameterisation` carries a deny-list pattern that fails the build if any file under `tools/` calls the forbidden tool directly.
- **The end-of-phase gate is proven to have teeth.** `validate --final` exits 1 right now with 8 specific errors (173/174/171 `unclassified` ranges across the three danish manifests, saeger's null trigger, zero canonical releases) — so nothing downstream can depend on a gate that was silently vacuous.
- **A recorded project assumption was refuted with evidence.** Both disks' `BRUCE LEE` directory entries are genuinely well-formed, not the "0-block, bogus track/sector" fakes PROJECT.md describes.

## Task Commits

1. **Task 1: Chip-state sidecar and range manifest, wired so no capture can land without them** — `c9bd657` (feat)
2. **Task 2: Parse both disk directories from the .d64 bytes** — `4d0518b` (test, RED) → `a80e43b` (feat, GREEN) → `9715b7a` (docs, evidence)
3. **Task 3: Encode the promoted release-centric data model as a runnable invariant** — `07e4813` (feat)

_Task 2 was executed TDD-style: the failing test landed before the parser._

## Files Created/Modified

- `tools/chip-state.mjs` — chip-state sidecar writer; raw register reads plus `$DD00` VIC-bank, `$D018` screen/charset base, sprite pointer and sprite-data-address derivations
- `tools/d64-parse.mjs` — direct `.d64` parser: `readImage`, `parseBam`, `parseDirectory`, `tsToOffset`, plus a suspicious-entry detector
- `tools/d64-parse.test.mjs` — 17 checks over offset arithmetic, chain walking, and detector behaviour against a synthetic defective fixture
- `tools/recovery-schema.mjs` — `validate`, `validate --final`, `check-parameterisation`
- `tools/recover.mjs` — capture path now emits the full artifact set
- `recovery/RELEASES.json` — registry extended to describe dumps as sets
- `recovery/{danish,saeger}/DIRECTORY.{md,json}` — directory/BAM evidence, human- and machine-readable
- `recovery/danish/dumps/*-run{1,2,3}.{state,map}.json` — sidecars for all three existing danish dumps

## Decisions Made

- **Sprite pointers come from RAM, not from `vice_sprite_get`.** The pointer bytes are read with `vice_memory_read` at the resolved screen base + `$3F8`; `vice_sprite_get` is used only for position and mode flags, which is all it can actually report. Both appear in the sidecar, from their correct sources.
- **`unclassified` is an explicitly transient sixth range kind** on top of D-02's five, and `validate --final` rejects it. This lets the manifests exist now in `ranges-only` state without letting that state survive the phase.
- **The faked-directory disagreement is recorded, not reconciled.** Writing the refutation down with its evidence was chosen over quietly updating either the prose or the parse.

## Deviations from Plan

### 1. A `must_haves` truth was empirically refuted rather than satisfied

- **Found during:** Task 2 (parse both disk directories)
- **The plan asserted:** "the parse output records the faked 0-block `BRUCE LEE` entries and the track/sector they point at (RECOVER-01)" — inherited from PROJECT.md's Context section: *"Both have faked directories — 0-block BRUCE LEE PRG entries pointing at bogus track/sector."*
- **What the bytes show:** neither disk's entry is faked.
  - `danish.d64`: `PRG (closed)`, `BRUCE LEE   (DC)`, first T/S **17/0**, **178 blocks**
  - `saeger.d64`: `PRG (closed)`, `BRUCE LEE`, first T/S **1/0**, **186 blocks**
- **Three independent evidence lines per disk:** (1) block count is 178/186, not 0, and the suspicious-entry detector — proven to fire against a synthetic defect in `d64-parse.test.mjs` — does not fire; (2) each entry's own sector chain is walkable and terminates on exactly its stated block count, matching the BAM's independent per-track free counts (danish interleave-10 across t17→t9; saeger interleave-1 across t1→t9); (3) the pointed-to sector is the documented BASIC stub byte-for-byte — danish t17/s0 holds load address `$0801` and the tokenized `SYS 2073` + `TCS-CRUNCH!` signature at exactly the track/sector PROJECT.md's own boot-stub table cites.
- **Resolution:** recorded in both `DIRECTORY.md` files as an open disagreement with PROJECT.md, per this plan's own instruction to record rather than silently reconcile. **PROJECT.md itself was not edited** — that is a provenance decision for 01-05/01-06, not a side effect of this plan.
- **Impact:** RECOVER-01 is satisfied in substance (both directories inspected from raw bytes, entries and their track/sectors recorded) but the *characterisation* in the requirement's wording is wrong. Flagged for human confirmation as coverage item D5.

### 2. Executor died mid-task-3; plan closed out by the orchestrator

- **What happened:** the executor committed tasks 1–2 (four commits), wrote `tools/recovery-schema.mjs`, and then died at ~06:10Z before `git add`/`commit` and before authoring this SUMMARY. No completion signal reached the orchestrator, and no process remained with a cwd inside the worktree.
- **Recovery:** the uncommitted file was rescued out of the worktree, verified against the plan's exact `<automated>` gate *before* being trusted (`validate` 0, `check-parameterisation` 0, `validate --final` 1 — all three as specified), then committed as `07e4813`. This SUMMARY was authored by the orchestrator from commit and gate evidence, under the "close out manually" recovery path, with explicit user approval.
- **Not re-run:** the three danish RAM captures already in the tree were left untouched; re-running them would have re-exercised the unstable host emulator for no gain.

---

**Total deviations:** 2 (1 refuted plan assumption, 1 executor-death close-out)
**Impact on plan:** No scope creep. All three tasks' deliverables exist and pass their stated gates. One inherited factual assumption is now known to be false and is flagged for human confirmation.

## Issues Encountered

- **Silent executor death with no completion signal.** The harness never reported the failure, and `/tmp` file metadata was unreliable as a liveness signal (`stat` reported 128 bytes for a 900KB file). The signal that actually worked was checking whether any live process held a cwd inside the worktree. Waves 3–6 should spot-check on the stall threshold rather than trusting notification.
- **Host VICE reachability was fine for this plan** — the pool reported 3/3 instances alive and free (epoch 3) throughout.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Ready for 01-03 (saeger recovery):** the artifact-set contract, the schema validator and the release-parameterisation check are all in place, so 01-03 is a re-run of a proven procedure rather than new construction. `saeger`'s `trigger.address` is still `null` — `validate --final` already names that as one of its 8 blocking errors, which is exactly what 01-03 must close.
- **Carried into 01-05/01-06:** the refuted faked-directory claim needs a decision, not just a note. Whoever writes `PROVENANCE.md` inherits a corrected picture: both cracks ship well-formed directories pointing at real, walkable, correctly-sized program files.
- **Concern:** 345 ranges across the danish manifests are `unclassified`. The three-bucket partition in 01-05 is the only thing standing between that and `validate --final` passing.

---
*Phase: 01-recovery-provenance*
*Completed: 2026-07-31*
