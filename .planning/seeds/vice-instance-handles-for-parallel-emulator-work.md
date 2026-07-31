---
title: Instance handles are how parallel emulator work becomes possible — but nothing needs it yet
trigger_condition: A phase first needs two plans driving VICE simultaneously, i.e. the ROADMAP's "VICE steps still queue" constraint becomes the actual bottleneck rather than a precaution
planted_date: 2026-07-31
---

# MCP cannot tell subagents apart, so the caller must carry its own identity

Extracted from `.planning/notes/vice-mcp-selector-design.md` when Phase 1.1/1.2 were split, to keep
speculative scope out of both.

## The problem it solves

`tools/vice-pool.sh:33` justifies a pool partly on throughput — *"N instances interleave and scaling
is near-linear."* That assumed several actors could each hold an instance. Researched finding 5
(recorded in the design note, HIGH confidence) says they cannot: subagents and worktree executors
share their parent session's MCP connections, and **MCP gives the proxy no way to tell which subagent
is calling.** One session, one proxy, one emulator — so a parallel executor wave serialises no matter
how many instances the host is running.

## The design

Stop trying to infer the caller; make it explicit. **The proxy exposes instance handles:**
`mcp__vice__instance_open` returns a handle, and every tool takes it as a parameter. A plan tells each
executor which handle it owns. The proxy never needs to know who is calling, because the caller
carries its identity in the arguments.

Under a fixed pool that is a rationing scheme with a hard cap. Under the on-demand broker from Phase
1.2 it is simply "open another one."

Two guardrails the implementation must honour:

- The handle parameter is **optional while exactly one instance is open, required beyond that**.
  Optional-always invites an agent to omit it and silently clobber a sibling's emulator — and that
  failure would present as nondeterministic emulator behaviour, which is the most expensive class of
  bug in this project.
- **Handles, not ports, are the snapshot naming key.** The old convention of prefixing snapshot names
  with the port breaks once ports are recycled across sessions.

## Why this is a seed and not part of Phase 1.2

Nothing needs it. `ROADMAP.md`'s standing constraints explicitly serialise emulator work, so no
current plan is blocked by the absence of parallel VICE access. Building it now would be scope
justified by a hypothetical, and it is the piece resting on the single finding with the weakest
independent support — one subagent pass, whose own closing summary contradicted this very finding.

Verify finding 5 first-hand before building on it. The `.planning/todos/pending/` lifecycle spike
already covers the observation ("from one session, spawn a subagent that calls the echo tool; check
whether a second pid appears").

## The observable signal that the trigger has fired

A phase plan wants two of its plans to drive VICE concurrently and the roadmap constraint is what
stops it — not host instance count, and not a lease conflict. Phases 5 and 6 are the likely origin,
since both scale subsystems out as parallel plans.

If finding 5 turns out to be wrong and subagents *do* get their own connections, this seed is void:
parallelism would come from the broker directly and handles would be unnecessary complexity.
