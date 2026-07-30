---
phase: quick-260730-q4b
plan: 01
subsystem: infra
tags: [vice, mcp, skill-packaging, repo-root-resolution, node-test, shell]

requires:
  - phase: quick-260730-oga
    provides: the vice-session skill's self-contained container-side Node modules (repo-root.mjs, vice.mjs, vice-pool.mjs, vice-session.mjs, vice-probe.mjs) and its "the host half stays in tools/, copy it alongside" caveat -- the exact caveat this plan removes.
provides:
  - vice-session skill directory now carries BOTH halves of the VICE setup -- resources/{vice-supervisor.sh,vice-pool.sh,lib/container-guard.sh,lib/repo-root.sh} plus the container-side Node modules -- so copying the skill directory alone is sufficient.
  - resources/lib/repo-root.sh's resolve_repo_root(), mirroring repo-root.mjs's ladder, so both shell scripts resolve the identical repo root (and .vice-supervisor directory) from either resources/ or tools/, including with CONTAINER_WORKSPACE_PATH unset (the real host case).
  - install-resources.mjs: RESOURCES_DIR, installTargetDir(), resourceEntries(), resourcesStatus(), installResources(), hostLaunchInstructions(), ensureResourcesInstalled() -- fire-once-per-process deploy-on-first-use, never overwrites, never throws, stderr-only instructions.
  - vice.mjs's new `install [--force]` verb -- per-entry status report by default, forced restore-from-resources/ on request.
  - tools/vice-supervisor.sh, tools/vice-pool.sh, tools/lib/container-guard.sh, tools/lib/repo-root.sh are now gitignored, disposable, auto-regenerated deployment targets -- no longer a second tracked copy that could drift.
affects: [vice-session, tools/recover.mjs, any future skill-export tooling]

tech-stack:
  added: []
  patterns:
    - "Deploy-on-first-use resource installer, triggered from a single side-effect call at the bottom of a shared module (repo-root.mjs) rather than from each entry point individually -- avoids a module cycle by taking the resolved root as an argument instead of importing the resolver back."
    - "Shell-side repo-root resolution factored into one sourced-only lib/repo-root.sh function, mirroring the Node-side repo-root.mjs ladder line for line, so a script's own directory name (resources/ vs tools/) determines the last-resort hop count instead of a fixed relative path."
    - "A pool/supervisor script resolves its own sibling script by its OWN directory, not a fixed tools/ path, so a script run from resources/ never silently reaches across to a possibly-stale deployed copy."

key-files:
  created:
    - .claude/skills/vice-session/resources/vice-supervisor.sh
    - .claude/skills/vice-session/resources/vice-pool.sh
    - .claude/skills/vice-session/resources/lib/container-guard.sh
    - .claude/skills/vice-session/resources/lib/repo-root.sh
    - .claude/skills/vice-session/install-resources.mjs
  modified:
    - .claude/skills/vice-session/repo-root.mjs
    - .claude/skills/vice-session/vice-probe.mjs
    - .claude/skills/vice-session/vice.mjs
    - .claude/skills/vice-session/vice-pool.test.mjs
    - .claude/skills/vice-session/SKILL.md
    - tools/README.md
    - .gitignore

key-decisions:
  - "git mv (not create-and-delete) for all three shell scripts, preserving `git log --follow` history back through tools/."
  - "install-resources.mjs takes the repo root as an ARGUMENT and imports nothing from repo-root.mjs, specifically to avoid the module-cycle TDZ crash ('Cannot access HERE before initialization') a naive back-import would cause."
  - "vice-pool.sh's SUPERVISOR_SCRIPT resolves as a sibling of the running script, not a fixed $REPO_ROOT/tools/ path -- a pool started from resources/ must supervise with the resources/ copy."
  - "The automatic deploy path never overwrites present or diverged targets; only the human-invoked `install --force` does. Bare `install` is a pure status report and writes nothing."
  - "install-resources.mjs's default log is console.error and it never writes to stdout, so tools --json / pool status stay machine-parseable regardless of what the installer does."

patterns-established:
  - "resolve_repo_root(from) (shell) / repoRoot({from}) (Node): CONTAINER_WORKSPACE_PATH (if it contains `from`) -> nearest .git ancestor -> CONTAINER_WORKSPACE_PATH anyway (one-time stderr note) -> location-shaped last resort (one-time stderr note), kept in sync across both languages."

requirements-completed: [D-1, D-2, D-3, D-4, D-5, D-6, D-7, D-8]

coverage:
  - id: D1
    description: "vice-session skill carries both halves of the VICE setup -- copying the skill directory alone is sufficient; no separate 'also copy these three files' step"
    requirement: "D-1"
    verification:
      - kind: unit
        ref: ".claude/skills/vice-session/vice-pool.test.mjs -- all 98 tests (88 pre-existing/extended + 10 new)"
        status: pass
      - kind: other
        ref: "git ls-files .claude/skills/vice-session/resources/ lists all four shell files; git log --follow on each reaches its tools/ history"
        status: pass
    human_judgment: false
  - id: D2
    description: "Exactly one tracked copy of each shell script; the three tools/ paths are absent from git ls-files, matched by git check-ignore, and still present+executable on disk"
    requirement: "D-2"
    verification:
      - kind: other
        ref: "git ls-files tools/vice-supervisor.sh tools/vice-pool.sh tools/lib/container-guard.sh (empty); git check-ignore -q per file (all three ignored); ls -l shows exec bits intact"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every skill .mjs entry point checks deployment once per process, cheaply, and a failed deployment warns and continues rather than breaking the caller"
    requirement: "D-3"
    verification:
      - kind: unit
        ref: ".claude/skills/vice-session/vice-pool.test.mjs#ensureResourcesInstalled(): fire-once-per-process ...; #installResources(): never throws when the target root is unwritable ..."
        status: pass
      - kind: other
        ref: "node --input-type=module -e \"await import(...)\" for repo-root.mjs, vice.mjs, vice-pool.mjs, vice-session.mjs, vice-probe.mjs -- all five succeed"
        status: pass
    human_judgment: false
  - id: D4
    description: "A real deployment explains the host launch (host path, container refusal, --check-container, Ctrl-C) on stderr, and writes nothing to stdout"
    requirement: "D-4"
    verification:
      - kind: unit
        ref: ".claude/skills/vice-session/vice-pool.test.mjs#installResources(): a real install writes its host-launch instructions to stderr only, never stdout (D-4)"
        status: pass
      - kind: other
        ref: "child-process install against a temp root: /tmp/q4b.out empty, /tmp/q4b.err names the container refusal, --check-container and Ctrl-C"
        status: pass
    human_judgment: false
  - id: D5
    description: "An already-present or diverged deployed script is never overwritten automatically; install --force is the only overwrite path, and bare install reports divergence"
    requirement: "D-5"
    verification:
      - kind: unit
        ref: ".claude/skills/vice-session/vice-pool.test.mjs#installResources(): no-overwrite-when-diverged ...; #installResources({ force: true }): restores a diverged target ..."
        status: pass
      - kind: other
        ref: "node .claude/skills/vice-session/vice.mjs install prints per-entry status and writes nothing (verified via git status --porcelain on the three deployed paths)"
        status: pass
    human_judgment: false
  - id: D6
    description: "--print-paths agrees between resources/ and tools/ for both scripts, with and without CONTAINER_WORKSPACE_PATH, and still agrees with repo-root.mjs"
    requirement: "D-6"
    verification:
      - kind: unit
        ref: ".claude/skills/vice-session/vice-pool.test.mjs#path agreement (D-3, D-6, THE regression this task exists to catch) ...; #path agreement without CONTAINER_WORKSPACE_PATH (D-6) ..."
        status: pass
      - kind: other
        ref: "diff of --print-paths output between resources/ and tools/ copies of both scripts: byte-identical"
        status: pass
    human_judgment: false
  - id: D7
    description: "All 87 pre-existing tests still pass, plus ten new cases, with no test run mutating the real repo's tools/"
    requirement: "D-7"
    verification:
      - kind: unit
        ref: "node --test .claude/skills/vice-session/vice-pool.test.mjs tools/recover.test.mjs -- pass 98, fail 0"
        status: pass
      - kind: other
        ref: "git status --porcelain tools/ .claude/skills/vice-session/resources/ empty after the full suite run"
        status: pass
    human_judgment: false
  - id: D8
    description: "Container guard still refuses (exit 2) and reports (exit 3) from both script locations; DENY_LIST/serverInfo() untouched; SKILL.md and tools/README.md describe the new arrangement"
    requirement: "D-8"
    verification:
      - kind: other
        ref: "vice-pool.sh status exits 2 from both resources/ and tools/; vice-supervisor.sh --check-container exits 3; grep confirms SKILL.md/tools/README.md reference resources/ and the install verb"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-07-30
status: complete
---

# Quick Task 260730-q4b: Move shell scripts to skill resources/, deploy automatically Summary

**Relocated `vice-supervisor.sh`, `vice-pool.sh` and `container-guard.sh` into the `vice-session` skill's `resources/`, added a shared `resources/lib/repo-root.sh` so both scripts resolve the same repo root from either location, and made every skill `.mjs` entry point deploy them into a now-gitignored `tools/` automatically on first use via a new `install-resources.mjs`.**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-07-30T18:57Z (approx.)
- **Completed:** 2026-07-30T19:23Z (approx.)
- **Tasks:** 3
- **Files modified:** 12 (3 renamed, 6 created, 5 modified — one file, `vice-pool.test.mjs`, counted in both created-content and modified since it received a large extension)

## Accomplishments
- `vice-supervisor.sh`, `vice-pool.sh` and `lib/container-guard.sh` now live tracked in `.claude/skills/vice-session/resources/` (`git mv`, history preserved via `git log --follow`), with the tracked `tools/` copies removed and gitignored deployed copies restored on disk so the host's existing setup keeps working untouched.
- New `resources/lib/repo-root.sh` mirrors `repo-root.mjs`'s ladder in shell, so both scripts resolve the identical repo root — and the identical `.vice-supervisor` directory — from either `resources/` or `tools/`, including with `CONTAINER_WORKSPACE_PATH` unset (the real host situation). `vice-pool.sh`'s `SUPERVISOR_SCRIPT` now resolves as a sibling of the running script rather than a fixed `tools/` path.
- New `install-resources.mjs` deploys `resources/` into `<root>/tools/` the first time any skill `.mjs` file runs, fired once per process from a single trigger at the bottom of `repo-root.mjs`. Never overwrites an existing target automatically, never throws, writes its host-launch instructions to stderr only, and respects `VICE_SKIP_RESOURCE_INSTALL=1` as a full opt-out.
- `vice.mjs` gained an `install [--force]` verb: bare `install` reports per-entry status (missing/present/diverged) with no side effects; `install --force` is the only path that restores a hand-edited or diverged deployed copy from `resources/`.
- Extended the path-agreement test to cover all four script copies plus a no-`CONTAINER_WORKSPACE_PATH` case, and added ten new tests for the installer's full behavior contract. Full suite: 98/98 passing (88 extended/pre-existing + 10 new).
- `SKILL.md` and `tools/README.md` rewritten to describe the new arrangement — no document still tells an exporter to "copy the shell scripts alongside" or claims the second tracked copy "deliberately stayed here".

## Task Commits

Each task was committed atomically:

1. **Task 1: Relocate the scripts and make repo-root resolution work from either location** - `4c1bec8` (feat)
2. **Task 2: Deploy on any entry point — install-resources.mjs, the trigger, and the install verb** - `b1f49fd` (feat)
3. **Task 3: Correct the two documents this change invalidates** - `e01531b` (docs)

_No separate plan-metadata commit was made for this quick task per the orchestrator's constraints — STATE.md and the final docs commit are handled by the orchestrator._

## Files Created/Modified
- `.claude/skills/vice-session/resources/vice-supervisor.sh` (moved from `tools/`) - repo-root resolution via `resolve_repo_root()`, `SELF_DIR`-relative guard sourcing, header/usage text updated for either-location operation
- `.claude/skills/vice-session/resources/vice-pool.sh` (moved from `tools/`) - same repo-root change; `SUPERVISOR_SCRIPT` now a sibling resolution instead of a fixed `tools/` path
- `.claude/skills/vice-session/resources/lib/container-guard.sh` (moved from `tools/lib/`) - unchanged content, new location
- `.claude/skills/vice-session/resources/lib/repo-root.sh` - new: `resolve_repo_root()`, the shell mirror of `repo-root.mjs`'s ladder
- `.claude/skills/vice-session/install-resources.mjs` - new: `RESOURCES_DIR`, `installTargetDir()`, `resourceEntries()`, `resourcesStatus()`, `installResources()`, `hostLaunchInstructions()`, `ensureResourcesInstalled()`
- `.claude/skills/vice-session/repo-root.mjs` - added the single `ensureResourcesInstalled({ root: repoRoot() })` trigger at the bottom of the module body
- `.claude/skills/vice-session/vice-probe.mjs` - added a side-effect-only `import "./repo-root.mjs"` so the deploy check fires when this is the entry point
- `.claude/skills/vice-session/vice.mjs` - new `install [--force]` verb; added to the `resolveInstance()` skip list and the no-argument usage block
- `.claude/skills/vice-session/vice-pool.test.mjs` - extended the path-agreement test to all four script copies plus a no-`CONTAINER_WORKSPACE_PATH` case; ten new install-resources.mjs tests
- `.claude/skills/vice-session/SKILL.md` - "Self-contained for both halves" section rewritten; pool-commands and troubleshooting rows note the deployment
- `tools/README.md` - Layout note rewritten to describe `resources/` as source of truth and `tools/` as a disposable deployment target
- `.gitignore` - four deployed paths added (`tools/vice-supervisor.sh`, `tools/vice-pool.sh`, `tools/lib/container-guard.sh`, `tools/lib/repo-root.sh`)

## Decisions Made
- `resources/lib/repo-root.sh`'s last-resort branch (no `.git` ancestor, no `CONTAINER_WORKSPACE_PATH`) keys off the script's own directory NAME (`resources` -> four levels up, anything else -> one level up) rather than a fixed hop count, exactly mirroring `repo-root.mjs`'s own last-resort shape.
- `install`'s bare (non-`--force`) form performs zero writes of its own — any genuinely missing file is already handled by the automatic `ensureResourcesInstalled()` trigger that fired when `vice.mjs` was imported, moments before the CLI even parses `argv`. This keeps "report" and "act" strictly separate, matching D-5's letter.
- `installResources({ force: true })` rewrites EVERY entry (missing, present, or diverged) rather than only diverged ones, since a forced call is explicitly "restore from `resources/`, whatever the current state" — simpler and matches "install --force overwrites every entry from resources/".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `git check-ignore -q` with multiple pathnames is rejected by this git version**
- **Found during:** Task 1's own verification pass
- **Issue:** The plan's verify command `git check-ignore -q tools/vice-supervisor.sh tools/vice-pool.sh tools/lib/container-guard.sh` fails with `fatal: --quiet is only valid with a single pathname` under the container's git 2.55.0 — `-q` only accepts one path at a time on this version.
- **Fix:** Verified equivalent intent with a per-file loop (`for f in ...; do git check-ignore -q "$f"; done`), confirming all three paths are individually ignored. No repository files needed changing; this only affected how I ran my own verification, not the plan's deliverables.
- **Files modified:** none (verification-only workaround)
- **Verification:** Ran the per-file loop; all three report ignored.

---

**Total deviations:** 1 auto-fixed (Rule 3, verification tooling only)
**Impact on plan:** No scope creep — the plan's own deliverables and `<verify>` intent were fully satisfied; only the literal multi-path `git check-ignore -q` invocation needed a per-file substitute due to a git version difference.

## Issues Encountered
None beyond the git version quirk documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The `vice-session` skill can now be copied into another project as a single self-contained unit — no separate "also copy these three shell files" step remains anywhere in its own documentation.
- All 98 tests pass (88 extended/pre-existing + 10 new); the full plan `<verification>` script ran end-to-end successfully, including the D-3/D-4/D-5 temp-root install checks and the D-7 clean-`git status` check on `tools/` and `resources/`.
- No blockers. The live VICE MCP endpoint remains down (pre-existing, unrelated to this plan) — nothing in this plan touched the emulator; no `vice_*` call was made, and `vice_disk_list` was never invoked, named, or tested against.

## Self-Check: PASSED

All created files verified present on disk (`resources/vice-supervisor.sh`, `resources/vice-pool.sh`, `resources/lib/container-guard.sh`, `resources/lib/repo-root.sh`, `install-resources.mjs`). All three task commits (`4c1bec8`, `b1f49fd`, `e01531b`) verified present in `git log`. The three legacy `tools/` paths verified absent from `git ls-files`, matched by `git check-ignore`, and still present+executable on disk.

---
*Phase: quick-260730-q4b*
*Completed: 2026-07-30*
