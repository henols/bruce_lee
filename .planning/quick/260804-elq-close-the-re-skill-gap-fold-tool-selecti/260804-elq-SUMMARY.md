---
quick_id: 260804-elq
description: "Close the RE-skill gap: fold tool-selection into c64-program-recon, route game facts to the docs todos"
date: 2026-08-04
status: complete
---

# Summary

Item 4 of the skill queue, closed by **not** building the skill it asked for.

## The result

The RE skill this todo wanted was already built, incrementally, as four skills —
`c64-program-recon`, `c64-ram-capture`, `c64-memory-mapping` and
`c64-provenance-diff`. The todo dates from 2026-08-01, before any of them existed in
their current form. Mapping all ten of the log's sections against the skills that
now exist left exactly **one** genuinely unhomed, skill-shaped entry: the
question→`mcp__vice__*`-call table.

That is now `c64-program-recon/references/tool-selection.md`. The remaining "gap" was
an artifact of two misleading section titles.

## Why it looked like a 2788-line job

Both large sections are **dated dumping grounds**, not topics — content was appended
chronologically under whichever heading was current:

- **`## Tool-to-question mapping` (400 lines)** — only its *first* entry maps tools to
  questions. The rest is silent-stall incidents, broker `VICE_BROKER_MAX` defects,
  boot-time measurements, a saeger chamber-1 `FALLS` counter, and three diff hazards.
  Those three (the kind-boundary bug, the `$4771-$4779` `DATASOFT`/`DIABOLO`
  divergence, the cracktro-vocabulary fix) had already been folded into
  `c64-provenance-diff` earlier the same day in `b43d409`.
- **`## Manual and printed-documentation findings` (1151 lines, 41% of the log)** —
  genuine game-domain fact interleaved with unrelated engineering findings logged the
  same day: `python3-minimal`'s partial stdlib, a TDZ crash, `npm ci` in fresh
  worktrees, an async `finally` ordering bug.

## What changed

| Change | Detail |
|---|---|
| New reference | `c64-program-recon/references/tool-selection.md` — question→call table, delegation rows, two live traps |
| Two rows | Recon's References table gained `tool-selection.md`; its cross-skill table gained `c64-provenance-diff` |
| Two docs todos | Given the already-extracted manual facts plus three cautions, so neither re-reads the PDFs |
| RE-skill todo | Section-by-section mapping recorded; says plainly not to build a fifth skill |

## Judgement calls worth naming

**`Confidence: MEDIUM` was carried across unchanged.** The source entry is
doc-derived and graded MEDIUM. Moving it into a skill does not make it measured, and
CLAUDE.md forbids upgrading a grade in place. The reference file says so.

**`## Corrections to earlier entries` (465 lines) was left untouched.** Curating it
into a skill would destroy exactly what CLAUDE.md says the log is for — the record of
*when* something stopped being a guess. Promotion happens by re-logging with new
evidence.

**Re-topicalizing the log was rejected, not overlooked.** It was one of the three
options considered. It means editing the project's most carefully-guarded append-only
file for organisational benefit alone. Recorded as still-open instead of done.

**The game-domain facts were routed, not relocated.** Two `docs`-area todos already
own that content. Inventing a third home would have duplicated them.

## Verification

- All **seven** skills pass the frontmatter/trigger validator.
- All **six** reference files that `c64-program-recon` cites resolve, including the
  new one.
- No existing reference already carried a consolidated tool table — checked before
  writing: `graphics.md` has watch targets, `observation-hazards.md` has read
  hazards, neither maps question→call.
- Section line counts and the 117-entry total measured directly with `awk`/`grep`
  rather than estimated.

## Still open, deliberately

- **Misfiled engineering findings** — toolchain and GSD lessons sitting under a
  manual heading. Not skill material, not RE method; they need a home or an explicit
  decision to leave them.
- **`## Manual and printed-documentation findings` keeps growing** under a title that
  does not describe it. Worth renaming or splitting next time something lands there.

Both are recorded on the todo, which stays **pending** for them.
