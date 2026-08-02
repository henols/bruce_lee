#!/usr/bin/env bash
# .claude/mcp/vice/resources/vice-launcher.sh
#
# HAND-AUTHORED -- not generated. It lives beside the generated vice-broker.mjs
# purely because install-resources.mjs deploys the whole resources/ directory
# as a unit; this is the one file in this directory a maintainer edits
# directly (see ./.claude/CLAUDE.md's Emulator Access three-tier rule).
#
# HOST-ONLY, and deliberately a TRACER launcher (Phase 01.6 plan 01) -- it
# does NOT replace vice-broker.sh start, and hostLaunchInstructions() is not
# repointed at it. The real broker stays bash until Phase 01.6.2; both entry
# points coexist for the duration of 01.6/01.6.1.
#
# Copies vice-broker.sh's own opening shape: SELF_PATH/SELF_DIR resolution,
# lib/repo-root.sh's resolve_repo_root(), then lib/container-guard.sh's
# shared detection -- so this launcher can never drift apart from the other
# host scripts on what counts as "inside a container".
set -euo pipefail

SELF_PATH="${BASH_SOURCE[0]}"
SELF_DIR="$(cd "$(dirname "$SELF_PATH")" && pwd)"

# resolve_repo_root() (lib/repo-root.sh) -- sourced ABOVE the container guard
# and above --print-paths, exactly like vice-broker.sh: it defines a function
# only, spawns nothing and writes no state.
source "$SELF_DIR/lib/repo-root.sh"
REPO_ROOT="$(resolve_repo_root "$SELF_DIR")"

HOST_EXAMPLE_PATH="/home/henrik/dev/henrik/git/bruce_lee/tools/vice-launcher.sh"

# Resolved as a SIBLING of this running script ($SELF_DIR), matching
# vice-broker.sh's own supervisor-resolution rationale: a launcher run from
# resources/ must launch the resources/ copy, not silently reach across to a
# deployed tools/ copy that may be stale or hand-edited.
BROKER_ARTIFACT="$SELF_DIR/vice-broker.mjs"

# Shared with vice-broker.sh, vice-supervisor.sh and vice-pool.sh via this
# script's own sibling lib/container-guard.sh, so no host script here can
# ever drift apart on what counts as "inside a container".
source "$SELF_DIR/lib/container-guard.sh"

# ---------------------------------------------------------------- --check-container
#
# `rc=0; container_guard_report "$label" || rc=$?` -- the documented idiom
# (lib/container-guard.sh's own header) for using the report path under
# `set -e` without aborting on a non-zero verdict the caller means to inspect.
CHECK_CONTAINER=0
for arg in "$@"; do
  case "$arg" in
    --check-container)
      CHECK_CONTAINER=1
      ;;
  esac
done

if [ "$CHECK_CONTAINER" -eq 1 ]; then
  rc=0; container_guard_report "vice-launcher" || rc=$?
  exit "$rc"
fi

# ---------------------------------------------------------------- --print-paths
#
# Prints already-resolved variables only -- writes no state, spawns nothing,
# so (like vice-broker.sh's own --print-paths) it needs no guard enforcement
# to report what this launcher would use.
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
  echo "self_dir=$SELF_DIR"
  echo "broker_artifact=$BROKER_ARTIFACT"
  exit 0
fi

# ---------------------------------------------------------------- enforce + exec
#
# The guard runs BEFORE the exec below, so inside the container the exec is
# never reached -- that is the point. On a real host, this returns and falls
# through to the exec.
container_guard_enforce "vice-launcher.sh" "$HOST_EXAMPLE_PATH"

exec node "$BROKER_ARTIFACT" --repo-root "$REPO_ROOT" "$@"
