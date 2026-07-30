# Walking Skeleton — Bruce Lee: Reverse Engineering & ACME Reconstruction

**Phase:** 1
**Generated:** 2026-07-30

> The Walking Skeleton is the Phase-1 special case of the tracer. For this project the "application" is not a web app — it is a *forensic recovery pipeline* whose full stack runs from the container, across the MCP boundary, into a host emulator running hostile 1984 code, and back out as committed evidence. The architectural decisions below are what every later phase's vertical slice builds on. Treat this file as a contract, not a scratchpad.

## Capability Proven End-to-End

**One command takes the emulator from a cold hard reset to a committed, byte-identical-on-re-run 65536-byte pure-RAM image of a running cracked Bruce Lee, with the loader-done point recorded as a signal rather than a duration.**

Concretely: `node tools/recover.mjs reproduce danish` exits zero and prints two identical SHA-256 digests.

That single chain crosses every layer the project will ever need — container-to-host path translation, the MCP transport, boot of a faked-directory disk, signal-based synchronisation, bank-scoped reads reaching RAM beneath ROM and I/O, artifact-set assembly, and a determinism proof. Plan 01-01, task 1 is that slice.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Emulator control transport | A single Node module, `tools/vice.mjs`, speaking MCP JSON-RPC to `http://host.docker.internal:6510/mcp` — with a documented fallback of shelling out to `curl` behind the same `call` signature | Success criterion 1 requires that *re-running the recorded procedure* reproduces the dump, and D-09 requires a *scripted* `machine_reset`. Both mean the procedure has to be a runnable command, not an agent transcript. Phase 3's VERIFY-01 independently requires "a replay driver over the `vice_*` MCP tools", so a Node-side client is inevitable in this project; building it here and reusing it there is cheaper than building it twice. Rated `costly`, not one-way: it is one seam every tool imports, swappable without a data migration. The `curl` fallback exists because the research pass verified that exact request shape working from this container. |
| Forbidden-tool guard | A deny-list inside `tools/vice.mjs`, checked *before* request serialisation | `vice_disk_list` crashes the host MCP server and recovery costs a manual host-side VICE restart. A convention in a document cannot be enforced; a guard in the one code path every call must pass through can. |
| Language and dependencies | Node 24, ESM `.mjs`, `node:`-prefixed built-ins only, zero `package.json` dependencies (D-18) | Everything this phase needs — byte diffing, SHA-256, JSON, `.d64` parsing — is trivial with `Buffer` and `node:crypto`. It matches all three existing skills and the planned `verify/runner.mjs`. Python's real advantages (Pillow, the `d64` library, pytest) do not pay off until Phase 4's sprite extraction, and are deferred there as a separate additive decision. |
| Test runner | Built-in `node:test` + `node:assert/strict`, files named `tools/*.test.mjs` | A deliberate, recorded deviation from `01-VALIDATION.md`'s "no framework" line: `node:test` ships with Node and installs nothing, so it costs nothing and keeps the zero-dependency rule. It is applied only to the pure byte math — chunk assembly, anchor search, offset arithmetic, range coalescing, hit attribution — which is precisely where a bug corrupts every downstream provenance verdict *silently* rather than visibly. Emulator-driven steps are verified by their own commands, not by unit tests. |
| Primary data entity | **`release`** — N recovered releases in `recovery/RELEASES.json`, exactly one of which carries `canonical: true` | The assumption-delta check fired on this phase. Promoting `release` to primary and demoting `canonical` to a field is what makes the developer's "plan N-ready, start with 2" decision structural rather than aspirational: adding a disk is one registry entry plus one invocation. `recovery/clean/bruce-lee.bin` survives as a locked path (D-01, success criteria 1 and 5 name it) but is documented and validated as a *projection* of the registry — a byte-identical copy of the canonical release's primary dump. Full reasoning in `01-01-PLAN.md` § `<assumption_delta_decision>`. |
| Unit of recovered evidence | A **set** per dump: `.bin` + `.capture.json` + `.state.json` + `.map.json` — never a lone `.bin` | A release's recovered artifact is plural from the start: the primary RAM image, the chip state that is not in RAM, the range manifest, the capture record, and later zero-or-more supplementary dumps from on-demand-load events. A model assuming one release equals one file breaks on the first event plan 01-04 exists to find. `recovery-schema.mjs validate` enforces the set. |
| Canonical image shape | Exactly 65536 bytes, file offset equal to CPU address, pure underlying RAM at every address including the `$A000`, `$D000` and `$E000` windows (D-01, D-03) | **One-way.** Phase 2's coverage bitmap, Phase 3's checkpoint regions and Phase 4's round-trip diff are all defined as offsets into this file. One rule covers every address, so there is never a "register or byte?" ambiguity, and I/O register *values* live in the chip-state sidecar instead. Chosen by the developer in CONTEXT.md, so recorded rather than re-gated. |
| RAM-under-ROM/IO access | `vice_memory_read(bank:"ram")`, non-invasively, with **no `$01` port write** | Verified live against the real server: `bank:"ram"` returns true underlying RAM beneath both ROM and I/O with zero side effects. D-08's guarded `$01`-write-then-restore fallback stays documented and unexercised. Re-confirmed per release against the actually-running game, because the original verification was taken on an idle pre-boot machine. |
| Synchronisation primitive | Checkpoints, watches and bounded step batches. **Never a wall-clock delay, never a derived millisecond figure** | The standing project constraint, and success criterion 1 explicitly demands the *signal* used rather than a duration. Reinforced by two machine facts: `vice_run_until`'s `cycles` parameter is documented in its own live schema as "not yet implemented", so it is no safety net; and this machine is PAL at roughly 50.125 Hz while the joystick tool docstrings quote milliseconds at 60 Hz, so any docstring-derived timing figure is simply wrong here. |
| Snapshot role | Recorded **by name** (`danish_gameentry_v1`), never as a committed file | Research correction to D-07: `vice_snapshot_save` takes only a `name`, stores under the *host's* `~/.config/vice/mcp_snapshots/`, and no tool exports snapshot bytes into the container. Reproducibility therefore runs through the recorded procedure, which is stronger — it works for someone who does not have the host's snapshot directory. |
| Provenance model | A regenerable machine-generated coalesced range tier plus a hand-written prose tier, in `recovery/PROVENANCE.md`, flowing one direction to `docs/provenance.md` and to inline `; PROVENANCE:` tags | Hand-maintained tables drift the moment a label changes (ARCHITECTURE.md Anti-Pattern 2), and per-byte rows would bury the handful of single-byte patches the requirement exists to surface. Confidence is a function of the count of *independent* releases that agree, so a third release raises confidence through data rather than through a schema change. |
| Directory layout | `disks/` (untouchable evidence) · `recovery/` (derived, regenerable) · `tools/` (Node CLIs) — three trust levels, never collapsed | ARCHITECTURE.md's component split. `disks/` is the only source material in existence; `recovery/` is expected to be regenerated if the recovery method improves; `tools/` is the machinery. Collapsing any two loses the audit trail the preservation-record driver requires. |

## Stack Touched in Phase 1

- [ ] **Tooling scaffold** — `tools/` created with the repository's established CLI shape (shebang, `node:` imports, `die` helper, `VERBS` dispatch, `--json`) and `node:test` wired for the byte math
- [ ] **Boundary crossing** — container path translated through `devcontainer-host-path`, handed to a host-side tool, and accepted
- [ ] **Real read** — all 65536 addresses read out of a running emulated machine with bank scoping
- [ ] **Real write** — a committed 65536-byte binary plus three JSON sidecars and a registry entry, all validated by a runnable schema check
- [ ] **Interactive control** — checkpoint-synchronised joystick input driving real gameplay far enough to exercise the plausible on-demand-load sites
- [ ] **Full-stack run command** — `node tools/recover.mjs reproduce <release>` exercises reset, boot, signal detection, capture, artifact write and determinism proof in one invocation

## Out of Scope (Deferred to Later Slices)

Explicit, so no later phase re-litigates Phase 1's minimalism.

- **Any disassembly, code/data classification, labelling, or ACME source.** Cracker code gets only enough analysis to get past it and to attribute patched bytes. Phase 2 owns the listing; the disassembler choice (`toacme` versus `regenerator2000`) is deliberately not made here.
- **The verification harness, the input-script format, and any checkpoint design.** Phase 3 owns VERIFY-01 through VERIFY-04. Phase 1 leaves the working joystick sequence as plain notes in `recovery/LOADING.md` — a seed for that format, deliberately not half a specification for it.
- **Python, `pip`, `venv`, Pillow, the `d64` library, pytest.** Deferred to Phase 4, where PNG rendering for sprite extraction first makes a second language worth its maintenance cost.
- **`.d64` writing and packaging.** Phase 3's plan 03-01 resolves the writing tool; Phase 7 packages.
- **Exhaustive gameplay coverage.** Phase 1 does bounded play; Phase 2's plan 02-02 re-arms this phase's exact watch set during its mandatory all-chambers trace, so breadth arrives without paying for the expensive play-through twice.
- **The load-event merge rule (D-13).** Left open by choice, because both disks appear to load everything up front. If plan 01-04 finds an event it becomes a checkpoint decision at that moment, and it must be settled before Phase 4 treats the canonical image as its round-trip diff target.
- **Symbolic or instruction-stream diffing as a provenance cross-check.** Needs Phase 2's disassembler decision. `vice_disassemble` covers ad-hoc spot-checks meanwhile.
- **A composite complete-coverage image.** Only if D-13's contingency fires, and only as a clearly-labelled derived artifact whose filename says so.
- **Static depacking of the cruncher, and any Wine-based tooling.** Live-memory recovery sidesteps identifying the cruncher at all; REQUIREMENTS.md scopes static depacking out.

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions.

- **Phase 2** — every byte of the canonical image is classified as executed-code, read-as-data or never-touched, every reachable routine is named, and the reconstruction hazards are catalogued. Consumes `recovery/clean/bruce-lee.bin` plus its `.map.json` as the coverage denominator; re-arms this phase's watch set during the exhaustive trace.
- **Phase 3** — a deterministic replay harness exists and has recorded the original's checkpoint baselines. Reuses `tools/vice.mjs` as `verify/runner.mjs`'s client; consumes the chip-state sidecars for checkpoint design and the snapshot names as start states.
- **Phase 4** — one subsystem (sprite and display) is driven end-to-end through trace, annotation, documentation, extraction, ACME transcription, build and verification. Round-trip byte-diffs every transcribed region against `recovery/clean/bruce-lee.bin`.
- **Phase 5** — the actor subsystems scale out across the proven pipeline.
- **Phase 6** — world, audio and shell scale out; every data-format spec is proven by round-trip.
- **Phase 7** — the listing is completed, source is split to mirror the docs, the bootable `.d64` is packaged, and the full replay suite defines done.
