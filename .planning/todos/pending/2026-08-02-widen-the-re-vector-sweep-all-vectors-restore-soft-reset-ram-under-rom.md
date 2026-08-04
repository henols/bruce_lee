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

## Status 2026-08-04 (quick task 260804-eu6) — the static half is DONE, and it found two new facts

Steps 1, 2 and 4 are discharged; step 3 and the live half of step 5 are blocked on the broker.

**Step 1 — all vectors.** `derive.mjs vectors` now sweeps every block in this todo's table:
`$0300-$030B` BASIC indirects, `$0314-$0319` IRQ/BRK/NMI, `$031A-$0333` KERNAL I/O indirects,
`$8000`/`$8002` with a real `CBM80` signature check at `$8004`, `$A000/$A002` BASIC ROM entry, and
`$FFFA-$FFFF` hardware. It prints the IRQ and hardware blocks by default and takes `--all` for the
rest, so the common case did not get longer. `$0328` STOP and `$0330`/`$0332` LOAD/SAVE are flagged
as cracker-hook sites, per this todo's point that neither was being looked for.

**Step 2 — bank disambiguation.** Any target landing in `$A000-$BFFF`, `$D000-$DFFF` or
`$E000-$FFFF` is now marked `bank-ambiguous` and left unresolved, with the two-read rule stated in
`control-flow.md`: read it through the default bank and through `bank: "ram"`, compare, record which
one the program executes, and record the stock bytes used as the baseline. Logged at **MEDIUM** —
doc-derived from the tool schema, not yet run.

**Step 4 — folded into the skill, and `c64-memory-mapping` was audited first** as this todo asked.
It already resolves `$0300`, `$0314`, `$0328`, `$0330`, `$A000` and `$8000` (including the `CBM80`
signature bytes) from two independent sources, so **no register table was copied.** The skill carries
the block list, the ordering and the judgement; per-address detail stays a `lookup` call away.

### Two new facts, from the first run

Run over all six committed gameentry captures. Every value identical across all three runs of its
release, so none of it is drift:

| Vector | danish | saeger | Reading |
|---|---|---|---|
| `$FFFA/$FFFB` NMI | `$1116` | `$1116` | **New** — the game installs its own NMI handler under KERNAL ROM |
| `$FFFC/$FFFD` RESET | `$1116` | `$1116` | **New** — RESET funnels to the *same* address as NMI |
| `$0328/$0329` ISTOP | `$F6FC` | `$F6ED` (stock) | **New divergence** — but residue, see below |
| `$8004` `CBM80` | absent | absent | Nothing catches a reset via the cartridge route |

**NMI and RESET share one entry point**, which is the shape of an anti-tamper trap: the two ways a
user perturbs a running game both land in the same place. That interpretation is **LOW confidence
and unexercised** — and it makes step 3 concrete, because there is now a specific address to
checkpoint (`$1116`) rather than a general intention to try RESTORE.

**A rule this produced, and a near-miss worth recording.** `$01 = $40` in both releases, so the
whole `$0300-$0333` block is dormant — nothing maintains it, and its bytes are the KERNAL's own
boot-time values partly overwritten. The first draft of the sweep printed
`*** CRACKER-HOOK SITES DIVERTED ***` for danish's `$0328` and **was wrong**. `derive.mjs` now
labels such blocks `DORMANT` and reports non-default values as *residue*, firing a hook alarm only
for a live block. A residue byte that differs between releases is a provenance question for
`c64-provenance-diff`, not a structural one.

### What is left

**Step 3 in full, and step 5's live half.** The broker is not running — `vice_diagnose` reports no
`broker.json` record exists at all — so no perturbation could be exercised. The experiment is now
fully specified: checkpoint `$1116`, `vice_keyboard_restore` press→release, then
`vice_machine_reset` soft and then hard, recording where the PC lands each time and what survives.
`$8004` already answers the `CBM80` half of step 3 statically: absent in both releases.

**Hazards to respect while running this:** most state reads pause the emulator — read first, poll
with `vice_ping`, resume exactly once at the end. Compare the restart epoch across the bracket; a
*deliberate* `vice_machine_reset` is the experiment, but an unintended broker restart in the same
bracket voids the run and will look like "the game survived a reset". None of this is
Bruce-Lee-specific, so it ships with the RE package
([[2026-08-01-pack-the-whole-c64-re-toolkit-including-the-vice-mcp-into-one-package]]).
