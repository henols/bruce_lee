---
phase: 01-recovery-provenance
plan: 03
subsystem: recovery
tags: [vice, mcp, c64, 6510, ram-capture, reproducibility, provenance, kernal-getin]

# Dependency graph
requires:
  - phase: 01-01
    provides: "The proven capture procedure, recovery/RELEASES.json registry, tools/recover.mjs and the danish game-entry dumps"
  - phase: 01-02
    provides: "The artifact-set contract (.bin+.capture.json+.state.json+.map.json), the schema validator, and saeger's DIRECTORY.md/DIRECTORY.json evidence"
provides:
  - "The second cracked release (saeger) recovered via the exact same command as danish -- `node tools/recover.mjs recover <id>` -- with zero release-name conditionals added"
  - "Proof that danish and saeger share byte-identical original Datasoft game code at $08B1 (title-screen input dispatcher) and $139E (input scanner)"
  - "A new, generic, data-driven gate-delivery mechanism (`gate.delivery: \"kernal-buffer\"`) for cracks that gate on the KERNAL's own GETIN rather than a direct CIA-port read"
  - "A real bug fix in the find-entry CLI verb (it never called boot() before searching)"
  - "recovery/saeger/NOTES.md -- the recorded procedure, structurally mirroring danish's, plus a cross-release differences section"
  - "recovery/RELEASES.json's schema_notes field + tools/releases.mjs's schemaNotes()/schema-notes CLI -- the N-readiness claim, rehearsed against the real validator"
affects: [01-04, 01-05, 01-06, phase-02, phase-03, phase-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Gate delivery mechanism is registry data (gate.delivery), never a release-id conditional -- the second legitimate value this project needed, and it arrived exactly the way the phase's own philosophy predicted: as a data field, not a branch"
    - "Cross-release corroboration as a diagnostic tool: comparing saeger's divergent bytes against danish's own fully-reproducible capture of the same address range proved the divergence was a real, fixable timing artifact rather than unexplainable noise"
    - "A found automation bug is verified against evidence before being trusted, not patched blind: the find-entry CLI fix was confirmed by disassembling its OLD wrong answer (KERNAL ROM) before writing the fix, and its NEW answer was cross-checked against danish's known-good dispatcher before being recorded as the release's trigger"

key-files:
  created:
    - recovery/saeger/NOTES.md
  modified:
    - tools/recover.mjs
    - tools/releases.mjs
    - recovery/RELEASES.json
    - recovery/saeger/dumps/saeger-gameentry-run1.bin
    - recovery/saeger/dumps/saeger-gameentry-run1.capture.json
    - recovery/saeger/dumps/saeger-gameentry-run1.state.json
    - recovery/saeger/dumps/saeger-gameentry-run1.map.json
    - recovery/saeger/dumps/saeger-gameentry-run2.bin
    - recovery/saeger/dumps/saeger-gameentry-run2.capture.json
    - recovery/saeger/dumps/saeger-gameentry-run3.bin
    - recovery/saeger/dumps/saeger-gameentry-run3.capture.json

key-decisions:
  - "saeger's trigger is $08B1 -- the SAME address as danish, not a differently-shaped trigger.kind as the plan's flagged_assumption anticipated. Both cracks preserve the original Datasoft game code at the same load address; the real per-release difference lives upstream, in the cracktro's own gate mechanism, not in the game's own entry point."
  - "Added a second gate-delivery style (`kernal-buffer`) selected by a registry field, never a release conditional, after finding and fixing a genuine timing-jitter bug: saeger's crack waits on KERNAL GETIN, which is subject to the periodic keyboard-scan IRQ's own schedule, unlike danish's instantaneous direct CIA-port read."
  - "Fixed a real, pre-existing bug in find-entry's CLI verb (it never called boot() before searching) -- confirmed by disassembling its wrong answer as KERNAL ROM code before trusting anything downstream of it."
  - "recovery/RELEASES.json gained a top-level schema_notes field (sibling to schema_version/releases) as the N-readiness documentation location, since JSON has no comments and this describes the registry's shape, not any one release."
  - "No relaxation of upsertRelease was needed for N-readiness -- the null-tolerant bare-entry shape was already exercised twice (once per real release) before this plan, and the probe rehearsal proved it mechanically."

patterns-established:
  - "A release-specific timing sensitivity is fixed at its source (a new, generic, data-selected delivery mechanism) rather than tolerated by loosening the shared drift classifier -- the classifier (`classifyRunSet`) was NOT modified."
  - "Cross-release byte comparison is a legitimate, cheap diagnostic once one release's game-code region is known: checking whether the second release loads identical bytes at the same addresses is the first thing to try, not a last resort."

requirements-completed: [RECOVER-01, RECOVER-03]

coverage:
  - id: D1
    description: "The second release is recovered via the same command as danish (`node tools/recover.mjs recover saeger`), with no release-name conditional added anywhere in tools/"
    requirement: "RECOVER-03"
    verification:
      - kind: integration
        ref: "node tools/recover.mjs reproduce saeger -- exits 0 across four independent post-fix invocations; node tools/recovery-schema.mjs check-parameterisation -- OK (7 files scanned, 0 violations)"
        status: pass
    human_judgment: false
  - id: D2
    description: "reproduce saeger exits zero; the artifact set is committed and passes schema validation"
    requirement: "RECOVER-03"
    verification:
      - kind: integration
        ref: "node tools/recover.mjs reproduce saeger --runs 3 (exit 0); stat -c%s recovery/saeger/dumps/saeger-gameentry-run1.bin == 65536; node tools/recovery-schema.mjs validate (exit 0)"
        status: pass
    human_judgment: false
  - id: D3
    description: "saeger's own trigger, $01 value, ranges, snapshot name, boot path and both reproducibility digests are recorded in recovery/saeger/NOTES.md"
    requirement: "RECOVER-03"
    verification:
      - kind: manual_procedural
        ref: "recovery/saeger/NOTES.md -- trigger $08B1, $01=$35 decoded, ranges, 3 digests + zone breakdown, snapshot names, exact reproduction command, cross-release differences table"
        status: pass
    human_judgment: true
    rationale: "Whether the write-up is genuinely sufficient for an unfamiliar reader, and whether the timing-jitter root-cause narrative is correctly reasoned, is a judgement no assertion can make. The mechanical checks (concrete hex trigger, concrete $01 byte, explicit ranges, 64-char digests, snapshot names, runnable command) all pass, but they cannot confirm the causal explanation is right."
  - id: D4
    description: "check-parameterisation exits zero after both releases are recovered, proving a third release costs one registry entry plus one invocation, not a code change"
    requirement: "RECOVER-03"
    verification:
      - kind: integration
        ref: "node tools/recovery-schema.mjs check-parameterisation -- OK; probe-entry rehearsal in recovery/saeger/NOTES.md §10 -- validate --json reported exactly one error (missing directory) for a bare new entry"
        status: pass
    human_judgment: false
  - id: D5
    description: "Both disk images have now booted under host VICE through the documented MCP-only procedure, and vice_disk_list was never called by any of it"
    requirement: "RECOVER-01"
    verification:
      - kind: other
        ref: "grep: tools/recovery-schema.mjs's DENY_LIST_CALL_PATTERN found no vice_disk_list call under tools/ (check-parameterisation's own scan); saeger boots via vice_disk_attach + vice_autostart + vice_execution_run, recorded in RELEASES.json's boot field"
        status: pass
    human_judgment: false

# Metrics
duration: ~1h40m (including discovery and fix of a real timing-jitter bug, one host-VICE transient outage, and one instance respawn)
completed: 2026-07-31
status: complete
---

# Phase 01 Plan 03: Saeger Recovery & N-Readiness Rehearsal Summary

**The second cracked release recovered via the identical `recover`/`reproduce` command as danish, proving both that the procedure is release-agnostic and that the two cracks share byte-identical original Datasoft game code at the title-screen dispatcher — with one genuine, release-specific timing bug found, root-caused by cross-referencing danish's own data, and fixed generically rather than tolerated.**

## Performance

- **Duration:** ~1h40m
- **Tasks:** 2 of 2
- **Files modified:** 12 (1 created, 11 modified)

## Accomplishments

- **The procedure really is release-agnostic.** `node tools/recover.mjs reproduce saeger` uses the exact same code path as danish — same `recover()`, same `capture()`, same `classifyRunSet()`, zero release-name conditionals. `check-parameterisation` confirms this mechanically (7 files scanned, 0 violations) both before and after this plan's code changes.
- **Both cracks load byte-identical original Datasoft code at the same addresses.** `$08B1` (title-screen input dispatcher) and `$139E` (input scanner) disassemble to the exact same bytes in both releases — the flagged assumption about needing a second `trigger.kind` turned out to be unnecessary; the game entry point is genuinely shared.
- **A real automation bug found and fixed, evidenced before trusted.** The `find-entry` CLI verb never called `boot()` before searching, so it silently stepped whatever the machine happened to be doing. Confirmed live by disassembling its wrong answer as KERNAL ROM code (`$E5CD`, the GETIN keyboard-wait loop) before writing the fix.
- **A real, release-specific timing bug found, root-caused, and fixed at its source — not papered over.** Saeger's crack gates on the KERNAL's own `GETIN`, which depends on the periodic keyboard-scan IRQ noticing a held key — a real-time-dependent delay, unlike danish's instantaneous direct CIA-port read. This jitter shifted a small table at `~$E104` by one repeat-unit in 2 of 3 cold boots; cross-checked directly against danish's own fully-reproducible copy of the identical table, proving it wasn't RAM noise. Fixed with a new, generic, registry-data-selected gate-delivery mode (`kernal-buffer`) that writes the KERNAL keyboard buffer directly — no dependency on the scan IRQ at all. The shared drift classifier (`classifyRunSet`) was never touched.
- **N-readiness rehearsed against the real validator, not asserted.** A probe registry entry (bare shape, matching what both real releases started from) produced *exactly one* validate error — the missing directory — proving a third release needs no code relaxation.

## Task Commits

1. **Task 1: Recover the second release by re-running the recorded procedure** — `aa7b02c` (feat)
2. **Task 2: Record the second procedure and prove N-readiness explicitly** — `a6d1c19` (docs)

## Files Created/Modified

- `recovery/saeger/NOTES.md` — the recorded procedure: trigger, `$01` decode, ranges, reproducibility verdict, boot procedure, snapshots, operational notes, and the cross-release differences table
- `tools/recover.mjs` — `find-entry` CLI verb fixed to boot before searching; `boot()` gained the generic `kernal-buffer` gate-delivery style
- `tools/releases.mjs` — `schemaNotes()` accessor and `schema-notes` CLI verb
- `recovery/RELEASES.json` — saeger's `trigger`, `boot.gates` (with `delivery`), `tier1_evidence`, `notes`; top-level `schema_notes` field
- `recovery/saeger/dumps/*` — the committed four-file artifact set for all three run labels

## Decisions Made

- **saeger's trigger is `$08B1`, the same address as danish** — both cracks preserve the original Datasoft code at the same load address. The plan's flagged assumption (a second `trigger.kind` might be needed) did not materialize; the real per-release difference is in the crack's own gate mechanism, upstream of the trigger.
- **A new gate-delivery mechanism, selected by registry data.** `gate.delivery: "kernal-buffer"` writes the KERNAL keyboard buffer directly, removing IRQ-scan timing jitter at its source, rather than accepting a lower reproducibility bar or hand-tuning the drift classifier.
- **`schema_notes` as a top-level registry field**, since JSON has no comments and the N-readiness claim describes the registry's own shape, not any one release.
- **No `upsertRelease` relaxation** — the null-tolerant bare-entry shape (`boot: null`, `trigger: null`, empty arrays) was already exercised by both real releases before their first capture; the probe rehearsal confirmed this mechanically rather than assuming it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `find-entry` CLI verb never booted the release before searching**
- **Found during:** Task 1, first attempt to establish saeger's trigger
- **Issue:** `node tools/recover.mjs find-entry saeger` called the generic `findEntry()` function directly, without `reset()`/`boot()` first. Confirmed live: it "stabilized" on `$E5CD`, KERNAL ROM's own keyboard-wait loop (`LDA $C6/STA $CC/STA $0292/BEQ $E5CD`) — not game code, because no disk had been attached that session.
- **Fix:** `find-entry`'s CLI verb now calls `reset()` then `boot(releaseId)` before `findEntry()`, mirroring `recover()`'s own order.
- **Files modified:** `tools/recover.mjs`
- **Verification:** Re-run after the fix, disassembly at the new landing address matched expected KERNAL-boot-sequence code (still not the final answer, but for the right reason — see deviation 2); the ultimate trigger address was independently confirmed via manual disassembly/backtrace before being trusted.
- **Committed in:** `aa7b02c` (Task 1 commit)

**2. [Rule 1 - Bug] Generic `find-entry` search budget too small for an uncrunched raw-sector loader**
- **Found during:** Task 1, same investigation
- **Issue:** Even after fix 1, `find-entry`'s 400-step/150-batch budget landed on `$FD59`, KERNAL's own boot-time vector-table init — still not game code. An uncrunched loader reading 186 raw sectors takes far more CPU instructions to get through than a crunched cracktro's short "hit any key" loop.
- **Fix:** Not a budget increase (which would risk becoming a release-tuned magic number) — the actual trigger was found by direct, hand-driven observation (screenshots + `vice_disassemble`/`vice_backtrace`), the same method danish's own trigger was originally found by. This is recorded as a known limitation of the generic automated search, not hidden.
- **Files modified:** none (procedural, not code)
- **Verification:** The resulting `$08B1` address was independently cross-checked against danish's own disassembly, confirming byte-for-byte identity before being recorded as the trigger.
- **Committed in:** `aa7b02c` (documented in `recovery/RELEASES.json`'s `trigger.how_located`)

**3. [Rule 1 - Bug] Real timing-jitter bug: saeger's KERNAL-GETIN gate is not deterministic under a plain matrix press**
- **Found during:** Task 1, first `reproduce saeger` run
- **Issue:** 8 real multi-bit divergences at `$E104`–`$E10F` and `$E3E3`, failing every existing drift clause. Cross-checked against danish's own dumps: the exact same address window holds a small, fully-reproducible table in danish (identical across all 3 runs); 2 of saeger's 3 runs showed the *same* table phase-shifted by one repeat-unit, and the third matched danish's positioning exactly — proof this was a real, explicable timing effect, not RAM noise.
- **Root cause:** danish's gate reads `$DC00`/`$DC01` directly (instantaneous); saeger's gate waits on KERNAL `GETIN`, which only sees a key once the periodic keyboard-scan IRQ notices it — a real-time-dependent delay from when the matrix-press RPC call happens to land.
- **Fix:** Added a second, generic gate-delivery style (`gate.delivery: "kernal-buffer"`) that writes the KERNAL keyboard buffer (`$C6`/`$0277`) directly, selected via registry data on saeger's gate entry — never a release-id conditional in `tools/`.
- **Files modified:** `tools/recover.mjs` (generic `boot()` change), `recovery/RELEASES.json` (saeger's gate `delivery` field)
- **Verification:** `node tools/recover.mjs reproduce saeger` exits 0 across all four subsequent independent invocations; `check-parameterisation` still reports 0 violations; `node --test tools/recover.test.mjs` (11/11) unaffected.
- **Committed in:** `aa7b02c` (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (3 Rule 1 bugs, all in the automated discovery/reproduction path)
**Impact on plan:** All three were necessary — without them, either the trigger would have been wrong (fixes 1–2) or `reproduce saeger` would never pass (fix 3). No scope creep: every fix is generic, data-driven, and re-verified against `check-parameterisation` after the fact. `recover danish` and its own reproducibility are untouched.

## Issues Encountered

- **One transient host-VICE timeout** during a `reproduce saeger` re-run (instance port 6512 went unresponsive mid-request). Did not corrupt any committed artifact — the timeout occurred before any file write for that invocation, confirmed by checking file timestamps against the prior successful run. Retried successfully against the two remaining live instances (6510/6511).
- **Port 6512 respawned** during this plan (epoch 4 → 5, per the pool supervisor's own detection), consistent with the documented host-instability history. No action was needed; the pool's own epoch mechanism and 2-of-3 minimum kept work moving.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Ready for 01-04:** both releases are now fully recovered with complete artifact sets, a proven release-agnostic procedure, and `check-parameterisation` confirming no release-specific code exists anywhere in `tools/`. `validate --final` still fails (expected at this point in the phase) on manifest bucketing and canonical-release selection, neither of which this plan addresses.
- **Carried into 01-06 (RECOVER-07):** the cross-release differences table in `recovery/saeger/NOTES.md` §9 is explicitly written to double as Tier-1 independence evidence raw material — loader style and structure are exactly what D-15 puts in Tier 1.
- **A durably useful diagnostic pattern for future plans:** when a second/third release's capture shows an unexplained divergence, checking whether the SAME address range is stable and known in an already-recovered release is a cheap, high-signal first move before assuming drift or inventing a new classifier clause.

## Self-Check: PASSED

All claimed files verified present on disk (recovery/saeger/NOTES.md, tools/recover.mjs, tools/releases.mjs, recovery/RELEASES.json, and the full run1/run2/run3 artifact sets). Both task commits (`aa7b02c`, `a6d1c19`) verified present in git history.

---
*Phase: 01-recovery-provenance*
*Completed: 2026-07-31*
