---
phase: quick-260730-oga
plan: 01
subsystem: infra
tags: [vice, mcp, skill-packaging, repo-root-resolution, node-test]

requires:
  - phase: quick-260730-nh5
    provides: the VICE session/pool layer (vice.mjs, vice-pool.mjs, vice-session.mjs) and its vice-session skill, still living split across tools/ and .claude/skills/vice-session/ at the start of this plan
provides:
  - vice-session skill directory that is fully self-contained on the container side (vice.mjs, vice-pool.mjs, vice-session.mjs, vice-pool.test.mjs, repo-root.mjs, SKILL.md)
  - repo-root.mjs: a single shared repoRoot()/supervisorDir() resolver (env-containment -> .git walk -> non-containing env -> three-levels-up), replacing three copies of a now-wrong fixed ".." hop
  - --print-paths on both tools/vice-supervisor.sh and tools/vice-pool.sh, so the shell side's resolved .vice-supervisor directory can be checked without side effects
  - an automated test proving the Node side and the shell side agree on .vice-supervisor, so a future path drift fails loudly instead of silently
affects: [vice-session, tools/recover.mjs, any future skill-export tooling]

tech-stack:
  added: []
  patterns:
    - "One shared repo-root resolver per skill directory (repo-root.mjs), rather than each module deriving its own relative-to-self path -- mirrors devcontainer-host-path/hostpath.mjs's three-levels-up shape as the last-resort fallback."
    - "Host-only shell scripts hoist their directory-default assignment above the container guard so a read-only --print-paths flag can report it without duplicating the default or triggering the guard."

key-files:
  created:
    - .claude/skills/vice-session/repo-root.mjs
  modified:
    - .claude/skills/vice-session/vice.mjs
    - .claude/skills/vice-session/vice-pool.mjs
    - .claude/skills/vice-session/vice-session.mjs
    - .claude/skills/vice-session/vice-pool.test.mjs
    - .claude/skills/vice-session/SKILL.md
    - tools/recover.mjs
    - tools/recover.test.mjs
    - tools/vice-supervisor.sh
    - tools/vice-pool.sh
    - tools/README.md

key-decisions:
  - "Moved tools/vice.mjs, vice-pool.mjs, vice-session.mjs and vice-pool.test.mjs into .claude/skills/vice-session/ via git mv, preserving history, so the skill matches every other skill's self-contained pattern."
  - "Created repo-root.mjs as the one shared resolver instead of just re-deriving each module's own relative hop count -- a single definition of both 'repo root' and 'the .vice-supervisor name' that all three modules and the shell scripts can be checked against."
  - "Kept tools/vice-supervisor.sh, tools/vice-pool.sh, tools/lib/container-guard.sh and tools/recover.mjs in tools/ -- host-only launchers and the one file that already had an established cross-tree import precedent (hostpath.mjs) stayed put; only the container-side client modules moved."
  - "Added --print-paths to both shell scripts, handled before the container guard (writes no state, spawns nothing), so the path-agreement test can check the shell side's real resolved value without needing VICE_SUPERVISOR_ALLOW_CONTAINER=1 or a live x64sc."

patterns-established:
  - "repoRoot({from, env}) ladder: CONTAINER_WORKSPACE_PATH (if it contains `from`) -> nearest .git ancestor -> CONTAINER_WORKSPACE_PATH anyway (with a one-time stderr note) -> three levels up (with a one-time stderr note). Pure w.r.t. its arguments, so it is unit-testable with mkdtempSync fixtures with no process.env mutation."

requirements-completed: [D-1, D-2, D-3, D-4, D-5, D-6]

coverage:
  - id: D1
    description: "vice-session skill directory is self-contained (own Node modules, own tests) and exportable as a unit"
    requirement: "D-1"
    verification:
      - kind: unit
        ref: ".claude/skills/vice-session/vice-pool.test.mjs -- all 63 tests (60 pre-existing + 3 new)"
        status: pass
      - kind: other
        ref: "git status --porcelain shows exactly 4 R (rename) entries for the moved files"
        status: pass
    human_judgment: false
  - id: D2
    description: "Node side and shell side compute the byte-identical .vice-supervisor directory; a test fails loudly if they ever disagree"
    requirement: "D-2, D-3"
    verification:
      - kind: unit
        ref: ".claude/skills/vice-session/vice-pool.test.mjs#path agreement (D-3, THE regression this task exists to catch)"
        status: pass
      - kind: other
        ref: "bash tools/vice-supervisor.sh --print-paths and bash tools/vice-pool.sh --print-paths both report /workspaces/bruce_lee/.vice-supervisor"
        status: pass
    human_judgment: false
  - id: D3
    description: "repo-root resolution survives the modules sitting two directories deeper, and survives no CONTAINER_WORKSPACE_PATH being set"
    requirement: "D-2"
    verification:
      - kind: unit
        ref: ".claude/skills/vice-session/vice-pool.test.mjs#repoRoot() ladder: a .git ancestor resolves with no env set; ..."
        status: pass
    human_judgment: false
  - id: D4
    description: "Every command a human or agent is told to run names a path that exists after the move (SKILL.md, tools/README.md, error strings)"
    requirement: "D-4"
    verification:
      - kind: other
        ref: "! grep -rn 'node tools/vice' tools/README.md .claude/skills/vice-session/ tools/vice-supervisor.sh tools/vice-pool.sh"
        status: pass
      - kind: unit
        ref: "node .claude/skills/vice-session/vice.mjs | grep -q 'port 6510'; dead-endpoint ping names tools/vice-supervisor.sh on the HOST"
        status: pass
    human_judgment: false
  - id: D5
    description: "SKILL.md states plainly that the host-side shell launchers stay in tools/ and must travel with the skill"
    requirement: "D-5"
    verification:
      - kind: other
        ref: ".claude/skills/vice-session/SKILL.md#Self-contained for the container side only"
        status: pass
    human_judgment: false
  - id: D6
    description: "No behaviour changed: deny-list, retry semantics, session/lease/TTL rules, and the port-6510 zero-configuration fallback are all as before"
    requirement: "D-6"
    verification:
      - kind: unit
        ref: "node --test .claude/skills/vice-session/vice-pool.test.mjs tools/recover.test.mjs -- all 60 pre-existing tests pass unchanged"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-07-30
status: complete
---

# Quick Task 260730-oga: Move VICE Node modules into the vice-session skill Summary

**Moved the three VICE Node modules and their test file from `tools/` into `.claude/skills/vice-session/` with `git mv`, and replaced their fixed `".."` repo-root derivation with one shared `repo-root.mjs` resolver — proven, by a new automated test, to agree byte-for-byte with what the host-side shell scripts compute.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-07-30T17:20Z (approx.)
- **Completed:** 2026-07-30T18:00Z (approx.)
- **Tasks:** 3
- **Files modified:** 11 (4 renamed, 1 created, 6 modified)

## Accomplishments
- `vice.mjs`, `vice-pool.mjs`, `vice-session.mjs` and `vice-pool.test.mjs` now live in `.claude/skills/vice-session/`, tracked as git renames (history preserved), matching the self-contained-skill pattern every other skill in this project already follows.
- New `repo-root.mjs` is the single shared place `EPOCH_FILE`, `poolDir()` and `sessionFilePath()` all resolve the repo root through — replacing three copies of a fixed `".."` hop that would have silently pointed at `.claude/skills/.vice-supervisor` after a naive move, with no error anywhere.
- `tools/vice-supervisor.sh` and `tools/vice-pool.sh` both gained a `--print-paths` flag (handled before the container guard, no side effects), and a new test proves the Node side and the shell side land on the exact same `.vice-supervisor` directory — the regression this whole plan exists to prevent.
- Every live reference to the old `tools/vice*.mjs` paths — SKILL.md, `tools/README.md`, runtime error strings, shell-script prose and echo lines — now names a path that actually exists after the move.

## Task Commits

Each task was committed atomically:

1. **Task 1: Move the four modules and make repo-root resolution survive the move** - `d954066` (refactor)
2. **Task 2: Prove the Node side and the shell side compute the same directory** - `a719aab` (test)
3. **Task 3: Repoint every live reference and state the export caveat** - `c31b07d` (docs)

_No separate plan-metadata commit was made for this quick task per the orchestrator's constraints — STATE.md and the final docs commit are handled by the orchestrator._

## Files Created/Modified
- `.claude/skills/vice-session/repo-root.mjs` - new shared `repoRoot()`/`supervisorDir()` resolver
- `.claude/skills/vice-session/vice.mjs` (moved from `tools/`) - `EPOCH_FILE` now derived via `supervisorDir()`
- `.claude/skills/vice-session/vice-pool.mjs` (moved from `tools/`) - `poolDir()` now derived via `supervisorDir()`
- `.claude/skills/vice-session/vice-session.mjs` (moved from `tools/`) - `sessionFilePath()` now derived via `supervisorDir()`; recovery error strings repointed
- `.claude/skills/vice-session/vice-pool.test.mjs` (moved from `tools/`) - added the path-agreement test, the `repoRoot()` ladder test, and a no-configuration CLI usage-output test
- `.claude/skills/vice-session/SKILL.md` - every command example repointed to the full path; new "Self-contained for the container side only" section
- `tools/recover.mjs` / `tools/recover.test.mjs` - imports repointed to the moved modules' new cross-tree path
- `tools/vice-supervisor.sh` / `tools/vice-pool.sh` - `--print-paths` flag added; prose and echo lines repointed
- `tools/README.md` - invocation examples, markdown links, and a new layout note

## Decisions Made
- Only the container-side client modules moved; the host-only launchers (`tools/vice-supervisor.sh`, `tools/vice-pool.sh`, `tools/lib/container-guard.sh`) and `tools/recover.mjs`/`tools/recover.test.mjs` stayed in `tools/` — the plan's explicit scope, and consistent with "a skill is invoked by an agent inside the container; launching x64sc is a host operation with no in-container analogue."
- `repo-root.mjs` implements the four-step precedence ladder exactly as specified: `CONTAINER_WORKSPACE_PATH` (if it contains the caller) → nearest `.git` ancestor → `CONTAINER_WORKSPACE_PATH` anyway (with a one-time stderr note) → three levels up (with a one-time stderr note). No fourth env knob was added for the repo root itself, per the plan's explicit instruction.

## Deviations from Plan

None - plan executed exactly as written. All three tasks completed with their exact `<verify>` commands passing, including the ~50s dead-endpoint reconnect-ladder check in Task 3, which is expected behaviour (the live VICE endpoint is down per STATE.md), not a bug.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The `vice-session` skill can now be copied into another project as a self-contained unit (with the caveat, documented in its own SKILL.md, that the host-side launchers must travel with it separately).
- All 63 tests (60 pre-existing + 3 new) pass from the new location; no behaviour changed.
- No blockers. The live VICE MCP endpoint is still down (pre-existing, unrelated to this plan) — Task 3's dead-endpoint verify check exercised the existing reconnect/recovery messaging against that real outage.

## Self-Check: PASSED

All created/modified files verified present on disk (`repo-root.mjs`, the four moved modules, `SKILL.md`, both shell scripts, `tools/README.md`, `tools/recover.mjs`/`tools/recover.test.mjs`). All three task commits (`d954066`, `a719aab`, `c31b07d`) verified present in `git log`.

---
*Phase: quick-260730-oga*
*Completed: 2026-07-30*
