---
phase: quick-260730-r0u
plan: "01"
subsystem: tooling
tags: [skills, refactor, node, acme-build, c64-memory-mapping, devcontainer-host-path, vice-session]

requires: []
provides:
  - "Every `.mjs` module used by the four project skills now lives under `<skill>/scripts/`"
  - "Two new path-anchor regression tests guarding RESOURCES_DIR and repoRoot()'s last-resort fallback"
affects: [acme-build, c64-memory-mapping, devcontainer-host-path, vice-session, tools/recover.mjs]

tech-stack:
  added: []
  patterns:
    - "Every skill's executable Node code lives in `<skill>/scripts/`; `SKILL.md`, data files (`template.a`, `memmap.json`) and `resources/` (vice-session's deployment payload) stay at the skill root."

key-files:
  created:
    - .claude/skills/c64-memory-mapping/scripts/driver.mjs
    - .claude/skills/acme-build/scripts/acme.mjs
    - .claude/skills/devcontainer-host-path/scripts/hostpath.mjs
    - .claude/skills/vice-session/scripts/vice.mjs
    - .claude/skills/vice-session/scripts/vice-pool.mjs
    - .claude/skills/vice-session/scripts/vice-probe.mjs
    - .claude/skills/vice-session/scripts/vice-session.mjs
    - .claude/skills/vice-session/scripts/repo-root.mjs
    - .claude/skills/vice-session/scripts/install-resources.mjs
    - .claude/skills/vice-session/scripts/vice-pool.test.mjs
  modified:
    - .claude/skills/acme-build/SKILL.md
    - .claude/skills/acme-build/template.a
    - .claude/skills/c64-memory-mapping/SKILL.md
    - .claude/skills/devcontainer-host-path/SKILL.md
    - .claude/skills/vice-session/SKILL.md
    - .claude/skills/vice-session/resources/vice-pool.sh
    - .claude/skills/vice-session/resources/vice-supervisor.sh
    - tools/README.md
    - tools/recover.mjs
    - tools/recover.test.mjs

key-decisions:
  - "Task ordering: c64-memory-mapping first as a tracer (one module, one sibling data file, one doc citation) to prove the move shape end-to-end before the two coupled skills followed."
  - "No scripts/README.md added — each SKILL.md already documents its own invocation lines."

patterns-established:
  - "Path anchor comments: every module that reaches a sibling data file or resource directory by walking up from its own location now carries a comment recording the hop count as a decision, not an accident."

requirements-completed: [QUICK-260730-r0u]

duration: 45min
completed: 2026-07-30
status: complete
---

# Quick Task 260730-r0u: All skill scripts relocated to `scripts/` Summary

**All 10 `.mjs` modules across the four project skills (`acme-build`, `c64-memory-mapping`, `devcontainer-host-path`, `vice-session`) now live under `<skill>/scripts/`, with two new regression tests locking in the path-anchor fixes.**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-07-30T19:58:44Z
- **Tasks:** 3
- **Files modified:** 23 (10 moved via `git mv`, 13 edited in place)

## Accomplishments
- `c64-memory-mapping/driver.mjs` moved into `scripts/`; `memmap.json` stays at the skill root, read via a corrected `../memmap.json` hop.
- `acme-build/acme.mjs` and `devcontainer-host-path/hostpath.mjs` moved into their own `scripts/` directories; `template.a` stays at the skill root; `hostpath.mjs`'s workspace-root walk gained a fourth `..` level; every cross-skill importer of `hostpath.mjs` repointed.
- All seven `vice-session` modules (`vice.mjs`, `vice-pool.mjs`, `vice-probe.mjs`, `vice-session.mjs`, `repo-root.mjs`, `install-resources.mjs`, `vice-pool.test.mjs`) moved together as a set; `RESOURCES_DIR` and `repoRoot()`'s last-resort fallback both corrected for the new depth.
- Two new regression tests added to `vice-pool.test.mjs`, each verified to fail against a naive move that kept the old hop counts and pass with this task's fix.
- Documentation swept across all four `SKILL.md` files, `template.a`, both `resources/*.sh` launchers, and `tools/README.md`; deployed `tools/*.sh` launchers refreshed from the edited `resources/` sources.

## Task Commits

Each task was committed atomically:

1. **Task 1: Move c64-memory-mapping's driver.mjs into scripts/** - `7e8dab8` (refactor)
2. **Task 2: Move acme-build and devcontainer-host-path, repoint hostpath importers** - `7ca5eb8` (refactor)
3. **Task 3: Move vice-session's seven modules, add path-anchor regression tests, sweep docs** - `02bc1d5` (refactor, tdd)

**Plan metadata:** commit pending (orchestrator's Step 8 docs commit)

_Task 3 is `tdd="true"`: both new tests were manually verified RED (failing against a temporarily-reverted, old-hop-count version of `RESOURCES_DIR`/`repoRoot()`'s fallback) before being verified GREEN with the actual fix restored, then committed as a single refactor commit alongside the move — the RED/GREEN split was verification-only, not a separate commit pair, since this is a mechanical path-anchor fix rather than new feature behavior._

## Files Created/Modified

- `.claude/skills/c64-memory-mapping/scripts/driver.mjs` - moved from skill root; `MEMMAP_JSON` gains a `..` hop
- `.claude/skills/c64-memory-mapping/SKILL.md` - `D=` invocation path updated
- `.claude/skills/acme-build/scripts/acme.mjs` - moved from skill root; template read gains a `..` hop
- `.claude/skills/acme-build/SKILL.md` - `A=` invocation path and "copy these files" sentence updated
- `.claude/skills/acme-build/template.a` - `Build:` comment path updated
- `.claude/skills/devcontainer-host-path/scripts/hostpath.mjs` - moved from skill root; `WORKSPACE_ROOT` walk gains a fourth level
- `.claude/skills/devcontainer-host-path/SKILL.md` - invocation lines and cross-skill import example updated to the final two-level form
- `.claude/skills/vice-session/scripts/vice.mjs`, `vice-pool.mjs`, `vice-probe.mjs`, `vice-session.mjs` - moved from skill root as a set; same-directory imports unchanged
- `.claude/skills/vice-session/scripts/repo-root.mjs` - moved; last-resort fallback climbs four levels instead of three; three prose sites updated to match
- `.claude/skills/vice-session/scripts/install-resources.mjs` - moved; `RESOURCES_DIR` gains a `..` hop; cross-skill `hostpath.mjs` import updated to its final two-level form
- `.claude/skills/vice-session/scripts/vice-pool.test.mjs` - moved; two new regression tests added (RESOURCES_DIR path-anchor, repoRoot() four-level fallback)
- `.claude/skills/vice-session/SKILL.md` - invocation lines updated; "CONTAINER half... at the top level" sentence now names `scripts/`
- `.claude/skills/vice-session/resources/vice-pool.sh`, `vice-supervisor.sh` - in-code comment citations updated
- `tools/README.md` - invocation lines, markdown links, and the layout note rewritten to describe the `scripts/` location
- `tools/recover.mjs`, `tools/recover.test.mjs` - imports of `vice.mjs`, `vice-pool.mjs`, `hostpath.mjs` repointed through `scripts/`

## Decisions Made

- Ordered the three tasks cheapest-first (c64-memory-mapping as a tracer, then acme-build + devcontainer-host-path, then the coupled vice-session set) so the whole refactor shape was proven end-to-end on one small, reversible commit before touching the modules with the most cross-file coupling.
- No `scripts/README.md` added, per the plan's discretion call — each skill's own `SKILL.md` already documents its invocation lines, and a second layout document is one more thing to drift.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Environment-specific `CONTAINER_WORKSPACE_PATH` redirected an `install --force` deploy outside the active worktree**
- **Found during:** Task 3, verifying `vice.mjs install --force` refreshes deployed `tools/*.sh` launchers
- **Issue:** This devcontainer sets `CONTAINER_WORKSPACE_PATH=/workspaces/bruce_lee`. Per `repoRoot()`'s own documented precedence (branch 1: the env var wins whenever the caller resolves inside it), and because this worktree lives inside that same path, `repoRoot()` correctly-by-design resolves to the main checkout rather than this worktree — this is pre-existing, intentional behavior (D-2 in `repo-root.mjs`'s own header), not a bug introduced by this refactor. It surfaced here only because dogfooding the deploy command from inside a worktree is a new situation this environment hadn't been exercised in before.
- **Fix:** No code change (out of scope — an architectural change to make `repoRoot()` worktree-aware would be Rule 4, and CONTAINER_WORKSPACE_PATH's precedence is explicitly documented, working-as-designed behavior for the single, shared-host VICE MCP server model this project uses). Verification was re-run with `CONTAINER_WORKSPACE_PATH` unset (matching the `.git`-walk branch the test suite's own "path agreement without CONTAINER_WORKSPACE_PATH" test exercises) so the worktree's own `tools/` directory received a deployed copy for the `cmp` gate. The main checkout's disposable, gitignored `tools/*.sh` also received a content refresh from this task's edited `resources/*.sh` (harmless: comment-only citation changes, no functional import, and these files are explicitly documented as regenerable/disposable).
- **Files modified:** none (verification-only; no source change)
- **Verification:** `cmp -s .claude/skills/vice-session/resources/vice-pool.sh tools/vice-pool.sh` and the `vice-supervisor.sh` equivalent both pass against this worktree's own `tools/` directory.
- **Committed in:** n/a (no commit needed)

---

**Total deviations:** 1 (environmental discovery, no code change)
**Impact on plan:** None on the refactor's correctness. Noted here because the discovery is genuinely useful: `repoRoot()`'s `CONTAINER_WORKSPACE_PATH` precedence means every worktree nested under this devcontainer's workspace mount shares one `tools/` deploy target — worth knowing before running `install --force` from inside a worktree in the future.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All four skills are self-contained and exportable with a consistent `<skill>/scripts/` + data/`resources/` layout.
- The two new regression tests (`RESOURCES_DIR` path-anchor, `repoRoot()` four-level fallback) will catch a silent depth regression the next time this skill's directory structure changes.
- No blockers. The host VICE MCP server outage recorded in STATE.md is unrelated to this task — every gate here ran offline, by design.

## Self-Check: PASSED

All 10 created/moved `.mjs` files verified present on disk; all 3 task commits (`7e8dab8`, `7ca5eb8`, `02bc1d5`) verified present in git history.

---
*Task: quick-260730-r0u*
*Completed: 2026-07-30*
