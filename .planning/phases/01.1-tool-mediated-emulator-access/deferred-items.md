# Deferred Items — Phase 01.1

Out-of-scope discoveries logged during plan execution, per the executor's
scope-boundary rule (fix only what the current task's changes directly
caused). Not fixed here; recorded so they are not silently lost.

## Plan 01.1-04 — three pre-existing test failures, not caused by this plan's relocation

Logged during Task 2/Task 3 execution. `node --test '.claude/skills/**/*.test.mjs'
'tools/**/*.test.mjs'` reports 3 failures out of 168 tests, all in
`.claude/skills/vice-mcp-selector/scripts/vice-pool.test.mjs`, none of them
caused by the plan's `git mv` relocation or any edit made in this plan:

1. **`path agreement (D-3, D-6, THE regression this task exists to catch)`** and
   **`path agreement without CONTAINER_WORKSPACE_PATH (D-6)`** — both resolve
   `repoRoot()` and then join `.claude/skills/vice-mcp-selector/resources/...`
   against it, expecting the deployed script to exist there. `repoRoot()`'s own
   documented precedence (see its header comment) checks
   `CONTAINER_WORKSPACE_PATH` FIRST, and this devcontainer sets it to the
   shared main checkout (`/workspaces/bruce_lee`) unconditionally — a git
   worktree executing from `.claude/worktrees/<id>/` resolves to that SAME
   main-checkout path regardless of which tree its own files actually live
   in. Two consequences, verified directly rather than assumed:
   - With `CONTAINER_WORKSPACE_PATH` at its real (unset-by-me) value, the
     test resolves against the MAIN checkout, which has not received this
     worktree's `git mv` yet (the orchestrator merges after the wave
     completes) — so the moved file is "missing" there, not here.
   - With `CONTAINER_WORKSPACE_PATH` deliberately overridden to point at the
     worktree (to isolate whether the move itself is correct), the SAME test
     fails a *different* assertion instead — "the agreed directory must not
     sit under .claude" — because a Claude Code worktree's own root is
     nested under `.claude/worktrees/<id>/` by construction, which the test
     was written assuming never happens (a reasonable assumption for a
     normal, non-worktree checkout).
   - Independently verified the relocation itself is correct, from *within*
     this worktree, without going through this test's cross-tree resolution:
     `node -e '...supervisorDir()'` and sourcing
     `resources/lib/repo-root.sh`'s `resolve_repo_root` both agree on the
     same repo root; `vice.mjs install --force` deployed cleanly from the
     new `resources/` location; bare `vice.mjs install` reports zero
     `DIVERGED` entries afterward. The plan's own acceptance criteria for
     these specific checks are satisfied; only this one test file's own
     cross-worktree path resolution is not.
   - Expected resolution: once the orchestrator merges this worktree's
     branch into main (standard end-of-wave step), the main checkout gains
     the same relocated files at the same depth, `CONTAINER_WORKSPACE_PATH`
     resolves to a root that is genuinely not under `.claude`, and both
     assertions pass again with no code change required.

2. **`acquire(): zero-config path still returns port 6510 with no registry,
   probes it, and warns on stderr rather than failing when it is not
   answering (D-7)`** — asserts the DEFAULT port (6510) is NOT answering and
   that `acquire()` warns about it. Task 1's checkpoint (already committed,
   `01.1-CRITERION-3-EVIDENCE.md`) started a real host VICE MCP server on
   port 6510 as part of the human-verify procedure this plan's Task 1 gates
   on, and it is still running (a shared, live resource this plan's remaining
   tasks were explicitly told not to disturb). With a real emulator now
   answering on 6510, the probe succeeds and the "not answering" warning
   never fires — an accurate reflection of the current live state, not a
   defect in `acquire()`. Unrelated to the relocation; would reproduce
   identically against the pre-relocation `vice-session` code path if it
   still existed.

None of these three are new regressions from this plan's own changes — see
`01.1-04-SUMMARY.md`'s Deviations section for the full trace.
