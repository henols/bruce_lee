---
created: 2026-08-01T12:20:00.000Z
updated: 2026-08-01T15:20:00.000Z
title: Absorb the host-path skill into the VICE MCP, then delete it
area: tooling
severity: minor
blocked_by: "Read(.claude/mcp/**) deny rule in .claude/settings.local.json"
files:
  - .claude/skills/devcontainer-host-path/
  - .claude/mcp/vice/vice-proxy.mjs:23,31
  - .claude/mcp/vice/vice-sync.mjs:47
  - .claude/mcp/vice/install-resources.mjs:26
  - .claude/mcp/vice/vice-proxy.test.mjs:41
  - .claude/mcp/vice/vice-mcp-selector-docs.test.mjs:214-282
---

## Problem

`devcontainer-host-path` is a skill in name only: 57 lines of usage prose wrapped around
`hostpath.mjs` (231) and `containerpath.mjs` (233), which the VICE MCP imports directly as
production code. It should live beside the proxy that depends on it, and the skill should go.

**`c64-ram-capture` is explicitly OUT of scope for this todo** (decision 2026-08-01). It is
kept as a skill. Its scripts were deleted separately in `db9eed3` because they reached the
emulator as a library, which the MCP-only rule forbids; what survives is a single SKILL.md of
imperative `mcp__vice__*` steps. Its domain knowledge — volatile ranges, single-bit drift vs
multi-bit divergence, epoch-bracketing, teardown by enumeration — was carried into that
SKILL.md rather than lost. Nothing further to do there.

### What has already happened since this todo was filed

Three of the five pinned `hostpath.mjs` consumers no longer exist:

| Consumer | Recorded reason | Status |
|---|---|---|
| `install-resources.mjs` | prints a host path for a human to type; never hands a path to VICE | still live |
| `vice-sync.mjs` | `screenshot()`, reachable only through the standalone `tools/recover.mjs` pipeline | still live, but its stated reason is now stale — that pipeline is gone |
| `ram-capture.mjs` | `attachAndStart()`, same `tools/recover.mjs` pipeline | **deleted** (`db9eed3`) |
| `vice-proxy.mjs` | owns translation for the MCP-mediated path | still live |
| `containerpath.mjs` | the inverse seam beside `hostpath.mjs` | still live, moves with the skill |

`tools/recover.mjs` (the importer at `:39`) and `tools/README.md` are also deleted
(`d963c5b`, `096ac26`). So the "exactly five production modules" assertion in
`vice-mcp-selector-docs.test.mjs:269` is already wrong by one and will be wrong again after
the move.

That assertion is **not** bureaucracy — it is the structural guard against a caller
hand-translating a host path instead of going through the proxy's translation seam. Amend
`HOSTPATH_ALLOW_LIST` and the count as part of the move; do not delete the test to make the
move compile.

### Why this is blocked

`.claude/settings.local.json` denies `Read(.claude/mcp/**)`, so the import sites cannot be
read, let alone repointed. Verbal authorisation was given on 2026-08-01 but the deny rule is
still in force and takes precedence. Lift the rule, or hand the move to someone who can read
that tree.

### Interactions with other pending todos

- **[[2026-08-01-extract-the-vice-mcp-into-an-installable-package]]** — this **answers that
  todo's open question** ("does `devcontainer-host-path` travel with the package, stay a peer,
  or get absorbed?"). The answer is *absorbed*, and it is a **prerequisite**: a published
  package cannot import from `.claude/skills/` in the consuming project.
- **[[collapse-vice-selector-skill-into-proxy]]** — largely overtaken by events; the
  `vice-mcp-selector` skill was deleted outright in `db9eed3`. What remains of that todo is
  the test and CLAUDE.md fallout, which overlaps this one.
- **[[move-drift-classification-into-ram-compare]]** — its target `ram-compare.mjs` was
  deleted with the other skill scripts. That todo needs rewriting or closing on its own terms.

## Solution

TBD. In the order the obstacles bite:

1. Lift the `Read(.claude/mcp/**)` deny rule, or reassign the task.
2. Move `hostpath.mjs` and `containerpath.mjs` into `.claude/mcp/vice/`. They belong beside
   the proxy that imports them; there is no longer any consumer outside that tree.
3. Repoint the importers: `vice-proxy.mjs:23,31`, `vice-sync.mjs:47`,
   `install-resources.mjs:26`, `vice-proxy.test.mjs:41`, and the path literals inside
   `vice-mcp-selector-docs.test.mjs`'s own fixtures.
4. Amend `HOSTPATH_ALLOW_LIST` to the new paths and correct the count, keeping every recorded
   reason. Refresh `vice-sync.mjs`'s reason — it cites a pipeline that no longer exists.
5. Delete `.claude/skills/devcontainer-host-path/` and its row in CLAUDE.md's Project Skills
   table. The Constraints line that used to name it as the mandatory host-path route was
   already reworded to state the MCP-only rule instead (2026-08-01), so nothing is needed
   there.
6. Verify the vice MCP server still starts — these are static top-level imports, so a missed
   one stops `mcp__vice__*` from existing at all.
