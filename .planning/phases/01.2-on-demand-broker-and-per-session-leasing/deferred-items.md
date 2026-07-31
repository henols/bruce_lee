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
