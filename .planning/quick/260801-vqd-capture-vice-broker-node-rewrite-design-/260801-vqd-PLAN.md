---
phase: quick-260801-vqd
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
requirements: [QUICK-260801-vqd]
files_modified:
  - .planning/notes/vice-broker-lifecycle-decisions.md
  - .planning/todos/pending/2026-08-01-raise-grant-poll-timeout-to-match-measured-tool-call-budget.md
  - .planning/spikes/005-concurrent-x64sc-ceiling/README.md
  - .planning/RE-FINDINGS.md

must_haves:
  truths:
    - "`.planning/notes/vice-broker-lifecycle-decisions.md` exists and records all seven locked decisions — one application, thin shell launcher, pool floor of 1, the 25s grant-timeout cap, the four lifecycle defects, the `spares` rename, and quick-task-not-phase scope — each with the reasoning that produced it, not just the conclusion."
    - "The note is specific enough to be the sole input to the follow-on rewrite task: every file:line citation it makes is one of the verified set supplied by this plan, and every number it derives rather than reads is labelled as derived."
    - "The note names the standalone non-MCP recovery pipeline as an OPEN QUESTION the rewrite must answer, rather than letting `vice-supervisor.sh`'s absorption silently drop its one genuine human user."
    - "`.planning/todos/pending/2026-08-01-raise-grant-poll-timeout-to-match-measured-tool-call-budget.md` exists with the same frontmatter shape as the other pending todos, states 25000 as the current default and ~120000 as the target, cites the >=150s measurement with its source, and says the change is independent of the rewrite and worth doing first."
    - "`.planning/spikes/005-concurrent-x64sc-ceiling/README.md` exists, follows spike 003's house style, and states in its own first section that the experiment cannot be run from this container and must be run by a human on the host."
    - "That README explains the ABSENCE of a driver script as a consequence of the project's hard emulator-access rule, so nobody later reads the missing script as an oversight and writes one."
    - "The `005-concurrent-x64sc-ceiling` directory contains exactly one file — its README — and no executable driver of any kind."
    - "`.planning/RE-FINDINGS.md` gains one appended entry for the 25s-vs-150s hazard, with `Evidence:` naming both sources and `Confidence:` separating the two directly-read constants from the assumed boot time and the arithmetic derived from it."
    - "No file outside `.planning/` is created, modified or deleted — in particular nothing under `.claude/`, and no shell script, `.mjs` module or test is written anywhere."
  artifacts:
    - ".planning/notes/vice-broker-lifecycle-decisions.md — the design note, and the input to the follow-on rewrite task"
    - ".planning/todos/pending/2026-08-01-raise-grant-poll-timeout-to-match-measured-tool-call-budget.md — the standalone near-one-line fix that widens waves now"
    - ".planning/spikes/005-concurrent-x64sc-ceiling/README.md — a host-run experiment design, status designed-not-run"
    - ".planning/RE-FINDINGS.md — one appended hazard entry, no existing entry edited"
  key_links:
    - "note Decision 4 -> the grant-timeout todo -> the RE-FINDINGS entry: one finding recorded in three registers with three different jobs (design rationale / actionable fix / durable session-to-session memory). All three must agree on the two constants and on the fact that ~8s boot is an assumption."
    - "note Decision 5.4 (VICE_BROKER_MAX=16 unverified) -> spike 005's question: the spike exists because the note refuses to plan against that number, so the note must link the spike and the spike must name the note as its origin."
    - "note Decision 1 (supervisor absorbed) -> the standalone recovery pipeline: the link the rewrite is most likely to break, which is why the note carries it as an open question rather than a footnote."
    - "CLAUDE.md's hard emulator-access rule -> spike 005 having no driver script: the rule is the reason for the absence, and the README is the only place that reason gets recorded."
---

<objective>
Capture the VICE broker Node-rewrite decisions as planning artifacts, so the decisions survive
this session and the rewrite can be planned from a document instead of re-derived from 2,997
lines of shell.

Purpose: phase 01 is halted on host VICE defects. A `/gsd-explore` session settled seven
decisions about rewriting the broker in Node — including that the rewrite must change lifecycle
POLICY rather than translate shell to JS, and that a 25s default in the container-side client is
capping every parallel wave at ~3 agents regardless of pool size. None of that is written down
anywhere yet, and the two people-facing consequences (a near-one-line fix worth doing first, and
a ceiling nobody has measured) have no home.

Output: three documents and one appended findings entry. THIS TASK WRITES DOCUMENTATION ONLY —
it does not perform the rewrite, does not create a Node broker, does not delete any shell script,
and does not change the grant timeout. Those are follow-on work that these documents specify.
</objective>

<execution_context>
@/workspaces/bruce_lee/.claude/gsd-core/workflows/execute-plan.md
@/workspaces/bruce_lee/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md

House-style exemplars and source material — read these, do not skim them:
@.planning/notes/vice-mcp-selector-design.md
@.planning/spikes/003-timeout-budgets/README.md
@.planning/todos/pending/2026-08-01-vice-broker-spare-warming-and-stale-grant-defects.md

Not @-included because of size — read the specific ranges named in the tasks:
- `.planning/RE-FINDINGS.md` lines 1-36 (the entry format and the confidence scale) and lines
  925-940 (the tail, and the `## Corrections to earlier entries` heading that marks the
  insertion point).
</context>

<hard_scope_boundary>
Read this before doing anything else. It is the thing most likely to go wrong.

**Every one of the seven decisions below is LOCKED.** They came out of a `/gsd-explore` session
that read the actual files. Do not revisit them, do not re-derive them, do not improve them, and
do not go looking for a better answer. Your job is to RECORD them well.

**Do not open, edit or create any file under `.claude/`.** Naming paths and line numbers from
`.claude/mcp/vice/` inside these documents is required and correct — CLAUDE.md § Emulator Access
was reworded in quick-260801-qpq precisely so this subsystem can be worked on and written about.
*Editing* that tree is out of scope for this task. The one permitted interaction is a directory
LISTING (`ls .claude/mcp/vice/`) in task 2, to avoid naming a test file that does not exist.

**Every file:line citation you write must be one from the verified set below.** They were read
first-hand. If a document seems to need a citation that is not in the set, either verify it
yourself by reading the file, or write the claim without a line number. Never invent a line
number — a wrong citation in a design note is worse than no citation, because the next session
acts on it.

**Verified citation set (use these, and only these, unless you verify more yourself):**

| Fact | Citation |
|---|---|
| `vice-broker.sh` is 1,656 lines; invoked by a human, on the host | `.claude/mcp/vice/resources/vice-broker.sh` |
| `vice-pool.sh` is 611 lines, invoked by nobody (referenced only in `.mjs` comments) | `.claude/mcp/vice/resources/vice-pool.sh` |
| `vice-supervisor.sh` is 443 lines, spawned by the broker once per instance via `nohup` in `launch_instance()` | `.claude/mcp/vice/resources/vice-supervisor.sh` |
| `lib/container-guard.sh` + `lib/repo-root.sh` are 287 lines combined, sourced by all three; `container_guard_enforce()` refuses in-container with exit 2 | `.claude/mcp/vice/resources/lib/` |
| `VICE_BROKER_SPARES` defaults to 3 | `vice-broker.sh:431` |
| `VICE_BROKER_MAX` defaults to 16 | `vice-broker.sh:442` |
| `GRANT_POLL_TIMEOUT_MS` defaults to 25000 | `.claude/mcp/vice/vice-broker-client.mjs:213` |
| tool-call budget measured at >=150s; "a cold `x64sc` launch is seconds" | `.planning/spikes/003-timeout-budgets/README.md:139` and `:104-105` |
| a `state granted` record for a dead x64sc survived a broker stop, a broker start and a full host restart | `.planning/todos/pending/2026-08-01-vice-broker-spare-warming-and-stale-grant-defects.md` (Defect 3) |
| three simultaneous spares died in a GPU/audio race (one SEGV, one exit 1, one exit 0, identical spawn second); x64sc opens a GTK3 window, an OpenGL 4.6 context and PulseAudio | same todo (Defect 1) |
| the stale `usage()` text that caused Defect 2's misdiagnosis during a live outage | same todo (Defect 2) |

Identifiers verified in the same session, safe to name WITHOUT a line number: `count_ready()`,
`count_launching()`, `process_requests()`, `maintain_spares()`, `grant_from_spare()`,
`launch_instance()`, `next_free_port()`, `teardown()`, `brokerHostPath()` (in `vice-proxy.mjs`),
`hostLaunchInstructions()` (in `install-resources.mjs`), `VICE_BROKER_PROBE_CMD`. The broker's
filesystem protocol under `.vice-supervisor/`: `requests/`, `grants/`, `leases/`, `spares/`,
`denials/`, `broker-instances.json`, and a per-instance `epoch.json`. The in-flight log line is
`"request $id -- a launch is already in flight, awaiting readiness"`. Request ids are shaped
`req-832-1785608443993-9c3df302`.

**Exactly four files change. Nothing else.** No `MANIFEST.md` entry (spike 005 is a design, not a
run), no `CONVENTIONS.md` edit, no `STATE.md` edit, no `PROJECT.md` edit, no `logs/` directory.
`.planning/spikes/CONVENTIONS.md` still points at a `spike-findings-bruce-lee` skill that was
deleted on 2026-08-01 — read it for house style, ignore the dead pointer, and do NOT fix it here.
</hard_scope_boundary>

<tasks>

<task type="tracer">
  <name>Task 1: Write the design note — all seven decisions, end to end</name>
  <files>.planning/notes/vice-broker-lifecycle-decisions.md</files>
  <read_first>
    `.planning/notes/vice-mcp-selector-design.md` in full. It is the house style for this
    document type and it is also this note's direct predecessor — it designed the broker whose
    lifecycle policy this note rewrites. Match its shape: YAML frontmatter with `title`, `date`,
    `context`; a lead section stating the destination; one section per decision carrying the
    *reasoning*, not just the verdict; comparison tables where two readings compete; an explicit
    open-questions section; a "Related" section at the end. Match its willingness to record a
    correction in place rather than tidying history away.
  </read_first>
  <action>
Create `.planning/notes/vice-broker-lifecycle-decisions.md`.

Frontmatter: `title` naming the two-part thesis (the broker becomes one Node application, and its
lifecycle policy is rewritten rather than translated); `date: 2026-08-01`; `context` naming the
`/gsd-explore` session that produced it and stating that all line references were verified by
reading the files during that session.

Open with a scope section fixing what this document is: a design record, written before the work,
whose consumer is the FOLLOW-ON rewrite task. State plainly that no code changed when it was
written — no Node broker exists yet, no shell script was deleted, no timeout was changed. State
that the rewrite is expected to want `--discuss`, and that this note is meant to be its input.

Then a "Current shape" section carrying the four-file table with line counts and a "who invokes
it" column (a human on the host / nobody / the broker, once per instance, via `nohup` in
`launch_instance()` / sourced by all three), the 2,997-line total, the fact that all of it runs on
the HOST and refuses to run in-container via `container_guard_enforce()` with exit 2, and the fact
that the container half is already `.mjs` and speaks to the broker through a filesystem protocol
under `.vice-supervisor/`. Name the protocol directories.

Then one section per decision. Carry the reasoning; a bare verdict is not plannable.

**Decision 1 — the broker is the only application.** `vice-pool.sh` is dead: nothing invokes it,
and the broker carries its own `launch_instance`/`next_free_port`/registry logic. The rewrite
deletes it outright along with `vice-pool.test.mjs`. `vice-supervisor.sh` is not dead but is not a
CLI either — the broker spawns it per instance as its respawn-and-epoch child — so the rewrite
absorbs it into the broker as an in-process child supervisor: `child_process.spawn` of `x64sc`
directly, per-child respawn, epoch bookkeeping in process. Record its one genuine remaining human
user, the standalone non-MCP recovery pipeline, as an OPEN QUESTION the rewrite has to answer.
Say explicitly that absorbing the supervisor without answering it would silently remove a
capability, which is the failure mode this sentence exists to prevent.

**Decision 2 — the host entry point stays a thin shell script.** The logic moves to Node; the
human-facing launcher stays shell. `vice-broker.sh` shrinks from 1,656 lines to a few that resolve
their own directory and exec node against the new Node entry point. Three reasons: the human types
an absolute HOST path, surfaced to them by `brokerHostPath()` in `vice-proxy.mjs` and
`hostLaunchInstructions()` in `install-resources.mjs`; a `.mjs` is not reliably directly
executable; and `node`'s location on the host is not knowable from the container. Enumerate the
launcher's three responsibilities and state that it has no others — resolve its own directory,
verify `node` exists and fail with a legible message naming the missing dependency if it does not,
and exec. No lifecycle logic, no JSON, no state. Note as a deliberate benefit that keeping the
shell filename means the container-side path builders naming `tools/vice-broker.sh` keep working
unchanged.

**Decision 3 — the pool floor becomes 1, not 3.** Explain what the knob currently means:
`VICE_BROKER_SPARES` defaults to 3 (`vice-broker.sh:431`) and counts *ready, probed, unclaimed*
instances via `count_ready()` over `spares/*.json` with state ready; claimed instances move to
`grants/` and stop counting — so three live sessions put SIX x64sc processes on the host. Then the
three reasons the target is 1: (a) a `/gsd-execute-phase` wave arrives as a burst, so spare #2 is
claimed milliseconds after spare #1 and the boot queue is the bottleneck either way, which buys
warm spares 2..N nothing; (b) x64sc is not headless — its own startup log shows a GTK3 window, an
OpenGL 4.6 context and a PulseAudio handle — so holding 3 permanently costs 3 GPU contexts for the
~95% of the time only one session is live; (c) a machine is never shared between agents, so
exclusivity is a hard requirement and a spare is only ever a latency optimisation. State that
kill-on-release stays, name the existing `teardown()` kill-never-recycle property explicitly as a
property the rewrite must preserve, and record that one replacement boot is enqueued immediately
on release.

**Decision 4 — the 25s grant timeout is the real cap on wave width.** `GRANT_POLL_TIMEOUT_MS`
defaults to 25000 (`.claude/mcp/vice/vice-broker-client.mjs:213`), while spike 003 measured the
tool-call budget at >=150s (`.planning/spikes/003-timeout-budgets/README.md:139`) and recorded
that a cold x64sc launch is seconds (`:104-105`). Include this table, and label the ~8s boot
figure feeding it as an ASSUMPTION in the same breath as the table itself, not in a footnote — the
wait column is arithmetic over serialised depth-1 boots, not measurement:

| Wave width | Last agent waits | Under the 25s ceiling | Under the measured >=150s |
|---|---|---|---|
| 1 | 0s (takes the warm one) | yes | yes |
| 3 | ~16s | yes | yes |
| 4 | ~24s | on the cliff | yes |
| 5 | ~32s | DENIED | yes |
| 10 | ~72s | denied | yes |
| ~18 | ~144s | denied | at the ceiling |

Draw the conclusion: the 25s default caps waves at ~3 agents regardless of pool size and discards
~125s of proven budget; raising it toward ~120000ms is a near-one-line change that widens waves
NOW, independently of the rewrite. Say that measuring real boot time is what turns that table from
arithmetic into evidence. Link the todo written in task 2.

**Decision 5 — four lifecycle defects a mechanical shell-to-JS translation would preserve.** Frame
the section with that claim: these are policy, not syntax, so a faithful port keeps every one of
them.

5.1 — No priority between launch reasons. `count_launching()` is ONE shared in-flight counter
consulted by both `process_requests()` (a cold launch for a real waiting request) and
`maintain_spares()` (speculative warming), so either blocks the other, and a boot nobody asked for
can delay a request an agent is actively waiting on — the log line is
`"request $id -- a launch is already in flight, awaiting readiness"`. Serialisation was the right
fix for the SEGV but needs a PRIORITY, not just a lock; the rewrite gets an explicit launch queue
of depth 1 in which a request-driven launch always precedes warming.

5.2 — The pool target counts files, not processes. `grant_from_spare()` was hardened to probe at
grant time, but `count_ready()`, which decides whether to launch a replacement, still trusts the
ready state recorded in a JSON file. Defect 3 of the defects todo proved such a record survives a
broker stop, a broker start and a full host restart with its x64sc long dead, so a host with N
dead-but-recorded spares concludes the invariant is satisfied and launches nothing. The rewrite
evaluates the floor over probe-live instances and reaps anything failing the probe.

5.3 — No FIFO fairness. `process_requests()` iterates the requests directory in glob (lexical)
order over ids shaped `req-832-1785608443993-9c3df302`, so `req-1000-...` sorts ahead of
`req-832-...`; and because each pass re-globs and re-picks, a burst can jump an unlucky agent
repeatedly while its own deadline runs down. That is the mechanism behind random wave failures
with no pattern; the rewrite uses an arrival-ordered queue.

5.4 — `VICE_BROKER_MAX=16` (`vice-broker.sh:442`) is unverified and inconsistent with a known
crash at 3 concurrent boots. The SEGV was during concurrent *init*; whether the host survives 8 or
16 x64sc processes *already running* has never been tested. State that this number, not the pool
floor, is the real ceiling on wave width, and link spike 005 from task 3 as the experiment that
measures it.

Add the pair of indistinguishable states worth recording alongside: a deliberate zero-spares
config and a broken host with no curl and no `VICE_BROKER_PROBE_CMD` both warm zero spares, and
they are distinguished only by a host stderr line the container-side agent never sees.

**Decision 6 — the name `spares` is part of the problem.** It reads as "extras beyond what is in
use" but denotes the entire ready pool, and the only pool. Cite that Defect 2 in the defects todo
was itself a misread of this knob's own stale `usage()` text during a live outage. The rewrite
renames it to something that says what it is — a warm floor or ready floor. Record that the rename
is deliberate, not cosmetic.

**Decision 7 — this is quick-task work, not a ROADMAP phase.** The deliverable of this project is
the Bruce Lee reconstruction; the broker is scaffolding that carries it. `.planning/quick/` shows
the whole subsystem was built this way already — cite `260730-jty` (supervisor), `260730-mef`
(pool), `260730-q4b` (resources layout), `260801-qpq` (shutdown contract). Phase 01 is halted right
now because of these very defects, so the rewrite is remediation of a blocker. Say that this note
exists partly so nobody later promotes it to milestone scope.

Close with two sections. **"What is not yet measured"** — a short explicit list, so the note cannot
be mistaken for evidence: the ~8s boot time (assumed, never measured, and the whole wave-width
table rests on it), the concurrent-x64sc ceiling (spike 005), and whether the standalone non-MCP
recovery pipeline still has a user. **"Related"** — the defects todo, the task-2 todo, spike 005,
`.planning/notes/vice-mcp-selector-design.md` as the design this one amends, and spike 003 as the
source of the >=150s measurement.
  </action>
  <verify>
    <automated>test -f .planning/notes/vice-broker-lifecycle-decisions.md && test "$(grep -c '^## ' .planning/notes/vice-broker-lifecycle-decisions.md)" -ge 9 && grep -q 'date: 2026-08-01' .planning/notes/vice-broker-lifecycle-decisions.md</automated>
    <automated>for s in 'vice-broker.sh:431' 'vice-broker.sh:442' 'vice-broker-client.mjs:213' '003-timeout-budgets' '005-concurrent-x64sc-ceiling' 'kill-never-recycle' 'vice-mcp-selector-design.md'; do grep -qF "$s" .planning/notes/vice-broker-lifecycle-decisions.md || { echo "MISSING: $s"; exit 1; }; done; grep -qi 'assumption' .planning/notes/vice-broker-lifecycle-decisions.md</automated>
    <automated>test -z "$(git status --porcelain -- .claude/ tools/ recovery/ src/ disks/)"</automated>
  </verify>
  <done>
    The note exists, carries all seven decisions as their own sections plus a current-shape
    section, a not-yet-measured section and a Related section; cites `vice-broker.sh:431`,
    `vice-broker.sh:442` and `vice-broker-client.mjs:213`; labels the ~8s boot time as an
    assumption; names kill-never-recycle as a property to preserve; links spike 005 and the
    predecessor design note; and nothing outside `.planning/` was touched.
  </done>
</task>

<task type="auto">
  <name>Task 2: Write the grant-timeout todo and append the matching RE-FINDINGS entry</name>
  <files>.planning/todos/pending/2026-08-01-raise-grant-poll-timeout-to-match-measured-tool-call-budget.md, .planning/RE-FINDINGS.md</files>
  <read_first>
    `.planning/todos/pending/2026-08-01-vice-broker-spare-warming-and-stale-grant-defects.md` for
    the exact frontmatter shape used in this directory (`created` as an ISO timestamp, `title`,
    `area`, `severity`, `files` as a list) and for the body style — evidence inline, a suggested
    fix per item, a cross-reference section at the end.

    `.planning/RE-FINDINGS.md` lines 1-36 for the mandatory entry format and the HIGH/MEDIUM/LOW
    scale, and lines 925-940 for the tail and the `## Corrections to earlier entries` heading.
  </read_first>
  <action>
**Part A — the todo.** Create
`.planning/todos/pending/2026-08-01-raise-grant-poll-timeout-to-match-measured-tool-call-budget.md`.

Frontmatter: `created: 2026-08-01T23:30:00.000Z`, a `title` stating the fix and its consequence,
`area: tooling`, `severity: major` (it caps every parallel wave at ~3 agents), and a `files` list.
Before writing `files`, run `ls .claude/mcp/vice/` and list only paths the listing actually shows —
the client module is `.claude/mcp/vice/vice-broker-client.mjs`; include a test file only if one
exists. Do not open either file.

Body:

- **Current value.** `GRANT_POLL_TIMEOUT_MS` defaults to 25000 in
  `.claude/mcp/vice/vice-broker-client.mjs:213`. This is the container-side deadline on polling for
  a grant, so it is the deadline on how long an agent will wait for an emulator.
- **The measured evidence.** Spike 003 measured the tool-call budget at >=150s
  (`.planning/spikes/003-timeout-budgets/README.md:139`) and recorded that a cold x64sc launch is
  seconds (`:104-105`). The >=150s figure is a floor, not a ceiling — nothing was measured beyond
  150s because nothing needed to be.
- **The consequence.** With a serialised depth-1 boot queue and an assumed ~8s boot, the last agent
  in a wave of N waits roughly 8*(N-1) seconds, so 25s is already on the cliff at N=4 and denies at
  N=5. Waves are capped at ~3 agents regardless of pool size, and ~125s of proven budget is
  discarded. Label the ~8s boot as an ASSUMPTION here too: the cap is real either way, but its
  exact width is arithmetic, not measurement.
- **The target.** ~120000ms, which leaves headroom under the measured floor rather than racing it.
- **Why this is worth doing first.** It is a near-one-line change, it is independent of the broker
  Node rewrite, and it widens waves immediately. Nothing in the rewrite has to land before it.
- **What to check while doing it.** Whether any test in `.claude/mcp/vice/` asserts the current
  default (`vice-broker-client.test.mjs` is the likely one) — a test pinned to 25000 needs updating
  in the same change.
- **Cross-reference.** `.planning/notes/vice-broker-lifecycle-decisions.md` Decision 4, where this
  number's role in the wave-width story is worked out, and the defects todo
  `2026-08-01-vice-broker-spare-warming-and-stale-grant-defects.md`.

**Part B — the findings entry.** Append ONE entry to `.planning/RE-FINDINGS.md`.

Placement: insert it immediately BEFORE the `## Corrections to earlier entries` heading, so it
lands at the end of the topical body rather than inside the corrections section. Use Edit with
that heading as the anchor, so the change is a pure insertion. The log is append-only: no existing
line may be edited or removed, and no existing confidence grade may be changed.

The entry, in the file's own format:

- Heading: `### 2026-08-01 — ` followed by a one-line statement that the container-side grant poll
  gives up at 25s while the measured tool-call budget is >=150s, so parallel wave width is capped
  at about three agents by a default nobody chose. The phrase `grant poll` must appear in that
  heading line.
- `**Type:** hazard`
- `**Evidence:**` source read, not live measurement — name both sources explicitly:
  `GRANT_POLL_TIMEOUT_MS` default 25000 read from `.claude/mcp/vice/vice-broker-client.mjs:213`,
  and the >=150s budget plus the cold-launch-is-seconds note read from
  `.planning/spikes/003-timeout-budgets/README.md:139` and `:104-105`.
- `**Confidence:**` must SEPARATE the claims on one line: HIGH for the two constants, since both
  were read directly; LOW for the ~8s boot time, which is assumed and has never been measured; and
  therefore MEDIUM at best for any wave-width arithmetic derived from it.
- `**Saves / costs:**` what it buys — one config change recovers waves wider than three — and what
  ignoring it costs: waves that fail by denial with no pattern, blamed on pool size or host
  instability, which is exactly the misattribution this project has already paid for once.
- Two or three sentences of detail: that the two numbers live in different registers (one in
  container-side client code, one in a spike README), which is why the mismatch went unnoticed for
  as long as it did; and the general lesson that a client-side deadline shorter than the
  platform's measured budget is a self-imposed cap that reads to everyone downstream as a platform
  limit.

Run this task's gates BEFORE committing, because the append-only gate reads the working diff.
  </action>
  <verify>
    <automated>T=.planning/todos/pending/2026-08-01-raise-grant-poll-timeout-to-match-measured-tool-call-budget.md; test -f "$T" && for s in 'created: 2026-08-01' 'area: tooling' 'severity:' '25000' '120000' 'vice-broker-client.mjs:213' '003-timeout-budgets/README.md:139' 'vice-broker-lifecycle-decisions.md'; do grep -qF "$s" "$T" || { echo "MISSING: $s"; exit 1; }; done</automated>
    <automated>test "$(git diff HEAD --numstat -- .planning/RE-FINDINGS.md | cut -f2)" = "0"</automated>
    <automated>E=$(grep -n 'grant poll' .planning/RE-FINDINGS.md | head -1 | cut -d: -f1); C=$(grep -n '^## Corrections to earlier entries' .planning/RE-FINDINGS.md | cut -d: -f1); test -n "$E" && test -n "$C" && test "$E" -lt "$C"</automated>
    <automated>CONF=$(grep -A12 'grant poll' .planning/RE-FINDINGS.md | grep -m1 'Confidence:'); echo "$CONF" | grep -q 'HIGH' && echo "$CONF" | grep -qE 'MEDIUM|LOW'</automated>
  </verify>
  <done>
    The todo exists with sibling-matching frontmatter, states 25000 and ~120000, cites both
    sources by file:line, labels the ~8s boot an assumption, and says the change is independent
    of the rewrite. RE-FINDINGS.md gained exactly one entry, positioned before the corrections
    section, with zero deleted lines and a Confidence line that grades the constants and the
    assumption separately.
  </done>
</task>

<task type="auto">
  <name>Task 3: Design spike 005 — the concurrent-x64sc ceiling, as an experiment a human runs on the host</name>
  <files>.planning/spikes/005-concurrent-x64sc-ceiling/README.md</files>
  <read_first>
    `.planning/spikes/003-timeout-budgets/README.md` in full — it is the house style. Note its
    frontmatter keys (`spike`, `name`, `type`, `validates` as a given/when/then sentence,
    `verdict`, `related`, `tags`) and its section order (What This Validates / Research / How to
    Run / What to Expect / Observability / Investigation Trail / Results / Limits of this
    evidence). 005 follows that order with the run-and-results sections written forward-looking,
    because it has not been run.

    `.planning/spikes/CONVENTIONS.md` for the house method. Ignore its pointer to the deleted
    `spike-findings-bruce-lee` skill and do not fix it.
  </read_first>
  <action>
Create `.planning/spikes/005-concurrent-x64sc-ceiling/README.md`. Create the directory. Create
NOTHING ELSE in it — no driver, no `logs/`, no fixtures.

Frontmatter matching 003's keys: `spike: 005`; `name: concurrent-x64sc-ceiling`; `type: standard`;
`validates:` a given/when/then sentence — given K x64sc instances brought up on the host with the
broker stopped, when K is raised through a ladder, then the log shows the largest K at which every
instance answers an MCP round trip and none dies within a settle window; `verdict: NOT RUN`;
`related: [003]`; `tags:` including `designed-not-run`.

**Lead with the status section, before "What This Validates".** Heading it so it cannot be missed:
this spike is DESIGNED, NOT RUN, and it is NOT RUNNABLE FROM THIS CONTAINER — use that exact
phrase, `NOT RUNNABLE FROM THIS CONTAINER`, in the body. Give the reason in two parts: the
experiment needs several x64sc processes brought up simultaneously on the HOST, and per
`.claude/CLAUDE.md` § Emulator Access the `mcp__vice__*` tools are the only permitted route to the
emulator and they grant exactly one instance per session. There is no route from here that could
run this. It is therefore an experiment specified for a HUMAN to run on the host, and the results
sections stay empty until they do.

**"Why there is no driver script" — its own section, and one of the two reasons this README
matters.** Every other spike in this set ships an `.mjs` driver, so its absence here reads as an
oversight unless the reason is recorded. The reason: a script in this repo that launches x64sc
directly would open its own route to the emulator, which is exactly what the project's hard rule
forbids, and reimplementing that route cleanly is the same violation as importing it. State that a
future session must not "fix" this by adding one. The host commands belong in this README as
copy-pasteable text a human runs, not as committed code.

**"What This Validates".** State the question: `VICE_BROKER_MAX` defaults to 16
(`vice-broker.sh:442`) and that number has never been tested. The only concurrency evidence this
project has is a crash at 3 — three spares warmed simultaneously all died in a GPU/audio race, one
SEGV, one exit 1, one exit 0, at an identical spawn second, because x64sc is not headless and opens
a GTK3 window, an OpenGL 4.6 context and PulseAudio (see the defects todo, Defect 1). That was
concurrent *init*. Whether the host survives 8 or 16 instances *already running* is a different
question and is unanswered. Say why it matters: this ceiling, not the pool floor, is the real cap
on how wide a `/gsd-execute-phase` wave can be, and the Node rewrite would otherwise inherit 16 as
an unexamined constant. Name `.planning/notes/vice-broker-lifecycle-decisions.md` Decision 5.4 as
the origin of the question.

**"How to Run" — on the host, by a human.** Two arms, because the two failure modes are different
and conflating them is what makes 16-vs-3 confusing:

Arm A, the steady-state ceiling: with the broker stopped, bring up instances one at a time with a
settle gap between each, on distinct ports clear of the band VS Code occupies. After each new
instance, probe EVERY instance already up for a real MCP round trip, not a socket accept. Ladder K
through 1, 2, 3, 4, 6, 8, 12, 16, stopping at the first K where the probe fails or an instance
dies.

Arm B, the init race, as a control: bring K up simultaneously and confirm the known failure
independently. This arm exists to establish that the two arms measure different things, so a
sequential ceiling of 12 and a simultaneous ceiling of 2 are both real answers rather than a
contradiction.

Give the commands as host shell a human can paste, based on the hand-run invocation the defects
todo records as always having worked — `x64sc -mcpserver -mcpserverhost 0.0.0.0 -mcpserverport
<port>` — with the port varied per instance. Say the broker must be stopped first so it does not
warm spares into the middle of the measurement.

**"What to Record".** Per K: which ports were up, which answered a probe, any exit statuses and
signals (a SEGV is status 139), host RSS and swap, whether the GPU/compositor degraded visibly, and
whether any instance died LATER — during the settle window rather than at launch, which would mean
the ceiling is a slow resource leak rather than a hard limit. Plus, once, the host's own specs: CPU,
RAM, GPU and driver, and whether a compositor is running. Without those the number does not
transfer to another machine, and the whole point is to replace a guessed constant with a measured
one.

**"Reading the result".** The ceiling is the largest K at which all K instances answer an MCP round
trip and none dies inside the settle window. `VICE_BROKER_MAX` should then be set to that number
minus a safety margin, and the margin stated. Name the three outcomes and what each one means:
under 16 (the current default is optimistic and the rewrite must lower it), at or above 16 (the
default is safe and the wave-width cap is entirely the grant timeout from Decision 4), or a ceiling
that moves between runs (the limit is contention, not count, and the broker needs a probe-based
admission check rather than a fixed max).

**"Limits of this evidence, in advance".** One host, one GPU, one driver version, one compositor.
The answer is a property of this machine, and re-measuring is the price of a new host. Say that
explicitly so the number does not become folklore the way `VICE_BROKER_MAX=16` did.
  </action>
  <verify>
    <automated>R=.planning/spikes/005-concurrent-x64sc-ceiling/README.md; test -f "$R" && for s in 'spike: 005' 'name: concurrent-x64sc-ceiling' 'verdict: NOT RUN' 'designed-not-run' 'NOT RUNNABLE FROM THIS CONTAINER' 'vice-broker.sh:442' 'mcp__vice__' 'vice-broker-lifecycle-decisions.md'; do grep -qF "$s" "$R" || { echo "MISSING: $s"; exit 1; }; done</automated>
    <automated>test "$(ls .planning/spikes/005-concurrent-x64sc-ceiling/)" = "README.md"</automated>
    <automated>test -z "$(git status --porcelain -- .claude/ tools/ recovery/ src/ disks/)" && test -z "$(git status --porcelain -- .planning/spikes/MANIFEST.md .planning/spikes/CONVENTIONS.md)"</automated>
  </verify>
  <done>
    The spike 005 README exists with 003-shaped frontmatter and a NOT RUN verdict, leads with the
    not-runnable-from-this-container status, explains the deliberate absence of a driver script by
    the project's emulator-access rule, specifies both experiment arms with what to record and how
    to read the result, links Decision 5.4, and is the only file in its directory. MANIFEST.md and
    CONVENTIONS.md are unchanged.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| planning docs → a future implementer | These documents are executable intent: a wrong citation or an unlabelled assumption is acted on later as fact. This is the only boundary this task crosses. |
| repo → host machine | Named but never crossed here. Spike 005 describes host commands; it never runs them, and no artifact of this task can reach the host. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-vqd-01 | Tampering | the design note's file:line citations | medium | mitigate | Only citations from the plan's verified set may be written; the task-1 gate greps for the three load-bearing ones so a silently dropped or mistyped citation fails the task rather than shipping. |
| T-vqd-02 | Repudiation | the ~8s boot time and the wave-width table derived from it | high | mitigate | Every artifact that carries the table must label the boot time an ASSUMPTION in the same section, and the RE-FINDINGS Confidence line must grade the constants and the assumption separately — gated by a grep in task 2. Unlabelled arithmetic hardening into a cited fact is the specific failure this project has already paid for. |
| T-vqd-03 | Elevation of privilege | spike 005's missing driver script | high | mitigate | A committed script that launched x64sc would be a second route to the emulator, violating CLAUDE.md's hard rule. The README must record the absence as deliberate and forbid a future "fix"; the directory-contents gate asserts README.md is the only file. |
| T-vqd-04 | Information disclosure | host paths and usernames appearing in planning docs | low | accept | Host-rooted paths already appear throughout `.planning/` and CLAUDE.md; this repo is not published and the design cannot be recorded without them. |
| T-vqd-05 | Tampering | scope creep into `.claude/mcp/` | high | mitigate | Documentation-only is asserted mechanically: every task carries a git-status gate over `.claude/`, `tools/`, `recovery/`, `src/` and `disks/` that must be empty. |
| T-vqd-SC | Tampering | npm/pip/cargo installs | high | mitigate | This task installs nothing — no package manager runs, no dependency is added, no `package.json` is touched. The clean-tree gates above are what proves it. |
</threat_model>

<verification>
Run from the repo root, after all three tasks:

1. All four files exist and no fifth appeared:
   `git status --porcelain` lists changes only under `.planning/notes/`,
   `.planning/todos/pending/`, `.planning/spikes/005-concurrent-x64sc-ceiling/`,
   `.planning/RE-FINDINGS.md`, and this quick task's own directory.
2. Nothing outside `.planning/` changed:
   `test -z "$(git status --porcelain -- .claude/ tools/ recovery/ src/ disks/)"`
3. No code artifact was created anywhere:
   `test -z "$(git status --porcelain | grep -E '\.(mjs|sh|js|ts|py|json)$')"`
4. The three documents cross-link: the note names spike 005 and the todo; the todo names the
   note; the spike README names the note's Decision 5.4.
5. The RE-FINDINGS append removed nothing:
   `test "$(git diff HEAD --numstat -- .planning/RE-FINDINGS.md | cut -f2)" = "0"` — run before
   the commit that lands it.
</verification>

<success_criteria>
- Three artifacts written at exactly the paths in `files_modified`, plus one appended
  RE-FINDINGS entry, and no other file changed outside this quick task's own directory.
- All seven locked decisions appear in the note with their reasoning intact and their
  verified citations attached.
- The ~8s boot assumption is labelled as an assumption in every artifact that depends on it.
- Spike 005 is unambiguously marked designed-not-run and host-only, and explains why it ships
  without a driver script.
- Zero code written. Zero files touched under `.claude/`.
</success_criteria>

<output>
Create `.planning/quick/260801-vqd-capture-vice-broker-node-rewrite-design-/260801-vqd-SUMMARY.md` when done.
</output>
