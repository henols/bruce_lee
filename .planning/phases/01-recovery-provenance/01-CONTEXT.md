# Phase 1: Recovery & Provenance - Context

**Gathered:** 2026-07-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Turn two cracked disk images into **one canonical memory image**, recovered by a procedure someone else can re-run and get byte-identical output from, with a provenance verdict plus its evidence behind **every byte range** of that image.

Delivers: `recovery/clean/bruce-lee.bin` (+ manifest + chip-state sidecar), `recovery/{danish,saeger}/NOTES.md`, `recovery/LOADING.md`, `recovery/PROVENANCE.md`, `recovery/clean/README.md`. Five plans, all sequential — every one touches the single shared VICE instance or hard-depends on the prior plan's output.

Not in this phase: disassembly, code/data classification, labelling, the verification harness, any ACME source. Cracker code gets only enough analysis to get past it and to attribute patched bytes.

</domain>

<decisions>
## Implementation Decisions

### Canonical image shape

- **D-01:** `recovery/clean/bruce-lee.bin` is **exactly 65536 bytes, file offset == CPU address**. Every address cited anywhere in the project indexes it directly, with no offset arithmetic, forever. — **Reversibility:** one-way — Phase 2's coverage bitmap, Phase 3's checkpoint region definitions, and Phase 4's per-region round-trip byte diff are all defined as offsets into this file. Changing its shape after Phase 2 begins invalidates every recorded range and every diff baseline downstream.
- **D-02:** It ships with a **machine-readable range manifest** (sidecar JSON) declaring each range's kind — `game` / `loader` / `cracktro` / `io` / `unused`. This is what makes success criterion 3's "100% coverage" an honest claim rather than one padded with ROM shadows and never-touched space, and it gives Phase 2's coverage tooling a machine-readable denominator instead of prose markdown to parse.
- **D-03:** The image holds **pure underlying RAM for all 65536 bytes**, including the `$A000-$BFFF`, `$D000-$DFFF` and `$E000-$FFFF` windows. One rule covers every address; there is never a "register or byte?" ambiguity. IO register *values* are not in the image — they live in the chip-state sidecar. This is the direct antidote to Pitfall 5's silent-ROM-substitution failure. — **Reversibility:** one-way — same cascade as D-01; a CPU's-eye-view image cannot be retrofitted into a RAM image without recapturing under VICE.
- **D-04:** Chip state goes in a **machine-readable sidecar JSON per dump**: raw register reads plus the derived facts that matter — `$DD00` VIC bank, `$D018` screen/charset, the 8 sprite pointers, the `$01` port value, CPU registers, SID and both CIAs. Phase 3's checkpoint design is a real consumer of this data, so it must be parseable, not a prose table.
- **D-05:** The `.bin` keeps crack-loader and cracktro bytes **verbatim, and is never edited or zeroed** — it is evidence, and editing it destroys the audit trail the preservation driver depends on and the bytes RECOVER-06/07 need for attribution. Bucket classification lives in the manifest and the ledger, not in the bytes.

### Dump trigger & evidence integrity

- **D-06:** The dump trigger is a **PC-reached checkpoint at the game's real entry point**, located empirically by stepping/tracing out of the last decrunch stage. Recorded as a single address in NOTES.md; `checkpoint_add` + `run_until` makes it deterministic regardless of host speed. Explicitly **not** a timeout (banned by success criterion 1), **not** a last-decrunched-byte write-watch (stops mid-decruncher, risking the "too early" half of Pitfall 5), and **not** a loader-exhausted window (a duration judgement in disguise).
- **D-07:** Committed per dump, with explicit roles: the **`.bin` is the canonical byte artifact** and the only thing anything ever diffs against; the **`.vsf` snapshot is committed alongside as the reusable deterministic start state** for Phases 2 and 3. Snapshots are **versioned and descriptively named** (`danish_gameentry_v1.vsf`), never `snapshot.vsf` — per PITFALLS' shared-emulator discipline. Full set per dump: `.bin` + `.map.json` + `-state.json` + `.vsf`.
- **D-08:** **Non-invasive reads first, guarded fallback.** Prefer bank-scoped reads to reach RAM under ROM/IO (a `vice_memory_banks` tool exists, so bank selection is likely supported — plan 01-01 confirms it). A `$01` write is permitted **only** after the `.vsf` is saved, **only** on a session that is then discarded, and **only** with the write and the restore recorded verbatim in NOTES.md. This keeps a tooling unknown from becoming a hard blocker without letting the captured image be one of a program we perturbed.
- **D-09:** Byte-identical reproducibility is **demonstrated, not asserted**: run the full recorded procedure twice from a scripted `machine_reset` and commit the SHA-256 of each dump plus the comparison result. If they differ, record every divergent range and the suspected cause and hand it to VERIFY-02 as a known nondeterminism source — do not paper over it. This is PITFALLS' Phase 3 capture-twice discipline applied one phase earlier, where it is cheapest.

### Load-event proof (RECOVER-04)

- **D-10:** **Mechanical watches are the detector; play merely drives them.** Exec-checkpoints over the loader region (must never fire again) plus write-watches on the drive/IEC registers and on never-populated ranges. Absence of hits is *positive* evidence — which is exactly what success criterion 2's "or states that zero were found, with the evidence that looked for them" is asking for. A raw memory-diff sweep was rejected: gameplay state churn and self-modifying code swamp it, so it cannot distinguish "the game wrote here" from "the loader brought this in".
- **D-11:** Phase 1 does **bounded play**, not an exhaustive play-through: several *real* chamber transitions, both opponents, death, game over, restart. `LOADING.md` records zero-found plus exactly what was armed and how far coverage got. The **same watch set is re-armed during Phase 2's exhaustive all-20-chambers trace** (MAP-01 requires that trace anyway), so breadth arrives without playing the game to completion twice — and a late hit reopens `LOADING.md`. Chamber-warping by memory poke was rejected: poking the chamber index can bypass the chamber-transition routine, which is precisely where a load call would live.
- **D-12:** Play is driven by `joystick_tap`/`joystick_set` **synchronised on checkpoints and frame position — never wall-clock sleeps** (standing constraint). The working input sequence is recorded in `LOADING.md` as plain notes, **explicitly not** as a `verify/scripts/` artifact: VERIFY-01 (Phase 3) still owns the real input-script format, and this is a seed for it, not a spec.
- **D-13:** **Open by choice** — if a load event *is* found, the rule for whether the canonical image absorbs it is decided in the moment, not pre-committed. Both disks appear to load everything up front, so this may never arise. **Constraint on the deferral:** it must be resolved before Phase 4 treats the image as its round-trip diff target. If plan 01-04 finds a load event, that is a checkpoint decision, not an executor judgement call.

### Provenance ledger & canonical designation

- **D-14:** `PROVENANCE.md` uses **coalesced, machine-generated ranges plus a hand-written prose tier** — the same generated/prose split ARCHITECTURE.md mandates for the memory map, and it keeps the ledger regenerable when the diff improves. Each row carries range, kind, verdict, confidence and evidence. The **gap-coalescing tolerance is stated explicitly** in the document (e.g. "coalesced across gaps < 16 identical bytes"). Per-byte rows were rejected: a relocated loader produces thousands of them and buries the handful of single-byte patches RECOVER-06 exists to surface. Hand-authored ranges were rejected as ARCHITECTURE.md's Anti-Pattern 2.
- **D-15:** Crack-independence evidence (RECOVER-07) is **tiered, and the tiers are not equal**. Tier 1 is the binary itself: loader style and structure, cracktro credits, surviving release text, whether one loader looks derived from the other. Tier 2 is external scene records (CSDb-style release entries, NFO text) — admissible, because release *lineage* is a different category from the third-party *byte data* the requirements ban as authoritative, but it can corroborate or raise questions and **can never outrank Tier 1**. Every claim in `PROVENANCE.md` names its tier.
- **D-16:** The canonical subject (RECOVER-08) is chosen by **measurement, not preference**: whichever image has the smaller CRACKER-PATCH byte footprint **inside game-logic ranges** wins, with both counts recorded in `recovery/clean/README.md` as the reason. Tiebreak order after that: contiguous layout, then uncrunched provenance clarity. This makes success criterion 5's "the reason it was chosen" a number. ARCHITECTURE.md's lean toward `danish` is explicitly *not* binding — it is a hypothesis for the measurement to confirm or refute.
- **D-17:** The provenance diff runs at an **anchor-proven offset, never an assumed one**: pick several long distinctive byte runs from one image, search for them in the other, and require all deltas to agree before declaring a global offset (expected to be zero, since the game must run at its own addresses). If the deltas disagree, fall back to per-region offsets recorded in the manifest and say so. Only then diff raw bytes — which is what produces the byte ranges the ledger needs. NOTES.md states the offset and how it was proven.

### Tooling

- **D-18:** **Node (`.mjs`) for all Phase 1 tooling.** Everything this phase needs — `.d64` track/sector parsing, byte diffing and coalescing, SHA-256, JSON — is trivial in Node with **zero install**, and it matches ARCHITECTURE.md's `tools/*.mjs`, all three existing skills, and the planned `verify/runner.mjs`. Python's real advantages (Pillow for PNG, the `d64` library, pytest) do not pay off until Phase 4's sprite extraction, so **Python is revisited at Phase 4 as a separate additive decision** — not installed now, and not a second toolchain to maintain through the phase the roadmap calls the most expensive place to be wrong.

  **This resolves a live conflict in the research set:** ARCHITECTURE.md specifies `tools/diff-images.mjs` (Node) while STACK.md recommends Python (`d64`, Pillow, pytest, hashlib). For Phase 1, ARCHITECTURE.md wins. STACK.md's Python recommendation is not overturned project-wide — it is deferred to the phase where its libraries are actually needed.

### Claude's Discretion

These were deliberately **not** put to the user, because they are empirical or mechanical rather than preferences. Downstream agents own them:

- **VICE bootstrap method** — the roadmap's headline Phase 1 decision (an MCP attach/boot tool vs `snapshot_load` from a pre-captured `.vsf`). Answered by probing the actual tool surface in plan 01-01, not by preference. If it turns out to be `snapshot_load`, D-07's versioned-naming rule applies to the boot snapshots too.
- Whether bank-scoped reads can actually reach RAM under ROM/IO — determines whether D-08's fallback is needed at all.
- The concrete steps of the shared-VICE reset/clear-checkpoints/reload ritual, and the exact register and range set the D-10 watches cover.
- How the game entry point is located for each image, and whether `saeger` (uncrunched) needs a differently-shaped trigger than `danish`.
- The exact structure of `NOTES.md`, beyond the three things criterion 1 requires it to record (dump trigger, `$01` configuration at dump time, captured address ranges).
- Where the three-bucket partition boundaries (loader / cracktro / game logic) fall.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` § "Phase 1: Recovery & Provenance" — goal, 5 success criteria, the 5 plans and their strict sequencing, the front-loaded VICE-bootstrap decision, the crack-independence open question
- `.planning/ROADMAP.md` § "Standing Constraints" — applies to every plan: shared-VICE serialisation, the `vice_disk_list` ban, host-path translation, the provenance-ledger single-direction rule
- `.planning/REQUIREMENTS.md` § "Recovery & Provenance — Phase 1" — RECOVER-01 through RECOVER-08 verbatim
- `.planning/REQUIREMENTS.md` § "Out of Scope" — in particular the bans on static `TCS-CRUNCH!` depacking and on treating third-party artifacts as authoritative (relevant to D-15)
- `.planning/PROJECT.md` § "Context" — the two disk images' boot stubs, signatures and occupied tracks; the `vice_disk_list` hazard; the toolchain gap list

### Architecture and layout (binding on this phase's outputs)
- `.planning/research/ARCHITECTURE.md` § "Recommended Project Structure" — the `recovery/` tree this phase must produce
- `.planning/research/ARCHITECTURE.md` § "Component Responsibilities" — the trust-level separation between `disks/` (untouchable evidence), `recovery/` (derived, regenerable) and `src/`
- `.planning/research/ARCHITECTURE.md` § "Recording confidence and provenance" — the verdict/evidence/confidence table the ledger implements, and the ledger→summary→inline one-direction rule
- `.planning/research/ARCHITECTURE.md` § "Anti-Pattern 2" — hand-maintained tables drift; the basis for D-14's generated tier
- `.planning/research/ARCHITECTURE.md` § "Anti-Pattern 5" — never silently reproduce cracker patches as original

### Hazards this phase must actively defend against
- `.planning/research/PITFALLS.md` § "Pitfall 5" — **primary risk.** Dump too early / too late / missing on-demand loads / reading ROM-IO where RAM is shadowed; capture chip state separately. Basis for D-03, D-04, D-06, D-08, D-10
- `.planning/research/PITFALLS.md` § "Pitfall 4" — naive two-crack diffing: common-ancestor risk, relocation false positives, packer artifacts, expected-to-differ loader regions. Basis for D-15, D-17
- `.planning/research/PITFALLS.md` § "Tool-mediated, single-shared-emulator-instance workflow risks" — the reset/clear-checkpoints ritual and snapshot-naming discipline. Basis for D-07, D-09
- `.planning/research/PITFALLS.md` § "Depacker/loader tooling gaps in the current environment" — confirm live-memory recovery genuinely needs no `exomizer`/`da65` rather than assuming it
- `.planning/research/PITFALLS.md` § "Looks Done But Isn't" — the "memory dump clean" and "provenance-diff establishes originality" entries are this phase's self-check list

### Tooling
- `.planning/research/STACK.md` — the Python recommendation D-18 defers to Phase 4; also the `.d64` layout facts (35 tracks, BAM at 18/0, directory chain from 18/1) needed by plan 01-01's direct byte parser
- `.claude/skills/devcontainer-host-path/SKILL.md` — **mandatory** for every path handed to host-side VICE (snapshot paths, disk image paths). Every artifact a host tool touches must stay inside the workspace
- `.claude/skills/c64-memory-mapping/SKILL.md` — resolving `$01`, `$D018`, `$DD00` and the IO/ROM window semantics D-03 depends on; note its own warning that a game with ROM banked out can repurpose a "known" zero-page address
- `.claude/skills/acme-build/SKILL.md` — not used in Phase 1, but its `.vs` symbol-file interop is what later phases build on
- `.mcp.json` — the VICE MCP endpoint (`http://host.docker.internal:6510/mcp`)

</canonical_refs>

<code_context>
## Existing Code Insights

The repository has **no source tree yet** — no `src/`, `tools/`, `recovery/`, `docs/`, `verify/` or `build/`. Phase 1 creates the first of them. There are no `.planning/codebase/*.md` maps, as expected this early.

### Reusable Assets
- `.claude/skills/devcontainer-host-path/hostpath.mjs` — path translation for host-side VICE. Load-bearing for every `.vsf` save/load and disk attach in this phase.
- `.claude/skills/c64-memory-mapping/driver.mjs` + `memmap.json` — address resolution; useful when interpreting `$01`, `$D018`, `$DD00` and the sprite-pointer derivation for D-04's sidecar.
- `.claude/skills/acme-build/acme.mjs` — not needed in Phase 1; noted so it is not mistaken for a gap.
- `disks/danish.d64` and `disks/saeger.d64` — both present, 174848 bytes each (standard 35-track `.d64`). Read-only evidence; never modified.

### Established Patterns
- **All three existing skills are Node `.mjs` with a small CLI surface.** D-18 follows this grain; a Python tool in Phase 1 would be the first exception in the repo.
- **The MCP server is HTTP at `host.docker.internal:6510`.** `anything.txt` holds a working raw `curl` probe of `vice.ping` — a useful sanity check if the MCP client path misbehaves. Note it is gitignored scratch, not a committed tool.
- `.gitignore` deliberately does **not** ignore `*.a` (ACME source uses that extension). Nothing in it currently excludes `recovery/` or `*.bin`/`*.vsf`, so this phase's binary artifacts will be committed by default — which matches success criteria 1 and 2 requiring committed dumps.

### Integration Points
- `recovery/clean/bruce-lee.bin` + its manifest is the **hand-off surface** to Phase 2 (coverage bitmap denominator), Phase 3 (checkpoint region definitions) and Phase 4 (round-trip byte-diff target). D-01/D-02/D-03 are one-way for exactly this reason.
- The versioned `.vsf` snapshots from D-07 are the hand-off to Phase 3's determinism work — the cheapest available route to a byte-identical starting state.
- The D-10 watch set is the hand-off to Phase 2's plan 02-02, which re-arms it during the exhaustive trace.

</code_context>

<specifics>
## Specific Ideas

- **"Anything synthesized says so in its filename."** The distinction between a real single-moment capture and any derived/merged artifact must be visible at the filename level, not buried in a README.
- **Absence of evidence, recorded as evidence.** For the load-event question, "we armed X, Y and Z, played through these states, and nothing fired" is the deliverable — not a bare "no loading found". The setup and the coverage reached are both part of the claim.
- **Prefer a number over a preference wherever a criterion asks "why".** Applied to D-16 (canonical pick by measured patch count) and D-09 (two hashes, committed). A recorded reason that is a measurement survives challenge; one that is a judgement does not.
- **Don't do the expensive play-through twice.** D-11 explicitly leans on Phase 2's mandatory exhaustive trace rather than duplicating it here — the watch set travels forward instead of the coverage being re-earned.
- **Don't pre-empt a later phase's format decision.** D-12 records the input sequence as notes rather than inventing a `verify/scripts/` format that VERIFY-01 owns. Same instinct behind D-18 deferring Python to Phase 4 and D-17 avoiding a dependency on Phase 2's disassembler choice.

</specifics>

<deferred>
## Deferred Ideas

- **Load-event merge rule** (D-13) — deliberately left open rather than pre-designed, since both disks appear to load everything up front. If plan 01-04 finds a load event, this becomes a checkpoint decision at that moment. Must be resolved before Phase 4 relies on the canonical image as its round-trip diff target.
- **Python toolchain** (`pip`/`venv`, `d64`, Pillow, pytest) — deferred to Phase 4, where PNG rendering for sprite extraction first makes it worth a second language. Not a rejection of STACK.md, a postponement to the phase that needs it.
- **A reusable input-script format** — belongs to VERIFY-01 in Phase 3. Phase 1 leaves it a working example, not a half-specification.
- **Symbolic / instruction-stream diffing** as a provenance cross-check — would need Phase 2's disassembler decision (`toacme` vs `regenerator2000`), so it is not a Phase 1 dependency. `vice_disassemble` is available for ad-hoc spot-checks if a difference block looks implausibly large.
- **A composite complete-coverage image** — only if D-13's contingency fires, and only as a clearly-labelled derived artifact.

</deferred>

---

*Phase: 1-Recovery & Provenance*
*Context gathered: 2026-07-30*
