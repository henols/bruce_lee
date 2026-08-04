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

### Resolved 2026-08-04 (quick task 260804-o09)

Took the second suggested fix: `build()` now stages every emitted, fully-bannered artifact in a
private same-filesystem sibling temp directory (`.build-tmp-<pid>-XXXXXX`, invisible to this
directory's shallow extension-filtered listing gates) and moves each finished file into `resources/`
with a single `renameSync()`, inside `try/finally` so the staging dir is removed on both the
success and the failure path. Nothing lands at a path inside `resources/` until that path's final
bytes already exist complete elsewhere, so a concurrent reader (including a sibling `build()`
call's own comparison, or a process that spawns an artifact straight out of `resources/`) can no
longer observe a partial or banner-less file. `build({ outDir })`'s signature is unchanged; none of
the 15 existing bare `build()` call sites were edited; no lock was introduced, because no test in
this suite mutates the `.mts` sources build() compiles, so every concurrent build already emits
byte-identical output.

Landed across two commits on branch `worktree-agent-a9cd6298137e8bf56`:
- `ea60ced` — `build-atomic.test.ts`, the regression test, observed RED against the pre-fix
  `build()` (deterministic in-place-mutation test failed with the held file descriptor reading
  compiled JavaScript instead of its original sentinel bytes; the concurrency test failed on round
  1 of up to 5, at 3 concurrent builds, with dozens of torn banner-less reads across
  `broker-epoch.mjs` and `container-guard.mjs`).
- `12663ab` — the fix itself in `build.ts`.

Evidence that closed it: the RED output above, plus three consecutive green full-suite runs
(`node --test '.claude/mcp/vice/'*.test.*` from the worktree root: 405 tests / 400 pass / 0 fail /
5 todo, all three times), a byte-identical `resources/` tree after `node build.ts`
(`git status --porcelain -- resources/` empty, all seven artifacts still mode 644), and
`npm run typecheck` passing. No `.build-tmp-*` entry survived anywhere under `.claude/mcp` after
any of the three runs. Full detail in
`.planning/quick/260804-o09-make-build-write-atomically-so-concurren/260804-o09-SUMMARY.md`.
