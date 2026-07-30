---
name: c64-ram-capture
description: Capture a running C64's full 64K RAM as a verified flat image, and prove two captures are equivalent under RAM drift. Use when asked to dump RAM, depack a program by running it, capture a memory image at a checkpoint, or compare two captures for reproducibility.
---

# Capturing and comparing C64 RAM

```js
import {
  capture,
  attachAndStart,
  findEntry,
  voidRun,
  captureBaseline,
  captureDecayReference,
  classifyRuns,
  VOLATILE_RANGES,
} from "../../c64-ram-capture/scripts/ram-capture.mjs";
```

Everything this skill offers is reached through that one module — including
the comparison functions, re-exported from it so callers never need a second
import path.

## Capturing at a trigger address

```js
const cap = await capture(triggerAddress, { releaseKeys, session });
```

`triggerAddress` is the instruction address to stop at (a number, or a
`"$08B1"`-style string). Returns the 64K image, its sha256, the chunk size
actually used to read it, and the machine/chip-state fields recorded
alongside it (VIC-II video standard, port `$01` value, the server version, a
`$E000` RAM-vs-ROM comparison proving bank scoping is working).

If the caller is holding down any keys at a gate, pass them as
`releaseKeys` — they are released at the trigger checkpoint, not before,
so the capture reflects a program event rather than a timed guess.

`session` is optional; pass one from a longer-running procedure (e.g. one
that also called `attachAndStart`) so identity checks compare against that
procedure's starting point rather than a fresh one.

## Booting a disk

```js
const { method, fallbackUsed, hostPath } = await attachAndStart({ diskPath });
```

Attaches and autostarts the given disk image, falling back to a scripted
`LOAD"*",8,1` + `RUN` if autostart doesn't visibly move the PC. Takes no
screenshot and writes nothing to any registry — that is the caller's job.

## Finding an entry point

```js
const { address, howLocated } = await findEntry({ batchSize, maxBatches });
```

Presses past a "hit any key" gate and steps forward until the program
counter and call-stack depth both stabilize, which is the signature of a
program's steady-state dispatch loop. Bounded by `maxBatches`; throws with a
diagnostic if execution never stabilizes.

## Comparing two captures for reproducibility

```js
const verdict = classifyRuns({ runA, runB });
```

Both must be exactly 65536-byte buffers. Reads:

- `verdict.ok` — `false` if any multi-bit difference was found outside
  volatile scratch. A real divergence differs in several bits; treat this
  as a failure.
- `verdict.decayCandidates` — single-bit differences, returned for
  inspection, not silently dropped. This is the expected shape of harmless
  RAM drift between two live runs.
- `verdict.volatileDiffs` — count of differences inside `VOLATILE_RANGES`
  (stack page, KERNAL work area, 6510 I/O port), excluded from the verdict
  but never uncounted.
- `verdict.programMismatches` — the multi-bit differences that failed the
  verdict, each with its address and both byte values.

## Voiding a run

```js
voidRun({ binPath, capturePath, reason, baselineEpoch, currentEpoch });
```

Call this when the machine's identity could not be proven unchanged across
a capture. Renames any existing artifacts to `*.VOID-<timestamp>` and writes
a sibling evidence note recording why — a voided run stays inspectable
rather than silently vanishing. Missing artifacts are a no-op.

## Building a machine baseline

```js
await captureBaseline({ outDir });
await captureDecayReference({ outDir, runMs });
```

Both take the directory to write into and reject a missing one before
touching the emulator. `captureBaseline` records the deterministic
power-on RAM image (valid only as the very first emulator action of a
fresh process). `captureDecayReference` runs the machine idle twice and
records every address that drifted, as a floor on the drift-prone set —
not a complete one.

## Copying this skill elsewhere

This skill depends on the sibling `vice-session` and `devcontainer-host-path`
skills — copy all three into another project together, not this one alone.
