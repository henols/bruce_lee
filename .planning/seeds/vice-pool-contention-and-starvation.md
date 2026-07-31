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

## Correction, 2026-07-31 — there is only one actor class, not three

The actor-class list above is wrong, and it was the basis for the starvation arithmetic
("three actively-working actors renew their leases indefinitely, while a fourth waits").

Researched Claude Code behaviour (HIGH confidence; recorded in
`.planning/notes/vice-mcp-selector-design.md`, finding 5): **subagents do not spawn their own MCP
connections.** They are additional model loops inside the *same* session process, and their MCP
tool calls route over the parent session's already-initialised client connections. `isolation:
"worktree"` swaps the filesystem view, not the MCP wiring. Nested subagents follow the same rule.

So of the three listed classes:

| Claimed actor class | Actually |
|---|---|
| GSD worktree executors | Same process as their parent session — **share** its emulator access |
| Subagents within one turn | Same process — **share** |
| Separate Claude sessions | Genuinely independent — one instance each |

Contention pressure is therefore far lower than this seed assumed: a 3-instance pool serves 3
concurrent Claude Code *sessions*, and any amount of subagent fan-out inside a session consumes
one instance, not N.

The policy question ("a busy holder never yields") still stands — it just fires later and needs
fewer instances than feared. **But the correction opens a sharper question in its place:** if a
whole parallel wave shares one instance, the pool buys crash isolation and cross-session
concurrency but **not** intra-session throughput, which is one of the two rationales in
`tools/vice-pool.sh:33`. That fork is unresolved and is carried in the design note, not here.

Trigger condition, updated: fires when concurrent Claude Code *sessions* (not agents) exceed the
launched instance count.
