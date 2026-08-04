# Deferred items — 01.6.2.1-01

Out-of-scope discoveries found while executing 01.6.2.1-01-PLAN.md, logged per the executor's
SCOPE BOUNDARY rule rather than fixed inline (not directly caused by this plan's own changes, and
not among this plan's own enumerated acceptance criteria).

## `resources-sync.test.ts` intermittently fails when run as part of the FULL suite, but always passes alone

- **Observed:** one full-suite run (`node --test '.claude/mcp/vice/'*.test.*`) reported
  `resources/broker-control.mjs does not match a fresh build of its TypeScript source -- the
  committed tree is STALE`, even though `broker-control.mts` was untouched by this plan and a
  standalone re-run of `resources-sync.test.ts` (and a manual `node build.ts` diffed against the
  committed tree) both showed no drift at all.
- **Likely cause:** `node --test` runs test files concurrently by default, and several files in
  this directory (`resources-sync.test.ts`, `broker-e2e.test.ts`, `vice-broker-launch.test.ts`,
  and this plan's own `vice-broker-acquire.test.ts`) each independently call `build()`
  (`build.ts`), which runs `tsc` and writes into the SAME shared `resources/` directory. A file
  comparing `resources/` against a fresh build can transiently read a sibling process's
  in-progress write.
- **Why deferred rather than fixed here:** this plan's `files_modified` and acceptance criteria
  are about `handleAcquire()`'s warm-floor consult, not the test suite's own build-concurrency
  discipline. Re-running the full suite immediately afterward passed cleanly (397 tests / 392 pass
  / 0 fail / 5 todo), so this plan's own changes are not implicated.
- **Suggested fix for whoever picks this up:** either serialise the handful of test files that
  call `build()` into their own `node --test` invocation (a `pretest` step, or a documented
  "these files must not run concurrently with each other" note), or have `build()` write to a
  per-process scratch directory and rename atomically into `resources/` only once complete.
