---
created: 2026-08-03T21:55:00.000Z
title: "`gsd-tools query commit --files <absolute-path>` returns `nothing_to_commit` and commits nothing, silently — the same path repo-relative works"
area: tooling
severity: minor
files:
  - .claude/gsd-core/bin/gsd-tools.cjs
related:
  - .planning/todos/pending/2026-08-03-gsd-phase-insert-cannot-resolve-any-phase-extractcurrentmilestone-returns-preamble.md
---

## Context

Hit by `gsd-planner` during the `/gsd-plan-phase 01.6.2` revision pass, and confirmed in the same
session. The agent passed an absolute container path to `--files`; the handler reported
`nothing_to_commit` and exited 0. Re-invoked with the identical path made repo-relative, it committed
correctly (`3337fe3`).

## The hazard

`nothing_to_commit` is the same response the handler gives for a genuinely clean tree, so an absolute
path produces a **success-shaped no-op**. There is nothing in the output to distinguish *"your file
had no changes"* from *"I could not see the path you named."* An agent following a workflow that ends
in a commit step will read it as "already committed" and move on, leaving real work uncommitted —
which then surfaces much later as a mysteriously dirty or mysteriously missing change.

This is worse than an error precisely because the workflows treat `committed: false, reason:
nothing_to_commit` as a benign outcome.

## Reproduction

```bash
# does nothing, exits 0, reports nothing_to_commit
node .claude/gsd-core/bin/gsd-tools.cjs query commit "msg" \
  --files /workspaces/bruce_lee/.planning/phases/01.6.2-the-one-process-host-broker/01.6.2-01-PLAN.md

# commits
node .claude/gsd-core/bin/gsd-tools.cjs query commit "msg" \
  --files ".planning/phases/01.6.2-the-one-process-host-broker/01.6.2-01-PLAN.md"
```

## Suggested fix

- Normalise `--files` entries against the repo root before staging, so absolute and relative paths
  behave identically. This is the real fix — callers should not have to know.
- Failing that, **distinguish the two cases in the response**: emit a distinct `reason` (e.g.
  `path_not_matched`) when a named path resolves to nothing stageable, and make it non-zero exit.
  A silent success for an unseen path is the actual defect; the path handling is just how it is
  reached.

## Workaround in use

Always pass `--files` repo-relative. Where a workflow document shows an absolute path (plan-phase's
step 13d, among others), convert it first. After any scripted commit, confirm with `git status
--porcelain` rather than trusting `committed: true` / `nothing_to_commit` alone.
