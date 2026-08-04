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

## RESOLVED 2026-08-04 (01.6.2.1-04-PLAN.md, task 1)

**Disposition: ADOPTED — done on the successor.** Not dissolved, overruling `ROADMAP.md`'s own
proposed wording (§ Phase 01.5, criterion 6 disposition table and § Phase 01.6.2's absorbed-criteria
section, both of which read *"close the standalone todo ... as dissolved"*). That wording was drafted
assuming the value question was separable from the constant's own deletion under D-01/D-12 — it was
not. The value survived; only the mechanism and the name changed. Recording this as dissolved would
read as *"we decided not to raise it,"* which is the opposite of what happened.

**Both constants, named:**

- **Retired: `GRANT_POLL_TIMEOUT_MS`** (this todo's own subject, `.claude/mcp/vice/vice-broker-client.mjs:213`
  at the time this todo was filed). It no longer exists. It went with `pollGrant()` and the whole
  file-messaging protocol, deleted under D-01/D-12 when Phase 01.6.2 replaced grant-polling with a TCP
  control plane — there is no grant left to poll for once acquire is a request and response on an
  already-open connection.
- **Surviving: `CONTROL_ACQUIRE_TIMEOUT_MS`** (aliased `ACQUIRE_TIMEOUT_MS`), `.claude/mcp/vice/vice-broker-client.ts`.
  It is a **connection-level acquire deadline**, not a poll timeout — a different mechanism answering
  the adjacent question ("how long will this session wait for a grant on its one open connection"). A
  reader who searches for `GRANT_POLL_TIMEOUT_MS` today and finds nothing should land here.

**This todo's literal ask is satisfied.** `CONTROL_ACQUIRE_TIMEOUT_MS`'s default rose from 25000 to
120000 in `01.6.2.1-04-PLAN.md` task 1, commit `789f18e` (this phase, this plan) — inside the headroom
this todo itself specified ("~120000ms, which leaves headroom under the measured >=150s floor rather
than racing it").

**This todo's own "what to check while doing it" question, answered.** It asked whether any test
asserts the current 25000 default, so a pinned test would be updated rather than left to fail or
silently loosened. Task 1 found two: `vice-proxy.test.ts`'s ordering-invariant test (which reads
`.mcp.json`'s own `timeout` field and asserts the acquire deadline stays strictly less than it) and
its never-started fail-fast test (whose bound was expressed as half the acquire deadline). Neither
is a test *of* the 25000 default directly, which is why this todo's own author-time search for that
exact shape did not surface them — but both are tests whose *effective* value moves when the deadline
does. **Closing this todo required moving a second file outside the broker's own directory** —
`.mcp.json`'s vice server `timeout`, raised 60000 -> 150000 in the same commit — to keep the ordering
invariant true rather than relax it, and the never-started bound was re-anchored to a fixed absolute
value rather than left as a now-loosened fraction. Both are exactly the *"tests pinned to the old
value... update rather than loosen them"* instruction this todo issued to whoever closed it, applied
to a coupling this todo did not anticipate by name but whose category it correctly predicted.

**Evidence:** direct read of `vice-broker-client.ts`, `vice-proxy.test.ts` and `.mcp.json` at plan
time, and a live green test run after the change (`node --test --test-concurrency=1
'.claude/mcp/vice/'*.test.*`: 400/395/0/5, unchanged baseline).
**Confidence:** HIGH.
