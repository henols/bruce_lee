# Requirements: Bruce Lee — Reverse Engineering & ACME Reconstruction

**Defined:** 2026-07-30
**Core Value:** An ACME source tree that rebuilds a Bruce Lee which plays identically to the original, where every gameplay system is explained well enough that someone could change it.
**Active milestone:** v1.1 — Emulator Access Hardened (Phases 01.3–01.6, 0 requirements — tooling)
**Paused behind it:** v1.0 — Pipeline Proven (Phases 1–4, 25 requirements)

## Milestone Map

| Milestone | Phases | Reqs | Delivers |
|---|---|---|---|
| **v1.1 — Emulator Access Hardened** *(active, inserted 2026-08-02)* | 01.3–01.6 | 0 (tooling) | Every proxy tool reaches the agent that needs it; a dead or wedged instance costs one acquisition, not the session; the broker never warms, grants or retains an instance that is not real; broker coordination moves into Node behind a TCP control plane. Deliverable is **live emulator work that survives its own failure modes**. |
| **v1.0 — Pipeline Proven** *(paused behind v1.1)* | 1–4 | 25 | Clean canonical image with per-byte provenance, full code/data map, working replay-verification harness with the original's baselines, and one subsystem driven end-to-end to a verified `.prg`. Deliverable is a **proven pipeline**. |
| **v2.0 — Complete Reconstruction** | 5–7 | 21 | All remaining subsystems documented and reconstructed, formats proven by replaying their re-serialised output, listing complete, source split, bootable `.d64`, full replay suite passing. **This is where "fully documented and recompiled" is met.** |
| **v3.0 — Editable** | not yet phased | 6 | Round-trip asset converters and the change guide + chamber editor. |

**Scope note.** v1.0 deliberately ships short of the original project goal in order to de-risk it — every pipeline stage is proven on one subsystem before scaling out. A v1.0 close is not project completion; v2.0 is.

**v1.1 carries no requirements, deliberately.** Phases 01.1, 01.2 and 01.3 already set this precedent: tooling insertions are ROADMAP-only and the requirement-coverage gate reads them as unmapped by design. The 25 requirements below are RE-domain scope and are **untouched** by the v1.1 insertion — v1.0 is paused, not closed, and `/gsd-complete-milestone` must not be run against it.

## v1.0 Requirements — Pipeline Proven (active)

Phases 1–4. These are the checkable, committed scope right now.

### Recovery & Provenance — Phase 1

The subject exists only as two cracked releases, one of them crunched. Nothing downstream can start until a clean, trustworthy memory image exists and its bytes carry known provenance.

- [x] **RECOVER-01**: Both disk images boot under host VICE through the MCP tool surface via a documented, repeatable procedure that never calls `vice_disk_list`
- [x] **RECOVER-02**: A clean RAM image is captured from `danish.d64` after its `TCS-CRUNCH!` decrunch completes, with dump trigger, `$01` port configuration, and captured address ranges all recorded
- [x] **RECOVER-03**: A clean RAM image is captured from `saeger.d64` (SSG release) under the same recorded procedure
- [ ] **RECOVER-04**: Dump completeness is proven by a full play-through after the dump point that detects any on-demand loading, with a supplementary dump captured for every load event found
- [x] **RECOVER-05**: Both recovered images are normalised to the same fully-loaded state and base address so that a byte-level diff between them is meaningful
- [x] **RECOVER-06**: Every byte range in the recovered image carries a provenance verdict — original Datasoft, cracker-modified, or uncertain — with the evidence recorded for each verdict
- [ ] **RECOVER-07**: Whether the two cracks are genuinely independent or share a common ancestor is determined and recorded, because it sets how much weight a "both releases agree" verdict carries
- [ ] **RECOVER-08**: One recovered image is designated the canonical disassembly subject, with the reason it was chosen over the other recorded

### Code & Data Mapping — Phase 2

- [ ] **MAP-01**: Live execution tracing under emulation produces a coverage map classifying each byte of the canonical image as executed-code, read-as-data, or never-touched
- [ ] **MAP-02**: Every routine reachable during gameplay is labelled, and the labels are emitted as a symbol file loadable into VICE for live debugging
- [ ] **MAP-03**: A hazard catalogue records every construct that constrains reconstruction: self-modifying code, computed-jump and RTS-dispatch tables, page-alignment-sensitive data, and any illegal/undocumented opcodes
- [ ] **MAP-04**: A memory map documents what the game keeps where — zero-page variables, buffers, table locations, VIC bank layout, and hardware register usage
- [ ] **MAP-05**: Coverage is reported as an explicit number so remaining unknown regions are visible rather than implied
- [ ] **MAP-06**: Every cracker-modified range carries a *function* verdict alongside its origin verdict — loader, cracktro, or gameplay-altering — and any gameplay-altering patch (a trainer) is catalogued with what it changes, found by signature hunt as well as by diff, because a two-release diff cannot detect a trainer both releases contain

### Verification Harness & Baselines — Phase 3

Scheduled before any rebuild exists, because baseline capture needs only the recovered image plus harness plumbing.

- [ ] **VERIFY-01**: A deterministic input script format and a replay driver over the `vice_*` MCP tools can drive a run reproducibly from reset
- [ ] **VERIFY-02**: Emulator determinism is proven — the same input script run twice produces identical state at every checkpoint — and any nondeterminism found is documented and worked around
- [ ] **VERIFY-03**: The checkpoint set is defined from the memory map as a curated set of game-state regions plus framebuffer, not a blind full-RAM hash, with the reason each region is included recorded
- [ ] **VERIFY-04**: Baselines are captured from the original canonical image and committed as the reference the rebuild is judged against

### Vertical Slice — Sprite & Display Pilot — Phase 4

One subsystem through every stage. The documented subsystem is the artifact; the proven pipeline is the point.

- [ ] **DOCS-01**: Sprite handling and display are documented — how the game gets its actors on screen, including any multiplexing, sprite pointer management, and VIC configuration
- [ ] **DATA-02**: The sprite data format is specified, and all sprites are extracted to viewable images
- [ ] **BUILD-01**: The ACME source tree assembles with ACME 0.97 under `--strict-segments` with zero warnings, and any warning fails the build
- [ ] **BUILD-02**: A transcribed region is promoted only when replaying the scenarios that exercise it diverges nowhere against the baselines, so addressing-mode drift and alignment mistakes — ACME silently widening a zero-page operand to 16-bit absolute shifts every following address — surface at transcription time rather than at the end
- [ ] **BUILD-03**: The build emits a `.prg` at the game's load address that runs in VICE
- [ ] **BUILD-04**: The build emits a VICE label file from the source, so source, documentation, and debugger share one set of names
- [ ] **VERIFY-05**: The rebuild is compared against the baselines, and any divergence is reported precisely enough to act on — which checkpoint, which memory region, what differed

## v2.0 Requirements — Complete Reconstruction

Phases 5–7. Phased and mapped, but not the active milestone. Promoted into the checkable set by `/gsd-new-milestone` at v1.0 close.

### Actors — Phase 5

- **DOCS-02**: Player movement is documented — the walk/crouch/jump/climb model, screen boundaries, and how position is represented
- **DOCS-03**: The move set and combat resolution are documented — punch, kick, flying kick, hit detection, hit reaction, and how a strike is arbitrated
- **DOCS-04**: Yamo's AI is documented — his state machine, decision inputs, attack behaviour, and how he differs from the Ninja
- **DOCS-05**: The Ninja's AI is documented — his state machine, pursuit behaviour, and attack pattern
- **DATA-04**: The animation frame table format is specified, and each actor's animation sequences are extracted

### World, Audio & Shell — Phase 6

- **DOCS-06**: Chamber structure and flow are documented — how the 20 chambers are represented, how exits link them, and how the lantern objective drives progression
- **DOCS-07**: Traps and hazards are documented — each hazard type, its trigger condition, and its effect on the player
- **DOCS-08**: Scoring, lives, and the two-player modes are documented, treating the distinct two-player behaviours separately
- **DOCS-09**: Sound is documented — SID usage, music and effect playback, and how audio is driven from gameplay events
- **DOCS-10**: Title screen, attract behaviour, and hi-score entry are documented lightly — enough to explain what the code does and where it lives, without deep analysis
- **DATA-01**: The chamber/level data format is specified, and all 20 chambers are extracted to an inspectable form
- **DATA-03**: The character set and background graphics format is specified and extracted to viewable images
- **DATA-05**: The music and sound effect data format is specified
- **DATA-06**: Each format spec is validated by feeding the re-serialised extraction back into the build and replaying the scenarios that exercise it — a spec whose output drives the game to identical behaviour at every checkpoint is correct rather than merely plausible

### Completion & Packaging — Phase 7

- **DOCS-11**: An annotated disassembly listing covers every routine reachable during gameplay, with each address resolved against the C64 memory map
- **BUILD-05**: The build emits a bootable `.d64` that starts the game the way the original disk does
- **BUILD-06**: The whole build runs from a single command, and the resolved `.d64` writing tool is committed and documented
- **BUILD-07**: Source is split into per-subsystem files matching the documentation structure, with any split that would break address-dependent code identified and avoided
- **BUILD-08**: The default build emits no cheat or debug code at all — every cheat, whether inherited from a crack or added as an RE aid, sits behind an ACME conditional-assembly switch and is named in one registry recording what it does, which addresses it touches, and why it exists, so the default `.prg` plays as the original shipped
- **VERIFY-06**: The replay suite exercises all 20 chambers, both opponents, the full move set, and both two-player modes, so passing verification means something
- **VERIFY-07**: The rebuild passes the full replay suite with no divergence — the reconstruction's definition of done

## v3.0 Requirements — Editable

Acknowledged and deliberately deferred. Not yet phased.

### Round-Trip Assets

- **ASSET-01**: Build-time converters turn extracted images back into the game's binary tables, so editing a source image changes the game
- **ASSET-02**: Chamber layouts are editable in their extracted form and converted back at build time
- **ASSET-03**: Animation sequences are editable in their extracted form and converted back at build time
- **ASSET-04**: The asset pipeline is wired into the single build command without disturbing the verified reconstruction build path

### Extension

- **EXT-01**: A guide documents how to change the game — where to edit, what will break, what verification will catch
- **EXT-02**: A chamber editor built on the v3.0 round-trip pipeline

## Out of Scope

Explicitly excluded, with reasoning, to prevent re-adding.

| Feature | Reason |
|---------|--------|
| Byte-identical rebuild, at any stage and in any role | Would forbid restructuring source for readability, which conflicts directly with the "base to build on" driver. Behaviour is the only gate — checkpoint replay against the baselines decides whether a region, a format spec, or the whole rebuild is correct (BUILD-02, DATA-06, VERIFY-05, VERIFY-07). No byte comparison is a gate, a promotion bar, or a definition of done anywhere in this project. |
| Round-trip asset converters before v3.0 | Wanted later, not now. v1.0/v2.0 still write and validate the format specs (DATA-01..06), so v3.0 becomes a build-pipeline addition rather than a research project. |
| Deep documentation of title screen / hi-score entry | Chosen coverage floor is gameplay systems. They execute, so they are in the rebuild and get light documentation (DOCS-10), but detailed effort goes where the craft is. |
| Documenting the crackers' loaders and cruncher as subjects | TCS and SSG code is an obstacle to get past and to attribute, not the object of study. Analysed only as far as RECOVER-02/03/06 require. |
| Cycle-exact timing reproduction | Not a stated goal, and verification compares observable state at checkpoints rather than raster timing. Would multiply effort for no gain against the Core Value. |
| New gameplay features, levels, or a remake | v1.0 and v2.0 reproduce and explain. Extension is what the v3.0 data layer exists to enable. |
| Level editor before v3.0 | Depends on the round-trip pipeline. Building it against verbatim byte tables would mean building it twice. |
| Atari 8-bit port comparison as scheduled work | Research found no public technical material on the ports to compare against, so this cannot be planned as a deliverable. Fine as opportunistic evidence if something surfaces. |
| Treating community sprite rips or third-party toolkits as authoritative | Provenance standards require evidence from the binary itself. External artifacts are hints for where to look, never source data. |
| Static depacking of `TCS-CRUNCH!` | No public signature or unpacker for this cruncher was findable, and the available static tools are Windows binaries needing Wine with no guarantee of recognising it. Live-memory recovery sidesteps identifying the cruncher at all. |

## Traceability

Which milestone and phase cover which requirements.

| Requirement | Milestone | Phase | Status |
|-------------|-----------|-------|--------|
| RECOVER-01 | v1.0 | Phase 1 | Complete |
| RECOVER-02 | v1.0 | Phase 1 | Complete |
| RECOVER-03 | v1.0 | Phase 1 | Complete |
| RECOVER-04 | v1.0 | Phase 1 | Pending |
| RECOVER-05 | v1.0 | Phase 1 | Done (01-05) |
| RECOVER-06 | v1.0 | Phase 1 | Done (01-05) |
| RECOVER-07 | v1.0 | Phase 1 | Pending |
| RECOVER-08 | v1.0 | Phase 1 | Pending |
| MAP-01 | v1.0 | Phase 2 | Pending |
| MAP-02 | v1.0 | Phase 2 | Pending |
| MAP-03 | v1.0 | Phase 2 | Pending |
| MAP-04 | v1.0 | Phase 2 | Pending |
| MAP-05 | v1.0 | Phase 2 | Pending |
| MAP-06 | v1.0 | Phase 2 | Pending |
| VERIFY-01 | v1.0 | Phase 3 | Pending |
| VERIFY-02 | v1.0 | Phase 3 | Pending |
| VERIFY-03 | v1.0 | Phase 3 | Pending |
| VERIFY-04 | v1.0 | Phase 3 | Pending |
| DOCS-01 | v1.0 | Phase 4 | Pending |
| DATA-02 | v1.0 | Phase 4 | Pending |
| BUILD-01 | v1.0 | Phase 4 | Pending |
| BUILD-02 | v1.0 | Phase 4 | Pending |
| BUILD-03 | v1.0 | Phase 4 | Pending |
| BUILD-04 | v1.0 | Phase 4 | Pending |
| VERIFY-05 | v1.0 | Phase 4 | Pending |
| DOCS-02 | v2.0 | Phase 5 | Pending |
| DOCS-03 | v2.0 | Phase 5 | Pending |
| DOCS-04 | v2.0 | Phase 5 | Pending |
| DOCS-05 | v2.0 | Phase 5 | Pending |
| DATA-04 | v2.0 | Phase 5 | Pending |
| DOCS-06 | v2.0 | Phase 6 | Pending |
| DOCS-07 | v2.0 | Phase 6 | Pending |
| DOCS-08 | v2.0 | Phase 6 | Pending |
| DOCS-09 | v2.0 | Phase 6 | Pending |
| DOCS-10 | v2.0 | Phase 6 | Pending |
| DATA-01 | v2.0 | Phase 6 | Pending |
| DATA-03 | v2.0 | Phase 6 | Pending |
| DATA-05 | v2.0 | Phase 6 | Pending |
| DATA-06 | v2.0 | Phase 6 | Pending |
| DOCS-11 | v2.0 | Phase 7 | Pending |
| BUILD-05 | v2.0 | Phase 7 | Pending |
| BUILD-06 | v2.0 | Phase 7 | Pending |
| BUILD-07 | v2.0 | Phase 7 | Pending |
| BUILD-08 | v2.0 | Phase 7 | Pending |
| VERIFY-06 | v2.0 | Phase 7 | Pending |
| VERIFY-07 | v2.0 | Phase 7 | Pending |

**Coverage:**

- Phased requirements: 46 total
- Mapped to phases: 46 ✓
- Unmapped: 0 ✓
- v1.0 (active): 25 · v2.0: 21 · v3.0 (not yet phased): 6

**Per-phase totals:** Phase 1: 8 · Phase 2: 6 · Phase 3: 4 · Phase 4: 7 · Phase 5: 5 · Phase 6: 9 · Phase 7: 7

---
*Requirements defined: 2026-07-30*
*Last updated: 2026-08-08 — added MAP-06 and BUILD-08 from the /gsd-explore session on cheat policy (see `.planning/notes/cheat-policy-and-build-time-switch.md`)*
