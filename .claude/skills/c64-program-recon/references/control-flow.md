# Control flow: entry point → vectors → IRQ source → main loop → structure

Source: `.planning/RE-FINDINGS.md` § Control-flow discovery method (2026-08-01, **MEDIUM**,
doc-derived) except where a line says otherwise. The vector-table step was confirmed against
this project's own captures on 2026-08-04 — see the bottom of this file.

## 1. Entry point — three routes, and post-depack is a different question

| Situation | Where the entry point is |
|---|---|
| BASIC stub at `$0801` | A tokenized `SYS <addr>` line. The address is plain PETSCII digits in the stub, so it reads straight out of the load image with no interpretation. |
| Autostart / non-BASIC | The `.prg` load address (first two bytes), the RESET vector at `$FFFC/$FFFD`, or a cartridge CBM80 signature at `$8000`. |
| **Post-depack — this project's case** | Wherever the PC sits when the decrunch checkpoint fires. A different question with a different answer. |

For a depacked image there is no BASIC stub to find. Do not spend time looking for one.
`c64-ram-capture` § Find an entry point gives the live procedure: step in batches until PC and
SP settle into a repeating range across three consecutive batches.

## 2. Vectors — six pairs, and `$01` decides which pair is live

| Vector | Default | Meaning |
|---|---|---|
| `$0314/$0315` | `$EA31` | CINV, KERNAL IRQ (RAM, indirect). Changed ⇒ the per-frame handler is at the new target |
| `$0316/$0317` | `$FE66` | CBINV, BRK |
| `$0318/$0319` | `$FE47` | NMINV, NMI. Commonly retargeted by music players and anti-tamper code |
| `$FFFA/$FFFB` | — | Hardware NMI |
| `$FFFC/$FFFD` | — | Hardware RESET |
| `$FFFE/$FFFF` | — | Hardware IRQ/BRK |

**The hardware pairs are only live when the ROMs are banked out via `$01`.** The deciding bit is
HIRAM, `$01` bit 1 (RE-FINDINGS 2026-08-02). HIRAM = 1 ⇒ KERNAL ROM is in and `$0314/$0315` is
live. HIRAM = 0 ⇒ RAM at `$E000-$FFFF` and `$FFFE/$FFFF` is live.

`node derive.mjs vectors <image.bin>` does this decode over a captured image.

The second tell is the handler's own first instruction: the KERNAL's register-save preamble means
the KERNAL path is in use; a jump straight into game code means it is not.

**A garbage-looking `$0314` is not a bug when HIRAM = 0.** With the KERNAL banked out, nothing
maintains the RAM vectors and they hold whatever was last there. Read the live pair, not both.

## 3. IRQ source — two enable masks close the question

- **Raster IRQ** — `$D012` (raster compare), `$D011` bit 7 (raster bit 8), `$D01A` (IRQ enable
  mask), `$D019` (latch, which the handler must acknowledge). **A handler that writes a new
  `$D012` on its way out is a split raster chain**, and each such write is one more IRQ position
  to enumerate.
- **CIA timer IRQ** — `$DC0D` (CIA#1, drives IRQ) and `$DD0D` (CIA#2, drives NMI), with
  `$DC04-$DC07` / `$DD04-$DD07` for the periods.

A game that never touches `$DC0D` is on a raster IRQ. One that programs `$DC04-$DC07` and enables
timer A has its own timebase. Read the two enable registers before reading any handler code.

## 4. Main loop — decide the shape before hunting

- **Real main loop** — an unconditional backward branch or `JMP` to a nearby earlier address that
  never returns, usually preceded by a frame-sync wait: polling `$D012` for a fixed raster line, or
  spinning on a flag the IRQ handler sets.
- **IRQ-does-everything** — the main loop is a two-instruction spin and all logic hangs off the
  raster IRQ. Common enough that assuming the first shape wastes the search.

**The honest test is live, not static.** The address that repeats exactly once per frame in an
execution trace is the main loop, whatever the listing suggests.

## 5. Four structural features a linear disassembler gets wrong

- **Jump tables and dispatch** — `JMP ($xxxx)` and `JSR` into an indexed table. This is where game
  state machines live, and exactly what a linear decoder mis-decodes.
- **Self-modifying code** — writes into `$0800-$CFFF` from code that also executes there. Common
  for animation frame pointers.
- **Zero page** — the game's hot variables. The highest-frequency ZP addresses in a trace are the
  state worth naming first.
- **Code/data separation** — the project's standing rule (`.claude/CLAUDE.md` § Stack Patterns): a
  range never hit as an instruction stream across full gameplay coverage is data, regardless of
  what the tracer guessed. The provenance diff between the two cracked releases is the second check
  on the same question.

## Finding the state machine

Most games have one even when it is not explicit. Two shapes:

```asm
    LDA GameState        ; indexed dispatch — the common shape, and the one
    ASL                  ; a linear disassembler turns into nonsense
    TAX
    LDA StateTable,X
    STA JumpVector+1
    LDA StateTable+1,X
    STA JumpVector+2
JumpVector:
    JMP $FFFF            ; operand is patched at runtime
```

```asm
    LDA GameState        ; compare chain — easier to read, easier to find
    CMP #STATE_TITLE
    BEQ TitleState
```

Finding the state variable gives a high-level map of the whole program. A practical route: pause
at a title screen and again in gameplay, diff the two captures, and look for a single byte that
changed in zero page or low RAM. `vice_memory_compare` narrows this; `c64-ram-capture` § Compare
two captures gives the volatility rules that stop you chasing drift.

## Verified against this project — 2026-08-04

Running `derive.mjs vectors` cold on `recovery/danish/dumps/danish-gameentry-run1.bin` and
`recovery/saeger/dumps/saeger-gameentry-run1.bin` returns, for both releases:

- `$01` = `$40` — LORAM 0, HIRAM 0, CHAREN 0. KERNAL and BASIC banked out.
- Live pair is therefore `$FFFE/$FFFF`, which holds **`$1103`**.
- `$0314/$0315` holds `$0101`, i.e. nothing meaningful — as expected with HIRAM = 0.

`$1103` is the same IRQ-handler entry that phase-01 live work independently established, with the
raster-split chain `$1103 → $1574 → $152C` (RE-FINDINGS 2026-08-02, checkpoint-trap entry). The
method reproduces a known-good result from a static image with no emulator running.

**Evidence:** derived mechanically from three-run-verified captures, cross-checked against a live
finding recorded independently.
**Confidence:** HIGH for the vector-table step and the HIRAM rule. The remaining steps in this
file stay MEDIUM until exercised the same way.
