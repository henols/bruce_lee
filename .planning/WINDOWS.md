---
schema_version: 1
open_count: 2
waived_count: 0
fixed_count: 1
total_count: 3
last_updated: 2026-08-04T05:49:19.000Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 260730-mef | unrun-verify | tools/vice-pool.sh |  | Task 3 human-check block (real x64sc multi-instance launch, crash-kill isolation, cross-instance snapshot naming on the host) not run in this container-only execution -- see SUMMARY coverage D1 rationale | open |  | 2026-07-30T16:39:30.106Z |  |
| 2 | 01.6.2 | deviation | .claude/mcp/vice/vice-broker.test.mjs |  | One tracer test skipped (not deleted): exercises the file protocol deleted by plan 07; replacement/deletion owned by 01.6.2-10/-11 | fixed | vice-broker.test.mjs deleted wholesale in 01.6.2-11 Task 3, against plan 10's complete disposition ledger -- the skipped tracer test (ledger row 1) is RE-OBSERVED by broker-e2e.test.ts's own end-to-end acquire/forward/release/teardown test | 2026-08-04T02:53:38.519Z | 2026-08-04T05:49:19.000Z |
| 3 | 01.6.2 | deviation | .claude/mcp/vice/vice-broker.mts |  | handleAcquire() never consults maintainWarmFloor()'s warm pool -- every acquire is a fresh cold launch; filed as Defect 5 in the existing spare-warming-and-stale-grant todo for 01.6.2.1 criterion M (01.6.2-10-PLAN.md ledger Class H) | open |  | 2026-08-04T04:24:04.210Z |  |

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
    "status": "fixed",
    "reason": "vice-broker.test.mjs deleted wholesale in 01.6.2-11 Task 3, against plan 10's complete disposition ledger -- the skipped tracer test (ledger row 1) is RE-OBSERVED by broker-e2e.test.ts's own end-to-end acquire/forward/release/teardown test",
    "recorded_at": "2026-08-04T02:53:38.519Z",
    "resolved_at": "2026-08-04T05:49:19.000Z"
  },
  {
    "id": 3,
    "kind": "deviation",
    "phase": "01.6.2",
    "file": ".claude/mcp/vice/vice-broker.mts",
    "line": null,
    "description": "handleAcquire() never consults maintainWarmFloor()'s warm pool -- every acquire is a fresh cold launch; filed as Defect 5 in the existing spare-warming-and-stale-grant todo for 01.6.2.1 criterion M (01.6.2-10-PLAN.md ledger Class H)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-04T04:24:04.210Z",
    "resolved_at": null
  }
]
````
