---
created: 2026-08-01T17:30:00.000Z
title: mcp__vice__* tools absent from the plan-01-04 executor's tool schema -- blocked Tasks 2-4
area: tooling
severity: major
files:
  - .planning/phases/01-recovery-provenance/01-04-PLAN.md
---

## Problem

Plan 01-04 (this phase's on-demand-load detector) has two tasks (Task 2, Task 3) whose entire
action is live emulator work performed through `mcp__vice__*` tool calls the executing agent
issues in its own turn -- per `.claude/CLAUDE.md` § "Emulator Access" and the 2026-08-01 hard rule
recorded in `.planning/STATE.md`, this is the *only* permitted route, and access is described as
"per-session and boot-fresh... granted on that session's first forwarded tool call."

When this plan's executor agent was spawned (a worktree-isolated `gsd-executor` subagent, model
Claude Sonnet 5, `/gsd-execute-phase` orchestrator), its actual tool schema for the turn contained
exactly five tools: `Read`, `Write`, `Edit`, `Bash`, `Skill`. **No `mcp__vice__*` tool was present
in the schema at all** -- not "unreachable" (which `vice_ping` would report as one of the three
documented unreachable statuses), but structurally absent, as if the MCP server were never wired
into this agent's tool list in the first place.

This is very likely the same class of bug the harness's own `documentation_lookup` guidance names
for a different MCP server: "upstream bug anthropics/claude-code#13898 strips MCP tools from
agents with a `tools:` frontmatter restriction." Context7 has a documented CLI fallback (`ctx7`)
for exactly this reason. **VICE has no such fallback, by design and by hard project rule** -- the
hard rule explicitly forbids any script, module, or driver from opening its own connection to host
VICE, reading broker state to find a port, or importing a transport module, even "cleanly." A
`ctx7`-style CLI escape hatch for VICE would be exactly the prohibited second route, so building
one is not an option here the way it is for Context7.

**Consequence:** Task 2 (earn the armed set live: derive `loader_ranges` from live disassembly,
calibrate the idle window, prove teardown by enumeration) and Task 3 (bounded play-through, hit
attribution, supplementary dumps, `recovery/LOADING.md`) could not be executed. Task 1 (the pure
detector logic and artifact renderer, with no emulator dependency) was completed and committed
normally -- this is purely a live-tool-access problem, not a design or code problem.

## What was NOT done as a workaround (and must not be done)

- No direct HTTP/fetch call to the host VICE endpoint.
- No reading of `.claude/mcp/` or `.vice-supervisor/` broker/lease state to find a port.
- No shell/`curl` bypass of any kind.

Per the hard rule and per `.planning/STATE.md`'s own recorded history ("an executor, following an
orchestrator instruction to 'build a clean transport that does not import the blocked tree,' wrote
a fresh `fetch()` bypass straight to the host endpoint plus broker-grant discovery — discarded
unmerged"), any of the above would repeat a mistake this project has already paid for once. The
correct response to an absent sanctioned tool is to halt and report, not to reconstruct an
unsanctioned one.

## Solution

TBD -- this is a harness/agent-definition issue, not something a plan executor can fix from inside
its own turn. Candidate directions for whoever picks this up:

- Check whether the `gsd-executor` agent definition (or whatever spawns it under
  `/gsd-execute-phase`) carries a `tools:` frontmatter restriction that is stripping the `vice` MCP
  server's tools the same way #13898 describes for other MCP servers. If so, either widen the
  restriction to include `mcp__vice__*` explicitly, or spawn emulator-driving tasks through an
  agent/invocation path that does not declare a restricted tool list.
- Re-run this same plan's Task 2/3 in a session verified in advance to actually expose
  `mcp__vice__*` tools (e.g. a manual/interactive session, or after the harness-level fix above),
  rather than inside a worktree-isolated executor subagent, until the tool-stripping question is
  resolved.
- Once fixed, re-verify by calling `mcp__vice__vice_ping` as the very first action of a fresh
  session and confirming it returns an `ok` status with a machine and version, per Task 2's own
  precondition.
