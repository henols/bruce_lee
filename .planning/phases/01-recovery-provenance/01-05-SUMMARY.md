---
phase: 01-recovery-provenance
plan: 05
subsystem: infra
tags: [provenance-diff, byte-diffing, node-crypto, sha256, range-manifest, ledger]

# Dependency graph
requires:
  - phase: 01-recovery-provenance (plan 01-03)
    provides: "recovery/RELEASES.json's committed run1/run2/run3 dumps (bin/state/map/capture) for both releases, and the shared $08B1 trigger"
  - phase: 01-recovery-provenance (plan 01-04, attempts 1-4, Task 2 half)
    provides: "recovery/RELEASES.json's earned loader_ranges, rejected_candidates and watch_set per release -- the authoritative, live-disassembly-evidenced loader seed this plan reads (never NOTES.md prose). Task 3/4 of 01-04 (the full play-through coverage claim) remains incomplete; this plan's ledger explicitly cross-references that incompleteness rather than assuming it away."
provides:
  - "tools/diff-images.mjs: anchorSearch/proveOffset/applyOffset (D-17 anchor-proven offset, proven 0 for danish vs saeger), diffRanges/coalesceRanges (N-way per-address agreement vote with gap-tolerant coalescing), countPatches, bucketManifest (ranges-only -> bucketed, seeding loader from RELEASES.json's loader_ranges and cracktro from a crack-credit-vocabulary-filtered printable scan), renderLedger (the generated + prose ledger tiers), splitRangeByManifestKind"
  - "recovery/PROVENANCE.md: the committed ledger, 508 generated-tier rows covering exactly $0000-$FFFF, plus a hand-written prose tier stating the proven offset, the normalised state, the gap tolerance and its justification, the three-bucket partition rationale, the LOADING.md completeness cross-reference (T-01-23), and the direction-of-truth rule"
  - "All 6 range manifests (danish/saeger x run1/run2/run3) promoted from ranges-only to bucketed, zero unclassified ranges remaining; validate --final down from 13 errors to exactly 1 (canonical designation, plan 01-06's job)"
  - "recovery/RELEASES.json's new provenance_offset field per release and top-level ledger field (generated_tier_sha256/gap_tolerance/generated_at) for drift detection"
  - "A genuine, previously-undocumented finding: danish's game data reads 'DATASOFT PRESENTS' where saeger's reads 'DIABOLO  PRESENTS' at $4771-$4779 -- an alignment-preserving substitution in neither the loader nor the cracktro region, recorded UNKNOWN (not asserted as a cracker patch) and logged as an open question for a future live session"
affects: [01-06, 02-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Anchor-proven offset search: select non-trivial byte runs (biased away from a documented volatile zone), locate with Buffer.indexOf, accept a global offset only when every unique-match anchor agrees -- a non-unique anchor is rejected outright and disagreement fails rather than voting a majority."
    - "Signature-based (not value-based) per-address evidence text, so adjacent same-signature addresses collapse into one range instead of one row per byte value -- discovered live when a byte-value-embedded evidence string defeated range collapsing (42591 singleton rows instead of ~100 long runs)."
    - "Split a coalesced range against a manifest's own categorical boundaries before resolving a per-row field from it (kind, here) -- 'the range agrees on verdict' does not imply 'the range agrees on kind'."
    - "Content-based classification needs a signature/vocabulary filter, not a bare structural predicate (printable-ASCII) -- the game's own title text is printable too, and a bare scan misclassified it as cracktro credit content."

key-files:
  created:
    - tools/diff-images.mjs
    - tools/diff-images.test.mjs
    - recovery/PROVENANCE.md
  modified:
    - recovery/danish/dumps/danish-gameentry-run1.map.json
    - recovery/danish/dumps/danish-gameentry-run2.map.json
    - recovery/danish/dumps/danish-gameentry-run3.map.json
    - recovery/saeger/dumps/saeger-gameentry-run1.map.json
    - recovery/saeger/dumps/saeger-gameentry-run2.map.json
    - recovery/saeger/dumps/saeger-gameentry-run3.map.json
    - recovery/RELEASES.json
    - recovery/danish/NOTES.md
    - recovery/saeger/NOTES.md
    - .planning/RE-FINDINGS.md
    - .planning/REQUIREMENTS.md

key-decisions:
  - "Reference release for the diff is registry.releases[0] (currently danish), resolved positionally at runtime, never hardcoded -- every other release's offset is proven against it. Recorded explicitly in the ledger's prose tier as a fact, not a canonical designation (that's plan 01-06's job)."
  - "CRACKER-PATCH is assigned only when a differing address falls inside a release's own earned loader_ranges (loader replacement) or a crack-credit-vocabulary-filtered printable run (intro splice) -- the only two mechanically-detectable 'recognised cracker techniques' available without deeper disassembly. Every other differing address gets UNKNOWN with a reason, never an inferred CRACKER-PATCH verdict."
  - "The DATASOFT/DIABOLO text divergence at $4771-$4779 is recorded UNKNOWN, not CRACKER-PATCH, despite being a real and interesting find -- the tool cannot mechanically confirm a rebrand/relabel technique without live disassembly confirming what code path reads this text, and asserting CRACKER-PATCH would be exactly the inferred-as-evidenced claim this plan's prohibition forbids."
  - "countPatches currently reports 0/0 for both releases -- an honest, empirically-grounded result (no CRACKER-PATCH verdict exists anywhere in this pass after the cracktro false-positive was fixed), not a design shortcoming; the measurement remains structurally capable of reporting non-zero if a genuine game-region patch is ever found."
  - "REQUIREMENTS.md was hand-edited for RECOVER-05/RECOVER-06 only (gsd-tools was not available in this worktree); RECOVER-01 through RECOVER-04's rows were left untouched since their completion status is this plan's neither to assert nor to change."

requirements-completed: [RECOVER-05, RECOVER-06]

coverage:
  - id: D1
    description: "Anchor-proven offset search and application (Task 1): anchorSearch/proveOffset/applyOffset, run against the real committed dumps and proving offset 0"
    requirement: "RECOVER-05"
    verification:
      - kind: unit
        ref: "tools/diff-images.test.mjs -- anchorSearch/proveOffset/applyOffset test group (16 tests) plus the real-dump integration case"
        status: pass
      - kind: other
        ref: "node tools/diff-images.mjs anchor-search --json (exit 0, offset 0, 7/8 anchors agreeing)"
        status: pass
    human_judgment: false
  - id: D2
    description: "N-way diff, gap-tolerant coalescing, and the three-bucket manifest partition (Task 2), run against all 6 committed manifests"
    requirement: "RECOVER-06"
    verification:
      - kind: unit
        ref: "tools/diff-images.test.mjs -- diffRanges/coalesceRanges/countPatches/bucketManifest test group (20 tests)"
        status: pass
      - kind: other
        ref: "node tools/diff-images.mjs diff --gap-tolerance 16 --json (65536-byte coverage, no gap/overlap, no ORIGINAL below 2 agreeing); node tools/recovery-schema.mjs validate --final (13 -> 1 error)"
        status: pass
    human_judgment: false
  - id: D3
    description: "recovery/PROVENANCE.md: generated tier + prose tier, refusing to emit on an evidence violation, byte-identical on regeneration"
    requirement: "RECOVER-06"
    verification:
      - kind: unit
        ref: "tools/diff-images.test.mjs -- renderLedger/splitRangeByManifestKind test group (6 tests, including refusal and digest-stability cases)"
        status: pass
      - kind: other
        ref: "node tools/diff-images.mjs ledger --gap-tolerance 16 (two runs, identical sha256 dde5db5...); test -s recovery/PROVENANCE.md"
        status: pass
    human_judgment: false

# Metrics
duration: ~50min
completed: 2026-08-01
status: complete
---

# Phase 01 Plan 05: Provenance Diff Summary

**Anchor-proven offset-0 diff between danish and saeger, a 508-row generated ledger over the full $0000-$FFFF space with a hand-written prose tier, and all 6 range manifests promoted to `bucketed` -- built and then corrected against the real dumps rather than trusted from design alone, catching a range-collapsing bug, a bucketing idempotency bug, a cracktro false-positive, and a kind-boundary bug along the way.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-08-01 (this session)
- **Completed:** 2026-08-01T22:45Z
- **Tasks:** 3/3 complete
- **Files modified:** 3 created (`tools/diff-images.mjs`, `tools/diff-images.test.mjs`, `recovery/PROVENANCE.md`), 10 modified

## Accomplishments

- **Proved the diff's base offset from the bytes, not assumed**, per D-17: `node tools/diff-images.mjs anchor-search` selected 8 long, non-trivial byte runs from danish's `run1` dump (biased away from the volatile zero-page/stack/KERNAL-work-area zone), located each in saeger's `run1` dump with `Buffer.indexOf`, and confirmed offset **0** with 7 of 8 anchors agreeing (the 8th correctly rejected as non-unique — a repeating `$00`x8+`$AA`x40 pattern matched at two target offsets). Recorded in both NOTES.md files and in `recovery/RELEASES.json`'s new `provenance_offset` field.
- **Ran an N-way per-address agreement vote across both releases' primary dumps** with gap-tolerant coalescing at `--gap-tolerance 16`, producing a coalesced range set covering exactly all 65536 addresses with no gap or overlap, and no `ORIGINAL` row ever below 2 agreeing releases.
- **Promoted all 6 range manifests (3 run labels x 2 releases) from `ranges-only` to `bucketed`**, seeding the `loader` bucket strictly from `recovery/RELEASES.json`'s earned `loader_ranges` (never `NOTES.md` prose) and the `cracktro` bucket from a crack-credit-vocabulary-filtered printable-text scan; everything else the trace reaches is `game`. `node tools/recovery-schema.mjs validate --final` dropped from 13 errors to exactly 1 (the canonical designation, explicitly reserved for plan 01-06).
- **Rendered `recovery/PROVENANCE.md`**: a 508-row generated tier (post kind-boundary-splitting) plus a hand-written prose tier covering the proven offset and how it was proven, the fully-loaded state both images were normalised to, the gap-coalescing tolerance (16) and its justification, the three-bucket partition rationale, and — per T-01-23 — an explicit, honest cross-reference to `recovery/LOADING.md`'s **incomplete** completeness claim (saeger 5/7 milestones, danish 0/7), stating plainly what would change if a future session finds an on-demand-loaded region. Regenerating twice from unchanged inputs produces a byte-identical generated tier (verified by SHA-256).
- **Found and fixed four real bugs by actually running the tool against the committed dumps**, not just by design review:
  1. Per-address evidence text embedded the literal byte value, defeating range collapsing (42591 singleton `ORIGINAL` rows instead of ~100 long runs) — fixed by making the text signature-based.
  2. `bucketManifest`'s "kept" filter only preserved `unused`/`io`, so re-running it on an already-bucketed manifest would silently discard `game`/`loader`/`cracktro` ranges — fixed to keep everything not `unclassified`, covered by a new idempotency test.
  3. A bare "any printable ASCII run" heuristic misclassified the game's own title-screen text as cracktro credit content — this is also **finding 5** below, a genuine discovery, not just a bug.
  4. The ledger resolved each row's `kind` column from only its start address, silently mislabeling a coalesced range's tail once it crossed a manifest kind boundary (danish's own `$0340`-`$035E` loader bytes were first rendered as `game`) — fixed with `splitRangeByManifestKind`, which raised the row count from 204 to 508 as the direct, correct consequence.
- **Discovered a genuine, previously-undocumented text divergence**: danish's game data reads "DATASOFT PRESENTS" where saeger's reads "DIABOLO  PRESENTS" at the identical address ($4771-$4779, offset-0 confirmed) — an alignment-preserving substitution (7+2 chars matching 8+1), in neither the loader nor the cracktro region. Recorded honestly as `UNKNOWN` (not `CRACKER-PATCH`, since the tool cannot mechanically confirm a rebrand technique) and logged to `.planning/RE-FINDINGS.md` as an open question for a future live session — this could indicate saeger derives from a differently-branded release rather than merely a different crack of the same Datasoft release.
- **check-parameterisation caught a real release-id conditional in the test file itself** (`r.id === "danish"` in the real-dump integration test), fixed positionally (`registry.releases[0]` / `find(r => r !== reference)`) — confirming the gate scans test files too, not only implementation modules.

## Task Commits

1. **Task 1: Anchor-proven offset, with the arithmetic pinned before anything trusts it** - `bc34af4` (feat)
2. **Task 2: N-way diff, gap-tolerant coalescing, and the three-bucket partition** - `76ed51c` (feat)
3. **Task 3: Render the ledger — generated range tier plus hand-written prose tier** - `455b1dc` (feat)

## Files Created/Modified

- `tools/diff-images.mjs` - Anchor search/offset proof, N-way diff, coalescing, manifest bucketing, ledger renderer; zero third-party dependencies (D-18)
- `tools/diff-images.test.mjs` - 42 tests: synthetic boundary/arithmetic cases, one real-dump integration case, an import-purity guard
- `recovery/PROVENANCE.md` - The committed provenance ledger (generated + prose tiers)
- `recovery/{danish,saeger}/dumps/*-run{1,2,3}.map.json` - All 6 promoted from `ranges-only` to `bucketed`
- `recovery/RELEASES.json` - New `provenance_offset` field per release; new top-level `ledger` field (digest/tolerance/timestamp)
- `recovery/{danish,saeger}/NOTES.md` - New sections documenting the proven offset, the anchor count, and how it was proven
- `.planning/RE-FINDINGS.md` - 8 new entries: the mechanical offset confirmation, two test-authoring pitfalls, a check-parameterisation catch in test code, the DATASOFT/DIABOLO discovery, the cracktro false-positive fix, and the kind-boundary bug
- `.planning/REQUIREMENTS.md` - RECOVER-05/RECOVER-06 marked complete (hand-edited; `gsd-tools` unavailable in this worktree)

## Decisions Made

See `key-decisions` in the frontmatter above for the full list with rationale; the headline ones: the reference release is positional (`registry.releases[0]`), never hardcoded; `CRACKER-PATCH` is reserved for the two mechanically-detectable techniques (loader-range membership, crack-credit-vocabulary match) and everything else differing gets `UNKNOWN`; the DATASOFT/DIABOLO divergence is recorded honestly as `UNKNOWN` rather than asserted as a patch.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Per-address evidence/reason text embedded the literal byte value, defeating range collapsing**
- **Found during:** Task 2, first real run of `diff --gap-tolerance 16` against the committed dumps
- **Issue:** `ORIGINAL` rows quoted the specific byte value ("byte $A5 identical..."), so two adjacent addresses with different byte values (the normal case) never compared equal on evidence text and never collapsed — 42591 singleton rows instead of ~100 long runs
- **Fix:** Evidence/reason text made signature-based (mentions the releases and the count, never the byte value)
- **Files modified:** `tools/diff-images.mjs`
- **Verification:** Re-ran `diff --gap-tolerance 16 --json`; range count dropped from 42733 to 204 (later 508 after the kind-boundary fix), coverage still exactly 65536 with no gap/overlap
- **Committed in:** `76ed51c`

**2. [Rule 1 - Bug] `bucketManifest` was not idempotent -- re-running it would discard already-bucketed ranges**
- **Found during:** Task 2, reasoning about what happens on a second `diff` invocation
- **Issue:** The "kept" filter only preserved `unused`/`io` ranges; on a manifest that was already `bucketed` (no `unclassified` ranges remaining), `game`/`loader`/`cracktro` ranges would be silently dropped
- **Fix:** Changed the "kept" predicate to `kind !== "unclassified"`, preserving every already-classified range regardless of which kind
- **Files modified:** `tools/diff-images.mjs`
- **Verification:** New idempotency test (`tools/diff-images.test.mjs`) asserts a second bucketing pass is a byte-for-byte no-op
- **Committed in:** `76ed51c`

**3. [Rule 1 - Bug] A blind "any printable ASCII run" heuristic misclassified the game's own title text as cracktro content**
- **Found during:** Task 2, inspecting the real diff output's one `CRACKER-PATCH` row before the fix
- **Issue:** `findPrintableRuns` alone was used as the cracktro-bucket seed; it found "DATASOFT PRESENTS"/"DIABOLO  PRESENTS" (the game's own title text, genuinely differing between releases) and classified it as an "intro/cracktro splice", which would have been a confidently-wrong `CRACKER-PATCH` verdict shipped straight into the ledger
- **Fix:** Added `findCracktroRuns`, which additionally requires the printable run's text to contain a crack-credit vocabulary word (`CRACKED`, `CRACKERS`, `SOFT GROUP`, `DC-011`, `BREAK'EM`, `MAKE'EM`, `PRESENTS BY`, `CRACKED BY`) sourced from both releases' own already-verified `tier1_evidence`
- **Files modified:** `tools/diff-images.mjs`
- **Verification:** New test asserts `findCracktroRuns` does not match "DATASOFT PRESENTS" while still matching genuine crack-credit text; re-ran the full pipeline (manifests reset to `ranges-only` and rebucketed) — zero `CRACKER-PATCH` rows remain, and the $4771-$4779 divergence correctly reports `UNKNOWN`
- **Committed in:** `76ed51c`

**4. [Rule 1 - Bug] The ledger resolved each row's `kind` from only its start address, mislabeling a range that crosses a manifest kind boundary**
- **Found during:** Task 3, inspecting the rendered `recovery/PROVENANCE.md`
- **Issue:** A coalesced `ORIGINAL` range (`$033C`-`$4770`) spans straight through danish's own `$0340`-`$035E` `loader` sub-range (both releases happen to hold identical bytes across the whole span), and resolving `kind` from the range's start (`game`) silently mislabeled the loader bytes as ordinary game data
- **Fix:** Added `splitRangeByManifestKind`, intersecting every generated row against the reference manifest's own kind boundaries before rendering
- **Files modified:** `tools/diff-images.mjs`
- **Verification:** New unit tests for the split function; re-ran `ledger`, confirmed `$0340`-`$035E` now reports `kind: loader`; row count went from 204 to 508 as the expected, correct consequence; coverage sum still exactly 65536 with no gap/overlap
- **Committed in:** `455b1dc`

**5. [Rule 3 - Blocking] A release-id conditional in the test file tripped `check-parameterisation`**
- **Found during:** Task 1, first `check-parameterisation` run after adding the real-dump integration test
- **Issue:** The test picked releases via `r.id === "danish"` / `r.id !== "danish"`, exactly the conditional the N-readiness gate exists to catch — and the gate scans every `.mjs` file under `tools/`, including tests
- **Fix:** Made the selection positional (`registry.releases[0]` as reference, `find(r => r !== reference)` as the other one — object-identity comparison, not a string literal)
- **Files modified:** `tools/diff-images.test.mjs`
- **Verification:** `node tools/recovery-schema.mjs check-parameterisation` exits 0
- **Committed in:** `bc34af4`

---
**Total deviations:** 5 -- four self-diagnosed bugs (Rule 1) found by running the tool against real data rather than trusting the design, one blocking N-readiness-gate fix (Rule 3)
**Impact on plan:** All auto-fixes were necessary for correctness; none represent scope creep. The plan's own instruction to run every acceptance criterion against the real committed dumps is exactly what surfaced all five issues — none would have been caught by unit tests over synthetic fixtures alone.

## Issues Encountered

No blocking issues beyond the four bugs documented above (all self-diagnosed and fixed within this plan's own scope). This plan touches no emulator, as verified at replan time and re-confirmed here: every input was an already-committed file, and every tool used was pure Node.

## Known Stubs

None. `recovery/PROVENANCE.md`'s two tiers are both fully populated for every one of the 65536 addresses; the "crack-independence verdict and confidence weighting" section is an intentional placeholder with a pointer to plan 01-06 (RECOVER-07), not a stub — the plan's own task text explicitly reserves that content for 01-06 rather than asserting it before its evidence exists.

## Threat Flags

None beyond what the plan's own threat model already covers (T-01-07, T-01-19, T-01-20, T-01-21, T-01-22, T-01-23 — all mitigated per the plan's own disposition, verified above). No new network endpoints, auth paths, or trust boundaries were introduced; this remains pure offline data processing over already-committed files.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- **Ready for plan 01-06** (RECOVER-07/RECOVER-08, crack-independence and canonical designation): `recovery/PROVENANCE.md` exists with per-range verdicts, confidence, and agreeing-release counts; `countPatches` is wired and re-runnable (currently 0/0, an honest result); `validate --final`'s only remaining error is exactly the canonical designation 01-06 owns.
- **Not blocking, but worth a future live session's attention**: the DATASOFT/DIABOLO text divergence at $4771-$4779 is a genuine open question (is this text ever rendered? on what screen? does it indicate a differently-branded source release for saeger?) that a future session with live emulator access could resolve by disassembling the code path that reads this table.
- **Unchanged blocker, inherited from 01-04 and explicitly honored, not papered over**: 01-04's Task 3/4 (the full on-demand-load play-through coverage claim) remains incomplete — saeger 5/7 milestones, danish 0/7. `recovery/PROVENANCE.md`'s prose tier states this plainly and explains what would change if a future session finds a genuine on-demand-loaded region: this ledger would need to be regenerated once that supplementary dump exists. This plan does not resolve that blocker (it was not this plan's job to), and does not assert completeness it doesn't have.
- **Plan 01-06 explicitly did not run this session** (per the user's own authorization for this plan to proceed ahead of 01-04) and `recovery/clean/` was not written -- that remains 01-06's job.

## Self-Check: PASSED

- FOUND: tools/diff-images.mjs
- FOUND: tools/diff-images.test.mjs
- FOUND: recovery/PROVENANCE.md
- FOUND: recovery/danish/dumps/danish-gameentry-run1.map.json (classification_state: bucketed)
- FOUND: recovery/saeger/dumps/saeger-gameentry-run1.map.json (classification_state: bucketed)
- FOUND commit bc34af4
- FOUND commit 76ed51c
- FOUND commit 455b1dc

---
*Phase: 01-recovery-provenance*
*Completed: 2026-08-01*
