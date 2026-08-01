# `danish.d64` — the recorded recovery procedure

Danish Crackers release of Datasoft's *Bruce Lee* (Ron J. Fortier, 1984).
Source image `disks/danish.d64`, SHA-256 `1a9d294e07f9593ba59d878423d157bacfe6c6902d3a52ef6ac96512a15fb6c5` — read-only throughout; no tool in this project writes to it.

Everything below was measured against a live host VICE **3.10**, machine **C64SC**, video standard **PAL**.

---

## Reproducing this dump

**Corrected 2026-08-01 (01-04 Task 2).** This section used to open with a single shell command —
a standalone Node CLI verb that reproduced this dump end to end — that no longer exists in this
repository: a 2026-08-01 hard project rule made `mcp__vice__*` the only permitted route to the
emulator, and every standalone script that opened its own connection to VICE was deleted rather
than migrated (see `.planning/STATE.md`, Phase 1 2026-08-01 entries). The three-run reproducibility proof
recorded in § "Reproducibility verdict" below **was performed and its digests are committed** —
deleting the script does not un-produce that evidence. What changed is the *mechanism* for
re-verifying it: a documented, ordered tool-call procedure precise enough for a different agent
session to replay by issuing the same `mcp__vice__*` calls in the same order, in place of one
shell command. This is a named downgrade in **convenience**, not in the evidentiary weight of the
proof already on record.

The ordered procedure, cross-referenced against § "Boot procedure", § "The cracktro gate" and
§ "Clean-slate ritual" below, which already record each step at this precision:

1. `mcp__vice__vice_disk_attach({ unit: 8, path: "disks/danish.d64" })`
2. `mcp__vice__vice_autostart({ path: "disks/danish.d64" })`
3. `mcp__vice__vice_execution_run` — mandatory; autostart only arms the load, the CPU is still
   halted from the reset.
4. `mcp__vice__vice_checkpoint_add({ start: "$08B1", exec: true, stop: true })` — arm the trigger
   before touching any key.
5. `mcp__vice__vice_keyboard_matrix({ key: "SPACE", pressed: true })` — press and hold at the
   `$0900` gate. Confirm via `mcp__vice__vice_registers_get`/`mcp__vice__vice_disassemble` that
   the machine has actually reached the `$0900/$0901` gate loop before pressing; pressing too
   early can be read by the autostart's own simulated typing and corrupt the boot (observed live
   in this session).
6. `mcp__vice__vice_execution_run`, then poll `mcp__vice__vice_ping` (non-pausing) until
   `execution` reports the trigger has stopped the machine.
7. `mcp__vice__vice_keyboard_matrix({ key: "SPACE", pressed: false })` — release, now a program
   event on the same CPU cycle every run, before any memory is read.
8. Sixteen `mcp__vice__vice_memory_read` calls of 4096 bytes each at `bank: "ram"`, concatenated
   in address order into one 65536-byte image; confirm the total is exactly 65536 bytes.
9. `mcp__vice__vice_registers_get`, `mcp__vice__vice_vicii_get_state` and a plain
   `mcp__vice__vice_memory_read` of `$0001` for the chip-state sidecar.
10. `mcp__vice__vice_checkpoint_delete` the trigger checkpoint by its `checkpoint_num`.
11. `mcp__vice__vice_checkpoint_list` and confirm it reports zero checkpoints — accept only this
    enumeration as proof, never the delete call's own return value.
12. `mcp__vice__vice_execution_run` to leave the machine running.

That is the whole procedure — the same recorded steps this file's earlier sections already
describe, now stated as the replay itself rather than as a description of what a deleted script
did. It needs no snapshot, no saved state, and nothing from the host's home directory — only the
disk image in this repository and a reachable VICE MCP server.

**Why three runs and not two:** 93 bytes were identical in runs 1 and 2 yet differed in run 3. Two captures cannot distinguish *"the program writes this byte"* from *"it happened to drift the same way twice"*, so `classifyRunSet` refuses fewer than three.

---

## 1. Dump trigger — a signal, never a duration

| | |
|---|---|
| **Trigger address** | **`$08B1`** |
| **Kind** | `pc-exec-checkpoint` |
| **Armed as** | `vice_checkpoint_add({ start: "$08B1", exec: true, stop: true })` |

`$08B1` is the game's **title-screen input dispatcher** — real game code, reached only after the loader has handed off:

```
$08B1  A5 49     LDA $49
$08B3  05 4A     ORA $4A
$08B5  D0 03     BNE $08BA
$08B7  4C 31 05  JMP $0531
$08BA  A9 00     LDA #$00
$08BC  8D 0E 01  STA $010E
$08BF  20 9E 13  JSR $139E   ; the game's own input scanner
```

and `$139E` reads the CIA data ports directly:

```
$139E  AD 0C 01  LDA $010C
$13A1  D0 0A     BNE $13AD
$13A3  AD 00 DC  LDA $DC00
$13A6  2D 01 DC  AND $DC01
$13A9  49 FF     EOR #$FF
```

**This is explicitly a signal, not an elapsed time.** No wall-clock delay, cycle count or frame count is used anywhere on the path to the dump. That is not stylistic: a duration cannot be re-armed, so a duration-triggered dump makes the reproducibility claim unfalsifiable. `vice_run_until`'s `cycles` argument is documented in its own schema as *"timeout, not yet implemented"* and is deliberately not relied on.

**A bare pause would not work.** `vice_backtrace` taken at an arbitrary asynchronous pause showed KERNAL IRQ `$FF41` in the frame chain — the title screen is IRQ-driven, so `vice_execution_pause` lands at an unpredictable instruction. Only a checkpoint gives a re-armable stop point.

### How `$08B1` was located

Empirically, against the live machine:

1. After `vice_disk_attach` + `vice_autostart` the **CPU is still halted** (`reset` uses `run_after: false`). `vice_execution_run` is mandatory or no loader code executes at all.
2. Once running, the machine settles into a tight loop at `$0900/$0901` — the cracktro's "hit any key" poll.
3. The cracktro then self-runs through further boot-time code at `$0340–$035E` (the cassette-buffer region, a classic loader-stub location), ending on the Danish Crackers sign-off. **Correction (01-04 Task 2, live-verified 2026-08-01):** this step previously grouped `$08F5/$08F7` and `$0D64–$0D82` here as if they were more of the cracktro's animation phases. Live disassembly taken at the post-trigger steady state shows otherwise for both: `$08F5: LDA $DC01 / AND #$10 / BNE $08B1 / JSR $094B` is the title dispatcher's own **permanent joystick poll** — ordinary game code that branches back to the `$08B1` trigger address itself, not defeated loader code — and `$0D30–$0D82` is ordinary per-frame title-screen animation/object-dispatch logic (reads zero-page flags `$40`/`$29`/`$42CA`, self-modifies a store at `$0D87`, calls `$10D0`). Both are recorded in `recovery/RELEASES.json`'s `rejected_candidates` with their disassembly and reasons rather than in `loader_ranges`. This is the exact misclassification recorded in `.planning/STATE.md` 2026-07-31 (113 false-positive hits from ordinary idle looping at the title screen) — corrected here at its source in this file, not just in the registry, so the prose that produced it cannot produce it again. Only `$0340–$035E` is accepted as a loader-reentry range: its post-trigger disassembly decodes as the single repeated byte `$01` across the whole span (`$0340: 01 01 ORA ($01,X)` ... `$0356: 01 01 ORA ($01,X)`), consistent with stale raw-sector-loader scratch never reclaimed by the game, and it registered exactly zero hits across a no-input idle calibration window (24,396,568 cycles advanced) before this file's own reproduction procedure below was ever re-run.
4. Execution settles into a stable two-cluster steady state across `$08B1–$08F8` and `$139E–$142B`, with Datasoft's original title screen displayed.
5. `vice_disassemble` confirmed `$08B1` is a genuine routine entry, not a mid-instruction landing.

---

## 2. `$01` port configuration at dump time

**Live value: `$23` = `%00100011`** (decimal 35), read with a plain `vice_memory_read`.

| Bits | Value | Meaning |
|---|---|---|
| 0–2 (LORAM/HIRAM/CHAREN) | `%011` | BASIC ROM at `$A000–$BFFF`; KERNAL ROM at `$E000–$FFFF` |
| 2 (CHAREN) | `0` | Character ROM visible at `$D000–$DFFF` |
| 3 | `0` | Datasette output low |
| 4 | `0` | A datasette button reads as pressed |
| 5 | `1` | Datasette motor off |

**No `$01` write was performed at any point.** `vice_memory_read({ bank: "ram" })` reaches the RAM underneath both ROMs and the I/O area with no side effects, so D-08's guarded `$01`-manipulation fallback stays documented and unexercised.

That was verified *with the game running*, not merely on an idle machine — the same 16 bytes at `$E000` read differently through the two banks:

```
bank:"ram"  4C 00 E3 4C 06 E3 4C 9E E4 26 D7 AA E6 26 D7 AA
bank:"rom"  85 56 20 0F BC A5 61 C9 88 90 03 20 D4 BA 20 CC
```

The `bank:"ram"` bytes are a **jump table the loader wrote into RAM under the KERNAL ROM** — proof both that bank scoping works and that this game genuinely uses that RAM.

### ⚠ `$0000` and `$0001` in the `.bin` are NOT the banking registers

`$0000` is the 6510's on-chip **data-direction register** (`D6510`) and `$0001` is the **processor port** (`R6510`). Neither is memory. Read through `bank:"ram"` they returned `$a9/$40`, `$70/$40` and `$0f/$40` across the three runs — *not* the live `$23`.

**Anyone reading offset 1 of the image as the banking state will get a wrong answer.** The authoritative value is `port01_value` in the capture record. `$0000–$0001` are excluded from the reproducibility comparison for this reason.

---

## 3. Captured address ranges

| | |
|---|---|
| **Range** | `$0000–$FFFF` — a single range, all 65536 addresses |
| **Bank** | `ram` for every read |
| **Chunk size actually used** | **4096 bytes** (a single 65536-byte read was attempted first and fell back) |
| **Bytes read** | 65536 |
| **Image layout** | File offset **equals** CPU address (D-01) |

Because every read used `bank: "ram"`, the image holds **pure underlying RAM across the whole map**, including the `$A000–$BFFF`, `$D000–$DFFF` and `$E000–$FFFF` windows that were shadowed by ROM at dump time.

A short read aborts the capture with a non-zero exit and writes **no** `.bin`. The image is never zero-padded or short-filled up to 65536 bytes.

---

## 4. Reproducibility verdict

Three independent cold-boot captures:

| Run | SHA-256 |
|---|---|
| run1 | `138350968375fcd502c76bb219c996ecaf052158670ba0166f6722dddfab70e5` |
| run2 | `0d21fb071e63df8540db829628c904fe21d263c67c62a6fde674bed3dbe5aeb2` |
| run3 | `969c878b4564d659aa25ac8db1fb8afa469adb1532a26b4ebd42510912676755` |

**The three digests differ, and that is expected.** Stability by zone, where *unstable* means "not identical across all three runs":

| Zone | Unstable |
|---|---|
| `$0000–$0001` 6510 on-chip port registers | 1 |
| `$0002–$00FF` zero page | **0 — IDENTICAL** |
| `$0100–$01FF` stack page | 24 |
| `$0200–$03FF` KERNAL work area / BASIC input buffer | 187 |
| **`$0400–$CB66` program image** | **0 — IDENTICAL** |
| `$CB67–$FFFF` upper RAM | 184 |

**65,140 of 65,536 bytes are stable. The loaded game image is byte-identical across three independent cold boots.**

### Why full-image identity is impossible here

Never-written RAM **drifts continuously while the emulator runs**. Measured three ways with no game involved at all:

- 994 bytes differing between two 20-second idle runs on a bare machine;
- 1014 on a repeat;
- 993 between two back-to-back power-on captures with the machine never deliberately run — drift accumulates *during* the capture itself.

Two consequences, both learned the hard way:

- `vice_machine_reset({ mode: "hard" })` reports *"Machine power cycled"* but does **not** restore pristine RAM once the machine has run — real hardware behaves the same way, since reset does not clear DRAM. **There is no stable reference image at any instant**, so baseline-difference classification cannot work.
- Drift is **stochastic per run**. An idle control that recorded 1014 drift-prone addresses covered only **2 of 137** real differences, so drift can never be excluded by address list.

### The rule that is applied

A difference is accepted as drift only if it satisfies at least one of three clauses, each independently justified and **none of them a tunable number**:

1. **Inside volatile scratch** — `$0000–$0001` (CPU registers, not RAM), `$0100–$01FF` (stack; bytes below the live SP are dead call frames), `$0200–$03FF` (KERNAL work area, not owned by the game).
2. **A shared single-bit drift origin** — one origin byte from which every observed value is at most one bit away, searched exhaustively over all 256 candidates. Necessary because drift accumulates *independently per run*: at `$DD0C` the three runs read `00 / 04 / 10`, each one bit from `$00`, yet `04` vs `10` is two bits apart. A pairwise comparison overcounts that.
3. **A pure power-on pattern block** — every one of the 15 neighbouring bytes is exactly `$00` or `$FF` in all runs. Deliberately binary rather than a percentage; an earlier "90% of the block" heuristic scored 134/137 and was **rejected**, because tuning a percentage until the suite passes is how false confidence gets manufactured.

Anything failing all three clauses is a real divergence and fails the gate. On these three captures, **zero** differences failed, and the only two that needed clauses 2 or 3 satisfied **both**:

```
$DA7B  00 / 00 / 0a   sharedOrigin=true  patternBlock=true
$DD0C  00 / 04 / 10   sharedOrigin=true  patternBlock=true
```

**Known limit, recorded rather than hidden:** a genuine divergence that happens to sit inside a pattern block *and* within one bit of a shared origin would be misread as drift. Every reclassified byte is therefore listed with its values and the clauses it matched, so a reviewer can audit the set rather than trust a boolean.

---

## 5. Boot procedure

| | |
|---|---|
| **Method** | `autostart` |
| **Keyboard fallback needed** | no |
| **Host path** | resolved via the `devcontainer-host-path` skill; never hardcoded |

1. `vice_disk_attach({ unit: 8, path })`
2. `vice_autostart({ path })`
3. **`vice_execution_run`** — mandatory. Autostart only *arms* the load; the CPU is still halted from the hard reset.
4. Walk the crack's input gates (below).

If `autostart` had failed to move the PC, the fallback is a scripted `LOAD"*",8,1` + `RUN`. It was not needed for this release, but the branch exists and records `boot.fallback_used`.

### The cracktro gate

| Address | Key | Why |
|---|---|---|
| `$0900` | `SPACE` | cracktro part 1 "hit any key" poll |

Gates live in `recovery/RELEASES.json` as **data**, not in tool control flow, so adding a release is one registry entry and one invocation.

Three delivery mechanisms were measured; only the third works:

| Mechanism | Key seen? | Reproducible? |
|---|---|---|
| `vice_keyboard_type` | ✗ — the crack polls `$DC00/$DC01` directly, bypassing the KERNAL buffer | — |
| `vice_execution_run` + a wall-clock hold | ✓ | ✗ — the release lands on a different CPU cycle each run: **264 of 65536 bytes differed**, including `$0049`, the very byte the trigger routine reads, plus the whole stack page |
| `vice_execution_step(fixed count)` | ✗ — the machine sat at `$0900` for 150 s | ✓ |
| **press at the gate, HOLD, release at the trigger checkpoint** | ✓ | ✓ |

The working design holds `SPACE` from the `$0900` gate until the `$08B1` checkpoint fires, then releases it **before any memory is read**. The release is therefore a program event — the same CPU cycle every run — and the captured image has no key artificially held down in the CIA state.

---

## 6. Clean-slate ritual

`reset` is a **step of `recover`**, not an optional courtesy, so a capture cannot silently inherit a previous session's state. In order:

1. `vice_checkpoint_list`, then `vice_checkpoint_delete` each id individually — no bulk-clear tool exists. Checkpoints VICE marks `temporary` are **skipped**: `vice_run_until` creates and auto-reaps those, so deleting a stale id is a hazard. Delete failures warn and continue.
2. `vice_disk_detach` units 8 through 11, tolerating failures.
3. `vice_machine_reset({ mode: "hard", run_after: false })`.

---

## 7. Snapshots — recorded by name only, never committed

Snapshot for this run: **`p6512_danish_gameentry_run1`**, in the host's `/home/henrik/.config/vice/mcp_snapshots`.

**The `.vsf` is not a committed artifact, and cannot be.** This supersedes CONTEXT.md decision D-07, which assumed it would sit alongside the `.bin`. `vice_snapshot_save` accepts only a `name` (plus `description`/`include_roms`/`include_disks`), writes host-side, and **no tool in the 64-tool surface exports snapshot bytes back into this container.**

Consequences:

- The committed per-dump set is the `.bin` plus its `.capture.json` (a `.state.json` and `.map.json` arrive in plan 01-02). There is no fourth file.
- Names are always explicit (`<release>_gameentry_<run>`), never `snapshot.vsf`.
- **A snapshot failure never discards a capture.** `snapshot_save` refuses to overwrite an existing name and there is no delete verb, so failures are expected; they are recorded as `snapshot_saved: false` with the reason and the capture proceeds. Coupling an essential artifact's fate to a disposable convenience would have been backwards.
- Reproducibility runs through the **recorded procedure**, which is strictly stronger than a replayed blob: it works for someone who does not have this host's snapshot directory.

---

## 8. Operational notes

**If a run appears hung.** `vice_run_until`'s `cycles` argument is unimplemented, so nothing server-side bounds a run to a wrong address. Every wait here is bounded client-side and fails loudly instead. Recovery from a genuinely wedged emulator is a **host-side VICE restart**, which this container cannot perform.

**Most state-reading `vice_*` calls pause the emulator and do not resume it.** Measured: with a resume issued as the last call before a quiet interval, the machine sustains **~991,000 cycles/s (100% of PAL)**; polled in a loop with no explicit resume it drops to **~6,000 cycles/s (0.7%)**, which is why a checkpoint can appear to "never fire" when in fact almost no cycles have executed. `vice_ping` is the exception — it does **not** pause the machine (~987,000 cycles/s while ping-polling), so it is the right call to poll with. `Speed:100`/`WarpMode:0` are not implicated.

**This machine is PAL, ~50.125 Hz.** Several MCP tool docstrings quote "~16.7 ms per frame at 60 Hz". That figure is wrong here and must never be used for timing arithmetic. A PAL frame is ~19.95 ms.

**Provenance evidence captured during boot** (Tier 1, feeding RECOVER-07 in plan 01-06): the cracktro reads "Danish Crackers Presents BRUCE LEE" with a scroller carrying the release id **DC-011/P** and the sign-off "They make'em, We break'em." This independently corroborates the CSDb record found during research — the artifact itself agrees with the database. The post-cracktro title screen is Datasoft's original and unmodified: "DATASOFT PRESENTS / BRUCE LEE (TM) / BY RON J FORTIER".
