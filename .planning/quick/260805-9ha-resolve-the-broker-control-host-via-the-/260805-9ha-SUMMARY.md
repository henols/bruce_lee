---
phase: quick-260805-9ha
plan: 01
subsystem: infra
tags: [vice-mcp, broker, control-plane, tcp, dial-resolution, docker-bridge]

# Dependency graph
requires: []
provides:
  - "vice-broker-client.ts's two control-plane connect sites resolve their dial target via resolveControlTarget()/classifyConnectHost(), never broker.json's own control_host (the broker's BIND address)"
  - "A wildcard-bind resolved target (0.0.0.0/::) is refused before any connect is attempted, naming the address and port"
  - "vice-proxy.ts's ensureBrokerLease() no longer misreports a control-plane connectivity failure as a stale/dead-or-hung broker when the heartbeat is fresh -- brokerControlUnreachableMessage() names the address and port instead"
  - "Every control-plane test across vice-broker-client.test.ts, vice-proxy.test.ts, broker-e2e.test.ts and broker-kill.test.ts names its own in-container listener explicitly, never the bridge alias"
  - "Two RE-FINDINGS.md facts recorded in one dated entry; the resolved todo closed with a dated resolution note; its separate stale-host-deploy half carried forward as its own pending todo"
affects: [any future session driving mcp__vice__* through the on-demand broker's TCP control plane, 01.8's live-verification work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A discovery record's own field can be correct for one reader (host-side tooling) and structurally meaningless for another (a container-side dialer) -- resolve the dial target from the READER's own context (mcpHost()/an explicit override), never from the record, when the record crosses a bind/connect boundary."
    - "Route a control-plane failure kind, not a blanket !ok check, to its own diagnosis -- only the kinds that come from an actual liveness re-read (never_started/stale) may say 'dead or hung'; every other kind gets a message naming what actually failed."

key-files:
  created:
    - .planning/todos/pending/2026-08-05-host-tools-deploy-is-stale-relative-to-committed-resources.md
  modified:
    - .claude/mcp/vice/vice-broker-client.ts
    - .claude/mcp/vice/vice-broker-client.test.ts
    - .claude/mcp/vice/vice-proxy.ts
    - .claude/mcp/vice/vice-proxy.test.ts
    - .claude/mcp/vice/broker-e2e.test.ts
    - .claude/mcp/vice/broker-kill.test.ts
    - .planning/RE-FINDINGS.md
    - .planning/todos/pending/2026-08-04-proxy-reports-a-live-broker-as-stale-blocking-all-emulator-access.md (moved to completed/)

key-decisions:
  - "resolveControlTarget()'s precedence is VICE_BROKER_CONTROL_DIAL_HOST (new) then mcpHost() (existing) -- never broker.json's control_host, which is carried through only as diagnostic text (`recorded`)."
  - "New resolver code lives ABOVE the BROKER-CONTROL-CLIENT REGION markers in vice-broker-client.ts, shared by both acquireOverControlPlane() and openBrokerControl(), per the structural no-filesystem-write gate scoped to that region."
  - "Deviation (Rule 3): the plan's task 2 said not to touch the two eth0-alias tests, but leaving them untouched broke them -- resolveControlTarget()'s mcpHost() default is now ALSO consulted for the control-plane dial, and those two tests set VICE_MCP_HOST to eth0 for the (unrelated) data-plane rewrite test, while their control listener binds to 127.0.0.1 only. Added VICE_BROKER_CONTROL_DIAL_HOST: \"127.0.0.1\" alongside their existing eth0 alias, touching neither the alias itself nor the assertions."
  - "Deviation (Rule 3): npm ci was required in this worktree (node_modules was absent here, present in the main checkout and every sibling worktree) -- a standard lockfile-pinned dependency restore, not a new/unverified package install, so it did not trigger the package-legitimacy checkpoint."
  - "Consolidated two RE-FINDINGS.md entries into the single dated entry the plan specified, after first drafting two -- re-read the plan text mid-task and fixed it in a follow-up commit rather than leaving a duplicate."

requirements-completed:
  - TODO-BROKER-CONTROL-DIAL-HOST

coverage:
  - id: D1
    description: "A broker.json record carrying 0.0.0.0/127.0.0.1/localhost in control_host never yields that value as the dial target; with no override, resolves to mcpHost()'s answer"
    verification:
      - kind: unit
        ref: "vice-broker-client.test.ts#resolveControlTarget(): a record carrying 0.0.0.0 never yields it as the dial target -- with no override set, resolves to the bridge alias"
        status: pass
      - kind: unit
        ref: "vice-broker-client.test.ts#resolveControlTarget(): neither 127.0.0.1 nor localhost in the record ever surfaces as the dial target, with no override set"
        status: pass
    human_judgment: false
  - id: D2
    description: "classifyConnectHost() classifies wildcard-bind/loopback/routable hosts structurally, across bracketed/unbracketed/fully-expanded IPv4 and IPv6 spellings"
    verification:
      - kind: unit
        ref: "vice-broker-client.test.ts#classifyConnectHost(): classifies a corpus of wildcard-bind, loopback and routable hosts structurally"
        status: pass
    human_judgment: false
  - id: D3
    description: "VICE_BROKER_CONTROL_DIAL_HOST overrides the resolved dial host verbatim, regardless of the record"
    verification:
      - kind: unit
        ref: "vice-broker-client.test.ts#resolveControlTarget(): the env override is honoured verbatim, regardless of what the record says"
        status: pass
    human_judgment: false
  - id: D4
    description: "openBrokerControl() refuses a wildcard-bind resolved target before any connect, naming the address and port, resolving well inside CONTROL_CONNECT_TIMEOUT_MS"
    verification:
      - kind: unit
        ref: "vice-broker-client.test.ts#openBrokerControl(): a wildcard-bind dial target is refused before any connect is attempted, naming the address and port"
        status: pass
    human_judgment: false
  - id: D5
    description: "A control-plane connect failure against a fresh heartbeat names the address and port, and never attributes the failure to heartbeat age"
    verification:
      - kind: integration
        ref: "vice-proxy.test.ts#control-plane unreachable: a fresh heartbeat but a dead connect names the address and port, never the heartbeat-age wording"
        status: pass
    human_judgment: false
  - id: D6
    description: "never_started and stale still each reach their own two pre-existing, distinct messages, unchanged"
    verification:
      - kind: integration
        ref: "vice-proxy.test.ts#broker three states: each broker-absent shape gets its own message and fix"
        status: pass
    human_judgment: false
  - id: D7
    description: "No test in the module tree dials the real bridge alias; every control-plane test names 127.0.0.1/eth0 explicitly or asserts on a resolver return value"
    verification:
      - kind: unit
        ref: "node --test '.claude/mcp/vice/'*.test.* -- 406/406 non-todo tests"
        status: pass
    human_judgment: false
  - id: D8
    description: "Full suite green and resources/ regenerates byte-identical (this change touches none of build.ts's seven HOST_BOUND_ARTIFACTS)"
    verification:
      - kind: other
        ref: "node .claude/mcp/vice/build.ts && git status --porcelain -- .claude/mcp/vice/resources/ (empty)"
        status: pass
    human_judgment: false
  - id: D9
    description: "One dated RE-FINDINGS.md entry with both reusable facts, separate Evidence/Confidence fields; the resolved todo moved to completed/ with a dated resolution note; its stale-host-deploy half carried forward as a new pending todo"
    verification: []
    human_judgment: true
    rationale: "Judging prose quality/completeness of a findings-log entry and a resolution note is not mechanically verifiable beyond presence checks already covered by other coverage rows."

duration: ~40min (commit-bounded: base 692018d 2026-08-05T07:01:24Z to 4218822 2026-08-05T07:41:00Z)
completed: 2026-08-05
status: complete
---

# Quick Task 260805-9ha: Resolve the Broker Control Host via the Bridge Alias Summary

**vice-broker-client.ts's control-plane connect sites now resolve their dial target through a new `resolveControlTarget()`/`classifyConnectHost()` pair (never `broker.json`'s own `control_host`, the broker's BIND address), and `vice-proxy.ts` stops misreporting a control-plane connectivity failure as a stale/dead-or-hung broker when the heartbeat is fresh.**

## Performance

- **Duration:** ~40 min (commit-bounded)
- **Started:** base commit `692018d`, 2026-08-05T07:01:24Z
- **Completed:** `4218822`, 2026-08-05T07:41:00Z
- **Tasks:** 3 (all executed, one gap-closing correction commit)
- **Files modified:** 9 (7 touched, 1 created, 1 moved)

## Accomplishments

- **The bug:** `broker.json`'s `control_host` field is the broker's own BIND address (`0.0.0.0`, per `broker-control.mts`'s own documented rule). `vice-broker-client.ts`'s two connect sites read it verbatim and dialed it, which from inside the container reaches the container's own network stack, where nothing listens -- every forwarded `mcp__vice__*` call failed while a healthy broker with three warm spares sat idle.
- **The fix:** `classifyConnectHost()`/`resolveControlTarget()`, placed above the `BROKER-CONTROL-CLIENT REGION START` marker in `vice-broker-client.ts`, resolve the dial target from a new `VICE_BROKER_CONTROL_DIAL_HOST` override or `vice.ts`'s existing `mcpHost()` -- never from the record, which is carried through only as diagnostic text (`recorded`). A resolved wildcard-bind host (`0.0.0.0`, `::`, matched structurally across bracketed/unbracketed/fully-expanded spellings) is refused before any connect is attempted. Both `acquireOverControlPlane()` and `openBrokerControl()` are wired through it.
- **The mis-attributing message:** `ensureBrokerLease()` used to read every `openBrokerControl()` failure as dead-or-hung, regardless of cause. It now routes only `never_started`/`stale` (a genuine liveness re-read) to that message; every other failure kind reaches a new `brokerControlUnreachableMessage()` that names the resolved address and port and states the heartbeat is fresh -- closing the exact mis-attribution that cost a prior session roughly a dozen tool calls chasing a threshold that was never exceeded.
- **Test seams:** every control-plane test across `vice-broker-client.test.ts`, `vice-proxy.test.ts`, `broker-e2e.test.ts` and `broker-kill.test.ts` now names its own in-container listener explicitly (`VICE_BROKER_CONTROL_DIAL_HOST`/`VICE_MCP_HOST` set to `127.0.0.1`, or the pre-existing `eth0` tests left dialing their own container interface) -- confirmed by an exhaustive scan of all 97 top-level test blocks in `vice-proxy.test.ts` pairing `startControlBroker()`/`acquireLeaseViaBroker()` against `startProxy()`.
- Full suite green: `node --test '.claude/mcp/vice/'*.test.*` -- 406/406 non-todo tests (411 total, 5 intentional `todo`s unrelated to this change). `resources/` regenerates byte-identical (`git status --porcelain` empty after a fresh `node .claude/mcp/vice/build.ts`) -- this change touched none of `build.ts`'s seven `HOST_BOUND_ARTIFACTS`.
- One dated `RE-FINDINGS.md` entry (2026-08-05) carrying both reusable facts (bind-vs-connect, and the mis-attributing message), each with its own "Saves" line, under a single Evidence/Confidence pair. The resolved todo is under `completed/` with a dated resolution note; its "host deploy is stale" half is carried forward as a new pending todo (`2026-08-05-host-tools-deploy-is-stale-relative-to-committed-resources.md`) rather than archiving alongside the fixed half.

## Task Commits

Each task was committed atomically, plus one follow-up correction:

1. **Task 1: End-to-end -- dial resolution + control-plane-unreachable diagnosis** - `20c5c1d` (feat, tracer/tdd)
2. **Task 2: Point every remaining in-container control-plane test at its own local listener** - `5c96eeb` (test)
3. **Task 3: Prove the whole suite and the generated tree, then close the record** - `70e902a` (docs)
4. **Correction: consolidate the two RE-FINDINGS entries into the plan's required single entry** - `4218822` (docs)

**Plan metadata:** none from this executor -- STATE.md is the orchestrator's responsibility per this task's constraints.

_Task 1 carried `tdd="true"` and `type="tracer"`: tests were written and run first (RED, confirmed failing against the pre-fix source), then the implementation (GREEN), all landing in one commit per this quick task's own file-scoped protocol rather than three separate RED/GREEN/REFACTOR commits._

## Files Created/Modified

- `.claude/mcp/vice/vice-broker-client.ts` - Added `classifyConnectHost()`/`resolveControlTarget()` above the control-client region; rewired both connect sites (`acquireOverControlPlane()`, `openBrokerControl()`); added `"unreachable_control_plane"` to `ControlFailureKind`; added optional `target?: string` to `OpenBrokerControlOutcome`'s failure member.
- `.claude/mcp/vice/vice-broker-client.test.ts` - Module-scope `VICE_BROKER_CONTROL_DIAL_HOST="127.0.0.1"` (with a `withEnv()` helper for the tests that must prove the no-override default); five new tests; export-list closure test updated with the two new runtime exports.
- `.claude/mcp/vice/vice-proxy.ts` - Added `brokerControlUnreachableMessage()`; `ensureBrokerLease()` now routes by failure kind instead of a blanket `!opened.ok`.
- `.claude/mcp/vice/vice-proxy.test.ts` - New "control-plane unreachable" test naming the address/port and asserting the heartbeat-age phrase's absence (via a named constant); two missing `VICE_BROKER_CONTROL_DIAL_HOST` sites added (the "broker three states" launch-denial case and the "broker warming" case); the two `eth0` tests each gained the same var alongside their existing alias (see Deviations).
- `.claude/mcp/vice/broker-e2e.test.ts` / `.claude/mcp/vice/broker-kill.test.ts` - Module-scope client-side override, explicitly unset from the spawned broker's own env; the existing `control_host === "0.0.0.0"` assertion annotated as now documenting the fix.
- `.planning/RE-FINDINGS.md` - One dated entry, both facts.
- `.planning/todos/completed/2026-08-04-proxy-reports-a-live-broker-as-stale-blocking-all-emulator-access.md` - Moved from `pending/`, dated resolution note appended, "Correction to an earlier diagnosis" section left untouched.
- `.planning/todos/pending/2026-08-05-host-tools-deploy-is-stale-relative-to-committed-resources.md` - New; carries forward the separate, still-open stale-`tools/`-deploy item.

## Decisions Made

See `key-decisions` in frontmatter above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Two `eth0`-alias tests broke under the new resolver and needed a var the plan said not to add to them**
- **Found during:** Task 1's own `<verify>` run (`node --test vice-broker-client.test.ts vice-proxy.test.ts`)
- **Issue:** The plan's task 2 explicitly said "do not touch the two tests that deliberately use the container's own eth0 address as the alias." But `resolveControlTarget()`'s default source is `mcpHost()`, which those two tests set to `eth0` for an unrelated purpose (proving the DATA-plane grant-url/epoch_file rewrite lands on the configured alias). Their control listener (`startControlBroker()`) binds to `127.0.0.1` only, so once the control-plane dial also started reading `mcpHost()` (=`eth0`), the connect failed with nothing listening on that interface.
- **Fix:** Added `VICE_BROKER_CONTROL_DIAL_HOST: "127.0.0.1"` to both tests' `startProxy()` env, alongside their existing `VICE_MCP_HOST: eth0` -- the eth0 alias itself, and every assertion, are untouched.
- **Files modified:** `.claude/mcp/vice/vice-proxy.test.ts`
- **Verification:** Both tests pass; full suite green.
- **Committed in:** `20c5c1d` (Task 1 commit)

**2. [Rule 3 - Blocking] This worktree's `node_modules` was missing (present in the main checkout and every sibling worktree)**
- **Found during:** Task 2's `<verify>` run -- `build()` (called by `broker-kill.test.ts`/`broker-e2e.test.ts`) failed with `spawnSync .../node_modules/.bin/tsc ENOENT`
- **Issue:** This is a standard, lockfile-pinned dependency (`typescript`, `@types/node`, both already declared in `package.json`/`package-lock.json`, byte-identical to the main checkout's lockfile), not a new or unverified package -- confirmed the exclusion in the executor's own deviation rules (package-legitimacy checkpoint) does not apply here, since nothing about the package name or version needed verifying.
- **Fix:** Ran `npm ci` inside `.claude/mcp/vice/` in this worktree only, restoring the exact locked dependency tree.
- **Files modified:** none tracked (`node_modules/` is gitignored)
- **Verification:** Full suite (`.claude/mcp/vice/*.test.*`) subsequently ran to completion.
- **Committed in:** n/a (gitignored, nothing to commit)

**3. [Rule 1 - Bug in my own prior commit] Two RE-FINDINGS.md entries where the plan specified one**
- **Found during:** Re-reading the plan's task 3 text after drafting the RE-FINDINGS.md entries
- **Issue:** The plan's exact instruction was "Append ONE entry... It carries the two reusable facts... State what each saves, and give the separate required Evidence: and Confidence: fields" -- I had drafted two separate dated headings instead of one entry with two facts.
- **Fix:** Consolidated into the single dated entry the plan specified, one fact per paragraph, each with its own "Saves" line, under one Evidence field and one Confidence field (with a per-fact confidence breakdown inside it). No content or grade was lost or edited in place -- this was a structural merge of freshly-authored text, not a retroactive edit to an existing grade.
- **Files modified:** `.planning/RE-FINDINGS.md`
- **Verification:** `grep -c '^### 2026-08-05'` returns 1.
- **Committed in:** `4218822` (follow-up commit, not amended into `70e902a`, per the no-amend git safety rule)

---

**Total deviations:** 3 auto-fixed (2 Rule 3 blocking-issue fixes, 1 Rule 1 self-correction of my own draft). **Impact on plan:** All three necessary for a green suite / plan-literal compliance. No scope creep -- the eth0 fix touches only an env var addition, the npm ci is untracked, and the RE-FINDINGS consolidation is a same-session correction before it ever left this task.

## Issues Encountered

- A pre-existing flake: `broker-kill.test.ts`'s "the broker prints its start-time banner on stderr before broker.json" test failed once under full-suite load (411 tests running back-to-back) and passed cleanly both in isolation and on a full-suite re-run immediately after. This is a real-subprocess stderr-ordering race unrelated to anything this task changed (no code path this task touched writes that banner or reads it); logged here as observed, not fixed, per the scope-boundary rule (pre-existing, unrelated-file flakiness is out of scope for this task).

## User Setup Required

None - no external service configuration required. (The container cannot restart the host broker; that remains the developer's own action, tracked separately in the carried-forward stale-deploy todo.)

## Next Phase Readiness

- Every forwarded `mcp__vice__*` call this session's proxy would make now resolves its control-plane connection correctly against a broker whose `broker.json` names `0.0.0.0` -- the defect blocking Phase 01.8's live-verification register (per the closed todo's own "Impact" section) is closed.
- The carried-forward todo (`2026-08-05-host-tools-deploy-is-stale-relative-to-committed-resources.md`) is a live blocker for verifying 01.6.2.1's five lifecycle-policy changes specifically -- it requires the developer's go-ahead (destructive to warm spares/granted instances) and is explicitly not closed by this task.
- No other blockers. `.claude/mcp/vice/resources/` is proven regenerated-not-hand-edited; no host-bound artifact was touched.

## Self-Check: PASSED

- `FOUND: .claude/mcp/vice/vice-broker-client.ts` (modified)
- `FOUND: .claude/mcp/vice/vice-broker-client.test.ts` (modified)
- `FOUND: .claude/mcp/vice/vice-proxy.ts` (modified)
- `FOUND: .claude/mcp/vice/vice-proxy.test.ts` (modified)
- `FOUND: .claude/mcp/vice/broker-e2e.test.ts` (modified)
- `FOUND: .claude/mcp/vice/broker-kill.test.ts` (modified)
- `FOUND: .planning/RE-FINDINGS.md` (modified, one 2026-08-05 heading)
- `FOUND: .planning/todos/completed/2026-08-04-proxy-reports-a-live-broker-as-stale-blocking-all-emulator-access.md` (moved from pending/)
- `FOUND: .planning/todos/pending/2026-08-05-host-tools-deploy-is-stale-relative-to-committed-resources.md` (new)
- Commits `20c5c1d`, `5c96eeb`, `70e902a`, `4218822` all found in `git log --oneline -6`
- `git status --porcelain` clean except this SUMMARY.md itself (staged next)
- `node --test '.claude/mcp/vice/'*.test.*` -- 406/406 non-todo tests, re-confirmed after every commit
- `node .claude/mcp/vice/build.ts && git status --porcelain -- .claude/mcp/vice/resources/` -- empty

---
*Phase: quick-260805-9ha*
*Completed: 2026-08-05*
