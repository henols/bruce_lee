#!/usr/bin/env bash
# .claude/mcp/vice/resources/vice-broker.sh
#
# This is the TRACKED source of truth. It runs unchanged from either this
# location or its deployed copy at <repo>/tools/vice-broker.sh -- the vice
# MCP implementation's install-resources.mjs (triggered from any of its .mjs
# entry points) copies it there automatically the first time it is missing.
# `tools/vice-broker.sh` is gitignored: it is a disposable deployment
# target, never hand-edited and never a second tracked copy that could drift
# out of sync with this file.
#
# HOST-ONLY. Do not run this inside the devcontainer -- it will refuse, on
# purpose (see the shared container guard, lib/container-guard.sh). x64sc,
# its windows, and its MCP listeners all live on the HOST.
#
# PRECONDITION -- uid parity (D-1.2-D): this script's own protocol files
# (broker.json, broker-instances.json, grants/, denials/, leases/) keep the
# SAME owner-only (0600) posture registry.json already has. That posture is
# safe ONLY because the container's `vscode` user and the host's own user
# are BOTH uid 1000 on this real ext4 bind mount -- either side can create
# and unlink the other's files as a direct result. This is written down HERE,
# not merely true today: if this script is ever run as a host user with a
# DIFFERENT uid than the container's, every file it writes becomes unreadable
# to the proxy, and every acquisition silently times out waiting on a grant
# that was written but could never be seen. Widening the mode defensively for
# a multi-user scenario that does not exist here would hide this precondition
# instead of stating it -- so the mode stays 0600 and the precondition is
# named here instead.
#
# What this adds on top of vice-pool.sh (launches a FIXED N instances once
# and returns) and vice-supervisor.sh (supervises ONE already-launched
# instance): this script launches instances ON DEMAND, one per container-side
# request, coordinating over the SAME .vice-supervisor/ bind mount every
# other host/container pairing here already uses -- deliberately NOT a new
# port, socket or IPC mechanism. A container-side proxy (vice-proxy.mjs, via
# vice-broker-client.mjs) writes a request file; this script reads it,
# allocates a port, launches (or, under --dry-run, pretends to launch) a
# supervised instance, and writes a grant file back. A released lease (the
# proxy's session ending) is observed on this script's NEXT pass, which then
# tears the corresponding instance down.
#
# THIS SCRIPT'S SCOPE AS OF PHASE 01.2 PLAN 02: `start` runs as a real,
# long-lived daemon (a `while true` loop with a signal trap and a
# consecutive-failure backoff, exactly like vice-supervisor.sh's own respawn
# loop) instead of plan 01's single pass. `--once` short-circuits the loop to
# exactly one pass and returns -- the seam every test in this file's sibling
# *.test.mjs drives. A released lease and a lease swept for staleness (past
# VICE_BROKER_TTL_S) now converge on the SAME tear-down function (below)
# -- the two differ only in which branch removed the lease file,
# never in what happens to the instance afterward. A released instance's
# grant entry is removed, never reset to a re-grantable state
# (kill-never-recycle): the only way an instance becomes grantable again is a
# fresh launch.
#
# EXTENDED IN PHASE 01.2 PLAN 04: warm spares. Every launched instance now
# carries an explicit "launching" -> "ready" state (spares/<port>.json,
# distinct from grants/<id>.json, which continues to represent LEASED
# instances exactly as plan 02 left it). Readiness is proven by a real MCP
# round trip (probe_ready(), an injectable seam via VICE_BROKER_PROBE_CMD, or
# the default host curl-based vice_ping check) -- a bare port_in_use() TCP
# accept is explicitly NOT sufficient, because a half-booted C64 can accept a
# connection before it can actually answer, and handing that out presents as
# a flaky emulator rather than as a race. maintain_spares() is the single
# function that owns BOTH the ready_spares == N target and the
# total_instances <= MAX ceiling, called once at the end of every
# broker_once() pass (after grants and after teardowns) so the two bounds can
# never drift apart. A request that finds no ready spare triggers a "cold"
# launch and gets NEITHER a grant NOR a denial -- the request file stays in
# place so a LATER pass, once that instance's probe succeeds, grants it;
# absence of both files is how the container side knows to keep polling,
# distinct from a denial telling it to stop and report (deny(), producing
# denials/<id>.json with the three genuinely-unsatisfiable reasons: ceiling
# reached, port already bound, supervisor script missing). When no readiness
# mechanism exists on this host at all (no VICE_BROKER_PROBE_CMD and no
# curl), maintain_spares() warms ZERO speculative spares and logs why --
# spares are a latency optimisation, not a correctness requirement (the
# tool-call budget was measured at >=150s, comfortably covering a cold
# boot) -- but probe_ready() itself still degrades to "trust the launch" in
# that one specific case for an ALREADY-pending request's cold instance, since
# refusing to ever grant ANY request on a probe-less host would be strictly
# worse than the alternative. See probe_ready()'s and maintain_spares()'s own
# comments below for the reasoning in full.
#
# SHUTDOWN CONTRACT REVERSED 2026-08-01 (quick-260801-qpq): every earlier
# version of this script left granted/spare instances running when the
# broker itself stopped -- the reasoning on record was "the broker stopping
# is not the same event as a session ending". That trade is now reversed:
# the broker terminates every instance it knows about (signal_recorded_pid(),
# reap_all_instances(), purge_protocol_state() below) on a trapped signal, on
# any other exit from the long-lived daemon loop, and on `stop` -- REGARDLESS
# of whether broker.json exists or names a live pid. Why: on 2026-08-01 the
# host warmed three x64sc instances simultaneously (see maintain_spares()'s
# own serialisation comment), all three died in a GPU/audio race, and a
# `state granted` record for a long-dead pid then survived a broker `stop`, a
# broker `start`, and a full host restart -- the broker kept reporting
# success and launching nothing, and recovery took roughly two hours. An
# orphaned instance outliving the session that wanted it, and then blocking
# every later launch, costs more than an interrupted session does. Start-time
# validation (drop_dead_instance_records()) is the backstop for the one exit
# path no trap can catch: a `kill -9` on the broker itself, or a full host
# power loss -- both skip every trap below entirely, so a stale record from
# either has to be caught on the NEXT `start` instead.
#
# Run the DEPLOYED copy from the HOST workspace, e.g.:
#   /home/henrik/dev/henrik/git/bruce_lee/tools/vice-broker.sh start
# i.e. <host workspace>/tools/vice-broker.sh -- never from inside
# `docker exec` or a devcontainer terminal.
set -euo pipefail

SELF_PATH="${BASH_SOURCE[0]}"
SELF_DIR="$(cd "$(dirname "$SELF_PATH")" && pwd)"

# resolve_repo_root() (lib/repo-root.sh) -- see vice-pool.sh's own header
# comment for why a fixed ".." hop count is wrong here. Sourced ABOVE the
# container guard and above --print-paths -- it defines a function only,
# spawns nothing and writes no state.
source "$SELF_DIR/lib/repo-root.sh"
REPO_ROOT="$(resolve_repo_root "$SELF_DIR")"

HOST_EXAMPLE_PATH="/home/henrik/dev/henrik/git/bruce_lee/tools/vice-broker.sh"

# Resolved as a SIBLING of this running script ($SELF_DIR), NOT
# $REPO_ROOT/tools/vice-supervisor.sh -- matching vice-pool.sh's own D-6
# rationale: a broker run from resources/ must supervise with the
# resources/ copy, not silently reach across to a deployed tools/ copy that
# may be stale or hand-edited.
SUPERVISOR_SCRIPT="$SELF_DIR/vice-supervisor.sh"

# Hoisted here, ABOVE the container guard below, so --print-paths can report
# the values this script would really use without duplicating the defaults.
VICE_POOL_DIR="${VICE_POOL_DIR:-$REPO_ROOT/.vice-supervisor}"
REQUESTS_DIR="$VICE_POOL_DIR/requests"
GRANTS_DIR="$VICE_POOL_DIR/grants"
DENIALS_DIR="$VICE_POOL_DIR/denials"
LEASES_DIR="$VICE_POOL_DIR/leases"
# Spare instances (state "launching" or "ready"), NOT YET leased -- one file
# per port, keyed by port rather than request id because a spare has no
# request associated with it until grant_from_spare() hands it out (plan 04).
# Once granted, a spare's entry here is removed and its ongoing record moves
# to grants/<id>.json, exactly like every other leased instance.
SPARES_DIR="$VICE_POOL_DIR/spares"
BROKER_JSON="$VICE_POOL_DIR/broker.json"
INSTANCES_JSON="$VICE_POOL_DIR/broker-instances.json"

# A request id is matched against this shape before it is ever used to build
# a path (T-01.2-01) -- kept byte-identical to vice-broker-client.mjs's own
# REQUEST_ID_PATTERN; the request-id-pattern parity test in
# vice-broker.test.mjs drives one shared corpus through both validators.
REQUEST_ID_PATTERN='^req-[0-9]+-[0-9]+-[0-9a-f]{8}$'

usage() {
  cat <<'USAGE'
usage: vice-broker.sh <start [N] | stop | status> [--once] [--dry-run] [--detach] [--help|-h] [--check-container] [--print-paths]

Runs identically from either this skill's resources/ (the tracked source of
truth) or its deployed copy at tools/vice-broker.sh (gitignored, regenerated
automatically -- see the header comment). Type this on the HOST as:
tools/vice-broker.sh <subcommand> [...].

HOST-ONLY. Reads request files a container-side proxy writes, allocates a
port, launches (or, under --dry-run, records without launching) a supervised
x64sc MCP instance, and writes a grant file back -- then, on a later pass,
tears down any granted instance whose lease has been released OR has gone
stale past its TTL, both through the SAME tear-down code path.

Subcommands:
  start [N]     Runs as a long-lived daemon: writes broker.json once (fixed
                started_at, pid $$), then loops forever refreshing
                broker.json's heartbeat_at, running one broker pass (grant
                pending requests, tear down released/stale grants), and
                sleeping VICE_BROKER_POLL_MS -- with the same
                consecutive-failure backoff shape vice-supervisor.sh's own
                respawn loop already uses. A trap on EXIT/HUP/INT/TERM
                terminates every instance this broker knows about (grants/
                and spares/ alike) and removes its own protocol state
                (spares/, grants/, requests/, leases/, broker.json,
                broker-instances.json) before exiting 0 -- reversed
                2026-08-01: an orphaned instance outliving the broker that
                started it costs more than an interrupted session does (see
                the header comment's shutdown-contract note). This trap is
                NOT installed on the --once path -- --once is a single pass
                of a broker that is not ending. [N] is an optional
                spares-target positional, validated as an integer 1..16
                exactly like vice-pool.sh's own start [N]; it DRIVES
                VICE_BROKER_SPARES (an explicit CLI count wins over the
                ambient env knob), same as vice-pool.sh's own start [N].
                With --detach, the daemon re-execs itself under setsid
                immediately before this trap is installed, leaving the
                invoking terminal's session and process group entirely, then
                returns promptly printing the daemon's pid and log path.
                Detaching changes WHICH SIGNALS CAN REACH the broker; it does
                NOT change what the broker does when one arrives -- the
                EXIT/HUP/INT/TERM trap above, its reap, and `stop` below are
                byte-identical in both modes.
  stop          Best-effort stop of the long-lived broker process recorded
                in broker.json, if one exists and its pid's identity checks
                out via ps -- then, in EVERY case (a live broker stopped just
                now, a dead or unidentifiable pid, no pid recorded, or no
                broker.json at all), terminates every instance this broker
                knows about and purges its own protocol state, exactly like
                the shutdown trap above. There is no case in which `stop`
                reports success while leaving an orphaned instance running.
  status        Prints the broker's own liveness line (pid, heartbeat age)
                followed by one line per broker-instances.json entry naming
                its port, state and lease id.

Flags:
  --once        Runs exactly ONE broker pass and returns instead of looping
                forever -- the seam this file's own *.test.mjs suite drives
                for every assertion. May be given with no subcommand at all,
                in which case 'start' is implied.
  --dry-run     Every grant records dry_run:true and spawns nothing -- exists
                so the request/grant/tear-down contract can be exercised
                from inside the devcontainer, where x64sc does not exist to
                actually launch, mirroring vice-supervisor.sh's own
                --dry-run rationale.
  --detach      Valid on 'start' ONLY -- rejected on 'stop', on 'status', and
                in combination with --once (a single pass that returns
                immediately has nothing to detach). Re-execs the broker under
                setsid so it leaves the invoking terminal's session and
                process group entirely, appends its stdout and stderr to
                VICE_BROKER_LOG, and prints the daemon's pid and log path
                before returning. Detaching changes WHICH SIGNALS CAN REACH
                the broker; it does NOT change what the broker does when one
                arrives -- the EXIT/HUP/INT/TERM trap, its reap, and `stop`
                are identical in both modes.
  --check-container
                Evaluate the container guard ONLY: print every signal and
                exit 0 on a host or 3 in a container. Spawns nothing, writes
                no state, and works with no subcommand.
  --print-paths Print repo_root=, pool_dir=, broker_json= and instances_json=
                (one key=value line each) and exit 0. Writes no state and
                spawns nothing, works with no subcommand, and runs BEFORE the
                container guard, exactly like --help.
  --help, -h    Print this usage and exit 0. Checked before the container
                guard, since printing usage writes no state and spawns
                nothing.

Configuration (all environment-overridable):
  VICE_BROKER_SPARES       Warm-spares target: maintain_spares() launches new
                            spare instances until this many are in state
                            "ready" (subject to the ceiling below), re-checked
                            at the end of every pass (default: 3). Warming is
                            SERIALISED -- one boot in flight at a time, never
                            two or three simultaneously -- because x64sc opens
                            a GTK3 window, an OpenGL 4.6 context and
                            PulseAudio, and on 2026-08-01 three simultaneous
                            launches lost that race: one SEGV, one exit 1, one
                            exit 0, all at the identical spawn second. Reaching
                            the target this way takes one additional pass per
                            spare rather than one pass total, which is the
                            trade this incident made non-negotiable.
  VICE_BROKER_MAX          Max instances (spares + leased) maintain_spares()
                            will ever hold at once (default: 16, range 1..16).
  VICE_BROKER_PROBE_CMD    Path to an executable readiness probe, invoked as
                            "$VICE_BROKER_PROBE_CMD" "$port" (the port as a
                            positional argument, never interpolated into a
                            command string) -- exit 0 means ready. When unset,
                            the default host probe is used: a single curl POST
                            of a vice_ping tools/call, bounded by
                            VICE_BROKER_PROBE_TIMEOUT_S. When NEITHER this nor
                            curl is available, maintain_spares() warms ZERO
                            speculative spares and logs why (D-1.2-J) --
                            spares are a latency optimisation, not a
                            correctness requirement.
  VICE_BROKER_PROBE_TIMEOUT_S
                            Bound (seconds) on the default curl-based probe's
                            round trip (default: 5).
  VICE_BROKER_TTL_S        TTL seconds a lease may go unrefreshed before the
                            sweeper reclaims its grant (default: 180 -- three
                            times the 60s heartbeat interval, D-1.2-G; a
                            reasoned default, not a measured constant -- see
                            the reversibility note in 01.2-02-PLAN.md).
  VICE_BROKER_KILL_WAIT_S  Seconds a signalled instance (or, for `stop`, the
                            broker process itself) is given to exit after
                            SIGTERM before SIGKILL escalates (default: 5).
                            Polled every 200ms; never a `wait`, since these
                            supervisors are nohup'd/disown'ed and are not a
                            waitable child of a later invocation.
  VICE_BROKER_BASE_PORT    First candidate port a granted instance is
                            allocated at (default: 6510); the next free port
                            at or above this value is chosen per request.
  VICE_BROKER_MCP_HOST     -mcpserverhost value passed to every spawned
                            instance (default: 0.0.0.0)
  VICE_BROKER_POLL_MS      The long-lived loop's own sleep interval between
                            passes (default: 500).
  VICE_BROKER_LOG          Where a --detach'd daemon's stdout and stderr are
                            APPENDED (never truncated) (default:
                            <pool dir>/broker.log). Matches no protocol glob
                            in this script and is deliberately NOT removed by
                            a state purge -- it is the evidence a detached
                            run leaves behind.
  VICE_POOL_DIR             Where requests/, grants/, denials/, leases/,
                            broker.json and broker-instances.json live
                            (default: <repo>/.vice-supervisor)
  VICE_SUPERVISOR_ALLOW_CONTAINER   TESTING ONLY. Set to 1 to bypass the
                            container guard below. Never set this to
                            actually run VICE.

Exit codes:
  0   success (start, stop, status, --help, or --check-container found no
      container signals)
  1   usage error, 'status' found no broker.json, or --detach was requested
      but setsid is unavailable on this host
  2   container guard refused to run
  3   --check-container found at least one container signal
USAGE
}

# --help/-h checked first, before the container guard, since printing usage
# writes no state and spawns nothing.
for arg in "$@"; do
  case "$arg" in
    --help|-h)
      usage
      exit 0
      ;;
  esac
done

CHECK_CONTAINER=0
for arg in "$@"; do
  case "$arg" in
    --check-container)
      CHECK_CONTAINER=1
      ;;
  esac
done

# --print-paths joins --help/--check-container above: it only prints
# already-resolved variables, writes no state and spawns nothing, so it runs
# BEFORE the container guard below and works with no subcommand.
PRINT_PATHS=0
for arg in "$@"; do
  case "$arg" in
    --print-paths)
      PRINT_PATHS=1
      ;;
  esac
done
if [ "$PRINT_PATHS" -eq 1 ]; then
  echo "repo_root=$REPO_ROOT"
  echo "pool_dir=$VICE_POOL_DIR"
  echo "broker_json=$BROKER_JSON"
  echo "instances_json=$INSTANCES_JSON"
  exit 0
fi

# ---------------------------------------------------------------- argument parse
#
# Parsed BEFORE the container guard below -- deliberately deviating from
# vice-pool.sh's own ordering, which validates its size argument AFTER
# enforcing the guard. Argument-SHAPE validation writes no state and spawns
# nothing, exactly like --help/--print-paths above, so there is no reason to
# require VICE_SUPERVISOR_ALLOW_CONTAINER=1 just to report a usage error to
# someone testing flag parsing from inside a container.
ONCE=0
DRY_RUN=0
DETACH=0
POSITIONALS=()
for arg in "$@"; do
  case "$arg" in
    --once)
      ONCE=1
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --detach)
      DETACH=1
      ;;
    --check-container|--help|-h|--print-paths)
      : # already handled above
      ;;
    -*)
      echo "usage error: unrecognised flag: $arg" >&2
      usage >&2
      exit 1
      ;;
    *)
      POSITIONALS+=("$arg")
      ;;
  esac
done

# Recursion guard, half 1 of 2 (T-d6v-01). Task 2 completes the second half by
# filtering --detach out of the relaunch argv; either guard alone is
# sufficient, and both exist because they fail in different ways. `set -u` is
# active, so the marker is read defensively. When VICE_BROKER_DETACHED_CHILD=1,
# this invocation IS the re-exec'd child a parent's --detach spawned: force
# DETACH back to 0 so it cannot re-enter the detach branch in cmd_start below
# (the child still carries --detach on its own command line -- this is what
# stops it re-detaching), record DETACHED_CHILD=1 for the foreground-warning
# gate, and unset the marker so nothing this process itself later spawns can
# ever inherit it. A recursion bug here forks UNBOUNDEDLY ON THE HOST -- the
# single highest-risk defect in this change.
if [ "${VICE_BROKER_DETACHED_CHILD:-0}" = "1" ]; then
  DETACHED_CHILD=1
  DETACH=0
  unset VICE_BROKER_DETACHED_CHILD
else
  DETACHED_CHILD=0
fi

if [ "${#POSITIONALS[@]}" -gt 2 ]; then
  echo "usage error: too many positional arguments: ${POSITIONALS[*]}" >&2
  usage >&2
  exit 1
fi

SUBCOMMAND="${POSITIONALS[0]:-}"
N_ARG="${POSITIONALS[1]:-}"

# --detach cannot be combined with --once: --once is a single pass that
# returns immediately, so there is nothing to detach. Checked BEFORE the
# bare-once-implies-start block below so the combination fails identically
# whether or not 'start' was typed explicitly.
if [ "$DETACH" -eq 1 ] && [ "$ONCE" -eq 1 ]; then
  echo "usage error: '--detach' cannot be combined with '--once' -- '--once' is a single pass that returns immediately and there is nothing to detach" >&2
  usage >&2
  exit 1
fi

if [ -z "$SUBCOMMAND" ] && [ "$ONCE" -eq 1 ]; then
  # --once with no explicit subcommand means "start --once": the one-shot
  # invocation this task's own tests drive directly (no long-lived loop
  # exists yet for --once to interrupt -- see cmd_start below).
  SUBCOMMAND="start"
fi

# A bare subcommand requirement is skipped when --check-container is set:
# that flag "works with no subcommand" (per usage text above), exactly like
# --help/--print-paths, and must reach the container-guard section below
# regardless of whether a subcommand was also given.
if [ "$CHECK_CONTAINER" -eq 0 ]; then
  case "$SUBCOMMAND" in
    start)
      :
      ;;
    stop|status)
      if [ -n "$N_ARG" ]; then
        echo "usage error: '$SUBCOMMAND' takes no positional argument" >&2
        usage >&2
        exit 1
      fi
      if [ "$DETACH" -eq 1 ]; then
        echo "usage error: '--detach' is only valid on 'start', not '$SUBCOMMAND'" >&2
        usage >&2
        exit 1
      fi
      ;;
    "")
      echo "usage error: a subcommand is required (start, stop, status)" >&2
      usage >&2
      exit 1
      ;;
    *)
      echo "usage error: unrecognised subcommand: $SUBCOMMAND" >&2
      usage >&2
      exit 1
      ;;
  esac
fi

# N (start's optional positional) validated exactly like vice-pool.sh's own
# start [N] -- an integer 1..16, same message shape. It is WIRED to
# VICE_BROKER_SPARES immediately after that knob's default is resolved below;
# see the assignment there for why. (Plan 02 validated N while no warm-spares
# logic existed for it to drive and said so here; plan 04 added that logic and
# did not come back to wire it, so `start 2` silently warmed 3 until this was
# fixed during the criterion-13 checkout.)
if [ "$SUBCOMMAND" = "start" ] && [ -n "$N_ARG" ]; then
  if ! [[ "$N_ARG" =~ ^[0-9]+$ ]] || [ "$N_ARG" -lt 1 ] || [ "$N_ARG" -gt 16 ]; then
    echo "usage error: instance count must be an integer 1..16, got: $N_ARG" >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------- container guard
#
# Shared with vice-supervisor.sh and vice-pool.sh via this script's own
# sibling lib/container-guard.sh, so no script here can ever drift apart on
# what counts as "inside a container".
source "$SELF_DIR/lib/container-guard.sh"

if [ "$CHECK_CONTAINER" -eq 1 ]; then
  rc=0; container_guard_report "vice-broker" || rc=$?
  exit "$rc"
fi

container_guard_enforce "vice-broker.sh" "$HOST_EXAMPLE_PATH"

# ---------------------------------------------------------------- configuration
VICE_BROKER_SPARES="${VICE_BROKER_SPARES:-3}"
# `start N` is the documented CLI surface (ROADMAP criterion 1's vice-pool.sh
# parity) and it has to actually take effect -- a validated-then-ignored
# argument is worse than no argument, because `start 2` reported
# "spares_target": 3 in broker.json and warmed three instances while looking
# like it had honoured the request. Explicit CLI beats ambient env, matching
# vice-pool.sh's own `start [N]`: the env knob remains the way to set it
# without a positional (e.g. from a test harness or a service unit).
if [ -n "$N_ARG" ]; then
  VICE_BROKER_SPARES="$N_ARG"
fi
VICE_BROKER_MAX="${VICE_BROKER_MAX:-16}"
VICE_BROKER_TTL_S="${VICE_BROKER_TTL_S:-180}"
VICE_BROKER_KILL_WAIT_S="${VICE_BROKER_KILL_WAIT_S:-5}"
VICE_BROKER_BASE_PORT="${VICE_BROKER_BASE_PORT:-6510}"
VICE_BROKER_MCP_HOST="${VICE_BROKER_MCP_HOST:-0.0.0.0}"
VICE_BROKER_POLL_MS="${VICE_BROKER_POLL_MS:-500}"
VICE_BROKER_PROBE_CMD="${VICE_BROKER_PROBE_CMD:-}"
VICE_BROKER_PROBE_TIMEOUT_S="${VICE_BROKER_PROBE_TIMEOUT_S:-5}"
# Where a --detach'd daemon's stdout/stderr land (Task 2). Three facts, all
# load-bearing: (1) the .log suffix matches NONE of this script's globs --
# every one is *.json scoped (spares/, grants/, requests/, the $d/*.json
# loops) and the verify gate below re-proves it after this change rather than
# trusting it; (2) the file is APPENDED to, never truncated, so a restart
# cannot destroy the previous run's evidence; (3) purge_protocol_state()
# deliberately does NOT remove it -- outliving a purge is the point, and that
# log is exactly the evidence the 2026-08-02 defect hunt needed. Do not touch
# purge_protocol_state() to "clean this up".
VICE_BROKER_LOG="${VICE_BROKER_LOG:-$VICE_POOL_DIR/broker.log}"

# VICE_BROKER_MAX validated as an integer 1..16 (same message shape as the
# existing start [N] range check) -- must_haves C9/T-01.2-05: this is the
# ceiling maintain_spares() enforces, so a malformed value must be caught
# here rather than silently coercing to something unbounded or zero.
if ! [[ "$VICE_BROKER_MAX" =~ ^[0-9]+$ ]] || [ "$VICE_BROKER_MAX" -lt 1 ] || [ "$VICE_BROKER_MAX" -gt 16 ]; then
  echo "usage error: VICE_BROKER_MAX must be an integer 1..16, got: $VICE_BROKER_MAX" >&2
  exit 1
fi
# VICE_BROKER_SPARES validated as an integer 0..MAX -- zero is legitimate
# (plan 01's own "N can be 0, no spares logic exists yet" note; here it is
# now a genuine "warm nothing" configuration, not merely inert).
if ! [[ "$VICE_BROKER_SPARES" =~ ^[0-9]+$ ]] || [ "$VICE_BROKER_SPARES" -lt 0 ] || [ "$VICE_BROKER_SPARES" -gt "$VICE_BROKER_MAX" ]; then
  echo "usage error: VICE_BROKER_SPARES must be an integer 0..$VICE_BROKER_MAX, got: $VICE_BROKER_SPARES" >&2
  exit 1
fi

mkdir -p "$VICE_POOL_DIR" "$REQUESTS_DIR" "$GRANTS_DIR" "$DENIALS_DIR" "$LEASES_DIR" "$SPARES_DIR"

# ---------------------------------------------------------------- json helpers
#
# No jq assumed present on the host (constraint), matching
# vice-supervisor.sh's/vice-pool.sh's own approach.
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

# ---------------------------------------------------------------- port probe
#
# Best-effort only (matches vice-pool.sh's own port_in_use(), copied here
# rather than shared via lib/ since it is a single three-line bash builtin,
# not worth a new sourced file): if bash's /dev/tcp redirection itself errors
# for a reason unrelated to the connection (feature unsupported, permission
# issue), this reports "not in use" and the launch proceeds -- cheaper and
# clearer than letting the supervisor discover a bound port through its own
# crash-loop give-up path. This answers ONLY "is a TCP listener already bound
# here" -- the launch-refusal question it exists for -- and is deliberately
# NEVER reused as a readiness check (see probe_ready()'s own header comment
# on exactly this point).
port_in_use() {
  local port="$1"
  ( exec 3<>"/dev/tcp/127.0.0.1/$port" ) 2>/dev/null
}

# Single atomic-write choke point (T-01.2-03): every protocol file this
# script writes -- broker.json, broker-instances.json, grants/<id>.json,
# denials/<id>.json -- goes through here, so there is exactly one place the
# tmp-then-mv atomicity rule lives. $1 = final path, $2 = fully-rendered
# content. The temp path is a deterministic sibling of the final path
# ("$final_path.tmp"), not a randomly-named file: a crash between write and
# rename leaves at most one stray file per target, bounded by construction,
# rather than an unbounded set of randomly-named orphans accumulating in the
# pool dir. Because the temp file is no longer created by a utility with an
# implicit owner-only default, it is created empty under the ambient umask
# and tightened to mode 600 BEFORE any content reaches it -- the explicit
# chmod below is now the ONLY guarantee of the uid-parity precondition's
# owner-only posture (D-1.2-D), not a redundant second one, so its ordering
# ahead of the content write is load-bearing. Glob-safety confirmed: every
# `*.json` glob in this script (spares/, grants/, requests/, and the
# `$d/*.json` loops) is scoped such that a `.json.tmp` suffix never matches,
# so this transient temp file is invisible to maintain_spares(),
# drop_dead_instance_records() and the start-time validator.
write_json_atomic() {
  local final_path="$1" content="$2" tmp
  tmp="$final_path.tmp"
  : >"$tmp"
  chmod 600 "$tmp"
  printf '%s\n' "$content" >"$tmp"
  mv "$tmp" "$final_path"
}

is_valid_request_id() {
  [[ "$1" =~ $REQUEST_ID_PATTERN ]]
}

# GNU `stat -c %Y`, with a BSD/macOS `stat -f %m` fallback -- this script
# runs on the HOST, which may be either, so both forms are tried in order.
# Returns the file's mtime as epoch seconds, or nothing (and a non-zero
# status) if the file cannot be stat'd at all.
file_mtime_epoch() {
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null
}

# Compares a lease's mtime against now; prints the observed staleness in
# seconds and returns 0 when the lease is older than ttl_seconds, otherwise
# returns 1 and prints nothing. The caller captures both the boolean (via
# exit status, inside an `if`) and the age (via command substitution) in one
# call: `if age="$(lease_is_stale "$lease" "$ttl")"; then ...`.
lease_is_stale() {
  local lease_path="$1" ttl_seconds="$2" mtime now age
  mtime="$(file_mtime_epoch "$lease_path")" || return 1
  [ -n "$mtime" ] || return 1
  now="$(date -u +%s)"
  age=$((now - mtime))
  if [ "$age" -gt "$ttl_seconds" ]; then
    printf '%s\n' "$age"
    return 0
  fi
  return 1
}

# ---------------------------------------------------------------- request scan
#
# Extracts the "id" JSON field's value from a request file -- the OPERATIVE
# id used everywhere below is this body field, NEVER the filename (T-01.2-01,
# task 2's own id-pattern parity test drives this specific extraction path).
# Matches a single quoted "id" value with no jq; a request whose body cannot
# even be parsed this far yields an empty string, which is_valid_request_id()
# below always rejects. `|| true` is load-bearing under this script's own
# `set -e -o pipefail`: grep exits 1 on no match (a malformed/garbage body,
# exactly the case this function exists to handle gracefully), and pipefail
# would otherwise propagate that as this function's own exit status, aborting
# the ENTIRE broker pass rather than skipping one bad request (T-01.2-14).
extract_id_field() {
  grep -o '"id": *"[^"]*"' "$1" 2>/dev/null | head -1 | sed 's/.*"id": *"//; s/"$//' || true
}

# Next free port at or above VICE_BROKER_BASE_PORT, "free" meaning not
# already recorded as some other live grant's OR spare's port -- scans every
# existing grants/*.json AND spares/*.json "port" field with the same
# grep-against-known-shape idiom vice-pool.sh's read_registry_ports uses,
# never jq. Spares must be included here (plan 04): a warm spare occupies a
# real port just as much as a leased grant does, and skipping that dir would
# let a new launch collide with an already-launching or already-ready spare.
# Ports this broker process has found genuinely bound by something outside
# its own bookkeeping. port_in_use() is *reality*; next_free_port() below is
# *bookkeeping* over grants/ and spares/ files, and nothing else reconciles
# the two. Without this set, a permanently-bound port is re-selected and
# re-refused on every single pass, forever: the spare-warming path has no
# request id, so unlike process_requests() it cannot deny() its way out, and
# the refusal is not a pass failure either, so the daemon's backoff never
# engages. Deliberately process-scoped, not persisted: a port freed while the
# broker runs should be reconsidered on the next start rather than remembered
# as dead across boots.
BLOCKED_PORTS=""

port_is_blocked() {
  case " $BLOCKED_PORTS " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

block_port() {
  port_is_blocked "$1" || BLOCKED_PORTS="$BLOCKED_PORTS $1"
}

# Scans upward from VICE_BROKER_BASE_PORT for a port that is neither recorded
# in grants/ or spares/ nor in BLOCKED_PORTS. Bounded: returns non-zero when
# every candidate in the window is taken, so an exhausted host produces one
# explicit denial rather than an unbounded scan. Both call sites check the
# return value -- an unchecked `port="$(next_free_port)"` would abort the
# whole pass under `set -e`.
next_free_port() {
  local port="$VICE_BROKER_BASE_PORT"
  local limit=$((VICE_BROKER_BASE_PORT + 100))
  local f p taken d
  while [ "$port" -lt "$limit" ]; do
    if port_is_blocked "$port"; then
      port=$((port + 1))
      continue
    fi
    taken=0
    for d in "$GRANTS_DIR" "$SPARES_DIR"; do
      [ -d "$d" ] || continue
      for f in "$d"/*.json; do
        [ -e "$f" ] || continue
        p="$(grep -o '"port": *[0-9]\+' "$f" 2>/dev/null | head -1 | grep -o '[0-9]\+$' || true)"
        if [ -n "$p" ] && [ "$p" = "$port" ]; then
          taken=1
          break 2
        fi
      done
    done
    if [ "$taken" -eq 0 ]; then
      printf '%s\n' "$port"
      return 0
    fi
    port=$((port + 1))
  done
  return 1
}

# Generic reader for a spares/<port>.json file, mirroring
# read_instance_field()'s grep-against-known-shape idiom (no jq). $1 = file
# path, $2 = field name. "id"/"url"/"epoch_file"/"supervisor_dir"/"state"/
# "reason" are quoted-string fields (or, for "id", always absent on a spare --
# a spare has no request id until it is granted); every other field here is a
# bare JSON scalar (number/bool/null).
read_spare_field() {
  local file="$1" field="$2"
  [ -f "$file" ] || return 0
  case "$field" in
    url|epoch_file|supervisor_dir|state|reason)
      grep -o "\"$field\": *\"[^\"]*\"" "$file" 2>/dev/null | sed "s/.*\"$field\": *\"//; s/\"$//" || true
      ;;
    *)
      grep -o "\"$field\": *[^,}[:space:]]*" "$file" 2>/dev/null | sed "s/.*\"$field\": *//" || true
      ;;
  esac
}

# Counts spares currently in state "ready" -- the numerator of the
# ready_spares == N invariant (must_haves C9). Reads SPARES_DIR once.
count_ready() {
  local n=0 f state
  if [ -d "$SPARES_DIR" ]; then
    for f in "$SPARES_DIR"/*.json; do
      [ -e "$f" ] || continue
      state="$(read_spare_field "$f" state)"
      [ "$state" = "ready" ] && n=$((n + 1))
    done
  fi
  printf '%s\n' "$n"
}

# Counts every launched instance regardless of state -- spares
# (launching+ready) plus leased (grants/*.json) -- the denominator of the
# total_instances <= MAX ceiling (must_haves C9).
count_total() {
  local n=0 f
  if [ -d "$SPARES_DIR" ]; then
    for f in "$SPARES_DIR"/*.json; do [ -e "$f" ] && n=$((n + 1)); done
  fi
  if [ -d "$GRANTS_DIR" ]; then
    for f in "$GRANTS_DIR"/*.json; do [ -e "$f" ] && n=$((n + 1)); done
  fi
  printf '%s\n' "$n"
}

# Counts spares in state "launching", ANY reason ("cold" or "spare") -- the
# SINGLE in-flight-launch counter both launch paths below (process_requests'
# cold-launch deferral and maintain_spares' warm-spare loop) consult before
# starting a new one. Two counters that could disagree about whether a boot
# is already under way is exactly how the two launch paths raced each other
# back into the 2026-08-01 outage (three simultaneous x64sc launches); there
# is now exactly one, read here and nowhere else.
count_launching() {
  local n=0 f state
  if [ -d "$SPARES_DIR" ]; then
    for f in "$SPARES_DIR"/*.json; do
      [ -e "$f" ] || continue
      state="$(read_spare_field "$f" state)"
      [ "$state" = "launching" ] && n=$((n + 1))
    done
  fi
  printf '%s\n' "$n"
}

# The host-side MCP round trip that promotes "launching" to "ready"
# (must_haves C9/T-01.2-16). When VICE_BROKER_PROBE_CMD names an executable,
# it is invoked as "$VICE_BROKER_PROBE_CMD" "$port" -- the port passed as a
# POSITIONAL ARGUMENT, never interpolated into a command string, so there is
# no injection surface (T-01.2-15) and the test suite gets a clean,
# deterministic seam. Exit 0 means ready.
#
# Otherwise, the DEFAULT host probe: a single curl POST of a tools/call for
# vice_ping at the instance's own URL, bounded by VICE_BROKER_PROBE_TIMEOUT_S,
# matching the exact single-POST curl form already documented in
# tools/README.md's own "Verify the connection" section. Treated as ready
# ONLY when the response body carries BOTH the "version" and "machine"
# markers a real vice_ping reply contains -- a bare TCP accept is explicitly
# NOT sufficient here: the C64 can accept a connection before it has finished
# booting, and advertising that as ready would hand out a half-ready machine,
# which presents as a flaky emulator rather than as a race (the expensive
# kind of bug in this project). This is exactly why port_in_use() -- correct
# for the launch-refusal check above -- is never reused for this question.
#
# When NEITHER a probe command nor curl is available at all, there is
# genuinely no mechanism left to check with. maintain_spares() responds to
# that by warming ZERO speculative spares (D-1.2-J) -- but a COLD instance
# launched for an ALREADY-pending real request is a different situation:
# refusing to ever promote it would mean this host could never satisfy ANY
# request at all, which is strictly worse than trusting the launch itself.
# So in this one degenerate case, and ONLY this one, probe_ready() returns
# success unconditionally -- there is nothing else it could possibly check.
probe_ready() {
  local port="$1"

  if [ -n "$VICE_BROKER_PROBE_CMD" ]; then
    "$VICE_BROKER_PROBE_CMD" "$port"
    return $?
  fi

  if command -v curl >/dev/null 2>&1; then
    local body response
    body='{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"vice_ping","arguments":{}}}'
    response="$(curl -sS --max-time "$VICE_BROKER_PROBE_TIMEOUT_S" \
      -H 'Content-Type: application/json' -H 'Accept: application/json' \
      --data "$body" "http://127.0.0.1:$port/mcp" 2>/dev/null || true)"
    # A real vice_ping result is MCP tool-call content: a JSON-RPC envelope
    # whose result.content[0].text is ITSELF a JSON-encoded string (matching
    # vice-probe.mjs's own parseMcpBody()/tool-result shape). That means the
    # "version"/"machine" keys arrive with their quotes BACKSLASH-ESCAPED in
    # the raw response bytes (`\"version\"`, not `"version"`) -- matching on
    # literal unescaped quotes here would never fire against a real server.
    # Matching the bare words (no quote framing) is deliberately looser, but
    # correct for both the escaped-string and (if a future server ever
    # returned it unwrapped) unescaped shape alike.
    case "$response" in
      *version*machine*|*machine*version*)
        return 0
        ;;
    esac
    return 1
  fi

  # No mechanism whatsoever -- see the header comment above for why this
  # degrades to "trust the launch" rather than "never ready".
  return 0
}

# $1 = started_at (fixed across every loop pass of ONE daemon lifetime --
# the caller holds this in a shell variable across the whole invocation, so
# it is never re-derived from a file read). heartbeat_at is always "now" at
# call time -- must_haves C1/C10 input: refreshed on every loop pass, so a
# reader (cmd_status, or the container-side readBrokerLiveness()) can
# distinguish never-started (no file) from dead-or-hung (file present, but
# heartbeat_at stopped advancing).
write_broker_json() {
  local started_at="$1"
  local now dry_run_field
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  dry_run_field="false"
  [ "$DRY_RUN" -eq 1 ] && dry_run_field="true"
  local content
  content="$(cat <<JSON
{
  "version": 1,
  "written_by": "vice-broker.sh",
  "pid": $$,
  "started_at": "$started_at",
  "heartbeat_at": "$now",
  "spares_target": $VICE_BROKER_SPARES,
  "max_instances": $VICE_BROKER_MAX,
  "ttl_seconds": $VICE_BROKER_TTL_S,
  "poll_ms": $VICE_BROKER_POLL_MS,
  "dry_run": $dry_run_field
}
JSON
)"
  write_json_atomic "$BROKER_JSON" "$content"
}

# Rebuilds broker-instances.json entirely from the CURRENT grants/ AND
# spares/ directories every pass -- this file is a PROJECTION of live state,
# never independently maintained. A torn-down grant (removed by the
# tear-down function below) simply stops appearing on the very next write,
# with no separate "mark reusable" step for kill-never-recycle (task 2) to
# accidentally skip (T-01.2-10). Every leased instance (a live grant) is
# reported with state "leased"; every spare reports its OWN recorded state
# ("launching" or "ready"). No jq: same grep-against-known-shape idiom as
# next_free_port() above.
write_instances() {
  local f id port supervisor_pid launched_at dry_run_field state reason ready_at first=1 body=""
  if [ -d "$GRANTS_DIR" ]; then
    for f in "$GRANTS_DIR"/*.json; do
      [ -e "$f" ] || continue
      id="$(extract_id_field "$f")"
      [ -n "$id" ] || id="$(basename "$f" .json)" # defensive only -- this script's own writes always carry a matching id
      port="$(grep -o '"port": *[0-9]\+' "$f" 2>/dev/null | head -1 | grep -o '[0-9]\+$' || true)"
      supervisor_pid="$(grep -o '"supervisor_pid": *\(null\|[0-9]\+\)' "$f" 2>/dev/null | sed 's/.*: *//' || true)"
      launched_at="$(grep -o '"launched_at": *[0-9]\+' "$f" 2>/dev/null | head -1 | grep -o '[0-9]\+$' || true)"
      dry_run_field="$(grep -o '"dry_run": *\(true\|false\)' "$f" 2>/dev/null | sed 's/.*: *//' || true)"
      if [ "$first" -eq 1 ]; then first=0; else body+=","; fi
      body+="$(cat <<JSON

    {
      "id": "$(json_escape "$id")",
      "port": ${port:-null},
      "state": "leased",
      "supervisor_pid": ${supervisor_pid:-null},
      "launched_at": ${launched_at:-null},
      "ready_at": null,
      "dry_run": ${dry_run_field:-false}
    }
JSON
)"
    done
  fi
  if [ -d "$SPARES_DIR" ]; then
    for f in "$SPARES_DIR"/*.json; do
      [ -e "$f" ] || continue
      port="$(read_spare_field "$f" port)"
      supervisor_pid="$(read_spare_field "$f" supervisor_pid)"
      launched_at="$(read_spare_field "$f" launched_at)"
      ready_at="$(read_spare_field "$f" ready_at)"
      state="$(read_spare_field "$f" state)"
      reason="$(read_spare_field "$f" reason)"
      dry_run_field="$(read_spare_field "$f" dry_run)"
      if [ "$first" -eq 1 ]; then first=0; else body+=","; fi
      body+="$(cat <<JSON

    {
      "id": null,
      "port": ${port:-null},
      "state": "$(json_escape "${state:-launching}")",
      "reason": "$(json_escape "${reason:-spare}")",
      "supervisor_pid": ${supervisor_pid:-null},
      "launched_at": ${launched_at:-null},
      "ready_at": ${ready_at:-null},
      "dry_run": ${dry_run_field:-false}
    }
JSON
)"
    done
  fi
  local content
  content="$(cat <<JSON
{
  "version": 1,
  "instances": [$body
  ]
}
JSON
)"
  write_json_atomic "$INSTANCES_JSON" "$content"
}

# Generic reader for broker-instances.json fields, mirroring
# read_registry_ports/read_registry_pids's own grep-against-known-shape
# idiom (vice-pool.sh) -- no jq assumed. $1 = field name. Returns one value
# per line, in file order. "id" is special-cased (quoted string); every
# other field here is a bare JSON scalar (number/bool/null).
read_instance_field() {
  local field="$1"
  [ -f "$INSTANCES_JSON" ] || return 0
  case "$field" in
    id)
      grep -o '"id": *"[^"]*"' "$INSTANCES_JSON" 2>/dev/null | sed 's/.*"id": *"//; s/"$//' || true
      ;;
    port)
      grep -o '"port": *[0-9]\+' "$INSTANCES_JSON" 2>/dev/null | grep -o '[0-9]\+$' || true
      ;;
    *)
      grep -o "\"$field\": *[^,}]*" "$INSTANCES_JSON" 2>/dev/null | sed "s/.*\"$field\": *//" || true
      ;;
  esac
}

# Allocates $1=port for reason $2 ("spare" or "cold"): spawns (or, under
# --dry-run, pretends to spawn) a supervised instance and records it in
# spares/$port.json with state "launching" -- NEVER directly grantable; only
# maintain_spares()'s probe_ready() promotion (or, in the degenerate no-probe
# case, probe_ready()'s own unconditional-success branch) can move it to
# "ready", and only grant_from_spare() below can move a ready entry to
# leased. Sets LAST_LAUNCH_ERROR and returns non-zero on failure so the
# caller can build a denial reason naming the concrete obstacle (T-mef-05
# style: visibility, not a guarantee, for the two preconditions checked here).
#
# port_in_use() is checked ONLY outside --dry-run, matching vice-pool.sh's
# own cmd_start convention exactly: a real x64sc genuinely cannot share a
# bound port, but --dry-run never spawns anything real in the first place,
# and this file's own tests deliberately grant a dry-run instance against an
# ALREADY-BOUND port (the in-process stand-in MCP server in the tracer test)
# so a forwarded call has something real to reach -- gating the check here
# preserves that pattern exactly as plan 01/02 established it. The
# "supervisor script missing" precondition, by contrast, is checked
# REGARDLESS of --dry-run: it has no side effect either way, is a real fact
# about this host that matters in every mode, and gating it behind
# "not dry-run" would make that denial path untestable without a real x64sc
# -- exactly the scenario this project's own hazard note forbids relying on
# in this container.
LAST_LAUNCH_ERROR=""
launch_instance() {
  local port="$1" reason="$2"
  LAST_LAUNCH_ERROR=""

  if [ "$DRY_RUN" -eq 0 ] && port_in_use "$port"; then
    LAST_LAUNCH_ERROR="port $port is already bound"
    echo "vice-broker: refusing to launch on port $port -- something is already listening there" >&2
    return 1
  fi
  if [ ! -e "$SUPERVISOR_SCRIPT" ]; then
    LAST_LAUNCH_ERROR="supervisor script not found at $SUPERVISOR_SCRIPT"
    echo "vice-broker: cannot launch on port $port -- $LAST_LAUNCH_ERROR" >&2
    return 2
  fi

  local dir epoch_file resolved_args supervisor_pid_field dry_run_field spawned_pid launched_at
  dir="$VICE_POOL_DIR/$port"
  epoch_file="$dir/epoch.json"
  mkdir -p "$dir"

  if [ "$DRY_RUN" -eq 1 ]; then
    # No real x64sc launches under --dry-run, so there is no real pid to
    # prove "this is a fresh launch, not a recycled one" (kill-never-recycle,
    # plan 02). A CONSTANT placeholder would make that property untestable --
    # pass vacuously no matter what the code actually does -- so this uses a
    # nanosecond-epoch timestamp instead: monotonically increasing and
    # virtually guaranteed distinct between any two separate launches.
    launched_at="$(date +%s%N)"
    supervisor_pid_field="$launched_at"
    dry_run_field="true"
  else
    resolved_args="-mcpserver -mcpserverhost $VICE_BROKER_MCP_HOST -mcpserverport $port"
    VICE_SUPERVISOR_DIR="$dir" VICE_ARGS="$resolved_args" \
      nohup "$SUPERVISOR_SCRIPT" >"$dir/supervisor.log" 2>&1 &
    spawned_pid=$!
    disown "$spawned_pid" 2>/dev/null || true
    supervisor_pid_field="$spawned_pid"
    launched_at="$(date +%s%N)"
    dry_run_field="false"
  fi

  local content
  content="$(cat <<JSON
{
  "version": 1,
  "port": $port,
  "url": "http://127.0.0.1:$port/mcp",
  "epoch_file": "$(json_escape "$epoch_file")",
  "supervisor_dir": "$(json_escape "$dir")",
  "supervisor_pid": $supervisor_pid_field,
  "launched_at": $launched_at,
  "ready_at": null,
  "state": "launching",
  "reason": "$(json_escape "$reason")",
  "dry_run": $dry_run_field
}
JSON
)"
  write_json_atomic "$SPARES_DIR/$port.json" "$content"
  echo "vice-broker: launched port $port (reason: $reason)"
  return 0
}

# Selects the LOWEST-PORT spare in state "ready", proves it with a grant-time
# probe_ready() call BEFORE ever writing the grant, flips it to leased by
# writing grants/$id.json carrying its recorded fields plus this request's
# own id, removes the spare entry, and unlinks the request. Returns non-zero
# (writing nothing) when no ready spare EXISTS, so the caller falls through
# to the cold-launch path. NEVER considers an entry in state "launching" --
# there is no code path here that can select one.
#
# The grant-time probe (T-qpq must_haves) is why this is a loop, not a
# single selection: a record saying "ready" is bookkeeping; a probe that
# answers RIGHT NOW is evidence, and the 2026-08-01 incident proved
# bookkeeping alone survives a broker stop, a broker start, and a full host
# restart while the process behind it is long dead. A candidate that fails
# the probe is terminated (signal_recorded_pid(), Task 1) and dropped, and
# selection moves to the next-lowest ready candidate -- only when NONE probe
# clean does this function finally give up (return 1), same as the
# no-ready-spare-at-all case.
grant_from_spare() {
  local id="$1"
  local f lowest_port lowest_file state candidate_port pid

  while true; do
    lowest_port=""
    lowest_file=""
    if [ -d "$SPARES_DIR" ]; then
      for f in "$SPARES_DIR"/*.json; do
        [ -e "$f" ] || continue
        state="$(read_spare_field "$f" state)"
        [ "$state" = "ready" ] || continue
        candidate_port="$(read_spare_field "$f" port)"
        [ -n "$candidate_port" ] || continue
        if [ -z "$lowest_port" ] || [ "$candidate_port" -lt "$lowest_port" ]; then
          lowest_port="$candidate_port"
          lowest_file="$f"
        fi
      done
    fi
    [ -n "$lowest_file" ] || return 1

    if probe_ready "$lowest_port"; then
      break
    fi

    pid="$(read_spare_field "$lowest_file" supervisor_pid)"
    signal_recorded_pid "$pid" "port $lowest_port (stale ready spare)" || true
    rm -f "$lowest_file"
    echo "vice-broker: dropped stale ready spare on port $lowest_port -- grant-time probe failed" >&2
  done

  local url epoch_file supervisor_dir supervisor_pid launched_at dry_run_field now
  url="$(read_spare_field "$lowest_file" url)"
  epoch_file="$(read_spare_field "$lowest_file" epoch_file)"
  supervisor_dir="$(read_spare_field "$lowest_file" supervisor_dir)"
  supervisor_pid="$(read_spare_field "$lowest_file" supervisor_pid)"
  launched_at="$(read_spare_field "$lowest_file" launched_at)"
  dry_run_field="$(read_spare_field "$lowest_file" dry_run)"
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  local grant_content
  grant_content="$(cat <<JSON
{
  "version": 1,
  "id": "$(json_escape "$id")",
  "port": $lowest_port,
  "url": "$(json_escape "$url")",
  "epoch_file": "$(json_escape "$epoch_file")",
  "supervisor_dir": "$(json_escape "$supervisor_dir")",
  "supervisor_pid": ${supervisor_pid:-null},
  "launched_at": ${launched_at:-null},
  "granted_at": "$now",
  "dry_run": ${dry_run_field:-false}
}
JSON
)"
  write_json_atomic "$GRANTS_DIR/$id.json" "$grant_content"
  rm -f "$lowest_file"
  rm -f "$REQUESTS_DIR/$id.json"
  echo "vice-broker: granted request $id -> port $lowest_port (from ready spare)"
  return 0
}

# Writes denials/$id.json (T-01.2's own field set: version, id, reason,
# denied_at) through the atomic helper, unlinks the request, and logs the
# denial. Called ONLY for the three cases that genuinely cannot be
# satisfied -- the reason string is the message a human ultimately reads via
# the container-side broker*Message() builders, so it names the concrete
# obstacle and the current counts, never a generic failure.
deny() {
  local id="$1" reason="$2"
  local now content
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  content="$(cat <<JSON
{
  "version": 1,
  "id": "$(json_escape "$id")",
  "reason": "$(json_escape "$reason")",
  "denied_at": "$now"
}
JSON
)"
  write_json_atomic "$DENIALS_DIR/$id.json" "$content"
  rm -f "$REQUESTS_DIR/$id.json"
  echo "vice-broker: denied request $id -- $reason"
}

# For each well-formed requests/*.json: prefer a ready spare (grant_from_spare,
# instant); otherwise, unless the ceiling is already reached, launch a COLD
# instance and write NEITHER a grant NOR a denial -- the request file stays
# in place so a LATER pass, once maintain_spares()'s probe promotes this new
# instance, grants it via grant_from_spare() above. This absence-of-both-files
# is load-bearing: it is how the container side knows to keep polling, while
# a denial is how it knows to stop and report (must_haves C9/C10 input).
#
# The OPERATIVE id for every request is its own body's "id" field
# (extract_id_field), never the filename -- validated against
# is_valid_request_id() BEFORE it is EVER used to build a grant/lease/denial
# path (T-01.2-01, plan 02). A request whose id fails that check, or whose
# body cannot even be parsed far enough to yield one, is skipped with a
# logged reason and writes NO file anywhere (T-01.2-14). Reads the request
# directory ONCE per pass (the for-loop's own glob) and acts on that
# snapshot -- a request that appears mid-pass waits for the NEXT pass, never
# this one.
process_requests() {
  local req_file id total_now port in_flight
  [ -d "$REQUESTS_DIR" ] || return 0

  # A single in-flight flag, initialised ONCE before the loop from
  # count_launching() -- the SAME counter maintain_spares() below also
  # consults, so the two launch paths (this cold-launch path and
  # maintain_spares' warm-spare path) can never disagree about whether a
  # boot is already under way. Two counters that could disagree is exactly
  # how the two launch paths raced each other back into the 2026-08-01
  # outage (three simultaneous x64sc launches); there is now exactly one.
  # Starts truthy when ANY spare -- cold or warm -- is already "launching"
  # from an earlier pass, and flips truthy the moment THIS pass itself
  # starts a cold launch, so a SECOND still-pending request later in this
  # same loop does not also trigger one.
  if [ "$(count_launching)" -gt 0 ]; then
    in_flight=1
  else
    in_flight=0
  fi

  for req_file in "$REQUESTS_DIR"/*.json; do
    [ -e "$req_file" ] || continue

    id="$(extract_id_field "$req_file")"
    if [ -z "$id" ] || ! is_valid_request_id "$id"; then
      echo "vice-broker: skipping request $(basename "$req_file") -- invalid or missing id: \"$id\"" >&2
      continue
    fi

    if grant_from_spare "$id"; then
      continue
    fi

    if [ "$in_flight" -eq 1 ]; then
      echo "vice-broker: request $id -- a launch is already in flight, awaiting readiness before granting or denying" >&2
      continue
    fi

    total_now="$(count_total)"
    if [ "$total_now" -ge "$VICE_BROKER_MAX" ]; then
      deny "$id" "at the instance ceiling ($VICE_BROKER_MAX instances, $total_now in use) -- nothing ready and nothing launchable"
      continue
    fi

    if ! port="$(next_free_port)"; then
      deny "$id" "no free port available at or above $VICE_BROKER_BASE_PORT -- every candidate is either bound by another process or already recorded as a grant or spare"
      continue
    fi
    if launch_instance "$port" "cold"; then
      in_flight=1
      echo "vice-broker: cold launch in flight for request $id on port $port -- awaiting readiness, no grant or denial written yet"
    else
      deny "$id" "$LAST_LAUNCH_ERROR"
    fi
  done
}

# The single function that owns BOTH halves of the spare invariant
# (must_haves C9/T-01.2-05): ready_spares == VICE_BROKER_SPARES, subject to
# total_instances <= VICE_BROKER_MAX, re-evaluated after every grant and
# every teardown (broker_once calls this LAST, after process_requests and
# sweep_grants). Both bounds are read ONLY here (and in the argument
# validation above) so they can never drift apart into two independently
# maintained limits.
#
# Step 1: promote every existing "launching" spare whose probe_ready() now
# succeeds, stamping ready_at and logging the transition with its elapsed
# time. This runs regardless of probe availability -- see probe_ready()'s own
# comment for why an unavailable probe still lets an ALREADY-launched cold
# instance promote (trust-the-launch), even though step 2 below will not
# speculatively launch anything new in that same case.
#
# Step 2: when no readiness mechanism is available at all (T-01.2-16/D-1.2-J
# -- neither VICE_BROKER_PROBE_CMD nor curl), warm ZERO speculative spares and
# log exactly one line naming what is missing, the consequence (every
# acquisition pays a cold launch), and the fix -- then return. Spares are a
# latency optimisation (the tool-call budget was measured at >=150s,
# comfortably covering a cold boot), never a correctness requirement, so
# guessing here would trade a real hazard for a marginal latency win.
#
# Step 3: return early, warming nothing, when count_launching() (the SAME
# single in-flight counter process_requests() above also consults) reports
# anything already launching -- no new boot starts while one is under way.
# Otherwise take ONE snapshot of count_ready()/count_total() (after the
# promotions above) and scan for a port to launch on while the snapshot's
# ready count is below VICE_BROKER_SPARES AND the snapshot's total is below
# VICE_BROKER_MAX -- but BREAK immediately after the first launch that
# actually succeeds (SERIALISED warming, D-qpq-01: x64sc opens a GTK3
# window, an OpenGL 4.6 context and PulseAudio, and three simultaneous
# launches lost that race on 2026-08-01 with one SEGV, one exit 1 and one
# exit 0 at the identical spawn second). A launch that is REFUSED (rc 1,
# the target port is already bound) does NOT break -- it blocks that port
# and keeps scanning within this SAME pass, which is the pre-existing
# bound-port regression's own requirement, and it is what stops one
# permanently-bound port from starving warming forever. Reaching
# VICE_BROKER_SPARES this way costs one additional pass per spare instead
# of one pass total -- the trade the incident made non-negotiable.
maintain_spares() {
  local f port

  if [ -d "$SPARES_DIR" ]; then
    for f in "$SPARES_DIR"/*.json; do
      [ -e "$f" ] || continue
      if [ "$(read_spare_field "$f" state)" = "launching" ]; then
        port="$(read_spare_field "$f" port)"
        if [ -n "$port" ] && probe_ready "$port"; then
          local launched_at now_ns elapsed_ns elapsed_ms content
          launched_at="$(read_spare_field "$f" launched_at)"
          now_ns="$(date +%s%N)"
          elapsed_ms="?"
          # Milliseconds, not whole seconds: the previous
          # elapsed_s=$((elapsed_ns / 1000000000)) integer-divided every
          # sub-second boot down to zero, which reads as "instant, or
          # unmeasured" rather than as a number -- that is why an ~8x-wrong
          # ~8s boot assumption went unchallenged long enough to reach a
          # design note, a todo and a spike, while the real measurement
          # existed the whole time and just displayed as nothing. The "?"
          # fallback for a missing/unreadable launched_at is unchanged: an
          # unmeasurable boot still renders "?", never "0ms".
          if [ -n "$launched_at" ]; then
            elapsed_ns=$((now_ns - launched_at))
            [ "$elapsed_ns" -lt 0 ] && elapsed_ns=0
            elapsed_ms=$((elapsed_ns / 1000000))
          fi
          content="$(cat "$f")"
          content="$(printf '%s' "$content" | sed 's/"state": *"launching"/"state": "ready"/; s/"ready_at": *null/"ready_at": '"$now_ns"'/')"
          write_json_atomic "$f" "$content"
          # The caveat names the real poll interval (never a hardcoded
          # literal) because this pass runs once every VICE_BROKER_POLL_MS:
          # the figure is an UPPER BOUND on boot time, not a measurement of
          # it. The precise source remains the nanosecond launched_at/
          # ready_at fields in the spare record itself.
          echo "vice-broker: port $port launching -> ready (${elapsed_ms}ms, upper bound: polled every ${VICE_BROKER_POLL_MS}ms)"
        fi
      fi
    done
  fi

  if [ -z "$VICE_BROKER_PROBE_CMD" ] && ! command -v curl >/dev/null 2>&1; then
    echo "vice-broker: no readiness probe available (VICE_BROKER_PROBE_CMD is unset and curl was not found) -- warming ZERO speculative spares; every acquisition will pay a cold launch until this is fixed (set VICE_BROKER_PROBE_CMD to an executable readiness check, or install curl)" >&2
    return 0
  fi

  if [ "$(count_launching)" -gt 0 ]; then
    echo "vice-broker: spare warming waits -- a boot is already in flight this pass" >&2
    return 0
  fi

  local ready total port attempts launch_rc
  ready="$(count_ready)"
  total="$(count_total)"
  attempts=0
  while [ "$ready" -lt "$VICE_BROKER_SPARES" ] && [ "$total" -lt "$VICE_BROKER_MAX" ]; do
    # Bounded: a refused launch does NOT advance the counters below, so
    # without this cap a host where every candidate port is bound would spin
    # here inside a single pass.
    attempts=$((attempts + 1))
    if [ "$attempts" -gt "$VICE_BROKER_MAX" ]; then
      echo "vice-broker: stopping spare warming for this pass after $((attempts - 1)) launch attempts -- $ready of $VICE_BROKER_SPARES ready" >&2
      return 0
    fi

    if ! port="$(next_free_port)"; then
      echo "vice-broker: no free port at or above $VICE_BROKER_BASE_PORT (every candidate is bound or already recorded) -- warming no further spares; $ready of $VICE_BROKER_SPARES ready" >&2
      return 0
    fi

    # launch_instance()'s return value is load-bearing and must NOT be
    # discarded: rc 1 = that specific port is bound (try another), rc 2 = the
    # supervisor script is missing (no port will fix that). Incrementing the
    # counters unconditionally is what previously made a failed launch look
    # like a successful one -- the pass then reported success, the daemon's
    # backoff never engaged, count_ready() still read 0 next pass, and the
    # same doomed port was retried and re-logged on every poll forever.
    launch_rc=0
    launch_instance "$port" "spare" || launch_rc=$?
    if [ "$launch_rc" -eq 0 ]; then
      # SERIALISED warming (D-qpq-01): break after the first successful
      # launch rather than looping to the target -- never two or three
      # simultaneous x64sc boots. Reaching VICE_BROKER_SPARES takes one
      # additional pass per spare instead of one pass total.
      ready=$((ready + 1))
      total=$((total + 1))
      echo "vice-broker: warmed 1 spare this pass -- $ready of $VICE_BROKER_SPARES ready, remainder warmed on later passes"
      break
    elif [ "$launch_rc" -eq 1 ]; then
      # Remembering the port is what turns "logged on every poll" into
      # "logged once": next_free_port() will not hand it back to this
      # process again, here or on any later pass. A refused launch does
      # NOT break -- it must still block that port and keep scanning
      # within this SAME pass (the pre-existing bound-port regression).
      block_port "$port"
    else
      echo "vice-broker: not warming spares -- $LAST_LAUNCH_ERROR" >&2
      return 0
    fi
  done
}

# The SINGLE implementation both triggers below converge on (must_haves C7):
# a released lease (missing) and a stale lease (present past TTL, converted
# to missing by the caller just before this call -- see sweep_grants() below)
# reach IDENTICAL code here, differing only in the reason string logged.
# Reads the grant's recorded supervisor pid ONCE, verifies identity via
# `ps -o args=` before ever signalling (mirrors vice-pool.sh's own
# cmd_stop), and removes the grant on BOTH the matched-and-signalled path
# and the refused-mismatch path -- a stale entry that cannot be killed must
# not wedge the protocol forever, and the refusal is already logged loudly.
# $1 = id, $2 = reason (e.g. "released", or "swept (stale 42s, ttl 180s)").
teardown() {
  local id="$1" reason="$2"
  local f="$GRANTS_DIR/$id.json"
  [ -e "$f" ] || return 0
  local supervisor_pid args
  supervisor_pid="$(grep -o '"supervisor_pid": *\(null\|[0-9]\+\)' "$f" 2>/dev/null | sed 's/.*: *//' || true)"
  if [ -n "$supervisor_pid" ] && [ "$supervisor_pid" != "null" ]; then
    args="$(ps -o args= -p "$supervisor_pid" 2>/dev/null || true)"
    case "$args" in
      *"$SUPERVISOR_SCRIPT"*)
        kill -TERM "$supervisor_pid" 2>/dev/null || true
        ;;
      *)
        if [ -n "$args" ]; then
          echo "vice-broker: refusing to signal pid $supervisor_pid for $id -- ps reports \"$args\", which does not match $SUPERVISOR_SCRIPT (possible pid reuse)" >&2
        fi
        ;;
    esac
  fi
  # Removed UNCONDITIONALLY (matched-kill or refused-mismatch alike): this IS
  # the kill-never-recycle structural guarantee (task 2), not an
  # optimisation -- the only way an instance becomes grantable again is a
  # fresh launch recorded by process_requests() above, never a reset of this
  # entry.
  rm -f "$f"
  echo "vice-broker: $id -- $reason"
}

# Signals a recorded pid ONLY after verifying its identity via `ps -o args=`
# against $SUPERVISOR_SCRIPT -- the SAME check teardown() above already
# performs (T-qpq-01), reused as its own helper here rather than re-derived,
# so every caller below gets the identical guarantee: a mismatched pid is
# logged and left alone, never signalled. $1 = pid, $2 = label (log lines
# only). Returns non-zero WITHOUT signalling when the pid is empty, the
# string "null", already dead (kill -0 fails -- nothing to do, not a
# failure), or fails the identity check (logged as a refusal, "possible pid
# reuse", exactly like teardown()'s own wording). Only on a genuine match
# does it proceed: SIGTERM, then POLL `kill -0` every 200ms up to
# VICE_BROKER_KILL_WAIT_S (default 5s) -- never `wait`, since a supervisor
# launched by launch_instance() was nohup'd and disown'ed, so it is never a
# waitable child of a LATER invocation such as a fresh `stop` or a signal
# handler running in a different process than the one that spawned it --
# escalating to SIGKILL for a survivor. The SIGKILL escalation is reachable
# ONLY after a match; there is no path here that skips straight to it.
signal_recorded_pid() {
  local pid="$1" label="$2"
  [ -n "$pid" ] && [ "$pid" != "null" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1

  local args
  args="$(ps -o args= -p "$pid" 2>/dev/null || true)"
  case "$args" in
    *"$SUPERVISOR_SCRIPT"*)
      ;;
    *)
      echo "vice-broker: refusing to signal pid $pid for $label -- ps reports \"$args\", which does not match $SUPERVISOR_SCRIPT (possible pid reuse)" >&2
      return 1
      ;;
  esac

  kill -TERM "$pid" 2>/dev/null || true
  local waited_ms=0 limit_ms=$((VICE_BROKER_KILL_WAIT_S * 1000))
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited_ms" -ge "$limit_ms" ]; then
      echo "vice-broker: pid $pid ($label) did not exit within ${VICE_BROKER_KILL_WAIT_S}s of SIGTERM -- sending SIGKILL" >&2
      kill -KILL "$pid" 2>/dev/null || true
      break
    fi
    sleep 0.2
    waited_ms=$((waited_ms + 200))
  done
  return 0
}

# Walks EVERY grants/*.json and spares/*.json record, reading each one's
# supervisor_pid and handing it to signal_recorded_pid() above -- this is
# what makes shutdown and `stop` terminate BOTH leased and warm-spare
# instances, not just one or the other. A missing directory is normal (a
# broker that never ran a pass has neither), not an error. Safe to call
# twice: a second call finds nothing left to signal and reports 0/0. Echoes
# ONE summary line naming how many records it saw and how many processes it
# actually terminated, so an operator watching a shutdown or `stop` can tell
# "reaped everything" from "found nothing to reap" at a glance.
reap_all_instances() {
  local d f pid seen=0 signalled=0
  for d in "$GRANTS_DIR" "$SPARES_DIR"; do
    [ -d "$d" ] || continue
    for f in "$d"/*.json; do
      [ -e "$f" ] || continue
      seen=$((seen + 1))
      pid="$(grep -o '"supervisor_pid": *\(null\|[0-9]\+\)' "$f" 2>/dev/null | sed 's/.*: *//' || true)"
      if signal_recorded_pid "$pid" "$(basename "$f")"; then
        signalled=$((signalled + 1))
      fi
    done
  done
  echo "vice-broker: reap saw $seen recorded instance(s), terminated $signalled"
}

# Removes every protocol-state directory/file this script owns: $SPARES_DIR,
# $GRANTS_DIR, $REQUESTS_DIR, $LEASES_DIR (recursively) and $INSTANCES_JSON,
# $BROKER_JSON (by name) -- ALWAYS via these already-resolved variables,
# NEVER a path built by string concatenation at the call site (T-qpq-02).
# Refuses loudly (logs, returns 1, deletes nothing) when VICE_POOL_DIR is
# somehow empty -- an empty base for a recursive removal is exactly the
# failure mode this guard exists to prevent. $DENIALS_DIR is DELIBERATELY
# NOT included: a denial is a message already addressed to a container that
# has not read it yet, not live state a shutdown should discard out from
# under it. Safe to call when everything is already gone (`rm -rf`/`rm -f`
# on an absent path is a no-op, not an error).
purge_protocol_state() {
  if [ -z "$VICE_POOL_DIR" ]; then
    echo "vice-broker: refusing to purge protocol state -- VICE_POOL_DIR is empty" >&2
    return 1
  fi
  rm -rf "$SPARES_DIR" "$GRANTS_DIR" "$REQUESTS_DIR" "$LEASES_DIR"
  rm -f "$INSTANCES_JSON" "$BROKER_JSON"
  echo "vice-broker: purged protocol state under $VICE_POOL_DIR"
}

# Start-time validation -- the ONLY backstop that survives an exit path no
# trap can catch: a `kill -9` on the broker itself, or a full host power
# loss, both of which skip broker_shutdown() below entirely. Called ONCE
# from cmd_start, before the first pass, on both the --once and daemon
# paths. For each grants/*.json and spares/*.json record NOT marked
# dry_run:true (a dry-run record never had a real process, so there is
# nothing to validate, and validating it would delete every fixture this
# file's own test corpus depends on -- see the header comment's own note on
# this), drops the record when: supervisor_pid is absent or null; OR
# `kill -0` fails on it; OR `ps -o args=` does not name $SUPERVISOR_SCRIPT.
# Additionally drops a SPARE recorded "ready" whose port has no listener per
# port_in_use() -- a record saying ready with nothing answering its port is
# the exact ghost-grant shape that survived a broker stop, a broker start,
# and a full host restart on 2026-08-01. Logs one line per drop naming the
# port, the pid, and which reason fired.
drop_dead_instance_records() {
  local d f port pid dry_run state args reason
  for d in "$GRANTS_DIR" "$SPARES_DIR"; do
    [ -d "$d" ] || continue
    for f in "$d"/*.json; do
      [ -e "$f" ] || continue

      dry_run="$(grep -o '"dry_run": *\(true\|false\)' "$f" 2>/dev/null | sed 's/.*: *//' || true)"
      [ "$dry_run" = "true" ] && continue

      port="$(grep -o '"port": *[0-9]\+' "$f" 2>/dev/null | head -1 | grep -o '[0-9]\+$' || true)"
      pid="$(grep -o '"supervisor_pid": *\(null\|[0-9]\+\)' "$f" 2>/dev/null | sed 's/.*: *//' || true)"
      reason=""

      if [ -z "$pid" ] || [ "$pid" = "null" ]; then
        reason="no supervisor_pid recorded"
      elif ! kill -0 "$pid" 2>/dev/null; then
        reason="pid $pid is not running"
      else
        args="$(ps -o args= -p "$pid" 2>/dev/null || true)"
        case "$args" in
          *"$SUPERVISOR_SCRIPT"*) : ;;
          *) reason="pid $pid does not match $SUPERVISOR_SCRIPT (possible pid reuse)" ;;
        esac
      fi

      if [ -z "$reason" ] && [ "$d" = "$SPARES_DIR" ]; then
        state="$(read_spare_field "$f" state)"
        if [ "$state" = "ready" ] && [ -n "$port" ] && ! port_in_use "$port"; then
          reason="recorded ready but port $port has no listener"
        fi
      fi

      if [ -n "$reason" ]; then
        echo "vice-broker: dropping dead record (port ${port:-?}, pid ${pid:-?}) -- $reason" >&2
        rm -f "$f"
      fi
    done
  done
}

# One pass over every live grant: lease absent -> tear down as "released";
# lease present but past VICE_BROKER_TTL_S -> the lease itself is removed
# FIRST (converting stale-but-present into missing), THEN the exact same
# tear-down function runs -- this conversion is what makes "exactly one
# tear-down path" true rather than merely asserted (RESEARCH.md Pattern 2,
# implemented literally). Reads each lease's existence/mtime ONCE per grant
# and acts on that snapshot, never re-checking mid-action (T-01.2-12).
sweep_grants() {
  local f id lease age
  [ -d "$GRANTS_DIR" ] || return 0
  for f in "$GRANTS_DIR"/*.json; do
    [ -e "$f" ] || continue
    id="$(basename "$f" .json)"
    if ! is_valid_request_id "$id"; then
      continue
    fi
    lease="$LEASES_DIR/$id"
    if [ ! -e "$lease" ]; then
      teardown "$id" "released"
    elif age="$(lease_is_stale "$lease" "$VICE_BROKER_TTL_S")"; then
      rm -f "$lease"
      teardown "$id" "swept (stale ${age}s, ttl ${VICE_BROKER_TTL_S}s)"
    fi
  done
}

# One pass, in this fixed order (plan 04 adds maintain_spares, LAST -- "after
# grants and after teardowns" per its own must_haves, so the spare invariant
# is always re-evaluated against the freshest possible grant/teardown state):
# grant every well-formed pending request from a ready spare or a fresh cold
# launch; tear down every grant whose lease is gone or stale; promote/launch
# spares to restore the ready_spares == N invariant under the total <= MAX
# ceiling; rebuild broker-instances.json as a projection of whatever grants
# and spares remain. Each step reads its own facts once and acts on that
# snapshot. write_broker_json() is NOT called here -- it is the caller's job
# (cmd_start), since started_at must stay fixed across every pass of one
# daemon lifetime, not be rewritten by broker_once() itself.
broker_once() {
  process_requests
  sweep_grants
  maintain_spares
  write_instances
}

# Runs as a real, long-lived daemon (must_haves C1): writes broker.json once
# with a FIXED started_at, then loops forever refreshing heartbeat_at,
# running one broker_once() pass, and sleeping VICE_BROKER_POLL_MS -- with
# the same consecutive-failure backoff shape vice-supervisor.sh's own
# respawn loop already uses, so a transient filesystem error slows the loop
# rather than killing it. --once short-circuits to exactly one pass (the
# seam every test in this file's own *.test.mjs drives).
# The signal/EXIT handler for the long-lived daemon (`start`, without
# --once) -- registered as `trap broker_shutdown EXIT HUP INT TERM`
# immediately before the `while true` loop in cmd_start below, and ONLY
# there (see that trap's own comment for why --once is excluded). Disarms
# itself FIRST (`trap - EXIT HUP INT TERM`) so its own `exit` cannot
# re-enter it, then reaps every instance this broker knows about and purges
# its own protocol state, then exits 0. See the header comment's
# "SHUTDOWN CONTRACT REVERSED 2026-08-01" note for why this now terminates
# instances instead of leaving them running.
broker_shutdown() {
  trap - EXIT HUP INT TERM
  echo "vice-broker: shutting down -- reaping instances and purging protocol state" >&2
  reap_all_instances
  purge_protocol_state
  exit 0
}

cmd_start() {
  local started_at
  started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  # Start-time validation: the only backstop that survives an exit path no
  # trap below can catch (a `kill -9` on THIS process, or a full host power
  # loss). Runs once, before the first pass, on BOTH the --once and daemon
  # paths -- see drop_dead_instance_records()'s own header comment.
  drop_dead_instance_records

  if [ "$ONCE" -eq 1 ]; then
    write_broker_json "$started_at"
    broker_once
    return 0
  fi

  # broker_shutdown() (defined above, beside reap_all_instances() and
  # purge_protocol_state()) is registered ONLY on this long-lived daemon
  # path -- deliberately NOT on --once above, which is a single pass of a
  # broker that is not ending; purging protocol state there would destroy
  # the seam every test in this file's own *.test.mjs suite drives.
  trap broker_shutdown EXIT HUP INT TERM

  local consecutive_failures=0 backoff=1
  while true; do
    write_broker_json "$started_at"
    if broker_once; then
      consecutive_failures=0
      backoff=1
    else
      consecutive_failures=$((consecutive_failures + 1))
      echo "vice-broker: pass failed ($consecutive_failures consecutive) -- backing off ${backoff}s" >&2
      sleep "$backoff"
      backoff=$((backoff * 2))
      [ "$backoff" -gt 30 ] && backoff=30
      continue
    fi
    sleep_ms "$VICE_BROKER_POLL_MS"
  done
}

# Sleeps a millisecond duration using only bash arithmetic (no bc/awk
# assumed) -- GNU `sleep` accepts fractional seconds, and this script's
# HOST-ONLY scope means GNU coreutils is the target, not BSD/macOS sleep.
sleep_ms() {
  local ms="$1" whole frac
  whole=$((ms / 1000))
  frac=$((ms % 1000))
  sleep "${whole}.$(printf '%03d' "$frac")"
}

cmd_stop() {
  # Best-effort stop of the long-lived broker PROCESS first, so it cannot
  # warm a fresh spare while the reap below is running -- but every branch
  # below, live broker or not, falls through to the SAME
  # reap_all_instances/purge_protocol_state pair cmd_start's broker_shutdown
  # uses. There is no early exit here: a broker.json naming a dead pid, a
  # missing broker.json, or a pid whose identity does not match are all
  # still full reap-and-purge passes, never a report of success that leaves
  # an orphaned instance running (the exact defect this reversed 2026-08-01;
  # see the header comment's own note).
  if [ -f "$BROKER_JSON" ]; then
    local pid args
    pid="$(grep -o '"pid": *[0-9]\+' "$BROKER_JSON" 2>/dev/null | head -1 | grep -o '[0-9]\+$' || true)"
    if [ -n "$pid" ]; then
      args="$(ps -o args= -p "$pid" 2>/dev/null || true)"
      case "$args" in
        *"vice-broker.sh"*)
          echo "vice-broker: stopping broker pid $pid"
          kill -TERM "$pid" 2>/dev/null || true
          local waited_ms=0 limit_ms=$((VICE_BROKER_KILL_WAIT_S * 1000))
          while kill -0 "$pid" 2>/dev/null; do
            if [ "$waited_ms" -ge "$limit_ms" ]; then
              echo "vice-broker: broker pid $pid did not exit within ${VICE_BROKER_KILL_WAIT_S}s of SIGTERM -- sending SIGKILL" >&2
              kill -KILL "$pid" 2>/dev/null || true
              break
            fi
            sleep 0.2
            waited_ms=$((waited_ms + 200))
          done
          ;;
        *)
          if [ -n "$args" ]; then
            echo "vice-broker: refusing to signal broker pid $pid -- ps reports \"$args\", which does not match vice-broker.sh (possible pid reuse)" >&2
          else
            echo "vice-broker: broker pid $pid from $BROKER_JSON is not running" >&2
          fi
          ;;
      esac
    else
      echo "vice-broker: $BROKER_JSON has no pid recorded" >&2
    fi
  else
    echo "vice-broker: no $BROKER_JSON present -- reaping and purging any protocol state left behind anyway" >&2
  fi

  reap_all_instances
  purge_protocol_state
}

cmd_status() {
  if [ ! -f "$BROKER_JSON" ]; then
    echo "vice-broker: no $BROKER_JSON -- broker has never run" >&2
    exit 1
  fi
  local pid hb_epoch now_epoch age
  pid="$(grep -o '"pid": *[0-9]\+' "$BROKER_JSON" 2>/dev/null | head -1 | grep -o '[0-9]\+$' || true)"
  hb_epoch="$(file_mtime_epoch "$BROKER_JSON")"
  now_epoch="$(date -u +%s)"
  age=$((now_epoch - hb_epoch))
  echo "vice-broker: broker pid ${pid:-?}, heartbeat ${age}s ago"

  local ids ports i
  mapfile -t ids < <(read_instance_field id)
  mapfile -t ports < <(read_instance_field port)
  for ((i = 0; i < ${#ids[@]}; i++)); do
    echo "vice-broker: instance ${ids[$i]}  port ${ports[$i]:-?}  state granted"
  done
}

case "$SUBCOMMAND" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
esac
