---
title: The VICE broker becomes one Node application, and its lifecycle policy is rewritten rather than translated
date: 2026-08-01
corrected: 2026-08-02
context: >
  Produced by a /gsd-explore session on rewriting the host VICE broker (tools/vice-broker.sh,
  tools/vice-pool.sh, tools/vice-supervisor.sh, lib/container-guard.sh, lib/repo-root.sh — 2,997
  lines of shell) in Node. All line references below were verified by reading the cited files
  during that session; none are carried over from memory or an earlier document.
---

# The VICE broker becomes one Node application, and its lifecycle policy is rewritten rather than translated

## Scope: what this document is, and is not

This is a design record, written before the work it describes, whose consumer is the FOLLOW-ON
rewrite task. Nothing changed in the codebase when this note was written: no Node broker exists
yet, no shell script has been deleted, and `GRANT_POLL_TIMEOUT_MS` has not been touched. Every
decision below is a plan for that later task, not a description of code already in the tree.

The rewrite task this note feeds is expected to want its own `/gsd-discuss-phase` (or equivalent
`--discuss`) pass before it is planned in detail — this note is meant to be that discussion's
input, not a replacement for it. Where this note says a question is open, that is a question for
the rewrite's own discuss cycle to close, not one this note answers by omission.

This is quick-task work, not a ROADMAP phase — see Decision 7 for why, and for the precedent that
already established the pattern.

## Correction — 2026-08-02: boot time measured, and Decision 4 withdrawn

Boot time was measured live on the host on 2026-08-02, via the nanosecond `launched_at`/`ready_at`
fields in the broker's own `.vice-supervisor/spares/*.json` records, read before the broker was
shut down. It came out sub-second — roughly 0.65s as an upper bound — not the ~8s Decision 4's
arithmetic assumed, an input that was labelled an assumption in the same breath as its own table.
That is roughly 11x smaller than the assumption, and it withdraws Decision 4's conclusion below:
the 25s grant timeout was never the constraint capping wave width. `VICE_BROKER_MAX` (Decision 5.4,
and spike 005) is the binding constraint on wave width, and always was.

| Port | launched_at (ns) | ready_at (ns) | elapsed |
|---|---|---|---|
| 6541 | 1785658461697376099 | 1785658462352542811 | 0.655 s |
| 6542 | 1785658462399346879 | 1785658463038645810 | 0.639 s |
| 6543 | 1785658820902732602 | 1785658821608383711 | 0.706 s |

These are upper bounds, not exact boot times: `ready_at` is stamped when `maintain_spares()`
observes `probe_ready()` succeed, and passes run every `VICE_BROKER_POLL_MS=500`, so up to ~0.5s of
each figure is poll latency rather than boot itself, making the figure an upper bound on the true
value rather than the true value itself — true boot sits somewhere in ~0.14–0.71s. The claim this
note makes anywhere it refers to boot time is "sub-second, roughly 0.65s measured, true value at or
below that" — never a bare figure standing alone as the boot time. A bare figure presented that way
is exactly the folklore this project has already paid for once.

## Current shape

| File | Lines | Who invokes it |
|---|---|---|
| `vice-broker.sh` | 1,656 | a human, on the host |
| `vice-pool.sh` | 611 | nobody (referenced only in `.mjs` comments) |
| `vice-supervisor.sh` | 443 | the broker, once per instance, via `nohup` in `launch_instance()` |
| `lib/container-guard.sh` + `lib/repo-root.sh` | 287 combined | sourced by all three |

That is 2,997 lines total, all of it running on the **host**. Every one of the three top-level
scripts refuses to run in-container: `container_guard_enforce()` checks for the container and
exits 2 if it finds one. The container half of this subsystem is already `.mjs` and speaks to the
host broker through a filesystem protocol under `.vice-supervisor/` — `requests/`, `grants/`,
`leases/`, `spares/`, `denials/`, `broker-instances.json`, and a per-instance `epoch.json`. None of
that protocol changes as part of this rewrite; the rewrite replaces what answers it, not the
channel itself.

## Decision 1 — the broker is the only application

`vice-pool.sh` is dead: nothing invokes it, and the broker carries its own
`launch_instance()`/`next_free_port()`/registry logic that duplicates what the pool script once
did. The rewrite deletes it outright, along with `vice-pool.test.mjs`.

`vice-supervisor.sh` is not dead, but it is not a CLI either — it is spawned by the broker as its
respawn-and-epoch child, one per running instance, via `nohup` inside `launch_instance()`. The
rewrite absorbs it into the broker as an in-process child supervisor: `child_process.spawn` of
`x64sc` directly, per-child respawn, epoch bookkeeping in process, instead of a second shell
script the broker launches and then has to track.

**Open question the rewrite has to answer, not sidestep:** the supervisor has one genuine
remaining human user — a standalone, non-MCP recovery pipeline that operates on
`vice-supervisor.sh`'s own crash logs and epoch files independently of the broker's request/grant
protocol. Absorbing the supervisor into the broker without first answering what happens to that
pipeline would silently remove a capability nobody asked to remove. This note deliberately does
not resolve it — it names it as an OPEN QUESTION precisely so it cannot be dropped by omission
when the absorption happens.

## Decision 2 — the host entry point stays a thin shell script

The lifecycle logic moves to Node; the human-facing launcher stays shell. `vice-broker.sh` shrinks
from 1,656 lines to a handful that resolve their own directory and exec `node` against the new
Node entry point.

Three reasons:

1. The human types an absolute HOST path to invoke it. That path is exactly what
   `brokerHostPath()` (in `vice-proxy.mjs`) and `hostLaunchInstructions()` (in
   `install-resources.mjs`) already surface to the operator, so the invocation surface is fixed
   independently of what runs behind it.
2. A `.mjs` file is not reliably directly executable across hosts and shells.
3. `node`'s location on the host is not knowable from inside the container.

The launcher has exactly three responsibilities, and no others: resolve its own directory, verify
`node` exists on `PATH` and fail with a legible message naming the missing dependency if it does
not, and `exec` into the Node entry point. No lifecycle logic lives in the shell file, no JSON
parsing, no state.

A deliberate benefit falls out of keeping the filename: the container-side path builders that name
`tools/vice-broker.sh` (`brokerHostPath()`, `hostLaunchInstructions()`) keep working unchanged,
because the thing at that path is still a script called `vice-broker.sh` — it is simply thinner.

## Decision 3 — the pool floor becomes 1, not 3

What the knob currently means: `VICE_BROKER_SPARES` defaults to 3 (`vice-broker.sh:431`) and
counts *ready, probed, unclaimed* instances via `count_ready()` over `spares/*.json` with state
`ready`. A claimed instance moves to `grants/` and stops counting toward that total — so three
live sessions, at the default, put **six** x64sc processes on the host at once (three granted,
three warm replacements).

Three reasons the target is 1, not 3:

1. **A wave arrives as a burst.** A `/gsd-execute-phase` wave requests its instances within
   milliseconds of each other, so spare #2 is claimed almost immediately after spare #1, and the
   boot queue becomes the bottleneck regardless of how many spares were sitting warm. Holding
   spares 2..N buys nothing against a burst arrival pattern.
2. **x64sc is not headless.** Its own startup log shows a GTK3 window, an OpenGL 4.6 context, and
   a PulseAudio handle — so holding 3 permanently means paying for 3 GPU contexts across the ~95%
   of wall-clock time only one session is actually live.
3. **A machine is never shared between agents.** Exclusivity is a hard requirement of this
   project's design, not a nice-to-have, so a spare is only ever a latency optimisation over a
   cold boot — never a capacity mechanism.

Kill-on-release stays. The existing `teardown()` **kill-never-recycle** property — a released
instance is killed, never recycled back into the spare pool — is named here explicitly as a
property the rewrite MUST preserve, because it is what keeps every granted instance a known-clean
boot-fresh machine. One replacement boot is enqueued immediately on release, exactly as today, just
against a floor of 1 instead of 3.

**Strengthened 2026-08-02:** a sub-second measured boot makes holding warm spares beyond the first
even less valuable than the three arguments above already made it — the latency a spare buys back
is now known to be under a second, not an unmeasured guess.

## Decision 4 — RETRACTED (2026-08-02): the 25s grant timeout was never the cap on wave width

### The withdrawn version — the original conclusion, as recorded 2026-08-01

`GRANT_POLL_TIMEOUT_MS` defaults to 25000 (`.claude/mcp/vice/vice-broker-client.mjs:213`) — this is
the container-side deadline the client polls against while waiting for a grant. Spike 003 measured
the actual tool-call budget at >=150s (`.planning/spikes/003-timeout-budgets/README.md:139`) and
recorded that a cold x64sc launch is seconds (`:104-105`).

| Wave width | Last agent waits | Under the 25s ceiling | Under the measured >=150s |
|---|---|---|---|
| 1 | 0s (takes the warm one) | yes | yes |
| 3 | ~16s | yes | yes |
| 4 | ~24s | on the cliff | yes |
| 5 | ~32s | DENIED | yes |
| 10 | ~72s | denied | yes |
| ~18 | ~144s | denied | at the ceiling |

**The ~8s boot figure feeding this table is an ASSUMPTION**, stated here in the same breath as the
table rather than as a footnote — the wait column is arithmetic over serialised depth-1 boots
(Decision 5.1), not a measurement. Measuring real boot time is exactly what would turn this table
from arithmetic into evidence.

The conclusion: the 25s default caps every wave at ~3 agents regardless of pool size, and discards
roughly 125s of proven budget that spike 003 already established exists. Raising
`GRANT_POLL_TIMEOUT_MS` toward ~120000ms is a near-one-line change that widens waves NOW,
independently of the broker rewrite — nothing in the rewrite has to land before it. This is
written up as its own todo (task 2 of this quick task), and that todo is the thing to do first.

**This is the withdrawn version, kept verbatim.** It is committed and may be quoted elsewhere, so
it stays visible rather than deleted — see below for why it fell and what replaces it.

### Why it fell — the ~8s input was ~11x too large

The ~8s boot figure the table above rested on, already labelled an assumption in the same breath
as the table, was measured live on the host on 2026-08-02 at sub-second — roughly 0.65s as an
upper bound (see the correction banner above for the full port table and the poll-quantisation
caveat). Every entry in the withdrawn table was computed against the wrong input.

### The corrected arithmetic

| Wave width | Last agent waits | Under the 25s ceiling |
|---|---|---|
| 5 | ~2.8 s | fine |
| 10 | ~6.3 s | fine |
| 16 (= current `VICE_BROKER_MAX`) | ~10.5 s | fine |
| ~36 | ~25 s | the actual cliff |

### The corrected conclusion

The 25s deadline caps waves at roughly 36 agents, more than double `VICE_BROKER_MAX=16`. The
timeout was never the binding constraint; `VICE_BROKER_MAX` is (Decision 5.4, spike 005).

### Priority, lowered

The withdrawn version above called raising `GRANT_POLL_TIMEOUT_MS` a near-one-line fix and "the
thing to do first". That framing is retracted along with the conclusion it rested on. Raising it
toward ~120000ms (`.claude/mcp/vice/vice-broker-client.mjs:213`) remains a cheap robustness
improvement — headroom on a slow or contended host, within the spike-003 `>=150s` budget
(`.planning/spikes/003-timeout-budgets/README.md:139`) — and it is still independent of the
rewrite, but it is no longer urgent and no longer unlocks anything: the number it was meant to
unlock, wave width above ~3, was never actually gated by this constant. The priority is lowered,
plainly, and spike 005 / `VICE_BROKER_MAX` is what matters for wave width now.

## Decision 5 — four lifecycle defects a mechanical shell-to-JS translation would preserve

These four are policy defects, not syntax defects — a faithful line-by-line port from shell to
Node would carry every one of them forward unchanged, which is exactly why "rewrite" has to mean
"change the policy," not "translate the shell."

### 5.1 — No priority between launch reasons

`count_launching()` is ONE shared in-flight counter, consulted by both `process_requests()` (a
cold launch answering a real waiting request) and `maintain_spares()` (speculative warming toward
the floor). Either one blocks the other, so a boot nobody actually asked for can delay a request an
agent is actively waiting on — the log line when this happens reads `"request $id -- a launch is
already in flight, awaiting readiness"`. Serialising launches was the right fix for the GPU/audio
SEGV (Decision 3), but a single shared counter needs a PRIORITY on top of the lock, not just the
lock itself. The rewrite gets an explicit launch queue of depth 1 in which a request-driven launch
always precedes warming.

### 5.2 — The pool target counts files, not processes

`grant_from_spare()` was hardened to probe a spare at grant time, but `count_ready()` — the
function that decides whether a replacement needs launching — still trusts the `ready` state
recorded in a JSON file rather than checking the process it describes. Defect 3 of the defects todo
proved such a record can survive a broker stop, a broker start, and a full host restart with its
x64sc long dead. A host with N dead-but-recorded spares concludes the ready-floor invariant is
satisfied and launches nothing to replace them. The rewrite evaluates the floor over probe-live
instances, and reaps anything that fails the probe rather than trusting its file record.

### 5.3 — No FIFO fairness

`process_requests()` iterates the requests directory in glob (lexical) order over ids shaped
`req-832-1785608443993-9c3df302`, so `req-1000-...` sorts ahead of `req-832-...` purely as a string
comparison. Because each pass re-globs and re-picks from scratch, a burst of arrivals can jump an
unlucky agent's request repeatedly while its own deadline keeps running down — this is the
mechanism behind wave failures that look random and have no repeatable pattern. The rewrite uses an
arrival-ordered queue instead of a re-glob-and-pick loop.

### 5.4 — `VICE_BROKER_MAX=16` is unverified and inconsistent with a known crash at 3

`VICE_BROKER_MAX` defaults to 16 (`vice-broker.sh:442`). The only concurrency evidence this project
actually has is a crash at **3** simultaneous boots (Decision 3's GPU/audio race). But that crash
was during concurrent *initialization* — whether the host survives 8 or 16 x64sc processes
*already running and idle/active* is a completely different question, and it has never been
tested. This number, not the pool floor from Decision 3, is the real ceiling on how wide a wave can
get once the grant timeout (Decision 4) stops being the binding constraint. Spike 005 (task 3 of
this quick task) is the experiment designed to measure it.

**Elevated 2026-08-02:** with Decision 4 retracted, this is now the load-bearing open question on
wave width — the number that actually caps a wave, not a side concern. Spike 005 is promoted from
nice-to-have to the next thing worth doing. New data point from the same 2026-08-02 host run: 4
concurrent x64sc instances ran on the host simultaneously (3 warm spares plus 1 granted) with no
incident, so the floor on the ceiling is now at least 4, measured. Those four were brought up
serialised, one per pass, so this data point bears on the steady-state arm of spike 005 and says
nothing about the simultaneous-init arm — 16 remains otherwise unverified, exactly as this
subsection already said.

### The foreground-only deployment shape, found fragile — 2026-08-02

The reap-everything-on-signal contract itself is deliberate and stays: `260801-qpq` chose it on
2026-08-01 because orphans cost more than an interrupted session, and nothing below reopens that
decision. The defect is the deployment shape, not the contract — the broker only runs in the
**foreground**, with no detached mode, so a stray Ctrl-C, a closed terminal or a SIGHUP from an
ending SSH/VS Code session destroys every live session's emulator. Observed directly on
2026-08-02: `^C` produced `vice-broker: reap saw 4 recorded instance(s), terminated 4`, protocol
state was purged, and this session's own `mcp__vice__vice_ping` then returned `ECONNREFUSED`
against its cached grant. The rewrite should ship a detached or nohup-able run mode and/or a loud
warning at start naming what a Ctrl-C will destroy. **Reversing the reap contract is NOT the
fix** — nobody should read this paragraph as licence to undo qpq.

### A pair of indistinguishable states worth recording alongside these four

A deliberate zero-spares configuration and a broken host with no `curl` and no
`VICE_BROKER_PROBE_CMD` both warm zero spares — and they are distinguished only by a host stderr
line the container-side agent never sees. This is not one of the four numbered defects, but it is
the same shape of failure (a policy question the rewrite should not carry forward silently) and
belongs in the same section.

## Host validation of the 2026-08-01 shutdown work (260801-qpq) — PASSED 2026-08-02

This is the first host confirmation the broker has ever had. On 2026-08-02 a human started the
broker on the host with `VICE_BROKER_BASE_PORT=6540 tools/vice-broker.sh start 3`, and the
lifecycle behaviour designed and committed on 2026-08-01 as `260801-qpq` was exercised live for
the first time.

- **Serialised warming, zero races.** Four launches, strictly one per pass, each reaching `ready`
  before the next began: zero SEGV, zero exit-1, zero exit-0 races — the 2026-08-01 outage's
  three-simultaneous-boot failure (one SEGV, one exit 1, one exit 0, all at an identical spawn
  second) did not recur.
- **Instant grant from a warm spare:** `vice-broker: granted request
  req-132346-1785658820506-ed4707b4 -> port 6540 (from ready spare)`.
- **Floor restored:** `vice-broker: launched port 6543 (reason: spare)` immediately after the
  grant, restoring the warm floor to 3.
- **Clean reap of 4 on signal:** `^C` produced `vice-broker: reap saw 4 recorded instance(s),
  terminated 4`, followed by `vice-broker: purged protocol state under
  /home/henrik/dev/henrik/git/bruce_lee/.vice-supervisor` — 4 = 3 spares + 1 grant.

## Decision 6 — the name `spares` is part of the problem

`spares` reads as "extras beyond what is in use," but it denotes the entire ready pool — the only
pool that exists. This is not a purely cosmetic complaint: Defect 2 in the defects todo was itself
a misread of this knob's own stale `usage()` text during a live outage, where the operator
misdiagnosed a working `start [N]` argument as broken because the surrounding prose about "spares"
was stale and confusing under pressure. The rewrite renames it to something that says what it is —
a warm floor or ready floor. The rename is deliberate, not cosmetic, and should be treated as part
of the lifecycle-policy change, not a drive-by tidy-up.

## Decision 7 — this is quick-task work, not a ROADMAP phase

The deliverable of this project is the Bruce Lee reconstruction; the VICE broker is scaffolding
that carries it, not part of the reconstruction itself. `.planning/quick/` already shows this whole
subsystem was built this way, one quick task at a time: `260730-jty` (crash supervision),
`260730-mef` (the pool), `260730-q4b` (the resources layout), `260801-qpq` (the shutdown contract).
Phase 01 is halted right now precisely because of the defects this note records, so the rewrite is
remediation of a blocker to a ROADMAP phase, not itself a piece of that phase's scope. This note
exists partly so that nobody later promotes the rewrite to milestone scope by default — it is
scaffolding maintenance, sized and tracked the same way its five predecessors were.

## What is not yet measured

- **Boot time — MEASURED 2026-08-02.** Sub-second, roughly 0.65s as an upper bound; see the
  correction banner near the top of this note for the full port table and the poll-quantisation
  caveat. This gap is closed, and Decision 4's wave-width arithmetic has been redone against the
  measured figure rather than the ~8s assumption.
- **The concurrent-x64sc ceiling.** `VICE_BROKER_MAX=16` (Decision 5.4) is an unverified constant
  the rewrite would otherwise inherit unexamined. Spike 005 designs the experiment; it has not been
  run.
- **Whether the standalone non-MCP recovery pipeline still has a user.** Decision 1's open
  question — absorbing `vice-supervisor.sh` into the broker without answering this risks silently
  removing a capability.

## Related

- `.planning/todos/pending/2026-08-01-vice-broker-spare-warming-and-stale-grant-defects.md` — the
  four defects, live-diagnosed, that Decision 5 and Decision 3 draw on directly.
- `.planning/todos/pending/2026-08-01-raise-grant-poll-timeout-to-match-measured-tool-call-budget.md`
  — the near-one-line grant-timeout fix from Decision 4, written up as its own actionable item.
- `.planning/spikes/005-concurrent-x64sc-ceiling/` — the host-run experiment that answers Decision
  5.4.
- `.planning/notes/vice-mcp-selector-design.md` — the design this note amends. It designed the
  broker/proxy split and the request/grant/lease filesystem protocol that this note's rewrite
  keeps unchanged; this note is entirely about what runs behind that protocol on the host side.
- `.planning/spikes/003-timeout-budgets/README.md` — the source of the >=150s tool-call budget
  measurement that Decision 4's table is built against.
- `.planning/todos/pending/2026-08-02-broker-atomic-write-temp-files-leak-into-the-pool-dir.md` —
  the atomic-write temp-file leak found during the 2026-08-02 host validation run.
- `.planning/todos/pending/2026-08-02-vice-broker-has-no-detached-run-mode.md` — the
  foreground-fragility item above, filed as its own todo.
- `.planning/todos/pending/2026-08-02-broker-boot-time-log-rounds-sub-second-to-zero.md` — why
  the ~8s assumption went unchallenged for a day.
- `.planning/RE-FINDINGS.md` — the durable record of the 2026-08-02 measurement, the supersession
  of the 2026-08-01 grant-poll entry, and the defect-4 reproduction.
