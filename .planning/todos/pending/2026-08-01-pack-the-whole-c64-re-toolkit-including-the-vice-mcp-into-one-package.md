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
  - .claude/skills/c64-ram-capture/scripts/d64-parse.mjs
  - .claude/skills/c64-ram-capture/scripts/dump-artifacts.mjs
  - .claude/skills/c64-ram-capture/scripts/watch-loads.mjs
  - .claude/skills/c64-ram-capture/scripts/releases.mjs
  - .claude/skills/c64-ram-capture/scripts/project-paths.mjs
  - .claude/skills/c64-provenance-diff/scripts/recovery-schema.mjs
---

> **The decision this todo was created to force has been made** (2026-08-04) — see
> [[c64-toolkit-packaging-decisions]] in `.planning/notes/`. **One package**, an `npx` installer
> that copies into the consuming project, **both** topologies detected at runtime, Claude Code as
> the only v1 harness, and a sequence that leads with local-VICE mode. That note is the authority
> on the shape; this todo remains the place the three slices are held together, with its inventory
> corrected below.

## Problem

**Umbrella todo.** The goal stated by the developer on 2026-08-01: *everything needed to reverse
engineer a C64 program — emulator access included — installable as one package.* A new project
should be able to install it and immediately have a working `mcp__vice__*` tool surface, the RE
method, and the supporting pure-logic modules, without copying a single file by hand.

Today none of that is installable. Every piece is reachable only by copying it out of this
workspace, and copies drift.

**Correction (2026-08-04):** the original text said there was "no real `package.json` in the repo".
`.claude/package.json` is indeed the two-token `{"type":"commonjs"}` GSD CJS marker and not a
manifest — but `.claude/mcp/vice/package.json` **is** a real one (`name: vice-mcp`,
`private: true`, ESM, `test`/`typecheck`/`build` scripts, pinned `typescript` and `@types/node`).
The emulator layer has a build toolchain to promote, not one to author from nothing.

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

**Two layers, as of 2026-08-04 — this section originally described three.** The third (pure-logic
Node modules in `tools/`) has since dissolved into the second: `tools/` is now purely a generated,
gitignored deployment target for the broker's host-bound artifacts, and every authored module moved
into the skill that uses it. What remains is two layers with genuinely different distribution
mechanics, which was always the crux of the problem:

**1. Emulator access — the VICE MCP proxy.** Per the extraction todo: `.claude/mcp/vice/` is
~14,650 lines across 22 files, wired by relative path in `.mcp.json`, with ~212 tests as the
safety net. (Facts cited from that todo; `.claude/mcp/` is read-blocked by standing project rule,
so this file does not re-derive them.) Its known-hard parts — three host-side `.sh` resources that
must land on the **host**, outside the container the package installs into; the `repoRoot()` `.git`
walk that is only accidentally right under `node_modules/`; the `tools-manifest.json` snapshot that
ships empty on a fresh clone — all live in that todo and stay there.

**2. The method — skills, each now carrying its own code.** Markdown an agent reads plus the
pure-logic modules that skill drives, installed into the consuming project's `.claude/skills/`.
The eight skills present today split three ways:

| Skill | `scripts/` files | Ships? |
|---|---|---|
| `acme-build` | 1 | Yes — ACME assembly, entirely general |
| `c64-memory-mapping` | 1 | Yes — address resolution, entirely general |
| `c64-program-recon` | 1 (+ 6 references, 1 template) | Yes — the recon ordering, general |
| `c64-provenance-diff` | 3 (incl. `recovery-schema`, 1 test) | Yes — see the portability correction below |
| `c64-ram-capture` | 10 (incl. 3 tests, 1 template) | Yes — no longer "a procedure with no scripts" |
| `vice-wedge-triage` | 0 | Yes — VICE-operational, general |
| `skill-writer` | 0 | **No** — generic skill authoring, not a C64 capability |
| `find-skills` | 0 | **No** — third-party, carries its own `source.json` |

**Nothing in any of them is Bruce-Lee-specific — now verified rather than asserted.** A
case-insensitive grep for `bruce`, `danish`, `saeger` and `yamo` across `.claude/skills/` (`.md`,
`.mjs`, `.json`) returns **zero** files. That is the strongest single argument that a package is the
right container, and it means this layer is far closer to shippable than this todo originally
assumed.

Still true and unchanged: the RE-method skill from the third component todo **does not exist yet**,
and packaging it is strictly downstream of writing it.

**~~3. Pure logic — Node modules.~~ Layer dissolved — the modules moved into layer 2.** This todo
originally inventoried six modules in `tools/` and predicted which would be too project-specific to
ship. That prediction has been overtaken by work that landed in between:

| Module | Now lives in | Original prediction | Actual |
|---|---|---|---|
| `d64-parse.mjs` (+ test) | `c64-ram-capture/scripts/` | General | General — unchanged |
| `dump-artifacts.mjs` (+ test) | `c64-ram-capture/scripts/` | Likely general | General — unchanged |
| `watch-loads.mjs` (+ test) | `c64-ram-capture/scripts/` | Mixed | Ships with the skill |
| `releases.mjs` | `c64-ram-capture/scripts/` | **Project-specific** | **Wrong — now portable.** Resolves its registry through `project-paths.mjs`, overridable via `C64RE_DATA_DIR` / `C64RE_REGISTRY`, and documents that in its own header |
| `recovery-schema.mjs` | `c64-provenance-diff/scripts/` | **Project-specific by construction** | Re-assess. It travelled with its skill rather than staying behind, and the same override mechanism now applies |

Two consequences worth carrying forward. First, **the keep/cut question this todo hands to the
skills-audit todo has largely answered itself** — the modules were placed with their skills, and the
portability mechanism (project-root walk plus `C64RE_*` overrides) was built rather than deferred.
Second, the reason the migration worked is the reason it was predicted to be hard: these modules are
pure logic over data the agent fetched through `mcp__vice__*`, which is exactly the shape a
distributable module needs.

### The question this todo had to settle first — settled

**Is it one package or a family? → One package.** Decided 2026-08-04. The reasoning is in
[[c64-toolkit-packaging-decisions]] and is not restated here, but the short form is that the
delivery choice settles it rather than being independent of it: an installer that copies already
forces an install-state file, an update path and a migration story, and paying for three of those
plus a meta-package to coordinate them costs more than it buys with one consumer. Splitting later is
mechanical; merging three that each grew their own conventions is not.

The two-layer collapse above also removed most of the force from the original argument — "ordinary
importable ESM" is no longer a separate install target, because those modules now travel inside the
skills that drive them.

**The three component todos can therefore proceed against a fixed shape**, which is what this todo
existed to give them.

Related, and still open:

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
- **Host-side install is the real risk — and it grew a second half.** Everything else is ordinary
  Node packaging. Deploying host-bound resources from a package installed inside a container has no
  analogue in this repo and probably determines the package's shape. The developer has since
  required that the toolkit work **with and without a devcontainer**, so there is now a second
  topology — VICE in the same box, no container boundary, `container-guard` inverted from a refusal
  into a detector — which the broker does not support at all today. That is the genuinely novel
  piece, it is decided to be resolved at *runtime* rather than at install time (a project moves
  between topologies), and it leads the sequence.
- **Dogfood or it isn't done.** This project consumes the result back, replacing its vendored tree
  with the dependency. That is what proves the coupling was removed rather than relocated.

## Solution

Revised 2026-08-04. Step 1 of the original order is **done** — the decision is recorded in
[[c64-toolkit-packaging-decisions]]. What remains, still front-loading the piece most likely to
invalidate an assumed package shape:

1. ~~Decide one-package vs family~~ — **done.** One package, `npx` installer that copies, both
   topologies detected at runtime, Claude Code only for v1 with placement separated from payload.
2. **Build local-VICE (no-container) mode**, including inverting `container-guard` into a topology
   detector, and design the host-resource deploy path for the container topology alongside it.
   Together these are the only genuinely novel work; everything after is ordinary Node packaging.
3. **Run the emulator layer to completion** via the extraction todo — it is unblocked (the
   `.claude/skills/` imports went away on 2026-08-01, `e0f9915`), and its test suite is the safety
   net for everything after. Re-count that suite against `.claude/mcp/vice/**` before quoting a
   number; the old "212 tests across `.claude/mcp/vice/**` and `tools/**`" figure spans a directory
   that no longer holds tracked code.
4. ~~Settle the `tools/` keep/cut question~~ — **largely self-answered.** The modules moved into
   their skills and gained `C64RE_*` overrides. What is left is a narrow re-assessment of
   `recovery-schema.mjs`, which was predicted to stay behind and did not.
5. **Write the RE-method skill** before deciding whether to ship it — an unwritten skill cannot be
   assessed against the keep/cut bar. Unchanged.
6. **Consume the result back in this project** as the first customer. Unchanged, and still the only
   thing that proves the coupling was removed rather than relocated.
