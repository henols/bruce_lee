---
created: 2026-08-03T19:30:00.000Z
title: "`gsd-tools phase remove` on a decimal phase renumbers siblings but silently skips three-level children — on this roadmap it would rename a completed phase and orphan its three sub-phases"
area: tooling
severity: major
files:
  - .claude/gsd-core/bin/lib/phase.cjs
  - .planning/ROADMAP.md
---

## Context

Found while executing `/gsd-phase` to retire Phases 01.5 and 01.7 after
`/gsd-discuss-phase 01.6.2` absorbed both into 01.6.2. The removal was **not** run — the hazard was
caught by reading the implementation first. Both phases were retired by editing their sections into
`ABSORBED` stubs instead, which is why the roadmap is currently intact.

## The defect

`cmdPhaseRemove` (`.claude/gsd-core/bin/lib/phase.cjs`) dispatches a decimal target to
`renameDecimalPhases(phasesDir, baseInt, removedDecimal)` (line 959). That function's directory
pattern is:

```js
const decPattern = new RegExp(`^(0*${baseInt})\\.(\\d+)-(.+)$`);
```

The `-` immediately after `(\d+)` means the pattern matches **two-level** decimals only. A
three-level phase directory such as `01.6.1-container-side-conversion-to-typescript` has `.` where
the pattern requires `-`, so it does not match and is skipped entirely — while its two-level sibling
`01.6-broker-in-node-and-tcp-control-plane` matches and *is* renamed.

### What `phase remove 01.5` would have done to this repo

Directories present under `.planning/phases/`:

| Directory | Matches pattern? | Outcome |
|---|---|---|
| `01.3-wedge-detection-and-recovery` | yes, `oldDecimal=3` | skipped (not `> 5`) — correct |
| `01.6-broker-in-node-and-tcp-control-plane` | yes, `oldDecimal=6` | **renamed to `01.5-…`** |
| `01.6.1-container-side-conversion-to-typescript` | **no** | left untouched |
| `01.6.2-the-one-process-host-broker` | **no** | left untouched |
| `01.6.3-mastra-mcp-adoption` | **no** | left untouched |

Result on disk: `01.5-broker-in-node-and-tcp-control-plane` sitting beside `01.6.1`, `01.6.2` and
`01.6.3` — three sub-phases orphaned from a parent number that no longer exists — plus ROADMAP.md
rewritten to decrement every phase token above `1.5`.

## Two aggravating factors

1. **The executed-plans guard does not cover the renamed directories.** `cmdPhaseRemove` checks for
   `*-SUMMARY.md` only in the *target* directory before requiring `--force`. `01.6` is a **completed
   phase with summaries and commits referencing its number**, and it would have been renumbered with
   no guard firing at all.

2. **`validate_future_phase` in `workflows/remove-phase.md` is wrong for non-numeric execution
   orders.** It requires `target > current phase`. This roadmap's v1.1 execution order is
   deliberately not numeric, so `01.5` is genuinely unstarted future work while sorting *below* the
   current phase `01.6.1`. The gate would have rejected a legitimate removal for the wrong reason —
   masking, rather than catching, the corruption above.

Separately: `gsd-tools query roadmap analyze` returns `phases: []` against this ROADMAP.md even
though `roadmap get-phase 01.6.2` resolves correctly. The analyze parser does not see these phase
sections, so any workflow branching on its output (edit-phase's `disk_status` check among them)
silently degrades.

## Suggested fix

- Make `renameDecimalPhases`' pattern handle arbitrary depth, or make it **refuse** rather than
  silently skip when a deeper child of the renumbering range exists.
- Extend the summary/`--force` guard to every directory the operation would *rename*, not just the
  one it deletes.
- Replace `validate_future_phase`'s numeric comparison with a check against the roadmap's declared
  execution order when one is present.
- Investigate why `roadmap analyze` returns zero phases here.

## Workaround in use

Retire a phase by editing its section into an `ABSORBED`/`SUPERSEDED` stub with a disposition table
instead of removing it. This turned out to be better than deletion on its own merits — it preserves
every cross-reference in commits, SUMMARYs and notes, and satisfies this project's own D-03 rule
that a reversed locked decision be recorded where a later reader meets the old one.
