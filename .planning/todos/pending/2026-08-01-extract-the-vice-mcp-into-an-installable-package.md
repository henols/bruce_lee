---
created: 2026-08-01T12:05:00.000Z
title: Extract the VICE MCP into its own project and publish it as an installable package
area: tooling
severity: major
files:
  - .claude/mcp/vice/vice-proxy.ts
  - .claude/mcp/vice/repo-root.ts
  - .claude/mcp/vice/install-resources.ts
  - .claude/mcp/vice/hostpath.ts
  - .claude/mcp/vice/package.json
  - .mcp.json
---

> **Distribution decisions are settled** as of 2026-08-04 — see
> [[c64-toolkit-packaging-decisions]] (`.planning/notes/`). One package, an `npx` installer that
> copies into the consuming project, both topologies detected at runtime, Claude Code as the only
> v1 harness. This todo stays the authority on the *blocker analysis* below; the note is the
> authority on the shape being built toward. **This layer leads the sequence** (step 2, after
> local-VICE mode).

## Problem

The VICE MCP server is **vendored source**, not a dependency. `.claude/mcp/vice/` is ~14,650 lines
across 22 files — proxy, broker client, pool, session, probe, sync, the three host-side shell
resources, a 1,231-line tools manifest, and ~6,300 lines of tests. `.mcp.json` wires it by relative
path:

```json
{ "mcpServers": { "vice": { "command": "node", "args": [".claude/mcp/vice/vice-proxy.ts"], "timeout": 60000 } } }
```

**Correction (2026-08-04):** the original text of this todo said there was "no `package.json`
anywhere in the repo", and named the entry points as `.mjs`. Both are now stale. The authored
sources are `.ts`/`.mts`, and `.claude/mcp/vice/package.json` is a real manifest — `name:
vice-mcp`, `private: true`, ESM, with `test` / `typecheck` / `build` scripts and pinned
`typescript` + `@types/node` devDependencies. **There is a build toolchain here to extract, not one
to invent.** The reuse blocker itself is unchanged: the only way for another project to drive VICE
is still to copy the tree in.

Copies drift: a deny-list, lease
protocol, or path-translation fix landing in one copy silently does not reach the others. The
`vice_disk_list` deny-list is the sharpest example — it crashes the host MCP server and is enforced
at three independent layers off one `DENY_LIST` definition, which is exactly the kind of guarantee
that must not fork.

This pairs with [[2026-08-01-make-the-broker-cross-project-via-shared-home-dir-state]] but is a
different axis, and both are needed for either to pay off:

| | That todo | This todo |
|---|---|---|
| Moves | runtime **state** out of the workspace (`~/.vice-broker/`) | **code** out of the workspace (a published package) |
| Solves | one broker serving N projects | N projects installing rather than vendoring |

Shared state without shared code means N drifting implementations agreeing on a protocol by luck.
Shared code without shared state means N brokers racing — the CR-01 hazard, multiplied.

### What makes this non-trivial

The extraction is not a straight `git mv`; the code is coupled to being *inside* the consuming
repo in four specific ways worth knowing before scoping:

1. **`repo-root.mjs` resolves the workspace by walking for a `.git` ancestor** from its own file
   location, with `CONTAINER_WORKSPACE_PATH` as the primary source and a realpath comparison to
   confirm the file sits inside it. Installed into `node_modules/`, the walk still finds a `.git` —
   the consuming project's — which is probably right, but it is currently *accidentally* right. The
   contract needs restating deliberately for the installed case, including a package inside a
   monorepo or a pnpm store outside the project tree.
2. **`vice-proxy.mjs` derives `HERE_DIR` from `import.meta.url`** and the host-side shell resources
   are shipped under `resources/`, deployed to `tools/` by `install-resources.mjs`. A package needs
   a real install/deploy story for those three `.sh` files — they must land on the **host**, which is
   outside the container the package is installed in. That is the genuinely awkward part.
3. **The host-path translation seam has a deliberately closed consumer set.** `hostpath.mjs` from
   the `devcontainer-host-path` skill has exactly **five** production consumers, enumerated with a
   recorded reason each in `HOSTPATH_ALLOW_LIST` and pinned by
   `vice-mcp-selector-docs.test.mjs:269` ("exactly the traced five production modules"). Worse for
   packaging: `vice-proxy.mjs:23,31` — the MCP entrypoint itself — imports from
   `../../skills/devcontainer-host-path/scripts/`, so **a published package cannot import from
   `.claude/skills/` in the consuming project**. This is a hard blocker, not a boundary question.
   **Resolved by [[2026-08-01-absorb-the-ram-capture-and-host-path-skills-into-the-vice-mcp]]**: the
   skill gets absorbed, and that todo should be sequenced before this one.
4. **The container guard is load-bearing.** `container-guard.sh` makes the host scripts refuse to
   run inside a devcontainer (exit 2, by design). A distributed package has to keep that refusal
   correct across environments it was never tested in.

### Consumption shape — mostly decided 2026-08-04

The end state as originally written here was "gets working `mcp__vice__*` tools **without copying
source**". **That is no longer the goal.** The developer chose an installer that *does* copy into
the consuming project (mastra/GSD-style), with an install-state file recording path + version +
hash as the answer to drift — an update that finds a modified file reports it rather than
clobbering it. See [[c64-toolkit-packaging-decisions]] for why, and for the plugin and
plain-dependency alternatives that were weighed and declined.

Settled there, and not to be re-litigated here: **one package** rather than a family; **npm + an
`npx` entrypoint**; **both topologies** (devcontainer-with-host-VICE and VICE-in-the-same-box)
detected at *runtime* by an inverted `container-guard` rather than chosen at install time;
**Claude Code only** for v1 with placement separated from payload.

Still genuinely open, and shaping this layer's scope:

- **`.mcp.json` in the consuming project** references what the installer wrote rather than this
  repo's relative path. Note from 01.2's checkpoint: a fresh session showed **no project-scope
  approval prompt** after `.mcp.json` gained a `timeout` field, though that observation does not
  isolate whether the workspace simply carries blanket trust
  (`01.2-CRITERION-13-EVIDENCE.md` § 6). Whether a *newly installed* server trips an approval
  prompt in a project that never had one is untested and is a first-run-experience risk.
- **The 1,231-line `tools-manifest.json` snapshot** is refreshed against a live host by
  `refresh-manifest.mjs`. Decide whether a published package ships a snapshot, generates one at
  install time, or requires a refresh step — a fresh clone currently ships an empty snapshot on
  purpose, which a package consumer would experience as "server connected, zero tools".

## Solution

TBD. Sketch, revised 2026-08-04 against the settled decisions:

- **Local-VICE (no-container) mode comes first**, before any code moves. It is the only part of
  this work with no working analogue in the tree — the broker assumes the container/host split —
  and it carries the inversion of `container-guard` from a refusal into a topology detector. It is
  step 1 of the sequence in [[c64-toolkit-packaging-decisions]] for exactly that reason.
- Stand up a separate repo, promoting `.claude/mcp/vice/package.json` from `private: true` to a
  published manifest rather than authoring one, with the existing test suite intact — the safety
  net for the extraction, and it should stay green throughout. (The original text here counted 212
  tests "across `.claude/mcp/vice/**` and `tools/**`"; `tools/` no longer holds tracked code, so
  re-count against `.claude/mcp/vice/**` alone before quoting a number.)
- Restate `repoRoot()`'s contract for the installed case explicitly, with tests for
  node_modules / monorepo / pnpm-store layouts, instead of relying on the `.git` walk landing right.
- Give the host-bound `resources/` artifacts a first-class deploy path from the installed package
  to the host workspace. `resources/` now holds **eight** entries — seven `tsc`-emitted `.mjs`
  (broker control, state, launch, kill, epoch, the broker itself, container-guard) plus the
  hand-authored `vice-launcher.sh` — not the "three `.sh` resources" this todo originally named.
  Still the awkward part, and still worth designing before the package's shape is assumed.
- ~~Land the host-path absorption first~~ — **done**, 2026-08-01 (`e0f9915`). The
  `.claude/skills/` imports that made this tree unpublishable are gone; `hostpath.ts` now lives
  inside the MCP tree. This layer is unblocked.
- Consume it back in this project as the first customer, replacing the vendored `.claude/mcp/vice/`
  with what the installer writes — dogfooding is what proves the extraction actually removed the
  coupling rather than hiding it.
