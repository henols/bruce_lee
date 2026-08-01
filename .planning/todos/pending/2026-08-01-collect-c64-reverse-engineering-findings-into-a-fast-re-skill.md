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
- Graphics data discovery: `$D018` (screen/charset base) plus `$DD00` bits 0-1 (VIC bank)
  resolve every graphics pointer to an absolute address. Sprite pointers sit at screen base
  `+$03F8`.
- Code/data separation: the project's own standing rule already says a range never hit as an
  instruction stream across full gameplay coverage is data regardless of what the tracer
  guessed. That rule belongs in the skill, not just in CLAUDE.md.

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
  the code that drives the thing shows itself.
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
per-address detail and to `c64-ram-capture` for image acquisition. If it grows past ~150 lines
it has probably started narrating instead of deciding.

### Where the findings already are

The collection step is real work — this is not a greenfield write-up. Sources to mine before
writing anything:

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
   loop → structure. Each step: the read to make, the tool that makes it, what each outcome
   rules in or out.
4. **Test it against this project's own game.** Run the procedure cold on the depacked Bruce
   Lee image and see whether it lands on the same answers the phase-01 work already
   established. A method that does not reproduce known-good results is not ready.
5. **Check it against the keep/cut criterion** from the skills-audit todo before committing —
   if the result reads as narration of the tool list, cut it back to the decision points.
6. Consider whether the general-purpose parts (nothing Bruce-Lee-specific in the vector table
   or the main-loop signatures) make this a candidate for the same
   extract-as-a-package question as [[2026-08-01-extract-the-vice-mcp-into-an-installable-package]].
