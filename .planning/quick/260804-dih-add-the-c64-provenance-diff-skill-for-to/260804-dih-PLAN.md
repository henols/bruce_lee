---
quick_id: 260804-dih
description: Add the c64-provenance-diff skill for tools/diff-images.mjs
date: 2026-08-04
status: planned
execution_note: |
  Executed inline (no subagents — session directives prohibit spawning them
  unless the user asks). GSD guarantees preserved: PLAN.md, atomic commit,
  SUMMARY.md, STATE.md row.
---

# Add `c64-provenance-diff`

Item 3 of the four-item skill queue. Item 4 (the RE skill) stays held for the
user's return.

## Why this one earns a skill

Settled in quick task `260804-brt-b` by applying the reusable-as-skills todo's own
criteria: `tools/diff-images.mjs` is imported by nothing, is agent-invoked, and its
pipeline has **ordering that fails closed**. Its own header calls it "the step most
able to produce confident nonsense". Before `260804-brt`, no skill referenced any
`tools/` script at all, so this pipeline is currently undiscoverable.

## Verified live before writing (all output real)

| Verb | Real output |
|---|---|
| `anchor-search` | `danish -> saeger: ok=true offset=0 (all 7 usable anchor(s) agree on offset 0)` |
| `diff` | `diff: 204 range(s), gap_tolerance=16, coalesced=260` |
| `count-patches` | `danish: 0` / `saeger: 0` |
| `ledger` | `wrote recovery/PROVENANCE.md (generated tier sha256 dde5db52…)` |
| `diff --json` verdict tally | `{"UNKNOWN":102,"ORIGINAL":102}` — **zero CRACKER-PATCH** |

`diff --json` top-level keys: `ranges, kept, coalesced, gapTolerance, imageIds`.
Range keys: `start, end, verdict, agreeing_releases, evidence, reason`.

**Determinism confirmed:** re-running `ledger` reproduced the committed
`generated_tier_sha256` `dde5db52d2dad4aa8aba5fa84e0d1739c459475076d14770c039285f0eebd0ec`
byte-identically.

## Hazards to carry into the skill

Each is documented in the source as live-found, not theorised:

1. **`anchor-search` and `ledger` write tracked files** (`recovery/RELEASES.json`,
   `recovery/PROVENANCE.md`). Re-running yields a **timestamp-only** diff
   (`proven_at`, `generated_at`); a *content* change is the signal to investigate.
   Discovered by running them during this task and reverting the churn.
2. **`loader` ranges come from `RELEASES.json`'s earned `loader_ranges`, never from
   `NOTES.md` prose.** Reading a loader range out of prose is the documented root
   cause of `$08F5` — a permanent joystick-poll instruction — once being
   misclassified as loader code.
3. **`cracktro` uses a crack-credit vocabulary scan, not a bare printable-run
   scan.** A bare scan false-positived on the game's own title text
   (`DATASOFT PRESENTS` / `DIABOLO  PRESENTS` at `$4771-$4779`) — itself a genuine
   divergence, correctly left `UNKNOWN` rather than asserted as a patch.
4. **`kind` must be resolved by splitting a range against manifest boundaries, not
   read off its `start`.** Coalescing groups on *verdict* continuity, not *kind*
   continuity. Found live: danish's `$033C-$4770` ORIGINAL range runs straight
   through its own `$0340-$035E` loader sub-range.
5. **`proveOffset` refuses a majority vote** — every anchor must agree.
6. **gap-tolerance semantics:** a gap *strictly shorter* than N coalesces; exactly
   N stays a separate row.
7. **Coverage is incomplete and the ledger says so.** `recovery/LOADING.md` has
   saeger at 5/7 milestones and danish at **0/7**. An on-demand-loaded region is by
   construction absent from the primary dumps, so every verdict is scoped to the
   post-loader game-entry point. This is why the ledger is regenerable.
8. **`.bin` files are never edited or zeroed** (D-05) — classification lives in
   manifests; bytes stay verbatim evidence.
9. **`count-patches: 0` is a result, not a failure.** It counts addresses whose
   verdict is `CRACKER-PATCH` *and* whose manifest kind is `game`. With two
   releases and no signature match, nothing reaches that verdict.

## Tasks

### Task 1 — Write the skill

- **files**: `.claude/skills/c64-provenance-diff/SKILL.md`
- **action**: Follow the house shape the other four converged on
  (`c64-program-recon` is the reference): bold lead directive, cwd-anchored
  commands-first block with a `D=` variable, a boundary line, `## The order`
  table, a worked example with real output and a confidence grade, the hazards
  above, `## Which skill does what`, and a `Symptom | Fix` table.
- **verify**: Every command shown has been run; every cited path exists.
- **done**: The skill exists and names the four verbs in their mandatory order.

### Task 2 — Register it

- **files**: `.claude/CLAUDE.md`
- **action**: Add **one row** to the Project Skills table, in alphabetical order
  (between `c64-program-recon` and `c64-ram-capture`). **By hand.** Do not run
  `gsd-tools generate-claude-md` — `skill-writer` records that it regressed the
  `mcp__vice__*` single-route constraint, deleted the headless constraint, and
  reverted the `.d64` decision, at 62 insertions/36 deletions for a one-row change.
- **verify**: `git diff .claude/CLAUDE.md` touches only the skills block.
- **done**: Row present; nothing else in CLAUDE.md changed.

### Task 3 — Cross-reference and close the queue item

- **files**: `.claude/skills/c64-ram-capture/SKILL.md`,
  `.planning/todos/pending/2026-08-01-investigate-whether-the-surviving-tooling-is-reusable-as-skills.md`
- **action**: `c64-ram-capture` already tells the reader a fresh manifest is
  `ranges-only` until "the provenance diff" bucketizes it, without saying where
  that lives — point it at the new skill. Then mark the todo's open item 1 done.
- **done**: The reference resolves; the todo reflects reality.

## must_haves

- **truths**: every shown command was run; the refuse-to-launder behaviour
  (`UNKNOWN` over `CRACKER-PATCH`) is the skill's central point; the incomplete
  coverage caveat is stated, not buried.
- **artifacts**: new SKILL.md, one CLAUDE.md row, two cross-references.
- **key_links**: `tools/diff-images.mjs`, `recovery/PROVENANCE.md`,
  `recovery/LOADING.md`, `recovery/RELEASES.json`.

## Out of scope

- Running the pipeline to *change* `recovery/` state. Exploratory runs were
  reverted; the skill documents the write behaviour instead of exercising it.
- The RE skill (item 4, held).
- `tools/diff-images.mjs` itself — no code changes.
