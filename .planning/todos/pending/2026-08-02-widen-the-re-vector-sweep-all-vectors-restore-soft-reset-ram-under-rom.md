---
created: 2026-08-02T10:57:57.172Z
title: Widen the RE vector sweep — all vectors, live RESTORE and soft reset, ROM vs RAM-under-ROM
area: tooling
severity: minor
files:
  - .planning/RE-FINDINGS.md:290-309
  - .planning/todos/pending/2026-08-01-collect-c64-reverse-engineering-findings-into-a-fast-re-skill.md:149-153
  - .claude/skills/c64-memory-mapping/SKILL.md
  - recovery/danish/dumps/danish-gameentry-run1.bin
---

## Problem

The vector step of the RE method — `.planning/RE-FINDINGS.md` § *"the vector table: six pairs,
and `$01` decides which pair is live"* (2026-08-01, MEDIUM, doc-derived) — is the second step of
the whole control-flow procedure (entry point → **vectors** → IRQ source → main loop → structure).
It has three gaps, and the third one lets the method return a confidently wrong answer.

### 1. Six pairs is not "all vectors"

The logged table covers `$0314/$0316/$0318` and `$FFFA/$FFFC/$FFFE` — the IRQ/BRK/NMI set. The
sweep should cover every indirection a C64 program can be sitting behind:

| Block | Range | Why it matters here |
|---|---|---|
| BASIC indirects | `$0300–$030B` | error, main, crunch, qplop, gone, eval — a program that returns to a modified BASIC prompt hooks these |
| KERNAL IRQ/BRK/NMI | `$0314–$0319` | already logged |
| KERNAL I/O indirects | `$031A–$0333` | OPEN, CLOSE, CHKIN, CKOUT, CLRCHN, BASIN, BSOUT, STOP, GETIN, CLALL, USRCMD, LOAD, SAVE |
| Autostart / cartridge block | `$8000` cold, `$8002` warm, `$8004` `CBM80` signature | the standard "survive a reset" trick |
| BASIC ROM entry | `$A000/$A002` | only meaningful with BASIC banked in — check `$01` first |
| Hardware vectors | `$FFFA/$FFFC/$FFFE` | already logged |

Two of these are directly on this project's critical path. **`$0328` (STOP) and `$0330/$0332`
(LOAD/SAVE) are exactly where a cracker hooks** — both disks use custom raw-sector loaders that
bypass KERNAL, so a diverted LOAD vector is a provenance signal, and a diverted STOP vector is
anti-tamper. Neither is currently looked for.

### 2. The entry is static-only; RESTORE and soft reset are drivable and unexercised

RESTORE and reset are the two ways a real user perturbs a running game, and both are one tool
call away:

- `mcp__vice__vice_keyboard_restore` — press/release, triggers NMI, *not in the keyboard matrix*
  (so `vice_keyboard_key_press` cannot reach it). NMI will not retrigger until the line is
  released, so it is a press→release **edge**, not a level.
- `mcp__vice__vice_machine_reset` — `mode: 'soft'` (CPU reset) or `'hard'` (power cycle),
  with `run_after`.

What the game does when each fires — traps it, hangs, returns to title, cold-starts — is
behaviour the static table cannot predict, and it is the cheapest possible confirmation that the
vector you read is the vector that actually runs.

### 3. A vector target in a ROM window is ambiguous, and the method currently stops at "check `$01`"

This is the part that can produce a wrong answer. A target in `$E000–$FFFF` (or `$A000–$BFFF`,
or `$D000–$DFFF`) is **either KERNAL/BASIC/IO ROM or the RAM underneath it**, depending on `$01`
at the moment the vector is taken. The logged entry says to check `$01` and stop; it never says
how to read the RAM below.

It is one extra call. `mcp__vice__vice_memory_read` takes a `bank` parameter — its own schema
says *"e.g. 'ram' to read RAM under ROM"* — and `mcp__vice__vice_memory_banks` lists what is
available. So the disambiguation is: **read the vector target twice, once through the default
bank and once through `ram`, and compare.** If the `ram` read differs from stock KERNAL at that
address, the game has its own code hidden under ROM, which is a large structural finding and is
currently not being looked for at all. If the two agree with stock KERNAL bytes, the vector
genuinely lands in ROM and the KERNAL path is in use.

The existing entry's second tell — "the handler's own first instruction: the KERNAL's
register-save preamble means the KERNAL path is in use" — is a weaker version of the same check,
and it silently reads whichever bank happens to be mapped.

## Solution

1. **Extend the vector table in `.planning/RE-FINDINGS.md`** to the full block list above. Do not
   edit the 2026-08-01 entry's grade — append a new dated entry; promotion is by re-logging.

2. **Add the bank-disambiguation rule** as its own finding: for any vector whose target lands in
   a ROM window, read it through the default bank *and* through `bank: 'ram'`, compare, and
   record which one the program is actually executing. Record the stock KERNAL bytes used as the
   comparison baseline so the check is reproducible.

3. **Exercise the perturbations live**, on a real capture rather than on paper:
   - checkpoint on the NMI target, then `vice_keyboard_restore` press → release, and see where
     the PC lands;
   - `vice_machine_reset {mode:'soft'}` and then `{mode:'hard'}`, and record what survives each;
   - confirm whether a `CBM80` block at `$8000` is present and whether it is what catches the
     reset.

4. **Fold the result into the RE skill's decision procedure** at its "vectors" step
   ([[2026-08-01-collect-c64-reverse-engineering-findings-into-a-fast-re-skill]], Solution step 3).
   The order and the decision points belong in the skill; any per-address register detail belongs
   in `c64-memory-mapping` — audit it for the `$0300–$0333` table before writing a second copy.

5. **Test cold against `recovery/danish/dumps/danish-gameentry-run1.bin`** (three verified
   gameentry captures are on disk) and re-log every confirmed MEDIUM entry at HIGH with the live
   evidence.

**Hazards to respect while running this:** most state reads pause the emulator — read first, poll
with `vice_ping`, resume exactly once at the end. Compare the restart epoch across the bracket; a
*deliberate* `vice_machine_reset` is the experiment, but an unintended broker restart in the same
bracket voids the run and will look like "the game survived a reset". None of this is
Bruce-Lee-specific, so it ships with the RE package
([[2026-08-01-pack-the-whole-c64-re-toolkit-including-the-vice-mcp-into-one-package]]).
