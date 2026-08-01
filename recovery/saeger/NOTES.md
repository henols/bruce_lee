# `saeger.d64` — the recorded recovery procedure

Saeger Soft Group release of Datasoft's *Bruce Lee* (Ron J. Fortier, 1984).
Source image `disks/saeger.d64`, SHA-256 `b45e53e602fe94654934beffaa483f59989a6d3973ef054afaeea4ea4bc2b8f5` — read-only throughout; no tool in this project writes to it.

Everything below was measured against a live host VICE **3.10**, machine **C64SC**, video standard **PAL**.

---

## Reproducing this dump

**Corrected 2026-08-01 (01-04 Task 2).** This section used to open with a single shell command — the same standalone Node CLI verb named in `recovery/danish/NOTES.md`, with only the release id changed — that no longer exists in this repository: a 2026-08-01 hard project rule made `mcp__vice__*` the only permitted route to the emulator, and every standalone script that opened its own connection to VICE was deleted rather than migrated (see `.planning/STATE.md`, Phase 1 2026-08-01 entries). The three-run reproducibility proof recorded in § "Reproducibility verdict" below **was performed and its digests are committed** — deleting the script does not un-produce that evidence.

The ordered procedure is the same one recorded in `recovery/danish/NOTES.md`'s own "Reproducing this dump" section, with the two release-specific substitutions (steps 4-5 below) carried as registry data rather than as a code branch, spelled out here in full so this file stands on its own:

1. `mcp__vice__vice_disk_attach({ unit: 8, path: "disks/saeger.d64" })`
2. `mcp__vice__vice_autostart({ path: "disks/saeger.d64" })`
3. `mcp__vice__vice_execution_run` — mandatory; autostart only arms the load, the CPU is still
   halted from the reset.
4. `mcp__vice__vice_checkpoint_add({ start: "$08B1", exec: true, stop: true })` — arm the trigger
   before touching any key. Confirm via `mcp__vice__vice_backtrace` that the call chain passes
   through `$08F6` (the gate's own `JSR $FFE4`) before proceeding to the next step — a key queued
   before the boot reaches this point is silently consumed by BASIC's own input-line editor
   instead (see "Loader-range derivation" above for the live-confirmed hazard).
5. `mcp__vice__vice_keyboard_petscii({ data: [32] })` — queue PETSCII SPACE into the KERNAL
   keyboard buffer (this release's `$08F4` gate polls KERNAL `GETIN` rather than the CIA ports
   directly, i.e. `gate.delivery: "kernal-buffer"`), in place of danish's hold-and-release on the
   keyboard matrix.
6. `mcp__vice__vice_execution_run`, then poll `mcp__vice__vice_ping` (non-pausing) until
   `execution` reports the trigger has stopped the machine.
7. Sixteen `mcp__vice__vice_memory_read` calls of 4096 bytes each at `bank: "ram"`, concatenated
   in address order into one 65536-byte image; confirm the total is exactly 65536 bytes.
8. `mcp__vice__vice_registers_get`, `mcp__vice__vice_vicii_get_state` and a plain
   `mcp__vice__vice_memory_read` of `$0001` for the chip-state sidecar.
9. `mcp__vice__vice_checkpoint_delete` the trigger checkpoint by its `checkpoint_num`.
10. `mcp__vice__vice_checkpoint_list` and confirm it reports zero checkpoints — accept only this
    enumeration as proof, never the delete call's own return value.
11. `mcp__vice__vice_execution_run` to leave the machine running.

Every step besides 4-5's substitution is identical to danish's own procedure, because both
releases load the same original Datasoft game code at the same trigger address. It needs no
snapshot, no saved state, and nothing from the host's home directory — only the disk image in
this repository and a reachable VICE MCP server.

**Why three runs and not two:** the same reason recorded for danish — two captures cannot distinguish *"the program writes this byte"* from *"it happened to drift the same way twice"*, so `classifyRunSet` refuses fewer than three, for every release, unconditionally.

---

## 1. Dump trigger — a signal, never a duration

| | |
|---|---|
| **Trigger address** | **`$08B1`** — the same address as `danish.d64` |
| **Kind** | `pc-exec-checkpoint` |
| **Armed as** | `vice_checkpoint_add({ start: "$08B1", exec: true, stop: true })` |

`$08B1` is the game's **title-screen input dispatcher**, and it is **byte-for-byte identical** to danish's own copy of the same routine:

```
$08B1  A5 49     LDA $49
$08B3  05 4A     ORA $4A
$08B5  D0 03     BNE $08BA
$08B7  4C 31 05  JMP $0531
$08BA  A9 00     LDA #$00
$08BC  8D 0E 01  STA $010E
$08BF  20 9E 13  JSR $139E   ; the game's own input scanner
```

and `$139E` (also byte-for-byte identical to danish's):

```
$139E  AD 0C 01  LDA $010C
$13A1  D0 0A     BNE $13AD
$13A3  AD 00 DC  LDA $DC00
$13A6  2D 01 DC  AND $DC01
$13A9  49 FF     EOR #$FF
```

**Both cracks preserve the original Datasoft game code at the same load addresses.** This is not a coincidence worth re-deriving per release: once one release's game-code region is known, checking whether the other release loads the same bytes at the same addresses is the cheapest possible next step, and here it holds exactly.

**This is explicitly a signal, not an elapsed time**, for the identical reasons recorded in danish's `NOTES.md` — no wall-clock delay, cycle count or frame count is used anywhere on the path to the dump.

### How `$08B1` was located for this release

Unlike danish, this address was **not** discovered by the automated `find-entry` search. Two things had to be fixed/worked around first, both recorded here rather than hidden:

1. **`find-entry`'s CLI verb had a real bug**: it called the generic entry-search function directly without ever calling `boot()` first, so it silently stepped whatever the machine happened to be doing rather than this release's own boot. Verified live: without a boot, the "stabilized" address was `$E5CD`, KERNAL ROM's own keyboard-wait loop (`LDA $C6 / STA $CC / STA $0292 / BEQ $E5CD`) — not game code at all. Fixed in the (since-retired) standalone recovery tool's `find-entry` verb to mirror its own reset → boot → find-entry order (a generic fix, not a release-specific branch).
2. **Even fixed, the generic search's step budget (400 steps × 150 batches) is far too small** for an uncrunched raw-sector loader that has to read 186 blocks off a simulated disk — orders of magnitude more CPU instructions than a crunched cracktro's "hit any key" loop. Re-run after the fix, it stabilized on `$FD59` (`STA $0300,Y`), also KERNAL ROM boot-time vector-table initialization, still not game code.

Given both automated attempts landed on boot-time KERNAL code, the actual address was found by **direct, hand-driven observation** — screenshots plus `vice_disassemble`/`vice_backtrace` at each step, exactly the method danish's own trigger was originally found by (see danish's `NOTES.md` §1, "Empirically, against the live machine"):

1. `vice_disk_attach` + `vice_autostart` + `vice_execution_run`, then poll with non-pausing `vice_ping` while the machine runs.
2. A screenshot shows a cracktro screen: **"BRUCE LEE / cracked in oktober 1984 by / SAEGER SOFT GROUP"** (Tier-1 evidence, below).
3. Pausing and disassembling shows the machine sitting in a KERNAL `GETIN` ($FFE4) call chain, called from `$08F6` — `$08F0: LDA #$36 / STA $01` then `$08F4: LDA #$00 / JSR $FFE4 / CMP #$20 / BNE $08F4`, a tight "wait for SPACE" loop. This is a **materially different loader shape from danish** — see §5 and the differences table below.
4. `vice_keyboard_matrix` SPACE breaks the loop (confirmed via a checkpoint at `$08F4` whose `hit_count` grew every iteration — a re-armable stop point, same evidentiary standard as danish's own gate).
5. Past the gate, the machine reaches Datasoft's original, unmodified title screen: **"DATASOFT PRESENTS / BRUCE LEE (TM) / BY RON J FORTIER / PRESS F1-1 PLAYER-2 PLAYERS / F3-COMPUTER OPPONENT / F7-TO BEGIN GAME"** — byte-identical to danish's own title screen.
6. `vice_disassemble` of `$08B1`–`$08C7` and `$139E`–`$13AB` confirms byte-for-byte identity with danish's dispatcher and input scanner (both quoted above).
7. A checkpoint armed at `$08B1` was confirmed re-armable: `hit_count` grew to 114 while the title screen looped waiting for F1/F3/F7 — the same re-armability evidence danish's own `NOTES.md` records for the identical address.

**A bare pause was not tried here** — the checkpoint-based approach was already established as necessary by danish's own investigation (the title screen is IRQ-driven there; there is no reason to expect otherwise here, since the code is identical), so it was used from the start rather than re-discovering the same limitation.

### Loader-range derivation (01-04 Task 2, live-verified 2026-08-01) — earned independently, not inherited from danish by analogy

This release's own candidate window was verified live rather than assumed from danish's finding: saeger's uncrunched raw-sector loader turns out to leave a **wider** scratch footprint than danish's crunched one, so danish's exact boundaries do not transfer unchanged. A precise 192-byte `vice_memory_read($02F0, size:192)` at steady state (post-`$08B1` trigger) — spanning `$02F0`–`$03AF` — gave an exact byte-for-byte picture rather than relying on instruction-boundary disassembly alone:

**Accepted — one loader-reentry range:**

| Range | Evidence | Idle hits |
|---|---|---|
| `$0340`–`$03A0` (97 bytes) | The whole span reads as the single repeated byte `$01` (disassembles as `ORA ($01,X)` at every boundary checked: `$0340`, `$039C`), with `$03A1` onward reading ordinary `$00` filler. This is the cassette/Datasette buffer region (`TBUFFR`, `$033C`–`$03FB` per the C64 memory map), a classic loader-stub location — the same finding danish made at `$0340`–`$035E`, just wider here: saeger's uncrunched loader leaves 97 bytes of stale scratch where danish's crunched one left 31. | **0** |

**Rejected — three candidates, each with live disassembly and a stated reason:**

| Range | Disassembly | Reason rejected |
|---|---|---|
| `$08F5`–`$08FA` | `LDA $DC01 / AND #$10 / BNE $08B1 / JSR $094B` | Byte-for-byte identical to danish's own copy of the same routine — the title dispatcher's permanent joystick poll, ordinary shared Datasoft game code, not loader code. Verified live on this release rather than inherited from danish by analogy. |
| `$0D30`–`$0D82` | Reads zero-page flag `$40`, branches, computes a self-modified store target, ADC-chains against `$29` feeding `$0D86`/`$0D87` | Ordinary per-frame title-screen animation/object-dispatch logic, consistent with danish's own rejected finding at the same address — verified live here, not assumed. |
| `$0302`–`$0327` | Also reads as the repeated byte `$01` throughout — **but** these addresses are the standard BASIC/KERNAL RAM vector table (`IMAIN` `$0302`, `ICRNCH` `$0304`, `IQPLOP` `$0306`, `IGONE` `$0308`, `IEVAL` `$030A`, `SAREG`/`SXREG`/`SYREG` `$030C`–`$030F`, the `USR()` `JMP` plus address `$0310`–`$0312`, `CINV` the IRQ vector `$0314`, `CNBINV` the BRK vector `$0316`, `NMINV` the NMI vector `$0318`, `IOPEN` `$031A`, `ICLOSE` `$031C`, `ICHKIN` `$031E`, `ICKOUT` `$0320`, `ICLRCH` `$0322`, `IBASIN` `$0324`, `IBSOUT` `$0326`), every one stomped to `$01` rather than left at its KERNAL default. | Nothing in the game ever dereferences these vectors — `$01`'s HIRAM bit is 0 at the title screen (KERNAL banked out, confirmed live: `$01`=`$40`), so the live hardware IRQ vector is `$FFFE`/`$FFFF` (confirmed live: `$1103`, identical to danish's own recorded value), not `$0314`/`CINV`, and this machine-language-only game never touches BASIC or a KERNAL I/O vector. Inert power-on-adjacent filler, structurally distinct from the accepted range (the Datasette buffer, not the vector table) — rejected despite sharing the same telltale `$01` byte value, because arming an exec checkpoint here would test for a re-entry path the game structurally never uses. Recorded precisely because a wider live window turned it up; a rejection with its reason is what keeps the set visibly earned rather than merely widened. |

**Counting-tier probe:** a non-stopping store checkpoint on the title-screen 1000-byte screen matrix (`$8C00`–`$8FE7`, derived from live `$D018`=`$31`/`$DD00`=`$C1` readings — VIC bank 2, screen base `$8C00`, the same absolute address danish's own probe used) accumulated **432 hits** over **16,182,609 cycles** while execution never stopped — confirms the counting tier can count without stopping, on this release too, no fallback needed.

**Idle calibration:** with the accepted loader-reentry range (`$0340`–`$03A0`) and the `$DD00` register sentinel armed as the small earned set, a no-input idle window advanced **51,563,549 cycles** genuinely (confirmed by a `vice_cycles_stopwatch` bracket). The loader-reentry sentinel registered **0** hits — the gate this release's `loader_ranges` entry must pass — while the `$DD00` counting sentinel registered 1 (an idle floor to read future counts against, not a gate requirement). `node tools/watch-loads.mjs check-idle --release saeger --json` confirms the gate passes.

**Teardown** was proven by an explicit `vice_checkpoint_list` enumeration reporting an empty set after both checkpoints were deleted individually by `checkpoint_num` — never trusted from the delete call's own return value.

**A confirming IRQ-path check, not a full re-derivation:** since plan 01-03 already established both releases load byte-identical original Datasoft game code at `$08B1`/`$139E`, a lighter check sufficed here rather than repeating danish's full reconnaissance: `$01`=`$40` (HIRAM=0, KERNAL banked out, same as danish) and the live hardware IRQ vector `$FFFE`/`$FFFF` reads `$1103` — **identical to danish's own recorded value** — confirming saeger shares the same IRQ handler and raster-split chain as danish, not merely the same main-loop dispatcher.

**A genuine operational hazard, distinct from the technique above:** deriving this took four separate emulator instances in one session — the host VICE crashed three times mid-session (epoch 8→9, 9→10, 10→11), each self-surfaced by the proxy as a loud epoch-drift error and self-healed on the very next call. Per this project's rule, every measurement taken before a detected crash was voided and the whole boot sequence was redone from `vice_disk_attach` on the new instance rather than trusted as a continuation. Recorded live in `.planning/RE-FINDINGS.md` and `.planning/todos/pending/2026-08-01-vice-crashes-three-times-during-sustained-execution-01-04-task2-saeger.md`. Separately, the fourth (successful) boot attempt hit a second, unrelated hazard: a PETSCII SPACE queued immediately after `autostart` (before the boot had reached the `$08F4` gate) was silently consumed by BASIC's own input-line editor (confirmed via `vice_backtrace` showing `$A483`/`IMAIN` in the call chain) rather than by the cracktro's gate — the `kernal-buffer`-delivery analogue of the matrix-delivery hazard this file already documents above ("pressing too early can be read by the autostart's own simulated typing and corrupt the boot"). The fix applied: confirm via `vice_backtrace` that the call chain passes through `$08F6` (the gate's own `JSR $FFE4`) before queuing the key, never queue on a timer or a guess.

---

## 2. `$01` port configuration at dump time

**Live value: `$35` = `%00110101`** (decimal 53), read with a plain `vice_memory_read` — **different from danish's `$23`**, and that is expected: it is a property of the state this release's dispatcher happens to be in when the checkpoint fires, not of the underlying game.

| Bits | Value | Meaning |
|---|---|---|
| 0 (LORAM) | `1` | |
| 1 (HIRAM) | `0` | |
| 2 (CHAREN) | `1` | |
| LORAM/HIRAM/CHAREN combined | `%101` | RAM at `$A000–$BFFF`; I/O visible at `$D000–$DFFF`; **RAM** at `$E000–$FFFF` (not KERNAL ROM) |

**No `$01` write was performed at any point**, same as danish. `vice_memory_read({ bank: "ram" })` reaches the RAM underneath both ROMs and the I/O area with no side effects.

Re-confirmed with the game running (not merely idle), the same 16 bytes at `$E000` read differently through the two banks, and **the `bank:"ram"` bytes are identical to danish's own reading at the same address**:

```
bank:"ram"  4C 00 E3 4C 06 E3 4C 9E E4 26 D7 AA E6 26 D7 AA
bank:"rom"  85 56 20 0F BC A5 61 C9 88 90 03 20 D4 BA 20 CC
```

This is further confirmation that both releases share the same underlying game image: the loader-written jump table under KERNAL ROM at `$E000` is byte-for-byte the same table in both cracks.

`$0000`/`$0001` carry the same caveat recorded in danish's `NOTES.md` — they are the 6510's on-chip DDR/port registers, not memory, and are excluded from the reproducibility comparison for the same reason.

---

## 3. Captured address ranges

Identical to danish's, because this is generic, release-agnostic capture code:

| | |
|---|---|
| **Range** | `$0000–$FFFF` — a single range, all 65536 addresses |
| **Bank** | `ram` for every read |
| **Chunk size actually used** | **4096 bytes** |
| **Bytes read** | 65536 |
| **Image layout** | File offset **equals** CPU address (D-01) |

---

## 4. Reproducibility verdict

Three independent cold-boot captures (the committed `run1`/`run2`/`run3` set):

| Run | SHA-256 |
|---|---|
| run1 | `425b6869b9311fd1d91563c9c9e5b5f8449197a8b6cbf371153f88132af92bd5` |
| run2 | `d44e6a1ecfd6cf3d3c49f0caf699624174dbac9d6af6198c3fb45275dc69e389` |
| run3 | `0d8e472b3f053de8c3ae357b72014c451b3641ea55d5d8edabcaebf357ed2c72` |

**The three digests differ, and — exactly as danish's own `NOTES.md` establishes — that is expected**, not a failure: full-64K byte-identity is impossible in principle (never-written RAM drifts continuously while the emulator runs; see danish's `NOTES.md` §4 for the full three-way measurement). Stability by zone:

| Zone | Unstable |
|---|---|
| `$0000–$0001` 6510 on-chip port registers | **0 — IDENTICAL** |
| `$0002–$00FF` zero page | **0 — IDENTICAL** |
| `$0100–$01FF` stack page | 13 |
| `$0200–$03FF` KERNAL work area / BASIC input buffer | 129 |
| `$0400–$CB66` program image | 2 (single-bit decay, never reaches the mismatch pipeline — see below) |
| `$CB67–$FFFF` upper RAM | 161 |

**65,231 of 65,536 bytes are stable.** Every one of the 305 unstable bytes — including the 2 inside `$0400–$CB66` — is either a single-bit decay candidate (excluded from the multi-bit mismatch check by `classifyRuns` itself, the same rule danish's own captures rely on) or a multi-bit finding that satisfies a drift clause below. `programMismatches` is empty on every run of this procedure since the §4 fix; this run happened to land two single-bit decay bytes inside the program-image zone where danish's own three captures landed zero, but that is exactly the kind of run-to-run variance the N≥3 rule (§ above) exists to characterise rather than paper over — RAM drift is stochastic per run (D-01-01), not pinned to one zone.

### The same evidence-based rule, applied unchanged

`classifyRunSet` is generic, release-agnostic code — nothing in it was modified or tuned to make this release's numbers come out clean. It re-adjudicates every pairwise multi-bit finding against the full three-run set, accepting a difference as drift only if it satisfies at least one of the three clauses recorded in danish's `NOTES.md` §4 (inside volatile scratch; a shared single-bit drift origin; a pure power-on pattern block). Two findings needed reclassification here:

```
$D628  ff / ff / db   sharedOrigin=true  patternBlock=true
$FC51  5f / ff / ff   sharedOrigin=true  patternBlock=false
```

Both satisfy at least one clause; `$D628` satisfies both. **Zero differences failed all three clauses** — `programMismatches` is empty, `reproduce saeger` exits `0`.

### A real, release-specific timing sensitivity — found, understood, and fixed at the source

The first two `reproduce saeger` runs (before the fix below) genuinely **failed**: 8 real multi-bit divergences at `$E104`–`$E10F` and `$E3E3`, none of which satisfied any drift clause. This was not RAM decay — cross-checked directly against danish's own dumps, the exact same address window holds a **small, fully-reproducible table** in all three of danish's captures (`... 00 00 00 00 07 38 38 ff f8 f8 07 38 07 ff f8 ff ...` at `$E100`–`$E10F`), and two of saeger's three runs reproduced a **phase-shifted** copy of the identical bytes (shifted earlier by one repeating unit), while the third run matched danish's canonical positioning exactly.

**Root cause:** danish's gate polls `$DC00`/`$DC01` directly — an instantaneous hardware read, so a held matrix key is seen on the very next poll, the same CPU cycle every run. Saeger's gate instead waits on the KERNAL's own `GETIN` (`$FFE4`), which only sees a key once the KERNAL's *periodic* keyboard-scan IRQ notices the matrix state — a real-time-dependent number of cycles after the press, since that scan runs on its own schedule, unrelated to when the press's RPC call happens to land. That jitter shifted how many extra iterations of some periodic table-filling process ran before the `$08B1` trigger fired, which is exactly the observed one-step phase shift.

**Fix:** the (since-retired) standalone recovery tool's boot routine gained a second, generic gate-delivery style, selected by a **registry field** (`gate.delivery`, default `"matrix"`) — never a release-id conditional:

- `"matrix"` (danish's `$0900` gate, unchanged): press-and-hold the keyboard matrix.
- `"kernal-buffer"` (saeger's `$08F4` gate): write the KERNAL keyboard buffer (`$C6`/`$0277`) directly — the exact end state a real keypress eventually produces — so `GETIN` is satisfied on its very next call, with no dependency on the scan IRQ's schedule at all.

After the fix, all subsequent `reproduce saeger` runs passed (`ok: true`), with the residual $CB67–$FFFF differences fully absorbed by the same unmodified drift clauses used for danish. `check-parameterisation` was re-run after this change and still passes — the fix added a data-driven branch on a **gate property**, not on a release identifier.

---

## 5. Boot procedure

| | |
|---|---|
| **Method** | `autostart` |
| **Keyboard fallback needed** | no |
| **Host path** | resolved via the `devcontainer-host-path` skill; never hardcoded |

1. `vice_disk_attach({ unit: 8, path })`
2. `vice_autostart({ path })`
3. **`vice_execution_run`** — mandatory, same as danish.
4. Walk the crack's input gate (below).

### The cracktro gate

| Address | Key | Delivery | Why |
|---|---|---|---|
| `$08F4` | `SPACE` | `kernal-buffer` | cracktro "hit any key" poll via the KERNAL's `GETIN` ($FFE4) |

Gates live in `recovery/RELEASES.json` as **data**, not in tool control flow, so adding a release is one registry entry and one invocation — the `delivery` field is exactly this: a per-gate data value, read generically by `boot()`, never branched on a release id.

---

## 6. Clean-slate ritual

Identical to danish's — `reset()` is a step of `recover()`, not an optional courtesy, and is entirely generic code: enumerate and delete every non-`temporary` checkpoint, detach disks 8–11, hard reset with `run_after: false`. See danish's `NOTES.md` §6 for the full rationale; nothing about it changed for this release.

---

## 7. Snapshots — recorded by name only, never committed

Snapshot names for this release's runs (host directory `/home/henrik/.config/vice/mcp_snapshots`, shared across all pool instances, hence the port-number prefix): `p6511_saeger_gameentry_run1`, `p6511_saeger_gameentry_run2`, `p6511_saeger_gameentry_run3` (plus earlier attempts under other ports, all recorded in the registry's `snapshot_names` array and never deleted, since `vice_snapshot_save` has no delete verb).

The same D-07 correction recorded in danish's `NOTES.md` applies unchanged: the `.vsf` is host-side only and is not a committed artifact. Some save attempts in this release's history returned `snapshot_saved: false` (name already existed, since `reproduce` was re-run several times while debugging §4's timing issue) — recorded as `snapshot_saved`/`snapshot_note` in the capture record, and, exactly as designed, **never discarded the capture**.

---

## 8. Operational notes

All of danish's operational notes (`vice_run_until`'s unimplemented `cycles` timeout, most state-reading calls pausing the emulator, `vice_ping` being the exception, this machine being PAL at ~50.125 Hz) apply unchanged — this is the same host VICE, the same generic tooling, and none of it is release-specific.

**Provenance evidence captured during boot** (Tier 1, feeding RECOVER-07 in plan 01-06): the cracktro reads **"BRUCE LEE / cracked in oktober 1984 by / SAEGER SOFT GROUP"**. The post-cracktro title screen is Datasoft's original and unmodified — byte-for-byte the same screen text as danish's: "DATASOFT PRESENTS / BRUCE LEE (TM) / BY RON J FORTIER / PRESS F1-1 PLAYER-2 PLAYERS / F3-COMPUTER OPPONENT / F7-TO BEGIN GAME".

---

## 9. Differences from the other release

Every field below that differs is recorded here as a **property of the disk or of its crack**, never as a code branch — the two procedures are otherwise the same generic code, diffable section-for-section against danish's `NOTES.md` above.

| Field | danish | saeger | Property of |
|---|---|---|---|
| Disk structure | Custom raw-sector loader, `TCS-CRUNCH!` packed payload | Custom raw-sector loader, **uncrunched** | the disk/crack |
| Directory entry | `PRG (closed)`, `BRUCE LEE   (DC)`, T/S 17/0, 178 blocks (well-formed; refutes PROJECT.md's "faked directory" claim — see `recovery/danish/DIRECTORY.md`) | `PRG (closed)`, `BRUCE LEE`, T/S 1/0, 186 blocks (also well-formed — see `recovery/saeger/DIRECTORY.md`) | the disk |
| Cracktro gate address | `$0900` | `$08F4` | the crack |
| Cracktro gate polling style | Direct hardware read: `LDA $DC00 / AND $DC01` | KERNAL-buffered: `JSR $FFE4 (GETIN) / CMP #$20` | the crack |
| Gate key-delivery mechanism needed | `vice_keyboard_matrix` (hold, release at trigger) | `vice_keyboard_matrix` alone was insufficient for byte-identical reproduction; a direct KERNAL-keyboard-buffer write (`delivery: "kernal-buffer"`) was needed to remove IRQ-scan timing jitter | the crack's polling style, not the game |
| Game entry trigger | `$08B1` | **`$08B1` — the same address** | the game (shared, original Datasoft code) |
| Trigger discovery method | Interactive/manual, from the start | Automated `find-entry` was tried first (after fixing a real bug in its CLI verb) but its generic step budget proved too small for an uncrunched loader's much longer boot chain; fell back to the same interactive/manual method danish used | the loader's shape (crunched vs. not), not the game |
| `$139E` input scanner | `LDA $010C / BNE $13AD / LDA $DC00 / AND $DC01 / EOR #$FF` | **byte-for-byte identical** | the game |
| `$01` value at dump time | `$23` (`%00100011`) | `$35` (`%00110101`) | the specific paused instant, not the game — both are valid `$01` configurations, and neither release's game code depends on which one is live at the title-screen dispatcher |
| `bank:"ram"` vs `bank:"rom"` at `$E000` | `4C00E34C06E3...` vs `8556200FBCA5...` | **identical RAM bytes to danish's own reading** | the game (shared loader-written jump table) |
| Tier-1 cracktro text | "Danish Crackers Presents BRUCE LEE" / "DC-011/P" / "They make'em, We break'em." | "BRUCE LEE / cracked in oktober 1984 by / SAEGER SOFT GROUP" | the crack |
| Post-cracktro title screen | Datasoft original | **byte-for-byte identical Datasoft original** | the game |
| Occupied-range disagreement vs. PROJECT.md | Counting-basis nuance only (see `DIRECTORY.md`) | **Genuine numeric disagreement** — PROJECT.md says tracks 1–11/216 sectors; the BAM shows tracks 1–9/186 sectors of game data plus track 18's DOS overhead, with tracks 10–11 entirely free (see `recovery/saeger/DIRECTORY.md`) | the disk (documentation drift, not a parser defect) |

**The flagged assumption in `01-03-PLAN.md` is resolved, but not exactly as anticipated.** The plan worried that `trigger.kind` might need a second legitimate value because saeger's loader has no decrunch stage to step out of. In fact `trigger.kind` stayed `"pc-exec-checkpoint"` and `trigger.address` stayed `$08B1` — identical to danish, because the two cracks load the same original game to the same addresses. The real, load-bearing difference turned out to be **upstream of the trigger**, in how the crack's own *gate* delivers keyboard input to a differently-shaped loader — which the registry's new `gate.delivery` field absorbs as data, exactly as the plan's core constraint requires.

---

## 10. N-readiness rehearsal

`recovery/RELEASES.json` carries a top-level `schema_notes` field stating the mechanical claim: **adding a release requires appending one `releases[]` entry with its `id`, `disk_image` and `disk_sha256` (all other fields `null`/empty, matching the shape both `danish` and `saeger` started from before their first capture), then the executing agent issuing the ordered `mcp__vice__*` calls this file's "Reproducing this dump" section now records — nothing else.**

This was rehearsed against the real validator, not merely asserted:

1. A probe entry `probe-n-ready` was appended, `disk_image` pointing at `saeger.d64`'s existing, real `disk_sha256` (so nothing about the probe's *own* fields would trip an unrelated check), with every unset field `null`/empty in the same shape as `danish`/`saeger` originally had.
2. `node tools/recovery-schema.mjs validate --json` was run. Result:
   ```json
   {
     "ok": false,
     "final": false,
     "errors": [
       "releases[] entry \"probe-n-ready\" has no matching recovery/probe-n-ready/ directory"
     ]
   }
   ```
   **Exactly one error, and it is the missing directory** — not a field-shape mismatch, not a disk-hash mismatch, not anything else. This is the actual mechanical proof that a brand-new entry, shaped like the ones this project already has, needs nothing relaxed in `tools/releases.mjs`'s `upsertRelease` (it already tolerates `boot: null` / `trigger: null` / empty arrays, as both `danish` and `saeger` demonstrated before their own first captures).
3. The probe entry was removed. `node tools/recovery-schema.mjs validate` returns to `OK`.

No code in `tools/releases.mjs` required relaxing for this rehearsal to pass — the null-tolerant shape was already exercised twice, once per real release, before this plan ever ran.

---

## 11. Provenance diff offset (01-05, D-17)

**saeger's offset is proven against danish**, the reference release (`tools/diff-images.mjs`'s reference is the first release in `recovery/RELEASES.json`'s `releases[]` array — currently danish — resolved from the registry, never a hardcoded id).

`node tools/diff-images.mjs anchor-search` selected 8 long (48-byte), non-trivial candidate byte runs from danish's `run1` dump — biased away from the volatile zero-page/stack/KERNAL-work-area zone (`$0000`–`$03FF`), the same drift zone documented in `recovery/danish/NOTES.md` §4 — and located each in this release's `run1` dump with `Buffer.indexOf`. **7 of the 8 anchors produced a unique match**; the 8th matched at two distinct target offsets (a repeating `$00`×8 + `$AA`×40 pattern) and was correctly rejected as non-unique, since a non-unique anchor proves nothing about a single global offset. **All 7 usable anchors agreed on delta 0** — **the proven offset for saeger is 0**, exactly matching what §1 above already established by direct inspection: `$08B1`/`$139E` are byte-for-byte identical between the two releases, so the game genuinely loads at the same addresses in both. The neighbour-byte check (the byte immediately before, at, and after each anchor's resolved position in saeger's dump) showed no off-by-one for any anchor.

The proven offset (0), the anchor count (8), and the agreeing-anchor count (7) are recorded machine-readably in `recovery/RELEASES.json`'s `provenance_offset` field (`role: "target"`, `reference_release: "danish"`), so `recovery/PROVENANCE.md`'s diff is reproducible without re-deriving the anchors.
