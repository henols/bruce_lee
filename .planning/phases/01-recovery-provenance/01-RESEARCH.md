# Phase 1: Recovery & Provenance - Research

**Researched:** 2026-07-30
**Domain:** Live-memory recovery of a cracked 1984 C64 game via VICE-over-MCP, plus two-image provenance diffing
**Confidence:** HIGH for the VICE MCP tool surface (directly probed, live, this session) and ACME/CLAUDE.md-adjacent facts; MEDIUM for crack-independence evidence (one release externally corroborated, one not yet found); MEDIUM-LOW for anything requiring actual gameplay (untested — no play-through has happened yet)

> **Refreshed 2026-08-01, 12:46 (targeted, RECOVER-04 / plan 01-04 only) — NOW ITSELF SUPERSEDED, see
> below.** Plans 01-01/01-02/01-03 executed successfully and the research from the original
> 2026-07-30 pass is unchanged and still authoritative (VICE MCP tool surface, bank-scoped RAM
> capture, the `$08B1` trigger, the snapshot-export limitation, the drift/Hamming-1 discriminator,
> the pause-on-state-read finding, Pitfalls 1–4 and 6). The 12:46 refresh analysed plan 01-04's
> revert (`bb0b1f7`) as a **pool-vs-broker acquisition-route** question — whether standalone
> `tools/*.mjs` CLI verbs should reach the emulator via the pre-01.2 fixed pool or via Phase 01.2's
> on-demand broker — and recommended building a new `tools/lib/vice-acquire.mjs` seam module for the
> standalone CLI to adopt a broker-granted instance. **That entire premise is now dead.**
>
> **Refreshed again 2026-08-01, after 14:57 (this refresh, current).** A hard rule landed the same
> day at 14:57 (commits `db9eed3`, `4f9e397`), now in `.claude/CLAUDE.md` § "Emulator Access": **the
> `mcp__vice__*` tools are the only permitted route to the emulator, full stop — no script, module,
> test or driver may open its own connection to host VICE, read broker state to find a port, or
> import a transport module as a library, and reimplementing that route cleanly counts as the same
> violation as importing it.** This does not merely re-open the pool-vs-broker question the 12:46
> refresh answered — it makes the question moot, because *neither* route is a standalone script's
> to take any more. Concretely, in the same window `tools/recover.mjs`, `tools/chip-state.mjs`,
> `tools/recover.test.mjs` and `tools/README.md` were **deleted, not migrated** (`d963c5b`,
> `096ac26`), and the `vice-mcp-selector` and `spike-findings-bruce-lee` skills were deleted;
> `c64-ram-capture` was reduced to a single `SKILL.md` with its scripts removed. `tools/` now holds
> only `releases.mjs`, `d64-parse.mjs` (+test) and `recovery-schema.mjs` — zero files that import a
> transport, by construction.
>
> The **`## Phase 01-04 Redo — Broker-Route Findings (Refreshed 2026-08-01)`** section below (Q1
> through Q9), inserted after "Non-VICE toolchain confirmation", is now marked **SUPERSEDED** at its
> own banner and left in place rather than deleted, because its diagnostic content (the six
> unexplained host-VICE-hang outages, the corrected loader-range and unused-range attribution
> defects, the two-liveness-signal distinction, the missed-input-recovery gap) is still real and
> still needed — only its acquisition-route framing (Q1, Q3, Q7, Q8, Q9, and the "Recommended tooling
> layout" and Node-orchestration code example that followed it) is dead. A new section, **`## Phase
> 01-04 Redo — MCP-Only-Rule Findings (Refreshed 2026-08-01, post-14:57)`**, inserted immediately
> after the superseded one, gives the current, plan-ready answers. Read the new section first; it
> tells you which parts of the old one to still rely on.

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

> **Refreshed 2026-08-01, post-14:57 — read "VICE (host emulator, via MCP)" literally as "the
> executing agent's own direct `mcp__vice__*` tool calls" in every row above, never as a Node script
> speaking to the emulator on the agent's behalf.** The "Node tooling (container)" secondary tier in
> the RAM/chip-state-capture row is correspondingly narrower than it reads: it is pure post-processing
> over data the agent already fetched and handed in (assembling a buffer from hex chunks, hashing it,
> writing sidecars) — it holds no MCP call of its own, not even one wrapped behind an injected
> function parameter. This map's tier assignments are otherwise unaffected by the 14:57 rule; only
> the *mechanism* by which the primary tier is reached changed (agent tool calls, not a transport
> module), which is exactly why this map's rows didn't need to move.

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

> **Refreshed 2026-08-01:** the tool signatures below are still accurate and still HIGH confidence —
> `vice_watch_add`/`vice_checkpoint_add` did not change. What changed is *which instance* they get
> aimed at and *how the resolved sentinel data was found to be wrong once actually exercised live*.
> See `## Phase 01-04 Redo — Broker-Route Findings` for the corrected `loader_ranges` data, the
> attribution requirement the reverted run skipped, and the acquisition-route decision the planner
> must make explicit. Do not re-arm `recovery/RELEASES.json`'s current `danish`/`saeger` watch data
> verbatim without reading that section — the reverted run found and partially fixed a real defect in
> it (`$08F5-$08F7` misclassified as loader code) before the rest of the run was reverted along with
> the fix.

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

## Phase 01-04 Redo — Broker-Route Findings (Refreshed 2026-08-01, 12:46) — SUPERSEDED 2026-08-01, post-14:57

> **SUPERSEDED.** This whole section reasons about which acquisition route (`vice-pool.mjs`
> vs. Phase 01.2's broker) a standalone `tools/*.mjs` CLI should use to reach the emulator. The
> 14:57 hard rule (`.claude/CLAUDE.md` § "Emulator Access") makes both routes equally prohibited —
> no standalone script may reach the emulator at all, by either route, and reimplementing the route
> cleanly (which is exactly what Q1/Q9's recommended `tools/lib/vice-acquire.mjs` seam would have
> done) is explicitly named as the same violation as importing the transport directly. **Do not build
> anything this section recommends building.** See the new `## Phase 01-04 Redo — MCP-Only-Rule
> Findings` section immediately below for what replaces it.
>
> Kept for the facts that remain true and useful regardless of acquisition route, each re-flagged
> inline where it appears: the six-outage host-VICE-hang diagnosis and its cycles-flat/`vice_ping`
> "running" signature (Q1's diagnostic content, not its acquisition recommendation); the two
> independent liveness signals and why neither subsumes the other (Q2); the corrected `loader_ranges`
> data and the requirement that every hit be attributed before it is called anything (Q4); the
> absence-as-evidence shape a null result must take (Q5); the open, unmeasured missed-input-recovery
> question (Q6). Q1's acquisition-route table, Q3's lease-lifetime analysis, Q7's "reuse
> `ram-capture.mjs`'s `capture()`" recommendation, Q8's do-not-rebuild file table and Q9's
> `watch-loads.mjs` keep/change list are **all dead** — every one of them assumes a standalone script
> can hold or adopt a transport, which is now false by construction (`tools/` holds three files,
> none of which import a transport, and `c64-ram-capture`'s scripts — including `ram-capture.mjs`
> itself — no longer exist).
>
> This section targeted the RECOVER-04 refresh only; nothing above this point (or in the
> "Normalisation and diffing" / "Crack-independence evidence" subsections, which belong to
> 01-05/01-06) was rewritten by either refresh.

### Q1 — The hang, diagnosed: pause-without-resume vs. genuine host hang vs. pool contamination

> **SUPERSEDED — the diagnosis below (items (a)/(b)/(c) and the six-outage history) is still true
> and still relevant background; the "does the broker fix this" framing and the closing
> pool-vs-broker property table are moot.** Under the 14:57 rule there is no standalone script
> acquiring anything — the agent's own tool calls always go through `vice-proxy.mjs`, which has
> always spoken the broker protocol since Phase 01.2 shipped. There is no second route to compare it
> against any more. What survives: the host VICE hang is real, unexplained, and predates and
> postdates this entire acquisition question — treat it as an operational risk the redo must detect
> (Q2's cycle bracket) and recover from (checkpoint/snapshot resumability), not as something the
> acquisition choice fixes.

**[VERIFIED: git history + STATE.md, this session]** The reverted run's own final commit message
(`7da03fc`, before revert) states the exact symptom: *"after the F7 probe, all three VICE pool
instances were found hung (`vice_ping` reports `"running"` but `vice_cycles_stopwatch` shows zero
cycles elapsing, and a hard reset does not recover it)."* Three independent, previously-established
facts let this be triaged precisely rather than left as a vague "VICE flaked again":

1. **(a) Pause-without-resume is ruled out, not merely unlikely.** This project settled the
   pause-on-state-read discipline in plan 01-01 (poll with `vice_ping`, which does not pause the
   machine, and resume exactly once before it — see `01-01-SUMMARY.md`'s "Notes for Future Phases").
   The reverted run's own commit messages show this discipline was already in active use
   (`cfc9d83`/`067c0d9`/`7da03fc` all describe checkpoint-gated, non-sleep synchronisation). More
   decisively: `vice_ping` reporting `"running"` is itself inconsistent with "someone forgot to
   resume" — an un-resumed machine reports `execution: "paused"` (see the original research's live
   sample above), not `"running"`. The symptom is a contradiction between two things VICE itself
   reported (running, yet zero cycles), not an omitted resume call.
2. **(b) Genuine host-side VICE hang is the best-supported explanation, and it is NOT new.**
   STATE.md already carries an unresolved, six-outage history from *before* 01-04 even started
   (`[HOST INSTABILITY — Phase 1, 2026-07-30]`), with four of six outages self-recovering and two
   needing a manual host restart, and an explicit note that "root cause remains unknown." The 01-04
   hang matches this pattern's shape exactly (a `vice_ping`-alive-but-non-advancing machine that a
   `machine_reset` — the "hard reset" — did not fix) and is best read as the **same unresolved
   host-side fault recurring**, not a new failure mode 01-04 introduced.
3. **(c) Shared-pool cross-contamination is a plausible *contributing* factor but is not proven, and
   is distinct from (b).** All **three** pool instances (ports 6510/6511/6512) hung
   **simultaneously**. Three independent x64sc processes failing at once is unusual for an
   independent per-process bug, and is more consistent with a **host-level resource or scheduling
   event** (CPU starvation, memory pressure, a host sleep/suspend cycle) affecting all three at once
   than with one session's *actions* corrupting a *different* session's leased instance in the sense
   "cross-contamination" usually means. **[ASSUMED — LOW confidence]:** this project has no
   instrumentation that distinguishes "one host-level event took down three processes" from "the
   third leased instance was independently unlucky at the same moment." Treat root cause as
   genuinely open, per STATE.md's own standing admission, not as solved by this refresh.

**The load-bearing answer to "does the broker fix this or relocate it":** **neither, cleanly — it
changes the *exposure*, not the *mechanism*.** Three independent facts, all `[VERIFIED: code
inspection, this session]`, establish this:

- `tools/recover.mjs`, `tools/chip-state.mjs`, and the reverted `tools/watch-loads.mjs` all import
  `acquire` from `.claude/mcp/vice/vice-pool.mjs` (`tools/recover.mjs:21`) — the **pre-01.2 fixed
  pool** (`vice-pool.sh`, long-running supervised instances on fixed ports). None of them import
  anything from `vice-broker-client.mjs`.
- Every one of Phase 01.2's five plan summaries states, verbatim, in its "Next Phase Readiness"
  section: *"`vice-pool.sh`, `vice-pool.mjs`, `tools/recover.mjs`, `tools/chip-state.mjs`,
  `tools/watch-loads.mjs` remain completely untouched... the non-MCP recovery pipeline's own lease
  mechanism is unaffected."* This is not an oversight; `tools/README.md:443` documents it as a
  **deliberate** design: *"a programmatic seam: two library consumers that are not the proxy."*
- The broker (`vice-broker.sh` / `vice-broker-client.mjs`) is wired into exactly one consumer:
  `.claude/mcp/vice/vice-proxy.mjs`, the stdio MCP server `.mcp.json` registers as `"vice"` — i.e.
  the tools the **live agent** calls directly as `mcp__vice__*` during a conversation. It is not
  reachable from a `node tools/whatever.mjs` script invoked over Bash unless that script is
  explicitly rewritten to speak the broker protocol itself (see Q9).

So: **if the 01-04 redo keeps driving detection/play-through through `tools/recover.mjs`-style
standalone Node CLI verbs unchanged, it is running on the exact same pool infrastructure that hung
— the broker changes nothing for it.** The broker only "replaces the shared-pool infrastructure that
failed" if the redo's mechanical work (arming, play-through, detection) is done via the live agent's
own `mcp__vice__*` tool calls (which *do* go through `vice-proxy.mjs` → the broker automatically), or
via new standalone-script plumbing that explicitly acquires a broker lease (Q9). This is the single
biggest architecture decision the planner must make explicit — it is not a detail the executor can
improvise, because the two routes have different failure exposure:

| Property | Pool route (`vice-pool.mjs`, pre-01.2, what hung) | Broker route (`vice-proxy.mjs`, Phase 01.2) |
|---|---|---|
| Instance lifetime | Long-running, shared across many sessions/scripts | Boot-fresh per session, torn down at session end |
| Concurrent x64sc processes | 3, always running | 1 per active session, 0 when idle (plus warm spares if configured) |
| Cross-session contamination | Possible (same instance reused across unrelated work) | Structurally removed (D-1.2-C) |
| The specific "3 pool instances hung" failure | Reproduces exactly as observed | Cannot recur in the same shape (only ever 1 instance per session) — but a *single* boot-fresh instance can still hang for the same unresolved host-side reason |
| Underlying root cause (six unexplained host outages) | Unaddressed | Unaddressed — the broker was never designed to fix this, only to change resource-sharing shape |

**Conclusion, stated plainly:** switching to the broker route removes the "three simultaneous
victims" shape of this specific failure and removes stale-session cross-contamination as a
contributing cause, both genuine wins. It does **not** resolve the underlying, still-unexplained
host VICE hang risk documented across six prior outages — that risk transfers to a single instance
per session rather than three. **[ASSUMED — LOW confidence, flagged for the planner rather than
smoothed over]:** whether a single freshly-booted instance hangs at a materially lower rate than a
long-running pool instance is not measured anywhere in this project; it is a plausible inference
(less accumulated state, less concurrent host load), not a verified fact.

### Q2 — Liveness under the broker: two different signals, both needed, neither is the other

Two genuinely different questions hide under "is it alive," and this project has separate,
already-established answers for each:

**(A) Is the *emulator* advancing, as distinct from merely answering `vice_ping`?**
`vice_ping` reports the MCP server's own view of `execution` state (`"running"`/`"paused"`) — this is
process-alive-and-responsive, not proof the 6502 is retiring instructions. The reverted run's own
hang signature (`vice_ping` "running", `vice_cycles_stopwatch` flat) is the textbook case this
distinction exists to catch. **Mechanical recipe, `[VERIFIED: tool schema, this session]`:**
```
vice_cycles_stopwatch({action: "reset"})
# ... drive one scripted input / advance to the next checkpoint ...
vice_cycles_stopwatch({action: "read"})   # or use "reset_and_read" for the bracket in one call
```
A non-increasing (or zero) cycle count across a window where input was scripted to occur is the
hang signature, and is the check the reverted run's own `067c0d9`/`7da03fc` did NOT bracket
*continuously* through the play-through (it was only discovered post-hoc, "after the F7 probe").
The redo should bracket cycles across every scripted input, not just check it reactively once
something already looks wrong.

**(B) Has the underlying machine *restarted* mid-run (a different process/epoch), so results since
then are void?** This is what the project's epoch mechanism answers, and it is a **different**
question from (A) — a restart changes epoch; a hang does not (the process never died, so nothing
re-spawned, so nothing increments the epoch counter). **This is the sharp distinction the research
question asks for and it must not be collapsed:** a cycles-flat/`vice_ping`-alive hang is invisible
to epoch checking, and an epoch change is invisible to a single cycles snapshot (a freshly restarted
machine still reads *some* cycle count from zero — only a *before/after* bracket across a suspected
restart catches it, and even then a fast restart can look like slow-but-nonzero progress). Both
checks are required; neither subsumes the other.

Under the broker route specifically, epoch-drift detection is **already wired automatically** and is
a genuine improvement over the old per-process route:
`[VERIFIED: code inspection, this session]` `vice-proxy.mjs`'s `handleToolsCall` calls
`checkEpochAndRebaseline("before forwarding")` on **every** forwarded `tools/call` (`vice-proxy.mjs`
around line 1090), refusing with an evidence-carrying error (both epoch values named) if drift is
detected — this happens for *every* live-agent `mcp__vice__*` call with zero extra code from the
executor. Contrast with the pool-route's `tools/vice.mjs`, whose epoch baseline lives in **per-process
module state** (`beginSession()`/`assertSameMachine()`) and resets on every separate `node
tools/whatever.mjs` invocation — so a standalone-script-driven play-through only gets epoch
protection *within one Node process's lifetime*, and only re-checks it after a **transport-forced
reconnect** actually happened, not continuously. This is a concrete, non-cosmetic reason to prefer
the live-agent-driven route for a long play-through, independent of the pool-vs-broker instance
question above.

**Executor-liveness (a different layer again — orchestrator, not emulator):** `[VERIFIED: STATE.md
+ git show b66b72f, this session]` this is the commit the objective points at, and it answers a
**third** question — not "is VICE advancing" but "is the *executor process running this plan* still
alive." Its finding, which must not be re-derived or contradicted: `readlink /proc/*/cwd` (and
worktree-write / commit activity) are **not** reliable negative liveness signals for an
emulator-driving executor, because legitimate long emulator work over HTTP produces **no** worktree
writes, no commits, and no cwd-holding process for many minutes at a stretch — exactly the shape of
a real, long play-through. Acting on this signal previously caused an orchestrator watchdog to
force-remove a *live* executor's worktree after 772s of quiet. **Consequences that bind the 01-04
redo directly:** (1) there is no known cheap negative test for executor liveness during this kind of
plan — absence of worktree activity is not evidence of death; (2) never destroy a worktree on
inferred death; (3) any stall check for a plan like this must be advisory (surface and ask) — never
actuating. If the redone 01-04 plan is executed under the same orchestration harness, this
constraint must be respected by whatever runs it, independent of anything VICE-side.

### Q3 — Lease lifetime vs. play-through duration

> **SUPERSEDED.** This entire analysis is about a standalone script acquiring and holding its own
> broker lease across a long play-through — not applicable when the agent's own tool calls are the
> only thing ever touching the emulator. The agent's session *is* the lease; `vice-proxy.mjs` manages
> its heartbeat and touch-on-every-call refresh automatically, with zero code for anyone to write.
> The one number worth carrying forward as background confidence: a full bounded play-through
> (title → chamber transition → both opponents → death → game over → restart) is comfortably short
> relative to the measured idle-session and per-call time budgets this section found, so nothing
> about session/lease lifetime is expected to constrain the agent-driven redo. The milestone-snapshot
> recommendation (save state at each play-through milestone, name it session-scoped, record the name
> plus progress in a file) is still good practice and is carried into the new section below.

**A full bounded play-through (title → chamber transition → both opponents → death → game over →
restart) comfortably fits inside a single broker lease, with wide margin, `[VERIFIED: spike-findings
+ 01.2 code, this session]`:**

- The lease is refreshed by **two** independent mechanisms while a session is active:
  `touchLease(brokerLeaseId)` on **every forwarded tool call** (`vice-proxy.mjs`, "touch-on-every-
  forwarded-call") and an **unref'd heartbeat timer** (`startHeartbeat`, default 60s interval,
  `vice-broker-client.mjs`).
  `VICE_BROKER_TTL_S` (lease staleness threshold, default **180s / 3 minutes**) is checked by the
  broker's sweep; 60s heartbeats leave 3× headroom even with *zero* tool calls in between.
- `spike-findings-bruce-lee` measured a live session held **completely idle for 40.1 minutes** with
  **zero** signals and continuous 60.1s-interval heartbeats — i.e. nothing reaps an idle *proxy*
  process either. A play-through with regular tool-call activity (checkpoints, screenshots, joystick
  input) is strictly *more* active than that idle case, so it is not at risk of the proxy-side timer
  either.
- The per-call tool-call budget is **≥150s** (measured floor, not a ceiling) — every individual
  `mcp__vice__*` call in a play-through (a checkpoint arm, a `run_until`, a screenshot) is
  sub-second-to-seconds of real work, nowhere near that floor.

**So a single lease does survive the whole bounded play-through, by a wide margin — no
resumable-segment strategy is *forced* by lease math.** What a resumable-segment strategy is still
good defence against is orthogonal to lease TTL: (a) the executor-liveness watchdog risk from Q2,
(b) a genuine host VICE hang from Q1 forcing an abort mid-run, (c) ordinary session/context loss.
**Recommendation, `[ASSUMED — reasoned from existing project patterns, not separately measured]`:**
snapshot state at each milestone boundary (title-armed, first chamber transition, each opponent,
death, game over, restart) using `vice_snapshot_save` with a **session-scoped** name — not a
port-prefixed one. This is not a new convention: `vice-mcp-selector/SKILL.md` already states *"Namespace
snapshot names by something session-scoped, never by port — ports are recycled across sessions under
on-demand launch, so a port-prefixed snapshot name can collide with an unrelated later session"* —
directly applicable here, and a real behaviour change from the pre-broker pool convention (which *did*
namespace by port, safely, because pool ports were not recycled the way broker ports are). Pair each
snapshot name with a written progress record (which milestone, its cycle count, its screenshot
filename) in a file — not just conversational state — so a resumed session (fresh lease, fresh boot)
can `vice_snapshot_load` the last proven milestone rather than restarting from the title screen.

### Q4 — Detecting an on-demand load mechanically, in real `mcp__vice__*` calls, with false-negative modes

The mechanism itself does not change from the original research (`vice_watch_add`/
`vice_checkpoint_add`, reasoned about in the "On-demand load detection" subsection above) — what
changed is **empirical knowledge about this specific game's code that the reverted run surfaced
live**, which the redo must incorporate rather than re-discover:

**Concrete config, carried forward `[VERIFIED: STATE.md + reverted commit cfc9d83, this session]`:**
- `danish`'s corrected `loader_ranges` (post-fix, pre-revert): `$0340-035E`, `$0900-0901`,
  `$0D64-0D82` — all three read **0** hits during the (truncated) play-through, which is the correct,
  clean signal.
- **`$08F5-$08F7` is NOT loader code** — it is the game's own **permanent joystick-poll instruction**
  inside the title dispatcher's steady-state loop (`$08F5: LDA $DC01 / AND #$10 / BNE $08B1`),
  confirmed by live disassembly. Left armed, it logs a false hit on **every ordinary idle loop
  iteration** (measured: 113 hits from nothing else happening). It was misclassified because of an
  imprecise reading of `recovery/danish/NOTES.md` prose, not a wrong tool. **The redo must not
  re-arm the current `recovery/RELEASES.json` verbatim** — the raw data still carries the pre-fix
  set unless the fix commit's data change is manually reapplied (the fix commit itself, `cfc9d83`,
  was reverted along with everything else).
- `saeger`'s wider `$08E0-$0900` `loader_ranges` window **also contains this address range** and was
  never exercised in the truncated run — verify it the same way (live disassembly of the boundary
  addresses) before arming saeger's set, not by inheriting danish's fix by analogy.
- **Every `unused`-range write-watch hit needs attribution before being called a load event, not
  just a count.** A concrete false positive was found and traced: an `$8E9D-$8FE7` hit traced to
  ordinary room-drawing code (`STA ($04),Y`/`STA ($08),Y` character-plot loop) — structurally
  inevitable because the dumps were captured at the **title screen**, so any RAM that only gets
  written once real gameplay starts reads as "never-populated" in the range manifest and is
  guaranteed to fire the first time gameplay actually runs. **An unattributed non-zero count is as
  worthless as an unearned zero** (STATE.md's own words) — the redo's detector must call
  `vice_backtrace`/`vice_disassemble` at the PC when a watch fires and record what code caused the
  write, before logging it as evidence either for or against an on-demand load.

**False-negative modes, reasoned from the mechanism's own shape (no additional live testing
performed this session — these are structural, not measured):**
- The `$DD00` (CIA2 port A) watch only catches a loader that toggles VIC-bank bits or bit-bangs the
  serial bus through *that specific register*. A hypothetical in-game loader using a different
  mechanism entirely would not trip it.
- Loader re-entry exec checkpoints only cover **address ranges already observed executing during
  boot**. A distinct in-game loading routine that was never exercised during boot (and therefore
  never recorded in `NOTES.md`/`loader_ranges`) would not be covered.
- Unused-range write-watches only catch writes into ranges that were **genuinely unpopulated at the
  specific dump-point capture**. A load that overwrites a range already touched by some unrelated
  boot-time initialisation would not be flagged as "unused," producing a silent miss.
- Bounded (not exhaustive) play coverage means anything outside the states actually reached is
  simply unknown, not ruled out — this is already handled honestly by D-11's "coverage not reached"
  requirement and should stay that way.

### Q5 — Absence as evidence: what must be recorded for a null result to be honest

The shape required by success criterion 2 and D-10/D-11/D-12 (armed set, coverage reached with
per-milestone screenshot proof, coverage not reached) is unchanged and still the right target — see
the original `01-04-PLAN.md`'s must_haves, which remain valid design even though the plan's *code*
was reverted. **What Q4's findings add, refreshed:** a "zero found" claim is only honest if the
armed set itself has been verified correct first. Given the loader-range misclassification found
live, the redo's evidence trail should explicitly show, for every entry in the armed set: (a) the
address range, (b) **why** it's believed to be loader/cracktro code (a disassembly excerpt or a
backtrace, not just an inherited prose claim), and (c) its hit count. This turns "we armed X, Y, Z
and nothing fired" into a claim that can be checked against the *evidence for X, Y, Z being the
right things to arm*, not just against the fact that arming happened. Coverage-reached proof
(screenshot hash / RAM signature / checkpoint hit) is unchanged from the original design: a
screenshot per milestone, named for what it shows, cross-checked by the same `checkpoint:human-verify`
gate the original plan already specified (Task 3) — that gate's design was sound; only the tooling
underneath the play-through needs to change.

### Q6 — Driving the play-through without wall-clock sleeps; recovering a missed input

The established pattern (checkpoint/`run_until` on a known address or frame position,
`vice_joystick_tap`/`vice_joystick_set`, `vice_ping`-based polling that doesn't pause the machine) is
unchanged and correctly specified by D-12 and the original research. **Recovering from a missed
input is genuinely unresolved by this project's evidence** — the reverted run never progressed past
the title screen, so no real missed-input recovery was ever exercised. `[ASSUMED — LOW confidence,
no empirical basis in this project]`: the generally sound pattern is to verify the *expected state
transition* after each scripted input (e.g. re-read PC, or a screenshot/RAM signature specific to
the expected next state) before advancing to the next input in the sequence, and retry the same
input a bounded number of times if the expected transition didn't occur, rather than proceeding
blindly on a fixed input schedule. This is an open question for the planner to make an explicit,
bounded decision about (e.g. "retry up to N times, then treat as a checkpoint-worthy blocker"),
not something to leave implicit in the executor's judgement.

### Q7 — Supplementary dumps: reuse `c64-ram-capture`, do not build a second capture path

> **SUPERSEDED — the recommended reuse target no longer exists.** `.claude/skills/c64-ram-
> capture/scripts/ram-capture.mjs` and every function this subsection names (`capture()`,
> `classifyRuns()`, `voidRun()`) were **deleted** on 2026-08-01 along with the rest of the skill's
> scripts (`db9eed3`) — `[VERIFIED: this session, ls .claude/skills/c64-ram-capture/ shows only
> SKILL.md]`. The skill was not removed, only its code: `SKILL.md` now documents the identical
> procedure — boot, capture-at-a-trigger, find-entry, prove-no-identity-change, void-a-run,
> compare-two-captures, establish-a-drift-floor — as a sequence of direct `mcp__vice__*` tool calls
> for the **agent** to perform, not a function to import. "Reuse, don't reinvent" still applies, but
> what is reused is the *procedure* (read `SKILL.md`, follow its steps live) rather than a Node
> function. See the new section below for the concrete shape.

**Reuse, don't reinvent — `[VERIFIED: code inspection, this session]`.** `.claude/skills/c64-ram-
capture/scripts/ram-capture.mjs` exports exactly the primitives a supplementary dump needs:
`capture()` (checkpoint + read + chip-state, releasing held keys at the trigger, per its own SKILL.md),
`classifyRuns()` (the reproducibility verdict: `ok`/`decayCandidates`/`volatileDiffs`/
`programMismatches`), and `voidRun()` (rename-and-annotate on a proven-bad run). These are the exact
same functions 01-01/01-02/01-03 already validated against the primary game-entry dumps; a
supplementary dump at a load-event milestone is mechanically the same operation at a different
trigger address, and should call the same `capture()` — not a parallel hand-rolled read loop.

**Composition with the registry, unchanged from the original (reverted) plan's design:** register as
a `dumps[]` entry with `kind: "supplementary"` and a `load_event_ref` pointing at the hit record —
`recovery-schema.mjs validate` already understands `dumps[]` as a set (per 01-02), so this needs no
new schema, only new entries.

**Open question this refresh surfaces and does not resolve — flag for the planner:** does a
supplementary dump need the same **N≥3, program-image-identity-under-drift** reproducibility bar
01-01 established for the primary game-entry dumps, or is a single capture sufficient because it is
evidence "a load happened at this observed moment," not a claim of a reproducible steady state? The
primary dump's reproducibility bar exists because the *canonical* image must be provably stable;
a supplementary dump's role (Q13/success-criterion-2 evidence, not a round-trip diff target per se,
unless D-13 resolves to "absorb") may not need the same bar. This is exactly the kind of decision
D-13 was deliberately left open for — the planner should decide it explicitly, not let the executor
infer it.

**Byte-identical-under-drift, if reproducibility is required:** reuse `classifyRuns()` exactly as
01-01 did — same volatile-range exclusions, same single-bit-decay tolerance, same "a real divergence
differs in several bits" rule. No new drift classifier logic should be written for this.

### Q8 — What 01-04 must NOT rebuild — file paths

> **SUPERSEDED — most of this table names files that have since been deleted, and its remaining
> living entries (`releases.mjs`, `recovery-schema.mjs`, `RELEASES.json`, the two `.map.json`
> manifests) are trivially still correct and did not need this table to establish. Do not use this
> table to decide what to import** — `tools/recover.mjs`, `tools/chip-state.mjs`,
> `.claude/skills/c64-ram-capture/scripts/ram-capture.mjs`, `.claude/mcp/vice/vice.mjs`,
> `vice-pool.mjs` and `vice-broker-client.mjs` are all either deleted or off-limits to `tools/`
> under the 14:57 rule regardless of whether anything "broke." The one still-relevant instruction
> this table encoded — do not reimplement the capture path, the drift classifier, the registry
> schema or the deny-list enforcement — is restated in the new section below without reference to
> any deleted file.

| Machinery | Path | Reuse as |
|---|---|---|
| Capture/reproduce/boot/find-entry CLI | `tools/recover.mjs` | The proven capture procedure — if the acquisition-route decision (Q1/Q9) keeps the pool route, call it unchanged; if it moves to the broker route, only its **acquisition call** needs a broker-lease equivalent, not its capture logic |
| Chip-state sidecar + range manifest | `tools/chip-state.mjs` | `captureChipState`, `buildRangeManifest` — unchanged |
| Registry read/write | `tools/releases.mjs` | `release()`, `upsertRelease()`, `schemaNotes()` — unchanged |
| Schema/parameterisation gate | `tools/recovery-schema.mjs` | `validate`, `validate --final`, `check-parameterisation` — unchanged |
| RAM capture + drift classification | `.claude/skills/c64-ram-capture/scripts/ram-capture.mjs` (+ `ram-compare.mjs`) | `capture`, `attachAndStart`, `findEntry`, `voidRun`, `classifyRuns`, `VOLATILE_RANGES` — unchanged, see Q7 |
| MCP transport seam (pool route) | `.claude/mcp/vice/vice.mjs` | `call()`, `useInstance()`, `activeInstance()`, `DENY_LIST`, `readEpoch`, `beginSession`, `assertSameMachine`, `MachineRestartedError` — this is the seam a broker-lease helper would still redirect via `useInstance()`, exactly as `vice-proxy.mjs` does |
| Old fixed-pool client | `.claude/mcp/vice/vice-pool.mjs` | Only if the planner explicitly keeps the pool route (not recommended, see Q1) |
| Broker protocol primitives | `.claude/mcp/vice/vice-broker-client.mjs` | `newRequestId`, `writeRequest`, `createLease`, `pollGrant`, `touchLease`, `releaseLease`, `startHeartbeat`, `readBrokerLiveness` — the primitives a new broker-lease helper for standalone scripts would compose (see Q9); nothing here is proxy-private |
| Grant host→container coordinate translation | `.claude/mcp/vice/vice-proxy.mjs`'s `containerizeGrant()` (private, ~line 887) | **Not currently exported/reusable** — a gap; a standalone broker-lease helper needs this logic too and it would need extracting or duplicating (see Q9) |
| Registry data | `recovery/RELEASES.json` | The release registry — **but its `loader_ranges` for `danish` need the `$08F5-$08F7` fix reapplied before re-arming** (Q4); do not treat current file contents as already-correct |
| Range manifests (unused-range source) | `recovery/danish/dumps/*.map.json`, `recovery/saeger/dumps/*.map.json` | Already committed by 01-02, unchanged, the source of the `unused`-range watch list |

A plan that reimplements the capture path, the drift classifier, the registry schema, or the deny-list
enforcement is wrong — none of that broke, and the revert did not touch it.

### Q9 — Rebuilding `tools/watch-loads.mjs`: what to keep, what to change

> **SUPERSEDED — "Must change" item 1 (the acquisition call) is now answered differently: there is
> no acquisition call, in either recommended or alternative form.** Both options this subsection
> offered (`adopt-seam`'s new broker-lease helper, or `keep-pool`) required a standalone script to
> hold a transport; the hard rule forecloses both, leaving only what this subsection already called
> the "more plumbing-averse, less scriptable" third path — driving everything through the agent's own
> tool calls — as the *only* legal option, not one of three. Items 2–5 below (the `disarm`
> target-instance bug class, the `loader_ranges` data fix, per-hit attribution, and enumeration-
> proven teardown) are still exactly right and are restated, adapted to the agent-driven shape, in
> the new section below. The "keep verbatim" pure-logic functions (`attributeAddress`, `reportHits`)
> remain a sound design for a pure, emulator-free module — what changes is that such a module can
> never itself arm, disarm, or otherwise call the transport, not even behind an injected function
> parameter that nothing in `tools/` is permitted to fill with a real implementation.

Read directly (`git show bb0b1f7^:tools/watch-loads.mjs`), `[VERIFIED: this session]`:

**Keep verbatim — this logic was correct and is exactly why it should not be redesigned:**
- The pure resolution functions: `WATCH_SET(releaseId)` (building the sentinel list from
  `recovery/RELEASES.json`'s `loader_ranges` and the range manifest's `unused` ranges, never
  hardcoded), `attributeAddress` (exactly-one-owner-per-address, abutting ranges stay separate),
  `reportHits` (cycle-then-address deterministic ordering).
- `disarmAll`'s enumerate-then-delete-individually pattern (`vice_checkpoint_list` +
  `vice_checkpoint_delete` per id) — there is still no bulk-clear tool.
- `armWatchSet`'s call-`disarmAll`-on-partial-failure guard (T-01-17) — still correct, still needed.
- The `checkpoint_num` (not `id`/`number`) field name for `vice_checkpoint_delete` — a real API fact,
  independent of the revert.

**Must change:**
1. **The acquisition call.** Line ~343-344 of the reverted file: `const lease = await
   acquire();` (from `vice-pool.mjs`) `useInstance(lease);`. This is the one line that ties the tool
   to the infrastructure that hung. Two options, and the planner must pick one explicitly:
   - **(Recommended) Drive arming/play-through/detection via the live agent's own `mcp__vice__*`
     tool calls directly, with no standalone `watch-loads.mjs` CLI invocation at all** — this
     automatically rides the broker (Q1/Q2's automatic epoch-drift wins apply for free) and needs no
     new plumbing. The pure logic (`WATCH_SET`, `attributeAddress`, `reportHits`) can still live in
     `tools/watch-loads.mjs` as an importable, emulator-independent module the executor's own
     reasoning is checked against — it just stops being a thing invoked over Bash as `node
     tools/watch-loads.mjs arm ...` against a live emulator.
   - **(Alternative, more plumbing) Give the standalone CLI its own broker-lease acquisition**,
     mirroring what `vice-proxy.mjs` already does: `newRequestId()` → `writeRequest()` →
     `createLease()` → `pollGrant()` → containerize the grant's coordinates (duplicating or
     extracting `containerizeGrant()`, currently private to `vice-proxy.mjs`) → `useInstance()` →
     ... → `releaseLease()` at the end. This keeps the CLI-tool shape but requires new code that does
     not exist yet anywhere in the tree.
2. **The `disarm` verb's target-instance handling.** The reverted version's `disarm` acquired its
   **own fresh pool lease** rather than tearing down the specific instance `arm` had used, and
   separately did not honour a `VICE_MCP_URL` override — STATE.md records both as real, found bugs
   (`174` checkpoints left armed on port 6511 with the override set). Whichever acquisition route is
   chosen, `arm` and `disarm` must operate against the **same** instance/lease — never re-acquire.
   Under the live-agent-driven recommendation above this class of bug is structurally avoided (one
   session, one lease, one instance for the whole procedure); under the standalone-CLI alternative it
   must be handled explicitly (persist the lease id/instance between `arm` and `disarm` invocations).
3. **The `loader_ranges` data itself**, per Q4 — reapply the `$08F5-$08F7` exclusion for `danish`
   before re-arming, and verify `saeger`'s wider range live before trusting it.
4. **Attribution on every non-loader hit**, per Q4/Q5 — add a `vice_backtrace`/`vice_disassemble`
   call at the PC when an `unused`-range watch fires, and record the causing code alongside the hit,
   before it is reported as a load-event candidate.
5. **Always confirm teardown with an explicit read-only `vice_checkpoint_list` after `disarm`**,
   rather than trusting the disarm call's own return value — STATE.md's own recommendation, carried
   forward independent of which acquisition route is chosen.

## Phase 01-04 Redo — MCP-Only-Rule Findings (Refreshed 2026-08-01, post-14:57)

> **This is the current, authoritative analysis for replanning 01-04/01-05/01-06.** It supersedes
> the section above in every place they disagree. Everything below was reasoned about statically —
> by reading committed code, git history and this project's own `CLAUDE.md`/`STATE.md` — not
> verified by making any `mcp__vice__*` call, because this research pass has no such tools. Every
> claim about "what the agent should do live" is written as an instruction for the executing plan to
> follow and empirically confirm, not as a finding already proven this session. Confidence levels are
> stated per claim.

### 1. What shape does emulator-driving work take now?

**All emulator contact is a direct `mcp__vice__*` tool call made by the plan's own executing agent,
in its own turn — never a `node tools/whatever.mjs` invocation, and never a call routed through a
new helper module that itself imports a transport, however thin.** `[VERIFIED: code inspection —
tools/ contains exactly releases.mjs, d64-parse.mjs(+test), recovery-schema.mjs; none imports a
transport, confirmed by grep]`. `tools/watch-loads.mjs` is rebuilt as a **pure logic module**: it
takes already-fetched data as its only input (a hit-log JSON the agent produces as it works) and
never arms, disarms, reads, or in any way calls `vice_*` itself, not even behind an injectable
transport parameter — the whole point of the rule is that no file under `tools/` may be capable of
reaching the emulator, and an injectable-but-real transport is exactly the shape Pitfall 7 above
warns against.

**The concrete seam, stated as a data contract rather than a code seam:**

1. **Sentinel data lives in `recovery/RELEASES.json`**, exactly as the (superseded) `WATCH_SET`
   design intended — `loader_ranges[]` and a derived `unused`-range list from each release's
   `.map.json` — but this data is now *earned by the agent performing live disassembly directly*
   (`mcp__vice__vice_disassemble` at each candidate range's boundary addresses, per Q4/Pitfall 6
   above, which are unaffected by this rule change) and written into the registry by the agent (via
   `Write`/`Edit`, not by a script that also armed the checkpoint).
2. **Arming is a sequence of direct tool calls the agent performs and narrates as it goes**:
   `mcp__vice__vice_checkpoint_add` per `stopping`-tier sentinel, and (per the still-open probe in
   the superseded Task 3 Step 2 above, unaffected by this rule change) either
   `mcp__vice__vice_checkpoint_add` with stopping disabled or `mcp__vice__vice_watch_add` per
   `counting`-tier sentinel — whichever the probe proves actually accumulates a count without
   stopping the machine. The agent records each returned `checkpoint_num` as it arms.
3. **The idle-calibration window, the play-through, and hit attribution are all agent-performed
   live**, exactly as the superseded Task 3/Task 4 actions already described in terms of
   `mcp__vice__*` tool calls (those actions were already written this way — they were never Node
   script instructions; only Task 2's acquisition-seam module was) — resume once, poll with
   `vice_ping`, read the checkpoint list, disassemble/backtrace at the PC when a counting-tier
   sentinel's count exceeds its idle floor, and so on.
4. **The agent writes the observations it collects into a committed hit-log JSON** as it works — one
   record per hit (`sentinel`, `address`, `cycle`, `checkpoint_num`, and, for attribution, the
   disassembly/backtrace text it read live at that PC) — via the `Write` tool, not via a script that
   also performed the read. This file (e.g. `recovery/<release>/dumps/<release>-loading-hits.json`)
   is the boundary artifact: everything upstream of it is live agent-tool-call work; everything
   downstream of it is pure logic.
5. **`tools/watch-loads.mjs`'s pure functions consume that hit-log file** — `attributeAddress` (one
   owner per address, abutting ranges separate, overlap throws), `reportHits` (total order: cycle,
   then address, then sentinel name), a hit-log reader/validator, and a `recovery/LOADING.md`
   renderer — and are fully unit-testable offline with `node --test`, exactly as the superseded
   Task 2's acceptance criteria already specified for these specific functions (only `WATCH_SET`,
   `armWatchSet` and `disarmAll`'s *live-calling* behavior is gone; their *data-shape* and *ordering*
   contracts survive as pure functions operating over the registry and the hit log).

**How a plan expresses "the agent does X live" as a checkable task, when the proof is a committed
artifact rather than an exit code:** this project already has the pattern for this — the superseded
Task 3/Task 4 actions above are already written this way (they instruct the agent to call specific
`mcp__vice__*` tools and record specific results), and their acceptance criteria already check the
*committed record* (a non-empty `evidence` field, an `idle_hits` value of exactly `0`, a screenshot
file that exists on disk, a `checkpoint:human-verify` task that opens each screenshot and confirms it
shows the claimed state) rather than an automated exit code proving the live work happened correctly.
**What genuinely changes is only Task 1 and Task 2** of the superseded plan: Task 1's
`checkpoint:decision` about *which acquisition route* is no longer a decision with options — there
is exactly one legal shape, so a plan should state this as a fact needing no checkpoint, and Task 2's
`tools/lib/vice-acquire.mjs` module (and its repointing of `tools/recover.mjs`/`tools/chip-state.mjs`,
both now deleted) is deleted from the plan entirely, not rewritten. `[ASSUMED — ordinary engineering
judgement, ex-post about a plan I cannot execute]`: an acceptance criterion like "`node
tools/watch-loads.mjs report --release danish --json` exits zero and is byte-identical across two
runs" remains exactly as checkable as it was before, because it operates over the *committed hit-log
file*, not over a live emulator — this is unaffected by the rule change and should be kept verbatim.

### 2. How is a procedure made repeatable without a runnable command?

**Recommendation: accept that the mechanism changes from "a command reproduces the dump" to "a
documented tool-call procedure, precise enough for a different agent session to replay by issuing
the same `mcp__vice__*` calls in the same order, reproduces the dump" — and record this explicitly
rather than let success criterion 1 quietly go unmet.** Three observations support this as the right
call rather than a concession:

- **For RECOVER-01/02/03, the criterion is already satisfied *as executed*, and that evidence is
  permanent.** `[VERIFIED: 01-01-SUMMARY.md, committed artifacts]` `node tools/recover.mjs reproduce
  danish --runs 3` was run three times and produced the N≥3 program-image-identity proof this
  criterion demands, and the three SHA-256 digests plus the comparison result are committed in
  `recovery/danish/NOTES.md` and `recovery/RELEASES.json`. Deleting the script that produced that
  evidence does not un-produce the evidence — the fact "this procedure is reproducible" was proven
  once, by a mechanism indistinguishable in principle from an agent issuing the same calls by hand
  (the script's inner loop *was* a sequence of `vice_*` tool calls; only its packaging as an
  unattended Node loop is now prohibited). What is lost is **convenience** — the ability to re-invoke
  that proof with one shell command in the future — not the evidentiary weight of the proof already
  on record.
- **`recovery/<release>/NOTES.md` is already written at the precision a replaying agent needs.**
  `[VERIFIED: recovery/danish/NOTES.md, recovery/saeger/NOTES.md, read this session]` The `trigger.
  how_located` narratives already read as literal tool-call transcripts — exact addresses, exact
  `vice_disassemble` output quoted, exact gate key and hold duration, exact port value at dump time —
  which is precisely the "written tool-call procedure ... precise enough for another agent to
  replay" option named in this research's brief. This was true before the hard rule existed; the
  rule just removes the *alternative* (a runnable command) that made this property easy to overlook.
- **A pure-logic verifier checks a *result*, and that is a genuinely different, weaker claim that
  must not be blurred with reproducibility.** `tools/recovery-schema.mjs validate` (unaffected by
  this rule, still callable, still pure Node) confirms a committed dump's artifact set is complete
  and internally consistent — right length, hash matches the file, sidecars present — but it cannot
  confirm that *re-running the procedure* would produce the same bytes, because it never re-runs
  anything. Recording "the schema validates" as if it were "reproducibility is proven" would be
  exactly the kind of laundered confidence this project's own architecture explicitly forbids
  (ARCHITECTURE.md Anti-Pattern 5's spirit, applied to a claim rather than a byte range).

**Recommendation for the planner, stated as an explicit choice rather than left implicit:** record in
the phase's plan/summary that RECOVER-01/02/03's success-criterion-1 reproducibility was
**demonstrated once, by a now-deleted script whose evidence is permanently committed**, and that any
*future* re-verification (if ever needed — e.g., after a VICE version upgrade, per this research's
own "Valid until" note) must be performed by an agent replaying `NOTES.md`'s documented tool-call
sequence directly, not by re-running a command. This is a real, honest downgrade in convenience that
should be named rather than smoothed over — do not write a plan task implying a command still exists
to re-check this. For 01-04 itself, this was always going to be true regardless of the hard rule:
D-12 already required recording the play-through's input sequence as plain notes, explicitly not a
`verify/scripts/` artifact, so 01-04's own reproducibility posture was never going to rest on a
runnable replay command in the first place.

### 3. What do the dangling downstream dependencies get instead?

**D-11 → plan 02-02 ("a command to re-arm the watch set"):** replace "a command" with **a data
contract plus a documented procedure** — `recovery/RELEASES.json`'s `loader_ranges[]` and resolved
`watch_set[]` (the earned sentinel list, with each entry's address range, tier, type and arming
reason) is the re-armable *specification*, and plan 02-02's own executing agent re-arms it live by
issuing the same `mcp__vice__vice_checkpoint_add`/`vice_watch_add` calls this phase's NOTES.md/
`RELEASES.json` describe, using `tools/watch-loads.mjs`'s pure `attributeAddress`/`reportHits`
functions to interpret whatever it observes. "Re-arming the watch set" becomes "the agent, reading
the registry's `watch_set` entries, arms each one live and records the result" — a hand-off of
**data and procedure**, not of an executable. `[ASSUMED — reasonable given the rule, not yet acted
on by any plan]`: this means plan 02-02's own plan text must itself describe this as agent-performed
work with the same "committed record, not exit code" acceptance-criteria shape as 01-04 — it should
not assume a command exists to shell out to, and the 01-04 replan should say so explicitly so 02-02's
own future planning isn't surprised by it.

**VERIFY-01 → Phase 3 ("a deterministic input script format and a replay driver over the `vice_*`
MCP tools"):** this is the more load-bearing casualty, and it belongs to Phase 3's own
discuss/research/plan cycle to resolve fully — flagging it here only to the depth this replan needs.
The literal requirement text ("a replay driver over the `vice_*` MCP tools") describes exactly the
prohibited shape: a piece of software that autonomously drives the emulator. **What it likely becomes
instead:** a deterministic input **script** as a *data format* (e.g., an ordered JSON list of
`{trigger: {checkpoint|frame}, action: {joystick_tap|joystick_set|...}}` steps) that is *replayed* by
an agent (or, in principle, any human or future MCP client) issuing the corresponding `mcp__vice__*`
tool calls one step at a time — the determinism guarantee comes from the script's own precision
(checkpoint-gated, frame-gated, no wall-clock) and from the agent executing it faithfully, not from
an unattended program executing it. D-12's "input sequence recorded as plain notes, not a
`verify/scripts/` artifact" already points in exactly this direction; VERIFY-01 was always going to
need to formalise that shape into a real, reusable data format, and the hard rule simply forecloses
the one framing (an autonomous replay driver) that the requirement's literal wording still allowed.
**This is not resolved here** — it needs Phase 3's own discuss-phase to confirm the developer accepts
"script-as-data plus agent-as-interpreter" as VERIFY-01's shape, since it changes what "passing
verification" can mean (a human/agent must be present to run a replay, rather than a CI job invoking
a binary unattended). Recorded as an open item for Phase 3's own research, not decided by this
phase's replan.

### 4. What happens to SKELETON.md?

**Recommendation: retire the "Emulator control transport" row explicitly, with a dated superseding
note, rather than leaving it to silently describe a decision that is now impossible.** This research
does not edit `SKELETON.md` itself (out of this document's scope), but the planner (or a `/gsd-quick`
task run alongside the 01-04 replan) should replace that row's "Choice" column — currently "A single
Node module, `tools/vice.mjs`, speaking MCP JSON-RPC ... with a documented fallback of shelling out to
`curl`" — with something to the effect of:

> **SUPERSEDED 2026-08-01.** `mcp__vice__*` tool calls made directly by the executing agent are the
> only permitted route; no Node module of any kind may speak MCP JSON-RPC to the emulator, and the
> `curl` fallback this row named is equally prohibited. `tools/` holds pure logic only. The
> "Rationale" column's premise — that success criterion 1 and Phase 3's VERIFY-01 both require a
> runnable command — no longer holds; see `01-RESEARCH.md` § "Phase 01-04 Redo — MCP-Only-Rule
> Findings", items 2 and 3, for what replaces each.

The row's original rationale ("D-09 requires a *scripted* `machine_reset`", "VERIFY-01 independently
requires a replay driver") should not be deleted either — it is useful history explaining why the
original architectural decision was made in good faith, and both of the claims it rested on are
addressed by items 2 and 3 above. **This retirement should happen before or alongside the 01-04
replan**, not after, because SKELETON.md is listed as a canonical reference the planner and any future
executor reads, and an unretired row stating an impossible architectural decision as current fact is
exactly the kind of stale ground-truth this project's own provenance discipline exists to prevent.

### 5. Do 01-05 and 01-06 actually survive?

**Confirmed: yes, unchanged, by direct reading of both plan files this session.**
`[VERIFIED: grep -rn "vice-pool|vice-broker|vice-acquire|containerizeGrant|watch-loads"
01-05-PLAN.md 01-06-PLAN.md` returns zero matches; every `read_first`, `<action>` and
`<acceptance_criteria>` in both plans operates exclusively over already-committed files
(`recovery/{danish,saeger}/dumps/*.bin`, `*.map.json`, `recovery/RELEASES.json`, `recovery/
PROVENANCE.md`) and the `tools/diff-images.mjs`/`tools/recovery-schema.mjs` pair, both pure Node with
zero emulator contact]`. Neither plan makes an `mcp__vice__*` call, imports a transport, or
references any of the files deleted on 2026-08-01 (`tools/recover.mjs`, `tools/chip-state.mjs`,
`tools/README.md`, any `.claude/mcp/vice/*` module, any `c64-ram-capture` script). Both plans were
already correctly scoped as "this step is pure Node-side diffing/registry work, no emulator tool is
involved" back in the original 2026-07-30 research (see "Normalisation and diffing" and
"Crack-independence evidence" sections above), and neither the 12:46 nor this refresh needed to
change that scoping.

**What precisely still needs the planner's attention, not because 01-05/01-06 changed but because
their *inputs* come from a plan that is being rewritten:**

- **The `loader_ranges` data contract.** 01-05 Task 2's action seeds the `loader` manifest bucket
  "from the loader code ranges already recorded in each `NOTES.md`" and its own `read_first` names
  `recovery/danish/NOTES.md`/`recovery/saeger/NOTES.md` as the source. This presumes the redone 01-04
  still produces a `loader_ranges`-shaped list of address ranges with disassembly evidence, recorded
  in the registry and/or `NOTES.md`, regardless of the mechanism that earned it. It does, under item
  1's agent-driven redesign above — the *data shape* 01-04 must produce is unchanged; only *how it is
  earned* changed. No edit to 01-05 is needed, but the 01-04 replan must not drop this output
  contract while changing the acquisition mechanism.
- **`validate --final`'s existing behaviour.** 01-05 Task 2's acceptance criteria assert `node
  tools/recovery-schema.mjs validate --final` "now exits zero, having failed at plan 01-02" — this
  depends only on `tools/recovery-schema.mjs`, which is untouched by the 14:57 rule (confirmed
  present, confirmed zero emulator contact). No change needed.
- **Nothing in 01-05/01-06 references `recovery/LOADING.md`'s specific content**, so a changed
  `LOADING.md` shape (different field names for the acquisition route, since there is no longer an
  "acquisition route" to name) does not ripple into either plan — 01-05's only cross-reference to
  `LOADING.md` is a prose pointer in Task 3's ledger ("the coverage cross-reference ... because a
  ledger over an image with an unnoticed on-demand-loaded region is a ledger over the wrong image"),
  which holds regardless of how `LOADING.md` was produced.

**Conclusion: 01-05 and 01-06 need zero edits for the MCP-only rule.** They may still need ordinary
re-review once 01-04's actual redo output lands (e.g., if the redone 01-04 changes a field name in
`RELEASES.json` that 01-05 reads), but that is normal cross-plan-dependency hygiene, not a
consequence of this rule change.

### 6. Two live bugs the redo must not reinherit

**Correction to the premise, verified this session: neither defect is currently live in the committed
`recovery/RELEASES.json` — both were introduced and then fully reverted in the same commit range.**
`[VERIFIED: git log — 4192a3e (introduced loader_ranges, including the bad $08F5-$08F7 entry),
cfc9d83 (partial fix), 067c0d9, 7da03fc were all reverted by bb0b1f7; git merge-base --is-ancestor
4192a3e HEAD confirms 4192a3e is an ancestor of HEAD, and node -e reading the live
recovery/RELEASES.json this session confirms no releases[].loader_ranges field exists at all —
neither the bug nor its fix is present]`. STATE.md's blocker entry describes these as defects "found
live" during the reverted run, which is accurate as a historical statement about what that run
discovered — but the phrasing "is live in `recovery/RELEASES.json` as of commit `4192a3e`" refers to
a specific historical commit, not current `HEAD`. **Do not read STATE.md's phrasing as describing the
current file.**

**What genuinely is still live, and is the reason this matters despite the data being gone:**

- **The imprecise prose that caused the `$08F5-$08F7` misclassification is still live, unchanged, in
  `recovery/danish/NOTES.md`.** `[VERIFIED: recovery/danish/NOTES.md line 62, read this session]`:
  *"The cracktro then self-runs through animation phases at `$08F5/$08F7`, `$0D64–$0D82` and
  `$0340–$035E`..."* — grouping `$08F5/$08F7` with "animation phases" — while the very next line (63)
  states *"Execution settles into a stable two-cluster steady state across `$08B1–$08F8` and
  `$139E–$142B`"* — a range that numerically **contains** `$08F5-$08F7`. The same document contains
  both the framing that caused the original misreading (line 62: "this is loader/cracktro-adjacent")
  and the framing that actually disambiguates it (line 63: "this address range is the post-loader
  steady state, i.e. real game code") — and nothing forces a reader (or a redo) to notice the
  contradiction and resolve it in favor of line 63 rather than line 62. **This means the redo is at
  real, live risk of reproducing the identical defect if it infers `loader_ranges` from this prose
  instead of doing fresh, independent live disassembly at each candidate's boundary addresses** —
  exactly the mechanical gate the superseded Task 3 (idle-calibration: every `loader_ranges` entry
  must show zero hits during a no-input window) already specified, and exactly Pitfall 6 above already
  names. This gate is unaffected by the MCP-only rule and remains the correct mitigation; the finding
  here is that the hazard is not hypothetical residue from a stale prose paragraph — it is present,
  word for word, in the currently committed file the redo will read.
- **The structural cause of the unused-range false-positive is unchanged and will recur if
  unaddressed, regardless of what data currently exists.** Both `danish` and `saeger`'s range
  manifests are `classification_state: "ranges-only"` with 171 (danish) `unused` ranges apiece
  `[VERIFIED: node -e read of recovery/danish/dumps/danish-gameentry-run1.map.json this session:
  classification_state "ranges-only", 345 ranges, {unclassified: 173, unused: 171, io: 1}]`, all
  derived from a dump captured **at the title screen** — so any range that only becomes populated
  once real gameplay runs is structurally guaranteed to register as "never-populated" in the manifest
  and therefore to fire the first time a chamber-drawing/animation/sprite routine executes, regardless
  of whether an on-demand load ever happens. This is a property of *when the dumps were taken*, not
  of any specific committed defect, so there is nothing to "fix" in the data — the fix is procedural,
  exactly as the superseded Q4/Q5 material and this project's own STATE.md already prescribe:
  **every non-zero counting-tier hit must be attributed (disassembly + backtrace at the causing PC,
  performed live by the agent) before it is classified `gameplay-write` or `load-candidate`, and an
  unattributed non-zero count carries no evidentiary weight in either direction.** This requirement is
  unaffected by the MCP-only rule and should be carried into the redo exactly as already specified.

**Recommendation for the planner:** since there is nothing to inherit or repair in `RELEASES.json`
(both `loader_ranges` and `watch_set` must be earned fresh, from a clean slate, exactly as the
superseded Task 3's own framing already assumed — "there is nothing to inherit and nothing to
repair"), the redo's plan text should say this explicitly rather than imply a partial fix is being
reapplied. The one thing that *is* still live and actionable today, independent of any plan, is that
`recovery/danish/NOTES.md`'s line 62 should be corrected or annotated to remove the "animation
phases" framing around `$08F5/$08F7` before it misleads a future reader again — this is a small,
optional, non-blocking documentation fix the planner may fold into 01-04's own tasks (e.g., as part
of Task 3's "append the derivation ... to each release's NOTES.md" step) rather than a separate todo.

## Architecture Patterns

### System Architecture Diagram — this phase's data flow

> **Refreshed 2026-08-01, post-14:57.** Every `vice_*` call in the diagram below was always meant to
> be a tool call rather than a description of a specific script, so the diagram's shape does not
> change under the 14:57 rule — but read every arrow into a `vice_*` line as **the executing agent's
> own direct tool call**, never as a `node tools/whatever.mjs` invocation on the agent's behalf. The
> two boxes that *did* imply a standalone script (`tools/diff-images.mjs`, further down) remain
> correct exactly because they involve zero emulator contact — pure Node over already-committed
> `.bin`/`.map.json` files, which is precisely the boundary the hard rule draws.

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

### Recommended tooling layout for this phase — SUPERSEDED 2026-08-01, post-14:57

> **SUPERSEDED.** `hostpath-boot.mjs`, `dump-capture.mjs` and `chip-state.mjs` as named here are
> exactly the shape the hard rule forecloses: each would wrap a live emulator call
> (`disk_attach`/`autostart`, `memory_read`, `vicii/sid/cia_get_state`) behind a Node CLI, which is a
> transport by another name. `tools/chip-state.mjs` was in fact built this way in plan 01-02 and has
> since been **deleted** along with `tools/recover.mjs`. The corrected layout is in the new section
> below; the short version is that `tools/` now holds only files with **zero** emulator contact —
> `d64-parse.mjs` and `recovery-schema.mjs` (both already committed, both untouched by this rule
> change since neither ever called `vice_*`) and, once 01-05 lands, `diff-images.mjs` — plus
> `releases.mjs` for registry read/write. Anything that needs to *read* the emulator (a RAM capture,
> a chip-state snapshot, a checkpoint arm) is performed by the agent directly, and its result is
> handed to a pure function (if one is warranted) as already-fetched data, never fetched by the
> function itself.

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
| *Refreshed 2026-08-01 — broker-lease acquisition for a standalone script* | A brand-new HTTP client re-implementing request/grant/lease semantics | Compose `.claude/mcp/vice/vice-broker-client.mjs`'s existing primitives (`newRequestId`, `writeRequest`, `createLease`, `pollGrant`, `touchLease`, `releaseLease`) plus `.claude/mcp/vice/vice.mjs`'s `useInstance()`, the exact same seam `vice-proxy.mjs` already uses | The protocol is already implemented and tested (44+ tests across `vice-broker-client.test.mjs`/`vice-broker.test.mjs`); the only genuinely missing piece is `containerizeGrant()`'s host→container coordinate translation, currently private to `vice-proxy.mjs` — extract or duplicate it, do not re-derive the translation logic (see Q9). |
| *Refreshed 2026-08-01 — mechanical "is the emulator actually advancing" check* | A custom polling/timing harness | `vice_cycles_stopwatch({action: "reset"})` / `{action: "read"}` bracketing each scripted input | Already a real tool in the 64-tool surface, documented for exactly this ("measuring, not gating"); reusing it directly is how the reverted run's own hang was eventually diagnosed — the redo should bracket it proactively, not just reactively. |

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

### Pitfall 5 (Refreshed 2026-08-01, 12:46) — SUPERSEDED 2026-08-01, post-14:57: Assuming Phase 01.2's broker automatically covers the standalone recovery tooling

> **SUPERSEDED.** The standalone recovery tooling this pitfall warns about no longer exists at all —
> `tools/recover.mjs` and `tools/chip-state.mjs` were deleted, and nothing may replace them with
> another script that imports a transport. The pitfall this project must now guard against is a
> different, opposite-shaped one: see **Pitfall 7** below, "Building a new standalone script to
> reach the emulator because a broker-lease helper looks like clean code."

**What goes wrong:** A plan or task description says "01-04 now runs on the broker route" and treats that as achieved simply because Phase 01.2 shipped, without checking that `tools/recover.mjs`/`tools/chip-state.mjs`/a rebuilt `watch-loads.mjs` still import `acquire` from `vice-pool.mjs` (the old fixed pool), not anything from `vice-broker-client.mjs`.
**Why it happens:** Phase 01.2's own summaries describe the broker as replacing "the shared-pool infrastructure," which reads as a wholesale replacement, but every one of its five plan summaries explicitly states the standalone `tools/*.mjs` pipeline was left "completely untouched" by design (`tools/README.md`'s documented "two library consumers that are not the proxy" seam).
**How to avoid:** Treat the acquisition route as an explicit decision the plan must state and implement (see Q1/Q9 above), not an ambient consequence of Phase 01.2 existing. If the redo continues to invoke standalone Node CLI verbs against `vice-pool.mjs`, it is running on the exact infrastructure that hung — verify this is not happening by grepping for `vice-pool.mjs` imports in whatever new/changed code the redo introduces.
**Warning signs:** A rebuilt `watch-loads.mjs` (or any new tool) imports `acquire` from `.claude/mcp/vice/vice-pool.mjs`; a plan task says "on the broker route" but its `<action>` describes calling `node tools/watch-loads.mjs arm ...` as a Bash command with no mention of how that command reaches a broker-granted instance.

### Pitfall 6 (Refreshed 2026-08-01): Misreading a loader-code range from prose instead of live disassembly

**What goes wrong:** A range gets added to `loader_ranges` (or `unused` ranges get trusted at face value) because a `NOTES.md` description said so, without independently confirming via `vice_disassemble`/`vice_backtrace` at the range's boundary addresses that the code there is genuinely defeated loader/cracktro code and not permanent game logic.
**Why it happens:** `NOTES.md`'s prose describing the boot/cracktro sequence is necessarily an approximation written once, early; a later precise disassembly can reveal it was imprecise at the boundary. This is exactly what happened with `$08F5-$08F7` in `danish` — the range was accurate in spirit ("this is near the loader") but wrong in exact boundary (it actually landed on a permanent game-code instruction one byte inside a still-legitimate-looking range).
**How to avoid:** Before arming any loader-reentry checkpoint or unused-range watch, disassemble its boundary addresses live and confirm the classification, rather than trusting the registry's inherited data. Treat any hit (loader-reentry or unused-range) as attribution work, not just a count — see Q4/Q5.
**Warning signs:** A watch or checkpoint fires far more often than plausible for "loader code that should never execute again" (the `$08F5-$08F7` case logged 113 hits from ordinary idling); a hit's cause, when disassembled, turns out to be ordinary gameplay code rather than loader/cracktro code.

### Pitfall 7 (New 2026-08-01, post-14:57): Building a new standalone script to reach the emulator because a broker-lease helper "isn't the same thing as importing the transport"

**What goes wrong:** A plan or an executor concludes that composing the broker client's own exported primitives (`newRequestId`, `createLease`, `pollGrant`, `containerizeGrant`-equivalent translation) into a *new* module counts as something other than "importing a transport module as a library," because the new module is original code rather than a copy-paste of an existing one. It is not — this is precisely the failure the hard rule's text was written to name.

**Why it happens:** The distinction feels meaningful from the inside of an engineering task — writing your own client against a documented protocol looks like good practice, not a violation, especially when the alternative (driving everything through the live agent's own tool calls) is less scriptable and harder to re-run as a single command. The 12:46 refresh's own recommended `adopt-seam` option (`tools/lib/vice-acquire.mjs`) is a real, in-this-project instance of exactly this reasoning, written in good faith before the rule existed to rule it out.

**How to avoid:** Read the rule as a positive statement — *"the only route to the emulator is `mcp__vice__*` tool calls made by the agent"* — rather than as a list of prohibited imports. Under that framing there is no clever composition of broker primitives that qualifies, because the primitives themselves are off-limits to `tools/`, full stop, regardless of what is built from them. If a task's design requires a Node process to reach VICE at all — even one that "only adopts an existing lease" rather than creating one — the design is dead; say so and replan around the agent performing the work directly.

**Warning signs:** A new file under `tools/` (or anywhere outside `.claude/mcp/vice/`) imports anything from `.claude/mcp/vice/vice-broker-client.mjs`, `vice.mjs`, `vice-pool.mjs`, or reads `.vice-supervisor/`/broker grant-directory state directly; a plan task's `<action>` describes a CLI verb ("`node tools/whatever.mjs arm`") as the mechanism for a live emulator operation, rather than describing the agent's own tool calls. **This is exactly what happened once already** — after the `bb0b1f7` revert, an executor was told to "build a clean transport that does not import the blocked tree" and responded by writing a fresh `fetch()` bypass straight to the host MCP endpoint plus broker-grant discovery, which was discarded unmerged (STATE.md, 2026-08-01). The instruction that produced it was phrased as a negative ("don't import X"); phrasing it positively ("the only route is `mcp__vice__*`") is what this project has since adopted specifically to prevent a repeat.

## Code Examples

### Reading a full 65536-byte RAM image via bank-scoped reads — SUPERSEDED 2026-08-01, post-14:57

> **SUPERSEDED.** The loop below was written as "conceptual Node-side orchestration" — a `for`
> loop issuing repeated `vice_memory_read` calls from inside a script. That is precisely a transport
> by another name and is exactly what the hard rule forecloses, regardless of whether the script is
> new or reused. This is also how 01-01/01-02/01-03 were *actually* built and executed (via
> `tools/recover.mjs`'s own loop, now deleted) — so this is not a hypothetical correction, it is a
> description of code that existed, worked, and was subsequently deleted for exactly this reason.
> **The equivalent live procedure now is:** the agent itself issues the same sequence of
> `mcp__vice__vice_memory_read` calls, one per chunk, directly as tool calls — not from inside a
> `for` loop in a file, but as repeated tool invocations in its own execution turn — and either (a)
> accumulates the returned `data_hex` strings itself and writes the assembled 65536-byte buffer via
> the `Write`/`Bash` tool, or (b) writes each chunk's hex to a small JSON/text sidecar as it goes and
> hands that off to a genuinely pure assembler function that only concatenates and hashes
> already-fetched hex strings — never issues a read itself. Below is the (b) shape, which is legal
> because it takes fetched data as its only input:

```js
// tools/assemble-image.mjs — pure logic only; never imports a transport, never calls vice_*.
// Input: an array of {address, data_hex} chunks the agent already fetched via
// mcp__vice__vice_memory_read tool calls and wrote to a JSON file, e.g.
//   [{ "address": "$0000", "data_hex": "..." }, { "address": "$1000", "data_hex": "..." }, ...]
// covering all 65536 addresses with no gap and no overlap.
export function assembleImage(chunks) {
  const image = Buffer.alloc(65536);
  const covered = new Uint8Array(65536);
  for (const { address, data_hex } of chunks) {
    const start = Number(address.startsWith("$") ? `0x${address.slice(1)}` : address);
    const bytes = Buffer.from(data_hex, "hex");
    bytes.copy(image, start);
    covered.fill(1, start, start + bytes.length);
  }
  if (covered.some((b) => b === 0)) throw new Error("gap in chunk coverage — image is not complete");
  return image;
}
```
**Source:** the pure-function half of this pattern is new reasoning for this refresh, applying the hard rule's own "tools/ holds pure logic only ... over data the agent fetched through the tools and passed in" language literally. The original `vice_memory_read` schema/sample data this example still relies on is [VERIFIED: live VICE MCP server, this session, 2026-07-30] and is unaffected by the rule change — only *who* calls it changed.

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
| A5 *(2026-08-01)* | A single, freshly-booted, per-session broker instance hangs at a materially lower rate than a long-running shared pool instance did | Q1, "Phase 01-04 Redo" section | If false, the redo simply relocates the hang risk to a single point of failure per session instead of eliminating exposure — no measurement in this project distinguishes "less accumulated state helps" from "the underlying host fault is unrelated to instance age/sharing." The redo should still include a liveness check (Q2) regardless, since this assumption is not load-bearing for correctness, only for expected frequency. |
| A6 *(2026-08-01)* | All three pool instances hanging simultaneously in the reverted run was a host-level event (resource/scheduling), not three independent per-instance faults | Q1 | If false (three genuinely independent faults), the pool-vs-broker distinction in Q1's table is less protective than stated, since a single broker instance could still be as failure-prone per-hour as any one pool instance was. Either way the recommendation (move off the pool route) is unaffected — only the *size* of the improvement is uncertain. |
| A7 *(2026-08-01)* | The generally-sound "verify state transition after each input, retry bounded" pattern is an adequate missed-input recovery strategy for this game's play-through | Q6 | Never empirically tested in this project (the reverted run never left the title screen). If the game's actual input timing is more finicky than assumed, a bounded retry could still miss a required transition; this needs the planner to pick concrete retry/timeout parameters rather than leaving it open. |
| A8 *(2026-08-01)* | A supplementary dump does not need the same N≥3 program-image-identity reproducibility bar as the primary game-entry dumps | Q7 | If the planner (or a later phase) actually needs a supplementary dump to be provably reproducible (e.g. if D-13 resolves to "absorb" and Phase 4's round-trip diff needs it), a single-capture supplementary dump would be insufficient evidence and would need redoing with the full 01-01-style N≥3 procedure. |
| A9 *(2026-08-01, post-14:57)* | Agent-performed direct tool calls, narrated into a committed hit-log file, are an adequate replacement for a scripted CLI as the mechanism a plan task checks — i.e. a `checkpoint:human-verify`/committed-artifact acceptance shape is sufficient evidence that the live work happened correctly | § "MCP-Only-Rule Findings" item 1 | This is not a new assumption this project invented for the rule — 01-04's superseded Task 3/4/5 already used exactly this shape (evidence fields, screenshots, a human-verify checkpoint) even before the rule existed, so the risk is bounded to "does a human/agent reviewer reliably catch a bad live run," which the existing checkpoint design already addresses. If wrong, a plausible-looking but incorrect hit-log could pass review; mitigated by the same screenshot/evidence-cross-check discipline already specified. |
| A10 *(2026-08-01, post-14:57)* | VERIFY-01's requirement text ("a replay driver over the `vice_* ` MCP tools") will be re-scoped by Phase 3's own discuss/plan cycle to "a data-format input script replayed by an agent," rather than resolved some other way | § "MCP-Only-Rule Findings" item 3 | This is this research pass's reasoned prediction, not a decision made by anyone with authority to make it. If Phase 3 instead finds some other legal mechanism (e.g. a human operator running a documented manual procedure with no data-format script at all), the D-12-style "notes as a seed" framing carried forward here would need revisiting — recorded as an open item for Phase 3, not settled here. |
| A11 *(2026-08-01, post-14:57)* | Correcting `recovery/danish/NOTES.md` line 62's "animation phases" framing around `$08F5/$08F7` is safe to fold into 01-04's own Task-3-equivalent work rather than needing a separate todo or checkpoint | § "MCP-Only-Rule Findings" item 6 | Low risk either way — it is a documentation clarity fix, not a data or code change, and the actual mitigation (live disassembly + idle-calibration gate) does not depend on the prose being fixed first. If the planner disagrees, filing it as a `.planning/todos/pending/` entry instead costs nothing. |

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

5. **(2026-08-01, 12:46) Which acquisition route does the 01-04 redo actually use — live-agent `mcp__vice__*` calls (broker, automatic) or a standalone-script broker-lease helper (new plumbing)? — RESOLVED, post-14:57, no longer a question.**
   - What changed: the 14:57 hard rule (`.claude/CLAUDE.md` § "Emulator Access") makes the standalone-script option categorically illegal, not merely less convenient — there is exactly one legal shape (the live agent's own direct tool calls), so this is no longer a decision for a plan's `checkpoint:decision` to present with options. See § "Phase 01-04 Redo — MCP-Only-Rule Findings" item 1.
   - Residual open question, genuinely unresolved: whether a non-stopping checkpoint can accumulate a hit count without stopping the machine (the counting-tier probe named in the superseded Task 3 Step 2) is unaffected by this resolution and remains untested — this needs an empirical, agent-performed probe at execution time, not something this research pass can confirm statically.

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

> **Refreshed 2026-08-01, post-14:57.** RECOVER-01/02/03 rows below are historical — those
> requirements were satisfied by plans 01-01/01-02/01-03, already executed and committed, and the
> commands named for them (`tools/hostpath-boot.mjs`, `tools/dump-capture.mjs`) were never actually
> built under those names; the real, executed procedure was `node tools/recover.mjs boot|recover
> <release>` — a file that has since been **deleted**, so neither the original nor the row below is
> re-runnable as a command any more (see the new section's answer to "how is a procedure made
> repeatable without a runnable command"). The RECOVER-04 row is corrected to remove the dead
> `watch-loads.mjs` CLI-arms-watches framing: arming/play/detection is agent-performed live, and the
> only thing checkable by an automated command is the *committed record* of that live work.

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RECOVER-01 | Both disks boot via a documented MCP-only procedure, never calling `vice_disk_list` | already satisfied (01-01/01-03, executed) | historical only — `node tools/recover.mjs boot <release>` was the real command; the file is deleted, so this is no longer re-runnable, only the NOTES.md procedure is | ✅ done, historical command gone |
| RECOVER-02 | `danish.d64` dump captured with recorded trigger/`$01`/ranges | already satisfied (01-01, executed) | historical only — `node tools/recover.mjs recover danish` was the real command; deleted | ✅ done, historical command gone |
| RECOVER-03 | `saeger.d64` dump captured under same procedure | already satisfied (01-03, executed) | historical only — `node tools/recover.mjs recover saeger` was the real command; deleted | ✅ done, historical command gone |
| RECOVER-04 | On-demand load detection via watches during bounded play | agent-performed live arm/play/attribute; automated check runs only over the committed hit-log/`LOADING.md` record afterward | `node tools/watch-loads.mjs report --release <id> --json` — a **pure**, emulator-free CLI that renders/validates the committed hit log; it does not arm anything | ❌ Wave 0 (pure-logic file only; no live-arming CLI exists or should exist) |
| RECOVER-05 | Both images normalised to common base/state before diff | scripted anchor-search + offset proof | `node tools/diff-images.mjs anchor-search --json` | ❌ Wave 0 (01-05, unaffected by the rule change — pure Node over committed files) |
| RECOVER-06 | Every byte range carries a provenance verdict + evidence | scripted coalesced-diff → `PROVENANCE.md` | `node tools/diff-images.mjs diff --gap-tolerance 16 --json` | ❌ Wave 0 (01-05, unaffected) |
| RECOVER-07 | Crack-independence verdict recorded with evidence/confidence weight | manual (CSDb search + binary inspection), written to `PROVENANCE.md` | n/a — analytical, not automatable | ❌ Wave 0 (01-06, unaffected) |
| RECOVER-08 | Canonical image chosen by measured patch-count | scripted count from `PROVENANCE.md`'s generated ranges | `node tools/diff-images.mjs count-patches --json` | ❌ Wave 0 (01-06, unaffected) |

### Sampling Rate
- **Per task commit:** re-run the specific dump/diff script just touched, confirm it still exits cleanly against already-captured fixtures.
- **Per wave merge:** re-run the byte-identical reproducibility check (D-09) end-to-end for whichever image(s) that wave touched.
- **Phase gate:** both images captured, both reproducibility checks green, `PROVENANCE.md` at 100% coverage, canonical image chosen with a recorded number, before `/gsd-verify-work`.

### Wave 0 Gaps

> **Refreshed 2026-08-01, post-14:57.** RECOVER-01/02/03's gaps are closed (01-01/01-02/01-03
> executed); `tools/hostpath-boot.mjs` and `tools/dump-capture.mjs` were never built under those
> names and never should be — capture/boot is agent-performed live, not a CLI wrapper. Only
> RECOVER-04's gap remains genuinely open, and its shape has changed from "build a CLI that arms
> watches" to "build a pure-logic reporter/validator over a hit-log record the agent produces live."

- [x] ~~`tools/hostpath-boot.mjs`~~ — superseded; RECOVER-01 already satisfied by 01-01/01-03's agent/CLI-driven boot (`tools/recover.mjs`, now deleted). No replacement file is needed — booting is agent-performed live, following `recovery/<release>/NOTES.md`'s recorded procedure.
- [x] ~~`tools/dump-capture.mjs`~~ / ~~`tools/chip-state.mjs`~~ — superseded; RECOVER-02/03 already satisfied (01-01/01-02, executed); `tools/chip-state.mjs` existed and was deleted 2026-08-01. No CLI replacement — capture is agent-performed live per `.claude/skills/c64-ram-capture/SKILL.md`.
- [ ] `tools/watch-loads.mjs` — **pure logic only**: sentinel resolution over registry data, `attributeAddress`, `reportHits`, a hit-log reader/validator and `recovery/LOADING.md` renderer. Must import nothing from a transport and must never itself arm a checkpoint or watch. Covers RECOVER-04.
- [ ] `tools/diff-images.mjs` — anchor search, coalesced diff, patch-count, covers RECOVER-05/06/08. Unaffected by the rule change (zero emulator contact, pure Node over already-committed `.bin` files) — carried forward unchanged from the 12:46 refresh.
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

### Refresh sources, 2026-08-01 (RECOVER-04 targeted pass)

**Primary (HIGH confidence) — direct code/history inspection, this session:**
- `git show bb0b1f7` / `git show bb0b1f7^:tools/watch-loads.mjs` — the revert commit's full diff and the deleted file's pre-revert content (acquisition call, pure-logic functions).
- `git show 28a4db3`, `git show b66b72f`, `git log --oneline` around commits `4192a3e`/`cfc9d83`/`067c0d9`/`7da03fc` — the reverted run's own commit messages, which are the primary source for the hang symptom and the loader-range/attribution defects.
- `.planning/STATE.md` — the `[HOST INSTABILITY]`, `[PROCESS — CORRECTION]`, and the three `[Phase 1, 2026-07-31]` defect entries (loader-range misclassification, unused-range attribution, `watch-loads.mjs disarm`'s `VICE_MCP_URL` bug).
- `.claude/mcp/vice/vice.mjs`, `vice-pool.mjs`, `vice-session.mjs`, `vice-broker-client.mjs`, `vice-proxy.mjs`, `resources/vice-broker.sh` — direct read of the acquisition-route split, the epoch-drift mechanism, the lease/heartbeat/TTL constants, and `containerizeGrant()`.
- `tools/recover.mjs`'s import statements — confirms the pool-route dependency directly (`vice-pool.mjs`'s `acquire`).
- `.planning/phases/01.2-on-demand-broker-and-per-session-leasing/01.2-{01,02,04,05}-SUMMARY.md` — each independently states the standalone recovery pipeline was left untouched; the lease-lifetime/TTL/heartbeat constants; the D-1.2-C narrowing verdict; the session-scoped-snapshot-naming guidance.
- `Skill("spike-findings-bruce-lee")` (`shutdown-and-lease-release.md`, `timeout-and-latency-budgets.md`, `large-response-chunking.md`) — the idle-session/heartbeat/tool-call-budget measurements underpinning Q3.
- `.planning/seeds/ram-capture-as-proxy-tools.md`, `.planning/seeds/vice-pool-contention-and-starvation.md`, `.planning/todos/pending/2026-08-01-absorb-the-ram-capture-and-host-path-skills-into-the-vice-mcp.md` — confirm the "two library consumers, not the proxy" seam is a documented, deliberate decision, and that absorbing the standalone tooling into the MCP surface is a known, not-yet-executed todo.

### Tertiary (LOW confidence), refresh
- The root cause of all three pool instances hanging simultaneously (Q1's assumption A6) — not measured or explained anywhere in this project; recorded as an open gap, not resolved by this refresh. Now moot as a *decision driver* (there is no route choice left to make), but the underlying host-hang risk itself is still unexplained and still real.
- Missed-input recovery strategy for the play-through (Q6's assumption A7) — no empirical basis; the reverted run never reached a state where this could be tested. Still unresolved by this refresh.

### Refresh sources, 2026-08-01, post-14:57 (this refresh)

**Primary (HIGH confidence) — direct inspection, this session, no emulator access used or available:**
- `.claude/CLAUDE.md` § "Emulator Access" and § "Constraints" — the hard rule's exact wording, read directly.
- `.planning/STATE.md` § "Blockers/Concerns" (top entry) and the two 2026-08-01 accumulated-context decision entries — the five things this replan must settle, the `fetch()`-bypass incident, and the exact deletion/rename commit list.
- `git log --oneline`, `git show bb0b1f7 --stat`, `git merge-base --is-ancestor 4192a3e HEAD` — confirmed `4192a3e`/`cfc9d83`/`067c0d9`/`7da03fc` are all reverted by `bb0b1f7`, and that no `loader_ranges` field exists in the current `recovery/RELEASES.json`.
- Direct `ls`/`cat`/`node -e` inspection of `tools/`, `tools/lib/`, `.claude/skills/c64-ram-capture/`, `.mcp.json`, `recovery/RELEASES.json`, and `recovery/danish/dumps/danish-gameentry-run1.map.json` — confirmed the current file inventory, the absence of `loader_ranges`/`watch_set`, the `ranges-only`/171-unused-range manifest state, and the still-live `$08F5/$08F7` "animation phases" prose in `recovery/danish/NOTES.md` line 62.
- `01-04-PLAN.md`, `01-05-PLAN.md`, `01-06-PLAN.md`, `SKELETON.md`, `01-01-SUMMARY.md`, `01-02-SUMMARY.md`, `01-03-SUMMARY.md`, `01-CONTEXT.md`, `REQUIREMENTS.md` — read in full this session; the basis for the dead-plan analysis, the 01-05/01-06 survival confirmation, and the phase-requirement/success-criterion cross-references above.
- `.claude/skills/c64-ram-capture/SKILL.md` — read in full; confirmed it is now a scripts-free, agent-tool-call procedure document.

## Metadata

**Confidence breakdown:**
- VICE MCP tool surface & bootstrap/capture mechanics: HIGH — directly probed, live, this session, against the actual project endpoint.
- Crack-independence evidence: MEDIUM — one side externally corroborated (Tier 2), one side an open, bounded, small task for 01-05.
- Gameplay-dependent findings (on-demand load behavior, actual entry-point addresses, in-game `bank:"ram"` behavior once a game is running): LOW/untested — nothing in this research pass involved actually running the game, since doing so live would have mutated the shared VICE instance's state ahead of the real execution plans. Flagged explicitly wherever this applies (Open Questions 1, 3, 4).
- **Refreshed 2026-08-01, 12:46 — Phase 01-04 Redo section (now itself superseded):** the acquisition-route split (pool vs. broker) and the specific defects found (loader-range misclassification, unused-range attribution gap, `disarm`'s env-var bug) were HIGH confidence — directly read from git history and current code, not inferred. That acquisition-route analysis is now moot per the 14:57 hard rule; the defect analysis remains accurate as *history* but is corrected above (§ item 6) to state plainly that neither defect is currently present in committed data, only in the still-live prose hazard that produced one of them.

**Refreshed 2026-08-01, post-14:57 (this refresh) — "Phase 01-04 Redo — MCP-Only-Rule Findings" section:** HIGH confidence for everything verified by direct file/git inspection this session (the current absence of `loader_ranges`/`watch_set` in `RELEASES.json`, the still-live NOTES.md prose hazard, the confirmed zero-emulator-contact scope of 01-05/01-06, the current `tools/` file inventory). MEDIUM/reasoned-not-verified for the concrete shape recommended for agent-driven arming/attribution/reporting (item 1) and for the VERIFY-01/D-11 replacements (item 3) — these are this session's design reasoning about how to satisfy the rule, not something confirmed by executing a plan under it, since this research pass has no `mcp__vice__*` tools. Every such claim is flagged inline with `[ASSUMED]` or an explicit "not yet acted on by any plan" caveat rather than presented as settled.

**Research date:** 2026-07-30 (original); **2026-08-01, 12:46** (targeted RECOVER-04 / Phase 01-04 Redo refresh, now superseded); **2026-08-01, post-14:57** (this refresh, current)
**Valid until:** Tool-surface findings (schemas, bank behavior against the idle machine) are stable indefinitely absent a VICE MCP server upgrade — re-check `vice_ping`'s `version` field if research is reused after a long gap. Gameplay-dependent findings should be re-verified the moment a disk is actually run under the new agent-driven procedure, not assumed to still hold. **This refresh should be re-checked if `.claude/mcp/vice/` is ever extracted into its own package** (the pending todo named in STATE.md) — the extraction would not change the MCP-only rule itself, but could change file paths this document cites (e.g. `.mcp.json`'s `vice-proxy.mjs` path). It should also be re-checked if Phase 3's own discuss/research cycle settles VERIFY-01's replacement shape differently from item 3's reasoned recommendation above, since that is this project's decision to make, not this research pass's.
