# Feature Research

**Domain:** 8-bit game reverse engineering / documentation / reconstruction (C64, *Bruce Lee* 1984)
**Researched:** 2026-07-30
**Confidence:** MEDIUM-HIGH (verified against multiple published RE projects; LOW confidence specifically flagged where noted)

## Prior Art Survey

Real published projects examined, with what they actually shipped:

| Project | What it is | Artifacts shipped | Confidence |
|---|---|---|---|
| [mwenge/iridisalpha](https://github.com/mwenge/iridisalpha) (Iridis Alpha, C64, Jeff Minter) | Full annotated disassembly + rebuild | Commented 6502 source in `src/`, `Makefile`, `OriginalGameManual.md`, `IridisAlphaDevelopmentDiary.md`, `TUNING.md`, `orig/` binary, `demos/` (recovered prototype mini-games found in the code), separate WIP book *Iridis Alpha Theory* for deep theory | HIGH — fetched and read directly |
| [mwenge/gridrunner](https://github.com/mwenge/gridrunner) (Gridrunner, C64, Jeff Minter) | Full disassembly + rebuild, with an explicit methodology writeup (`Disassembling.md`) | Hybrid static+dynamic method: Regenerator/Infiltrator for static disassembly, VICE snapshots loaded into Infiltrator when static analysis stalled, 64tass for reassembly, **MD5/byte-for-byte checksum verification against the original binary as the correctness gate**, iterative label renaming (`b1535` → `CopyLevelTextLoop`), CBM Prg Studio for charset visualization | HIGH — fetched and read directly |
| [Piddewitt/C64-Game-Source-Code](https://github.com/Piddewitt/C64-Game-Source-Code) (Loderunner, Castles of Dr Creep, + "enhanced" variants) | Multi-game disassembly collection, uniform structure | Per-game folders: `asm/`, `dis/` (raw disassembly), `inc/` (includes), `lst/` (assembler listings), `prg/` (binaries), `d64/`, `xtra/`; build scripts (`all.bat`, `asm.bat`, `dis.bat`); explicit goal stated as producing "an exact copy of the original binary" | HIGH — fetched and read directly |
| [pditincho / mm-explained](https://github.com/pditincho/mm-explained) (Maniac Mansion, C64) | Annotated disassembly with subsystem-level docs (rooms, costumes, scripts) per retroreversing.com | Comprehensive commented disassembly covering disk loader, VIC-II/SID interaction, room/costume/script data | MEDIUM — described via retroreversing.com survey page, not fetched directly (repo path attempted returned 404; likely renamed/moved) |
| [s-macke/weltendaemmerung](https://github.com/s-macke/weltendaemmerung) (Weltendämmerung, C64) | **Directly analogous precedent**: AI-assisted (Claude) reverse engineering of an obscure C64 strategy game | Custom Python 6502 disassembler splitting code/data; 2,700-line disassembly split into 12 modular `.asm` files; markdown specs per subsystem (memory layout, terrain, units, phases, save format); a web port as the "proof it's understood" artifact (this project's equivalent of our rebuild-as-proof) | HIGH — fetched and read directly |
| Super Mario Bros. NES disassembly family (multiple repos, e.g. smwcentral "meta-disassembly") | Full disassembly with CI | Makefile-driven build with **checksum/SHA-256 comparison against the original ROM in CI**, enforcing byte-identical reassembly as a hard gate on every commit | MEDIUM — synthesized from search results, not fetched directly |
| [jmechner/Prince-of-Persia-Apple-II](https://github.com/jmechner/Prince-of-Persia-Apple-II) + [videogamepreservation/princeofpersia](https://github.com/videogamepreservation/princeofpersia) | Original author's recovered source (not reverse-engineered, but the canonical "preservation record" precedent) + a fan (Adam Green) layer that reverse-engineered the surrounding build/boot process and wrote the tooling to actually produce bootable disk images from the recovered source | Original 6502/assembly source, disk-image recovery via specialist hardware (DiscFerret), fan-built instructions/helper code to reconstruct a bootable image | MEDIUM — synthesized from search results |
| [dmx / Vidar Bang — *Bruce Lee: Return of Fury*](https://www.retrogamernation.com/bruce-lee-return-of-fury-c64/) | Reverse engineering of **this exact game**, but oriented at a fan sequel, not publication | Built a custom C# C64 emulator to disassemble/document while playing; reached a "fully relocatable" disassembly by ~2018; rewrote hazard code, SFX engine, and music player while keeping original compositions/graphics and the original collision/state-machine "glitches" intentionally | MEDIUM — no public source or writeup found; described via retrogamernation.com and lemon64 forum threads. **No published disassembly, memory map, or documentation artifact from this effort could be located** — it exists as tacit knowledge in the author's private tooling and the shipped fan-game binary only |
| [5k3105/bruce](https://github.com/5k3105/bruce) | Toolkit/engine for building "Bruce-Lee-style" games, built with the original as reference | Go-based level editor (character map, color data, lantern placement — **level code is explicitly NOT yet linked, per its own README**), config files for doors and enemy behavior, VICE-monitor-over-TCP dev workflow, screenshots of door/sprite coordinate maps | HIGH — fetched and read directly. Confirms doors, lanterns, and enemy behavior are naturally separable data/config concerns for this exact game |
| The Spriters Resource — [Bruce Lee C64](https://www.spriters-resource.com/commodore_64/brucelee/) | Community sprite rip | Manually-ripped sprite/charset sheets (screenshot-derived, not ROM-verified) | LOW — useful as a sanity check for sprite appearance, not as ground truth; do not treat as authoritative source data |

**Bottom line on Bruce Lee prior art:** there is no publicly available annotated disassembly, memory map, or reconstructed source tree for the original Datasoft *Bruce Lee* (C64 or Atari 8-bit) that this project can build on. The closest prior art (dmx's *Return of Fury*) proves the game *is* fully reverse-engineerable by one dedicated person, and its design notes (hazard code as a distinct rewritable module, original collision/state-machine quirks treated as "the game's charm" and deliberately preserved) are useful design signal, but the technical artifact itself was never published. The 5k3105 toolkit corroborates that doors, lanterns, and enemy behavior tables are naturally-separable data formats — useful confirmation for our own data-format-extraction requirement. **This project would be the first public, documented, reassemblable disassembly of Bruce Lee C64** if completed — that is itself a differentiator, not just a feature.

No Atari 8-bit internals writeup was found either (Atari 8-bit was the lead platform per Datasoft credits — Ron J. Fortier — but no port-comparison technical material exists online). Treat any claim that the Atari version would "explain" C64 internals as unsupported; the platforms share design but not code layout (different CPU memory maps, no shared assembly).

## Feature Landscape

### Table Stakes (Without These the Project Is Incomplete)

These map directly to PROJECT.md's Active requirements — a serious RE project is judged first on whether these exist at all, before quality is assessed.

| Artifact | Why Expected | Complexity | Notes |
|---|---|---|---|
| Clean recovered memory image (crack + cruncher defeated) | Every published full disassembly (Iridis Alpha, Gridrunner, mm-explained, SMB) starts from a clean binary; static disassembly of packed/loader-obscured bytes is not possible | HIGH | Gridrunner and Iridis Alpha both used live-memory snapshotting (VICE → dump → static tool) exactly because raw disk bytes weren't directly disassemblable — this validates PROJECT.md's planned "run it, break, dump" approach |
| Provenance diff between the two cracked sources | Not universal in prior art (most projects had one clean source) but directly demanded by this project's "no original master" constraint; the two-crack diff is the substitute for a master | MEDIUM | Unique to this project's situation — no external precedent to copy verbatim, but the general principle ("establish confidence per byte") mirrors how mm-explained and Gridrunner treat any byte they haven't traced to a purpose as suspect |
| Annotated disassembly, every reachable routine labeled | Universal — every project surveyed treats this as the core deliverable, not a nice-to-have | HIGH | Gridrunner's label-renaming workflow (`b1535` → `CopyLevelTextLoop`) is the concrete pattern to follow |
| Full memory map (zero page, buffers, tables, VIC bank layout) | Universal — Iridis Alpha, Gridrunner, mm-explained, Weltendämmerung all ship this as a distinct document, not folded into inline comments only | MEDIUM | Best practice from Weltendämmerung: memory layout as its own markdown file, separate from the per-subsystem specs |
| Reassemblable source tree that builds with the target assembler | Universal — this is the actual proof-of-understanding artifact in every project surveyed | HIGH | Depends on: clean image + disassembly. ACME-compatible per project constraint |
| Per-subsystem prose documentation (movement, combat, AI, rooms, sprites, sound) | Universal in the mature projects (Iridis Alpha, mm-explained, Weltendämmerung); the projects that skip this (raw Piddewitt-style listings) read as "voluminous, not useful" — see the analysis below | HIGH | This is the single biggest differentiator between "documentation nobody reads" and "documentation a reader can build on" |
| Data format specifications (level layout, sprite/charset, animation tables, music) extracted to inspectable files | Universal — every mature project separates "what the data means" from "the disassembly of the code that reads it" | MEDIUM | Depends on: disassembly complete enough to identify the table-reading routines |
| `.prg` build + VICE run | Universal minimum bar — a disassembly that "compiles" but was never actually run/tested is a common failure mode call out in these communities (Lemon64 threads reference stalled RE efforts) | LOW (once source exists) | Depends on: reassemblable source tree |
| Bootable `.d64` package | Common (Piddewitt ships `d64/` per game; Prince of Persia's fan continuation specifically had to solve "how do I get this to boot" as a separate, non-trivial problem) | MEDIUM | `c1541`/`cc1541` (or equivalent) is currently missing from the container per PROJECT.md — this is a real blocker, not just an artifact task |
| Automated verification harness | Universal in the *rigorous* tier (SMB NES disassemblies gate every commit on checksum equality in CI; Gridrunner used MD5 comparison) — the C64 equivalent here is behavioral since byte-identical is explicitly out of scope | HIGH | This project's version (scripted joystick replay + framebuffer/RAM comparison via VICE MCP) is the correct C64-native adaptation of the NES "checksum in CI" pattern, since byte-identical is Out of Scope here |

### Differentiators (What Makes It Excellent, Not Just Adequate)

These are not required for "complete," but they are what separates a project people actually cite/reuse from one that just exists.

| Artifact | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Prose docs that reference disassembly labels/addresses directly (not paraphrase) | This is the single clearest quality signal across all projects surveyed. mm-explained and Weltendämmerung both write subsystem docs that name the actual routine/label, so a reader can jump from prose to code and back. Docs that only describe behavior in the abstract ("the AI chases the player") without anchoring to code are the ones nobody can build on | MEDIUM | Enhances every table-stakes doc; costs little beyond discipline in how docs are written |
| Confidence/provenance annotation per byte or region | Directly serves the "preservation record" driver in PROJECT.md and is *not* something most surveyed projects do (they mostly had one clean source, so provenance wasn't in question). This project's two-crack-diff constraint makes this differentiator effectively mandatory, elevating it above a typical nice-to-have | MEDIUM | Depends on: provenance diff table-stakes item above |
| Verification harness reusable for regression, not just one-time proof | SMB NES disassemblies run this in CI on every change. Doing the same here (checkpoint replay as a standing regression gate, not a one-off validation) means the source tree stays provably correct as it's refactored for readability — which matters *because* this project explicitly permits restructuring for readability (functional equivalence, not byte-identical) | HIGH | Depends on: verification harness (table stakes) + reassemblable source tree |
| Development-diary / "how this was actually figured out" narrative (Iridis Alpha's `IridisAlphaDevelopmentDiary.md`, Weltendämmerung's session log) | Serves "understand the craft" driver directly — readers report these are what make a disassembly memorable rather than just a reference. Costs little (write as you go) but is frequently skipped because it feels like overhead | LOW | No hard dependency; best written incrementally per phase rather than reconstructed at the end |
| Symbol file for the debugger (VICE labels file) | Makes the annotated disassembly *live* — load it into VICE and single-step with real names instead of raw addresses. Directly useful for the "base to build on" driver | LOW-MEDIUM | Depends on: disassembly complete enough to have stable label names; near-free once labels exist, ACME can emit a VICE-compatible label/symbol file |
| Cross-platform comparison notes (Atari 8-bit as lead platform, other ports) | Differentiator *if* comparable material existed to compare against — it largely doesn't publicly (see Prior Art Survey). Treat as opportunistic: if disassembly work surfaces a C64-specific workaround, a one-line note ("likely present because X, unlike other 8-bit ports where Y" ) adds value cheaply, but do not budget dedicated phase time to it | LOW | Not gated by anything; purely opportunistic, low-confidence findings only |
| Diagrams (room-link maps, sprite-multiplexing timeline, state-machine charts) | Iridis Alpha and Weltendämmerung both use these for spatial/stateful subsystems specifically because prose alone is hard to follow for a 20-room map or a per-scanline sprite schedule | MEDIUM | Depends on: the underlying subsystem doc existing in prose first; diagrams are additive, not a substitute |

### Anti-Features (Commonly Tempting, Should Not Be Built)

Cross-checked against PROJECT.md's existing Out of Scope list — all of PROJECT.md's exclusions are affirmed by this research as sound (no conflicting evidence found in prior art). Additional anti-features surfaced by the survey are added below and flagged as **new**.

| Anti-Feature | Why It's Tempting | Why Problematic | Alternative |
|---|---|---|---|
| Byte-identical rebuild *(PROJECT.md: Out of Scope — affirmed)* | Feels like the "purest" proof of understanding, and is literally what SMB NES disassemblies gate on in CI | Forbids restructuring for readability; SMB disassemblies pay for this rigor by leaving code deliberately awkward/unreadable in the exact-checksum tree, which conflicts directly with this project's "base to build on" driver | Behavioral verification (replay + checkpoint compare), as PROJECT.md already specifies |
| Round-trip asset converters *(PROJECT.md: Out of Scope — affirmed)* | 5k3105/bruce shows how appealing a level editor is once data formats are known; the temptation is to build the editor as soon as formats are understood | Turns a documentation/rebuild project into a tools project; scope creep risk is exactly what a "v1 keeps original byte tables verbatim" boundary is meant to prevent | Read-only extraction + format spec now; editor is a natural v2 differentiator once the base exists |
| Deep title-screen/hi-score documentation *(PROJECT.md: Out of Scope — affirmed)* | It's easy, self-contained, and satisfying to finish quickly | Effort there doesn't serve any of the three drivers (craft, base-to-build-on, preservation) — it's not where the interesting engineering is | Light coverage only, enough that it executes correctly in the rebuild |
| Documenting the crackers' code as a subject *(PROJECT.md: Out of Scope — affirmed)* | The crack loaders are genuinely clever (TCS cruncher, SSG loader) and it's tempting to treat reverse engineering them as its own interesting side quest | Diverts effort from the actual subject (the game); PROJECT.md is explicit that these are an obstacle, not the object of study | Document only enough to defeat the loader and attribute patched bytes; no deep technique writeup |
| Cycle-exact timing reproduction *(PROJECT.md: Out of Scope — affirmed)* | 8-bit RE culture has a strong "understand the raster trick" tradition (see retroreversing.com's Ocean loader writeup, which is *all* about raster-bar timing) and it's tempting to chase that rigor here too | Not needed for functional-equivalence verification, and adds a large research burden (cycle counting, badline analysis) disproportionate to this project's actual verification gate | Verification checks observable state at checkpoints, not raster timing, per PROJECT.md |
| New gameplay features / a remake *(PROJECT.md: Out of Scope — affirmed)* | Once a level editor and data formats exist (see 5k3105/bruce, dmx's Return of Fury), the natural next move in this community is "now make a new game with it" | This is a different project with a different core value; v1's job is to reproduce and explain, not extend | Extension is explicitly what the v2 data layer is *for* — defer, don't build now |
| **(New)** Building the level editor / modding tool in v1 | Directly enabled the moment data formats are understood, and 5k3105/bruce proves it's a natural, appealing next step | Not requested by PROJECT.md, not required by any Active requirement, and pulls effort into UI/tooling instead of documentation depth (the stated priority driver) | Format specs + read-only extracted files in v1 are the enabler; the editor itself is future work, consistent with "round-trip asset converters" already being deferred |
| **(New)** Chasing full Atari 8-bit port comparison as a phase-level goal | The "lead platform" framing in PROJECT.md's Context and this game's known multi-port history make comparative analysis feel valuable | No public technical material on the Atari 8-bit build exists (verified — see Prior Art Survey); pursuing this would mean *originating* a second full disassembly, which is an entirely separate project | Treat as opportunistic one-line notes only if something surfaces incidentally; never schedule dedicated research time against it |
| **(New)** Reproducing the original's collision/state-machine "glitches" as an explicit research target in themselves | dmx's *Return of Fury* explicitly preserved these as "part of the game's charm," which invites over-analyzing them as their own subsystem | Functional-equivalence + full disassembly automatically reproduces them (they're just what the original code does) — spending dedicated documentation effort explaining *why* a bug exists beyond what the code shows is effort with no reader payoff | Document quirks in-line, where they show up, as an artifact of collision/combat resolution code — not as a dedicated "here are the bugs" section |
| **(New)** Treating community sprite rips (e.g. Spriters Resource) as authoritative source data | They already exist, look plausible, and would save extraction work | These are manual, screenshot-derived rips, not verified against actual ROM charset/sprite memory — using them risks documenting the wrong bytes with false confidence, directly undermining the "preservation record" / provenance driver | Extract sprite and charset data directly from the recovered memory image; use community rips only as a visual sanity check, never as the documented source |

## Feature Dependencies

```
Clean recovered memory image (defeat crack + cruncher)
    └──requires──> nothing (first gate; foundation for everything below)

Provenance diff (danish.d64 vs saeger.d64)
    └──requires──> Clean recovered memory image (both copies)

Annotated disassembly (every reachable routine labeled)
    └──requires──> Clean recovered memory image
    └──enhanced-by──> Provenance diff (confidence annotation per routine)

Full memory map document
    └──requires──> Annotated disassembly (in progress; map firms up as labels stabilize)

Per-subsystem prose documentation
    └──requires──> Annotated disassembly (subsystem's routines identified)
    └──requires──> Full memory map (subsystem's variables/tables identified)

Data format specifications (level/sprite/anim/music)
    └──requires──> Annotated disassembly (table-reading routines identified)
    └──enables──> Extracted asset galleries (read-only, v1)
    └──enables──> Level editor / modding tool (v2, deferred — Anti-Feature in v1)
    └──enables──> Round-trip asset converters (v2, deferred — Anti-Feature in v1)

Reassemblable ACME source tree
    └──requires──> Annotated disassembly
    └──requires──> Full memory map
    └──requires──> Data format specifications (verbatim tables must be re-embedded correctly)

.prg build
    └──requires──> Reassemblable ACME source tree

Bootable .d64 package
    └──requires──> .prg build
    └──requires──> disk-image writing tool (c1541/cc1541 equivalent — currently missing, per PROJECT.md Context)

Verification harness (checkpoint replay + framebuffer/RAM diff)
    └──requires──> .prg build (rebuild to compare)
    └──requires──> Clean recovered memory image (original to compare against)
    └──requires──> checkpoint design (which states are "observable" — first-class task per PROJECT.md)

Confidence/provenance annotation
    └──requires──> Provenance diff
    └──enhances──> Annotated disassembly, Memory map, Subsystem docs (every artifact, retroactively)

Symbol/label file for VICE
    └──requires──> Annotated disassembly (stable label names)

Development diary / narrative
    └──enhances──> everything (write incrementally; no blocking dependency)

Cross-port comparison notes
    └──conflicts-with──> "no public Atari 8-bit material exists" (treat as opportunistic only, not schedulable)
```

### Dependency Notes

- **Everything downstream of the clean image is blocked until it exists.** This is the single hardest gate in the whole project — `danish.d64` cannot be statically disassembled at all until the TCS cruncher is defeated (live-memory dump), and both images need their crack loaders defeated before the underlying game code is reachable. This should be phase 1, full stop.
- **Provenance diff should happen right after both images are cleanly recovered, before heavy disassembly investment.** Diffing early means every subsequent labeling/documentation pass can carry a confidence tag from the start, rather than requiring a costly retrofit later.
- **Data format specs gate the source tree, not just the asset gallery.** The reassemblable source must re-embed the original tables verbatim (per PROJECT.md's "read-only asset extraction" decision) — so the format spec needs to be right *before* the source tree can claim completeness, not just before an extraction tool runs.
- **The verification harness needs checkpoint design work that is not "free" once the rebuild exists** — PROJECT.md is explicit that this is a first-class task. This argues for designing checkpoints in parallel with (not after) the subsystem documentation work, since a checkpoint for "sumo AI defeated player" is really just an operationalization of the AI documentation.
- **The bootable `.d64` package has an external tooling dependency that is currently unmet.** `c1541`/`cc1541` (or an equivalent raw-sector writer) is missing from the container per PROJECT.md's Context section — this is a blocker to resolve early (likely via installing a package or writing a minimal raw `.d64` writer), not a late-phase surprise.
- **Level editor / round-trip converters / new content are downstream of data format specs but are explicitly NOT to be built in v1** — flagging this dependency exists precisely so the roadmap doesn't accidentally schedule them "because the data's already there."

## MVP Definition

Framed against this project's actual Core Value ("an ACME source tree that rebuilds a Bruce Lee which plays identically to the original, where every gameplay system is explained well enough that someone could change it") rather than a generic launch — there's one delivery, not staged user validation, so "MVP" here means the smallest complete slice that satisfies Core Value.

### Launch With (v1 — matches PROJECT.md Active requirements exactly)

- [ ] Clean recovered memory image from both cracked disks — nothing else is possible without it
- [ ] Provenance diff establishing per-byte confidence — the substitute for a missing master
- [ ] Annotated disassembly of every reachable routine — the core artifact
- [ ] Full memory map — required reference for every subsystem doc
- [ ] Per-subsystem prose + diagrams (movement, combat, AI, rooms, sprites/multiplexing, sound) — where "understand the craft" lives
- [ ] Data format specs + read-only extracted asset files — required by "base to build on," constrained to read-only per PROJECT.md
- [ ] Reassemblable ACME source producing a working `.prg`
- [ ] Bootable `.d64` package
- [ ] Automated checkpoint-replay verification harness

### Add After Validation (v1.x — natural next step once v1 ships, not currently scheduled)

- [ ] VICE debugger symbol/label file export — cheap, high-value, no reason to defer except sequencing
- [ ] Development-diary narrative, polished into a readable writeup (if only captured as raw notes during v1) — trivial to defer since it should be written incrementally anyway

### Future Consideration (v2+ — explicitly deferred by PROJECT.md)

- [ ] Round-trip asset converters (PNG ↔ game data)
- [ ] Level editor / modding tool
- [ ] New gameplay content enabled by the exposed data layer
- [ ] Any dedicated cross-platform (Atari 8-bit) comparative disassembly — only pursue if this becomes its own project

## Feature Prioritization Matrix

| Artifact | Project Value | Implementation Cost | Priority |
|---|---|---|---|
| Clean recovered memory image | HIGH | HIGH | P1 |
| Provenance diff | HIGH | MEDIUM | P1 |
| Annotated disassembly | HIGH | HIGH | P1 |
| Memory map document | HIGH | MEDIUM | P1 |
| Per-subsystem prose + diagrams | HIGH | HIGH | P1 |
| Data format specs + read-only extraction | HIGH | MEDIUM | P1 |
| ACME source tree / `.prg` build | HIGH | HIGH | P1 |
| `.d64` packaging | HIGH | MEDIUM (blocked on missing tooling) | P1 |
| Verification harness | HIGH | HIGH | P1 |
| Symbol/label file for VICE | MEDIUM | LOW | P2 |
| Development diary | MEDIUM | LOW | P2 |
| Cross-port comparison notes | LOW | LOW | P3 (opportunistic only) |
| Level editor / modding tool | LOW (for v1 goal) | HIGH | Explicitly deferred — not on the matrix for this milestone |
| Round-trip asset converters | LOW (for v1 goal) | HIGH | Explicitly deferred — not on the matrix for this milestone |

## Bruce Lee Subsystem Checklist

Concrete enumeration for documentation-phase planning, derived from the game's known design (verified against Wikipedia's gameplay summary and cross-checked against the 5k3105/bruce toolkit's data-format assumptions):

1. **Player movement & traversal model** — walking, running, ducking, climbing ropes and ladders, jumping (including jump-arc/gravity handling and mid-air state). *Flag: likely non-trivial* — this is the state machine everything else (collision, combat) hooks into, and the "glitchy" collision behavior dmx preserved intentionally suggests real edge cases here.
2. **Combat move set** — punch, kick, and the flying kick (jump + kick combined), including how hit detection resolves against each enemy type and how the player can be hit in return. *Flag: likely non-trivial* — this is squarely a Driver-1 ("understand the craft") priority system.
3. **Yamo (the sumo-styled enemy)** — AI/behavior state machine, how it's driven by the computer vs by a second player in multiplayer mode (this is a mode-dependent subsystem, not purely AI), infinite-lives/respawn behavior.
4. **The Ninja** — separate AI/behavior state machine (bokken-stick attack), distinct patrol/chase logic from Yamo, infinite-lives/respawn behavior.
5. **Room/chamber structure and flow** — 20 chambers, each a single screen; how chambers link (progression order, whether it's linear or branching), and what varies per chamber (layout, hazard set, lantern placement). *Flag: needs an explicit diagram* — a 20-node map is exactly the kind of subsystem prose alone won't convey well (per the differentiator on diagrams above).
6. **Lanterns (the objective)** — placement data per chamber, collection detection, chamber-clear condition.
7. **Traps and hazards** — later-chamber hazards specifically: mines, moving walls, the electric-spark comb surface, plus the final chamber's confrontation with the Fire Wizard (a distinct boss subsystem, not just another hazard). *Flag: the Fire Wizard fight is likely a special-cased subsystem, not reducible to the generic hazard model.*
8. **Two-player mode behavior** — two distinct modes exist and must be documented as such: (a) player 2 controls Yamo against player 1's Bruce Lee, vs (b) two players alternately control Bruce Lee. These are functionally different systems (adversarial simultaneous vs turn-taking), not one mode with a flag.
9. **Scoring and lives** — point values per action/enemy, extra-life thresholds, game-loop behavior on completion (confirmed: the game loops after chamber 20, with faster/no-respawn-delay enemies and removed "safe spots" from the second loop onward — this loop-difficulty-escalation logic is its own small subsystem, easy to miss).
10. **Sprite multiplexing** — getting player + Yamo + Ninja + hazards + projectiles on screen simultaneously beyond the C64's native sprite limit; this is architecture-adjacent but the *table* driving it (which sprite slot each actor borrows, per-frame) is a data-format concern that belongs in both the disassembly and the data-format spec. *Flag: likely non-trivial* — this is the kind of "how did they fit this in a handful of KB" system Driver 1 is specifically about.
11. **Sound/music** — in-game SFX and music playback; PROJECT.md scopes this as "document," not necessarily full player-format reverse-engineering depth — treat at the same depth as other table-stakes subsystems, no more.
12. **Title screen / hi-score entry** — explicitly light-touch per PROJECT.md Out of Scope; include only enough to confirm it executes correctly in the rebuild.

**Subsystems flagged as likely to need deeper phase-specific research:** combat/collision resolution (#2, given the deliberately-preserved "glitchy" behavior), sprite multiplexing (#10), and the room-link/chamber-progression map (#5) as a diagramming task. Two-player mode (#8) is flagged not for difficulty but because it is easy to under-scope as "one mode" when it is actually two.

## Sources

**Primary sources — archived locally under `docs/`, retrieved 2026-08-03.** These four are the
list's first *primary* in-box source documents; everything below them is prior-art and community
material. See `docs/SOURCES.md` for full retrieval provenance, SHA-256 hashes, and confidence
grades.

- Bruce Lee manual scan, Mastertronic budget re-release — archived locally as
  `docs/Bruce_Lee_1984_Mastertronic_budget.pdf` (handed to the project directly, no URL);
  image-only scan with no text layer, as yet unread — OCR (`poppler-utils`/`tesseract-ocr`)
  deliberately deferred
- Bruce Lee manual scan, [c64online.com](https://c64online.com/wp-content/uploads/2021/03/Bruce-Lee.pdf) —
  archived locally as `docs/Bruce_Lee_1984_manual_c64online_edition-unknown.pdf`; edition
  unidentified, as yet unread (same OCR blocker as above)
- Bruce Lee manual, Project 64 etext, via [Lemon64](https://www.lemon64.com/doc/bruce-lee/112) —
  archived locally as `docs/Bruce_Lee_1984_manual_AppleII_Project64_etext.txt` (plain text
  transcription) and `docs/Bruce_Lee_1984_manual_AppleII_Project64_etext_lemon64.html` (source
  page); **this is the Apple II manual, not the C64 one** — its REQUIREMENTS section names an
  "Apple II(R) series computer" outright — so its game-design content (scoring table, damage
  thresholds, named hazards, movement verbs) transfers across ports at MEDIUM confidence, but its
  platform specifics (loading procedure, controls hardware) do not and must not be cited as C64
  fact. Its own TWO-PLAYER GAME description ("you and another person take turns being Bruce") is
  turn-taking, which disagrees with item 8 above and `FEATURES.md:202`'s claim that **Yamo can be
  driven by a second human player** in one of the C64 release's two-player modes — both may be
  true across different ports; recorded as an open question in `.planning/RE-FINDINGS.md`, not
  resolved here, and line 202 is left standing rather than overwritten. **RESOLVED 2026-08-03 by
  the C64-Wiki entry below: both are right, about different modes. Line 202 is vindicated.**
- Bruce Lee, [C64-Wiki](https://www.c64-wiki.com/wiki/Bruce_Lee) — archived locally as
  `docs/Bruce_Lee_C64wiki_2026-08-03.html` and `…_2026-08-03.txt` (extraction); graded **MEDIUM**
  — community-authored and unsourced, so corroboration rather than ground truth, but rated above
  the retroarcadia blog because it is a structured reference making checkable claims, and because
  its scoring table independently reproduces the Apple II manual's on all eight values. **This is
  the only archived source whose platform claims are C64-specific.** It settles the two-player
  question: the C64 has *three* modes — 1P, 2P-versus-computer (turn-taking), and
  2P-versus-each-other where player two **is** Yamo and the roles swap when Bruce loses a life.
  Also supplies `POKE 5472,99` (unlimited lives) — a direct pointer at the lives counter, `$1560`
  — the second-loop difficulty escalation, and the SID attribution to John A. Fitzpatrick
- Bruce Lee retrospective, [retroarcadia.blog (2024)](https://retroarcadia.blog/2024/06/19/my-life-with-bruce-lee-on-commodore-64/) —
  archived locally as `docs/Bruce_Lee_C64_retroarcadia_2024_retrospective.html`; graded **LOW**,
  the same reasoning the Spriters Resource entry below already gets: enthusiast recollection is a
  sanity check, never ground truth

- [mwenge/iridisalpha](https://github.com/mwenge/iridisalpha) — fetched directly
- [mwenge/gridrunner](https://github.com/mwenge/gridrunner) and [Disassembling.md](https://github.com/mwenge/gridrunner/blob/master/Disassembling.md) — fetched directly
- [Piddewitt/C64-Game-Source-Code](https://github.com/Piddewitt/C64-Game-Source-Code) — fetched directly
- [retroreversing.com/C64](https://www.retroreversing.com/C64) — fetched directly (mm-explained, Freeload/Ocean Loader survey)
- [s-macke/weltendaemmerung](https://github.com/s-macke/weltendaemmerung) — fetched directly
- [5k3105/bruce](https://github.com/5k3105/bruce) — fetched directly
- [Bruce Lee: Return of Fury — RetroGamerNation](https://www.retrogamernation.com/bruce-lee-return-of-fury-c64/) — web search summary
- [Bruce Lee — Lemon64 forum](https://www.lemon64.com/forum/viewtopic.php?t=44587) and [game page](https://www.lemon64.com/game/bruce-lee) — web search summary
- [Bruce Lee (video game) — Wikipedia](https://en.wikipedia.org/wiki/Bruce_Lee_(video_game)) — fetched directly, gameplay/subsystem details
- [Bruce Lee — The Spriters Resource](https://www.spriters-resource.com/commodore_64/brucelee/) — noted, treated as LOW-confidence/non-authoritative
- [Prince of Persia Apple II source — Jordan Mechner](https://github.com/jmechner/Prince-of-Persia-Apple-II) and [videogamepreservation/princeofpersia](https://github.com/videogamepreservation/princeofpersia) — web search summary
- Super Mario Bros. NES disassembly family (smwcentral, 6502disassembly.com, various GitHub forks) — web search summary, CI/checksum-verification pattern
- No prior art found for: a public Bruce Lee C64 disassembly, a Bruce Lee memory map, or Atari 8-bit *Bruce Lee* internals documentation — absence verified via multiple targeted searches, not assumed

---
*Feature research for: 8-bit game reverse engineering / documentation / reconstruction*
*Researched: 2026-07-30*
