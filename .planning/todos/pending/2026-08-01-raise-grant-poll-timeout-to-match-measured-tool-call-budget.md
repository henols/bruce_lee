---
created: 2026-08-01T23:30:00.000Z
title: Raise GRANT_POLL_TIMEOUT_MS from 25000 toward 120000 so it stops capping parallel waves at ~3 agents
area: tooling
severity: major
files:
  - .claude/mcp/vice/vice-broker-client.mjs
  - .claude/mcp/vice/vice-broker-client.test.mjs
---

## Context

Found while writing up the VICE broker Node-rewrite design
(`.planning/notes/vice-broker-lifecycle-decisions.md`, Decision 4). This is a standalone,
near-one-line fix and is independent of that rewrite — it is worth doing first.

## Current value

`GRANT_POLL_TIMEOUT_MS` defaults to 25000 in `.claude/mcp/vice/vice-broker-client.mjs:213`. This is
the container-side deadline the client polls against while waiting for a grant, so it is the
deadline on how long an agent will wait for an emulator to become available.

## The measured evidence

Spike 003 measured the tool-call budget at >=150s
(`.planning/spikes/003-timeout-budgets/README.md:139`) and separately recorded that a cold x64sc
launch is seconds (`:104-105`). The >=150s figure is a floor, not a ceiling — nothing was measured
beyond 150s because nothing needed to be; 30s, 90s and 150s delays all returned real results.

## The consequence

With a serialised depth-1 boot queue (see Decision 5.1 of the lifecycle-decisions note) and an
assumed ~8s boot time, the last agent in a wave of N waits roughly `8*(N-1)` seconds. That puts
25s already on the cliff at N=4 and denies outright at N=5. Waves are capped at ~3 agents
regardless of how many spares the pool holds, and roughly 125s of proven tool-call budget goes
unused. The ~8s boot figure here is an ASSUMPTION, exactly as it is in the lifecycle-decisions
note: the cap is real either way, but its precise width is arithmetic, not measurement.

## The target

~120000ms, which leaves headroom under the measured >=150s floor rather than racing it.

## Why this is worth doing first

It is a near-one-line change, it is completely independent of the broker Node rewrite, and it
widens waves immediately. Nothing in the rewrite has to land before this can ship.

## What to check while doing it

Whether any test in `.claude/mcp/vice/` asserts the current 25000 default —
`vice-broker-client.test.mjs` is the likely candidate. A test pinned to 25000 needs updating in the
same change, not left to fail or, worse, silently loosened.

## Cross-reference

- `.planning/notes/vice-broker-lifecycle-decisions.md`, Decision 4 — where this number's role in
  the wave-width story is worked out in full, including the table this todo's consequence section
  summarises.
- `.planning/todos/pending/2026-08-01-vice-broker-spare-warming-and-stale-grant-defects.md` — the
  four broker defects found in the same investigation.
