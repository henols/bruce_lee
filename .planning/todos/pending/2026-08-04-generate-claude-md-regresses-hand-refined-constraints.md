# `gsd-tools generate-claude-md` regresses CLAUDE.md's hand-refined constraints

**Found:** 2026-08-04, during quick task `260804-9m3` (authoring the `skill-writer` skill).

## The hazard

`.claude/CLAUDE.md`'s Project Skills table sits inside
`<!-- GSD:skills-start source:skills/ -->` / `<!-- GSD:skills-end -->`, which reads as
an invitation to register a new skill by running the generator:

```bash
node .claude/gsd-core/bin/gsd-tools.cjs generate-claude-md
```

It does add the missing rows. It also regenerates **every** managed block —
`project`, `stack`, `skills`, `workflow` — from `.planning/PROJECT.md` and
`.planning/research/STACK.md`, and those sources are stale relative to CLAUDE.md.
A one-row change came out as **62 insertions, 36 deletions**, and three project
constraints regressed:

| Constraint | Before (CLAUDE.md, hand-refined) | After (regenerated from PROJECT.md) |
|---|---|---|
| Emulator route | "the single permitted access point… No script, module, test or driver may open its own connection… If a design needs a Node process to reach VICE, the design is dead" | "All emulator interaction is tool-mediated; anything requiring host paths must go through the `devcontainer-host-path` skill" — a skill that **no longer exists** |
| Headless container | Full constraint present | **Deleted outright** |
| `.d64` packaging | "done from Python — the `d64` library reads and writes disk images; `cc1541` … as a fallback" | "No `c1541`/`exomizer`/`petcat` in the container — `.d64` packaging … need a solution chosen during research" |

The stale source lines are `.planning/PROJECT.md:68-69` and `:84-85`.

This is a silent regression: the generator reports `Generated 4/6 sections` and exits
0. Nothing flags that the hard rules just got weaker. Committing it would have put a
non-existent skill back into the project's emulator constraint.

## Why it was not fixed inline

Bringing `PROJECT.md` and `STACK.md` up to date with CLAUDE.md's constraint list is a
docs-reconciliation task with its own review surface — well outside a quick task about
authoring a skill. Deviating into it would have buried the actual deliverable.

## The work

1. Reconcile `.planning/PROJECT.md`'s `## Constraints` (and the tooling inventory at
   `:68-69`) with `.claude/CLAUDE.md`'s current, refined constraint list. CLAUDE.md is
   the newer of the two — it wins.
2. Same pass over `.planning/research/STACK.md` for anything the `stack` block pulls.
3. Drop every remaining reference to the `devcontainer-host-path` skill; it is gone.
4. Re-run `generate-claude-md` and confirm the diff is empty or additive only.
5. Then remove the "do not run the generator" carve-out from
   `.claude/skills/skill-writer/SKILL.md` § Register it, which documents this hazard
   as the current reason to hand-edit the table.

## Interim rule

Register a new skill by hand-editing the table row. If the generator is run for any
reason, diff before committing:

```bash
git diff .claude/CLAUDE.md          # must touch ONLY the GSD:skills-* block
git checkout .claude/CLAUDE.md      # if it touched anything else
```

**Evidence:** Run directly in this container on 2026-08-04 — generator executed, diff
inspected line by line, reverted with `git checkout`. Both hard rules confirmed intact
afterward by `grep`.
**Confidence:** HIGH (observed, not inferred).
