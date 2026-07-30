# Deferred items — quick task 260730-v6z

Out-of-scope discoveries found while executing this plan. Not fixed here per
the SCOPE BOUNDARY rule (only auto-fix issues directly caused by this task's
own changes).

## `vice-pool.test.mjs` environmental test failure

- **File:** `.claude/skills/vice-session/scripts/vice-pool.test.mjs`
- **Test:** `acquire(): zero-config path still returns port 6510 with no
  registry, probes it, and warns on stderr rather than failing when it is
  not answering (D-7)`
- **Cause:** The test asserts a `/not answering/` warning on the assumption
  that the default port 6510 instance is unreachable. During this task's
  Task 3 verification, the host VICE MCP server was found to be reachable
  again (it answered `vice_ping` and completed a full `reproduce danish`
  run), so the assumption no longer holds in this environment and the test
  fails with an empty match. This is an environmental flake tied to VICE's
  live/down state, not a regression caused by this plan's code moves — the
  file is not in this plan's `files_modified` list and none of its logic
  was touched.
- **Action:** Not fixed. Left for whoever next touches `vice-pool.test.mjs`
  (or a future quick task) to make the fixture resilient to a live default
  instance if that's judged worthwhile.
