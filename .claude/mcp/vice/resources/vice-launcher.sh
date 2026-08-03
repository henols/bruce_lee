#!/usr/bin/env bash
# .claude/mcp/vice/resources/vice-launcher.sh
#
# HAND-AUTHORED -- not generated. It lives beside the generated vice-broker.mjs
# purely because install-resources.mjs deploys the whole resources/ directory
# as a unit; this is the one file in this directory a maintainer edits
# directly (see ./.claude/CLAUDE.md's Emulator Access three-tier rule).
#
# HOST-ONLY. Phase 01.6.2: the container guard no longer lives in bash here
# -- it ported to TypeScript (container-guard.mts, PD-03) and now runs at
# the BROKER PROCESS's own startup, closing the invocation-scoped hole
# recorded in RE-FINDINGS.md (running the compiled broker directly, bypassing
# this launcher, was previously unguarded). This launcher no longer sources
# the bash guard module or calls its enforce/report functions itself --
# --check-container is now forwarded through to the Node entry point, which
# answers it, preserving the exact same exit-code contract this launcher
# always had: 2 when the guard refuses, 3 for the report path, 0 for
# --print-paths.
#
# Copies vice-broker.sh's own opening shape: SELF_PATH/SELF_DIR resolution,
# lib/repo-root.sh's resolve_repo_root() -- kept here THIS wave; the inline
# of resolve_repo_root() lands in plan 10, in the same commit that deletes
# that lib file.
set -euo pipefail

SELF_PATH="${BASH_SOURCE[0]}"
SELF_DIR="$(cd "$(dirname "$SELF_PATH")" && pwd)"

# resolve_repo_root() (lib/repo-root.sh) -- sourced above --print-paths,
# exactly like vice-broker.sh: it defines a function only, spawns nothing
# and writes no state.
source "$SELF_DIR/lib/repo-root.sh"
REPO_ROOT="$(resolve_repo_root "$SELF_DIR")"

# Resolved as a SIBLING of this running script ($SELF_DIR), matching
# vice-broker.sh's own supervisor-resolution rationale: a launcher run from
# resources/ must launch the resources/ copy, not silently reach across to a
# deployed tools/ copy that may be stale or hand-edited.
BROKER_ARTIFACT="$SELF_DIR/vice-broker.mjs"

# ---------------------------------------------------------------- --print-paths
#
# Prints already-resolved variables only -- writes no state, spawns nothing,
# so (like vice-broker.sh's own --print-paths) it needs no guard enforcement
# to report what this launcher would use. Checked BEFORE --check-container is
# forwarded, since --print-paths needs no guard verdict at all.
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

# ---------------------------------------------------------------- exec
#
# The guard now runs INSIDE the Node entry point, at its own process
# startup, before any state is read or written and before anything is
# spawned -- both --check-container (exit 3, reporting) and the plain
# enforcement path (exit 2, refusal) are the broker's own job now. This
# launcher forwards every argument, including --repo-root, unchanged, and
# no longer inspects --check-container itself; the exit-code contract this
# launcher always exposed (2/3/0) is preserved because the guard functions
# ported into container-guard.mts return the SAME codes
# container_guard_enforce()/container_guard_report() always did. Signal
# delivery still passes straight through to the broker process with no bash
# trap in between.
exec node "$BROKER_ARTIFACT" --repo-root "$REPO_ROOT" "$@"
