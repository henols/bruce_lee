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

The seam already exists. `handleToolsList()` at `.claude/mcp/vice/vice-proxy.mjs:202`
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

## Scoping constraint — RESOLVED by quick task 260731-p8a

This section originally warned that `.claude/skills/vice-mcp-selector/` could not be deleted
because it held the load-bearing implementation. **That is no longer true.** Quick task
`260731-p8a` (commits `b26970c`, `2fdb168`, `bdd1040`) relocated all 18 implementation files to
`.claude/mcp/vice/` via `git mv`, and `.mcp.json` now points at
`.claude/mcp/vice/vice-proxy.mjs`.

`.claude/skills/vice-mcp-selector/` now holds `SKILL.md` and nothing else. Deleting it is
therefore a plain `git rm` of one file plus the reference cleanup listed above — no implementation
moves left to untangle.

Two things that came out of that move and still bear on this todo:

- **Unverified:** whether the changed `.mcp.json` `args[0]` re-triggers project-scope MCP
  approval. Observe it on the next fresh session; do not design around it either way.
- `skill-docs.test.mjs` now lives in `.claude/mcp/vice/` while the `SKILL.md` it guards lives in
  `.claude/skills/vice-mcp-selector/` — the gate spans two trees. Its header carries a note saying
  the gate should be retired together with that `SKILL.md`. **Retiring that gate is part of this
  todo**, not a separate one.

## Done when

- The polling contract reaches the agent through `execution_run`/`ping` descriptions, verified in a
  real `tools/list` response.
- A relative path at a path-shaped argument returns a refusal naming the argument position, with no
  regression across the other tools.
- `SKILL.md` is gone; CLAUDE.md's table, the `:250` assertion, and the `c64-ram-capture:113`
  cross-reference are consistent with its absence.
- The scripts are untouched and `.mcp.json` still resolves.
