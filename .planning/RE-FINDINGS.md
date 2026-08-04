# Reverse-Engineering Findings Log

Append-only. Raw material for the RE skill
(`.planning/todos/pending/2026-08-01-collect-c64-reverse-engineering-findings-into-a-fast-re-skill.md`).

Governed by `.claude/CLAUDE.md` § Reverse-Engineering Findings Log. Log at discovery, not at
session end. Negative findings count. Do not suppress a finding as "probably already known" —
duplication is free, omission is not.

**Entry format**

```
### YYYY-MM-DD — one-line finding

**Type:** shortcut | trick | hazard | dead end | confirmation
**Evidence:** how it was established (live measurement, disassembly, doc) — provenance is the
difference between a fact and a guess
**Confidence:** HIGH | MEDIUM | LOW
**Saves / costs:** what it buys, or what ignoring it costs

Detail.
```

`Evidence` and `Confidence` are different fields and both are required. `Evidence` says *how*
the finding was established; `Confidence` says *how much to trust it*. The scale is the one
`.planning/research/STACK.md` already uses, so there is one vocabulary across the project:

| Grade | Means |
|---|---|
| HIGH | Established live on this project's own machine, or verified directly in this container |
| MEDIUM | Doc-derived, or cross-checked against published sources, but not exercised here |
| LOW | Inferred or assumed; recorded so it can be tested, not so it can be relied on |

A MEDIUM entry is not a lesser entry — it is a *hypothesis with an address attached*, which is
exactly what makes the next session faster. Promote it to HIGH by re-logging it with live
evidence when it is confirmed; do not silently edit the grade.

**Status:** the full sweep of `.planning/research/`, `01-RESEARCH.md`, `01-PATTERNS.md`, the
`01-0N-SUMMARY.md` files and both `01-04-ATTEMPT-N-HALT.md` records is **outstanding** — it is
step 1 of the skill todo, and its method is settled in
`.planning/notes/re-findings-sweep-design.md`. What follows is the emulator-technique and
capture seed already recorded in `STATE.md`, plus the full control-flow and chip discovery
method migrated out of the skill todo on 2026-08-01.

That migration was the fix for a live contradiction: the method was parked in a todo, and todos
move to `completed/`. The log has to outlive every one of them, so it holds the method now and
the todo points here.

---

## Emulator technique

### 2026-07-30 — `vice_keyboard_type` is invisible to code that polls the keyboard matrix

**Type:** hazard
**Evidence:** live, during recovery work on the cracked disks
**Costs:** an afternoon, if unknown

The crack reads `$DC00`/`$DC01` directly rather than going through the KERNAL keyboard buffer,
so `vice_keyboard_type` delivers nothing it can see. Direct matrix polling is the norm in games
and cracks, not the exception — assume it until shown otherwise.

### 2026-07-30 — keypress delivery: press at the gate, HOLD, release at the trigger checkpoint

**Type:** trick
**Evidence:** three mechanisms measured against each other
**Saves:** determinism — the difference between a reproducible capture and a 264-byte diff

`vice_execution_run` + a wall-clock sleep *does* deliver the key, but the release lands on a
different CPU cycle each run: **264 of 65536 bytes differed**, including `$0049` (the exact byte
the trigger routine reads) and the whole stack page. `vice_execution_step(fixed count)` is
cycle-identical but never delivers a held matrix key — the machine sat at `$0900` for 150 s.
Releasing on a *program event* (a checkpoint) instead of a time is what makes it repeatable,
and leaves no key held in CIA state in the dump.

### 2026-07-30 — every state-reading `vice_*` call pauses the emulator and does not resume it

**Type:** hazard
**Evidence:** measured directly — 991,000 cycles/s (100% of PAL C64) with an explicit
`vice_execution_run` issued last, vs **6,000 cycles/s (0.7%)** when polling in a loop without
re-resuming
**Costs:** presents as "the checkpoint never fired"

Any poll/wait loop must re-issue `vice_execution_run` after each state read, then leave the
server alone for a real interval. `Speed:100`/`WarpMode:0` are not the cause.

### 2026-07-30 — `vice_ping` is the non-pausing poll

**Type:** shortcut
**Evidence:** 986,693 cycles/s while ping-polling vs 991,569 fully quiet — effectively free
**Saves:** cut resumes from ~20+ to 3 per capture

Poll with `vice_ping`, not with `vice_checkpoint_list` (which pauses).

### 2026-08-01 — `vice_ping`'s `execution` field is NOT a liveness signal

**Type:** hazard
**Evidence:** confirmed twice independently — a stalled host VICE kept answering
`execution: "running"` while `vice_cycles_stopwatch` measured **exactly 0 cycles** across
reset→run→poll→read
**Costs:** the orchestrator used it to wrongly reassure the developer *after* they had correctly
suspected a freeze

The only trustworthy liveness test is **a cycle count that advanced**. Every non-cycle-based
health check reads green during a silent stall.

## Capture and comparison

### 2026-07-30 — the recovery procedure is deterministic for the program image, not for 64K

**Type:** confirmation
**Evidence:** two independent cold-boot run pairs of `danish.d64`
**Saves:** makes byte-identity a usable criterion instead of an impossible one

`$0400–$CB66` (~51 KB of loaded game code+data) and zero page `$0002–$00FF` are byte-identical;
65,320 of 65,536 bytes match. Every difference is a 6510 port register, volatile scratch
(`$0100–$03FF`), or never-written RAM.

### 2026-07-30 — never-written RAM drifts continuously, so full-64K byte-identity is impossible in principle

**Type:** dead end (kills the baseline-diff approach)
**Evidence:** measured three ways with no game involved — 994 and 1014 bytes differing between
two 20 s idle runs, and **993 between two back-to-back power-on captures with the machine never
deliberately run**

Drift accumulates *during* a capture. Consequences: `mode:"hard"` reports a power cycle but does
**not** restore pristine RAM once the machine has run (real hardware behaves the same — reset
does not clear DRAM); there is no stable reference image at any instant; and drift is stochastic
per run, so it can never be excluded by address list — an idle control yielding 1014
drift-prone addresses covered only **2 of 137** real diffs.

### 2026-07-30 — the working drift discriminator is a property of the VALUE, not the address

**Type:** trick
**Evidence:** all 137 diffs in one run pair were Hamming distance exactly 1
**Saves:** a falsifiable contract instead of a tuned threshold

Drift flips *individual bits*; a program writing different data differs in ~4 bits on average.
`$0000–$0001` are excluded structurally (6510 on-chip I/O port registers, not memory). A
power-on-pattern block-fill heuristic was **rejected** despite scoring 134/137 — it is
threshold-tunable, and tuning until green manufactures the false confidence this work exists to
prevent. Known gap: one 2-bit drift byte (`$FDD9`) still fails, so the Hamming-1 rule is
slightly too tight; widening the threshold is not the fix.

### 2026-08-01 — the only trustworthy VICE liveness test is a cycle bracket, and it clears the host after the broker fix

**Type:** confirmation (live), plus the hazard it retires
**Evidence:** fresh session, orchestrator-side, four calls — `vice_cycles_stopwatch reset` →
`vice_execution_run` → three `vice_ping` polls → `vice_cycles_stopwatch read` = **21,551,860
cycles**. Same bracket read **exactly 0** twice during 01-04 attempt 2, on two different disk
images, while `vice_ping` kept answering `execution: "running"` throughout.
**Saves:** one tool call's worth of certainty before dispatching any plan that drives the
emulator — and it is the difference between a real zero and a stalled machine's worthless zero.

`vice_ping`'s `execution` field is **not** a liveness signal; neither is a transport that
answered. Only an advancing cycle count is. Run the bracket first in any session that will do
live work, before committing to a long pass — attempt 2 lost its saeger half and all of Task 3
to a stall that every non-cycle-based health check read as green.

Two facts confirmed alongside it, both cheap and worth repeating at session start:
`vice_checkpoint_list` returned `count: 0`, so no prior session's checkpoints survived into this
one; and the instance is granted on the session's **first** forwarded call (here `vice_ping` →
`3.10`/`C64SC`/`paused`), so a subagent of this session inherits *this* instance — which is why
a stalled session cannot be repaired from inside and has to be abandoned for a fresh one.

### 2026-08-01 — `vice_disk_attach` rejects a repo-relative path; an absolute container path works

**Type:** hazard
**Evidence:** live, during 01-04 Task 2's saeger pass — `vice_disk_attach({unit:8, path:"disks/saeger.d64"})`
returned an error ("Failed to attach disk image") from the proxy; the identical call with
`path` set to the absolute in-container worktree path (`git rev-parse --show-toplevel`, then
`/disks/saeger.d64` appended) succeeded immediately, no other change.
**Saves/costs:** a failed attach reads like a host-side problem (the error message even quotes the
host-side launcher path and the "ask a human to start it" boilerplate), which wastes time
suspecting the emulator when the actual defect is a relative path the host-side path-translation
layer can't resolve. Always resolve the disk image to an absolute in-container path — derive it
from `git rev-parse --show-toplevel` inside the worktree, per the project's own
worktree-path-safety rule for Edit/Write — before calling `vice_disk_attach`, never pass a
repo-relative string like `disks/<release>.d64` directly.

### 2026-08-01 — a genuine mid-session host VICE crash/respawn, self-surfaced by the proxy as an epoch-drift error, and auto-recovered on the NEXT call

**Type:** hazard, plus a confirmation that the epoch mechanism now works as designed
**Evidence:** live, during 01-04 Task 2's saeger pass, immediately after `vice_autostart` +
`vice_execution_run` on `saeger.d64` and several non-pausing `vice_ping` polls. Three consecutive
`vice_ping` calls failed — first `UND_ERR_SOCKET`, then `ECONNREFUSED` (naming lease
`req-92387-...`, port 6510, epoch 8, pid 827101, "may have crashed after being granted") — then a
fourth call returned a distinct error: `"epoch drift detected before forwarding -- the host VICE
MCP server's epoch changed from 8 to 9, pid 944178"`. Every `vice_ping` call after that fourth one
succeeded normally (`execution:"paused"`, i.e. a fresh boot). A fresh `cycles_stopwatch
reset -> execution_run -> ping x3 -> read` bracket on the new epoch-9 instance measured **13,501,532
cycles** — genuinely live, not another silent stall.
**Costs / saves:** costs the whole in-progress saeger boot (disk attach, autostart, run, and the
partial `$08F0`/PC=61024 register read taken under epoch 8) — all of it must be treated as void
and redone from `vice_disk_attach` on the new instance, because a differently-booted machine
answering the same tool calls is not the machine the earlier steps ran against. Saves: the proxy's
own epoch-drift detection means this doesn't have to be caught by comparing cycle brackets by
hand — the transport surfaces it as a loud, unambiguous error naming both epoch numbers on the
very next forwarded call, and (unlike the STATE.md-documented "proxy caches a dead grant for the
session's whole life" defect from the prior incident) subsequent calls transparently used the new
instance without the session needing to be abandoned. This is the eighth host VICE incident in
this project and the first one that self-healed within the same session rather than requiring a
fresh session.
**Rule applied:** per `.claude/CLAUDE.md` § Emulator Access ("Compare the restart epoch across a
bracket. A changed epoch voids the run.") and this plan's identity-change handling, nothing
measured between the last confirmed-good point and the epoch-drift report is trustworthy. The
correct response is not to inspect the "paused" state further as if it were a continuation — it
is to re-run the entire boot sequence from `vice_disk_attach` on the new instance.
**Confidence:** HIGH (measured live, twice independently, both self-healed the same way).

**Second occurrence, same session, ~8 minutes later (epoch 9 → 10).** Immediately after the
epoch-9 instance's re-derived idle-window checkpoints had just measured a clean counting-tier
probe (45,519,518 cycles, non-stopping checkpoint hit_count 2513), the very next two
`vice_checkpoint_add` calls failed the same way — `UND_ERR_SOCKET` then `ECONNREFUSED` naming
lease `req-92387-...`, pid 944178, epoch 9 — and the following `vice_ping` reported `"epoch drift
detected... changed from 9 to 10, pid 1056804"`. Identical shape to the first occurrence:
`vice_checkpoint_list` on the new epoch-10 instance immediately returned `count:0` (fresh, no
stale checkpoints), and a fresh cycle bracket measured 19,017,687 cycles — genuinely live. Two
crashes in roughly 20 minutes of continuous live work is a real rate, not a one-off: plan a live
session for saeger/danish work to tolerate re-deriving a boot sequence more than once, and treat
every post-crash "paused" read as a fresh machine requiring a full reboot, never a resume point.

### 2026-08-01 — a fourth incident this session: a genuine SILENT stall (not a crash), during Task 3's play-through

**Type:** hazard
**Evidence:** live, during 01-04 Task 3's saeger play-through, on the epoch-11 instance (the one
that successfully completed all of Task 2). After capturing one attributed `gameplay-write` hit
on `$DD00` (a `$07DB: STA $DD00` graphics-mode-setup store during the title-to-chamber
transition) and moving Bruce Lee right with `vice_joystick_tap`, three independent
`cycles_stopwatch reset -> execution_run -> ping xN -> read` brackets all measured **exactly 0
cycles**, while `vice_ping` continuously reported `execution:"running"` and NO epoch-drift error
ever appeared (`vice_ping`'s own `version`/`machine` fields stayed identical throughout — this is
not a crash/respawn like the three epoch-drift incidents logged above; the *same* instance is
answering, just not advancing). `vice_registers_get` returned an identical `PC:2014` across three
separate reads spanning two of those brackets, including one taken immediately after an explicit
`vice_execution_pause`. `vice_checkpoint_list` and `vice_checkpoint_delete` both remained
reliable throughout (teardown proven: two armed checkpoints deleted individually by
`checkpoint_num`, enumeration confirmed `count:0`).
**Confidence:** HIGH (three independent zero-cycle brackets, PC frozen across pause/resume,
matches this project's own prior documented "silent stall" shape from `.planning/STATE.md`'s
2026-07-31/08-01 entries almost exactly).
**Costs:** ended this session's live play-through after only 2 of saeger's ~7 required milestones
(title screen, game start/chamber 1) and before danish's play-through could even begin. Per the
project's rule ("MUST NOT report a load-event count... from a run whose emulator was not proven
to be executing") and this plan's own instruction ("If the emulator stalls again... do not attempt
a host restart... record the stall honestly... a partial, honestly-labelled result is the correct
outcome"), no further play-through input was attempted once this pattern was confirmed twice.
**Distinguishing note for a future session:** this is the *silent* variant (transport answers,
nothing executes) rather than the *loud* variant (transport errors, then epoch drift) seen three
times earlier in this same session — both are now confirmed live in one sitting, and neither can
be told apart by `vice_ping`'s own fields; only a cycle bracket distinguishes either from genuine
liveness, and only a subsequent forwarded call distinguishes a silent stall (no epoch change) from
a crash already in progress (epoch changes on the next call). A session hitting one incident type
should not assume immunity from the other.

## Control-flow discovery method

Migrated 2026-08-01 from the skill todo's Problem section, where it was at risk of being
archived with the todo. Everything in this section is **MEDIUM** — it is doc-derived method,
correct as far as published sources go, but not yet exercised against this project's own
depacked image. Running it on `recovery/danish/dumps/danish-gameentry-run1.bin` is what
promotes these to HIGH, and is step 5 of the skill todo.

### 2026-08-01 — locating the main loop and the IRQ vectors is a fixed lookup, not a search

**Type:** shortcut
**Evidence:** doc-derived; the motivating observation behind the skill todo
**Confidence:** MEDIUM
**Saves:** written down, minutes; undocumented, an hour of reasoning per session

The structure of a C64 game hangs off a small, fixed set of well-known addresses. Read them in
order and the answer falls out; treat it as a search problem and it costs an hour every time.
The order is: entry point → vectors → IRQ source → main loop → structure.

### 2026-08-01 — entry point has three routes, and this project's is the third

**Type:** shortcut
**Evidence:** doc-derived
**Confidence:** MEDIUM
**Saves:** avoids hunting for a BASIC stub that a depacked image does not have

- **BASIC stub at `$0801`** — a tokenized `SYS <addr>` line. The address is plain PETSCII digits
  in the stub, so it reads straight out of the load image with no interpretation.
- **Autostart / non-BASIC** — the `.prg` load address (first two bytes), plus the RESET vector at
  `$FFFC/$FFFD`, or a cartridge-style CBM80 signature at `$8000`.
- **Post-depack, which is this project's case** — the practical entry point is wherever the PC
  sits when the decrunch checkpoint fires. A different question with a different answer, and
  the one that actually applies here.

### 2026-08-01 — the vector table: six pairs, and `$01` decides which pair is live

**Type:** shortcut
**Evidence:** doc-derived
**Confidence:** MEDIUM
**Saves:** one or two `vice_memory_read` calls answer most structural questions about a game

| Vector | Default | Meaning |
|---|---|---|
| `$0314/$0315` | `$EA31` | KERNAL IRQ vector (RAM, indirect). Changed ⇒ the per-frame handler is at the new target |
| `$0316/$0317` | `$FE66` | BRK vector |
| `$0318/$0319` | `$FE47` | NMI vector. Commonly retargeted by music players and anti-tamper code |
| `$FFFA/$FFFB` | — | Hardware NMI |
| `$FFFC/$FFFD` | — | Hardware RESET |
| `$FFFE/$FFFF` | — | Hardware IRQ/BRK |

**The hardware pairs are only live when the ROMs are banked out via `$01`.** Check `$01` before
trusting either pair. The second tell is the handler's own first instruction: the KERNAL's
register-save preamble means the KERNAL path is in use; a jump straight into game code means it
is not.

### 2026-08-01 — IRQ source is settled by reading two enable masks

**Type:** shortcut
**Evidence:** doc-derived
**Confidence:** MEDIUM
**Saves:** one call instead of reading the handler and inferring

- **Raster IRQ** — `$D012` (raster compare), `$D011` bit 7 (raster bit 8), `$D01A` (IRQ enable
  mask), `$D019` (IRQ latch, which the handler must acknowledge). **A handler that writes a new
  `$D012` value on its way out is a split raster chain**, and each such write is one more IRQ
  position to enumerate.
- **CIA timer IRQ** — `$DC0D` (CIA#1, drives IRQ) and `$DD0D` (CIA#2, drives NMI), with
  `$DC04-$DC07` / `$DD04-$DD07` for the periods. Music players sit here or on a raster line.

Which one is armed is a cheap read. Do that before reading any handler code.

### 2026-08-01 — decide the main loop's *shape* before hunting for it

**Type:** trick
**Evidence:** doc-derived
**Confidence:** MEDIUM
**Saves:** the difference between a narrow search and an open-ended one

Two shapes, and knowing which one applies is most of the work:

- **Real main loop** — an unconditional backward branch or `JMP` to a nearby earlier address that
  never returns, usually preceded by a frame-sync wait: polling `$D012` for a fixed raster line,
  or spinning on a flag the IRQ handler sets.
- **IRQ-does-everything** — the main loop is a two-instruction spin and all logic hangs off the
  raster IRQ. Common enough that assuming the first shape wastes the search.

**The honest test is live, not static:** the address that repeats exactly once per frame in an
execution trace is the main loop, whatever the listing suggests. `vice_checkpoint_add` on a
suspected loop head plus `vice_run_until` proves it in one bracket.

### 2026-08-01 — four structural features that a linear disassembler gets wrong

**Type:** hazard
**Evidence:** doc-derived; consistent with `toacme`'s documented limitations
**Confidence:** MEDIUM
**Costs:** silently wrong code/data separation, which contaminates everything downstream

- **Jump tables and dispatch** — `JMP ($xxxx)` and `JSR` into an indexed table. This is where
  game state machines live, and it is exactly what a linear decoder mis-decodes.
- **Self-modifying code** — writes into `$0800-$CFFF` from code that also executes there. Common
  for animation frame pointers.
- **Zero page** — the game's hot variables. The highest-frequency ZP addresses in a trace are the
  state worth naming first.
- **Code/data separation** — the project's standing rule (`.claude/CLAUDE.md` § Stack Patterns):
  a range never hit as an instruction stream across full gameplay coverage is data, regardless
  of what the tracer guessed. The provenance diff between the two cracked releases is the second
  check on the same question.

## VIC-II discovery — charsets, screens, bitmaps, sprites

Migrated 2026-08-01 from the skill todo. All **MEDIUM** pending live confirmation against the
depacked image. The derivation tables here are candidates for `c64-memory-mapping` rather than
the RE skill — that audit is step 4 of the skill todo, and is deliberately *not* pre-empted by
logging them here. The log holds them so they survive; the skill decides where they live.

### 2026-08-01 — graphics data is computed, not searched: five reads locate every displayed byte

**Type:** shortcut
**Evidence:** doc-derived
**Confidence:** MEDIUM
**Saves:** the single largest time sink in graphics RE — searching memory for something the
hardware will tell you the address of

Every pointer the VIC follows is derived from two registers plus a bank. Read the bank, read
`$D018`, read the mode bits, read `$D015` and the sprite pointer block, and you have located
every byte of graphics the game is currently displaying. There is nothing to search for.

### 2026-08-01 — read `$DD00` first, every time, and remember the bits are inverted

**Type:** hazard
**Evidence:** doc-derived
**Confidence:** MEDIUM
**Costs:** every subsequent graphics pointer is wrong, with no error to signal it

`$DD00` bits 0-1 (CIA#2 port A) select the VIC bank, **inverted**:

| `$DD00 & 3` | Bank | Base |
|---|---|---|
| `%11` | 0 | `$0000` |
| `%10` | 1 | `$4000` |
| `%01` | 2 | `$8000` |
| `%00` | 3 | `$C000` |

This is the most common source of a wrong answer in C64 graphics RE. Every other pointer is
relative to this base, so getting it wrong corrupts the whole chain silently.

### 2026-08-01 — `$D018` is two pointers in one byte

**Type:** shortcut
**Evidence:** doc-derived
**Confidence:** MEDIUM
**Saves:** locates screen RAM and the charset in one read

- Bits 4-7 = **VM**, video matrix (screen RAM) base = bank + VM × `$0400`
- Bits 1-3 = **CB**, character generator base = bank + CB × `$0800`
- Bit 0 unused

In bitmap mode, `$D018` bit 3 selects which 8K half the bitmap occupies, and the video matrix
then holds colour pairs rather than character codes.

### 2026-08-01 — the character ROM shadow at `$1000`/`$9000` breaks the `$D018` arithmetic

**Type:** hazard
**Evidence:** doc-derived
**Confidence:** MEDIUM
**Costs:** "the classic wasted hour" — extracting a charset that is not in RAM at all

The VIC sees character ROM at `$1000-$1FFF` (bank 0) and `$9000-$9FFF` (bank 2) **regardless of
the `$01` banking the CPU sees**. If CB resolves into either window, the game is using ROM
characters and there is no charset in RAM to extract. Check this before dumping anything.

### 2026-08-01 — three bits decide what the graphics bytes mean

**Type:** shortcut
**Evidence:** doc-derived
**Confidence:** MEDIUM
**Costs, if skipped:** a multicolor sprite decoded as hires comes out as garbage twice as wide
as it should be

`$D011` bit 6 (ECM), `$D011` bit 5 (BMM), `$D016` bit 4 (MCM):

| ECM | BMM | MCM | Mode |
|---|---|---|---|
| 0 | 0 | 0 | Standard text |
| 0 | 0 | 1 | Multicolor text |
| 0 | 1 | 0 | Standard bitmap |
| 0 | 1 | 1 | Multicolor bitmap |
| 1 | 0 | 0 | Extended background text |
| 1 | 1 | 0 | Invalid — screen goes black |
| 1 | 0 | 1 | Invalid — screen goes black |
| 1 | 1 | 1 | Invalid — screen goes black |

Multicolor halves horizontal resolution and reads bit *pairs* rather than bits.

### 2026-08-01 — sprites: `$D015` first, then the pointer block at VM + `$03F8`

**Type:** shortcut
**Evidence:** doc-derived
**Confidence:** MEDIUM
**Saves:** stops you decoding stale noise from disabled sprites

- `$D015` — enable mask. **Start here**; a disabled sprite's other registers are stale.
- Sprite pointers live at **video matrix base + `$03F8`**, 8 bytes. Each pointer × 64 = the
  sprite's data address *within the current bank*. 63 bytes used of the 64 allocated.
- `$D000-$D00F` X/Y pairs; `$D010` the X bit-8 mask for sprites past X=255.
- `$D01C` multicolor per sprite; `$D017`/`$D01D` Y/X expand; `$D01B` sprite-background priority.
- `$D027-$D02E` per-sprite colour; `$D025`/`$D026` the two shared multicolor registers.

`vice_sprite_get` / `vice_sprite_inspect` do the pointer arithmetic and the multicolor bit-pair
unpacking. Verify what they return once against a hand-resolved pointer, then trust them.

### 2026-08-01 — colour RAM is fixed at `$D800-$DBFF` and does not move with the VIC bank

**Type:** hazard
**Evidence:** doc-derived
**Confidence:** MEDIUM
**Costs:** looking for colour data at a bank-relative address that holds something else

Colour RAM is **not** banked. Only the low nybble of each byte exists. `$D020` is the border,
`$D021-$D024` backgrounds 0-3 (2 and 3 used only in ECM).

### 2026-08-01 — `$D01E` and `$D01F` clear on read, so observing them changes the game

**Type:** hazard
**Evidence:** doc-derived (hardware behaviour); the monitor's exact behaviour is **unverified**
**Confidence:** MEDIUM
**Costs:** a running game behaves differently *because you looked at it* — the worst class of
observation bug, because it discredits the capture without announcing itself

`$D01E` (sprite-sprite collision) and `$D01F` (sprite-background collision) clear when read.
Reading them while the game runs steals the collision the game was about to act on. Prefer
`vice_vicii_get_state`. **Whether the VICE monitor's read is side-effect-free is a
verify-don't-assume item**, not something to take on faith.

### 2026-08-01 — two watch targets that find the two highest-value routines

**Type:** trick
**Evidence:** doc-derived
**Confidence:** MEDIUM
**Saves:** finds the room loader and the animation driver without reading the disassembly

- **Watch `$D018`** → the screen-setup routine, which in a room- or level-based game is usually
  the room loader. One of the highest-value routines to locate early.
- **Watch VM + `$03F8`** (the sprite pointer block) → the animation driver, since rewriting those
  pointers frame to frame is exactly what it does.

`vice_watch_add` finds *writers*. That is the tool's real leverage in RE, and it is under-used
relative to reading memory.

## SID discovery — the music player, sound effects, and the RNG

Migrated 2026-08-01 from the skill todo. All **MEDIUM**.

### 2026-08-01 — SID layout: three voices, 7 bytes each, write-only but for the last four

**Type:** shortcut
**Evidence:** doc-derived
**Confidence:** MEDIUM

Voice 1 at `$D400`, voice 2 at `$D407`, voice 3 at `$D40E`:

| Offset | Register |
|---|---|
| +0 / +1 | Frequency lo / hi |
| +2 / +3 | Pulse width lo / hi |
| +4 | Control — gate (bit 0), sync, ring, test, then waveform: triangle, saw, pulse, noise |
| +5 | Attack / Decay |
| +6 | Sustain / Release |

Then `$D415`/`$D416` filter cutoff lo/hi, `$D417` resonance plus filter routing, `$D418` volume
(bits 0-3), filter mode (bits 4-6), voice-3-disconnect (bit 7). Read-only: `$D419`/`$D41A`
paddles, `$D41B` voice 3 oscillator, `$D41C` voice 3 envelope.

### 2026-08-01 — watch `$D404` to land directly on the music play routine

**Type:** trick
**Evidence:** doc-derived
**Confidence:** MEDIUM
**Saves:** finds the player without reading the IRQ handler line by line

The player is whoever writes `$D400-$D418` from inside the IRQ handler. Voice 1's control
register gates on every note, so a watch on `$D404` lands on the play routine directly.
Separating `init` from `play` follows immediately: **`init` is called once from the main code,
`play` once per frame from the IRQ.**

### 2026-08-01 — `$D41B` read is the random number generator, not audio

**Type:** trick
**Evidence:** doc-derived; the standard C64 idiom
**Confidence:** MEDIUM
**Saves:** stops enemy AI and spawn logic being filed as sound code

Reading voice 3's oscillator is *the* C64 RNG idiom. Code reading `$D41B` is almost never doing
audio — it is enemy AI, spawn placement, or a title-screen effect. Worth recognising on sight.
Corollary: `$D418` bit 7 (voice 3 disconnect) is often set **precisely because** voice 3 is
being used as the RNG rather than as a voice.

### 2026-08-01 — `$D418` written alone at high frequency is 4-bit sample playback

**Type:** trick
**Evidence:** doc-derived
**Confidence:** MEDIUM
**Saves:** correctly identifies a second, separate audio subsystem

`$D418` hammered with no accompanying voice setup is digi playback, not music. It is a different
subsystem from the player and usually runs off a **fast CIA timer** rather than the frame IRQ —
so finding it also explains a CIA timer you could not otherwise account for.

## CIA 6526 discovery — input, timing, banking, serial

Migrated 2026-08-01 from the skill todo. All **MEDIUM** except where noted. Two chips with
identical register layouts doing almost entirely different jobs — confusing them is a frequent
early error.

### 2026-08-01 — CIA#1 vs CIA#2: identical layouts, different jobs

**Type:** shortcut
**Evidence:** doc-derived
**Confidence:** MEDIUM

**CIA#1 at `$DC00` — keyboard, joysticks, the IRQ line.**
- `$DC00` port A: keyboard **column** select, and joystick port 2
- `$DC01` port B: keyboard **row** read, and joystick port 1
- `$DC02`/`$DC03` data direction A/B
- `$DC04-$DC07` timer A/B lo-hi; `$DC0E`/`$DC0F` the control registers that start them
- `$DC08-$DC0B` TOD clock; `$DC0C` serial shift register
- `$DC0D` interrupt control/status: bit 0 timer A, bit 1 timer B, bit 2 TOD alarm, bit 3 SP,
  bit 4 FLAG, bit 7 "an IRQ occurred" on read / set-clear on write

**CIA#2 at `$DD00` — VIC bank, serial bus, user port, the NMI line.**
- `$DD00` port A: bits 0-1 VIC bank (inverted); bits 3-5 serial ATN/CLK/DATA out; bits 6-7
  serial in
- `$DD01` port B: user port / RS-232
- `$DD04-$DD07`, `$DD0E`/`$DD0F` timers — these drive **NMI**, not IRQ
- `$DD0D` interrupt control, same bit layout as `$DC0D`

### 2026-08-01 — `$DC0D` untouched means raster IRQ; programmed means the game runs its own timebase

**Type:** shortcut
**Evidence:** doc-derived
**Confidence:** MEDIUM
**Saves:** settles the timebase question in one read of two registers

A game that never touches `$DC0D` is on a raster IRQ. One that programs `$DC04-$DC07` and
enables timer A has its own timebase. Read the two enable registers and the question is closed.

### 2026-08-01 — `$DD00` is dual-purpose, and loader code writing it is usually talking to the drive

**Type:** hazard
**Evidence:** doc-derived
**Confidence:** MEDIUM
**Costs:** misreading disk I/O as a bank switch, or vice versa

The same register carries the VIC bank *and* the serial bus lines, so a write during disk access
also moves the VIC's view of memory unless the code masks carefully. **Check the mask** before
concluding a `$DD00` write is a bank switch.

### 2026-08-01 — `$DC0D`/`$DD0D` clear the interrupt flags on read

**Type:** hazard
**Evidence:** doc-derived (hardware behaviour); the monitor's exact behaviour is **unverified**
**Confidence:** MEDIUM
**Costs:** stealing an interrupt the game was about to service — same shape as `$D01E`/`$D01F`

Prefer `vice_cia_get_state` over a raw read. Treat the VICE monitor's behaviour here as
verify-don't-assume.

### 2026-08-01 — direct `$DC00`/`$DC01` polling is the norm, and it defeats `vice_keyboard_type`

**Type:** hazard
**Evidence:** **live** — established on this project during recovery work; see the
2026-07-30 entry under Emulator technique
**Confidence:** HIGH
**Costs:** an afternoon

Logged here as well as under Emulator technique because it belongs to both the CIA method and
the emulator-driving method, and a reader arriving from either direction needs it. Games and
cracks bypass the KERNAL keyboard buffer and read the matrix directly. Assume it until shown
otherwise.

## Tool-to-question mapping

### 2026-08-01 — which `mcp__vice__*` call answers which RE question

**Type:** shortcut
**Evidence:** doc-derived, from the skill todo
**Confidence:** MEDIUM
**Saves:** the ordering, which is the part the tool schemas cannot supply

Nothing here needs installing; the gap was that the mapping was not written down. Note this is
deliberately *not* a restatement of the tool surface — the agent already holds typed schemas.
The value is which call to reach for first.

| Question | Call |
|---|---|
| Vectors, `$01`, `$D011/$D012/$D018/$D019/$D01A`, `$DC0D/$DD0D`, `$DD00` | `vice_memory_read` — highest-value first move; answers most vector questions in one or two calls |
| What does the handler at this vector do? | `vice_disassemble` — the emulator's own decoder, not a dead listing |
| Is this really the main loop? | `vice_checkpoint_add` + `vice_run_until` + `vice_registers_get` — fires once per frame ⇒ proven |
| What code writes this? | `vice_watch_add` — finds *writers*. Best targets: `$D018`, VM+`$03F8`, `$D404` |
| Whole-chip state without the read hazards | `vice_vicii_get_state` / `vice_sid_get_state` / `vice_cia_get_state` — **prefer these over raw register reads** |
| Decode sprite data | `vice_sprite_get` / `vice_sprite_inspect` |
| Find a known byte pattern | `vice_memory_search` |
| Carry labels across sessions | `vice_symbols_load` / `vice_symbols_lookup` — ACME `--vicelabels` and regenerator2000 output share this channel |
| Fast first-pass listing | `toacme` — decodes data as instructions; never the deliverable |
| Traced disassembly with code/data separation | regenerator2000 — still MEDIUM per STACK.md; its first real run is its verification |
| What does address X mean? | the `c64-memory-mapping` skill — **delegate, do not restate its tables** |

Standing constraint: `mcp__vice__*` is the only route to the emulator. Any step of this method
that would want a Node process talking to VICE is dead on arrival and must be expressed as
agent-performed tool calls — the same rule that reduced `c64-ram-capture` to a procedure.

### 2026-08-01 — a silent stall outlives the subagent that hit it, confirmed from the orchestrator side

**Type:** hazard (confirms the "abandon the session" rule live, from the other side of the agent boundary)
**Evidence:** live. Plan 01-04 attempt 3's executor halted on a silent stall. After it returned and
its worktree was merged and removed, the **orchestrator** ran its own bracket in the same session:
`cycles_stopwatch reset` → `execution_run` → 3× `vice_ping` → `read` = **exactly 0 cycles**, while
all three pings reported `execution: "running"`. The same bracket in this same session before
dispatch read 21,551,860 cycles, so the instance was healthy at dispatch and stalled during the run.
**Confidence:** HIGH — measured directly, twice in one session, with a known-good reading as control.
**Saves/costs:** one bracket (4 calls) tells you whether a session still has an emulator before you
spend an executor dispatch on it. Skipping it costs a whole dispatch and produces a halt.

**The operational rule this confirms:** a stalled instance is a property of the *session*, not of
the agent that was unlucky. It does not clear when the subagent exits, and the container cannot
repair it — the proxy never re-requests a grant, so host-side repair does not reach an
already-granted session either. There is no in-session recovery. Abandon the session and open a
fresh one; the first forwarded call takes a new boot-fresh grant.

**Corollary for orchestrators:** re-dispatching an executor after a stall-halt is guaranteed to
fail, because the subagent inherits its session's dead instance. Run the bracket *before*
re-dispatch and treat zero as "stop and hand off", not as "retry".

### 2026-08-01 — saeger chamber 1's opening area has a fast-depleting `FALLS` counter that kills Bruce Lee in roughly 4 actions regardless of direction chosen

**Type:** hazard
**Evidence:** live -- 01-04 attempt 4, saeger Task 3 play-through, repeated across ~6 independent restarts from the title screen
**Confidence:** HIGH (measured directly, repeatedly, with a control: an "up" tap that produced no visible sprite movement still decremented the counter by exactly 1, ruling out "counts physical falls off a ledge" as the mechanism)

The status-bar field labelled `FALLS` (top-right HUD, e.g. `FALLS 04`) decrements by
approximately 1 per `vice_joystick_tap`/`vice_keyboard_matrix` input issued in chamber 1's
opening room, **independent of direction, of whether the sprite visibly moved, and of whether
fire was held** -- a stationary "up" tap that produced no observable position change still cost
one count, ruling out a literal "number of ledge-falls taken" interpretation. It starts at `04`
on room entry (including after an F7 restart) and reaching `00` kills Bruce Lee: either a
non-terminal respawn-in-place (screen resets to the room's start position, `1UP` persists, FALLS
resets to `04`) if a life remains, or the explicit `GAME OVER / PLAYER 1 / <score>` screen if it
was the last life. **This makes naive "hold a direction and walk across" traversal of this
specific room fail before reaching the far side** -- roughly 4 input events is not enough real
distance to cross the room's width at normal walk speed, so every attempt this session (six
restarts, several different direction/fire combinations) died in the opening area before finding
the exit/chamber-2 transition. Not yet root-caused at the disassembly level (no checkpoint was
armed on the HUD's FALLS byte itself, only inferred from repeated on-screen observation) -- a
future session attempting this room should arm a store-watch on the FALLS digit's screen-RAM
address (or find its backing counter in zero page/low RAM) to learn the actual trigger condition
before spending further live budget on trial-and-error navigation.
**Saves:** a future session should not re-discover this by trial and error across several
restarts; arm a watch on the counter's backing byte first, or try a diagonal/jump input pattern
that covers more ground per discrete input event, before attempting this room's chamber
transition again.

### 2026-08-01 — a second genuine silent stall, in a FRESH session's FRESH instance, froze at the exact same PC ($07DE) as attempt 3's stall

**Type:** hazard (confirms and sharpens the silent-stall hazard already logged for attempt 3)
**Evidence:** live -- 01-04 attempt 4, saeger Task 3, immediately after re-arming the earned
watch set for a final clean death/restart evidence pass
**Confidence:** HIGH (two independent 0-cycle brackets, `vice_ping` continuously "running",
identical PC across both brackets and immediately after an explicit `vice_execution_pause`,
matching the project's documented stall signature exactly)

This is a **brand-new session, first tool call `vice_ping`**, so per the project's own boot-fresh
access model this should have been a fresh, healthy instance — attempt 3's stall could not have
carried over. Sequence: `vice_cycles_stopwatch reset_and_read` reported `previous_cycles:
54,894,035` (genuine prior execution), then two `checkpoint_add` calls succeeded, a screenshot
came back **solid blue with no text at all** (not the title screen, not chamber 1 — a state never
seen at any other point this session), an `F7` press + `execution_run` produced no visible change,
and from that point on every `cycles_stopwatch reset -> run -> ping xN -> read` bracket measured
**exactly 0** across two independent brackets. `vice_registers_get` read `PC:2014` ($07DE) both
times, including immediately after an explicit `vice_execution_pause` — **the identical PC
attempt 3's own stall froze at**, per
`.planning/todos/pending/2026-08-01-vice-silent-stall-during-01-04-task3-saeger-playthrough.md`.
`$07DE` is the instruction immediately after `STA $DD00` in the chamber-1-entry graphics-mode-setup
routine (`$07D9: LDA #$01 / $07DB: STA $DD00 / $07DE: LDA #$38 / ...`) — exactly where this
session's own `$DD00` attribution capture (a stopping checkpoint on that store) had just paused
the machine for evidence-gathering, one action earlier.
**With N=2 this is a real pattern worth flagging, not yet a proven root cause**: both saeger
stalls this project has hit occurred shortly after a stopping checkpoint had paused the machine
at/near this exact address and execution was then resumed. Whether the hang is triggered by
resuming from a checkpoint sitting on this specific instruction, by something else in the
chamber-1-entry code path, or is unrelated coincidence, is not established — but a future session
repeating this same technique (attribute a `$DD00` hit via a stopping checkpoint, then resume and
keep playing) should treat a stall recurring at this same PC as a real correlation to investigate,
not surprising noise.
**Saves/costs:** per the project's hard rule, a confirmed stall has no in-session recovery; this
cost the rest of attempt 4's live budget for BOTH releases (danish's Task 3 was never reached).
Logged as a new pending todo cross-referencing attempt 3's.

### 2026-08-01 — a coalesced diff range can silently cross a manifest's own kind boundary; resolving `kind` from only a range's start address mislabels everything past the first boundary

**Type:** dead end (own tool-design mistake) / hazard, caught before commit
**Evidence:** live -- `node tools/diff-images.mjs ledger` run against the real committed dumps;
danish's own `$0340`-`$035E` `loader`-bucketed range was rendered with `kind: game` in the first
ledger draft
**Confidence:** HIGH (directly reproduced: danish's manifest has `$0000`-`$033F` = `game`,
`$0340`-`$035E` = `loader`; the diff's coalesced `ORIGINAL` range spans `$033C`-`$4770`, straight
through that boundary, because coalescing groups on VERDICT continuity across addresses, not on
manifest kind continuity)

`tools/diff-images.mjs`'s ledger renderer resolved each generated row's `kind` column by looking up
the reference manifest's kind *at the range's start address only*. Since `diffRanges`/
`coalesceRanges` merge purely on verdict agreement (two adjacent addresses with the same ORIGINAL/
UNKNOWN/CRACKER-PATCH signature collapse into one row regardless of what the underlying manifest
calls either address), a merged row can legitimately span a `game`→`loader`→`game` boundary when
both releases happen to hold identical bytes across all three zones. The first ledger draft
resolved this whole span's kind from its start (`game`), silently reporting the `$0340`-`$035E`
loader-scratch bytes as ordinary game data. **Fix:** `splitRangeByManifestKind` intersects every
generated range against the reference manifest's own range boundaries before rendering, so a
spanning row becomes multiple sub-rows (same verdict/evidence, correct per-sub-range kind) --
verified by re-running the ledger and confirming `$0340`-`$035E` now reports `kind: loader`. Row
count went from 204 to 508 as a direct, expected consequence (every kind-crossing merge became
multiple rows). **Saves:** any future ledger-style renderer that resolves a per-row categorical
field (kind, bucket, owner) from a merged/coalesced range's start address alone should split
against the categorising boundary first -- "the range agrees on X" does not imply "the range agrees
on Y" for an unrelated partition Y.

### 2026-08-01 — a genuine, previously-undiscovered text divergence: "DATASOFT PRESENTS" (danish) vs "DIABOLO  PRESENTS" (saeger) at $4771-$4779, in a region that is neither loader nor cracktro

**Type:** confirmation / open question (real mechanical finding, not yet explained)
**Evidence:** live -- `node tools/diff-images.mjs diff --gap-tolerance 16` run against the two
committed `run1` primary dumps (01-05 Task 2); directly re-read with `Buffer.subarray` to confirm
byte-for-byte (not a rendering artifact): danish reads
`29292929a0a6a044415441534f46542050524553454e5453a027` (`...DATASOFT PRESENTS.'`), saeger reads
`29292929a0a6a0444941424f4c4f202050524553454e5453a027` (`...DIABOLO  PRESENTS.'`) at the identical
address range in both images
**Confidence:** HIGH for the byte-level fact (directly read from both committed `.bin` files);
LOW for any interpretation of *why* -- recorded as an open question, not a conclusion

At address $4771 (danish) / the identical address in saeger (proven offset 0, so this is a true
same-address comparison, not a relocation artifact), the two releases' game images hold different
text: danish's copy reads "DATASOFT PRESENTS", saeger's reads "DIABOLO  PRESENTS" (note: "DIABOLO"
is 7 characters + 2 spaces = 9, matching "DATASOFT" 8 characters + 1 space = 9, before "PRESENTS"
starts at the same byte offset in both -- a deliberate, alignment-preserving substitution, not
accidental corruption). This is **not** the cracktro banner (that's already documented separately:
"Danish Crackers Presents..." / "...SAEGER SOFT GROUP", found at different addresses during boot,
per each release's own `tier1_evidence`) and it is **not** inside either release's earned
`loader_ranges`. It sits inside what the trace/entry point reaches as ordinary game data (bucketed
`game` by `tools/diff-images.mjs`'s `bucketManifest`).

This appears to directly complicate the previously-recorded claim (`recovery/saeger/NOTES.md` §8,
screenshot-based) that "the post-cracktro title screen is Datasoft's original and unmodified —
byte-for-byte the same screen text as danish's." That claim was verified against the **rendered
screen** at the title-screen dump point, not this underlying source-text table at $4771 — so the
two observations are not necessarily in direct conflict (this table may hold text for a screen
never actually visited during either release's boot capture, e.g. a credits/loading screen, or may
be dead/unused leftover data from a different repackaging), but it is a genuine, mechanically
verified divergence in the game's own data, not the cracktro or loader, and it was **not** caught
by the earlier screenshot-based Tier-1 evidence gathering. **Recorded as `UNKNOWN` in
`recovery/PROVENANCE.md`, not `CRACKER-PATCH`** — the diff tool cannot mechanically confirm this
matches a "recognised cracker technique" (rebrand/relabel is plausible per Pitfall 4, but asserting
it with `CRACKER-PATCH`'s confidence marker would be exactly the kind of inferred-as-evidenced
claim this project's prohibition forbids without stronger corroboration, e.g. live disassembly
confirming which code path actually reads this text and whether it is ever rendered).

**Saves/costs:** a future live session investigating saeger's provenance (or the game's title-
screen code path) should check whether this text is ever actually displayed, and if so on what
screen -- this could indicate saeger's disk derives from a rebranded/relabelled release (published
under a "Diabolo" label) rather than merely being a different *crack* of the same Datasoft-branded
release, which would be a materially different provenance story than "two independent cracks of
the same original." Costs nothing to defer: `recovery/PROVENANCE.md`'s `UNKNOWN` verdict here is
honest and does not block anything downstream.

### 2026-08-01 — a blind "any printable ASCII run" heuristic misclassifies the game's own title text as cracktro content; fixed with a crack-credit-vocabulary filter

**Type:** dead end (own tool-design mistake) / hazard, caught before commit
**Evidence:** live -- the finding immediately above, discovered while running `tools/diff-images.mjs
diff` against the real committed dumps; `tools/diff-images.mjs`'s first `bucketManifest`/`diffRanges`
draft used a bare `findPrintableRuns` scan as the cracktro bucket's seed
**Confidence:** HIGH

The plan's own instruction ("seed the cracktro bucket from banner and credit text located by a
plain buffer scan for printable runs") is correct in general, but a bare "printable ASCII, length >=
minLength" predicate cannot distinguish crack-credit text from the *original game's own* printable
text -- and this game's data genuinely has both (the $4771 "DATASOFT PRESENTS" / "DIABOLO  PRESENTS"
divergence above is exactly such game-owned text). The first draft classified this address as
`CRACKER-PATCH` with the reason "intro/cracktro splice", which would have been a confidently-wrong
verdict shipped straight into the ledger. **Fix:** narrowed the scan to `findCracktroRuns`, which
additionally requires the printable run's decoded text to contain at least one word from a short,
explicitly-sourced crack-credit vocabulary (`CRACKED`, `CRACKERS`, `SOFT GROUP`, `DC-011`,
`BREAK'EM`, `MAKE'EM`, `PRESENTS BY`, `CRACKED BY`) drawn from what both releases' own already-
verified `tier1_evidence` in `recovery/RELEASES.json` record as the actual cracktro text -- and
deliberately does not include either release's own name as a bare word. After the fix, this
address (and every other candidate in this steady-state dump) is bucketed `game`, not `cracktro`,
and `recovery/PROVENANCE.md`'s ledger correctly reports zero `CRACKER-PATCH` rows for this pass
rather than one false positive. **Saves:** the next tool doing content-based classification from a
plain-text scan (anywhere in this project) should reach for a vocabulary/signature filter rather
than trusting "printable and long enough" as sufficient on its own -- the false positive here was
found only because the plan required running the tool against real data before trusting it, not
because the design was reviewed and caught in the abstract.

### 2026-08-01 — `check-parameterisation` catches a real release-id conditional in a TEST file, not just implementation code

**Type:** confirmation (the gate works as designed, including where it wasn't specifically aimed)
**Evidence:** live -- `node tools/recovery-schema.mjs check-parameterisation` run after adding
`tools/diff-images.test.mjs`'s real-dump integration test
**Confidence:** HIGH

`checkParameterisation` in `tools/recovery-schema.mjs` scans every `.mjs` file under `tools/` --
which includes test files, not only the implementation modules a plan author might picture when
writing the N-readiness rule. A first draft of `diff-images.test.mjs`'s real-dump integration test
picked the two releases with `registry.releases.find(r => r.id === "danish")` /
`registry.releases.find(r => r.id !== "danish")` -- convenient shorthand, and exactly the
release-id conditional the gate exists to catch. The gate flagged both occurrences immediately and
by name (file + release id + matched pattern), and the fix was purely positional:
`registry.releases[0]` as the reference release, `registry.releases.find(r => r !== reference)` as
"the other one" (object-identity comparison, not a string literal, so it doesn't match the gate's
regexes at all). **Saves:** a future test needing "pick a specific release and a different one"
should default to positional/first-vs-not-first logic rather than reaching for a literal id string,
even in test code -- the gate does not exempt tests, and re-discovering that by tripping it is a
five-minute detour, not a costly one, but avoidable.

### 2026-08-01 — anchor-proven provenance offset is 0 for danish vs saeger, confirmed mechanically (not just by the earlier byte-for-byte inspection)

**Type:** confirmation
**Evidence:** live -- `node tools/diff-images.mjs anchor-search --json` run against the two committed
`run1` primary dumps (01-05 Task 1)
**Confidence:** HIGH (mechanical: 8 candidate anchors selected, 7 produced a unique match in the
target and all 7 agreed on delta 0; the 8th was correctly rejected as non-unique rather than
silently averaged in)

Both releases' `01-04`/earlier NOTES.md sections already established by direct disassembly
inspection that `$08B1`/`$139E` are byte-for-byte identical between danish and saeger, implying an
offset of 0. This finding is the *mechanical* confirmation of that same fact via
`tools/diff-images.mjs`'s `anchorSearch`/`proveOffset`, independent of the earlier manual
inspection: 8 long (48-byte), non-trivial byte runs were selected from danish's dump (reference),
located in saeger's dump via `Buffer.indexOf`, and every anchor that produced a unique match agreed
on offset 0. One anchor (a repeating `$00`x8 + `$AA`x40 pattern, landing in never-written/scratch
territory) matched at two distinct target offsets and was correctly rejected rather than treated as
a tie-break. **Saves:** any future release added to the registry can reuse this same verb rather than
re-deriving an offset by manual disassembly comparison; the recorded `provenance_offset` field in
`recovery/RELEASES.json` makes the diff reproducible without re-running the anchor search at all.

### 2026-08-01 — a linear-congruence byte fill is a bad "distinctive" test fixture for anchor/offset search code

**Type:** hazard (test-authoring pitfall, not a project-data finding)
**Evidence:** live -- writing `tools/diff-images.test.mjs`'s anchor-search fixtures
**Confidence:** HIGH (directly reproduced and diagnosed in this session)

A synthetic test fixture filled via `(i * 37 + 11) & 0xff` looks non-repeating at a glance but has
a short period (256 bytes, since 37 is coprime with 256) -- any window of 48 bytes recurs every 256
bytes, so a search tool that looks for "long distinctive runs" will find the fixture run matching
at *multiple* target offsets and reject it as non-unique, exactly the behaviour meant to be tested
against a genuinely distinctive run. **Fix used:** a sha256-counter-mode fill
(`createHash("sha256").update(seed+counter).digest()` concatenated) has no short period and behaves
like real C64 program-image bytes for this purpose. **Saves:** the next test needing a "distinctive,
non-repeating" byte fixture (anywhere in this project, not just `tools/diff-images.test.mjs`) should
reach for a hash-counter fill rather than a linear congruence or other short-period generator.

### 2026-08-01 — a coarse fixed-stride candidate sampler can miss a narrow non-trivial region entirely, not just under-sample it

**Type:** dead end / hazard (own tool-design mistake, caught before commit)
**Evidence:** live -- `tools/diff-images.mjs`'s first `anchorSearch` draft, caught by its own test
suite
**Confidence:** HIGH

The first draft of `anchorSearch` walked candidate offsets with a fixed stride (`step`) computed
from `(imageLength / (count * 6))`, then filtered each sampled window for triviality. For a real
65536-byte image with abundant non-trivial data this rarely matters, but for a small/narrow
distinctive region (exactly the shape of a synthetic test fixture, and potentially of a genuinely
narrow real anchor candidate near a boundary) the stride can step clean over the region without
ever sampling a window inside it -- silently returning zero candidates from that area rather than
finding and correctly rejecting or accepting one. **Fix:** scan every offset for the triviality
check (cheap: O(imageLength * minRunLength) byte comparisons, well under a second even at 65536
bytes), then spread the final `count` picks across the resulting candidate list. **Saves:** avoids
a class of "anchor search silently found nothing near address X" bug that would be very hard to
notice without a synthetic test exercising exactly that boundary.

### 2026-08-01 — the container-side grant poll gives up at 25s while the measured tool-call budget is >=150s, so parallel wave width is capped at about three agents by a default nobody chose

**Type:** hazard
**Evidence:** source read, not live measurement. `GRANT_POLL_TIMEOUT_MS` default 25000 read from
`.claude/mcp/vice/vice-broker-client.mjs:213`; the >=150s tool-call budget and the "a cold x64sc
launch is seconds" note read from `.planning/spikes/003-timeout-budgets/README.md:139` and
`:104-105`.
**Confidence:** HIGH for the two constants themselves (both read directly from their source files); LOW for the ~8s boot time used to derive wave-width behaviour from them (assumed, never measured); MEDIUM at best, therefore, for any wave-width arithmetic built on top of that assumption.
**Saves / costs:** one config change — raising `GRANT_POLL_TIMEOUT_MS` toward ~120000ms — recovers
waves wider than three agents immediately, independent of any broker rewrite. Ignoring it costs
waves that fail by denial with no visible pattern, which reads as pool-size trouble or host
instability rather than what it actually is: a client-side deadline shorter than the platform's own
measured budget.

The two numbers live in different registers — one inside container-side client code, the other in
a spike README — which is why the mismatch went unnoticed for as long as it did. The general
lesson: a client-side deadline shorter than the platform's measured budget is a self-imposed cap
that reads to everyone downstream as a platform limit, not a config default someone can just raise.

### 2026-08-02 — boot time measured live on the host: sub-second, not the assumed ~8s

**Type:** confirmation (promotes a previously LOW-graded assumption)
**Evidence:** live on the host — nanosecond `launched_at`/`ready_at` fields read from
`.vice-supervisor/spares/*.json` before the broker was shut down, during a
`VICE_BROKER_BASE_PORT=6540 tools/vice-broker.sh start 3` run.

| Port | launched_at (ns) | ready_at (ns) | elapsed |
|---|---|---|---|
| 6541 | 1785658461697376099 | 1785658462352542811 | 0.655 s |
| 6542 | 1785658462399346879 | 1785658463038645810 | 0.639 s |
| 6543 | 1785658820902732602 | 1785658821608383711 | 0.706 s |

**Confidence:** HIGH that boot is sub-second; MEDIUM for any specific figure — `ready_at` is stamped when `maintain_spares()` observes `probe_ready()` succeed and passes run every `VICE_BROKER_POLL_MS=500`, so each figure is an upper bound with up to ~0.5s of poll latency in it, and true boot sits somewhere in ~0.14–0.71s.
**Saves / costs:** any future wave-width or pool-sizing arithmetic now starts from a measured
sub-second boot instead of a guess, and the measurement route itself — read the nanosecond fields
out of the broker's own spare records — is reusable in minutes.

### 2026-08-02 — supersedes the 2026-08-01 grant-poll entry: the timeout was never the cap, `VICE_BROKER_MAX` is

**Type:** correction / dead end retired
**Evidence:** live measurement (the boot-time entry directly above) plus the two constants as
originally read (`GRANT_POLL_TIMEOUT_MS=25000`, tool-call budget >=150s).
**Confidence:** HIGH for the retraction; MEDIUM for the ~36 figure, since it inherits the upper-bound boot number.
**Saves / costs:** this entry supersedes the 2026-08-01 entry above titled "the container-side
grant poll gives up at 25s while the measured tool-call budget is >=150s, so parallel wave width
is capped at about three agents by a default nobody chose" — its two constants were correct and
remain so; its LOW-graded ~8s boot input was the part that failed. At ~0.7s per serialised boot
the 25s deadline binds at roughly 36 agents, so `VICE_BROKER_MAX=16` binds first and the timeout
was never the cap. General lesson: an entry whose conclusion rests on one unmeasured input should
be re-read as soon as that input is measured, because the conclusion had already propagated into
a design note, a todo and a spike before the measurement existed.

### 2026-08-02 — the boot-time log rounds every sub-second boot down to `(0s)`

**Type:** hazard
**Evidence:** live — the four `(0s)` log lines observed alongside the nanosecond records that
contradict them, from the same 2026-08-02 host run.
**Confidence:** HIGH for the rendering, MEDIUM for the integer-division attribution, since the host script was not read in this container.
**Saves / costs:** `maintain_spares()` computes elapsed seconds with integer division
(`elapsed_s=$((elapsed_ns / 1000000000))`), so every sub-second boot renders as `(0s)` — all four
launches in the 2026-08-02 log did (e.g. `vice-broker: port 6540 launching -> ready (0s)`). The
only human-readable boot figure in the system rounds the true value to zero and reads as "instant,
or unmeasured," while full nanosecond precision sits unused in the JSON one directory away. This
is why an 8x-wrong boot assumption survived for a day with nothing to contradict it: a
rounded-to-zero display of a value the system measures precisely is worse than no display, because
it reads as an answer.

### 2026-08-02 — host validation of serialised spare warming PASSED: zero races across four launches, instant grant, clean reap

**Type:** confirmation
**Evidence:** live — the verbatim broker output from
`VICE_BROKER_BASE_PORT=6540 tools/vice-broker.sh start 3`, plus `mcp__vice__vice_ping` answering
`{"status":"ok","version":"3.10","machine":"C64SC","execution":"paused"}` from the granted
instance.
**Confidence:** HIGH.
**Saves / costs:** four launches, strictly one per pass, each reaching `ready` before the next
began, with zero SEGV, zero exit-1 and zero exit-0 races — the exact 2026-08-01
three-simultaneous-boot failure (one SEGV, one exit 1, one exit 0 at an identical spawn second)
did not recur. Instant grant from a warm spare (`granted request
req-132346-1785658820506-ed4707b4 -> port 6540 (from ready spare)`), floor restored by the
immediate launch of the next port, clean reap of 4 on `^C` (`reap saw 4 recorded instance(s),
terminated 4`) with protocol state purged. The serialisation fix is now confirmed on the machine
it was written for, so the GPU/audio init race can be treated as closed rather than as a suspect
the next time a wave misbehaves.

### 2026-08-02 — defect 4 reproduced a second time: a deliberate broker shutdown poisons a session exactly like a crash

**Type:** hazard, second sighting
**Evidence:** live — two consecutive `mcp__vice__vice_ping` calls returning byte-identical
`ECONNREFUSED` against the cached grant (`req-132346-1785658820506-ed4707b4`, port 6540, epoch 3,
pid 3493998) after the broker's `^C` reaped this session's granted instance, plus
`.vice-supervisor/6540/supervisor.log` showing `caught signal, shutting down` / `terminating
child pid 3493998` / `clean shutdown` (proving the emulator was signalled, not crashed) and
`.vice-supervisor/6540/logs/x64sc-20260802-081421.log` truncating mid-line inside `MCP-Tools: Handling tools/ca` (proving x64sc died mid-request).
**Confidence:** HIGH.
**Saves / costs:** the proxy holds a dead grant for the session's whole life with no re-request
path. The new fact this run adds: an orderly, intentional broker shutdown poisons a session
exactly as a crash does, so "the host is fine now" never recovers it — the remedy is a new
session, and a session that loses its instance loses its accumulated context. Distinguish
carefully: the reap-everything contract is deliberate and correct (qpq chose it because orphans
cost more than an interrupted session); the fragility is that the broker only runs in the
foreground. Logged here as a reproduction only — no duplicate todo is opened, because defect 4
already has one:
`.planning/todos/pending/2026-08-01-vice-broker-spare-warming-and-stale-grant-defects.md`.

## Corrections to earlier entries

### 2026-08-01 — CORRECTION: the `vice_disk_attach` relative-path failure was a deleted contract, not a translation defect — and it is now fixed

**Type:** confirmation (corrects the 2026-08-01 hazard entry above), plus a dead end retired
**Evidence:** live *and* source. Live, on the pre-fix proxy this session:
`vice_disk_attach({unit:8, path:"disks/danish.d64"})` → the misleading host-launcher error;
`path:"/workspaces/bruce_lee/disks/danish.d64"` → `{"status":"ok","unit":8,"drive":0,
"path":"/home/henrik/dev/henrik/git/bruce_lee/disks/danish.d64"}`. Source: `vice-proxy.mjs`'s
own comment declared the pass-through a **deliberate stated residual**, not an oversight.
**Confidence:** HIGH (both halves verified directly).
**Saves/costs:** the earlier entry's diagnosis — "a relative path the host-side path-translation
layer can't resolve" — was wrong, and would have had every future session performing an
absolute-path ritual forever instead of fixing a ten-line gap.

The earlier entry said "always resolve to an absolute in-container path … never pass a
repo-relative string". **That instruction is now obsolete.** What was actually true:

- The residual was deliberate, and its reasoning was sound *for a walker with no schema*: a
  relative string is indistinguishable from a label or a hex address like `$0400`.
- Its caller-facing half — a `SKILL.md` "Paths" section the code comment explicitly cited —
  **was deleted in `db9eed3`**. The code kept the requirement; nothing was left stating it.
- `.claude/CLAUDE.md` then promised the opposite ("pass container paths and let the tools
  handle the boundary"). A relative path *is* a container path, so the 01-04 executor did
  exactly as instructed and hit the residual.
- The premise had also expired: `tools-manifest.json` types every argument, and exactly four
  declare a path (`vice_disk_attach`, `vice_autostart`, `vice_display_screenshot`,
  `vice_symbols_load` — all named `path`). The proxy already loads that manifest to serve
  `tools/list`; the walker just never consulted it.

**Fixed this session** (`vice-proxy.mjs`, 190 tests green across all six suites): a relative
string in a *manifest-declared* path argument resolves against the workspace root, then
translates as before. Everything else keeps the byte-identical pass-through. The result now
names what was written and the absolute container path it became, and both failure branches
lead with the caller's own string rather than a host path they cannot act on.

**Two general lessons worth more than the fix:**

1. **A "stated residual" is only safe while the document stating it exists.** Deleting a
   SKILL.md deletes half of a design. Grep for what cites a doc before removing it.
2. **A findings-log entry that records a workaround for our own tooling will outlive the
   defect and become folklore.** This entry existed for hours and already contained a
   confident wrong diagnosis aimed at every future session. When logging a workaround, say
   what would make it obsolete.

**Still open, and NOT ours:** `vice_ping`'s `execution` field reporting `"running"` at zero
cycles, and state reads pausing without resuming, are **upstream host-side VICE MCP**
behaviour — `execution` appears in `vice-proxy.mjs` only inside a comment. Do not re-file
those as proxy defects; the cycle-bracket rule above remains the answer.

**Deployment caveat:** the MCP server process is spawned once per session. A session already
running when the fix landed keeps the old behaviour until it is restarted — which is exactly
how it was verified here.

### 2026-08-02 — real agent think-time between tool calls lets the emulator run unattended, at full speed, for far longer than intended, unless execution is EXPLICITLY paused; this likely confounds every "hazard counter" finding recorded so far

**Type:** hazard (methodology), plus a confirmation of the fix
**Evidence:** live, 01-04 attempt 5, danish Task 3, first play-through session
**Confidence:** HIGH (measured directly, reproduced immediately with a control)

Sequence observed: pressed F7 to start a 1-player game, confirmed via screenshot that chamber 1
was already active (HUD showing `FALLS 04`, cycle bracket healthy). Between that screenshot and
the next one — with only a handful of `mcp__vice__vice_memory_read` / `vice_registers_get` /
`vice_cycles_stopwatch` calls in between, and **zero joystick input sent** — the game had already
progressed through a "PLAYER 1" interstitial and reached a full `GAME OVER / PLAYER 1 / 000000`
screen. `vice_cycles_stopwatch` read **258,504,308** cycles elapsed since the F7 press, i.e.
roughly **262 seconds of PAL emulated time** (~985 kHz clock) — all of it real, unattended
execution while the agent was composing tool calls and reasoning between messages, not anything
the game's own logic did in response to input. A second confirmation: calling
`vice_execution_pause` and then immediately re-reading the stopwatch still showed the cycle count
climb another ~20,000,000 cycles before finally settling — consistent with the pause taking effect
only once actually processed, with real elapsed agent-side latency counted as running time right up
until that point. Once genuinely paused, however, two consecutive `vice_cycles_stopwatch read` calls
with nothing in between returned the **identical** value (278,035,001 twice) — confirming the pause,
once landed, holds solidly with no further drift.

**This directly threatens the FALLS-counter hazard conclusion attempt 4 recorded** ("depletes ~1 per
input event regardless of direction"): if the machine keeps running at full native speed through
every one of the agent's non-input observation calls (screenshots, memory reads, registers_get),
then the elapsed real time between "enter the room" and "send the first joystick tap" is itself
enough emulated seconds for Bruce Lee to die from ordinary gameplay hazards (patrolling enemies,
falling objects) with **no** relationship to the discrete input count at all. Attempt 4's six
failed restarts, and this session's own near-instant `GAME OVER` with zero input sent, are both
consistent with "the agent's own tool-call/reasoning latency burns real game-seconds unattended",
which is a confound attempt 4 had no way to rule out because it never paused between its own
observation steps either.

**The fix, adopted from this point in this session onward:** call `mcp__vice__vice_execution_pause`
immediately after every observation (screenshot, memory read, register read) that is not
immediately followed by a deliberate scripted input, and resume with `vice_execution_run` only for
the bounded duration of that input (a `vice_joystick_tap`'s own frame count, or a short explicit
poll-and-repause window). Never leave the machine in "running" state across a reasoning step.

**Saves/costs:** if this holds up under a repeat test with pausing disciplined from the very start
of a room, it could turn the FALLS-counter "hazard" from a room-navigation puzzle into a solved
non-issue — the room may not be especially difficult at all once the agent stops burning its own
budget as unattended game-seconds. Costs: this session's first life on danish, spent confirming the
theory rather than progressing. A future session (or the rest of this one) should verify by holding
strict discipline from the very first frame of a chamber and comparing survival time.

**Confirmation, same session, immediately after adopting the discipline:** with `vice_execution_pause`
called after every observation from this point forward, danish's chamber 1 opening room -- the same
room that cost saeger six restart-from-title attempts in attempt 4, all attributed to the FALLS
counter -- was crossed cleanly: FALLS held at `04` through two full `right` taps with no depletion at
all, only dropping (`04`->`03`->`02`->`01`->`00`) during a stretch of enemy contact/attack exchanges,
and did **not** cause an immediate death at `00` -- Bruce Lee continued taking `right` input and
crossing further ground (from spawn at sprite x=52 past the pedestal at x=136, to x=244 at the
doorway, then further to x=304 with the sprite disabled, i.e. genuinely progressing through and past
the room) while `FALLS` sat at `00` for several more actions before an eventual `GAME OVER`. This
reframes the FALLS counter: it is not a simple per-input death timer, and disciplined pausing alone
turned what previously read as an impassable hazard into a room that was crossed on the very next
attempt. **Confidence raised to HIGH** for the "unpaused agent think-time is a real confound"
half of this finding; the exact FALLS trigger condition (still not root-caused at the disassembly
level) remains MEDIUM/open.

### 2026-08-02 — a genuine mid-session host VICE crash during 01-04 attempt 5's danish Task 3 restart test, self-healed on the next call (epoch 4 -> 5)

**Type:** hazard, plus a confirmation the self-heal mechanism still works
**Evidence:** live -- 01-04 attempt 5, danish Task 3, immediately after capturing a fully-evidenced
GAME OVER milestone (screen-matrix signature, sprite_enable, registers, cycles_advanced all read
successfully) and issuing `vice_execution_run` + `vice_keyboard_matrix(F7)` to test the restart
milestone. The next `vice_ping` reported `execution:"running"`, but the following
`vice_execution_pause` failed with `UND_ERR_SOCKET` naming a specific lease/port/pid ("may have
crashed after being granted"). The next `vice_ping` call reported the epoch drift explicitly
(`4 -> 5`, new pid, new spawned_at timestamp), and the call after THAT succeeded normally
(`execution:"paused"`, i.e. a fresh boot). `vice_checkpoint_list` on the new instance immediately
returned `count:0`.
**Confidence:** HIGH (matches the exact three-call shape documented in the 2026-08-01 epoch-drift
entries above: loud transport error -> epoch-drift report -> clean resume on the new instance).
**Costs/saves:** voided only the in-flight restart-test step (nothing else, since the GAME OVER
evidence had already been read successfully on the prior, confirmed-live instance moments earlier
with no crash indicator in between) -- the whole boot procedure had to be redone from
`vice_disk_attach` on the new epoch-5 instance to get back into a session. Confirms yet again that
this class of crash is self-healing and does not require abandoning the session, unlike a genuine
silent stall (which has no such recovery and must be abandoned per the standing rule).

### 2026-08-02 — danish chamber 1's ground-level rightward path dies at the SAME precise sprite x-coordinate (~290-304) every time, across six independent attempts; the room's central chain-ladder was never climbed

**Type:** hazard / dead end (a specific technique tried and ruled out)
**Evidence:** live -- 01-04 attempt 5, danish Task 3, six independent play-throughs of chamber 1's
opening room across this session (three following host-crash re-boots, one following a fresh
restart), tracked via `mcp__vice__vice_sprite_get` on Bruce's own sprite (sprite 0) at each step
**Confidence:** HIGH (six independent repetitions, same outcome, precise coordinate match each
time -- this is not attributable to timing variance or enemy randomness)

Every attempt that walked Bruce rightward from the starting pole reached almost exactly sprite
`x=296-304` before an immediate death (sprite disabled, next screenshot shows the `PLAYER 1`
interstitial), regardless of how many enemy encounters or fire+right attacks preceded it along the
way. This is a different failure mode from saeger's own chamber-1 FALLS-counter hazard (attempt 4):
here the death is tied to a **precise horizontal position**, not to an elapsed input count. Three
techniques were tried and ruled out as the fix: (1) plain `right` taps through the zone -- always
died; (2) a `right`+`fire` attack tap at the same zone -- always died; (3) an `up` tap attempted at
three different x-positions along the path (76, 148, 196) to test whether the room's visible
central blue chain-ladder structure is climbable -- produced only continued forward walking or a
duck/crouch animation at every position tried, never vertical ascent. A fourth technique (a
diagonal jump via `direction: ["up","right"]` on `vice_joystick_tap`) was attempted once but failed
on a tool-parameter format error (the direction array was passed as a JSON string instead of an
actual array) and was not successfully retried before the session's live budget ran out.
**Saves/costs:** a future session should NOT re-spend lives re-confirming this exact wall exists --
six repetitions is more than enough. Two concrete next steps, in priority order: (a) retry the
diagonal-jump array syntax correctly (`direction: ["up","right"]` as an actual array parameter, not
a string) exactly at the x~280-296 approach to the hazard, since a jump-over is the most likely fix
for a "precise x-coordinate kill" shape (consistent with a pit/trap/spike at that exact location);
(b) if that fails, arm a live disassembly/backtrace capture (stopping checkpoint or a paused-state
read) at the moment of death to identify the exact code path and hazard type mechanically, rather
than continuing blind trial-and-error. The central chain-ladder's climb point, if one exists, was
never found in this session and remains a completely open question -- it may require a jump onto
it rather than a simple directional approach.

### 2026-08-02 — the "silent stall" may be a self-inflicted checkpoint trap, and all three recorded incidents share an armed stopping checkpoint, not an address

**Type:** hypothesis (a shortcut if it holds; the strongest candidate mechanism on record)
**Evidence:** cross-read of three already-recorded incidents during `/gsd-discuss-phase 01.3` — no
new live execution. Derived from
`.planning/todos/pending/2026-08-01-vice-registers-frozen-after-reset-during-01-04-task2.md`,
`…-vice-silent-stall-during-01-04-task3-saeger-playthrough.md` and
`…-vice-silent-stall-attempt4-froze-at-same-pc-as-attempt3.md`.
**Confidence:** MEDIUM — the correlation is real and covers 3/3 incidents, the mechanism is
consistent with every recorded symptom, and it is testable in minutes. It has not been reproduced.
**Saves:** potentially the entire recovery path — a checkpoint trap needs no restart, no kill and no
lost session, only a checkpoint deleted. Also saves killing a *healthy* instance in the belief it
was wedged.

**The correlation.** The common factor across all three freezes is not `$DD00` and not chamber-1
entry. It is: **a stopping exec checkpoint was armed, and execution was resumed.**

- Attempt 3 and attempt 4 both froze at `PC:2014` (`$07DE`) — the instruction immediately after
  `STA $DD00`, which is exactly where a stopping checkpoint on that store had just parked the
  machine before execution was resumed.
- The 01-04 Task 2 incident began *immediately after* an exec+stop checkpoint was armed at
  **`$1103`, an IRQ-handler entry**, on a title screen with a confirmed live raster-split IRQ chain
  `$1103→$1574→$152C`.

**The tell, and it is the strongest single piece of evidence:** in the `$1103` incident,
`vice_checkpoint_list` reported that checkpoint at **`hit_count: 0`** after multiple resume/poll
cycles — on an IRQ-driven screen where `$1103` must execute every frame. A checkpoint that cannot
register a hit on an address the machine is obliged to execute means the machine was not getting
there.

**The mechanism this implies.** An armed stopping checkpoint pins the PC because every resume
re-enters the trap before any useful work retires. That reproduces the full documented signature
with nothing else required: the cycle bracket reads exactly `0`; `vice_ping` answers
`execution:"running"` because VICE's execution flag flips before the trap fires; and
`vice_registers_get` returns a byte-identical PC every time because **the machine genuinely never
moved** — which is a simpler explanation than the "stale/cached register-reporting path" the
original todo reached for.

**How to test it, container-side, in two reads.** Before running any cycle bracket:
`vice_checkpoint_list` to enumerate what is armed, then resolve the live IRQ handler — `$0314/$0315`
normally, `$FFFE/$FFFF` when `$01` has the ROMs banked out (see the 2026-08-01 vector-table entry).
An armed *stopping* checkpoint at or inside the live IRQ path, with the PC pinned at or just past
it, is the signature. **No `vice_execution_run` is needed to reach this verdict** — which matters,
because `vice_execution_run` is this project's leading crash suspect (D-1.2-F) and the liveness
bracket requires it.

**The counter-evidence, which is why this is MEDIUM and not HIGH.** In the `$1103` incident,
deleting the offending checkpoint did **not** unfreeze the machine, and neither did a soft reset, a
hard reset, nor an explicit `vice_execution_step({count:1})`. So a checkpoint trap may be the
*onset* without being the whole story — it may be what tips VICE into a state it cannot leave.
Do not assume delete-and-resume always recovers it.

**Costs if wrong:** none beyond two cheap reads. Checking for a checkpoint trap before running a
bracket is strictly cheaper than the bracket itself.

**Consequence for technique, applicable immediately and independently of Phase 01.3:** a stopping
exec checkpoint on an IRQ handler entry is core RE technique that Phase 2's exhaustive trace
depends on, so this is **not** a reason to stop using it. It is a reason to enumerate armed
checkpoints *first* whenever the machine looks frozen, and to suspect what you armed before
concluding the emulator died.

### 2026-08-02 — the trigger hunt's own denominator: 0 of 6, blocked before the first attempt

**Type:** dead end (a real, bounded negative — plan 01.3-05's own required outcome statement)
**Evidence:** live, this session — see `.planning/phases/01.3-wedge-detection-and-recovery/01.3-TRIGGER-HUNT.md`
in full, and the "unreachable tools" entry above for the reason
**Confidence:** HIGH (the fact of zero attempts, and the reason for it, are both directly
established this session — not an inference)
**Saves:** a future session resuming this hunt does not have to re-discover that `vice_diagnose`/
`vice_recycle` need to be confirmed reachable, by name, before Variant A's first attempt — checking
only `vice_ping` is not sufficient, because a healthy `vice_ping` does not imply the rest of the
proxy-local synthetic-tool surface is reachable in the same session

Neither of the plan's two variants (Variant A, mid-routine, `$07DB`/`$07DE` shape; Variant B,
IRQ-entry, `$1103` shape) was started. The budget of 6 (3 + 3) is entirely unspent. This is recorded
as a real result per this project's own rule against fabricating attempts, and per the plan's own
"if the emulator cannot be reached at all, record that as the outcome and stop" contingency,
generalized here to cover "the emulator is reachable but the specific tools this hunt's safety case
depends on are not."

### 2026-08-02 — the checkpoint-trap correlation stands exactly where it was before this hunt ran: neither strengthened nor weakened

**Type:** confirmation (of non-change — an explicit statement that no new evidence moved an
existing grade, so a future reader does not mistake silence for erosion)
**Evidence:** this session gathered zero new live evidence (see the two entries immediately above);
the existing correlation and its caveat, entered 2026-08-02 during phase discussion (§ "the 'silent
stall' may be a self-inflicted checkpoint trap..." above), are unchanged and not re-graded here
**Confidence:** MEDIUM, unchanged from the existing entry — cross-session at N=2 (mid-routine) / N=1
(IRQ-entry), with the counter-evidence (delete/soft-reset/hard-reset/single-step all failing to
unstick the `$1103` incident) still the reason it is MEDIUM and not HIGH
**Saves:** tells a future reader explicitly that this plan's own bounded trigger hunt did not touch
the existing checkpoint-trap grade, rather than leaving that as something to infer from the absence
of a promotion entry

Plan 01.3-05 set out to either confirm a trigger (promoting this correlation toward HIGH via a
reproduced attempt) or record a bounded negative against it (attempts made, no reproduction). It did
neither — it was blocked before its first attempt (see above). The existing correlation's grade is
therefore **not promoted and not demoted**; it is exactly where the phase-discussion cross-read left
it. A future session that actually runs Variant A/B is what would move this grade in either
direction; this session's own contribution is limited to confirming why it could not attempt to.

### 2026-08-02 — `resolveLiveIrqHandler()`'s vector lookup was not exercised live this session; its MEDIUM grade is unchanged

**Type:** dead end (an explicit non-promotion, so the existing grade is not silently assumed stale)
**Evidence:** this session made zero `vice_diagnose` calls (unreachable — see above) and zero manual
replications of its vector-lookup logic, since no attempt reached the point of needing one; the
existing "vector table" (2026-08-01) and "HIRAM bit" (2026-08-02) entries are unchanged
**Confidence:** HIGH that no live exercise occurred this session (a direct fact about this session);
the underlying vector-lookup claim itself remains at its pre-existing MEDIUM, untouched
**Saves:** the plan's own instruction was "if the hunt resolved a live handler and the resolution
proved correct... re-log it... If it was not exercised live, say so and leave the existing grade
alone" — this entry is that explicit statement, so a future reader does not have to check whether
promotion silently happened or was silently skipped

Neither `$0314/$0315` nor `$FFFE/$FFFF` was read this session, live, against a real IRQ-driven
screen, because Variant B (the variant that would have exercised this lookup) was never started.
The existing MEDIUM-confidence vector-table entries stand exactly as they were.

### 2026-08-02 — the exact bit of `$01` that decides which IRQ vector pair is live: HIRAM, bit 1

**Type:** shortcut (sharpens an existing MEDIUM finding)
**Evidence:** doc-derived — standard 6510 processor-port bit assignment (`$01`: bit 0 LORAM, bit 1
HIRAM, bit 2 CHAREN), applied while implementing `vice_diagnose`'s `resolveLiveIrqHandler()`
(plan 01.3-02)
**Confidence:** MEDIUM — standard, well-documented C64 hardware fact, not yet cross-checked live
against this project's own recovered image
**Saves:** the existing "vector table" entry (2026-08-01) says to check `$01` before trusting
either vector pair but does not name which bit decides; this closes that gap with one line instead
of a re-derivation next time a vector lookup is implemented

The 6510 processor port at `$01` controls memory banking via three bits: bit 0 (LORAM, BASIC ROM),
bit 1 (**HIRAM**, KERNAL ROM), bit 2 (CHAREN, character ROM vs I/O). The default power-on value is
`$37` (`0011 0111`) — all three set, i.e. BASIC+KERNAL+I/O all banked in. **HIRAM (bit 1, mask
`0x02`) is specifically the bit that decides which IRQ vector pair is live**: when set, the KERNAL
ROM is banked in and the CPU's hardware IRQ/BRK vector (`$FFFE/$FFFF`) resolves to the ROM's own
fixed dispatcher, which itself indirects through the RAM-resident `$0314/$0315` pair — so
`$0314/$0315` is the pair to trust while HIRAM is set. When HIRAM is clear, the KERNAL is replaced
by RAM and the CPU reads `$FFFE/$FFFF` directly with no ROM indirection, so *that* pair becomes the
one actually dispatched. `resolveLiveIrqHandler()` implements this as `($01 & 0x02) === 0` deciding
"banked out". Not yet independently verified against a live wedge in this project's own image — the
first real `vice_diagnose` run over a genuine checkpoint trap is what would promote this to HIGH.

### 2026-08-02 — `vice_diagnose` and `vice_recycle` (and even the older `vice_result_continue`) are unreachable from an agent session's own tool surface, even though the running proxy's code has them fully wired

**Type:** hazard (blocks plan 01.3-05's live trigger hunt entirely, before a single attempt)
**Evidence:** live, this session, cross-checked against the source directly:
- `mcp__vice__vice_ping` (a named, directly-callable tool function) works normally and returns a
  real result — confirming the session's MCP connection to `vice-proxy.mjs` is live and healthy.
- Neither `vice_diagnose` nor `vice_recycle` appears as a directly-callable named tool function in
  this session, and a tool-schema search for either name (or for `vice_result_continue`) returns no
  match — as if none of the three proxy-local synthetic tools exist.
- The generic escape-hatch tools this session *does* expose, `tools_list`/`tools_call` (both under
  the `mcp__vice__` prefix), behave as a **lower-level bypass that never reaches
  `handleToolsCall()`'s synthetic-tool dispatch**: `tools_list` returns the raw 64-tool manifest
  set with `vice_disk_list` **present** (it should never appear — layer 2/3 of the four-layer
  deny-list guard exists specifically to keep it out of any `tools/list` response) and with none of
  the three synthetic tools present; `tools_call({name:"vice_ping"})` succeeds normally (a real host
  tool, forwarded correctly); `tools_call({name:"vice_recycle"})`, `tools_call({name:"vice_diagnose"})`
  and `tools_call({name:"vice_result_continue"})` **all three** fail identically with `vice-proxy: the
  host VICE MCP server ... rejected this call: Tool not found` — the exact wording
  `aliveButFailedMessage()` (`vice-proxy.mjs:1364-1370`) emits when the **real x64sc host** rejects a
  forwarded call, meaning `tools_call` forwarded the literal string `"vice_diagnose"` straight to the
  host rather than intercepting it proxy-side.
- Directly confirmed this is not a stale-file/stale-process problem: `grep -c
  "DIAGNOSE_TOOL\|RECYCLE_TOOL" .claude/mcp/vice/vice-proxy.mjs` on the main workspace checkout
  (`/workspaces/bruce_lee`, the cwd the running `vice-proxy.mjs` process was launched from, confirmed
  via `/proc/<pid>/cwd`) returns 6 hits, and the dispatch lines (`if (name === RECYCLE_TOOL.name)`,
  `if (name === DIAGNOSE_TOOL.name)`, the `handleToolsList()` concatenation at `const tools = [...
  manifestTools, RESULT_CONTINUE_TOOL, RECYCLE_TOOL, DIAGNOSE_TOOL]`) are present at the identical
  line numbers as this worktree's own copy. The file's mtime (17:01:10 UTC) predates the running
  process's start time (~17:06 UTC, derived from `/proc/<pid>/stat` field 22 against `/proc/uptime`),
  so the running process loaded this exact, fully-wired code. The code is correct; the gap is
  elsewhere.
- Most likely explanation, not independently confirmed further (this is the point at which the
  question becomes harness/session-discovery-internal rather than emulator-internal, so the
  investigation stopped here per D-11's boundary): this session's set of directly-callable named
  `mcp__vice__vice_*` tool functions was generated from a snapshot that never includes proxy-local
  synthetic tools by construction — consistent with Key Finding 3's own confirmation that
  `tools-manifest.json` **never** contains them (`refresh-manifest.mjs` only ever writes real,
  forwardable host tools). If the harness's per-tool function generation reads that manifest file
  rather than issuing a live `tools/list` JSON-RPC call through `handleToolsList()`, it would produce
  exactly this result, and would do so for every proxy-local synthetic tool ever added, not just
  the three checked here.
**Confidence:** HIGH for the observed behavior (all four probes reproduced directly, in this
session); MEDIUM for the causal explanation (the manifest-snapshot hypothesis is the most
parsimonious account of every observation but was not confirmed by reading the harness's own
tool-discovery code, which is outside this project's tree).
**Costs:** this is the reason plan 01.3-05's live trigger hunt could not run a single attempt this
session — every attempt in the plan's own design needs a `vice_diagnose` verdict, and recovery from
a genuine wedge needs `vice_recycle`; neither is reachable. Blocks the whole D-05 sequencing
rationale ("recycle first is what makes the six-attempt budget affordable") from applying in an
agent session shaped like this one. Filed as an actionable item at
`.planning/todos/pending/2026-08-02-vice-diagnose-and-vice-recycle-unreachable-from-agent-session.md`.

### 2026-08-02 — arming a stopping checkpoint on the KERNAL default IRQ handler (`$EA31`) bounds a resume to almost exactly one frame regardless of real-world latency

**Type:** trick (re-logged from an orphaned worktree branch — this entry never reached `main`'s
`RE-FINDINGS.md`, per plan 01.3-05's own instructions to preserve it here with its original
evidence and confidence intact, append-only)
**Evidence:** live, 01-04 attempt 6, danish. `$0314/$0315` read `$31/$EA` (untouched default vector
— this game does not hook a custom IRQ handler, so the stock jiffy/keyboard-scan ISR fires every
frame off the CIA1 timer). Armed one exec-break stopping checkpoint at `$EA31`. Two independent
`cycles_stopwatch reset -> execution_run -> vice_registers_get` brackets, with NO `vice_ping`
polling between, each measured **exactly 19,656 cycles** — one PAL frame, bit-for-bit identical
both times — regardless of how many real seconds of reasoning passed between the calls.
`vice_checkpoint_list` confirmed `hit_count` incrementing by exactly 1 per resume.
**Confidence:** HIGH.
**Saves:** to advance exactly N frames deterministically: `vice_checkpoint_set_ignore_count(cp,
N-1)`, set the joystick/key state, ONE `execution_run`, then read state.

**Caveat, recorded rather than smoothed over:** the reported PC after each halt was `$E5CD`/`$E5D1`
(a KERNAL idle-loop address past the IRQ's RTI), not `$EA31` itself — the checkpoint reliably GATES
elapsed game time to one frame per resume, but does not necessarily leave the CPU parked at the
breakpoint address. The frame-count guarantee is the load-bearing part, not the PC.

**The tension this technique creates for a checkpoint-arm-and-resume trigger hunt.** It works by
*arming a stopping exec checkpoint and resuming* — precisely the call shape plan 01.3-05's trigger
hunt investigates as the freeze cause (all three recorded freezes share that shape; D-09 retargeted
the hunt to the family rather than one address). Using it as a measurement instrument while hunting
it as a suspect risks confounding the experiment or self-inflicting the freeze under study.

### 2026-08-02 — the `$EA31` frame-bounding technique was neither used nor tested this session; the tension was decided, not resolved

**Type:** dead end (an unresolved question, not a conclusion) / confirmation of a procedural decision
**Evidence:** none live — plan 01.3-05's own trigger hunt was blocked before its first attempt (see
the entry immediately above this section and `01.3-TRIGGER-HUNT.md`)
**Confidence:** N/A (no measurement was taken; this entry records a decision, not a fact about the
emulator)
**Saves:** a future session resuming the hunt does not have to re-derive the instrument-vs-suspect
decision from scratch

The decision recorded in `01.3-TRIGGER-HUNT.md`'s setup section, made before any attempt was
possible: this hunt's procedure would **not** use the `$EA31` frame-bounding technique as
measurement tooling for its own attempts — every checkpoint armed during an attempt would be the
checkpoint *under investigation*, never a second, frame-bounding instrument layered on top, because
that would confound which armed checkpoint (if either) caused an observed freeze. This decision was
never exercised, because no attempt reached the point of arming any checkpoint at all this session
(see the `vice_diagnose`/`vice_recycle` unreachability finding above). Neither role — instrument nor
suspect — was tested live this session. The `$EA31` finding immediately above stands exactly where
it was: HIGH confidence for the frame-bounding fact itself (established in a *different* session,
01-04 attempt 6), untested for whether it participates in the freeze this hunt investigates.


### 2026-08-02 — CONFIRMED LIVE: a fresh agent session *does* surface proxy-local synthetic tools; the unreachability is per-session snapshot staleness, not a code or broker defect

**Type:** confirmation (promotes, by re-logging, the explicitly-unverified expectation recorded in
`01.3/.continue-here.md` — "A fresh session is expected to fix this ... That expectation is
**unverified** — this session never observed it working")
**Evidence:** live, this session, as the first action of the `/gsd-execute-phase 01.3` orchestrator
before any wave-5 dispatch: `ToolSearch: select:mcp__vice__vice_diagnose,mcp__vice__vice_recycle`
returned **both** full schemas — `vice_diagnose` (no parameters; five-state verdict; leaves the
machine PAUSED after a bracket) and `vice_recycle` (required non-empty `reason`, written to a
repo-tracked incident record before anything is killed). Nothing on the host was changed between the
previous session's four failed probes and this load: the broker was not restarted, `vice-proxy.mjs`
was not edited, no resource was re-deployed. The only variable that differed is the session itself.
**Confidence:** HIGH for the observation (both schemas loaded by exact name, in one call). HIGH,
raised from the prior entry's MEDIUM, for the causal account: the surviving hypothesis is now the
only one standing — the client's callable-tool surface is a **snapshot taken at MCP initialization**,
and Claude Code spawns `vice-proxy.mjs` per session, so a new process runs the current on-disk
`handleToolsList()` and its synthetics appear. Same code, same broker, different session, opposite
result is exactly the discriminating experiment the previous session could not run on itself.
**Saves:** the whole six-attempt budget that the previous session burned to 0/6. Any synthetic tool
added to `vice-proxy.mjs` **mid-session is unreachable for the remainder of that session** and
becomes reachable in the next one — no restart, redeploy, or broker bounce shortens that. The
generalisation is worth more than the two tool names: after adding a proxy-local synthetic tool,
plan on finishing the session; do not design the rest of the session's work around calling it.
**Costs / hazard retained:** the three blocking anti-patterns in `01.3/.continue-here.md` remain
correct and are *not* superseded by this confirmation. A healthy `vice_ping` still proves nothing
about tool reachability (they are independent facts); `tools_list`/`tools_call` still bypass
`handleToolsCall()`'s synthetic dispatch and still cannot reach a synthetic tool; a broker restart
still does not refresh a client's tool surface. The correct pre-flight remains a by-name schema load,
which is what produced this entry.

### 2026-08-02 — four `vice-proxy.mjs` child processes observed running concurrently, with start times spanning 2h21m across the SAME container, directly corroborating the session-snapshot mechanism

**Type:** confirmation (corroborates, with a new independent data point, the "CONFIRMED LIVE" entry
immediately above this one — the per-session MCP tool-schema snapshot mechanism)
**Evidence:** live, this container, during 01.4 research: `ps -eo pid,lstart,cmd | grep vice-proxy.mjs`
found **four** simultaneously-running `node .claude/mcp/vice/vice-proxy.mjs` processes, started
15:22:26, 17:12:39, 17:35:10 and 17:43:55 (all 2026-08-02) — one per concurrently-open session, none
sharing a process, none restarted since its own session began. `git log` on `.claude/mcp/vice/vice-proxy.mjs`
shows six commits landing between 14:58:13 and 16:58:38 that same day (the 01.3-01..04 synthetic-tool
and hazard-table work). The 15:22:26 process therefore predates three of those six commits and is
still running the code as it stood at 15:22 — a live, currently-observable instance of exactly the
"whichever session's snapshot was taken before a later commit lands, it does not see that commit's
tools for the rest of its life" mechanism the entry above establishes. `/proc/<pid>/cwd` for all four
resolves to `/workspaces/bruce_lee` (the main workspace, not a worktree) — confirming the earlier
"ruled out stale-file/stale-process" check's own method (cwd comparison) is insufficient on its own:
cwd correctness says nothing about which commit's code a long-running process loaded at spawn time.
**Confidence:** HIGH (direct `ps`/`git log` cross-reference, reproducible by anyone with container
shell access, no emulator contact).
**Saves:** a cheap, non-destructive, container-side diagnostic for "is THIS session's proxy possibly
serving a stale snapshot": `ps -eo pid,lstart,cmd | grep vice-proxy.mjs` cross-referenced against
`git log -1 --format=%cI -- .claude/mcp/vice/vice-proxy.mjs` — if any commit post-dates a live
process's start time, every session bound to that process has been snapshotted from before that
commit and will not see whatever it added, however long that session continues to run.

## Manual and printed-documentation findings

A new heading rather than a continuation of "Corrections to earlier entries" above: none of the
following are corrections. All eight entries below are dated 2026-08-03 and were extracted from
`docs/Bruce_Lee_1984_manual_AppleII_Project64_etext.txt` (archived and greppable — see
`docs/SOURCES.md`) during archival of the four *Bruce Lee* source documents. Every claim here is
design intent from one manual, one edition; none of it is HIGH confidence about the C64 release
until live execution against the disassembly confirms it, per this file's own confidence scale.

### 2026-08-03 — the Lemon64 `/doc/` page is a full plain-text transcription of the manual, not a scan

**Type:** shortcut
**Evidence:** live — fetched and archived this session as
`docs/Bruce_Lee_1984_manual_AppleII_Project64_etext_lemon64.html`, with a plain-text extraction at
`docs/Bruce_Lee_1984_manual_AppleII_Project64_etext.txt`. The page states its own provenance chain
in its footer, preserved verbatim in the `.txt` file: Project 64
(`https://project64.c64.org/Games/BRUCEL10.TXT`), converted to HTML by Lemon64, itself converted to
etext by an anonymous transcriber from the Asimov Apple ][ site's `BRUCEL10.TXT` (April 1997,
etext #200).
**Confidence:** HIGH (the file is archived and greppable; the provenance chain is stated by the
source itself, not inferred).
**Saves / costs:** the manual's contents, today, without OCR and without installing
`poppler-utils` — the two scanned PDFs (`docs/Bruce_Lee_1984_Mastertronic_budget.pdf`,
`docs/Bruce_Lee_1984_manual_c64online_edition-unknown.pdf`) remain unread image scans, but this
transcription already supplies the same class of content for one edition.

### 2026-08-03 — the Lemon64/Project 64 transcription is the APPLE II manual, not the C64 one

**Type:** hazard
**Evidence:** live — `docs/Bruce_Lee_1984_manual_AppleII_Project64_etext.txt`'s own REQUIREMENTS
section names an "Apple II(R) series computer" and an "Apple compatible disk drive" outright, and
its GETTING STARTED section instructs the reader to "Insert the BRUCE LEE(TM) diskette"; the C64
is never named anywhere in the document body.
**Confidence:** HIGH for the identification itself (stated outright by the source, not inferred).
**Saves / costs:** the cost this entry exists to prevent — citing this manual's platform specifics
(loading procedure, controls hardware, memory) as C64 fact. Its game-design content (scoring,
damage, hazards, moves) is shared across ports and usable at MEDIUM; its platform specifics are
not transferable at any confidence.

### 2026-08-03 — the Apple II manual's scoring table, all eight values

**Type:** confirmation
**Evidence:** manual scan (Apple II edition) — `docs/Bruce_Lee_1984_manual_AppleII_Project64_etext.txt`,
§ POINTS: Lantern 125, Chopping ninja or Yamo 100, Kicking ninja or Yamo 75, Entering new room
2000, Knocking out ninja 200, Knocking out Yamo 450, Destroying wizard 3000, Landing on ninja or
Yamo 50.
**Confidence:** MEDIUM — design intent from one edition's manual, directly checkable against the
disassembly's own scoring routine later. That checkability is the point of logging it now.
**Saves / costs:** a scoring table to check the disassembly against, rather than reverse-deriving
point values from scratch by observing the HUD across many play sessions.

### 2026-08-03 — damage thresholds and life count, from the Apple II manual

**Type:** confirmation
**Evidence:** manual scan (Apple II edition) — `docs/Bruce_Lee_1984_manual_AppleII_Project64_etext.txt`,
verbatim: "the Yamo can survive only three blows and the ninja can survive only two." Also, in a
one-player game: "You can take five falls before the game is over."
**Confidence:** MEDIUM, same reasoning as the scoring table above.
**Saves / costs:** a concrete numeric target (3 hits / 2 hits / 5 falls) for whatever counter
variables the disassembly turns out to use for opponent health and player lives.

### 2026-08-03 — named in-fiction hazards/objects, doubling as a string-sweep target list

**Type:** shortcut
**Evidence:** manual scan (Apple II edition) — `docs/Bruce_Lee_1984_manual_AppleII_Project64_etext.txt`:
electrical charges in the gaps between ledges; "PAN lights streaming across the floor"; exploding
"T'SUNG-LIN (bushes)"; the ninja's weapon is a "BOKKEN" stick; the wizard streams fire balls from
his eyes and is destroyed by a button press.
**Confidence:** MEDIUM for the names as design vocabulary (one edition's manual).
**Saves / costs:** these names (BOKKEN, T'SUNG-LIN, PAN, YAMO) are a ready-made string-sweep target
list for a captured 64K image — the sweep itself, not this entry, is what would promote any single
name to HIGH by confirming it appears in the game's own data.

### 2026-08-03 — dead end / negative result: this edition's manual gives the ninja no proper name (edition-scoped)

**Type:** dead end
**Evidence:** manual scan (Apple II edition) — `docs/Bruce_Lee_1984_manual_AppleII_Project64_etext.txt`
says "the ninja" throughout, lowercase and frequently plural ("the ninja brandishing their BOKKEN
sticks"), against "the Yamo" with a definite article and a capitalised proper name. No other name
for the ninja appears anywhere in the document.
**Confidence:** HIGH that this specific edition (Apple II, Project 64 etext) contains no proper
name for the ninja. LOW as evidence about the Commodore 64 printings — the Mastertronic budget
scan (`docs/Bruce_Lee_1984_Mastertronic_budget.pdf`) and the c64online PDF
(`docs/Bruce_Lee_1984_manual_c64online_edition-unknown.pdf`) are both still unread image scans, and
either could name him differently.
**Saves / costs:** this is the negative result
`.planning/todos/pending/2026-08-03-pin-canonical-character-names-bruce-lee-yamo-and-the-ninja.md`'s
Solution step 1 asks for, but it is scoped to one edition — the item is narrowed, not closed. A
future session should not re-run this exact check against this exact file; it should read the two
unread C64 scans (once OCR is available) or sweep a live 64K capture for a proper name instead.

### 2026-08-03 — open question, not a conclusion: the Apple II manual's two-player mode is turn-taking, disagreeing with `FEATURES.md:202`'s Yamo-controlling claim

**Type:** dead end (an open question, not a conclusion)
**Evidence:** manual scan (Apple II edition) — `docs/Bruce_Lee_1984_manual_AppleII_Project64_etext.txt`,
verbatim: "In a TWO-PLAYER GAME, you and another person take turns being Bruce, competing against
the Yamo and ninja. As soon as you (Bruce) take a fall, the other player takes a turn as Bruce."
Compare `.planning/research/FEATURES.md:202` (unchanged by this task), which describes a C64
two-player mode where player 2 drives Yamo against player 1's Bruce Lee.
**Confidence:** LOW for either description being the definitive Commodore 64 truth — this manual
is the Apple II edition and may simply describe a different port's mode set; the C64 release is
widely described elsewhere as having a Yamo-controlling mode, but that claim is itself unconfirmed
against this project's own disassembly.
**Saves / costs:** both sources may be correct about their respective ports. Recorded here as an
open question naming both sources, per this task's explicit instruction not to overwrite
`FEATURES.md:202` — settling which mode(s) the C64 release actually implements is a live-execution
question, not a re-reading-the-manual question.

### 2026-08-03 — credits attribution nuance: this manual credits Mirsky (programming) and Fortier (concept) — for the Apple II edition

**Type:** confirmation
**Evidence:** manual scan (Apple II edition) — `docs/Bruce_Lee_1984_manual_AppleII_Project64_etext.txt`,
§ CREDITS, verbatim: "Programming by Richard Mirsky / Concept by Ron J. Fortier and Kelly Day /
Computer graphics by Kelly Day / Documentation by Ingrid Holcomb." (C) 1984 Datasoft Inc.,
licensed by Ziv International.
**Confidence:** MEDIUM — one edition's manual; Fortier is conventionally credited elsewhere as the
Atari/C64 programmer, which this document does not confirm or deny for that platform.
**Saves / costs:** `.claude/CLAUDE.md` frames this project as "Datasoft / Ron J. Fortier" and is
**not** to be edited on the strength of this Apple II manual alone — noted here so the nuance is on
record without triggering an unwarranted edit to the project's own framing document.

### 2026-08-03 — hazard: this container's `python3` is `python3-minimal` — the stdlib is partial, and `python3 --version` does not reveal it

**Type:** hazard
**Evidence:** live, in-container, this session. `python3 -c "import html"` fails with
`ModuleNotFoundError` — first hit while extracting text from an archived HTML page during quick
task `260803-9hi`, and initially misread as a cwd/shadowing problem, which it is not. A sweep over
26 common stdlib modules returns **12 missing**: `html`, `shutil`, `tempfile`, `ctypes`, `venv`,
`ensurepip`, `sqlite3`, `http`, `xml`, `unittest`, `lzma`, `bz2`. `ls /usr/lib/python3.13/` shows
only 95 entries. `dpkg -l` confirms the cause: `python3-minimal`, `python3.13-minimal` and
`libpython3.13-minimal` are installed, while `python3` and `libpython3.13-stdlib` are **not**
(`apt-cache policy` → both `Installed: (none)`, candidate `3.13.5-2+deb13u4`).
**Confidence:** HIGH — verified directly by import probe, filesystem listing, and package state.
**Saves / costs:** this **contradicts `.planning/research/STACK.md` / `.claude/CLAUDE.md`**, which
record "Python 3.13.5 — **Verified present** (`python3 --version`) … Confidence: HIGH". The binary
is present; the language's standard library largely is not, and `--version` cannot tell the two
apart. That matters because Python is the designated host for `.d64` packaging, Pillow-based
graphics extraction, and the `pytest` verification harness — and `venv` + `ensurepip` being absent
means the documented `pip install d64` / `pip install Pillow` route does not work as written.
Fix before relying on any of it: `apt-get install -y python3 libpython3.13-stdlib` (plus
`python3-pip` / `python3-venv` as STACK.md already notes). Cheap check that would have caught it
earlier, and is worth preferring to `--version` for any interpreter in any container:
`python3 -c "import shutil, tempfile, ctypes"`.

### 2026-08-03 — RESOLVED: the two-player disagreement was never a contradiction — the C64 has three game modes

**Type:** confirmation
**Evidence:** C64-Wiki, archived as `docs/Bruce_Lee_C64wiki_2026-08-03.txt`, § Hints → Game modes,
verbatim: "1 player: You are Bruce and you fight against Yamo and the Ninja." / "2 players against
computer: You are Bruce and you fight against Yamo and the Ninja. If you lose a life, player two is
next." / "2 players against each other: one player is Bruce and the other is Yamo. If Bruce loses a
life the roles are swapped."
**Confidence:** MEDIUM — a community wiki, unsourced, not the disassembly.
**Saves / costs:** this closes the open question logged earlier today. The Apple II manual's
turn-taking description and `.planning/research/FEATURES.md:202`'s Yamo-controlling claim are
**both correct, about different modes** — the Apple II manual documented 2P-versus-computer and
simply did not describe the versus mode. `FEATURES.md:202` is vindicated and was right to be left
standing. New detail neither prior source had: in versus mode **the roles swap when Bruce loses a
life**, so the Bruce/Yamo assignment is state, not a fixed per-player binding — a mode-select and
role-swap path the state machine must implement. Also relevant to
`pin-canonical-character-names`: the Ninja is never player-controllable in any of the three modes,
so "AI opponent" is unconditional for him and mode-dependent for Yamo, exactly as that todo
hypothesised.

### 2026-08-03 — `POKE 5472,99` for unlimited lives: a community cheat that hands over the lives-counter address

**Type:** shortcut
**Evidence:** C64-Wiki, archived as `docs/Bruce_Lee_C64wiki_2026-08-03.txt`, § Cheats, verbatim:
"Load the original program and type POKE 5472,99. Then start with RUN and you have unlimited
lives."
**Confidence:** MEDIUM — community-published, not yet executed or confirmed against a live capture
by this project.
**Saves / costs:** 5472 decimal = **`$1560`**. A cheat that *writes a count* (99) rather than
NOPing a decrement is almost certainly writing the lives-counter variable itself, which makes
`$1560` a free, checkable hypothesis for the lives counter — and a lives counter is one of the
highest-value anchors in a fresh disassembly, because everything that can kill the player writes
to it. Cheapest confirmation: set a watch on `$1560` in a live run and take a hit. Note the cheat
is specified against "the original program", so the address is only valid for a build with the
original's memory layout — on a cracked release with a relocating loader it may not hold, which is
itself worth knowing. Promote to HIGH only by re-logging with live evidence.

### 2026-08-03 — the scoring table is cross-confirmed by two independent sources, all eight values

**Type:** confirmation
**Evidence:** two sources agreeing to the point, neither derived from the other — the Apple II
Project 64 etext (`docs/Bruce_Lee_1984_manual_AppleII_Project64_etext.txt`) and the C64-Wiki
article (`docs/Bruce_Lee_C64wiki_2026-08-03.txt`, § Table of points): landing on an opponent 50 ·
kick 75 · chop/punch 100 · lantern 125 · KO ninja 200 · KO Yamo 450 · new room 2000 · wizard 3000.
Wording differs ("Chopping"/"Punch on", "Knocking out"/"Victory over"); every value is identical.
**Confidence:** MEDIUM, but a *stronger* MEDIUM than either source alone — a 1984 Apple II manual
and a modern C64 community wiki agreeing on eight arbitrary integers is hard to explain by
coincidence or by copying, and it means the scoring table did not change between those two ports.
Still not HIGH: neither source is the code.
**Saves / costs:** eight exact integers to grep a captured 64K image for. 2000 (`$07D0`) and 3000
(`$0BB8`) are the distinctive ones; 50/75/100/125 are too common to search on alone. Finding them
adjacent in memory locates the score table, and the score table is a short hop from the scoring
routine.

### 2026-08-03 — second-loop difficulty escalation: instant respawn plus one room losing its safe spots

**Type:** confirmation
**Evidence:** C64-Wiki, archived as `docs/Bruce_Lee_C64wiki_2026-08-03.txt`, § Description,
verbatim: "After passing through the game once, the difficulty increases. Yamo and the Ninja will
respawn instantly when killed. Additionally, one of the rooms that does not have enemies becomes
far more dangerous, with an elimination of 'safe spots.'"
**Confidence:** MEDIUM — community-authored; the specific room is not named.
**Saves / costs:** flags a **loop counter** as a real piece of game state and a documentation
subsystem in its own right — there is at least one difficulty variable that is read by the
opponent-respawn logic *and* by per-room hazard setup, meaning the second loop is not simply the
first replayed. Worth knowing before the AI and room-hazard systems are documented as if they were
loop-invariant, and worth a checkpoint: any behavioural-equivalence replay that never completes a
full loop will never exercise this path at all.

### 2026-08-03 — C64-specific metadata: SID attribution, HVSC path, and the alternate title "Banzai"

**Type:** shortcut
**Evidence:** C64-Wiki infobox, archived as `docs/Bruce_Lee_C64wiki_2026-08-03.txt`: Musician
**John A. Fitzpatrick**; HVSC file `MUSICIANS/F/Fitzpatrick_John/Bruce_Lee.sid`; developers Ron J.
Fortier, Richard Mirsky, Kelly Day; company Datasoft; released 1984 across Amstrad CPC, Apple II,
Atari, C64 and ZX Spectrum; **aka "Banzai"**.
**Confidence:** MEDIUM — community-authored infobox.
**Saves / costs:** the HVSC path is the useful part: a ripped, independently-preserved `.sid` of
this game's music is a **reference artifact to diff the reconstructed music engine against**, which
is otherwise an awkward thing to verify behaviourally. "Banzai" is a search term that will surface
material the string "Bruce Lee" does not. The credit list also names all three of Fortier, Mirsky
and Day against the C64 entry without splitting roles by platform, which neither confirms nor
refutes the Apple II manual's Mirsky-programmed/Fortier-concept split logged earlier today.

### 2026-08-03 — hazard: a naive HTML-to-text extraction silently corrupted a value/label table

**Type:** hazard
**Evidence:** live, this session. Flattening the C64-Wiki page with a regex tag-strip plus a
`len(line) > 2` noise filter dropped the two-digit cells `50` and `75` from a value-first points
table, leaving every remaining label paired with the *next* value — a plausible, complete-looking,
entirely wrong scoring table (lantern 200, wizard-less, kick 100). It was caught only because the
result was cross-checked against the Apple II manual's table, which disagreed.
**Confidence:** HIGH — reproduced and then fixed by re-extracting with the cell structure intact.
**Saves / costs:** the failure mode is the dangerous kind — no error, no gap, just shifted data
that reads as authoritative. Two rules follow. **Never apply a minimum-length filter when the
payload is numeric**: short lines are exactly the values. **Never read a table out of a flattened
page**; extract cell-wise, or read it out of the archived file where the structure survives — this
is why `docs/Bruce_Lee_C64wiki_2026-08-03.txt` carries a note that its table is value-first. The
general lesson for this project: any table lifted from a web source should be cross-checked against
a second source before it is written down, because a single-source table has no way to announce
that it has been mangled.

### 2026-08-03 — a fourth extension-hardcoded static check existed that RESEARCH §2 and PATTERNS.md did not name, and it failed loudly rather than silently

**Type:** hazard (a gap in the phase's own pre-execution inventory), plus a confirmation that
the loud-failure mode this project prefers actually held
**Evidence:** live, during Phase 01.6.1 Plan 01 Task 1 (the tracer). `01.6.1-RESEARCH.md` §2 and
`01.6.1-PATTERNS.md` named exactly three extension-hardcoded static checks needing widening in
the same commit as any rename: `skill-docs.test.mjs`'s `scriptModules()`, and
`vice-mcp-selector-docs.test.mjs`'s `enumerateModules()`/`importsHostpath()`. Renaming
`vice-probe.mjs` -> `vice-probe.ts` (the tracer's own conversion target) dropped the full suite
from 247/247 to 246/247. The failure was `vice-proxy.test.mjs:3435`'s
`"structural: the set of .mjs files under .claude/mcp/vice/ containing a network-call
construct is exactly vice.mjs and vice-probe.mjs"` -- a fourth enumerator, inside a file that is
itself explicitly out of this phase's scope (`vice-proxy.mjs`/`vice-proxy.test.mjs` are deferred
to their own later plan, RESEARCH §2 Slice 9), hardcoded to `.endsWith(".mjs")` and to the literal
name `vice-probe.mjs` in its expected-offenders array.
**Confidence:** HIGH -- directly reproduced (the rename dropped the live suite from 247/247 to
246/247, naming the exact failing assertion in its own error text) and then fixed (widening the
one check's file-enumeration predicate to the same `[cm]?[jt]s` class used elsewhere, and updating
its expected array to `["vice-probe.ts", "vice.mjs"]`, restored 247/247), all inside this same
task.
**Saves / costs:** costs nothing this time -- the check is a `deepEqual` assertion against an
explicit array, not a `.length > 0` sanity check, so a shrinking module set failed LOUDLY rather
than silently passing vacuously. Had it been written the way `importsHostpath()`'s pre-widening
form was (a closure check that would report "zero consumers" and pass), this would have been the
exact silent-failure class RESEARCH's Pitfall section already warns about, just in a fourth
location nobody had inventoried. The general lesson: an inventory of extension-hardcoded static
checks built by *reading* the source (as RESEARCH and PATTERNS both did, carefully) can still be
one short of the inventory built by *actually performing a rename* and watching what breaks --
grep for a known pattern shape finds instances of that shape, not instances of a check's
*consequence*. Later plans in this phase (03, 05, 07, 08) rename files this same check enumerates
(`vice.mjs`, when Slice 6 converts it) -- the check is now widened and this should not recur, but
a future phase performing a similar mechanical rename across a test suite should budget for "run
the rename and watch the full suite" as a real discovery step, not only "grep for `.mjs` literals
first."

### 2026-08-03 — a static guard proven to discriminate: both `load-order.test.mjs` halves observed FAILING against a live-injected regression, and the underlying TDZ crash reproduced a second time against the landed fix

**Type:** confirmation (a static check's discriminating power, not just its existence, verified live)
**Evidence:** live, during Phase 01.6.1 Plan 02 Task 3, against a scratch copy of the flat module
tree (never the tracked tree -- `git status --porcelain` confirmed clean before, during and after).
Three regressions, each independently applied and restored:
1. **Graph half.** Scratch `hostpath.mjs` had `import { repoRoot } from "./repo-root.mjs"` and
   `const REGRESSION_WORKSPACE_ROOT = repoRoot({ from: HERE })` restored (the exact shape Plan 02
   Task 1 removed). Running `load-order.test.mjs` against the scratch tree failed the cycle
   assertion exactly as expected: `AssertionError [ERR_ASSERTION]: the set of cycles through
   repo-root.mjs changed -- expected exactly [], got
   [["hostpath.mjs","install-resources.mjs","repo-root.mjs"]]`.
2. **Call-site half.** Scratch `hostpath.mjs` restored to healthy; scratch `containerpath.mjs`'s
   own module-scope call had its `from:` override dropped (`repoRoot({ from: HERE })` ->
   `repoRoot()`). Running the guard failed the call-site assertion, naming the file:
   `AssertionError [ERR_ASSERTION]: containerpath.mjs: module-scope call \`const WORKSPACE_ROOT =
   repoRoot();\` does not pass an explicit \`from:\` override.`
3. **The crash itself.** Scratch `containerpath.mjs` restored to healthy; scratch `hostpath.mjs`
   regressed a second time, this time with the call UNGUARDED (`const
   REGRESSION_WORKSPACE_ROOT = repoRoot();`, no `from:`) -- reproducing both the cycle and the
   unguarded call-site simultaneously. Dynamically importing the scratch `repo-root.mjs` in a
   fresh Node process crashed with exactly `ReferenceError: Cannot access 'HERE' before
   initialization` -- the same text 01.6-RESEARCH.md §E and 01.6.1-RESEARCH.md §3.2 both
   reproduced against the pre-Plan-02 tree, confirming the guards defend against a real crash
   and not a stylistic preference.
After all three, the real (tracked) `load-order.test.mjs` still reported 6/6 against the real
tree, and the scratch directory was deleted.
**Confidence:** HIGH -- both assertion failures and the crash text are engine/assertion-emitted
strings captured verbatim from a live run, not paraphrased, and the tracked tree's own clean
`git status --porcelain` before/after brackets the whole experiment.
**Saves / costs:** this is the general lesson RESEARCH's own Manual-Only Verifications table
already named: a check that has only ever been observed passing is not evidence a check
*discriminates* at all -- the real `load-order.test.mjs` was 4/4 green against the genuinely
broken pre-Plan-02 tree, which is why "the test passes" was never sufficient proof on its own.
The saved cost for a future maintainer: this entry is the concrete recipe (copy the flat tree to
a scratch dir outside the repo, apply one regression at a time, restore between each, delete the
scratch dir after) for re-proving any future static guard in this tree actually fires, rather than
re-deriving the scratch-copy methodology from scratch each time.

### 2026-08-03 — incident-record.mjs's atomic write never actually restricted the record's file mode, despite the plan text and PATTERNS.md's own framing assuming it already did

**Type:** hazard (a plan/reality mismatch caught before it silently ported forward) plus a
Rule 2 fix (missing critical functionality per this plan's own threat register)
**Evidence:** live, during Phase 01.6.1 Plan 04 Task 2. `01.6.1-04-PLAN.md`'s task text says the
atomic-write discipline ("create an empty tmp sibling, restrict its mode before any content
lands, write the content, then rename") "must come through unchanged," and
`01.6.1-PATTERNS.md`'s "Atomic write (tmp -> chmod 600 -> content -> rename)" section lists
`incident-record.ts`'s `writeIncidentRecord` under "Apply to," alongside
`install-resources.ts`'s manifest writer. Reading the actual pre-conversion
`incident-record.mjs`'s `writeAtomic()` showed only `writeFileSync(tmp, content)` then
`renameSync(tmp, path)` -- no `chmodSync` step at all, and no empty-write-first step either.
Checked whether this pattern existed at least somewhere else in the tree that this file was
supposed to already match: `vice-broker-client.mjs`'s `writeJsonAtomic()` and
`resources/vice-broker.sh`'s `write_json_atomic()` (the two siblings `incident-record.mjs`'s own
header comment claims parity with) were read directly and ALSO lack the chmod step -- only the
newer `vice-broker.mts` (Phase 01.6's TS tracer) and `install-resources.ts` (Plan 03) actually do
`writeFileSync(tmp, "")` -> `chmodSync(tmp, 0o600)` -> `writeFileSync(tmp, content)` ->
`renameSync`. So the "already has this" framing in both PLAN.md and PATTERNS.md was simply wrong
about this one file's actual pre-conversion state; the described discipline is a newer, tighter
pattern than the codebase's own older writers use, not a status quo being preserved.
**Confidence:** HIGH -- read directly, both the file being converted and both siblings it claims
parity with, before writing a single line of the port.
**Saves / costs:** costs nothing to catch early (a `grep -n chmodSync` across the three named
"parity" files before starting the port would have surfaced this in seconds); costs real
correctness if missed, since this plan's own threat register (T-01.6.1-08, Information
Disclosure, medium severity, disposition "mitigate") explicitly requires the produced record's
mode to be checked as an acceptance criterion -- a silent verbatim port would have left an
untested claim in the SUMMARY ("the discipline survived unchanged") that was never true to begin
with. Fixed by adding the `chmodSync(tmp, 0o600)` step (matching `vice-broker.mts`/
`install-resources.ts`'s idiom exactly) and a direct test asserting the written file's mode has
no group/world bits set, both before and after `finaliseIncidentRecord()`'s re-render. The general
lesson: when a plan or pattern doc says a discipline "already exists" in a specific file, read
that file's actual current bytes before trusting the claim -- a plan authored from a broader
pattern survey can generalize a NEIGHBORING file's property onto the one actually being converted.

### 2026-08-03 — a fresh worktree has no node_modules; `npm ci` against the already-committed package-lock.json is the fix, not a new install decision

**Type:** hazard (toolchain), caught before it produced a false "the suite is red" reading
**Evidence:** live, during Phase 01.6.1 Plan 05 execution, in a parallel-executor git worktree
(`/workspaces/bruce_lee/.claude/worktrees/agent-a08c1590af9f9a608`). The baseline
`node --test '.claude/mcp/vice/'*.test.*` run reported `253 pass, 1 fail`, with the one failure
being `resources-sync.test.ts`'s own "resources/ is byte-identical to a fresh build" test throwing
`spawnSync .../node_modules/.bin/tsc ENOENT`. `ls node_modules` in the worktree came back empty
entirely (`ls: cannot access 'node_modules'`), while the main checkout at
`/workspaces/bruce_lee/.claude/mcp/vice/node_modules` had it populated -- confirming the gap is a
per-worktree artifact, not a real regression in the converted source. `.claude/mcp/vice/package.json`
declares only `typescript@7.0.2` and `@types/node@24.13.3` as devDependencies (both already
human-approved in Phase 01.6's own Package Legitimacy Audit), and a `package-lock.json` for
exactly those versions is already committed and tracked -- so `npm ci` there materializes the
already-locked, already-approved tree rather than making any new package-manager decision. Running
it (`cd .claude/mcp/vice && npm ci`) immediately fixed both the typecheck (`npx tsc --version` had
been silently falling through to `npx`'s own auto-install of an unrelated, deprecated `tsc@2.0.4`
package from the registry -- a near-miss slopsquat-adjacent surprise in its own right, printing
"This is not the tsc command you are looking for") and the one failing test; the full suite
returned to 254/254 immediately after.
**Confidence:** HIGH -- reproduced live, `ls`/`which` checked directly in both the worktree and the
main checkout, and the before/after suite counts (253/254 -> 254/254) are direct command output.
**Saves / costs:** costs nothing to check (`ls node_modules/.bin/tsc` before trusting a worktree's
baseline suite run); costs a wrongly-attributed "pre-existing failure, not my problem" writeup, or
worse, a genuine new-package install decision reached for out of confusion, if missed. The general
lesson for any future parallel-worktree executor in this repo: a worktree does NOT inherit the main
checkout's `node_modules` (git worktrees never share untracked directories), so the FIRST thing to
check when a fresh worktree's baseline suite run shows an unexpected failure is whether
`node_modules/.bin/<tool>` exists at all -- and if a `package-lock.json` is already committed,
`npm ci` there is a mechanical materialization step, not a new dependency decision requiring a
package-legitimacy checkpoint.

### 2026-08-03 — a synchronous wrapper `return`ing an unawaited async callback's Promise runs its own `finally` before the callback's real work finishes

**Type:** hazard, caught live while writing `refresh-manifest.test.ts` (Phase 01.6.1 Plan 06,
Task 1) -- it briefly clobbered the real, tracked `tools-manifest.json`
**Evidence:** live, in this worktree. The first version of the test file's
`withTempManifestPath()` helper was written as a plain (non-`async`) function:
`function withTempManifestPath(fn) { ...; try { return fn(path); } finally { restore env var } }`,
called as `await withTempManifestPath(async (path) => { ...; await main(); ... })`. Every
write-triggering test failed with `ENOENT` reading the tmpdir path, and the console showed
`main()` writing to the REAL `tools-manifest.json` (the default, non-redirected path) instead --
confirmed by `git diff` afterward showing the tracked file's content replaced with test fixture
data. Root cause: `fn(path)` returns a Promise immediately (it is an async arrow function), and a
**non-async** outer function's `try { return fn(path); } finally { ...restore... }` runs the
`finally` block the instant `fn(path)` returns *the Promise object*, not once that promise
settles -- so `VICE_TOOLS_MANIFEST` was already deleted/restored before `main()`'s `await
serverInfo()` had even resolved, and `main()`'s own `manifestPath()` read the env var late and
found it already gone, falling through to the real default path. Fixed by making the outer helper
`async` and writing `try { return await fn(path); } finally { ... }` -- the `await` is what makes
the `finally` wait for the real work. The real manifest was restored via `git checkout --
.claude/mcp/vice/tools-manifest.json` before any commit.
**Confidence:** HIGH -- reproduced live (six tests failed with a consistent, explained ENOENT/
wrong-path signature before the fix, zero failures after), and the real file's clobbering and
restoration were both directly observed via `git diff`/`git checkout --`.
**Saves / costs:** this is a general JavaScript hazard, not specific to this project, but it is
sharp-edged here because the corrupted target was a *tracked, committed* file rather than a
throwaway fixture -- a test helper that redirects a real module's env-var-driven output path MUST
either be declared `async` with an `await` on the inner call, or take an explicit callback-style
`done()` signal, never a bare `return fn(...)` when `fn` is (or might be) async. The general
tell: if a "cleanup" `finally` block ever runs suspiciously fast relative to the async work it is
supposed to bracket, suspect an unawaited promise escaping the `try`, not a race in the code under
test. Worth checking on any future test helper in this codebase that wraps an async callback in a
try/finally for env-var or global-state save/restore.

### 2026-08-03 — verifying a rewired `.mcp.json` entry point requires driving a REAL stdio MCP handshake against it; the executor's own session cannot detect a broken rewire

**Type:** trick, plus the hazard it exists to catch
**Evidence:** live, this session (01.6.1-07). `.mcp.json`'s `args[0]` was repointed from
`vice-proxy.mjs` to `vice-proxy.ts` in the same commit as the file's rename. Piping
`{"jsonrpc":"2.0","id":1,"method":"initialize",...}` followed by a `tools/list` request into
`timeout 10 node .claude/mcp/vice/vice-proxy.ts` over stdin, and reading stdout, is what proved
the rewire actually works: exit 0, `protocolVersion: "2025-06-18"`, `serverInfo: {name:"vice",
version:"0.1.0"}`, 66 tools, `vice_disk_list` absent, and no network call attempted for either
request (confirmed via stderr, which carried only the two expected startup lines, nothing
naming a host connection attempt).
**Confidence:** HIGH -- measured directly, and reproduced identically against the same file
twice (once as Task 1's pre-rename baseline against `vice-proxy.mjs`, once as Task 3's
post-rename check against `vice-proxy.ts`).
**Saves/costs:** per this project's own per-session tool-schema snapshot mechanism (this file's
own earlier "CONFIRMED LIVE" entry, 2026-08-02), the client's callable-tool surface is captured
ONCE at MCP initialization, and Claude Code spawns the proxy once per session -- so a session
already running when `.mcp.json` is rewired keeps working, correctly or not, using its own
already-loaded snapshot. This means "it still works for me, in this same session" is worthless
evidence for a rewire's correctness; only a FRESH process start against the exact path the
config now names, verified by a real protocol exchange over stdio, tells you anything. Reusable
recipe for any future `.mcp.json`/entry-point rewire in this project: `printf` two
newline-delimited JSON-RPC lines (`initialize`, then `tools/list`) into `node <path>` under
`timeout`, capture stdout/stderr/exit-code separately, and diff the parsed result against a
captured pre-change baseline rather than trusting the process merely exited 0.

### 2026-08-03 — a function/const whose EXACT untyped declaration text is scanned by a structural test cannot be given an inline type annotation; contextual typing on a `const = function expr` (or a per-entry cast, for a const) types it without touching that text

**Type:** hazard, plus the tested fix
**Evidence:** live, this session (01.6.1-07), `.claude/mcp/vice/vice-proxy.test.mjs`.
Typing `handleRecycle`'s parameter (`async function handleRecycle(args: Record<string,
unknown>): Promise<ToolCallResult> {`) made `node --test vice-proxy.test.mjs` fail LOUDLY:
`src.indexOf("async function handleRecycle(args)")` returned -1, because that test's own
structural check greps the SOURCE FILE for that literal, untyped substring. The same class of
failure hit `runCycleBracket` (`^async function runCycleBracket\(\)\s*\{` requires no return
type between `()` and `{`), `DIAGNOSE_VERDICTS` and `CHECKPOINT_ARMING_TOOLS` (both scanned via
a regex requiring `const NAME = Object.freeze([...])` / `new Set([...])` with NO `: type`
between the name and `=`), and `SEAM_HAZARDS` (`indexOf("const SEAM_HAZARDS = [")`, plus a
second `indexOf("\n];", startIdx)` search for the array's own closing line -- confirmed by
direct experiment that appending ` as Type[]` to that closing line breaks the SECOND search too,
since the text after the array's own `]` is no longer bare `;`).
**What does NOT work (tested, rejected):** a function-declaration overload pair
(`async function f(args: T): R; async function f(args) {...}`) -- TypeScript's
`noImplicitAny` still fires on the untyped IMPLEMENTATION signature's bare parameter, even with
a fully-typed overload declared immediately above it (`error TS7006`, reproduced live in a
scratch file). A leading `/** @param {T} args */` JSDoc comment on a plain `.ts` file's
function declaration does NOT suppress `noImplicitAny` either (also reproduced live) --
JSDoc-driven parameter inference is a `checkJs`/`allowJs` behavior, not a general `.ts` one.
**What DOES work (tested, kept):** for a `function` whose param needs a real type,
convert the DECLARATION to a `const`-bound function EXPRESSION with an explicit function-type
annotation on the `const` itself: `const f: (args: T) => R = async function f(args) { ... }`
(no trailing semicolon after the closing brace, to preserve a `\n}\n` ending the oracle
also scans for). TypeScript's ordinary contextual typing for a function expression assigned to
a typed variable gives `args` a real, checked type with ZERO characters changed inside
`f(args)` itself -- verified live: `tsc --noEmit --strict` exits 0, and `node` runs the file
natively via strip-only mode. For a `const` whose VALUE (not a function parameter) needs typing
without touching its own declaration line, either drop the annotation entirely and let
inference from the initializer do the work (`DIAGNOSE_VERDICTS`, `CHECKPOINT_ARMING_TOOLS` --
`Object.freeze([...])`/`new Set([...])` already infer a concrete type), or cast the array's
individual ELEMENT (`{ ... } as SeamHazardEntry`), never the array/const declaration itself, so
the array's own element type is inferred as the target interface without changing the `const
NAME = [` prefix or the closing `];` suffix the oracle anchors to.
**Confidence:** HIGH -- every claim above (`TS7006` on the overload attempt, `TS7006` on the
JSDoc attempt, exit 0 on the `const = function expr` pattern, native `node` execution of the
same file) was reproduced live this session in throwaway scratch files, not reasoned about.
**Saves/costs:** this is the sixth instance this phase has caught of an
extension/format-hardcoded structural check reacting to a legitimate source change -- but the
FIRST one that fails LOUDLY (every prior instance in this phase went silently vacuous instead).
Recognise the symptom fast: a `node --test` run against an untouched oracle test file that
worked before a type-annotation-only source edit and now reports "X's own definition must be
found in the source" or "expected exactly one X() definition, found 0" -- the fix is almost
never to touch the test (often explicitly forbidden by the plan, as it was here); it is to find
a way to give the same value a real type without changing the exact substring the oracle scans
for, using one of the two patterns above.

### 2026-08-03 — `vice-broker.test.mjs`'s "warns on stderr naming Ctrl-C... --detach" test is flaky under full-suite load, unrelated to any source change

**Type:** dead end (ruled out as a regression) / hazard (a flaky assertion worth knowing about)
**Evidence:** live, this session. One full-suite run (`node --test '.claude/mcp/vice/'*.test.*`)
reported this single test failing with the captured stderr missing the `--detach` substring the
assertion expects, immediately after this plan's `vice-broker.test.mjs` one-line
`PROXY_PATH` fix (unrelated file, unrelated code path -- this test spawns the real bash
`resources/vice-broker.sh`, never touches `vice-proxy.ts`/`vice.ts`). Re-running the SAME test
in isolation (`node --test --test-name-pattern="warns on stderr naming Ctrl-C" vice-broker.test.mjs`)
passed in 46ms, and a subsequent full-suite re-run reproduced the clean 275/270/5/0 result with
no failures at all.
**Confidence:** HIGH for "not caused by this plan's changes" (isolated re-run + clean full-suite
re-run both confirm it); LOW for the actual root cause (never investigated further -- plausibly
a stderr-buffering/timing race when many other tests are spawning real subprocesses
concurrently ahead of it in the same suite run).
**Saves/costs:** a future session hitting a single, non-reproducing failure in this specific
test (or any other test that asserts on a real spawned bash process's stderr content within a
tight time window) should re-run it in isolation before treating it as a regression -- this
project's own full-suite run time (~45-50s) is long enough that resource contention across ~300
tests, several of which spawn real subprocesses, is a plausible source of one-off timing
flakes, distinct from the genuine, reproducible module-cycle/liveness hazards logged elsewhere
in this file.

### 2026-08-03 — the criterion-B cycle guard went VACUOUS after a rename it did not track, and stayed that way, undetected, for five plans -- promoting Plan 02's own "proven to discriminate" entry above with the live counter-evidence

**Type:** hazard (a static guard that silently stopped discriminating), confirmed and fixed live
**Evidence:** live, this session (01.6.1-08, Task 2's end-of-phase re-proof). `load-order.test.mjs`'s
Part 2 cycle test called `findCyclesThroughNode(graph, "repo-root.mjs")` -- a LITERAL string, not
resolved by stem the way Part 1's `resolveModuleByStem()` already does two tests earlier in the
SAME file. Plan 03 (01.6.1-03) renamed `repo-root.mjs` to `repo-root.ts` and repointed every
consumer, but this one hardcoded literal was never updated. From that commit onward,
`graph.get("repo-root.mjs")` returned `undefined` (the node simply does not exist under that key
any more), so `findCyclesThroughNode()` returned `[]` UNCONDITIONALLY regardless of whether any
real cycle existed through the real `repo-root.ts` node. The test still reported 7/7 green on
every subsequent plan (04 through 07) because `ALLOWED_CYCLES_THROUGH_REPO_ROOT` is also `[]` --
an empty-expected-vs-empty-actual match that looked identical to a genuinely enforced invariant.
Confirmed by injecting Plan 02's own Task 3 regression (reintroducing the cycle in a scratch copy
of `hostpath.ts`, WITH an explicit `from:` override) against the pre-fix test: it passed cleanly
(0 failures) when it should have failed. After changing the literal to
`resolveModuleByStem("repo-root")`, the identical injected regression correctly failed with
`the set of cycles through repo-root.mjs changed -- expected exactly [], got
[["hostpath.ts","install-resources.ts","repo-root.ts"]]`, and the combined-regression crash
(`Cannot access 'HERE' before initialization`) still reproduced byte-for-byte against the fixed
tree's real modules via a fresh dynamic `import()`.
**Confidence:** HIGH -- reproduced live, twice (failing before the fix, passing after), with the
exact failure text quoted and the crash re-triggered a third time independently.
**Saves/costs:** this is the seventh instance this phase has caught of the
extension/format-hardcoded-check hazard, and the FIRST one to survive completely silently across
five whole plans rather than failing loudly or being caught the same session it was introduced --
because an empty-vs-empty assertion match gives no signal that the check stopped running at all.
The lesson: a static analysis test that names a SPECIFIC file by its literal extension-qualified
name is a landmine the moment that file is a rename candidate in a phase that renames files for a
living; prefer stem-based resolution (already established in the SAME file, two tests earlier)
from the day the check is written, not just for the file the check's own module lives in but for
every file NAME it passes as a literal argument. A green re-run of an existing test proves
nothing about whether it is still testing the right subject -- only a live-injected regression,
repeated at the END of a conversion phase and not just when the guard was first written, catches
this class of drift. Directly vindicates T-01.6.1-04's own stated concern ("six plans of renames
after they were written") and is the reason Task 2 step B exists as a mandatory re-proof rather
than a citation of Plan 02's prior evidence.

### 2026-08-03 — TypeScript flags an implicit-any callback parameter on a `.map()`/`.filter()` call even when the array itself is typed `any`; it does NOT flag an implicit-any on a bare `for...of` over the same `any` value

**Type:** trick / non-obvious TypeScript rule, useful for any future test-file conversion in this repo
**Evidence:** live, this session (01.6.1-08), converting `vice-proxy.test.mjs`'s ~4,400 lines.
`const x: any = f(); x.tools.map((t) => t.name)` DOES report `TS7006: Parameter 't' implicitly
has an 'any' type` under `strict`, confirmed by a minimal throwaway `.ts` file compiled with
`tsc --noEmit --strict` -- calling a method on an `any`-typed receiver still requires the
CALLBACK's own parameter to be explicitly annotated, because when the callee resolves to `any`
there is no signature left to contextually type the argument from. By contrast
`for (const t of x.tools) { ... }` (`x.tools` also `any`) draws no such error -- `for...of`
iteration over `any` does not go through a call-signature contextual-typing step at all, so `t`
is silently `any` with no diagnostic. Also confirmed: passing a 1-required-parameter callback
(e.g. a `Promise` executor's own `resolve`, inferred as `(value: unknown) => void` when the
executor never calls `resolve` with a value) into a 0-parameter callback SLOT (`server.listen(port,
host, resolve)`, whose Node type is `() => void`) is a real `TS2345` error ("Target signature
provides too few arguments. Expected 1 or more, but got 0") -- fixed by wrapping,
`() => resolve()`, not by typing `resolve` differently.
**Confidence:** HIGH -- both claims reproduced live in isolated scratch `.ts` files against this
project's own `tsconfig.json` (`strict: true`, `erasableSyntaxOnly: true`), not reasoned about.
**Saves/costs:** when converting a large, dynamically-shaped JSON-RPC test harness (MCP responses
whose payload legitimately differs per method) to TypeScript, the pragmatic and idiom-consistent
fix for the resulting wave of `.map((t) => t.name)`-shaped errors is a targeted `(t: any) =>`
annotation at each call site -- not a parallel set of hand-declared response-shape interfaces
that would drift from the untyped reality being tested, and not a blanket suppression. Declare a
small number of shared ENVELOPE types (method/id/params/result, with the volatile payload fields
left `any`) once near the top of the file, then annotate individual callback parameters as `tsc`
finds them; do not expect the envelope's own looseness to propagate through `.map`/`.filter`
callbacks automatically.

### 2026-08-03 — TypeScript narrowing (`if (x) ...`) does NOT survive into a closure that captures a mutable outer `let`, even when the closure is created and invoked synchronously in the same statement as the check

**Type:** hazard (a subtle strict-mode gotcha), tested and worked around
**Evidence:** live, this session (01.6.1-08). `let server: Server | undefined; ... if (server)
await new Promise((resolve) => server.close(resolve));` reports `TS18048: 'server' is possibly
'undefined'` INSIDE the arrow closure, despite the `if (server)` check on the same line --
reproduced live in an isolated scratch `.ts` file compiled against this project's own
`tsconfig.json`. A simpler variant with NO closure (`if (server) server.close();`) does NOT
error -- confirmed by removing the closure and re-running the same file -- isolating the cause to
closure capture specifically, not to the try/finally structure the real code also had (also
tested in isolation and ruled out separately). The fix is to bind the narrowed value to a new
`const` immediately before constructing the closure (`const finalServer = server; if
(finalServer) await new Promise((resolve) => finalServer.close(resolve));`) -- a `const` is never
reassignable, so TypeScript's narrowing survives the closure boundary for it even though it does
not for the original mutable `let`.
**Confidence:** HIGH -- reproduced live in isolated scratch files, both the failing shape and the
two working variants (no-closure; closure-over-a-fresh-const).
**Saves/costs:** this is a general TypeScript strict-mode rule (not specific to `node:http`'s
`Server` type) worth recognizing by its shape rather than re-deriving from the error text each
time: `if (mutableVar) <closure using mutableVar>` inside a `try`/`finally` cleanup block is
exactly the pattern this project's test helpers use repeatedly for "close the stand-in server if
one was ever created," and every future conversion of a similar helper should reach for the
capture-into-a-const idiom immediately rather than debugging the narrowing loss from scratch.

### 2026-08-03 — `tools/vice-launcher.sh` CANNOT produce a `node_version` broker record while a real (bash) broker is alive, and running it to try would trade the working daemon for a record that reads as `never_started`

**Type:** dead end (an approach that looked right and was not) + hazard
**Evidence:** live, this session (`/gsd-verify-work 01.6.1`, UAT test 3). Phase 01.6's backstop
truth expects `broker.json` to carry `pid`/`started_at`/`node_version` written by
`vice-launcher.sh` → `exec node tools/vice-broker.mjs`. With the host broker up and serving this
session's lease, the live `.vice-supervisor/broker.json` was read directly (it is inside the
mounted workspace, so it is readable from the container) and shows `pid`/`started_at` present,
`node_version` **absent**, and `"written_by": "vice-broker.sh"` — i.e. the record was written by
the **2,103-line bash daemon** (`resources/vice-broker.sh`), which does not emit `node_version`.
That absence is correct behaviour for the bash writer, not a defect.

The obvious next move — "restart with a fresh broker via the launcher so the Node path writes the
record" — is a dead end, for three independent reasons found by reading the source rather than by
trying it:

1. **Double refuse-to-clobber guard.** `vice-broker.mts:132-140`'s `writeBrokerRecord()` refuses
   if `pidIsAlive(existing.pid)` (the bash broker's pid was alive) **and** separately refuses if
   the existing record `hasOwnProperty("heartbeat_at")` (it did: `heartbeat_at` was present).
   Either guard alone makes the write refuse and exit non-zero. So the launcher cannot write a
   `node_version` record at all while a real broker is alive.
2. **It is a tracer, not a broker.** `vice-broker.mts` is **190 lines** with no `setInterval`, no
   listener and no poll loop — `main()` writes one record, sets `process.exitCode`, returns. The
   real broker is the 2,103-line `resources/vice-broker.sh`. Phase 01.6 was "prove the build
   topology end-to-end on ONE REAL MODULE"; this is that module, not a broker implementation.
3. **Succeeding would strand every later session.** `vice-broker.mts:14-20` states it
   "DELIBERATELY OMITS heartbeat_at" because `vice-broker-client`'s `readBrokerLiveness()`
   classifies a heartbeat-less record as `never_started` — "adding a heartbeat field here would
   make an inert record read as 'alive' to every session's proxy and strand it on a request nobody
   serves." So the only state in which the launcher *can* write (dead pid, no heartbeat) is also a
   state in which it leaves no daemon behind and the record it leaves says nobody is home.

**Confidence:** HIGH for guards 1–3 and the bash-authorship of the live record (source read
directly plus the live `broker.json` inspected in-session). The end-to-end host ritual was
deliberately NOT executed, so the claim "the launcher would write `node_version` once the record
is clear" remains MEDIUM — mechanism-derived, matching `01.6-VERIFICATION.md`'s own backstop
status, not run.

**Saves/costs:** saves a self-inflicted emulator outage. The tempting remedy for the missing
`node_version` field costs the working broker and produces a record that actively misinforms the
next session's proxy. The field arrives honestly in **Phase 01.6.2**, which replaces the bash
daemon with a TypeScript process that genuinely *is* the broker — at which point `node_version` is
written by a live process with a heartbeat, and the truth becomes verifiable without stopping
anything. Do not chase this field before then.

### 2026-08-03 — the container guard protects only the *launcher* path: running the compiled broker directly inside this container is unguarded, and always has been

**Type:** hazard (a real hole that nothing currently exercises, so nothing currently reports it)
**Evidence:** doc/source-derived, this session (`/gsd-plan-phase 01.6.2` research pass, `gsd-phase-researcher`
reading `.claude/mcp/vice/resources/lib/container-guard.sh` — 184 lines — in full, plus every script that
sources it). `container-guard.sh` is sourced by `vice-broker.sh`, `vice-supervisor.sh` and
`vice-launcher.sh`. Its five detection signals (`fs.existsSync`-shaped file checks, one `process.env`
read, `systemd-detect-virt`, `/proc/1/cgroup`) fire **only when one of those shell entry points runs**.
Invoking the Node broker directly — `node resources/vice-broker.mjs`, bypassing the shell wrapper — is
therefore completely unguarded. Nothing does this today, which is exactly why the hole has never
surfaced: it is untested rather than known-safe.

**Why this matters beyond the one phase that fixes it:** the guard exists because host-side broker code
run inside the devcontainer would try to spawn `x64sc` in a container with no display and no host state
directory — the failure is confusing rather than loud. Anyone adding a new Node entry point to the
host-side plumbing inherits the hole silently, since the guard is not in the code path they are writing.
The structural fix is to make the guard a property of the *process*, not of the *wrapper that started it*.

**Resolution in flight:** Phase 01.6.2 decision PD-03 (developer, 2026-08-03) ports the guard to
TypeScript, checked at broker process startup before any state read/write or spawn — chosen over
inlining the bash into the surviving launcher precisely because it closes this hole rather than
relocating it. All five signals are directly Node-portable, and the ported guard becomes unit-testable
with mocked `/proc/1/cgroup` content and env vars instead of only being reachable via a bash subprocess
spawn. Recorded in `.planning/phases/01.6.2-the-one-process-host-broker/01.6.2-DISCUSSION-AGENDA.md`.

**Confidence:** HIGH that the hole exists as described (every sourcing script read directly; the guard's
own `_container_guard_record_signal`/`container_guard_evaluate` structure confirms it is invocation-scoped).
MEDIUM that the direct-invocation path is genuinely never used today — established by "nothing in the
repo does it," which is absence-of-evidence, not a live check.

**Saves/costs:** saves a confusing container-side failure for whoever next adds a Node entry point to the
host plumbing, and records *why* the TypeScript port was chosen over the cheaper bash inline — so a later
reviewer does not "simplify" the guard back into the launcher and silently reopen the hole.

### 2026-08-03 — Phase 01.6.2 plan 01 control-plane wire format: `as-specified` confirmed, unix-domain socket auth is a recorded dead end

**Type:** confirmation + dead end
**Evidence:** developer decision at the plan's blocking `checkpoint:decision` gate (Phase 01.6.2
plan 01, task 2), during `/gsd-execute-phase 01.6.2`. Not a live measurement — a one-way design
choice made explicitly to avoid re-litigation, since every later plan and both container-side
modules are written against it.
**Confidence:** HIGH that the decision itself was made and is final (developer's own words, "No
amendments. Do not re-open this decision in later tasks."). The two residual risks named below
keep their own, lower confidence — see below.

**Confirmed as specified, no amendments:**
- **Auth** — per-boot capability token in `broker.json` (mode `0600`, uid-parity precondition
  `D-1.2-D`), required on every control request, checked before any state read or write.
- **Bind** — `0.0.0.0` explicitly, never `127.0.0.1` (the container reaches the host at
  `host.docker.internal`, the bridge address, not loopback).
- **Port** — `19510` default, overridable via `VICE_BROKER_CONTROL_PORT`.
- **Framing** — newline-delimited JSON, one object per line; connection open = claim, close =
  release. Requests `acquire`, `release`, `recycle` (`target_id`), `status`, `host_state`; an
  `acquire` grant carries exactly the five fields `containerizeGrant()` already reads (`id`,
  `port`, `url`, `epoch_file`, `supervisor_dir`).

**Residual risks, recorded as accepted rather than verified:**
- The `19510` port default's placement (above the registered range, below this container's
  measured ephemeral range start of `32768`) is reasoned from *this container's*
  `/proc/sys/net/ipv4/ip_local_port_range`. The **host's** own ephemeral range is unverifiable
  from inside this container. Confidence: MEDIUM — doc/measurement-derived for the container side
  only, not exercised against the real host.
- The capability token's strength is bounded by the `D-1.2-D` uid-parity precondition on
  `broker.json`'s mode-`0600` file permission — if that precondition ever fails to hold, the token
  is only as strong as the file permission enforcing it, not an independent secret channel.
  Confidence: MEDIUM — the precondition is already relied upon elsewhere (same file, same read),
  not newly introduced, but its continued truth is not re-verified by this decision.

**Dead end, named so it is not re-litigated:** a host unix-domain socket (filesystem-permission
auth, no token needed) was considered and rejected as a *design dead end*, not merely a worse
option — a unix socket on the host is not reachable from the container across the Docker bridge,
which is the entire reason this listener is TCP in the first place. Confidence: HIGH (structural;
the container-to-host reachability constraint that rules it out is the same one that makes `0.0.0.0`
mandatory above, already established in Phase 01.1/01.2).

**Saves/costs:** saves a later plan from re-opening a one-way door — the file protocol this
control plane replaces is deleted, not disabled, so a change of mind after Task 3 lands would mean
rewriting the client, the listener, the discovery record and every test that drives them. Recording
the two residual risks as accepted-not-verified, rather than silently treating them as closed,
keeps `01.6.2-VALIDATION.md`'s backstop-truth bookkeeping honest.

### 2026-08-04 — a long-lived Node server holding `setInterval` timers never actually exits on a signal unless the handler calls `process.exit()`; merely setting `process.exitCode` is not enough

**Finding:** Phase 01.6.2 plan 04 wired `registerShutdownHandlers()` (`broker-kill.mts`) to every
catchable shutdown path in `vice-broker.mts`. The first working version only set
`proc.exitCode = code` after killing every instance — mirroring this codebase's own established
convention elsewhere (`main()`'s argument-parsing error paths: "never call `process.exit()`,
always set `process.exitCode` so pending I/O flushes first"). Against a real spawned broker
process (`broker-e2e.test.ts`-style: build the artifact, spawn under bare `node`, send a real
`SIGTERM`), the child pids it launched were correctly killed, but **the broker process itself
never actually exited** — `child.exitCode`/`child.signalCode` stayed `null` past an 8-second
poll deadline. Root cause: `vice-broker.mts`'s `run()` installs a heartbeat `setInterval` and a
poll-pass `setInterval`, both of which keep the event loop alive for the process's entire life by
design. Setting `process.exitCode` only tells Node *what code to exit with once the event loop
naturally drains* — it does not itself stop anything, and an interval-based server's loop never
drains on its own. The convention that "never `process.exit()`" is correct is scoped to a
synchronous, short-lived code path with pending writes to flush before a natural exit; it does
not extend to a deliberate, fully-sequenced shutdown of a process that would otherwise run
forever.

**Fix:** `registerShutdownHandlers()`'s default `exit` callback now distinguishes the real Node
`process` global (the production wiring, `deps.proc` omitted) from an injected test stand-in
(`deps.proc` supplied, e.g. a plain `EventEmitter`): it always sets `proc.exitCode` first, but
calls the real `process.exit(code)` explicitly ONLY when operating against the real global
process. A test's injected fake `proc` never takes that branch, so emitting `'exit'` /
`'uncaughtException'` on a fake stand-in never terminates the actual test-runner process — while
the real broker, wired with no `proc` override, genuinely exits after a signal.

**Evidence:** live, in this container — reproduced via a real spawned `resources/vice-broker.mjs`
process (VICE_BIN stubbed to `/bin/sleep`) sent a real `SIGTERM`/`SIGINT`/`SIGHUP`; failed
(process never exited, deadline reached) before the fix, passed (child pids gone AND
`exitCode === 0`) after it. Three separate signal-path tests in `broker-kill.test.ts` all exercise
this.
**Confidence:** HIGH — reproduced and fixed against a real Node process in this container, not
inferred from documentation.
**Saves:** the exact 8-second deadline-timeout failure mode this entry describes, for anyone who
next adds a `setInterval`-based long-lived process in this codebase and reaches for the
"never `process.exit()`" convention by reflex without checking whether it still applies once the
event loop has something keeping it alive forever.

### 2026-08-04 — Plan 11 Task 1 checkpoint:decision resolved: `delete` (the four retiring bash files and the retiring test suite, in one commit)

**Decision:** Confirmed at plan 11's blocking `checkpoint:decision` (reversibility: one-way).
Selected `delete` over `delete-scripts-keep-suite` and `defer` — delete
`resources/vice-broker.sh` (2,103 lines), `resources/vice-supervisor.sh` (443 lines),
`resources/lib/container-guard.sh` (184 lines), `resources/lib/repo-root.sh` (103 lines, plus the
then-empty `resources/lib/` directory), and `vice-broker.test.mjs` (2,697 lines, 61 tests) — all
in one commit, together with the structural arrays in `host-scripts.test.ts` that enumerate them.
No amendments, no partial variant.

**What backs it:** plan 10's disposition ledger gives every one of the 61 retiring tests a named
disposition (4 REPLACED, 31 RE-OBSERVED, 26 DELETED-with-reason), each REPLACED/RE-OBSERVED row's
named replacement confirmed to exist and pass; plan 10's function disposition table gives every
retiring shell function a PORTED/DELETED/ABSORBED outcome; plan 07's structural closure gate
already proved the file-protocol deletion holds; the frozen epoch/broker fixtures from plan 01
preserve the on-disk contracts as evidence independent of the scripts; plan 09 repointed every
host-instruction message at the surviving `vice-launcher.sh` before this deletion could land.

**What is knowingly given up:** the bash implementation stops being available as a live reference
for comparison during the rest of this sub-phase. No live host-session verification exists until
Phase 01.4 — this checkpoint does not re-open that acceptance (already recorded, D-03), it is only
the last point at which the retiring implementation could still be diffed against.

**Precedent followed:** the equivalent deletion in Phase 01.6 plan 04 sat behind the same kind of
blocking decision checkpoint.

**Re-dispatch note:** a prior agent reached this same checkpoint in a since-reaped worktree,
correctly halted having made zero commits, and lost nothing (git history + all five retiring
files were untouched). This entry is written by the re-dispatched agent recording the developer's
already-made decision before proceeding to Tasks 2 and 3, rather than re-asking.

**Confidence:** HIGH — a developer decision at a blocking checkpoint:decision gate, not a coded
behavior a test can prove; recorded here per the precedent `01.6.2-01-SUMMARY.md` set for its own
Task 2 wire-format checkpoint.

### 2026-08-04 — Plan 12 Task 3: a complete, exhaustively unit-tested module can be dead code from the real entry point's point of view, and a fully green suite reports nothing wrong

**Finding:** `broker-launch.mts`'s `superviseChild()` — a complete per-child crash-respawn
supervisor with doubling backoff, a crash-loop give-up threshold, and a `deliberateKill` marker —
was built and exhaustively unit-tested in plan 03 (backoff-doubling, give-up, deliberate-kill,
per-instance logging, all green). It was never imported or called anywhere in `vice-broker.mts`,
the real broker entry point, for two whole plans (04 through 11) and a full phase verification
pass. The concrete instance: before this plan's Task 1, the only non-test, non-comment reference
to `superviseChild` in the entire `.claude/mcp/vice` tree was its own export at
`broker-launch.mts:820` — confirmed directly by grep (`01.6.2-VERIFICATION.md`'s own diagnosis,
re-confirmed independently at the start of this plan). 368 tests passed the whole time; none of
them proved the assembled system ever reached the module they were testing, because a unit test
proves the unit behaves, not that the real entry point arrives at it.

**Cheap detector that found it:** a one-line grep for the module's own exported name inside the
real entry-point file (`grep -c superviseChild vice-broker.mts`, restricted to non-test,
non-comment lines) — zero hits was the whole diagnosis. No static analysis tool, no type error,
and no failing test surfaced this; the module typechecked, exported cleanly, and its own tests
were green throughout.

**Cheap detector that keeps it closed:** this plan's own structural gate
(`broker-launch.test.ts`, "structural: broker-launch.mts's child exit listener is installed in
exactly one place, and vice-broker.mts's spawn-factory count equals its withCrashSupervision
call-site count, importing the wrapper by name") promotes that same diagnostic grep into a
standing, three-part equality assertion: a future third launch path that adds a `spawnFactory`
without composing it through the shared wrapper changes the count equality and fails this test,
rather than shipping unsupervised the way this one did.

**Process mechanism that produced it:** plan 03's own `files_modified` deliberately excluded
`vice-broker.mts` — confirmed by direct read of `01.6.2-03-SUMMARY.md` line 206: *"vice-broker.mts
(Plan 01/02's real broker entry point) is NOT wired to call superviseChild() yet — this plan's own
files_modified deliberately excludes vice-broker.mts... This is a known, explicit scope boundary
..., not an oversight — whichever plan next touches vice-broker.mts's real launch paths should
route them through superviseChild() ... and should flag this gap if it is not already accounted
for in that plan's own scope."* The boundary was stated honestly at the time. The miss is that no
later plan's own scope picked up that flagged gap until this gap-closure plan — wiring a module
into its real caller was nobody's declared task, so it stayed undone silently behind a green
suite for two plans and a full verification pass.

**Evidence:** live, in this container — the pre-fix zero-hit grep was re-run and reconfirmed at
the start of this plan (matching `01.6.2-VERIFICATION.md`'s independent finding), and the fix
(Tasks 1–2 of this plan) plus the standing gate (Task 3) were built and proved against the real
spawned broker artifact, not merely against the module in isolation.

**Confidence:** HIGH — reproduced directly in this container (the grep, before and after), not
inferred from documentation.

**Saves:** re-deriving this exact diagnosis (which file to grep, which name to grep for, why a
green suite does not mean the system reaches the code) for whoever next builds a host-side module
in `broker-launch.mts`/`vice-broker.mts`'s sibling relationship and wonders why their new
`unit`-tested function has zero effect on the running broker.

### 2026-08-04 — Plan 12 Task 3: the wiring-assertion technique — count call sites in the real entry point, not just exports in the module

**Finding:** the general technique this plan's structural gate applies: for any host-side module
in this subsystem that exposes a primitive meant to be composed into a real entry point (a
wrapper, a factory, a guard), the unit test proving the primitive behaves correctly is
insufficient on its own — pair it with a wiring assertion in the SAME file that counts the real
entry point's own call sites into that primitive and asserts the count is not zero (or, where
there are multiple call sites that must each be wrapped, that it equals the number of places that
need wrapping). This plan's own gate does the count-equality form: `vice-broker.mts`'s
`spawnFactory:` property count must equal its `withCrashSupervision(` call-site count, so a THIRD
launch path added later without composing through the wrapper changes the equality and fails the
gate immediately, rather than shipping silently the way the original CR-01 gap did.

**What it costs:** one structural test per primitive that needs this guarantee — a `readFileSync`
of the two files plus two or three count-based assertions, no new production code and no runtime
cost.

**What it saves:** the entire class of defect this gap closure exists to repair — a substantively
correct, exhaustively unit-tested module that the shipped system never reaches, discoverable only
by a fully green suite that reports nothing wrong. The cost of NOT having this gate, demonstrated
in this exact plan, is two full plans (04–11) plus a full phase verification pass elapsing before
anyone noticed.

**Evidence:** the gate's own discriminating power was demonstrated live in this container, not
assumed: the warm-floor path's `withCrashSupervision(...)` composition (Task 2 of this same plan)
was temporarily reverted to a bare, unwrapped spawn factory in the actual working tree (never
committed), the gate was run, and it failed with `assertion 2 (spawn-factory count vs
supervision-wrapper call-site count) FAILED: vice-broker.mts declares 2 comment-stripped
spawnFactory properties but composes through withCrashSupervision( at only 1 comment-stripped call
site` (`2 !== 1`). The file was then restored via `git checkout -- vice-broker.mts` (a targeted,
single-file restore of already-committed content, not a blanket reset) and the gate was
re-confirmed green.

**Confidence:** HIGH — the discriminating-power demonstration above was executed live in this
container, immediately before this entry was written.

**Saves:** for the next maintainer deciding whether a wiring assertion is worth writing versus
"the unit tests are already green" — this is the concrete, reproduced cost/benefit: one test,
versus a defect that survives a fully green 368-test suite for two plans undetected.

### 2026-08-04 — Plan 12 Task 3: a naive line-anchored comment strip (`^\s*//`) misses `/** ... */` JSDoc block comments, and a count-based structural gate is self-invalidating the moment its OWN authoring comments mention the counted token

**Finding:** while writing this plan's structural gate (the entry above), the exact self-
invalidation failure mode the plan's own task description warned about was reproduced by
accident, in the gate's own surrounding code, before the gate was even finished: this plan's
Task 1/2 authored `/** ... */` JSDoc comments in `vice-broker.mts` (documenting the new
`superviseDepsFor()` helper and the warm-floor composition) happen to mention both counted tokens
inline — one doc comment reads "Builds the supervision dependency object for
withCrashSupervision()," and another reads "Deliberately does NOT set spawnFactory: on a
respawn...". A first-draft verification grep using this project's OWN established idiom elsewhere
(`grep -v '^\s*//'`, which strips only whole COMMENT LINES that begin with `//`) left both of
these untouched, because they are `/** */` block-comment lines that begin with ` * `, not `//` —
inflating `withCrashSupervision(` 's raw count to 3 and `spawnFactory:` 's raw count to 3, when
the real (non-comment) count of each is 2. An "at least N" acceptance check tolerates this
silently; the Task 3 gate's exact-equality check (`spawnFactoryCount === wrapperCallSiteCount`)
would NOT have — it would have reported 3 !== 2 against perfectly correct code, a false failure
exactly as costly as the false pass this whole gap closure exists to prevent.

**Fix:** the gate's own `stripComments()` helper (`broker-launch.test.ts`) strips full `/* ... */`
block comments (including `/** ... */`, via a non-greedy `[\s\S]*?` match spanning newlines)
BEFORE stripping whole `//` comment lines, rather than relying on the whole-line `^\s*//` idiom
alone. Whole-line-only `//` stripping (never an inline trailing `// comment` after real code) is
kept deliberately, so a string literal containing `//` (e.g. this same file's own
`http://127.0.0.1:<port>/mcp` URL construction) is never truncated mid-line by an over-eager
inline strip.

**Evidence:** live, in this container — the raw (pre-fix) counts were computed via
`grep -v '^\s*//' vice-broker.mts | grep -c 'withCrashSupervision'` (returned 3) and the same for
`spawnFactory:` (returned 3), then re-computed after applying the block-comment-aware
`stripComments()` helper (returned 2 for both), matching the real, non-comment call-site count
confirmed by direct line-by-line inspection (`grep -n`).

**Confidence:** HIGH — reproduced and fixed live in this container against the actual authored
source, not inferred from documentation.

**Saves:** this exact off-by-one-comment-style trap, for whoever next writes a count-based
structural gate anywhere in this codebase and reaches for the established `grep -v '^\s*//'`
idiom by reflex — that idiom is correct for whole-line `//` comments only, and silently
under-strips any `/** ... */` JSDoc block that happens to mention the counted token, which is
precisely the self-invalidation failure mode a count gate exists to avoid.

### 2026-08-04 — ACME `.a` source files are invisible to the agent's Read tool regardless of content; Edit (which requires a prior Read) is blocked as a consequence

**Type:** hazard (toolchain / agent-workflow), confirmed live and mitigated in the same
session.
**Evidence:** live, in this container, 2026-08-04, during quick task 260804-ae9 (fixing
`acme-build`'s SKILL.md). Read on `.claude/skills/acme-build/template.a` failed with `This tool
cannot read binary files. The file appears to be a binary .a file.`; a freshly `node acme.mjs
new game.a`-scaffolded file hit the identical refusal. A byte-identical copy of the same
content saved as `game.asm` read fine with no error. Confirmed the driver (`scripts/acme.mjs`)
is indifferent to the extension: `node acme.mjs build` on `game.a`, `game.asm` and `game.s` all
reported the identical `Saving 53 (0x35) bytes (0x801 - 0x836 exclusive).` note and produced
byte-identical `.prg`/`.sym`/`.vs`/`.rep` output, with the output stem unaffected by which
extension was used for the source.
**Confidence:** HIGH — reproduced live in both directions (refusal on `.a`, success on `.asm`),
and the driver's extension-indifference was independently confirmed via matching build output
across three extensions.
**Saves / costs:** costs a confusing "binary file" refusal on a file that is plain text,
misread as a corrupt or non-text file, the next time an agent tries to open ACME source named
`.a` — which is this project's own naming convention for the rebuild's source tree. Saves that
detour: scaffold and write ACME source as `.asm` (or `.s`) instead of `.a` whenever the agent
itself needs to read or edit it later; read an already-existing `.a` file via `sed -n '1,60p'
file.a` (or equivalent) rather than the Read tool. `acme-build`'s own SKILL.md and `template.a`
were updated to use `.asm` examples and to carry this Troubleshooting row (same session, same
commit).

### 2026-08-04 — an absolute path written for the main checkout silently resolves to the wrong content inside a git worktree, with no error

**Type:** hazard (toolchain / agent-workflow), caught before it produced a wrong finding.
**Evidence:** live, during quick task 260804-ae9, executing inside a parallel-executor git
worktree (`/workspaces/bruce_lee/.claude/worktrees/agent-a17977441deb96574`). The task's own
plan specified an absolute driver path,
`/workspaces/bruce_lee/.claude/skills/acme-build/scripts/acme.mjs`, for a capture sequence
meant to exercise a `template.a` fix already applied in the worktree. Running `node` against
that literal path executed the **main checkout's** copy of `acme.mjs`, which in turn read the
main checkout's (still-unfixed) `template.a` via its own `HERE`-relative path — reproducing the
stale, pre-fix content in the capture even though the worktree's own copy had already been
corrected. No error or warning was produced; the command ran and exited 0. Re-running the
identical sequence against the worktree's own absolute path
(`.../.claude/worktrees/agent-a17977441deb96574/.claude/skills/acme-build/scripts/acme.mjs`)
produced the corrected output.
**Confidence:** HIGH — reproduced live: same command, same relative arguments, only the leading
absolute path segment changed, with directly observable differing output (stale vs. fixed
`template.a` content) confirmed by direct `sed`/`grep` comparison of both checkouts' files.
**Saves / costs:** costs a false capture — evidence that looks freshly re-verified but was
actually read from a sibling checkout, silently invalidating any downstream fix built on it.
Saves the detour: inside a worktree, never trust an absolute `/workspaces/<repo>/...` path
handed down verbatim by a plan or an earlier session — resolve the worktree's own root first
(`git rev-parse --show-toplevel`) and build absolute paths from that, or use paths relative to
the current working directory instead.

### 2026-08-04 — PROMOTION to HIGH: the vector-table method reproduces the live `$1103` IRQ entry from a static capture, for both releases

**Type:** confirmation (promotes the 2026-08-01 "vector table: six pairs, and `$01` decides which
pair is live" entry, and the 2026-08-02 "the exact bit of `$01` … HIRAM, bit 1" entry, from
MEDIUM to HIGH). Logged as a new entry, not as an edit to either grade in place.
**Evidence:** mechanical derivation over `recovery/danish/dumps/danish-gameentry-run1.bin` and
`recovery/saeger/dumps/saeger-gameentry-run1.bin` — both three-run-verified captures — using
`.claude/skills/c64-program-recon/scripts/derive.mjs vectors`, written and run during the
authoring of the `c64-program-recon` skill. No emulator involved. Cross-checked against the
independently recorded live finding in the 2026-08-02 checkpoint-trap entry, which names `$1103`
as an IRQ-handler entry with the raster-split chain `$1103 → $1574 → $152C`.
**Confidence:** HIGH — derived, then matched against a live observation recorded separately and
earlier, on two independent releases.

Both captures return, identically:

- `$01` = `$40` — LORAM 0, HIRAM 0, CHAREN 0. BASIC and KERNAL banked out.
- HIRAM = 0 ⇒ the live vector pair is `$FFFE/$FFFF`, which holds **`$1103`**.
- `$0314/$0315` holds `$0101` — meaningless, exactly as expected with the KERNAL banked out.

**The trap this closes, and it is the practically valuable half.** `$0314` reading `$0101` looks
like a retargeted vector and invites a hunt for a handler at `$0101`. It is uninitialised RAM. The
HIRAM bit is what says so, and reading it *first* costs one byte and removes the whole detour.

**Saves:** the entry-point and IRQ-handler question on a depacked image, answered in one read of a
capture already on disk, with no emulator and no session risk — against re-deriving it live each
time. It also means step 5 of the skill todo
(`2026-08-01-collect-c64-reverse-engineering-findings-into-a-fast-re-skill`) is satisfied for the
control-flow half: the method reproduced a known-good result cold. The chip half (VIC-II charset
/ sprite / screen rediscovery) is still untested against the extraction work and stays MEDIUM.

### 2026-08-04 — Plan 13: a single boolean silently answering two orthogonal questions is a latent defect that stays dormant only while one of the two questions has no second answer

**Finding:** `InstanceRecord.deliberateKill` (`broker-state.mts`) originally answered two
different questions with one boolean: "did the broker order this death?" and "should a
replacement follow?" This was harmless for the whole of plans 02–11 because there was only ever
ONE kind of broker-ordered death in the shipped broker — a release, whose answer to the second
question is always "no" — so with no second answer ever in play, the conflation had nothing to
expose. The moment plan 12 wired real crash supervision into the real broker, the conflation
became live: had this plan wired respawn-on-recycle by simply reusing `deliberateKill` without a
second field, the exit handler would have had no way to tell a recycle (wants a replacement)
apart from a release (wants none) — every release would have been misread as a recycle candidate
the instant the marker's meaning was silently stretched to also mean "replace it," breaking
kill-never-recycle for every release in the broker, not merely failing to add recycle's own new
path.

**The detector:** whether the two call sites that set the marker — the recycle handler and the
release handler in `vice-broker.mts` — want the SAME value for the second question. They do not:
recycle wants `true`, release wants `false`. That is exactly why the fix splits the question at
the type level into two fields (`deliberateKill`, narrowed to the first question only, and a new
`respawnAfterKill` for the second) set together by one shared setter (`markDeliberateDeath()`),
rather than widening `deliberateKill` itself into a tri-state value, or leaving a second, silently
competing boolean for a future maintainer to reconcile by hand. A structural test
(`broker-control.test.ts`) now holds this apart permanently: it asserts, region-scoped to each
handler's own body, that the setter precedes the kill call and that the two call sites pass
opposite `respawnAfterKill` answers.

**What it saves:** this plan's own release end-to-end test
(`broker-e2e.test.ts#"wired release: a release over the real control plane kills the granted
child and no replacement appears -- kill-never-recycle holds with supervision wired"`) is what
would have caught this exact regression if the fields had been conflated — but only AFTER the
fact, on a green suite that had already shipped the conflated marker. Splitting the question at
the type level means a future maintainer adding a THIRD kind of broker-ordered death cannot
reintroduce this conflation without either the structural gate above or a call site visibly
passing the same `respawnAfterKill` answer for two semantically different deaths — both are things
a code reviewer can actually see, unlike a single boolean whose second meaning was only ever
implicit in the reader's head.

**Evidence:** derived from this plan's own design work (`01.6.2-13-PLAN.md`'s
`assumption_delta_decision` block, itself written before any code existed) and confirmed live
against the wired broker in this container: both new end-to-end tests
(`broker-e2e.test.ts#"wired recycle: ..."` and `broker-e2e.test.ts#"wired release: ..."`) pass
against the real spawned broker artifact with the split fields in place, and the structural gate
in `broker-control.test.ts` passes asserting the two handlers pass opposite `respawnAfterKill`
answers to the one shared setter.

**Confidence:** HIGH — the conflation and its fix are both directly observable in the diff this
plan produced, and the two end-to-end tests exercise the exact failure mode (a release respawning)
the conflation would have caused.

## Tooling findings — the pure-Node modules in `tools/`

### 2026-08-04 — `d64-parse --json` decides directory fakery for you, with named reasons

**Type:** shortcut
**Evidence:** `node tools/d64-parse.mjs directory --image disks/danish.d64 --json` run live in
this container; the flagging rule read off `parseDirectory`'s contract in `tools/d64-parse.mjs`
**Saves:** the eyeball pass over a directory listing, and the wrong conclusion it invites

Every entry carries `suspicious` plus `suspicious_reasons` — never a bare boolean. It is set when
the block count is 0, when the first track/sector falls outside the image, or when it points into
a track the BAM reports as entirely free. That third case is the actual signature of an entry
claiming a file never written to disk. A non-null `chain_error` is the separate failure: a chain
that leaves the image or loops, reported rather than hung on.

Both project images return `suspicious: false` for `BRUCE LEE` — genuinely well-formed, not faked.
`tools/d64-parse.test.mjs` asserts this against the real images as committed fixture tests.

**Confidence:** HIGH — run live, and covered by fixture tests over the real disk images.

### 2026-08-04 — a capture's assembly path is checkable against a committed dump's own digest

**Type:** confirmation
**Evidence:** 16×4096-byte `{address,hex}` chunks derived from
`recovery/danish/dumps/danish-gameentry-run1.bin`, fed to `node tools/dump-artifacts.mjs assemble`
→ `65536 bytes, sha256 e1b8428c55bc7606b7e77846e8928bff23e9cf0c8241da479aadc1bc092faa26`,
byte-identical to the `sha256` field committed in that dump's `.capture.json`
**Saves:** turns "the tool produced 65536 bytes" into "the tool reproduced a known-good artifact"

This is the cheap regression check on the capture path itself, and it needs no emulator — any
committed `.bin` can be re-chunked and pushed back through `assemble` to confirm the assembly and
digest logic still agree with what was committed earlier.

**Confidence:** HIGH — reproduced live against the committed sidecar.

### 2026-08-04 — the guards name the offending address; a dropped 4096-byte read is otherwise invisible

**Type:** hazard
**Evidence:** deliberately broken chunk sets run through `assemble` live — a removed chunk gives
`assembleImage: gap before address $3000 -- next chunk starts at $4000`, a 2-byte-truncated final
chunk gives `assembleImage: assembled 65534 bytes ending at $FFFE, expected exactly 65536`, and a
4-byte overlap gives `assembleImage: overlap at address $8000 -- a previous chunk already covered
up to $8003`
**Costs:** hand-concatenating the chunks instead loses all three of these signals silently

A 64K capture is 16 `vice_memory_read` calls, and the normal failure is one of them dropping or
returning short. In a hex dump the result still looks like plausible memory. The assertions run
*before* anything is written, so a bad set never reaches `recovery/`. Read the messages as
addresses to re-read, never as sizes to pad.

**Confidence:** HIGH — all three messages produced live in this container.

### 2026-08-04 — `classification_state` distinguishes a fresh capture from a post-diff one

**Type:** trick
**Evidence:** `manifest` on freshly derived chunks emits `classification_state: "ranges-only"`
with every range `kind: "unclassified"`; the committed
`recovery/danish/dumps/danish-gameentry-run1.map.json` carries `"bucketed"` with real
`loader`/`cracktro`/`game`/`unused` kinds
**Saves:** a one-field check for whether a manifest has been through the provenance diff yet

A fresh capture claiming `"bucketed"` is the anomaly — only the provenance diff sets it.

**Confidence:** HIGH — both states observed directly, one live and one committed.

### 2026-08-04 — dead end: the `tools/` modules do NOT depend on the caller's working directory

**Type:** dead end (a plausible troubleshooting rule that is simply false)
**Evidence:** `cd tools && node releases.mjs list` succeeds and prints both releases; every module
derives `REPO_ROOT` from `dirname(fileURLToPath(import.meta.url))`, not from `process.cwd()`
**Saves:** stops "run it from the repo root" being written into docs as a fix for a failure it
cannot cause

This was drafted into a skill's troubleshooting table as the cause of a
`no registry at .../recovery/RELEASES.json` error and removed after testing. That error means the
registry is genuinely absent, not that the caller was in the wrong directory. Path arguments are
resolved against the caller's cwd; the repo-relative data files are not.

**Confidence:** HIGH — the false rule was tested and disproved in this container before shipping.

### 2026-08-04 — HAZARD: `c64-ram-capture`'s volatile-span list omits `$D000-$DFFF`, so its own comparison rule fails 5 of 6 pairings of this project's verified captures

**Type:** hazard (a documented rule that gives the wrong answer), plus a confirmation of where
capture non-determinism actually lives.
**Evidence:** mechanical, no emulator. `.claude/skills/c64-ram-capture/scripts/compare.mjs`
(written during quick task 260804-bux) implements the three classification rules exactly as
`c64-ram-capture/SKILL.md` states them — volatile spans `$0000-$0001`, `$0100-$01FF`,
`$0200-$03FF` excluded from the verdict; one differing bit is drift and passes; two or more bits
is divergence and fails — then run over all six committed gameentry captures
(`recovery/{danish,saeger}/dumps/*-gameentry-run{1,2,3}.bin`, all 65536 bytes, all six sha256s
matching their committed `.capture.json` manifests, which independently validates the reader).

Result — **five of the six pairings FAIL** under the skill's own documented rule:

| pairing | volatile | drift | divergence | verdict |
|---|---|---|---|---|
| danish run1 vs run2 | 195 | 142 | 1 | FAIL |
| danish run1 vs run3 | 164 | 130 | 2 | FAIL |
| danish run2 vs run3 | 35 | 126 | 0 | PASS |
| saeger run1 vs run2 | 139 | 104 | 1 | FAIL |
| saeger run1 vs run3 | 14 | 113 | 2 | FAIL |
| saeger run2 vs run3 | 133 | 105 | 1 | FAIL |

**Every divergence, across all pairings, sits at one of five addresses**, and each falls in a
region that cannot be stable:

- `$D344` — VIC-II register **image** (the VIC's 47 registers repeat every `$40` across
  `$D000-$D3FF`).
- `$D625`, `$D628` — SID **images** (`$D500-$D7FF`). This project already relies on `$D41B`
  changing every cycle as its RNG, which is the same mechanism.
- `$FAD8`, `$FC51` — RAM under KERNAL ROM (`$E000-$FFFF`, live as RAM because `$01 = $40`,
  HIRAM 0).

**The finding:** `$D000-$DFFF` is not RAM. Reading it samples live hardware, so two captures of
the same checkpoint can never agree there, and the skill's volatile list omitting that range
means its rule condemns good captures. Region classification, not bit-count, is what decides
whether a difference matters — a 2-bit difference at `$D625` is meaningless and a 1-bit
difference in game code is not, which is the exact inverse of what the documented rule says.

**Confidence: HIGH** for the `$D000-$DFFF` half — that reading register images is
non-deterministic is structural, and the addresses land on documented image ranges (resolved via
`c64-memory-mapping`'s `lookup`).
**Confidence: MEDIUM** for the `$E000-$FFFF` half — the two addresses are consistent with
uninitialised RAM under ROM, but **only two addresses out of 8192 differ**, which is far too few
for power-on garbage and is not yet explained. Do not treat `$E000-$FFFF` as blanket-volatile on
this evidence; `$FAD8` and `$FC51` deserve a look at what writes them.

**Saves / costs:** stops a reviewer voiding a sound three-run capture set over hardware register
reads, and redirects the comparison rule from bit-counting toward region classification. The
cost of not knowing it is a re-capture cycle that cannot converge, because no number of retries
makes a SID image hold still.

### 2026-08-04 — follow-up to the same hazard: excluding `$D000-$DFFF` moves 3 of 6 pairings to PASS, and isolates the remaining failure to two unexplained addresses

**Type:** confirmation of the fix for the entry immediately above, plus a sharpened open question.
**Evidence:** `compare.mjs`'s `VOLATILE` table extended with `$D000-$DFFF`, then all six committed
gameentry pairings re-run. No emulator.

| pairing | volatile | drift | divergence | verdict |
|---|---|---|---|---|
| danish run1 vs run2 | 271 | 66 | 1 (`$FAD8`) | FAIL |
| danish run1 vs run3 | 235 | 61 | 0 | **PASS** |
| danish run2 vs run3 | 100 | 61 | 0 | **PASS** |
| saeger run1 vs run2 | 197 | 46 | 1 (`$FC51`) | FAIL |
| saeger run1 vs run3 | 72 | 56 | 1 (`$FC51`) | FAIL |
| saeger run2 vs run3 | 189 | 50 | 0 | **PASS** |

PASS count goes 1 → 3, and **every remaining failure is one of exactly two addresses** — `$FAD8`
on danish, `$FC51` on saeger — both in RAM under KERNAL ROM. Each is per-release, not shared.

**The open question, now precise enough to answer cheaply:** what writes `$FAD8` (danish) and
`$FC51` (saeger)? Two addresses out of 8192 is not power-on garbage. `vice_watch_add` on each
address finds the writer, which is the leverage `c64-program-recon` names for exactly this shape.
Until then `$E000-$FFFF` stays non-volatile so the failure keeps surfacing rather than being
buried under a blanket exclusion.

**Confidence:** HIGH for the verdict table (mechanical, reproducible from committed files).
MEDIUM for "these two are benign" — untested, and the reason the range was not excluded.

### 2026-08-04 — the error *shape* tells you whether a `mcp__vice__` tool was intercepted or forwarded

**Type:** trick (and the resolution of a major todo)
**Evidence:** `mcp__vice__vice_diagnose` called live in this container on 2026-08-04, compared against
the verbatim failure wording recorded on 2026-08-02 in
`.planning/todos/completed/2026-08-02-vice-diagnose-and-vice-recycle-unreachable-from-agent-session.md`
**Saves:** distinguishes "this tool does not exist for me" from "this tool exists and is telling me
something", which cost a whole plan (01.3-05, 0/6 attempts) when read the wrong way

The `mcp__vice__*` surface mixes two kinds of tool: real host tools that the proxy **forwards**, and
proxy-local synthetic tools (`vice_diagnose`, `vice_recycle`, `vice_result_continue`) that the proxy
**intercepts** before any forwarding. Which one you hit is readable off the error text alone:

| Reply shape | Means |
|---|---|
| `vice-proxy: the host VICE MCP server ... rejected this call: Tool not found` | the literal name was forwarded to x64sc — the proxy did **not** intercept it |
| A proxy-local, tool-specific message (e.g. `the on-demand VICE broker has never been started on this host -- no broker.json record exists at all`) | the proxy intercepted it and dispatched correctly |

The second shape is proof of interception, because a forwarded call cannot produce it — the host has
no such tool and therefore nothing to report broker state about.

As of 2026-08-04 both synthetic tools resolve as named functions and intercept correctly, reversing
the 2026-08-02 finding. That was a harness-side change, not a code change: the proxy's code was
already confirmed correct and current then.

**Confidence:** HIGH for the reachability and the error-shape test, both observed directly. That
`vice_diagnose` returns a *correct verdict* is **not** established — the host broker was not running,
so no cycle bracket was measured.

### 2026-08-04 — the N≥3 drift-stability rule currently exists in no code

**Type:** hazard (a deleted invariant, not a deleted file)
**Evidence:** `tools/recover.mjs` deleted in `d963c5b` and
`.claude/skills/c64-ram-capture/scripts/ram-compare.mjs` in `db9eed3`; a repo-wide grep for
`classifyRunSet`, `sharesSingleBitDriftOrigin`, `inPowerOnPatternBlock` and `REPORT_ZONES` now
returns prose only — `recovery/*/NOTES.md`, two planning notes, and todos
**Costs:** a capture set can be declared equivalent on two runs, which this project has already
measured to be wrong

The rule was: *a byte is only stable when it agrees across N ≥ 3 captures, and a pairwise multi-bit
finding is re-adjudicated against the whole run set before it is called a real divergence.* The
forcing measurement is already in the record — **93 bytes were identical in runs 1+2 yet differed in
run 3.**

What survives is `scripts/compare.mjs` (`compare`, `floor`, `digest`), which is pairwise plus a union
floor. A union floor is not an adjudication: it reports which addresses ever differed, not which
bytes may be trusted as stable. `c64-ram-capture`'s own description still advertises proving **two**
captures equivalent, which is the half the project's own evidence says is insufficient.

Tracked in `.planning/todos/pending/move-drift-classification-into-ram-compare.md`, retargeted rather
than closed for exactly this reason.

**Confidence:** HIGH that the code is absent (grep + two deletion commits). The right home for the
rule is undecided.
