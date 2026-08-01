---
created: 2026-08-01T12:20:00.000Z
title: Absorb the ram-capture and host-path skills into the VICE MCP, then delete both
area: tooling
severity: minor
files:
  - .claude/skills/c64-ram-capture/
  - .claude/skills/devcontainer-host-path/
  - .claude/mcp/vice/vice-proxy.mjs:23,31
  - .claude/mcp/vice/vice-mcp-selector-docs.test.mjs:214-282
  - tools/recover.mjs:39
---

## Problem

Two skills hold code the VICE MCP already depends on, so they are skills in name only:

| Skill | Files | Lines | What it actually is |
|---|---|---|---|
| `c64-ram-capture` | 5 | 1,101 | `ram-capture.mjs` (465) + `ram-compare.mjs` (81) + tests + a 117-line SKILL.md |
| `devcontainer-host-path` | 4 | 710 | `hostpath.mjs` (231) + `containerpath.mjs` (233) + tests + a 57-line SKILL.md |

**The MCP entrypoint reaches across the tree into both.** `vice-proxy.mjs:23,31` imports
`hostPath`/`SET_ENV_HINT` from `../../skills/devcontainer-host-path/scripts/hostpath.mjs` and
`containerizeRecord` from the sibling `containerpath.mjs`. `vice-sync.mjs:47` and
`install-resources.mjs:26` do the same. Going the other way, `tools/recover.mjs:39` imports
`ram-capture.mjs` out of the skill tree.

This is the same collapse already argued for `vice-mcp-selector` in
[[collapse-vice-selector-skill-into-proxy]] — a skill that exists as a wrapper around code the
system loads directly — but applied to the two skills that carry *implementation* rather than
prose.

### The two removals are coupled, not independent

`ram-capture.mjs` is itself one of the pinned `hostpath.mjs` consumers, so moving it changes the
closure that guards the other skill. `vice-mcp-selector-docs.test.mjs:269` asserts the consumer set
is **exactly five** production modules, each with a recorded reason in `HOSTPATH_ALLOW_LIST`:

| Consumer | Recorded reason |
|---|---|
| `install-resources.mjs` | prints a host path for a human to type; never hands a path to VICE |
| `vice-sync.mjs` | `screenshot()`, reachable only through the standalone `tools/recover.mjs` pipeline |
| **`ram-capture.mjs`** | `attachAndStart()`, same `tools/recover.mjs` pipeline ← **in the skill being removed** |
| `vice-proxy.mjs` | owns translation for the MCP-mediated path |
| `containerpath.mjs` | the inverse seam beside `hostpath.mjs`, added by quick task 260801-ccn |

That assertion is **not** bureaucracy — it is the structural guard against a caller hand-translating
a host path instead of going through the proxy's translation seam. Amend `HOSTPATH_ALLOW_LIST` as
part of the move; do not delete the test to make the move compile.

### What is genuinely load-bearing vs. what is wrapper

`devcontainer-host-path`'s SKILL.md is 57 lines of usage prose around code that four production
modules import directly — the clearest wrapper of the two, and the one with no domain knowledge to
rescue.

`c64-ram-capture` is different and needs care. Its SKILL.md has eight sections
(`Capturing at a trigger address`, `Comparing two captures for reproducibility`, `Voiding a run`,
`Building a machine baseline`, `Copying this skill elsewhere`, …) and some of it encodes **hard-won
project findings, not usage**: RAM drift between live runs, the drift-prone floor, and how a run is
voided. STATE.md's Blockers/Concerns records the underlying measurements at length (continuous
drift, the Hamming-1 discriminator, the rejected block-fill heuristic). Moving the *scripts* into
the MCP is mechanical; deciding where that *knowledge* lives is not, and it is the same keep/cut
question [[collapse-vice-selector-skill-into-proxy]] § 2.5 poses. Do not let the knowledge evaporate
because the file it lived in was deleted.

### Interactions with other pending todos

- **[[2026-08-01-extract-the-vice-mcp-into-an-installable-package]]** — this **answers that todo's
  open question** ("does `devcontainer-host-path` travel with the package, stay a peer, or get
  absorbed?"). The answer is *absorbed*. It is also effectively a **prerequisite**: a published
  package cannot import from `.claude/skills/` in the consuming project. Recorded `minor` per triage,
  but sequence it before the extraction regardless.
- **[[collapse-vice-selector-skill-into-proxy]]** — sibling, same mechanism. Both must edit
  CLAUDE.md's Project Skills table and the `:250` assertion that pins it. Doing them together is
  cheaper than twice; doing them apart risks the second one tripping the first's assertion.
- **[[move-drift-classification-into-ram-compare]]** — its target, `ram-compare.mjs`, **lives inside
  `c64-ram-capture`**. If the skill dissolves, that todo's file moves with it. Settle where
  `ram-compare.mjs` lands (MCP? `tools/`?) before, or as part of, resolving that one.

## Solution

TBD. Constraints and known obstacles, in the order they bite:

- Decide destinations first. `hostpath.mjs`/`containerpath.mjs` clearly belong beside the proxy that
  imports them. `ram-capture.mjs` is less obvious — it serves the standalone `tools/recover.mjs`
  pipeline (which criterion 8 preserves), so "inside the vice MCP" may be right for `attachAndStart()`
  but wrong for `ram-compare.mjs`. Do not assume both halves land in the same place.
- Amend `HOSTPATH_ALLOW_LIST` and its "exactly five production modules" assertion to the new paths,
  keeping every recorded reason. The guard must survive the move.
- Update the cross-tree importers: `vice-proxy.mjs:23,31`, `vice-sync.mjs:47`,
  `install-resources.mjs:26`, `tools/recover.mjs:39`, plus `vice-proxy.test.mjs:41` and the path
  literals inside `vice-mcp-selector-docs.test.mjs`'s own fixtures.
- Rescue `c64-ram-capture`'s domain knowledge before deleting its SKILL.md — drift, voiding a run,
  baseline building. Some may already be fully carried by STATE.md's Blockers/Concerns; check rather
  than assume, and give the rest a home.
- Retire `c64-ram-capture/scripts/skill-docs.test.mjs` (74 lines) with the skill it guards, the same
  way [[collapse-vice-selector-skill-into-proxy]] retires its own gate.
- Update CLAUDE.md: the Project Skills table rows for both skills, **and** the Constraints line at
  `:16` which names `devcontainer-host-path` as the mandatory route for host paths. That line states
  a real rule — reword it to point at the absorbing module rather than deleting the rule.
- `tools/README.md` names `c64-ram-capture` at `:137` and `:453`.
