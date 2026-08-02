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
