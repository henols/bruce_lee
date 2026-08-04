---
name: c64-provenance-diff
description: Decide whether a byte in a cracked C64 release is original game code or something a cracker changed, by diffing two or more independently-cracked releases at an anchor-proven offset. Use when asked to diff two releases or disk images, work out which bytes the cracker patched, tell loader or cracktro code from game code, prove a byte is original, establish provenance or confidence for a memory range, regenerate the provenance ledger, or run anchor-search, count-patches or diff-images.
---

# Deciding what a cracker changed

**A byte that differs between two releases is not a cracker patch.** It is a byte
that differs. This pipeline exists because the gap between those two statements is
where confident nonsense gets manufactured — `tools/diff-images.mjs`'s own header
calls it "the step most able to produce confident nonsense". Every stage below
either proves its own precondition or refuses to emit.

**Run the four verbs in order.** `diff` is meaningless without a proven offset, and
`ledger` will not write a verdict the earlier stages did not earn.

```bash
D=tools/diff-images.mjs                      # from the repo root

node $D anchor-search                        # 1. prove the per-release offset  [WRITES]
node $D diff                                 # 2. N-way byte diff at that offset
node $D count-patches                        # 3. CRACKER-PATCH addresses in game code
node $D ledger                                # 4. regenerate recovery/PROVENANCE.md [WRITES]

node $D diff --json                          # machine-readable, with per-range reasons
node $D diff --gap-tolerance 16              # coalescing width (default shown)
node $D anchor-search --reference danish     # pick the reference release
node tools/releases.mjs list                 # the release ids in play
```

Pure Node over committed files — the `.bin` dumps, their `.map.json` manifests, and
`recovery/RELEASES.json`. It contacts nothing.

## The order

| # | Verb | Proves | Refuses to |
|---|---|---|---|
| 1 | `anchor-search` | A single global offset per release, from long distinctive byte runs located with `Buffer.indexOf` | Accept a **majority** vote — every usable anchor must agree, or there is no offset |
| 2 | `diff` | Which ranges differ, coalesced on verdict continuity | Diff at an assumed offset |
| 3 | `count-patches` | How many addresses are `CRACKER-PATCH` **and** `game`-kind | Count a patch outside game code |
| 4 | `ledger` | The generated tier of `recovery/PROVENANCE.md` | Emit rather than launder an assumption |

## Two verbs write to tracked files

`anchor-search` updates `recovery/RELEASES.json`; `ledger` rewrites
`recovery/PROVENANCE.md` and touches `RELEASES.json` too. So `git status` is
**expected** to be dirty after a run.

What matters is *what* changed. A clean re-run produces a **timestamp-only** diff —
`proven_at` and `generated_at`. Anything else is a real change:

```bash
git diff -- recovery/RELEASES.json recovery/PROVENANCE.md
```

If the only `-`/`+` pairs are those two fields, revert the churn and move on. If
`offset`, `anchor_count`, `anchors_agreeing` or `generated_tier_sha256` moved, stop
and find out why before committing — that is the pipeline telling you the evidence
changed.

## Worked example — the real corpus

Two independently-cracked releases, `danish` and `saeger`, both captured at the
post-loader game-entry trigger:

```
$ node $D anchor-search
danish -> saeger: ok=true offset=0 (all 7 usable anchor(s) agree on offset 0)

$ node $D diff
diff: 204 range(s), gap_tolerance=16, coalesced=260

$ node $D count-patches
danish: 0
saeger: 0
```

**204 differing ranges and zero cracker patches.** The verdict tally from
`diff --json` is `{"UNKNOWN": 102, "ORIGINAL": 102}` — nothing reached
`CRACKER-PATCH` at all. That is the pipeline working, not failing.

Read it as: 102 ranges are identical across two independently-cracked releases, so
they are `ORIGINAL` with real evidence behind the word. The other 102 differ, match
no cracker signature, and are therefore `UNKNOWN` — and each carries a `reason`
naming the alternatives it ruled out:

> differs across 2 release(s) (danish, saeger) with no recognised cracker
> signature … not a revision difference … not a `.d64` read error … not a packer
> artifact … not relocation (the anchor-proven offset for this pair is recorded
> above and used here).

`UNKNOWN` with a rule-out list is the honest answer. Do not upgrade it to
`CRACKER-PATCH` because a byte differs. **Confidence: HIGH** — run live against the
committed corpus; `ledger` reproduced the committed
`generated_tier_sha256 dde5db52…` byte-identically, so the classification is
deterministic.

## The five kinds and the three verdicts

`bucketManifest` promotes a manifest from `ranges-only` to `bucketed`, assigning
`game` / `loader` / `cracktro` / `io` / `unused`. Verdicts are `ORIGINAL`,
`CRACKER-PATCH`, `UNKNOWN`, carrying `HIGH` or `MEDIUM-HIGH` confidence.

The two seeds are where this goes wrong, and both failure modes are on record:

- **`loader` is seeded from `RELEASES.json`'s earned `loader_ranges`** — live
  disassembly evidence — **never from `NOTES.md` prose.** Reading a loader range
  out of prose is the documented root cause of `$08F5`, a permanent joystick-poll
  instruction, once being classified as loader code.
- **`cracktro` is seeded from a crack-credit *vocabulary* scan**, not a bare
  printable-ASCII scan. A bare scan was tried and produced a real false positive
  against these dumps: the game's own title text (`DATASOFT PRESENTS` in danish,
  `DIABOLO  PRESENTS` in saeger, at `$4771-$4779`) is printable too. That
  divergence is genuine and is correctly left `UNKNOWN` — not asserted as cracker
  credit.

`io` (`$D000-$DFFF`) and `unused` (contiguous `$00`/`$FF` power-on runs) are
assigned at capture time and kept verbatim. Everything the trace reaches is `game`.

Per D-05 the `.bin` files are **never** edited or zeroed. Classification lives in
the manifests; the bytes stay verbatim evidence.

## Before you trust a verdict

- **Coverage is incomplete, and the ledger says so out loud.**
  `recovery/LOADING.md` has **saeger at 5 of 7** required milestones and **danish
  at 0 of 7**, every attempt halted by host VICE instability. An on-demand-loaded
  region — bytes that only appear after reaching a room or state nobody visited —
  is by construction **absent from the primary dumps this diffs**. Every verdict is
  scoped to "the addresses visible at the post-loader game-entry point", not to the
  whole running game. This is exactly why the ledger is regenerable: a more
  complete `LOADING.md` reopens it.
- **Never resolve a range's `kind` from its `start` address.** Coalescing groups on
  *verdict* continuity, not *kind* continuity, so one range can span several kind
  zones. `splitRangeByManifestKind` exists for this, and the bug was found live:
  danish's `$033C-$4770` `ORIGINAL` range runs straight through its own
  `$0340-$035E` `loader` sub-range. Resolving from `start` silently mislabels every
  address after the first boundary.
- **`--gap-tolerance` is off-by-one sensitive by design.** A gap of identical bytes
  *strictly shorter* than N coalesces; a run of *exactly* N stays its own row.
- **More agreeing independent releases is the only thing that raises confidence.**
  Two releases can establish `ORIGINAL`; they cannot establish intent.

## Which skill does what

This one answers "is this byte original?". It does not capture images or read
addresses.

| Need | Go to |
|---|---|
| A verified 64K image, or proving two captures equivalent | `c64-ram-capture` |
| Which address to read next, and what the answer rules out | `c64-program-recon` |
| What a specific address or bit means | `c64-memory-mapping` — `node … lookup '$D018'` |
| Assembling, or a first-pass dead listing | `acme-build` |
| **Whether a byte is original, cracker-changed, or unknown** | here |

Findings that make RE faster go in `.planning/RE-FINDINGS.md` **at the moment you
find them**, graded with `Evidence:` and `Confidence:`. Promote by re-logging with
the new evidence, never by editing a grade in place. File-changing work enters
through a GSD command (`/gsd-quick`).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `anchor-search` reports `ok=false` | Anchors disagreed, so there is no single offset. Do **not** pick the majority — the images are not the same fully-loaded state, or one capture is bad. Re-capture rather than force it. |
| `git status` dirty after a run | Expected — two verbs write. Diff the two files; if only `proven_at`/`generated_at` moved, `git checkout --` them. |
| `generated_tier_sha256` changed | The classification changed, not just a timestamp. Find the cause before committing; the digest is the determinism check. |
| `count-patches` reports 0 | Usually correct. It counts `CRACKER-PATCH` **and** `game`-kind addresses; with two releases and no signature match, nothing qualifies. Check the `diff --json` tally before treating it as a bug. |
| Everything is `UNKNOWN` | Also usually correct. `UNKNOWN` means "differs, no recognised signature, alternatives ruled out". Read the range's `reason` field. |
| A range's `kind` looks wrong past its start | You resolved `kind` from `start`. Use `splitRangeByManifestKind`; coalescing does not respect kind boundaries. |
| A loader range disagrees with `NOTES.md` | `RELEASES.json`'s `loader_ranges` wins — it is earned from disassembly. Prose is how `$08F5` got misclassified. |
| Title-screen text shows up as cracktro | You used a bare printable-run scan. The vocabulary scan exists because `$4771-$4779` is the game's own text. |
| `unknown release "x" -- known releases: …` | `node tools/releases.mjs list` for the valid ids. |
