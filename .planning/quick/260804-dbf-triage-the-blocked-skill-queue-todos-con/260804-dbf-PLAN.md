---
quick_id: 260804-dbf
description: "Triage the blocked skill-queue todos: confirm diagnose/recycle reachability, retarget the supervisor todo, close two stale todos"
date: 2026-08-04
status: planned
execution_note: |
  Executed inline (no gsd-planner/gsd-executor subagents) — session directives
  prohibit spawning subagents unless the user asks. GSD guarantees preserved:
  this PLAN.md, atomic commits, SUMMARY.md, STATE.md row.
---

# Triage the blocked skill-queue todos

Items 1 and 2 of the four-item skill queue the user approved. Item 3 (the
provenance-diff skill) is a separate quick task; item 4 (the RE skill) is held
for the user's return by their explicit decision.

## What changed the shape of item 1

Item 1 was scoped as *"redirect the wedged-VICE supervisor todo, because a
supervisor skill can't reach the emulator under the hard rule."* **That framing
was wrong and is withdrawn.** Reading
`2026-08-02-supervisor-skill-to-detect-and-recover-a-wedged-vice.md` in full: it
already states the hard constraint verbatim ("nothing may reach the host outside
`mcp__vice__*` … If a proposed design needs a container-side Node process to talk
to VICE, that design is dead"), and already resolves placement correctly —
"skill for the procedure, one or two MCP tools for the privileged actions it
calls," naming `vice_diagnose`/`vice_recycle`. Nothing needs redirecting.

What *has* changed since it was written is that the MCP half shipped, and the
sibling todo blocking it is now resolvable.

## Live confirmation obtained this session

`2026-08-02-vice-diagnose-and-vice-recycle-unreachable-from-agent-session.md`
asks exactly one thing as its "Suggested next step": confirm from a fresh session
whether the two tools are reachable. Tested:

| Check | 2026-08-02 result | 2026-08-04 result |
|---|---|---|
| Named `mcp__vice__vice_diagnose` function exists | absent | **present** (schema loads via ToolSearch) |
| Named `mcp__vice__vice_recycle` function exists | absent | **present** |
| Call is intercepted proxy-side | no — host replied `Tool not found`, proving the name was forwarded | **yes** — reply is the proxy's own broker-absence message, tool-specific, never reaching the host |

The error-shape distinction is the load-bearing evidence, and it is the todo's own
diagnostic: `Tool not found` meant "forwarded to the host". The current reply is
`vice-proxy: the on-demand VICE broker has never been started on this host -- no
broker.json record exists at all`, which only proxy-local dispatch can produce.

Not verified, and stated as such: that `vice_diagnose` returns a correct *verdict*.
The host broker is not running, so no live bracket could be measured. Reachability
and interception are proven; behaviour is not.

## Tasks

### Task 1 — Resolve the reachability todo

- **files**: `.planning/todos/pending/2026-08-02-vice-diagnose-and-vice-recycle-unreachable-from-agent-session.md`
  → `.planning/todos/completed/`
- **action**: Append a dated resolution recording the three checks above, the
  error-shape evidence, and the one thing still unverified. Move to `completed/`.
- **verify**: File is in `completed/`, `pending/` no longer lists it.
- **done**: The todo states it is resolved, with how.

### Task 2 — Retarget the supervisor todo

- **files**: `.planning/todos/pending/2026-08-02-supervisor-skill-to-detect-and-recover-a-wedged-vice.md`
- **action**: Add a dated status section: its part-2 placement question is
  **settled** (both MCP tools exist and are reachable); its prerequisite sibling
  is resolved; the remaining work is part 1, the triage narrative, which is
  implementable as a skill because the privileged actions are now MCP tools it
  can call. Record that `vice_diagnose`'s own schema already encodes the
  five-state verdict and the checkpoint_trap trap, so the skill must not restate
  it — and that verifying any of it needs the host broker running. Stays
  **pending**; it is not done.
- **verify**: Severity/priority untouched; no claim that the skill exists.
- **done**: A reader knows exactly what is left and what no longer applies.

### Task 3 — Close the two STALE todos

- **files**: `.planning/todos/pending/move-drift-classification-into-ram-compare.md`,
  `.planning/todos/pending/collapse-vice-selector-skill-into-proxy.md`
  → `.planning/todos/completed/`
- **action**: Both carry self-declared `STALE 2026-08-01` banners.
  `move-drift-classification` asked where the run-set drift classification should
  live; commits `0db0127`/`e1b55c1` answered it — it lives in
  `.claude/skills/c64-ram-capture/scripts/compare.mjs`, pure logic over committed
  captures, wired into the skill, and that change also **corrected** the rule by
  adding `$D000-$DFFF` as volatile (I/O, not RAM) and documenting `$FAD8`/`$FC51`
  as known-unexplained. `collapse-vice-selector` says its own fallout "is already
  done" and it "may be closeable as-is"; `.claude/skills/vice-mcp-selector/` does
  not exist. Append the resolution to each, then move both.
- **verify**: `.claude/skills/vice-mcp-selector/` absent; `compare.mjs` present and
  committed.
- **done**: Neither appears in `pending/`.

### Task 4 — Log the reachability finding

- **files**: `.planning/RE-FINDINGS.md`
- **action**: Append one entry under the existing tooling section: proxy-local
  synthetic tools are now reachable as named functions, and the error-shape test
  distinguishes proxy-side interception from host forwarding. `Evidence:` and
  `Confidence:` per project rule. Append-only.
- **done**: Entry present and graded.

## must_haves

- **truths**: the reachability claim rests on the error-shape distinction, not on
  a schema existing; nothing asserts `vice_diagnose` was behaviourally verified;
  the supervisor todo stays open.
- **artifacts**: two todos moved to `completed/` (three including Task 1), one
  retargeted in place, one RE-FINDINGS entry.
- **key_links**: `vice_diagnose` tool schema, commits `0db0127`, `e1b55c1`.

## Out of scope

- Building the wedged-VICE triage skill (needs the host broker to verify).
- Starting the host broker — not reachable from the container, and the tool's own
  error says to ask the human.
- The provenance-diff skill (separate quick task) and the RE skill (held).
