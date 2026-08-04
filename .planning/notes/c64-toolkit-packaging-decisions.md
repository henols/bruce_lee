---
title: The C64 RE toolkit ships as one npm package installed by an npx entrypoint, detecting its topology at runtime
date: 2026-08-04
context: >
  Produced by a /gsd-explore session on extracting the skills and the VICE MCP into their own
  project. This note is the decision record the umbrella todo
  (2026-08-01-pack-the-whole-c64-re-toolkit-including-the-vice-mcp-into-one-package) demands
  "before any code moves". Every inventory fact below was verified by reading or grepping the
  tree during that session; the stale facts it corrects in the two existing todos are named
  explicitly rather than silently overwritten.
---

# The C64 RE toolkit ships as one npm package installed by an npx entrypoint, detecting its topology at runtime

## Scope: what this document is, and is not

This is a design record written **before** the work it describes. Nothing changed in the codebase
when it was written: no package exists, no repo has been created, no file has moved. It exists so
the two component todos can proceed without contradicting each other, which is the specific gap
the umbrella todo identified.

It is the authority on **the four decisions below and their rationale**. It is deliberately not
the authority on the blocker analysis inside
`2026-08-01-extract-the-vice-mcp-into-an-installable-package` — that todo keeps owning its own
slice, and duplicating it here would fork it.

## The four decisions

| # | Decision | Status |
|---|---|---|
| 1 | One repo, one npm package, one `npx` entrypoint — not a family | Recommended in this session; developer did not separately ratify, but it follows from decision 2 |
| 2 | Delivery is an installer that **copies** into the consuming project — mastra/GSD-style install UX, not a plugin and not a runtime dependency | **Decided by developer** |
| 3 | Both topologies supported: devcontainer-with-host-VICE **and** VICE in the same box. "It must work with and without a devcontainer" | **Decided by developer** |
| 4 | Claude Code is the only harness target for v1, but placement is separated from payload so a second target is additive | **Decided by developer** (chose the "additive later" option over Claude-only-ever and full multi-harness) |

### 1. One package, not a family

The umbrella todo left "is it one package or a family?" as the decision that had to be made
first, on the grounds that the three layers install to different places by different mechanisms.
Decision 2 settles it: the copy model already forces an install-state file, an update path, and a
migration story. Paying for three of those, plus a meta-package to coordinate them, costs more
than it buys while there is one consumer. A family remains available later — splitting a package
that already has a manifest and an install-state format is a mechanical change; merging three that
each grew their own is not.

### 2. An installer that copies, with install-state as the drift answer

The extraction todo's core argument is that *copies drift*. An installer that writes files into a
consuming project produces copies, so the argument applies to the chosen model and has to be
answered inside it rather than dismissed.

The answer is the install-state file: record path, version and content hash for everything
written. An update that finds a modified file **reports it rather than clobbering it**. That
converts drift from a silent-divergence problem into an ordinary versioning problem, which is the
part of GSD's model that works — `.claude/gsd-install-state.json` and
`.claude/gsd-file-manifest.json` are the existing local example to study.

This was weighed against two alternatives and both were declined:

- **A Claude Code plugin** — no copies at all, native install/update, one manifest declaring
  skills and the MCP server. Declined in favour of harness-independence and the ability for a
  consuming project to pin or edit its copy.
- **A plain npm dependency** — clean for the MCP layer, but skills are only discovered from
  `.claude/skills/`, so the skills half stays unsolved and the project ends up with a copy
  mechanism anyway for half its payload.

### 3. Topology is detected at runtime, not chosen at install time

Both topologies must work, and the non-obvious part is *when* the choice is made. A project moves
between topologies: the same repository is opened in a devcontainer today, bare tomorrow, in CI
next week. An installer that picks a mode is wrong the first time the environment changes, and
wrong in a way that looks like a broken emulator rather than a stale install.

So: **install both payloads unconditionally, and let the proxy decide at startup.**
`container-guard` already answers exactly the question "am I inside a devcontainer?" — today to
refuse, under this design to dispatch. Inverting a refusal into a detector reuses logic that is
already load-bearing and already tested, rather than adding a parallel probe that can disagree
with it.

The local-VICE mode itself does not exist today. The broker assumes the container/host split. That
makes it the only piece of this work with **no working analogue in the tree**, which is why it
leads the sequence.

### 4. Claude Code v1, placement separated from payload

A manifest says *what* ships. A thin adapter says *where this harness puts it*. A second harness
becomes a second adapter rather than a rewrite.

The reason not to do multi-harness now is specific, not just scope discipline: the skills instruct
the agent to call `mcp__vice__*` tools by name, and that naming is Claude Code's. A skill that
says "call `mcp__vice__vice_memory_read`" is simply wrong in a harness that names MCP tools
differently, so multi-harness support is not a placement problem — it is a per-harness content
problem hiding behind one.

## Sequence

Deliberately front-loads the piece with no analogue, so an assumed package shape is invalidated
early rather than late.

1. **Local-VICE (no-container) mode**, including inverting `container-guard` into a topology
   detector. Novel, and most likely to reshape everything after it.
2. **Extract the MCP layer**, behind its existing test suite — that suite is the safety net and
   should stay green throughout.
3. **Extract the skills layer.** Nearly free (see below), but downstream of the MCP layer because
   the skills' scripts are pure logic over data the agent fetched through `mcp__vice__*`.
4. **Dogfood back here** — this project becomes the first customer, replacing its vendored tree
   with the installed one. That is what proves the coupling was removed rather than relocated.

## What ships, and what does not

**Ships:** the five C64 RE skills (`acme-build`, `c64-memory-mapping`, `c64-program-recon`,
`c64-provenance-diff`, `c64-ram-capture`), `vice-wedge-triage`, and the VICE MCP.

**Stays behind:** `skill-writer` (generic skill authoring — a real capability, but not a C64 one,
and it belongs in whatever ships GSD-adjacent tooling) and `find-skills` (third-party, carries its
own `source.json` and `.skillfish.json`).

## Inventory corrections — what changed since the two todos were written

Both existing todos were written on 2026-08-01 and describe a tree that has since moved. Verified
2026-08-04:

- **The three-layer model is now two layers.** The umbrella todo describes MCP / skills / a
  `tools/` layer of pure-logic Node modules. That third layer no longer exists separately:
  `tools/` is now purely a generated, gitignored deployment target, and the pure logic moved into
  the skills that use it. `c64-ram-capture/scripts/` carries `d64-parse`, `dump-artifacts`,
  `watch-loads`, `releases`, `project-paths`, `compare`, `test-corpus` and three test files;
  `c64-provenance-diff/scripts/` carries `diff-images`, `recovery-schema` and a test.
- **`recovery-schema.mjs` and `releases.mjs` are no longer project-bound.** The umbrella todo
  expects them to "stay behind" as project-specific by construction. The portability work landed
  in between: `releases.mjs` resolves its registry through `project-paths.mjs`, overridable via
  `C64RE_DATA_DIR` / `C64RE_REGISTRY`, and says so in its own header comment.
- **The skills contain no project-specific references at all.** A case-insensitive grep for
  `bruce`, `danish`, `saeger` and `yamo` across `.claude/skills/` (`.md`, `.mjs`, `.json`) returns
  **zero** files. The skills layer is close to shippable as-is, which is a materially smaller job
  than either todo assumes.
- **"There is no `package.json` anywhere in the repo" is false now.** Two exist:
  `.claude/package.json` (the two-token CJS marker, correctly discounted by the umbrella todo) and
  `.claude/mcp/vice/package.json` — a real manifest, `name: vice-mcp`, `private: true`, ESM, with
  `test` / `typecheck` / `build` scripts and pinned `typescript` + `@types/node` devDependencies.
  The MCP layer already has a build toolchain to extract, not one to invent.
- **File extensions in the extraction todo are stale.** It names `vice-proxy.mjs`,
  `repo-root.mjs`, `install-resources.mjs`; the authored sources are `.ts`/`.mts` and `.mcp.json`
  wires `node .claude/mcp/vice/vice-proxy.ts`. Its `resources/`-to-`tools/` deploy analysis still
  holds — that mechanism is intact, with eight entries under `resources/`.

## The one open unknown

What a local (no-container) VICE mode costs the broker, and whether `container-guard` inverts
cleanly from refusal into detection. Everything else in this plan is ordinary Node packaging. This
was offered as a research question during the session and not taken up; it is recorded here so it
is not lost, and it is step 1 of the sequence precisely because it is the unknown.

## Rules that travel with the package

The umbrella todo's point stands and is restated here because it constrains the package's design
rather than its documentation: **`mcp__vice__*` as the sole route to the emulator has to be
structural for consumers, not a convention they read about.** A consumer under deadline will
otherwise reinvent the direct-connection bypass this project has already discarded twice. The
existing import-purity tests in each pipeline skill are the working precedent — they enforce the
rule mechanically, and a distributed package should ship them rather than a warning.
