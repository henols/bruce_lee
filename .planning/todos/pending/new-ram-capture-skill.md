---
title: Create a reusable RAM-capture skill for layer B of recover.mjs
date: 2026-07-30
priority: medium
---

# Create the layer-B RAM-capture skill

A skill owning "dump a running C64's RAM reproducibly and prove it" — no concept of a
release, no `recovery/` layout, no registry. See [[reusable-capture-harness-seam]] for the
full seam analysis.

Depends on [[extract-sync-primitives-to-vice-session]] landing first.

## What moves out of `tools/recover.mjs`

| Symbol | Note |
|---|---|
| `assembleChunks(chunks)` | order-independent 65536-byte assembly, throws on gap/overlap |
| `captureImage({ call, ranges, chunkSize })` | already takes `call` as a parameter |
| `captureWithFallback(callFn)` | 64K read, falls back to 4096-byte chunks |
| `capture(triggerAddress, opts)` | **drop the dead `releaseId` parameter** — unused in the body |
| `findEntry(opts)` | step-batches until PC + backtrace depth stabilize |
| `classifyRuns({ runA, runB, volatileRanges })` | Hamming-distance-1 drift rule |
| `VOLATILE_RANGES` | `$00-$01`, `$0100-$01FF`, `$0200-$03FF`, each with its recorded reason |
| `voidRun({ … })` | rename to `*.VOID-<ts>` + write the evidence note |
| `captureBaseline()` | **parameterize the output dir** (currently `REPO_ROOT/recovery/machine`) |
| `captureDecayReference({ runMs })` | same parameterization |
| `snapshotName(port, releaseId, runLabel)` | rename the middle param — it is just a string namespace |
| all of `tools/recover.test.mjs` | 333 lines; already covers exactly this surface |

## Also split

`boot()` is mixed. Extract the generic half — attach → autostart → `vice_execution_run` →
confirm PC moved → keyboard `LOAD"*",8,1` + `RUN` fallback — as something like
`attachAndStart({ diskPath })`. The gate-walking loop and the `upsertRelease` call stay in
`tools/recover.mjs`.

## Do not lose

- The `bank:"ram"` vs `bank:"rom"` check at `$E000` (D-08 confirmation) — it must stay a
  hard error, not a warning.
- The three `assertSameMachine` gates in `capture()` (`before-arm`,
  `after-trigger-wait`, `before-declare-good`) and the rule that a detected restart **never**
  auto-resets, auto-reboots or auto-resumes.
- Releasing held keys **at the trigger**, before any memory read — a program event, not a
  timed release. This is what makes the dump reproducible.
- `classifyRuns`'s honest limit: every single-bit drift candidate is counted and returned,
  never silently swallowed.
- Comments carrying measured numbers (994/1014/993-byte idle drift, 2551-byte mid-epoch
  baseline drift, 137 diffs all at Hamming distance 1, 264-byte timed-release drift). They are
  the evidence for the design and must travel with the code.

## Importing layer A across skills is an established shape

`.claude/skills/vice-session/scripts/install-resources.mjs` already imports
`../../devcontainer-host-path/scripts/hostpath.mjs`, so this skill importing
`../../vice-session/scripts/vice-sync.mjs` needs no new precedent. Note also that moving
`screenshot()` into `vice-session` adds no new cross-skill edge — `vice-session` already
depends on `hostpath.mjs`.

## Naming — resolved: `c64-ram-capture`

Avoid "memory" in the name: `c64-memory-mapping` already exists and does something completely
different (address lookup and disassembly annotation). A `c64-memory-capture` sibling would be
a confusing pair. "RAM" is the distinguishing word.

Draft description, scoped so it does not fire on every prompt in this repo — it must not
match "annotate this listing" (that is `c64-memory-mapping`) or "assemble this source" (that
is `acme-build`):

> Capture a running C64's full 64K RAM as a verified flat image, and prove two captures are
> equivalent under RAM drift. Use when asked to dump RAM, depack a program by running it,
> capture a memory image at a checkpoint, or compare two captures for reproducibility.

Mirror `vice-session`'s doc split that landed in `260730-ryz`: `SKILL.md` is a usage-only
guide, architecture and rationale go in `INTERNALS.md`.
