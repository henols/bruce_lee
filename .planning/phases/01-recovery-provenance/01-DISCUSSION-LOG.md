# Phase 1: Recovery & Provenance - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-30
**Phase:** 1-Recovery & Provenance
**Areas discussed:** Canonical image shape, Dump trigger & evidence integrity, Load-event proof method, Ledger shape & canonical pick, Tooling language

**Area selection:** all four offered gray areas were selected.

---

## Canonical image shape

### Q1 — What is `recovery/clean/bruce-lee.bin`, physically?

| Option | Description | Selected |
|--------|-------------|----------|
| Flat 64KB + range manifest | 65536 bytes, offset == address, plus a sidecar manifest declaring real captured RAM vs filler so the "100% provenance coverage" claim stays honest | ✓ |
| Occupied ranges only | One file per captured region plus an index; smaller, but every address lookup in Phase 2/3/4 needs the index | |
| Flat 64KB, no manifest | Simplest artifact, but "100% coverage" would quietly include ROM shadows and never-touched space | |

**User's choice:** Flat 64KB + range manifest (recommended option)

### Q2 — In what form is non-RAM chip state captured?

| Option | Description | Selected |
|--------|-------------|----------|
| Machine-readable sidecar JSON | Raw register reads plus derived facts ($DD00 VIC bank, $D018, sprite pointers, $01); Phase 3's checkpoint design can consume it directly | ✓ |
| Prose table in NOTES.md | Human-readable next to the procedure narrative, but nothing downstream can consume it without retyping | |
| Rely on the .vsf snapshot | Nothing to maintain, but state locked in an opaque, version-coupled binary that can't be reviewed in a diff | |

**User's choice:** Machine-readable sidecar JSON (recommended option)

### Q3 — With offset == address, what bytes go at $A000-$BFFF, $D000-$DFFF, $E000-$FFFF?

| Option | Description | Selected |
|--------|-------------|----------|
| Underlying RAM everywhere | Image is pure RAM by definition for all 65536 bytes; IO register values live in state.json. Direct antidote to Pitfall 5 | ✓ |
| CPU's-eye view at dump time | Faithful to what the program saw, but bakes ROM bytes into the disassembly base — the Pitfall 5 failure mode itself | |
| RAM under ROM, hole at $D000-$DFFF | Smaller claim to defend, but presumes the game stashes nothing under IO — an unearned assumption | |

**User's choice:** Underlying RAM everywhere (recommended option)

### Q4 — Do crack-loader and cracktro bytes stay in the canonical image?

| Option | Description | Selected |
|--------|-------------|----------|
| Keep verbatim, mark in manifest | Never edited (it is evidence); manifest range kinds let Phase 2 report coverage against a game-logic denominator | ✓ |
| Zero out loader and cracktro | Cleaner coverage arithmetic, but edits the evidence and discards the bytes RECOVER-06/07 need for attribution | |
| Keep verbatim, no marking | One less file to sync, but coverage tooling would have to parse prose markdown | |

**User's choice:** Keep verbatim, mark in manifest (recommended option)

**Notes:** Area closed after four questions. Follow-ups the user chose not to pursue: the manifest's exact range vocabulary, the filler byte for genuinely uncaptured space, and whether the manifest is generated or hand-authored.

---

## Dump trigger & evidence integrity

### Q1 — What is the "loader is done, dump now" signal? (Criterion 1 forbids a timeout.)

| Option | Description | Selected |
|--------|-------------|----------|
| PC-reached checkpoint on game entry | Locate entry empirically, record the address, checkpoint_add + run_until. Deterministic regardless of host speed | ✓ |
| Write-watchpoint on last decrunched byte | Mechanically clean, but stops mid-decruncher rather than at a stable game state — the "too early" half of Pitfall 5 | |
| Loader-code-exhausted watchpoint | No entry-point hunt needed, but "stopped being hit" is a duration judgement in disguise | |

**User's choice:** PC-reached checkpoint on game entry (recommended option)

### Q2 — What gets committed as the record of that moment?

| Option | Description | Selected |
|--------|-------------|----------|
| Both, with explicit roles | .bin is the canonical byte artifact and sole diff target; a versioned .vsf is committed as the reusable deterministic start state for Phases 2–3 | ✓ |
| Byte dump only | Smallest footprint, no snapshot-format coupling — but every later phase re-runs the loader and Phase 3 loses its cheapest byte-identical start state | |
| Snapshot only | Single source of truth for RAM and chip state, but the canonical image depends on an opaque version-coupled binary | |

**User's choice:** Both, with explicit roles (recommended option)

### Q3 — Policy for reaching RAM under ROM/IO, given a $01 write mutates the subject?

| Option | Description | Selected |
|--------|-------------|----------|
| Non-invasive first, guarded fallback | Bank-scoped reads preferred; $01 write only after .vsf saved, only on a discarded session, recorded verbatim | ✓ |
| Non-invasive only, hard stop | Maximum integrity, but risks stalling the phase's first plan on a tooling question with no agreed way forward | |
| Perturbation allowed, just record it | Always works, but the image is then of a program whose memory configuration we changed — permanent doubt | |

**User's choice:** Non-invasive first, guarded fallback (recommended option)

### Q4 — How is byte-identical reproducibility demonstrated rather than asserted?

| Option | Description | Selected |
|--------|-------------|----------|
| Capture twice from cold reset, commit both hashes | Two full procedure runs from scripted machine_reset; both SHA-256s committed. Divergence becomes a recorded VERIFY-02 finding, not a papered-over gap | ✓ |
| Capture twice across separate sessions | Also proves the reset ritual clears prior state, but costs more emulator time and conflates two failure causes | |
| Capture once; determinism implied | Fastest, but leaves the phase's headline claim untested; uninitialised-RAM differences would slip through | |

**User's choice:** Capture twice from cold reset, commit both hashes (recommended option)

**Notes:** Area closed after four questions. Follow-ups not pursued: the reset/clear-checkpoints ritual's exact steps, how the entry point gets located per image, and whether saeger (uncrunched) needs a differently-shaped trigger.

---

## Load-event proof method

### Q1 — How do we prove nothing loads on demand after the dump point?

| Option | Description | Selected |
|--------|-------------|----------|
| Mechanical watch as primary, play as the driver | Exec-checkpoints over the loader plus write-watches on drive/IEC and never-populated ranges; absence of hits is the positive evidence criterion 2 asks for | ✓ |
| Exhaustive 20-chamber play-through | Highest confidence, but a large fragile scripted-input effort on the phase's critical path, and still only covers walked paths | |
| Memory-diff sweep after free play | Simple, but gameplay churn and self-modifying code swamp the diff — can't distinguish a game write from a loader write | |

**User's choice:** Mechanical watch as primary, play as the driver (recommended option)

### Q2 — How much play does Phase 1 need, given Phase 2's MAP-01 exhaustive trace?

| Option | Description | Selected |
|--------|-------------|----------|
| Bounded play now, watch stays armed into Phase 2 | Real transitions, both opponents, death, game over, restart; same watch set rides Phase 2's all-20 trace so the game isn't played to completion twice | ✓ |
| Warp to all 20 chambers by memory poke | Cheap breadth, but poking the chamber index can bypass the transition routine where a load call would live | |
| Full honest 20-chamber play-through in Phase 1 | Strongest early claim, but duplicates Phase 2's mandatory work on the phase the roadmap calls most expensive to be wrong | |

**User's choice:** Bounded play now, watch stays armed into Phase 2 (recommended option)

### Q3 — How is the play-through driven, given VERIFY-01 owns the script format?

| Option | Description | Selected |
|--------|-------------|----------|
| Ad-hoc frame-synced input, sequence recorded as a seed | joystick_tap/set on checkpoint and frame sync, never sleeps; sequence recorded in LOADING.md as notes, not as a verify/scripts/ artifact | ✓ |
| Design the input-script format now | Phase 3 inherits working plumbing, but moves a Phase 3 requirement forward and locks the format before the determinism work that should inform it | |
| Interactive driving, outcome only | Cheapest, but leaves no reusable trace, so a challenge to the "zero load events" claim can't be re-examined | |

**User's choice:** Ad-hoc frame-synced input, sequence recorded as a seed (recommended option)

### Q4 — Contingency: if a load event IS found, what happens to the canonical image?

| Option | Description | Selected |
|--------|-------------|----------|
| Canonical stays a real single moment; composite is derived | .bin never synthesized; a composite, if needed, is a clearly-labelled derived artifact with per-byte origin | |
| Canonical becomes a merged union | Simplest downstream, but depicts a memory state that never existed, undermining criterion 1's reproducibility claim | |
| Decide it if and when it happens | Avoids designing for a case that may not exist, but leaves plan 01-04 without a rule at the moment it would need one | ✓ |

**User's choice:** Decide it if and when it happens — **not** the recommended option

**Notes:** The user overrode the recommendation here, deliberately deferring rather than pre-committing a merge rule. Both disks appear to load everything up front, so the case may never arise. CONTEXT.md records the deferral with a constraint attached: it must be resolved before Phase 4 treats the image as its round-trip diff target, and it is a checkpoint decision for plan 01-04 rather than an executor judgement call.

Area closed after four questions. Follow-ups not pursued: the specific registers/ranges the watches cover, and a concrete floor for "bounded play" that plan 01-04 could not under-deliver against.

---

## Ledger shape & canonical pick

### Q1 — What ledger granularity keeps PROVENANCE.md complete and readable?

| Option | Description | Selected |
|--------|-------------|----------|
| Coalesced ranges, machine-generated + prose tier | Tool emits ranges with a stated gap tolerance; prose tier above explains the interesting ones. Regenerable when the diff improves | ✓ |
| Per-byte rows for every difference | Maximum precision, but a relocated loader produces thousands of rows that bury the single-byte patches RECOVER-06 exists to surface | |
| Hand-authored ranges only | Most readable for least tooling, but can't demonstrate 100% coverage mechanically — ARCHITECTURE.md Anti-Pattern 2 | |

**User's choice:** Coalesced ranges, machine-generated + prose tier (recommended option)

### Q2 — What evidence counts for the crack-independence verdict?

| Option | Description | Selected |
|--------|-------------|----------|
| In-image first, external as a separate weaker tier | Binary artifacts are Tier 1; scene release records admissible as Tier 2 but can never outrank Tier 1. Every claim names its tier | ✓ |
| In-image evidence only | Immune to a wrong scene attribution, but if the images carry no lineage signal the verdict is forced to INCONCLUSIVE with no route to improve | |
| External and internal weighted equally | Most likely to reach a confident verdict, but a bad second-hand record could silently raise confidence across the whole ledger | |

**User's choice:** In-image first, external as a separate weaker tier (recommended option)

### Q3 — Which recovered image becomes canonical, and on what rule?

| Option | Description | Selected |
|--------|-------------|----------|
| Least contaminated wins, measured | Smaller CRACKER-PATCH footprint in game-logic ranges wins, counts recorded as the reason; makes criterion 5's "why" a number | ✓ |
| Prefer saeger (uncrunched) | Decidable up front, one less recovery stage to have gone wrong — but commits before relative contamination is known | |
| Prefer danish (flatter layout) | ARCHITECTURE.md's lean, but conditional on a property unconfirmable until after recovery, and equally blind to contamination | |

**User's choice:** Least contaminated wins, measured (recommended option)

### Q4 — How is the diff made relocation-aware for RECOVER-05?

| Option | Description | Selected |
|--------|-------------|----------|
| Anchor-proven offset, then raw byte diff | Derive the offset from distinctive byte runs and prove it (expected zero); per-region offsets recorded if deltas disagree. Yields the byte ranges the ledger needs | ✓ |
| Symbolic instruction-stream diff | Relocation-immune by construction, but pre-empts or depends on Phase 2's disassembler choice and yields instruction-level rather than byte-range output | |
| Offset diff plus symbolic spot-check | Catches relocation artifacts masquerading as patches, at the cost of extra round-trips on the shared VICE instance | |

**User's choice:** Anchor-proven offset, then raw byte diff (recommended option)

**Notes:** `vice_disassemble` remains available for ad-hoc spot-checks without a toolchain decision, noted in CONTEXT.md as a deferred cross-check rather than part of the primary method.

---

## Tooling language

Raised by Claude, not offered as a selectable area — a live conflict between two committed research documents (`ARCHITECTURE.md` specifies `tools/*.mjs`; `STACK.md` recommends Python) that plans 01-01 and 01-05 would both trip over.

| Option | Description | Selected |
|--------|-------------|----------|
| Node for Phase 1; revisit Python at Phase 4 | Everything Phase 1 needs is trivial in Node with zero install and matches all three existing skills; Python's advantages arrive with Phase 4's PNG work | ✓ |
| Python now, for the whole project | Gets the d64 library and pytest, but adds an install and a second language for capabilities nothing in Phase 1 uses | |
| Split by role, now | Each job gets the better ecosystem, but commits to two toolchains before either is proven necessary | |

**User's choice:** Node for Phase 1; revisit Python at Phase 4 (recommended option)

**Notes:** Recorded in CONTEXT.md as D-18, explicitly framed as a phase-scoped resolution rather than a project-wide overturning of STACK.md.

---

## Claude's Discretion

Not put to the user, because each is empirical or mechanical rather than a preference:

- **VICE bootstrap method** — the roadmap's headline Phase 1 decision (MCP attach/boot tool vs `snapshot_load` from a pre-captured `.vsf`). Answered by probing the tool surface in plan 01-01. Flagged to the user explicitly so its absence from the discussion wasn't mistaken for an oversight.
- Whether bank-scoped reads can actually reach RAM under ROM/IO — determines whether D-08's fallback is ever exercised.
- The shared-VICE reset/clear-checkpoints/reload ritual's concrete steps, and the exact register and range set the load watches cover.
- How the game entry point is located per image, and whether `saeger` needs a differently-shaped trigger than `danish`.
- `NOTES.md` structure beyond the three items criterion 1 mandates.
- Where the three-bucket partition boundaries (loader / cracktro / game logic) fall.

## Deferred Ideas

- **Load-event merge rule** — deferred by explicit user choice (see Load-event proof Q4). Constraint recorded: resolve before Phase 4 depends on the image as its round-trip diff target.
- **Python toolchain** (`pip`/`venv`, `d64`, Pillow, pytest) — deferred to Phase 4, where PNG rendering first justifies a second language.
- **Reusable input-script format** — belongs to VERIFY-01 in Phase 3; Phase 1 leaves a working example, not a half-specification.
- **Symbolic / instruction-stream diffing** as a provenance cross-check — needs Phase 2's disassembler decision; `vice_disassemble` covers ad-hoc spot-checks meanwhile.
- **Composite complete-coverage image** — only if the load-event contingency fires, and only as a clearly-labelled derived artifact.

No scope creep arose during the discussion — every area stayed inside the phase boundary.
