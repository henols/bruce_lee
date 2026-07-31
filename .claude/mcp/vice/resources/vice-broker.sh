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
# THIS TASK'S SCOPE (Phase 01.2 plan 01, the tracer): exactly ONE pass of the
# request -> grant -> forward -> release -> teardown seam, invoked with
# --once. No warm spares, no TTL sweep, no long-lived loop, no denial
# handling beyond reading a denial file if one happens to be there -- those
# are plans 02, 03 and 04. `start` in this task performs exactly one
# broker_once pass and returns; the long-lived loop that keeps `start`
# running (and that spares/TTL logic hangs off of) is plan 02's job.
#
# Run the DEPLOYED copy from the HOST workspace, e.g.:
#   /home/henrik/dev/henrik/git/bruce_lee/tools/vice-broker.sh --once
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
BROKER_JSON="$VICE_POOL_DIR/broker.json"
INSTANCES_JSON="$VICE_POOL_DIR/broker-instances.json"

# A request id is matched against this shape before it is ever used to build
# a path (T-01.2-01) -- kept byte-identical to vice-broker-client.mjs's own
# REQUEST_ID_PATTERN; the request-id-pattern parity test in
# vice-broker.test.mjs drives one shared corpus through both validators.
REQUEST_ID_PATTERN='^req-[0-9]+-[0-9]+-[0-9a-f]{8}$'

usage() {
  cat <<USAGE
usage: vice-broker.sh <start [N] | stop | status> [--once] [--dry-run] [--help|-h] [--check-container] [--print-paths]

Runs identically from either this skill's resources/ (the tracked source of
truth) or its deployed copy at tools/vice-broker.sh (gitignored, regenerated
automatically -- see the header comment). Type this on the HOST as:
tools/vice-broker.sh <subcommand> [...].

HOST-ONLY. Reads request files a container-side proxy writes, allocates a
port, launches (or, under --dry-run, records without launching) a supervised
x64sc MCP instance, and writes a grant file back -- then, on a later pass,
tears down any granted instance whose lease has been released.

Subcommands:
  start [N]     Perform broker passes. In THIS version, always performs
                exactly ONE pass and returns (the long-lived loop that keeps
                this running between passes is a later addition) -- --once
                is accepted for forward compatibility with that loop and has
                no additional effect here. [N] is an optional spares-target
                positional, validated as an integer 1..16 exactly like
                vice-pool.sh's own start [N]; it is not yet consumed by any
                spares logic in this version (no warm spares exist yet).
  stop          Best-effort stop of a long-lived broker process recorded in
                broker.json, if one exists and its pid's identity checks out
                via ps.
  status        Prints broker.json verbatim, if it exists.

Flags:
  --once        Accepted alongside (or in place of) 'start': performs a
                single broker pass. May be given with no subcommand at all,
                in which case 'start' is implied.
  --dry-run     Every grant records dry_run:true and spawns nothing -- exists
                so the request/grant/teardown contract can be exercised from
                inside the devcontainer, where x64sc does not exist to
                actually launch, mirroring vice-supervisor.sh's own
                --dry-run rationale.
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
  VICE_BROKER_SPARES       Warm-spares target recorded into broker.json
                            (default: 3) -- not yet enforced in this version.
  VICE_BROKER_MAX          Max instances recorded into broker.json
                            (default: 16) -- not yet enforced in this version.
  VICE_BROKER_TTL_S        TTL seconds recorded into broker.json
                            (default: 180) -- the sweeper is a later addition.
  VICE_BROKER_BASE_PORT    First candidate port a granted instance is
                            allocated at (default: 6510); the next free port
                            at or above this value is chosen per request.
  VICE_BROKER_MCP_HOST     -mcpserverhost value passed to every spawned
                            instance (default: 0.0.0.0)
  VICE_BROKER_POLL_MS      Recorded into broker.json for a future long-lived
                            loop's poll interval (default: 500) -- unused by
                            the single-pass behaviour in this version.
  VICE_POOL_DIR             Where requests/, grants/, denials/, leases/,
                            broker.json and broker-instances.json live
                            (default: <repo>/.vice-supervisor)
  VICE_SUPERVISOR_ALLOW_CONTAINER   TESTING ONLY. Set to 1 to bypass the
                            container guard below. Never set this to
                            actually run VICE.

Exit codes:
  0   success (start, stop, status, --help, or --check-container found no
      container signals)
  1   usage error, or 'status' found no broker.json
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
POSITIONALS=()
for arg in "$@"; do
  case "$arg" in
    --once)
      ONCE=1
      ;;
    --dry-run)
      DRY_RUN=1
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

if [ "${#POSITIONALS[@]}" -gt 2 ]; then
  echo "usage error: too many positional arguments: ${POSITIONALS[*]}" >&2
  usage >&2
  exit 1
fi

SUBCOMMAND="${POSITIONALS[0]:-}"
N_ARG="${POSITIONALS[1]:-}"

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
# start [N] -- an integer 1..16, same message shape. Deliberately NOT wired
# to VICE_BROKER_SPARES (a completely separate env knob, read further down):
# no warm-spares logic exists yet in this version for N to drive, so this is
# CLI-shape parity for the future loop (plan 02), not a live behaviour.
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
VICE_BROKER_MAX="${VICE_BROKER_MAX:-16}"
VICE_BROKER_TTL_S="${VICE_BROKER_TTL_S:-180}"
VICE_BROKER_BASE_PORT="${VICE_BROKER_BASE_PORT:-6510}"
VICE_BROKER_MCP_HOST="${VICE_BROKER_MCP_HOST:-0.0.0.0}"
VICE_BROKER_POLL_MS="${VICE_BROKER_POLL_MS:-500}"

mkdir -p "$VICE_POOL_DIR" "$REQUESTS_DIR" "$GRANTS_DIR" "$DENIALS_DIR" "$LEASES_DIR"

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

# Single atomic-write choke point (T-01.2-03): every protocol file this
# script writes -- broker.json, grants/<id>.json, denials/<id>.json -- goes
# through here, so there is exactly one place the tmp-then-mv atomicity rule
# lives. $1 = final path, $2 = fully-rendered content.
write_json_atomic() {
  local final_path="$1" content="$2" tmp
  tmp="$(mktemp "$VICE_POOL_DIR/.broker.XXXXXX")"
  printf '%s\n' "$content" >"$tmp"
  mv "$tmp" "$final_path"
}

is_valid_request_id() {
  [[ "$1" =~ $REQUEST_ID_PATTERN ]]
}

# ---------------------------------------------------------------- request scan
#
# Lists candidate request ids by filename only (the request file's basename
# minus .json) -- read_registry_ports/read_registry_pids's own
# grep-against-known-shape idiom, no jq. Each id is validated by
# is_valid_request_id() before it is EVER used to build a further path (grant,
# denial, lease) -- see process_requests() below.
list_request_ids() {
  local f
  if [ -d "$REQUESTS_DIR" ]; then
    for f in "$REQUESTS_DIR"/*.json; do
      [ -e "$f" ] || continue
      basename "$f" .json
    done
  fi
}

# Next free port at or above VICE_BROKER_BASE_PORT, "free" meaning not
# already recorded as some other live grant's port -- scans every existing
# grants/*.json's own "port" field with the same grep-against-known-shape
# idiom vice-pool.sh's read_registry_ports uses, never jq.
next_free_port() {
  local port="$VICE_BROKER_BASE_PORT"
  local f p taken
  while : ; do
    taken=0
    if [ -d "$GRANTS_DIR" ]; then
      for f in "$GRANTS_DIR"/*.json; do
        [ -e "$f" ] || continue
        p="$(grep -o '"port": *[0-9]\+' "$f" 2>/dev/null | head -1 | grep -o '[0-9]\+$' || true)"
        if [ -n "$p" ] && [ "$p" = "$port" ]; then
          taken=1
          break
        fi
      done
    fi
    if [ "$taken" -eq 0 ]; then
      printf '%s\n' "$port"
      return 0
    fi
    port=$((port + 1))
  done
}

write_broker_json() {
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
  "started_at": "$now",
  "heartbeat_at": "$now",
  "spares_target": $VICE_BROKER_SPARES,
  "max_instances": $VICE_BROKER_MAX,
  "ttl_seconds": $VICE_BROKER_TTL_S,
  "dry_run": $dry_run_field
}
JSON
)"
  write_json_atomic "$BROKER_JSON" "$content"
}

# For each well-formed requests/*.json: allocate the next free port, and
# under --dry-run record dry_run:true with no spawn at all (under a real
# run, spawn vice-supervisor.sh detached exactly as vice-pool.sh's own
# cmd_start does); write grants/<id>.json and unlink the request. Reads the
# request directory ONCE per pass (list_request_ids() is called once, at the
# top of the loop construct below) and acts on that snapshot -- a request
# that appears mid-pass waits for the NEXT pass, never this one.
process_requests() {
  local id req_file port now dir epoch_file resolved_args supervisor_pid_field dry_run_field spawned_pid grant_content
  while IFS= read -r id; do
    [ -z "$id" ] && continue
    if ! is_valid_request_id "$id"; then
      echo "vice-broker: skipping malformed request id: $id" >&2
      continue
    fi
    req_file="$REQUESTS_DIR/$id.json"
    [ -e "$req_file" ] || continue # vanished between listing and processing

    port="$(next_free_port)"
    now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    dir="$VICE_POOL_DIR/$port"
    epoch_file="$dir/epoch.json"
    mkdir -p "$dir"

    if [ "$DRY_RUN" -eq 1 ]; then
      supervisor_pid_field="null"
      dry_run_field="true"
    else
      resolved_args="-mcpserver -mcpserverhost $VICE_BROKER_MCP_HOST -mcpserverport $port"
      VICE_SUPERVISOR_DIR="$dir" VICE_ARGS="$resolved_args" \
        nohup "$SUPERVISOR_SCRIPT" >"$dir/supervisor.log" 2>&1 &
      spawned_pid=$!
      disown "$spawned_pid" 2>/dev/null || true
      supervisor_pid_field="$spawned_pid"
      dry_run_field="false"
      echo "vice-broker: spawned supervisor for port $port (pid $spawned_pid), request $id"
    fi

    grant_content="$(cat <<JSON
{
  "version": 1,
  "id": "$(json_escape "$id")",
  "port": $port,
  "url": "http://127.0.0.1:$port/mcp",
  "epoch_file": "$(json_escape "$epoch_file")",
  "supervisor_dir": "$(json_escape "$dir")",
  "supervisor_pid": $supervisor_pid_field,
  "granted_at": "$now",
  "dry_run": $dry_run_field
}
JSON
)"
    write_json_atomic "$GRANTS_DIR/$id.json" "$grant_content"
    rm -f "$req_file"
    echo "vice-broker: granted request $id -> port $port"
  done < <(list_request_ids)
}

# For each grants/<id>.json whose leases/<id> is absent: teardown -- verify
# the recorded supervisor pid's `ps -o args=` output names $SUPERVISOR_SCRIPT
# before signalling it (refusing loudly and skipping when it does not,
# mirroring vice-pool.sh's own cmd_stop), then remove the grant. Reads each
# lease's existence ONCE per grant and acts on that snapshot, never
# re-checking mid-action (T-01.2-12).
process_teardowns() {
  local f id supervisor_pid args
  [ -d "$GRANTS_DIR" ] || return 0
  for f in "$GRANTS_DIR"/*.json; do
    [ -e "$f" ] || continue
    id="$(basename "$f" .json)"
    if ! is_valid_request_id "$id"; then
      continue
    fi
    if [ -e "$LEASES_DIR/$id" ]; then
      continue # lease still held -- nothing to tear down this pass
    fi
    supervisor_pid="$(grep -o '"supervisor_pid": *\(null\|[0-9]\+\)' "$f" 2>/dev/null | sed 's/.*: *//')"
    if [ -n "$supervisor_pid" ] && [ "$supervisor_pid" != "null" ]; then
      args="$(ps -o args= -p "$supervisor_pid" 2>/dev/null || true)"
      case "$args" in
        *"$SUPERVISOR_SCRIPT"*)
          echo "vice-broker: tearing down $id -- stopping supervisor pid $supervisor_pid"
          kill -TERM "$supervisor_pid" 2>/dev/null || true
          ;;
        *)
          if [ -n "$args" ]; then
            echo "vice-broker: refusing to signal pid $supervisor_pid for $id -- ps reports \"$args\", which does not match $SUPERVISOR_SCRIPT (possible pid reuse)" >&2
          fi
          ;;
      esac
    fi
    rm -f "$f"
    echo "vice-broker: removed grant $id (lease released)"
  done
}

# One pass, in this fixed order: write broker.json; grant every well-formed
# pending request; tear down every grant whose lease is gone. Each step reads
# its own facts once and acts on that snapshot -- the long-lived loop that
# repeats this indefinitely is plan 02's job.
broker_once() {
  write_broker_json
  process_requests
  process_teardowns
}

cmd_start() {
  # This version always performs exactly one pass, whether or not --once was
  # given -- there is no long-lived loop yet for --once to interrupt. The
  # flag is accepted now so plan 02's loop can distinguish "run once" from
  # "run forever" with no CLI change.
  broker_once
}

cmd_stop() {
  if [ ! -f "$BROKER_JSON" ]; then
    echo "vice-broker: no $BROKER_JSON -- nothing to stop" >&2
    exit 0
  fi
  local pid args
  pid="$(grep -o '"pid": *[0-9]\+' "$BROKER_JSON" 2>/dev/null | head -1 | grep -o '[0-9]\+$' || true)"
  if [ -z "$pid" ]; then
    echo "vice-broker: $BROKER_JSON has no pid recorded -- nothing to stop" >&2
    exit 0
  fi
  if [ "$pid" = "$$" ]; then
    echo "vice-broker: broker.json's pid is this one-shot invocation's own pid -- there is no long-lived process to stop yet (the persistent loop is a later addition)" >&2
    exit 0
  fi
  args="$(ps -o args= -p "$pid" 2>/dev/null || true)"
  case "$args" in
    *"vice-broker.sh"*)
      echo "vice-broker: stopping broker pid $pid"
      kill -TERM "$pid" 2>/dev/null || true
      ;;
    *)
      echo "vice-broker: refusing to signal pid $pid -- ps reports \"$args\", which does not match vice-broker.sh (possible pid reuse)" >&2
      ;;
  esac
}

cmd_status() {
  if [ ! -f "$BROKER_JSON" ]; then
    echo "vice-broker: no $BROKER_JSON -- broker has never run" >&2
    exit 1
  fi
  cat "$BROKER_JSON"
}

case "$SUBCOMMAND" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
esac
