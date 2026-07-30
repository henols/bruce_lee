---
title: Reusable capture harness — the three-layer seam in tools/recover.mjs
date: 2026-07-30
context: /gsd-explore session on whether tools/recover.mjs and tools/releases.mjs belong in a skill
---

# Reusable capture harness — the three-layer seam

## The question

Should `tools/recover.mjs` / `tools/releases.mjs` move into a skill, and if so, into
`vice-session` or a separate one? Answered by way of a prior goal: **the scripts should be
reusable.**

## What the two files are today

- **`tools/releases.mjs`** (91 lines) — the *only* accessor for `recovery/RELEASES.json`.
  `loadRegistry`, `release(id)`, `releaseDir(id)`, `assertKnownRelease`, `upsertRelease`,
  plus a `list`/`show` CLI. Deliberately the single place a release id is read out of the
  registry; every other tool takes the id as an argument.
- **`tools/recover.mjs`** (1052 lines) — the depack-by-execution procedure driving host VICE
  over MCP. Verbs `reset` → `boot` → `find-entry` → `capture`, with `recover` as the whole
  path, `reproduce` running it twice and comparing, plus `baseline` and `decay-reference`.

The coupling is one-directional and thin: `recover.mjs` imports only `release`, `releaseDir`,
`upsertRelease`. No release identifier appears in its control flow — boot gates come from
`rel.boot.gates`, the dump trigger from `rel.trigger.address`. A third release is a registry
entry, not a code change.

## Why folding either into `vice-session` wholesale is wrong

All four existing skills are **generic C64/devcontainer capabilities** — `acme-build`,
`c64-memory-mapping`, `devcontainer-host-path`, `vice-session`. None mentions Bruce Lee; each
could drop into any C64 project unchanged. That is exactly the property the `260730-oga`
quick task was chasing when it moved `vice.mjs`/`vice-pool.mjs`/`vice-session.mjs` into the
skill ("so the vice-session skill is self-contained and exportable"), and that same plan
explicitly decided `recover.mjs`, `recover.test.mjs` and `releases.mjs` stay in `tools/`.

`recover.mjs` knows about cracktro keypress gates and `recovery/RELEASES.json`;
`releases.mjs` hardcodes `join(REPO_ROOT, "recovery", "RELEASES.json")`. Moving them in
would make `vice-session` a Bruce Lee skill wearing a generic name.

## Evidence that the generic/specific seam is already cheap

1. **`capture(releaseId, triggerAddress, …)` never uses `releaseId` in its body.** A
   vestigial parameter on the biggest function — the capture layer is already
   release-agnostic and merely doesn't admit it in its signature.
2. **`tools/recover.test.mjs` (333 lines) is a de facto spec of the reusable surface.** It
   imports exactly `assembleChunks`, `captureImage`, `voidRun`, `classifyRuns`,
   `VOLATILE_RANGES`, `snapshotName` — and zero tests touch `release()`, `boot()`,
   `recover()` or `reproduce()`. Everything the tests import is generic; everything they
   skip is project-specific.
3. **Registry coupling is 7 lines out of 1052**, all inside `boot()` and `recover()`.
4. **`REPO_ROOT` appears 4 times**: the constant itself, `rel.disk_image`, and twice for
   `recovery/machine` in `captureBaseline`/`captureDecayReference`.

## The split

### Layer A — emulator synchronization → **into `vice-session`** (decided)

`reset()`, `readCheckpoint`, `waitCheckpointHit`, `runToCheckpoint`, `POLL_WINDOWS_MS`,
`PING_INTERVAL_MS`, `screenshot()`, `addrNum`/`hex4`.

**Why `vice-session` and not the new capture skill:** these primitives exist *because* of
knowledge that already lives in `vice-session` — `vice_execution_run` is the call the host
server dies on (hence exactly one resume per wait), `vice_ping` does not pause the machine
(986,693 vs 991,569 cycles/s, hence ping-polling is free), and a paused-poll returns
instantly because the machine is usually already paused (hence waiting on `hit_count`, never
on "is execution paused"). The deleted `waitPaused()` helper is precisely the bug that
happens when the primitive drifts away from the rationale that shaped it. Keeping them
together makes that class of regression structurally harder.

### Layer B — reproducible RAM capture → **new skill**

`assembleChunks`, `captureImage`, `captureWithFallback`, `capture()`, `findEntry()`,
`classifyRuns`, `VOLATILE_RANGES`, `voidRun`, `captureBaseline`, `captureDecayReference`,
`snapshotName`, and the whole of `recover.test.mjs`.

Nothing here knows what a release is. Changes required are small: drop `capture()`'s dead
`releaseId` parameter, and have the two `machine/` writers take an output directory instead
of computing `REPO_ROOT/recovery/machine`.

### Layer C — Bruce Lee → **stays in `tools/`**

`releases.mjs` untouched. `recover.mjs` shrinks to registry reads, the gate-walking loop, the
`recovery/<id>/dumps/<id>-gameentry-<label>` path layout, and the CLI (including the
`kind:"process"` lease acquired once at the CLI entry point, spanning a whole `reproduce`).

## The one function that resists

`boot()` is genuinely mixed. Attach → autostart → confirm PC moved → keyboard `LOAD"*",8,1`
fallback is generic; reading `rel.boot.gates`, walking them, and upserting the registry is
not. It wants splitting into a generic `attachAndStart({ diskPath })` plus a project-side
gate walk.

## The second consumer is not hypothetical

ROADMAP **Phase 3 — Verification Harness & Original Baselines** (replay + checkpoint
comparison against the rebuild) is layers A + B again, in this same repo, with no registry
involved. So making layer B take plain paths rather than a release id is not speculative
future-proofing — it is what Phase 3 needs. See [[phase3-harness-reuses-capture-layer]].
