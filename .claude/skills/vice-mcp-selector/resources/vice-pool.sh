#!/usr/bin/env bash
# .claude/skills/vice-mcp-selector/resources/vice-pool.sh
#
# This is the TRACKED source of truth. It runs unchanged from either this
# location or its deployed copy at <repo>/tools/vice-pool.sh -- the skill's
# install-resources.mjs (triggered from any of the skill's .mjs entry points)
# copies it there automatically the first time it is missing.
# `tools/vice-pool.sh` is gitignored: it is a disposable deployment target,
# never hand-edited and never a second tracked copy that could drift out of
# sync with this file.
#
# HOST-ONLY. Do not run this inside the devcontainer -- it will refuse, on
# purpose (see the shared container guard, lib/container-guard.sh). x64sc,
# its windows, and its MCP listeners all live on the HOST.
#
# What this adds on top of vice-supervisor.sh: that script already
# supervises ONE x64sc instance on one port. This script launches N of them
# in parallel, each its own supervised instance with its own port, supervisor
# dir (epoch file, logs, crash log), and coordinates with container-side
# code (.claude/skills/vice-mcp-selector/scripts/vice-pool.mjs) via a registry.json file written on the same
# bind mount vice-supervisor.sh's epoch.json already uses (D-2) --
# deliberately NOT a new port, socket, or IPC mechanism.
#
# Run the DEPLOYED copy from the HOST workspace, e.g.:
#   /home/henrik/dev/henrik/git/bruce_lee/tools/vice-pool.sh start 3
# i.e. <host workspace>/tools/vice-pool.sh -- never from inside `docker exec`
# or a devcontainer terminal.
#
# Why a pool at all: a polled emulator runs at ~0.7% duty cycle (see
# .planning/STATE.md's pause-on-read finding) -- the bottleneck is MCP
# round-trip latency, not host CPU, so N instances interleave and scaling is
# near-linear. And six host VICE MCP outages happened in one session; one
# instance today blocks every emulator task. A pool gives crash isolation:
# killing or losing one instance does not disturb the others.
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

HOST_EXAMPLE_PATH="/home/henrik/dev/henrik/git/bruce_lee/tools/vice-pool.sh"

# Resolved as a SIBLING of this running script ($SELF_DIR), NOT
# $REPO_ROOT/tools/vice-supervisor.sh (D-6): a pool started from resources/
# must supervise with the resources/ copy, not silently reach across to a
# deployed tools/ copy that may be stale or hand-edited. A pool started from
# the deployed tools/ copy correctly supervises with the deployed
# tools/vice-supervisor.sh, since that is this script's own sibling there too.
SUPERVISOR_SCRIPT="$SELF_DIR/vice-supervisor.sh"

# Hoisted here, ABOVE the container guard below, so --print-paths (which must
# run before the guard -- see that check below) can report the values this
# script would really use without duplicating the defaults. See the
# "configuration" block further down for the rest of the overridable knobs.
VICE_POOL_DIR="${VICE_POOL_DIR:-$REPO_ROOT/.vice-supervisor}"
REGISTRY_PATH="$VICE_POOL_DIR/registry.json"

usage() {
  cat <<USAGE
usage: vice-pool.sh <start [N] [--dry-run] | stop | status> [--help|-h] [--check-container] [--print-paths]

Runs identically from either this skill's resources/ (the tracked source of
truth) or its deployed copy at tools/vice-pool.sh (gitignored, regenerated
automatically -- see the header comment). Type this on the HOST as:
tools/vice-pool.sh <subcommand> [...].

HOST-ONLY. Launches, tracks, and tears down N supervised x64sc MCP instances
in parallel (D-1), coordinating with container-side harness code
(.claude/skills/vice-mcp-selector/scripts/vice-pool.mjs) over a registry.json file on the shared bind mount
(D-2) -- the same channel tools/vice-supervisor.sh's epoch.json already
uses. \`.mcp.json\` is not touched: instance 0 is always the default port
(6510), so the existing single-instance workflow keeps working untouched
with zero configuration.

Subcommands:
  start [N]     Launch N instances (default \$VICE_POOL_SIZE or 3, range
                1..16). Instance i gets port \$VICE_POOL_BASE_PORT + i
                (default base port 6510), its own
                VICE_SUPERVISOR_DIR=<pool dir>/<port> (so epoch files, logs
                and crash logs never collide), and is spawned detached via
                tools/vice-supervisor.sh. Before spawning, each port is
                best-effort probed and refused (skipped, not fatal) if
                something already answers there. Returns promptly -- does
                not block waiting for instances to become ready. Writes
                registry.json atomically when done.
  stop          Reads supervisor_pid out of registry.json, verifies each
                pid's identity via \`ps\` before signalling (never a
                name-matched or blind kill), SIGTERMs matching pids, then
                removes registry.json so the container falls back to the
                single default instance.
  status        Reports, per instance: port, url, supervisor pid liveness +
                identity, whether its epoch.json exists (and its value), and
                whether its lease is currently held and by whom. Marks
                entries STALE when the supervisor pid is dead, null
                (dry-run), or fails identity verification.

Flags:
  --dry-run     (start only) Create per-port directories and write the
                registry with supervisor_pid null and dry_run true for every
                requested instance, spawning nothing. Exists so the registry
                contract is verifiable from inside the devcontainer, where
                x64sc does not exist to actually launch -- mirrors
                tools/vice-supervisor.sh's own --dry-run rationale.
  --check-container
                Evaluate the container guard ONLY: print every signal and
                exit 0 on a host or 3 in a container. Spawns nothing, writes
                no state, and works with no subcommand. Ignores
                VICE_SUPERVISOR_ALLOW_CONTAINER.
  --print-paths Print repo_root=, pool_dir= and registry_path= (one
                key=value line each) and exit 0. Writes no state and spawns
                nothing, works with no subcommand, and runs BEFORE the
                container guard, exactly like --help -- there is no reason to
                require VICE_SUPERVISOR_ALLOW_CONTAINER=1 just to ask this
                script which directory it resolves to.
  --help, -h    Print this usage and exit 0. Checked before the container
                guard, since printing usage writes no state and spawns
                nothing.

Configuration (all environment-overridable):
  VICE_POOL_SIZE                Default instance count for 'start' (default: 3)
  VICE_POOL_BASE_PORT           First instance's port (default: 6510);
                                 instance i gets port VICE_POOL_BASE_PORT + i
  VICE_POOL_DIR                 Where registry.json, leases/ and each
                                 instance's <port>/ subdirectory live
                                 (default: <repo>/.vice-supervisor)
  VICE_POOL_MCP_HOST            -mcpserverhost value passed to every spawned
                                 instance (default: 0.0.0.0)
  VICE_SUPERVISOR_ALLOW_CONTAINER   TESTING ONLY. Set to 1 to bypass the
                                 container guard below. Never set this to
                                 actually run VICE -- x64sc cannot run in a
                                 container; this only exists so the registry
                                 contract can be exercised in CI/tests.

Exit codes:
  0   success (start, stop, --help, --dry-run, or --check-container found no
      container signals)
  1   usage error, or 'status'/'stop' found no registry.json (status only;
      'stop' with no registry is a clean no-op at exit 0)
  2   container guard refused to run
  3   --check-container found at least one container signal
  5   'status' found at least one stale entry (dead/null/unverified
      supervisor pid)
USAGE
}

# --help/-h checked first, before the container guard, since printing usage
# writes no state and spawns nothing -- there is no reason to make an
# operator set VICE_SUPERVISOR_ALLOW_CONTAINER=1 just to read usage text.
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

# --print-paths joins --help/--check-container above (D-oga): it only prints
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
  echo "registry_path=$REGISTRY_PATH"
  exit 0
fi

# ---------------------------------------------------------------- container guard
#
# Shared with vice-supervisor.sh via this script's own sibling
# lib/container-guard.sh (from whichever location both scripts are running)
# so the two scripts can never drift apart on what counts as "inside a
# container" (D-1's anti-drift requirement). Uses $SELF_DIR, computed at the
# top of this file, for consistency with lib/repo-root.sh's own sourcing
# above.
source "$SELF_DIR/lib/container-guard.sh"

# --check-container reports and exits, without spawning or writing anything,
# and works standalone with no subcommand. It deliberately ignores
# VICE_SUPERVISOR_ALLOW_CONTAINER: its job is to say what the signals
# actually are, not what the escape hatch would permit.
if [ "$CHECK_CONTAINER" -eq 1 ]; then
  rc=0; container_guard_report "vice-pool" || rc=$?
  exit "$rc"
fi

# Everything else (start/stop/status) enforces the guard first, with the
# same VICE_SUPERVISOR_ALLOW_CONTAINER escape hatch vice-supervisor.sh
# uses -- so 'start' inside the container exits 2, matching that script's
# behaviour exactly.
container_guard_enforce "vice-pool.sh" "$HOST_EXAMPLE_PATH"

# ---------------------------------------------------------------- configuration
VICE_POOL_SIZE="${VICE_POOL_SIZE:-3}"
VICE_POOL_BASE_PORT="${VICE_POOL_BASE_PORT:-6510}"
# VICE_POOL_DIR and REGISTRY_PATH are hoisted ABOVE the container guard (top
# of file) so --print-paths can report them without duplicating the
# defaults -- this is just where the knobs are documented, not where they're
# assigned.
VICE_POOL_MCP_HOST="${VICE_POOL_MCP_HOST:-0.0.0.0}"
LEASES_DIR="$VICE_POOL_DIR/leases"

# ---------------------------------------------------------------- subcommand parse
SUBCOMMAND="${1:-}"
if [ -n "$SUBCOMMAND" ]; then
  shift
fi

DRY_RUN=0
POOL_SIZE_ARG=""
for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=1
      ;;
    --check-container|--help|-h|--print-paths)
      : # already handled above
      ;;
    *)
      if [ -n "$POOL_SIZE_ARG" ]; then
        echo "usage error: unexpected argument: $arg" >&2
        usage >&2
        exit 1
      fi
      POOL_SIZE_ARG="$arg"
      ;;
  esac
done

case "$SUBCOMMAND" in
  start)
    :
    ;;
  stop|status)
    if [ -n "$POOL_SIZE_ARG" ]; then
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

if [ "$SUBCOMMAND" = "start" ]; then
  VICE_POOL_SIZE="${POOL_SIZE_ARG:-$VICE_POOL_SIZE}"
  if ! [[ "$VICE_POOL_SIZE" =~ ^[0-9]+$ ]] || [ "$VICE_POOL_SIZE" -lt 1 ] || [ "$VICE_POOL_SIZE" -gt 16 ]; then
    echo "usage error: instance count must be an integer 1..16, got: $VICE_POOL_SIZE" >&2
    exit 1
  fi
  if ! [[ "$VICE_POOL_BASE_PORT" =~ ^[0-9]+$ ]] || [ "$VICE_POOL_BASE_PORT" -lt 1024 ] || [ "$VICE_POOL_BASE_PORT" -gt 65500 ]; then
    echo "usage error: VICE_POOL_BASE_PORT must be an integer 1024..65500, got: $VICE_POOL_BASE_PORT" >&2
    exit 1
  fi
fi

mkdir -p "$VICE_POOL_DIR" "$LEASES_DIR"

# ---------------------------------------------------------------- json helpers
#
# No jq assumed present on the host (constraint), matching
# tools/vice-supervisor.sh's own approach.
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

# ---------------------------------------------------------------- port probe
#
# Best-effort only (T-mef-05's spirit: visibility, not a guarantee): if
# bash's /dev/tcp redirection itself errors for a reason unrelated to the
# connection (feature unsupported, permission issue), this reports "not in
# use" and start proceeds -- cheaper and clearer than letting the supervisor
# discover a bound port through its own crash-loop give-up path, but not a
# substitute for it either.
port_in_use() {
  local port="$1"
  ( exec 3<>"/dev/tcp/127.0.0.1/$port" ) 2>/dev/null
}

# ---------------------------------------------------------------- registry writer
write_registry() {
  local pool_pid="$1" written_at="$2"
  shift 2
  local entries=("$@")
  local tmp
  tmp="$(mktemp "$VICE_POOL_DIR/.registry.XXXXXX")"
  {
    printf '{\n'
    printf '  "version": 1,\n'
    printf '  "written_by": "tools/vice-pool.sh",\n'
    printf '  "written_at": "%s",\n' "$written_at"
    printf '  "pool_pid": %s,\n' "$pool_pid"
    printf '  "base_port": %s,\n' "$VICE_POOL_BASE_PORT"
    printf '  "size": %s,\n' "${#entries[@]}"
    printf '  "instances": [\n'
    local first=1 e
    for e in "${entries[@]}"; do
      if [ "$first" -eq 1 ]; then first=0; else printf ',\n'; fi
      printf '%s' "$e"
    done
    printf '\n  ]\n'
    printf '}\n'
  } >"$tmp"
  mv "$tmp" "$REGISTRY_PATH"
}

# ---------------------------------------------------------------------- start
cmd_start() {
  local started_at
  started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local pool_pid=$$
  local entries=()
  local i port dir epoch_file supervisor_log_rel supervisor_log_abs
  local resolved_args supervisor_pid_field dry_run_field spawned_pid

  for ((i = 0; i < VICE_POOL_SIZE; i++)); do
    port=$((VICE_POOL_BASE_PORT + i))
    dir="$VICE_POOL_DIR/$port"
    epoch_file="$dir/epoch.json"
    supervisor_log_rel="$port/supervisor.log"
    supervisor_log_abs="$dir/supervisor.log"
    resolved_args="-mcpserver -mcpserverhost $VICE_POOL_MCP_HOST -mcpserverport $port"

    if [ "$DRY_RUN" -eq 0 ] && port_in_use "$port"; then
      echo "vice-pool: refusing instance on port $port -- something is already listening there" >&2
      continue
    fi

    mkdir -p "$dir"

    echo "vice-pool: resolved command for port $port: VICE_SUPERVISOR_DIR=$dir VICE_ARGS=\"$resolved_args\" $SUPERVISOR_SCRIPT"

    if [ "$DRY_RUN" -eq 1 ]; then
      supervisor_pid_field="null"
      dry_run_field="true"
    else
      VICE_SUPERVISOR_DIR="$dir" VICE_ARGS="$resolved_args" \
        nohup "$SUPERVISOR_SCRIPT" >"$supervisor_log_abs" 2>&1 &
      spawned_pid=$!
      disown "$spawned_pid" 2>/dev/null || true
      supervisor_pid_field="$spawned_pid"
      dry_run_field="false"
      echo "vice-pool: spawned supervisor for port $port (pid $spawned_pid), log $supervisor_log_abs"
    fi

    entries+=("$(cat <<ENTRY
    {
      "port": $port,
      "url": "http://127.0.0.1:$port/mcp",
      "epoch_file": "$(json_escape "$epoch_file")",
      "supervisor_dir": "$(json_escape "$dir")",
      "supervisor_log": "$(json_escape "$supervisor_log_rel")",
      "supervisor_pid": $supervisor_pid_field,
      "started_at": "$started_at",
      "dry_run": $dry_run_field
    }
ENTRY
)")
  done

  if [ "${#entries[@]}" -eq 0 ]; then
    echo "vice-pool: no instances started -- every candidate port was refused" >&2
    exit 1
  fi

  write_registry "$pool_pid" "$started_at" "${entries[@]}"
  echo "vice-pool: wrote $REGISTRY_PATH (${#entries[@]} instance(s))"
}

# ------------------------------------------------------------- registry read
#
# No jq assumed present (constraint) -- grep/sed against the exact shape
# write_registry() above produces, same posture as
# tools/vice-supervisor.sh's own read_prev_epoch(). "port" and
# "supervisor_pid" are exact-match keys that appear only inside `instances`
# entries (top-level's "base_port" does not match the `"port":` pattern,
# since there is no quote character immediately before "port" in
# "base_port"), so the Nth match of each is the Nth instance, in file order.
read_registry_ports() {
  grep -o '"port": *[0-9]\+' "$REGISTRY_PATH" | grep -o '[0-9]\+$'
}
read_registry_pids() {
  grep -o '"supervisor_pid": *\(null\|[0-9]\+\)' "$REGISTRY_PATH" | sed 's/.*: *//'
}

# ----------------------------------------------------------------------- stop
cmd_stop() {
  if [ ! -f "$REGISTRY_PATH" ]; then
    echo "vice-pool: no registry.json at $VICE_POOL_DIR -- nothing to stop" >&2
    exit 0
  fi

  mapfile -t PORTS < <(read_registry_ports)
  mapfile -t PIDS < <(read_registry_pids)

  local i port pid args
  for ((i = 0; i < ${#PORTS[@]}; i++)); do
    port="${PORTS[$i]}"
    pid="${PIDS[$i]:-null}"

    if [ "$pid" = "null" ] || [ -z "$pid" ]; then
      echo "vice-pool: port $port has no supervisor pid recorded (dry-run entry) -- skipping" >&2
      continue
    fi

    args="$(ps -o args= -p "$pid" 2>/dev/null || true)"
    if [ -z "$args" ]; then
      echo "vice-pool: port $port pid $pid is not running -- skipping (registry may be stale)" >&2
      continue
    fi

    # Identity check BEFORE signalling (T-mef-02): a pid from a stale
    # registry may have been recycled onto an unrelated process, and killing
    # it would be a far worse failure than not stopping a supervisor.
    case "$args" in
      *"$SUPERVISOR_SCRIPT"*)
        echo "vice-pool: stopping port $port (pid $pid)"
        kill -TERM "$pid" 2>/dev/null || true
        ;;
      *)
        echo "vice-pool: refusing to signal pid $pid for port $port -- ps reports \"$args\", which does not match $SUPERVISOR_SCRIPT (possible pid reuse)" >&2
        ;;
    esac
  done

  rm -f "$REGISTRY_PATH"
  echo "vice-pool: removed $REGISTRY_PATH"
}

# --------------------------------------------------------------------- status
cmd_status() {
  if [ ! -f "$REGISTRY_PATH" ]; then
    echo "vice-pool: no registry.json at $VICE_POOL_DIR" >&2
    exit 1
  fi

  mapfile -t PORTS < <(read_registry_ports)
  mapfile -t PIDS < <(read_registry_pids)

  local stale=0
  local i port pid args alive identified epoch_file lease_file
  local epoch_present epoch_value lease_held lease_holder entry_stale
  for ((i = 0; i < ${#PORTS[@]}; i++)); do
    port="${PORTS[$i]}"
    pid="${PIDS[$i]:-null}"
    epoch_file="$VICE_POOL_DIR/$port/epoch.json"
    lease_file="$LEASES_DIR/$port.lease"

    alive="no"
    identified="no"
    if [ "$pid" != "null" ] && [ -n "$pid" ]; then
      args="$(ps -o args= -p "$pid" 2>/dev/null || true)"
      if [ -n "$args" ]; then
        alive="yes"
        case "$args" in
          *"$SUPERVISOR_SCRIPT"*) identified="yes" ;;
          *) identified="no" ;;
        esac
      fi
    fi

    entry_stale="no"
    if [ "$pid" = "null" ] || [ -z "$pid" ] || [ "$alive" = "no" ] || [ "$identified" = "no" ]; then
      entry_stale="yes"
      stale=1
    fi

    epoch_present="no"
    epoch_value="-"
    if [ -f "$epoch_file" ]; then
      epoch_present="yes"
      epoch_value="$(grep -o '"epoch"[[:space:]]*:[[:space:]]*[0-9]\+' "$epoch_file" 2>/dev/null | head -1 | grep -o '[0-9]\+$' || echo '?')"
    fi

    lease_held="no"
    lease_holder="-"
    if [ -f "$lease_file" ]; then
      lease_held="yes"
      lease_holder="$(grep -o '"holder_pid"[[:space:]]*:[[:space:]]*[0-9]\+' "$lease_file" 2>/dev/null | head -1 | grep -o '[0-9]\+$' || echo '?')"
    fi

    printf 'port %s  url http://127.0.0.1:%s/mcp  supervisor_pid %s (alive:%s identified:%s)  epoch:%s(%s)  lease:%s(holder:%s)  %s\n' \
      "$port" "$port" "$pid" "$alive" "$identified" "$epoch_present" "$epoch_value" "$lease_held" "$lease_holder" \
      "$([ "$entry_stale" = "yes" ] && echo STALE || echo ok)"
  done

  # D-5 permits either half (host shell or container Node) to own the
  # "is VICE actually answering" question; this is the split actually taken:
  # the "alive" column above is the SUPERVISOR PID's liveness as `ps` sees it
  # from the HOST -- it says nothing about whether VICE itself is answering a
  # vice_ping. Re-implementing a liveness probe here in shell would be a
  # second, weaker copy of the one vice-probe.mjs already provides
  # (quick-260730-p5x) -- pids, epoch files and lease files are all this
  # script can see from the host; whether VICE is actually up is answered
  # container-side.
  echo "vice-pool: for actual VICE liveness (not just supervisor-pid liveness), run inside the container: node .claude/skills/vice-mcp-selector/scripts/vice.mjs pool status"

  if [ "$stale" -eq 1 ]; then
    exit 5
  fi
  exit 0
}

case "$SUBCOMMAND" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
esac
