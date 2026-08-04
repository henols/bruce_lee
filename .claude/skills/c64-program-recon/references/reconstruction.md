# Turning findings into ACME source

Do not wait until everything is understood. Stand up a buildable tree early, include the
unidentified bulk as binary, and replace regions with real source as they are confirmed. The tree
stays assemblable at every commit, so a regression has a small blast radius.

`acme-build` covers assembling; this file covers the shape of the source and the verification
milestone.

## Start with binary inclusion

```asm
* = $4000
!binary "unknown_4000_5fff.bin"
```

Then replace piece by piece, keeping the addresses fixed:

```asm
* = $4200

UpdatePlayer:
    ; reconstructed code
```

A layout that keeps this workable:

```
src/
  main.a          zeropage.a      irq.a
  input.a         player.a        enemies.a
  collision.a     graphics.a      music.a
  data/
    sprites.a     levels.a        text.a
```

## Byte-identity is the first milestone — and it is narrower than it sounds

> Reassemble the source and produce exactly the original **extracted region**.

That proves addresses, code and data boundaries, alignment, padding and binary inclusions are all
right. It is a much stronger signal than "it seems to work".

```bash
cmp original.prg rebuilt.prg
sha256sum original.prg rebuilt.prg
```

**Scope this claim carefully.** Byte-identity applies to the assembled artifact against the
extracted region. It does **not** apply to a 64K RAM capture: never-written RAM drifts
continuously, so full-64K byte-identity is impossible in principle (`observation-hazards.md` § 7).
Two different questions that both use the word "identical".

**This project's definition of correctness is behavioural equivalence** — replay plus checkpoint
comparison (`.claude/CLAUDE.md` § Constraints). Byte-identity is the stronger, earlier check on
the *reconstruction*, not a replacement for the behavioural one. Anything not observable at a
checkpoint is not verified.

After identity holds you can safely rename routines, reorganise files, replace constants with
symbols and add macros. **Be careful:** reorganising changes addresses, which breaks
self-modifying code and timing-sensitive raster routines. Re-verify after each reorganisation, not
at the end of several.

## Self-modifying code needs explicit labels

A static disassembler sees `LDA $FFFF,X` and cannot know the operand is written at runtime:

```asm
    LDA SourceAddress
    STA CopyLoop+1
    LDA SourceAddress+1
    STA CopyLoop+2
CopyLoop:
    LDA $FFFF,X
    STA $0400,X
```

Name the patched location so the intent survives:

```asm
CopySource = CopyLoop + 1
```

Look for writes to the byte after an opcode, the two bytes after a `JMP`/`JSR`, branch operands
and immediate constants — `STA Routine+1`, `STX Routine+2`, `INC Routine+1`.

## Label vocabulary: name from evidence, promote on confirmation

Provisional names that carry their own uncertainty beat confident names that turn out wrong:

| Prefix | Means |
|---|---|
| `ZP_` | unknown zero-page variable |
| `State_` | state variable |
| `Flag_` | boolean or bit field |
| `Counter_` | counter |
| `Ptr_` | pointer |
| `Table_` | lookup table |
| `IRQ_` | interrupt routine |
| `Maybe_` | plausible but unconfirmed |
| `Unknown_` | no reliable interpretation yet |

`Routine_43A2` → `Maybe_UpdatePlayer` → `UpdatePlayerPosition`, promoted only when behaviour is
confirmed. Avoid `AmazingCollisionRoutine`-style names entirely; they encode a guess as a fact.

Record the confidence next to the thing, in the same grammar the project uses everywhere else:

```asm
; Confirmed: decremented once per frame while the player is invulnerable.
; Evidence: live, watch on $D015 during damage. Confidence: HIGH.
PlayerInvulnerabilityTimer:
    !byte 0
```

## Data tables a linear disassembler destroys

The split low/high address table is the classic:

```asm
AddressLo:  !byte <Room0, <Room1, <Room2
AddressHi:  !byte >Room0, >Room1, >Room2
```

Without recognising the pair, a disassembler shows meaningless instructions. Other data tells:
referenced through indexed loads, repeated byte patterns, valid PETSCII or screen codes,
sprite-sized 64-byte blocks, values matching VIC-II coordinates.

Code tells: reachable through `JSR`/`JMP`/branches/vectors, **executes during tracing**, plausible
control flow. The project's standing rule settles ties — a range never hit as an instruction
stream across full gameplay coverage is data, whatever the tracer guessed.

## Labels round-trip through VICE

ACME's `--vicelabels` output and regenerator2000's exported label files share one format, which
`vice_symbols_load` / `vice_symbols_lookup` consume. Labels therefore flow
disassembler → source → build → debugger without translation. `acme-build` emits the `.vs` file on
every build; load it after each one and your checkpoints carry real names.
