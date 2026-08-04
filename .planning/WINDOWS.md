---
schema_version: 1
open_count: 2
waived_count: 0
fixed_count: 0
total_count: 2
last_updated: 2026-08-04T02:53:38.519Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 260730-mef | unrun-verify | tools/vice-pool.sh |  | Task 3 human-check block (real x64sc multi-instance launch, crash-kill isolation, cross-instance snapshot naming on the host) not run in this container-only execution -- see SUMMARY coverage D1 rationale | open |  | 2026-07-30T16:39:30.106Z |  |
| 2 | 01.6.2 | deviation | .claude/mcp/vice/vice-broker.test.mjs |  | One tracer test skipped (not deleted): exercises the file protocol deleted by plan 07; replacement/deletion owned by 01.6.2-10/-11 | open |  | 2026-08-04T02:53:38.519Z |  |

````json
[
  {
    "id": 1,
    "kind": "unrun-verify",
    "phase": "260730-mef",
    "file": "tools/vice-pool.sh",
    "line": null,
    "description": "Task 3 human-check block (real x64sc multi-instance launch, crash-kill isolation, cross-instance snapshot naming on the host) not run in this container-only execution -- see SUMMARY coverage D1 rationale",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-07-30T16:39:30.106Z",
    "resolved_at": null
  },
  {
    "id": 2,
    "kind": "deviation",
    "phase": "01.6.2",
    "file": ".claude/mcp/vice/vice-broker.test.mjs",
    "line": null,
    "description": "One tracer test skipped (not deleted): exercises the file protocol deleted by plan 07; replacement/deletion owned by 01.6.2-10/-11",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-04T02:53:38.519Z",
    "resolved_at": null
  }
]
````
