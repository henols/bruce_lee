---
spike: 005
name: concurrent-x64sc-ceiling
type: standard
validates: "Given K x64sc instances brought up on the host with the broker stopped, when K is raised through a ladder, then the log shows the largest K at which every instance answers an MCP round trip and none dies within a settle window"
verdict: NOT RUN
related: [003]
tags: [vice, host-only, capacity, designed-not-run]
---

# Spike 005: Concurrent x64sc Ceiling

## Status: DESIGNED, NOT RUN, and NOT RUNNABLE FROM THIS CONTAINER

This spike is specified, not executed. It cannot be run from inside this container, for two
independent reasons that both have to hold at once for the experiment to make sense:

1. The experiment requires several `x64sc` processes brought up simultaneously (and later,
   sequentially) on the **host** — that is the entire thing under test.
2. Per `.claude/CLAUDE.md` § Emulator Access, the `mcp__vice__*` tools are the only permitted
   route to the emulator, and each session's tool set grants access to exactly one instance. There
   is no way, from inside this container, to bring up a second, third or sixteenth `x64sc` process
   alongside the one a session already holds.

There is no route from here that could run this experiment. It is therefore specified for a
**human to run on the host**, and every section below that would normally report a result stays
empty — "What to Record", "Reading the result" and the results table — until a human does.

## Why there is no driver script

Every other spike in this set (001–004) ships an `.mjs` driver alongside its README. This one does
not, and the absence is deliberate — not an oversight to be quietly "fixed" by a later session.

A script committed to this repo that launched `x64sc` directly would be a second route to the
emulator, and that is exactly what this project's hard rule forbids: *"No script, module, test or
driver may open its own connection to the host VICE, read broker state to find a port, or import a
transport module as a library. Reimplementing that route cleanly is the same violation as importing
it."* A driver for this specific spike would do precisely that — launch and probe `x64sc` processes
outside the `mcp__vice__*` surface — so it cannot exist as committed code, no matter how carefully
scoped or how obviously experiment-only its intent.

The host commands below are copy-pasteable **text** a human runs directly in a host shell, not code
this repo ships or executes.

## What This Validates

`VICE_BROKER_MAX` defaults to 16 (`vice-broker.sh:442`), and that number has never been tested. The
only concurrency evidence this project actually has is a crash at **3** simultaneous boots: three
spares warmed at once all died in a GPU/audio race — one SEGV, one exit 1, one exit 0, all at an
identical spawn second — because `x64sc` is not headless and opens a GTK3 window, an OpenGL 4.6
context and a PulseAudio handle (see the defects todo,
`.planning/todos/pending/2026-08-01-vice-broker-spare-warming-and-stale-grant-defects.md`, Defect
1).

That crash was during concurrent **initialization**. Whether the host survives 8 or 16 instances
that are already **running** — past their init race, sitting idle or actively serving MCP calls —
is a different question, and it is completely unanswered. **This is now the binding open question
on wave width, as of 2026-08-02.** Decision 4 of the lifecycle-decisions note, which originally
conditioned this spike's importance on the grant timeout ceasing to be the binding constraint, has
been retracted: boot was measured live on the host at sub-second, and the 25s grant-timeout
deadline turns out to imply a cliff at roughly 36 agents — more than double `VICE_BROKER_MAX=16` —
so the timeout was never the binding constraint in the first place. `VICE_BROKER_MAX` is, and the
Node broker rewrite would otherwise inherit 16 as an unexamined constant. This question originates
from `.planning/notes/vice-broker-lifecycle-decisions.md` Decision 5.4, which names it explicitly
and links back here.

### New data point — 2026-08-02

Four concurrent x64sc instances (3 warm spares + 1 granted) ran on the host simultaneously on
2026-08-02 with no incident, so the measured floor on the ceiling is now at least 4. Caveat: they
were brought up serialised, one per pass, and were idle rather than actively serving, so this bears
on Arm A's steady state and says nothing about Arm B's init race. Arm A's ladder can therefore
start above K=4 if the human wants to save time, without deleting the lower rungs from the design.

## How to Run

On the host, by a human, with the broker **stopped first** — so it does not warm spares into the
middle of the measurement. Two arms, because the two failure modes are different and conflating
them is exactly what makes "16 vs. a crash at 3" read as a contradiction rather than two separate
facts.

### Arm A — the steady-state ceiling (sequential)

Bring instances up **one at a time**, with a settle gap between each, on distinct ports clear of the
band VS Code occupies (`127.0.0.1:6511` is held by VS Code — see the defects todo's "Also
observed"). After each new instance comes up, probe **every** instance already running with a real
MCP round trip — not a socket accept, which can succeed before the C64 has finished booting.

Ladder K through 1, 2, 3, 4, 6, 8, 12, 16, stopping at the first K where a probe fails or an
instance dies.

Host shell, per instance (vary the port each time), based on the hand-run invocation the defects
todo records as always having worked:

```bash
x64sc -mcpserver -mcpserverhost 0.0.0.0 -mcpserverport <port>
```

### Arm B — the init race, as a control

Bring K instances up **simultaneously** and confirm the known failure independently. This arm
exists to establish that the two arms measure different things, so a sequential ceiling of, say, 12
and a simultaneous ceiling of 2 are both real, non-contradictory answers.

## What to Record

*(empty — fill in when a human runs this on the host)*

Per K: which ports came up, which answered a probe, any exit statuses and signals (a SEGV is status
139), host RSS and swap at that K, whether the GPU/compositor visibly degraded, and whether any
instance died **later** — during the settle window rather than at launch, which would mean the
ceiling is a slow resource leak rather than a hard limit.

Once, in addition: the host's own specs — CPU, RAM, GPU and driver, and whether a compositor is
running. Without those the number does not transfer to another machine, and the whole point of this
spike is to replace a guessed constant with a measured one.

## Reading the result

*(empty — fill in when a human runs this on the host)*

The ceiling is the largest K at which all K instances answer an MCP round trip and none dies inside
the settle window. `VICE_BROKER_MAX` should then be set to that number minus a stated safety margin.

Three possible outcomes, and what each means:

- **Ceiling under 16** — the current default is optimistic, and the rewrite must lower
  `VICE_BROKER_MAX` to match what was actually measured.
- **Ceiling at or above 16** — the default is safe, and the cap is whatever `VICE_BROKER_MAX` is
  set to, since the grant timeout (Decision 4, retracted 2026-08-02) has roughly 36 agents of room
  before it would bind.
- **Ceiling that moves between runs** — the limit is contention, not a fixed count, and the broker
  needs a probe-based admission check rather than a hardcoded max.

## Results

*(empty — NOT RUN)*

## Limits of this evidence, in advance

One host, one GPU, one driver version, one compositor. Whatever number comes out of this is a
property of *this* machine, and re-measuring is the price of moving to a new host. Say that
explicitly here, in advance, so the number does not become folklore the way `VICE_BROKER_MAX=16`
already has.

## Related

- `.planning/notes/vice-broker-lifecycle-decisions.md` — Decision 5.4 names this question and links
  here.
- `.planning/todos/pending/2026-08-01-vice-broker-spare-warming-and-stale-grant-defects.md` —
  Defect 1, the init-race crash at 3 that motivates Arm B.
- `.planning/spikes/003-timeout-budgets/README.md` — house style for this spike set; related as a
  sibling spike, not a dependency.
