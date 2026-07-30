---
phase: 260730-mef
plan: 01
subsystem: infra
tags: [vice, mcp, bash, node, concurrency, recovery-tooling]

requires:
  - phase: 01-recovery-provenance
    provides: tools/vice.mjs transport seam, tools/vice-supervisor.sh host-side crash supervision, tools/recover.mjs recovery procedure
provides:
  - "tools/lib/container-guard.sh: shared container-detection guard used by both vice-supervisor.sh and vice-pool.sh"
  - "tools/vice-pool.sh: host-only launcher for N parallel supervised VICE MCP instances (start/stop/status)"
  - "tools/vice-pool.mjs: container-side registry reader + atomic lease coordinator (acquire/release)"
  - "tools/vice.mjs: useInstance()/activeInstance() runtime transport-seam redirect, with per-instance epoch tracking"
  - "tools/recover.mjs: CLI-level lease acquisition per verb, snapshotName() port-namespacing"
affects: [01-recovery-provenance, phase-3-verification-harness]

tech-stack:
  added: []
  patterns:
    - "Shared bash guard fragment (container_guard_evaluate/_report/_enforce) sourced by multiple host-only scripts to prevent detection-logic drift"
    - "Atomic lease acquisition via linkSync of a fully-written temp file (never O_EXCL create) for cross-process mutual exclusion over a shared filesystem"
    - "Registry/lease files treated as untrusted input: validate-then-derive, never open a path read out of a host-written file"

key-files:
  created:
    - tools/lib/container-guard.sh
    - tools/vice-pool.sh
    - tools/vice-pool.mjs
    - tools/vice-pool.test.mjs
  modified:
    - tools/vice-supervisor.sh
    - tools/vice.mjs
    - tools/recover.mjs
    - tools/recover.test.mjs
    - tools/README.md

key-decisions:
  - "Container guard extracted into tools/lib/container-guard.sh rather than duplicated, per D-1's explicit anti-drift requirement"
  - "acquire() walks candidate ports in DESCENDING order so batch/harness leases drift away from port 6510, leaving the interactive .mcp.json instance free when possible"
  - "Blocking-with-timeout chosen as the lease acquisition policy over fail-fast or wait-forever (a capture run is long; a leaked lease must still surface loudly)"
  - "Pid-based stale-lease reclaim gated on a hostname match (T-mef-03): host and container pids live in different namespaces, so cross-host pid comparison is never trusted, only age-based reclaim applies across hosts"
  - "snapshotName() namespaces by port unconditionally (including the 6510 fallback), since vice_snapshot_save writes into one shared host directory with no path argument (D-4)"
  - "vice.mjs's useInstance()/activeInstance() extended with an optional `pooled` field beyond the plan's documented {port,url,epochFile} shape (Rule 2 deviation, see below) so recover.mjs's capture record can note pool provenance without a second channel"

requirements-completed: [D-1, D-2, D-3, D-4, D-5]

coverage:
  - id: D1
    description: "tools/vice-pool.sh launches N supervised host-only VICE MCP instances (start/stop/status), sharing the container guard with tools/vice-supervisor.sh with zero drift"
    requirement: "D-1"
    verification:
      - kind: unit
        ref: "manual verify block: guard-parity diff, --check-container exit codes, dry-run start N"
        status: pass
    human_judgment: true
    rationale: "Real multi-window x64sc launch, crash isolation, and pid respawn can only be confirmed on the host with a display; this container has no x64sc binary. The plan's own Task 3 human-check block covers this."
  - id: D2
    description: "registry.json is the atomic host->container channel over the same bind mount as epoch.json; container-side readRegistry()/instanceFor() treat it as untrusted input"
    requirement: "D-2"
    verification:
      - kind: unit
        ref: "tools/vice-pool.test.mjs#readRegistry, #instanceFor, #hostile registry (7 sub-cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Container-side leases (acquire/release) prevent two concurrent callers from ever taking the same instance; blocking-with-timeout policy; stale-lease reclaim by pid (same-host only) and by age"
    requirement: "D-3"
    verification:
      - kind: unit
        ref: "tools/vice-pool.test.mjs#cross-process exclusivity (8-way race -> 2 winners), #in-process exclusivity, #blocking acquire, #stale reclaim by pid, #stale reclaim by age, #cross-namespace safety, #malformed lease file, #token safety, #no registry"
        status: pass
    human_judgment: false
  - id: D4
    description: "snapshotName(port, releaseId, runLabel) namespaces every snapshot name by instance port unconditionally, preventing silent cross-instance overwrite in the shared host snapshot directory"
    requirement: "D-4"
    verification:
      - kind: unit
        ref: "tools/recover.test.mjs#snapshotName (3 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "vice_disk_list stays denied after redirection; restart detection reads the leased instance's own epoch file; .mcp.json untouched; no new MCP server added"
    requirement: "D-5"
    verification:
      - kind: unit
        ref: "tools/vice-pool.test.mjs#deny-list survives redirection; grep confirmed no .mcp.json diff"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-30
status: complete
---

# Quick Task 260730-mef: Parallel VICE Instance Pool Launch Summary

**Host-side launcher for N supervised VICE MCP instances plus a container-side atomic lease layer, sharing one container-detection guard with the existing single-instance supervisor and preserving every current invariant (default port 6510, deny-list, restart detection) with zero configuration.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3 (tracer, TDD lease hardening, TDD consumption + docs)
- **Files modified:** 9 (4 created, 5 modified)

## Accomplishments

- Extracted the container-detection guard out of `tools/vice-supervisor.sh` into `tools/lib/container-guard.sh` so it and the new `tools/vice-pool.sh` can never drift apart on what "inside a container" means — proven by a byte-identical `diff` of both scripts' `--check-container` report lines.
- Built `tools/vice-pool.sh`: a host-only launcher (`start [N] | stop | status`) that spawns N independently supervised `x64sc` instances, each with its own port, supervisor dir, epoch file, logs and crash log — instance 0 is always port 6510, so the existing `.mcp.json` workflow is untouched.
- Built `tools/vice-pool.mjs`: reads `registry.json` as untrusted input (integer-port validation only, never opens a path out of the file), and `acquire()` takes an atomic `linkSync`-based lease on the highest free port, with blocking-with-timeout semantics, stale-lease reclaim (by same-host dead pid, or by age — never cross-host pid), and token-safe idempotent release.
- Wired `tools/vice.mjs`'s new `useInstance()`/`activeInstance()` runtime redirect so restart detection (`readEpoch`/`beginSession`) and the transport (`rpc()`) both follow the leased instance, with the MCP handshake correctly reset on redirect.
- Wired `tools/recover.mjs`'s CLI to acquire exactly one lease per invocation (spanning both `recover()` calls inside `reproduce`, since the epoch-identity check needs both runs on the same machine) and added `snapshotName()` to prevent the shared host snapshot directory from silently overwriting captures across instances.
- Documented the whole feature in `tools/README.md` (rationale, start/stop/status, registry channel, lease policy, snapshot namespacing, the mixed-supervisor caveat, and why `.mcp.json` stays on the default instance).

## Task Commits

1. **Task 1: One instance, end to end (tracer)** — `aeedb9e` (feat)
2. **Task 2 RED: lease-layer hardening tests** — `8c3d620` (test)
2. **Task 2 GREEN: blocking acquire, stale reclaim, token-safe release** — `a812b2a` (feat)
3. **Task 3 RED: snapshotName tests** — `91fab01` (test)
3. **Task 3 GREEN: recover.mjs lease consumption, snapshot namespacing, README** — `9ea95f9` (feat)

_No REFACTOR commits were needed — GREEN implementations were written clean the first time._

## Files Created/Modified

- `tools/lib/container-guard.sh` - shared `container_guard_evaluate`/`_report`/`_enforce` functions, sourced (never executed) by both host-only scripts
- `tools/vice-pool.sh` - host-only pool launcher: `start [N] [--dry-run]`, `stop`, `status`, `--check-container`, `--help`
- `tools/vice-pool.mjs` - `poolDir()`, `registryPath()`, `readRegistry()`, `instanceFor()`, `acquire()`
- `tools/vice-pool.test.mjs` - 14 tests covering the full `<behavior>` contract (cross-process race, reclaim, timeout, hostile registry, deny-list survival)
- `tools/vice-supervisor.sh` - now sources the shared guard instead of an inline copy
- `tools/vice.mjs` - `DEFAULT_ENDPOINT`, `activeUrl`/`activeEpochFile`/`activePort`/`activePooled`, `useInstance()`, `activeInstance()`
- `tools/recover.mjs` - `snapshotName()` export; CLI `main()` now acquires/redirects/releases a lease per invocation; capture record gained `instance_port`/`pooled`
- `tools/recover.test.mjs` - 3 new `snapshotName()` tests, additive on top of the existing 24
- `tools/README.md` - new "Running a pool of instances" section

## Decisions Made

- Container guard extraction chosen over a second hand-maintained copy (D-1's own framing: "let me choose; extracting is the choice").
- Descending port order for `acquire()` so the pool's own consumers naturally avoid the default interactive port when alternatives exist.
- Blocking-with-timeout over fail-fast or wait-forever, per the plan's explicit rationale (routine long captures vs. leaked-lease visibility).
- Cross-host pid-reclaim is structurally disabled (hostname gate) rather than best-effort — a wrong reclaim here would corrupt a live capture on another machine.
- `snapshotName()` applied unconditionally rather than only when pooled, so a name is never ambiguous about whether a pool was running at capture time.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] `useInstance()`/`activeInstance()` extended with an optional `pooled` field**
- **Found during:** Task 3 (recover.mjs capture record)
- **Issue:** The plan's Task 3 action text requires the capture record to carry `instance_port` and `pooled`, but the `<interfaces>` section's documented shape for `useInstance()`/`activeInstance()` was strictly `{port, url, epochFile}`, with no channel for `recover.mjs` (which doesn't hold the lease object directly inside `capture()`/`recover()`) to learn whether the active instance came from a pool.
- **Fix:** Added `pooled` as an optional, default-`false` field to both functions' object shapes. `useInstance(lease)` already receives the full lease object from `acquire()` (which includes `pooled`), so the extra field flows through automatically; a caller passing only the documented `{port,url,epochFile}` minimum is unaffected (defaults to `false`).
- **Files modified:** `tools/vice.mjs`
- **Verification:** Existing 41 tests unaffected; capture record now records `pooled` correctly in manual inspection of the CLI's `useInstance(lease)` call path.
- **Committed in:** `9ea95f9` (part of Task 3's GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 2).
**Impact on plan:** Necessary to satisfy an explicit plan requirement (capture record provenance); the interface addition is backward-compatible and does not change any documented call site's behavior. No scope creep.

## Issues Encountered

None. All three tasks' automated `<verify>` blocks passed on first or second attempt; no host-side VICE access was needed since every verification in this plan is designed to run without a live emulator (per the plan's own `<verification>` note and the "you cannot run x64sc" constraint).

## User Setup Required

None — no external service configuration required. The plan's Task 3 `<human-check>` block (real multi-instance `x64sc` launch, crash-kill isolation, cross-instance snapshot naming) requires the HOST workspace with a display and was not run in this container-only execution; it is the one part of this feature that genuinely cannot be verified here. See coverage `D1`'s rationale above.

## Known Stubs

None. Every exported function has a real implementation; no placeholder data paths were introduced.

## Threat Flags

None beyond what the plan's own `<threat_model>` already covers (T-mef-01 through T-mef-06, all addressed in the implementation and exercised by tests except T-mef-02's `ps`-identity check on `stop`, which was manually verified in this container against a synthetic non-matching pid — see the self-check note below).

## Next Phase Readiness

- The pool coordination layer is code-complete and unit-tested; the one remaining verification step is the host-side `<human-check>` in Task 3 (real `x64sc` launch, crash isolation, cross-instance snapshot naming) — recommended before relying on this for Phase 1's remaining emulator-heavy plans (01-02 through 01-04).
- `tools/recover.mjs`'s CLI now silently benefits from pooling the moment a host operator runs `tools/vice-pool.sh start N` and points `.mcp.json`'s own connection stays put; no code changes are needed on the Phase 1 recovery plans to start using a pool.
- No blockers introduced. The existing single-instance workflow (`tools/vice-supervisor.sh`, `.mcp.json` on 6510) is provably unchanged (41/41 tests green, including explicit no-registry fallback tests).

---
*Task: 260730-mef*
*Completed: 2026-07-30*

## Self-Check: PASSED

All 9 created/modified files confirmed present on disk; all 5 task commits (`aeedb9e`, `8c3d620`, `a812b2a`, `91fab01`, `9ea95f9`) confirmed present in `git log`. Full test suite (41/41) re-run clean immediately before this check.
