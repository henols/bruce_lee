# Bruce Lee — Reverse Engineering & ACME Reconstruction

## What This Is

A complete reverse engineering of the 1984 Commodore 64 game *Bruce Lee* (Datasoft / Ron J. Fortier), taking it apart down to individual bytes and rebuilding it from annotated ACME assembly source. The output is two intertwined artifacts: a documentation set that explains how every gameplay system works, and a buildable source tree that produces a game which plays identically to the original.

The documentation and the rebuild are not separate deliverables — the rebuild is the proof that the documentation is correct.

## Core Value

An ACME source tree that rebuilds a Bruce Lee which plays identically to the original, where every gameplay system is explained well enough that someone could change it.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Recover the original game code from both cracked disk images (defeat crack loader + TCS cruncher) and produce a clean, disassemblable memory image
- [ ] Diff the two recovered images to separate original Datasoft bytes from cracker patches, establishing provenance for every byte
- [ ] Produce an annotated disassembly where every reachable routine is labeled and commented, with all addresses resolved against the C64 memory map
- [ ] Produce a full memory map documenting zero-page variables, buffers, table locations, and VIC bank layout
- [ ] Document each gameplay subsystem in prose + diagrams: sprite multiplexing, animation/move tables, collision & combat resolution, Yamo and Ninja AI, room/screen flow, scoring, sound
- [ ] Reverse and specify the in-memory data formats (level layout, sprite/charset graphics, animation frame tables, music) and extract them to inspectable files
- [ ] Rebuild from ACME source into a `.prg` that runs in VICE
- [ ] Package the rebuild as a bootable `.d64` disk image
- [ ] Automated verification: scripted joystick input replayed through the VICE MCP against original and rebuild, comparing framebuffer hash and game-state RAM at defined checkpoints

### Out of Scope

- **Byte-identical rebuild** — Chose functional equivalence instead. Byte-exactness would forbid restructuring the source for readability, which conflicts with "a base to build on." Verification is behavioural, not `cmp`-based.
- **Round-trip asset converters** — Deferred to v2. Editing a PNG to change the game is wanted *later*; v1 keeps original byte tables verbatim in the source and treats extracted assets as read-only documentation.
- **Deep documentation of title screen and hi-score entry** — Documented lightly. They execute (so they are in the rebuild), but detailed analysis effort goes to systems that make the game a game.
- **Documenting the crackers' own code as a subject** — TCS/SSG loaders and the cruncher get only enough analysis to get past them and to attribute patched bytes. They are an obstacle, not the object of study.
- **Cycle-exact timing reproduction** — Not a stated goal. Verification compares observable state at checkpoints, not raster timing.
- **New gameplay features, levels, or a remake** — v1 reproduces and explains. Extension is what the v2 data layer enables.

## Context

**The disk images available** (both in [disks/](../disks/), both cracked releases, neither an original Datasoft master):

| Image | Boot | Signature | Occupied |
|---|---|---|---|
| `danish.d64` | BASIC stub `SYS 2073` at t17/s0 | `TCS-CRUNCH!` — packed | tracks 9–17, 180 sectors |
| `saeger.d64` | BASIC stub `SYS 2161` at t1/s0 | `SSG`, disk name `XIDEX` | tracks 1–11, 216 sectors |

Both have faked directories — 0-block `BRUCE LEE` PRG entries pointing at bogus track/sector — and load via custom raw-sector loaders rather than the KERNAL. `danish.d64` is additionally crunched, so its game code is unreachable by static disassembly until depacked. This makes a live-memory approach (run it, break, dump) the practical route to a clean image, rather than static analysis of the disk bytes.

Having two independent cracks is an asset, not redundancy: bytes present in both releases are almost certainly original, and the differences localize cracker modifications.

**Toolchain in the devcontainer:**

- `acme` — installed at `/usr/bin/acme`
- VICE — runs on the *host*, reached over MCP (`vice_*` tools): memory read/write/search/compare, disassembly, checkpoints & watches, register access, sprite inspection, screenshots, joystick/keyboard injection, snapshots
- Missing: `c1541`, `petcat`, `exomizer`, `da65`, `cc1541` — disk-image writing and any static depacking will need tooling decided during research
- Existing skills: `acme-build` (assemble/link/scaffold), `c64-memory-mapping` (resolve addresses, annotate disassembly), `devcontainer-host-path` (translate workspace paths for host-side VICE)

**Known hazard:** `vice_disk_list` crashes the host MCP server and requires a manual VICE restart. Never call it. Disk directory inspection is done by parsing `.d64` bytes directly.

**Motivation** — three drivers, all active:

1. *Understand the craft* — how a 1984 8-bit game fits a multi-sprite fighting engine, 20 screens, and two AI opponents into a handful of KB
2. *A base to build on* — a source tree that can actually be changed later
3. *Preservation record* — a readable, buildable record that outlives the binary

Driver 1 sets documentation depth. Driver 2 sets source structure and pushes the data layer to be exposed early. Driver 3 sets completeness and provenance standards.

## Constraints

- **Tech stack**: ACME cross-assembler as the only assembler — Explicit project goal; the rebuild must assemble with ACME, so all source idioms must be ACME-compatible.
- **Tooling**: VICE lives on the host, reached only via MCP — All emulator interaction is tool-mediated; anything requiring host paths must go through the `devcontainer-host-path` skill.
- **Tooling**: No `c1541`/`exomizer`/`petcat` in the container — `.d64` packaging and any static depacking need a solution chosen during research.
- **Source material**: Only cracked releases available, no original master — Provenance must be *reconstructed* by diffing, not assumed. Every documented byte carries a confidence level.
- **Verification**: Behavioural equivalence only — Correctness is defined by replay + checkpoint comparison. Anything not observable at a checkpoint is not verified, so checkpoint design is a first-class task, not an afterthought.
- **Compatibility**: Rebuild must run on stock C64 in VICE — No host-side helpers, no emulator-only behaviour.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Functional equivalence, not byte-identical | Byte-exactness forbids restructuring for readability, which conflicts with "a base to build on". Behavioural verification is the gate instead. | — Pending |
| Diff both cracks to establish provenance | Two independent cracks separate original Datasoft bytes from cracker patches. Costs extra unpacking work up front, buys confidence in every documented byte. | — Pending |
| Recover original game code as the subject | Crack loaders and the cruncher are obstacles to get past, not the object of study. | — Pending |
| Automated replay + RAM diff verification | "Plays identically" is otherwise a judgement call at every phase boundary. A scripted, deterministic gate survives refactors. | — Pending |
| Gameplay-systems documentation depth | Concentrates effort where the craft lives. The *rebuild* still covers every executing byte — only doc depth is prioritized. | — Pending |
| Read-only asset extraction in v1 | Round-trip converters are wanted later; deferring them keeps v1 focused while the format specs still get written and validated by inspection. | — Pending |
| Emit both `.prg` and `.d64` | `.prg` gives fast build/test iteration; `.d64` is the deliverable that boots like the original. | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-30 after initialization*
