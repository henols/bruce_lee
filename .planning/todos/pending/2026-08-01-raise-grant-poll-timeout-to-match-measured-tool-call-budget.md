---
created: 2026-08-01T23:30:00.000Z
title: Raise GRANT_POLL_TIMEOUT_MS from 25000 toward 120000 for headroom on a slow or contended host
area: tooling
severity: minor
files:
  - .claude/mcp/vice/vice-broker-client.mjs
  - .claude/mcp/vice/vice-broker-client.test.mjs
---

## Context

Found while writing up the VICE broker Node-rewrite design
(`.planning/notes/vice-broker-lifecycle-decisions.md`, Decision 4). This is a standalone,
near-one-line fix and is independent of that rewrite.

**Priority lowered 2026-08-02.** Boot time was measured live on the host on 2026-08-02 at
sub-second (~0.65s as an upper bound, with a poll-quantisation caveat — see
`.planning/notes/vice-broker-lifecycle-decisions.md`'s 2026-08-02 correction section and
`.planning/RE-FINDINGS.md` for the full measurement). Decision 4's original conclusion — that this
timeout capped every wave at ~3 agents — is retracted. What matters for wave width now is
`VICE_BROKER_MAX` and spike 005 (`.planning/spikes/005-concurrent-x64sc-ceiling/`), not this
constant.

## Current value

`GRANT_POLL_TIMEOUT_MS` defaults to 25000 in `.claude/mcp/vice/vice-broker-client.mjs:213`. This is
the container-side deadline the client polls against while waiting for a grant, so it is the
deadline on how long an agent will wait for an emulator to become available.

## The measured evidence

Spike 003 measured the tool-call budget at >=150s
(`.planning/spikes/003-timeout-budgets/README.md:139`) and separately recorded that a cold x64sc
launch is seconds (`:104-105`). The >=150s figure is a floor, not a ceiling — nothing was measured
beyond 150s because nothing needed to be; 30s, 90s and 150s delays all returned real results. Both
of these still hold; nothing about the 2026-08-02 boot measurement changes either constant.

## The consequence, corrected 2026-08-02

The original consequence section here read: with a serialised depth-1 boot queue and an assumed
~8s boot time, the last agent in a wave of N waits roughly `8*(N-1)` seconds, putting 25s already
on the cliff at N=4 and denying outright at N=5 — capping waves at ~3 agents regardless of pool
size. That ~8s figure was an assumption, and it was ~11x too large. Boot measured sub-second on the
host on 2026-08-02, so at ~0.7s per serialised boot the 25s deadline implies a cliff at roughly 36
agents — more than double `VICE_BROKER_MAX=16`. `VICE_BROKER_MAX` binds first; this timeout does
not limit any wave that `MAX` would allow. The remaining value of raising it is robustness headroom
on a slow or contended host, nothing more.

## The target

~120000ms, which leaves headroom under the measured >=150s floor rather than racing it.

## Priority

This is no longer urgent and no longer unlocks anything by itself — `VICE_BROKER_MAX` and spike
005 are what matter for wave width now. It remains a cheap, independent robustness improvement and
can ship whenever it is convenient; nothing in the broker rewrite has to land before it, and it
does not have to land before the rewrite either.

## What to check while doing it

Whether any test in `.claude/mcp/vice/` asserts the current 25000 default —
`vice-broker-client.test.mjs` is the likely candidate. A test pinned to 25000 needs updating in the
same change, not left to fail or, worse, silently loosened.

## Cross-reference

- `.planning/notes/vice-broker-lifecycle-decisions.md`, Decision 4 — RETRACTED 2026-08-02; where
  this number's role in the wave-width story is worked out in full, including both the withdrawn
  table and the corrected arithmetic.
- `.planning/todos/pending/2026-08-01-vice-broker-spare-warming-and-stale-grant-defects.md` — the
  four broker defects found in the same investigation.
- `.planning/spikes/005-concurrent-x64sc-ceiling/` — the now-binding open question on wave width.
- `.planning/RE-FINDINGS.md` — the 2026-08-02 boot-time measurement and the entry that supersedes
  the original 2026-08-01 grant-poll finding.
