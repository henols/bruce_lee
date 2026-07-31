#!/usr/bin/env bash
# .claude/mcp/vice/resources/vice-supervisor.sh
#
# This is the TRACKED source of truth. It runs unchanged from either this
# location or its deployed copy at <repo>/tools/vice-supervisor.sh -- the
# skill's install-resources.mjs (triggered from any of the skill's .mjs
# entry points) copies it there automatically the first time it is missing.
# `tools/vice-supervisor.sh` is gitignored: it is a disposable deployment
# target, never hand-edited and never a second tracked copy that could drift
# out of sync with this file.
#
# HOST-ONLY. Do not run this inside the devcontainer -- it will refuse, on
# purpose (see the container guard below). x64sc, its window and its MCP
# listener (:6510) all live on the HOST. This repo is a bind mount visible
# from both sides (see .devcontainer/devcontainer.json's
# HOST_WORKSPACE_PATH / CONTAINER_WORKSPACE_PATH comment), so this script's
# only channel back into the container is a plain file written on that shared
# mount -- deliberately NOT a new port, socket or IPC mechanism, because the
# container already has everything it needs to read a file and nothing it
# needs to open a new listener.
#
# Run the DEPLOYED copy from the HOST workspace, e.g.:
#   /home/henrik/dev/henrik/git/bruce_lee/tools/vice-supervisor.sh
# i.e. <host workspace>/tools/vice-supervisor.sh -- never from inside
# `docker exec` or a devcontainer terminal.
#
# Why this exists at all: the host VICE MCP server has died six times in one
# session (see .planning/STATE.md's HOST INSTABILITY entry). Each death
# hard-blocked every emulator task until a human noticed and restarted x64sc
# by hand. This script respawns it automatically -- but respawning alone
# would be a regression: .claude/mcp/vice/vice.mjs's withReconnect() retries transport
# failures and would start SUCCEEDING against a brand-new, blank machine with
# no disk attached and no checkpoints armed. That is why every spawn here
# writes an "epoch" -- a monotonically increasing counter -- to a JSON file
# that .claude/mcp/vice/vice.mjs's readEpoch() reads from the container side, so the
# harness can tell "the emulator restarted out from under me" apart from "the
# emulator has been running the whole time".
set -euo pipefail

SELF_PATH="${BASH_SOURCE[0]}"
SELF_DIR="$(cd "$(dirname "$SELF_PATH")" && pwd)"

# resolve_repo_root() (lib/repo-root.sh) replaces this script's old fixed
# `".."` hop: that fixed count was correct only from `tools/` and would have
# silently resolved to `.claude/skills/.vice-supervisor` from `resources/`,
# with no error anywhere (see that file's header). Sourced ABOVE the
# container guard below and above --print-paths -- it defines a function
# only, spawns nothing and writes no state, so this does not disturb the
# "--print-paths needs no escape hatch" property; the guard's own `source`
# line stays exactly where it was, further down.
source "$SELF_DIR/lib/repo-root.sh"
REPO_ROOT="$(resolve_repo_root "$SELF_DIR")"

# Hoisted here, ABOVE the container guard below, so --print-paths (which must
# run before the guard -- see that check below) can report the value this
# script would really use without duplicating the default. See the
# "configuration" block further down for the rest of the overridable knobs;
# this is the one the guard-free --print-paths path also needs.
VICE_SUPERVISOR_DIR="${VICE_SUPERVISOR_DIR:-$REPO_ROOT/.vice-supervisor}"

usage() {
  cat <<USAGE
usage: vice-supervisor.sh [--dry-run] [--check-container] [--print-paths] [--help|-h]

Runs identically from either this skill's resources/ (the tracked source of
truth) or its deployed copy at tools/vice-supervisor.sh (gitignored,
regenerated automatically -- see the header comment). Type this on the HOST
as: tools/vice-supervisor.sh [...].

HOST-ONLY. Launches and supervises x64sc's MCP server, restarting it on
crash with backoff, collecting crash evidence, and recording a restart
"epoch" that the container-side harness (.claude/mcp/vice/vice.mjs's readEpoch()) uses
to detect that a restart happened.

  --dry-run     Write exactly one epoch record (dry_run: true) and exit
                without spawning x64sc. Exists so the epoch file contract can
                be verified from inside the devcontainer, where x64sc does
                not exist to actually launch.
  --check-container
                Evaluate the container guard ONLY: print every signal, whether
                it fired, and the evidence behind it; then exit 0 on a host or
                3 in a container. Spawns nothing and writes no state. Use this
                to confirm the guard's verdict without launching x64sc -- and
                to diagnose a guard that refuses when it should not. Ignores
                VICE_SUPERVISOR_ALLOW_CONTAINER: it reports what the signals
                actually say, not what the escape hatch would let through.
  --print-paths Print repo_root=, supervisor_dir= and epoch_file= (one
                key=value line each) and exit 0. Writes no state and spawns
                nothing, so it runs BEFORE the container guard below, exactly
                like --help -- there is no reason to require
                VICE_SUPERVISOR_ALLOW_CONTAINER=1 just to ask this script
                which directory it resolves to.
  --help, -h    Print this usage and exit 0. Checked before the container
                guard below, since printing usage writes no state and spawns
                nothing.

Configuration (all environment-overridable):
  VICE_BIN                     x64sc binary to launch (default: x64sc)
  VICE_ARGS                    args passed to VICE_BIN, space-separated
                                (default: "-mcpserver -mcpserverhost 0.0.0.0")
  VICE_SUPERVISOR_DIR           where epoch.json, logs/ and crashes.log live
                                (default: <repo>/.vice-supervisor)
  VICE_RESTART_BACKOFF_S        initial restart backoff, seconds (default: 3)
  VICE_RESTART_BACKOFF_MAX_S    backoff ceiling, seconds (default: 30)
  VICE_MAX_RESTARTS             restarts allowed within the crash window
                                before giving up (default: 5)
  VICE_CRASH_WINDOW_S            crash-loop detection window, seconds
                                (default: 120)
  VICE_SUPERVISOR_ALLOW_CONTAINER   TESTING ONLY. Set to 1 to bypass the
                                container guard below. Never set this to
                                actually run VICE -- x64sc cannot run in a
                                container; this only exists so the epoch
                                file contract can be exercised in CI/tests.

Exit codes:
  0   clean shutdown (SIGINT/SIGTERM handled) or --help/--dry-run success,
      or --check-container found no container signals (i.e. this is a host)
  1   usage error (unrecognised argument)
  2   container guard refused to run (see above)
  3   --check-container found at least one container signal
  4   crash-loop give-up: too many restarts within the crash window
USAGE
}

# --help/-h is checked FIRST, before the container guard, because it writes
# no state and spawns nothing -- there is no reason to make an operator set
# VICE_SUPERVISOR_ALLOW_CONTAINER=1 just to read usage text. --print-paths
# joins it here for the same reason (D-oga): it only prints already-resolved
# variables.
DRY_RUN=0
CHECK_CONTAINER=0
PRINT_PATHS=0
for arg in "$@"; do
  case "$arg" in
    --help|-h)
      usage
      exit 0
      ;;
    --check-container)
      # Detected here, acted on below -- it must run the guard's evaluation
      # but must NOT be blocked by the guard's refusal, since diagnosing a
      # wrongly-refusing guard is the entire reason it exists.
      CHECK_CONTAINER=1
      ;;
    --print-paths)
      PRINT_PATHS=1
      ;;
  esac
done

# --print-paths reports the resolved paths and exits, BEFORE the container
# GUARD below is even sourced (lib/repo-root.sh, sourced above for REPO_ROOT,
# is a pure path resolver with no container-detection concern of its own) --
# spawns nothing, writes nothing (no mkdir, no epoch record), so there is no
# reason to make anyone set VICE_SUPERVISOR_ALLOW_CONTAINER=1 just to ask
# this script which directory it will use.
if [ "$PRINT_PATHS" -eq 1 ]; then
  echo "repo_root=$REPO_ROOT"
  echo "supervisor_dir=$VICE_SUPERVISOR_DIR"
  echo "epoch_file=$VICE_SUPERVISOR_DIR/epoch.json"
  exit 0
fi

# ---------------------------------------------------------------- container guard
#
# Load-bearing (D-2): this check runs before ANY state is written and before
# ANY process is spawned. The guard itself -- signal collection, the
# --check-container report, and enforcement -- lives in this script's own
# sibling lib/container-guard.sh so vice-pool.sh shares the exact same code
# (from whichever location both scripts are running) rather than a second,
# hand-maintained copy that could drift out of sync. See that file for the
# removed-mountinfo-signal history (do not re-add it) and the full signal
# list. Uses $SELF_DIR, computed at the top of this file, for consistency
# with lib/repo-root.sh's own sourcing above.
source "$SELF_DIR/lib/container-guard.sh"

# --check-container reports and exits, without spawning or writing anything.
# It deliberately ignores VICE_SUPERVISOR_ALLOW_CONTAINER: its job is to say
# what the signals actually are, not what the escape hatch would permit.
if [ "$CHECK_CONTAINER" -eq 1 ]; then
  rc=0; container_guard_report "vice-supervisor" || rc=$?
  exit "$rc"
fi

container_guard_enforce "vice-supervisor.sh" "/home/henrik/dev/henrik/git/bruce_lee/tools/vice-supervisor.sh"

# ---------------------------------------------------------------- configuration
#
# All overridable with defaults, per D-1. VICE_ARGS is a single space-
# separated string in the environment (matching how an operator would set
# it: `VICE_ARGS="-foo -bar" ./vice-supervisor.sh`) and is split exactly
# once into a bash array below, quoting "$VICE_BIN" at the spawn site --
# T-jty-02's mitigation for treating operator-supplied configuration as a
# privilege-elevation channel: it is not one (it runs at the operator's own
# privilege), but a bad value should be visible, not silently mis-parsed.
VICE_BIN="${VICE_BIN:-x64sc}"
VICE_ARGS="${VICE_ARGS:--mcpserver -mcpserverhost 0.0.0.0}"
# VICE_SUPERVISOR_DIR is hoisted ABOVE the container guard (top of file) so
# --print-paths can report it without duplicating the default -- this is just
# where the knob is documented, not where it's assigned.
VICE_RESTART_BACKOFF_S="${VICE_RESTART_BACKOFF_S:-3}"
VICE_RESTART_BACKOFF_MAX_S="${VICE_RESTART_BACKOFF_MAX_S:-30}"
VICE_MAX_RESTARTS="${VICE_MAX_RESTARTS:-5}"
VICE_CRASH_WINDOW_S="${VICE_CRASH_WINDOW_S:-120}"

# Parse the rest of the arguments now that the guard has passed.
for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=1
      ;;
    --help|-h|--check-container|--print-paths)
      : # already handled above
      ;;
    *)
      echo "usage error: unrecognised argument: $arg" >&2
      usage >&2
      exit 1
      ;;
  esac
done

# read -ra splits VICE_ARGS on IFS exactly once into an array -- never
# re-split downstream, and never pass VICE_ARGS unquoted to the spawn site.
read -ra VICE_ARGS_ARR <<<"$VICE_ARGS"

EPOCH_FILE="$VICE_SUPERVISOR_DIR/epoch.json"
LOG_DIR="$VICE_SUPERVISOR_DIR/logs"
CRASHES_LOG="$VICE_SUPERVISOR_DIR/crashes.log"
mkdir -p "$VICE_SUPERVISOR_DIR" "$LOG_DIR"

# Print the fully resolved command line before anything spawns (T-jty-02) --
# an unexpected VICE_ARGS/VICE_BIN override must be visible, not silent.
echo "vice-supervisor: resolved command: $VICE_BIN ${VICE_ARGS_ARR[*]}"
echo "vice-supervisor: supervisor dir:   $VICE_SUPERVISOR_DIR"
echo "vice-supervisor: epoch file:       $EPOCH_FILE"
echo "vice-supervisor: log dir:          $LOG_DIR"
echo "vice-supervisor: the container-side harness (.claude/mcp/vice/vice.mjs's readEpoch())"
echo "vice-supervisor: reads epoch.json over the bind mount to detect restarts."

# ---------------------------------------------------------------- json helpers
#
# No jq assumed present on the host (constraint). These are deliberately
# tiny and special-cased for the exact shapes this script writes -- not a
# general-purpose JSON library.
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

json_string_array() {
  # Emits a JSON array of strings from the given positional args.
  local out="[" first=1 a
  for a in "$@"; do
    if [ "$first" -eq 1 ]; then first=0; else out+=","; fi
    out+="\"$(json_escape "$a")\""
  done
  out+="]"
  printf '%s' "$out"
}

# Read the previous epoch back out of an existing epoch.json with grep/sed,
# NOT jq (constraint: jq must not be assumed present on the host). Starts at
# 0 (so the first write below becomes epoch 1) when the file is absent or
# its "epoch" field cannot be parsed as an integer. Comment placed here
# rather than at the call site: this is intentionally lenient parsing of a
# file that is, from this script's own perspective, its own prior output --
# the untrusted-input hardening belongs to the container side's readEpoch(),
# which treats this same file as attacker-adjacent input (see
# .claude/mcp/vice/vice.mjs).
read_prev_epoch() {
  local prev="0"
  if [ -f "$EPOCH_FILE" ]; then
    prev="$(grep -o '"epoch"[[:space:]]*:[[:space:]]*[0-9]\+' "$EPOCH_FILE" 2>/dev/null \
             | head -1 | grep -o '[0-9]\+$' || true)"
  fi
  if ! [[ "$prev" =~ ^[0-9]+$ ]]; then
    prev="0"
  fi
  printf '%s' "$prev"
}

# Write the epoch file ATOMICALLY: a temp file in the SAME directory, then
# `mv` into place. The container polls this file on its own schedule and
# must never observe a half-written JSON document mid-write -- `mv` within
# one filesystem is atomic, a direct `>` redirect into epoch.json is not.
write_epoch() {
  local this_epoch="$1" pid_field="$2" log_field="$3" dry_run_field="$4"
  local tmp
  tmp="$(mktemp "$VICE_SUPERVISOR_DIR/.epoch.XXXXXX")"
  {
    printf '{\n'
    printf '  "epoch": %s,\n' "$this_epoch"
    printf '  "spawned_at": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '  "pid": %s,\n' "$pid_field"
    printf '  "supervisor_pid": %s,\n' "$$"
    printf '  "vice_bin": "%s",\n' "$(json_escape "$VICE_BIN")"
    printf '  "vice_args": %s,\n' "$(json_string_array "${VICE_ARGS_ARR[@]}")"
    printf '  "log": %s,\n' "$log_field"
    printf '  "dry_run": %s\n' "$dry_run_field"
    printf '}\n'
  } >"$tmp"
  mv "$tmp" "$EPOCH_FILE"
}

# ---------------------------------------------------------------- --dry-run
#
# Writes exactly one epoch record with dry_run:true and exits without
# spawning anything. This exists so the epoch file contract (shape, atomic
# write, monotonic increment) can be verified from INSIDE the devcontainer,
# where x64sc does not exist to actually launch -- see Task 2's verify step,
# which reads this exact file back through readEpoch().
if [ "$DRY_RUN" -eq 1 ]; then
  prev_epoch="$(read_prev_epoch)"
  epoch=$((prev_epoch + 1))
  write_epoch "$epoch" "null" "null" "true"
  echo "vice-supervisor: --dry-run wrote epoch $epoch to $EPOCH_FILE"
  exit 0
fi

# ---------------------------------------------------------------- respawn loop
#
# child_pid is declared here (outside the loop) so the INT/TERM trap below
# can see whichever child is currently running and kill it cleanly rather
# than leaving an orphaned x64sc behind.
child_pid=""

cleanup() {
  if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
    echo "vice-supervisor: caught signal, terminating child pid $child_pid" >&2
    kill -TERM "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
  echo "vice-supervisor: clean shutdown" >&2
  exit 0
}
trap cleanup INT TERM

epoch="$(read_prev_epoch)"
epoch=$((epoch + 1))
backoff="$VICE_RESTART_BACKOFF_S"
# Timestamps (epoch seconds) of recent restarts, used for crash-loop
# detection: if VICE_MAX_RESTARTS of them fall within VICE_CRASH_WINDOW_S, a
# bad flag or an already-bound port 6510 must not be allowed to spin forever
# (D-1, T-jty-03).
restart_times=()

while true; do
  ts="$(date -u +%Y%m%d-%H%M%S)"
  log_path="$LOG_DIR/x64sc-$ts.log"

  # Evidence is the POINT of this script, not a nicety (D-4): the crash root
  # cause behind the six host outages recorded in STATE.md is still
  # unconfirmed -- a two-data-point hypothesis around vice_run_until's own
  # temporary checkpoint, plus the later observation that the last three
  # outages all landed on vice_execution_run instead. A supervisor that
  # silently respawned would destroy the only trail that could confirm or
  # kill either hypothesis.
  "$VICE_BIN" "${VICE_ARGS_ARR[@]}" >"$log_path" 2>&1 &
  child_pid=$!
  spawned_pid="$child_pid"
  write_epoch "$epoch" "$child_pid" "\"logs/x64sc-$ts.log\"" "false"
  echo "vice-supervisor: spawned $VICE_BIN (pid $child_pid), epoch $epoch, log $log_path"

  set +e
  wait "$child_pid"
  status=$?
  set -e
  child_pid=""

  signal_name="none"
  if [ "$status" -gt 128 ]; then
    signal_num=$((status - 128))
    signal_name="$(kill -l "$signal_num" 2>/dev/null || echo "SIG$signal_num")"
  fi

  {
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) epoch=$epoch pid=$spawned_pid exit_status=$status signal=$signal_name log=$log_path"
    echo "  last ~20 lines of $log_path:"
    tail -n 20 "$log_path" 2>/dev/null | sed 's/^/    | /'
  } >>"$CRASHES_LOG" 2>/dev/null || true

  echo "vice-supervisor: x64sc exited (status $status, signal $signal_name) -- see $CRASHES_LOG"

  now="$(date +%s)"
  restart_times+=("$now")
  pruned=()
  for t in "${restart_times[@]}"; do
    if (( now - t <= VICE_CRASH_WINDOW_S )); then
      pruned+=("$t")
    fi
  done
  restart_times=("${pruned[@]}")

  if [ "${#restart_times[@]}" -ge "$VICE_MAX_RESTARTS" ]; then
    {
      echo "FATAL: $VICE_MAX_RESTARTS restarts within ${VICE_CRASH_WINDOW_S}s -- giving up (D-1)."
      echo "This is not a transient crash; the two realistic causes are:"
      echo "  - a bad flag in VICE_ARGS (currently: ${VICE_ARGS_ARR[*]})"
      echo "  - port 6510 already bound by an x64sc that is still running"
      echo "Last exit status: $status, last log: $log_path"
    } >&2
    exit 4
  fi

  echo "vice-supervisor: backing off ${backoff}s before restart $((${#restart_times[@]}))"
  sleep "$backoff"
  backoff=$((backoff * 2))
  if [ "$backoff" -gt "$VICE_RESTART_BACKOFF_MAX_S" ]; then
    backoff="$VICE_RESTART_BACKOFF_MAX_S"
  fi

  epoch=$((epoch + 1))
done
