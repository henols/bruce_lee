---
created: 2026-08-02T12:28:55.104Z
title: Strip cracktro and cruncher code from the RE scope — a rule for the RE skill
area: tooling
severity: minor
files:
  - .planning/todos/pending/2026-08-01-collect-c64-reverse-engineering-findings-into-a-fast-re-skill.md
  - .planning/RE-FINDINGS.md
  - .planning/phases/01-recovery-provenance/01-05-SUMMARY.md
  - recovery/RELEASES.json
---

## Problem

The only artifacts this project has are cracked releases. Every 64K image captured from them
carries three kinds of byte that are **not the game**:

- **cracktro** — the crack group's intro screen, banner, scroller, credits, and the keypress
  gate that dismisses it (danish: "Danish Crackers Presents BRUCE LEE", release id `DC-011/P`)
- **cruncher / depacker** — the decompression stub that unpacks the payload and is dead the
  moment it has run (danish's `TCS-CRUNCH!` signature, undocumented anywhere)
- **loader** — the custom raw-sector routine that bypasses KERNAL

None of it is Datasoft's code. None of it belongs in the ACME reconstruction, and none of it
should consume RE effort as though it were a gameplay system. The rule to encode: **if a byte
has nothing to do with the actual game, it is removed — always, not case by case.**

This is not a new capability. Plan 01-05 already built the machinery: `tools/diff-images.mjs`
buckets ranges into `loader` / `cracktro` / `game`, seeding `loader` from `RELEASES.json`'s
`loader_ranges` and `cracktro` from a crack-credit-vocabulary-filtered printable scan. What
is missing is the **standing rule that consumes those buckets** — a documented default that
says non-game buckets are excluded from the rebuild and from annotation effort, rather than
each session re-deciding.

### Why it matters enough to write down

Two live findings already show the boundary is easy to get wrong in *both* directions:

- **Over-attribution.** A bare printable-ASCII scan classified the game's own title text as
  cracktro credit content and would have shipped a confidently-wrong `CRACKER-PATCH` verdict
  into the ledger (`.planning/RE-FINDINGS.md`, 2026-08-01). Removing too eagerly deletes the
  game.
- **Under-attribution.** The `DATASOFT PRESENTS` / `DIABOLO  PRESENTS` divergence at
  `$4771-$4779` sits in a region that is *neither* loader nor cracktro — a cracker edit inside
  the game's own data. Removing only the obvious intro screen leaves crack residue behind.

So the rule needs a stated evidence bar, not just an instruction to delete. That bar is the
project's existing confidence vocabulary: a range is removed as non-game when its bucket
assignment is evidenced, and left in place (recorded `UNKNOWN`) when it is not.

### Where the rule belongs

Primarily the RE skill —
[[2026-08-01-collect-c64-reverse-engineering-findings-into-a-fast-re-skill]] — as a scope step
near the front of the decision procedure, *before* the entry-point → vectors → main-loop chain.
Tracing an IRQ handler that belongs to the depacker is wasted work, and the current procedure
does not tell the reader to check.

It is also general-purpose, not Bruce-Lee-specific: every cracked C64 release has this layer.
That strengthens the case for shipping it in the RE package
([[2026-08-01-pack-the-whole-c64-re-toolkit-including-the-vice-mcp-into-one-package]]).

## Solution

1. **Write the rule as an RE-skill procedure step**, placed before control-flow discovery:
   identify and bucket the non-game layer first, then trace only what survives. State the
   three kinds explicitly (cracktro / cruncher / loader) so the reader is not left inferring
   the taxonomy.

2. **State the evidence bar, both directions.** Removal requires positive evidence of the
   bucket (vocabulary match, `RELEASES.json` `loader_ranges`, a depacker stub that is dead
   after first run). Absence of evidence records `UNKNOWN` and keeps the bytes — the
   `$4771` case is the worked example of why, and the printable-scan false positive is the
   worked example of the opposite failure.

3. **Point at the existing machinery rather than restating it.** `tools/diff-images.mjs`'s
   bucketing and `recovery/RELEASES.json` already do the mechanical part; the skill supplies
   the ordering and the judgement, per the keep/cut criterion in the RE-skill todo (no
   narration of a tool surface the agent already holds).

4. **Confirm the rebuild-side consequence is recorded** where the rebuild scope is defined:
   the `.d64` this project produces boots via a real, valid directory and carries no crack
   loader, no intro, no cruncher. `.claude/CLAUDE.md` § Stack Patterns already says the
   original's *faked* directory scheme is explicitly out of scope — check whether that
   statement is broad enough to cover the whole non-game layer, and widen it if not rather
   than adding a second overlapping rule.

5. **Log it in `.planning/RE-FINDINGS.md`** at discovery grade if the sweep has not already
   captured it, so the rule survives this todo moving to `completed/`.

## Status 2026-08-04 (quick task 260804-eu6) — steps 1-3 landed. Step 4 needs a human.

The rule is now `c64-program-recon`'s **step 0**, ahead of the entry-point → vectors → main-loop
chain, exactly where this todo placed it: a row in the order table (*"Which of these bytes are even
the game?"*) plus a `## Step 0 in full: only the game is in scope` section.

What it says, and why each part is there:

- **The three layers named explicitly** — loader, cruncher/depacker, cracktro — with what each is
  and when it goes dead, so the reader is not left inferring the taxonomy (step 1).
- **The rule as a standing default:** a byte with nothing to do with the game is out of scope
  *always, not case by case* — not annotated, not reconstructed, not traced.
- **The evidence bar in both directions** (step 2), with both recorded failures as the worked
  examples: the printable-ASCII scan that classified the game's own title text as cracktro credit,
  and the `$4771-$4779` `DATASOFT`/`DIABOLO` divergence sitting in a region that is neither loader
  nor cracktro. Absence of evidence records `UNKNOWN` and keeps the bytes.
- **Cites the machinery, does not restate it** (step 3). `c64-provenance-diff` owns the five kinds
  and the bucketing; what step 0 adds is the *ordering* — bucket first, trace only what survives.

A closely related rule fell out of the same session's vector work and is now in
`control-flow.md`: a non-default vector in a block whose ROM is banked out is **residue, not a
hook**. Same failure shape as the printable-ASCII false positive — over-attribution to the cracker
— and it was caught only because the first draft of the widened sweep shouted
`CRACKER-HOOK SITES DIVERTED` at danish's `$0328` and was wrong.

### Step 4 is NOT done, and should not be done silently

Step 4 asks whether `.claude/CLAUDE.md` § Stack Patterns' faked-directory statement is broad enough
to cover the whole non-game layer, and to widen it if not. **It is not broad enough** — it addresses
only the original's faked *directory scheme*, not the cracktro, the cruncher or the loader, and the
rebuild-side consequence (the produced `.d64` boots via a real valid directory and carries no crack
loader, no intro, no cruncher) is stated nowhere in that file.

It was left alone because § Stack Patterns sits **inside a GSD-managed block**
(`<!-- GSD:stack-start -->`), and the generator that owns it is known to regress this file's
hand-refined constraints — measured 2026-08-04, 62 insertions / 36 deletions for a one-row change,
including deleting the headless-container constraint outright
([[2026-08-04-generate-claude-md-regresses-hand-refined-constraints]]). Hand-editing a managed block
is a decision about this repo's own conventions, not a doc fix, so it belongs to the user.

**The rule itself is not lost in the meantime:** it is in the skill and logged in RE-FINDINGS.md.
What is missing is the rebuild-scope statement in CLAUDE.md, which is a different claim in a
different place.
