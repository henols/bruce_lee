# Project Research Summary: Bruce Lee Reverse Engineering & ACME Reconstruction

**Project:** Bruce Lee — Reverse Engineering & ACME Reconstruction
**Domain:** 8-bit C64 game reverse engineering / disassembly reconstruction
**Researched:** 2026-07-30
**Confidence:** MEDIUM-HIGH overall (HIGH where verified in-container; MEDIUM where verified against documented community patterns; LOW explicitly flagged)

## Executive Summary

This is a **binary reverse-engineering project with behavioral verification**, not an emulator or application project. The subject (Bruce Lee, Datasoft 1984, recovered only from two cracked disk images) requires defeating anti-tampering loaders, extracting a clean memory image, and rebuilding from annotated ACME assembly. The recommended approach is **live-memory-first** (run under VICE, break, dump) rather than static disassembly of packed bytes, feeding both a provenance-tracked source tree and integrated documentation that explains how the game works.

Core challenge: all input is cracked, none is original. Mitigation is a two-crack diff that separates Datasoft bytes from cracker patches, yielding confidence tiers per region. The entire project gates on this foundational confidence work, and verification is **behavioral** (scripted replay vs. checkpoints), not byte-identical, allowing restructuring for readability once the disassembly is solid.

**Top three risks**: incomplete/contaminated memory dump (Pitfall 5, gates everything downstream), code/data misclassification via missed jump tables / RTS-dispatch idioms (Pitfall 1, surfaces late in verification), and silent address drift in ACME reconstruction (Pitfall 6, produces cleanly-assembling but wrong .prg). All three are preventable with explicitly-documented practices (per-checkpoint dump logging, live-trace coverage bitmap, mandatory per-block round-trip byte diffs).

## Key Findings

### Recommended Stack

**Core assembler: ACME 0.97 "Zem" (verified in-container at `/usr/bin/acme`).** Already mandated by project constraints; nothing to decide. Emits `--vicelabels` symbol tables compatible with VICE's label load, and supports all NMOS 6502/6510 illegal opcodes via `!cpu nmos6502` directive. HIGH confidence (verified).

**Disassembly toolchain: `toacme` (fast first pass, dead-listing) + regenerator2000 (traced, reassemblable output).** Both follow from ACME ecosystem; `toacme` ships with the acme package (verified). `regenerator2000` is a modern Rust reimplementation of the historical Regenerator workflow, actively maintained, produces ACME-compatible source with code/data separation, and imports/exports VICE label files — avoiding a separate code/data annotation step. Install via `cargo install regenerator2000` (requires `apt-get install cargo rustc`, both Debian trixie candidates available). MEDIUM confidence (GitHub + community sources; not hands-on tested in this container yet).

**Memory recovery: live-emulator approach via VICE MCP tools, bypassing static depacking entirely.** Container has no `exomizer`/`da65`/etc., making static depacking a research spike if attempted; live-memory-dump (run cracked loader under VICE, break at known-good moment, dump RAM) is both simpler and more reliable than pattern-matching cruncher signatures. HIGH confidence (validated by prior-art precedent: Iridis Alpha, Gridrunner both used VICE snapshots for disassembly completion).

**Python scripting: custom Pillow + Python stdlib for graphics extraction, `.d64` reading, and verification-harness I/O.** No third-party graphics-ripper dependency; sprites/charset/level-layout are just byte tables at known addresses, extracted via small custom scripts. No specialized C64 graphics library needed. MEDIUM-HIGH confidence (Pillow is stable; C64 memory layout is well-established).

**Open tooling decision — `.d64` packaging: either source `c1541` (VICE's native disk tool) or write a minimal custom `.d64` writer.** Orchestrator verified d64 PyPI library is NOT currently installed — only a candidate. Two parallel paths available: (a) `apt-get install vice` or fetch `c1541` standalone (small research spike, should be resolved before Phase 2), or (b) implement a minimal Python writer using the public `.d64` byte layout (BAM, directory chain, interleave). Both are low-risk. MEDIUM confidence (choice pending, not a blocker).

**Emulator interaction: host-side VICE via MCP only.** All interaction through the `vice_*` tool surface. **Hard constraint: never call `vice_disk_list`** — empirically crashes host MCP server. Disk directory inspection done by parsing `.d64` raw bytes instead. Confirmed tools: `memory_read/write/search/compare`, `checkpoint_add/watch_add/run_until`, `execution_step/pause/run`, `registers_get/set`, `display_screenshot`, `joystick_set/tap`, `snapshot_save/load`, `symbols_load`, `cycles_stopwatch`. HIGH confidence (verified in PROJECT.md constraints).

### Expected Features

**Must have (table stakes) — every omission makes the project incomplete:**
- Clean recovered memory image from both cracks (no static disassembly possible until achieved)
- Provenance diff establishing per-byte confidence (the substitute for a missing master)
- Annotated disassembly with every reachable routine labeled and hazards catalogued
- Full memory map (zero-page, buffers, VIC bank layout)
- Per-subsystem prose documentation (sprite multiplexing, animation/move tables, combat/collision, AI, rooms, scoring, sound)
- Data format specs + read-only extracted assets (level, sprite, charset, anim, music)
- Reassemblable ACME source producing a working `.prg`
- Bootable `.d64` package
- Automated verification harness (checkpoint replay + RAM diff)

**Should have (competitive/differentiators):**
- VICE debugger symbol file export (cheap, high-value once stable labels exist)
- Development diary / "how this was figured out" narrative (incremental write-as-you-go, no blocking dependency)
- Confidence/provenance annotation per byte region (strongly motivated by "two-crack only" constraint; sets this project apart from typical RE)
- Prose that references disassembly labels/addresses directly (not paraphrase), anchoring documentation to code

**Defer to v2+ (explicitly out of scope, affirmed by prior-art research):**
- Round-trip asset converters (PNG ↔ game data)
- Level editor / modding tool
- Byte-identical rebuild (would forbid restructuring for readability, conflicts with "base to build on" driver)
- Deep documentation of crackers' loaders (TCS, SSG are obstacles, not the object of study)
- Cycle-exact timing reproduction

**Prior art position:** No public, disassembled Bruce Lee C64 exists. dmx's *Return of Fury* (fan sequel, ~2018) proves the game is fully reverse-engineerable but no technical artifact was published. 5k3105/bruce toolkit confirms doors/lanterns/AI are naturally-separable data formats. **This project would be the first public, documented, reassemblable disassembly if completed** — a significant standalone achievement beyond the three stated drivers. MEDIUM confidence (absence verified via targeted search; not exhaustive).

### Architecture Approach

**One-way pipeline with a feedback loop.** Bytes flow: disk → recovery → provenance → disassembly → docs + source (forked, cite each other via labels) → build → verification (compares rebuild vs. original). Verification result gates whether docs/source are considered "verified" or "believed." This is not a typical software project — the feedback loop is not optional; it is the correctness criterion.

**Key structural insight (from ARCHITECTURE.md): baseline capture needs only the recovered image and harness plumbing, not the rebuild.** This makes verification-harness setup a fully parallel stream from day one — no dependency on disassembly/source progress. Every other project surveyed (Iridis Alpha, Gridrunner, SMB NES) implements this pattern in CI; this project's manual equivalent should start immediately after recovery, not at the end.

**Major components:**
1. **`recovery/`** — Live-memory dumps per source image + one canonical clean image + provenance ledger (byte-range verdicts)
2. **`src/` (ACME reconstruction)** — Subsystem files organized to match `docs/`, one-source-included from `main.a`, `zeropage.a` centralizes ZP allocation
3. **`docs/` (prose explanation)** — Memory map (generated from `.sym` + hand-written), per-subsystem systems docs, data format specs; every subsystem paired with a corresponding `src/` file
4. **`data/` + `assets/`** — Extracted binary tables (unchanged in v1, seam for v2 converters) + read-only renderings (PNG, JSON)
5. **`verify/`** — First-class verification component: input scripts, checkpoint definitions, baselines (from original), runner orchestrator, divergence reports
6. **`build/`** — Generated only, disposable; gitignored

### Critical Pitfalls

**1. Depacking-hazard memory dump is incomplete, premature, or misses non-RAM state (Pitfall 5).**
Everything downstream depends on this. Failure modes: too-early dump captures mid-decompression, too-late dump captures self-modified state, on-demand-loaded regions missed, RAM shadowed by ROM/IO not banked in, non-RAM hardware state not captured.
**Prevention:** Explicit, reproducible dump-point logging per crack (loader-done signals, address ranges, `$01` port state), full play-through post-dump to detect on-demand loading, supplementary dumps per observed loading event. **High-effort gate — spend time here.**

**2. Code/data misclassification via missed computed-jump and RTS-dispatch targets (Pitfall 1).**
6502 has no reliable way to statically determine whether a table is code or data without watching it execute. Jump tables and the "RTS trick" are invisible to linear disassembly.
**Prevention:** Live-trace coverage bitmap (bitmap over full recovered image showing executed/data/unknown), exhaustive play-through (all rooms, all enemies, all moves), union of static + live coverage as the real metric, confidence tags per label (verified-by-trace vs. inferred). **Critical for verification reliability.**

**3. ACME reconstruction silently diverges through address-dependent side effects (Pitfall 6).**
Restructuring can change assembled output invisibly: addressing-mode drift (forward references default to 16-bit, warnings if caught), alignment-sensitive data placed wrong (sprite pointers, charset, VIC bank boundaries), branch-out-of-range after reordering, segment overlap (default is warning-only).
**Prevention:** Treat all ACME warnings as blocking (fail the build on any warning, not just errors), use `--strict-segments` always, execute per-block round-trip byte diff (reassemble block, diff resulting bytes against original) as the gate for every transcribed region — non-optional practice, catches addressing-mode drift and alignment mistakes immediately. **Mandatory practice, one-line fix, high leverage.**

## Implications for Roadmap

### Suggested Phase Structure

**Phase 1: Recovery & Provenance**
- **Deliverable:** `recovery/clean/bruce-lee.bin` (canonical recovered image) + `recovery/PROVENANCE.md` (byte-range confidence ledger)
- **Rationale:** Hard gate for everything downstream. Live-memory approach: run each cracked disk under VICE, defeat loaders (TCS-CRUNCH! for `danish.d64`, SSG for `saeger.d64`), snapshot at known-good moment, extract full RAM image (with `$01` port configuration logged). Diff both recovered images byte-for-byte, partition results into (loader code / intro / actual game logic), assign confidence tiers per region.
- **Duration:** HIGH effort. This determines everything downstream.
- **Research flags:** Two open questions requiring empirical answer: (a) Are `danish` and `saeger` cracks genuinely independent? (b) Does VICE's RAM initialization determinism and frame-pacing guarantee deterministic checkpoint replay?

**Phase 2: Verification Harness Infrastructure + Baseline Capture** *(parallel with Phase 1, fully independent)*
- **Deliverable:** `verify/runner.mjs`, input scripts, checkpoint definitions, original baselines recorded
- **Rationale:** No dependency on disassembly — only needs recovered image. Establish this day one so verification is not waiting at the end. Design checkpoint set by analyzing what game-state RAM matters (score, lives, room, player/enemy positions, AI variables), not blind full-RAM hash.
- **Duration:** MEDIUM effort. Heavy design work, lighter implementation.

**Phase 3: Code/Data Mapping & Annotation**
- **Deliverable:** Annotated disassembly (every reachable routine labeled), hazard catalogue (self-modifying code, raw jump tables, page-alignment dependencies identified)
- **Rationale:** Per-subsystem, parallel across subsystems. Live-trace instrumentation (watchpoints, coverage bitmap) + static reachability = real coverage metric.
- **Duration:** HIGH effort. Core understanding work.

**Phase 4: ACME Reconstruction & Round-Trip Verification**
- **Deliverable:** `src/` (reassemblable ACME source per subsystem), `build/bruce-lee.prg` (working executable)
- **Rationale:** Immediate gate: per-block round-trip byte diff (reassemble each block, diff against original, must match). Build with `-Wtype-mismatch`, `--strict-segments`, treat all warnings as blocking.
- **Duration:** HIGH effort. Largely mechanical once Phase 3 is solid, but discipline-heavy.

**Phase 5: Documentation & Data Extraction**
- **Deliverable:** Memory map (generated + hand-written prose), per-subsystem docs, data format specs, extracted assets
- **Rationale:** Write the explanation layer. Memory map auto-generated from `.sym` + hand-written prose. Per-subsystem docs cite `src/` labels by name. Confidence tags on every region.
- **Duration:** MEDIUM-HIGH effort.

**Phase 6: .d64 Packaging & Final Verification**
- **Deliverable:** `build/bruce-lee.d64` (bootable disk), final verification report
- **Rationale:** Resolve `.d64` tooling (c1541 vs. custom writer). Run full verification suite, report divergences.
- **Duration:** LOW-MEDIUM effort.

**Phase 7: Hardening & Readability Refactoring** *(conditional, post-"verified" gate)*
- **Deliverable:** Code comments improved, symbol names refined, docs polished
- **Rationale:** Once core verification passes, restructure for readability without changing behavior. Each refactor checked via round-trip byte diff (should be 100% match on pure reorganization).
- **Duration:** LOW effort, high value.

### Hard Dependencies & Parallel Streams

**Hard gates:**
1. Both images recovered + one clean canonical base → all downstream
2. Disassembly per subsystem → hazard catalogue → safe splitting (per subsystem)
3. First assemble-able `src/` → first `build/.prg`
4. `.prg` exists → `.d64` packaging
5. Baseline + rebuild both exist → verification

**Parallel streams:**
- Verification harness + baseline fully parallel with recovery/annotation/source
- Per-subsystem documentation and source parallel across subsystems
- Data format extraction parallel per type, each gated only by its subsystem's disassembly
- `.d64` packaging research small, self-contained, blocks only itself

### Byte-Identical Reconciliation

**PITFALLS.md recommends** per-block round-trip byte diff as **development-time check** (reassemble each block, diff against original).

**ARCHITECTURE.md suggests** byte-identical `.prg` as **pure-reorganisation sanity check** (if you only split files without logic change, result should be byte-identical).

**PROJECT.md rejected** byte-identical as **project-level correctness gate** (verification is behavioral, not `cmp`-based).

**These are complementary, not contradictory:**
- Per-block round-trip diff is a **local quality check** during Phase 4 reconstruction
- Byte-identical check is a **structural invariant** during Phase 7 refactoring
- Behavioral equivalence (replay + checkpoints) is the **final acceptance gate**, allowing restructuring after verification

Use all three: (1) per-block round-trip diffs during transcription, (2) byte-identical check on pure reorganization, (3) behavioral verification throughout.

---

## Unresolved Tooling Decisions (Must Resolve Phase 0)

| Decision | Options | Recommendation |
|----------|---------|-----------------|
| **`.d64` writing** | (a) c1541 standalone, (b) custom Python writer | Try (a) first; (b) is low-risk fallback |
| **Bootstrap into VICE** | (a) MCP attach/boot tool, (b) snapshot_load | Confirm which; if (b), capture once, reuse |
| **Regenerator2000** | Upgrade from `toacme` | MEDIUM priority: `toacme` works now, regenerator2000 is improvement, not blocker |

---

## Two Key Open Questions (Affect Core Viability)

**1. Are the two cracks genuinely independent?**
If common-ancestor is discovered, "both agree" evidence loses force. Check release notes / cracktro credits during Phase 1. Informs confidence retroactively.

**2. Does VICE guarantee deterministic checkpoint replay?**
Two identical input-script runs must produce identical framebuffer/RAM at checkpoints. Test during Phase 2 baseline capture (run once, then again with same script, diff results). If they diverge, document and adjust harness expectations.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| **Stack** | HIGH | Verified in-container (ACME, VICE, Python). MEDIUM for regenerator2000 (not hands-on yet). |
| **Features** | MEDIUM-HIGH | Verified against published RE projects. No prior Bruce Lee C64 disassembly found (absence verified). |
| **Architecture** | HIGH | Verified against ACME 0.97 docs. Prior-art patterns validated. |
| **Pitfalls** | MEDIUM-HIGH | ACME claims verified. C64 facts well-established. Pitfalls 1, 5, 6 are known patterns. Pitfalls 4, 7 need empirical validation during phases. |
| **Overall** | MEDIUM-HIGH | Two open empirical questions are expected and do not block phases. |

### Gaps to Address

1. **Crack independence (empirical):** Examine release artifacts during Phase 1.
2. **Emulator determinism (empirical):** Test during Phase 2 baseline capture.
3. **`.d64` tooling (research spike, Phase 0):** Resolve `c1541` availability.
4. **Bootstrap method (Phase 2):** Confirm MCP tool naming for load/boot.
5. **Regenerator2000 (Phase 3):** Attempt `cargo install regenerator2000` once Phase 1 completes.
6. **On-demand loading in Bruce Lee (Phase 1 finding):** Full play-through post-dump will answer.

---

## Sources

### Primary (HIGH — verified in-container)
- ACME 0.97 at `/usr/bin/acme`, documentation at `/usr/share/doc/acme/`
- `dpkg -L acme`, `which toacme` — verified present
- Project files: PROJECT.md, .mcp.json

### Secondary (MEDIUM — GitHub + community docs)
- regenerator2000, vice-mcp, gridrunner, iridisalpha, weltendaemmerung, sim6502 (all GitHub, direct inspection)
- PyPI d64 library documentation

### Tertiary (LOW-MEDIUM — needs validation)
- TCS-CRUNCH signature: web search found zero documented references (validates "genuinely obscure")
- VICE power-on RAM pattern: web-sourced, needs verification during Phase 2

---

*Research completed: 2026-07-30*
*Synthesized from: STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md, PROJECT.md*
*Ready for roadmap creation*
