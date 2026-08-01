---
task: quick-260801-ccn
subsystem: infra
tags: [vice-mcp, on-demand-broker, host-container-path-translation, node-test]

key-files:
  created:
    - .claude/skills/devcontainer-host-path/scripts/containerpath.mjs
    - .claude/skills/devcontainer-host-path/scripts/containerpath.test.mjs
  modified:
    - .claude/mcp/vice/vice-proxy.mjs
    - .claude/mcp/vice/vice-proxy.test.mjs
    - .claude/mcp/vice/vice.mjs
    - .claude/mcp/vice/vice-pool.mjs
    - .claude/mcp/vice/vice-session.mjs
    - .claude/mcp/vice/vice-broker.test.mjs
    - .claude/mcp/vice/vice-mcp-selector-docs.test.mjs
    - .claude/skills/devcontainer-host-path/SKILL.md
    - .planning/notes/vice-mcp-selector-design.md

key-decisions:
  - "Host-root-containment safety net (T-ccn-01) only re-validates a field that containerizeRecord() actually TRANSLATED (its host root matched) -- an already container-shaped path (every pre-existing broker test's tmpdir-rooted VICE_POOL_DIR) is never re-checked against repoRoot() and is trusted exactly as before, which is what keeps the passthrough property from colliding with the safety net."
  - "The url port-match safety net (T-ccn-02) is checked UNCONDITIONALLY on the FINAL url, translated or not -- unlike the path safety net, since a grant could declare a mismatched port from the start without needing translation to be malicious."
  - "mcpHost() in vice.mjs is a FUNCTION, not a cached constant, so it stays sensitive to VICE_MCP_HOST toggled at runtime (matches vice-pool.test.mjs's existing withMcpHostEnv() pattern)."

duration: ~33min
completed: 2026-08-01
status: complete
---

# Quick Task 260801-ccn: Translate broker-granted host coordinates to container form

**Added the missing HOST->CONTAINER inverse at the on-demand VICE broker's lease seam: a new `containerpath.mjs` module beside `hostpath.mjs`, `containerizeGrant()` in `vice-proxy.mjs` inverting a grant's `url`/`epoch_file`/`supervisor_dir` before `useInstance()` adopts them, and a distinct "broker-granted unreachable" diagnosis that stops sending operators to the retired fixed-port route.**

## Performance

- **Duration:** ~33 min (plan dispatched 09:06Z, last commit 09:39Z)
- **Tasks:** 3/3 completed
- **Files created:** 2
- **Files modified:** 9

## Accomplishments

- **`containerpath.mjs`** (new, beside `hostpath.mjs`): `hostRootCandidates()`, `containerPathCandidates()`, `containerPath()`, `containerHost()`, `containerizeRecord()` -- the host->container inverse of `hostpath.mjs`'s outbound translation, deriving the host root at runtime (no literal ever written down) and rewriting loopback hostnames (127.0.0.0/8, `localhost`, IPv6 `[::1]`) structurally rather than against the one observed literal.
- **`containerizeGrant()`** in `vice-proxy.mjs`, wired into `ensureBrokerLease()` between `pollGrant()` and `useInstance()`: inverts all three grant fields via `containerizeRecord()`, then applies a safety net (never open/connect to an unvalidated string read out of a grant file) -- a translated `epoch_file`/`supervisor_dir` escaping the workspace, or a final `url` whose port disagrees with the validated grant port, is refused in favor of the port-derived coordinate, with the substitution reported. Emits exactly one stderr line per grant naming all three fields' before/after.
- **`brokerGrantedUnreachableMessage()`**, routed ahead of the existing refused-and-no-epoch test in `handleToolsCall()`'s probe-failure branch: a broker-granted instance that doesn't answer now names the broker launcher and the probe's own reason, never the retired `vice-supervisor.sh` route. A fixed-port instance (no lease held) is completely unaffected -- verified by a dedicated regression test.
- Corrected `vice-mcp-selector-design.md`'s "the broker needs no path translation" claim (it was true for the broker itself, false for the grant record it hands back) and added a short inverse-direction pointer to `devcontainer-host-path/SKILL.md`.
- **15 new tests added, all guard-removal verified** (see below), full repo sweep 234 -> 249 tests, only one pre-existing, unrelated failure remains.

## Task Commits

1. **Task 1: containerpath.mjs, the host->container inverse** - `2e50c01` (feat)
2. **Task 2: containerize every grant at the ensureBrokerLease() seam** - `91b52cc` (feat)
3. **Task 3: a broker-granted unreachable instance names the broker** - `7549a59` (fix)

## Files Created/Modified

- `.claude/skills/devcontainer-host-path/scripts/containerpath.mjs` - new host->container inverse module
- `.claude/skills/devcontainer-host-path/scripts/containerpath.test.mjs` - its test suite (7 tests)
- `.claude/mcp/vice/vice-proxy.mjs` - `containerizeGrant()`, `brokerGrantedUnreachableMessage()`, wiring
- `.claude/mcp/vice/vice-proxy.test.mjs` - 9 new tests (5 containerize, 2 broker-diagnosis, plus the 6-test env sweep)
- `.claude/mcp/vice/vice.mjs` - `mcpHost()`, the single container-visible host-alias reader
- `.claude/mcp/vice/vice-pool.mjs` - repointed to `mcpHost()` (no behaviour change)
- `.claude/mcp/vice/vice-session.mjs` - repointed to `mcpHost()` (no behaviour change)
- `.claude/mcp/vice/vice-broker.test.mjs` - env sweep fix for a regression this task introduced (see Deviations)
- `.claude/mcp/vice/vice-mcp-selector-docs.test.mjs` - allow-list entry + broadened importer matcher + 1 new test
- `.claude/skills/devcontainer-host-path/SKILL.md` - inverse-direction pointer
- `.planning/notes/vice-mcp-selector-design.md` - corrected path-translation claim

## Decisions Made

- **T-ccn-01's containment check only fires on a field `containerizeRecord()` actually translated.** Re-checking an untranslated (already container-shaped) path against `repoRoot()` would have broken every pre-existing broker test that uses a `/tmp`-rooted `VICE_POOL_DIR` (deliberately outside the workspace, to avoid polluting the real `.vice-supervisor/`) -- those paths were never part of the translation's threat surface in the first place.
- **T-ccn-02's port check runs unconditionally**, translated or not, since a malicious grant could simply declare a wrong port from the start without any loopback rewrite being involved.
- **`mcpHost()` is a function, not a constant**, matching the existing `withMcpHostEnv()` test pattern in `vice-pool.test.mjs` that toggles `VICE_MCP_HOST` mid-process.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a real regression in `vice-broker.test.mjs` introduced by Task 2**
- **Found during:** Task 2's full-sweep verification (`node --test '.claude/**/*.test.mjs' 'tools/**/*.test.mjs'`)
- **Issue:** `vice-broker.test.mjs`'s own end-to-end tracer test (`"tracer: request -> grant -> forward -> SIGINT release -> teardown, end to end"`) drives the REAL `resources/vice-broker.sh` script, which writes grants with a loopback url. Once `containerizeGrant()` started rewriting loopback urls to the container-visible alias (default `host.docker.internal`), this test's loopback-bound stand-in server became unreachable through the rewritten url, and the forwarded call started failing.
- **Fix:** Added `VICE_MCP_HOST: "127.0.0.1"` to this test's `startProxy()` env, exactly matching the sweep already applied to every affected test in `vice-proxy.test.mjs` -- the alias makes the inverse an identity for a stand-in that really does live on this side of the boundary.
- **Files modified:** `.claude/mcp/vice/vice-broker.test.mjs`
- **Verification:** `node --test .claude/mcp/vice/vice-broker.test.mjs` -- 33/33 pass; full repo sweep confirmed clean afterward.
- **Committed in:** `7549a59` (Task 3 commit -- discovered during Task 2's verification pass but fixed alongside Task 3's own work, since it surfaced in the same full-sweep check that task's verification step runs)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug, a real regression this task's own change caused in a file outside the plan's original `<files>` list for any task, but squarely in scope as a direct consequence of Task 2's change).
**Impact on plan:** Necessary for correctness -- without it, this task would have silently broken a previously-green end-to-end test. No scope creep beyond the one env-var line plus an explanatory comment.

## Issues Encountered

- **Pre-existing, out-of-scope test failure (not fixed):** `vice-mcp-selector-docs.test.mjs`'s "the skills table names vice-mcp-selector and not vice-session" test fails in this worktree because `.claude/CLAUDE.md` is untracked/gitignored and therefore never copied into any `git worktree add` checkout -- it exists in the main checkout, not here. This is a structural worktree artifact, present before this task started and unrelated to any file this task touches; confirmed via `git ls-files .claude/CLAUDE.md` returning nothing. Left as-is per the deviation rules' scope boundary.

## Verification Detail (per this task's own `<output>` spec)

**The stderr translation line, as actually emitted for a real grant** (captured live against a freshly spawned proxy, not copied from a test assertion):

```
vice-proxy: containerized grant req-909236-1785577376824-ca1da2b6 -- url: unchanged ("http://127.0.0.1:45743/mcp"); epoch_file: "/home/henrik/dev/henrik/git/bruce_lee/.vice-supervisor/9999/epoch.json" -> "/workspaces/bruce_lee/.vice-supervisor/9999/epoch.json"; supervisor_dir: "/home/henrik/dev/henrik/git/bruce_lee/.vice-supervisor/9999" -> "/workspaces/bruce_lee/.vice-supervisor/9999"
```

(The `url` field reads "unchanged" here because `VICE_MCP_HOST` was set to `127.0.0.1` for this capture, matching the stand-in's own bind address -- the substantive proof that the url rewrite *works* when the alias differs from the stub's address is in the dedicated "containerize: a loopback grant url is rewritten..." test, which binds its stub off loopback entirely.)

**Exact vs. mountinfo-guess branch:** `HOST_WORKSPACE_PATH` and `CONTAINER_WORKSPACE_PATH` are both set in this container (confirmed via `printenv`), so `hostPathCandidates()`'s `exact: true` single-candidate branch was in play throughout every test run in this task -- the 6-candidate mountinfo-guess branch was never exercised live. `containerPathCandidates()`'s handling of that branch (multiple host-root candidates, longest-first) is covered structurally by `hostRootCandidates()`'s own sort, but not exercised against a real guessed mount in this environment.

**Full-sweep count delta:** 234 tests before this task -> 249 after (+15, none removed): 7 new in `containerpath.test.mjs` (new file), 7 new in `vice-proxy.test.mjs` (5 containerize + 2 broker-diagnosis), 1 new in `vice-mcp-selector-docs.test.mjs` (the `importsHostpath()` direct assertion). `vice-broker.test.mjs`'s test count is unchanged (33 -> 33; the fix there was an env-var addition to an existing test, not a new one).

**Where the safety net (T-ccn-01/T-ccn-02) fired during testing:** Only in the two tests deliberately built to trip it -- a lexical `../../../../../../etc/passwd` traversal appended to a real, recognized host root (epoch_file safety net), and a grant `url` whose port was hand-set to disagree with the granted port (url safety net). It did **not** fire in either of the two "real" containerization tests (the url-rewrite and epoch-path end-to-end tests) or in the passthrough test -- i.e., every well-formed grant this task exercised (including the one modeled directly on the captured real-world grant from the plan's own root-cause evidence) translated cleanly with no fallback substitution needed. This is itself informative: the safety net is confirmed to be a defense-in-depth layer against a malformed/hostile grant, not something that fires under ordinary operation.

## Next Phase Readiness

This unblocks Phase 01.2's last plan (01.2-05), whose criteria C12 and C13 both require a broker-granted instance to actually be reachable from the container -- that route now works. The two-session concurrent-leasing proof (criterion 13) was explicitly out of scope for this task (D-8) and remains 01.2-05's job, with its own human checkpoint.

## Self-Check: PASSED

- All 12 files listed under Files Created/Modified verified present on disk via `ls`.
- All 3 task commit hashes (`2e50c01`, `91b52cc`, `7549a59`) verified present via `git log --oneline --all`.

---
*Task: quick-260801-ccn*
*Completed: 2026-08-01*
