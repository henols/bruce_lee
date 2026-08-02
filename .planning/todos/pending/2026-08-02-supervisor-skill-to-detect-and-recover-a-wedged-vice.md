---
created: 2026-08-02T12:10:44.677Z
title: Supervisor skill to detect and recover a wedged (not crashed) VICE
area: tooling
severity: blocker
files:
  - .claude/mcp/vice/resources/vice-supervisor.sh
  - .claude/mcp/vice/resources/vice-pool.sh
  - .claude/mcp/vice/vice-proxy.mjs
  - .planning/todos/pending/2026-08-01-vice-silent-stall-during-01-04-task3-saeger-playthrough.md
  - .planning/todos/pending/2026-08-01-vice-silent-stall-attempt4-froze-at-same-pc-as-attempt3.md
  - .planning/todos/pending/2026-08-01-vice-registers-frozen-after-reset-during-01-04-task2.md
  - .planning/todos/pending/2026-08-01-vice-crashes-three-times-during-sustained-execution-01-04-task2-saeger.md
---

## Problem

When the host VICE wedges mid-session, an agent driving it has **no recovery path at all** —
the only exit is to abandon the session. This has already halted plan 01-04 across at least
three separate attempts (see the four sibling todos listed above), and it is the single
most expensive recurring failure in live-emulator work so far.

**The gap is specific, and it is not the one the existing supervisor covers.**
`.claude/mcp/vice/resources/vice-supervisor.sh` handles the *loud* failure: x64sc exits, the
respawn loop notices the dead child, collects crash evidence, bumps the restart epoch, and
starts a fresh one with backoff. That works. What nothing handles is the *silent* failure:
**x64sc is still alive and the MCP still answers, but the emulated CPU has stopped retiring
cycles.** No process exit means no respawn trigger, no epoch bump, and no evidence
collection — the supervisor is structurally blind to it.

The failure signature is already well characterised from live evidence:

- `vice_ping` reports `status:"ok", execution:"running"` continuously and indefinitely.
  **`ping`'s `execution` field is not a liveness signal** — this is the core trap.
- A `vice_cycles_stopwatch reset → vice_execution_run → vice_ping xN → read` bracket returns
  **exactly `0` cycles**, reproducibly, across independent brackets.
- `vice_registers_get` returns a byte-for-byte identical snapshot across resumes, an explicit
  pause, and even `vice_execution_step({count:1})`.
- Checkpoint bookkeeping (`vice_checkpoint_add`/`list`/`delete`) keeps returning healthy,
  self-consistent responses throughout — so "the tools respond" proves nothing.
- Observed shapes vary: registers-only staleness while `vice_vicii_get_state` still moved
  (Task 2), through to whole-machine zero-cycle freeze across two different disk images.
  Two saeger stalls froze at the **identical `PC:2014`** in different sessions.

So today, every agent hitting this has to (a) know the cycle-bracket trick, (b) invent the
same triage from scratch, and (c) discover there is no remedy. That's the cost this todo
exists to remove.

## Solution

Two parts, and the second one is the open design question.

**1. The detection/triage procedure (the skill's real content).** A callable
"VICE looks stuck — is it, and what now?" routine that encodes what took four incidents to
learn:

- Never trust `vice_ping`'s `execution` field as liveness. The **cycle bracket is the only
  test** — reset stopwatch, run, poll, read; `0` cycles twice in a row is a wedge.
- Distinguish the three states that look alike from the outside: *crashed and respawned*
  (restart epoch changed — the run is void, and this is the already-solved case),
  *wedged but alive* (epoch unchanged, `0` cycles), and *merely slow* (cycles advancing but
  far below the ~991,000/s baseline — a documented separate hazard at ~6,000/s).
- Order the reads correctly, since most state reads pause the emulator — read first, poll
  with `vice_ping`, resume exactly once.
- Say plainly what is and is not recoverable, and what evidence to capture before recovering
  (the current stall todos exist precisely because nobody could capture host-side state).

**2. Where it lives — decide before building.** The user's framing: it may belong inside the
VICE MCP if it fits as a natural piece of it. Options, in rough order of preference:

- **An MCP tool** (`vice_health` / `vice_recycle`, names TBD) — the strongest fit for the
  *recovery* half, because actually replacing a wedged instance requires host-side action,
  and `mcp__vice__*` is the only permitted route to the host. A skill alone can diagnose but
  cannot fix. Note this needs a real supervisor-side change: recycling a *live-but-wedged*
  process is a new capability, not a config knob on the existing crash path.
- **A skill** (`.claude/skills/`) — the right home for the triage narrative, the ordering
  rules, and the "what does this mean" judgement, which don't belong in a tool schema.
- **Both** — likely the honest answer: skill for the procedure, one or two MCP tools for the
  privileged actions it calls.

**Hard constraint on any design here:** nothing may reach the host outside `mcp__vice__*`.
No script, test or driver may open its own connection, read broker state to find a port, or
import a transport module. If a proposed design needs a container-side Node process to talk
to VICE, that design is dead — say so and replan. Recovery actions must be exposed *through*
the MCP or not at all.

**Prerequisite to check first:** whether a wedged x64sc can even be detected host-side
(a hung GTK/OpenGL event loop, per the sibling todos' hypothesis) and whether it can be
killed and replaced cleanly while the pool registry still lists it as healthy — the pool's
own comments already warn that a stale registry entry may have been recycled onto an
unrelated pid, so blind killing is not safe.

**Related:** the incident evidence lives in the four sibling todos and `.planning/RE-FINDINGS.md`.
Whatever gets built should fold the cycle-bracket liveness test into that findings log's
eventual RE skill rather than duplicating it in a third place.
