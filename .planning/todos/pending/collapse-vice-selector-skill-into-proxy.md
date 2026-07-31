---
title: Move the polling contract and the relative-path refusal into the proxy, then delete the vice-mcp-selector SKILL.md
date: 2026-07-31
priority: medium
---

# Collapse the skill into the proxy that made it redundant

Evidence and full line-by-line audit: [[vice-selector-skill-doc-is-vestigial]].

Of 78 lines in `.claude/skills/vice-mcp-selector/SKILL.md`, two facts are not reachable at runtime.
Move both into code, then delete the file. **Do the two code moves first** — deleting the doc before
its two survivors have a home loses real information.

## 1. Polling contract → tool descriptions

The rule: read → `mcp__vice__execution_run` → `mcp__vice__ping`, never read → wait → read, because
state-reading calls stop the machine and `ping` reports state without stopping it. A loop written
the wrong way runs at a small fraction of full speed and **emits no error** — which is why this one
genuinely cannot just be deleted.

The seam already exists. `handleToolsList()` at `.claude/skills/vice-mcp-selector/scripts/vice-proxy.mjs:202`
already maps every manifest tool to inject `_meta`, and each of the 63 manifest entries already
carries a `description` string. Add a third read-time transform appending the contract to the
descriptions of `execution_run` and `ping`.

Keep it a **read-time** transform, consistent with the two already there — the comment at
`vice-proxy.mjs:203-210` explains why (a stale or hand-edited snapshot can never leak the wrong
property). Do not bake the text into `tools-manifest.json`; `refresh-manifest.mjs` is its only
writer and a refresh would drop it.

## 2. Relative-path residual → a refusal

`vice-proxy.mjs:460` reads `if (!value.startsWith("/")) return value; // the stated residual:
relative strings untouched`. A relative path therefore reaches the host unchanged and fails there.

Make it throw with a fix-it message, mirroring `PathOutOfWorkspaceError` at `vice-proxy.mjs:466`.

**The hard part is the false-positive risk, and it's the reason this wasn't done originally.** From
inside `rewritePathsIn` a relative path is indistinguishable from any other non-path string — a tool
name, a hex address like `$08B1`, a symbol, a format argument. Blanket-refusing every non-absolute
string would break most of the 63 tools. Options, in preference order:

1. Refuse only strings at argument positions known to be paths (`arguments.path`, `diskPath`,
   `filename`, …). `argPath` is already threaded through the walker for exactly this kind of
   positional reasoning.
2. Refuse only strings that look unambiguously like relative paths (contain `/` or a known
   extension: `.d64`, `.prg`, `.vsf`, `.vs`, `.png`).

Option 1 is narrower and safer. Option 2 needs care — `vice_symbols_load` and friends take formats
and names that could collide.

## 3. Delete `SKILL.md`

Cheap — the docs tests assert **negatives** about documents (no shell-invocation patterns at
`vice-mcp-selector-docs.test.mjs:157`, no `vice-session` directory at `:177`) and never pin the
body's prose.

Two things do break and must move in the same change:

- `vice-mcp-selector-docs.test.mjs:250` asserts CLAUDE.md's Project Skills table names
  `vice-mcp-selector`. Both the assertion and the table row go.
- `.claude/skills/c64-ram-capture/SKILL.md:113` names it as a sibling dependency for anyone copying
  the skills elsewhere. That instruction is still *true* about the scripts — reword it to point at
  the implementation directory, don't just drop it.

## Scoping constraint — do not delete the directory

`.claude/skills/vice-mcp-selector/` is load-bearing implementation, not just a skill:

- `.mcp.json:5` → `scripts/vice-proxy.mjs`
- `tools/chip-state.mjs:32-34` imports `vice.mjs`, `vice-pool.mjs`, `vice-sync.mjs`
- `.gitignore:78-80` references its `resources/`
- `tools/README.md` links into it in at least four places

Removing `SKILL.md` is what un-declares the skill. **Relocating the scripts is a separate decision
and should not be bundled in** — changing `.mcp.json`'s `args[0]` alters the server definition, and
whether that re-triggers project-scope MCP approval is unverified. The test at
`vice-mcp-selector-docs.test.mjs:96-98` reasons about approval invalidation for a changing `url`;
whether an `args` path change behaves the same way is exactly the kind of thing that needs checking
before it is assumed. Keeping the scripts in place costs nothing and risks nothing.

## Done when

- The polling contract reaches the agent through `execution_run`/`ping` descriptions, verified in a
  real `tools/list` response.
- A relative path at a path-shaped argument returns a refusal naming the argument position, with no
  regression across the other tools.
- `SKILL.md` is gone; CLAUDE.md's table, the `:250` assertion, and the `c64-ram-capture:113`
  cross-reference are consistent with its absence.
- The scripts are untouched and `.mcp.json` still resolves.
