# Requirements: Bruce Lee — Reverse Engineering & ACME Reconstruction

**Defined:** 2026-07-30
**Core Value:** An ACME source tree that rebuilds a Bruce Lee which plays identically to the original, where every gameplay system is explained well enough that someone could change it.

## v1 Requirements

Requirements for the initial milestone. Each maps to exactly one roadmap phase.

### Recovery & Provenance

The subject exists only as two cracked releases, one of them crunched. Nothing downstream can start until a clean, trustworthy memory image exists and its bytes carry known provenance.

- [ ] **RECOVER-01**: Both disk images boot under host VICE through the MCP tool surface via a documented, repeatable procedure that never calls `vice_disk_list`
- [ ] **RECOVER-02**: A clean RAM image is captured from `danish.d64` after its `TCS-CRUNCH!` decrunch completes, with dump trigger, `$01` port configuration, and captured address ranges all recorded
- [ ] **RECOVER-03**: A clean RAM image is captured from `saeger.d64` (SSG release) under the same recorded procedure
- [ ] **RECOVER-04**: Dump completeness is proven by a full play-through after the dump point that detects any on-demand loading, with a supplementary dump captured for every load event found
- [ ] **RECOVER-05**: Both recovered images are normalised to the same fully-loaded state and base address so that a byte-level diff between them is meaningful
- [ ] **RECOVER-06**: Every byte range in the recovered image carries a provenance verdict — original Datasoft, cracker-modified, or uncertain — with the evidence recorded for each verdict
- [ ] **RECOVER-07**: Whether the two cracks are genuinely independent or share a common ancestor is determined and recorded, because it sets how much weight a "both releases agree" verdict carries
- [ ] **RECOVER-08**: One recovered image is designated the canonical disassembly subject, with the reason it was chosen over the other recorded

### Code & Data Mapping

- [ ] **MAP-01**: Live execution tracing under emulation produces a coverage map classifying each byte of the canonical image as executed-code, read-as-data, or never-touched
- [ ] **MAP-02**: Every routine reachable during gameplay is labelled, and the labels are emitted as a symbol file loadable into VICE for live debugging
- [ ] **MAP-03**: A hazard catalogue records every construct that constrains reconstruction: self-modifying code, computed-jump and RTS-dispatch tables, page-alignment-sensitive data, and any illegal/undocumented opcodes
- [ ] **MAP-04**: A memory map documents what the game keeps where — zero-page variables, buffers, table locations, VIC bank layout, and hardware register usage
- [ ] **MAP-05**: Coverage is reported as an explicit number so remaining unknown regions are visible rather than implied

### Subsystem Documentation

Each document explains how a system works in prose and diagrams, cites the actual labels and addresses in the disassembly rather than paraphrasing, and tags claims with confidence.

- [ ] **DOCS-01**: Sprite handling and display are documented — how the game gets its actors on screen, including any multiplexing, sprite pointer management, and VIC configuration
- [ ] **DOCS-02**: Player movement is documented — the walk/crouch/jump/climb model, screen boundaries, and how position is represented
- [ ] **DOCS-03**: The move set and combat resolution are documented — punch, kick, flying kick, hit detection, hit reaction, and how a strike is arbitrated
- [ ] **DOCS-04**: Yamo's AI is documented — his state machine, decision inputs, attack behaviour, and how he differs from the Ninja
- [ ] **DOCS-05**: The Ninja's AI is documented — his state machine, pursuit behaviour, and attack pattern
- [ ] **DOCS-06**: Chamber structure and flow are documented — how the 20 chambers are represented, how exits link them, and how the lantern objective drives progression
- [ ] **DOCS-07**: Traps and hazards are documented — each hazard type, its trigger condition, and its effect on the player
- [ ] **DOCS-08**: Scoring, lives, and the two-player modes are documented, treating the distinct two-player behaviours separately
- [ ] **DOCS-09**: Sound is documented — SID usage, music and effect playback, and how audio is driven from gameplay events
- [ ] **DOCS-10**: Title screen, attract behaviour, and hi-score entry are documented lightly — enough to explain what the code does and where it lives, without deep analysis
- [ ] **DOCS-11**: An annotated disassembly listing covers every routine reachable during gameplay, with each address resolved against the C64 memory map

### Data Formats & Extraction

v1 specifies and extracts formats read-only. The ACME source keeps original byte tables verbatim; extracted files are documentation. Converters that feed data back into the build are deferred to v2, so extraction must be structured to leave that seam clean.

- [ ] **DATA-01**: The chamber/level data format is specified, and all 20 chambers are extracted to an inspectable form
- [ ] **DATA-02**: The sprite data format is specified, and all sprites are extracted to viewable images
- [ ] **DATA-03**: The character set and background graphics format is specified and extracted to viewable images
- [ ] **DATA-04**: The animation frame table format is specified, and each actor's animation sequences are extracted
- [ ] **DATA-05**: The music and sound effect data format is specified
- [ ] **DATA-06**: Each format spec is validated by round-tripping the extraction — re-serialising the extracted representation reproduces the original bytes exactly, proving the spec is correct rather than plausible

### ACME Reconstruction & Build

- [ ] **BUILD-01**: The ACME source tree assembles with ACME 0.97 under `--strict-segments` with zero warnings, and any warning fails the build
- [ ] **BUILD-02**: Every transcribed region passes a round-trip byte diff against the canonical image, catching addressing-mode drift and alignment mistakes at transcription time
- [ ] **BUILD-03**: The build emits a `.prg` at the game's load address that runs in VICE
- [ ] **BUILD-04**: The build emits a VICE label file from the source, so source, documentation, and debugger share one set of names
- [ ] **BUILD-05**: The build emits a bootable `.d64` that starts the game the way the original disk does
- [ ] **BUILD-06**: The whole build runs from a single command, and the resolved `.d64` writing tool is committed and documented
- [ ] **BUILD-07**: Source is split into per-subsystem files matching the documentation structure, with any split that would break address-dependent code identified and avoided

### Behavioural Verification

The acceptance gate. "Plays identically" is defined mechanically so it survives refactoring.

- [ ] **VERIFY-01**: A deterministic input script format and a replay driver over the `vice_*` MCP tools can drive a run reproducibly from reset
- [ ] **VERIFY-02**: Emulator determinism is proven — the same input script run twice produces identical state at every checkpoint — and any nondeterminism found is documented and worked around
- [ ] **VERIFY-03**: The checkpoint set is defined from the memory map as a curated set of game-state regions plus framebuffer, not a blind full-RAM hash, with the reason each region is included recorded
- [ ] **VERIFY-04**: Baselines are captured from the original canonical image and committed as the reference the rebuild is judged against
- [ ] **VERIFY-05**: The rebuild is compared against the baselines, and any divergence is reported precisely enough to act on — which checkpoint, which memory region, what differed
- [ ] **VERIFY-06**: The replay suite exercises all 20 chambers, both opponents, the full move set, and both two-player modes, so passing verification means something
- [ ] **VERIFY-07**: The rebuild passes the full replay suite with no divergence — the project's definition of done

## v2 Requirements

Acknowledged and deliberately deferred. Not in the current roadmap.

### Round-Trip Assets

- **ASSET-01**: Build-time converters turn extracted images back into the game's binary tables, so editing a source image changes the game
- **ASSET-02**: Chamber layouts are editable in their extracted form and converted back at build time
- **ASSET-03**: Animation sequences are editable in their extracted form and converted back at build time
- **ASSET-04**: The asset pipeline is wired into the single build command without disturbing the verified v1 build path

### Extension

- **EXT-01**: A guide documents how to change the game — where to edit, what will break, what verification will catch
- **EXT-02**: A chamber editor built on the v2 round-trip pipeline

## Out of Scope

Explicitly excluded, with reasoning, to prevent re-adding.

| Feature | Reason |
|---------|--------|
| Byte-identical rebuild as the acceptance gate | Would forbid restructuring source for readability, which conflicts directly with the "base to build on" driver. Byte comparison is still used as a *development-time* check per transcribed block (BUILD-02) and as a structural invariant on pure-reorganisation commits — just not as the project's definition of done. |
| Round-trip asset converters in v1 | Wanted later, not now. v1 still writes and validates the format specs (DATA-01..06), so v2 becomes a build-pipeline addition rather than a research project. |
| Deep documentation of title screen / hi-score entry | Chosen coverage floor is gameplay systems. They execute, so they are in the rebuild and get light documentation (DOCS-10), but detailed effort goes where the craft is. |
| Documenting the crackers' loaders and cruncher as subjects | TCS and SSG code is an obstacle to get past and to attribute, not the object of study. Analysed only as far as RECOVER-02/03/06 require. |
| Cycle-exact timing reproduction | Not a stated goal, and verification compares observable state at checkpoints rather than raster timing. Would multiply effort for no gain against the Core Value. |
| New gameplay features, levels, or a remake | v1 reproduces and explains. Extension is what the v2 data layer exists to enable. |
| Level editor in v1 | Depends on the v2 round-trip pipeline. Building it against verbatim byte tables would mean building it twice. |
| Atari 8-bit port comparison as scheduled work | Research found no public technical material on the ports to compare against, so this cannot be planned as a deliverable. Fine as opportunistic evidence if something surfaces. |
| Treating community sprite rips or third-party toolkits as authoritative | Provenance standards require evidence from the binary itself. External artifacts are hints for where to look, never source data. |
| Static depacking of `TCS-CRUNCH!` | No public signature or unpacker for this cruncher was findable, and the available static tools are Windows binaries needing Wine with no guarantee of recognising it. Live-memory recovery sidesteps identifying the cruncher at all. |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| RECOVER-01 | TBD | Pending |
| RECOVER-02 | TBD | Pending |
| RECOVER-03 | TBD | Pending |
| RECOVER-04 | TBD | Pending |
| RECOVER-05 | TBD | Pending |
| RECOVER-06 | TBD | Pending |
| RECOVER-07 | TBD | Pending |
| RECOVER-08 | TBD | Pending |
| MAP-01 | TBD | Pending |
| MAP-02 | TBD | Pending |
| MAP-03 | TBD | Pending |
| MAP-04 | TBD | Pending |
| MAP-05 | TBD | Pending |
| DOCS-01 | TBD | Pending |
| DOCS-02 | TBD | Pending |
| DOCS-03 | TBD | Pending |
| DOCS-04 | TBD | Pending |
| DOCS-05 | TBD | Pending |
| DOCS-06 | TBD | Pending |
| DOCS-07 | TBD | Pending |
| DOCS-08 | TBD | Pending |
| DOCS-09 | TBD | Pending |
| DOCS-10 | TBD | Pending |
| DOCS-11 | TBD | Pending |
| DATA-01 | TBD | Pending |
| DATA-02 | TBD | Pending |
| DATA-03 | TBD | Pending |
| DATA-04 | TBD | Pending |
| DATA-05 | TBD | Pending |
| DATA-06 | TBD | Pending |
| BUILD-01 | TBD | Pending |
| BUILD-02 | TBD | Pending |
| BUILD-03 | TBD | Pending |
| BUILD-04 | TBD | Pending |
| BUILD-05 | TBD | Pending |
| BUILD-06 | TBD | Pending |
| BUILD-07 | TBD | Pending |
| VERIFY-01 | TBD | Pending |
| VERIFY-02 | TBD | Pending |
| VERIFY-03 | TBD | Pending |
| VERIFY-04 | TBD | Pending |
| VERIFY-05 | TBD | Pending |
| VERIFY-06 | TBD | Pending |
| VERIFY-07 | TBD | Pending |

**Coverage:**
- v1 requirements: 44 total
- Mapped to phases: 0 ⚠️ (populated by roadmap creation)
- Unmapped: 44 ⚠️

---
*Requirements defined: 2026-07-30*
*Last updated: 2026-07-30 after initial definition*
