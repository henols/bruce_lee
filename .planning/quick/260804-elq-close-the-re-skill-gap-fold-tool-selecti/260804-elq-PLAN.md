---
quick_id: 260804-elq
description: "Close the RE-skill gap: fold tool-selection into c64-program-recon, route game facts to the docs todos"
date: 2026-08-04
status: planned
execution_note: |
  Executed inline (no subagents — session directives prohibit spawning them
  unless the user asks). The scope analysis below was done and presented to the
  user for a decision BEFORE any file was changed; they chose "close the gap,
  don't build a new skill".
---

# Close the RE-skill gap without building a new skill

Item 4 of the four-item skill queue, rescoped after analysis.

## The finding that rescoped it

The todo asks for "a fast RE skill" built from `.planning/RE-FINDINGS.md`. Measured
2026-08-04, that log is **2788 lines, 117 entries, 10 sections**. Mapping each
section against the skills that now exist shows the skill was **already built,
incrementally, as four skills** — the todo predates all of them.

| Section | Lines | Home |
|---|---|---|
| Control-flow discovery | 107 | `c64-program-recon` → `references/control-flow.md` |
| VIC-II discovery | 140 | `c64-program-recon` → `references/graphics.md` |
| SID + CIA discovery | 129 | `c64-program-recon` → `references/sound-and-input.md` |
| Emulator technique | 55 | `c64-program-recon` → `references/observation-hazards.md` |
| Capture and comparison | 148 | `c64-ram-capture` |
| Tooling findings | 212 | `c64-ram-capture` + `c64-provenance-diff` |
| Tool-to-question mapping | 400 | **one** entry is unhomed; the rest is misfiled |
| Manual and printed-documentation | 1151 | not skill material — belongs to two `docs` todos |
| Corrections to earlier entries | 465 | stays in the log, permanently |

**Two section titles are misleading, which is why the job looked bigger than it is.**
Both large sections are dated dumping grounds rather than topics:

- `## Tool-to-question mapping`: only its *first* entry maps tools to questions. The
  rest is silent-stall incidents, broker `VICE_BROKER_MAX` defects, boot-time
  measurements, a saeger chamber-1 `FALLS` counter, and three diff hazards — and
  those three were folded into `c64-provenance-diff` earlier today (`b43d409`).
- `## Manual and printed-documentation findings`: genuine game-domain fact
  (scoring, damage, lives, game modes, `POKE 5472` → the lives-counter address)
  interleaved with unrelated engineering findings logged the same day
  (`python3-minimal`'s partial stdlib, a TDZ crash, `npm ci`, an async `finally`
  ordering bug).

So the actual gap is **one entry**, not 400 lines.

## Tasks

### Task 1 — Home the one skill-shaped orphan

- **files**: `.claude/skills/c64-program-recon/references/tool-selection.md` (new),
  `.claude/skills/c64-program-recon/SKILL.md`
- **action**: Curate the question→call table into a reference file, in that skill's
  established `references/` pattern. Carry its `Confidence: MEDIUM` (doc-derived)
  across unchanged — **do not silently upgrade a grade**. Add the delegation rows
  (`c64-memory-mapping` for addresses, `c64-provenance-diff` for provenance) and the
  two live traps (`vice_diagnose` leaves the machine paused; `checkpoint_trap` must
  not be recycled). Register it in the References table.
- **verify**: No existing reference already carries a consolidated tool table —
  checked; `graphics.md` has watch targets and `observation-hazards.md` has read
  hazards, neither maps question→call.
- **done**: The file exists and is listed in the skill.

### Task 2 — Route game-domain facts to their real owners

- **files**: `.planning/todos/pending/2026-08-03-register-the-primary-source-documents-manuals-and-writeups.md`,
  `.planning/todos/pending/2026-08-03-pin-canonical-character-names-bruce-lee-yamo-and-the-ninja.md`
- **action**: List what is already extracted so neither todo re-reads the PDFs, and
  carry the three cautions the log records: the widely-linked transcription is the
  **Apple II** manual not the C64 one; the two-player disagreement is already
  **RESOLVED** (three game modes); a naive HTML-to-text extraction silently
  corrupted a value/label table. Note that the ninja is **unnamed** in that edition,
  which bears directly on the naming todo.
- **done**: Both carry pointers; neither will re-derive.

### Task 3 — Record the resolution on the RE-skill todo

- **files**: `.planning/todos/pending/2026-08-01-collect-c64-reverse-engineering-findings-into-a-fast-re-skill.md`
- **action**: Record the section-by-section mapping, why it is four skills and not
  one, what this task did, and the two items deliberately left open.
- **done**: A reader knows not to build a fifth skill.

## must_haves

- **truths**: no grade is upgraded in place; `## Corrections` is untouched; nothing
  claims the log was reorganised.
- **artifacts**: one new reference file, one References row, one cross-skill row,
  three todos updated.
- **key_links**: `.planning/RE-FINDINGS.md`, the four `c64-*` skills.

## Out of scope

- **Re-topicalizing the log.** Considered and rejected: it means editing the
  project's most carefully-guarded append-only file for organisational benefit
  alone. Recorded as still-open instead.
- Building a fifth skill. It would mostly point at the other four — the narration
  failure that got a previous skill deleted.
