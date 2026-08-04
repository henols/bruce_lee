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

> **STATUS 2026-08-04 (quick task 260804-bjq) — the skill exists; this todo stays open for one
> reason.** `.claude/skills/c64-program-recon/` is written, registered and committed (`bd597e8`):
> `SKILL.md` as the index, five `references/` files, `scripts/derive.mjs`, and a memory-map
> template. Steps 1-4, 6 and 7 are discharged. All three of its shown commands were re-run at
> finalisation and reproduce their documented output; the frontmatter checker passes on all six
> skills; `derive.mjs` imports `node:fs` alone and opens no socket, so the `mcp__vice__*`
> single-route rule holds.
>
> **Step 5 is half done, and the outstanding half is the one with the good test available.**
> - **Control-flow half: DONE, promoted to HIGH** (`9ce0d11`). The procedure run cold on
>   `recovery/danish/dumps/danish-gameentry-run1.bin` *and* the saeger capture returns
>   `$01 = $40` (HIRAM 0) and `$FFFE/$FFFF = $1103` — the same IRQ entry phase-01 live work
>   established independently, from a static image with no emulator. Re-verified 2026-08-04.
> - **Chip half: NOT DONE, stays MEDIUM.** The procedure has not been made to independently
>   rediscover this game's charset, sprite set and screen layout and checked against what the
>   extraction work already produced. `derive.mjs vic` and `derive.mjs sprites` were exercised
>   only on *hand-supplied* register values (including the char-ROM-shadow path, which does flag
>   correctly) — never on registers read out of a real Bruce Lee capture through
>   `mcp__vice__vice_vicii_get_state`. Until that happens this todo's own bar is unmet: **"a
>   method that does not reproduce known-good results is not ready."**
>
> So the remaining work is narrow and well-specified: read the VIC registers at a gameentry
> checkpoint, feed them to `derive.mjs vic`/`sprites`, and diff the derived charset/sprite/screen
> addresses against the extraction work's. If they agree, re-log the chip-half entries at HIGH as
> new entries. That needs the emulator, which is why it did not ride along with the authoring.

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

## Resolution 2026-08-04 (quick task 260804-elq) — the skill was built, incrementally, and is not one skill

**Do not build a single RE skill. It already exists as four, and this todo predates all of them.**

When this was written on 2026-08-01, `.claude/skills/` held the survivors of a cleanup and nothing
that covered RE method. Since then `c64-program-recon` (2026-08-04, `bd597e8`), `c64-ram-capture`'s
rewrite, `c64-memory-mapping`, and `c64-provenance-diff` (2026-08-04, `b43d409`) have absorbed most
of this log's technique content — each one built from these findings, each verified live.

### Where the log's ten sections actually live

Measured 2026-08-04 against a 2788-line, 117-entry log:

| Section | Lines | Home |
|---|---|---|
| Control-flow discovery method | 107 | `c64-program-recon` → `references/control-flow.md` |
| VIC-II discovery | 140 | `c64-program-recon` → `references/graphics.md` |
| SID discovery | 58 | `c64-program-recon` → `references/sound-and-input.md` |
| CIA discovery | 71 | same |
| Emulator technique | 55 | mostly `c64-program-recon` → `references/observation-hazards.md` |
| Capture and comparison | 148 | `c64-ram-capture` |
| Tooling findings (`tools/`) | 212 | `c64-ram-capture` + `c64-provenance-diff` |
| Tool-to-question mapping | 400 | **one** entry → `c64-program-recon/references/tool-selection.md` (added by this task); the rest is not tool-mapping at all — see below |
| Manual and printed-documentation | 1151 | **not skill material** — routed to the two `docs` todos |
| Corrections to earlier entries | 465 | **stays in the log, permanently** |

### Two section titles are misleading, which is why this looked bigger than it is

Both large sections are **dated dumping grounds**, not topics — content was appended
chronologically under whatever heading was current.

- `## Tool-to-question mapping` (400 lines): only its **first** entry is a tool-to-question
  mapping. The rest is silent-stall incidents, broker grant-poll and `VICE_BROKER_MAX` defects,
  boot-time measurements, a saeger chamber-1 `FALLS` counter, and three diff hazards — and those
  three (the kind-boundary bug, the `$4771-$4779` `DATASOFT`/`DIABOLO` text divergence, the
  cracktro-vocabulary fix) were folded into `c64-provenance-diff` on 2026-08-04.
- `## Manual and printed-documentation findings` (1151 lines): mixes genuine game-domain fact
  (scoring, damage, lives, game modes, `POKE 5472` → the lives-counter address) with entirely
  unrelated engineering findings logged the same day (`python3-minimal`'s partial stdlib, a TDZ
  crash, `npm ci` in fresh worktrees, an async `finally` ordering bug).

### What this task did

1. Added `c64-program-recon/references/tool-selection.md` — the one genuinely skill-shaped orphan,
   the question→call table, with its `Confidence: MEDIUM` (doc-derived) carried over rather than
   silently upgraded. Registered in that skill's References table.
2. Routed the manual-derived game facts to
   [[2026-08-03-register-the-primary-source-documents-manuals-and-writeups]] and
   [[2026-08-03-pin-canonical-character-names-bruce-lee-yamo-and-the-ninja]], with the three
   cautions the log records (the transcription is the **Apple II** manual; the two-player question
   is already RESOLVED; a naive HTML-to-text extraction corrupted a table).
3. Left `## Corrections to earlier entries` untouched. Curating it into a skill would destroy the
   thing CLAUDE.md says the log exists for — the record of *when* something stopped being a guess.
   Promotion happens by re-logging with new evidence, never by editing a grade in place.

### Still open

- **The misfiled engineering findings.** Toolchain and GSD lessons sitting under a manual heading.
  Not skill material and not RE method; they need either a home or an explicit decision to leave
  them where they are. Re-topicalizing the log was considered and **rejected for now** as touching
  the project's most carefully-guarded append-only file for organisational benefit alone.
- **`## Manual and printed-documentation findings` keeps growing** under a title that does not
  describe it. Worth renaming or splitting the *next* time something is appended there.

**Evidence:** section line counts and entry counts measured directly with `awk`/`grep` over
`.planning/RE-FINDINGS.md` on 2026-08-04; each mapping checked against the target skill's actual
files rather than assumed.
**Confidence:** HIGH for what is already homed. The two "still open" items are judgement calls
deliberately left to a human.
