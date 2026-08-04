---
quick_id: 260804-dbf
description: "Triage the blocked skill-queue todos: confirm diagnose/recycle reachability, retarget the supervisor todo, close two stale todos"
date: 2026-08-04
status: complete
---

# Summary

Items 1 and 2 of the approved four-item skill queue. Two todos closed, two
retargeted and kept open, one `blocker`-severity chain unblocked, two findings
logged. **Two planned closures did not happen, on purpose** — see Deviations.

## Outcome per todo

| Todo | Action | Now |
|---|---|---|
| `vice-diagnose-and-vice-recycle-unreachable-from-agent-session` | Resolved by live test | `completed/` |
| `collapse-vice-selector-skill-into-proxy` | Verified genuinely done | `completed/` |
| `supervisor-skill-to-detect-and-recover-a-wedged-vice` | Retargeted — part 2 settled, part 1 remains | **pending**, severity `blocker` unchanged |
| `move-drift-classification-into-ram-compare` | Retargeted — a real gap surfaced | **pending** |

## The unblocking result

`vice_diagnose` and `vice_recycle` are reachable from an agent session as named
functions, and are intercepted proxy-side. The evidence is the **error shape**,
which is that todo's own diagnostic: on 2026-08-02 the reply was
`... rejected this call: Tool not found`, proving the name had been forwarded to
the host. It now returns the proxy's own `the on-demand VICE broker has never been
started on this host` — a message only proxy-local dispatch can produce, because a
forwarded call has no host tool to report broker state about.

That resolves the prerequisite blocking the wedged-VICE supervisor todo, and with
it plan 01.3-05's stated blocker.

**Not verified, and said so in every place it is written down:** that
`vice_diagnose` returns a correct *verdict*. The host broker is not running, so no
cycle bracket was measured. Reachability and interception are proven; behaviour is
not.

## Deviations from the plan

### 1. Item 1's framing was withdrawn, not executed

The queue item was *"redirect the supervisor todo, because a supervisor skill
can't reach the emulator under the hard rule."* Reading the todo in full, that was
wrong: it already quotes the hard constraint and already resolves placement as
"skill for the procedure, one or two MCP tools for the privileged actions it
calls," naming both tools. Nothing needed redirecting. What it needed was the
reachability fact, which is what this task obtained. The withdrawal is recorded in
the PLAN.md rather than quietly dropped.

### 2. `move-drift-classification` was retargeted, not closed

It was queued for closure as "STALE, target deleted". Closing it would have buried
a live gap. Both sides of its tension are gone — `ram-compare.mjs` in `db9eed3`,
`tools/recover.mjs` in `d963c5b` — and the second deletion took the **N≥3
stability rule** with it. A repo-wide grep for `classifyRunSet`,
`sharesSingleBitDriftOrigin`, `inPowerOnPatternBlock` and `REPORT_ZONES` now
returns prose only. No code implements it.

That rule is not a preference: the todo already records that **93 bytes were
identical in runs 1+2 yet differed in run 3**, so two captures cannot establish
stability. `compare.mjs` provides pairwise plus a union `floor`, and a union floor
is not an adjudication. Meanwhile `c64-ram-capture` still advertises proving *two*
captures equivalent — the half the project's own measurement says is insufficient.
Left open with the two options stated and undecided.

## Verification

- `mcp__vice__vice_diagnose` called live; reply compared word-for-word against the
  2026-08-02 wording in the todo.
- `.claude/skills/vice-mcp-selector/` confirmed absent; `grep -c` on
  `.claude/CLAUDE.md` returns **0**.
- The surviving `vice-mcp-selector-docs.test.ts` assertion read at source and
  confirmed **negative** — `assert.ok(!text.includes(retired), …)` over a list of
  retired routes. Those references are the machinery keeping the skill deleted, not
  a dependency on it, which is why they were left alone.
- Both deletion commits confirmed with `git log --diff-filter=D`.
- Supervisor todo's `severity: blocker` confirmed intact after editing.

## Boundaries respected

`.claude/mcp/vice/` was **read but not edited**. Editing it is MCP maintenance, a
different task from triaging a todo about it. The host broker was **not** started —
it is a host action, not reachable from the container, and the tool's own error says
to ask the human. No emulator state was changed; the one call made was diagnostic
and failed before touching a machine.

## Flagged, not acted on

`.claude/worktrees/` holds **seven** leftover agent worktrees. Deliberately not
touched: a concurrent session has been active in this repo today, and reaping a
worktree that still holds uncommitted work would destroy it. Two existing pending
todos already cover worktree reaping defects.

## Next

Item 3 — the provenance-diff skill for `tools/diff-images.mjs`. Item 4, the RE
skill, is held for the user's return by their decision; it needs a scope call
before it is worth starting.
