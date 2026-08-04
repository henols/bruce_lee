<!--
HAND-MAINTAINED project prose for recovery/PROVENANCE.md's prose tier.

This file is NOT generated. `c64-provenance-diff`'s `ledger` verb reads it and
appends it after the prose it derives from the registry, so project-specific
narrative lives here rather than inside a portable module. Placeholders the
renderer substitutes:

  {{gapTolerance}}  the --gap-tolerance value the ledger ran at

Everything else is yours to write. Moved out of `diff-images.mjs` verbatim on
2026-08-04, when the toolkit was made portable; the module used to hardcode all
of it, which meant no other project could use the tool without inheriting Bruce
Lee's evidence.
-->

### Decisions this ledger rests on

The offset is anchor-proven per release (**D-17**), never assumed. Per **D-01**, file offset equals
CPU address in every captured `.bin`; every read used `bank: "ram"`, so each image holds pure
underlying RAM across the whole $0000-$FFFF map, including the windows shadowed by ROM/I-O at
capture time. See each release's own `NOTES.md` §1-§3 for the full boot procedure.

The gap-coalescing tolerance of **{{gapTolerance}}** is **D-14** and is `CONTEXT.md`'s own worked
example, chosen because a relocated loader would otherwise produce thousands of per-byte rows that
bury the handful of single-byte patches this ledger exists to surface. Here the anchor-proven offset
is 0 for every release, so no such relocation inflation actually occurs, but the tolerance is
retained as the stated, justified choice regardless.

The five kinds are **D-02**'s. Per **D-05** the `.bin` files themselves are never edited or
zeroed -- classification lives in this ledger and in the manifests; the bytes stay verbatim
evidence.

### The two seeding rules, and the failure each one prevents

- **`loader`** is seeded from each release's own earned `loader_ranges` in the registry (live
  disassembly evidence from plan 01-04), never from `NOTES.md` prose. Reading a loader range out of
  prose is the documented root cause of a permanent joystick-poll instruction (`$08F5`) once being
  misclassified as loader code -- see `recovery/danish/NOTES.md` §1 and `recovery/saeger/NOTES.md`
  "Loader-range derivation".
- **`cracktro`** is seeded from printable-ASCII runs whose decoded text contains a recognised
  crack-credit vocabulary word, not from a bare "any printable run" scan. A bare scan was tried
  first and found a real false positive against these exact dumps: the game's own title-screen text
  ("DATASOFT PRESENTS" in danish / "DIABOLO  PRESENTS" in saeger, at $4771-$4779) is printable ASCII
  too, and a blind scan would have misclassified it as cracktro credit content. That divergence is
  itself genuine and previously undocumented -- logged in `.planning/RE-FINDINGS.md` and left
  `UNKNOWN` above, not asserted as a cracker patch. The signature vocabulary is drawn from both
  releases' own already-verified `tier1_evidence` in the registry.

### Coverage cross-reference to `recovery/LOADING.md`

**This ledger rests on an INCOMPLETE completeness claim, and that is stated plainly here rather than
left implicit.** `recovery/LOADING.md` (01-04's on-demand-load detection record) is not a finished
coverage claim: as of this writing, **saeger** reached 5 of 7 required Task 3 milestones
(title-screen and game-start-chamber1 durable from earlier attempts, plus death/game-over/restart
newly earned in attempt 4), and **danish** has not been attempted at all (0 of 7) across four
attempts, each halted by host VICE instability before danish's play-through could begin.

Concretely: if a future session's play-through finds a genuine **on-demand-loaded region** -- bytes
that only appear in RAM after reaching a specific room, chamber, or game state not yet visited --
that region is, by construction, **absent from the primary dumps this ledger diffs**, and every
verdict this ledger currently assigns to that region's addresses would need to be re-derived once
the supplementary dump exists. This ledger is regenerable specifically for that reason: a later,
more complete `recovery/LOADING.md` reopens this document, not just the loader-detection one.

Until then, treat every verdict above as scoped to "the addresses visible at the post-loader
game-entry point reached by both releases' `$08B1` triggers" -- not as a claim that no other
addresses exist in the running game.

### Direction-of-truth rule

This file is the ledger. `docs/provenance.md` will be a short pointer/summary for readers who land
in `docs/` first; inline `; PROVENANCE:` comments in `src/` will be the point-of-use copy. One
direction of truth only -- ledger to everything else -- and no downstream copy is ever edited
independently of this one (per `ARCHITECTURE.md`'s "Recording confidence and provenance" and
Anti-Pattern 5).

### Crack-independence verdict and confidence weighting

*Reserved for plan 01-06, which owns RECOVER-07 (the canonical-release designation).* Nothing about
crack-independence or a confidence weighting beyond "more independent agreeing releases raises
confidence" is asserted here before that plan's own evidence exists.
