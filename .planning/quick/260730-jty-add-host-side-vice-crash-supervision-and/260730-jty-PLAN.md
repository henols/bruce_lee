---
phase: quick-260730-jty
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - tools/vice-supervisor.sh
  - tools/vice.mjs
  - tools/recover.mjs
  - tools/recover.test.mjs
  - .gitignore
  - .planning/STATE.md
autonomous: true
requirements: [D-1, D-2, D-3, D-4, D-5, D-6]
user_setup:
  - service: host-vice
    why: "The supervisor can only be started on the host; this container cannot execute x64sc."
    dashboard_config:
      - task: "Start VICE via tools/vice-supervisor.sh from the host workspace instead of launching x64sc by hand"
        location: "Host terminal at /home/henrik/dev/henrik/git/bruce_lee — never the devcontainer"

must_haves:
  truths:
    - "Running tools/vice-supervisor.sh inside this devcontainer exits non-zero with a loud HOST-ONLY message and spawns nothing (D-2)."
    - "Every x64sc spawn writes a monotonically increasing epoch plus spawn timestamp to a JSON file in the workspace, written atomically, readable from the container over the existing bind mount (D-1)."
    - "Every x64sc exit produces a timestamped log holding its stderr and a decoded exit status/signal, kept as crash evidence (D-4)."
    - "A capture whose emulator identity changed, or could not be proven unchanged, mid-run is voided: no .bin is presented as valid and the operator is told to re-run (D-3)."
    - "With no supervisor running the epoch file is simply absent, and that is not an error — the harness still works exactly as it does today (D-3)."
    - "node --test tools/recover.test.mjs passes, including new cases for epoch-changed, epoch-absent, and checkpoint-disappeared (D-6)."
    - "vice.mjs still refuses DENY_LIST tools before serialising a request, and still retries only TRANSPORT failures, never RPC-level errors (D-3)."
    - "Recovery wording in tools/*.mjs and .planning/STATE.md points at the supervisor, and the existing unconfirmed hazard entry is still present (D-5)."
  artifacts:
    - tools/vice-supervisor.sh
    - tools/vice.mjs
    - tools/recover.mjs
    - tools/recover.test.mjs
    - .gitignore
    - .planning/STATE.md
  key_links:
    - "supervisor writes .vice-supervisor/epoch.json on the host -> readEpoch() reads the same file in the container over the existing workspace bind mount — no new port, socket or IPC."
    - "withReconnect() records that a reconnect happened -> assertSameMachine() consumes it -> MachineRestartedError -> voidRun() runs BEFORE any .bin is accepted."
    - "capture()'s armed checkpoint id -> assertSameMachine()'s fallback probe, the only identity signal available when no supervisor is running."
---

<objective>
The host VICE MCP server has now died six times in one session. Each death hard-blocks every
emulator task until the user restarts x64sc by hand. This adds a host-side supervisor that
respawns it (D-1) while preserving the crash evidence needed to confirm or kill the still
unconfirmed `vice_run_until` / `vice_execution_run` hypothesis (D-4) — and, critically, teaches
the container-side harness to notice that a restart happened, so the new supervision cannot
silently convert a loud crash into a quiet, wrong dump (D-3).

Purpose: today a crash stops everything, loudly. `withReconnect()` in tools/vice.mjs already
retries transport failures for ~50s and redoes the handshake. Once something is respawning
x64sc, that retry will start SUCCEEDING — against a brand-new blank machine with no disk
attached, no checkpoints armed and the CPU halted at the BASIC prompt. The capture would then
keep reading empty RAM and write a plausible-looking 64K image that is garbage. For a project
whose whole discipline is that every documented byte carries a confidence level, that is
strictly worse than the crash. Supervision without detection is a downgrade; they ship together
or not at all.

Output: `tools/vice-supervisor.sh` (host-only, guarded, evidence-collecting, epoch-emitting),
session-identity support in `tools/vice.mjs`, void-the-run behaviour in `tools/recover.mjs`,
new node:test coverage, and corrected recovery wording in code and STATE.md.

Tracer link — the one end-to-end path that IS checkable in this container: Task 1's `--dry-run`
writes a real epoch file, and Task 2's verify reads that exact file back through the harness's
own `readEpoch()`. The host-to-container channel is therefore proven here even though x64sc
itself cannot run in this container.
</objective>

<context>
@.planning/STATE.md
@tools/vice.mjs
@tools/recover.mjs
@tools/recover.test.mjs
@.claude/skills/devcontainer-host-path/hostpath.mjs
</context>

<constraints>
- **No new runtime dependencies.** Node stdlib plus bash only. There is no package.json and none
  is being added. `jq` must not be assumed present on the host.
- **Match the existing idiom in tools/*.mjs**: ES modules, exported functions, dependency
  injection for testability (see `captureImage({ call: callFn, ... })`), and the heavy
  explanatory comment style — comments state WHY, including what went wrong before. New code
  that omits a WHY comment for a non-obvious choice is not done.
- **This container cannot run x64sc.** Do not write verify steps that need a live emulator.
  Supervisor verification is limited to `bash -n`, the executable bit, the container guard
  actually refusing in here, and epoch-file shape via `--dry-run`. Host-side steps belong in the
  human-verification section for the user to run, not in `<verify>`.
- **Do not weaken vice.mjs's two existing guarantees**: the `DENY_LIST` check stays the first
  statement in `call()`, before anything is serialised; and only TRANSPORT failures are retried,
  never RPC-level errors — a server that answered and said no gets to keep its answer.
- **Do not arm extra checkpoints** as identity sentinels. Checkpoint work is one of the two live
  crash suspects; the fallback probe reuses checkpoints the harness already armed for its own
  reasons and adds none.
- **Never auto-reboot and never auto-resume** (D-3). Captures are deterministic and cheap to
  repeat; a wrong dump is not.
</constraints>

<tasks>

<task type="auto">
  <name>Task 1: Host-only VICE supervisor — container guard, crash-loop give-up, evidence logs, epoch file</name>
  <files>tools/vice-supervisor.sh, .gitignore</files>
  <read_first>tools/vice.mjs (endpoint/port 6510 and the tone of the existing comments); .devcontainer/devcontainer.json (HOST_WORKSPACE_PATH=/home/henrik/dev/henrik/git/bruce_lee, CONTAINER_WORKSPACE_PATH=/workspaces/bruce_lee — the bind mount that makes the epoch file a host-to-container channel)</read_first>
  <action>
Create `tools/vice-supervisor.sh` (bash, `#!/usr/bin/env bash`, `set -euo pipefail`) and make it
executable.

HEADER COMMENT BLOCK (D-2), before any code: state that this script runs on the HOST ONLY and
never inside the devcontainer; that x64sc, its window and its MCP listener all live on the host
while this repo is a bind mount visible from both sides; give the concrete host invocation
(`/home/henrik/dev/henrik/git/bruce_lee/tools/vice-supervisor.sh`, i.e.
`<host workspace>/tools/vice-supervisor.sh`); and explain that its epoch file is the only
channel back to the container, deliberately a plain file on the shared mount rather than a new
port, socket or IPC mechanism.

ORDER OF OPERATIONS — load-bearing (D-2): `--help`/`-h` may print usage and exit 0 first, since
it writes no state and spawns nothing; note that exception in a comment. Immediately after,
before ANY state is written and before ANY process is spawned, run the container guard.

CONTAINER GUARD (D-2): collect matched signals into an array using MORE THAN ONE signal —
`/.dockerenv` exists; `/run/.containerenv` exists (podman); `CONTAINER_WORKSPACE_PATH` is set
(this devcontainer sets it); `/proc/1/cgroup` or `/proc/self/mountinfo` matches
`docker|containerd|kubepods|libpod`. If any signal fired and `VICE_SUPERVISOR_ALLOW_CONTAINER`
is not `1`, print to stderr a loud refusal that names EVERY signal that fired and explains why
this cannot work in here (no x64sc binary, no display, and the entire point of the script is to
restart a process the container has no access to), mention the escape-hatch variable by name,
and `exit 2`. Document the escape hatch in the usage text as being for testing only.

CONFIGURATION, all env-overridable with defaults (D-1): `VICE_BIN` (default `x64sc`),
`VICE_ARGS` (default `-mcpserver -mcpserverhost 0.0.0.0`), `VICE_SUPERVISOR_DIR` (default
`<repo>/.vice-supervisor`, where `<repo>` is derived from the script's own location via
`BASH_SOURCE`, never hardcoded), `VICE_RESTART_BACKOFF_S` (default 3),
`VICE_RESTART_BACKOFF_MAX_S` (default 30), `VICE_MAX_RESTARTS` (default 5),
`VICE_CRASH_WINDOW_S` (default 120). Split `VICE_ARGS` once into a bash array with `read -ra`
and quote `"$VICE_BIN"` when spawning; print the fully resolved command line at startup so an
unexpected override is visible rather than silent (T-jty-02).

STARTUP OUTPUT: resolved binary and args, supervisor dir, epoch file path, log dir, and a line
reminding the operator that the container reads the epoch file to detect restarts.

EPOCH FILE (D-1) at `$VICE_SUPERVISOR_DIR/epoch.json`, written on EVERY spawn, ATOMICALLY —
write a temp file in the same directory then `mv` it into place, because the container polls
this file and must never read a half-written one; put that reason in a comment. Fields:
`epoch` (integer, monotonically increasing), `spawned_at` (ISO-8601 UTC), `pid` (the x64sc
pid), `supervisor_pid`, `vice_bin`, `vice_args`, `log` (this run's log path, relative to the
supervisor dir), `dry_run` (boolean). Read the previous `epoch` back out of the existing file
with `sed`/`grep`, NOT `jq`, which cannot be assumed present on the host; start at 1 when the
file is absent or unparseable. Comment that the epoch is only trustworthy while this supervisor
is the thing launching VICE — a manual restart behind its back leaves the epoch unchanged,
which is exactly why the container-side check keeps a second, independent signal (Task 2's
checkpoint fallback).

`--dry-run` FLAG: write exactly one epoch record with `dry_run` true, print where it went, and
exit 0 without spawning anything. It exists so the epoch contract can be verified inside the
container, where x64sc does not exist; say that in the comment beside it.

RESPAWN LOOP (D-1, D-4): per iteration, build a timestamped log path
`$VICE_SUPERVISOR_DIR/logs/x64sc-YYYYmmdd-HHMMSS.log`; spawn `"$VICE_BIN" "${args[@]}"` with
stdout and stderr redirected into it; write the epoch record with the resulting pid; `wait` for
the child and capture its status; decode a signal death (status greater than 128 means signal
status-128) and append a one-line crash record to `$VICE_SUPERVISOR_DIR/crashes.log` carrying
timestamp, epoch, pid, exit status, decoded signal and log path, followed by the last ~20 lines
of that log so the evidence is readable without opening it. Comment that this evidence is the
POINT, not a nicety: the crash root cause is still unconfirmed — STATE.md records only a
two-data-point hypothesis around `vice_run_until` creating its own temporary checkpoint, plus
the later observation that the last three outages all landed on `vice_execution_run` — and a
supervisor that silently respawned would destroy the only trail that can confirm or kill it
(D-4).

BACKOFF AND CRASH-LOOP GIVE-UP (D-1): sleep `VICE_RESTART_BACKOFF_S` between restarts, doubling
up to `VICE_RESTART_BACKOFF_MAX_S`. Keep the timestamps of recent restarts; if
`VICE_MAX_RESTARTS` restarts occur within `VICE_CRASH_WINDOW_S`, stop looping, print WHY —
naming the two things that actually cause this, a bad flag in `VICE_ARGS` or port 6510 already
bound by an x64sc that is still running — plus the last exit status and last log path, and
`exit 4`. A bad flag or an occupied port must not spin forever.

Trap INT and TERM: kill the child, log a clean shutdown, exit 0. Do not leave an orphaned x64sc
behind.

Document the exit codes in the usage text: 0 clean, 1 usage error, 2 container guard refusal, 4
crash-loop give-up.

Finally, add `.vice-supervisor/` to `.gitignore` (D-1) under a comment explaining that these are
host-side crash logs and the restart epoch, regenerated on every supervisor start.
  </action>
  <verify>
    <automated>bash -n tools/vice-supervisor.sh && test -x tools/vice-supervisor.sh && { command -v shellcheck >/dev/null 2>&1 && shellcheck tools/vice-supervisor.sh || echo "shellcheck absent in this container - skipped, not a failure"; }</automated>
    <automated>bash tools/vice-supervisor.sh --dry-run >/tmp/sup.out 2>/tmp/sup.err; rc=$?; test "$rc" -ne 0 && grep -Eqi 'host' /tmp/sup.err && echo "container guard refused, rc=$rc"</automated>
    <automated>D=$(mktemp -d); VICE_SUPERVISOR_ALLOW_CONTAINER=1 VICE_SUPERVISOR_DIR="$D" bash tools/vice-supervisor.sh --dry-run && VICE_SUPERVISOR_ALLOW_CONTAINER=1 VICE_SUPERVISOR_DIR="$D" bash tools/vice-supervisor.sh --dry-run && node -e 'const e=JSON.parse(require("fs").readFileSync(process.argv[1]+"/epoch.json","utf8")); if(e.epoch!==2) throw new Error("epoch did not increment monotonically: "+e.epoch); for(const k of ["epoch","spawned_at","pid","supervisor_pid","vice_bin","vice_args","log","dry_run"]) if(!(k in e)) throw new Error("missing field: "+k); console.log("epoch.json ok", JSON.stringify(e));' "$D"</automated>
    <automated>grep -q 'vice-supervisor' .gitignore && git check-ignore -q .vice-supervisor/epoch.json && echo "supervisor output dir is gitignored"</automated>
  </verify>
  <done>
`tools/vice-supervisor.sh` exists, is executable, passes `bash -n`, refuses to run in this
container with a non-zero exit and a message naming the signals that fired, writes a
well-formed atomically-updated `epoch.json` whose `epoch` increments across `--dry-run`
invocations, and its output directory is gitignored. The respawn loop, per-crash log with
decoded exit status/signal, backoff and crash-loop give-up are all present and commented with
their reasons.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Container-side restart detection — void the run, never auto-resume</name>
  <files>tools/vice.mjs, tools/recover.mjs, tools/recover.test.mjs</files>
  <read_first>tools/vice.mjs `withReconnect()` and `call()` (the DENY_LIST guard and the transport-vs-RPC distinction that must survive this change); tools/recover.mjs `capture()`, `recover()`, `runToCheckpoint()`, `waitCheckpointHit()`; tools/recover.test.mjs (the node:test idiom and the `{ call: stubCall }` injection pattern already used for `captureImage`)</read_first>
  <behavior>
Identity rules the tests must pin down (D-3):
  - Baseline epoch present, later read shows a DIFFERENT epoch -> MachineRestartedError, run void.
  - Epoch file absent at session start -> not an error; `readEpoch()` reports absence and the
    capture proceeds exactly as it does today with no supervisor running.
  - Epoch absent, a reconnect happened, and a checkpoint the harness itself armed is missing
    from `vice_checkpoint_list` -> MachineRestartedError, run void.
  - Epoch absent, a reconnect happened, and the armed checkpoint IS still present -> pass; the
    machine is demonstrably the same one.
  - A reconnect happened and NOTHING can prove sameness (no epoch file and no armed checkpoint
    to probe) -> void, with a message saying identity could not be proven and recommending the
    supervisor. Unproven is not the same as fine; re-running a capture is cheap.
  - No reconnect and no epoch change -> pass, and no extra MCP call is made (the epoch check is
    a plain file read; the checkpoint probe only happens after a reconnect).
  - `voidRun()` on artifacts that exist renames them so they cannot be mistaken for valid, and
    is a no-op on artifacts that do not exist.
  </behavior>
  <action>
**tools/vice.mjs — a new "session identity" section** (D-3, D-4). Explain in a block comment WHY
it lives in the transport seam: this file is the only place that knows a reconnect happened, and
`withReconnect()`'s retry becoming SUCCESSFUL under supervision is precisely what turns a loud
crash into a quiet, wrong dump.

Export:
  - `EPOCH_FILE` default `<repo>/.vice-supervisor/epoch.json`, resolved relative to this file's
    own location, overridable with `VICE_EPOCH_FILE`.
  - `readEpoch(path = EPOCH_FILE)` — synchronous, never throws. Returns
    `{ present, epoch, spawned_at, pid, path, reason? }`. Absence returns `present: false` with
    no error (D-3): the harness must work with no supervisor at all. Treat the file's contents
    as untrusted host-written input (T-jty-01): `JSON.parse` inside try/catch, require `epoch`
    to be a finite integer, ignore unknown fields, and never open a path taken from it.
  - `beginSession({ epochPath } = {})` — captures the baseline epoch, zeroes the reconnect
    counter, returns a session handle `{ baseline, epochPath, startedAt }`.
  - `sessionReconnects()` and `lastToolCall()` — read-only accessors over module state.
  - `MachineRestartedError extends ViceError`, carrying `baselineEpoch`, `currentEpoch`,
    `where`, and `lastToolCall`.
  - `assertSameMachine(session, { where, armedCheckpoints = [], reconnected = sessionReconnects() > 0, call: callFn = call } = {})` —
    async, implements the rules in `<behavior>`. `call` is injected exactly like
    `captureImage({ call: callFn })` so the fallback path is unit-testable with a stub.

In `withReconnect()`: increment a session reconnect counter each time a transport failure forces
`initialized = false`, and record `lastToolCall` as the tool name plus a short truncated arg
summary (~120 chars — D-4 wants the last call before a detected restart, not a full transcript).
Keep the TRANSPORT-only retry predicate exactly as it is.

In `call()`: leave the `DENY_LIST` check as the first statement, untouched and un-reordered.
After `withReconnect()` returns, if that call needed a reconnect, run the CHEAP epoch check only
(a synchronous file read, zero MCP traffic) and throw `MachineRestartedError` immediately on a
changed epoch — the earliest and loudest possible detection point. Do not perform the checkpoint
probe here; that would be a re-entrant `call()`. Instead set a module flag that
`assertSameMachine()` consumes.

**tools/recover.mjs** (D-3):
  - Track checkpoints the harness itself armed in a module-level `Set`: add on
    `vice_checkpoint_add` success in `runToCheckpoint()` and `capture()`, remove on successful
    delete. This is the ONLY identity signal available with no supervisor running, and it costs
    no new checkpoints — comment that arming a sentinel checkpoint was rejected because
    checkpoint work is itself a crash suspect.
  - `recover()` calls `beginSession()` before `reset()` and threads the session into
    `capture(releaseId, addr, { releaseKeys, session })`; `capture()` starts its own session when
    none is passed, so the `capture` CLI verb is covered too.
  - Call `assertSameMachine()` at three points, each with a distinct `where` label: at the start
    of `capture()` before arming (cheap, epoch-only); immediately after `waitCheckpointHit()`
    returns, passing the still-armed trigger checkpoint id (the long wait is where an outage is
    most likely); and after `captureWithFallback()` before the image is returned — the "before
    any dump is declared good" gate from D-3.
  - Export `voidRun({ binPath, capturePath, reason })`: rename any artifact that exists to
    `<name>.VOID-<ISO timestamp>` and write a sibling `.VOID.json` note holding the reason, the
    baseline and observed epochs, `lastToolCall()` and the timestamp, so a voided run is itself
    evidence (D-4). Missing artifacts are a silent no-op.
  - `recover()` catches `MachineRestartedError`, calls `voidRun()`, and rethrows with an operator
    message along the lines of: the emulator restarted mid-capture, this run is void, re-run it.
    Do NOT reset, reboot or resume automatically (D-3). `reproduce()` must let the error
    propagate rather than comparing hashes across a voided run.
  - Add a `--void-check`-free design note in a comment: absence of the epoch file is normal and
    silent; only a CHANGE, or an unprovable reconnect, voids anything.

**tools/recover.test.mjs** (D-6): extend the existing file in its current node:test idiom — no
new framework, no new dependency. Add cases covering every bullet in `<behavior>`, driving
`assertSameMachine()` with a temp epoch file (`mkdtemp` under `os.tmpdir()`) and a stub `call`
that returns a synthetic `{ checkpoints: [...] }`, plus a `voidRun()` case over temp files. Keep
the existing `assembleChunks`/`captureImage` tests untouched and green.
  </action>
  <verify>
    <automated>node --test tools/recover.test.mjs</automated>
    <automated>VICE_SUPERVISOR_ALLOW_CONTAINER=1 bash tools/vice-supervisor.sh --dry-run && node -e 'import("./tools/vice.mjs").then(m=>{const e=m.readEpoch(); if(!e.present||!Number.isInteger(e.epoch)) throw new Error("harness could not read the supervisor epoch file"); console.log("readEpoch sees supervisor epoch",e.epoch);})'</automated>
    <automated>node -e 'import("./tools/vice.mjs").then(m=>{const e=m.readEpoch("/nonexistent/epoch.json"); if(e.present!==false) throw new Error("absent epoch file must report present:false"); if(!m.DENY_LIST.includes("vice_disk_list")) throw new Error("DENY_LIST guard lost"); console.log("absent epoch file is not an error; DENY_LIST intact");})'</automated>
    <automated>node tools/recover.mjs >/dev/null && node tools/vice.mjs >/dev/null; echo "both CLIs still load and print usage"</automated>
  </verify>
  <done>
`node --test tools/recover.test.mjs` passes with the new cases. A changed epoch or an unprovable
reconnect raises `MachineRestartedError`, `voidRun()` renames the artifacts and writes the
evidence note, and no `.bin` from such a run is presented as valid. An absent epoch file is
silent and non-fatal. `DENY_LIST` is still checked first in `call()` and only transport failures
are retried. The harness reads the real epoch file the supervisor's `--dry-run` produced.
  </done>
</task>

<task type="auto">
  <name>Task 3: Point every recovery instruction at the supervisor, and record it in STATE.md</name>
  <files>tools/vice.mjs, tools/recover.mjs, .planning/STATE.md</files>
  <read_first>tools/vice.mjs (the two manual-restart strings in `rpc()`'s timeout branch and in `withReconnect()`'s give-up throw); tools/recover.mjs (`waitCheckpointHit()`'s give-up message, which points at a release NOTES.md that does not exist, and `findEntry()`'s hung-execution message); .planning/STATE.md Blockers/Concerns</read_first>
  <action>
D-5. Rewrite the operator-facing recovery wording so it names the supervisor instead of telling
the reader to restart VICE by hand:

  - `tools/vice.mjs`: the timeout message in `rpc()` and the give-up message in
    `withReconnect()`. Both should say that recovery is a host-side restart, that this container
    cannot perform it, and that `tools/vice-supervisor.sh` (run on the HOST) does it
    automatically and logs the crash for the still-open root-cause investigation. Also refresh
    the block comment above `RECONNECT_ATTEMPTS`, which currently ends with "and ask for a manual
    restart" — under supervision the retry may now succeed against a DIFFERENT machine, which is
    what the identity check added in Task 2 exists to catch; state that connection explicitly so
    the next reader does not remove one half of it.
  - `tools/recover.mjs`: the same treatment for `waitCheckpointHit()`'s give-up message (drop the
    dangling reference to a release NOTES.md that does not exist) and `findEntry()`'s
    hung-execution message.

  - `recovery/**/NOTES.md`: none exist today (`find recovery -name NOTES.md` returns nothing).
    Run that find; update any file it turns up that carries the same manual-restart wording. Do
    NOT create a NOTES.md that does not exist — there is nothing to document there yet.

  - `.planning/STATE.md`: add ONE entry to Blockers/Concerns recording that host-side supervision
    now exists (`tools/vice-supervisor.sh`, host-only), that per-crash x64sc logs and exit
    status/signal are being collected under `.vice-supervisor/` as evidence for the still
    unconfirmed `vice_run_until` / `vice_execution_run` hypothesis, and that the harness now
    voids any capture whose emulator identity changed or could not be proven mid-run rather than
    writing a dump from a fresh blank machine. DO NOT delete or edit the existing HAZARD
    CANDIDATE entry — the hypothesis is still unconfirmed and still true. Update the `last_*`
    frontmatter fields in the same idiom the file already uses.
  </action>
  <verify>
    <automated>test "$(grep -c 'vice-supervisor.sh' tools/vice.mjs)" -ge 2 && test "$(grep -c 'vice-supervisor.sh' tools/recover.mjs)" -ge 2 && echo "code recovery wording points at the supervisor"</automated>
    <automated>grep -q 'vice-supervisor.sh' .planning/STATE.md && grep -q 'HAZARD CANDIDATE' .planning/STATE.md && echo "STATE.md records supervision and still carries the unconfirmed hazard entry"</automated>
    <automated>node --test tools/recover.test.mjs && node tools/vice.mjs >/dev/null; echo "docs pass did not break the harness"</automated>
    <automated>for f in $(find recovery -name NOTES.md); do grep -q 'vice-supervisor.sh' "$f" || { echo "stale recovery instructions in $f"; exit 1; }; done; echo "recovery NOTES.md files consistent (none exist today)"</automated>
  </verify>
  <done>
Every operator-facing recovery message in `tools/vice.mjs` and `tools/recover.mjs` names
`tools/vice-supervisor.sh` and says it runs on the host; the `RECONNECT_ATTEMPTS` comment
explains why a now-succeeding retry needs the identity check. STATE.md carries a new entry about
supervision and evidence collection, with the original HAZARD CANDIDATE entry intact. Any
existing recovery NOTES.md is consistent; none is invented.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| host -> container | `.vice-supervisor/epoch.json` is written by a host process and parsed inside the container. It is the only new data crossing in. |
| operator env -> shell exec | `VICE_BIN` / `VICE_ARGS` become the command line the supervisor spawns on the host. |
| supervisor -> shared filesystem | Logs, crash records and the epoch file are written into the bind-mounted repo, visible from both sides. |
| emulator -> capture artifacts | A restarted (blank) emulator can supply bytes that look like a valid dump. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-jty-01 | Tampering | `readEpoch()` parsing `.vice-supervisor/epoch.json` | medium | mitigate | Treat as untrusted input: `JSON.parse` in try/catch, require `epoch` to be a finite integer, ignore unknown fields, never open a path taken from the file, never eval. A malformed file reports `present:false` rather than throwing. |
| T-jty-02 | Elevation of Privilege | `VICE_BIN` / `VICE_ARGS` in `vice-supervisor.sh` | medium | mitigate | Operator-supplied configuration running at the operator's own privilege, not an injection channel — but quote `"$VICE_BIN"`, split `VICE_ARGS` once into a bash array with `read -ra`, and print the fully resolved command line at startup so an unexpected value is visible before anything spawns. |
| T-jty-03 | Denial of Service | supervisor respawn loop | high | mitigate | Backoff between restarts plus a crash-loop give-up threshold (N restarts within a window) that stops, prints the two realistic causes (bad flag, port 6510 already bound) and exits non-zero. A bad flag cannot spin forever. |
| T-jty-04 | Spoofing | a fresh blank emulator masquerading as the captured machine | high | mitigate | Epoch comparison plus an armed-checkpoint fallback probe after any reconnect; an unprovable identity voids the run. `voidRun()` renames artifacts so a void run can never be read as valid. |
| T-jty-05 | Repudiation | crash root cause unconfirmed, evidence lost on respawn | high | mitigate | Per-crash timestamped log with x64sc stderr, decoded exit status/signal, and a `crashes.log` line; the harness records `lastToolCall()` into the void note so both halves of the picture survive. |
| T-jty-06 | Information Disclosure | `.vice-supervisor/logs/*.log` | low | accept | Contents are x64sc stderr only, no credentials; the directory is gitignored so nothing is published. Accepted. |
| T-jty-SC | Tampering | npm/pip/cargo installs | high | accept | No package installs in this change — zero new runtime dependencies, bash and Node stdlib only. The package legitimacy gate has nothing to audit here. |

</threat_model>

<verification>
All automated verification runs in-container:

```bash
bash -n tools/vice-supervisor.sh && test -x tools/vice-supervisor.sh
bash tools/vice-supervisor.sh --dry-run; test $? -ne 0     # container guard refuses
node --test tools/recover.test.mjs                          # all tests green
node tools/recover.mjs >/dev/null && node tools/vice.mjs >/dev/null
git check-ignore -q .vice-supervisor/epoch.json
```

`shellcheck` is NOT installed in this container; the syntax gate is `bash -n`, with shellcheck
run opportunistically if it ever becomes available.
</verification>

<human_verification>
The container cannot execute `x64sc`, so the supervisor's actual behaviour must be confirmed by
the user, on the HOST, from `/home/henrik/dev/henrik/git/bruce_lee`:

1. **Guard sanity (host):** `./tools/vice-supervisor.sh --help` prints usage and exits 0.
2. **Normal start:** with no x64sc running, `./tools/vice-supervisor.sh` launches VICE, the
   window appears, and startup output names the resolved command line and epoch path. Confirm
   `.vice-supervisor/epoch.json` exists with `epoch: 1` and a real `pid`.
3. **Restart detection (host + container):** kill x64sc (`pkill x64sc`, or close the window). The
   supervisor should log the exit with its status/signal, back off, respawn, and bump `epoch` to
   2. From the container, `node -e 'import("./tools/vice.mjs").then(m=>console.log(m.readEpoch()))'`
   should show the new epoch.
4. **Void behaviour end-to-end:** start `node tools/recover.mjs recover danish` on the container
   side, then kill x64sc mid-capture. Expected: the harness aborts with an emulator-restarted
   message, no new valid `.bin` appears in `recovery/danish/dumps/`, and any partial artifact is
   renamed `*.VOID-*` with a sibling `.VOID.json` note. It must NOT reboot or resume by itself.
5. **Crash-loop give-up:** run the supervisor a second time while the first is still running
   (port 6510 already bound) and confirm it gives up after the threshold with a message naming
   the likely cause, exiting non-zero rather than spinning.
6. **Evidence:** confirm `.vice-supervisor/logs/` holds one timestamped log per run and
   `crashes.log` has one line per death with the decoded exit status/signal.
</human_verification>

<success_criteria>
- [ ] `tools/vice-supervisor.sh` exists, is executable, passes `bash -n`, and refuses to run in
      this container with a non-zero exit naming the signals that fired (D-2)
- [ ] `--dry-run` writes an atomically-updated `epoch.json` whose `epoch` increments monotonically
      and whose fields match the documented shape (D-1)
- [ ] Respawn loop, backoff, crash-loop give-up, per-crash log with decoded exit status/signal,
      and `crashes.log` are all implemented (D-1, D-4)
- [ ] `.vice-supervisor/` is gitignored (D-1)
- [ ] Epoch change, or an unprovable reconnect, aborts the capture and voids the artifacts; no
      auto-reboot, no auto-resume (D-3)
- [ ] Missing epoch file is silent and non-fatal; the checkpoint-disappeared fallback covers the
      no-supervisor case (D-3)
- [ ] `DENY_LIST` still checked first in `call()`; transport-vs-RPC retry distinction preserved (D-3)
- [ ] `node --test tools/recover.test.mjs` green, extended with the three D-6 cases plus the
      checkpoint-present and voidRun cases, in the existing node:test idiom, no new dependency (D-6)
- [ ] Recovery wording in `tools/vice.mjs` and `tools/recover.mjs` names the supervisor; STATE.md
      records supervision + evidence collection with the HAZARD CANDIDATE entry left intact (D-5)
</success_criteria>

<decision_coverage_audit>
| Decision | Covered by | Status |
|----------|-----------|--------|
| D-1 host-only bash supervisor: launch, respawn, backoff, crash-loop give-up, per-crash evidence, epoch file, chmod +x, gitignore | Task 1 | COVERED |
| D-2 HOST-ONLY marking, multi-signal runtime guard first, documented escape hatch | Task 1 | COVERED |
| D-3 restart detection, fail loudly, void the run, no auto-resume, epoch-absent fallback, DENY_LIST and transport/RPC distinction preserved | Task 2 | COVERED |
| D-4 evidence collector: stderr + exit code/signal logs; harness records last tool call before a detected restart | Task 1 (logs) + Task 2 (`lastToolCall()` in the void note) | COVERED |
| D-5 documentation: vice.mjs messages, recovery NOTES.md if any, STATE.md entry without deleting the hazard | Task 3 | COVERED |
| D-6 tests: recover.test.mjs green and extended for epoch-changed / epoch-absent / checkpoint-disappeared, existing idiom | Task 2 | COVERED |

No decision is deferred, reduced, or split. No item from the locked-decision set is unplanned.
</decision_coverage_audit>

<output>
Commit each task separately. No SUMMARY file is required for quick mode; the operator-facing
record is the STATE.md entry written in Task 3.
</output>
