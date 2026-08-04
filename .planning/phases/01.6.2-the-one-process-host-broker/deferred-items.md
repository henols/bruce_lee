# Deferred items — 01.6.2-09

Out-of-scope discoveries found while executing 01.6.2-09-PLAN.md, logged per the executor's
SCOPE BOUNDARY rule rather than fixed inline (they are not directly caused by this plan's own
changes, and are not among the eight agent-facing messages / one installer paragraph / port
triage this plan's own acceptance criteria enumerate).

## `.claude/mcp/vice/vice.ts`'s `EPOCH_FILE` comment still attributes epoch-writing to `vice-supervisor.sh`

- **File:** `.claude/mcp/vice/vice.ts`, the comment directly above `export const EPOCH_FILE`
  (currently around line 43): `// Where tools/vice-supervisor.sh (host-only) writes its restart
  epoch --`.
- **Why it's stale:** as of an earlier plan in this phase (D-23/D-27), the long-lived TypeScript
  broker (`vice-broker.mts`) is what actually writes each instance's `epoch.json` now — the
  retiring per-instance supervisor no longer does. The comment predates that change and was not
  part of this plan's own enumerated eight messages (it does not instruct anyone to run
  anything; it only misattributes who writes a file).
- **Why deferred rather than fixed here:** this plan's scope is the eight agent-facing/
  operator-facing host-instruction messages, the installer's dead-capability paragraph, and the
  port triage — all explicitly enumerated in `01.6.2-09-PLAN.md`'s own `must_haves`/acceptance
  criteria. This comment's staleness is a separate, pre-existing documentation defect from an
  earlier plan, not something this plan's changes introduced or that its own verification checks.
- **Suggested fix for whoever picks this up:** reword the comment to attribute epoch-writing to
  the broker (`vice-broker.mts`'s `writeEpochForLaunch()`/`broker-epoch.mts`), keeping the
  "resolved via `repo-root.ts`'s `supervisorDir()`" path-resolution explanation, which is still
  accurate (only the WRITER changed, not the path or format — D-23's own "same paths, same
  format" contract).
