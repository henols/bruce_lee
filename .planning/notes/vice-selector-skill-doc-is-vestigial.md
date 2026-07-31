---
title: The vice-mcp-selector SKILL.md is vestigial — every hazard it documents was later fixed in code, and the prose was never removed
date: 2026-07-31
context: /gsd-explore challenging whether the vice-mcp-selector skill carries any information an agent cannot get at runtime; line-by-line audit of all 78 lines against the shipped proxy. Follow-up to the design note that created the skill.
---

# 78 lines audited, two facts survive, and both are code gaps

The skill was designed as the agent-facing companion to the stdio proxy (see
[[vice-mcp-selector-design]]). Phase 1.1 then shipped the hazards *as enforcement* — deny-list
filtering, path refusal, three-state unreachable diagnostics, epoch voiding. Each hazard's prose
stayed behind next to the code that made it unnecessary. Nothing ever went back to delete it.

## The audit

Every region of `.claude/skills/vice-mcp-selector/SKILL.md` against "could the agent get this
another way":

| Lines | Claim | Reachable without the doc? |
|---|---|---|
| 6–11 | Call `mcp__vice__*` directly; no CLI, no JSON, no select step | **Yes** — the session's tool list. This is un-teaching `vice-session`, whose absence is already asserted structurally at `vice-mcp-selector-docs.test.mjs:177` |
| 13–19 | Poll as read → `execution_run` → `ping`, never read → wait → read | **No** — silent speed loss, emits no error |
| 21–25 | Absolute container paths are auto-translated | **Yes** — it simply works; there is nothing to act on |
| 26–29 | A relative path is forwarded as written and won't resolve on the host | **No** — confirmed at `vice-proxy.mjs:460`, `if (!value.startsWith("/")) return value` |
| 31–35 | `vice_disk_list` is refused and hidden | **Yes** — two structural layers: `DENY_LIST` filter at `vice-proxy.mjs:211` plus absence from every listing |
| 36–39 | Don't route around an unreachable host | Marginal — a negative instruction about something an agent is unlikely to attempt |
| 41–45 | Parse `.d64` bytes directly rather than listing a disk | **Yes** — already stated in CLAUDE.md's "What NOT to Use" table |
| 47–62 | Tools missing → refresh the manifest / approve the MCP server | Human setup step, and the section delegates to `tools/README.md` anyway |
| 64–74 | Read the unreachable message itself rather than guessing | **Yes** — the doc says so explicitly, which is an argument against its own necessity |
| 76–78 | Parse `.d64` bytes directly | **Duplicate of 41–45** |

## The tell

The file states the disk-reading rule **twice** in 78 lines. A document that is actually read and
maintained does not repeat itself at that density. The duplication is the signature of accretion:
each newly discovered hazard was appended, then fixed in code, and the append was never reverted.

## The two survivors, and why they aren't documentation

- **The polling contract.** Genuinely only knowable from prose today, and genuinely costly — a
  wrong loop runs the machine at a fraction of full speed with no error. But it belongs in the
  `execution_run` and `ping` tool *descriptions*, where the agent is choosing the call. The seam
  exists: `handleToolsList()` at `vice-proxy.mjs:202` already maps over all 63 manifest tools to
  stamp `_meta`, and each manifest entry already carries a `description`.
- **The relative-path residual.** Should throw, exactly as its absolute-path sibling does eleven
  lines below it at `vice-proxy.mjs:466`. Documenting a silent failure is strictly worse than
  making it loud.

Both are tracked in [[collapse-vice-selector-skill-into-proxy]].

## The principle worth keeping

**When a hazard moves into enforcement, its prose becomes a liability, not a backup.** Two copies
of a rule drift, and the doc copy is the one nobody re-reads. The audit above is what a docs
surface looks like when that cleanup step is missing from the loop — the skill accumulated a
hazard note per discovery while the code accumulated the actual fix.

A related smell in the same family: `tools/README.md` is 458 lines of proxy architecture, and
`SKILL.md:55` points an agent into it for the manifest-refresh step. That is the one place the
word "proxy" reaches an agent through documentation. The larger leak is through *runtime strings* —
see [[de-architecture-agent-visible-proxy-messages]].

## Decision taken

**Delete the skill outright** rather than rename it. `selector` names a step the skill's own first
paragraph says does not exist, but renaming only fixes the label on a file whose body shouldn't
survive the two moves above.

Important scoping constraint, established during the audit: **"delete the skill" cannot mean delete
the directory.** `.claude/skills/vice-mcp-selector/` holds the load-bearing implementation —
`.mcp.json` points at `scripts/vice-proxy.mjs`, `tools/chip-state.mjs:32-34` imports three modules
from it, and `.gitignore:78-80` references its `resources/`. Removing `SKILL.md` is what un-declares
it as a skill; relocating the scripts is a separate and riskier decision.
