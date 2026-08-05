---
phase: quick-260805-decided-fixes
plan: inline (no PLAN.md — two already-decided items, task-scoped)
subsystem: vice-mcp
tags: [vice-mcp, vice-proxy, vice-broker, continuation, warm-floor, wr-02, test-coverage]
status: complete
completed: 2026-08-05
---

# Quick Task 260805: two decided fixes — vice_result_continue coverage, WR-02 fire-and-forget kill

Two items the orchestrator had already decided; this task implemented both without re-opening
either decision.

## Task 1 — cover the continuation machinery by lowering the cap in a test

**Decision (given, not re-opened): keep `vice_result_continue`; do not change the production
500,000-char default.**

`vice-proxy.ts`'s `OUTPUT_CHAR_CAP` reads `VICE_MAX_RESULT_CHARS` with 500000 only as a fallback,
so the chunking path is env-overridable and testable even though it never fires at the real
default. The existing suite (`vice-proxy.test.ts`) already drove the *whole* continuation
sequence end-to-end against a lowered cap — chunk marker, issued token, `vice_result_continue`
returning the next chunk, sequence termination, byte-for-byte reassembly — and already covered
the exhausted-token failure path (a token issued then fully drained). Two gaps remained and were
closed:

1. **An unknown token that was never issued at all** (distinct from "issued then expired") hits
   the same guard at `vice-proxy.ts:1960` (`!token || !CONTINUATION_STORE.has(token)`) but had no
   test exercising that half of the condition. New test: `"an unknown continuation token (never
   issued by this proxy) fails loudly, not silently or opaquely"` — sends a fabricated token,
   asserts the same error message, and confirms the proxy stays alive and fully functional
   afterward (a subsequent `vice_ping` still succeeds).
2. **Nothing tied the `_meta["anthropic/maxResultSizeChars"]` stamp to the actual enforced chunk
   boundary using the SAME cap value in one assertion** — the two existing tests used different
   cap values (1000 and 12345) for the enforcement half and the advertisement half respectively,
   so the two could in principle drift apart without either test noticing. New test: `"the _meta
   cap stamp and the actual chunk boundary never drift apart"` — sets one cap (777), asserts every
   tool's `_meta` stamp equals it, then triggers an oversized call and asserts every non-final
   chunk (including the first) is exactly that many characters long, with full reassembly
   confirmed at the end.

**File touched:** `.claude/mcp/vice/vice-proxy.test.ts` only (test-only; no production code
change). `vice-proxy.ts` is container-side, so a correct `resources/` diff for this task is
**empty** — confirmed via `git status --short`.

## Task 2 — WR-02: the acquire no longer blocks behind a synchronous per-candidate kill

**Decision (given, not re-opened): fix now**, per the todo filed at
`.planning/todos/pending/2026-08-05-wr-02-grant-time-probe-kill-serialises-the-acquire-hot-path.md`
(now moved to `completed/` with a resolution note).

**Option chosen: fix option 1 (fire-and-forget the kill), not option 2 (cap how many failed
candidates a walk waits through).** Reasoning: option 1 matches an idiom already local to this
file — `handleRelease()`'s own `verifiedKill(...).catch(() => {})` a few hundred lines below
`selectWarmInstance()` — rather than inventing a new bound, and it removes the wait entirely
instead of merely capping it.

**Implementation (`selectWarmInstance()`, `.claude/mcp/vice/vice-broker.mts`):**
- The drop (`markDeliberateDeath(record, false)` + `state.instances.delete(record.port)`) still
  happens **synchronously**, in the same tick as the failed probe, strictly **before**
  `deps.kill(...)` is even invoked. This ordering is unchanged and is exactly what CR-01's
  identity recheck (`state.instances.get(record.port) !== record`) depends on — a concurrent
  sibling must see the record already gone from `state.instances`, and it still does.
- `deps.kill(...)` is invoked (still the identity-verified kill — never replaced by a bare,
  unverified signal) but its promise is no longer `await`ed by the walk: attached to a
  `.then()`/`.catch()` chain instead, so `selectWarmInstance()` continues to the next candidate
  (or returns `null` to the cold-launch fall-through) immediately.
- The grant-time-probe-failure log line is split in two: an immediate line logged right after the
  drop (no kill stage — nothing here waits for one), and a second line logged once the kill's
  promise actually settles, naming the resolved stage. This preserves D-07's "a lifecycle
  decision must be reconstructable from the log after an incident" property without pretending
  the walk saw the outcome synchronously.

**CR-01 preserved, verified rather than assumed:** the pre-existing CR-01 regression test
(`vice-broker-acquire.test.ts`) was run unmodified and stays green — it passes **for the same
reason as before** (the drop's ordering relative to the kill never changed), confirmed by reading
the test rather than merely re-running it: its assertions never depended on the kill being
awaited, only on the drop preceding a sibling's recheck.

**Grant-recording call site and identity-verified kill both preserved:** `state.grants.set()`
still has exactly one call site (`handleAcquire()`, unaffected by this change; the structural gate
in `broker-launch.test.ts` that counts it stayed green), and `deps.kill` is still the same
identity-verified `verifiedKill()` — detaching the wait did not become an unverified kill.

**Tests added/changed (`.claude/mcp/vice/vice-broker-acquire.test.ts`):**
- Updated the existing log-wording test (`"the grant-time-probe-failure log line is distinct
  from broker-kill.mts's shutdown wording"`) to match the new split message shape, and added an
  assertion that the immediate line does **not** name a kill stage.
- New test: `"handleAcquire: WR-02 -- falls through to a cold launch without ever awaiting the
  dropped candidate's kill"` — uses a deferred kill promise this test controls; proves
  `handleAcquire()` settles into a successful grant **while the kill's own promise is still
  pending**. This is the direct proof of the regression this fix closes, not merely that the
  outcome is still correct.
- New test: `"handleAcquire: WR-02 -- once the fire-and-forget kill settles, a separate log line
  names the resolved kill stage"` — confirms no settled-kill line exists before the deferred kill
  resolves, and that the correct line (naming port, pid, and stage) appears once it does.

**`vice-broker.mts` is host-bound**, so `resources/vice-broker.mjs` was rebuilt (`node build.ts`)
and its diff is **non-empty, correctly** — hand-read and confirmed to mirror the source edit
exactly (no unrelated drift).

## Verification

- `npm ci --prefix .claude/mcp/vice` (worktree root, not the shared checkout) — dependencies
  installed before any edit.
- `npx tsc --noEmit -p .claude/mcp/vice/tsconfig.json` — clean, both tasks.
- `node --test vice-proxy.test.ts` (Task 1, in isolation) — 115/115 pass, including the two new
  tests.
- `node --test vice-broker-acquire.test.ts` (Task 2, in isolation) — 13/13 pass, including the
  CR-01 regression test (unmodified) and the two new WR-02 tests.
- **Full suite, foreground, `node --test '*.test.*'` from `.claude/mcp/vice/`:**
  - Baseline on `main`: `446 / 441 pass / 0 fail / 5 todo`.
  - After Task 1 alone: `448 / 443 pass / 0 fail / 5 todo` (+2, both new).
  - After Task 1 + Task 2: `450 / 445 pass / 0 fail / 5 todo` (+4 total: 2 from Task 1, 2 from
    Task 2's new WR-02 timing tests — the updated log-wording test replaces an existing test
    in place, no net count change from that edit).
  - `0 fail` and `5 todo` preserved throughout. No lost coverage.
- `git status --short .claude/mcp/vice/resources/` — confirmed empty after Task 1, non-empty
  (exactly `vice-broker.mjs`) after Task 2.

## Broker safety

`vice_recycle` was never called. `mcp__vice__*` was never invoked — both tasks are unit/seam-level
tests against a stub host (Task 1) or an in-process `BrokerState` with injected dependencies
(Task 2); no real emulator or real broker connection was touched. The running host broker and its
three warm spares were not restarted, killed, or recycled at any point in this task.

## Deviations from Plan

None beyond what the work order itself anticipated. One self-inflicted process note: the first
commit attempt for Task 2 initially staged incompletely (a multi-path `git add` that included an
already-moved source path failed silently for the whole invocation, leaving only the `git
mv`-staged rename committed). Caught immediately via `git status --short` after the commit,
corrected with a proper `git add` of all four intended paths followed by `git commit --amend`
before any further work — the amend targeted this task's own just-made, not-yet-shared commit, not
prior history, so no rule against amending shared work was implicated.

## Known Stubs

None.

## Threat Flags

None — both changes are test/timing-behavior only; no new network endpoint, auth path, file
access pattern, or trust-boundary schema change was introduced.

## Commits

- `6466f07` — `test(260805): cover vice_result_continue's unknown-token path and cap/enforcement drift`
- `7c30127` — `fix(260805): WR-02 -- make the grant-time-probe-failure kill fire-and-forget`

## Self-Check

- `.claude/mcp/vice/vice-proxy.test.ts` — FOUND, contains both new Task 1 tests.
- `.claude/mcp/vice/vice-broker.mts` — FOUND, contains the fire-and-forget kill change.
- `.claude/mcp/vice/vice-broker-acquire.test.ts` — FOUND, contains the updated + two new Task 2 tests.
- `.claude/mcp/vice/resources/vice-broker.mjs` — FOUND, rebuilt.
- `.planning/todos/completed/2026-08-05-wr-02-grant-time-probe-kill-serialises-the-acquire-hot-path.md` — FOUND.
- Commit `6466f07` — FOUND in `git log --oneline`.
- Commit `7c30127` — FOUND in `git log --oneline`.

## Self-Check: PASSED
