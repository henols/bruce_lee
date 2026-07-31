# Deferred Items — Phase 01.2

Out-of-scope discoveries logged during plan execution, per the executor's
scope-boundary rule (fix only what the current task's changes directly
caused). Not fixed here; recorded so they are not silently lost.

## Plan 01.2-03 task 1 — breaks plan 01.2-02's own tracer test, by design, in a file this plan does not own

**Test:** `.claude/mcp/vice/vice-broker.test.mjs`
`"tracer: request -> grant -> forward -> SIGINT release -> teardown, end to end"`

**Symptom:** fails with `a request file must appear under requests/ before the broker has run` —
`waitFor()` never observes a request file, because none is ever written for that test's flow.

**Root cause, fully diagnosed, not a flake:** plan 01.2-03 task 1's own required behavior (must_have
C10) is that `ensureBrokerLease()` classifies `readBrokerLiveness()` **before** writing any request —
`never_started` and `stale` both return their message immediately, with no request and no lease ever
created. `vice-broker.test.mjs`'s tracer test starts a proxy against a temp `VICE_POOL_DIR` with **no
`broker.json` yet** and expects a request file to appear as soon as the first forwarded `tools/call` is
sent — true under plan 01.2-01's original `ensureBrokerLease()` (which wrote a request unconditionally),
false now that C10's classify-first behavior is implemented.

**Why not fixed here:** `vice-broker.test.mjs` is plan 01.2-02's owned file for this wave (per the
orchestrator's overlap check), not this plan's — plan 01.2-03 is explicitly scoped to
`vice-proxy.mjs`/`vice-proxy.test.mjs`/`.mcp.json`/`tools/README.md` only, and editing a file outside
that set is exactly the scope-widening the wave's parallel-execution contract asks executors to avoid
and instead record as a deviation.

**The fix, once someone is allowed to touch that file:** identical in shape to the fix
`vice-proxy.test.mjs`'s own `acquireLeaseViaBroker()` helper needed for the same reason (see
`01.2-03-SUMMARY.md`'s Deviations section) — write a `broker.json` with a fresh `heartbeat_at` into the
test's `VICE_POOL_DIR` **before** sending the first forwarded `tools/call`, so the liveness
classification reaches `alive` and a request is written. A single `writeFileSync` call, no control-flow
change.

**Verified in isolation:** `node --test .claude/mcp/vice/vice-proxy.test.mjs
.claude/mcp/vice/vice-mcp-selector-docs.test.mjs` (this plan's own two files) is 39/40 green (the one
red is the pre-existing, documented, unrelated `CLAUDE.md`-not-tracked-in-worktree failure — see
`01.2-01-SUMMARY.md`'s Known Issues). The only failure introduced across the whole
`.claude/mcp/vice/**/*.test.mjs` + `tools/**/*.test.mjs` surface is this one test, in the one file this
plan is not permitted to edit.

**Resolution path:** the orchestrator (or a follow-up quick task) applies the one-line fix above to
`vice-broker.test.mjs` after this wave's worktrees merge, or plan 01.2-02's own executor picks it up if
it observes the same failure first. Either way this is a merge-time reconciliation item, not a blocker
on either plan's own task completion.

## Plan 01.2-04 — breaks 10 of plan 01.2-03's own `vice-proxy.test.mjs` tests, by design, in a file this plan does not own

**Tests (10 of 35 in `.claude/mcp/vice/vice-proxy.test.mjs`):** every test that calls the shared
`acquireLeaseViaBroker()` helper — the five `ending path releases the lease: <trigger>` tests,
`idempotency: SIGINT followed by SIGTERM ~50ms later releases exactly once`, `a lease already removed
out from under the proxy`, both heartbeat tests, and `broker never-cache: absent-then-alive-and-granted
succeeds on the SAME process, no restart`.

**Symptom:** each times out waiting for the forwarded `tools/call`'s own response, with stderr showing
the proxy fell back to `forwarding to http://host.docker.internal:6510/mcp (port 6510)` — the static
default URL, never a broker grant — because the grant this helper waits for is never written within
its own single `runBrokerOnceDryRun()` call.

**Root cause, fully diagnosed, not a flake:** this plan's own task 2 introduces an explicit-state
granting model: a request with **zero ready spares** triggers a **cold launch** and the pass writes
**neither a grant nor a denial** — the request stays pending for a **later** pass, once
`maintain_spares()`'s `probe_ready()` promotes the new instance from `launching` to `ready` (this
plan's own `<behavior>` text, verified directly by this plan's `"cold path: with zero ready spares..."`
test). `vice-proxy.test.mjs`'s `acquireLeaseViaBroker()` helper (line ~1484) calls
`runBrokerOnceDryRun()` **exactly once** and immediately awaits the forwarded call's resolution — true
under plan 01/02's original one-pass-always-grants `process_requests()`, false now that a cold-launched
instance needs a second pass to prove itself ready before `grant_from_spare()` will hand it out.

This is the *same* fixture this plan's own `vice-broker.test.mjs` tracer test needed fixing for (see
this file's own comment on that test, and `01.2-04-SUMMARY.md`'s Deviations section) — but
`vice-proxy.test.mjs` is a different, sibling file this plan does not own.

**Why not fixed here:** this plan's declared files are `.claude/mcp/vice/resources/vice-broker.sh` and
`.claude/mcp/vice/vice-broker.test.mjs` only. `vice-proxy.test.mjs` belongs to plan 01.2-03 (already
executed this wave, per the roadmap's own wave ordering), and editing a file outside this plan's
declared set is exactly the scope-widening the parallel-execution contract asks executors to avoid and
instead record as a deviation.

**The fix, once someone is allowed to touch that file:** identical in shape to this plan's own tracer
test fix — either (a) call `runBrokerOnceDryRun()` **twice** before awaiting the forwarded call's
resolution (a cold-launched instance whose probe succeeds gets promoted to `ready` within the FIRST
pass's own `maintain_spares()` step, since nothing else in that pass has consumed the promotion window
yet, so the grant appears on the SECOND pass), or (b) pre-plant a `ready` entry under
`spares/<port>.json` (matching this plan's own `writeSpareFile()` fixture shape in
`vice-broker.test.mjs`) at the request's target port before the first pass, so `grant_from_spare()`
grants instantly in one pass exactly as the helper currently expects. No control-flow change to
`vice-proxy.mjs` itself is needed — only to the TEST helper.

**Verified in isolation:** `MAX_MCP_OUTPUT_TOKENS=25000 node --test .claude/mcp/vice/vice-proxy.test.mjs`
is 25/35 green; the 10 red tests are exactly (and only) the ones using `acquireLeaseViaBroker()`, all
failing with the identical single-pass-timeout symptom above. (`MAX_MCP_OUTPUT_TOKENS` unset is a
separate, pre-existing, unrelated per-machine-setup gap in this worktree — see `tools/README.md`'s "Per-
machine setup" section — not caused by this plan; without it every one of these 35 tests fails
immediately on the proxy's own startup precondition check, masking the real, narrower 10-test symptom
above.)

**Resolution path:** the orchestrator (or a follow-up quick task) applies option (a) or (b) above to
`vice-proxy.test.mjs`'s `acquireLeaseViaBroker()` helper after this wave's worktrees merge, or plan
01.2-03's own executor/maintainer picks it up if it observes the same failure first. This is a
merge-time reconciliation item, not a blocker on this plan's own task completion — `vice-broker.sh`'s
and `vice-broker.test.mjs`'s own full suite (42/42) passes, and this plan's declared behavior (two
passes to grant a cold launch) is exactly what task 2's own acceptance criteria require and test for.
