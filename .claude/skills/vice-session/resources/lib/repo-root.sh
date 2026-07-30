# .claude/skills/vice-session/resources/lib/repo-root.sh
#
# Shared repo-root resolution for vice-supervisor.sh and vice-pool.sh,
# mirroring repo-root.mjs's documented ladder (D-6) so the shell and Node
# halves of this skill can never resolve to two different `.vice-supervisor`
# directories.
#
# WHY THIS FILE EXISTS AT ALL: the fixed `".."` this replaces
# (`REPO_ROOT="$(cd "$(dirname "$SELF_PATH")/.." && pwd)"`) was correct only
# from `tools/` -- one level up from `tools/` IS the repo root. From
# `resources/` (three levels deeper than `tools/`, at
# `.claude/skills/vice-session/resources/`) that same fixed hop count would
# have resolved to `.claude/skills/.vice-supervisor`, a directory nothing
# else ever writes to. NOTHING would have errored: the container would just
# read a permanently-empty epoch/registry file forever, and restart
# detection (and the pool) would quietly stop working while every command
# kept "succeeding". See repo-root.mjs's own header comment for the Node-side
# telling of the same failure class.
#
# Sourced only, never executed directly: this file defines exactly one
# function, resolve_repo_root, and nothing else. It deliberately does NOT set
# `set -euo pipefail` (or any other shell option) of its own -- it is sourced
# into scripts that already run under `set -euo pipefail`, and a sourced file
# changing its caller's shell options out from under it would be a
# surprising, hard-to-spot side effect. Matches lib/container-guard.sh's
# sourced-file idiom exactly.

# One-time stderr notes, so a long process (or a test driving this function
# repeatedly) does not spam stderr -- mirrors repo-root.mjs's
# warnedEnvOutsideFrom / warnedNoMarkerFound module-level latches.
_REPO_ROOT_WARNED_ENV_OUTSIDE=0
_REPO_ROOT_WARNED_NO_MARKER=0

# resolve_repo_root <absolute-dir>
#
# Prints the resolved repo root for a script whose own directory is
# <absolute-dir>. Precedence, in order (mirrors repo-root.mjs's repoRoot()):
#
#   1. CONTAINER_WORKSPACE_PATH, when set AND <absolute-dir> resolves inside
#      it -- this devcontainer sets it, and it is the most explicit signal
#      available.
#   2. Otherwise, walk up from <absolute-dir> toward the filesystem root,
#      returning the first directory containing a `.git` entry (tested with
#      `-e`, so a worktree's `.git` FILE matches just as well as a real
#      `.git` DIRECTORY). This is what keeps the script correct once exported
#      into a project that sets no such variable at all -- the ONLY branch
#      that ever runs on the real host, which sets no such env var.
#   3. Otherwise, CONTAINER_WORKSPACE_PATH if it is set at all (just not
#      containing <absolute-dir> -- an exported copy of this skill living
#      outside the mounted workspace the variable names). Silence here would
#      be exactly the quiet-wrong-answer failure class this file exists to
#      prevent, so this path emits a one-time stderr note naming both paths.
#   4. Otherwise, a location-shaped last resort, also with a one-time stderr
#      note: FOUR levels up when <absolute-dir>'s own directory is named
#      `resources` (matching `<root>/.claude/skills/vice-session/resources`),
#      ONE level up otherwise (matching `<root>/tools`).
resolve_repo_root() {
  local from="$1" dir parent base

  if [ -n "${CONTAINER_WORKSPACE_PATH:-}" ]; then
    case "$from" in
      "$CONTAINER_WORKSPACE_PATH" | "$CONTAINER_WORKSPACE_PATH"/*)
        printf '%s\n' "$CONTAINER_WORKSPACE_PATH"
        return 0
        ;;
    esac
  fi

  dir="$from"
  while :; do
    if [ -e "$dir/.git" ]; then
      printf '%s\n' "$dir"
      return 0
    fi
    parent="$(dirname "$dir")"
    if [ "$parent" = "$dir" ]; then
      break # reached the filesystem root -- no .git found anywhere above $from
    fi
    dir="$parent"
  done

  if [ -n "${CONTAINER_WORKSPACE_PATH:-}" ]; then
    if [ "$_REPO_ROOT_WARNED_ENV_OUTSIDE" -eq 0 ]; then
      _REPO_ROOT_WARNED_ENV_OUTSIDE=1
      echo "warn: CONTAINER_WORKSPACE_PATH is set ($CONTAINER_WORKSPACE_PATH) but does not contain $from, and no .git ancestor was found either -- falling back to CONTAINER_WORKSPACE_PATH itself as the repo root. This is expected for an exported copy of this skill living outside its mounted workspace; if that is not the situation here, the repo root this resolved to may be wrong." >&2
    fi
    printf '%s\n' "$CONTAINER_WORKSPACE_PATH"
    return 0
  fi

  base="$(basename "$from")"
  if [ "$base" = "resources" ]; then
    dir="$(cd "$from/../../../.." && pwd)"
  else
    dir="$(cd "$from/.." && pwd)"
  fi

  if [ "$_REPO_ROOT_WARNED_NO_MARKER" -eq 0 ]; then
    _REPO_ROOT_WARNED_NO_MARKER=1
    echo "warn: could not find a .git ancestor above $from and CONTAINER_WORKSPACE_PATH is not set -- falling back to a location-shaped last resort ($dir). This is a last resort; if it's wrong, set CONTAINER_WORKSPACE_PATH or run from inside a git repo." >&2
  fi
  printf '%s\n' "$dir"
}
