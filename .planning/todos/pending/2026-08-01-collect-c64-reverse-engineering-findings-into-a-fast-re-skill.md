---
created: 2026-08-01T19:46:08.128Z
title: Collect C64 reverse-engineering findings into a fast RE skill
area: tooling
severity: minor
files:
  - .claude/skills/c64-memory-mapping/SKILL.md
  - .claude/skills/c64-ram-capture/SKILL.md
  - .claude/skills/acme-build/SKILL.md
  - .planning/RE-FINDINGS.md
  - .planning/notes/re-findings-sweep-design.md
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

### The method itself now lives in the findings log, not here

**Migrated 2026-08-01.** The full write-up — control flow (entry point → vectors → IRQ source →
main loop → structure), the VIC-II discovery chain (bank → `$D018` → mode → sprites → colour),
the SID player/RNG/digi idioms, the CIA#1-vs-#2 split, and the tool-to-question mapping — is in
`.planning/RE-FINDINGS.md` under these sections:

- **Control-flow discovery method**
- **VIC-II discovery — charsets, screens, bitmaps, sprites**
- **SID discovery — the music player, sound effects, and the RNG**
- **CIA 6526 discovery — input, timing, banking, serial**
- **Tool-to-question mapping**

Every migrated entry is graded **MEDIUM**: doc-derived, correct as far as published sources go,
not yet exercised against this project's own depacked image.

It moved because keeping it here was a live contradiction with the project's own rule.
`.claude/CLAUDE.md` § Reverse-Engineering Findings Log says *"Append-only, and never in a todo.
Todos move to `completed/` when their work is done; the log has to outlive every one of them."*
Completing this todo would have archived the single largest block of method knowledge in the
project — the exact failure mode that rule exists to prevent, sitting inside the todo that
prompted the rule. The log holds the method now; this todo points at it.

Full rationale, and the sweep design that follows from it, in
`.planning/notes/re-findings-sweep-design.md`.

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
CIA material in scope that ceiling is wrong, and the honest reading is that the skill has two
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

The collection step is real work — this is not a greenfield write-up. Sources to mine, with
their expected confidence skew:

| Source | Size | Expected grade |
|---|---|---|
| `.planning/RE-FINDINGS.md` | — | already logged; the merge target, not a source |
| `01-RESEARCH.md` | 156 KB | mostly MEDIUM, doc-sourced |
| `01-04-ATTEMPT-2-HALT.md` | 27 KB | HIGH, live, negative |
| `01-04-ATTEMPT-1-HALT.md` | 12 KB | HIGH, live, negative |
| three `01-0N-SUMMARY.md` | 45 KB | HIGH/MEDIUM mixed |
| `01-PATTERNS.md` | 17 KB | LOW/MEDIUM, inferred |
| `.planning/research/` — `ARCHITECTURE.md`, `PITFALLS.md`, `STACK.md`, `SUMMARY.md` | ~60 KB | MEDIUM, doc-sourced |

The two HALT records are the priority: they document what the method got *wrong*, which is the
most valuable input of the set and the thing a register list can never supply.

`.claude/CLAUDE.md` § Stack Patterns already states the live-execution cross-check rule and the
provenance-diff second check — reference them, do not copy them.

## Solution

Order settled by exploration on 2026-08-01; rationale in
`.planning/notes/re-findings-sweep-design.md`.

0. ~~**Make the log self-sufficient.**~~ **Done 2026-08-01.** `Confidence:` added as a required
   field distinct from `Evidence:`, on STACK.md's HIGH/MEDIUM/LOW scale; the control-flow and
   chip method migrated out of this todo into `.planning/RE-FINDINGS.md`; `.claude/CLAUDE.md`
   § Reverse-Engineering Findings Log updated to match. This had to land *before* the sweep so
   that parallel readers append to a log that already holds the method.

1. **Sweep the sources — parallel readers, single merging author.** One subagent per document
   from the table above, each returning entries already in the log's format with
   `Type` / `Evidence` / `Confidence` / `Saves` filled. The orchestrator merges and writes;
   an append-only file does not get ten concurrent writers.

   - **Filter: everything, graded.** Not live-only. Doc-derived method enters at MEDIUM — an
     unrun method with addresses attached is a hypothesis the next session can test in minutes.
   - **Duplicates merge, keeping every provenance line.** The "do not deduplicate" rule is
     against *suppressing* a finding, not a mandate to scatter one fact across the file.
   - Run this in its own session with clean context. The merge is the expensive part.

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
   drift this project keeps paying for. The tables now sitting in RE-FINDINGS.md are a holding
   pen, not a decision about where they finally live.

5. **Test it against this project's own game, and promote the grades.** Run the procedure cold
   on `recovery/danish/dumps/danish-gameentry-run1.bin` — three verified gameentry captures are
   already on disk — and see whether it lands on the same answers the phase-01 work established.
   The chip half has an unusually good test available: the procedure should independently
   rediscover the game's charset, sprite set and screen layout, checkable against what the
   extraction work already produced. **A method that does not reproduce known-good results is
   not ready.** Every MEDIUM entry this confirms gets re-logged at HIGH with the live evidence —
   promotion is by new entry, never by editing a grade in place.

6. **Check it against the keep/cut criterion** from the skills-audit todo before committing —
   if the result reads as narration of the tool list, cut it back to the decision points.

7. The general-purpose parts are the clear majority — nothing in the vector table, the
   main-loop signatures, the VIC-II derivation chain, the SID layout or the CIA split is
   Bruce-Lee-specific. That strengthens the case for shipping this in the RE package
   ([[2026-08-01-pack-the-whole-c64-re-toolkit-including-the-vice-mcp-into-one-package]]),
   whose skills layer this skill is a named candidate for.
