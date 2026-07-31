# Roadmap: Bruce Lee — Reverse Engineering & ACME Reconstruction

## Overview

The project starts with two cracked disk images and nothing else, and ends with an ACME source tree that rebuilds a Bruce Lee which passes a scripted replay suite against the original with zero divergence, alongside documentation that explains every gameplay system well enough to change it. The route there is deliberately *vertical, not layered*: after recovering a clean memory image (Phase 1) and mapping what is code, what is data, and where the reconstruction hazards are (Phase 2), the verification harness and the original's baselines are built next (Phase 3) — before any rebuild exists, because baselines need only the recovered image. Phase 4 then drives **one** subsystem all the way through the full pipeline (trace → annotate → document → extract → transcribe to ACME → build → verify against baseline). Its real deliverable is a *proven pipeline*; the documented sprite/display subsystem is the artifact that proves it. Phases 5 and 6 scale the remaining subsystems out across that proven pipeline as parallel plans. Phase 7 completes the listing, splits the source to mirror the documentation, packages the bootable `.d64`, and runs the full suite that defines done.

Three risks decided this shape. A mistimed or incomplete RAM dump, jump-table code misclassified as data, and silent ACME addressing/alignment drift all surface — under horizontal layering — only at the verification phase, after everything has been built on top of them. The vertical slice moves that discovery to Phase 4, where a wrong assumption costs one subsystem instead of the whole disassembly.

## Standing Constraints

These apply across every phase and every plan; `/gsd-plan-phase` should inherit them rather than rediscover them.

| Constraint | Consequence for planning |
|---|---|
| **VICE is a single shared host instance reached only over MCP** | `parallelization: true` does **not** extend to emulator work. Any two plans that both drive VICE must be serialised, and each must open with the reset/clear-checkpoints/reload ritual before trusting emulator state. Plans marked parallel below are parallel in *authoring*; their VICE steps still queue. **Phase 01.1 does not change this** — it replaces how the emulator is reached, not how many there are. **Phase 01.2 is expected to relax it**: per-session on-demand instances make cross-session concurrency real, and because each is a fresh boot, **the reset/clear-checkpoints/reload ritual should narrow** to within-session reuse only. Intra-*session* parallelism is a separate question deferred to a seed (instance handles), since subagents share their parent's MCP connections. See `.planning/notes/vice-mcp-selector-design.md`; until 01.2 lands, this constraint stands exactly as written and plans must not assume otherwise. |
| **`vice_disk_list` crashes the host MCP server** | Never called. Disk directory inspection is done by parsing `.d64` bytes directly. Recovery from an accidental call needs a manual host-side VICE restart. |
| **Host-side tools need translated paths** | Every artifact a host-side tool touches stays inside the workspace and goes through the `devcontainer-host-path` skill. **Phase 01.1 is expected to retire the manual half of this**: the proxy sees every forwarded call, so it can translate container paths to host paths itself and callers stop doing it by hand. Until 01.1 lands, this constraint stands exactly as written. |
| **All ACME warnings are build-blocking; `--strict-segments` always** | Established as a gate in Phase 4 and inherited by every later phase. The `acme-build` skill's wrapper does not currently expose `--strict-segments` or a warning-gated exit — Phase 4 must extend it (or wrap it) rather than assume the flag is reachable. |
| **Per-region round-trip byte diff is the transcription gate** | A region is not "transcribed" until reassembling it reproduces the canonical image's bytes at that address range. Non-optional, every region, every phase from 4 onward. |
| **Confidence-marker convention from Phase 2 onward** | Speculative labels/claims carry a `?` suffix; unknown regions use `unk_$addr`. `grep -rn '^unk_' src/` and `grep -rn '?' docs/` are live completeness metrics. A correction is incomplete until the old name/claim is swept out of `docs/` and `src/` in the same change. |
| **Provenance ledger is the single source of truth** | `recovery/PROVENANCE.md` → `docs/provenance.md` summary → inline `; PROVENANCE:` tags in `src/`. One direction only; never edit a downstream copy independently. |

**No UI hint on any phase.** Several phases match generic UI keywords ("display", "screen", "title screen", "layout") but none is a frontend phase — this is 6510 assembly against VIC-II registers. `/gsd-ui-phase` would be misapplied here, so the annotation is deliberately omitted rather than overlooked.

## Milestones

The 7 phases are split across two milestones at the Phase 4 boundary, with a third already scoped from the deferred requirements.

| Milestone | Phases | Reqs | What it delivers |
|---|---|---|---|
| **v1.0 — Pipeline Proven** *(active)* | 1–4 | 24 | A clean canonical image with per-byte provenance, a full code/data map, a working replay-verification harness with the original's baselines recorded, and one subsystem (sprite/display) driven end-to-end through the pipeline to a verified `.prg`. The deliverable is a **proven pipeline**. |
| **v2.0 — Complete Reconstruction** | 5–7 | 20 | Every remaining subsystem documented and reconstructed, all data formats proven by round-trip, the annotated listing complete, source split to mirror the docs, a bootable `.d64`, and the full replay suite passing. This is where "fully documented and recompiled" is actually met. |
| **v3.0 — Editable** | — | 6 | Round-trip asset converters (`ASSET-01..04`) and the change guide + chamber editor (`EXT-01..02`). Deferred; not yet phased. |

**Scope note.** v1.0 intentionally ships short of the original project goal. The full "documented and recompiled" deliverable lands at v2.0 — v1.0 exists to de-risk it by proving every stage of the pipeline works before scaling out. Do not read a v1.0 close as project completion.

**At v1.0 close**, `/gsd-complete-milestone` archives Phases 1–4 to `.planning/milestones/v1.0-ROADMAP.md`, archives the 24 completed requirements, runs the PROJECT.md evolution review, and `/gsd-new-milestone` opens v2.0 with Phases 5–7 promoted into a fresh `REQUIREMENTS.md`.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

### Milestone v1.0 — Pipeline Proven *(active)*

- [ ] **Phase 1: Recovery & Provenance** - Defeat both crack loaders, capture a clean canonical memory image, and give every byte range a provenance verdict
- [ ] **Phase 01.1: Tool-Mediated Emulator Access** *(INSERTED)* - Diagnose why `vice-session` fails, remove it, and replace it with `vice-mcp-selector`: one static `.mcp.json` entry whose stdio proxy forwards to a fixed host port, surfacing the emulator as real `mcp__vice__*` tools and enforcing the known hazards in code. No leasing, no broker — deliberately immune to every unverified assumption
- [ ] **Phase 01.2: On-Demand Broker and Per-Session Leasing** *(INSERTED)* - Add the host-side broker: launch a fresh `x64sc` per session on first use, kill it at session end, keep N warm spares, sweep orphans on TTL. This is the phase that makes cross-session concurrency real and narrows the reset ritual. Gated by the lifecycle spike
- [ ] **Phase 2: Coverage, Hazards & Memory Map** - Classify every byte as code/data/untouched by live trace, label every reachable routine, catalogue every reconstruction hazard, document the memory map
- [ ] **Phase 3: Verification Harness & Original Baselines** - Build the deterministic replay harness and record the original's checkpoint baselines, before any rebuild exists
- [ ] **Phase 4: Vertical Slice — Sprite & Display Pilot** - Prove the whole pipeline end-to-end on one subsystem: trace → annotate → document → extract → ACME → `.prg` → verified against baseline

### Milestone v2.0 — Complete Reconstruction

- [ ] **Phase 5: Actors — Movement, Combat & AI** - Scale the proven pipeline across player movement, the move set and combat resolution, Yamo, and the Ninja
- [ ] **Phase 6: World, Audio & Shell + Data Format Validation** - Scale out chambers, traps, scoring/two-player, sound, and the shell; prove every data format spec by round-trip
- [ ] **Phase 7: Complete Source Tree, Bootable Disk & Full-Suite Verification** - Finish the annotated listing, split source to mirror the docs, package the bootable `.d64`, pass the full replay suite

**Cross-milestone dependency:** Phase 6 depends only on Phase 4, not Phase 5 — so if v2.0 planning wants to overlap Phases 5 and 6, nothing in the dependency graph forbids it.

## Phase Details

### Phase 1: Recovery & Provenance

**Goal**: A clean, canonical Bruce Lee memory image exists, recovered by a procedure anyone can repeat, with every byte range carrying a provenance verdict and its evidence
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: RECOVER-01, RECOVER-02, RECOVER-03, RECOVER-04, RECOVER-05, RECOVER-06, RECOVER-07, RECOVER-08
**Success Criteria** (what must be TRUE):

  1. `recovery/clean/bruce-lee.bin` exists, and `recovery/danish/NOTES.md` + `recovery/saeger/NOTES.md` each record the dump trigger (the "loader is done" signal used, not a timeout), the `$01` port configuration at dump time, and the captured address ranges — re-running the recorded procedure produces a byte-identical dump.
  2. `recovery/LOADING.md` names every on-demand load event observed during a full post-dump play-through (or states that zero were found, with the evidence that looked for them), and a supplementary dump is committed for each event found.
  3. `recovery/PROVENANCE.md` assigns ORIGINAL / CRACKER-PATCH / UNKNOWN plus per-range evidence and confidence covering 100% of the canonical image, and records that the diff was run only after both images were normalised to the same fully-loaded state and base address (with the offset and load-state used stated).
  4. `recovery/PROVENANCE.md` records an explicit verdict on whether the two cracks are independent, the artifacts examined to reach it, and the confidence weight a "both releases agree" verdict therefore carries.
  5. `recovery/clean/README.md` names the canonical disassembly subject and the reason it was chosen over the other image.

**Plans**: 3/6 plans executed

Plans:

- [x] 01-01-PLAN.md
- [x] 01-02-PLAN.md
- [x] 01-03-PLAN.md
- [ ] 01-04-PLAN.md
- [ ] 01-05-PLAN.md
- [ ] 01-06-PLAN.md

**Wave 1**

- [x] 01-01: **Tracer** — one release recovered end-to-end: MCP client seam, boot, loader-done signal, bank-scoped 64K capture, byte-identical re-run proof, `RELEASES.json` registry (RECOVER-01, RECOVER-02) — *strictly first; everything else in this phase depends on it*

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02: Complete the per-dump artifact set — chip-state sidecar (D-04) and range manifest (D-02); parse both disk directories from `.d64` bytes; release-schema invariant validator (RECOVER-01, RECOVER-02) — *sequential (shared VICE)*

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 01-03: Second release recovered by re-running the same recorded procedure, with N-readiness proven by the parameterisation gate (RECOVER-01, RECOVER-03) — *sequential (shared VICE)*

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 01-04: Mechanical on-demand-load detector, bounded play-through, `LOADING.md` absence-as-evidence record, supplementary dumps (RECOVER-04) — *sequential; has a blocking human-verify checkpoint*

**Wave 5** *(blocked on Wave 4 completion)*

- [ ] 01-05: Anchor-proven offset, N-way diff, gap-tolerant coalescing, three-bucket partition, `PROVENANCE.md` generated + prose tiers at 100% coverage (RECOVER-05, RECOVER-06) — *sequential; no emulator needed*

**Wave 6** *(blocked on Wave 5 completion)*

- [ ] 01-06: Crack-independence verdict with tiered evidence; canonical designation by measured patch count; `recovery/clean/` published as a projection of the registry (RECOVER-07, RECOVER-08) — *strictly last*

**Planning note (2026-07-30):** the plan set was restructured from the horizontally-sliced 5-plan breakdown originally recorded here to a **tracer-first** 6-plan shape. Plan 01-01 is now a complete end-to-end vertical slice — cold reset through boot, signal detection, capture, artifact write and determinism proof against one release — rather than a bootstrap survey that produces no dump. Reasoning, and the explicit resolution of the tension with the original breakdown, is recorded in `.planning/phases/01-recovery-provenance/01-01-PLAN.md`. Two further deviations: `RECOVER-05` (normalisation) moved from 01-04 to 01-05's first task, where it gates the diff directly; and the `$01`-write step named in the original 01-02 line is **not** performed at all — research verified live that `vice_memory_read(bank:"ram")` reaches RAM beneath ROM and I/O non-invasively, so D-08's guarded fallback stays documented and unexercised.

**Parallelisation**: none. Every plan touches the single shared VICE instance or hard-depends on the prior plan's output. This phase is the project's most expensive place to be wrong — spend the time.

**Decisions to resolve here**: **VICE bootstrap method** — whether an MCP attach/boot tool exists or booting must go through `snapshot_load` from a pre-captured "just booted" `.vsf`. Front-loaded here because nothing in the project can run without it. *Resolved during research (2026-07-30): `vice_disk_attach` + `vice_autostart` exist and were confirmed live, so `snapshot_load` bootstrapping is not needed; whether autostart survives these disks' faked directories is the one remaining empirical test, with a keyboard `LOAD`/`RUN` fallback ready. The explicit-naming rule still applies — snapshots are recorded **by name** (`danish_gameentry_v1`), and research further established that a `.vsf` **cannot** be committed at all: `vice_snapshot_save` takes only a name, stores host-side, and no tool exports snapshot bytes into the container. See `01-01-PLAN.md` § "Research correction to D-07".*

**Open question resolved here**: are the two cracks genuinely independent, or common-ancestor? Examine loader style, cracktro credits, and any surviving release text. The answer retroactively sets the weight of every "both agree" provenance verdict.

**Risks (PITFALLS.md)**: **Pitfall 5 (primary)** — dump too early (mid-decrunch), too late (post-gameplay self-modification), missing on-demand-loaded regions, or reading ROM/IO where RAM is shadowed; capture chip-level state (VIC bank select, sprite pointers, SID voice, CIA latches) alongside the RAM image, since it is not in RAM. **Pitfall 4** — do not diff raw sectors or pre-decrunch memory; relocation-induced false positives make an un-normalised diff actively misleading; loader/protection regions are *expected* to differ and must be bucketed as such before anything is called suspicious; check for duller explanations (revision difference, `.d64` read error) before concluding "cracker changed it". **Moderate** — tooling gaps (confirm live-memory recovery genuinely needs no `exomizer`/`da65`, rather than assuming); shared-emulator state leaking between capture sessions.

---

### Phase 01.1: Tool-Mediated Emulator Access

**Goal**: The emulator is reached through real `mcp__vice__*` tools instead of through `Bash`, and every known hazard is enforced by code in the proxy rather than remembered from documentation — with the existing failure diagnosed first, so nothing is built on an unexamined assumption
**Depends on**: Nothing. This is tooling: it replaces *how* the emulator is reached, not what any phase produces. Phase 1's remaining plans (01-04 … 01-06) and every later phase consume its output. It deliberately depends on **no** unverified research finding — see the phasing table in `.planning/notes/vice-mcp-selector-design.md`.
**Requirement mapping**: none — tooling phase, by design (see § Requirement Coverage). Deliberately written *without* a `**Requirements**:` key so the requirement-coverage gate reads this phase as unmapped rather than parsing this sentence as a REQ-ID.
**Success Criteria** (what must be TRUE):

  1. A written diagnosis records *why* `vice-session` fails, naming the actual mechanism with the evidence that established it — not the assertion that has been accepted so far. It states explicitly whether the host emulator is reachable from this container at all; if it is not, that is the phase's finding and the proxy is not built on top of it.
  2. `.mcp.json` contains exactly one static `vice` stdio server entry invoking `.claude/skills/vice-mcp-selector/scripts/vice-proxy.mjs`. The entry carries no `url` field and nothing rewrites the file at runtime, so project-scope approval is granted once and survives.
  3. From a **fresh** session, `mcp__vice__*` tools are listed and a real emulator operation succeeds through them (e.g. `mcp__vice__memory_read` returning known bytes), with the evidence recorded. Verification requires a new session by construction — MCP server definitions are read once at session start (finding 1), so the session that adds the entry cannot load it.
  4. `initialize` and `tools/list` are answered without acquiring an emulator — enumerating tools neither launches nor requires one (finding 6: spawn is eager, so acquisition must be deferred to the first `tools/call`).
  5. Hazards are enforced in code, each with a test that fails if the guard is removed: `vice_disk_list` is refused at the proxy and never forwarded; the epoch is re-checked on every forwarded call so a mid-session host restart surfaces as a loud tool error instead of silent blank-machine reads; a response larger than the output limit is chunked at the proxy rather than truncated (a 64K RAM read is the shape that trips it).
  6. The proxy never exits and never caches a negative result: with the emulator absent, calls return actionable MCP error frames and the proxy stays alive; once the emulator is running, the *next* call succeeds with no session restart. A dead stdio server is never reconnected (finding 7), so "never throw, always answer in MCP frames" is a hard requirement, not a quality goal.
  7. Emulator-unreachable diagnostics distinguish three states — never started, dead or hung, alive but the operation failed — each with its own message and its own fix, each quoting the absolute **host** path of the command to run (since it runs on the host), and each explicitly stating that this is the only route and that reaching for the old `node …/vice.mjs` scripts is not an available workaround.
  8. Agent-facing `Bash`-mediated emulator access is retired: no remaining skill, agent definition, or document instructs an agent to reach the emulator through `Bash`. Removal lands only after criterion 3 passes — retiring access before the replacement is proven would strand the emulator. Two things this criterion is **not**: it is not a bare `rm -rf` of `.claude/skills/vice-session/` (its transport module is imported as a *library* by `tools/recover.mjs`, `tools/chip-state.mjs`, `tools/watch-loads.mjs` and `c64-ram-capture`, entirely outside the MCP layer — those call sites must be relocated and repointed, not broken), and it does not touch host-side launch machinery (`vice-pool.sh` / `vice-supervisor.sh`), which still serves the fixed port 1.1 forwards to.
  9. **Container→host path translation happens in the proxy, not in every caller.** Any path argument on a forwarded call that names a location inside the container workspace is rewritten to its host equivalent before the host emulator sees it — because VICE runs on the host, a container path is never correct there, and today a wrong one fails *silently*. Callers stop importing `tryHostPaths` to do this by hand, a test proves an untranslated container path cannot reach the host, and the `devcontainer-host-path` skill is retired if and only if nothing outside the proxy still needs it (the remaining consumers, if any, are named rather than assumed away). This is the same conversion as criterion 5 — a rule that had to be remembered becomes a rule enforced at the one seam that sees every call.

**Plans**: TBD — set by `/gsd-plan-phase 1.1`

**Parallelisation**: none meaningful. The diagnosis strictly precedes the build, and the removal in criterion 8 strictly follows the proof in criterion 3.

**Decisions to resolve here**:
- **Where the tool manifest for `tools/list` comes from** — a schema snapshot baked in at build time, or a live fetch cached from a warm emulator. Forced by finding 6: tools must enumerate with no emulator present.
- **Whether the proxy absorbs the pause-on-state-read polling discipline** (read → run → poll-with-`ping`, resume last) or leaves it documented. The proxy sees every call, so it *could* enforce ordering — design open question 4.
- **What the epoch check is for now** — with fresh boots expected, its job narrows to detecting a host restart *mid-session*; confirm that narrowing rather than inheriting the old semantics (design open question 5).
- **Which fixed port, and who launches the emulator on it during 1.1** — the existing pool/supervisor started by hand, or a documented manual `x64sc -mcpserver` invocation. On-demand launch is explicitly 1.2's job.
- **How the proxy recognises a path argument (criterion 9)** — a per-tool argument allow-list, or the narrower structural rule "any string argument beginning with the container workspace root". The structural rule is high-precision for `mcp__vice__*` specifically, because every path a VICE tool takes is host-side by definition; decide it explicitly rather than by accident, and decide what happens to a path that is *outside* the workspace (reject loudly, or forward untouched).

**Risks**: **Primary** — the diagnosis in criterion 1 may show the host emulator is simply unreachable from this container, in which case the proxy fails identically and the phase must stop rather than build; this is exactly why diagnosis is first and cheapest. **Verification asymmetry** — findings 1 and 10 mean the phase cannot self-verify: a new session plus project-scope approval is required, so criterion 3 carries a human checkpoint. **Unrecoverable-by-construction** — finding 7 makes any uncaught throw in the proxy fatal for the rest of a session; stdio framing is where that is easiest to get wrong. **Sequencing** — removing `vice-session` early is tempting and strands emulator access; keep criterion 8 behind criterion 3. **Scope creep toward 1.2** — leasing, on-demand launch, warm spares, and the TTL sweeper are 1.2, and instance handles are a seed (`.planning/seeds/vice-instance-handles-for-parallel-emulator-work.md`); 1.1 stays immune to every MEDIUM finding by not needing any of them.

**Research corrections (2026-07-31, `01.1-RESEARCH.md`):** three findings adjust this section rather than contradict it. (a) A live read-only probe found the host emulator **not running** — `ECONNREFUSED` on 6510/6511/6512, supervisor state files absent. So criterion 1's diagnosis has an answer already: the "`vice-session` doesn't work" claim conflates *the host is down* with *the design is wrong*, and the Bash path is working, heavily-used code (three real recovery captures went through it). The phase's justification is the hazard/tooling argument, not a defect. (b) `tools/README.md` records the empty `.mcp.json` as **deliberate decision D-5** — registering `mcp__vice__*` directly would bypass the deny-list/epoch discipline. The proxy is consistent with D-5's *intent* (it keeps that discipline and makes it the chokepoint) but the plan must say so explicitly rather than appear to reverse a recorded decision. (c) Claude Code exposes a per-tool `_meta["anthropic/maxResultSizeChars"]` override up to 500,000 chars, which may be a simpler answer to criterion 5's 64K-RAM-read problem than proxy-side chunking.

**Roadmap note (2026-07-31):** this detail section was reconstructed during `/gsd-plan-phase 1.1`. The `phase insert` that registered 01.1 and 01.2 wrote their summary lines and progress-table rows but no `## Phase Details` sections, which left `roadmap.get-phase` returning `malformed_roadmap`. Content is transcribed from the phasing table and the 1.1 column of `.planning/notes/vice-mcp-selector-design.md` plus the summary line above — no new scope was invented. **Phase 01.2 is still missing its detail section** and will fail the same way until it gets one.

---

### Phase 2: Coverage, Hazards & Memory Map

**Goal**: Every byte of the canonical image is classified as executed-code, read-as-data, or never-touched; every reachable routine is named; every construct that constrains reconstruction is catalogued; the memory map is documented
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: MAP-01, MAP-02, MAP-03, MAP-04, MAP-05
**Success Criteria** (what must be TRUE):

  1. `docs/coverage.md` reports an explicit percentage of the canonical image as executed-code / read-as-data / never-touched, derived from the **union** of live-trace and static reachability, and lists every remaining never-touched region as a named open item rather than leaving it implied.
  2. No byte range classified "data" in the annotation is visited by the program counter in any recorded trace — a scripted cross-check over the trace logs reports zero such hits.
  3. A VICE label file loads via `symbols_load` without error, and every routine the trace play-through reached resolves to a name; `grep -c 'unk_' ` over the reachable set is reported as a number in `docs/coverage.md`.
  4. `docs/hazards.md` lists every self-modifying-code site, computed-jump/RTS-dispatch table, page-alignment-sensitive region, and illegal/undocumented opcode found, each with its address and the evidence that found it (watchpoint hit, single-step resolution, or alignment requirement).
  5. `docs/memory-map.md` documents zero-page variables, buffers, table locations, VIC bank layout, and hardware register usage, with its address/label table generated from the symbol file rather than hand-copied.

**Plans**: 5 plans

Plans:

- [ ] 02-01: Disassembler toolchain decision (`toacme` vs `regenerator2000`) and first-pass listing over the canonical image — *strictly first*
- [ ] 02-02: Live-trace coverage instrumentation + exhaustive play-through (all 20 chambers, both opponents, every move, death, game over, hi-score entry); coverage bitmap and reported number (MAP-01, MAP-05) — *sequential (shared VICE); the trace logs it produces feed 02-03 and 02-04*
- [ ] 02-03: Label every reachable routine; emit the VICE symbol file (MAP-02) — *sequential after 02-02*
- [ ] 02-04: Hazard catalogue — write-watchpoints over code regions for SMC, single-step resolution of every suspected dispatch table, alignment requirements, illegal-opcode audit (MAP-03) — *parallel with 02-05 after 02-03 (needs VICE; queue its emulator steps)*
- [ ] 02-05: Memory map — generated address/label tier plus hand-written prose per region (MAP-04) — *parallel with 02-04 after 02-03 (no emulator needed)*

**Parallelisation**: 02-04 ∥ 02-05 once 02-03 lands. 02-01 → 02-02 → 02-03 strictly sequential. **Cross-phase**: Phase 3's plans 03-01 and 03-02 depend only on Phase 1 and should run as a parallel workstream alongside this phase (see Phase 3).

**Decisions to resolve here**: **`regenerator2000` vs `toacme`** — decided before annotation volume accumulates, because switching later means re-deriving the listing. `toacme` ships with the installed `acme` package and works now; `regenerator2000` (`cargo install`, needs `apt-get install cargo rustc`) adds traced code/data separation and VICE label import/export. Whichever wins, confirm it decodes the full illegal-opcode set before trusting a single line of its output.

**Risks (PITFALLS.md)**: **Pitfall 1 (primary)** — static/recursive-descent disassembly is precise but not complete; RTS-trick dispatch (`lda #>(t-1) / pha / lda #<(t-1) / pha / rts`) and hand-built indirect jumps are invisible to it, and inline data after a `JSR` desyncs the byte stream until the next branch target accidentally resynchronises. Live trace is the only mechanical tell. **Pitfall 2** — self-modifying code looks unremarkable until caught in the act; set write-watchpoints on code regions as standing practice, not on suspicion. **Pitfall 3** — an illegal opcode misdecoded upstream still assembles cleanly later; `!cpu nmos6502` catches "wrong mnemonic", not "wrong decode". **Pitfall 8** — establish the `?`/`unk_$addr` convention *here*, before documentation volume makes it expensive to retrofit. **Effort trap** — N near-identical per-room init variants: document the pattern once plus per-instance deltas, treat enumeration as data extraction.

---

### Phase 3: Verification Harness & Original Baselines

**Goal**: A deterministic replay harness exists and has recorded the original's checkpoint baselines, so the rebuild has something concrete to be judged against before any rebuild exists
**Mode:** mvp
**Depends on**: Phase 1 (plans 03-01, 03-02); Phase 2 (plans 03-03, 03-04 — checkpoint design needs the memory map)
**Requirements**: VERIFY-01, VERIFY-02, VERIFY-03, VERIFY-04
**Success Criteria** (what must be TRUE):

  1. `node verify/runner.mjs run --target=original --scenario=<name>` drives the original from an explicit scripted reset to every checkpoint in the scenario, and `verify/scripts/<name>.json` is a frame-keyed input timeline (not wall-clock) that reproduces the same run twice.
  2. `verify/DETERMINISM.md` records the result of running one script twice and diffing every checkpoint; any nondeterministic source found (power-on RAM pattern, raster/CIA reads, mid-frame framebuffer capture, warp-mode frame pacing) is named with the workaround applied, and a re-run after the workaround reports zero divergence.
  3. `verify/checkpoints/<name>.json` names every captured region by its `docs/memory-map.md` symbol — zero raw literal addresses in the file — and records for each region the reason it is included and, where excluded, why.
  4. `verify/baselines/<scenario>/` is committed, holding framebuffer hash plus named RAM-region values per checkpoint, captured from the original canonical image; the RAM regions are small enough to read in a diff.

**Plans**: 4 plans

Plans:

- [ ] 03-01: Input-script format, runner skeleton, target-loading path (`--target=original`); resolve the program-injection / `.d64`-writing tooling decision (VERIFY-01) — *runs as a parallel workstream alongside Phase 2; depends only on Phase 1*
- [ ] 03-02: Determinism proof — double-run diff, pinned emulator RAM-init configuration, frame-stable capture point synchronised to the game's own main-loop pacing (VERIFY-02) — *sequential after 03-01; also parallel with Phase 2 (queue its VICE steps behind Phase 2's)*
- [ ] 03-03: Checkpoint set design from `docs/memory-map.md` — curated game-state regions plus framebuffer, with a recorded rationale per region (VERIFY-03) — *hard gate: needs MAP-04 from Phase 2*
- [ ] 03-04: Baseline capture from the original; divergence-report schema (VERIFY-04) — *sequential after 03-02 and 03-03*

**Parallelisation**: 03-01 → 03-02 form a workstream that is genuinely independent of Phase 2 and should be executed alongside it — this is the project's strongest parallel stream, and the reason verification is not a terminal phase. 03-03 → 03-04 are gated on Phase 2's memory map. Note the shared-VICE constraint: 03-02's and Phase 2's emulator steps interleave, they do not run concurrently.

**Decisions to resolve here**: **`.d64` writing tool** (`c1541` standalone vs a minimal custom writer) — front-loaded to this phase rather than to packaging, because the harness must define how a *rebuild* target is loaded. If a `.prg` can be injected directly over MCP, record that and defer only bootable-disk mastering to Phase 7; if it cannot, `.d64` writing becomes a hard blocker on Phase 4 and must be solved now, not discovered then.

**Open question resolved here**: does VICE guarantee deterministic checkpoint replay? Run one script twice, diff every checkpoint. If it diverges, the harness's expectations change — and that is far cheaper to learn now than after a rebuild exists to blame.

**Risks (PITFALLS.md)**: **Pitfall 7 (primary)** — the harness can be polluted by legitimate nondeterminism: the C64/VICE power-on RAM pattern is not all-zero, so any region the game never initialises before use diffs spuriously unless both targets boot from an identical scripted reset with identical RAM-init config; raster/CIA-timer reads used as gameplay randomness diverge unless input timing is frame-identical; SID/VIC internal state is not in the RAM map; a mid-frame framebuffer capture differs between two runs of the *same* binary. Validate the capture point by capturing twice from one original run and requiring byte-identical output *before* the rebuild is ever involved. A full-RAM hash is acceptable only as a throwaway smoke test, never as the final gate. **Moderate** — shared-emulator discipline: name and version every snapshot; a stale-state comparison that "passes" is worse than a failing one.

---

### Phase 4: Vertical Slice — Sprite & Display Pilot

**Goal**: The whole pipeline is proven end-to-end on one subsystem — sprite handling and display is traced, annotated, documented, extracted, transcribed to ACME, built to a running `.prg`, and verified against the original's baselines with zero divergence
**Mode:** mvp
**Depends on**: Phase 2, Phase 3
**Requirements**: DOCS-01, DATA-02, BUILD-01, BUILD-02, BUILD-03, BUILD-04, VERIFY-05
**Success Criteria** (what must be TRUE):

  1. The single build entry point assembles `src/main.a` with ACME 0.97 under `--strict-segments` and exits non-zero on **any** warning — demonstrated by deliberately introducing an oversized-addressing-mode forward reference and observing the build fail, then removing it.
  2. The round-trip byte-diff check is wired into the build and reports byte-identical output for every transcribed region against `recovery/clean/bruce-lee.bin`; a deliberately introduced zero-page-vs-absolute drift in one instruction makes it fail and names the offending address range.
  3. `build/bruce-lee.prg` boots in VICE by the Phase 1 procedure and reaches gameplay, and `build/bruce-lee.vs` loads via `symbols_load` with names matching those cited in `docs/systems/sprite-display.md`.
  4. `docs/systems/sprite-display.md` explains sprite pointer management, VIC configuration, and any multiplexing, citing `src/` labels with addresses and file paths; `docs/formats/sprite-format.md` plus `assets/sprites/*.png` render every sprite from `data/sprites.bin`, with byte-offset provenance per asset.
  5. `node verify/runner.mjs run --target=rebuild --scenario=<sprite scenario> --compare` reports zero divergence against the Phase 3 baselines, and injecting a single wrong sprite-pointer byte makes it report which checkpoint, which named region, and what differed.

**Plans**: 5 plans

Plans:

- [ ] 04-01: Build skeleton — whole-image verbatim transcription that round-trips byte-identically, `--strict-segments`, warnings-as-blocking (extending or wrapping the `acme-build` skill), `.prg` + `.vs` emission, `!cpu nmos6502` where illegals appear (BUILD-01, BUILD-03, BUILD-04) — *strictly first*
- [ ] 04-02: Round-trip diff harness wired as the per-region promotion gate (BUILD-02) — *strictly second; the gate must exist before any region is promoted from blob to source*
- [ ] 04-03: Trace, annotate, and document the sprite/display subsystem; promote its region from verbatim blob to annotated ACME source with `!align` preservation and address-lock assertions at hazard sites (DOCS-01) — *sequential after 04-02*
- [ ] 04-04: Sprite data format spec + extraction to viewable PNGs (DATA-02) — *parallel with 04-05 after 04-03*
- [ ] 04-05: Divergence reporting + pilot verification run against the Phase 3 baselines, including the injected-fault check (VERIFY-05) — *parallel with 04-04 after 04-03*

**Parallelisation**: 04-01 → 04-02 → 04-03 strictly sequential (each is the other's precondition). 04-04 ∥ 04-05 afterwards.

**Why sprite/display is the pilot**: It is bounded enough to isolate — a raster-IRQ-driven region with a clear entry point, not entangled with game-state arbitration — while still exercising *every* stage of the pipeline. It needs live tracing (IRQ-driven code is precisely where dispatch tables and self-modifying code hide, so Pitfall 1 and 2 detection get a real workout). It needs address resolution against VIC-II registers, which is exactly what the `c64-memory-mapping` skill is for. It carries the project's hardest reconstruction hazard — 64-byte sprite-data alignment inside a 16KB VIC bank window — so Pitfall 6's alignment failure mode is confronted at the pilot rather than at scale. It has real data to extract (sprite tables → PNG), so the `data/` ↔ `assets/` v2 seam is exercised. And it produces a checkpoint that is meaningful on **both** verification channels: sprite pointer/position RAM regions localise a fault, and the framebuffer hash catches a misaligned sprite instantly.

*Alternatives rejected:* **combat/collision** is entangled with both AIs, the move tables, and the animation engine — a wrong pilot assumption there costs four subsystems instead of one, defeating the purpose. **Sound** is too isolated: SID output is not sampled by the checkpoint design at all (framebuffer + game-state RAM), so a sound pilot would silently skip the verification stage — the single most important stage to prove. **Player movement** is the runner-up, but its state is more entangled with combat arbitration and it exercises no alignment-sensitive data extraction.

**Risks (PITFALLS.md)**: **Pitfall 6 (primary)** — ACME defaults a forward reference to 16-bit absolute and only *warns* when zero-page would have sufficed, shifting every subsequent address in the segment; segment overlap is warning-only without `--strict-segments`; reordering can push a branch out of ±127 range; alignment-sensitive data placed wrong assembles cleanly and fails at runtime. All four are why criteria 1 and 2 are demonstrated with injected faults rather than asserted. **Pitfall 3** — round-trip diff is the only check that catches an illegal opcode misdecoded upstream; "it assembles" proves nothing. **Anti-Pattern 3** — do not split or restructure the pilot region beyond what `docs/hazards.md` marks safe. **Anti-Pattern 1** — iterate on `.prg`, never `.d64`. **Anti-Pattern 5** — where the ledger marks a byte CRACKER-PATCH, the choice to reproduce it or reconstruct the Datasoft original is explicit and tagged inline, never incidental.

---

### Phase 5: Actors — Movement, Combat & AI

**Goal**: Every actor subsystem — player movement, the move set and combat resolution, Yamo, and the Ninja — is documented and reconstructed through the pipeline Phase 4 proved
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: DOCS-02, DOCS-03, DOCS-04, DOCS-05, DATA-04
**Success Criteria** (what must be TRUE):

  1. `docs/systems/player-movement.md`, `docs/systems/combat.md`, `docs/systems/ai-yamo.md`, and `docs/systems/ai-ninja.md` each exist, cite `src/` labels with address and file path rather than paraphrasing, and tag every claim with a confidence marker; the doc-label linter passes, meaning every cited label is present in the emitted symbol table.
  2. Every region these four subsystems occupy is annotated ACME source rather than a verbatim blob, and each passes the round-trip byte diff against the canonical image.
  3. `docs/systems/combat.md` states how a strike is arbitrated (including the simultaneous-hit case) and `docs/systems/ai-yamo.md` states explicitly how Yamo's decision inputs and attack behaviour differ from the Ninja's — both traceable to named routines.
  4. `docs/formats/anim-table-format.md` specifies the animation frame table format, and `assets/anim/` holds each actor's extracted animation sequences with byte-offset provenance.
  5. Every hazard `docs/hazards.md` lists inside these regions carries an address-lock assertion or a `; HAZARD:` tag at its site in `src/`, and moving such a routine fails the build — demonstrated once.

**Plans**: 5 plans

Plans:

- [ ] 05-01: Player movement — walk/crouch/jump/climb model, screen boundaries, position representation; **allocate this phase's `src/zeropage.a` entries and `main.a` segment slots up front** (DOCS-02) — *strictly first, because it establishes the shared vocabulary and the high-fan-in file edits*
- [ ] 05-02: Move set and combat resolution — punch, kick, flying kick, hit detection, hit reaction, arbitration (DOCS-03) — *sequential after 05-01*
- [ ] 05-03: Yamo's AI — state machine, decision inputs, attack behaviour, contrast with the Ninja (DOCS-04) — *parallel with 05-04 and 05-05*
- [ ] 05-04: The Ninja's AI — state machine, pursuit, attack pattern (DOCS-05) — *parallel with 05-03 and 05-05*
- [ ] 05-05: Animation frame table format spec + per-actor sequence extraction (DATA-04) — *parallel with 05-03 and 05-04*

**Parallelisation**: 05-01 → 05-02 sequential (combat reads movement's position model). Then 05-03 ∥ 05-04 ∥ 05-05 — genuinely parallel: disjoint subsystems, disjoint `src/` and `docs/` files. **Two coordination hazards for parallel plans:** (a) `src/zeropage.a` and `src/main.a` are the highest-fan-in files in the tree and must not be edited concurrently — 05-01 allocates them for the whole phase; (b) any plan needing a live trace queues behind the others on the single VICE instance.

**Risks (PITFALLS.md)**: **Pitfall 1** — combat/animation/AI is exactly the code shape that uses jump tables and RTS-trick dispatch; a missed dispatch table leaves real code sitting in a "data table", silently un-reconstructed, and diverges only in the state-dependent way that a checkpoint may never exercise. Re-verify against the Phase 2 coverage bitmap rather than trusting the listing. **Pitfall 2** — direction-dependent sprite routines that patch a `CMP #` operand are idiomatic here; represent self-modification *as* self-modification and add a checkpoint that exercises every patched state, not just the default. **Pitfall 8** — this is where speculation hardens fastest (a label called `enemy_ai_state` that turns out to be indexed by chamber, not enemy); sweep `docs/` and `src/` on every correction, in the same change.

---

### Phase 6: World, Audio & Shell + Data Format Validation

**Goal**: The remaining subsystems — chambers, traps, scoring/lives/two-player, sound, and the title/attract/hi-score shell — are documented and reconstructed, and every data format spec is proven correct by round-trip rather than merely plausible
**Mode:** mvp
**Depends on**: Phase 4 (pipeline); Phase 5 not required
**Requirements**: DOCS-06, DOCS-07, DOCS-08, DOCS-09, DOCS-10, DATA-01, DATA-03, DATA-05, DATA-06
**Success Criteria** (what must be TRUE):

  1. `docs/systems/chamber-flow.md` and `docs/systems/traps.md` explain how the 20 chambers are represented, how exits link them, how the lantern objective drives progression, and each hazard type's trigger condition and effect on the player; `docs/formats/chamber-format.md` plus `assets/chambers/` cover all 20 chambers in inspectable form.
  2. `docs/systems/scoring.md` documents scoring, lives, and both two-player modes as distinct behaviours; `docs/systems/sound.md` documents SID usage, music and effect playback, and how audio is driven from gameplay events; `docs/systems/shell.md` locates title, attract, and hi-score entry and says what their code does, without deep analysis.
  3. `docs/formats/charset-format.md` with `assets/charset/*.png`, and `docs/formats/music-format.md`, both exist and cite the addresses their data lives at.
  4. A format-validation tool re-serialises every extracted representation — chamber, sprite, charset, animation, music — and reports byte-identical output against the corresponding `data/*.bin`, exiting non-zero on any mismatch.
  5. Every region these subsystems occupy passes the round-trip byte diff, and `docs/coverage.md` is regenerated to show the coverage number after this phase, with remaining never-touched regions still enumerated.

**Plans**: 5 plans

Plans:

- [ ] 06-01: Chambers and traps — representation, exit linkage, lantern objective, each hazard type; chamber data format spec + extraction of all 20 (DOCS-06, DOCS-07, DATA-01) — *parallel*
- [ ] 06-02: Scoring, lives, and both two-player modes; light documentation of title/attract/hi-score entry (DOCS-08, DOCS-10) — *parallel*
- [ ] 06-03: Sound — SID usage, player routine, event-driven playback; music and SFX data format spec (DOCS-09, DATA-05) — *parallel*
- [ ] 06-04: Character set and background graphics format spec + extraction to viewable images (DATA-03) — *parallel*
- [ ] 06-05: Format-spec round-trip validation across all five formats (DATA-06) — *strictly last; needs every spec from 06-01, 06-03, 06-04 and Phase 4's DATA-02, Phase 5's DATA-04*

**Parallelisation**: 06-01 ∥ 06-02 ∥ 06-03 ∥ 06-04 — four genuinely independent subsystems touching disjoint files. 06-05 is a hard gate at the end. Same two coordination hazards as Phase 5 apply: `zeropage.a`/`main.a` must be allocated for the whole phase before the parallel plans start, and live-trace steps queue on the single VICE instance. This phase can also overlap Phase 5 if the workstream budget allows — nothing in it depends on Phase 5's output.

**Risks (PITFALLS.md)**: **Effort traps** — three of them concentrate here. (a) *SID rabbit hole*: cap effort at identifying the player routine and data format well enough to extract and document per DATA-05; do not chase full understanding of every SID trick. (b) *Title screen / hi-score depth-creep*: DOCS-10 says "lightly" and PROJECT.md scopes it out; runs correctly, lightly annotated, stop. (c) *Repetitive per-chamber init variants*: document the pattern once with per-instance deltas, treat enumeration as data extraction. **Pitfall 8** — parallel authoring across four plans is where two documents most easily give different explanations of the same address; the doc-label linter catches broken citations, not contradictory prose, so the correction-sweep discipline carries the weight. **"Looks done but isn't"** — a format spec that is plausible but wrong is exactly what 06-05 exists to catch; a spec is not validated until re-serialisation reproduces the original bytes.

---

### Phase 7: Complete Source Tree, Bootable Disk & Full-Suite Verification

**Goal**: The reconstruction is complete, split to mirror the documentation, packaged as a bootable `.d64`, and passes the full replay suite with no divergence — the project's definition of done
**Mode:** mvp
**Depends on**: Phase 5, Phase 6
**Requirements**: DOCS-11, BUILD-05, BUILD-06, BUILD-07, VERIFY-06, VERIFY-07
**Success Criteria** (what must be TRUE):

  1. An annotated disassembly listing covers every routine `docs/coverage.md` marks reachable during gameplay, with each address resolved against the C64 memory map; the count of unnamed reachable routines is zero and is reported as a number.
  2. `src/` is split into per-subsystem files mirroring `docs/systems/`, and the split produces a **byte-identical** `.prg` against the pre-split build; every region `docs/hazards.md` marks unsafe to split is recorded as deliberately left intact, with the reason, at its site.
  3. One command produces `build/bruce-lee.prg`, `build/bruce-lee.vs`, and `build/bruce-lee.d64` from a clean tree, and the resolved `.d64` writing tool is committed under `tools/` and documented.
  4. `build/bruce-lee.d64` boots under VICE by the Phase 1 recorded procedure and starts the game the way the original disk does.
  5. `verify/scripts/` covers all 20 chambers, both opponents, the full move set, and both two-player modes, and a full-suite rebuild run exits zero with a divergence report committed to `verify/reports/` showing zero divergent checkpoints.

**Plans**: 5 plans

Plans:

- [ ] 07-01: Complete the annotated disassembly listing over every reachable routine (DOCS-11) — *parallel with 07-02/07-03 chain and with 07-04*
- [ ] 07-02: Split `src/` per subsystem as a behaviour-preserving refactor, gated on a byte-identical `.prg` diff; `!source` order preserves original layout; fall-through pairs and RTS-trick regions left intact (BUILD-07) — *sequential before 07-03*
- [ ] 07-03: `.d64` packaging with the tool resolved in Phase 3; single-command build (BUILD-05, BUILD-06) — *hard gate: needs a `.prg` from 07-02*
- [ ] 07-04: Author the full replay suite — all 20 chambers, both opponents, every move, both two-player modes; capture the corresponding original-side baselines (VERIFY-06) — *parallel with 07-01 and the 07-02/07-03 chain; its baseline captures queue on the single VICE instance*
- [ ] 07-05: Full-suite rebuild run, divergence triage, final verification report (VERIFY-07) — *strictly last*

**Parallelisation**: three streams — 07-01 (listing), 07-02 → 07-03 (split then package, hard-gated), 07-04 (suite authoring + original baselines) — then 07-05 alone at the end. Note 07-04 captures *original-side* baselines for the new scenarios, which needs no rebuild and is why it can run alongside the packaging chain.

**Risks (PITFALLS.md)**: **Pitfall 6** — the split is exactly where branch-out-of-range and silent segment overlap appear; `--strict-segments` plus the byte-identical `.prg` check make both mechanical. A pure-reorganisation commit that does *not* produce a byte-identical `.prg` has changed something, and the diff says where. **Pitfall 7 / "looks done but isn't"** — a passing suite proves nothing if the checkpoints are too coarse or too few; VERIFY-06's coverage requirement (20 chambers, both opponents, full move set, both 2P modes) is the guard, and it is a success criterion rather than a nice-to-have for that reason. **Anti-Pattern 5** — before declaring done, confirm no CRACKER-PATCH byte was reproduced silently; every such choice is tagged inline. **Pitfall 8** — final sweep for surviving `?`-marked claims and `unk_` labels: resolve or explicitly re-flag with a reason they are still open.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

Two cross-phase overlaps are intended and should be honoured when scheduling workstreams:

- Phase 3 plans 03-01 and 03-02 depend only on Phase 1 and run alongside Phase 2.
- Phase 6 depends only on Phase 4 and can overlap Phase 5.

| Milestone | Phase | Plans Complete | Status | Completed |
|-----------|-------|----------------|--------|-----------|
| v1.0 | 1. Recovery & Provenance | 3/6 | In Progress|  |
| v1.0 | 01.1. Tool-Mediated Emulator Access (INSERTED) | 0/3 | Not started | - |
| v1.0 | 01.2. On-Demand Broker & Leasing (INSERTED) | 0/5 | Not started | - |
| v1.0 | 2. Coverage, Hazards & Memory Map | 0/5 | Not started | - |
| v1.0 | 3. Verification Harness & Original Baselines | 0/4 | Not started | - |
| v1.0 | 4. Vertical Slice — Sprite & Display Pilot | 0/5 | Not started | - |
| v2.0 | 5. Actors — Movement, Combat & AI | 0/5 | Not started | - |
| v2.0 | 6. World, Audio & Shell + Data Format Validation | 0/5 | Not started | - |
| v2.0 | 7. Complete Source Tree, Bootable Disk & Full-Suite Verification | 0/5 | Not started | - |

**v1.0 progress:** 0/28 plans · **v2.0 progress:** 0/15 plans

*Phases 1.1 and 1.2 carry insertion-time estimates (0/3, 0/5); `/gsd-plan-phase` sets the real counts.*

## Requirement Coverage

All 44 requirements map to exactly one phase. No orphans, no duplicates.

**Phases 1.1 and 1.2 carry no requirements**, by design — they are tooling that changes how every
later phase reaches the emulator, not deliverables the requirements describe. The coverage invariant
above is unaffected: no requirement moved, and none was added.

| Milestone | Phase | Requirements | Count |
|-----------|-------|--------------|-------|
| v1.0 | 1 | RECOVER-01, RECOVER-02, RECOVER-03, RECOVER-04, RECOVER-05, RECOVER-06, RECOVER-07, RECOVER-08 | 8 |
| v1.0 | 2 | MAP-01, MAP-02, MAP-03, MAP-04, MAP-05 | 5 |
| v1.0 | 3 | VERIFY-01, VERIFY-02, VERIFY-03, VERIFY-04 | 4 |
| v1.0 | 4 | DOCS-01, DATA-02, BUILD-01, BUILD-02, BUILD-03, BUILD-04, VERIFY-05 | 7 |
| | | **v1.0 subtotal** | **24** |
| v2.0 | 5 | DOCS-02, DOCS-03, DOCS-04, DOCS-05, DATA-04 | 5 |
| v2.0 | 6 | DOCS-06, DOCS-07, DOCS-08, DOCS-09, DOCS-10, DATA-01, DATA-03, DATA-05, DATA-06 | 9 |
| v2.0 | 7 | DOCS-11, BUILD-05, BUILD-06, BUILD-07, VERIFY-06, VERIFY-07 | 6 |
| | | **v2.0 subtotal** | **20** |
| | | **Total** | **44** |

**v3.0 (not yet phased):** ASSET-01, ASSET-02, ASSET-03, ASSET-04, EXT-01, EXT-02 — 6 requirements.

## Tooling Decisions & Open Questions — Where Each Lands

| Item | Resolved in | Why there |
|------|-------------|-----------|
| VICE bootstrap method (attach/boot tool vs `snapshot_load`) | Phase 1, plan 01-01 | Nothing in the project runs without it |
| `.d64` writing tool (`c1541` vs custom writer) | Phase 3, plan 03-01 | The harness must define how a rebuild target loads; if `.prg` injection is unavailable this becomes a Phase 4 blocker, so it cannot wait for packaging |
| `regenerator2000` vs `toacme` | Phase 2, plan 02-01 | Decided before annotation volume accumulates; switching later means re-deriving the listing |
| Crack independence (empirical) | Phase 1, plan 01-05 | Sets the confidence weight of every "both releases agree" verdict |
| Emulator determinism (empirical) | Phase 3, plan 03-02 | Must be known before baselines are trusted, and long before a rebuild exists to blame |
