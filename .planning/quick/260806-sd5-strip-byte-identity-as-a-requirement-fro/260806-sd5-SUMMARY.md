---
phase: quick-260806-sd5
plan: 01
subsystem: planning-artifacts
tags: [requirements, roadmap, behavioural-verification]
dependency-graph:
  requires: []
  provides: [PLANNING-BEHAVIOURAL-GATE-ONLY]
  affects: [".planning/REQUIREMENTS.md", ".planning/ROADMAP.md"]
tech-stack:
  added: []
  patterns: ["checkpoint-replay-as-sole-correctness-gate"]
key-files:
  created: []
  modified:
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
decisions:
  - "Byte-identity removed as a requirement, gate, promotion bar, standing principle, or definition-of-done everywhere in these two files, per the developer's second ruling: 'this is the rule and it must be followed no matter what.' Behaviour -- checkpoint replay against the baselines -- is the sole gate at every level."
metrics:
  duration: "~25 min"
  completed: 2026-08-06
status: complete
---

# Quick Task 260806-sd5: Strip byte-identity as a requirement Summary

Removed every requirement, gate, promotion bar, standing principle, and definition-of-done that
used byte comparison as its mechanism from `.planning/REQUIREMENTS.md` and `.planning/ROADMAP.md`,
replacing each with the equivalent behavioural claim (checkpoint replay against the baselines,
using the existing VERIFY-01..07 vocabulary). No byte-identity language survives except as an
explicit exclusion (the widened Out-of-Scope row) and a small set of tolerated survivors that
carry the vocabulary in an unrelated sense (completed dump-procedure records, MCP round trips,
the v3.0 asset-pipeline feature name, a wedge diagnostic, TS build property, bash/JS regex parity).

## What Changed

**`.planning/REQUIREMENTS.md`** (4 sites):
- v2.0 milestone row: `formats proven by round-trip` -> `formats proven by replaying their
  re-serialised output`
- `BUILD-02`: rewritten to gate promotion on checkpoint replay against the baselines rather than
  a round-trip byte diff, keeping the ACME zero-page-to-absolute addressing-drift worry that
  motivates it
- `DATA-06`: rewritten to validate a format spec by feeding its re-serialised output back into the
  build and replaying the scenarios that exercise it, rather than requiring the re-serialisation to
  reproduce the original bytes exactly
- Out-of-Scope row: the hedge sentence that preserved byte comparison "as a development-time check"
  and "as a structural invariant on reorganisation commits" is deleted entirely; the row title
  widened from "as the acceptance gate" to "at any stage and in any role"

**`.planning/ROADMAP.md`** (16 sites): the standing principle (L19), the v2.0 milestone row (L33),
the Phase 6 one-liner (L130), and 13 phase-level sites across Phases 4, 6, and 7 (success criteria,
plan bullets, and Risks/Pitfalls clauses). Three of these were found by grep at plan time, beyond
the task brief's original enumeration:

- **L1275** — Phase 4 Risks, Pitfall 3, which asserted the round-trip diff was the *only* check
  that catches an illegal opcode misdecoded upstream
- **L1311** — the Phase 6 Goal line, which closed with "proven correct by round-trip rather than
  merely plausible"
- **L1335** — Phase 6 Risks, the "Looks done but isn't" clause, which said a format spec is not
  validated until re-serialisation reproduces the original bytes

All three are gate claims and all three fell under the ruling; they are stripped exactly like the
16 the brief named.

Two force/ordering clauses survive verbatim because they are correct independent of mechanism:
`Non-optional, every region, every phase from 4 onward` (the standing principle) and `the gate must
exist before any region is promoted from blob to source` (plan 04-02). `--strict-segments` survives
everywhere on its own merits — it is an assembly-time segment-overlap check, not a byte comparison.

## The Four Rewritten Judgement-Call Paragraphs (verbatim, for read-back)

**ROADMAP L19 — the standing principle:**

> **Checkpoint replay is the transcription gate** | A region is not "transcribed" until replaying
> the scenarios that exercise it diverges nowhere against the baselines. Behaviour is the only
> gate -- no byte comparison against the canonical image gates anything. Non-optional, every
> region, every phase from 4 onward.

**ROADMAP Phase 4 success criterion 2:**

> The per-region promotion gate is wired into the build as a checkpoint replay against the Phase 3
> baselines, and no transcribed region diverges; a deliberately introduced zero-page-vs-absolute
> drift in one instruction makes the replay fail and the divergence report names which checkpoint
> and which memory region moved.

**ROADMAP Phase 7 Risks, Pitfall 6:**

> **Pitfall 6** — the split is exactly where branch-out-of-range and silent segment overlap
> appear; `--strict-segments` catches the overlap at assembly time and a branch out of ±127 range
> fails the assembly outright, so both are mechanical without any byte comparison. A
> pure-reorganisation commit that diverges under replay has changed behaviour, and the divergence
> report says which checkpoint and which region.

**REQUIREMENTS Out-of-Scope row:**

> Byte-identical rebuild, at any stage and in any role | Would forbid restructuring source for
> readability, which conflicts directly with the "base to build on" driver. Behaviour is the only
> gate -- checkpoint replay against the baselines decides whether a region, a format spec, or the
> whole rebuild is correct (BUILD-02, DATA-06, VERIFY-05, VERIFY-07). No byte comparison is a gate,
> a promotion bar, or a definition of done anywhere in this project.

No hedge language (`where practical`, `as a sanity check`, `still useful as`, `optional`, `may
also`, `for development`) was reintroduced anywhere in either file.

## Tolerated Survivors (deliberately left untouched)

Per the plan's allowlist — these carry byte-identity vocabulary in a sense unrelated to rebuild
correctness, or are already-recorded `[x]` COMPLETE evidence of what was actually proven, and
rewriting them would falsify the record:

- **ROADMAP L145, L164** — Phase 01-01, `[x]` COMPLETE, dump-procedure reproducibility against the
  ORIGINAL
- **ROADMAP L1241** — Pitfall 7, harness self-validation before the rebuild exists
- **ROADMAP L259, L263, L273, L276** — MCP request-response round trips
- **ROADMAP L333** — wedge-diagnostic register snapshot
- **ROADMAP L612** — committed-equals-deployed TS build property
- **ROADMAP L620** — bash/JS regex parity test
- **ROADMAP L34 / REQUIREMENTS L15, L104, L114, L123, L128** — the v3.0 `Round-Trip Assets`
  editable-asset feature naming (`ASSET-01..04`, `EXT-02`)
- **REQUIREMENTS RECOVER-05** (L33) — `[x]` COMPLETE, byte-level diff *between the two cracked
  releases*, which is provenance work, not rebuild correctness

## Verification

Ran the plan's Task 1, Task 2, and Task 3 (whole-file sweep) gates exactly as written. All three
passed:

- `TASK1 PASS` — REQUIREMENTS.md: all replacement anchors present, no hedge survives, both
  requirement IDs intact, 44-row traceability table unchanged, RECOVER-05 and the v3.0 asset
  naming undamaged
- `TASK2 PASS` — ROADMAP.md: all 11 replacement anchors present, no byte-gate vocabulary survives,
  all 7 protected survivor signatures present, all 4 requirement IDs resolve
- `SWEEP PASS` — cross-file sweep asserting the exact allowed-survivor set by content in both
  directions, no hedge phrase, both IDs, 44 traceability rows, `.claude/` untouched

`git diff --stat` against the pre-edit base commit confirms exactly two files changed:
`.planning/REQUIREMENTS.md` (8 lines changed across 4 edits) and `.planning/ROADMAP.md` (32 lines
changed across 16 edits). `.claude/` has zero diff.

## Deviations from Plan

None — plan executed exactly as written, including the three grep-discovered sites the plan itself
flagged as beyond the brief's original enumeration.

## Known Stubs

None. This is a documentation-only edit to two planning artifacts; no code, no data flow, nothing
that could stub.

## Self-Check: PASSED

- `.planning/REQUIREMENTS.md` — FOUND, modified as described
- `.planning/ROADMAP.md` — FOUND, modified as described
- Commit `c6630e6` (REQUIREMENTS.md) — FOUND in `git log`
- Commit `fac7e93` (ROADMAP.md) — FOUND in `git log`
- `.claude/` — confirmed zero diff via `git status --porcelain -- .claude/`
