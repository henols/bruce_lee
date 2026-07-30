---
title: Extract the checkpoint-synchronization primitives from recover.mjs into vice-session
date: 2026-07-30
priority: medium
---

# Extract layer A into `vice-session`

Move the emulator-synchronization primitives out of `tools/recover.mjs` into a module under
`.claude/skills/vice-session/scripts/`, so anything that drives VICE gets them without
importing the Bruce-Lee-specific recovery tool.

## Shape: a new sibling module, not folded into `vice.mjs`

Follow `vice-probe.mjs`'s precedent. Its header states outright that the fragile liveness
probe and `vice.mjs`'s resilient `withReconnect()` ladder "must NEVER be merged" — different
jobs, own module, structurally isolated. Synchronization is a third such job: put it in
`.claude/skills/vice-session/scripts/vice-sync.mjs`.

**Gate to update:** the `260730-ryz` plan installed an automated check that greps `SKILL.md`
for a `LEAKS` regex of module names and requires each to appear in `INTERNALS.md`. Add
`vice-sync\.mjs` to that regex and document the module in `INTERNALS.md`, or the gate silently
stops covering it.

## What moves

| Symbol | Note |
|---|---|
| `reset()` | clear non-temporary checkpoints, detach units 8–11, hard reset with `run_after:false` |
| `readCheckpoint(cpId, addr)` | id lookup with address fallback |
| `waitCheckpointHit(cpId, addr, label)` | the single-resume wait — the load-bearing one |
| `runToCheckpoint(addr, label)` | arm → wait → delete |
| `POLL_WINDOWS_MS`, `PING_INTERVAL_MS` | the measured poll schedule |
| `screenshot(containerPath)` | host-path translation via `tryHostPaths` + `vice_display_screenshot` |
| `addrNum(a)`, `hex4(n)` | address normalization across the JSON boundary |

## Why here

These encode knowledge that is already `vice-session`'s: `vice_execution_run` is the call the
host server dies on, `vice_ping` does not pause the machine, and a paused-poll returns
instantly because the machine is usually already paused. The deleted `waitPaused()` helper is
the bug that happens when the primitive drifts from that rationale. See
[[reusable-capture-harness-seam]].

## Constraints

- **Preserve exactly one `vice_execution_run` per wait.** The resume count is the risk being
  minimized; do not "simplify" the pre-check that reads `hit_count` before resuming.
- **Never reintroduce a paused-poll.** Wait on the checkpoint's own `hit_count`.
- **`armedCheckpoints` — resolved: layer A owns it, as a tracker.** `assertSameMachine(session,
  { armedCheckpoints = [] })` already takes it as an injected parameter with a default, so
  `vice.mjs` never owned that state — the *arming* code does, and after this move that is
  `runToCheckpoint()` (adds) and `reset()` (clears). Export a small tracker with
  `track(id)` / `untrack(id)` / `ids()` / `clear()` rather than a bare `Set`: layer B's
  `capture()` deliberately hand-rolls its own arm → wait → delete (it interleaves the identity
  check and the held-key release *between* the wait and the delete) and must register its
  trigger id in the same place. One source of truth, both layers writing through one door.
- Keep the `warn:` -and-continue behaviour on `checkpoint_delete` / `disk_detach` failures.
- Skip `temporary` checkpoints in `reset()` — deleting a stale id is one of the two leading
  crash suspects.
- No behaviour change intended; `node tools/recover.mjs reproduce danish` must still pass.

## Sequencing

Do this before [[new-ram-capture-skill]], since layer B will import these.
