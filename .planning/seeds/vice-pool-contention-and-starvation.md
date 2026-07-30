---
title: Pool contention becomes real once several actors each hold their own VICE session
trigger_condition: Concurrent VICE actors first exceed the launched instance count (3 today), or the per-actor session file lands
planted_date: 2026-07-30
---

# Waiting for a free instance already works — the session layer bypasses it

The pool has a genuine contention story already. `acquire()` polls every 500ms against a
120s deadline (`VICE_POOL_ACQUIRE_TIMEOUT_MS`, default `120000`) and only then throws
`acquire: no free instance within Nms -- every candidate rejected: ...` with a per-candidate
reason. `acquireSession()` passes no `timeoutMs`, so sessions inherit that 2-minute wait for
free.

That wait is currently **unreachable for a second actor**, because of a refusal one layer up.

## The two refusals are not the same refusal

| Refusal | Where | Waits? |
|---|---|---|
| `acquire: no free instance within Nms` | `acquire()` in `vice-pool.mjs` | Yes — 120s, 500ms poll |
| `a session is already active (id ..., port ...) -- release it first` | `acquireSession()` in `vice-session.mjs` | **No — immediate** |

`sessionFilePath()` defaults to a single `<repo>/.vice-supervisor/session.json`, and
`repoRoot()` resolves via `CONTAINER_WORKSPACE_PATH` first — so every caller under the
workspace, git worktrees included, collapses onto that one file. Actor #2 therefore hits the
*second* refusal instantly and never reaches the first one's wait loop. Contention today
looks like an immediate hard stop, not like queuing.

So the per-actor session file is what **unlocks** the waiting behaviour that already exists.
It isn't adding a queue; it's removing the thing that pre-empts the queue.

## Why this is a seed and not just a todo

Because the moment several actors do queue properly, an unresolved design question opens that
nothing in the current code answers: **a busy holder never yields.**

- Pool state as of 2026-07-30: three launched instances — `6510`, `6511`, `6512`.
- Actor classes that want one each: GSD worktree executors, separate Claude sessions, and
  subagents within one turn. Three classes, three instances, no shared coordinator across them.
- Session leases are TTL-reclaimed, never pid-reclaimed. Default TTL is 30 minutes.
- `refreshOnUse()` slides `expires_at` forward on **every** call and refreshes the pool lease
  with it.

Put those together: three actively-working actors renew their leases indefinitely, while a
fourth waits 120 seconds and dies. The 30-minute TTL only ever reclaims an *abandoned*
session, never a busy one. Nothing starves on an idle pool; everything starves on a working one.

That's a policy question, not a bug, and it has no obviously right answer yet:

- Is 120s the right ceiling when the expected wait is "until another agent finishes a phase"?
- Should a waiter be able to signal intent, so holders stop refreshing and drain?
- Should the pool simply grow to match the actor count, making queuing rare rather than solved?
- Should some work be demoted to sharing an instance sequentially instead of holding one?

Do not pick one of these now — pick it when real contention shows which failure actually hurts.
The observable signal that the trigger has fired: `acquire: no free instance within 120000ms`
appearing in normal work rather than as a symptom of dead instances. Check the per-candidate
reasons in that message to tell the two apart — `leased by pid ...` on every candidate means
genuine contention, `no answer` means the instances are dead and this seed is not what fired.
