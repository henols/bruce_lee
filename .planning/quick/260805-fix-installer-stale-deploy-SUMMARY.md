---
phase: quick-260805-fix-installer-stale-deploy
plan: inline (no PLAN.md — one filed defect, task-scoped)
subsystem: infra
tags: [vice-mcp, install-resources, deploy, generated-vs-hand-authored]
status: complete
completed: 2026-08-05
---

# Quick Task 260805: fix `installResources()`'s default so it can refresh a stale deploy

One pre-filed major defect, fixed without restarting the host broker (the developer has no
machine access this session).

## The defect

`.claude/mcp/vice/install-resources.ts`'s `statusForEntry()` classifies each deployed file as
`missing` | `present` (byte-identical) | `diverged` (exists, differs). Without `force`,
`installResources()` copied only `missing` entries — `present` was skipped and `diverged` was
refused and merely reported. Once `resources/` moved forward, every deployed file went
`diverged`, and the default install became a silent no-op for exactly the files that most needed
updating. This is the documented root cause of the host running an 11-hour-stale broker: CR-01's
cross-session-kill fix was sealed in the tree but absent from the running process, while the
install path reported success-shaped output (`failed: []`) having deployed nothing.

The refusal was defensible in general ("don't clobber a local edit") but wrong for this
directory specifically: CLAUDE.md's `.claude/mcp/` contract states `resources/`'s generated half
and all of `tools/` are "never hand-edited". If nothing may be hand-edited there, `diverged`
cannot mean "a local edit worth protecting" for a generated artifact — it can only mean stale.

## The fix (`.claude/mcp/vice/install-resources.ts`)

Added `isGeneratedEntry(entry)`, which checks whether `entry` is a member of `build.ts`'s
`HOST_BOUND_ARTIFACTS` — the array `build()` itself throws against if the compiler's real output
ever differs from it, and which `resources-sync.test.ts` independently keeps in sync with
committed `resources/`. This makes the generated/hand-authored distinction derive from an
already-enforced source of truth rather than a second hardcoded filename: a maintainer who adds
a new compiled artifact must already extend `HOST_BOUND_ARTIFACTS` for `build()` to succeed, so
this check cannot silently drift out of sync with reality without also breaking the build.

**New default behavior in `installResources()`, without `force`:**
- `missing` → copied (unchanged).
- `present` → skipped (unchanged).
- `diverged` + generated (member of `HOST_BOUND_ARTIFACTS`) → **overwritten automatically**
  (new). Staleness is the only thing divergence can mean for it. Logged via a `note:`-prefixed
  line naming the entry and why.
- `diverged` + NOT generated (the one hand-authored survivor, `resources/vice-launcher.sh`) →
  **still refused**, exactly as before, but now with a loud per-entry `warn:` line, plus (new) a
  count-carrying summary line after the copy loop — `"N hand-authored entrie(s) refused
  (diverged, no force): [...]"` — so a refused divergence can never again read as silent success
  the way `diverged: [6 files]` alongside `installed: []` / `failed: []` did before this fix.
- `force: true` is unchanged — it still overwrites everything, hand-authored included.

**Disclosed limitation (autonomy contract):** `isGeneratedEntry()` is a closed-list check against
`HOST_BOUND_ARTIFACTS`, not a check of the generated-file banner's actual text
(`build.ts`'s `GENERATED_BANNER()`). A hypothetical future `resources/` entry that is
hand-authored but happens to share a relative path with something `tsc` emits would be
misclassified as generated — there is no such collision today, and the one real hand-authored
survivor (`vice-launcher.sh`) is a `.sh` file, so it cannot collide with the `.mjs`-only compiled
set by construction. A more robust version would additionally require the source file's content
to start with the `GENERATED_BANNER()` prefix; left as a documented follow-up rather than done
here, to avoid introducing a second, independently-driftable banner check in the same fix.

## Automatic invocation path (fix-direction item 4)

`repo-root.ts` wires `ensureResourcesInstalled({ root: repoRoot() })` at module-body scope, fired
once per process the first time any skill `.mjs` entry point runs. It calls
`installResources({ root })` with no `force` — i.e. it goes through exactly the default path this
fix changes. No change was needed in `repo-root.ts` itself: the automatic path inherits the fix
for free once `installResources()`'s own default behavior is corrected. This confirms the defect's
suspicion that the automatic path had been silently no-op'ing on every stale artifact since the
first divergence, with nobody having skipped a step.

## Tests added/changed (`.claude/mcp/vice/install-resources.test.ts`)

- Retargeted the old "no-overwrite-when-diverged" test from `vice-broker.mjs` (a generated
  artifact, whose behavior this fix intentionally changes) to `vice-launcher.sh` (the hand-authored
  entry) — asserts it is still refused, left byte-for-byte unchanged, and that both the per-entry
  and the count-carrying summary warnings fire.
- Added a new test: a diverged `vice-broker.mjs` (generated) is overwritten by default with no
  `force`, restoring the exact `resources/` content, with the auto-refresh logged.
- Added a new test: `force: true` still overwrites a diverged `vice-launcher.sh` (hand-authored)
  too — confirms force is unchanged and strips protection from the hand-authored entry exactly as
  before this fix.
- Kept the existing `force: true` / `vice-broker.mjs` test as a regression guard for the
  generated-artifact force path.
- All four tests drive a synthetic `mkdtempSync` temp root, never the real `tools/`.

## Verification

- `npm ci --prefix .claude/mcp/vice` — run first, against the correct **worktree** copy of
  `.claude/mcp/vice` (an initial `cd`-based invocation accidentally targeted the shared checkout
  instead of the worktree; caught and re-run correctly before any edit).
- `npx tsc --noEmit -p .claude/mcp/vice/tsconfig.json` (via `npm run typecheck`) — clean.
- `.claude/mcp/vice/resources/` diff: **empty, correctly** — this fix only touches authored
  `install-resources.ts` / `install-resources.test.ts`, neither of which compiles into
  `resources/`. Confirmed with `git status --short` / `git diff --stat` before and after the
  commit: no output.
- `install-resources.test.ts` run in isolation first: 22/22 pass, including all 4
  new/retargeted tests.
- **Full suite, run in the foreground, three times in a row** (`npm test` = `node --test
  '*.test.*'` from `.claude/mcp/vice/`):
  - Run 1: `tests 446 / pass 441 / fail 0 / cancelled 0 / todo 5`
  - Run 2: `tests 446 / pass 441 / fail 0 / cancelled 0 / todo 5`
  - Run 3: `tests 446 / pass 441 / fail 0 / cancelled 0 / todo 5`
  - Documented baseline was `444 / 439 / 0 fail / 5 todo`. This task's net test-count change is
    +2 (4 tests added/retargeted in the diverged/force block, 2 of which replace/extend the prior
    2 tests in that block) — `444 + 2 = 446`, `439 + 2 = 441`, matching all three runs exactly.
    `0 fail` and `5 todo` preserved in every run.

## Broker safety

`vice_recycle` was never called against the real host broker. `tools/` (the real deployment
target) was never touched or written to by any test — every test drives a synthetic temp root.
The running host broker and its warm spares were not restarted, killed, or recycled at any point
in this task.

## Commits

- `e2304f1` — `fix(260805): overwrite a stale generated resource by default in installResources()`
