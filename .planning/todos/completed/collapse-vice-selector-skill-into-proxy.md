---
title: Move the surviving facts into the proxy, then delete or minimize the vice-mcp-selector SKILL.md
date: 2026-07-31
updated: 2026-08-01
priority: medium
---

> **STALE 2026-08-01.** Largely overtaken by events: `.claude/skills/vice-mcp-selector/` was
> deleted outright in `db9eed3` rather than collapsed into the proxy. What survives of this todo
> is only the fallout, and that is already done — the two assertions that read its SKILL.md were
> repointed at CLAUDE.md in `e0f9915`, and its CLAUDE.md skills-table row is gone. Re-read before
> acting; this may be closeable as-is.

# Collapse the skill into the proxy that made it redundant

Evidence and full line-by-line audit: [[vice-selector-skill-doc-is-vestigial]].

The original audit found that of **78 lines** in `.claude/skills/vice-mcp-selector/SKILL.md`, two
facts were not reachable at runtime. Move the survivors into code, then delete the file. **Do the
code moves first** — deleting the doc before its survivors have a home loses real information.

> **Updated 2026-08-01 — the file grew and the delete got harder.** Plan 01.2-05 took SKILL.md from
> **78 to 99 lines** (commit `74d0d70`) and, in the same change, added an assertion to
> `vice-mcp-selector-docs.test.mjs` that the document **must** describe the per-session broker
> route — confirmed to fire by temporary removal and revert. That assertion is now a third thing
> blocking deletion (see § 3), and the new section needs its own keep/cut pass (see § 2.5). The
> "two facts" count above is the pre-01.2 audit and is stale; treat § 2.5 as the delta rather than
> re-auditing from scratch.
>
> **Sharpening criterion, from the capture that prompted this update:** prose describing behavior
> that is *just how MCP works* does not belong in the file at all. An agent calling an MCP tool
> already expects per-session isolation and self-describing errors; restating them is not knowledge,
> it is noise. This is the file's own stated philosophy — see its
> **"Known hazards enforced in code, not by memory"** section, which the new content partly
> contradicts. If minimizing turns out to be more tractable than deleting, that criterion is what
> decides each line's fate.

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

## 2.5. The 01.2-05 section — keep/cut, line by line

Plan 01.2-05 added a 21-line `## Per-session, boot-fresh emulator access` section. Applying the
criterion above splits it cleanly.

**Cut outright — ambient MCP behavior or self-describing output:**

| Content | Why it goes |
|---|---|
| "Each session gets its own boot-fresh emulator… granted on that session's first forwarded tool call and released when the session ends, so a second session never shares the first session's machine." | An invariant the agent cannot act on. It is either true (and invisible) or broken (and a bug). Per-session isolation is the ambient expectation for an MCP server; documenting it teaches nothing. |
| "A tool call reporting the broker itself is absent or unreachable names which of three states applies and the host command to run." | Pure redundancy — the message says it. Documenting that a message is self-describing is the exact anti-pattern the file's own "enforced in code, not by memory" section names. |

**Must survive — not derivable, and the agent can act on it:**

| Content | Where it belongs |
|---|---|
| "The first call of a session may wait a few seconds for a cold launch, and may report warming-and-retry; retrying the same call is the correct action." | The warming message itself. Same move as § 1's polling contract → tool descriptions: the guidance travels with the thing that triggers it. Adjacent to [[de-architecture-agent-visible-proxy-messages]]. |
| "Within one session, the same emulator is reused across every call… a procedure that needs a known-clean machine still resets explicitly." | This is **D-1.2-C**, the narrowed reset ritual, and it is real project knowledge. Already carried by the ROADMAP § Standing Constraints VICE row — check whether the row alone suffices before finding it a second home. |
| "Namespace snapshot names by something session-scoped, never by port — ports are recycled across sessions under on-demand launch." | **D-1.2-E**. Genuinely not derivable and silently corrupting if ignored (a port-prefixed snapshot name can collide with an unrelated later session). Needs a code-side home — a refusal or a naming helper — not a paragraph. |

## 3. Delete `SKILL.md`

Cheap — the docs tests assert **negatives** about documents (no shell-invocation patterns at
`vice-mcp-selector-docs.test.mjs:157`, no `vice-session` directory at `:177`) and never pin the
body's prose.

**Three** things do break and must move in the same change:

- `vice-mcp-selector-docs.test.mjs:250` asserts CLAUDE.md's Project Skills table names
  `vice-mcp-selector`. Both the assertion and the table row go.
- `.claude/skills/c64-ram-capture/SKILL.md:113` names it as a sibling dependency for anyone copying
  the skills elsewhere. That instruction is still *true* about the scripts — reword it to point at
  the implementation directory, don't just drop it.
- **NEW (01.2-05):** `vice-mcp-selector-docs.test.mjs` gained an assertion that the skill document
  describes the per-session broker route, pinned to a stable meaning-bearing phrase and confirmed to
  fire. Deleting the document red-lines it. Do not simply delete the assertion — it exists so a
  future rewrite cannot silently drop D-1.2-C/D-1.2-E guidance. Re-point it at whatever code-side
  home § 2.5 gives those two facts, so the guard survives the move rather than the move deleting
  the guard.

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
- The warming-and-retry guidance is carried by the warming message itself, not by prose.
- D-1.2-E's session-scoped snapshot naming has a code-side home (refusal or helper), and D-1.2-C's
  within-session reset rule is confirmed to survive — in the ROADMAP row alone if that suffices.
- Every line in § 2.5's cut column is gone, with nothing restated that an MCP caller already assumes.
- `SKILL.md` is gone **or** reduced to only facts that fail the "ambient MCP behavior" test;
  CLAUDE.md's table, the `:250` assertion, the new per-session-route assertion, and the
  `c64-ram-capture:113` cross-reference are all consistent with the outcome.
- The scripts are untouched and `.mcp.json` still resolves.

Note the two outcomes are not equivalent. Deleting is cleaner but must find homes for three
survivors; minimizing keeps a file whose *entire* remaining content passes the criterion. Decide
after § 2.5's moves land — if all three survivors get code-side homes, nothing is left to keep.

## RESOLVED 2026-08-04 (quick task 260804-dbf) — closeable as its own banner predicted

The 2026-08-01 banner said "this may be closeable as-is". Re-read and verified; it is. All three
things this todo needed are done, and none of them were done by this task:

| Requirement | State |
|---|---|
| The SKILL.md is gone | `.claude/skills/vice-mcp-selector/` does not exist |
| Its CLAUDE.md skills-table row is gone | `grep -c` on `.claude/CLAUDE.md` returns **0** |
| The assertions that read its SKILL.md are repointed | Done, and now inverted into a retirement gate |

**The third one is stronger than "repointed", which is why this closes rather than lingers.** The
surviving `.claude/mcp/vice/vice-mcp-selector-docs.test.ts` no longer asserts anything *about* the
skill existing. It asserts the opposite, over a list of retired routes:

```js
for (const retired of ["vice-session", "vice-mcp-selector", "spike-findings-bruce-lee", "devcontainer-host-path"]) {
  assert.ok(!text.includes(retired), `CLAUDE.md must not name the retired ${retired} skill`);
}
```

Its own header records the rewrite and the reasoning: *"The invariant underneath was never 'this row
exists'; it was 'CLAUDE.md tells an agent how to reach the emulator, and names no retired route'."*
So the deletion this todo asked for is now enforced by a test that walks directories fresh at run
time — the skill cannot come back by accident, and no future doc can re-name it.

### On the eight remaining references

`grep -rln vice-mcp-selector` over `.claude/mcp/vice/` still returns eight files, which looks at
first like unfinished cleanup. It is not: they are the retirement machinery itself (the gate above,
plus header comments recording *why* the route was retired) and file names. Nothing depends on the
skill existing. Deliberately not "cleaned up" — deleting the gate would remove the thing keeping
the skill deleted, and renaming the test file is churn with no invariant behind it.

`.claude/mcp/vice/` was read but **not edited** here. Editing it is MCP maintenance, a different
task from triaging this todo.

**Evidence:** direct verification in this container, 2026-08-04 — directory absent, `grep -c` on
CLAUDE.md returns 0, and the negative assertion read verbatim from the test source.
**Confidence:** HIGH.
