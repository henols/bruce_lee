# Roadmap: Bruce Lee — Reverse Engineering & ACME Reconstruction

## Overview

The project starts with two cracked disk images and nothing else, and ends with an ACME source tree that rebuilds a Bruce Lee which passes a scripted replay suite against the original with zero divergence, alongside documentation that explains every gameplay system well enough to change it. The route there is deliberately *vertical, not layered*: after recovering a clean memory image (Phase 1) and mapping what is code, what is data, and where the reconstruction hazards are (Phase 2), the verification harness and the original's baselines are built next (Phase 3) — before any rebuild exists, because baselines need only the recovered image. Phase 4 then drives **one** subsystem all the way through the full pipeline (trace → annotate → document → extract → transcribe to ACME → build → verify against baseline). Its real deliverable is a *proven pipeline*; the documented sprite/display subsystem is the artifact that proves it. Phases 5 and 6 scale the remaining subsystems out across that proven pipeline as parallel plans. Phase 7 completes the listing, splits the source to mirror the documentation, packages the bootable `.d64`, and runs the full suite that defines done.

Three risks decided this shape. A mistimed or incomplete RAM dump, jump-table code misclassified as data, and silent ACME addressing/alignment drift all surface — under horizontal layering — only at the verification phase, after everything has been built on top of them. The vertical slice moves that discovery to Phase 4, where a wrong assumption costs one subsystem instead of the whole disassembly.

## Standing Constraints

These apply across every phase and every plan; `/gsd-plan-phase` should inherit them rather than rediscover them.

| Constraint | Consequence for planning |
|---|---|
| **VICE is per-session and boot-fresh, granted by a host-side broker reached only over MCP** | Emulator access is per-session and boot-fresh: each session's first forwarded tool call is granted its own freshly launched instance, killed when that session ends. Cross-**session** concurrency is real — two plans running in two different sessions no longer serialise on one emulator, proven by two concurrent sessions holding two different broker-granted instances (see `.planning/phases/01.2-on-demand-broker-and-per-session-leasing/01.2-CRITERION-13-EVIDENCE.md`). The reset/clear-checkpoints/reload ritual is **NARROWED, not retired** (D-1.2-C): a fresh boot removes cross-session contamination structurally, so a plan no longer needs the ritual to protect itself from a *previous session's* state, but it does **not** remove contamination within a session that reuses one emulator across several plans — a plan that is not the first emulator-touching plan of its session still opens with the ritual. Intra-**session** parallelism is still out of scope: subagents share their parent session's single proxy connection and therefore its single instance, so a parallel executor wave inside one session still shares one emulator and its steps still queue — see `.planning/seeds/vice-instance-handles-for-parallel-emulator-work.md` for the deferred design. The broker is started by hand on the host and nothing auto-starts it; a broker-absent tool call reports which of three states it is in and what to do. See `.planning/notes/vice-mcp-selector-design.md`. |
| **`vice_disk_list` crashes the host MCP server** | Never called. Disk directory inspection is done by parsing `.d64` bytes directly. Recovery from an accidental call needs a manual host-side VICE restart. |
| **Host-side tools need translated paths** | Every artifact a host-side tool touches stays inside the workspace and goes through the `devcontainer-host-path` skill. **Phase 01.1 is expected to retire the manual half of this**: the proxy sees every forwarded call, so it can translate container paths to host paths itself and callers stop doing it by hand. Until 01.1 lands, this constraint stands exactly as written. |
| **All ACME warnings are build-blocking; `--strict-segments` always** | Established as a gate in Phase 4 and inherited by every later phase. The `acme-build` skill's wrapper does not currently expose `--strict-segments` or a warning-gated exit — Phase 4 must extend it (or wrap it) rather than assume the flag is reachable. |
| **Per-region round-trip byte diff is the transcription gate** | A region is not "transcribed" until reassembling it reproduces the canonical image's bytes at that address range. Non-optional, every region, every phase from 4 onward. |
| **Confidence-marker convention from Phase 2 onward** | Speculative labels/claims carry a `?` suffix; unknown regions use `unk_$addr`. `grep -rn '^unk_' src/` and `grep -rn '?' docs/` are live completeness metrics. A correction is incomplete until the old name/claim is swept out of `docs/` and `src/` in the same change. |
| **Provenance ledger is the single source of truth** | `recovery/PROVENANCE.md` → `docs/provenance.md` summary → inline `; PROVENANCE:` tags in `src/`. One direction only; never edit a downstream copy independently. |

**No UI hint on any phase.** Several phases match generic UI keywords ("display", "screen", "title screen", "layout") but none is a frontend phase — this is 6510 assembly against VIC-II registers. `/gsd-ui-phase` would be misapplied here, so the annotation is deliberately omitted rather than overlooked.

## Milestones

The 7 phases are split across two milestones at the Phase 4 boundary, with a third already scoped from the deferred requirements. A fourth, **v1.1**, was inserted ahead of the rest of v1.0 on 2026-08-02 — see the insertion note below the table.

| Milestone | Phases | Reqs | What it delivers |
|---|---|---|---|
| **v1.1 — Emulator Access Hardened** *(active, inserted 2026-08-02)* | 01.3–01.6 | 0 (tooling) | Every tool the proxy implements actually reaches the agent that needs it; a dead or wedged instance costs one acquisition instead of the whole session; the broker never warms, grants or retains an instance that is not real; and the broker's coordination logic moves into Node behind a TCP control plane, retiring the file-messaging protocol. The deliverable is **live emulator work that survives its own failure modes** — every long unattended session from Phase 1's remaining play-through onward depends on it. |
| **v1.0 — Pipeline Proven** *(paused behind v1.1)* | 1–4 | 24 | A clean canonical image with per-byte provenance, a full code/data map, a working replay-verification harness with the original's baselines recorded, and one subsystem (sprite/display) driven end-to-end through the pipeline to a verified `.prg`. The deliverable is a **proven pipeline**. |
| **v2.0 — Complete Reconstruction** | 5–7 | 20 | Every remaining subsystem documented and reconstructed, all data formats proven by round-trip, the annotated listing complete, source split to mirror the docs, a bootable `.d64`, and the full replay suite passing. This is where "fully documented and recompiled" is actually met. |
| **v3.0 — Editable** | — | 6 | Round-trip asset converters (`ASSET-01..04`) and the change guide + chamber editor (`EXT-01..02`). Deferred; not yet phased. |

**Scope note.** v1.0 intentionally ships short of the original project goal. The full "documented and recompiled" deliverable lands at v2.0 — v1.0 exists to de-risk it by proving every stage of the pipeline works before scaling out. Do not read a v1.0 close as project completion.

### v1.1 insertion note (2026-08-02)

**Why a milestone and not a fourth inserted phase.** Emulator-tooling work has arrived as decimal insertions three times already (01.1, 01.2, 01.3), one problem at a time, each one interrupting Phase 1. What is outstanding is no longer one problem: it is twelve recorded defects and design changes across the proxy, the broker and the tool surface, and several of them are the direct cause of Phase 1 stalling five times. Batching them behind a single completion bar is the point — the alternative is a fourth, fifth and sixth insertion discovered the same way, mid-plan, at the cost of an executor's context each time.

**This displaces v1.0 rather than running beside it.** v1.0's remaining work (plan 01-04's live play-through, then Phases 2–4) is long unattended emulator sessions, which is exactly the workload every v1.1 defect makes expensive or impossible. v1.0 does not resume until v1.1 closes. `/gsd-complete-milestone` has not been run on v1.0 and must not be — it is paused, not finished, and its 24 requirements are untouched by this insertion.

**Requirement accounting is deliberately zero.** Phases 01.1, 01.2 and 01.3 carry no REQ IDs; the 24 requirements are RE-domain scope, and the requirement-coverage gate reads tooling phases as unmapped by design. v1.1 follows that established pattern rather than minting a `TOOL-xx` block that would break the "24 requirements" accounting in this file, `REQUIREMENTS.md` and `STATE.md` at once.

**Execution order is not numeric order.** Phase 01.3 sorts first and runs last — see its own PAUSED annotation. The order is **01.4 → 01.5 → 01.6 → 01.3**.

**Gating risk — CLEARED 2026-08-02.** Phase 01.6 (and, since the 2026-08-02 split, Phase 01.7) depended on a fact nobody in this container can check: whether the host has a usable `node` on PATH. **It does** — confirmed by the developer, who has host access; not verified from the container, which cannot verify it by construction. The TCP control plane is therefore in scope, and the fallback branch (01.3 resuming against the bash broker with `vice_recycle` staying on the file protocol) is off the table. Treat the first host-side `node` invocation during 01.6 as the mechanical confirmation of this answer.

**At v1.0 close**, `/gsd-complete-milestone` archives Phases 1–4 to `.planning/milestones/v1.0-ROADMAP.md`, archives the 24 completed requirements, runs the PROJECT.md evolution review, and `/gsd-new-milestone` opens v2.0 with Phases 5–7 promoted into a fresh `REQUIREMENTS.md`.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

### Milestone v1.1 — Emulator Access Hardened *(active, inserted 2026-08-02)*

Execution order is **01.6 → 01.6.1 → 01.6.2 → 01.6.2.1 → 01.6.3 → 01.4 → 01.3 → 01.8**, not numeric order.

> **PHASE 01.8 APPENDED 2026-08-04 (developer).** The developer's instruction is that the remaining
> phases are driven autonomously, with no check-ins, and that **anything genuinely requiring the
> developer is collected into one phase they come back to** rather than halting the run. Phase 01.8 is
> that phase, and it is last. Consequence accepted knowingly: several phases will seal with criteria
> marked CARRIED rather than verified, so **no v1.1 phase seal should be read as live-verified until
> 01.8 closes** — which is a sharper version of the limit 01.6, 01.6.1 and 01.6.2 already carry.

> **SPLIT AGAIN 2026-08-03 (developer, via `/gsd-plan-phase 01.6.2`, at plan time).** Was
> `01.6 → 01.6.1 → 01.6.2 → 01.6.3 → 01.4 → 01.3`. `gsd-planner` returned
> `## PHASE SPLIT RECOMMENDED` — ~13 plans across 11 near-sequential waves against a `standard`
> granularity of 3–5 — and the developer took the split. **Phase 01.6.2.1 (Broker Lifecycle Policy)**
> is inserted directly after 01.6.2 and takes its criteria **E, L and M**. This does **not** undo the
> absorption below: 01.7 still lands whole inside 01.6.2, and 01.5 stays an `ABSORBED` stub that
> never returns — only its *defect fixes* move into the sub-phase. The split axis is the seal
> boundary, not the *conversion | defects | transport* axis the developer rejected earlier the same
> day. See § Phase 01.6.2 for the quantified basis and § Phase 01.6.2.1 for what it owns.
>
> **RE-SEQUENCED AGAIN 2026-08-03 (developer, via `/gsd-discuss-phase 01.6.2`).** Was
> `01.6 → 01.6.1 → 01.6.2 → 01.6.3 → 01.4 → 01.5 → 01.7 → 01.3`. **Phases 01.5 and 01.7 are
> absorbed into 01.6.2** and no longer run — their sections are retained as `ABSORBED` stubs with
> full criteria disposition tables, not deleted, so existing cross-references keep resolving.
> This reverses the 2026-08-02 split for two of its four members; see each stub for what was given
> up. **01.6.2 now lands the conversion, five behaviour changes and the transport together, with no
> live verification available until 01.4.** Decisions: `01.6.2-CONTEXT.md` D-01…D-03.
>
> **Neither phase was renumbered, deliberately.** `gsd-tools phase remove` renumbers sibling
> decimals but silently skips three-level children (`01.6.1`/`01.6.2`/`01.6.3` do not match its
> pattern), so removing `01.5` would have renamed the *completed* `01.6` directory to `01.5` and
> orphaned its three children. Filed as a pending todo.

> **RE-SEQUENCED 2026-08-02 (developer).** Was `01.4 → 01.5 → 01.6 → 01.3`. The developer chose to
> land the TypeScript conversion **before** any further work on the files it rewrites, which forced
> the split criterion 15 had already flagged as likely: old 01.6 divides into **01.6 (the conversion)**
> and **01.7 (the transport)**. Consequence recorded honestly: 01.5's original rationale — *fix the
> defects in bash, in place, so 01.6 relocates working code* — **is dead**, because there is no bash
> left to fix in place. What survives, and is the reason this ordering works, is the discipline that
> rationale existed to protect: **defects are still fixed before the protocol changes** (01.5 before
> 01.7), so a transport regression still has one candidate cause. Fixing a stringly-typed state
> machine in TypeScript is also a better outcome than fixing it in bash — the 2026-08-01
> triple-launch outage was exactly that class of bug. Decision record:
> `.planning/notes/one-process-broker-in-typescript.md`.

- [ ] **Phase 01.3: Wedge Detection and Recovery** *(INSERTED — **PAUSED at 5/6 plans**, resumes LAST)* - Close the gap the broker cannot see: `x64sc` alive and answering, but the emulated CPU retiring zero cycles. Paused 2026-08-02 with only 01.3-06 outstanding: `vice_recycle` is a control-plane command living on the file protocol that **Phase 01.6.2** replaces (~~01.7~~ — absorbed 2026-08-03), and both of this phase's tools are unreachable from an agent session until Phase 01.4 lands, so its final plan cannot be verified live. **Resumes once 01.6.2 and 01.4 have closed.** Note its recovery path was designed against a *separate* supervisor process holding the respawn loop; Phase 01.6 collapses that inward, so re-read before resuming
- [ ] **Phase 01.4: Tool Surface Reachability** *(INSERTED — now runs **second**, in TypeScript)* - Make every tool the proxy implements reach the agent that needs it, in every session shape the project uses including subagents, and close the deny-list hole the generic call path opens. `vice_diagnose` and `vice_recycle` are written, 268/268 green and invisible; `mcp__vice__*` was structurally absent from an executor subagent's schema; `vice_disk_list` was observed in a `tools_list` response
- [~] **Phase 01.5: Session and Broker Survivability** — **ABSORBED INTO 01.6.2 (2026-08-03), does not run** - A dead instance costs one acquisition, not the session, and the broker never warms, grants or retains an instance that is not real. Its seven criteria are dispositioned one by one in its retained section; 01.6.2 criterion M is the gate that requires the plan to show where each lands. Criteria 4 (replenish cap semantics) and 6 (`GRANT_POLL_TIMEOUT_MS` headroom) are flagged there as **not settled**
- [ ] **Phase 01.6: Conversion Foundation and Scope Reduction** *(INSERTED — **split four ways 2026-08-02 at plan time**; runs **first**)* - Prove the whole TypeScript build topology end-to-end on one real module before 16,000 lines ride on it, and reduce the scope: delete the `vice-pool` subsystem and `vice.mjs`'s CLI behind a confirmation gate, record the locked decision that reverses, and fix the `.gitignore` / `.mcp.json` landmines that a file move would otherwise trip. Holds the shared C1–C10 criteria register for all four groups. ~~Gated on whether the host has a usable `node`~~ **gate cleared 2026-08-02 — the host has `node` on PATH**
- [ ] **Phase 01.6.1: Container-Side Conversion to TypeScript** *(INSERTED 2026-08-02 — split out of 01.6)* - Convert the 11 surviving `.mjs` modules (5,316 lines) and 5 surviving test files (5,518 lines) to TypeScript with the suite green **continuously**, not green at the end. Widen the TDZ static check to the transitive `repo-root → install-resources → hostpath → repo-root` cycle the planner found, and bar `enum`/`namespace`/parameter-properties mechanically from the first file
- [ ] **Phase 01.6.2: The One-Process Host Broker** *(INSERTED 2026-08-02 — split out of 01.6)* - 2,546 lines of host-side bash become one TypeScript process owning coordination, per-instance supervision and the warm-spare pool. Includes the `vice-broker.test.mjs` **redesign** (2,685 lines / 61 tests — it verifies the daemon by spawning it and reading on-disk state, which stops existing), the single-`in_flight`-owner race test, and D-04: the epoch file survives as a second on-disk exception, written by the broker
- [x] **Phase 01.6.2.1: Broker Lifecycle Policy** *(INSERTED 2026-08-03 — split out of 01.6.2 at plan time)* - Fix the broker's five lifecycle-policy defects rather than translate them — five labelled tasks, five tests, separate commits — disposition Phase 01.5's seven absorbed criteria one by one against real work (criterion M is where absorbing 01.5 actually seals), and itemise every claim neither 01.6.2 nor this phase could verify live into the carry-forward list **Phase 01.4** must discharge. Shares 01.6.2's four artifacts unchanged; has none of its own. **D-07's launch-priority change is blocked on 01.6.2 criterion C's race test being green**, so a failure has one candidate cause
- [x] **Phase 01.6.3: `@mastra/mcp` Adoption** *(INSERTED 2026-08-02 — split out of 01.6, deliberately last)* - Swap the ~164-line generic JSON-RPC seam in the proxy for `@mastra/mcp` (developer decision D-01, taken against research's HIGH-confidence advice), with the ~88–94% of project-specific logic working unchanged, a decided `COVERAGE.md` capability matrix, a blocking package-legitimacy checkpoint, and D-06: whether to bundle to preserve the container's zero-dependency-clone property
- [~] **Phase 01.7: The TCP Control Plane** — **ABSORBED INTO 01.6.2 (2026-08-03), does not run** - Replace the file-messaging protocol with one TCP control connection per proxy whose lifetime *is* the lease, so connection close — including on SIGKILL — is the release, enforced by the kernel. Bootstrap stays a file for discovery; the emulator data plane is untouched; broker restart reaps unconditionally and voids via the existing epoch mechanism; CR-01's singleton guard closes here. All eight criteria are dispositioned in its retained section — **criterion 7 (cross-project brokering) is dropped entirely, and criterion 8's live verification is unavailable because 01.4 has not landed**
- [ ] **Phase 01.8: Developer Closure & Live Verification** *(INSERTED 2026-08-04 — runs **LAST**, and exists so the autonomous run never stops)* - Settle the v1.1 claims only the developer can settle, and complete the work each answer unblocks in the same phase. Six authored HV rows: the host-side backstop truths 01.6 and 01.6.1 share, the blocking `@mastra` package-legitimacy approval, D-06's bundle-or-`npm install` decision, 01.4's live-session criteria, 01.3-06's human-verify gate, and the `CF-01.4-NN` carry-forward list. **HV-05 is structurally unautomatable** — it asks a human to confirm no criterion was reworded to fit its outcome, so the agent cannot answer it. New blockers found mid-run are appended, never dropped

### Milestone v1.0 — Pipeline Proven *(paused behind v1.1)*

- [ ] **Phase 1: Recovery & Provenance** - Defeat both crack loaders, capture a clean canonical memory image, and give every byte range a provenance verdict
- [x] **Phase 01.1: Tool-Mediated Emulator Access** *(INSERTED)* - Diagnose why `vice-session` fails, remove it, and replace it with `vice-mcp-selector`: one static `.mcp.json` entry whose stdio proxy forwards to a fixed host port, surfacing the emulator as real `mcp__vice__*` tools and enforcing the known hazards in code. No leasing, no broker — deliberately immune to every unverified assumption (completed 2026-07-31)
- [x] **Phase 01.2: On-Demand Broker and Per-Session Leasing** *(INSERTED)* - Add the host-side broker: launch a fresh `x64sc` per session on first use, kill it at session end, keep N warm spares, sweep orphans on TTL. This is the phase that makes cross-session concurrency real and narrows the reset ritual. ~~Gated by the lifecycle spike~~ **spike gate cleared 2026-07-31** (`.planning/spikes/`, 4 spikes; design findings 8 and 12 corrected, 4/5/6 confirmed, 13/14/15 new) (completed 2026-08-01)
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

**Plans**: 4/6 plans executed

Plans:

- [x] 01-01-PLAN.md
- [x] 01-02-PLAN.md
- [x] 01-03-PLAN.md
- [ ] 01-04-PLAN.md
- [x] 01-05-PLAN.md
- [ ] 01-06-PLAN.md

**Wave 1**

- [x] 01-01: **Tracer** — one release recovered end-to-end: MCP client seam, boot, loader-done signal, bank-scoped 64K capture, byte-identical re-run proof, `RELEASES.json` registry (RECOVER-01, RECOVER-02) — *strictly first; everything else in this phase depends on it*

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02: Complete the per-dump artifact set — chip-state sidecar (D-04) and range manifest (D-02); parse both disk directories from `.d64` bytes; release-schema invariant validator (RECOVER-01, RECOVER-02) — *sequential (shared VICE)*

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03: Second release recovered by re-running the same recorded procedure, with N-readiness proven by the parameterisation gate (RECOVER-01, RECOVER-03) — *sequential (shared VICE)*

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 01-04: Earned on-demand-load detector as pure logic, live arming and bounded play-through driven by the agent's own `mcp__vice__*` tool calls for both releases, `LOADING.md` absence-as-evidence record, supplementary dumps rendered from committed observation records, both `NOTES.md` reproduction sections corrected (RECOVER-04) — *sequential; replanned twice — once after the first run was reverted (`bb0b1f7`), then again on 2026-08-01 when `mcp__vice__*` became the only permitted route to the emulator and the plan's CLI-driven design became impossible; one blocking human-verify gate on the coverage claim, which also settles D-13 if any load event fires*

**Wave 5** *(blocked on Wave 4 completion)*

- [ ] 01-05: Anchor-proven offset, N-way diff, gap-tolerant coalescing, three-bucket partition, `PROVENANCE.md` generated + prose tiers at 100% coverage (RECOVER-05, RECOVER-06) — *sequential; no emulator needed*

**Wave 6** *(blocked on Wave 5 completion)*

- [ ] 01-06: Crack-independence verdict with tiered evidence; canonical designation by measured patch count; `recovery/clean/` published as a projection of the registry (RECOVER-07, RECOVER-08) — *strictly last*

**Replanning note (2026-08-01, `/gsd-plan-phase 1`):** a hard rule landed mid-phase — **the `mcp__vice__*` tools are the only permitted route to the emulator**, so no script, module, test or driver may reach it and `tools/` holds pure logic only over data the agent fetched and passed in (`.claude/CLAUDE.md` § "Emulator Access"). Plans 01-01, 01-02 and 01-03 were already executed and are untouched; the evidence they produced is unaffected. **01-04 was rewritten**: its intent survives intact — earn the armed set, calibrate idle to zero, attribute every hit before classifying it, prove teardown by enumeration, record absence as evidence — but every CLI verb aimed at a live machine is gone, replaced by the agent's own tool calls with a committed observation record as the boundary between live work and pure logic. **01-05 and 01-06 were reviewed and found already correct** — verified independently to make zero emulator calls and to reference no deleted module — and carry only three corrections found by running the real validator during the replan (the manifest set is enumerated from the registry rather than hardcoded to two files; the loader bucket is seeded from the registry's earned `loader_ranges` rather than from prose; `validate --final`'s exits-zero claim moved from 01-05, where it is unachievable, to 01-06, which sets the canonical designation it asserts). `SKELETON.md`'s "Emulator control transport" row is retired in place with a dated superseding note rather than left to rot; its two premises — success criterion 1's mechanism and Phase 3's VERIFY-01 — are addressed in `01-04-PLAN.md` rather than abandoned, the second as an explicit deferral to Phase 3's own discuss cycle.

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
  9. **Container→host path translation happens in the proxy, not in every caller that goes through it.** Any path argument on a forwarded call that names a location inside the container workspace is rewritten to its host equivalent before the host emulator sees it — because VICE runs on the host, a container path is never correct there, and today a wrong one fails *silently*. A test proves an untranslated container path cannot reach the host. This is the same conversion as criterion 5: a rule that had to be remembered becomes a rule enforced at the one seam that sees every call. **The `devcontainer-host-path` skill is NOT retired by this**, and the plan must not try — its consumers were traced by hand in `01.1-PATTERNS.md`: `install-resources.mjs` uses it to print a host path for a *human* (nothing to do with tool calls), and `vice-sync.mjs`'s `screenshot()` plus `c64-ram-capture`'s `attachAndStart()` hand paths to VICE only through `tools/recover.mjs`'s standalone Bash-invoked pipeline, which criterion 8 deliberately preserves outside the MCP layer. The proxy becomes a **third consumer** of `hostpath.mjs`, not a replacement for it. What the phase retires is the *manual discipline* on the MCP-mediated path, not the module.

**Plans**: 4/4 plans executed

Plans:

- [x] 01.1-01-PLAN.md — Diagnosis (criterion 1), the tracer proxy proving one real tool call end-to-end, and the one static `.mcp.json` entry resolving D-5 (criteria 1, 2, tracer scope of 4)
- [x] 01.1-02-PLAN.md — `tools/list` from a committed snapshot with its refresh script, plus all three hazards enforced in code with per-layer tests (criteria 4, 5)
- [x] 01.1-03-PLAN.md — Never-throw hardening, fail-fast three-state diagnostics, proxy-owned path translation (criteria 6, 7, 9 proxy-side)
- [x] 01.1-04-PLAN.md — Blocking fresh-session proof, then the transport-module relocation and retirement of the documented Bash path (criteria 3, 8, 9 caller-side) — *has a blocking human-verify checkpoint*

**Wave 1** — 01.1-01 · **Wave 2** — 01.1-02 · **Wave 3** — 01.1-03 · **Wave 4** — 01.1-04. Strictly sequential: every plan after the first modifies `vice-proxy.mjs` and its test file, so same-wave parallelism is impossible by file ownership, independently of the criterion ordering.

**Parallelisation**: none meaningful. The diagnosis strictly precedes the build, and the removal in criterion 8 strictly follows the proof in criterion 3.

**Planning note (2026-07-31, `/gsd-plan-phase 1.1`):** the plan set is **tracer-first**. Plan 01.1-01's second task is a `type="tracer"` slice that wires one `tools/call` from stdin through the reused transport to an MCP server over HTTP and back out on stdout, with the never-throw handlers and the spawned-child test harness present from the first commit — retrofitting never-throw is how finding 7 turns into a session with no emulator access. The remaining plans expand horizontally from that proven slice. Five decisions were resolved with reversibility ratings and none rated `one-way`, so no `checkpoint:decision` was inserted: **D-A** fixed port 6510 via `tools/vice-supervisor.sh`; **D-B** `.mcp.json`'s first entry as D-5's resolution (rated `costly`); **D-C** committed schema snapshot plus refresh script; **D-D** epoch narrowed to mid-session restart detection via `readEpoch()` only, declining `assertSameMachine()`'s checkpoint-fallback probe; **D-E** the `_meta` output ceiling *plus* proxy-side continuation chunking, never truncation; **D-F** the pause-on-state-read discipline stays documented rather than absorbed, because `vice_execution_run` is this project's leading crash suspect; **D-G** the structural path rule with a loud refusal for out-of-workspace absolute paths and relative paths a stated residual. One deliberate deviation from `workflow.human_verify_mode: end-of-phase`: criterion 3 is a blocking `checkpoint:human-verify`, because it is a sequencing gate the removal work depends on rather than a look-at-it check.

**Decisions to resolve here** *(all five resolved at planning time — see the planning note above for the D-A … D-G verdicts and their reversibility ratings; the open framing is kept because it records why each was live)*:

- **Where the tool manifest for `tools/list` comes from** — a schema snapshot baked in at build time, or a live fetch cached from a warm emulator. Forced by finding 6: tools must enumerate with no emulator present.
- **Whether the proxy absorbs the pause-on-state-read polling discipline** (read → run → poll-with-`ping`, resume last) or leaves it documented. The proxy sees every call, so it *could* enforce ordering — design open question 4.
- **What the epoch check is for now** — with fresh boots expected, its job narrows to detecting a host restart *mid-session*; confirm that narrowing rather than inheriting the old semantics (design open question 5).
- **Which fixed port, and who launches the emulator on it during 1.1** — the existing pool/supervisor started by hand, or a documented manual `x64sc -mcpserver` invocation. On-demand launch is explicitly 1.2's job.
- **How the proxy recognises a path argument (criterion 9)** — a per-tool argument allow-list, or the narrower structural rule "any string argument beginning with the container workspace root". The structural rule is high-precision for `mcp__vice__*` specifically, because every path a VICE tool takes is host-side by definition; decide it explicitly rather than by accident, and decide what happens to a path that is *outside* the workspace (reject loudly, or forward untouched).

**Risks**: **Primary** — the diagnosis in criterion 1 may show the host emulator is simply unreachable from this container, in which case the proxy fails identically and the phase must stop rather than build; this is exactly why diagnosis is first and cheapest. **Verification asymmetry** — findings 1 and 10 mean the phase cannot self-verify: a new session plus project-scope approval is required, so criterion 3 carries a human checkpoint. **Unrecoverable-by-construction** — finding 7 makes any uncaught throw in the proxy fatal for the rest of a session; stdio framing is where that is easiest to get wrong. **Sequencing** — removing `vice-session` early is tempting and strands emulator access; keep criterion 8 behind criterion 3. **Scope creep toward 1.2** — leasing, on-demand launch, warm spares, and the TTL sweeper are 1.2, and instance handles are a seed (`.planning/seeds/vice-instance-handles-for-parallel-emulator-work.md`); 1.1 stays immune to every MEDIUM finding by not needing any of them.

**Research corrections (2026-07-31, `01.1-RESEARCH.md`):** three findings adjust this section rather than contradict it. (a) A live read-only probe found the host emulator **not running** — `ECONNREFUSED` on 6510/6511/6512, supervisor state files absent. So criterion 1's diagnosis has an answer already: the "`vice-session` doesn't work" claim conflates *the host is down* with *the design is wrong*, and the Bash path is working, heavily-used code (three real recovery captures went through it). The phase's justification is the hazard/tooling argument, not a defect. (b) `tools/README.md` records the empty `.mcp.json` as **deliberate decision D-5** — registering `mcp__vice__*` directly would bypass the deny-list/epoch discipline. The proxy is consistent with D-5's *intent* (it keeps that discipline and makes it the chokepoint) but the plan must say so explicitly rather than appear to reverse a recorded decision. (c) Claude Code exposes a per-tool `_meta["anthropic/maxResultSizeChars"]` override up to 500,000 chars, which may be a simpler answer to criterion 5's 64K-RAM-read problem than proxy-side chunking.

**Roadmap note (2026-07-31):** this detail section was reconstructed during `/gsd-plan-phase 1.1`. The `phase insert` that registered 01.1 and 01.2 wrote their summary lines and progress-table rows but no `## Phase Details` sections, which left `roadmap.get-phase` returning `malformed_roadmap`. Content is transcribed from the phasing table and the 1.1 column of `.planning/notes/vice-mcp-selector-design.md` plus the summary line above — no new scope was invented. **Phase 01.2's detail section was reconstructed the same way during `/gsd-plan-phase 1.2`** — see the roadmap note at the end of that section.

---

### Phase 01.2: On-Demand Broker and Per-Session Leasing

**Goal**: A host-side broker owns emulator lifecycle — each session gets a boot-fresh `x64sc` launched on demand at its first tool call and killed when that session ends — so cross-session concurrency is real, contamination is structurally impossible, and the reset/clear-checkpoints/reload ritual narrows to within-session reuse only
**Depends on**: Phase 01.1 (complete). The proxy at `.claude/mcp/vice/vice-proxy.mjs` is the client side of this protocol; 01.2 replaces the fixed-port target it forwards to with a requested, granted, leased instance. No longer gated by the lifecycle spike — **that gate cleared 2026-07-31** (`.planning/spikes/`, 4 spikes, all VALIDATED). The findings it rested on (4, 5, 8) are now MEASURED, and 8 was **corrected**, not merely promoted.
**Requirement mapping**: none — tooling phase, by design (see § Requirement Coverage). Deliberately written *without* a `**Requirements**:` key so the requirement-coverage gate reads this phase as unmapped rather than parsing this sentence as a REQ-ID.
**Success Criteria** (what must be TRUE):

  1. A host-side broker daemon exists and is startable by hand — `vice-broker.sh start [N]`, default `N=3`, range `1..16`, mirroring `vice-pool.sh start 3` so existing muscle memory carries over. It is the same long-lived shape `tools/vice-supervisor.sh:350` already uses (`while true` with backoff, `trap cleanup INT TERM`) with a request queue instead of a fixed port, and it inherits the container guard: the broker only runs on the host, because only the host can launch or kill `x64sc`.
  2. The request/grant/lease protocol is files on the shared bind mount, under the **existing** `.vice-supervisor/` directory — `broker.json` (liveness: pid, started_at, heartbeat mtime), `requests/<id>.json`, `grants/<id>.json`, `denials/<id>.json`, `leases/<id>`, and the existing per-port `<port>/` dirs. No new port, socket, IPC mechanism, mount, or gitignore entry — this matches recorded decision D-2. Every write is tmp-file + `rename()` in the same directory, never in place, so a poller can never read a half-written file. Polling is the contract; `inotify` is at most an optional accelerator, because same-inode bind-mount behaviour is a property of *this* host and not of the design.
  3. **Acquisition stays deferred.** `initialize` and `tools/list` neither launch nor request an emulator (01.1 criterion 4, forced by finding 6's eager spawn); the request is written on the first real `tools/call`. A session that never touches VICE never launches an emulator, and a test fails if that regresses.
  4. **Release is wired to BOTH `SIGINT`/`SIGTERM` AND stdin `end`/`close`**, with a test per ending path. This is the correction with the most direct effect on implementation (spike 002, finding 8): a graceful ending delivers **SIGINT first** and **never closes stdin**; abrupt client death closes the pipe and **never signals**. A handler on either alone misses an entire class of session ending. `SIGINT` is treated as a teardown trigger, never ignored as a user Ctrl-C — it is the first signal every graceful teardown delivers, and ignoring it burns 100ms of a ~490ms budget.
  5. **The shutdown handler does exactly one synchronous local filesystem operation** — `unlinkSync` on the lease file — and awaits nothing. Measured: ~0.1ms against a ~490ms window, roughly 3000× inside budget, while a host round trip would not reliably fit. Anything requiring host action (actually stopping `x64sc`) does not happen in the handler at all: the proxy marks the lease released, and the broker, which outlives it, does the teardown.
  6. **One lease file does three jobs** — its existence is the lease, its mtime is the heartbeat, its removal is the release. Release is a *delete*, never a write. The heartbeat is touched on every call **and** on an interval timer, so a session that is merely thinking does not look abandoned; the timer's only job is keeping the broker's TTL sweeper away (measured: nothing reaps an idle proxy — 40.1 minutes idle, 39 ticks at 60.1s, zero drift, no signal of any kind). The lease records `CLAUDE_CODE_SESSION_ID` and `CLAUDE_PID` as **diagnostic metadata, not as the key** — one subprocess per session (finding 4) with subagents riding it (finding 5) means process identity already *is* session identity, and finding 13 hands the proxy both values in its environment.
  7. **There is exactly one teardown path.** Graceful release and TTL sweep differ only in latency and converge on the same broker code — the rarely-exercised path *is* the common path, rather than a second branch that rots untested. The broker kills the instance by the pid it recorded, **identity-verified, never a name match** (the existing `stop` path already does this), and removes the grant. The sweeper is still mandatory, but for the corrected reasons: not abrupt client death (now the *best* case — unbounded time, clean exit), but the proxy itself being SIGKILLed ~490ms into every graceful teardown, container or host death, and a proxy wedged with a blocked event loop.
  8. **A released instance is killed, never returned to the spare set.** This is the one rule that must not be relaxed for efficiency, and it carries a test that fails if it is: on-demand beat the fixed pool because a newly launched emulator is a known-clean power-on state, and a warm spare preserves that property only while it has never been used. Recycling released instances rebuilds the fixed pool, reintroduces cross-session contamination, and keeps none of the benefit.
  9. **Warm spares hold the invariant `ready_spares == N` subject to `total_instances <= MAX`** (`MAX` = 16, the range `vice-pool.sh` already accepts), re-evaluated after every grant and every teardown. `N` counts **ready spares, not total processes** — total is `leased + N` until the ceiling. Spares carry explicit `launching` → `ready` states, only `ready` ones are grantable, and **readiness is proven by a real MCP round-trip, not a socket probe**: a TCP accept can occur before the C64 has finished booting, and handing out a half-ready machine presents as a flaky emulator rather than as a race — the expensive kind of bug in this project. Warm spares are a latency optimisation, **not** a correctness requirement (finding 15: the tool-call budget is ≥150s, so even a fully cold launch fits with two orders of magnitude to spare), and the cold path says "warming, retry" explicitly rather than hanging silently.
 10. **Broker-absent reporting is three states with three messages**, each with its own fix, because one generic "broker unavailable" sends the reader to the wrong fix two times out of three: *never started* (`broker.json` absent → start it), *dead or hung* (`broker.json` present, mtime stale → restart it, quoting the recorded pid so it can be checked on the host), *alive but the launch failed* (`denials/<id>.json` written → relay the broker's own reason verbatim: missing `x64sc`, port already bound, no display). Each message quotes the **absolute host path** of the command, computed via `hostpath.mjs`, since it runs on the host. Each explicitly states this is the only route and that reaching for the old `vice.mjs` scripts is not an available workaround — an agent that hits "broker not running" is otherwise quite likely to route around it into the path 01.1 removed. It **fails fast** rather than waiting out `MCP_TOOL_TIMEOUT`, which would convert a clear diagnosis into an opaque timeout.
 11. **The proxy never exits and never caches a negative result** (finding 7: a dead stdio server is never auto-reconnected, so an exit costs the session its emulator access for good). With no broker running, calls return actionable MCP error frames and the proxy stays alive; once the broker is started, the *next* call succeeds with no session restart.
 12. **The standing constraint in this ROADMAP is actually edited, not just declared obsolete.** Open question 2 is answered with evidence: fresh-boot removes cross-*session* contamination, so the reset/clear-checkpoints/reload ritual narrows to within-session reuse — it does not remove contamination within a session that reuses one emulator across several plans. Whether that is "retired" or "narrowed" is decided by what the phase measures, and the § Standing Constraints row plus the `vice-mcp-selector` skill are updated in the same change. Intra-session parallelism stays out of scope, deferred to `.planning/seeds/vice-instance-handles-for-parallel-emulator-work.md`.
 13. **From a fresh session, a real emulator operation succeeds through a broker-granted instance**, with the evidence recorded, and two concurrent sessions demonstrably hold two different instances. Like 01.1 criterion 3 this cannot be self-verified — the broker runs on the host and per-session leasing is only observable across sessions — so it carries a blocking human-verify checkpoint.

**Plans**: 5/5 plans executed

Plans:

- [x] 01.2-01-PLAN.md — **Tracer**: one request → grant → forward → release round trip end-to-end, with the five-trigger release wiring, the heartbeat and the deferred-acquisition guard present from the first commit (C2 slice, C3, C4, C5, C6)
- [x] 01.2-02-PLAN.md — The broker as a real daemon: `start`/`stop`/`status`, one `teardown()` reached by release and TTL sweep alike, kill-never-recycle, request-id validation parity, uid-parity precondition (C1, C2, C7, C8)
- [x] 01.2-03-PLAN.md — Proxy side: three broker-absent states with three fixes, never-exit/never-cache, the per-server tool-call timeout committed in `.mcp.json` (C10, C11, cold-path half of C9)
- [x] 01.2-04-PLAN.md — Warm spares: `launching` → `ready` states, readiness by real MCP round-trip, `ready_spares == N` under `total <= MAX`, grant-from-spare with refill, denials that distinguish "not yet" from "never" (C9)
- [x] 01.2-05-PLAN.md — The narrowing edit in place plus the two-session proof (C12, C13) — *has a blocking human-verify checkpoint*

**Wave 1** — 01.2-01 · **Wave 2** — 01.2-02 ∥ 01.2-03 · **Wave 3** — 01.2-04 · **Wave 4** — 01.2-05.

**Parallelisation**: exactly the one opportunity this section predicted. The protocol shape (criterion 2) is fixed by the wave-1 tracer; after that, host-side broker work (`vice-broker.sh`, `vice-broker.test.mjs`) and container-side proxy work (`vice-proxy.mjs`, `vice-proxy.test.mjs`, `.mcp.json`) touch disjoint files and run as wave 2 in parallel. Warm spares re-enter the broker script and so wait for wave 2's broker plan. The narrowing edit and the fresh-session proof are wave 4, strictly after a working broker and a working proxy.

**Planning note (2026-07-31, `/gsd-plan-phase 1.2`):** the plan set is **tracer-first**, following 01.1's precedent for the same stated reason. Plan 01.2-01's first task is a `type="tracer"` slice wiring one `tools/call` through a real request/grant exchange on the shared bind mount to a granted endpoint and back, then releasing it — with the five-trigger teardown handler present in that first commit rather than retrofitted, because release wired to only one handler family is how finding 8's correction turns into a whole class of session ending that silently leaks leases. The remaining four plans expand horizontally off that proven slice. Its test needs neither a host emulator nor a real `x64sc`: an in-process HTTP stand-in plays the granted instance and `--once --dry-run` plays the launcher.

Nine decisions were resolved at planning time with reversibility ratings. **None rated `one-way`, so no `checkpoint:decision` was inserted.** **D-1.2-A** the broker is bash, extending `vice-supervisor.sh`'s shape and sharing `container-guard.sh`/`repo-root.sh` verbatim, since host-side Node availability was never verified while host bash is a given (rated `costly` — the protocol is the contract, so a Node replacement would not touch the container side). **D-1.2-B** `vice-pool.sh` and `vice-pool.mjs`'s classic port-keyed lease are left **entirely untouched**: they still serve the non-MCP recovery pipeline, whose Phase 1 plans 01-04…01-06 are unexecuted, so "superseded in intent" is not "safe to delete" (accepts the research recommendation). **[OVERRIDDEN 2026-08-02 by Phase 01.6's D-02 and D-05 — the files this decision protected were deleted outright, after Phase 1's 2026-08-01 replan rewrote plan 01-04 to go through `mcp__vice__*` tools exclusively and removed the non-MCP recovery-pipeline consumer named above. Full reasoning, the blocking-checkpoint verdict, and the date are recorded in `notes/one-process-broker-in-typescript.md`'s override record.]** **D-1.2-C** the reset ritual is **narrowed, not retired** — fresh boot removes cross-*session* contamination but not within-session reuse across several plans; criterion 12's edit says exactly that. **D-1.2-D** `registry.json` stays `0600` and uid parity is written into the broker's header as a named precondition with its failure consequence, rather than widening the mode for a multi-user case that does not exist. **D-1.2-E** request ids are `req-<pid>-<ms>-<8 hex>`, one per acquisition attempt, validated against an allow-list pattern before any path construction — and since the pattern exists as one literal per language, a parity test over a shared corpus pins the two together. **D-1.2-F** the pause-on-state-read discipline **stays documented** (inheriting 01.1's D-F, but revisited rather than assumed): `vice_execution_run` is this project's leading crash suspect, so a proxy that auto-issues it after every state read would multiply calls to the tool most correlated with host death, widening the blast radius the on-demand model was meant to narrow. **D-1.2-G** TTL is 180s, three times the 60s heartbeat — a reasoned default, not a measured constant, so it is env-overridable and every sweep logs the observed staleness alongside the configured TTL, making the guess observable. **D-1.2-H** `MCP_TOOL_TIMEOUT` is set explicitly as the per-server `timeout` field on the single static `.mcp.json` entry; `MAX_MCP_OUTPUT_TOKENS` **cannot** be committed because `.claude/settings.json` is gitignored, so it is documented in tracked `tools/README.md` and its absence is made observable by a one-line stderr warning from the proxy. **D-1.2-I** overrules the research's suggestion to reuse `registry.json` at a new cadence: the broker writes its own `broker-instances.json`, because a second writer on `registry.json` would let `vice-pool.mjs`'s `acquire()` hand a broker-owned instance to the recovery pipeline, breaking kill-never-recycle and reintroducing precisely the contamination this phase removes. **D-1.2-J** host-side spare readiness is proven by a single `curl` POST of a `vice_ping` call rather than a Node probe (host Node unverified, the curl form already documented against this server), invoked through an executable seam so tests can stub it; when no readiness command exists the broker warms **zero** spares and logs why, because spares are latency and not correctness and guessing is worse than a cold path.

One deliberate deviation from `workflow.human_verify_mode: end-of-phase`: criterion 13 is a **blocking** `checkpoint:human-verify`, not an end-of-phase look. It is a sequencing gate — a host-side broker and two fresh sessions are both required, MCP definitions are read once at session start, and criterion 12's doc edit asserts a verdict the checkpoint is what establishes, so recording the verdict first would be the failure mode. Its procedure additionally carries one extra evidence row that settles, for the price of one memory read, the recorded discrepancy between the standing 32KB chunking rule and the 500,000-character ceiling the proxy declares — a question no CI test can answer and which is otherwise left open.

Also recorded: this phase has **no requirement IDs and no `-SPEC.md`**, so the spec-less probe fallback was **skipped visibly** — no probe predicates were generated, and `must_haves.truths` are derived from the 13 success criteria above instead. Four truths that cannot be confirmed by automated evidence (criterion 9's readiness half, criterion 12's two doc edits, criterion 13's two halves) are authored as `verification: backstop` markers so the verifier abstains rather than silently passing them.

**Decisions to resolve here** *(the design note's remaining open questions, verbatim in intent)*:

- **Does the broker replace `vice-pool.sh` or wrap it?** The per-port supervisor directories, epoch files, and identity-verified kills are all reusable; the fixed-N `start` subcommand is what becomes obsolete.
- **Is the reset ritual actually retired, or only weakened?** Fresh boot removes cross-*session* contamination but not within-session reuse. Criterion 12 requires the answer to be written into the constraint, so this must be decided rather than left ambiguous.
- **Does `registry.json` stay `0600`?** It works only while broker and proxy share uid 1000 (verified: container `vscode` and host `henrik` are both uid 1000, on a real ext4 bind mount, so either side can create and unlink the other's files). Either widen the mode or record uid-parity as a stated precondition of the whole design.
- **What is the request-id scheme?** It must not reuse a value across sessions, since grants and leases are keyed by it and ports are recycled. It is also the natural snapshot-name prefix, now that port-prefixing breaks under on-demand launch.
- **Does the proxy absorb the pause-on-state-read polling discipline** (read → run → poll-with-`ping`, resume last), or does it stay documented? 01.1 decided *documented* (D-F) because `vice_execution_run` is this project's leading crash suspect; on-demand instances change the blast radius of getting it wrong, so revisit rather than inherit.
- **`MAX_MCP_OUTPUT_TOKENS` and `MCP_TOOL_TIMEOUT` are set explicitly, not inherited.** Both were measured to genuinely govern their thresholds, which turns two client-version-dependent surprises into known constants that 32KB chunking and the "warming, retry" threshold derive from. `MCP_TIMEOUT` was measured *not* to govern the startup handshake — do not rely on it.

**Risks**: **Verification asymmetry** — as in 01.1, the phase cannot self-verify: a fresh session plus a host-side broker are both required, so criterion 13 is a human checkpoint rather than a test. **Unrecoverable-by-construction** — finding 7 still makes any uncaught throw in the proxy fatal for the rest of a session, and 01.2 adds a whole polling/acquisition path where that is easy to get wrong. **The 490ms window** — release is safe with one `unlinkSync`, but any drift toward "just one await" in the shutdown handler silently reintroduces leaked leases; the constraint needs a test, not a comment. **Churn as mystery host load** — kill-on-release means every session end triggers a background boot to refill the spare set: cheap but constant, and it must be visible in the broker log rather than discovered as unexplained host activity. **Spare readiness races** — advertising a spare on `port_in_use()` alone hands out a half-booted machine and presents as flakiness, not as a race. **Broken window #1** (`WINDOWS.md`) — the host-side multi-instance launch was never actually verified (that check ran container-only, where `x64sc` does not exist), so this phase is the first real exercise of it and should expect to find something. **Scope creep toward the seed** — instance handles / intra-session parallelism are explicitly deferred and rest on finding 5's narrowest evidence (nested subagents were never tested).

**Roadmap note (2026-07-31):** this detail section was reconstructed during `/gsd-plan-phase 1.2`, for the same reason and by the same method as 01.1's above — the `phase insert` wrote a summary line and a progress-table row but no `## Phase Details` section, so `roadmap.get-phase` returned `malformed_roadmap` and planning could not start. Content is transcribed from the summary line, the § Standing Constraints row, the 1.2 column of the phasing table in `.planning/notes/vice-mcp-selector-design.md`, that note's broker-protocol / warm-spares / broker-absent-reporting / open-questions sections, and the **Requirements** section of `.planning/spikes/MANIFEST.md` (which states those items are non-negotiable for this build). No new scope was invented; the measured spike findings are cited where they replace an earlier assumption.

---

### Phase 01.3: Wedge Detection and Recovery

> **PAUSED 2026-08-02 at 5/6 plans — resumes LAST in milestone v1.1, after 01.6.2 and 01.4.**
> *(Re-sequenced 2026-08-02: the protocol replacement moved from 01.6 to the new 01.7, and 01.6 — now the TypeScript conversion — runs first. Additionally: this phase's recovery path was designed against a **separate supervisor process** holding the respawn loop, which 01.6 collapses into the broker. Re-read the design before resuming; it may no longer describe the machine.)*
> *(**Amended 2026-08-03:** Phase 01.7 was absorbed into 01.6.2 and no longer runs, so the resume gate now reads **01.6.2 and 01.4**. `vice_recycle`'s move off the file protocol happens inside 01.6.2. The "re-read the design before resuming" warning is now stronger, not weaker: 01.6.2 both collapses the supervisor inward **and** replaces the transport, so two of this phase's assumptions change at once.)*
>
> Plans 01.3-01 through 01.3-05 are executed and committed. Only **01.3-06** is outstanding, and it is blocked on two things this phase does not own:
>
> 1. **`vice_recycle` is a control-plane command sitting on a protocol that is scheduled for replacement.** It is implemented today as `requests/<id>.json` with `op:"recycle"` polled against `recycle-acks/`. Phase 01.6 replaces that file protocol with a TCP control connection. Finishing recovery now means building it twice, and the second build is the one that ships.
> 2. **This phase's own two tools are unreachable from an agent session.** `vice_diagnose` and `vice_recycle` are fully wired and 268/268 green, and neither appears in a live session's tool schema (see Phase 01.4). Plan 01.3-06 ends at a blocking human-verify checkpoint over exactly those tools, so it cannot be verified live until 01.4 closes.
>
> Plan 01.3-05's bounded trigger hunt already recorded its own blocked outcome honestly (commits `874e1ad`, `e5c3d82`, `8e6e868`): no trigger was found to close at the seam, and the hunt is destructive by nature — each attempt costs an instance, which is unaffordable while Phase 01.5's defects stand. Criterion 9 therefore carries forward into the resumed plan rather than being written off.
>
> **Nothing in this phase's criteria below changes.** The pause is a sequencing decision, not a scope change.

**Goal**: An agent that suspects the emulator is stuck can establish mechanically whether it is, tell the three look-alike states apart, and recover a wedged instance through the permitted route — instead of abandoning the session, which is the only option that exists today

**Depends on**: Phase 01.2 (complete). The broker owns instance lifecycle, so recovery is a new broker capability rather than a new mechanism; `vice-supervisor.sh`'s respawn loop, its restart-epoch file, and its identity-verified kill are the parts being extended. **Nothing in Phase 1 blocks this phase, and this phase blocks nothing that is currently runnable** — it is inserted ahead of 01-04's remaining live play-through and Phase 2's exhaustive trace because both are long unattended emulator sessions, which is exactly where an unrecoverable wedge is most expensive.

**Requirement mapping**: none — tooling phase, by design (see § Requirement Coverage). Deliberately written *without* a `**Requirements**:` key, matching 01.1 and 01.2, so the requirement-coverage gate reads this phase as unmapped rather than parsing this sentence as a REQ-ID.

**Success Criteria** (what must be TRUE):

  1. **The three states that look identical from the outside are distinguished mechanically, and `vice_ping`'s `execution` field is never the signal.** *Crashed and respawned* — the restart epoch changed; the run is void, and this case is already handled. *Wedged* — epoch unchanged, zero cycles retired. *Degraded but live* — cycles advancing far below the ~991,000/s baseline; the ~6,000/s figure this project already recorded is a distinct state, not a wedge, and must not be recovered as one. A `status:"ok", execution:"running"` response is compatible with all three and therefore evidence for none.

  2. **The cycle bracket is the definitive liveness test and is specified in exactly one place.** Reset the stopwatch, resume once, poll with `vice_ping`, read the stopwatch back; two consecutive brackets measuring zero is a wedge. No wall-clock delay appears anywhere in the procedure — the project's standing rule, and the reason this test is trustworthy at all.

  3. **Partial staleness is classified, not treated as a wedge.** Plan 01-04's Task 2 incident had `vice_registers_get` returning a byte-for-byte identical snapshot while `vice_vicii_get_state` reported genuine post-hard-reset change — one tool's stale response is not proof the machine is frozen. The procedure names which reads are load-bearing for the verdict and which are corroborating, so a single misbehaving response path does not trigger a recycle of a healthy instance.

  4. **Evidence is captured before anything is killed.** The four existing stall todos all end with "worth investigating host-side" and no host-side data, because recovery was never possible and the session simply ended. A recycle that discards the only trail that could root-cause the wedge trades a recurring blocker for a permanent mystery. A wedge produces a durable record — cycle brackets, program counter, restart epoch, checkpoint enumeration, screenshot, and whatever host-side state proves obtainable — written before the recovery action runs.

  5. **Every privileged action is reached through `mcp__vice__*` and nothing else.** No script, module, test or driver opens its own connection, reads broker state to find a port, or imports a transport module; reimplementing the route cleanly is the same violation as importing it. If the design cannot expose recovery through the tool surface, the phase reports that the capability is unavailable and stops — it does not route around the rule.

  6. **The kill is identity-verified against a recorded pid, never blind and never name-matched.** `vice-pool.sh`'s own comments already warn that a registry entry may have been recycled onto an unrelated process; the existing `stop` path's verified-kill discipline is reused rather than re-derived, because the failure mode here is killing something that is not the emulator.

  7. **Recovery bumps the restart epoch, so a deliberate recycle voids a run by exactly the mechanism a crash already does.** No second voiding channel is invented. Every caller that already compares epochs across a bracket gets correct behaviour for free, and a recycle can never be mistaken for continuity.

  8. **Whether a wedge is detectable host-side is answered with evidence, and a negative answer is a real result.** The hypothesis on record is a hung GTK/OpenGL event loop, never tested. If the host cannot distinguish a wedged `x64sc` from a busy one, the phase says so and delivers container-side detection plus unconditional recycle rather than quietly shipping a detector that guesses.

  9. **The question "is a specific call or sequence causing this?" is investigated and answered, not assumed away.** There is already one proven instance of a single tool call killing the host — `vice_disk_list`, deny-listed at four layers for exactly that reason — so "a call does this" is an established shape in this codebase, not a hypothesis. The evidence pointing the same way here: two independent sessions froze at the **identical `PC:2014`**, both shortly after a stopping checkpoint parked the machine at `$07DE` (the instruction after the chamber-1-entry `STA $DD00`) and execution was resumed. A third session's whole-machine freeze followed a hard reset issued while a checkpoint was armed on an IRQ handler entry. The candidates worth ruling in or out: resuming from a checkpoint parked on a specific instruction; arming an exec checkpoint on an IRQ entry point; `vice_machine_reset` with checkpoints live; `vice_execution_run` at raster-sensitive moments (already this project's leading crash suspect, per D-1.2-F). **A confirmed trigger changes the deliverable** — a call or ordering that reliably wedges the machine is prevented at the seam, the way `vice_disk_list` is, rather than recovered from after the fact. Prevention beats recovery, and recovery is the fallback for what prevention cannot catch.

 10. **`vice_disk_list` stays unreachable, and the guard is re-proven rather than trusted.** Verified 2026-08-02: absent from the 63-tool committed manifest, stripped from `tools/list` discovery, refused at `tools/call` before any network request, re-filtered proxy-side even from a manifest that names it, with 119/119 tests passing. Any tool this phase adds inherits the same treatment, and any *new* call found to wedge the machine under criterion 9 joins the same deny-list by the same mechanism.

 11. **The recovery path is exercised against an actual non-advancing emulator, or the phase records that one could not be produced on demand.** This phase cannot be verified by unit tests alone: its subject is a failure state that has occurred five times unbidden and never once on request. The strongest reproduction candidate on record is the `$DD00`-attribution-then-resume technique, which froze two independent sessions at the identical `PC:2014`. Whether that reproduces a third time is itself a finding worth having.

**Plans**: 4/6 plans executed

Plans:
**Wave 1**

- [x] 01.3-01-PLAN.md — Tracer: `vice_recycle` end to end — capture a record, identity-verified kill of the emulator child, supervisor respawn on the same port, epoch confirmed *(strictly first, per D-05)*

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01.3-02-PLAN.md — `vice_diagnose`: the checkpoint-trap check before any resume, then the single-definition cycle bracket and the five-verdict classification

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01.3-03-PLAN.md — One evidence gatherer wired into the destructive path, the full incident-record format, and the best-effort pre-kill snapshot

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01.3-04-PLAN.md — The seam hazard annotation that warns and never refuses, in a table a confirmed trigger joins as one entry

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 01.3-05-PLAN.md — The bounded trigger hunt: six attempts, both recorded variants, findings logged as they are found

**Wave 6** *(blocked on Wave 5 completion)*

- [ ] 01.3-06-PLAN.md — The answers reached by decision, the continuity confirmation, the coverage delta, and the human-verify checkpoint

**Parallelisation**: none. Every code plan owns `vice-proxy.mjs`, so waves 1-4 are strictly sequential
on file ownership, and waves 5-6 are sequential on evidence — the hunt needs recovery working (D-05),
and the phase record needs the hunt's denominator. Waves are 1 through 6, one plan each.

**Decisions to resolve here**:

- **Skill, MCP tool, or both?** The captured todo's framing, and the likely answer: a skill for the triage judgement and ordering, one or two tools for the privileged host-side actions a skill cannot perform. Worth resolving explicitly rather than drifting into one of them.
- **Does the detector ever run automatically?** Strong argument against: measuring liveness requires `vice_execution_run`, which decision **D-1.2-F** already identifies as this project's leading crash suspect. A detector that resumes the machine on every call would multiply calls to the tool most correlated with host death — the detector would cause the failure it exists to catch. On-demand invocation is the presumed answer; state the reasoning either way.
- **Is a wedged instance ever worth preserving before recycling** — a snapshot, a memory read — or is the evidence in criterion 4 sufficient and recovery always a fresh boot?
- **What does the caller resume from?** Plan 01-04 already specifies resuming from the last recorded milestone snapshot after an identity change. A recycle is an identity change, so the existing rule should cover it; confirm rather than assume, since it is the difference between losing a session and losing a milestone.
- **Prevention or recovery — and in what order?** Criterion 9 may find a reproducible trigger, which would make a seam-level block (the `vice_disk_list` treatment) the higher-value deliverable and recovery the fallback. It may equally find nothing, leaving recovery as the whole phase. Sequence the plans so the trigger investigation reports **before** the recovery design is fixed, rather than building recovery first and discovering it was addressing a preventable cause.
- **How far does trigger investigation go before it becomes root-causing `x64sc`?** Identifying *which call or ordering* wedges the machine is in scope and is answerable from the container. Diagnosing *why* GTK/OpenGL wedges is not. Draw the line explicitly at planning time, because the first naturally invites the second.

**Risks**: **Unreproducible subject** — the wedge has never been produced on demand, so criterion 9 may resolve to "could not reproduce", and a recovery path that has never run against a real wedge is a hypothesis. **The detector as cause** — see D-1.2-F above; resuming to measure is not free. **Blind-kill blast radius** — a stale registry entry pointing at a recycled pid makes the naive implementation dangerous, which is why criterion 6 is a criterion and not an implementation note. **Scope creep into root-causing `x64sc`** — identifying a triggering call or ordering (criterion 9) is in scope; diagnosing why GTK/OpenGL wedges underneath it is not, and the evidence criterion exists so that investigation stays possible later without being attempted now. The boundary is a decision above, not a hope. **Trigger-hunting is destructive by nature** — deliberately reproducing a wedge means deliberately killing instances, so the investigation needs the recovery path, or a fresh-session-per-attempt budget, before it can run at any scale; a plan that hunts triggers before recovery works will spend most of its wall-clock waiting for sessions. **Verification asymmetry, again** — as in 01.1 and 01.2, host-side behaviour is not self-verifiable from the container, so expect a human-verify checkpoint.

**Roadmap note (2026-08-02, `/gsd-phase --insert`):** this detail section was written by hand at insertion time, for the reason the 01.1 and 01.2 notes above already record — `phase insert` writes a summary line and a directory but no `## Phase Details` section, so `roadmap.get-phase` returns `malformed_roadmap` and planning cannot start. The CLI additionally placed the summary line before 01.1/01.2 rather than in numeric order; that was corrected in the same edit. Content is derived from `.planning/todos/pending/2026-08-02-supervisor-skill-to-detect-and-recover-a-wedged-vice.md` and the four incident todos it cites, plus direct reads of `vice-supervisor.sh`'s respawn loop and `vice-pool.sh`'s kill path. No new scope was invented.

---

### Phase 01.4: Tool Surface Reachability

**Goal**: Every tool the proxy implements is callable by the agent that needs it, in every session shape this project actually uses — main session and spawned subagent alike — and no path that can name a tool can reach `vice_disk_list`

**Depends on**: Phase 01.6. ~~Nothing. Runs **first** in v1.1~~ — **re-sequenced 2026-08-02: it now runs SECOND, after the TypeScript conversion.** The developer chose to convert `.claude/mcp/vice/` before further work on the files this phase edits, so this phase's work lands in TypeScript rather than being written in `.mjs` and then converted. The reason it was first still stands and is now a *cost of the new ordering rather than a feature of it*: it is the phase that makes the others verifiable — three tools built across 01.2 and 01.3 cannot be called at all, and no live check of any later phase's work can be trusted while the tool surface an agent sees differs from the one the proxy serves. Phase 01.6 therefore runs with **no live verification available**, which its own risks section records.

**Note on this phase's existing artifacts:** `01.4-RESEARCH.md` and `01.4-PATTERNS.md` were produced 2026-08-02 *before* the re-sequencing. Their **mechanisms remain valid** — only the outer `params.name` is deny-list-checked; four host JSON-RPC meta-methods sit in the manifest as forwardable tools; Claude Code snapshots a server's tool schema once at session init. Their **line-number anchors are void**, because 01.6 rewrites every file they point into. Re-derive anchors against the TypeScript source; do not re-derive the findings.

**Requirement mapping**: none — tooling phase, matching 01.1/01.2/01.3.

**Success Criteria** (what must be TRUE):

  1. **`vice_diagnose`, `vice_recycle` and `vice_result_continue` are callable from a normal agent session as named `mcp__vice__*` tools.** All three are implemented in `vice-proxy.mjs`, concatenated onto the manifest in `handleToolsList()`, dispatched in `handleToolsCall()` before any forwarding, and covered by structural tests asserting they appear in a live `tools/list`. The suite passes 268/268 and the session still cannot see them. Tests asserting a property the running system does not have is itself a finding: the criterion is a call from a real session, not a green suite.

  2. **The route that bypasses `vice-proxy.mjs` is identified and named in writing.** The evidence on record: a session sees a flat **64**-tool list against a committed **63**-tool manifest, the three proxy-local synthetic tools are absent from it, and calling one by name returns the host's own `Tool not found` in `aliveButFailedMessage()`'s wording — meaning the literal name was forwarded to `x64sc` instead of being intercepted proxy-side. A stale-file and stale-process explanation was already ruled out directly (`/proc/<pid>/cwd` is the main workspace). Whatever is in the path, name it before changing anything, because a fix aimed at the wrong layer will appear to work in tests exactly as the current state does.

  3. **`vice_disk_list` is unreachable on the generic call path, not only the named one.** The four-layer guard was verified on 2026-08-02 against the named-tool path and holds there. It does **not** hold on the path that session actually had: `tools_list` returned `vice_disk_list` in its 64-tool response. That is a live breach of the project's one hard hazard rule — the tool crashes the host MCP server and recovery is a manual host restart. Any generic `tools_call`/`tools_list` surface is treated as a first-class enforcement point or removed.

  4. **`mcp__vice__*` tools are present in a spawned executor subagent's tool schema, or the limitation is documented with a workaround that does not break the hard rule.** Plan 01-04's executor received exactly five tools (`Read`, `Write`, `Edit`, `Bash`, `Skill`) with no `mcp__vice__*` entry at all — structurally absent, not reporting one of the three documented unreachable statuses. This blocked Tasks 2–4 of that plan. The suspected cause is upstream (`anthropics/claude-code#13898`, MCP tools stripped from agents with a `tools:` frontmatter restriction). **A CLI escape hatch is not an available answer here** — that is precisely the prohibited second route — so if the cause is upstream and unfixable, the deliverable is a documented session-shape constraint that planning must respect, not a bypass.

  5. **Agent-visible failure messages name an action the agent can take, not a topology it has no model of.** `vice-proxy.mjs` returns roughly ten agent-visible strings describing a three-layer container/proxy/broker/host arrangement. They are read by the model on every failure and are not actionable as written. Stderr-only strings are out of scope — they are invisible to the model and cost nothing.

**Risks**: **The cause may be outside this repo.** Criteria 2 and 4 both point at harness or upstream behaviour rather than at `vice-proxy.mjs`, and a phase can end with "identified, not fixable here" as an honest result — but criterion 3 must be closed regardless, because a reachable `vice_disk_list` is a hazard this project has already paid for once. **A green suite is actively misleading here** — 268/268 passing while three tools are uncallable is the shape of the problem, so verification for this phase is a live session call and nothing else.

**Plans**: 5 plans

Plans:

- [ ] 01.4-01-PLAN.md — Tracer: close the generic-dispatch deny-list gap (criterion 3) — `tools_list` first, then `tools_call`/`initialize`/`notifications_initialized`, with a live before/after refusal proof
- [ ] 01.4-02-PLAN.md — Criteria 2 and 4: a real `gsd-executor` dispatch self-reports its own `mcp__vice__*` tool surface; the bypass route is named in writing against today's live evidence
- [ ] 01.4-03-PLAN.md — Criterion 5: rewrite every agent-visible proxy message per the existing de-architecture spec, plus a permanent regression guard
- [ ] 01.4-04-PLAN.md — Criterion 1's remaining two live proofs: a deliberate `vice_recycle` and a deliberately-produced oversized result exercising `vice_result_continue`
- [ ] 01.4-05-PLAN.md — Discharges Phase 01.8's HV-06: walks all 35 `CF-01.4-NN` carry-forward rows in `01.6.2-VALIDATION.md` to a real disposition (discharged / blocked-on-HV-08 / permanently-unverifiable-from-container)

**Wave 1** — 01.4-01 · **Wave 2** — 01.4-02 ∥ 01.4-03 (disjoint files; both depend on 01.4-01) · **Wave 3** — 01.4-04 (depends on 01.4-02, 01.4-03) · **Wave 4** — 01.4-05 (depends on 01.4-04)

---

### Phase 01.5: Session and Broker Survivability — **ABSORBED INTO PHASE 01.6.2**

> **ABSORBED 2026-08-03, via `/gsd-discuss-phase 01.6.2`.** This phase no longer runs. Its goal —
> *"A dead or wedged instance costs one acquisition rather than the whole session, and the broker
> never warms, grants or retains an instance that does not exist"* — turned out to be substantially
> the work that discussion had already folded into 01.6.2 as the five lifecycle-policy changes.
>
> **The section is kept, not deleted**, so that every reference to Phase 01.5 in commits, SUMMARYs,
> design notes and prior CONTEXT files still resolves, and so a reader meeting the old plan here
> learns why it stopped. Decisions: `01.6.2-CONTEXT.md` D-02.
>
> **Absorbing this phase is gated.** Phase 01.6.2 criterion M requires its plan to show, *per
> criterion below*, where each lands — deleting a phase without that is how a defect gets silently
> lost. Disposition at absorption time:
>
> | 01.5 criterion | Where it lands in 01.6.2 |
> |---|---|
> | 1 — a session whose instance dies recovers by re-requesting | Criterion J / CONTEXT D-13. The triggering call fails loudly with the fresh-machine signal; the replacement is already in place. |
> | 2 — spare warming is serialised, never two `x64sc` in the same instant | Criterion C / CONTEXT D-07. Already the current behaviour; this phase must preserve it, not re-fix it, and must not "improve" the serialised-warming break into concurrent spawns. |
> | 3 — a grant is proven live before it is honoured, and cannot outlive its process | Criterion L / CONTEXT D-05. The floor is evaluated over probe-live instances; a failed probe drops the record *and* identity-verified-kills the pid. |
> | 4 — lazy replenishment, pool capped at ~`N + 1` | **NOT fully settled.** The floor moves to 1 (CONTEXT D-06) and kill-never-recycle stands, but R1/R2's exact replenish semantics were not decided. Criterion M requires a decision rather than a lapse. |
> | 5 — the default port band is clear of ports other software holds | Criterion G / CONTEXT D-18. Broker allocation moves to 6600+, which retires the VS Code `127.0.0.1:6511` collision this criterion recorded. |
> | 6 — `GRANT_POLL_TIMEOUT_MS` has headroom over the measured tool-call budget | **NOT settled, and may dissolve.** Under a TCP control plane, grant-polling becomes a request/response on the connection and the constant may cease to exist. Criterion M requires the outcome be named either way. Its standalone todo stays in the backlog meanwhile. |
> | 7 — operator-facing text matches the code | Dissolved. The stale `usage()` prose goes with the bash file that carries it. |

**Original goal (historical)**: A dead or wedged instance costs one acquisition rather than the whole session, and the broker never warms, grants or retains an instance that does not exist

**Depends on (historical)**: Phase 01.6 (the TypeScript application these defects now live in) and Phase 01.4 (for live verification of anything). ~~Runs **before** 01.6 deliberately~~ — **re-sequenced 2026-08-02: it now runs AFTER 01.6.** The developer chose conversion-first, so there is no bash left to fix in place and these four defects are fixed in TypeScript instead. The discipline the old ordering protected is preserved by this phase still running **before Phase 01.7**, so a transport regression still has one candidate cause; and fixing a stringly-typed state machine with types on it is a better outcome than fixing it in bash, given the 2026-08-01 outage was exactly that class of bug. Historical rationale, no longer operative: the shrink-broker todo's own sequencing note is that fixing known defects and relocating the code holding them in one move makes it impossible to tell which change caused a regression. These defects are fixed in bash, in place, and 01.6 then moves working code. **Superseded 2026-08-03: the "before Phase 01.7" discipline this paragraph relies on is exactly what the absorption gives up — defects and protocol now change together. That cost was stated and accepted.**

**Requirement mapping**: none — tooling phase.

**Success Criteria (historical — retained as the evidence record behind 01.6.2's criteria L and M)**:

  1. **A session whose granted instance dies recovers by re-requesting, instead of being permanently dead.** Today the proxy caches its grant for the session's lifetime: after a host was *fully repaired* — broker healthy, one live `x64sc`, zero stale grant records — every subsequent `vice_ping` from the original session still returned the old `req-832` / port 6512 `ECONNREFUSED`. The consequence is that losing an instance means losing an executor's accumulated context mid-plan, which has already halted plan 01-04 twice. On `ECONNREFUSED` against a held grant, the lease is dropped and re-requested once before any error surfaces.

  2. **Spare warming is serialised, and never launches two `x64sc` processes in the same instant.** `VICE_BROKER_SPARES` defaults to 3, so `start` warmed three simultaneously and all three died — port 6510 **SEGV** (139), 6512 exit 1, 6513 exit 0, identical log timestamp. The cause is that `x64sc` is not headless: each instance opens a GTK3 window, takes an OpenGL 4.6 context and opens PulseAudio, and concurrent GPU/sound contention segfaults a failed OpenGL init rather than exiting cleanly. This was the root cause of the 2026-08-01 outage; `VICE_BROKER_SPARES=1` works.

  3. **A grant is proven live before it is honoured, and cannot outlive its process.** A `state granted` record for port 6512 whose `x64sc` (pid 1634866) was long dead survived a broker `stop`, a broker `start`, and a full host restart, during which the broker reported *"granted request … (from ready spare)"* and launched nothing. `pgrep -a x64sc` showed no process at all, and recovery required moving `grants/`, `requests/`, `leases/`, `spares/` and `broker-instances.json` aside **by hand**. The epoch record already carries the pid, so a `kill -0` or port probe at load time closes this. Relatedly: a spare recorded "ready" is never grantable without a successful readiness probe.

  4. **The spawn policy replenishes lazily and caps the pool at roughly `N + 1`, not `N + outstanding_leases`.** R1 — after handing an instance out, launch a replacement **only if zero ready remain**. R2 — on release, always kill the returned instance (kill-never-recycle stands), then launch a replacement **only if `total < N`**, never overshooting. At rest the pool holds exactly `N` ready. On a host where every instance costs a window, a GL context and a sound device, the current always-rewarm-to-N policy spends that headroom for nothing.

  5. **The default port band is clear of ports other software holds.** `127.0.0.1:6511` is held by VS Code, inside the broker's default 6510–6512 band. It is loopback-only so the container could never have reached it, but the broker refuses to launch on a bound port, so it silently narrows the usable band.

  6. **`GRANT_POLL_TIMEOUT_MS` has headroom over the measured tool-call budget** rather than sitting at a value a slow or contended host can exceed during a cold `x64sc` launch.

  7. **Operator-facing text matches the code.** `usage()` still claims the positional `start [N]` argument *"is not yet consumed by any spares logic in this version"*. It is consumed (`vice-broker.sh:394-396`, three passing tests); the prose describes a defect that was repaired without updating the docs, and during a live outage it sent the debugging session down a wrong branch. Stale operator text under pressure is a defect, not cosmetics.

**Risks**: **Host-side verification asymmetry**, as in 01.1/01.2/01.3 — several of these are host behaviours the container cannot self-verify, so expect a human-verify checkpoint. **Defect 1's fix has a failure mode of its own**: re-requesting on `ECONNREFUSED` must not mask a genuinely dead host into an infinite re-request loop, and it must not silently hand the session a *different* machine without the epoch check firing — a re-request is an identity change and `assertSameMachine()` must see it as one.

---

### Phase 01.6: Conversion Foundation and Scope Reduction

> **SCOPE AMENDED AND SPLIT 2026-08-02 (developer).** This phase was scoped from a todo about
> *shrinking* `vice-broker.sh`. That was narrower than intended, three times over. The broker, the
> **supervisor** and the **pool** become **one application in one process**; **every** host-side shell
> script retires except a single broker launcher; and **all** of `.claude/mcp/vice/`'s JavaScript
> becomes TypeScript. The developer's framing: *"Nice and simple, no mixture of different things — the
> broker becomes a server that holds everything it needs to know in a single place."*
>
> **The transport change left this phase** and is now Phase 01.7, because the developer chose to land
> the conversion before any further work on the files it rewrites, and "convert first" only means
> something if the conversion is separable. The conversion therefore **runs first in v1.1** and changes
> no protocol.
>
> Rationale, the trade on TypeScript, and the kernel constraint behind criterion 5 are recorded in
> `.planning/notes/one-process-broker-in-typescript.md`.

> **SPLIT AGAIN 2026-08-02 (developer, at plan time).** `gsd-planner` returned
> `## PHASE SPLIT RECOMMENDED` rather than plans, with a quantified reason: post-D-02 the work is
> **13,478 lines changed plus 2,546 bash lines re-expressed**, and four single files each exceed one
> task's context budget alone (`vice-proxy.test.mjs` 4,370 · `vice-broker.test.mjs` 2,685 ·
> `vice-proxy.mjs` 2,441 · `vice-broker.sh` 2,103). Honouring the phase's own "keep the suite green
> continuously" discipline yields **18 plans across 5 waves**; standard granularity is 3–5. Compressing
> them means ~3,000-line conversion tasks — precisely the volume this phase's own risk section names as
> where an agent-driven conversion drifts. The developer chose the split over `--chunked`, because it
> puts a real seal between *"the container half is converted and the suite is green"* and *"the host
> half is a new process whose test suite was itself rewritten in the same change"* — which is where
> the risk actually lives.
>
> **Groups, run serially:** `01.6` (foundation, topology, scope reduction) → `01.6.1` (container-side
> conversion) → `01.6.2` (the one-process host broker) → `01.6.2.1` (broker lifecycle policy —
> **inserted 2026-08-03 at plan time**, when `gsd-planner` returned `## PHASE SPLIT RECOMMENDED`
> against 01.6.2's enlarged scope) → `01.6.3` (`@mastra/mcp` adoption).
> Serial, not parallel: 01.6.2 writes TypeScript against conventions and types 01.6.1 establishes, so
> concurrent runs would make a suite regression ambiguous in attribution — the same discipline D-2d
> preserved by keeping 01.5 before 01.7. **01.6.3 runs last on PATTERNS.md's explicit recommendation:**
> convert `vice-proxy` hand-rolled first, then swap the ~164-line seam in isolation, so 2,100+ lines of
> project logic do not need re-verifying at the same time as a new dependency lands.
>
> The four research artifacts (`01.6-RESEARCH.md`, `01.6-CONTEXT.md`, `01.6-PATTERNS.md`,
> `01.6-VALIDATION.md`) stay in this phase's directory and remain valid for **all four groups** — they
> were produced against the undivided scope. Every sub-phase reads them.

**Goal**: The TypeScript build pipeline is proven end-to-end on one real module, and the conversion's scope is reduced to what will actually be converted — with the `vice-pool` subsystem deleted, its removal gated on confirmation, and the locked decision it reverses recorded in writing

**Depends on**: Nothing. ~~Phase 01.5 (defects fixed in place first, so this relocates working code)~~ — **that dependency is inverted as of 2026-08-02.** The developer chose conversion-first, so there is no bash left for 01.5 to fix in place; 01.5 now runs *after* this phase and fixes its defects in TypeScript. The discipline that dependency protected is preserved by 01.5 still running before **01.7**, so a transport regression still has one candidate cause. ~~Gated on an unanswered external fact~~ — **the host-`node` gate was cleared 2026-08-02; see criterion 1.**

**Criteria ownership across the four groups.** The ten numbered criteria below are the **shared
acceptance bar for the whole conversion** and are kept here, verbatim, as the single register. Each
sub-phase names the register items it must satisfy; read this section for their full text.

| Group | Owns | Adds |
|---|---|---|
| **01.6** — foundation, topology, scope reduction | C1 (mechanism), C3 (mechanism), C9, C6+C10 scaffolds | **D-02** deletion + confirmation gate, **D-03** override record |
| **01.6.1** — container-side conversion | C3 (TS half), C7, C8, C10 | — |
| **01.6.2** — the one-process host broker | C2, C4, C5, C6, C1 (recorded), C7 | **D-04** epoch file |
| **01.6.2.1** — broker lifecycle policy *(split out of 01.6.2, 2026-08-03)* | — (register fully discharged by its siblings) | 01.6.2's criteria **E, L, M**; `01.6.2-CONTEXT.md` **D-02, D-05…D-08, D-10, D-11, D-19…D-22** |
| **01.6.3** — `@mastra/mcp` adoption | C3 (host clause) | **D-01**, `COVERAGE.md`, **D-06** bundling decision |

**This group's own success criteria** (in addition to the register items it owns):

  A. **The tracer proves the whole topology before anything rides on it.** One real module — not a toy — goes `vice-launcher.sh` (container-guarded) → `exec node tools/vice-broker.js` → `broker.ts` compiled by `tsc` into `resources/vice-broker.js` with a generated banner → deployed by `install-resources.mjs` → runs under bare `node` with no `node_modules` → writes `broker.json` with `pid`, `started_at` and **the host's `node --version`** (criterion 1's deliverable). Verified by the `resources/`-in-sync test plus a test that executes the emitted JS.

  B. **`vice-pool.mjs`, `vice-pool.sh`, `vice-session.mjs`, `vice.mjs`'s CLI and their tests are deleted** (CONTEXT D-02 + D-05), **after** a blocking confirmation that no host-side automation or documented manual workflow invokes them. Container-side grep reached MEDIUM confidence only; the container cannot see the host. Getting this wrong strands Phase 1's dormant recovery pipeline.

  C. **The Phase 01.2 `D-1.2-B` override is recorded where a later reader meets the old decision** (CONTEXT D-03). `D-1.2-B` says these files are *"left entirely untouched… 'superseded in intent' is not 'safe to delete'."* D-02 reverses it. A locked decision reversed without a record is the failure this project already names for confidence grades.

  D. **`.gitignore` and `.mcp.json` are corrected in the same change that moves files.** `.gitignore` lines 99–103 name deployed files **individually** (`/tools/vice-broker.sh`, `/tools/vice-pool.sh`, `/tools/vice-supervisor.sh`, `/tools/lib/container-guard.sh`, `/tools/lib/repo-root.sh`) rather than ignoring `tools/` wholesale — because `tools/` also holds **tracked** RE tooling (`d64-parse.mjs`, `watch-loads.mjs`, …). When the deployed set becomes `.js`, `.gitignore` must change with it, and **C6's "excluding gitignored `tools/`" phrasing is wrong for a mixed directory and would produce a false gate — fix the check, not just the ignore list.** Separately, `.mcp.json` hardcodes `.claude/mcp/vice/vice-proxy.mjs`: any move or rename that does not update it in the same commit **loses all emulator access at the next session start.** This is the highest-blast-radius one-line change in the whole conversion and it appears in no source artifact. *(Both found by the planner, 2026-08-02.)*

  E. **`install-resources.mjs` gains a prune step, or the absence of one is recorded as accepted.** It has none today, and `tools/` currently holds all three stale `.sh` copies. Once the deployed set changes shape, a missing prune leaves stale executables on the host.

**Verification hazard, stated up front:** this phase now runs **before 01.4**, which means the only
available proof of equivalence is the test suite — and 01.4's central finding is that a green suite
proves nothing about what a session can actually see (268/268 passing while three tools were
uncallable). **No live session verification is available during this phase.** The conversion must
therefore treat "the tool surface a session sees is unchanged" as an explicitly unverified claim,
carried forward as 01.4's problem, rather than one the suite has settled.

**Plans:** 4/4 plans executed

Plans:
**Wave 1**

- [x] 01.6-01-PLAN.md — **Tracer.** The whole build topology on one real module: `typescript` legitimacy checkpoint, `package.json`/`tsconfig`/`tsconfig.build`/`build.ts`, `vice-broker.mts` → banner-marked `resources/vice-broker.mjs`, the container-guarded `vice-launcher.sh`, deployment by the existing installer, execution under bare `node` with no `node_modules`, the `resources/`-in-sync gate and the `./.claude/CLAUDE.md` directory-meaning inversion (criteria A, C1, C3, C9)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01.6-02-PLAN.md — Rescue the ~28 assertions in `vice-pool.test.mjs` that cover **surviving** modules into files named for their subjects: `repo-root.test.mjs`, `host-scripts.test.mjs`, `install-resources.test.mjs`, `vice-probe.test.mjs`, `vice.test.mjs`. Pure addition; nothing is deleted (criteria B prerequisite, C8, C9)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01.6-03-PLAN.md — The deployed-set contract: a manifest-scoped prune in `install-resources.mjs`, two-way `.gitignore` parity, the one-shell-script check rebuilt on `git ls-files`, the load-order guard and cycle allowlist, and the `.mcp.json` wiring gate (criteria D, E, C6 scaffold, C9, C10 scaffold)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01.6-04-PLAN.md — Delete `vice-pool.mjs`, `vice-session.mjs`, `vice-pool.test.mjs`, `resources/vice-pool.sh` and `vice.mjs`'s CLI behind a blocking `checkpoint:decision`, then record the `D-1.2-B` override in the design note, this ROADMAP and `STATE.md` (criteria B, C — D-02, D-03, D-05)

**Waves:** strictly sequential, 1 → 2 → 3 → 4. Plan 02 must precede 03 because `install-resources.mjs`'s only test home today is inside the file plan 04 deletes; plan 03 must precede 04 because the prune and the two parity gates are what make the deletion propagate and stay honest.

**Planning note (2026-08-02, `/gsd-plan-phase 01.6`):** the plan set is **tracer-first** — plan 01's second task is a `type="tracer"` slice proving authored-TypeScript → `tsc` → committed JS → installer → host `tools/` → container-guarded launcher → bare `node`, end to end, before any of the 16,000-line conversion rides on it. Six findings changed what got planned. (1) The emitted artifact is `.mjs`, not `.js`: it is deployed into `<repo>/tools/`, which has no `package.json`, so Node resolves a bare `.js` there as CommonJS and an ESM import in it fails outright. (2) RESEARCH §A3's recommended `src/` layout is **rejected** — `repo-root.mjs`'s branch-4 fallback climbs exactly three levels from `<root>/.claude/mcp/<server>/` and is pinned by a named regression test, and `RESOURCES_DIR` resolves `resources/` as a plain sibling; a `src/` subdirectory breaks both. Authored TypeScript stays flat, and `tsconfig.build.json`'s literal `include` list becomes the definition of "host-bound". (3) **`vice-pool.test.mjs` is a mixed test file**: of its 76 tests, roughly 28 cover modules that survive D-02 — including the *only* coverage `install-resources.mjs` has, which criterion 9 rests on — so a whole-file deletion would silently remove them. Plan 02 exists solely to rescue them first. (4) The tracer's `broker.json` record **omits `heartbeat_at` deliberately**: `vice-broker-client.mjs` classifies a record without one as `never_started`, so an inert record reads as honest rather than as a live broker, and the writer additionally refuses to overwrite a record naming a live pid. (5) RESEARCH §E(c)'s proposed load-order regex does not work as written — its extension group misses the `.mjs` specifier that is the only one that exists, and once widened it matches the forbidden import **quoted verbatim in the module's own header comment**, so the pattern must be anchored to a statement. (6) `01.6-VALIDATION.md`'s full-suite command is wrong: `node --test <dir>/` makes Node treat the directory as a test file. Measured baseline, live: **268 tests, 268 pass, ~34 s**, via `node --test '.claude/mcp/vice/*.test.*'`. One reversibility rating is `one-way` — the D-02/D-05 deletion, which reverses locked decision `D-1.2-B` — so a `checkpoint:decision` sits immediately before it in plan 04; the tracer is rated `costly` and flagged only. A blocking, non-auto-approvable `checkpoint:human-verify` gates the first `npm install`, per the `[SUS]` legitimacy verdict on `typescript`.

**Requirement mapping**: none — tooling phase.

**Design source**: `.planning/notes/one-process-broker-in-typescript.md` (the 2026-08-02 scope amendment — read first). `.planning/notes/broker-control-plane-over-tcp.md` and `.planning/seeds/broker-restart-reaps-and-voids.md` inform **Phase 01.7**, not this one.

**Conversion inventory** (measured 2026-08-02 — the phase is sized by these numbers, so re-measure before planning rather than trusting them):

| What | Files | Lines | Disposition |
|---|---|---|---|
| `.claude/mcp/vice/*.mjs` (source) | 13 | 6,426 | → TypeScript |
| `.claude/mcp/vice/*.test.mjs` | 8 | 10,096 | → TypeScript |
| `resources/vice-broker.sh` | 1 | 2,103 | deleted, logic absorbed |
| `resources/vice-pool.sh` | 1 | 611 | deleted, logic absorbed |
| `resources/vice-supervisor.sh` | 1 | 443 | deleted, logic absorbed |
| `resources/lib/container-guard.sh` | 1 | 184 | **not boilerplate** — see criterion 6 |
| `resources/lib/repo-root.sh` | 1 | 103 | deleted or absorbed into the launcher |
| **the one surviving shell script** | 1 | — | to be written: starts the broker, nothing else |

**Explicitly out of scope for conversion:** `tools/*.mjs` (~4,900 lines of RE tooling with tests) and `.claude/skills/*/scripts/*.mjs` (~811) — a separate concern with its own lifecycle, sharing no code with the MCP; filed as a follow-up rather than dragged into this phase (developer, 2026-08-02). `.planning/spikes/**` (~1,500 lines) is **never** converted — those are frozen records of completed experiments, and rewriting them destroys evidence, the same objection as editing a confidence grade in place. `.devcontainer/*.sh` is container provisioning, untouched.

**Success Criteria** (what must be TRUE):

  1. **ANSWERED 2026-08-02 — the host has `node` on PATH.** This was the phase's gate and it is cleared. Confirmed by the developer, who has host access; **not** verified from the container, which cannot verify it by construction (`lib/container-guard.sh` makes `vice-broker.sh` *refuse* to run in the devcontainer, and `x64sc`, its windows and its MCP listeners are all host-side). The remaining obligation is mechanical rather than investigative: **there is no existing host-side Node precedent in this repo to copy** — `vice-pool.sh` + `vice-pool.mjs` is a host/container *split*, not a thin-shell/fat-node split — so the first plan establishes and records the host-side Node invocation pattern (how the shell entry point calls it, what its cwd and module resolution are, how `install-resources.mjs` deploys it) before any logic moves. Record the host's actual `node --version` when that first invocation runs, since the version bound is now a real constraint on what the moved code may use.

  2. **All three host-side shell scripts retire into one application, and nothing shell-shaped is carved out to stay behind.** *(Rewritten 2026-08-02 — the previous wording kept process launch, signalling, the daemon loop and traps in bash. It does not stay.)* `resources/vice-broker.sh` (2,103 lines), `resources/vice-pool.sh` (611) and `resources/vice-supervisor.sh` (443) all go — 3,157 lines of bash — along with `vice-pool.mjs`'s host/container split. Everything the old criterion listed as *moving* still moves: hand-rolled JSON (`json_escape`, `write_json_atomic`, `extract_*_field`, `read_*_field`), the spare state machine, `count_*`, port allocation and blocking, lease staleness, grant sweeping, and the decisions in `process_requests`/`maintain_spares`. Everything it listed as *staying* now moves too, because there is no second process left to hold it: `launch_instance`, `signal_recorded_pid`, `reap_all_instances`, the daemon loop and traps, `port_in_use`, and the host `curl` probe. The developer's rationale for one process over one codebase-with-subcommands: the broker has direct access to everything and can act fast on requests. **What this costs, stated plainly:** `vice-supervisor.sh` is today one process *per emulator* and it **outlives broker restarts**, which is what makes the restart-epoch file trustworthy as an independent channel. Collapsing it inward removes that independence — Phase 01.7's criterion 4 (unconditional reap on startup) is what pays for it.

  3. **The application is TypeScript, and the host receives only JavaScript.** Locked 2026-08-02 after the cost was named explicitly: this repo has **no TypeScript today** — no `tsconfig.json`, no root `package.json`, no `node_modules`, zero JS dependencies, and the 268-test suite runs on bare `node --test` with no build step, so what is committed is byte-identical to what is deployed. That property ends here, deliberately. Authored TS compiles to JS that `install-resources.mjs` deploys exactly as it deploys shell scripts today; the host needs `node` and never `tsc` or `npm`. `tsconfig`'s `target`/`lib` is then a **better** answer to criterion 1's version bound than recording `node --version` and hoping — the version becomes a setting the code cannot accidentally violate. **The directory-meaning inversion must be handled in the same change, not after it:** `./.claude/CLAUDE.md` currently instructs editing host scripts *in* `resources/`, which becomes generated output — so that rule is updated, generated files carry a banner, and a test asserts `resources/` is in sync with its source. Editing a build artifact and watching it silently vanish on the next build is the failure this criterion exists to prevent.

  4. **The broker holds all its state in a single place, in process.** The developer's framing: *"the broker becomes a server that holds everyting it needs to know in as single place."* Today coordination state is scattered across six on-disk locations — `grants/`, `requests/`, `leases/`, `spares/`, `broker-instances.json` and the per-instance epoch files — which is why recovering from the 2026-08-01 stale-grant defect required moving five directories aside **by hand** (Phase 01.5 criterion 3). All of it becomes in-process state with one owner. **One deliberate exception survives:** `broker.json` stays on disk as the *discovery* record, because without a file naming the port nothing can find the broker and `ECONNREFUSED` goes back to being ambiguous between never-started, stale and alive. State in one place; discovery still a file. (Retiring the file *protocol* is Phase 01.7 — this criterion is about where state lives, not how the proxy talks to it.)

  5. **Orphaned `x64sc` after a SIGKILL is accepted, and nothing is built to prevent it.** *(Scope relaxed 2026-08-02 by the developer, who withdrew the earlier hard "never orphan" constraint: a stray emulator is easy to close by hand, and the machinery to avoid it is not worth its cost.)* On **catchable** shutdown — `SIGTERM`, `SIGINT`, `SIGHUP`, `uncaughtException`, `unhandledRejection`, normal exit — the broker kills every child it launched, identity-verified against the pid recorded at spawn, reusing Phase 01.3 criterion 6's verified-kill discipline rather than re-deriving it. That is the whole mechanism. On `SIGKILL` (or OOM-kill, or power loss) the emulators are left running and are cleaned up manually. **Recorded so it is not re-proposed as a defect: SIGKILL and SIGSTOP cannot be caught, blocked or handled** — a process receiving signal 9 executes no handler, no `process.on("exit")`, no `finally`, and in a one-process design there is no supervisor left to be told anything. So this is not a gap to be closed later by a cleverer handler; there is no handler. `PR_SET_PDEATHSIG` and cgroup-per-run were both considered and **dropped as over-engineering**, not deferred. **Note Phase 01.7's criterion 4 is unaffected** — unconditional reap-on-startup stays exactly as written, for its own reason: without it a restarted broker sees zero connections, concludes every emulator is free, and hands a live one to a second session. That is a correctness rule about *granting*, not orphan hygiene, and a surviving stray is precisely what it must not hand out.

  6. **Exactly one shell script survives, and the container guard survives with it.** The single remaining script starts the broker and does nothing else. `resources/lib/container-guard.sh` (184 lines) is **not boilerplate to delete on the way past** — it makes the broker *refuse to run inside the devcontainer*, and `x64sc`, its windows and its MCP listeners are all host-side, so a broker started in the wrong place is a real failure this guard prevents. It either lives inside the surviving launcher or moves into TypeScript, deliberately either way. Same question, answered explicitly, for `resources/lib/repo-root.sh` (103 lines).

  7. **The duplicated request-id regex is deleted, not merely kept in sync.** `is_valid_request_id` in bash must stay byte-identical to `REQUEST_ID_PATTERN` in `vice-broker-client.mjs`, and a parity test exists solely to stop the two implementations of one rule from drifting. Importing the constant makes that test unnecessary rather than passing.

  8. **The existing 102 KB test suite passes across the move.** It is the cheapest available proof of equivalence, and `--once` plus `VICE_BROKER_PROBE_CMD` are the seams every test drives; both stay.

  9. **`install-resources.mjs` deploys any new `.mjs` under `resources/`.** It copies `resources/` to the gitignored `tools/`; a new module that is not added to what it copies breaks the deployed broker with a missing-module error, silently, on a machine nobody is watching.

 10. **The conversion does not "tidy" the load-order hazard it will be tempted to tidy.** `install-resources.mjs` carries an explicit comment that it takes the repo root as an **argument** and imports **nothing** from `repo-root.mjs`, because `repo-root.mjs`'s `const HERE` is still in its temporal dead zone when this module evaluates — and it says in so many words *"Do not 'clean this up' by adding `import { repoRoot } from './repo-root.mjs'` here."* A mechanical language conversion, especially one an agent runs across 16,522 lines, is exactly the process that performs that cleanup and breaks module initialisation silently. The hazard is re-read, preserved, and covered by a test that fails if the import is ever added back.

**Risks**: ~~The gate may close the phase~~ — cleared 2026-08-02, see criterion 1. **This phase now runs FIRST, so it has no live-session verification available at all** — see the verification-hazard note above. Its only proof of equivalence is a test suite that Phase 01.4 has already demonstrated can be 268/268 green while three tools are uncallable from a real session. That is the single largest risk here and it cannot be engineered away by adding tests of the same shape. **The host Node version is an unknown constraint**: `node` is present but its version is not recorded, and the converted code inherits whatever it is; establish it in the first plan rather than discovering it through a syntax error on a machine nobody is watching — though criterion 3's `tsconfig` `target` turns this from a landmine into a pinned setting. **A TypeScript build step lands between committed source and deployed artifact for the first time in this repo** — a stale build deploys stale code silently, on a machine nobody is watching, and `resources/` inverts from authored source to generated output while `./.claude/CLAUDE.md` still instructs editing it directly. **16,522 lines is a volume at which an agent-driven conversion drifts**: 6,426 lines of source plus 10,096 of tests, and the tests are the equivalence proof, so a conversion bug that lands in *both* halves is invisible. Convert in slices that keep the suite green continuously rather than in one jump. **Collapsing the per-instance supervisor inward removes an independent channel**: `vice-supervisor.sh` currently outlives broker restarts, which is what makes the restart-epoch file trustworthy on its own. **Concurrency moves from a poll loop to an event loop** — the single `in_flight` flag that prevents a repeat of the 2026-08-01 triple-launch must survive as a single owner; TypeScript makes this easier than bash, but only if it is deliberate. **No host-side Node precedent exists in this repo**, so deployment, module resolution and the shell→Node call boundary are all first-time work, not copies of an established pattern.

---

### Phase 01.6.1: Container-Side Conversion to TypeScript

> **Split out of Phase 01.6 on 2026-08-02** (planner returned `## PHASE SPLIT RECOMMENDED`; developer
> approved the four-way split). Read Phase 01.6's section first — the criteria register, the scope
> amendment, the verification hazard and the risk list are shared and are not repeated here. All four
> research artifacts live in `.planning/phases/01.6-broker-in-node-and-tcp-control-plane/` and apply
> to this group unchanged.

**Goal**: Every surviving container-side `.mjs` module and its tests are TypeScript, the suite is green continuously across the move, and the two hazards a mechanical conversion would erase are covered by tests that fail if they are re-introduced

**Depends on**: Phase 01.6 (the build topology must be proven and the deletion landed, so this group converts only what survives and against a pipeline that is known to work)

**Owns from Phase 01.6's criteria register**: C3 (the TypeScript half — authored TS, host receives only JS), C7 (the duplicated request-id regex is deleted, not synced), C8 (the existing suite passes across the move; `--once` and `VICE_BROKER_PROBE_CMD` stay real seams), C10 (the load-order hazard is preserved, not tidied).

**Scope**: ~~11 surviving `.mjs` source files (5,316 lines) and 5 surviving test files (5,518 lines) after D-02's deletions.~~ **[RE-MEASURED 2026-08-03 — the figures above were written at split time, before Phase 01.6's four plans executed, and are stale.]** Live inventory: **11 source files (5,237 lines)** and **11 owned test files (6,680 lines)**, plus `host-scripts.test.mjs` (280). Six of those test files did not exist at split time — plans 01.6-02 and 01.6-03 created them — which is ~1,200 lines of test conversion the old figure did not account for. Baseline suite: **247 tests, 247 pass, ~35 s**. Full table in `01.6.1-RESEARCH.md §1`; size plans off that, not off this line. `vice-proxy.mjs` (2,441) and `vice-proxy.test.mjs` (4,370) each need their own plan — they exceed one task's context budget alone. `vice-broker.test.mjs` (2,685) is **explicitly excluded** — it is redesigned, not ported, by 01.6.2 (C4).

**This group's own success criteria**:

  A. **The suite is green continuously, not green at the end.** A conversion bug that lands in *both* a source file and its test is invisible; per-file conversion with that file's own test run at each commit is what makes it visible. Slicing strategy is RESEARCH.md §A5.

  B. **C10's static check covers the transitive path, not just the direct import.** The planner found an already-existing, undocumented three-module cycle: `repo-root.mjs` → `install-resources.mjs` → `hostpath.mjs` → `repo-root.mjs`. It survives only because `hostPath()` is called lazily inside `hostLaunchInstructions()`, never at `install-resources.mjs`'s top level — the same "lazy call does not crash" nuance RESEARCH.md §E reproduced, one hop further out. **The check specified in VALIDATION.md (`!/from ["']\.\/repo-root(\.[jt]s)?["']/`) would not catch a reintroduction routed through `hostpath`.** Either widen the check to the transitive path or break the cycle — deliberately, either way.

  C. **`enum`, `namespace` and constructor parameter properties never enter the codebase.** Container Node v24.18.1 strips types natively and unflagged (verified live) but rejects all three; a file using them passes `tsc` and fails at `node --test`. Enforce mechanically via `erasableSyntaxOnly` from the first converted file, not by convention.

**Risks**: This is the bulk of the line count and the place a mechanical conversion drifts silently. `vice-proxy.mjs`'s ~2,100 lines of project-specific logic (broker leasing, epoch/liveness, recycle/diagnose, deny-list, path rewriting, incident capture) must come through untouched — 01.6.3 swaps its transport seam afterwards, and doing both at once would make a regression ambiguous.

**Plans:** 8/8 plans executed

Plans:
**Wave 1**

- [x] 01.6.1-01-PLAN.md — **Tracer.** The whole per-slice loop on one real module (`vice-probe` source + test), with all three extension-hardcoded module enumerators widened in the same commit; then Slice 0's two doc-shape tests, `host-scripts.test` (PTD-2) and the stale `workflow.test_command`

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01.6.1-02-PLAN.md — Criterion B, both halves (PTD-1): break the `repo-root`/`install-resources`/`hostpath` cycle structurally, empty the allowlist, add a module-scope `repoRoot` call-site guard, and **prove both guards fail against an injected regression**. No renames

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01.6.1-03-PLAN.md — Slice 2: the three ex-cycle modules and their three test files convert; the last hardcoded-extension read becomes a by-stem resolution; ~15 consumer specifiers repointed

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01.6.1-04-PLAN.md — Slices 3–4: `containerpath` and `incident-record`, each with its own test; atomic-write ordering and both never-throw layers demonstrated intact

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 01.6.1-05-PLAN.md — Slices 5–6: `vice-broker-client` (C7 — the request-id pattern survives as a typed export; the out-of-scope parity test touched in exactly one line) and `vice`, with its export surface asserted unchanged

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 01.6.1-06-PLAN.md — Slices 7–8: `refresh-manifest` and `vice-sync` convert **and get their first-ever coverage**; the emulator-dependent checkpoint primitives recorded as machine-visible todos, never faked with a stub

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 01.6.1-07-PLAN.md — Slice 9a: the 2,441-line hub converts and `.mcp.json` is rewired in the same commit, audited against a pre-captured invariant baseline and a real offline MCP handshake over stdio; its 4,370-line test file stays `.mjs` as an unchanged oracle

**Wave 8** *(blocked on Wave 7 completion)*

- [x] 01.6.1-08-PLAN.md — Slice 9b: the 4,370-line proxy test converts; phase close rolls up C3/C7/C8/C10 + A/B/C with evidence, re-proves the criterion-B guards against the final tree, and records the two unprovable claims as backstops

**Cross-cutting constraints:**

- The typecheck exits 0 and the suite is green with no test lost

**Waves:** strictly sequential, 1 → 8. **Deliberately no parallelism.** Criterion A requires the suite green *continuously*; two plans landing in separate worktrees would each verify their own tree and neither would verify the merge. Independently, nearly every slice touches the hub's import block, so `files_modified` overlap forces the same ordering.

**Planning note (2026-08-03, `/gsd-plan-phase 01.6.1`):** tracer-first; plan 01 task 1 is a `type="tracer"` slice proving the complete per-slice loop before any of the ~12,200 lines ride on it. Two developer decisions were taken at plan time: **PTD-1** — criterion B resolves as *both* the cycle break and the guard, in that order, with the guard's discriminating power proven against a live-injected regression; **PTD-2** — `host-scripts.test` converts its file type now and its content is rewritten in 01.6.2, keeping the phase goal literally true with no carve-out. Four corrections to RESEARCH.md were found live at plan time and are recorded in plan 01: `vice-probe` is **not** a leaf (it has a bare side-effect import of `repo-root`); `skill-docs.test`'s `scriptModules()` is a **third** extension-hardcoded enumerator RESEARCH did not name; widening `enumerateModules()` without a `node_modules` exclusion would enumerate 335 third-party declaration files; and widening `scriptModules()` collides with `./.claude/CLAUDE.md:209`, which names `resources-sync.test.ts` deliberately. One measurement de-risks the cycle break: `CONTAINER_WORKSPACE_PATH` is exported by `devcontainer.json`, so the env-first fallback preserves every existing bare call site and RESEARCH's assumption A2 (nine test call sites needing a threaded parameter) does **not** bite. Reversibility: no `one-way` ratings, so no `checkpoint:decision`; the cycle break and the `.mcp.json` rewiring are rated `costly` and flagged. No package installs, so no legitimacy gate. `api-coverage` and `assumption-delta` detectors both returned `detected: false`. Spec-less probe fallback skipped, visibly: no SPEC.md and no requirement IDs to probe.

---

### Phase 01.6.2: The One-Process Host Broker

> **Split out of Phase 01.6 on 2026-08-02.** Read Phase 01.6's section first — shared criteria
> register, scope amendment, verification hazard and risks are there.
>
> **SCOPE ENLARGED 2026-08-03, via `/gsd-discuss-phase 01.6.2`.** The developer merged **Phase 01.7
> (The TCP Control Plane)** into this phase and folded **Phase 01.5 (Session and Broker
> Survivability)** into it. Both are now `ABSORBED` stubs pointing here; neither was deleted, so
> every existing cross-reference still resolves.
>
> **This reverses the 2026-08-02 four-way split for two of its members**, and is recorded as a
> reversal per the D-03 precedent — *a locked decision reversed without a record is the failure mode
> this project already names for confidence grades*. The split existed because *"old 01.6 carried
> four changes at once — consolidate three programs into one, change language, centralise state,
> change transport. Its own criterion 15 flagged that as one too many."* That rationale, and the
> cost of landing the transport change ahead of 01.4 (no live verification) and ahead of 01.5
> (defects and protocol changing together), were put in front of the developer before the decision.
>
> **All decisions live in `.planning/phases/01.6.2-the-one-process-host-broker/01.6.2-CONTEXT.md`
> (D-01…D-27). Read it before planning — it governs where this section and the design notes
> disagree.**
>
> **SPLIT 2026-08-03 (later the same day), at plan time, via `/gsd-plan-phase 01.6.2`.**
> `gsd-planner` returned `## PHASE SPLIT RECOMMENDED` rather than plans — the outcome this section's
> own risk paragraph anticipated — and the developer chose the split. **Phase 01.6.2.1 (Broker
> Lifecycle Policy)** now owns criteria **E, L and M** and CONTEXT decisions **D-02, D-05, D-06,
> D-07, D-08, D-10, D-11, D-19, D-20, D-21, D-22**. Everything else stays here.
>
> **This is the second recorded reversal in two days and is logged as one, per the same D-03
> precedent.** The scope enlargement above is *not* undone: Phase 01.7 stays absorbed and lands
> whole inside this phase (D-01 is honoured in one move — `requests/`, `grants/`, `denials/`,
> `leases/`, `recycle-acks/` and `broker-instances.json` all cease to exist here), and Phase 01.5
> stays an `ABSORBED` stub that never returns to the roadmap. What changed is only where 01.5's
> *defect fixes* land: in a sub-phase of this one, still in TypeScript, still after the new machine
> exists. **The split axis is deliberately not the one the developer rejected on 2026-08-03**
> (*conversion | defects | transport*); it is the seal boundary — *"the new machine exists and the
> file protocol is dead"* | *"its lifecycle policy is corrected."*
>
> **Quantified basis, measured live at plan time** (the artifacts undercounted three of these):
> ~13 plans across 11 near-strictly-sequential waves against a `standard` granularity of 3–5 and a
> largest in-repo precedent of 8 (01.6.1). Retiring-script references across tracked TypeScript:
> **~37 hits in 12 files**, not RESEARCH §A6's "5 call sites + 9 test hits". `6510` references
> needing re-banding per D-18: **~34 hits in 5 files**, never counted anywhere. And
> `vice-broker-client.test.ts` (240 lines) is a **second** test-file redesign no artifact counted —
> it tests only functions that retire under D-12. Waves are sequential rather than parallel because
> every plan after the tracer writes into the same three modules, so `files_modified` overlap forces
> ordering; there is essentially no parallelism to buy.

**Goal**: 2,546 lines of host-side bash become one TypeScript process that owns coordination, per-instance supervision and the warm pool, holding its state in memory and speaking to the container over one TCP control connection per session whose lifetime *is* the lease — with exactly one shell script left in the repo and the file-messaging protocol retired. ~~and five lifecycle-policy defects fixed rather than translated~~ — **the five lifecycle-policy changes moved to Phase 01.6.2.1 on 2026-08-03 (criterion L); this phase builds the machine they are policy for.**

**Depends on**: Phase 01.6.1 (this group writes TypeScript against the conventions, types and build settings that group establishes; running them concurrently would make a suite regression ambiguous in attribution)

**Owns from Phase 01.6's criteria register**: C2 (all three host-side shell scripts retire into one application, nothing shell-shaped carved out to stay behind), C4 (state in one place, in process), C5 (catchable shutdown kills every child, identity-verified; SIGKILL orphans accepted), C6 (exactly one shell script survives, container guard survives with it), C1 (the host's actual `node --version` recorded), C7 (the bash half of the request-id regex).

**Scope**: `vice-broker.sh` (2,103) + `vice-supervisor.sh` (443) re-expressed as one process; `lib/container-guard.sh` (184) + `lib/repo-root.sh` (103) dispositioned with them (PD-03/PD-04); the file-messaging protocol replaced by a TCP control plane (absorbed 01.7); the `vice-broker.test.mjs` **redesign** (2,685 lines / 61 tests) **plus `vice-broker-client.test.ts` (240 lines)**, which tests only functions retiring under D-12 and is a second redesign no source artifact counted; the ~37 retiring-script references across 12 tracked TypeScript files and the ~34 `6510` references across 5; and the surviving launcher. ~~the five lifecycle-policy changes of `.planning/notes/vice-broker-lifecycle-decisions.md`; Phase 01.5's defect scope (absorbed)~~ — **moved to Phase 01.6.2.1, 2026-08-03.**

**This group's own success criteria**:

  A. **`vice-broker.test.mjs` is redesigned, not ported.** It verifies the bash daemon by spawning it as a real subprocess and inspecting on-disk `grants/`/`spares/` files. Once state moves in-process per C4 **and the file protocol is gone entirely**, that verification mechanism stops existing. It is the single largest item in the conversion and must be sized as its own work, never folded into a generic "convert `vice-broker.sh`" line item. RESEARCH §F's per-function quantification is a floor, not the estimate. **Split 2026-08-03: this phase owns the 61-test disposition ledger and the replacement suite for everything *this phase* builds; the tests for the five policy changes are criterion L's, in Phase 01.6.2.1, one per change. `vice-broker-client.test.ts` is in this phase's half.**

  B. **D-04 — the per-instance restart-epoch file survives as one of exactly two on-disk exceptions, written by the broker, contract unchanged.** `readEpoch()`'s entire value is a liveness check that costs zero MCP traffic, which requires *some* on-disk record; today `vice-supervisor.sh`'s `write_epoch()` writes it and D-1 folds that process away. The file's format, location and semantics do not change — only its writer. **The two survivors are `broker.json` (discovery, now carrying the control port) and the per-instance `epoch.json`. Everything else under `.vice-supervisor/` goes, except per-instance boot/crash logs, which stay because a human reads them (CONTEXT D-23).**

  C. **The single `in_flight` owner survives the move from a poll loop to an event loop.** The 2026-08-01 outage launched three `x64sc` processes simultaneously; that guard is why. A concurrency race test — two concurrent launch requests against a **stubbed** spawn, asserting exactly one spawn — is a required deliverable, and **must be green before the launch-priority layer (criterion L) is written**, so a failure has one candidate cause. **No real emulator: `mcp__vice__*` is the only route to VICE and tests must not open their own.**

  D. **Identity-verified kill is reused, not re-derived.** Phase 01.3 criterion 6 already established the discipline. **The expected-identity substring needs correcting, not copying** — the broker now spawns `x64sc` directly rather than through an intermediate supervisor script, and a wrong-but-compiling identity string is a real new risk this phase introduces (RESEARCH Pitfall 2).

  E. **→ MOVED to Phase 01.6.2.1 on 2026-08-03.** *Correctness is claimed against specification, not against the bash — and the unverified set is itemised and owned.* The criterion's **framing binds this phase too** and is restated here so a reader of this section alone is not misled: with the protocol replaced there is no old behaviour for most of this deliverable to be equivalent to, so "a green suite proves language and structural equivalence" is retired as the frame; the genuinely-unchanged set (the emulator data plane, the `epoch.json` contract, the agent-facing tool surface) is named separately and held to real equivalence. What moved is the **deliverable** — authoring the itemised carry-forward list into `01.6.2-VALIDATION.md` that **Phase 01.4 owns and must discharge**. It lands last, in 01.6.2.1, because it must cover both phases' unverified claims and cannot be written before the second one exists. **No live-session verification exists until Phase 01.4 for either phase.**

  F. **The lease is the connection.** Connection open is the claim; connection close — including on SIGKILL and including container death — is the release, enforced by the kernel. `startHeartbeat()`, the mtime-as-heartbeat convention, `file_mtime_epoch()`, `lease_is_stale()`, `sweep_grants()` and the 180 s TTL **all retire together**; keeping any one of them leaves two competing authorities on whether a lease is alive.

  G. **Bootstrap stays a file, and the port bands are separated.** `broker.json` gains the control port and becomes the discovery record, read once, so `ECONNREFUSED` is never ambiguous; `readBrokerLiveness()` keeps distinguishing `never_started` / `stale` / `alive`. **Three bands: the control plane on a fixed default clear of both others; 6510–6599 reserved by convention for an `x64sc` a human launches for their own work; broker-allocated instances from 6600 up.** This is what stops the broker squatting a port an operator wants, and it retires the VS Code `127.0.0.1:6511` collision that Phase 01.5 criterion 5 recorded.

  H. **The emulator data plane is unchanged.** The proxy still dials the granted port directly. The broker carries control traffic only — acquire, release, recycle, status, host-state questions — and is never in the emulator path. This is what keeps the change off the hot path.

  I. **Broker restart reaps every instance unconditionally, and the void rides the existing epoch mechanism.** With the lease in a connection, a restarted broker would otherwise see zero connections, conclude every emulator is free, and hand a live one to a second proxy. Reaping bumps every epoch, which `assertSameMachine()` already turns into `MachineRestartedError` — no second notion of "recoverable". **Unconditional**, because a SIGKILLed broker never runs a shutdown path, so "was the last shutdown clean" is unanswerable and a marker file would itself be the class of liveness claim criterion F retires.

  J. **A lost machine costs one acquisition, not the session — and the agent is told plainly.** When a proxy's granted emulator stops answering, the proxy acquires a replacement immediately, but **the call that hit the dead emulator returns an explicit error** naming that the machine was replaced and prior state is gone; the next call succeeds on the new instance. Serving that call silently against a blank machine would return zeroed RAM as a valid read, which is exactly what the epoch check exists to prevent. **Broker death gets the same discipline and the same vocabulary** — an accepted, knowing regression against today, where broker death is survivable.

  K. **Two brokers cannot run at once — CR-01 closes here.** `01.2-REVIEW.md`'s CR-01 is an independently-verified blocker carried since Phase 01.2: `cmd_start()` has no singleton guard, so two concurrent brokers race in a read-then-remove that is not atomic across processes and can hand the same ready spare to two sessions. A TCP listener on a well-known port cannot be bound twice, so `EADDRINUSE` is a kernel-enforced singleton — **verify it actually holds rather than assuming it.** On `EADDRINUSE`, `broker.json` arbitrates and there are **two distinct outcomes**: a live broker → exit quietly as a second instance; `stale`/`never_started` → the port is held by something that is not a broker → fail loudly. The guarantee holds only while the control port keeps its default; say so rather than implying it is unconditional.

  L. **→ MOVED to Phase 01.6.2.1 on 2026-08-03.** *The five lifecycle-policy changes land as five explicitly-labeled tasks, each with its own test.* Full text in that phase's section. **This phase must not implement any of the five** — but criterion C's race test is 01.6.2.1's stated prerequisite for the launch-priority change (D-07), so it is a real cross-phase dependency, not a note.

  M. **→ MOVED to Phase 01.6.2.1 on 2026-08-03.** *Phase 01.5's seven criteria are discharged or explicitly carried — and the plan shows which, per criterion.* Full text, and the two items the discussion left unsettled, in that phase's section. **This phase does not discharge 01.5's defects**, so absorbing 01.5 is not sealed until 01.6.2.1 verifies — say so rather than letting this phase's seal imply it.

  N. **The control listener is reachable from the container and is not open to everything that can reach the host bridge.** *(Added 2026-08-03 at plan time; not in the original register.)* This is the subsystem's **first network listener** — the bash daemon had none, so no inherited threat register covers it, and with no live verification until Phase 01.4 nothing in this phase would catch a wrong choice. Two parts, both load-bearing: **(a)** it must **not** bind `127.0.0.1`. The container reaches the host at `host.docker.internal`, which is the bridge address and not host loopback, and `VICE_BROKER_MCP_HOST` already defaults to `0.0.0.0` for exactly this reason — a loopback-only control listener is *structurally unreachable* from the container. State the bind address explicitly rather than inheriting a default. **(b)** Bound across the bridge, an unauthenticated control plane lets any process that can reach the host bridge acquire, release, recycle or — via reap — kill emulators. **Developer decision, 2026-08-03: `broker.json` carries a per-boot capability token.** It is already mode `0600` under the uid-parity precondition (`D-1.2-D`) and is already read once at bootstrap, so this is the same file on the same read — no new channel, no new failure mode. The token is required on every control request; a request without it is refused before any state is touched. **This earns a `checkpoint:decision` before the listener is written** — it is a one-way door on the wire format.

**Risks**: **Even after the 2026-08-03 split this phase carries two of three phases' content** — the consolidation, the language change and the transport, with only the five behaviour changes moved out. **Every failure mode changes shape at once** when a lease stops being a file: anything that quietly depended on one of criterion F's six mechanisms fails in a new way. **Nothing here is live-verifiable** until Phase 01.4, and criterion E's carry-forward list — the thing that makes that survivable — is now authored in **01.6.2.1**, so this phase seals with its unverified set itemised but not yet consolidated. Collapsing the per-instance supervisor inward also removes an independent channel — `vice-supervisor.sh` currently outlives broker restarts, which is what made the epoch file trustworthy on its own; D-04 keeps the file but not that independence, and criterion I's unconditional reap is what pays for it. **Criterion I's reap has a derivation problem the seed already flagged and no plan may hand-wave:** in-process state means a restarted broker has *no* registry, so the reap must be derived from the port band plus process identity (`ps`-verified `x64sc` on 6600+), not from a file. That is the one place where deleting the on-disk registry costs something real. **Five agent-facing strings become instructions to run a file that will not exist** — `supervisorHostPath()` at `vice-proxy.ts:1387` feeds `neverStartedMessage()`/`deadOrHungMessage()`/`aliveButFailedMessage()`, and `vice.ts:236,352,546` plus `vice-sync.ts:254` each tell the agent to run `tools/vice-supervisor.sh` on the host. RESEARCH §A6 names only `brokerHostPath()`. That is Phase 01.4 criterion 5's exact failure shape arriving as a side effect of this phase. **`install-resources.ts`'s `hostLaunchInstructions()` needs a paragraph deleted, not a path swapped** — it advertises the standalone non-MCP recovery pipeline, whose scripts D-23 confirms are already gone; swapping the path would keep advertising a dead capability. **The live epoch fixture must be captured before anything is deleted** — `01.6.2-VALIDATION.md` flags the capture as order-dependent and irreversible if missed, and a bash-written broker with four recorded instances exists *now*.

**Plans:** 15/15 plans executed

Plans:
**Wave 1**

- [x] 01.6.2-01-PLAN.md — **Tracer.** The live epoch/broker fixture capture (order-dependent, irreversible), a blocking `checkpoint:decision` on the control-plane wire format, and then one `acquire` end to end: authored TypeScript → `tsc` → banner-marked `resources/` → the container guard in **TypeScript at broker startup** (PD-03) → the control listener on `0.0.0.0:19510` with per-boot capability-token auth (criterion N) → the guarded spawn seam → `epoch.json` → a grant the existing `containerizeGrant()` consumes → connection close releases and identity-verified-kills (criteria A/B/C1/C6/N, D-04, D-18, D-26, D-27, PD-03)

**Wave 2** *(blocked on Wave 1)*

- [x] 01.6.2-02-PLAN.md — In-process state (C4), port allocation re-banded to **6600** (D-18), the three counts, serialised warming with its break-after-first-success, the readiness probe's three branches with the injectable seam intact, and **criterion C's concurrency race test** with proven discriminating power — Phase 01.6.2.1's stated prerequisite for D-07

**Wave 3** *(blocked on Wave 2)*

- [x] 01.6.2-03-PLAN.md — The epoch writer held to the frozen bash fixture by a diff test (criterion B, D-04); the per-instance supervisor absorbed wholesale — crash respawn with doubling clamped backoff, crash-loop give-up, the deliberate-kill marker that stops a teardown respawning, and the per-instance boot/crash logs a human reads (D-23)

**Wave 4** *(blocked on Wave 3)*

- [x] 01.6.2-04-PLAN.md — `verifiedKill()` with the **corrected** identity string and the four-word stage contract (criterion D, Pitfall 2); catchable shutdown across all six paths with the uncatchable case recorded as accepted (C5); the **unconditional startup reap derived from the port band plus `ps` identity, not from a file** (criterion I, D-15); the mandatory start-time banner (D-25)

**Wave 5** *(blocked on Wave 4)*

- [x] 01.6.2-05-PLAN.md — The complete control-plane message set (`acquire`/`release`/`recycle`/`status`/`host_state`), the arrival-ordered pending-acquire structure without the fairness claim, `broker.json` at its full field set with a refreshed `heartbeat_at` and a true `written_by` (criterion G, D-24, D-26, D-27), and the **kernel-enforced singleton with its two distinct outcomes — CR-01 closes** (criterion K, D-17)

**Wave 6** *(blocked on Wave 5)*

- [x] 01.6.2-06-PLAN.md — The container-side control client, additive: one connection per session, one discovery-record read, all five kinds, real deadlines, correct framing both directions, broker death as its own typed outcome. Plus `vice-broker-client.test.ts` redesigned with a per-test disposition table — **criterion A's second half**

**Wave 7** *(blocked on Wave 6)*

- [x] 01.6.2-07-PLAN.md — The proxy swapped onto TCP (acquire, release, recycle) **and** the file protocol's container half deleted in the same commit, with a structural closure gate proving none of criterion F's six mechanisms survives (criteria F/H, D-01, D-09, D-12, PD-05)

**Wave 8** *(blocked on Wave 7)*

- [x] 01.6.2-08-PLAN.md — A lost machine costs one acquisition, not the session, and the triggering call fails loudly naming the replacement (criterion J, D-13, closing Defect 4); broker death gets the same discipline and the same vocabulary as an accepted knowing regression (D-14)

**Wave 9** *(blocked on Wave 8)*

- [x] 01.6.2-09-PLAN.md — All eight host-instruction messages repointed at the surviving launcher with invocations it actually accepts; `hostLaunchInstructions()`'s dead-capability paragraph **deleted, not repointed** (D-23); and the **per-occurrence triage** of every `6510` reference — one of which is the processor, not a port (D-18)

**Wave 10** *(blocked on Wave 9)*

- [x] 01.6.2-10-PLAN.md — **Criterion A's first half:** the 61-test disposition ledger and the function-by-function disposition table (C2), both into `01.6.2-VALIDATION.md`, plus every replacement test a row names but nobody wrote, plus the reconciled count arithmetic plan 11 asserts against

**Wave 11** *(blocked on Wave 10)*

- [x] 01.6.2-11-PLAN.md — **The deletion, behind a blocking `checkpoint:decision`.** The repo-root ladder inlined into the launcher and every retiring-script test fixture repointed first; then the four bash files, `vice-broker.test.mjs`, `host-scripts.test.ts`'s two structural arrays, its SIGHUP test and its `bash -n` loop, and the ignore-block lines — **all in one commit** (C2, C6, C7, D-01, D-24, PD-04)

**Wave 12** *(gap closure, blocked on Wave 11)*

- [x] 01.6.2-12-PLAN.md — **Gap closure, tracer.** Per-instance crash supervision actually wired into the real broker entry point: one exported exit-aware spawn wrapper with exactly one exit-listener installation in the tree, both launch paths composed through it, and a stub child killed out from under the *spawned artifact* coming back on the same port with its epoch advanced. Plus the structural anti-regression gate, with demonstrated ability to fail (closes **CR-01**, verification truth 18)

**Wave 13** *(blocked on Wave 12)*

- [x] 01.6.2-13-PLAN.md — `vice_recycle` respawns what it kills, as its own tool description already promises. The one boolean that silently answered two orthogonal questions is split: the broker-ordered-death marker keeps its name and narrows to "the broker ordered this", a separate field answers "does a replacement follow". Recycle spends no crash budget and waits no crash backoff; release stays gone. End-to-end proof of both directions (closes **gap 3** and **WR-01**, verification truth 19)

**Wave 14** *(blocked on Wave 13)*

- [x] 01.6.2-14-PLAN.md — Both remaining ways a grant outlives its owning connection: the destroyed-socket check moved *before* the launch call with a late-arriving grant released through the existing release path, and the replacement acquisition releasing the prior grant before adopting the new one. **No wire-format change** — the review's release-by-id sketch was rejected as an unnecessary one-way door (closes **CR-02** and **WR-03**, verification truth 20)

**Wave 15** *(blocked on Waves 12–14)*

- [x] 01.6.2-15-PLAN.md — The disposition ledger's recycle row corrected to cite a test that observes respawn in the *wired* system, with a dated correction note; the suite total measured rather than computed, with the inherited computed-versus-measured discrepancy stated not smoothed; and the two deliberately-excluded review warnings filed as durable pending todos (closes **gap 1**, verification truth 7)

**Waves:** strictly sequential, 1 → 15. **Deliberately no parallelism.** Every plan after the tracer writes into the same broker modules or the same two container-side hubs, so `files_modified` overlap forces the ordering; there is essentially no parallelism to buy, which the split analysis already quantified. Waves 12–14 inherit that same forced ordering (all three write `vice-broker.mts` or `broker-e2e.test.ts`, and all three append to the findings log). **Wave 15 is the one exception, and it is a choice rather than a conflict:** its files are entirely disjoint from wave 14's, so it could have run alongside it, but its suite arithmetic must count wave 14's added tests and its ledger correction should be written against the final green tree — recorded so a future reader does not read it as another forced ordering.

**Gap-closure planning note (2026-08-04, `/gsd-plan-phase 01.6.2 --gaps`).** Phase 01.6.2 executed 11/11 and verified **16/20 — not sealed**. Four plans added, numbered from 12 upward; **plans 01–11 are not modified** (developer decision at the planning gate: additive only). **The four gaps share one root and one shape:** the crash-respawn supervisor was built and exhaustively unit-tested in plan 03, but `vice-broker.mts` was outside that plan's `files_modified`, so wiring it was nobody's task — and a fully green 368-test suite reported nothing wrong, because a unit test proves the unit behaves, not that the assembled system reaches it. **Every acceptance criterion in these four plans is therefore checkable against the wired system** — the real spawned broker artifact, or a structural assertion that the real entry point calls the thing — because a gap closure that added more isolated unit tests would reproduce the exact failure. **Three developer decisions locked at the gate:** additive plans only; `vice_recycle` gets *real respawn* rather than a corrected description (restoring the retiring bash broker's own behaviour, so no regression to record); and scope is the four gaps plus **WR-01** and **WR-03**, with **WR-02** and **WR-04** deliberately left open and filed as `.planning/todos/pending/` items by plan 15 — named rather than dropped. **IN-01** is informational and untouched. Reversibility: **no `one-way` ratings and no decision checkpoint owed** — WR-03 is closed by ordering an existing release request before an existing acquire, which was chosen over the review's own release-by-id sketch precisely because that would have been a control-plane wire-format change of the class criterion N earned a blocking checkpoint for; the supervision wiring composes around the existing per-port logging spawn rather than changing its contract, keeping it `reversible` instead of `costly`. Security: `<threat_model>` in all four plans, ASVS L1, blocking on high, **30 further threats** (T-01.6.2-72 … T-01.6.2-101), one accepted with rationale. **Spec-less probe fallback skipped, visibly** — no SPEC.md and no requirement IDs to probe, so no probe-derived predicates exist in this plan set and none were fabricated; `requirements:` frontmatter carries criteria letters, CONTEXT decision IDs and this gap closure's own defect identifiers. **API-coverage detector run and returned `detected: false`** — no external API is integrated, so no coverage matrix is owed. **Assumption-delta detector run and returned `detected: true`, but all three signals are ROADMAP prose false positives**; the one genuine identity-model delta is the code-level one plan 13 introduces and records as `promote`. No package installs, so no legitimacy gate fires. **Nothing from criteria E, L or M is planned here.**

**Planning note (2026-08-03, `/gsd-plan-phase 01.6.2`, Group A only).** **Eleven plans, not the ~9 the split analysis projected** — the two extra come from splitting work that would otherwise have produced tasks in the three-thousand-line class, the exact failure the split existed to avoid. Tracer-first: plan 01 leads with a `type="tracer"` slice wiring one `acquire` through every layer the phase modifies, verified before any expansion task. Reversibility: **two `one-way` ratings, each with its own blocking `checkpoint:decision`** — criterion N's wire format before the listener is written (plan 01), and the four-file deletion (plan 11, following the Phase 01.6 plan 04 precedent). **Four plan-time findings no source artifact records.** (1) `vice-broker-launch.test.ts`'s `NETWORK_CALL_PATTERNS` scan asserts that NO host-bound source contains a network-call construct — the control listener, the readiness probe and the port-in-use check all trip it by design, so it must be amended deliberately in plan 01 with the container-side-versus-host-side distinction recorded, rather than discovered red. (2) `vice-proxy.test.ts`'s second network-call scan enumerates the whole module directory and pins the `fetch(`-containing set to exactly two files, so every new host-bound `.mts` is in its scope. (3) `vice-broker-launch.test.ts`'s three-key `broker.json` assertion and its two refuse-to-clobber tests all change here — a **third** test-file surgery beyond the two RESEARCH counted, and the refuse-to-clobber heuristic is *replaced* by the bind-before-write singleton, not merely extended. (4) **Not all ~34 `6510` references are ports**: `vice-proxy.ts:824` names the processor in a comment about a memory-mapped register, and `vice.ts`'s fixed-port fallback endpoint is *more* correct at 6510 after D-18 than before, because that band is now reserved by convention for an emulator a human launched — which is precisely why CONTEXT said re-check every one rather than replace them. Control port `19510`: above the registered range, below this container's measured ephemeral range start (`32768`), trailing `510` as a 6510 mnemonic; the **host's** range is unverifiable from here, so **MEDIUM** confidence, and the singleton guarantee holds only while that default is kept. No package installs, so no legitimacy gate — `typescript`/`@types/node` were approved at Phase 01.6 plan 01's checkpoint with an explicit forward-reference to this phase. **Spec-less probe fallback skipped, visibly:** no SPEC.md and no requirement IDs to probe, so there are no probe-derived predicates in this plan set. `requirements:` frontmatter carries criteria and decision IDs rather than fabricated REQ-IDs. Security: `<threat_model>` in all eleven plans, ASVS L1, blocking on high, **72 threats** — the listener is treated as a genuinely new surface with no inherited register, because the bash daemon had none. **Nothing from criteria E, L or M is planned here.**

---

### Phase 01.6.2.1: Broker Lifecycle Policy

> **Split out of Phase 01.6.2 on 2026-08-03, at plan time, via `/gsd-plan-phase 01.6.2`.**
> `gsd-planner` returned `## PHASE SPLIT RECOMMENDED` (~13 plans / 11 near-sequential waves against a
> `standard` granularity of 3–5) and the developer chose the split. Read **Phase 01.6.2's section
> first** — the reversal record, the quantified basis and the shared criteria are there, and Phase
> 01.6's section above that for the C1–C10 register.
>
> **This is a sub-phase, not a restored Phase 01.5.** Phase 01.5's own entry stays an `ABSORBED` stub
> and never returns to the roadmap; this phase is where its *defect fixes* land — still in
> TypeScript, still after the new machine exists, per **D-02**.
>
> **No artifacts of its own.** It shares Phase 01.6.2's `CONTEXT.md`, `RESEARCH.md`, `PATTERNS.md`
> and `VALIDATION.md` unchanged, exactly as Phase 01.6's four artifacts serve all four of its split
> groups. Read them from
> `.planning/phases/01.6.2-the-one-process-host-broker/`. **`01.6.2-CONTEXT.md` governs where it and
> this section disagree.**

**Goal**: The broker's five lifecycle-policy defects are fixed rather than translated — each as its own labelled task with its own test — Phase 01.5's seven criteria are dispositioned one by one against real work rather than deleted, and the phase closes by itemising every claim neither 01.6.2 nor this phase could verify live into the carry-forward list Phase 01.4 must discharge

**Depends on**: Phase 01.6.2 (it builds the machine these are policy for; five behaviour changes against a process that does not exist yet is not a plannable phase). **One hard task-level dependency inside that**: criterion L's non-preemptive launch-priority change (D-07) must not be written until 01.6.2 criterion C's concurrency race test is green, so a failure has one candidate cause.

**Owns from Phase 01.6's criteria register**: nothing — the register items are all discharged by 01.6.2 and its siblings. This phase's bar is criteria E, L and M, inherited from 01.6.2 on the split.

**Scope**: the five lifecycle-policy changes of `.planning/notes/vice-broker-lifecycle-decisions.md` (CONTEXT D-05…D-11); Phase 01.5's absorbed defect scope and its seven-criteria disposition (D-02); and criterion E's Phase 01.4 carry-forward list into `01.6.2-VALIDATION.md` (D-19…D-22). **Nothing in the transport, the state design or the test-suite redesign** — those sealed with 01.6.2.

**This group's own success criteria** (criteria E, L and M, inherited from Phase 01.6.2 on the 2026-08-03 split — lettering preserved deliberately so every existing cross-reference to "01.6.2 criterion L" still resolves):

  E. **Correctness is claimed against specification, not against the bash — and the unverified set is itemised and owned.** With the protocol replaced there is no old behaviour for most of the 01.6.2/01.6.2.1 deliverable to be equivalent to, so "a green suite proves language and structural equivalence" is retired as the frame. The genuinely-unchanged set is named separately and held to real equivalence: the emulator data plane, the `epoch.json` contract, the agent-facing tool surface. **No live-session verification exists until Phase 01.4**, so every host-side and session-shaped claim **from both phases** is itemised in `01.6.2-VALIDATION.md` as a carry-forward list that **Phase 01.4 owns and must discharge**. This lands last and covers both phases; that is why it moved here rather than sealing with 01.6.2.

  L. **The five lifecycle-policy changes land as five explicitly-labeled tasks, each with its own test.** Never blended into a generic "convert `vice-broker.sh`" line item — and now never blended into 01.6.2 either, which is what the split bought. Warm floor defaults to 1 with the knob still honouring N; the floor is evaluated over probe-live instances with a failed probe both dropping the record and identity-verified-killing the pid; launch priority is non-preemptive on top of the unweakened `in_flight` lock; request ordering is arrival order on the control connection; `spares` becomes `warm floor` throughout, with `VICE_BROKER_SPARES` breaking cleanly. Rationale and per-change proofs: `01.6.2-CONTEXT.md` D-05…D-11. **D-11 requires separate commits per change**, and **D-10's rename is its own commit** — a squashed landing defeats the point of five labelled tasks.

  M. **Phase 01.5's seven criteria are discharged or explicitly carried — and the plan shows which, per criterion.** This is the gate on absorbing 01.5, not a formality: deleting a phase without it is how a defect gets silently lost. **Phase 01.6.2 does not discharge them, so this phase's verification is where absorbing 01.5 actually seals.** D-02's four-defect mapping must also be shown explicitly: Defect 1 (parallel warming kills `x64sc`) is *preserved*, not re-fixed; Defect 2 (stale `usage()` text) is dissolved by the rewrite in 01.6.2; Defect 3 (grants outlive their process) is D-05; Defect 4 (proxy caches a dead grant for the session's life) is D-13, which landed in 01.6.2.

  **The two items the 2026-08-03 discussion left unsettled — both now have a proposed disposition from plan-time analysis, and this phase must either adopt or overrule each in writing:**

  - **01.5 criterion 4 (lazy-replenishment R1/R2 cap semantics) — proposed: *dissolved by D-06*, not deferred.** At `warm floor = 1` with kill-never-recycle, R1 (*"launch a replacement only if zero ready remain"*) and R2 (*"only if `total < N`"*) collapse into the single predicate the floor evaluation already computes — `probe-live ready < floor` — so there is no separate replenish policy left to specify, and the `N + outstanding_leases` overshoot is structurally impossible. The cap becomes `floor + outstanding_grants`, bounded by `VICE_BROKER_MAX` (untouched, D-06). Record it as dissolved-by-D-06 with that reasoning, or overrule it.
  - **01.5 criterion 6 (`GRANT_POLL_TIMEOUT_MS` headroom) — proposed: the constant *ceases to exist*.** Under D-01 acquire is a request/response on an already-open connection, so there is no grant to poll for; `GRANT_POLL_TIMEOUT_MS` and `GRANT_POLL_INTERVAL_MS` die with `pollGrant()` in 01.6.2. What replaces it is a **connection-level acquire deadline**, which must be set with spike-003's ≥150 s tool-call budget in view and the measured ~0.65 s boot as the expected case. If adopted, **close the standalone todo `2026-08-01-raise-grant-poll-timeout-to-match-measured-tool-call-budget.md` as dissolved** rather than leaving it pending against a deleted constant.

**Risks**: **The split's whole value is the seal boundary, and it is only real if this phase actually verifies** — a phase that seals on "the five tasks exist" rather than "each has a passing test" gives back exactly what the split bought. **Nothing here is live-verifiable either**, so criterion E's carry-forward list is this phase's most load-bearing deliverable, not its cleanup step. **The cross-phase ordering constraint is easy to lose across a phase boundary**: D-07 depends on a test that lives in 01.6.2's plans, so it must be a stated prerequisite in this phase's plan text and not an assumption that 01.6.2 sealed green. **Criterion M is where a defect gets silently lost if the disposition is treated as paperwork** — the two unsettled items above are the specific place that happens, and both arrive with a proposed answer precisely so "not settled" cannot quietly become "not addressed".

**Plans:** 6/6 plans executed

Plans:
**Wave 1**

- [x] 01.6.2.1-01-PLAN.md — **Tracer.** Defect 5 closed: `handleAcquire()` consults the warm floor end to end, re-probes the instance at grant time, drops-and-identity-verified-kills a failed candidate, walks the remainder and only then cold-launches — proved by a red-first unit test **and** an e2e test against the real spawned broker, plus a structural gate over the single grant-recording call site (criterion L, P-01…P-04, P-10)

**Wave 2** *(blocked on Wave 1)*

- [x] 01.6.2.1-02-PLAN.md — The probe collapsed to exactly one in-process mechanism whose answer requires evidence the emulator replied; the mechanism union, resolver, external-command branch, its env var, the unconditional-ready branch and the warm-zero conditional all deleted; timeout default 5 s → ~1 s; four retiring tests named with reasons; the e2e suite migrated onto a probe-answering stub emulator; **the P-05 amendment to locked decision D-05 on the record** (criterion L, D-05, P-05…P-07)

**Wave 3** *(blocked on Wave 2)*

- [x] 01.6.2.1-03-PLAN.md — Warm floor default 3 → 1 with the knob still honouring N, proved by a test that **reads the default** and demonstrably fails against 3; non-preemptive launch priority on the **unweakened** in-flight lock, citing 01.6.2 criterion C's green race test (verification truth #9) as its stated prerequisite and re-running it first; and D-08's direct arrival-order FIFO assertion plus a comment-stripped structural gate that the queue region cannot be re-ordered — the queue itself untouched (criterion L, D-06, D-07, D-08, D-20)

**Wave 4** *(blocked on Wave 3)*

- [x] 01.6.2.1-04-PLAN.md — The acquire deadline's default 25 000 → 120 000 ms, with `.mcp.json`'s vice timeout raised 60 000 → 150 000 in the same commit so the landed ordering-invariant test passes **unedited**, and the never-started fail-fast bound re-anchored from a fraction of the deadline to an absolute value; 01.5 criterion 6 adopted and its todo closed as **done-on-the-successor**, overruling the ROADMAP's proposed "dissolved" wording (criterion L/M, P-08, P-09)

**Wave 5** *(blocked on Wave 4)*

- [x] 01.6.2.1-05-PLAN.md — **The rename, one commit, the phase's last code commit.** `spares` → `warm floor` on every remaining surface including the on-disk `spares_target` → `warm_floor`; `VICE_BROKER_SPARES` → `VICE_BROKER_WARM_FLOOR` as a clean break with no alias or fallback; the D-25 banner naming the retired variable as set-and-ignored; a structural gate keeping the break clean (criterion L, D-10, D-11, D-25, P-11…P-13)

**Wave 6** *(blocked on Wave 5)*

- [x] 01.6.2.1-06-PLAN.md — **Criteria M and E.** All seven of Phase 01.5's criteria dispositioned one by one with a decision ID and named evidence; the **five**-row defect mapping and its todo closed on that gate; criterion E's equivalence framing **replaced** not annotated with the genuinely-unchanged set named separately; D-20's per-change proof table; and criterion E's **carry-forward list** into `01.6.2-VALIDATION.md` — mechanically harvested, stable `CF-01.4-NN` IDs, a concrete discharge route per row, both phases covered, **Phase 01.4 named as owner** (criteria E/M, D-02, D-19…D-22, P-05, P-09, P-10)

**Waves:** strictly sequential, 1 → 6. **Deliberately no parallelism**, and one place where it was available and declined: plans 03 and 04 have disjoint source files (`broker-launch.mts`/`vice-broker.mts` versus `vice-broker-client.ts`/`.mcp.json`, and `vice-broker-client.ts` is not host-bound so plan 04 touches no generated artifact), so they could have shared a wave — but both append to the append-only findings log, which is the same forced-ordering cause 01.6.2's waves 12–14 recorded. Recorded so a future reader does not read wave 4 as a missed parallelism. Every other ordering is a real `files_modified` overlap.

**Planning note (2026-08-04, `/gsd-plan-phase 01.6.2.1`).** **Six plans against a `standard` granularity of 3–5**, and the overage is criterion L's own arithmetic rather than scope creep: L mandates six explicitly-labelled behaviour tasks each with its own test and its own commit, D-11 forbids blending them, P-12 pins the rename to its own last commit, and criteria E and M are two further deliverables that must land after all of it — seven code commits plus three documentation commits at 2–3 tasks per plan is six plans at minimum. **No split is recommended: this phase *is* the split**, and its scope was not enlarged. Tracer-first: plan 01 leads with a `type="tracer"` slice through the acquire path, which is also criterion L's sixth task, so tracer ordering and locked ordering did not conflict there. **One ordering conflict did exist and is resolved in writing** (plans 05 and 06 both state it): P-12's literal *"last commit of the phase"* is not satisfiable alongside criteria E and M, so the rename is the last **code** commit and plan 06 commits only `.planning/` files after it — P-12's deciding mechanism (*"backing it out is one revert"*) is preserved exactly, since a revert of the rename drags nothing in plan 06. Reversibility: **no `one-way` ratings and no decision checkpoint owed** — CONTEXT already rates P-05 reversible, P-06 costly and P-11 costly, and P-12 *is* the mitigation for the only costly-to-reverse decision here; those ratings are honoured, not re-derived. Security: `<threat_model>` in all six plans, ASVS L1, blocking on high, **27 threats** (T-01.6.2.1-01 … T-01.6.2.1-27) plus a supply-chain row per plan; the credible surface is pid/process handling, the loopback control plane and environment-variable handling, not web input validation. No package installs, so no legitimacy gate fires. **API-coverage detector run and returned `detected: false`** — no external API is integrated, so no coverage matrix is owed. **Assumption-delta detector run and returned `detected: true`** with one `pluralization` signal on the word *"also"* in this section's own prose — a false positive; the genuine identity-model delta is the code-level one plan 01 records as `promote` (a grantable instance becomes primary, cold launch becomes one of two ways to obtain one, leaving exactly **one** grant-recording call site so a future third arm cannot reintroduce Defect 5 invisibly). **Spec-less probe fallback skipped, visibly** — no SPEC and no requirement IDs to probe, so no probe-derived predicates exist in this plan set and none were fabricated; `requirements:` frontmatter carries criteria letters, CONTEXT decision IDs and defect identifiers. **Three plan-time findings no source artifact records.** (1) Raising the acquire deadline to 120 000 **breaks a landed passing test** — `vice-proxy.test.ts` reads `.mcp.json`'s vice `timeout` (currently **60 000**) and asserts the deadline is strictly less than it, so the client's side must move to 150 000, a figure spike-003 measured as returning a real result; P-08's *"headroom under the ≥150 s budget"* reasoning assumed the client default applied, but this repository pins its own. (2) The same file's never-started fail-fast bound is *half the acquire deadline*, so the raise would silently move it from 12 500 ms to 60 000 ms — past the surrounding 10 000 ms read deadline, making a fail-fast assertion unfalsifiable; re-anchored to an absolute value. (3) The landed e2e warm-floor supervision test **depends on the external-command probe** P-06 deletes, so the collapse would have turned it red rather than merely simplifying it; plan 02 owns migrating it, and plan 01's own e2e test, onto a probe-answering stub emulator (`VICE_BIN` a listening stub with `VICE_ARGS` left **unset**, so `buildViceArgs()` takes its port-constructing branch). **Fourth finding, on criterion E's harvest:** CONTEXT's calibration of *5 `verification: backstop` truths across the fifteen SUMMARY frontmatters* is **exactly right for SUMMARY files and incomplete as a harvest** — those 5 hits sit inside `deviations[].rationale` prose describing 8 claims, while the truths themselves live in the **PLAN** frontmatters, where there are **23**; decisively, `01.6.2-VERIFICATION.md` names plans 12–14's three backstop truths, which appear in **zero** SUMMARY frontmatters. The harvest is therefore refined to the **union** of plan and summary frontmatters across both phases — a strict superset, so nothing is narrowed — for an expected **35** rows (23 + the medium-confidence control-port item + this phase's own **11**, counted from the authored frontmatters). The discrepancy is recorded rather than smoothed.

### Phase 01.6.3: `@mastra/mcp` Adoption

> **Split out of Phase 01.6 on 2026-08-02, and deliberately placed last** — PATTERNS.md's explicit
> recommendation: convert `vice-proxy` hand-rolled first, then swap the seam in isolation, so 2,100+
> lines of project logic do not need re-verifying at the same time as a new dependency lands.

**Goal**: The generic MCP/JSON-RPC plumbing in the proxy is served by `@mastra/mcp` instead of being hand-rolled, with the project-specific ~88–94% working unchanged and the capability surface decided rather than defaulted

**Depends on**: Phase 01.6.2 (and transitively 01.6.1 — the proxy must already be TypeScript and green before its transport seam is swapped)

**Owns from Phase 01.6's criteria register**: C3 (the host clause — the host needs `node` and never `tsc` or `npm`).

**This group's own success criteria**:

  A. **D-01 — `@mastra/mcp` is adopted.** *(Developer decision, 2026-08-02, taken against RESEARCH.md §B6's HIGH-confidence recommendation to keep the proxy hand-rolled. The recommendation was read, priced and overridden; recorded so a later reader sees a choice, not an accident.)* The seam is the ~150–300 lines of generic plumbing near the top of `vice-proxy.mjs` — `writeMessage()`, `respond()`, `errorResponse()`, `handleInitialize()`, and the `handleToolsCall()` routing skeleton. PATTERNS.md cuts it by function name and line.

  B. **The ~88–94% that no SDK touches keeps working.** Broker leasing, epoch/liveness (`currentEpoch()`, `epochChanged()`, `checkEpochAndRebaseline()`), `handleRecycle()`, `handleDiagnose()`, wedge evidence gathering, deny-list enforcement, `rewriteArguments()`, incident capture, and the ten agent-facing broker-absent/dead/launch-failed message strings Phase 01.4 named. The 4,370-line proxy test suite is what proves the swap.

  C. **`COVERAGE.md` enumerates `@mastra/mcp`'s capability surface with a decision on every row.** `INTEGRATE` is the default and the matrix is the subtraction record; **every `OPT-OUT` carries a one-line reason.** Expect most rows to be `OPT-OUT` — this project has no Mastra primitives to expose — and each still needs its reason. A missing or malformed matrix **blocks the phase seal** at `verify:pre`.

  D. **D-06 — whether to bundle is decided here, not assumed.** *(Deferred to this group by the developer, 2026-08-02.)* The planner established that CONTEXT D-01's original premise was factually wrong: `install-resources.mjs` deploys only `resources/`, and `vice-proxy.mjs` **never reaches the host** — so criterion 3's host clause is satisfiable without a bundler, via VALIDATION.md's own stated check (no file under `resources/` imports a bare specifier outside `node:*`; the deployed artifact runs under bare `node` with no `node_modules`). What bundling actually protects is **container-side**: today the vice MCP server starts with zero dependencies, so a fresh clone works on bare `node`. A runtime `@mastra/mcp` dependency ends that — **the agent loses all emulator access on a clone that has not run `npm install`.** Decide deliberately: bundle and keep the property, or drop it and wire `npm install` into provisioning. Either is defensible; leaving it undecided is not.

  E. **Package legitimacy is verified before install, as a blocking human checkpoint.** `@mastra/mcp` (453 K/wk) and `@mastra/core` (1.36 M/wk) were both flagged `[SUS]` by the legitimacy audit on a weak "too-new" heuristic. Non-auto-approvable.

**Plans:** 4 plans

Plans:

- [ ] 01.6.3-01-PLAN.md — Legitimacy gate (pre-answered by `01.6.3-APPROVALS.md`), exact-pinned install, D-06 decided against the real 69 MB/35-dependency figure (provision via devcontainer `npm ci`, do not bundle), telemetry non-import structural guard (criteria D, E)
- [ ] 01.6.3-02-PLAN.md — **Tracer.** Swap the wire layer for `@mastra/mcp`'s `MCPServer`; `vice_ping` + the three synthetic tools proven end-to-end; the deny-list preserved by a `CallToolRequestSchema` override installed immediately after `startStdio()` (criteria A, B, C3)
- [ ] 01.6.3-03-PLAN.md — Full expansion: every remaining manifest tool registered through the same generic mechanism; `tools/list` full parity proof; `COVERAGE.md` re-confirmed against shipped code (criteria A, B, C)
- [ ] 01.6.3-04-PLAN.md — Full regression repair of the ~5,300-line proxy test suite, every wire-level difference disclosed; rollback path documented; phase close-out with zero `resources/` drift (criteria B, C3)

**Wave 1** — 01.6.3-01 · **Wave 2** — 01.6.3-02 · **Wave 3** — 01.6.3-03 · **Wave 4** — 01.6.3-04. Strictly sequential: every plan after the first modifies `vice-proxy.ts` and/or its test file, so same-wave parallelism is impossible by file ownership.

**Risks**: This is the first runtime dependency this repository has ever had — `@mastra/core` is ~59 MB unpacked across 33 direct dependencies, and it is an agent-orchestration framework whose `MCPServer` exists to expose *Mastra's own* agents and tools. Research rated the fit a mismatch. Reversible, but only by re-hand-rolling the seam — rated **costly**, not one-way.

---

### Phase 01.7: The TCP Control Plane — **ABSORBED INTO PHASE 01.6.2**

> **ABSORBED 2026-08-03, via `/gsd-discuss-phase 01.6.2`.** This phase no longer runs. The developer
> stated the requirement directly during that discussion — *"requests//leases//denials//recycle-acks/
> non of them shall exist, all … shall go over tcp to the broker"* — which is this phase's specified
> content, and chose to land it inside 01.6.2 rather than after it.
>
> **The section is kept, not deleted**, so every reference to Phase 01.7 in commits, design notes and
> prior CONTEXT files still resolves — including `01.6-CONTEXT.md`'s deferred list and the
> `01.6.2` criterion B text that pointed here. Decisions: `01.6.2-CONTEXT.md` D-01, D-12…D-18.
>
> **This reverses the 2026-08-02 split that created this phase**, whose own rationale is preserved
> verbatim below. That rationale — *"convert first only means something if the conversion is
> separable from the protocol change"* — and the loss of both ordering dependencies were put in front
> of the developer before the decision was taken. Recorded as a reversal per the D-03 precedent.
>
> **Criteria disposition — all eight, so none is lost:**
>
> | 01.7 criterion | Where it lands in 01.6.2 |
> |---|---|
> | 1 — the lease is the connection; six file mechanisms retire together | Criterion F / CONTEXT D-12 |
> | 2 — bootstrap stays a file, liveness answerable without a connection | Criterion G / CONTEXT D-27 |
> | 3 — the emulator data plane is unchanged | Criterion H |
> | 4 — broker restart reaps unconditionally; the void rides the epoch mechanism | Criterion I / CONTEXT D-15 |
> | 5 — broker death takes the session with it, and says so | Criterion J / CONTEXT D-14 |
> | 6 — two brokers cannot run at once; CR-01 closes | Criterion K / CONTEXT D-17 |
> | 7 — cross-project brokering checked, droppable if not free | **DROPPED ENTIRELY** (CONTEXT D-16). It was explicitly optional as of 2026-08-02; on 2026-08-03 the developer took it out of scope and out of checking. Its standalone todo stays in the backlog. |
> | 8 — the suite passes across the transport change, using live verification | **Folded into criterion E, but weakened and the weakening is the point.** This criterion assumed 01.4 and 01.5 had landed. They have not, so **live-session verification is unavailable** and criterion 8's own instruction — *"do not fall back to treating a green suite as sufficient"* — cannot be satisfied here. 01.6.2 criterion E answers with an itemised carry-forward list that **Phase 01.4 owns and must discharge**. |

**Original split rationale (historical, and the record of what the absorption reverses)**

> **SPLIT OUT OF PHASE 01.6 on 2026-08-02.** Old 01.6 carried four changes at once —
> consolidate three programs into one, change language, centralise state, change transport.
> Its own criterion 15 flagged that as one too many. The developer then chose to land the
> conversion **before** any further work on the files it rewrites, which made the split
> mandatory rather than advisable: "convert first" only means something if the conversion is
> separable from the protocol change. Phase 01.6 is the conversion; this is the protocol.

**Original goal (historical)**: proxy↔broker coordination is one TCP control connection per session whose lifetime *is* the lease, so connection close — including on SIGKILL and including container death — is the release, enforced by the kernel

**Depends on (historical, both dependencies given up by the absorption)**: Phase 01.6 (the application this changes the transport of must exist first) and Phase 01.5 (**the load-bearing ordering rule**: defects are fixed before the protocol changes, so a transport regression has one candidate cause. This is what survives of 01.5's original "fix it in bash first" rationale — the bash is gone, the discipline is not). Phase 01.4 has also landed by now, so live-session verification is available here. **Superseded 2026-08-03: 01.5 is itself absorbed into 01.6.2, so defects and protocol now change together; and 01.4 has NOT landed, so live-session verification is not available. Both costs were stated and accepted.**

**Requirement mapping**: none — tooling phase.

**Design source**: `.planning/notes/broker-control-plane-over-tcp.md` and `.planning/seeds/broker-restart-reaps-and-voids.md`. **Both are promoted from boundary-reading to active design sources for Phase 01.6.2 by the absorption.**

**Success Criteria (historical — retained as the specification 01.6.2's criteria F–K are built from)**:

  1. **The lease is the connection.** Connection open is the claim; connection close — including on SIGKILL and including container death — is the release, enforced by the kernel. `startHeartbeat()`, the mtime-as-heartbeat convention, `file_mtime_epoch()`, `lease_is_stale()`, `sweep_grants()` and the 180 s TTL all retire together. Today's release is one attempted `unlinkSync` inside a measured ~490 ms shutdown window, so a hard kill strands an instance for the full TTL.

  2. **Bootstrap stays a file, so liveness is answerable without a connection.** `broker.json` already carries `pid` and `heartbeat_at`; it gains a port and becomes the discovery record, read once. `readBrokerLiveness()` keeps distinguishing never_started / stale / alive, so `ECONNREFUSED` is never ambiguous.

  3. **The emulator data plane is unchanged.** The proxy still dials the granted port directly, exactly as today. The broker carries control traffic only — acquire, release, recycle, host-state questions — and is never in the emulator path. This is what keeps the change off the hot path and out of the failure mode most correlated with host death.

  4. **Broker restart reaps every instance, and the void rides the existing epoch mechanism.** With the lease in a connection, a restarted broker would otherwise see zero connections, conclude every emulator is free, and hand a live one to a second proxy. Reaping on startup bumps every supervisor's epoch, which `assertSameMachine()` already turns into `MachineRestartedError` — the same discipline already applied to a restarted emulator, with no second notion of "recoverable". The reap must be **unconditional on startup**, not only on clean shutdown, since a SIGKILLed broker never runs its shutdown path.

  5. **Broker death takes the session with it, and says so.** This is an accepted trade, decided explicitly: the MCP reports that the session must be restarted, or acquires a fresh instance where possible. Note this is a *regression* against today, where broker death is survivable — after the grant the proxy's only broker dependency is `touchLease`, whose failure is a silent no-op — and it is accepted knowingly rather than overlooked.

  6. **Two brokers cannot run at once and corrupt each other — CR-01 is closed here.** `01.2-REVIEW.md`'s **CR-01** is an independently-verified **blocker** carried since Phase 01.2: `cmd_start()` goes straight from timestamp to `write_broker_json` and the poll loop with **no singleton guard**, so two concurrent brokers race in `grant_from_spare()` — whose read-then-remove is not atomic across processes — and can hand the same ready spare to two different sessions, violating the per-session isolation Phase 01.2 exists to guarantee. A possibly-connected unexplained port-6510 teardown is recorded as NOT CAPTURED in `01.2-CRITERION-13-EVIDENCE.md` §5/§7, and "a second broker adopting state" is exactly what that would look like. **This phase is where the guard becomes cheap**: a TCP listener on a well-known port cannot be bound twice, so `EADDRINUSE` is a kernel-enforced singleton for free — *if* the port is well-known and `broker.json` is the arbiter of which one it is. Verify that it actually holds rather than assuming it; two brokers on *different* ports are still two brokers, and the bootstrap record has to be what forecloses that.

  7. **Whether cross-project brokering falls out for free is checked and answered — and is droppable if it does not.** Today the broker is workspace-scoped *by construction*: all coordination lives in `<repo>/.vice-supervisor/`, so a second project cannot request, be granted, or lease anything, and the only route is a second broker — which is what makes CR-01 dangerous. A TCP control plane is not workspace-scoped at all: any container that can reach the host bridge and knows the port can talk to it. What remains scoped is the **bootstrap record**, and the whole cross-project question reduces to whether `broker.json` moves to a project-independent root (`~/.vice-broker/` or similar). That is one file, against the six directories of protocol state the standalone todo (`2026-08-01-make-the-broker-cross-project-via-shared-home-dir-state.md`) had to contemplate. **Explicitly optional** (developer, 2026-08-02): if it does not fall out, record that and ignore it — the standalone todo stays in the backlog and nothing here blocks on it. Criterion 11 does *not* inherit this optionality; the singleton guard is required either way.

  8. **The suite passes across the transport change as well, and it is a different suite than 01.6 handed over.** Phase 01.6's criterion 9 proved equivalence for the *language and consolidation* move; this criterion is the same discipline applied to the *protocol* move, against the TypeScript suite 01.6 produced. `--once` and `VICE_BROKER_PROBE_CMD` are the seams every test drives and both stay. Because 01.5 has landed by now, live-session verification is available here in a way it was not during 01.6 — use it, and do not fall back to treating a green suite as sufficient (see Phase 01.4's finding).

**Risks**: **This is the phase where a lease stops being a file and becomes a socket**, so every failure mode changes shape at once: `startHeartbeat()`, the mtime-as-heartbeat convention, `file_mtime_epoch()`, `lease_is_stale()`, `sweep_grants()` and the 180 s TTL all retire together, and anything that quietly depended on one of them fails in a new way. **Broker death becomes fatal to the session** (criterion 5) — an accepted, knowing regression against today, where after the grant the proxy's only broker dependency is `touchLease`, whose failure is a silent no-op. **A restarted broker seeing zero connections concludes every emulator is free**, which is why criterion 4's reap must be unconditional on startup rather than on clean shutdown; a SIGKILLed broker never runs a shutdown path, and Phase 01.6 explicitly accepts leaving emulators running. **Two brokers on different ports are still two brokers** — `EADDRINUSE` is only a singleton guard if the port is well-known and `broker.json` is the arbiter of which one it is; verify that it holds rather than assuming it (criterion 6).

---

### Phase 01.8: Developer Closure & Live Verification

> **INSERTED 2026-08-04 (developer), hand-authored.** `gsd-tools query phase.add` would have
> computed `Phase 8` (max integer + 1) and landed it in v2.0's sequence, and `phase.insert` cannot
> resolve any phase in this ROADMAP — `roadmap analyze` returns `phases: []`, re-confirmed live on
> 2026-08-04, the same defect already filed for the 01.6.2.1 insertion. `roadmap get-phase 01.3`
> resolves correctly, so the read verbs are unaffected and only the write path was bypassed.
>
> **This phase exists so the autonomous run does not stop.** The developer's instruction (2026-08-04)
> is that the remaining v1.1 phases are driven without check-ins, and that anything genuinely needing
> them collects here instead of blocking. It is therefore **the only phase in v1.1 that is allowed to
> be a container for other phases' unfinished business**, and it is deliberately last.

**Goal**: Every v1.1 claim that only the developer can settle is settled — the host-side backstop truths observed live, the two `@mastra` packages approved or rejected, D-06 decided, the carry-forward list discharged and 01.3-06's human-verify gate answered — and the work each answer unblocks is completed inside this phase, so v1.1 closes with nothing still carried

**Depends on**: every other v1.1 phase (01.6.2.1, 01.6.3, 01.4, 01.3). It runs last by construction: its content is what those phases could not close without the developer.

**Requirement mapping**: none — tooling phase, matching 01.1/01.2/01.3/01.4.

**The HV register.** Each row names what it blocks, what the developer does, and what the agent completes once answered. **The last field is the point of the row** — a gate whose downstream work is not named is a gate that gets answered and then forgotten.

| ID | Blocks | Developer action | Completed by agent after |
|----|--------|------------------|--------------------------|
| ~~**HV-01**~~ | ~~01.6 sealing at 14/14; 01.6.1 UAT test 3~~ | **CLOSED 2026-08-04** — developer started the host launcher | ✅ **Satisfied by direct record read, no forwarded call needed.** `.vice-supervisor/broker.json` live: `node_version: "v22.22.0"` **present**, `written_by: "vice-broker.mjs"` (not the 2,103-line `vice-broker.sh`), `heartbeat_at` present and advancing on a 60 s cadence (so a real broker with a poll loop, not the 190-line tracer), plus a live TCP control plane (`control_port: 19510`, token) and 3 warm spares at 6600/6601/6602 each with an `epoch.json` naming a real `x64sc` pid. **01.6 and 01.6.1's shared host-side backstop truth is now observed.** Caveat stated rather than glossed: the running deploy is dated 05:43, which is *post*-01.6.2 (where the field was to arrive) and *pre*-01.6.2.1 — which does not weaken the closure, since every HV-01 ask is a 01.6.2-era fact and even the 05:43 build is the `.mjs` broker |
| ~~**HV-02**~~ | ~~All of 01.6.3 downstream of the install~~ | **PRE-DISCHARGED 2026-08-04** — approved, then re-confirmed after the telemetry disclosure | ✅ Recorded in `01.6.3-APPROVALS.md` as **two separate approvals**, because the first was given before the `posthog-node` finding existed. Pinned exact: `@mastra/mcp@1.15.0` + `@mastra/core@1.55.0`. The gate stays authored `blocking-human` — pre-answered, not weakened. **Telemetry resolved as a non-issue by evidence:** `posthog` appears only under `@mastra/core/dist/telemetry/`, `./telemetry` is a separate export subpath, and none of the **nine** core subpaths `@mastra/mcp` imports references it — so 01.6.3 asserts non-import structurally rather than trusting `MASTRA_TELEMETRY_DISABLED`, which upstream [#7813](https://github.com/mastra-ai/mastra/issues/7813) reports as not working |
| **HV-09** | Phase 01.4 criterion 3's **live** confirmation — the phase is `human_needed` solely on this | **Start a genuinely new top-level session**, then tell me to call `mcp__vice__tools_list` and `mcp__vice__tools_call` (benign nested name only) | The generic-dispatch deny-list closure is **code-verified**: `DENY_LIST` extended, both enforcement seams read directly, unit tests prove zero real requests escape, and all three sites confirmed tool-name scoped so the MCP handshake is untouched. What is missing is a live observation from a session whose schema snapshot **postdates** the fix. Every proxy process in the session that did this work predates it, so its own self-report still lists the meta-tools — that is a stale snapshot, not a failed closure. **No subagent dispatch can settle this**, including the verifier's own. ⚠ Never use `vice_disk_list` as the probe: that call *is* the hazard |
| ~~**HV-07**~~ *(CLOSED — emulator access proven live)* | **Every forwarded `mcp__vice__*` call — total loss of emulator access.** Therefore HV-04 and HV-06 too | **Restart the vice MCP server (or start a fresh session), then tell the agent to re-ping.** This is also the decisive next diagnostic step | `vice_ping` returns "the broker appears to be dead or hung" against a **demonstrably live** broker (heartbeat advancing `19:57:24`→`19:59:24`→`20:01:24`, 3 spares up, `BROKER_STALE_MS` = 180 000 vs a 15 s heartbeat age). Ruled out: timing transient, cached negative, threshold regression, competing record, clock skew — all documented in the todo. The running proxy started **13:23**, six hours before the broker, and predates plan 04's edits to `vice-broker-client.ts`/`.mcp.json`. If a fresh proxy reports `alive`, the real bug is that a long-lived proxy cannot see an on-demand broker that starts after it; if it still reports `stale`, the liveness comparison itself is wrong and the 05:43 deploy is the suspect. Filed: `.planning/todos/pending/2026-08-04-proxy-reports-a-live-broker-as-stale-blocking-all-emulator-access.md` |
| **HV-08** | Any **live** verification of 01.6.2.1's five lifecycle-policy changes | Re-run the installer to refresh host `tools/`, then restart the broker so it loads the new code — **the restart kills the 3 warm spares and any granted instance, so it is deliberately your call** | The host deploy is stale: `tools/vice-broker.mjs` and `tools/broker-launch.mjs` **differ** from committed `resources/` and are dated 05:43, hours before 01.6.2.1 merged. The live record proves it — `"spares_target": 3`, both the pre-rename key *and* the pre-change default, where 01.6.2.1 renamed it `warm_floor` and defaulted it to 1. Until then, anything verified live exercises the **pre-01.6.2.1** broker, and I will label it that way rather than claiming the new code was exercised |
| ~~**HV-03**~~ | ~~01.6.3 criterion D~~ | **DISSOLVED 2026-08-05 — decided by measurable cost, so it never became yours** | ✅ D-06 taken in 01.6.3's plan 01: **provision, not bundle** — `npm ci --prefix .claude/mcp/vice` wired into the devcontainer's `postCreateCommand`. The row existed in case the decision turned on developer *preference*; it turned on cost, so taking it here was correct rather than a quiet grab. Grounds: `vice-proxy.ts` is not host-bound (it runs in-container on Node's native TS stripping, no build step), so D-06 only ever concerned the container's clone-and-go property; bundling would mean committing ~69 MB / 35 dependencies of third-party minified code as authored source plus a bundler toolchain this repo has never needed. **Disclosed cost:** a bare clone that bypasses devcontainer provisioning now fails until `npm ci` runs once. That cost proved itself the same day — after wave 1 merged, `main`'s `node_modules` lacked `@mastra/*` and one telemetry test failed until `npm ci` ran |
| **HV-04** *(mostly discharged)* | 01.4 criteria 1–4 | **Already provided — you started the launcher 2026-08-05 and live access now works** | ⬤ **Criterion 1 partially discharged live**, recorded in `01.4-LIVE-EVIDENCE.md`: all three synthetic tools are present in a real session (against a recorded state of *"the session still cannot see them"*), and **`vice_diagnose` actually executed** — `verdict: restarted`, epoch 1 → 2. `vice_recycle` is deliberately **not** probed (destructive: proving it by probing destroys a healthy instance) and `vice_result_continue` needs a continuation token from an oversized result, so both are honestly unproven rather than inferred from presence. **Criterion 3 split:** named path holds (`vice_disk_list` absent from the surface); the generic path still exists (`tools_call`/`tools_list` both present) and its `tools_list` probe is deferred to 01.4's plan — `tools_call` with that name must never be the probe, since that *is* the hazard. **Criterion 4** (subagent schema) not probed. **Nothing further needed from you here** — the remainder is mine, once 01.6.3 stops rewriting the files 01.4 points into |
| **HV-05** | 01.3-06 (`gate="blocking"`, `01.3-06-PLAN.md:259`) and therefore 01.3's seal | Read the phase records and confirm no criterion was reworded to fit its outcome (threat T-01.3-20) | Nothing — **this row is structurally unautomatable.** It is a check on the agent's own honesty, so the agent cannot be the one to answer it |
| ~~**HV-06**~~ *(discharged)* | The `CF-01.4-NN` carry-forward rows (01.6.2.1 plan 06, ~35 expected) that 01.4 cannot discharge container-side | Same live-broker access as HV-04, once | Walk the carry-forward list row by row and mark each discharged or permanently unverifiable, with the reason |
| **HV-07+** | *(open)* | *(appended during the autonomous run)* | Any blocker the run hits is appended here with these same four fields, never dropped and never answered by inference |

**Success Criteria** (what must be TRUE):

  1. **Every HV row carries a dated developer answer.** No row is closed by inference, by "presumably approved", or by the agent deciding the answer was obvious. A row the developer *declines* is recorded as declined with its consequence named — that is a closed row, not an open one.

  2. **Every downstream item an answer unblocks is completed in this phase.** This is where carrying stops. A phase that answers six gates and defers their consequences to a Phase 01.9 has reproduced the problem it was created to solve.

  3. **Rows added during the autonomous run are indistinguishable in quality from the six authored here.** Same four fields, same specificity. A row reading "01.4 needs live verification" is a failure of this criterion; HV-04's wording is the bar.

  4. **v1.1's per-phase seals are re-read after the answers land, not assumed to still be accurate.** 01.6, 01.6.1 and whichever of 01.6.3 / 01.4 / 01.3 sealed with carried items each move to fully verified or state exactly what remains and why.

  5. **The autonomous run's deferral decisions are auditable.** Every criterion that was marked CARRIED rather than verified names its HV row, so the developer can see what was routed here and — more importantly — what was *not* routed here and closed for real.

### Register status, 2026-08-05 close-out

| Row | State | Settled by |
|---|---|---|
| HV-01 | **CLOSED** | live `broker.json`: `node_version` present, `written_by: vice-broker.mjs`, heartbeat advancing |
| HV-02 | **PRE-DISCHARGED** | two dated developer approvals, packages installed exact-pinned |
| HV-03 | **DISSOLVED** | D-06 turned on measurable cost, not preference — decided in 01.6.3 plan 01 |
| HV-04 | **mostly discharged** | criterion 1 partially proven live; remainder folded into 01.4's own verification |
| **HV-05** | **OPEN — developer** | 01.3-06's honesty gate. Structurally unanswerable by any party that authored the work |
| HV-06 | **discharged** | 01.4-05's 35-row walk: 12 discharged / 11 blocked-on-HV-08 / 12 permanently unverifiable, zero `open` |
| HV-07 | **CLOSED** | the bind-vs-connect dial fix; `vice_ping` → VICE 3.10 / C64SC end-to-end |
| **HV-08** | **OPEN — developer** | host `tools/` deploy is stale (05:43, pre-01.6.2.1). Blocks 11 carry-forward rows. Restart kills warm spares, so it is deliberately not taken unasked |
| **HV-09** | **OPEN — developer** | 01.4 criterion 3's live confirmation needs a session whose schema snapshot postdates the fix. No subagent dispatch can settle it |

**Three rows open, all genuinely developer-owned, and none of them a deferral of work that could have
been done here.** HV-05 is a check on the author's own honesty; HV-08 is destructive to running state;
HV-09 needs a process this run cannot create. The register's stated purpose was that the cost of each
answer be visible before the developer sits down — that holds: two are single actions, and HV-05 is a
read of four named records.

**What the register got right, worth keeping for the next milestone.** Five of the nine rows closed
*without* the developer, and three of those (HV-03, HV-06, HV-07) closed because the row forced someone
to name the blocker precisely enough to discover it was not actually developer-gated. HV-07 in
particular was filed as a blocker and turned out to be a one-line address bug. **The failure mode the
risks section named — filing things here instead of thinking harder — was real, and the discipline that
caught it was requiring each row to name what it blocks and what completes after.**

**Risks**: **Deferral becomes a habit if it is not policed, and this phase is the instrument that would make it easy.** The whole point of routing blockers here is to keep the run moving; the failure mode is five phases sealing "implemented, unverified" and handing the developer a wall of un-triaged gates. Criterion 1's dated-answer requirement and the register's *"Completed by agent after"* column are the mitigation — the cost of each answer is visible before the developer sits down. **A rejection at HV-02 invalidates 01.6.3's plans, not just its execution** — that phase would need re-planning around the hand-rolled seam, which is exactly what `01.6-RESEARCH.md` §B6 recommended at HIGH confidence before D-01 overrode it. Cheaper than installing 59 MB of agent-orchestration framework on a weak heuristic, and the reason the gate is blocking. **HV-05 cannot be discharged by the agent under any circumstance**, so an autonomous run that reports 01.3 fully sealed has either skipped it or answered it dishonestly; treat that as the tell.

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
| v1.0 | 1. Recovery & Provenance | 4/6 | In Progress|  |
| v1.0 | 01.1. Tool-Mediated Emulator Access (INSERTED) | 4/4 | In Progress|  |
| v1.0 | 01.2. On-Demand Broker & Leasing (INSERTED) | 5/5 | In Progress|  |
| v1.0 | 2. Coverage, Hazards & Memory Map | 0/5 | Not started | - |
| v1.0 | 3. Verification Harness & Original Baselines | 0/4 | Not started | - |
| v1.0 | 4. Vertical Slice — Sprite & Display Pilot | 0/5 | Not started | - |
| v2.0 | 5. Actors — Movement, Combat & AI | 0/5 | Not started | - |
| v2.0 | 6. World, Audio & Shell + Data Format Validation | 0/5 | Not started | - |
| v2.0 | 7. Complete Source Tree, Bootable Disk & Full-Suite Verification | 0/5 | Not started | - |

**v1.0 progress:** 0/29 plans · **v2.0 progress:** 0/15 plans

*Phase 1.1's count is now real (4 plans, set by `/gsd-plan-phase 1.1`). Phase 1.2's count is now real too (5 plans, set by `/gsd-plan-phase 1.2`) — coincidentally the same as its insertion-time estimate.*

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
