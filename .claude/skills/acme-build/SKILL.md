---
name: acme-build
description: Assemble Commodore 64 6510 assembly with the ACME cross assembler. Use when asked to assemble, build, compile or link .a/.asm 6502/6510 source, produce a C64 .prg, scaffold a new C64 program, list the symbols a program uses, or turn a .prg back into ACME source.
---

# Assembling C64 source with ACME

Source in, `.prg` out. Everything goes through one script:

```bash
A=.claude/skills/acme-build/scripts/acme.mjs

node $A new game.a          # scaffold a C64 program
node $A build game.a        # assemble -> .prg .sym .vs .rep
node $A sym game.a          # the symbols the program uses
node $A disasm game.prg     # object code back into ACME source
```

Options: `-o FILE` `--out-dir DIR` `-f FORMAT` `--setpc ADDR` `-DSYM=VAL`
`-I DIR` `--no-report` `--json`.

## Build

```bash
node $A build game.a
```
```
built game.prg (55 bytes)  load $0801-$0836  53 bytes of code
symbols: game.sym (4 used / 121 total)
debug labels: game.vs (4 addresses)
```

Four files land next to the `.prg`:

| file | contents |
|---|---|
| `.prg` | the program, with its load address |
| `.sym` | every symbol, with the used ones marked |
| `.vs` | address labels, ready for a debugger or monitor |
| `.rep` | each source line with the address and bytes it produced |

Re-run `build` until it exits 0 — fixing the reported diagnostics reveals the
next layer, and a clean exit means every symbol resolved.

Add `--json` to act on diagnostics programmatically:

```bash
node $A build game.a --json
```
```json
{ "ok": false,
  "diags": [ { "file": "game.a", "line": 3, "severity": "error",
               "zone": "Zone <untitled>",
               "message": "Number does not fit in 8 bits." } ] }
```

Use the `.rep` listing to map source to memory:

```
    16  0801 0b080a00                   !word .eol, 10          ; link to next line, line number
    26  080d a900                       lda #viccolor_BLACK
    27  080f 8d21d0                     sta vic_cbg             ; $d021 background
    29  0814 8d20d0                     sta vic_cborder         ; $d020 border
```

Build variants with `-D`, giving each its own `-o` so the symbol files stay
separate:

```bash
node $A build game.a -DBORDER=2 -o v2.prg    # -> v2.prg v2.sym v2.vs
node $A build game.a -DBORDER=5 -o v5.prg    # -> v5.prg v5.sym v5.vs
```

Inspect the result with `od`:

```bash
od -An -tx1 game.prg | head -2
```

The first two bytes are the little-endian load address (`01 08` = `$0801`); code
follows.

## Writing source

Start from the scaffold — it carries a BASIC stub whose `SYS` target is computed,
so the entry point stays correct as the program grows:

```bash
node $A new game.a
```

Use the C64 symbol library instead of writing addresses by hand:

| `!source <...>` | gives you | example |
|---|---|---|
| `<cbm/c64/vic.a>` | `vic_*` registers, `viccolor_*` constants | `vic_cborder` = `$d020` |
| `<cbm/c64/kernal.a>` | `k_*` KERNAL entry points `$ff81`–`$fff5` | `k_chrout` = `$ffd2` |
| `<cbm/c64/cia1.a>` / `<cbm/c64/cia2.a>` | `cia1_*` / `cia2_*` | keyboard, joystick, timers |
| `<cbm/c64/sid.a>` | `sid_*` | sound |

KERNAL routines use the **`k_`** prefix — `k_chrout`, `k_getin`, `k_setnam`,
`k_plot`. Several have aliases (`k_bsout` and `k_basout` are also `$ffd2`).
Run `node $A sym game.a` to see what a build resolved:

```
addr    $80d  entry
addr   $ffd2  k_chrout
addr   $d021  vic_cbg
addr   $d020  vic_cborder
```

Let `-o` name the output and leave `!to` out of the source, so the filename you
pass is the filename you get.

The 6510's illegal opcodes are always available: `lax dcp sax slo rla sre rra
isc anc alr arr sbx las tas sha shx shy jam`. Verified — `lax $fb / dcp $fc /
sax $fd / slo $02 / anc #$0f / sbx #$10` assembles to
`a7 fb c7 fc 87 fd 07 02 0b 0f cb 10`. Keep `!cpu 6510` at the top of any source
you also assemble by hand, so these stay recognised as mnemonics.

## Disassembly

```bash
node $A disasm game.prg
```
```
		*=$0801
L0801		!by$0b;ANC#      <- BASIC stub, read as data
L0802		php
L0805		 SHX L3032, y
...
L080d		lda #$00         <- code, decoded correctly
L080f		sta Ld021
L0812		lda #$05
L0814		sta Ld020
L081e		jsr Lffd2
L0824		rts
L0825		pha              <- PETSCII string, read as data
```

Read it as a linear decode: the instruction stream is accurate, and strings,
tables and the BASIC stub appear as instructions — interpret those regions as
data. To reassemble the listing, define the out-of-range labels it emits
(`Ld020`, `Lffd2`) and indent its illegal-opcode lines to the operand column.

## Setup

Put `acme` and `toacme` on `$PATH`. For `<...>` library includes, set `$ACME` to
the directory holding `cbm/c64/vic.a` when calling `acme` directly.

Copy `acme.mjs` into any project's `.claude/skills/acme-build/scripts/`, and
`template.a` into `.claude/skills/acme-build/`, to use this elsewhere.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `install the ACME cross assembler and put acme on PATH` | Install ACME. |
| `for <...> includes, set $ACME to …` | `export ACME=<dir holding cbm/c64/vic.a>`. |
| `Value not defined (kernal_chrout)` | Use the `k_` prefix — `k_chrout`. `node $A sym` lists what resolved. |
| `Label name not in leftmost column` + `Syntax error` on a mnemonic | Add `!cpu 6510`. |
| `Output file already chosen` | Remove `!to` from the source and keep `-o`. |
| `Number does not fit in 8 bits` | Pass a value 0–255, or drop the `#` if you meant an address. |
