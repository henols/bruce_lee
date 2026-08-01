---
created: 2026-08-01T19:46:08.128Z
title: Collect C64 reverse-engineering findings into a fast RE skill
area: tooling
severity: minor
files:
  - .claude/skills/c64-memory-mapping/SKILL.md
  - .claude/skills/c64-ram-capture/SKILL.md
  - .claude/skills/acme-build/SKILL.md
  - .planning/research/ARCHITECTURE.md
  - .planning/research/PITFALLS.md
  - .planning/phases/01-recovery-provenance/01-RESEARCH.md
  - .planning/phases/01-recovery-provenance/01-PATTERNS.md
---

## Problem

The three skills this project owns each cover one *station* of reverse engineering, and none
covers the *route between them*:

| Skill | Covers | Does not cover |
|---|---|---|
| `c64-ram-capture` (93 lines) | Getting a verified flat 64K image out of a running machine | What to do with the image once you have it |
| `c64-memory-mapping` (142 lines) | Resolving a single address — `$D020`, `$EA24`, `$FFD2` — to its meaning | Which addresses are worth resolving, and in what order |
| `acme-build` (163 lines) | Source → `.prg`, and `toacme` for a first-pass dead listing | Turning an untraced dead listing into a structural map |

So the method itself — *"here is a 64K image of an unknown C64 game; find the entry point,
the main loop, the IRQ handlers, the data tables, in that order"* — is re-derived from scratch
every session. Each rediscovery costs the same reasoning and risks landing somewhere different
from the last one, which is corrosive for a project whose entire premise is that every
documented byte carries a stable confidence level.

The finding that motivates this: locating the main loop and the IRQ vectors is not a search
problem. It is a small, fixed set of lookups on well-known addresses, followed by live
confirmation through `mcp__vice__*`. Written down once, it is minutes of work. Undocumented,
it is an hour of reasoning each time.

### What the collected findings need to cover

**Entry point** — where execution actually begins.
- BASIC stub at `$0801`: tokenized `SYS <addr>` line; the address is plain PETSCII digits in
  the stub, so it reads straight out of the load image.
- Autostart / non-BASIC entry: the `.prg` load address (first two bytes) plus RESET vector
  `$FFFC/$FFFD`, or a cartridge-style `$8000` CBM80 signature.
- For this project specifically, entry is *post-depack*, so the practical entry point is
  "wherever the PC sits when the decrunch checkpoint fires" — a different question with a
  different answer, and both belong in the skill.

**IRQ / NMI vectors** — the fixed table that most C64 game structure hangs off.
- `$0314/$0315` — KERNAL IRQ vector (RAM, indirect). Default `$EA31`. A game that changed it
  has its per-frame handler at the new target.
- `$0316/$0317` — BRK vector. Default `$FE66`.
- `$0318/$0319` — NMI vector. Default `$FE47`. Commonly retargeted by music players and by
  anti-tamper code.
- `$FFFA/$FFFB`, `$FFFC/$FFFD`, `$FFFE/$FFFF` — hardware NMI / RESET / IRQ-BRK vectors. Only
  live when the ROMs are banked out via `$01`; check `$01` before trusting either pair.
- Which of the two routes is in play is decided by `$01` (processor port) and by whether the
  handler starts with the KERNAL's register-save preamble or jumps straight into game code.

**IRQ source** — what is actually firing, once the handler is found.
- Raster IRQ: `$D012` (raster compare), `$D011` bit 7 (raster bit 8), `$D01A` (IRQ enable
  mask), `$D019` (IRQ latch — the handler must acknowledge it). A handler that writes a new
  `$D012` value on the way out is a split raster chain; each write is one more IRQ position
  to enumerate.
- CIA timer IRQ: `$DC0D` (CIA#1, IRQ) and `$DD0D` (CIA#2, NMI), with `$DC04-$DC07` /
  `$DD04-$DD07` for the timer periods. Music players are usually here or on a raster line.
- Distinguishing them at runtime is cheap: read the enable masks and see which is armed.

**Main loop** — the part that is genuinely a search, but a narrow one.
- Structural signature: an unconditional backward branch or `JMP` to a nearby earlier address
  that never returns, usually preceded by a frame-sync wait — polling `$D012` for a fixed
  raster line, or spinning on a flag that the IRQ handler sets.
- The IRQ-handler-does-everything variant: many games leave the main loop as a two-instruction
  spin and hang all logic off the raster IRQ. Deciding which shape a game has *before*
  hunting is what saves the time.
- Live confirmation is the honest test — the address that repeats once per frame in an
  execution trace is the main loop, whatever the static listing suggests.

**Structure below that** — the parts that turn a listing into a map.
- Jump tables and dispatch: `JMP ($xxxx)` and `JSR` into an indexed table; these are where
  game-state machines live, and they are exactly what a linear disassembler decodes wrong.
- Self-modifying code: writes into the `$0800-$CFFF` region from code that also executes
  there. Common for animation frame pointers.
- Zero-page: the game's hot variables. Highest-frequency ZP addresses in a trace are the
  state worth naming first.
- Graphics and sound data discovery: see the three chip sections below — this is the largest
  block of the method and does not compress into a bullet.
- Code/data separation: the project's own standing rule already says a range never hit as an
  instruction stream across full gameplay coverage is data regardless of what the tracer
  guessed. That rule belongs in the skill, not just in CLAUDE.md.

### VIC-II — finding charsets, screens, bitmaps and sprites

The whole point: **graphics data is not searched for, it is computed.** Every pointer the VIC
follows is derived from two registers plus a bank, so five reads locate every byte of graphics
the game is currently displaying. Getting this written down is most of the value of the skill.

**Step 1 — the VIC bank, because every other pointer is relative to it.** `$DD00` bits 0-1
(CIA#2 port A), and they are *inverted*:

| `$DD00 & 3` | Bank | Base |
|---|---|---|
| `%11` | 0 | `$0000` |
| `%10` | 1 | `$4000` |
| `%01` | 2 | `$8000` |
| `%00` | 3 | `$C000` |

Bank is the single most common source of a wrong answer here — read it first, every time.

**Step 2 — `$D018` splits into two pointers.**
- Bits 4-7 = VM, video matrix (screen RAM) base = bank + VM × `$0400`
- Bits 1-3 = CB, character generator base = bank + CB × `$0800`
- Bit 0 unused

**Step 3 — the character ROM shadow, which breaks the arithmetic if you forget it.** The VIC
sees character ROM at `$1000-$1FFF` (bank 0) and `$9000-$9FFF` (bank 2) *regardless of the
`$01` banking the CPU sees*. If CB resolves into either window the game is using ROM
characters and there is no charset in RAM to extract. This is the classic wasted hour.

**Step 4 — which mode, because it changes what the bytes mean.** Three bits, `$D011` bit 6
(ECM), `$D011` bit 5 (BMM), `$D016` bit 4 (MCM):

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

In bitmap mode `$D018` bit 3 selects the 8K half the bitmap lives in; the video matrix then
holds colour pairs, not character codes. Multicolor halves horizontal resolution and reads
bit *pairs*, which is why a multicolor sprite decoded as hires comes out as garbage twice as
wide as it should be.

**Step 5 — sprites.**
- `$D015` — enable mask. Start here; a disabled sprite's other registers are stale noise.
- Sprite pointers: **video matrix base + `$03F8`**, 8 bytes. Each pointer × 64 = the sprite's
  data address *within the current bank*. 63 bytes used of the 64 allocated.
- `$D000-$D00F` X/Y pairs, `$D010` the X bit-8 mask (sprites past X=255).
- `$D01C` multicolor per sprite, `$D017`/`$D01D` Y/X expand, `$D01B` sprite-background priority.
- `$D027-$D02E` per-sprite colour; `$D025`/`$D026` the two shared multicolor registers.

**Step 6 — colour.** Colour RAM is fixed at `$D800-$DBFF` and is **not** banked — it does not
move with the VIC bank, and only the low nybble of each byte exists. `$D020` border,
`$D021-$D024` backgrounds 0-3 (2-3 used only in ECM).

**Hazard — two VIC registers are destroyed by reading them.** `$D01E` (sprite-sprite
collision) and `$D01F` (sprite-background collision) **clear on read**. Reading them while the
game runs steals the collision the game was about to act on, which can make a running game
behave differently *because you looked at it*. Prefer `vice_vicii_get_state`, and treat
"is the monitor's read side-effect-free?" as something the skill tells the reader to verify
rather than assume.

**Where this leads in the disassembly.** A watch on `$D018` finds the screen-setup routine,
which in a room- or level-based game is usually the room loader — one of the highest-value
routines to locate early. A watch on the sprite pointer block (VM + `$03F8`) finds the
animation driver, since that is what rewrites pointers frame to frame.

### SID — finding the music player and the sound effects

`$D400-$D41C`, write-only apart from the last four registers. Three voices at 7 bytes each:

| Offset | Register |
|---|---|
| +0 / +1 | Frequency lo / hi |
| +2 / +3 | Pulse width lo / hi |
| +4 | Control — gate (bit 0), sync, ring, test, then waveform bits: triangle, saw, pulse, noise |
| +5 | Attack / Decay |
| +6 | Sustain / Release |

Voice 1 at `$D400`, voice 2 at `$D407`, voice 3 at `$D40E`. Then `$D415`/`$D416` filter cutoff
lo/hi, `$D417` resonance + which voices route through the filter, `$D418` volume (bits 0-3),
filter mode (bits 4-6), and voice-3-disconnect (bit 7).

Read-only: `$D419`/`$D41A` paddles, `$D41B` voice 3 oscillator, `$D41C` voice 3 envelope.

What matters for RE:
- **The player is whoever writes `$D400-$D418` from inside the IRQ handler.** A watch on
  `$D404` (voice 1 control — gate changes every note) lands on the play routine directly.
  Separating `init` from `play` follows from there: `init` is called once from the main code,
  `play` once per frame from the IRQ.
- **`$D41B` read = random number generator.** Reading voice 3's oscillator is the standard C64
  RNG idiom. Code reading `$D41B` is almost never doing audio — it is enemy AI, spawn
  placement, or a title-screen effect. Worth recognising on sight; it is easy to misread as
  sound code and file in the wrong place.
- **`$D418` written alone, at high frequency, with no voice setup = 4-bit sample playback.**
  A different subsystem from the music player, and it usually runs off a fast CIA timer rather
  than the frame IRQ.
- Note voice 3 disconnect (`$D418` bit 7) is often set precisely *because* voice 3 is being
  used as the RNG rather than as audio.

### CIA 6526 — input, timing, banking, and the serial bus

Two of them, and they do almost entirely different jobs. Confusing which is which is a
frequent early error, because their register layouts are identical.

**CIA#1 at `$DC00` — keyboard, joysticks, and the IRQ line.**
- `$DC00` port A: keyboard **column** select, and joystick port 2
- `$DC01` port B: keyboard **row** read, and joystick port 1
- `$DC02`/`$DC03` data direction A/B — which way each port's pins face
- `$DC04-$DC07` timer A/B lo-hi; `$DC0E`/`$DC0F` the control registers that start them
- `$DC08-$DC0B` TOD clock; `$DC0C` serial shift register
- `$DC0D` interrupt control/status: bit 0 timer A, bit 1 timer B, bit 2 TOD alarm, bit 3 SP,
  bit 4 FLAG, bit 7 "an IRQ occurred" on read / set-clear on write

**CIA#2 at `$DD00` — VIC bank, serial bus, user port, and the NMI line.**
- `$DD00` port A: bits 0-1 the VIC bank (inverted, see above); bits 3-5 serial bus ATN/CLK/DATA
  out; bits 6-7 serial in
- `$DD01` port B: user port / RS-232
- `$DD04-$DD07`, `$DD0E`/`$DD0F` timers — these drive **NMI**, not IRQ
- `$DD0D` interrupt control, same bit layout as `$DC0D`

What matters for RE:
- **Direct `$DC00`/`$DC01` polling is the norm in games and cracks**, bypassing the KERNAL
  keyboard buffer entirely. This project already proved it the hard way: `vice_keyboard_type`
  is invisible to the crack because the crack reads the matrix directly (recorded in STATE.md).
  The skill must carry that, because it is the difference between working input injection and
  an afternoon lost.
- **A game that never touches `$DC0D` is on a raster IRQ**; one that programs `$DC04-$DC07`
  and enables timer A is running its own timebase. Reading the two enable registers settles
  the question in one call.
- **`$DD00` is dual-purpose and that trips people up** — the same register carries the VIC
  bank *and* the serial bus lines, so a write to it during disk access also moves the VIC's
  view of memory unless the code is careful. Loader code writing `$DD00` is usually talking to
  the drive, not switching banks; check the mask.
- **Hazard, same shape as the VIC collision registers:** reading `$DC0D`/`$DD0D` **clears the
  interrupt flags** on real hardware, so a raw memory read can steal an interrupt the game was
  about to service. Prefer `vice_cia_get_state`; flag the monitor's exact behaviour as
  verify-don't-assume.

### Which tool answers which question

Nothing new needs installing; the gap is that the mapping is not written down.

- `mcp__vice__vice_memory_read` — vector tables, `$01`, `$D011/$D012/$D018/$D019/$D01A`,
  `$DC0D/$DD0D`, `$DD00`. This is the single highest-value first move and it answers most of
  the vector questions in one or two calls.
- `mcp__vice__vice_disassemble` — read the handler at the vector target directly, with the
  emulator's own decoder, instead of hunting in a dead listing.
- `mcp__vice__vice_checkpoint_add` + `vice_run_until` + `vice_registers_get` — the main-loop
  test. A checkpoint on a suspected loop head that fires exactly once per frame proves it.
- `mcp__vice__vice_watch_add` — finds *writers*. Point it at a ZP address or at `$D012` and
  the code that drives the thing shows itself. The three highest-value watch targets found
  above: `$D018` → the screen/room setup routine, VM+`$03F8` → the animation driver, `$D404`
  → the music play routine.
- `mcp__vice__vice_vicii_get_state` / `vice_sid_get_state` / `vice_cia_get_state` — **use
  these in preference to raw reads of the chip registers.** Two reasons: one call returns the
  whole chip instead of a dozen reads, and it avoids the read-clears-it hazard on `$D01E`,
  `$D01F`, `$DC0D` and `$DD0D`.
- `mcp__vice__vice_sprite_get` / `vice_sprite_inspect` — decode sprite data without
  hand-implementing the pointer arithmetic or the multicolor bit-pair unpacking. Verify what
  they return the first time against a hand-resolved pointer, then trust them.
- `mcp__vice__vice_memory_search` — locate a known byte pattern (a sprite, a string, a table)
  once its shape is known from elsewhere.
- `mcp__vice__vice_symbols_load` / `vice_symbols_lookup` — carry ACME `--vicelabels` output
  and regenerator2000 labels back into the debugger, so names survive across sessions.
- `toacme` — fast first-pass listing only; it decodes data as instructions and must not be
  the deliverable.
- regenerator2000 — the traced disassembly with code/data separation and ACME export. Still
  MEDIUM confidence per STACK.md; the first real run is its verification.
- `c64-memory-mapping` skill — the per-address resolver the method calls into. The new skill
  should *delegate* to it rather than restate any of its tables.

Note the standing constraint: `mcp__vice__*` is the only route to the emulator. Any part of
this method that would want a Node process talking to VICE is dead on arrival and must be
expressed as agent-performed tool calls instead — the same rule that reduced `c64-ram-capture`
to a procedure.

### Why a skill, and the bar it has to clear

Two of the three skills that existed on 2026-08-01 were deleted, and their failure modes are
the acceptance criteria here (see [[2026-08-01-investigate-whether-the-surviving-tooling-is-reusable-as-skills]]
for the full derivation):

- `vice-mcp-selector` died for restating a tool surface the agent already holds typed schemas
  for. **This skill must not become a list of what `mcp__vice__*` tools exist.** Its value is
  the *order* and the *decision points* — which read to make first, what each answer rules out.
- `c64-ram-capture`'s scripts died for reaching the emulator as a library. **No executable
  helper that contacts VICE.** Procedure only.
- `devcontainer-host-path` died because the system imported it as a dependency. Not a risk
  here.

A useful shape to aim at: a decision-ordered procedure with a short table of "question →
address to read → what each answer means", which hands off to `c64-memory-mapping` for
per-address detail and to `c64-ram-capture` for image acquisition.

**On size.** An earlier draft of this todo set a ~150-line ceiling. With the VIC-II, SID and
CIA material added that ceiling is wrong, and the honest reading is that the skill has two
halves with different economics:

- **The control-flow half** (entry point → vectors → IRQ source → main loop) is pure decision
  procedure and stays small. The 150-line instinct was right *for this half*.
- **The chip half** (graphics, sound, input) is partly derivation tables — the `$DD00` bank
  map, the ECM/BMM/MCM matrix, the SID voice layout. Those are lookup, and lookup is
  `c64-memory-mapping`'s job.

So the split to aim for is: **derivation tables into `c64-memory-mapping`** if it does not
already carry them, **the order and the hazards into the new skill**. "Read `$DD00` before
anything else or your pointers are wrong", "`$D01E`/`$D01F` clear on read", "CB landing in
`$1000`/`$9000` means ROM characters and there is nothing to extract", "`$D41B` is the RNG,
not audio" — none of that is a table, all of it is judgement, and it is what the reader
actually cannot derive from a register list. Check `c64-memory-mapping` first; every table
the new skill would restate is a sign the content belongs there instead.

### Where the findings already are

The collection step is real work — this is not a greenfield write-up. Sources to mine before
writing anything:

- **`.planning/RE-FINDINGS.md`** — the append-only findings log, created 2026-08-01 and now
  mandated by `.claude/CLAUDE.md` § Reverse-Engineering Findings Log. This is the primary
  input: everything logged there is already a finding someone chose to record. It carries a
  partial seed of the verified emulator-technique and capture findings from STATE.md; the rest
  of the sweep below is still outstanding and is step 1 of this todo.
- `.planning/research/ARCHITECTURE.md`, `PITFALLS.md`, `STACK.md`, `SUMMARY.md`
- `.planning/phases/01-recovery-provenance/01-RESEARCH.md` and `01-PATTERNS.md`
- The three `01-0N-SUMMARY.md` files, plus both `01-04-ATTEMPT-N-HALT.md` records — halts
  document what the method got wrong, which is the most valuable input of the set
- `.claude/CLAUDE.md` § Stack Patterns — the live-execution cross-check rule and the
  provenance-diff second check are already stated there and should be referenced, not copied

## Solution

TBD. Suggested order:

1. **Collect first, write second.** Sweep the sources above and pull every RE-method finding
   into one scratch list, tagged with where it came from. Findings that only exist in a halt
   record are the ones most at risk of being lost.
2. **Separate method from lookup.** Anything that is "what does address X mean" belongs in
   `c64-memory-mapping` (extend it there if a gap shows). Anything that is "what do I do next"
   is the new skill.
3. **Draft the decision procedure**, in the order entry point → vectors → IRQ source → main
   loop → code structure → VIC-II (bank → `$D018` → mode → sprites → colour) → SID → CIA.
   Each step: the read to make, the tool that makes it, what each outcome rules in or out.
   The chip steps come last because they are cheap once the IRQ handler is known — the handler
   is where most chip writes happen.
4. **Audit `c64-memory-mapping` for the derivation tables** before writing them anywhere. If it
   already resolves `$D018`, `$DD00` bit inversion and the SID voice offsets, the new skill
   cites it. If it does not, extend it there — a second copy of a register table is exactly the
   drift this project keeps paying for.
5. **Test it against this project's own game.** Run the procedure cold on the depacked Bruce
   Lee image and see whether it lands on the same answers the phase-01 work already
   established. The chip half has an unusually good test available: the procedure should
   independently rediscover the game's charset, sprite set and screen layout, and those are
   checkable against what the extraction work already produced. A method that does not
   reproduce known-good results is not ready.
6. **Check it against the keep/cut criterion** from the skills-audit todo before committing —
   if the result reads as narration of the tool list, cut it back to the decision points.
7. The general-purpose parts are now the clear majority — nothing in the vector table, the
   main-loop signatures, the VIC-II derivation chain, the SID layout or the CIA split is
   Bruce-Lee-specific. That strengthens the case for shipping this in the RE package
   ([[2026-08-01-pack-the-whole-c64-re-toolkit-including-the-vice-mcp-into-one-package]]),
   whose skills layer this skill is a named candidate for.
