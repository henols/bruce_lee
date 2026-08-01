---
created: 2026-08-01T12:05:00.000Z
title: Extract the VICE MCP into its own project and publish it as an installable package
area: tooling
severity: major
files:
  - .claude/mcp/vice/vice-proxy.mjs
  - .claude/mcp/vice/repo-root.mjs
  - .claude/mcp/vice/install-resources.mjs
  - .mcp.json
  - .claude/skills/devcontainer-host-path/scripts/hostpath.mjs
---

## Problem

The VICE MCP server is **vendored source**, not a dependency. `.claude/mcp/vice/` is ~14,650 lines
across 22 files — proxy, broker client, pool, session, probe, sync, the three host-side shell
resources, a 1,231-line tools manifest, and ~6,300 lines of tests. `.mcp.json` wires it by relative
path:

```json
{ "mcpServers": { "vice": { "command": "node", "args": [".claude/mcp/vice/vice-proxy.mjs"], "timeout": 60000 } } }
```

There is **no `package.json` anywhere in the repo**. The only way for another project to drive VICE
is to copy the tree in. That is the actual blocker to reuse, and copies drift: a deny-list, lease
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
   the `devcontainer-host-path` skill has exactly four production consumers, and 01.2's acceptance
   criteria assert that count (`grep -c … install-resources.mjs` is exactly 1). Packaging must
   decide whether the skill travels with the package, stays a peer, or gets absorbed — the existing
   todo [[collapse-vice-selector-skill-into-proxy]] is adjacent to this question.
4. **The container guard is load-bearing.** `container-guard.sh` makes the host scripts refuse to
   run inside a devcontainer (exit 2, by design). A distributed package has to keep that refusal
   correct across environments it was never tested in.

### Consumption shape to decide

The end state the user asked for is: an LLM-driven project installs the package and gets working
`mcp__vice__*` tools **without copying source**. Open questions that shape scope:

- **Registry and runtime.** npm (`npx @scope/vice-mcp`) is the obvious fit given the code is ESM
  Node and this container runs Node v24 — but nothing is packaged today, so there is no existing
  convention to follow.
- **`.mcp.json` in the consuming project** would reference the installed binary rather than a
  relative path. Note from 01.2's checkpoint: a fresh session showed **no project-scope approval
  prompt** after `.mcp.json` gained a `timeout` field, though that observation does not isolate
  whether the workspace simply carries blanket trust (`01.2-CRITERION-13-EVIDENCE.md` § 6).
- **The 1,231-line `tools-manifest.json` snapshot** is refreshed against a live host by
  `refresh-manifest.mjs`. Decide whether a published package ships a snapshot, generates one at
  install time, or requires a refresh step — a fresh clone currently ships an empty snapshot on
  purpose, which a package consumer would experience as "server connected, zero tools".

## Solution

TBD. Sketch:

- Stand up a separate repo with a real `package.json`, ESM entrypoint, and the existing test suite
  intact (212 tests today across `.claude/mcp/vice/**` and `tools/**` — they are the safety net for
  the extraction and should keep passing throughout).
- Restate `repoRoot()`'s contract for the installed case explicitly, with tests for
  node_modules / monorepo / pnpm-store layouts, instead of relying on the `.git` walk landing right.
- Give the three host `.sh` resources a first-class deploy path from the installed package to the
  host workspace — this is the piece with no current analogue and should be designed first, since it
  is most likely to change the package's shape.
- Decide the `devcontainer-host-path` boundary: travels with the package, peer dependency, or
  absorbed.
- Consume it back in this project as the first customer, replacing `.claude/mcp/vice/` with the
  dependency — dogfooding is what proves the extraction actually removed the coupling rather than
  hiding it.
