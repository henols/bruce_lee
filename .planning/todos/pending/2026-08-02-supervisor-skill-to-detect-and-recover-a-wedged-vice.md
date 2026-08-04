---
created: 2026-08-02T12:10:44.677Z
title: Supervisor skill to detect and recover a wedged (not crashed) VICE
area: tooling
severity: minor
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

## Status 2026-08-04 (quick task 260804-dbf) — still open, but part 2 is settled

**Part 2 ("Where it lives — decide before building") no longer needs deciding.** The answer this
todo listed as "likely the honest answer" is what shipped: *both*. Two MCP tools now exist and are
reachable from an agent session as named functions — `mcp__vice__vice_diagnose` and
`mcp__vice__vice_recycle`. Confirmed live on 2026-08-04; see
`.planning/todos/completed/2026-08-02-vice-diagnose-and-vice-recycle-unreachable-from-agent-session.md`
for the evidence, which turns on the proxy returning its own broker-absence message rather than the
host's `Tool not found`.

That also clears the prerequisite this todo was waiting on. The sibling todo that blocked plan
01.3-05 is resolved.

**`vice_diagnose`'s own schema already encodes much of what part 1 was going to write down**, so the
skill must reference it rather than restate it. From the schema verbatim: it answers which of five
states the session's emulator is in — `restarted`, `checkpoint_trap`, `wedged`, `stale_read_path`,
`live` — with the evidence that produced the verdict; it may resume the machine once or twice to
measure a cycle bracket; **it leaves the machine PAUSED afterward, and resuming is the caller's own
next call**; and a `checkpoint_trap` verdict means the machine stopped *itself* at an armed
checkpoint and must **not** be recycled, because recycling a self-inflicted stop destroys a healthy
instance.

Note what that last point does to this todo's framing. The original text treats the hard case as
distinguishing *wedged* from *crashed* from *merely slow*. The tool adds a fourth that is more
dangerous than any of them: a self-inflicted checkpoint stop is indistinguishable from a wedge from
the outside, and the intuitive response to it — recycle — is destructive. That trap belongs at the
top of the skill, not in a troubleshooting table. It is also already logged in
`c64-program-recon`'s hazards, which the skill should point at rather than duplicate.

### What is actually left

Part 1 only: the triage narrative — when to suspect a wedge, that `vice_ping`'s `execution` field is
not a liveness signal, the cycle-bracket test, read-before-resume ordering, what evidence to capture
before recovering, and what is not recoverable. It **is** implementable as a skill now, because the
privileged actions it needs are MCP tools it can call, which is exactly what the hard constraint
requires.

### Blocked on

The host broker is not running (`vice_diagnose` reports no `broker.json` record exists at all). No
part of a triage skill should be written from the schema alone — the whole value of this todo is that
it encodes what four live incidents taught, and the five-state verdict path has **not** been
exercised end to end. Write it against a live wedge, or against a live healthy machine at minimum.
Starting the broker is a host action; the tool's own error says to ask the human.

### Unchanged

Severity stays `blocker`. Nothing here builds the skill.

## Status 2026-08-04 (quick task 260804-eu6) — part 1 is BUILT. Severity dropped to `minor`.

`.claude/skills/vice-wedge-triage/` exists, is registered by hand in `.claude/CLAUDE.md`'s skills
table, and passes the frontmatter checker. **Both halves of this todo are now discharged in the
shape it predicted — skill for the procedure, MCP tools for the privileged actions.**

The skill carries exactly what part 1 specified, and nothing the schemas already say:

- The four look-alike states as the opening table, with the destructive-response trap
  (`checkpoint_trap` → do **not** recycle) at the top rather than buried in troubleshooting, per
  this todo's own reordering note.
- Verdict → response, one row per verdict, because a verdict is not a suggestion to try things.
- **`vice_recycle`'s required `reason` IS the evidence capture** — it is written verbatim into a
  permanent, repo-tracked record under `.planning/incidents/` *before* anything is killed. That
  answers this todo's "what evidence to capture before recovering" without inventing a ritual:
  there is nothing separate to do, and a lazy `reason` is a lost incident.
- What is not recoverable, with the recorded incident where delete → soft reset → hard reset →
  single step all failed in sequence.
- The manual cycle-bracket fallback, four calls, for a session where `vice_diagnose` cannot answer.
- A per-claim provenance table, so the HIGH incident-derived content is not confused with the
  MEDIUM tool contract.

**Deliberately written despite this todo's "Blocked on".** That block said no part of the skill
should be written *from the schema alone* — and it is not: the substance is the four live incidents
already logged at HIGH, and every schema-derived claim is graded MEDIUM in the skill's own
provenance table and labelled unexercised. The broker is still not running (`vice_diagnose` reports
no `broker.json` record exists at all), so the alternative was leaving a `blocker` todo unactioned
for an unknown period while the cost it names — every agent reinventing the triage — kept accruing.

### What is genuinely left

**Exercise the five-verdict path end to end against a live machine.** Until then those rows stay
MEDIUM. Two of the five are cheap to force deliberately rather than waiting for an incident:

- `checkpoint_trap` — arm a stopping exec checkpoint at the live IRQ handler entry (`$1103` on both
  releases), let it stop the machine, then call `vice_diagnose`.
- `live` — call it on a healthy instance, and confirm the bracket it reports is non-zero and that
  the machine is left paused afterwards.

`wedged` and `stale_read_path` cannot be manufactured on demand; take them opportunistically the
next time an incident happens, which this log says will not be long.

**A defect found while writing it, filed not fixed:**
[[2026-08-04-vice-diagnose-checkpoint-trap-shapes-miss-mid-handler-arming]] — the trap verdict
matches two shapes, and a checkpoint armed *mid*-handler with a non-zero hit count matches neither,
falling through to `wedged`, whose response is the destructive one. Mitigated skill-side for now.
That is also the first candidate for "move the remembered procedure into the tool" once decided.
