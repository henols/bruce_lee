# Quick Task 260802-d6v: add a detached run mode to the vice broker — Context

**Gathered:** 2026-08-02
**Status:** Ready for planning

> **Provenance of these decisions:** the user asked to "finish everything so it is complete" and
> then left the machine. These decisions are therefore **the assistant's**, not the user's,
> recorded here so the plan treats them as fixed and so the user can audit them on return.
> Where a choice was genuinely close, the alternative is named.

<domain>
## Task Boundary

Close the last open VICE-broker defect:
`.planning/todos/pending/2026-08-02-vice-broker-has-no-detached-run-mode.md` (severity `major`).

The broker runs in the foreground only. A stray Ctrl-C, a closed terminal, or a SIGHUP from an
ending SSH/VS Code session reaps **every instance it is tracking** — not just the process the
human meant to stop. Observed live on 2026-08-02: `^C` produced `reap saw 4 recorded
instance(s), terminated 4`, and a live session's `vice_ping` immediately returned ECONNREFUSED
against its cached grant. This has already halted plan 01-04 once.

**Out of scope:** the `$07DE` silent stall blocking 01-04. Unrelated defect, needs `/gsd-debug`
and live emulator work, not a shell-script change.

</domain>

<decisions>
## Implementation Decisions

### THE CONTRACT THAT MUST NOT CHANGE

**Reap-on-signal stays exactly as `260801-qpq` designed it.** The todo says this twice, in bold,
because it is the thing most likely to be "helpfully" reversed:

> The reap-everything-on-signal contract itself is deliberate and is NOT the defect. […] **this is
> not a request to reverse the reap-on-signal contract** — the fix is to the deployment shape, not
> the shutdown policy.

Concretely: the detached child **still installs `trap broker_shutdown EXIT HUP INT TERM`**, and
`stop` still terminates every tracked instance and purges protocol state. The fix changes *which
signals can reach the broker*, never *what the broker does when one arrives*. A plan that weakens,
narrows, or conditionalises the trap has misread the task.

### Detach mechanism

- Add a **`--detach` flag**, valid on `start` only.
- Reject it on `stop`/`status` with a usage error, mirroring the existing `N_ARG` rejection at
  lines ~382-388 (`'$SUBCOMMAND' takes no positional argument`). Same shape, same exit 1.
- `--detach` is **incompatible with `--once`** — `--once` is a single pass that returns, so
  detaching it is meaningless. Reject the combination with a usage error rather than silently
  preferring one.
- Mechanism: **re-exec self under `setsid`**, so the daemon leaves the terminal's session and
  process group entirely. That is what makes a terminal-directed SIGINT (Ctrl-C goes to the
  foreground *process group*) and a session-death SIGHUP stop reaching it.
  - `setsid` is present at `/usr/bin/setsid` (verified in-container) and is util-linux, which the
    script's existing HOST-ONLY GNU-coreutils assumption already implies. **Still check for it**
    and fail with a clear, actionable message if absent — do not silently fall back to a weaker
    mechanism that only *looks* detached.
  - Guard the re-exec against infinite recursion with an internal env marker (e.g.
    `VICE_BROKER_DETACHED_CHILD=1`) that the child sets/consumes, so the child runs the normal
    daemon path instead of re-detaching forever. **This is the single highest-risk bug in the
    task** — a recursion bug here forks unboundedly on the host.
- The parent must **return promptly** after spawning, printing the child pid and the log path.

### Logging

- Detached output goes to a log file, since the child no longer has the terminal: default
  `$VICE_POOL_DIR/broker.log`, overridable via a `VICE_BROKER_LOG` env knob (documented in
  `usage()` alongside the existing `VICE_BROKER_*` knobs).
- **Append, never truncate** — a restart must not destroy the previous run's evidence, which is
  exactly the evidence the 2026-08-02 defect hunt needed.
- Redirect both stdout and stderr. Close/redirect stdin from `/dev/null`.
- `broker.log` must **not** collide with any protocol glob. Existing globs are `*.json`-scoped
  (`spares/`, `grants/`, `requests/`) — `.log` matches none. **Confirm by grep, do not assume.**
  Note `purge_protocol_state()` removes `broker.json`; it must **not** be extended to remove
  `broker.log` (the log outliving a purge is the point).

### Foreground warning

- The foreground `start` path prints a **loud, explicit warning at startup** naming what a Ctrl-C
  in that terminal will destroy: every tracked instance, **including instances granted to other
  agents' sessions**, and that those sessions lose their accumulated context.
- Point at `--detach` in the same message as the remedy.
- This is the half of the fix that helps even when someone chooses not to detach, so it is **not
  optional** and not a nice-to-have.

### Testing — and its honest limit

- Tests go in `.claude/mcp/vice/vice-broker.test.mjs`, following its established idiom.
- The container guard **can** be bypassed in-container with `VICE_SUPERVISOR_ALLOW_CONTAINER=1`
  (already used throughout that file), so detached mode is genuinely exercisable here — this is
  not a "can only be tested on the host" change.
- Test with `--dry-run` so no real `x64sc` is ever launched, against a `mkdtemp` pool dir.
- Coverage required:
  1. `start --detach` returns promptly and prints a pid and a log path.
  2. The child is **in a different session id than the test's own process** — assert via
     `ps -o sid=`. This is the assertion that actually proves detachment; a test that only checks
     the parent returned proves nothing.
  3. `--detach` with `--once`, and `--detach` on `stop`/`status`, each exit 1 with a usage error.
  4. The foreground warning text appears on a foreground `start` and names Ctrl-C.
  5. `stop` still reaps a detached broker — the contract above, proven rather than asserted.
- **HAZARD, and the reason this task is riskier than 260802-ci3:** these tests spawn a genuinely
  detached, long-lived process that by construction ignores the signals a test runner would
  normally use, and that outlives its parent. A failing or timing-out test **will leak a daemon**.
  Every detach test must clean up unconditionally (`t.after(...)`, not a trailing statement), kill
  by the recorded pid, and verify the pid is gone. A leaked in-container broker polling every
  500ms is a worse outcome than the defect being fixed.

### Claude's Discretion

- Exact flag spelling beyond `--detach` (a `-d` short form is fine but not required).
- Exact warning wording, provided it names Ctrl-C, names that *other sessions'* instances die, and
  points at `--detach`.
- Whether the re-exec uses `setsid "$0" ...` or `setsid bash "$0" ...`.
- Whether `--detach` refuses to start when a live broker is already recorded in `broker.json`.
  Reasonable either way; if implemented, it must not be a hard error when the recorded pid is dead.

</decisions>

<specifics>
## Specific Ideas

Relevant sites in `.claude/mcp/vice/resources/vice-broker.sh` (line numbers as of `cd1d130`):

- `usage()` — lines 151+. Documents subcommands and flags; `--detach` and `VICE_BROKER_LOG` both
  belong here. The `start [N]` entry already documents the trap and the 2026-08-01 shutdown
  reversal — extend that prose, do not contradict it.
- Flag/subcommand parsing and the `case "$SUBCOMMAND"` validation — lines ~370-400.
- `cmd_start()` — lines 1556-1594. The `--once` early return is at 1566-1570; the daemon trap is
  installed at 1577. The detach re-exec belongs **after** `drop_dead_instance_records()` and
  **before** the trap install, so the parent does not register a shutdown trap it will then exit
  through — a parent that traps on EXIT would reap the very instances its own child is adopting.
  **This ordering is load-bearing.**
- `cmd_stop()` — 1607+; `cmd_status()` — 1656+. Both take no positional today.
- Dispatch — lines 1677-1679.
- `purge_protocol_state()` — 1398+. Read-only for this task; the log must survive it.

Verified in-container: `/usr/bin/setsid` exists; `VICE_SUPERVISOR_ALLOW_CONTAINER=1` is the
guard's documented escape hatch (`tools/lib/container-guard.sh:160`).

</specifics>

<canonical_refs>
## Canonical References

- `.planning/todos/pending/2026-08-02-vice-broker-has-no-detached-run-mode.md` — the defect, its
  live 2026-08-02 reproduction, and its two explicit warnings about not reversing the reap
  contract. **Its `files:` frontmatter is stale** (`tools/vice-broker.sh`, the gitignored
  generated copy) — correct it to `.claude/mcp/vice/resources/vice-broker.sh` when archiving,
  exactly as quick task `260802-ci3` did for its two todos.
- `.planning/quick/260802-ci3-.../260802-ci3-CONTEXT.md` — the canonical-vs-deployed file rule this
  task inherits: edit `.claude/mcp/vice/resources/`, never `tools/`.
- `.planning/notes/vice-broker-lifecycle-decisions.md` — Decision 5's 2026-08-02
  foreground-fragility subsection.
- `.planning/todos/pending/2026-08-01-vice-broker-spare-warming-and-stale-grant-defects.md` —
  Defect 4 (the proxy caches a dead grant with no re-request path), which this fragility triggers
  and which this task does **not** fix.
- `.claude/CLAUDE.md` § Emulator Access — this task *is* maintaining the `mcp__vice__`
  implementation, the mode in which `.claude/mcp/` is in-bounds.

</canonical_refs>
