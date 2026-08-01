---
phase: quick-260801-qpq
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
requirements: [QUICK-260801-qpq]
files_modified:
  - .claude/mcp/vice/resources/vice-broker.sh
  - .claude/mcp/vice/resources/vice-supervisor.sh
  - .claude/mcp/vice/resources/vice-pool.sh
  - .claude/mcp/vice/vice-broker.test.mjs
  - .claude/mcp/vice/vice-pool.test.mjs
  - .claude/CLAUDE.md

must_haves:
  truths:
    - "A broker daemon that receives SIGINT, SIGTERM or SIGHUP, or that leaves its loop by any other exit path, terminates every emulator recorded in grants/ and spares/ and removes spares/, grants/, requests/, leases/, broker-instances.json and broker.json before exiting."
    - "`stop` reaps the same set even when the broker process is already dead or was never started: it never again reports success while leaving orphaned emulators running."
    - "Every signal this work sends is preceded by the existing `ps -o args=` identity check against the resolved supervisor script path; a pid whose identity does not match is logged and left alone, and the SIGKILL escalation is reachable only for a pid that already matched."
    - "`start` validates every persisted spare and grant against its recorded pid (and, for a spare recorded ready, its port) before the first pass, and drops records whose process is gone — the defect that let a ghost grant survive a full host restart and block all launches."
    - "A record marked dry_run:true is exempt from that validation, because it never had a process; this is what keeps the whole existing --dry-run test corpus meaningful."
    - "Spare warming is serialised: no new instance is launched while any spare is still in state launching, and at most one successful launch happens per pass — a refused launch still blocks that port and keeps scanning within the same pass."
    - "A spare recorded ready is never granted without a readiness probe succeeding at grant time; one that fails is terminated and dropped, and selection moves to the next ready spare."
    - "vice-supervisor.sh and vice-pool.sh terminate what they spawned on SIGINT, SIGTERM, SIGHUP and on any other exit path, and the supervisor's crash-loop give-up exit status survives the new EXIT handler unchanged."
    - "The broker's header comment, usage text and cmd_start comment all state the new shutdown contract; no surviving line claims the broker leaves its instances alone."
    - "CLAUDE.md's § Emulator Access no longer forbids working on the VICE MCP implementation, while the hard rule that mcp__vice__* is the only route to the emulator is untouched."
  artifacts:
    - ".claude/mcp/vice/resources/vice-broker.sh — shutdown reaper, purge, start-time record validation, serialised warming, grant-time probe, and the reversed design note"
    - ".claude/mcp/vice/resources/vice-supervisor.sh — two-entry-point trap (signal handler plus status-preserving EXIT handler)"
    - ".claude/mcp/vice/resources/vice-pool.sh — spawned-pid tracking plus the same two-entry-point trap"
    - ".claude/mcp/vice/vice-broker.test.mjs — a sleeping-supervisor fixture and behavioural gates for shutdown, stop-with-dead-broker, start-time reaping, serialised warming and the grant-time probe"
    - ".claude/mcp/vice/vice-pool.test.mjs — a supervisor SIGHUP gate plus structural trap assertions for both scripts"
    - ".claude/CLAUDE.md § Emulator Access — reworded so the don't-touch clause stops contradicting this work"
  key_links:
    - "broker trap -> reap_all_instances -> signal_recorded_pid -> supervisor SIGTERM -> supervisor's own trap -> x64sc: the whole point is this chain completing, so the supervisor trap work in task 3 is what makes task 1's reaping actually reach the emulator"
    - "cmd_stop -> the SAME reap_all_instances/purge_protocol_state helpers the trap uses -- two entry points, one implementation, or they drift"
    - "drop_dead_instance_records -> called once from cmd_start before the first pass -- traps cannot catch SIGKILL, so start-time validation is the only backstop that survives a host crash"
    - "count_launching -> consulted by BOTH maintain_spares and process_requests -- one in-flight counter, or the two launch paths race each other back into the outage"
    - "grant_from_spare -> probe_ready -> the tracer test's forwarded-tool-call count, which rises from three to four"
    - "resources/*.sh -> install-resources.mjs (force) -> tools/*.sh: the deployed copies are gitignored and never overwritten unless forced, so an unforced refresh leaves the host validating the OLD script"
---

<objective>
Make the VICE broker and its sibling launchers self-cleaning on shutdown, stop parallel
spare warming from killing x64sc, and stop dead bookkeeping from surviving a host restart.

Purpose: on 2026-08-01 the host warmed three x64sc instances simultaneously; all three
died in a GPU/audio race (one SEGV, one exit 1, one exit 0 at the identical spawn second),
and a `state granted` record for a long-dead pid then survived a broker stop, a broker
start and a full host restart, so the broker reported success and launched nothing.
Recovery took roughly two hours and cost plan 01-04 its second halt. The launch race is
what broke; the missing cleanup and the unvalidated bookkeeping are what made it
undiagnosable.

Output: a broker that terminates and purges what it owns on every exit path it can trap,
validates what it persisted on the path it cannot trap, launches one emulator at a time,
and never hands out an instance it has not just proven answers.
</objective>

<execution_context>
@/workspaces/bruce_lee/.claude/gsd-core/workflows/execute-plan.md
@/workspaces/bruce_lee/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/todos/pending/2026-08-01-vice-broker-spare-warming-and-stale-grant-defects.md

@.claude/mcp/vice/resources/vice-broker.sh
@.claude/mcp/vice/resources/vice-supervisor.sh
@.claude/mcp/vice/resources/vice-pool.sh
@.claude/mcp/vice/vice-broker.test.mjs
@.claude/CLAUDE.md

**Edit the TRACKED sources under `.claude/mcp/vice/resources/` ONLY.** `tools/vice-broker.sh`,
`tools/vice-supervisor.sh` and `tools/vice-pool.sh` are gitignored deployment targets
regenerated by the vice MCP's own resource installer; `.gitignore` says outright never to
hand-edit them there. Work done in `tools/` silently vanishes.

**These scripts refuse to run inside this container** (shared container guard). Every gate
below therefore drives the `--dry-run` and `--once` seams and the existing `node --test`
suites, with `VICE_SUPERVISOR_ALLOW_CONTAINER=1` exactly as the current tests already do.
**No task here may require launching a real x64sc** — that is impossible in this container,
and a plan that pretended otherwise would be worse than one that states the limit.
The developer performs the live host validation afterwards; the procedure is in
`<verification>`.

**This touches no emulator.** No `mcp__vice__*` call is needed or wanted at any point.

Baseline before any edit: `node --test .claude/mcp/vice/vice-broker.test.mjs` is 33 tests,
33 pass, ~7.5 s.
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: The broker terminates and purges what it owns — on shutdown, on `stop`, and against what it finds at start</name>
  <files>.claude/mcp/vice/resources/vice-broker.sh, .claude/mcp/vice/vice-broker.test.mjs</files>
  <read_first>
    `.claude/mcp/vice/resources/vice-broker.sh` — the header comment block, `usage()`'s
    `start`/`stop` entries, `teardown()`, `cmd_start()`'s handler, `cmd_stop()`,
    `read_spare_field()`, `port_in_use()`, and the `VICE_POOL_DIR`/`SPARES_DIR`/`GRANTS_DIR`
    variables resolved near the top. `.claude/mcp/vice/vice-broker.test.mjs` —
    `runBrokerOnce()`, `writeGrantFile()`, `writeSpareFile()`, `writeLeaseFile()`,
    `brokerCopyWithStubSupervisor()` and the existing stop test.
  </read_first>
  <behavior>
    - A daemon sent SIGTERM terminates the supervisor pid recorded in spares/ and exits with
      spares/, grants/, requests/, leases/, broker.json and broker-instances.json all gone.
    - `stop` with no broker.json present still terminates a live recorded supervisor and
      purges protocol state.
    - `stop` refuses to signal a recorded pid whose `ps` identity does not name the
      supervisor script; that process is still alive afterwards and the refusal is logged.
    - A `--once` start drops a non-dry-run record whose recorded pid is dead, and leaves a
      record whose pid is a live supervisor untouched.
    - A `--once --dry-run` start leaves dry-run grant and spare records untouched.
  </behavior>
  <action>
    Add four helpers to `vice-broker.sh`, placed just below `teardown()` so the identity-check
    idiom sits beside its existing use:

    `signal_recorded_pid` takes a pid and a label. It returns non-zero without signalling when
    the pid is empty, the string null, or fails `kill -0`. It runs the same `ps -o args=`
    identity check `teardown()` already uses and, on a mismatch, logs a refusal naming the pid
    and what `ps` reported, then returns non-zero. Only on a match does it SIGTERM, poll
    `kill -0` every 200 ms up to a new `VICE_BROKER_KILL_WAIT_S` knob (default 5), and SIGKILL
    a survivor. Poll — do not use `wait`: these supervisors were `nohup`'d and `disown`ed, so
    they are not waitable children of a later invocation.

    `reap_all_instances` walks `grants/*.json` and `spares/*.json`, reads each
    `supervisor_pid`, and calls `signal_recorded_pid` for each. A missing directory is normal,
    not an error. It echoes one summary line naming how many records it saw and how many
    processes it actually terminated. Safe to call twice.

    `purge_protocol_state` removes `$SPARES_DIR`, `$GRANTS_DIR`, `$REQUESTS_DIR` and
    `$LEASES_DIR` recursively and `$INSTANCES_JSON` and `$BROKER_JSON` by name. Use only those
    already-resolved variables — never a path built by string concatenation at the call site —
    and refuse with a logged error if `VICE_POOL_DIR` is empty (T-qpq-02). `$DENIALS_DIR` is
    deliberately kept: a denial is a message already addressed to a container that has not
    read it yet, not live state. Safe to call when everything is already gone.

    `drop_dead_instance_records` is the start-time validation. For each `grants/*.json` and
    `spares/*.json`: skip the record entirely when its `dry_run` field is true (it never had a
    process, so there is nothing to validate and validating it would delete every fixture the
    test corpus depends on); otherwise remove the record when the recorded `supervisor_pid` is
    absent or null, when `kill -0` fails on it, or when `ps -o args=` does not name
    `$SUPERVISOR_SCRIPT`; and additionally remove a spare whose recorded state is ready but
    whose port has no listener per `port_in_use`. Log one line per drop naming the port, the
    pid and which of those reasons fired.

    Wire the three entry points:

    1. `cmd_start` calls `drop_dead_instance_records` once, before the first pass, on both the
       `--once` and daemon paths. Traps cannot catch SIGKILL and cannot run after a host power
       loss, so this is the only backstop that survives the way the real incident actually
       happened.
    2. Replace `cmd_start`'s current handler with `broker_shutdown`, registered as
       `trap broker_shutdown EXIT HUP INT TERM` immediately before the `while true` loop and
       **not** on the `--once` path — `--once` is a single pass of a broker that is not ending,
       and purging there would destroy the seam every test drives. `broker_shutdown` disarms
       itself first (`trap - EXIT HUP INT TERM`) so its own `exit` cannot re-enter it, then
       calls `reap_all_instances`, then `purge_protocol_state`, then exits 0.
    3. Rewrite `cmd_stop`. When `broker.json` names a pid whose `ps` identity checks out, send
       SIGTERM and poll for its exit up to `VICE_BROKER_KILL_WAIT_S`, escalating to SIGKILL,
       so the broker cannot warm a fresh spare while the reap is running. Then, in **every**
       case — live broker, dead pid, no pid recorded, or no `broker.json` at all — run
       `reap_all_instances` and `purge_protocol_state` and report what was found and done. The
       early exits that reported success without reaping are the defect; remove them.

    Then reverse the design note in all three places that state it: the header comment block,
    `usage()`'s `start` and `stop` entries, and `cmd_start`'s own comment. They currently say
    the trap leaves granted emulators alone because a broker stopping is not a session ending.
    Say instead that the broker terminates the instances it spawned and removes its protocol
    state, and record why the trade was reversed on 2026-08-01: an orphan outlives the session
    that wanted it and then blocks every later launch, which costs more than an interrupted
    session does. Document `VICE_BROKER_KILL_WAIT_S` in the Configuration list.

    In `vice-broker.test.mjs`, add a `brokerCopyWithSleepingSupervisor()` fixture beside
    `brokerCopyWithStubSupervisor()`: same whole-directory copy, but the stub supervisor traps
    TERM/INT/HUP and sleeps 300 s, so it is a genuinely live process whose `ps` args name the
    copy's own supervisor path — which is exactly what the identity check requires. Add the
    five gates in `<behavior>` using it, plus a direct spawn of that stub for the cases that
    need a live "supervisor" without a broker. Every bounded wait polls; none sleeps a fixed
    interval and hopes. Update the existing no-broker.json stop test to assert the new
    reporting instead of the old wording — its old assertion is the defect, not a contract.
  </action>
  <verify>
    <automated>bash -n .claude/mcp/vice/resources/vice-broker.sh && node --test .claude/mcp/vice/vice-broker.test.mjs</automated>
    <automated>test "$(grep -v '^ *#' .claude/mcp/vice/resources/vice-broker.sh | grep -c 'granted instances left running')" -eq 0</automated>
    <automated>test "$(grep -v '^ *#' .claude/mcp/vice/resources/vice-broker.sh | grep -c 'nothing to stop')" -eq 0</automated>
  </verify>
  <done>
    `node --test .claude/mcp/vice/vice-broker.test.mjs` passes with the five new gates and every
    pre-existing gate still green. No line of the script claims granted instances are left
    running, and no executable line reports there is nothing to stop. Every signal path still
    goes through the `ps` identity check, and `purge_protocol_state` names only the
    already-resolved directory variables.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: One boot at a time, and never grant an instance that has not just answered</name>
  <files>.claude/mcp/vice/resources/vice-broker.sh, .claude/mcp/vice/vice-broker.test.mjs</files>
  <read_first>
    `vice-broker.sh` — `count_cold_launching()`, `probe_ready()`, `process_requests()`,
    `maintain_spares()`, `grant_from_spare()`, and `usage()`'s `start [N]` and
    `VICE_BROKER_SPARES` entries. In `vice-broker.test.mjs` — the tracer test's
    forwarded-tool-call assertion, the VICE_BROKER_SPARES=2 two-pass test, the bound-port
    regression test, and `makeProbeStub()`.
  </read_first>
  <behavior>
    - With a spares target of 2 and an always-succeeding probe: pass 1 records exactly one
      spare, in state launching; pass 2 shows one ready plus one launching; pass 3 shows two
      ready. Never two launches in one pass.
    - With a spare already in state launching and a probe that never promotes, a pass with a
      spares target of 3 adds no second spare and says on stderr that it is waiting.
    - A pending request that finds no ready spare while a launch is in flight writes neither a
      grant nor a denial and triggers no second launch.
    - With two ready spares and a probe that fails only for the lower port, the grant goes to
      the higher port, the lower spare's record is gone, and the drop is logged.
    - The pre-existing bound-port regression still holds: a refused launch blocks that port and
      the pass still warms a spare on the next port.
  </behavior>
  <action>
    Add `count_launching()` beside the existing counters — spares in state launching, any
    reason. Delete `count_cold_launching()` and its call site: two in-flight counters that can
    disagree is how the two launch paths race each other back into the outage, so there must be
    exactly one.

    In `process_requests`, replace the cold-pending decrement with a single in-flight flag,
    initialised from `count_launching` before the loop and set to 1 after any launch this pass.
    While it is set, a request that found no ready spare is skipped with neither a grant nor a
    denial and a log line saying a launch is already in flight — this is the existing
    absence-of-both-files protocol the container side already reads as "keep polling", not a
    new signal.

    In `maintain_spares` step 3, return early when `count_launching` reports anything in
    flight, logging once that warming waits for the boot already under way; and break out of
    the launch loop after the first launch that actually succeeds. A refused launch (return
    code 1) must still block that port and keep scanning inside the same pass — the bound-port
    regression gate depends on exactly that, and it is what stops one permanently-bound port
    from starving warming forever.

    In `grant_from_spare`, call `probe_ready` on the selected port before writing the grant.
    On success, proceed unchanged. On failure, terminate that spare through Task 1's
    `signal_recorded_pid`, remove its record, log that a stale ready spare was dropped, and
    continue selecting the next-lowest ready candidate; return non-zero only once no ready
    spare probes clean. A record saying ready is bookkeeping; a probe that just answered is
    evidence, and the incident proved bookkeeping alone is worth nothing after a restart.

    Fix the two documentation lies while in `usage()`. The `start [N]` entry still claims the
    positional is inert; it has driven `VICE_BROKER_SPARES` since the criterion-13 checkout, so
    describe what it actually does. The `VICE_BROKER_SPARES` entry must state that warming is
    serialised — one boot at a time — and say why: x64sc opens a GTK3 window, an OpenGL 4.6
    context and PulseAudio, and three simultaneous launches lost that race on 2026-08-01 with
    one SEGV, one exit 1 and one exit 0 at the identical spawn second. Put the same reasoning
    in a comment above `maintain_spares`, where the next person changing the loop will read it.

    Test changes: rewrite the VICE_BROKER_SPARES=2 test into the serialised ladder from
    `<behavior>` — against the current parallel code it fails on pass 1, which is the point.
    Add the three new gates using `makeProbeStub()` (a port-selective stub is a one-line
    script body). Update the tracer test's forwarded-tool-call count from three to four and
    extend its comment to name the fourth: the grant-time readiness probe this task adds.
  </action>
  <verify>
    <automated>bash -n .claude/mcp/vice/resources/vice-broker.sh && node --test .claude/mcp/vice/vice-broker.test.mjs</automated>
    <automated>test "$(grep -c '^count_launching() {' .claude/mcp/vice/resources/vice-broker.sh)" -eq 1 && test "$(grep -cE '^count_[a-z_]*launching\(\) \{' .claude/mcp/vice/resources/vice-broker.sh)" -eq 1</automated>
    <automated>test "$(tr '\n' ' ' < .claude/mcp/vice/resources/vice-broker.sh | grep -c 'not yet *consumed')" -eq 0</automated>
  </verify>
  <done>
    The full broker suite passes, including the rewritten serialisation ladder and the four-call
    tracer. Exactly one in-flight counter exists in the script. No usage line claims the `start`
    positional is unconsumed, and both `usage()` and `maintain_spares` state the one-boot-at-a-
    time rule together with the GTK3/OpenGL/PulseAudio reason for it.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: The supervisor and pool clean up on every exit path, and CLAUDE.md stops forbidding this work</name>
  <files>.claude/mcp/vice/resources/vice-supervisor.sh, .claude/mcp/vice/resources/vice-pool.sh, .claude/mcp/vice/vice-pool.test.mjs, .claude/CLAUDE.md</files>
  <read_first>
    `vice-supervisor.sh` — the `child_pid` declaration, its handler, its `trap` line, and the
    crash-loop give-up that exits 4. `vice-pool.sh` — `cmd_start()`'s spawn loop and
    `cmd_stop()`'s identity check. `vice-pool.test.mjs` — the path-agreement test (it drives
    both shell scripts via `--print-paths` and calls the resource installer) and the
    installer tests around it. `.claude/CLAUDE.md` § Emulator Access.
  </read_first>
  <behavior>
    - A supervisor running a sleeping stand-in binary, sent SIGHUP, terminates that child
      before exiting.
    - Both scripts' trap registrations name EXIT and HUP as well as INT and TERM.
    - `bash -n` exits 0 for both scripts, and every pre-existing pool, skill-doc and
      selector-doc gate still passes against the reworded CLAUDE.md.
  </behavior>
  <action>
    In `vice-supervisor.sh`, split the current handler into `terminate_child` (the existing
    kill-and-wait body) plus two entry points. The signal entry point disarms all four traps,
    terminates the child, and exits 0. The EXIT entry point captures `$?` as its very first
    statement, disarms itself, terminates the child, and re-exits with the captured status —
    this is load-bearing: the crash-loop give-up path exits 4 to tell an operator the cause is
    a bad flag or a bound port, and an EXIT handler that exited 0 would erase that signal.
    Register the signal entry point for INT, TERM and HUP, and the EXIT entry point for EXIT.

    In `vice-pool.sh`, collect every supervisor pid `cmd_start` spawns into an array as it
    spawns them, and add the same two-entry-point trap so an interrupted start terminates what
    it already spawned and removes a partially written registry rather than orphaning half a
    pool. Reuse `cmd_stop`'s existing `ps -o args=` identity check before any signal. Note
    honestly in a comment that `cmd_start` is one-shot, so this window is small — the trap is
    for correctness on an interrupted start, and its behavioural coverage below is structural
    rather than timing-dependent, because a test that had to interrupt a loop this fast would
    be flaky rather than informative.

    Reword `.claude/CLAUDE.md` § Emulator Access. Keep untouched: that `mcp__vice__*` is the
    only permitted route to the emulator, that no script may open its own connection or read
    broker state to find a port, that `tools/` holds pure logic only, and that `.vice-supervisor/`
    is runtime state nobody hand-edits. Change only the clause that forbids reading or editing
    the MCP implementation: say that the vice MCP under `.claude/mcp/` is the tracked
    implementation, read and edited only when the task *is* maintaining it, and that in that
    case the host shell scripts are edited in its `resources/` directory because the `tools/`
    copies are generated and gitignored. Keep the habit of filing observed VICE MCP quirks as
    `.planning/todos/pending/` entries during emulator work — that is a triage rule about not
    derailing a plan, and it survives.

    Four durable tests constrain that rewrite and none of them may be weakened: CLAUDE.md must
    still contain the `mcp__vice__` prefix; it must still contain the exact phrase about access
    being granted on that session's first forwarded tool call; it must name none of the retired
    skills; and it must name no `.mjs` module from the vice MCP directory. Write the section
    referring to scripts and directories by path, never by module filename.

    Add to `vice-pool.test.mjs`: a supervisor SIGHUP gate that runs the supervisor with
    `VICE_SUPERVISOR_ALLOW_CONTAINER=1`, `VICE_BIN` pointed at `/bin/sleep`, `VICE_ARGS` set to
    a long duration and a temp `VICE_SUPERVISOR_DIR`, polls the written epoch record for the
    child pid, sends SIGHUP to the supervisor, and asserts the child is gone within a bounded
    poll; plus structural assertions that both scripts register EXIT and HUP; plus `bash -n`
    on both.

    Finally, refresh the deployed copies from the tracked sources with the resource installer's
    force option, so this container's gitignored `tools/*.sh` match what was just edited rather
    than silently diverging.
  </action>
  <verify>
    <automated>bash -n .claude/mcp/vice/resources/vice-supervisor.sh && bash -n .claude/mcp/vice/resources/vice-pool.sh</automated>
    <automated>node --test .claude/mcp/vice/vice-pool.test.mjs .claude/mcp/vice/skill-docs.test.mjs .claude/mcp/vice/vice-mcp-selector-docs.test.mjs</automated>
    <automated>grep -q 'mcp__vice__' .claude/CLAUDE.md && grep -q "granted on that session's first forwarded tool call" .claude/CLAUDE.md</automated>
  </verify>
  <done>
    Both scripts pass `bash -n`, register EXIT and HUP alongside INT and TERM, and the
    supervisor's give-up exit status is preserved through the new EXIT handler. The SIGHUP gate
    proves the supervisor kills its child. All three doc-gate suites pass against the reworded
    CLAUDE.md, whose § Emulator Access no longer forbids maintaining the implementation while
    the emulator-route hard rule reads exactly as before. The deployed `tools/` copies match the
    tracked sources.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| `.vice-supervisor/` bind mount → broker process | Container-writable JSON files drive which pids the host-side broker signals and which paths it deletes |
| broker → OS process table | Every pid read from that mount becomes an argument to `kill` |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-qpq-01 | Elevation / Denial of Service | `signal_recorded_pid`, `reap_all_instances`, `drop_dead_instance_records` | high | mitigate | Every pid from a JSON record passes the existing `ps -o args=` identity check against `$SUPERVISOR_SCRIPT` before any signal; a mismatch logs and refuses. SIGKILL escalation is reachable only for a pid whose identity already matched, never as a first resort. This is the same rule `teardown()` and `vice-pool.sh cmd_stop` already enforce, reused rather than re-derived. |
| T-qpq-02 | Tampering | `purge_protocol_state` | high | mitigate | The purge names only `$SPARES_DIR`, `$GRANTS_DIR`, `$REQUESTS_DIR`, `$LEASES_DIR`, `$INSTANCES_JSON` and `$BROKER_JSON` — variables resolved once at the top of the script — and refuses outright when `VICE_POOL_DIR` is empty. No recursive removal is built from a path assembled at the call site or read out of a record. |
| T-qpq-03 | Denial of Service | SIGKILL escalation vs. an in-flight `epoch.json` write | low | accept | A bounded SIGTERM wait (`VICE_BROKER_KILL_WAIT_S`, default 5 s) runs first, and the epoch writer is already tmp-then-mv atomic, so a torn record is not reachable. Accepted rather than mitigated further: an unkillable supervisor wedging shutdown is the worse outcome. |
| T-qpq-04 | Information disclosure | protocol file modes | low | accept | No new file is written by this work; the 0600 posture of `write_json_atomic` and the uid-parity precondition (D-1.2-D) are untouched. |
| T-qpq-SC | Tampering | package installs | — | n/a | This plan installs nothing from npm, pip or cargo, so the package legitimacy gate does not apply. No task may add a dependency; if one appears to be needed, stop and replan. |
</threat_model>

<verification>
Container gates, all runnable here and all required green before commit:

```
bash -n .claude/mcp/vice/resources/vice-broker.sh
bash -n .claude/mcp/vice/resources/vice-supervisor.sh
bash -n .claude/mcp/vice/resources/vice-pool.sh
node --test .claude/mcp/vice/vice-broker.test.mjs
node --test .claude/mcp/vice/vice-pool.test.mjs
node --test .claude/mcp/vice/skill-docs.test.mjs
node --test .claude/mcp/vice/vice-mcp-selector-docs.test.mjs
node --test .claude/mcp/vice/vice-broker-client.test.mjs
node --test .claude/mcp/vice/vice-proxy.test.mjs
```

Baseline for the first of those was 33/33 before any edit; it must not shrink.

## HOST VALIDATION — developer, after this lands (cannot run in this container)

These scripts refuse to run here by design, and no x64sc exists here to launch, so the
live proof is host-side and belongs to the developer. In the host workspace:

1. **Refresh the deployed copies with force.** The host's `tools/vice-broker.sh` will be
   *diverged* after this change, and the installer never overwrites a diverged target
   unless forced. Without this step the host validates the old script and every result
   below is meaningless.
2. `tools/vice-broker.sh start 1` — confirm `broker.json` records `"spares_target": 1`
   and that exactly one x64sc appears, not three.
3. With the daemon running, `pgrep -a x64sc`, then Ctrl-C the broker. Confirm every x64sc
   is gone and that `spares/`, `grants/`, `requests/`, `leases/`, `broker.json` and
   `broker-instances.json` are gone from `.vice-supervisor/`.
4. Start it again, note the x64sc pid, `kill -9` the broker (the case no trap can catch),
   then `tools/vice-broker.sh stop` with no broker process alive. Confirm it reports the
   reap and that the orphaned x64sc is gone — this is the exact failure that produced the
   `req-832` ghost grant.
5. Start it again with `VICE_BROKER_SPARES=3` and watch `supervisor.log`: the spawn
   timestamps must be staggered, one boot completing before the next begins, and all three
   must survive. Three deaths at an identical spawn second means the serialisation did not
   take effect.
6. Confirm the port band question separately if it bites: VS Code holds `127.0.0.1:6511`
   inside the default 6510–6512 range. Moving `VICE_BROKER_BASE_PORT` clear of it is
   deliberately **not** in this plan's scope — it is a configuration choice, recorded in the
   todo, not a defect in these scripts.

Defect 4 from the todo — the container-side proxy caching a dead grant for the session's
whole life, with no re-request path — is **out of scope here and stays open**. It lives in
the proxy, not in these shell scripts, and it is the reason a session whose instance dies
must be replaced rather than repaired. Leave that todo entry in place, and note in the
SUMMARY that this plan closed defects 1, 2, 3 and 5 and did not close 4.
</verification>

<success_criteria>
- Every container gate above passes, with no pre-existing gate deleted or weakened to make a
  new one green.
- Each of the five behaviour changes has at least one test that fails against the current
  code: shutdown reaping, `stop` reaping a dead broker, start-time record validation,
  serialised warming, and the grant-time readiness probe.
- Only `.claude/mcp/vice/resources/*.sh` are edited among the shell scripts; `tools/*.sh` are
  regenerated, never hand-edited.
- The reversed design decision is documented wherever the old one was stated, with its date
  and its reason — no surviving line of any script or doc contradicts the new behaviour.
- `.claude/CLAUDE.md` § Emulator Access keeps the emulator-route hard rule verbatim in force
  and no longer forbids the work this plan performs.
</success_criteria>

<output>
Create `.planning/quick/260801-qpq-make-vice-broker-and-supervisor-shutdown/260801-qpq-SUMMARY.md` when done.
</output>
