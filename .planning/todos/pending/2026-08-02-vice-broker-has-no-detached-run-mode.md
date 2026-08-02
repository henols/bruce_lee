---
created: 2026-08-02T09:05:00.000Z
title: The VICE broker only runs in the foreground, so one signal destroys every live session's emulator
area: tooling
severity: major
files:
  - tools/vice-broker.sh
  - tools/vice-supervisor.sh
---

## Problem

The broker runs in the foreground only, with no detached or daemonized mode. A stray Ctrl-C, a
closed terminal, or a SIGHUP from an ending SSH/VS Code session reaps every instance it is
tracking — not just the process the human meant to stop.

Observed live on 2026-08-02: `^C` produced `vice-broker: reap saw 4 recorded instance(s),
terminated 4`, immediately followed by protocol state being purged. This session's own
`mcp__vice__vice_ping` then returned `ECONNREFUSED` against its cached grant — a live, in-use
session's emulator was destroyed by a signal meant for the broker's own terminal.

The blast radius is what makes this `major`, not `minor`: one signal to a foreground process
destroys every live session's emulator at once, and a session that loses its instance loses its
accumulated context — this has already halted plan 01-04 once.

**The reap-everything-on-signal contract itself is deliberate and is NOT the defect.** `260801-qpq`
chose it on 2026-08-01 because orphaned emulator processes cost more than an interrupted session.
This todo does not ask to reverse that contract.

## Solution

Add a detached / nohup-able run mode so the broker's lifetime is not tied to the lifetime of the
terminal or SSH/VS Code session that launched it, and/or a loud warning at start naming
explicitly what a Ctrl-C in that terminal will destroy (every tracked instance, including
sessions granted to other agents). To be unambiguous a second time: **this is not a request to
reverse the reap-on-signal contract**, which stays exactly as `260801-qpq` designed it — the fix
is to the deployment shape, not the shutdown policy.

## Cross-reference

- `.planning/notes/vice-broker-lifecycle-decisions.md` — the 2026-08-02 foreground-fragility
  subsection under Decision 5, which scopes this into the rewrite.
- `.planning/RE-FINDINGS.md` — the second reproduction of defect 4, on the same 2026-08-02 run.
- `.planning/todos/pending/2026-08-01-vice-broker-spare-warming-and-stale-grant-defects.md` —
  Defect 4 (the proxy caches a dead grant with no re-request path), which this fragility triggers.
