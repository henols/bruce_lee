---
name: c64-program-recon
description: Work out how an unknown C64 program is structured at runtime — entry point, interrupt handlers, main loop, game states, graphics and sound — in a fixed order, before disassembling anything. Use when asked to reverse engineer a C64 game, find the main loop, entry point or IRQ handler, locate the player sprite, charset or music player, identify a game state machine, work out which memory regions are code versus data, or decide where to start on a depacked image.
---

# Reconnaissance on an unknown C64 program

**Do not disassemble the whole program first.** The structure hangs off a small fixed set of
well-known addresses: read them in order and the answer falls out. Treated as a search problem it
costs an hour every session; written down it is minutes.

Build a network of confirmed facts. Once the vectors, the IRQ handler, the main loop and the major
tables are known, everything else classifies far more easily.

```bash
D=.claude/skills/c64-program-recon/scripts/derive.mjs   # from the repo root

node $D vectors dump.bin                                # $01 + six vectors, which pair is live
node $D vic --dd00 3E --d018 18 --d011 1B --d016 C8     # bank, screen, charset, mode
node $D sprites --dd00 3E --d018 18 --d015 0F --ptrs 20,21,22,23,FF,FF,FF,FF
```

The script does only the arithmetic that a lookup table cannot — register bits to concrete
addresses — over values **you** fetched through `mcp__vice__*`. It contacts nothing.

## The order

Each step is a read whose answer rules something out. Do not skip ahead: step 6 is cheap once the
handler is known, because that is where most chip writes happen.

| # | Question | Read | What the answer settles |
|---|---|---|---|
| 1 | Where does execution start? | Post-depack: wherever the PC sits at the decrunch checkpoint. There is no BASIC stub to find. | The one address everything else hangs off |
| 2 | Which vector is live? | `$01`, then `$0314/$0315` **or** `$FFFE/$FFFF` | HIRAM (`$01` bit 1) decides. KERNAL out ⇒ the RAM vectors are meaningless |
| 3 | What drives the frame? | `$D01A`, `$D012`, `$DC0D` | `$DC0D` untouched ⇒ raster IRQ; programmed ⇒ the game runs its own timebase |
| 4 | Where is the main loop? | Checkpoint a suspected loop head, run one frame | Two shapes only: a real loop, or a two-instruction spin with the IRQ doing everything |
| 5 | Code or data? | What the PC actually visits across full coverage | A range never executed is data, whatever a tracer guessed |
| 6 | Where is the graphics? | `$DD00` → `$D018` → mode bits → `$D015` → VM+`$03F8` | Every displayed byte, computed. Nothing to search for |
| 7 | Where is the music? | Watch `$D404` | `init` runs once from main code; `play` runs once per frame from the IRQ |
| 8 | Where is the input? | Reads of `$DC00`/`$DC01` | Games poll the matrix directly and ignore the KERNAL buffer |

Then work **backwards from observable effects** rather than reading code sequentially — it is
consistently faster. Watch writes to the sprite coordinates to find movement; watch `$D018` to find
the room loader; watch VM+`$03F8` to find the animation driver. `vice_watch_add` finds *writers*,
and that is its real leverage.

Differential experiments close the loop: patch a routine to `RTS` and see what stops. If enemies
freeze and nothing else does, the routine's purpose is confirmed — far stronger evidence than
reading the listing.

## Worked example — a real capture

```
$ node $D vectors recovery/danish/dumps/danish-gameentry-run1.bin
$01 = $40 %01000000
  bit 0 LORAM  = 0  BASIC ROM  out (RAM at $A000-$BFFF)
  bit 1 HIRAM  = 0  KERNAL ROM out (RAM at $E000-$FFFF)
  bit 2 CHAREN = 0  character ROM at $D000-$DFFF

LIVE VECTOR PAIR: $FFFE/$FFFF (KERNAL banked OUT — the hardware vectors are live)

vector        value   default  status
$0314/$0315  $0101   $EA31   *** RETARGETED ***
…
$FFFE/$FFFF  $1103     --     RAM under ROM
```

Read it as: the KERNAL is banked out, so `$0314`'s `$0101` is **not** a retargeted vector but
uninitialised RAM — ignore it. The live handler is `$1103`, and that is where to arm the first
checkpoint.

Both cracked releases give the same answer, and `$1103` is the same IRQ entry that phase-01 live
work established independently (chain `$1103 → $1574 → $152C`). The method reproduces a known-good
result from a static image with no emulator running. **Confidence: HIGH** for steps 1-2.

## Before you touch the emulator

Two hazards cost this project real sessions. Both are in `references/observation-hazards.md`; these
two lines are the part you cannot afford to load lazily.

- **Pause after every observation.** Agent think-time runs the emulator at full speed — 258 million
  cycles (~262 emulated seconds) elapsed across a handful of reads with zero input sent, which was
  enough to reach `GAME OVER` and to invalidate an earlier finding. Never leave the machine running
  across a reasoning step.
- **When the machine looks frozen, enumerate your own checkpoints first.** An armed *stopping*
  checkpoint on the live IRQ path reproduces the entire "dead emulator" signature — zero cycles,
  `ping` still reporting `running`, an identical PC — because the machine genuinely never moved.
  Two cheap reads settle it, and neither needs `vice_execution_run`.

## Which skill does what

This one is the route between the stations. It does not restate what the others carry.

| Need | Go to |
|---|---|
| A verified 64K image, or comparing two captures | `c64-ram-capture` |
| What a specific address or bit means | `c64-memory-mapping` — `node … lookup '$D018'` |
| Assembling, or a first-pass dead listing | `acme-build` |
| **Which address to read next, and what the answer rules out** | here |

## References

| File | Covers |
|---|---|
| `references/control-flow.md` | Entry point, the six vectors, IRQ source, main-loop shapes, state machines |
| `references/graphics.md` | The VIC derivation chain, the char-ROM shadow trap, sprites, watch targets |
| `references/sound-and-input.md` | SID player vs `$D41B`-as-RNG vs digi; CIA#1 vs CIA#2 |
| `references/observation-hazards.md` | Every way a live read gives a wrong answer. **Read before driving.** |
| `references/reconstruction.md` | Binary inclusion, byte-identity scope, SMC labels, label vocabulary |
| `templates/memory-map.template.md` | Region map with per-row confidence grading |

Findings that make RE faster go in `.planning/RE-FINDINGS.md` **at the moment you find them**,
graded with `Evidence:` and `Confidence:`. Promote by re-logging with the new evidence, never by
editing a grade in place. File-changing work enters through a GSD command (`/gsd-quick`).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `$0314` holds something that is not a plausible address | Check HIRAM. With the KERNAL banked out the RAM vectors are uninitialised; read `$FFFE/$FFFF`. |
| Every graphics pointer is wrong, with no error | `$DD00` bits 0-1 are **inverted**. Re-derive the bank first; everything else hangs off it. |
| The charset at the computed address is garbage | CB may resolve into the char-ROM shadow (`$1000`/`$9000`, banks 0/2). `derive.mjs vic` flags it — there is no charset in RAM to extract. |
| A sprite decodes as noise | Check `$D015` first; a disabled sprite's registers are stale. Then check MCM — multicolor decoded as hires comes out twice as wide. |
| Computed mode is "INVALID — screen goes black" | You caught the registers mid-update inside a raster split. Re-read. |
| The emulator looks dead | Enumerate armed checkpoints before anything else. See hazard 2. |
| `vice_keyboard_type` does nothing | The game polls `$DC00`/`$DC01` directly. Use `vice_keyboard_matrix`. |
| Two captures of the same checkpoint differ | Expected. Full-64K identity is impossible in principle; use `c64-ram-capture`'s drift rules. |
