---
created: 2026-08-01T19:58:00.000Z
title: Pack the whole C64 RE toolkit, including the VICE MCP proxy, into one installable package
area: tooling
severity: major
files:
  - .mcp.json
  - .claude/skills/acme-build/SKILL.md
  - .claude/skills/c64-memory-mapping/SKILL.md
  - .claude/skills/c64-ram-capture/SKILL.md
  - tools/d64-parse.mjs
  - tools/dump-artifacts.mjs
  - tools/watch-loads.mjs
  - tools/recovery-schema.mjs
  - tools/releases.mjs
---

## Problem

**Umbrella todo.** The goal stated by the developer on 2026-08-01: *everything needed to reverse
engineer a C64 program — emulator access included — installable as one package.* A new project
should be able to install it and immediately have a working `mcp__vice__*` tool surface, the RE
method, and the supporting pure-logic modules, without copying a single file by hand.

Today none of that is installable. There is no real `package.json` in the repo (`.claude/package.json`
is a two-token `{"type":"commonjs"}` marker for the GSD CJS shim, not a manifest). Every piece is
reachable only by copying it out of this workspace, and copies drift.

Three pending todos each own one slice of this question and none owns the whole:

| Todo | Slice it owns | Severity |
|---|---|---|
| [[2026-08-01-extract-the-vice-mcp-into-an-installable-package]] | The emulator-access layer, and every hard blocker in it | major |
| [[2026-08-01-investigate-whether-the-surviving-tooling-is-reusable-as-skills]] | Which of `tools/` is a capability vs this project's plumbing | minor |
| [[2026-08-01-collect-c64-reverse-engineering-findings-into-a-fast-re-skill]] | The RE method that doesn't exist as a skill yet | minor |

This todo exists to hold the shape they answer *into*. It should not restate their contents —
each is the authority on its own slice, and the MCP-extraction one in particular carries the
detailed blocker analysis that must not be duplicated or it will fork.

### What a complete RE kit would contain

Three layers with genuinely different distribution mechanics, which is the crux of the problem:

**1. Emulator access — the VICE MCP proxy.** Per the extraction todo: `.claude/mcp/vice/` is
~14,650 lines across 22 files, wired by relative path in `.mcp.json`, with ~212 tests as the
safety net. (Facts cited from that todo; `.claude/mcp/` is read-blocked by standing project rule,
so this file does not re-derive them.) Its known-hard parts — three host-side `.sh` resources that
must land on the **host**, outside the container the package installs into; the `repoRoot()` `.git`
walk that is only accidentally right under `node_modules/`; the `tools-manifest.json` snapshot that
ships empty on a fresh clone — all live in that todo and stay there.

**2. The method — skills.** Markdown an agent reads, installed into the consuming project's
`.claude/skills/`. Candidates:
- `c64-memory-mapping` (142 lines) — address resolution, entirely general
- `acme-build` (163 lines) — ACME assembly, entirely general
- `c64-ram-capture` (93 lines) — capture procedure, general, and already reduced to a procedure
  performed through `mcp__vice__*` with no scripts
- The RE-method skill from the third todo above — **does not exist yet.** Packaging it is strictly
  downstream of writing it.

All four are general-purpose; nothing in them is Bruce-Lee-specific. That is the strongest single
argument that a package is the right container.

**3. Pure logic — Node modules.** `tools/` currently holds 2,268 lines across six modules and
three test files:

| Module | Lines | General or project-specific? |
|---|---|---|
| `d64-parse.mjs` (+ test) | 243 + 229 | **General** — works on any 1541 image |
| `dump-artifacts.mjs` (+ test) | 316 + 136 | Likely general — assembles a 64K image from agent-serialised chunks, derives chip-state and range manifests |
| `watch-loads.mjs` (+ test) | 567 + 314 | Mixed — sentinel resolution and hit attribution are general; the loader-classification policy is this project's |
| `recovery-schema.mjs` | 356 | **Project-specific by construction** — the invariants *are* this project's |
| `releases.mjs` | 107 | **Project-specific** — the `RELEASES.json` data model |

Note this inventory is larger than the skills-audit todo describes: it was written when `tools/`
held four files, before plan 01-04 Task 1 added `watch-loads.mjs` and `dump-artifacts.mjs`. Those
two are the interesting new cases, because they were written *after* the MCP-only rule and are
therefore already shaped as pure logic over agent-fetched data — which is exactly the shape a
distributable module needs.

### The question this todo has to settle first

**Is it one package or a family?** The three layers install to different places by different
mechanisms — an MCP server entry in `.mcp.json`, markdown into `.claude/skills/`, and ordinary
importable ESM. Forcing them into one artifact may be worse than a small family with one
meta-package that pulls the others in. Deciding this early matters, because the answer changes
whether the three component todos can proceed independently or must converge.

Related, and not yet answered anywhere:

- **Sequencing is already partly fixed.** The extraction todo records that
  `.claude/skills/` imports from the MCP tree were the hard blocker, and that they were removed on
  2026-08-01 (`e0f9915`) — the host-path skill was absorbed and deleted. So the emulator layer is
  unblocked *now*, and it is the layer with the most unknowns. It should lead.
- **The skills layer has a bar to clear.** Three skills were deleted on 2026-08-01 for being
  narration, for hiding code from a standing rule, and for being a module wearing a skill's clothes.
  A package that ships skills inherits that bar — shipping a weak skill to N projects is worse than
  keeping it in one.
- **The MCP-only rule travels with the package.** `mcp__vice__*` as the sole route to the emulator
  is what keeps the design honest. A distributed package must make that rule structural for
  consumers rather than a convention they read about, or the first consumer under deadline will
  reinvent the direct-connection bypass this project has already discarded twice.
- **Host-side install is the real risk.** Everything else is ordinary Node packaging. Deploying
  shell resources onto a host from a package installed inside a container has no analogue in this
  repo and probably determines the package's shape. Design it first.
- **Dogfood or it isn't done.** This project consumes the result back, replacing its vendored tree
  with the dependency. That is what proves the coupling was removed rather than relocated.

## Solution

TBD. Suggested order — deliberately front-loads the decision that constrains everything else:

1. **Decide one-package vs family**, with the three install mechanics on the table. Write the
   decision down before any code moves; it is the thing the three component todos need in order to
   proceed without contradicting each other.
2. **Design the host-resource deploy path**, since it is the only genuinely novel piece and most
   likely to invalidate an assumed package shape.
3. **Run the emulator layer to completion** via the extraction todo — it leads, it is unblocked,
   and its 212 tests are the safety net for everything after.
4. **Settle the `tools/` keep/cut question** via the skills-audit todo, refreshed against the
   current six-module inventory rather than the four it was written for. Expect
   `recovery-schema.mjs` and `releases.mjs` to stay behind.
5. **Write the RE-method skill** before deciding whether to ship it — an unwritten skill cannot be
   assessed against the keep/cut bar.
6. **Consume the result back in this project** as the first customer.
