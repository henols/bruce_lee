---
quick_id: 260804-dih
description: Add the c64-provenance-diff skill for tools/diff-images.mjs
date: 2026-08-04
status: complete
---

# Summary

`.claude/skills/c64-provenance-diff/` now exists and is registered. Item 3 of the
four-item skill queue is done; item 4 (the RE skill) remains held for the user.

This closes the last open build item on
`2026-08-01-investigate-whether-the-surviving-tooling-is-reusable-as-skills` —
the todo that identified `diff-images.mjs` as the one module in `tools/` earning a
skill of its own.

## What the skill teaches

The central point is a refusal, not a capability: **a byte that differs between two
releases is not a cracker patch.** Run live against the committed corpus, the
pipeline reports **204 differing ranges and zero cracker patches** — a verdict tally
of `{"UNKNOWN": 102, "ORIGINAL": 102}`. Each `UNKNOWN` carries a `reason` naming
what it ruled out (revision difference, `.d64` read error, packer artifact,
relocation). That is the module's own answer to being "the step most able to produce
confident nonsense", and it is what the skill is built around.

Also documented: the mandatory four-verb order, the five kinds, the three verdicts,
and `proveOffset` refusing a majority vote.

## Verified live before writing — all shown output is real

| Verb | Output |
|---|---|
| `anchor-search` | `danish -> saeger: ok=true offset=0 (all 7 usable anchor(s) agree on offset 0)` |
| `diff` | `diff: 204 range(s), gap_tolerance=16, coalesced=260` |
| `count-patches` | `danish: 0` / `saeger: 0` |
| `ledger` | `wrote recovery/PROVENANCE.md (generated tier sha256 dde5db52…)` |

`diff --json` keys confirmed directly: `ranges, kept, coalesced, gapTolerance,
imageIds`; per-range `start, end, verdict, agreeing_releases, evidence, reason`.

**Determinism confirmed:** `ledger` reproduced the committed
`generated_tier_sha256 dde5db52d2dad4aa8aba5fa84e0d1739c459475076d14770c039285f0eebd0ec`
byte-identically.

## Hazard found by running it, not by reading it

**`anchor-search` and `ledger` write to tracked files** — `recovery/RELEASES.json`
and `recovery/PROVENANCE.md`. The module's header does not say so, and neither did
any doc. My exploratory runs left both modified; the diff was **timestamp-only**
(`proven_at`, `generated_at`), with `offset`, `anchor_count`, `anchors_agreeing` and
`generated_tier_sha256` all unchanged. Reverted with `git checkout --`.

The skill now states this as a section of its own, with the rule: a timestamp-only
diff is expected and revertible; a change to any substantive field means the
evidence moved and must be understood before committing.

## Hazards carried in from the source

All four are documented there as live-found, and all four are stated in the skill:

- `loader` ranges come from `RELEASES.json`'s earned `loader_ranges`, **never**
  `NOTES.md` prose — prose is the documented cause of `$08F5`, a permanent
  joystick-poll instruction, once being classified as loader code.
- `cracktro` uses a crack-credit **vocabulary** scan, not a bare printable-run scan.
  A bare scan false-positived on the game's own title text (`DATASOFT PRESENTS` /
  `DIABOLO  PRESENTS` at `$4771-$4779`), itself a genuine divergence left `UNKNOWN`.
- `kind` must be resolved by splitting against manifest boundaries, never read off a
  range's `start` — coalescing groups on *verdict* continuity, not *kind*. Found
  live: danish's `$033C-$4770` `ORIGINAL` range runs through its own `$0340-$035E`
  `loader` sub-range.
- **Coverage is incomplete**: `recovery/LOADING.md` has saeger at 5/7 and danish at
  **0/7**. An on-demand-loaded region is by construction absent from the dumps being
  diffed, so every verdict is scoped to the post-loader game-entry point. Given a
  prominent section, not a footnote.

## Registration

One row added to CLAUDE.md's Project Skills table **by hand**, alphabetically
between `c64-program-recon` and `c64-ram-capture`. `gsd-tools generate-claude-md`
was **not** run — `skill-writer` records that it regressed the `mcp__vice__*`
single-route constraint, deleted the headless-container constraint, and reverted the
settled `.d64` decision, at 62 insertions/36 deletions for a one-row change.

`git diff --stat -- .claude/CLAUDE.md` → **1 file changed, 1 insertion(+)**.

## Cross-references

`c64-ram-capture` twice said a manifest becomes `"bucketed"` "only after the
provenance diff" without saying where that lived. Both now point at
`c64-provenance-diff`, and its cross-skill table gained a row.

## Verification

- All **seven** skills pass the frontmatter/trigger validator.
- Every path the new skill cites resolves.
- Every command shown was run in this container.
- CLAUDE.md names none of the four retired routes (`grep -c` = 0 for each),
  which is the exact invariant `vice-mcp-selector-docs.test.ts` asserts with
  `assert.ok(!text.includes(retired), …)`.

**Not run:** the `.claude/mcp/vice/` test suite itself. Those tests are `.ts` now
and need a build step, which is MCP maintenance rather than verification of this
change. The grep above checks the one assertion this edit could plausibly break,
directly.

## Boundaries respected

No emulator contact — the pipeline is pure Node over committed files.
`tools/diff-images.mjs` was **not** modified. `recovery/` state was left exactly as
committed: the exploratory writes were reverted, so the skill documents the write
behaviour rather than having changed the ledger.

## Next

Item 4, the RE skill from `.planning/RE-FINDINGS.md` (now 2788 lines across 9+
sections), is held for the user's return. It needs a scope decision before it is
worth starting — it is not a quick-task-sized job.
