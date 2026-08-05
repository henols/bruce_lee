---
type: defect
severity: blocker
area: vice-mcp
files:
  - tools/vice-broker.mjs
  - tools/broker-launch.mjs
  - .claude/mcp/vice/resources/vice-broker.mjs
found: 2026-08-04
found_by: orchestrator, driving the emulator after the developer started the host launcher
---

# The host's deployed `tools/` broker is stale relative to committed `resources/`

Carried forward from
`.planning/todos/completed/2026-08-04-proxy-reports-a-live-broker-as-stale-blocking-all-emulator-access.md`
(quick-260805-9ha resolution note) -- that todo's control-plane dial-address defect is fixed and
closed; THIS half of it is separate and still open.

`tools/vice-broker.mjs` and `tools/broker-launch.mjs` **differ** from committed
`.claude/mcp/vice/resources/`, and the host copies are dated **Aug 4 05:43** -- hours before
01.6.2.1 merged. The live record proves it: `"spares_target": 3`, the pre-rename key *and* the
pre-change default, where 01.6.2.1 renamed it to `warm_floor` and changed the default to 1.

**Consequence:** any live verification performed right now exercises the **pre-01.6.2.1** broker.
Live-verifying 01.6.2.1's five lifecycle-policy changes requires re-running the installer to
refresh `tools/`, **and** restarting the broker so it loads the new code. The restart kills the
three warm spares and any granted instance, so it is the developer's call, not an incidental
step.

## What to check while doing it

- Confirm the installer (whatever regenerates `tools/` from `resources/`) actually ran end to end
  before declaring `tools/` fresh -- a partial copy would still show a newer mtime.
- After the restart, re-read `.vice-supervisor/broker.json` and confirm `warm_floor` (not
  `spares_target`) is present, matching 01.6.2.1's renamed vocabulary.
- The restart is destructive to any in-flight session's warm spares/granted instance -- get the
  developer's explicit go-ahead before running it, per the note above.
