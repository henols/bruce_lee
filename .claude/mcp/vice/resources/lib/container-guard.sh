# tools/lib/container-guard.sh
#
# Shared container-detection guard, extracted out of tools/vice-supervisor.sh
# so tools/vice-pool.sh can share the exact same signals rather than carrying
# a second, hand-maintained copy that could drift out of sync (D-1). This
# guard already had one wrong signal removed once (see the comment below) --
# two copies is exactly how that kind of bug comes back.
#
# Sourced only, never executed directly: this file defines functions and
# arrays, nothing else. It deliberately does NOT set `set -euo pipefail` (or
# any other shell option) of its own -- it is sourced into scripts that
# already run under `set -euo pipefail`, and a sourced file changing its
# caller's shell options out from under it would be a surprising, hard-to-spot
# side effect.
#
# IMPORTANT for callers: container_guard_report() and container_guard_enforce()
# both return non-zero as a NORMAL, expected outcome (3 = container detected
# by --check-container's reporting path, 2 = enforcement refused). Under
# `set -e` a bare call to either function aborts the calling script the
# instant it returns non-zero -- which is fine for container_guard_enforce()
# (exiting on refusal IS the point), but container_guard_report() is meant to
# let the caller inspect the verdict and choose its own exit code. Callers
# MUST use the idiom:
#
#   rc=0; container_guard_report "some-label" || rc=$?
#
# rather than a bare `container_guard_report "some-label"`, so that `set -e`
# does not abort the script on a container verdict it is only trying to
# observe.

# Populated by container_guard_evaluate(): one entry per FIRED signal
# (human-readable line, with evidence) and one entry per signal regardless of
# outcome (for the full report), respectively.
CONTAINER_SIGNALS=()
CONTAINER_REPORT=()

# $1 = fired (0/1), $2 = description, $3 = evidence (may be empty)
_container_guard_record_signal() {
  local fired="$1" desc="$2" evidence="${3:-}"
  if [ "$fired" -eq 1 ]; then
    CONTAINER_SIGNALS+=("$desc${evidence:+ -- $evidence}")
    CONTAINER_REPORT+=("  [FIRED] $desc${evidence:+
            evidence: $evidence}")
  else
    CONTAINER_REPORT+=("  [clear] $desc${evidence:+ ($evidence)}")
  fi
}

# Evaluate every signal and (re)populate CONTAINER_SIGNALS / CONTAINER_REPORT.
# Idempotent -- safe to call more than once (e.g. --check-container followed
# by the enforcement path) since both arrays are reset at the top.
container_guard_evaluate() {
  CONTAINER_SIGNALS=()
  CONTAINER_REPORT=()

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

  if [ -e /.dockerenv ]; then
    _container_guard_record_signal 1 "/.dockerenv exists"
  else
    _container_guard_record_signal 0 "/.dockerenv exists"
  fi

  if [ -e /run/.containerenv ]; then
    _container_guard_record_signal 1 "/run/.containerenv exists (podman)"
  else
    _container_guard_record_signal 0 "/run/.containerenv exists (podman)"
  fi

  if [ -n "${CONTAINER_WORKSPACE_PATH:-}" ]; then
    _container_guard_record_signal 1 "CONTAINER_WORKSPACE_PATH is set (this devcontainer sets it)" "$CONTAINER_WORKSPACE_PATH"
  else
    _container_guard_record_signal 0 "CONTAINER_WORKSPACE_PATH is set (this devcontainer sets it)"
  fi

  # systemd-detect-virt is authoritative on systemd Linux and answers exactly
  # the question we care about: --container reports the container technology,
  # or "none" (exit 1) on a bare host. Absence of the binary is not an error --
  # it simply contributes no signal.
  if command -v systemd-detect-virt >/dev/null 2>&1; then
    local detected_virt
    detected_virt="$(systemd-detect-virt --container 2>/dev/null || true)"
    if [ -n "$detected_virt" ] && [ "$detected_virt" != "none" ]; then
      _container_guard_record_signal 1 "systemd-detect-virt --container" "reports: $detected_virt"
    else
      _container_guard_record_signal 0 "systemd-detect-virt --container" "reports: ${detected_virt:-none}"
    fi
  else
    _container_guard_record_signal 0 "systemd-detect-virt --container" "binary not present, signal skipped"
  fi

  # PID 1's cgroup PATH (the field after the last colon), matched against
  # container-indicating path components only. A systemd host's `0::/init.scope`
  # and a bare `0::/` must not match; `/docker/<id>`, `/system.slice/docker-<id>.scope`,
  # `/kubepods/...`, `/libpod-...` and `/lxc/...` must. Note this deliberately
  # does NOT match `/system.slice/docker.service` -- that is the Docker daemon's
  # own cgroup on a HOST, and PID 1 there is systemd in /init.scope anyway.
  local cgroup_match=""
  if [ -r /proc/1/cgroup ]; then
    cgroup_match="$(awk -F: '{ p = $NF; if (p ~ /(^|\/)(docker|lxc|kubepods|libpod)(\/|-|$)/) { print; exit } }' \
                     /proc/1/cgroup 2>/dev/null || true)"
  fi
  if [ -n "$cgroup_match" ]; then
    _container_guard_record_signal 1 "/proc/1/cgroup path names a container" "$cgroup_match"
  else
    _container_guard_record_signal 0 "/proc/1/cgroup path names a container" "no container path component in PID 1's cgroup"
  fi
}

# container_guard_report <label>
#
# Evaluates the guard and prints "<label>: container guard evaluation" followed
# by the per-signal report lines and a verdict line. Returns 0 on a host (no
# signals fired) and 3 in a container (at least one signal fired). Spawns
# nothing and writes no state -- safe to call purely to inspect the verdict.
# See the caller-idiom note at the top of this file: use
# `rc=0; container_guard_report "$label" || rc=$?` under `set -e`.
container_guard_report() {
  local label="$1"
  container_guard_evaluate
  echo "$label: container guard evaluation"
  for line in "${CONTAINER_REPORT[@]}"; do
    echo "$line"
  done
  if [ "${#CONTAINER_SIGNALS[@]}" -gt 0 ]; then
    echo "verdict: CONTAINER (${#CONTAINER_SIGNALS[@]} signal(s) fired) -- the guard would refuse here."
    return 3
  fi
  echo "verdict: HOST (no signals fired) -- the guard would allow x64sc to launch here."
  return 0
}

# container_guard_enforce <label> <host-example-path>
#
# Evaluates the guard and, if any signal fired, prints a FATAL block naming
# every fired signal and exits 2 -- UNLESS VICE_SUPERVISOR_ALLOW_CONTAINER is
# set to 1 (testing only; never set it to actually run VICE). On a clear host
# verdict, returns 0 and prints nothing.
container_guard_enforce() {
  local label="$1" host_example_path="$2"
  container_guard_evaluate
  if [ "${#CONTAINER_SIGNALS[@]}" -gt 0 ] && [ "${VICE_SUPERVISOR_ALLOW_CONTAINER:-0}" != "1" ]; then
    {
      echo "FATAL: $label refuses to run inside a container." >&2
      echo "This script is HOST-ONLY. Signals that fired:" >&2
      for sig in "${CONTAINER_SIGNALS[@]}"; do
        echo "  - $sig" >&2
      done
      echo "" >&2
      echo "If you believe this IS the host, run --check-container for the full" >&2
      echo "per-signal breakdown and report which signal is wrong." >&2
      echo "" >&2
      echo "This cannot work in here: there is no x64sc binary, no display, and" >&2
      echo "the entire point of this script is to launch or supervise a process" >&2
      echo "the container has no access to in the first place." >&2
      echo "" >&2
      echo "Escape hatch (TESTING ONLY -- never to actually run VICE):" >&2
      echo "  VICE_SUPERVISOR_ALLOW_CONTAINER=1" >&2
      echo "" >&2
      echo "Run this script on the HOST instead, from the host workspace, e.g.:" >&2
      echo "  $host_example_path" >&2
    } >&2
    exit 2
  fi
  return 0
}
