# Phase 1: Recovery & Provenance - Research

**Researched:** 2026-07-30
**Domain:** Live-memory recovery of a cracked 1984 C64 game via VICE-over-MCP, plus two-image provenance diffing
**Confidence:** HIGH for the VICE MCP tool surface (directly probed, live, this session) and ACME/CLAUDE.md-adjacent facts; MEDIUM for crack-independence evidence (one release externally corroborated, one not yet found); MEDIUM-LOW for anything requiring actual gameplay (untested — no play-through has happened yet)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** `recovery/clean/bruce-lee.bin` is exactly 65536 bytes, file offset == CPU address. Every address cited anywhere in the project indexes it directly, with no offset arithmetic, forever. One-way decision — Phase 2/3/4 all define offsets against this file.
- **D-02:** Ships with a machine-readable range manifest (sidecar JSON) declaring each range's kind — `game` / `loader` / `cracktro` / `io` / `unused`.
- **D-03:** The image holds pure underlying RAM for all 65536 bytes, including `$A000-$BFFF`, `$D000-$DFFF`, `$E000-$FFFF`. IO register *values* are not in the image — they live in the chip-state sidecar. One-way decision.
- **D-04:** Chip state goes in a machine-readable sidecar JSON per dump — raw register reads plus derived facts ($DD00 VIC bank, $D018 screen/charset, 8 sprite pointers, `$01` port value, CPU registers, SID, both CIAs).
- **D-05:** The `.bin` keeps crack-loader and cracktro bytes verbatim, never edited or zeroed. Bucket classification lives in the manifest/ledger, not in the bytes.
- **D-06:** The dump trigger is a PC-reached checkpoint at the game's real entry point, located empirically by stepping/tracing out of the last decrunch stage. Recorded as a single address in NOTES.md. Explicitly NOT a timeout, NOT a last-decrunched-byte write-watch, NOT a loader-exhausted window.
- **D-07:** Committed per dump: `.bin` is the canonical byte artifact; `.vsf` snapshot is committed alongside as the reusable deterministic start state for Phases 2/3, versioned and descriptively named (e.g. `danish_gameentry_v1.vsf`), never `snapshot.vsf`. **Research correction (see Summary/Snapshot section below): the live tool surface has no path-based snapshot export — this decision's `.vsf`-as-committed-file part needs the planner's attention.**
- **D-08:** Non-invasive reads first, guarded fallback. Prefer bank-scoped reads to reach RAM under ROM/IO. A `$01` write is permitted only after the `.vsf` is saved, only on a session that is then discarded, only with the write and restore recorded verbatim in NOTES.md. **Research finding: bank-scoped reads confirmed sufficient live — this fallback likely unneeded, see below.**
- **D-09:** Byte-identical reproducibility is demonstrated, not asserted: run the full recorded procedure twice from a scripted `machine_reset`, commit SHA-256 of each dump plus the comparison result. Divergences recorded, not papered over.
- **D-10:** Mechanical watches are the detector; play merely drives them. Exec-checkpoints over the loader region (must never fire again) plus write-watches on drive/IEC registers and never-populated ranges. Absence of hits is positive evidence.
- **D-11:** Phase 1 does bounded play, not exhaustive: several real chamber transitions, both opponents, death, game over, restart. `LOADING.md` records zero-found plus exactly what was armed and how far coverage got. Same watch set re-armed during Phase 2's exhaustive trace.
- **D-12:** Play is driven by `joystick_tap`/`joystick_set` synchronised on checkpoints and frame position — never wall-clock sleeps. Working input sequence recorded in `LOADING.md` as plain notes, not a `verify/scripts/` artifact.
- **D-13:** Open by choice — whether the canonical image absorbs a found load event is decided in the moment, not pre-committed. Must be resolved before Phase 4 treats the image as its round-trip diff target.
- **D-14:** `PROVENANCE.md` uses coalesced, machine-generated ranges plus a hand-written prose tier. Each row: range, kind, verdict, confidence, evidence. Gap-coalescing tolerance stated explicitly (e.g. "coalesced across gaps < 16 identical bytes"). Per-byte rows rejected; hand-authored ranges rejected.
- **D-15:** Crack-independence evidence (RECOVER-07) is tiered, tiers not equal. Tier 1 = the binary itself (loader style/structure, cracktro credits, surviving release text). Tier 2 = external scene records (CSDb-style, NFO text) — admissible, corroborating, never outranks Tier 1. Every claim names its tier.
- **D-16:** Canonical subject (RECOVER-08) chosen by measurement: whichever image has the smaller CRACKER-PATCH byte footprint inside game-logic ranges wins, both counts recorded in `recovery/clean/README.md`. Tiebreak: contiguous layout, then uncrunched provenance clarity. ARCHITECTURE.md's lean toward `danish` is a hypothesis to confirm/refute, not binding.
- **D-17:** Provenance diff runs at an anchor-proven offset, never assumed. Pick long distinctive byte runs from one image, search in the other, require all deltas to agree. Fall back to per-region offsets if deltas disagree, recorded in the manifest. NOTES.md states the offset and how it was proven.
- **D-18:** Node (`.mjs`) for all Phase 1 tooling — zero install, matches ARCHITECTURE.md and all three existing skills. Python (Pillow/`d64`/pytest) deferred to Phase 4, not installed now.

### Claude's Discretion

- **VICE bootstrap method** — an MCP attach/boot tool vs `snapshot_load` from a pre-captured `.vsf`. **Resolved by this research: an attach/boot tool (`vice_disk_attach` + `vice_autostart`) exists and was confirmed live — see Bootstrap section. Whether it works against these specific disks' faked directories is still an empirical question for plan 01-01.**
- Whether bank-scoped reads can actually reach RAM under ROM/IO — **resolved by this research: yes, confirmed live (`bank: "ram"`) — see Complete RAM capture section.**
- The concrete steps of the shared-VICE reset/clear-checkpoints/reload ritual, and the exact register/range set the D-10 watches cover.
- How the game entry point is located for each image, and whether `saeger` (uncrunched) needs a differently-shaped trigger than `danish`.
- The exact structure of `NOTES.md`, beyond the three things criterion 1 requires (dump trigger, `$01` configuration at dump time, captured address ranges).
- Where the three-bucket partition boundaries (loader / cracktro / game logic) fall.

### Deferred Ideas (OUT OF SCOPE)

- **Load-event merge rule** (D-13) — left open; becomes a checkpoint decision if 01-04 finds a load event. Must be resolved before Phase 4.
- **Python toolchain** (`pip`/`venv`, `d64`, Pillow, pytest) — deferred to Phase 4.
- **A reusable input-script format** — belongs to VERIFY-01 in Phase 3; Phase 1 leaves a working example only.
- **Symbolic/instruction-stream diffing** as a provenance cross-check — needs Phase 2's disassembler decision; `vice_disassemble` covers ad-hoc spot-checks meanwhile.
- **A composite complete-coverage image** — only if D-13's contingency fires, clearly labelled as derived.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RECOVER-01 | Both disk images boot under host VICE through the MCP tool surface via a documented, repeatable procedure that never calls `vice_disk_list` | `vice_disk_attach`/`vice_autostart` confirmed live in the 64-tool surface; `vice_disk_list` confirmed present-but-forbidden by exact name match. Bootstrap procedure against the faked directories is the one remaining empirical test, scoped to plan 01-01. See "Bootstrap" and Pitfall 1. |
| RECOVER-02 | Clean RAM image captured from `danish.d64` post-decrunch, with dump trigger/`$01`/ranges recorded | `vice_checkpoint_add`+`vice_run_until` for the trigger; `vice_memory_read(bank:"ram")` confirmed live for the capture, no `$01` write needed. See "Dump-point detection" and "Complete RAM capture" sections. |
| RECOVER-03 | Clean RAM image captured from `saeger.d64` under the same recorded procedure | Same tool path as RECOVER-02; `saeger.d64` is uncrunched so its entry-point search should be simpler (see Open Question 4). |
| RECOVER-04 | Dump completeness proven by full play-through detecting on-demand loading | `vice_watch_add` on `$DD00` + standing loader exec-checkpoint, per D-10. See "On-demand load detection" section. |
| RECOVER-05 | Both images normalised to same fully-loaded state and base address | Pure Node-side diffing once both `.bin`s exist; D-17's anchor-proving technique needs no emulator tool. See "Normalisation and diffing" section. |
| RECOVER-06 | Every byte range carries a provenance verdict with evidence | `tools/diff-images.mjs` (D-14's coalesced/prose-tier ledger); Tier 1 binary inspection primary. See "Crack-independence evidence" and Code Examples. |
| RECOVER-07 | Crack independence (or common ancestry) determined and recorded | CSDb Tier-2 evidence found for `danish.d64` (Danish Crackers/DC-011/P/Turbocopy-Crunch V2.0); `saeger.d64`'s Tier-2 record not yet found — small bounded task for 01-05. See "Crack-independence evidence" section. |
| RECOVER-08 | One recovered image designated canonical, with the reason recorded | D-16's measured-patch-count rule; no new tooling needed beyond `diff-images.mjs`'s output. |

</phase_requirements>

## Summary

The single biggest open question this phase was framed around — "does an MCP boot/attach tool exist, or must booting go through `snapshot_load`?" — is now closed with direct evidence, not inference. I connected to the project's own VICE MCP endpoint (`http://host.docker.internal:6510/mcp`, from `.mcp.json`) using the documented JSON-RPC protocol and enumerated the live tool surface: **64 tools**, including `vice_autostart`, `vice_disk_attach`/`detach`, `vice_machine_reset`, and a `vice_memory_read` that takes an explicit `bank` parameter. I then used that bank parameter live against the currently-running machine and confirmed, byte-for-byte, that `bank: "ram"` returns the true underlying RAM beneath both ROM (`$E000`) and I/O (`$D000`) — while `bank: "rom"`/`"io"` (and the default/no-bank read) return the banked-in view. This resolves D-08 outright: **no `$01` port write is needed to read RAM under ROM/IO**; the bank parameter does it non-invasively. The RAM-under-ROM/IO bytes I read back also happened to independently confirm PITFALLS.md's previously-unverified claim about C64 power-on RAM being short runs of `$00`/`$FF`, not true garbage (`FFFF00000000FFFFFFFF00000000FFFF` at both `$E000` and `$D000` right now).

The second major finding is a correction, not a confirmation: `vice_snapshot_save` takes only a `name` (and `description`/`include_roms`/`include_disks` flags) — it has **no `path` argument**. Its own tool description states snapshots are stored at `~/.config/vice/mcp_snapshots/` on the **host filesystem**, and a live `vice_snapshot_list` call confirmed that exact path (`/home/henrik/.config/vice/mcp_snapshots`, currently empty). There is no tool in the 64-tool surface that exports a snapshot's raw bytes back through MCP. This means D-07's plan to "commit the `.vsf` alongside the `.bin`" **cannot be done as stated** — a named snapshot is a durable, host-side, name-addressable restore point (reusable across every later phase against this same host installation), but it is not a git-committable artifact. The planner needs to adjust D-07's deliverable set accordingly: `.bin` + `.map.json` + `-state.json` are all real, MCP-returned, workspace-writable artifacts; the `.vsf` becomes "recorded by name in NOTES.md, reproducible by re-running the procedure" rather than a fourth committed file. This is a load-bearing correction — flagging it here so it doesn't surface as a surprise mid-plan.

Third, I found external, Tier-2 corroborating evidence for one side of the crack-independence question (RECOVER-07): CSDb release id 56637 identifies `danish.d64` as a **Danish Crackers** release (DC-011/P), cracked by PMK of Ace Crackings, November 1984, using "**Turbocopy/Crunch V2.0**" — described in a CSDb user comment as a *publicly available* cruncher unrelated to any group called "TCS." That directly bears on the on-disk `TCS-CRUNCH!` banner text PROJECT.md already identified: it is most likely the cruncher tool's own self-identifying string, not a crack-group name. I could not find a corresponding CSDb entry for the `saeger.d64`/SSG/XIDEX release via web search (CSDb's internal search isn't well indexed externally) — this is a small, bounded task to do directly against csdb.dk during plan 01-05, not a blocker now.

**Primary recommendation:** Bootstrap both images with `vice_disk_attach` + `vice_autostart` (falling back to `vice_disk_attach` + scripted `vice_keyboard_type`/`vice_keyboard_petscii` LOAD+RUN keystrokes only if autostart's directory-walk chokes on the faked directories — test both empirically as the very first step of 01-01, cheaply, since both tools already exist). Locate each game's real entry point by single-stepping/backtracing out of the loader with `vice_execution_step`/`vice_backtrace`/`vice_disassemble`, arm a `vice_checkpoint_add(exec=true, stop=true)` there, and treat that checkpoint as the recorded, re-runnable dump trigger. Capture RAM with `vice_memory_read(bank: "ram")` in the largest chunks the transport allows (this returns hex text directly over MCP — no host-path translation needed for output, only for `disk_attach`/`autostart` input paths, which do need the `devcontainer-host-path` skill). Capture chip state with `vice_vicii_get_state`/`vice_sid_get_state`/`vice_cia_get_state`/`vice_sprite_get` (×8) into the JSON sidecar D-04 specifies. Detect on-demand loads with `vice_watch_add` on `$DD00` (CIA2 PRA — VIC bank select bits *and* the serial/IEC lines a bit-banging custom loader would toggle) plus a standing `exec` checkpoint over the loader's own defeated code range (should never refire). Normalise and diff with a `tools/diff-images.mjs` Node script per D-18, anchored per D-17 by searching for long byte runs across both images before trusting any offset.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Disk image boot / loader defeat | VICE (host emulator, via MCP) | — | Only a running 6502 CPU can defeat a custom raw-sector loader and a proprietary cruncher; this is exactly the "run it, don't parse it" strategy the project already committed to. |
| RAM/chip-state capture | VICE (host emulator, via MCP) | Node tooling (container) | VICE is the only thing that can read banked RAM/registers; the container-side Node script only receives, writes, and hashes what MCP hands back. |
| `.d64` directory/BAM parsing | Node tooling (container) | VICE (`vice_disk_read_sector`, read-only fallback) | `vice_disk_list` is permanently forbidden; parsing 35-track/BAM-at-18/0 structure locally in Node is trivial and needs no emulator round-trip. `disk_read_sector` is the sanctioned live-drive-perspective fallback if the on-disk bytes and the emulated drive's view might disagree. |
| Byte diffing / provenance ledger generation | Node tooling (container) | — | Pure data-processing over two already-captured `.bin` files; no emulator involvement once both dumps exist. |
| Dump-trigger discovery (finding the "loader is done" address) | VICE (host emulator, via MCP), driven interactively | — | Requires live single-stepping/backtracing; nothing static can locate this for a crunched, custom-loaded target. |
| Crack-independence evidence gathering | External research (CSDb, web) | Binary inspection (VICE-read strings/loader bytes) | Tier 1 (binary itself) and Tier 2 (scene records) per D-15; both are non-emulator-execution activities. |

## Package Legitimacy Audit

**Not applicable this phase.** Per D-18, all Phase 1 tooling is hand-written Node (`.mjs`) using only Node built-ins (`fs`, `crypto` for SHA-256, no JSON library needed beyond `JSON` global). No `npm install` of any third-party package is planned or needed for RECOVER-01 through RECOVER-08. If a future phase plan for Phase 1 discovers a need for an external package (it shouldn't), re-run the Package Legitimacy Gate before adding it.

## VICE MCP Tool Surface — Verified Live, This Session

**Verification method:** [VERIFIED: live VICE MCP server, this session] — I connected directly to `http://host.docker.internal:6510/mcp` (the exact endpoint in `.mcp.json`) using raw MCP JSON-RPC (`initialize`, `tools/list`, `tools/call`) over `curl`, since this research subagent has no `vice_*` tools registered directly. The live server answered `initialize` with `serverInfo: {"name":"VICE MCP","version":"3.10"}` and `tools/list` returned exactly **64 tools**. I then exercised several **read-only, non-mutating** calls (`vice_ping`, `vice_memory_read` at multiple banks, `vice_memory_banks`, `vice_registers_get`, `vice_vicii_get_state`, `vice_sid_get_state`, `vice_cia_get_state`, `vice_sprite_get`, `vice_machine_config_get`, `vice_snapshot_list`) to confirm behavior, and made **no mutating calls** (no `disk_attach`, `autostart`, `machine_reset`, `memory_write`, `checkpoint_add`) so the shared host instance is left exactly as found for the actual execution plans. Everything below not explicitly marked otherwise is HIGH confidence, directly observed.

This is the same server the execution-phase `vice_*` tool calls will reach — findings transfer directly, they are not a different simulated surface.

### Machine identity and state, as observed right now

```json
// vice_ping
{"status":"ok","version":"3.10","machine":"C64SC","execution":"paused"}

// vice_machine_config_get (abridged)
{"machine":"C64SC","video_standard":"PAL",
 "memory":{"ram_kb":64,"expansion":"standard"},
 "chips":[
   {"name":"VIC-II","model":"6569","registers":"D000-D3FF"},
   {"name":"SID","model":"6581","registers":"D400-D7FF"},
   {"name":"CIA1","model":"6526","registers":"DC00-DCFF"},
   {"name":"CIA2","model":"6526","registers":"DD00-DDFF"}],
 "resources":{"MachineVideoStandard":1,"WarpMode":0,"Speed":100,
              "SidModel":1,"CIA1Model":1,"CIA2Model":1},
 "memory_map":[ /* standard C64 map, RAM/ROM/IO per range, matches c64-memory-mapping skill */ ]}
```

- **`machine: "C64SC"`** confirms the CLAUDE.md hypothesis that this is `barryw/vice-mcp` wrapping `x64sc` (cycle-exact VIC-II), not plain `x64`. [VERIFIED]
- **`video_standard: "PAL"`.** The tool descriptions for `hold_frames`/`duration_frames` say "~16.7ms each at 60Hz" — that figure is NTSC and does not match this PAL machine (~50.125Hz, ~19.95ms/frame). Don't use the tool docstring's ms-per-frame figure for any timing arithmetic; drive everything by frame *count* or by checkpoint, never by a derived millisecond value. This is a documentation-vs-reality mismatch worth a one-line note in `NOTES.md`, not a blocker (the project already bans wall-clock sync).
- Execution starts in a **paused** state at PC `$E5CD` (58829) — inside KERNAL ROM, i.e. a fresh/default power-up state, not yet running anything. Expect to need an explicit `vice_execution_run` or `vice_autostart`/`vice_machine_reset(run_after: true)` before anything happens.
- `vice_snapshot_list` returned `{"snapshots":[],"directory":"/home/henrik/.config/vice/mcp_snapshots"}` — a clean slate, no leftover snapshot state from any prior session.

### Bootstrap (RECOVER-01) — confirmed tools, procedure TBD by empirical test

| Tool | Signature (from live schema) | Role |
|---|---|---|
| `vice_disk_attach` | `{unit: 8-11, path}` | Attach a `.d64`/`.g64` to a drive unit. `path` is a **host** path — must go through `devcontainer-host-path`. |
| `vice_disk_detach` | `{unit}` | Clean detach between the `danish` and `saeger` sessions (01-02 → 01-03 sequencing). |
| `vice_autostart` | `{path, program?, run?, index?}` | One-call load+run. `path` also host-side. **Untested against these specific disks' faked directories** — see below. |
| `vice_machine_reset` | `{mode: soft\|hard, run_after?}` | Clean-slate ritual step. `hard` = power cycle. |
| `vice_execution_run` / `vice_execution_pause` | none | Manual resume/pause if autostart doesn't auto-run. |
| `vice_disk_read_sector` | `{unit, track, sector}` | Sanctioned, non-forbidden fallback for reading the emulated drive's own view of a sector, distinct from parsing the `.d64` file bytes directly in Node. |

**`vice_disk_list` is present in the tool list (`{name:"vice_disk_list", description:"List directory contents", args:{unit}}`) — never call it, per the project's own hazard note and STATE.md's blocker entry.** [VERIFIED — the tool exists and matches the forbidden name exactly, confirming the hazard note refers to this exact tool, not a lookalike.]

**Open, empirical question — smallest experiment to settle it:** PROJECT.md records that both disks have "faked directories — 0-block `BRUCE LEE` PRG entries pointing at bogus track/sector" and load via custom raw-sector loaders that bypass the KERNAL. VICE's `vice_autostart` for a `.d64` typically emulates typing `LOAD"*",8,1` + `RUN` against the KERNAL's own directory-walk — which may or may not correctly retrieve a boot stub sitting behind a deliberately-faked directory entry. **Smallest experiment:** call `vice_disk_attach` then `vice_autostart` on `danish.d64`, then check `vice_registers_get` (is PC now inside BASIC/the loader rather than stuck at the READY prompt?) and/or `vice_display_screenshot`. If it works, done — record it as the procedure. If it silently fails (stays at READY, or loads garbage), fall back to reading the actual boot-sector bytes directly (`danish.d64` BASIC stub is known to be at t17/s0, `SYS 2073`; `saeger.d64` at t1/s0, `SYS 2161` — both already documented in PROJECT.md from prior static byte inspection) and replicate the same keystrokes a real drive user would type — `vice_keyboard_type({text: "LOAD\"*\",8,1\n"})` then, after the load completes (checkpoint-gated, not timed), `vice_keyboard_type({text:"RUN\n"})` — or `vice_keyboard_petscii` for exact byte control if `keyboard_type`'s ASCII→PETSCII conversion proves lossy for the exact bytes needed. This determination is plan 01-01's job exactly as CONTEXT.md scopes it; I flag it here as untestable without actually attaching a disk (which this research pass deliberately avoided, to leave the shared VICE instance untouched for the execution phase).

### Dump-point detection & determinism (RECOVER-02/03, D-06, D-09)

| Tool | Role |
|---|---|
| `vice_checkpoint_add` | `{start, end?, stop, load, store, exec}` — `exec:true, stop:true` at the empirically-located game-entry address is exactly D-06's "PC-reached checkpoint," not a timeout. |
| `vice_run_until` | `{address, cycles}` — runs until PC reaches `address`. **`cycles` is documented in its own description as "Max cycles to run (timeout, not yet implemented)."** [VERIFIED from live schema text] This is a real tooling gap: there is currently no cycle-bounded safety net if the target address is never reached (e.g. entry point mis-identified). Mitigate by always having a `checkpoint_add` on the *same* address armed first (belt-and-suspenders) and being ready to fall back to bounded `vice_execution_step(count: N)` loops with a `vice_registers_get` check between batches if a `run_until` call appears to hang — do not rely on the `cycles` param to protect you. |
| `vice_execution_step` | `{count, stepOver}` — single/multi-step, for manually walking out of the decruncher when the entry point isn't known yet. |
| `vice_backtrace` | `{depth}` — call stack (JSR return addresses); useful for confirming "we're now inside code the loader jumped to, not the loader itself." |
| `vice_disassemble` | `{address, count≤100, show_symbols}` — ad-hoc spot-check of what's actually at a candidate entry address before committing to it as the checkpoint. |
| `vice_memory_search` | `{start, end, pattern, mask?, max_results}` | Can locate the literal `TCS-CRUNCH!` (or other) banner bytes in RAM to help triangulate where the loader/banner region is, independent of stepping. |
| `vice_cycles_stopwatch` | `{action: reset\|read\|reset_and_read}` | For measuring, not gating — useful for documenting how long a stage took in `NOTES.md`, not for deciding when to stop. |

**No checkpoint bulk-clear tool exists.** `vice_checkpoint_list` + `vice_checkpoint_delete(checkpoint_num)` (one at a time) and `vice_checkpoint_toggle`/`vice_checkpoint_group_toggle` are the only clearing primitives — the "clean slate ritual" PITFALLS.md calls for must enumerate via `checkpoint_list` and delete each returned ID individually, or toggle a pre-established group off. Worth a two-line helper in `tools/` (or just inline in NOTES.md as a documented step) rather than assuming a single "clear all" call exists.

**D-09's reproducibility check** (run the recorded procedure twice from a scripted `vice_machine_reset`, hash both dumps) is directly supported: `vice_machine_reset({mode:"hard", run_after:false})` then re-run the attach/autostart/checkpoint/run_until/memory_read sequence a second time, SHA-256 both `.bin`s with Node's `crypto` module, and commit both hashes + the comparison result per D-09. No blocker found.

### Complete RAM capture under banking (RECOVER-02/03, D-03, D-08) — CONFIRMED, live

[VERIFIED: live VICE MCP server, this session — data below is a direct, unedited transcript of real tool responses against the machine's actual current state]

```
vice_memory_banks →
  {"banks":[{"name":"default","number":0},{"name":"cpu","number":0},
            {"name":"ram","number":1},{"name":"rom","number":2},
            {"name":"io","number":3},{"name":"cart","number":4}],
   "machine":"C64SC"}

vice_memory_read(address:"$E000", size:16, bank:"rom", encoding:"hex") →
  data_hex: 8556200FBCA561C988900320D4BA20CC     (real KERNAL ROM code)

vice_memory_read(address:"$E000", size:16, bank:"ram", encoding:"hex") →
  data_hex: FFFF00000000FFFFFFFF00000000FFFF     (power-on RAM pattern, underneath ROM)

vice_memory_read(address:"$E000", size:16, encoding:"hex")             →  (no bank given)
  data_hex: 8556200FBCA561C988900320D4BA20CC     (matches "rom" — default read is the CPU's-eye/banked view)

vice_memory_read(address:"$D000", size:16, bank:"io", encoding:"hex")  →
  data_hex: 00000000000000000000000000000000     (VIC-II registers, currently zero)

vice_memory_read(address:"$D000", size:16, bank:"ram", encoding:"hex") →
  data_hex: FFFF00000000FFFFFFFF00000000FFFF     (RAM underneath the I/O block)

vice_memory_read(address:"$01", size:2, encoding:"hex")                →
  data_hex: 3700     ($01=$37 — default LORAM/HIRAM/CHAREN=1/1/1, ROM+IO all banked in, as expected pre-boot)
```

**This resolves D-08 conclusively: `vice_memory_read(..., bank: "ram")` reads true underlying RAM beneath ROM (`$A000-$BFFF`, `$E000-$FFFF`) and beneath I/O (`$D000-$DFFF`) directly, with zero side effects and zero `$01` port manipulation.** D-08's guarded `$01`-write fallback should not be needed at all for RECOVER-02/03's capture step — plan the capture as: for each of the 4 "windowed" ranges (`$A000-$BFFF`, `$D000-$DFFF`, `$E000-$FFFF`, plus the always-RAM rest of the map), read with `bank: "ram"`; assemble the 65536-byte flat image from those reads regardless of whatever the *live* `$01` configuration happens to be at dump time (record that live `$01` value in the sidecar per D-04, but it no longer gates *how* the read is done — only what the CPU itself would currently see, which is separately interesting but not needed for the D-03 "pure RAM" image). Keep D-08's fallback documented as a contingency only, to be invoked and recorded verbatim if `bank: "ram"` is later found to misbehave for some sub-range once real disk-attached testing begins (not observed in this pre-boot state, but confirm again once a game is actually loaded and running, since bank behavior for cartridge/expansion-adjacent ranges wasn't exercised here).

**Independent, incidental confirmation:** the `FFFF00000000FFFFFFFF00000000FFFF` pattern read back from *both* `$E000` and `$D000`'s RAM matches PITFALLS.md's previously LOW-confidence, web-search-only claim about C64/VICE power-on RAM being short `$00`/`$FF` runs rather than true garbage. That claim can now be upgraded to [VERIFIED: live VICE MCP server, this session] for *this* VICE instance's default power-on state specifically (still worth reconfirming after a hard reset immediately before the actual capture, since this reading was taken at whatever the emulator's ambient pre-session state happened to be, not a freshly-triggered reset).

### Chip-level state capture (RECOVER-02/03, D-04)

All four state-read tools exist and were exercised live (schemas + real sample output below). This is exactly D-04's sidecar content.

```
vice_vicii_get_state →
  {"raster_line":15,"video_mode":0,"screen_enabled":true,"25_rows":true,
   "y_scroll":3,"x_scroll":0,"border_color":254,
   "background_color_0..3": [246,241,242,243],
   "sprite_sprite_collision":0,"sprite_background_collision":0,
   "irq_status":113,"irq_enabled":240,
   "memory_pointers":21,                    ← this IS the $D018 value
   "registers":[ ... 45 raw bytes, $D000-$D02E ... ]}

vice_sid_get_state →
  {"voices":[{voice:1..3, frequency, pulse_width, waveform flags, ADSR...}],
   filter_cutoff_low/high, filter_resonance, filter_voice1/2/3, volume, ...}

vice_cia_get_state →
  {"cia1":{port_a, port_b, ddr_a, ddr_b, timer_a, timer_b, tod_*, control_a/b, ...},
   "cia2":{ same shape }}

vice_sprite_get({sprite: N}) →
  {"sprite_data":{sprite, x, y, enabled, multicolor, expand_x, expand_y,
                  priority_foreground, color}}
```

**Nuance for D-04's "8 sprite pointers" requirement:** `vice_sprite_get` returns position/color/mode flags but **not** the raw sprite-pointer byte itself (the value at screen-matrix-base+`$03F8`..`+$03FF`). Get the 8 pointer bytes with a plain `vice_memory_read` at (current screen base, resolved from `vicii_get_state`'s VIC-bank-adjusted memory pointers) `+ $3F8`, size 8 — combine with `vicii_get_state`'s `memory_pointers`/CIA2 `$DD00` bank-select bits to compute the absolute sprite-data addresses, exactly the derivation the `c64-memory-mapping` skill already documents for `$D018`/VIC-bank resolution. `vice_sprite_inspect({sprite_number, format:"ascii"|"binary"|"png_base64"})` is a good human-readable cross-check (it already resolves pointer→bitmap internally) but is not itself the sidecar's source of the raw pointer byte.

**VIC bank derivation:** CIA2's `$DD00` bits 0-1 select the 16KB VIC bank (inverted: `11`=bank0 default). Read via `vice_cia_get_state().cia2.port_a` (live sample: `151` = `%10010111`, low 2 bits `11` → bank 0, `$0000-$3FFF`) or directly via `vice_memory_read("$DD00", 1)`. Record both the raw byte and the derived bank number in the sidecar per D-04.

### Snapshot mechanism — real capability and its real limit (RECOVER-02/03, D-07)

```
vice_snapshot_save({name, description?, include_roms?, include_disks?})   ← no `path` arg
vice_snapshot_load({name})
vice_snapshot_list() → {"snapshots":[...], "directory": "<host path>"}
```

Live `vice_snapshot_list` right now: `{"snapshots":[],"directory":"/home/henrik/.config/vice/mcp_snapshots"}`.

**Finding [VERIFIED: live VICE MCP server, this session]:** snapshots are addressed **by name only**, and physically stored under the **host's** `~/.config/vice/mcp_snapshots/` — a location outside the git workspace, outside the container's own filesystem, and with **no MCP tool that exports a snapshot's raw bytes** for writing into `recovery/{danish,saeger}/`. This directly affects D-07:

- **What still works exactly as D-07 wants:** a versioned, descriptively-named snapshot (`danish_gameentry_v1`, never `snapshot.vsf`) is real, durable state on the same host this project's `.mcp.json` always points at — reusable by name across Phase 2/3 sessions without any re-derivation, satisfying "reusable deterministic start state for Phases 2 and 3."
- **What D-07 needs to drop or reword:** "committed alongside... Full set per dump: `.bin` + `.map.json` + `-state.json` + `.vsf`" — the `.vsf` cannot be a fourth committed file with the current tool surface. Record the **snapshot name** (a string) in `NOTES.md`/the manifest instead of a binary file, alongside the exact procedure that reconstructs it (which is what success criterion 1 already demands — "re-running the recorded procedure produces a byte-identical dump" — so the name-only approach doesn't weaken reproducibility, it just means reproducibility runs through the recorded *procedure*, not a replayed blob).
- This is a planning-time decision the phase 01-01/01-02/01-03 plans need to make explicitly, not discover mid-execution: I recommend recording `{"snapshot_name": "danish_gameentry_v1", "snapshot_description": "...", "host_snapshot_dir": "/home/henrik/.config/vice/mcp_snapshots"}` as fields inside the JSON sidecar (`-state.json`) rather than trying to commit a `.vsf` file that doesn't exist as a workspace artifact.

### On-demand load detection (RECOVER-04, D-10/D-11)

- `vice_watch_add({address, size, type: read|write|both, condition?})` — arm on `$DD00` (CIA2 PRA: VIC bank bits *and*, for a raw-sector custom loader bypassing the KERNAL, very plausibly the bit-banged serial-bus CLK/DATA/ATN lines a fastloader toggles directly) with `type: "both"` as the primary on-demand-load sentinel, since custom loaders in this project's disks explicitly bypass KERNAL IEC routines (no standard `$FFD5`/serial-bus KERNAL vector activity to watch instead).
- A standing `vice_checkpoint_add({start: loaderStart, end: loaderEnd, exec: true, stop: true})` over the already-defeated loader's own code range doubles as a "did we re-enter the loader" sentinel — per D-10, it should never fire again post-dump; if it does, that is itself evidence of a second load pass.
- `vice_checkpoint_set_condition`/`set_ignore_count` exist if a watch/checkpoint needs to be conditioned (e.g. "only break if `A == $xx`") or allowed a bounded number of expected benign hits before it becomes meaningful — available but likely unnecessary for a first pass given D-11's bounded-play scope.
- No dedicated "disk activity LED" or "drive busy" tool was found in the 64-tool list; treat the watch-based approach above as the mechanism, not a drive-status poll.

### Normalisation and diffing (RECOVER-05, D-17)

No emulator tool is needed for this step — it is pure Node-side data processing over the two already-captured `.bin` files (per D-18/ARCHITECTURE.md's `tools/diff-images.mjs`). D-17's anchor-proving technique (pick long distinctive byte runs from one image, search for them in the other, require all deltas to agree) is a straightforward `Buffer.indexOf`-based script; no external library is needed. `vice_memory_search`/`vice_memory_compare` exist and *could* do a live in-emulator comparison (`vice_memory_compare({mode:"ranges", range1_start, range1_end, range2_start})` or `mode:"snapshot"` against a saved state) but since both dumps will already be flat `.bin` files by this point, doing the diff in Node against the files directly is simpler, faster, and doesn't require either image to still be loaded in the (single, shared) emulator.

### Crack-independence evidence (RECOVER-07, D-15)

**Tier 1 (binary itself — highest weight per D-15):** loader style/structure, on-disk cracktro banner text, any surviving release strings — read directly from the captured images (or from the raw `.d64` bytes even before capture, since crack banners are typically outside the crunched game-code region). `vice_memory_search` can locate a known ASCII string once the image is loaded; a plain Node `Buffer` scan works equally well directly against the `.d64` file bytes for anything not yet decrunched.

**Tier 2 (external scene records — corroborating, never outranks Tier 1):**

- **`danish.d64` [CITED: csdb.dk/release/?id=56637]** — Danish Crackers, release **DC-011/P**, November 1984, credited to "PMK of Ace Crackings and Danish Crackers." A CSDb user comment (Fred, April 2016) states the cruncher used is "**Turbocopy/Crunch V2.0**," described as *publicly available* software, and explicitly disputes any connection to a group called "TCS": *"I don't think TCS has anything to do with this release."* — This strongly suggests the on-disk `TCS-CRUNCH!` banner (already identified by static byte inspection per PROJECT.md) is the **cruncher tool's own self-identifying string**, not a crack-group signature. Worth recording verbatim in `recovery/danish/NOTES.md` as Tier 2 evidence bearing on attribution, even though defeating/analysing "Turbocopy/Crunch V2.0" itself remains explicitly out of scope (REQUIREMENTS.md's ban on static `TCS-CRUNCH!` depacking effort).
- **`saeger.d64` / SSG / XIDEX** — **not found** via web search; CSDb's internal search isn't well indexed by general search engines (confirmed by two distinct search attempts returning only unrelated Bruce Lee remake/sequel entries). **Recommended smallest experiment:** search csdb.dk directly (its own release/group search, not a general web search) for "XIDEX" and "SSG" during plan 01-05 — small, bounded, and the natural place for it since 01-05 owns the crack-independence verdict anyway. Until then, treat `saeger.d64`'s Tier 2 corroboration as an open gap, not a negative finding — absence of a web-search hit is not evidence the release lacks scene documentation.
- **Independence signal so far:** the two loaders are already known (PROJECT.md) to differ substantially in kind — `danish.d64` is crunched with a **named, publicly-available generic cruncher** (Turbocopy/Crunch V2.0) wrapped in a custom raw-sector loader; `saeger.d64` is **uncrunched** with a different (SSG/XIDEX) custom raw-sector loader. Using a shared, publicly-available generic cruncher (rather than a bespoke one) on one side actually *weakens* any common-ancestor concern between the two specific crack groups — a public tool being reused doesn't imply the two groups derived from each other — but this is reasoning from what's known so far, not a substitute for actually inspecting both loaders' code once captured (Tier 1, primary).

### Non-VICE toolchain confirmation

- `acme --version` → `ACME, release 0.97 ("Zem"), 31 Jan 2021` [VERIFIED, in-container] — present but **not used in Phase 1** (no ACME source work happens until Phase 4+, consistent with CONTEXT.md's scope boundary).
- `toacme` present at `/usr/bin/toacme` [VERIFIED, in-container] — also not needed this phase.
- `python3 --version` → `3.13.5` [VERIFIED, in-container] — present, but per D-18 deliberately not used this phase (deferred to Phase 4).
- `node --version` → `v24.18.1` [VERIFIED, in-container] — this is what all Phase 1 tooling runs on.
- No `wine`/`unp64`/`exomizer`/`c1541`/`petcat` install attempted or needed — Phase 1's scope (per REQUIREMENTS.md's Out-of-Scope table and D-18) is live-memory recovery only; the optional "five-minute Wine/unp64 experiment" ARCHITECTURE.md/STACK.md mention as cheap insurance is explicitly *not* required for this phase's success criteria and can be skipped without any gap in coverage.

## Architecture Patterns

### System Architecture Diagram — this phase's data flow

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│  disks/danish.d64 (174848B) │     │  disks/saeger.d64 (174848B) │
│  read-only evidence          │     │  read-only evidence          │
└───────────────┬──────────────┘     └───────────────┬──────────────┘
                │ devcontainer-host-path (translate path)
                ▼                                     
   vice_disk_attach(unit=8, path)         (sequential — shared VICE,
   vice_autostart(path)  ── or fallback ──  01-02 before 01-03)
   keyboard LOAD+RUN keystrokes                        
                │ single-step / backtrace / disassemble
                │ to find real game-entry PC
                ▼
   vice_checkpoint_add(exec, stop, entryAddr)   ← the recorded, re-runnable trigger
   vice_run_until(entryAddr)  [+ step-count fallback, "cycles" timeout NOT implemented]
                │ (loader now defeated, decrunch complete, PC at entry)
                ▼
   vice_memory_read(bank:"ram") × N ranges  → assemble 65536-byte flat image
   vice_vicii/sid/cia_get_state + vice_sprite_get×8 + $01/$DD00 reads → sidecar JSON
   vice_snapshot_save(name)  → host-side, name-addressable only (NOT git-committable)
                │
                ▼
   recovery/{danish,saeger}/dumps/*.bin + *.map.json + *-state.json + NOTES.md
   (recorded: dump trigger addr, $01 value, ranges captured, snapshot name)
                │
                │  ── D-11 bounded play-through: watch $DD00 + re-arm loader exec checkpoint ──
                ▼
   recovery/LOADING.md  (found N load events, or zero + what was armed/how far played)
                │  (only if a load event found: supplementary dump per event)
                ▼
   D-17 anchor-proving offset search (Node, Buffer.indexOf on long byte runs)
                │
                ▼
   tools/diff-images.mjs → three-bucket partition (loader / cracktro / game logic)
                │
                ▼
   recovery/PROVENANCE.md (coalesced ranges, verdict, evidence, confidence, tier)
   + crack-independence verdict (Tier 1 binary inspection + Tier 2 CSDb records)
                │
                ▼
   recovery/clean/bruce-lee.bin (winner by D-16's measured-patch-count rule)
   recovery/clean/README.md (the reason, as a number)
```

### Recommended tooling layout for this phase

```
tools/
├── hostpath-boot.mjs      # wraps devcontainer-host-path + disk_attach/autostart calls
├── dump-capture.mjs       # calls memory_read(bank:"ram") across ranges, assembles .bin
├── chip-state.mjs         # calls vicii/sid/cia_get_state + sprite_get×8, writes -state.json
├── diff-images.mjs        # D-17 anchor search + D-14 coalesced-range diff → PROVENANCE.md draft
└── d64-parse.mjs          # direct .d64 byte parsing (BAM @ 18/0, dir chain @ 18/1) — never vice_disk_list
```
This matches ARCHITECTURE.md's `tools/` component list and D-18's "Node, zero install" decision; nothing here needs a package.json dependency.

### Pattern: Bank-scoped memory read as the primary RAM-under-ROM/IO technique

**What:** Call `vice_memory_read` with `bank: "ram"` for any address, regardless of what the CPU's `$01` port currently shows there.
**When to use:** Every capture of the canonical 65536-byte image (D-03) — this is now the *only* read path needed; skip D-08's `$01`-write fallback unless a live, disk-attached test later shows the bank parameter behaving differently once a game is actually running (untested in this research pass — the machine was in its default pre-boot state throughout).
**Example (verified, real response):**
```
vice_memory_read({address:"$A000", size:8192, bank:"ram", encoding:"hex"})
→ returns the RAM bytes underneath BASIC ROM at $A000-$BFFF, not the ROM's own bytes
```
**Trade-off:** None found. This is strictly better than the guarded `$01`-write-then-restore fallback D-08 anticipated, because it never perturbs the running machine at all.

### Anti-Patterns to Avoid

- **Relying on `vice_run_until`'s `cycles` parameter as a timeout.** Its own schema description says "timeout, not yet implemented." A misidentified entry address will hang the call rather than fail cleanly.
- **Assuming `vice_snapshot_save` produces a file you can `git add`.** It doesn't; it's a host-side, name-addressable store with no export path. Plan `NOTES.md`/sidecar content accordingly (see above).
- **Diffing before both images reach the same execution phase and base address.** Per D-17/Pitfall 4 — a raw diff of anything captured at different points in each loader's progress is close to meaningless.
- **Trusting the tool docstring's "~16.7ms at 60Hz" framing for this PAL-configured machine.** Use frame counts/checkpoints, never a derived millisecond value.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| RAM-under-ROM/IO access | A custom `$01`-poke-then-restore sequence as the default path | `vice_memory_read(bank:"ram")` | Confirmed live to work with zero side effects; the poke-based approach is strictly more invasive and was only ever meant as a guarded fallback (D-08). |
| `.d64` directory parsing | Any dependence on `vice_disk_list` | Direct byte parsing of the `.d64` file in Node (35 tracks, BAM at 18/0, dir chain from 18/1) or `vice_disk_read_sector` for the live-drive view | `vice_disk_list` is a known, unconditional hazard — crashes the host MCP server. |
| SHA-256 hashing for D-09's reproducibility check | A third-party hashing library | Node's built-in `crypto.createHash('sha256')` | Zero-install, standard, sufficient. |
| Byte-pattern search across a dump | A custom diffing/search library | Node `Buffer.indexOf`, or `vice_memory_search` while still live in the emulator | Both are already available and sufficient for this phase's data volumes (64KB images). |

**Key insight:** Every capability this phase needs is either (a) already exposed by the live `vice_*` MCP surface, confirmed by direct testing, or (b) trivial in vanilla Node against small (64KB-scale) byte buffers. There is no dependency gap to fill for RECOVER-01 through RECOVER-08.

## Runtime State Inventory

**Not applicable — this is not a rename/refactor/migration phase.** Phase 1 is greenfield creation of `recovery/`; there is no prior state (repo-wide grep of tracked files shows no `recovery/`, `src/`, `tools/`, `docs/`, or `verify/` directories yet, confirmed by `git log`/`ls`). Skipping per the conditional trigger in the output format.

## Common Pitfalls

### Pitfall 1: Trusting `vice_autostart` against a faked directory without checking

**What goes wrong:** `vice_autostart` may silently "succeed" (return without error) while actually loading nothing useful, if its directory-walk logic can't correctly resolve a deliberately-faked 0-block directory entry pointing at a bogus track/sector.
**Why it happens:** Autostart implementations generally emulate typing `LOAD"*",8,1`+`RUN`, which depends on the KERNAL correctly reading a directory entry — exactly the mechanism these disks' custom loaders are designed to route around.
**How to avoid:** After calling `vice_autostart`, immediately check `vice_registers_get` (has PC moved away from the READY-prompt/reset vector?) and/or take a `vice_display_screenshot` before assuming success. Have the keyboard-keystroke fallback (typed `LOAD"*",8,1`/`RUN`, or a raw `vice_keyboard_petscii` sequence) ready as plan B, since both tools already exist.
**Warning signs:** PC stays in KERNAL/BASIC ROM range after autostart "completes"; screenshot still shows a READY prompt; a checkpoint set on the expected loader entry point never fires.

### Pitfall 2: Treating a snapshot name as a portable artifact

**What goes wrong:** Writing plan/NOTES.md language that implies a `.vsf` file will be committed to git, then discovering at execution time there's no tool to produce that file.
**Why it happens:** D-07 was written before the tool surface was directly probed; the natural assumption ("snapshot = a file, like a save-state") doesn't hold for this specific MCP server's design (name-addressable, host-config-dir-stored).
**How to avoid:** Plan for `.bin` + `.map.json` + `-state.json` as the three real, committable artifacts; record the snapshot **name** (a string) as a field inside `-state.json` or `NOTES.md`, with the understanding that restoring it later requires the same host machine and the same MCP server instance — which is guaranteed by this project's fixed `.mcp.json` endpoint, so this is a safe assumption, not a risk.
**Warning signs:** A plan task literally says "commit `danish_gameentry_v1.vsf`" — that file will not exist anywhere the container can read it.

### Pitfall 3: Relying on `run_until`'s cycle timeout

**What goes wrong:** A `vice_run_until({address: wrongAddr})` call hangs (or runs far longer than expected) because the target PC is never reached, and there is no working cycle-count safety net.
**Why it happens:** The tool's own schema documents `cycles` as "not yet implemented" — this is a real, current gap in the tool, not a hypothetical.
**How to avoid:** Verify the target address with `vice_disassemble`/`vice_backtrace` *before* committing to a long `run_until`; prefer smaller `vice_execution_step(count: N)` batches with a `vice_registers_get` check in between when the target address is not yet fully trusted, reserving `run_until` for once the entry point is confirmed.
**Warning signs:** A `run_until` call that doesn't return within the time a normal loader/decrunch pass should take.

### Pitfall 4: Diffing across a `$01`-configuration mismatch that no longer needs to exist

**What goes wrong:** Because D-08's `$01`-write fallback is no longer the primary path, a plan that still writes "set `$01` to bank in RAM, then dump, then restore `$01`" as the main procedure adds unnecessary complexity and an unnecessary invasive step for no benefit.
**Why it happens:** Written before the `bank: "ram"` parameter was confirmed live.
**How to avoid:** Default the capture procedure to `bank: "ram"` reads only; keep the `$01`-write approach documented as a named, guarded contingency (per D-08) rather than the everyday path.

## Code Examples

### Reading a full 65536-byte RAM image via bank-scoped reads (conceptual, Node-side orchestration)

```js
// tools/dump-capture.mjs — conceptual shape, not yet written
// Calls vice_memory_read via whatever MCP client surface the execution agent has
// (the vice_* tools directly, not raw HTTP as this research pass used).
const CHUNK = 4096; // stay well under whatever the MCP transport's response-size comfort zone is
const image = Buffer.alloc(65536);
for (let addr = 0; addr < 65536; addr += CHUNK) {
  const size = Math.min(CHUNK, 65536 - addr);
  const { data_hex } = await viceMemoryRead({
    address: `$${addr.toString(16).padStart(4, "0")}`,
    size,
    bank: "ram",
    encoding: "hex",
  });
  Buffer.from(data_hex, "hex").copy(image, addr);
}
```
**Source:** [VERIFIED: live VICE MCP server, this session] — schema and real sample response for `vice_memory_read` shown above; the chunking loop is standard, not vendor-documented (no max single-call size was found in the schema, so a conservative chunk size is a defensive choice, not a documented limit — worth confirming empirically in 01-02 whether a single 65536-byte call even works before assuming chunking is required).

### SHA-256 for D-09's reproducibility check

```js
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const hash = createHash("sha256").update(readFileSync("recovery/danish/dumps/run1.bin")).digest("hex");
```
**Source:** Node built-in, standard usage — [VERIFIED, in-container: `node --version` confirms `crypto` module availability at v24.18.1].

## State of the Art

| Old Approach (what CONTEXT.md/ARCHITECTURE.md assumed before this research) | Current Approach (confirmed this session) | When Changed | Impact |
|--------------------------------------------------------------------------|---------------------------------------------|--------------|--------|
| Unknown whether an MCP boot tool exists vs. `snapshot_load`-only bootstrap | `vice_autostart`/`vice_disk_attach` confirmed present and callable | This research pass | Resolves the phase's headline front-loaded decision before 01-01 even starts probing — 01-01 can go straight to *testing* autostart against the faked directories rather than first discovering whether a boot tool exists at all. |
| D-08 planned a guarded `$01`-write-then-restore as a likely-needed fallback | `bank: "ram"` on `vice_memory_read` confirmed sufficient, non-invasive | This research pass | D-08's fallback path probably never gets exercised in the actual capture; keep it documented but expect not to need it. |
| D-07 assumed a `.vsf` file is a fourth committed artifact per dump | Snapshots are name-addressable, host-side only, no export tool | This research pass | Plan the deliverable set as `.bin` + `.map.json` + `-state.json` + a recorded snapshot *name*, not four files. |
| PITFALLS.md flagged the C64 power-on RAM pattern claim as LOW confidence (web-search only) | Directly reproduced live against this exact VICE instance | This research pass | Upgradeable to VERIFIED for this project's specific emulator instance. |
| PROJECT.md/STACK.md: "TCS-CRUNCH!" signature "genuinely not documented anywhere found" | CSDb ties `danish.d64` to Danish Crackers/DC-011/P using "Turbocopy/Crunch V2.0," a named public tool, with the "TCS" attribution explicitly disputed by a CSDb commenter | This research pass | Doesn't unblock static depacking (still out of scope), but gives RECOVER-06/07 a much stronger attribution lead than "unknown." |

**Deprecated/outdated:** Nothing in the existing research docs is wrong on ACME-specific claims (still HIGH confidence, unchanged) — the corrections above are all in the VICE-tooling and crack-provenance areas that were explicitly marked open/unverified before this pass.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `vice_autostart` will successfully boot at least one of the two disks despite the faked directory scheme, without needing the keyboard-keystroke fallback | Bootstrap section | If wrong, 01-01 spends extra time on the keystroke fallback path — already planned for, low risk, but untested this session (deliberately, to avoid touching the shared VICE instance during research). |
| A2 | `bank: "ram"` behaves identically once a real game is loaded and running (vs. the untested, default pre-boot state this session observed it in) | Complete RAM capture section | If the bank read behaves differently once code has actually banked things in dynamically (e.g. cartridge-adjacent behavior, or a region the game itself remaps), D-08's `$01`-write fallback becomes load-bearing again rather than a rarely-needed contingency — re-verify in 01-02 against the actual running game, not just the idle machine. |
| A3 | The `saeger.d64` release has a discoverable CSDb (or other scene-record) entry corroborating SSG/XIDEX attribution | Crack-independence section | If no record exists, RECOVER-07's verdict leans more heavily on Tier 1 (binary-only) evidence — still valid per D-15, just carries less external corroboration on one side than the other. |
| A4 | A single `vice_memory_read` call can handle chunk sizes up to (at least) a few KB without transport-imposed truncation | Code Examples section | If the real per-call limit is smaller than assumed, `dump-capture.mjs`'s chunk size needs tuning down — cheap to discover and fix in 01-02, not a structural risk. |

## Open Questions

1. **Does `vice_autostart` actually work against these specific faked-directory disks?**
   - What we know: the tool exists, takes `path`/`program`/`run`/`index`.
   - What's unclear: whether its directory-walk logic tolerates the "0-block PRG entry pointing at bogus track/sector" scheme PROJECT.md documents.
   - Recommendation: test first in 01-01, exactly as CONTEXT.md already scopes it; keyboard-keystroke fallback is ready if it fails.

2. **What is the real per-call size ceiling for `vice_memory_read`?**
   - What we know: the schema allows `size: 1-65535`.
   - What's unclear: whether the MCP transport (HTTP, this session observed no explicit chunking limit in the schema) actually delivers a 65535-byte single response cleanly, or whether practical response-size limits force chunking.
   - Recommendation: try a single large read first in 01-02 before assuming chunking is required; fall back to a conservative chunk size (e.g. 4096) only if the large read is truncated or errors.

3. **Does `bank: "ram"` remain well-behaved once a game (not just the idle pre-boot machine) is actually running?**
   - What we know: confirmed correct against the machine's current idle, pre-boot, default-`$01`-configuration state.
   - What's unclear: behavior once cartridge-bank-adjacent hardware state, if any, or game-driven `$01`/expansion-port changes are in play (Bruce Lee doesn't use cartridge hardware, so this risk is likely low, but untested).
   - Recommendation: re-confirm with one quick `bank:"ram"` vs `bank:"rom"` comparison immediately after the game is running, before trusting it for the real capture.

4. **Where exactly does each image's real game-entry point sit?**
   - What we know: `danish.d64`'s BASIC stub is `SYS 2073` at t17/s0 (loader/decruncher stub, not the final game address); `saeger.d64`'s is `SYS 2161` at t1/s0.
   - What's unclear: the actual post-decrunch/post-load entry address for the real game code in each case — this is exactly what 01-01/01-02/01-03's stepping-and-backtracing work is for.
   - Recommendation: locate empirically via `vice_execution_step`/`vice_backtrace`/`vice_disassemble`, exactly as D-06 already specifies; no shortcut exists.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| VICE MCP server (`http://host.docker.internal:6510/mcp`) | Everything in this phase | ✓ [VERIFIED, live] | server `3.10`, machine `C64SC`, PAL | None needed — core dependency, confirmed reachable and responsive |
| Node.js | All Phase 1 tooling (`tools/*.mjs`) | ✓ [VERIFIED, in-container] | v24.18.1 | — |
| `devcontainer-host-path` skill | Any `path` argument to `vice_disk_attach`/`vice_autostart` | ✓ [VERIFIED — skill present and documented] | — | — |
| ACME / `toacme` | Not needed this phase | ✓ present but unused | 0.97 "Zem" | N/A |
| Python / pip / venv | Not needed this phase (deferred to Phase 4 per D-18) | Python present, pip/venv not installed | 3.13.5 | N/A — out of scope this phase |
| Wine / `unp64` / `exomizer` | Optional cheap-insurance static-depack spike (ARCHITECTURE.md's "five-minute experiment") | ✗ not installed | — | Explicitly optional; skip without any coverage gap per this phase's success criteria |

**Missing dependencies with no fallback:** None. Every RECOVER-01..08 requirement has a confirmed, working tool path.

**Missing dependencies with fallback:** Wine/unp64/exomizer (optional static-depack spike) — skip entirely; not required for any success criterion.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None yet — no test runner exists in this greenfield repo. Phase 1's "tests" are the mechanical checks success criteria 1/3 already specify (byte-identical re-run, 100% provenance coverage), implemented as small Node scripts, not a formal test framework. |
| Config file | none — see Wave 0 |
| Quick run command | `node tools/diff-images.mjs recovery/danish/dumps/run1.bin recovery/danish/dumps/run2.bin` (byte-identical check, D-09) |
| Full suite command | Re-run the full recorded procedure for both images, twice each, diff all four resulting `.bin`s pairwise, then run the cross-image provenance diff |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RECOVER-01 | Both disks boot via a documented MCP-only procedure, never calling `vice_disk_list` | manual (one-time, scripted) | `node tools/hostpath-boot.mjs danish.d64` then check `vice_registers_get` PC moved | ❌ Wave 0 |
| RECOVER-02 | `danish.d64` dump captured with recorded trigger/`$01`/ranges | scripted capture + SHA-256 | `node tools/dump-capture.mjs danish` | ❌ Wave 0 |
| RECOVER-03 | `saeger.d64` dump captured under same procedure | scripted capture + SHA-256 | `node tools/dump-capture.mjs saeger` | ❌ Wave 0 |
| RECOVER-04 | On-demand load detection via watches during bounded play | scripted watch-arm + manual play, log to `LOADING.md` | `node tools/watch-loads.mjs` (arms watches, reports hits) | ❌ Wave 0 |
| RECOVER-05 | Both images normalised to common base/state before diff | scripted anchor-search + offset proof | `node tools/diff-images.mjs --anchor-search danish.bin saeger.bin` | ❌ Wave 0 |
| RECOVER-06 | Every byte range carries a provenance verdict + evidence | scripted coalesced-diff → `PROVENANCE.md` | `node tools/diff-images.mjs --gap-tolerance 16` | ❌ Wave 0 |
| RECOVER-07 | Crack-independence verdict recorded with evidence/confidence weight | manual (CSDb search + binary inspection), written to `PROVENANCE.md` | n/a — analytical, not automatable | ❌ Wave 0 |
| RECOVER-08 | Canonical image chosen by measured patch-count | scripted count from `PROVENANCE.md`'s generated ranges | `node tools/diff-images.mjs --count-patches` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** re-run the specific dump/diff script just touched, confirm it still exits cleanly against already-captured fixtures.
- **Per wave merge:** re-run the byte-identical reproducibility check (D-09) end-to-end for whichever image(s) that wave touched.
- **Phase gate:** both images captured, both reproducibility checks green, `PROVENANCE.md` at 100% coverage, canonical image chosen with a recorded number, before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `tools/hostpath-boot.mjs` — wraps `devcontainer-host-path` + `disk_attach`/`autostart`, covers RECOVER-01
- [ ] `tools/dump-capture.mjs` — bank-scoped RAM capture + sidecar writer, covers RECOVER-02/03
- [ ] `tools/chip-state.mjs` — chip-state sidecar, covers RECOVER-02/03 (D-04)
- [ ] `tools/watch-loads.mjs` — on-demand-load watch arming/reporting, covers RECOVER-04
- [ ] `tools/diff-images.mjs` — anchor search, coalesced diff, patch-count, covers RECOVER-05/06/08
- [ ] Framework install: none — Node built-ins only, nothing to install

## Security Domain

**Not applicable — `security_enforcement` context.** This phase produces no network-facing service, no user-input-handling code, and no authentication/authorization surface; it is offline binary forensics against a fixed, already-possessed pair of disk images, orchestrated through a single trusted local MCP endpoint. None of the OWASP ASVS categories (authentication, session management, access control, input validation as a web/app-security concern, cryptography as a security control) apply to reading RAM out of an emulator and diffing two files. Skipping this section's per-category table as genuinely inapplicable, not merely low-priority.

## Sources

### Primary (HIGH confidence)
- **Live VICE MCP server, this session** (`http://host.docker.internal:6510/mcp`, per `.mcp.json`) — `initialize`, `tools/list` (64 tools enumerated), and 10 read-only `tools/call` probes (`vice_ping`, `vice_memory_read` ×6 variants, `vice_memory_banks`, `vice_registers_get`, `vice_vicii_get_state`, `vice_sid_get_state`, `vice_cia_get_state`, `vice_sprite_get`, `vice_machine_config_get`, `vice_snapshot_list`). No mutating calls made — shared host instance left untouched for execution.
- `acme --version`, `which toacme`, `python3 --version`, `node --version` — direct in-container verification.
- `.mcp.json`, `.planning/PROJECT.md`, `.planning/STATE.md`, `.planning/phases/01-recovery-provenance/01-CONTEXT.md` — this repository's own committed decisions and hazard notes.
- `.claude/skills/{devcontainer-host-path,c64-memory-mapping,acme-build}/SKILL.md` — direct inspection.

### Secondary (MEDIUM confidence)
- [csdb.dk/release/?id=56637](https://csdb.dk/release/?id=56637) — `danish.d64` = Danish Crackers DC-011/P, Nov 1984, "Turbocopy/Crunch V2.0" cruncher, TCS attribution disputed in comments. Community-maintained database, not primary-source documentation, but a specific, checkable release record.
- `.planning/research/{ARCHITECTURE.md,PITFALLS.md,STACK.md}` — this project's own prior research pass (already MEDIUM-HIGH per their own confidence notes; unchanged by this pass except where explicitly flagged above as corrected/upgraded).

### Tertiary (LOW confidence)
- General web search for a CSDb entry corresponding to `saeger.d64`/SSG/XIDEX — no result found; flagged as an open item for 01-05, not a negative finding.

## Metadata

**Confidence breakdown:**
- VICE MCP tool surface & bootstrap/capture mechanics: HIGH — directly probed, live, this session, against the actual project endpoint.
- Crack-independence evidence: MEDIUM — one side externally corroborated (Tier 2), one side an open, bounded, small task for 01-05.
- Gameplay-dependent findings (on-demand load behavior, actual entry-point addresses, in-game `bank:"ram"` behavior once a game is running): LOW/untested — nothing in this research pass involved actually running the game, since doing so live would have mutated the shared VICE instance's state ahead of the real execution plans. Flagged explicitly wherever this applies (Open Questions 1, 3, 4).

**Research date:** 2026-07-30
**Valid until:** Tool-surface findings (schemas, bank behavior against the idle machine) are stable indefinitely absent a VICE MCP server upgrade — re-check `vice_ping`'s `version` field if research is reused after a long gap. Gameplay-dependent findings should be re-verified the moment 01-01/01-02 actually runs a disk, not assumed to still hold.
