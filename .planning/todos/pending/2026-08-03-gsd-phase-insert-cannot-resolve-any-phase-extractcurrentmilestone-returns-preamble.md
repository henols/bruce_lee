---
created: 2026-08-03T21:05:00.000Z
title: "`gsd-tools phase insert|add|remove` cannot resolve ANY phase in this ROADMAP — `extractCurrentMilestone` returns only the preamble, because milestones are `### ` under `## Phases` rather than `## `"
area: tooling
severity: major
files:
  - .claude/gsd-core/bin/lib/phase.cjs
  - .claude/gsd-core/bin/lib/roadmap-parser.cjs
  - .planning/ROADMAP.md
related:
  - .planning/todos/pending/2026-08-03-gsd-phase-remove-corrupts-three-level-decimal-phases.md
---

## Context

Found while executing `/gsd-plan-phase 01.6.2`. The planner returned `## PHASE SPLIT RECOMMENDED`;
the developer chose the split, so plan-phase step 9b called for `/gsd-phase --insert` to create the
sub-phase. It cannot run. **Nothing was written** — the command errors before its first
`platformEnsureDir`, so the tree stayed clean and the failure cost only diagnosis time.

This is very likely the same root cause as the *"Separately:"* paragraph at the end of the
`phase remove` todo above — `roadmap analyze` returning `phases: []` against a ROADMAP where
`roadmap get-phase` resolves fine.

## The defect

`cmdPhaseInsert` (`phase.cjs:839`) resolves the anchor phase against a **milestone-scoped** window,
not the whole file:

```js
const content = extractCurrentMilestone(rawContent, cwd);
const targetPattern = new RegExp(`#{2,4}\\s*Phase\\s+${afterPhaseEscaped}${OPTIONAL_PHASE_TAG_SOURCE}:`, 'i');
const headingMatch = targetPattern.test(content);
```

Measured directly against this repo's `.planning/ROADMAP.md` (177,992 chars):

| Probe | Result |
|---|---|
| `extractCurrentMilestone(raw, cwd)` length | **10,301** chars — the file's first 10 KB |
| Window content | `# Roadmap` → `## Overview` → `## Standing Constraints` → `## Milestones`, ending at `## Phases` |
| `### Phase …` headings inside window | **0** |
| `- [ ] **Phase …` bullets inside window | **0** |
| `headingMatch` | false |
| `bulletPattern.test(content)` | false |
| → `isBulletStyle` | false → `error("Phase 01.6.2 not found in ROADMAP.md")` |

The regex helpers are **not** at fault — `phaseMarkdownRegexSource('01.6.2')` yields `0*1\.6\.2`,
which matches both `### Phase 01.6.2: The One-Process Host Broker` and the summary bullet when
tested against the raw file. Only the window is wrong. (This distinguishes it from the sibling
`phase remove` defect, which *is* a regex-depth bug.)

### Why the window is wrong here

This ROADMAP nests milestones one level deeper than the parser expects:

```
## Milestones                     <- extractCurrentMilestone appears to anchor here
## Phases
### Milestone v1.1 — …  (active)  <- the real milestone sections, with the phase bullets
### Milestone v1.0 — …
### Milestone v2.0 — …
## Phase Details
### Phase 01.3: …                 <- the detail sections, ~340 lines further down
### Phase 01.6.2: …
```

Two structural facts each defeat the lookup independently:

1. Milestone sections are `### `, under a `## Phases` parent — so the extractor cuts at `## Phases`
   and returns the preamble.
2. Even with the right milestone window, the `### Phase N:` **detail** sections live under a separate
   `## Phase Details` heading, outside any milestone window. So `headingMatch` can only ever succeed
   if the extractor falls through to the whole file.

Affects all four `extractCurrentMilestone` call sites in `phase.cjs`: **281, 659, 760, 839** —
i.e. `phase add`, `phase add-batch`, `phase insert`, `phase remove` all share it.

## Suggested fix

- Recognise `### Milestone …` nested under `## Phases`, not only top-level `## Milestone …`.
- Resolve the phase **anchor** against the whole file (or against `## Phase Details`) and use the
  milestone window only to decide *where the new summary bullet goes*. Anchor resolution and
  insertion point are two different questions being answered by one window.
- Fail loud when the milestone window contains zero phase headings **and** zero phase bullets — that
  is never a legitimate state for a roadmap with phases, and it is exactly the condition that
  produced a misleading "Phase not found" for a phase that is plainly present.
- Re-check `roadmap analyze`'s `phases: []` against the same hypothesis; one fix may close both.

## Workaround in use

Hand-author the ROADMAP amendment (summary bullet + `### Phase N.M:` detail section under
`## Phase Details`) and `mkdir` the phase directory, then run `/gsd-plan-phase <new>` normally.
`query roadmap.get-phase`, `query init.plan-phase` and `query phase next-decimal` all resolve
three- and four-level phase numbers correctly, so **only the CRUD write path is affected** — every
read path used by plan-phase, discuss-phase and execute-phase works.

Confirmed working on four-level numbers before relying on it:
`phase next-decimal 01.6.2` → `{ "found": true, "base_phase": "01.6.2", "next": "01.6.2.1" }`.
