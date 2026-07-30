# Architecture Research: Bruce Lee Reverse Engineering & ACME Reconstruction

**Domain:** 8-bit (C64) game reverse-engineering / disassembly reconstruction project
**Researched:** 2026-07-30
**Confidence:** HIGH for ACME mechanics and MCP-surface constraints (verified against installed ACME 0.97 docs and project files) · MEDIUM for verification-harness tool specifics (some named MCP tools not directly inspectable) · MEDIUM for d64-packaging tooling (flagged as open, per PROJECT.md)

## Standard Architecture

### System Overview

This is not a request/response system — it is a **pipeline with a feedback loop**. Bytes flow one direction (disk → understanding → source → artifact); a verification signal flows back to gate every claim. Two independent input images (`danish.d64`, `saeger.d64`) merge into one provenance-tagged truth, which forks into two parallel outputs (prose docs, ACME source) that must stay mutually consistent, and reconverges at the verification harness, which is the only component allowed to declare success.

```
┌───────────────────────────────────────────────────────────────────────────┐
│  INPUT (read-only, as received)                                           │
│  disks/danish.d64  (TCS-CRUNCH!, packed)   disks/saeger.d64  (SSG)        │
└───────────────────────────┬───────────────────────────┬───────────────────┘
                             │  run+break+dump (VICE)    │
                             ▼                           ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  RECOVERY  — recovery/danish/  recovery/saeger/  recovery/clean/          │
│  Live-memory dump per image → one canonical clean memory image           │
└───────────────────────────┬───────────────────────────┬───────────────────┘
                             │                           │
                             ▼                           ▼
              ┌───────────────────────────┐   ┌───────────────────────────┐
              │  PROVENANCE               │   │  BASELINE CAPTURE         │
              │  diff danish vs saeger →  │   │  original + harness →     │
              │  recovery/PROVENANCE.md   │   │  verify/baselines/        │
              │  (byte-range ledger)      │   │  (independent of src/!)   │
              └─────────────┬─────────────┘   └─────────────┬─────────────┘
                             ▼                               │
┌───────────────────────────────────────────────────────────┐│
│  DISASSEMBLY & ANNOTATION  (recovery/clean/ + PROVENANCE) ││
│  every reachable routine labeled, hazards catalogued       ││
└───────────────┬───────────────────────────┬────────────────┘│
                 │                           │                 │
                 ▼                           ▼                 │
   ┌─────────────────────────┐   ┌─────────────────────────┐  │
   │  DOCS  (docs/)          │   │  SOURCE  (src/)          │  │
   │  memory-map, systems,   │◄─►│  ACME .a files + data/   │  │
   │  formats — cite src/    │   │  *.bin verbatim blobs    │  │
   │  labels, not raw addrs  │   │  cite docs/ for "why"    │  │
   └─────────────────────────┘   └────────────┬─────────────┘  │
                                                │ acme build     │
                                                ▼                │
                                   ┌─────────────────────────┐  │
                                   │  BUILD  (build/)        │  │
                                   │  .prg .sym .vs .rep     │  │
                                   │  → .d64                 │  │
                                   └────────────┬─────────────┘  │
                                                │                │
                                                ▼                ▼
                                   ┌───────────────────────────────┐
                                   │  VERIFICATION HARNESS (verify/)│
                                   │  replay scripts + checkpoints  │
                                   │  vs baselines → divergence     │
                                   │  report (frame, region, value) │
                                   └───────────────────────────────┘
```

The one non-obvious edge in this diagram: **baseline capture only needs `recovery/clean/` and the harness itself — it does not need `src/` or a rebuilt `.prg` at all.** That makes it a day-one, fully parallel stream (see Dependency Graph below), not something that waits at the end of the pipeline.

### Component Responsibilities

| Component | Owns | Talks to |
|-----------|------|----------|
| `disks/` | The two cracked images, byte-for-byte as received. Read-only forever — this is the evidence, never edited. | `recovery/` (read source) |
| `recovery/` | Depacking/loader-defeat process and its output: raw dumps per image, plus one canonical `clean/` memory image chosen as the disassembly base. | `disks/` (input), VICE MCP (dump), `docs/provenance.md` (output), disassembly (consumer) |
| Provenance ledger (`recovery/PROVENANCE.md`) | Byte-range verdicts: ORIGINAL / CRACKER-PATCH / UNKNOWN, with evidence and confidence, derived from diffing both recovered images. | Both recovered images (input), `src/` inline tags (consumer), `docs/` (consumer) |
| Disassembly & annotation (working notes, feeds both docs/ and src/) | Identifying every reachable routine/variable and, critically, cataloguing **restructuring hazards** (self-modifying code, raw-data jump tables, fall-through pairs, page-alignment requirements) before anyone splits files. | `recovery/clean/` (input), `c64-memory-mapping` skill (address resolution), `docs/` + `src/` (outputs) |
| `docs/` | Prose subsystem explanations, data-format specs, the memory map. Explains *why*; cites `src/` labels for *where*. | `src/` (cites labels/addresses), `recovery/PROVENANCE.md` (confidence/provenance), generated `.sym`/`.vs` (memory-map source of truth) |
| `src/` (ACME source) | The buildable, restructured-for-readability reconstruction. Functionally identical, not byte-identical. Owns the segment map, zero-page allocation, and per-subsystem files. | `data/*.bin` (via `!bin`), `docs/` (cites for rationale), ACME toolchain (consumer) |
| `data/` | Verbatim byte tables (levels, sprites, charset, animation, music) as extracted, unmodified blobs — the seam v2's converters will target. | `src/` (`!bin` includes it), `assets/` (read-only rendering of it) |
| `assets/` | Human-inspectable, read-only-in-v1 renderings (PNG/JSON) of `data/*.bin`, plus the byte-offset provenance of each. | `data/` (source of truth, one-directional in v1) |
| `build/` | Generated artifacts only: `.prg`, `.d64`, `.sym`, `.vs`, `.rep`. Never hand-edited; safe to blow away. | ACME (producer), `verify/` (consumer), VICE MCP `symbols_load` (consumer of `.vs`) |
| `verify/` | The verification harness: input scripts, checkpoint definitions, recorded baselines, the runner/orchestrator, divergence reports. First-class component, not a script — see dedicated section below. | VICE MCP `vice_*` tools exclusively, `recovery/clean/` (original target), `build/` (rebuild target) |
| `tools/` | Project-local scripts that aren't reusable skills: provenance diffing, memory-map generation, doc-label linter, (later) d64 packaging. | Everything else, read-only where possible |
| `.claude/skills/` (existing) | `acme-build` (assemble/disassemble), `c64-memory-mapping` (address resolution), `devcontainer-host-path` (host paths for VICE). Reused, not duplicated. | `src/`, `docs/`, VICE MCP |

## Recommended Project Structure

```
bruce_lee/
├── disks/                          # EXISTING — read-only cracked source images
│   ├── danish.d64
│   └── saeger.d64
│
├── recovery/                       # live-memory recovery, one dir per source + the merged result
│   ├── danish/
│   │   ├── dumps/                  # raw memory_read / snapshot captures taken while defeating the loader
│   │   └── NOTES.md                # loader/cruncher defeat log: breakpoints used, depack entry, exit point
│   ├── saeger/
│   │   ├── dumps/
│   │   └── NOTES.md
│   ├── clean/
│   │   └── bruce-lee.bin           # canonical recovered image — THE disassembly base
│   └── PROVENANCE.md               # byte-range ledger: ORIGINAL / CRACKER-PATCH / UNKNOWN + confidence
│
├── src/                             # ACME reconstruction — the buildable tree
│   ├── main.a                       # top-level: !source includes in link order + segment map (*=)
│   ├── zeropage.a                   # single source of truth for every zero-page allocation
│   ├── boot/
│   │   └── stub.a                   # BASIC stub / load-and-jump
│   ├── engine/
│   │   └── main-loop.a              # dispatch, frame/game-state machine
│   ├── sprites/
│   │   └── multiplex.a              # sprite multiplexer
│   ├── ai/
│   │   ├── yamo.a
│   │   └── ninja.a
│   ├── combat/
│   │   └── resolve.a                # collision & combat resolution
│   ├── rooms/
│   │   └── flow.a                   # room/screen flow, scrolling
│   ├── score/
│   │   └── score.a
│   ├── sound/
│   │   └── player.a
│   ├── ui/
│   │   └── title-hiscore.a          # lightly documented, still built (per PROJECT.md scope)
│   ├── data/                        # verbatim byte tables — the v2 converter seam
│   │   ├── levels.a / levels.bin
│   │   ├── sprites.a / sprites.bin
│   │   ├── charset.a / charset.bin
│   │   ├── anim-tables.a / anim.bin
│   │   └── music.a / music.bin
│   └── lib/                         # local macros; hardware/KERNAL symbols come from ACME's own
│       └── macros.a                 #   cbm/c64/*.a includes (vic_*, k_*, cia*_*) — do not re-invent
│
├── build/                            # GENERATED — gitignore contents, keep .gitkeep
│   ├── bruce-lee.prg
│   ├── bruce-lee.d64
│   ├── bruce-lee.sym
│   ├── bruce-lee.vs                  # --vicelabels output, fed to VICE MCP symbols_load
│   └── bruce-lee.rep
│
├── docs/
│   ├── memory-map.md                 # generated table (from .sym/zeropage.a) + hand-written prose tier
│   ├── provenance.md                 # short pointer/summary; recovery/PROVENANCE.md is canonical
│   ├── formats/
│   │   ├── level-format.md
│   │   ├── sprite-format.md
│   │   ├── anim-table-format.md
│   │   └── music-format.md
│   └── systems/
│       ├── sprite-multiplexing.md
│       ├── animation-move-tables.md
│       ├── collision-combat.md
│       ├── ai-yamo.md
│       ├── ai-ninja.md
│       ├── room-flow.md
│       ├── scoring.md
│       └── sound.md
│
├── assets/                            # extracted, human-inspectable, read-only in v1
│   ├── sprites/*.png
│   ├── charset/*.png
│   ├── levels/*.json
│   └── README.md                       # extraction method + byte-offset provenance per asset
│
├── verify/                             # verification harness — first-class component
│   ├── scripts/<scenario>.json         # deterministic joystick input timelines
│   ├── checkpoints/<scenario>.json     # checkpoint definitions (frame trigger, regions to capture)
│   ├── baselines/<scenario>/           # recorded from the ORIGINAL, per checkpoint
│   │   ├── <checkpoint-id>.json        # framebuffer hash + named RAM-region snapshot
│   │   └── snapshots/*.vsf             # optional VICE snapshots, regenerable convenience artifacts
│   ├── reports/                        # divergence reports from rebuild runs
│   ├── runner.mjs                      # orchestrator over VICE MCP vice_* tools
│   └── README.md                       # checkpoint schema, target selection, how to add a scenario
│
├── tools/                              # project-local scripts (not reusable skills)
│   ├── diff-images.mjs                 # produces recovery/PROVENANCE.md
│   ├── gen-memmap.mjs                  # produces docs/memory-map.md's generated tier
│   ├── lint-doc-labels.mjs             # fails if docs/ cites a label not in build/bruce-lee.sym
│   └── d64-pack.mjs                    # placeholder until c1541-vs-custom-writer decision lands
│
├── Makefile                             # build driver — see Build Pipeline
├── .claude/skills/                      # EXISTING — acme-build, c64-memory-mapping, devcontainer-host-path
└── .planning/                           # EXISTING — GSD process state
```

### Structure Rationale

- **`recovery/` is separate from `disks/` and from `src/`.** Three different trust levels: `disks/` is untouchable evidence, `recovery/` is a derived working artifact (large binary dumps, expected to be regenerated if the depacking method improves), `src/` is the hand/agent-authored reconstruction. Collapsing any two of these loses the audit trail the preservation-record driver requires.
- **`recovery/clean/` holds exactly one canonical image**, not two. Both cracks feed the provenance ledger, but disassembly needs one unambiguous base to number addresses against; recommend `danish` as candidate base *if* it depacks cleanly to a single contiguous image (raw-loader disks tend to produce a flatter memory layout than a cruncher's decompressed output might if fragmented) — this is a phase-level decision, not an architectural one, but the directory structure should not presuppose which one wins.
- **`src/` subsystem directories mirror `docs/systems/` names one-to-one** (`sprites/` ↔ `sprite-multiplexing.md`, `ai/yamo.a` ↔ `ai-yamo.md`, etc.). This is the single cheapest thing that keeps prose and source from drifting apart: anyone editing one knows exactly where its twin lives.
- **`zeropage.a` and `main.a` are singled out at the top of `src/`**, not buried in a subdirectory. They are the highest-fan-in files (every subsystem reads zero-page vars; every subsystem is `!source`-included from `main.a`'s segment map) and the most likely point of merge contention when work is parallelized — keeping them visible and small (allocation table + include list, no logic) minimizes that contention.
- **`data/` and `assets/` are deliberately separate**, even though `assets/` is *derived from* `data/`. `data/*.bin` is what `src/` actually assembles against (via `!bin`) and is the v2 converter seam (see Build Pipeline). `assets/*.png`/`*.json` are read-only-in-v1 human artifacts. Merging them would make it ambiguous, later, which one the build depends on — for a project with a planned v2 that inverts that dependency, that ambiguity is exactly the rewrite risk the milestone context asks to avoid.
- **`build/` is fully disposable and gitignored.** Nothing outside this directory should ever read a value out of a `.prg`/`.sym` by hand; `tools/gen-memmap.mjs` and `tools/lint-doc-labels.mjs` are the only sanctioned consumers, and they regenerate `docs/memory-map.md` and check `docs/` respectively — this is what prevents the classic prose-drifts-from-source failure (see Documentation Architecture).
- **`verify/` is a peer of `src/` and `docs/`, not a subfolder of either.** It is explicitly called out as first-class in the milestone context, and structurally it depends on both the original (via `recovery/clean/`) and the rebuild (via `build/`) — it cannot be scoped under either without misrepresenting that it judges both.

## Architectural Patterns

These are ACME-specific mechanisms, verified against the ACME 0.97 documentation installed in this devcontainer (`/usr/share/doc/acme/{QuickRef,AllPOs}.txt.gz`), not assumed from general 6502-assembler folklore.

### Pattern 1: Splitting into files is (almost) free — `!source` does not move addresses

**What:** `!source FILENAME` (alias `!src`) assembles another file inline and returns to the current one afterward. It does **not** reset the program counter or start a new segment — it is a textual include. Splitting a monolithic disassembly into `src/sprites/multiplex.a`, `src/ai/yamo.a`, etc. and `!source`-ing them in order from `main.a` produces **exactly the same address layout** as one giant file, as long as the include order matches the original code order.

**When to use:** Always, for organizing already-annotated, already-hazard-checked code. This is the default and should be the terminal state of every subsystem.

**Trade-off:** None, provided the *order* of `!source` statements in `main.a` reproduces the original linear layout. Reordering **does** move addresses — that's Pattern 2's territory, not this one.

```acme
; main.a
!to "build/bruce-lee.prg", cbm
* = $0801
!source "boot/stub.a"
* = $0812                    ; wherever the original code segment actually starts
!source "engine/main-loop.a"
!source "sprites/multiplex.a"
!source "ai/yamo.a"
!source "ai/ninja.a"
!source "combat/resolve.a"
!source "rooms/flow.a"
!source "score/score.a"
!source "sound/player.a"
!source "ui/title-hiscore.a"
```

### Pattern 2: Segment map via `*=`, guarded with `--strict-segments` and `!initmem`

**What:** `* = EXPRESSION [, MODIFIER]` sets the program counter and starts a new segment; at least one is required (or `--setpc`). Segments that overlap only warn by default — use the `--strict-segments` CLI switch to turn that into a build failure, and `overlay`/`invisible` modifiers only where overlap is genuinely intentional (e.g. reusing a region for a table that's write-only before it's read). `!initmem EXPRESSION` fills the gaps between segments with a chosen byte instead of zero, useful for matching original padding cosmetically (verification here is behavioral, not byte-diff, so this is a legibility choice, not a correctness one).

**When to use:** Every project this shape. With a multi-file, potentially multi-agent-parallel source tree, silent segment overlap is a real risk the moment two subsystem files both claim the same address range by mistake — `--strict-segments` converts that from "discovered during verification" to "discovered at `make prg`", which is a much cheaper failure to catch.

**Trade-off:** None meaningful; it is strictly a build-time safety net.

```acme
* = $c000
!source "sprites/multiplex.a"     ; original sprite work-RAM segment
* = $8000
!source "ai/yamo.a"
!source "ai/ninja.a"
```
Build with: `acme --strict-segments --vicelabels build/bruce-lee.vs -o build/bruce-lee.prg src/main.a`

### Pattern 3: Address-lock assertions via `!if` + `!error`

**What:** ACME's expression parser can query the current program counter with `*`, and `!if CONDITION { BLOCK } else { BLOCK }` combined with `!error VALUE` aborts the build with a message. This is directly documented (`AllPOs.txt`, Section "Warnings/Errors") with the canonical example of asserting a region hasn't grown past a size limit.

**When to use:** Immediately after any routine flagged as a restructuring hazard (see Pattern 6) — self-modifying code, a routine another table jumps to by hardcoded address, anything the original's own code assumes sits at a specific place. Pin its start address with an assertion so that a future, unrelated edit anywhere earlier in the file order that accidentally shifts this routine **fails the build**, rather than silently changing behavior and only being caught (if at all) by the expensive verification harness.

**Trade-off:** Adds a small amount of source noise; worth it exactly at hazard boundaries, not everywhere.

```acme
combat_resolve_hit
        ; PROVENANCE: original (present in both danish and saeger)
        ; HAZARD: address referenced by raw jump table at $1F40 (data/anim.bin) — do not move
        !if * != $1a2e {
            !error "combat_resolve_hit moved from $1a2e to ", *, " — update data/anim.bin jump table"
        }
        lda combat_state
        ...
```

### Pattern 4: Label naming, and syncing names to a live VICE session

**What:** ACME's own `disasm` mode (via the `acme-build` skill) already establishes the fallback convention for anything not yet understood: `L<addr>` for code, matching what a linear disassembly emits before annotation. Once named, use a per-subsystem prefix that matches the directory it lives in — `sprite_*`, `ai_yamo_*`, `ai_ninja_*`, `combat_*`, `room_*`, `score_*`, `sound_*` — so a bare label announces its subsystem in any listing, prose reference, or VICE breakpoint list. Hardware/KERNAL addresses should reuse the symbols ACME's own `<cbm/c64/vic.a>`, `<cbm/c64/kernal.a>`, `<cbm/c64/cia1.a>`/`<cbm/c64/cia2.a>`, `<cbm/c64/sid.a>` includes provide (`vic_cborder`, `k_chrout`, etc. — already wired up via the `acme-build` skill) rather than reinventing names, and BASIC/KERNAL work-area variables the game still touches should take their names from the canonical `C64.MemoryMap.txt` symbols the `c64-memory-mapping` skill already resolves (`PNT`, `CINV`, ...) — but only after confirming the game actually uses them for that KERNAL-documented purpose (the `c64-memory-mapping` skill's own working notes flag exactly this trap: a game with ROM banked out can repurpose a "known" zero-page address for something unrelated).

Zero-page variables are the one category to centralize rather than distribute: `zeropage.a` allocates every used ZP byte with a symbolic name and, where the type-check system is worth using, marks pointer-holding symbols with `!address`/`!addr` so `-Wtype-mismatch` can catch a pointer used as a plain value or vice versa — cheap insurance in a reconstruction where zero-page reuse across subsystems (a classic 8-bit space-saving trick) is likely.

Unknowns get an explicit, greppable placeholder — `unk_$addr` — so `grep -rn "^unk_" src/` is a live completeness metric throughout the project, not just at the start.

**Syncing to VICE:** ACME's `--vicelabels FILE` flag emits the symbol table in the exact format the VICE monitor's `add_label` (`al`) command consumes. Generate `build/bruce-lee.vs` on every build and feed it to the emulator via the MCP `symbols_load` tool before any debugging or verification session. This guarantees **one generation path** — ACME's own symbol table — rather than a hand-maintained label file that can silently diverge from the source it's supposed to describe.

```bash
node .claude/skills/acme-build/acme.mjs build src/main.a \
  -o build/bruce-lee.prg --vicelabels build/bruce-lee.vs --strict-segments
```

### Pattern 5: Page-alignment preservation via `!align`

**What:** `!align ANDVALUE, EQUALVALUE [, FILLVALUE]` pads output until `(* AND ANDVALUE) == EQUALVALUE`. The documentation's own worked examples are directly relevant here: `!align 255, 0` aligns to a 256-byte page, `!align 63, 0` aligns to a 64-byte block — the exact granularity C64 sprite pointers require (sprite data must start at a 64-byte boundary within the current VIC bank).

**When to use:** Any table whose original placement depends on a page or block boundary — sprite pointer tables, anything indexed with wraparound assumed at a page edge, charset data (also 64-byte-block-aligned in the same way as sprites). These are **structural constraints inherited from the hardware/original layout, not stylistic choices** — restructuring source for readability must preserve them explicitly with `!align`, never assume the assembler will happen to land there.

**Trade-off:** None; omitting it where required produces a rebuild that assembles cleanly and then fails at runtime in a way the verification harness's framebuffer-hash check will catch (garbled sprite) but that is far cheaper to prevent at annotation time by flagging the boundary requirement explicitly.

```acme
* = $c000
!align 63, 0
sprite_data_yamo_walk1
        !bin "data/sprites.bin", 63, 0
```

### Pattern 6: `!pseudopc` for self-relocating code (apply only if the disassembly finds it)

**What:** `!pseudopc EXPRESSION { BLOCK }` assembles a block as if the PC held a different value than where it's physically stored — for code assembled at one address but copied to and executed at another at runtime (common for IRQ handlers relocated into fast/unused RAM, or a small stage-2 loader copying itself). It nests, and the enclosing PC (real or itself a pseudo-PC) resumes correctly after the block.

**When to use:** Only if disassembly finds the original does this — many C64 games relocate a sprite IRQ handler or similar into zero-page-adjacent RAM at startup. If found, express it as one `!pseudopc` block rather than two disconnected copies of the same logic in the source (one at its assembled/resident location for the game's own copy step to read `!bin`-style, one implied at its runtime target) — this keeps the single source of truth intact and is exactly what the mechanism is for.

**When *not* to use:** Speculatively, before confirming the original actually relocates code. Not every game does; don't manufacture a relocation stage that never existed.

### Anti-patterns: restructuring hazards to catalogue *before* splitting a region

These are exactly what research priority #2 asks to flag as unsafe to split, cast as anti-patterns because the failure mode is the same in each case — reordering or separating bytes that the *original code itself* depends on being contiguous or at a fixed absolute address:

- **Raw-data jump/vector tables.** If a table of target addresses is a verbatim `!bin` blob (bytes, not assembled `!word label` entries), moving the routine it targets does not update the table — ACME only recalculates addresses it assembled itself. Fix: where a jump table targets *reconstructed* code, assemble it as `!word` entries referencing labels (so ACME keeps it correct under refactor) rather than as raw extracted bytes, even though the surrounding project convention is "verbatim data tables" — a table of code addresses is not really game *data* in the same sense as a level layout, and should be treated as an exception.
- **Self-modifying code / POKE'd operands.** Code that writes a literal address byte into another instruction's operand at runtime (or reads its own opcode stream as data) must not have its target relocated unless the write is expressed symbolically (`sta target_routine+1`) rather than as a bare numeric literal matching a specific original address.
- **Implicit fall-through.** Two routines with no explicit jump between them, where the second is reached simply by the first's code ending and control continuing into the next byte, must stay adjacent, in the same file, in original order. Splitting them into separate files is fine (Pattern 1) as long as `main.a`'s `!source` order keeps them consecutive; separating them with unrelated code in between requires inserting an explicit `jmp`, which is a real (if tiny and behavior-preserving) change worth flagging in a commit, not doing silently.
- **The "RTS trick" / self-referential opcode tricks.** Code using `pha`/`rts` or pushing `PC-1` for a computed-jump idiom is maximally position-sensitive relative to itself; leave such regions in one un-split file with a `; HAZARD:` tag and an address-lock assertion (Pattern 3) rather than attempting to reorganize them at all.
- **Page-alignment-sensitive data**, covered in Pattern 5.

Catalogue these during annotation (a `; HAZARD: <kind>` comment at the point of discovery is sufficient), and treat "safe to split into the final multi-file layout" as a status a region *earns* after that catalogue exists for it — not the default starting state. See the Dependency Graph for how this shapes build order.

## Data Flow

### Key Data Flows

1. **Binary → Provenance:** `recovery/clean/bruce-lee.bin` and both `recovery/{danish,saeger}/dumps/` feed `tools/diff-images.mjs`, which produces `recovery/PROVENANCE.md` — a byte-range ledger (start, end, verdict, evidence, confidence). This is upstream of everything else; nothing downstream should assign "original vs. cracker" status without checking it first.
2. **Binary + Provenance → Disassembly → Docs & Source (forked, must reconverge):** annotation work against `recovery/clean/` (aided by the `c64-memory-mapping` skill) produces two co-evolving outputs — `docs/systems/*.md` (why) and `src/**/*.a` (what, buildably) — that cite each other. This is the fork that most needs an explicit discipline to keep in sync (see Documentation Architecture).
3. **Source + Data → Build → Artifacts:** `src/main.a` (`!source`-including every subsystem file, `!bin`-including `data/*.bin`) assembles to `build/bruce-lee.prg` plus `.sym`/`.vs`/`.rep`; a packaging step turns `.prg` into `build/bruce-lee.d64`.
4. **Artifacts + Original → Verification → Divergence report (the feedback edge):** the harness drives both `recovery/clean/` (baseline, recorded once) and `build/bruce-lee.prg`/`.d64` (rebuild, recorded every run) through the same `verify/scripts/*.json` input timeline, samples `verify/checkpoints/*.json`-defined state at each checkpoint, and diffs rebuild-vs-baseline. A pass is the only thing entitled to call a claim in `docs/` "verified" rather than "believed."
5. **Provenance → Source annotation (a return edge):** any byte-range the ledger marks non-ORIGINAL gets an inline `; PROVENANCE: cracker-patch (...)` tag in `src/` at the point that byte lives, not only in the ledger — so a reader hits the caveat where the byte is, and the rebuild can make an explicit, visible choice about whether to reproduce the crack patch or the reconstructed Datasoft original when they differ.
6. **`.sym`/`.vs` → generated docs tier (a return edge preventing drift):** `docs/memory-map.md`'s generated table and `verify/`'s checkpoint region names both derive from the same build artifact, never from a hand-copied address. `tools/lint-doc-labels.mjs` fails the build if `docs/` cites a label absent from `build/bruce-lee.sym`.

### Citing a routine from prose stably

Unlike a typical software project (where "never cite a line number, it'll move" is the standard advice), **addresses in this project are mostly load-bearing and therefore mostly stable** — the whole premise of "functional equivalence, not byte-identical" is that most code *keeps its original address* because other code depends on it (Pattern 3 exists to enforce this), and only provably-safe regions get relocated at all. That makes address-based citation more durable here than in ordinary software. Recommended citation form combines both anyway, because each identifies something the other can't:

> `combat_resolve_hit` ($1A2E, `src/combat/resolve.a`)

- the **label** is what the source and the doc-linter check against each other;
- the **address** is what VICE will show you regardless of which file or doc you came from, and survives even a hypothetical future rename;
- the **file path** is what a reader browsing the repo (rather than a live session) needs.

### Recording confidence and provenance

Every documented byte-range should carry a confidence tag, resolved from the two-crack diff:

| Verdict | Evidence | Confidence |
|---|---|---|
| ORIGINAL | Identical in both `danish` and `saeger` recovered images | HIGH |
| CRACKER-PATCH | Differs between the two, and the difference matches a known cracker technique (protection-check NOP-out, loader relocation, disk I/O substitution) | HIGH (patch), MEDIUM-LOW (what original there replaced) |
| UNKNOWN | Differs between the two, no clear cracker signature, no known original to compare | LOW — flag explicitly, do not guess |

`recovery/PROVENANCE.md` is the ledger; `docs/provenance.md` is a short pointer/summary for readers who land in `docs/` first; inline `; PROVENANCE:` comments in `src/` are the point-of-use copy. Three places, one fact, one direction of truth (ledger → everything else) — never edit the summary or inline tags independently of the ledger.

## Documentation Architecture

**Memory map:** generate, don't hand-author, the address/label/size/source-file table (`tools/gen-memmap.mjs` walking `build/bruce-lee.sym` and `src/zeropage.a`'s comments), and keep it as a distinct tier from a hand-written prose section per major region underneath it (what the region *means*, which the auto-walk cannot infer). Regenerating on every `make docs` (or as a build step) is what prevents the classic failure mode named in the research priorities: a hand-maintained map drifts the moment one label gets renamed and nobody remembers to update a second, disconnected document.

**Avoiding prose/source drift generally:** the doc-linter (`tools/lint-doc-labels.mjs`) scans `docs/**/*.md` for backtick-quoted identifiers that look like labels and fails if any is absent from `build/bruce-lee.sym`. This is mechanical and cheap, and it is the reason label names (Pattern 4) matter more than they would in an ordinary project — they are the join key between two otherwise-independent documents.

**Confidence/provenance:** covered above; the key architectural point is that it's a single ledger with two downstream copies, not three independent sources of truth.

## Build Pipeline

### Dataflow

```
src/*.a  +  data/*.bin (!bin)
        │  acme (via acme-build skill)
        ▼
build/bruce-lee.prg  +  .sym  +  .vs (--vicelabels)  +  .rep
        │  packaging (tool TBD — see Dependency Graph)
        ▼
build/bruce-lee.d64
```

### Build driver: Makefile

Recommend a **Makefile** as the primary build driver, not a bespoke script:

- The dependency shape is naturally mtime-based: `.prg` depends on every `.a`/`.bin` input, `.d64` depends on `.prg`, `docs/memory-map.md` depends on `.sym`, `verify` reports depend on both `.prg`/`.d64` and the baselines. `make`'s incremental rebuild is exactly this model already; a script would have to reimplement it.
- It composes with the existing `acme-build` skill rather than replacing it — a `make prg` rule simply shells out to `node .claude/skills/acme-build/acme.mjs build src/main.a -o build/bruce-lee.prg --vicelabels build/bruce-lee.vs`.
- It matches domain convention: assembler-plus-Makefile is the standard pairing in the 6502/ACME ecosystem (the ACME distribution's own bundled examples ship a `Makefile`), unlike web-app ecosystems where `npm`/task-runner scripts dominate — following the grain here reduces surprise for anyone who has touched a comparable project before.
- Natural phony targets fall out of the component list: `make prg`, `make d64`, `make docs` (regenerate memory map + run the doc-linter), `make verify` (invoke the harness), `make clean`.

```makefile
ACME := node .claude/skills/acme-build/acme.mjs

build/bruce-lee.prg: src/main.a src/**/*.a data/*.bin
	$(ACME) build src/main.a -o build/bruce-lee.prg --vicelabels build/bruce-lee.vs --strict-segments

build/bruce-lee.d64: build/bruce-lee.prg
	node tools/d64-pack.mjs build/bruce-lee.prg build/bruce-lee.d64   # tool TBD, see below

docs: build/bruce-lee.prg
	node tools/gen-memmap.mjs
	node tools/lint-doc-labels.mjs

verify: build/bruce-lee.prg
	node verify/runner.mjs run --target=rebuild --all-scenarios --compare

.PHONY: docs verify clean
```

### The open dependency: `.d64` packaging

`c1541` (VICE's own disk-image tool — the natural first choice, since it produces exactly VICE's expected format) is confirmed absent from this devcontainer, per PROJECT.md. Two paths, both compatible with the pipeline above without changing anything upstream of `build/bruce-lee.d64`:

1. Install `c1541` (it may be obtainable as a standalone VICE utility without a full VICE emulator build) — preferred if feasible, since it guarantees format correctness.
2. A small custom `.d64` writer (`tools/d64-pack.mjs`) — consistent with this project's already-demonstrated pattern of parsing `.d64` bytes directly (the `vice_disk_list` hazard already forces direct byte-level disk inspection elsewhere in this project), so a minimal writer is a natural, low-risk fallback, not a novel approach.

This is a small, self-contained research spike, independent of everything else — see Dependency Graph.

### The v2 seam: asset converters

The contract between `src/` and `data/` is **a stable filename and byte layout**, not a build mechanism. In v1, `data/levels.bin` is a checked-in, hand/agent-placed file with no recipe — `make` treats it as a leaf. In v2, add a Makefile rule that *generates* `data/levels.bin` from `assets/levels/*.json` via a round-trip converter; `src/data/levels.a`'s `!bin "data/levels.bin"` line never changes. Because the seam is the file, not the process that produced it, v2 requires adding a rule, not rewriting the pipeline.

## Verification Harness

Treated as a first-class component with named parts, per the milestone context. All emulator interaction goes through the MCP `vice_*` tool surface exclusively (checkpoints/watches, `run_until`, `execution_step`, `memory_read`/`compare`, `display_screenshot`, `joystick_set`/`tap`, `snapshot_save`/`load`, `cycles_stopwatch`, `symbols_load`) — **never** a local VICE binary, and **never** `vice_disk_list` (known to crash the host MCP server; recovery requires a manual host-side VICE restart).

### Components

**1. Input Script (`verify/scripts/<scenario>.json`)** — a deterministic joystick timeline keyed to frame count, not wall-clock: a list of `{ frame, action: up|down|left|right|fire|release, hold_frames }` events. Joystick-only (matching the game's actual control scheme and the available MCP tools), so the same script drives both targets identically.

**2. Checkpoint Definitions (`verify/checkpoints/<scenario>.json`)**, decoupled from input scripts so multiple scenarios can share a schema. Recommend **frame count as the primary trigger**: address-independent, so it works identically against the original and a rebuild whose subsystems are still being restructured, and it doesn't require deciding in advance which routine matters. Layer a **semantic gate** on top where useful — e.g., "don't start counting gameplay frames until `room_load` has executed once" — to skip past non-deterministic-length attract-mode/title-screen time that isn't gameplay-relevant; this is where a PC-based `run_until`/checkpoint is the right tool, used for synchronization rather than as the correctness signal itself. Each checkpoint entry names which RAM regions to capture, using the **same symbolic names as `docs/memory-map.md`/the `.sym` file** — never raw literal addresses in this file — so a divergence report is human-readable without cross-referencing.

**3. Runner / Orchestrator (`verify/runner.mjs`)** — parameterized by `target` (`original`: `recovery/clean/bruce-lee.bin` + its boot method; `rebuild`: `build/bruce-lee.prg`/`.d64`) and `scenario`, orthogonally, so adding a scenario never touches target-loading logic and vice versa:
   ```
   node verify/runner.mjs run --target=original --scenario=level1-start --record-baseline
   node verify/runner.mjs run --target=rebuild  --scenario=level1-start --compare
   ```
   **Open question to resolve in a phase, not assumed here:** the tool list given for this project does not name an explicit "load/attach a program and boot it" MCP tool (the enumerated set is checkpoints/watches, `run_until`, `execution_step`, `memory_read`/`compare`, `display_screenshot`, `joystick_set`/`tap`, `snapshot_save`/`load`, `cycles_stopwatch`, `symbols_load`). Two compatible designs, to be confirmed against the actual tool surface: (a) an unlisted attach/boot tool exists and is simply out of this research's scope, or (b) booting is achieved via `snapshot_load` from a pre-captured "just booted, control returned to game" `.vsf` snapshot per target, created once and reused as the deterministic starting point for every scenario run. Either way, the runner's job is the same: reach a known, deterministic starting state, then replay the input script frame-by-frame using `execution_step`/`run_until`, sampling at checkpoints.

**4. Captured state per checkpoint** — two independent channels, as required: a **framebuffer hash** (hash of the `display_screenshot` payload — a superset signal that catches anything that renders differently, including subsystems not yet instrumented into the RAM-region list) and a **named RAM-region snapshot** via `memory_read` (score, lives, room number, player/enemy state, anything else `docs/memory-map.md` has named for that subsystem — the localizing signal that turns "something's wrong" into "which byte, which subsystem"). Neither alone is sufficient: framebuffer-only can't localize; RAM-only can miss a purely-visual bug (wrong sprite color) that never touches a tracked region.

**5. Baseline recording (`verify/baselines/<scenario>/`)** — the original run through a given input script, once, produces `{ frame, framebuffer_hash, ram_snapshot: { region_name: value_or_hash } }` per checkpoint, stored as small diffable JSON (raw hex for RAM regions small enough to review in a PR; hash only for the framebuffer, to avoid bloating the repo with frame images) — legible in code review, in keeping with the preservation-record driver. An optional `snapshot_save`-produced `.vsf` per checkpoint under `snapshots/` is a convenience for later interactive debugging (regenerable by re-running the baseline capture; safe to gitignore if repo size matters more than convenience).

**6. Divergence reporting (`verify/reports/`)** — on mismatch, emit a structured report naming: scenario, the **first** divergent checkpoint (report subsequent ones too, flagged as likely-consequential noise once state has already diverged, but lead with the first), whether the framebuffer hash mismatched, and an itemized per-region diff for RAM (`score_lo differs: original=$05 rebuild=$07 at frame 480, checkpoint 'first-hit'`) — actionable because region names are already the same ones used in `docs/memory-map.md`, not raw addresses a human has to look up separately.

### Design notes worth calling out explicitly

- **Baseline capture needs no rebuild at all.** It only needs `recovery/clean/` to boot and the harness plumbing (runner, checkpoint schema, input-script format) to exist. This makes it fully parallel with disassembly/source-writing — arguably the single best "start on day one" stream in the whole project (see Dependency Graph).
- **A pure file-reorganization commit (Pattern 1) should reproduce a byte-identical `.prg`.** If a commit's stated purpose is "split this routine into its own file, no logic change," diffing the resulting `.prg` bytes before/after is a free, instant, stronger check than the full joystick-replay harness — reserve the expensive harness run for commits that actually claim new behavioral equivalence to the original, not for pure reorganization of already-verified code.

## Dependency Graph

Hard edges cannot be reordered; soft edges are conventional/beneficial orderings that can be relaxed, especially across subsystems, to parallelize.

```
                         disks/{danish,saeger}.d64
                                    │  (hard)
                                    ▼
                    recovery/{danish,saeger}/  (defeat loader+cruncher)
                                    │  (hard: need BOTH before diffing)
                    ┌───────────────┴────────────────┐
                    ▼                                 ▼
        recovery/PROVENANCE.md              recovery/clean/bruce-lee.bin
        (diff both images)                  (canonical base for disassembly)
                    │  (soft: informs,                │  (hard: disassembly needs
                    │   doesn't strictly gate,         │   *a* clean image; provenance
                    │   starting to read opcodes)      │   detail can catch up)
                    │                                  │
                    │                    ┌─────────────┼───────────────────────┐
                    │                    ▼                                     ▼
                    │        Disassembly & annotation              verify/ harness plumbing
                    │        per subsystem (soft-parallel            (runner, checkpoint schema,
                    │        across subsystems once each             input-script format) —
                    │        entry point is located)                 needs ONLY recovery/clean/
                    │                    │  (hard, per subsystem:                 │
                    │                    │   hazards must be catalogued           │ (hard: needs the
                    │                    │   before that region is split)         │  harness to exist,
                    │                    ▼                                        │  not the rebuild)
                    │     ┌──────────────┴───────────────┐                        ▼
                    │     ▼                               ▼              Baseline capture
                    │  docs/systems/*.md          src/**/*.a (per            against ORIGINAL
                    │  docs/formats/*.md          subsystem, split          (fully parallel with
                    │                              only after hazards       everything at left)
                    │                              catalogued for it)
                    │                                     │  (hard: need
                    │                                     │   working src/
                    │                                     ▼   for a first build)
                    │                          build/bruce-lee.prg
                    │                                     │  (hard: packaging
                    │                                     │   needs a chosen tool —
                    │                                     │   independent research,
                    │                                     │   soft-parallel with all else)
                    │                                     ▼
                    │                          build/bruce-lee.d64
                    │                                     │
                    └─────────────────────┐                │
                                           ▼                ▼
                              Verification: rebuild run vs. baseline
                              (hard: needs BOTH baseline AND a rebuild)
```

### Hard dependencies

1. Both `disks/*.d64` → both must be depacked/recovered before provenance diffing is possible (can't diff against nothing).
2. `recovery/clean/` → disassembly (can't disassemble what's still packed).
3. Disassembly of a given region → hazard catalogue for that region → safe file-splitting of that region (splitting before hazards are known risks silently breaking self-modifying code, raw-data jump tables, fall-through pairs).
4. A first assemble-able `src/` → a first `build/bruce-lee.prg` (some coverage threshold, not full coverage).
5. `.prg` → `.d64` packaging (needs the artifact to exist; the *tool choice* for packaging is independent, see soft dependencies).
6. Baseline (from `recovery/clean/`) AND rebuild (`build/`) both existing → verification comparison (can't diff against a baseline that doesn't exist, or a rebuild that doesn't exist).

### Soft dependencies / genuinely parallelizable streams

- **Provenance diffing** and **starting to read opcodes** can proceed together once both images are recovered — they don't block each other, only both depend on recovery being done.
- **Per-subsystem documentation and per-subsystem source reconstruction** are parallel across subsystems (sprite-multiplexing docs/source don't block on AI docs/source) once each subsystem's entry point is located in the disassembly — the *only* shared coordination points are `zeropage.a` and `main.a`'s segment map/include order, which should be established early and touched rarely, precisely because they're the highest-fan-in files across parallel workstreams.
- **The verification harness itself (runner, checkpoint schema, input-script format, baseline recording)** depends only on `recovery/clean/` booting — it can be built, smoke-tested, and even used to record real baselines **before any `src/` work is done at all**. This is the strongest available parallel stream and should start as close to day one as the recovery stage allows.
- **Data-format specs and asset extraction** are parallel per data type (levels vs. sprites vs. charset vs. anim vs. music), each gated only by its own subsystem's disassembly progress, not the whole game's.
- **`.d64`-packaging tool research** (c1541 feasibility vs. custom writer) is small, self-contained, and can happen at any time — it blocks nothing except the final `.d64` artifact itself, and nothing blocks it.

### Suggested build order (derived, for roadmap phase structuring)

1. Recovery of both images → clean canonical base (hard gate for everything else).
2. In parallel from that point: (a) provenance diffing, (b) first-pass disassembly/annotation (whole-game skeleton, not full depth), (c) verification-harness plumbing + first original baseline.
3. Per-subsystem, in parallel once each subsystem's entry point is located: deepen annotation → catalogue hazards → write docs + monolithic scratch `src/` for that subsystem → get it building and passing verification → *then* split into the final multi-file layout as a behavior-preserving refactor (byte-identical `.prg` check).
4. `.d64`-packaging tool decision, any time, ideally early (small, unblocks only itself).
5. Full-game verification pass (all scenarios, all subsystems integrated) once enough subsystems have individually passed.
6. `.d64` packaging of the completed rebuild as the final deliverable step.

## Anti-Patterns

### Anti-Pattern 1: Iterating against `.d64` instead of `.prg`

**What people do:** Rebuild the whole disk image on every edit-compile-run cycle.
**Why it's wrong:** `.d64` packaging depends on a tool decision that may still be in flux, and adds a layer of indirection with no benefit during development.
**Instead:** Use `.prg` for the fast loop; reserve `.d64` for final packaging validation and the "does it boot standalone" milestone check.

### Anti-Pattern 2: Hand-maintained memory map / label list

**What people do:** Write `docs/memory-map.md` once by hand, alongside (not generated from) the ACME source.
**Why it's wrong:** It will drift the first time a label is renamed during ongoing annotation work — this is the explicitly named failure mode in the research priorities.
**Instead:** Generate the address/label/size table from `build/bruce-lee.sym`/`zeropage.a`; hand-author only the prose interpretation layered on top, and lint doc citations against the generated symbol table.

### Anti-Pattern 3: Splitting/restructuring before hazards are catalogued

**What people do:** Reorganize a region into "nice" multiple files for readability as soon as it's understood well enough to read.
**Why it's wrong:** Self-modifying code, raw-data jump tables, fall-through pairs, and page-alignment requirements are invisible in a listing until specifically looked for, and a naive split can silently change addresses they depend on — a failure that may not even be caught if the verification harness's checkpoints don't happen to exercise that exact path.
**Instead:** Catalogue hazards during annotation (`; HAZARD:` tags), keep hazardous regions in one file with an address-lock assertion (`!if`/`!error`), and only split what's been confirmed safe.

### Anti-Pattern 4: A single checkpoint-trigger mechanism

**What people do:** Use only PC/address breakpoints, or only fixed frame counts, for every checkpoint.
**Why it's wrong:** Pure PC-based triggers are fragile if timing varies (e.g., variable-length attract-mode/title-screen sequences); pure frame-count triggers can't express "wait until this game event has happened" semantically.
**Instead:** Combine a semantic gate (PC/routine-based, to skip non-deterministic setup time) with frame-count-based sampling for the deterministic gameplay portion.

### Anti-Pattern 5: Silently reproducing cracker patches as if they were original

**What people do:** Ship whatever byte pattern happens to boot, without checking the provenance ledger.
**Why it's wrong:** Directly conflicts with the project's stated preservation-record driver and the explicit requirement to distinguish original Datasoft bytes from cracker patches.
**Instead:** The provenance ledger decides; reconstruct the Datasoft original where the two cracks agree it's not patched, and tag any region where a genuine choice was made (patch reproduced, or gap filled) inline in `src/`.

## Integration Points

### External Services / Tooling

| Service/Tool | Integration Pattern | Notes |
|---|---|---|
| ACME cross-assembler (`/usr/bin/acme`) | Via the `acme-build` skill's `acme.mjs` wrapper — `new`, `build`, `sym`, `disasm` subcommands | Already installed; `--vicelabels`, `--strict-segments`, `-DSYMBOL=VALUE` are the flags this project should lean on |
| VICE (host-side) | MCP only — `vice_*` tools over `http://host.docker.internal:6510/mcp` (`.mcp.json`) | Never invoke a local VICE binary; never call `vice_disk_list` (crashes the host MCP server, needs manual host-side VICE restart to recover) |
| `c64-memory-mapping` skill | `driver.mjs lookup`/`annotate` for resolving addresses during disassembly | Ground zero-page/BASIC-area name guesses in the game's own behavior, not just the KERNAL-documented meaning, per the skill's own working notes |
| `devcontainer-host-path` skill | Translates workspace paths for any host-side tool argument (VICE snapshot paths, disk image paths) | Keep every artifact a host-side tool needs inside the workspace so it translates |

### Internal Boundaries

| Boundary | Communication | Notes |
|---|---|---|
| `recovery/` ↔ `docs/`+`src/` | One-directional: provenance/clean-image feeds annotation; annotation never edits recovery dumps | Recovery is evidence, treat as append-only |
| `docs/` ↔ `src/` | Bidirectional citation by label name + address; enforced by `tools/lint-doc-labels.mjs` | The doc-linter is the mechanism that makes this boundary honest rather than aspirational |
| `data/` ↔ `assets/` | One-directional in v1 (`data/` is truth, `assets/` is a read-only rendering); inverts in v2 | Keep them as separate directories now so the v2 inversion is a Makefile-rule change, not a directory reshuffle |
| `src/` ↔ `build/` | One-directional, generated | `build/` is disposable; nothing should hand-edit it or read from it except `tools/` scripts and the verification harness |
| `build/` + `recovery/clean/` ↔ `verify/` | Verification reads both, writes only to `verify/reports/` and `verify/baselines/` (baselines only during explicit `--record-baseline` runs) | The harness is the only component allowed to declare "verified" |

## Sources

- ACME Crossassembler 0.97 ("Zem") documentation, installed locally: `/usr/share/doc/acme/QuickRef.txt.gz` and `/usr/share/doc/acme/AllPOs.txt.gz` — primary source for `!source`/`!src`, `!binary`/`!bin`, `*=`, `!initmem`, `!pseudopc`, `!align`, `!if`/`!error`/`!warn`, `!address`/`!addr`, `!zone`, `--vicelabels`, `--strict-segments`, `--setpc`, `-DSYMBOL=VALUE`, `-I` — read directly, not assumed. (HIGH confidence — primary vendor documentation, installed and version-matched to the toolchain this project uses.)
- `acme --help` output from the installed binary — confirms CLI flag set matches the QuickRef text. (HIGH)
- Project files: `/workspaces/bruce_lee/.planning/PROJECT.md`, `.mcp.json`, `.claude/skills/{acme-build,c64-memory-mapping,devcontainer-host-path}/SKILL.md` — project-specific constraints (toolchain gaps, MCP endpoint, existing skill conventions, the `vice_disk_list` hazard). (HIGH — direct inspection of this repository's own files.)
- VICE monitor documentation (`vice_9.html`, community mirror) — confirms `add_label`/`load_labels`/`save_labels` monitor commands as the consumer of ACME's `--vicelabels` output format. (MEDIUM — secondary/community-hosted mirror of VICE manual, not the exact VICE version pinned to this project's MCP server, but the monitor label-command surface has been stable across VICE releases.)
- The exact MCP tool names for this project's `vice_*` surface (`run_until`, `execution_step`, `memory_read`/`compare`, `display_screenshot`, `joystick_set`/`tap`, `snapshot_save`/`load`, `cycles_stopwatch`, `symbols_load`, `vice_disk_list`) were taken as given from the research brief itself, since they describe this project's specific MCP server rather than a generic one; a general web search surfaced a differently-named VICE MCP server (`simen/vice-mcp`, `setBreakpoint`/`readMemory`/etc.) which does **not** match this project's naming and was not used as a source for tool names. (MEDIUM confidence on tool-surface *details* not directly inspectable from here — flagged as an open item: confirm during a phase whether an explicit "load/attach and boot a program" tool exists beyond the enumerated set, since none was named.)

---
*Architecture research for: 8-bit game reverse-engineering / ACME reconstruction*
*Researched: 2026-07-30*
