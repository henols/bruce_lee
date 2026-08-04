---
type: tooling
severity: major
area: gsd-execute-phase / Claude Code worktree isolation
discovered: 2026-08-04
discovered_during: /gsd-execute-phase 01.6.2, wave 11 (plan 01.6.2-11)
---

# A non-autonomous plan whose checkpoint precedes its first commit loses its worktree

## What happened

Plan `01.6.2-11` is `autonomous: false` with a blocking `checkpoint:decision` as **Task 1**.
The executor did the correct thing: it read the plan, reached the checkpoint, made **zero file
changes and zero commits**, and returned `## CHECKPOINT REACHED`.

Claude Code's `Agent(isolation="worktree")` **auto-cleans a worktree that is unchanged on
return**. Because the executor had committed nothing, its worktree and branch
(`worktree-agent-aeae067c2d9e37971`) were reaped while the orchestrator was presenting the
decision to the developer. The subsequent `SendMessage` resume had nothing to resume into; the
agent re-ran its own branch/base assertion, found no worktree, and halted again — correctly
refusing to self-recover or fall back to `main`.

Nothing was lost, precisely because nothing had been done yet.

## Why plan 01 did not hit this

`01.6.2-01` is also `autonomous: false` with a blocking `checkpoint:decision`, but its checkpoint
is **Task 2** — Task 1 (the fixture capture) had already committed `f9defc3`. A changed worktree
is not reaped, so `SendMessage` resumed it with its commits and context intact.

**The discriminator is not "is the plan non-autonomous" — it is "has the plan committed anything
before it blocks".**

## Cost

One re-dispatch (~120k subagent tokens for the halted read-and-report run, plus a full re-read of
the plan and validation artifacts in the fresh worktree). No data loss, no partial state. The cost
is bounded but repeats every time this shape occurs.

## Candidate fixes (not implemented — this is a report, not a patch)

- **Planner-side:** never make a checkpoint the first task of a plan; order at least one
  committing task ahead of it. This is the cheapest fix and needs no tooling change.
- **Orchestrator-side:** when a plan is `autonomous: false`, expect the worktree may be gone at
  resume time and re-dispatch fresh with the decision pre-resolved, rather than attempting
  `SendMessage`. This is what was actually done here and it worked cleanly.
- **Executor-side:** commit the decision-record artifact *before* returning the checkpoint, so
  the worktree is never unchanged. Changes the checkpoint contract, so needs thought.

Evidence: observed live, 2026-08-04, during `/gsd-execute-phase 01.6.2` wave 11. `git worktree
list`, `git branch --list`, `.git/worktrees/` and `git reflog` all confirmed clean removal rather
than a crash.
Confidence: HIGH.
