#!/usr/bin/env bash
# tools/vice-supervisor.sh
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
# Run it from the HOST workspace, e.g.:
#   /home/henrik/dev/henrik/git/bruce_lee/tools/vice-supervisor.sh
# i.e. <host workspace>/tools/vice-supervisor.sh -- never from inside
# `docker exec` or a devcontainer terminal.
#
# Why this exists at all: the host VICE MCP server has died six times in one
# session (see .planning/STATE.md's HOST INSTABILITY entry). Each death
# hard-blocked every emulator task until a human noticed and restarted x64sc
# by hand. This script respawns it automatically -- but respawning alone
# would be a regression: tools/vice.mjs's withReconnect() retries transport
# failures and would start SUCCEEDING against a brand-new, blank machine with
# no disk attached and no checkpoints armed. That is why every spawn here
# writes an "epoch" -- a monotonically increasing counter -- to a JSON file
# that tools/vice.mjs's readEpoch() reads from the container side, so the
# harness can tell "the emulator restarted out from under me" apart from "the
# emulator has been running the whole time".
set -euo pipefail

SELF_PATH="${BASH_SOURCE[0]}"
REPO_ROOT="$(cd "$(dirname "$SELF_PATH")/.." && pwd)"

usage() {
  cat <<USAGE
usage: tools/vice-supervisor.sh [--dry-run] [--check-container] [--help|-h]

HOST-ONLY. Launches and supervises x64sc's MCP server, restarting it on
crash with backoff, collecting crash evidence, and recording a restart
"epoch" that the container-side harness (tools/vice.mjs's readEpoch()) uses
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
# VICE_SUPERVISOR_ALLOW_CONTAINER=1 just to read usage text.
DRY_RUN=0
CHECK_CONTAINER=0
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
  esac
done

# ---------------------------------------------------------------- container guard
#
# Load-bearing (D-2): this check runs before ANY state is written and before
# ANY process is spawned. More than one signal is collected, because relying
# on a single check (e.g. only /.dockerenv) is exactly the kind of narrow
# check that silently stops working when the container runtime changes.
#
# REMOVED, DO NOT RE-ADD: a `grep docker /proc/self/mountinfo` check used to
# live here. It answered the WRONG QUESTION -- it detects "Docker is
# installed on this machine", not "this process is inside a container". Any
# host that runs a devcontainer has /var/lib/docker/... overlay entries in
# its mountinfo, so the check fired on the real host and refused to launch
# on exactly the machine this script exists to run on. It cannot be fixed by
# tightening the pattern; the signal itself is invalid. It is gone.
#
# CONTAINER_REPORT carries one line per signal (fired or not, with its
# evidence) so --check-container can show the whole picture and so a refusal
# message can name what actually matched instead of leaving the operator to
# guess -- which is precisely how the mountinfo bug above went unnoticed.
CONTAINER_SIGNALS=()
CONTAINER_REPORT=()

record_signal() {
  # $1 = fired (0/1), $2 = description, $3 = evidence (may be empty)
  local fired="$1" desc="$2" evidence="${3:-}"
  if [ "$fired" -eq 1 ]; then
    CONTAINER_SIGNALS+=("$desc${evidence:+ -- $evidence}")
    CONTAINER_REPORT+=("  [FIRED] $desc${evidence:+
            evidence: $evidence}")
  else
    CONTAINER_REPORT+=("  [clear] $desc${evidence:+ ($evidence)}")
  fi
}

if [ -e /.dockerenv ]; then
  record_signal 1 "/.dockerenv exists"
else
  record_signal 0 "/.dockerenv exists"
fi

if [ -e /run/.containerenv ]; then
  record_signal 1 "/run/.containerenv exists (podman)"
else
  record_signal 0 "/run/.containerenv exists (podman)"
fi

if [ -n "${CONTAINER_WORKSPACE_PATH:-}" ]; then
  record_signal 1 "CONTAINER_WORKSPACE_PATH is set (this devcontainer sets it)" "$CONTAINER_WORKSPACE_PATH"
else
  record_signal 0 "CONTAINER_WORKSPACE_PATH is set (this devcontainer sets it)"
fi

# systemd-detect-virt is authoritative on systemd Linux and answers exactly
# the question we care about: --container reports the container technology,
# or "none" (exit 1) on a bare host. Absence of the binary is not an error --
# it simply contributes no signal.
if command -v systemd-detect-virt >/dev/null 2>&1; then
  detected_virt="$(systemd-detect-virt --container 2>/dev/null || true)"
  if [ -n "$detected_virt" ] && [ "$detected_virt" != "none" ]; then
    record_signal 1 "systemd-detect-virt --container" "reports: $detected_virt"
  else
    record_signal 0 "systemd-detect-virt --container" "reports: ${detected_virt:-none}"
  fi
else
  record_signal 0 "systemd-detect-virt --container" "binary not present, signal skipped"
fi

# PID 1's cgroup PATH (the field after the last colon), matched against
# container-indicating path components only. A systemd host's `0::/init.scope`
# and a bare `0::/` must not match; `/docker/<id>`, `/system.slice/docker-<id>.scope`,
# `/kubepods/...`, `/libpod-...` and `/lxc/...` must. Note this deliberately
# does NOT match `/system.slice/docker.service` -- that is the Docker daemon's
# own cgroup on a HOST, and PID 1 there is systemd in /init.scope anyway.
cgroup_match=""
if [ -r /proc/1/cgroup ]; then
  cgroup_match="$(awk -F: '{ p = $NF; if (p ~ /(^|\/)(docker|lxc|kubepods|libpod)(\/|-|$)/) { print; exit } }' \
                   /proc/1/cgroup 2>/dev/null || true)"
fi
if [ -n "$cgroup_match" ]; then
  record_signal 1 "/proc/1/cgroup path names a container" "$cgroup_match"
else
  record_signal 0 "/proc/1/cgroup path names a container" "no container path component in PID 1's cgroup"
fi

# --check-container reports and exits, without spawning or writing anything.
# It deliberately ignores VICE_SUPERVISOR_ALLOW_CONTAINER: its job is to say
# what the signals actually are, not what the escape hatch would permit.
if [ "$CHECK_CONTAINER" -eq 1 ]; then
  echo "vice-supervisor: container guard evaluation"
  for line in "${CONTAINER_REPORT[@]}"; do
    echo "$line"
  done
  if [ "${#CONTAINER_SIGNALS[@]}" -gt 0 ]; then
    echo "verdict: CONTAINER (${#CONTAINER_SIGNALS[@]} signal(s) fired) -- the guard would refuse here."
    exit 3
  fi
  echo "verdict: HOST (no signals fired) -- the guard would allow x64sc to launch here."
  exit 0
fi

if [ "${#CONTAINER_SIGNALS[@]}" -gt 0 ] && [ "${VICE_SUPERVISOR_ALLOW_CONTAINER:-0}" != "1" ]; then
  {
    echo "FATAL: tools/vice-supervisor.sh refuses to run inside a container." >&2
    echo "This script is HOST-ONLY. Signals that fired:" >&2
    for sig in "${CONTAINER_SIGNALS[@]}"; do
      echo "  - $sig" >&2
    done
    echo "" >&2
    echo "If you believe this IS the host, run --check-container for the full" >&2
    echo "per-signal breakdown and report which signal is wrong." >&2
    echo "" >&2
    echo "This cannot work in here: there is no x64sc binary, no display, and" >&2
    echo "the entire point of this script is to restart a process the container" >&2
    echo "has no access to in the first place." >&2
    echo "" >&2
    echo "Escape hatch (TESTING ONLY -- never to actually run VICE):" >&2
    echo "  VICE_SUPERVISOR_ALLOW_CONTAINER=1" >&2
    echo "" >&2
    echo "Run this script on the HOST instead, from the host workspace, e.g.:" >&2
    echo "  /home/henrik/dev/henrik/git/bruce_lee/tools/vice-supervisor.sh" >&2
  } >&2
  exit 2
fi

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
VICE_SUPERVISOR_DIR="${VICE_SUPERVISOR_DIR:-$REPO_ROOT/.vice-supervisor}"
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
    --help|-h|--check-container)
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
echo "vice-supervisor: the container-side harness (tools/vice.mjs's readEpoch())"
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
# which treats this same file as attacker-adjacent input (see vice.mjs).
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
