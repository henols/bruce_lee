---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Pipeline Proven *
current_phase: 01
current_phase_name: recovery-provenance
status: executing
stopped_at: Phase 1 context gathered
last_updated: "2026-07-30T12:45:53.920Z"
last_activity: 2026-07-30
last_activity_desc: Phase 01 execution started
progress:
  total_phases: 1
  completed_phases: 0
  total_plans: 6
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-30)

**Core value:** An ACME source tree that rebuilds a Bruce Lee which plays identically to the original, where every gameplay system is explained well enough that someone could change it.
**Current milestone:** v1.0 — Pipeline Proven (Phases 1–4, 24 requirements)
**Current focus:** Phase 01 — recovery-provenance

## Current Position

Milestone: v1.0 — Pipeline Proven (Phases 1–4 of 7 total)
Phase: 01 (recovery-provenance) — EXECUTING
Plan: 1 of 6
Status: Executing Phase 01
Last activity: 2026-07-30 — Phase 01 execution started

Progress (v1.0): [░░░░░░░░░░] 0% — 0/20 plans
Progress (overall): [░░░░░░░░░░] 0% — 0/35 plans

**Milestone roadmap:** v1.0 = Phases 1–4 (proven pipeline) · v2.0 = Phases 5–7 (complete reconstruction, where "fully documented and recompiled" is met) · v3.0 = round-trip assets + editor, not yet phased.

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Vertical-slice-first structure over horizontal layers — the three project-sinking risks (mistimed dump, jump-table code misclassified as data, silent ACME addressing/alignment drift) all surface only at verification under layering. Phase 4 drives one subsystem through the full pipeline to move discovery early.
- [Roadmap]: Sprite/display chosen as the pilot subsystem — bounded and IRQ-driven enough to isolate, but exercises every stage including alignment-sensitive data extraction and a checkpoint meaningful on both verification channels. Combat rejected as too entangled; sound rejected because the checkpoint design never samples SID.
- [Roadmap]: Verification harness scheduled at Phase 3, not terminal — baseline capture needs only the recovered image plus harness plumbing, so plans 03-01/03-02 run as a parallel workstream alongside Phase 2.
- [Milestones]: Split at the Phase 4 boundary — v1.0 closes on a proven pipeline (24 reqs), v2.0 on the complete reconstruction (20 reqs). Archives and the PROJECT.md evolution review happen while context is small and after the pipeline's assumptions have been tested. Accepted cost: v1.0 is not the originally-stated deliverable; v2.0 is.

### Pending Todos

None yet.

### Blockers/Concerns

- **[MAJOR FINDING — Phase 1, 2026-07-30]: every state-reading `vice_*` MCP call PAUSES the emulator and does not resume it.** Measured directly: with an explicit `vice_execution_run` issued as the *last* call before a quiet interval, the machine sustains **~991,000 cycles/s (100% of PAL C64)**. Poll in a loop without re-resuming and it drops to **~6,000 cycles/s (0.7%)** — which is why a checkpoint appeared to "never fire". Any poll/wait loop MUST re-issue `vice_execution_run` after each state read, and must then leave the server alone for a real interval. `Speed:100`/`WarpMode:0` in `vice_machine_config_get` are not the problem. **Phase 3's replay harness will hit this too — design for it.**
- **[HAZARD CANDIDATE — Phase 1, 2026-07-30]: the host VICE MCP server has now crashed TWICE, both times during checkpoint + `vice_run_until` work.** `vice_disk_list` was never called either time. Leading suspects, in order: (1) `vice_run_until` creates its **own `temporary` checkpoint** at the target address — two live checkpoints at `$08B1` (one `temporary`) were observed after a failed attempt, so arming a permanent checkpoint *and* calling `run_until` on the same address (which plan 01-01 explicitly instructs as "belt and suspenders") may be the trigger; (2) `vice_checkpoint_delete` on an already-auto-reaped `temporary` id. Mitigations now in code: `capture()` no longer calls `run_until` at all (armed checkpoint + `execution_run` only — still a signal, not a duration), and `reset()` skips `temporary` checkpoints and tolerates delete/detach failures. **Unconfirmed — treat as a hypothesis with two supporting data points, not a diagnosis.**
- **[Phase 1, 2026-07-30]: boot sequence established for `danish.d64`** — `vice_disk_attach` + `vice_autostart` leave the CPU **halted** (`reset` uses `run_after:false`), so `vice_execution_run` is mandatory or no loader code executes at all. The cracktro polls `$DC00/$DC01` **directly**, so `vice_keyboard_type` is invisible to it; the "hit any key" gate at `$0900` needs `vice_keyboard_matrix`. Gates are stored per-release in `recovery/RELEASES.json` (`boot.gates`), never in tool control flow.
- **[Phase 1, 2026-07-30]: dump trigger located — `$08B1`**, the title-screen input dispatcher (`LDA $49 / ORA $4A / BNE / JMP $0531`, then `JSR $139E` which reads `$DC00 AND $DC01`). Distinct from the loader's own `$0900` poll. Full evidence narrative is in `recovery/RELEASES.json` → `danish.trigger.how_located`. A bare `vice_execution_pause` is **nondeterministic** (the title screen is IRQ-driven — `$FF41` appears in the backtrace), so only a checkpoint gives a re-armable stop point.
- **[Phase 1, 2026-07-30]: Tier-1 provenance evidence captured** — the cracktro screen reads "Danish Crackers Presents BRUCE LEE", scroller includes release id **DC-011/P**, sign-off reads "They make'em, We break'em." This **corroborates the CSDb record** found during research from an independent source (the artifact itself). The post-cracktro title screen is Datasoft's original and unmodified ("DATASOFT PRESENTS / BRUCE LEE (TM) / BY RON J FORTIER"). Recorded in `RELEASES.json` → `danish.tier1_evidence`; feeds RECOVER-07 in plan 01-06.
- **[HARD BLOCKER — Phase 1, 2026-07-30]: the host VICE MCP server is DOWN.** `http://host.docker.internal:6510/mcp` returns `ECONNREFUSED` from both the raw HTTP path and the harness MCP client. It was verified healthy (`vice_ping` → `version 3.10, C64SC, paused`) immediately before plan 01-01 was dispatched, then dropped mid-run (`SocketError: other side closed`, then refused). DNS to `host.docker.internal` still resolves (172.17.0.1), so this is the VICE process, not container networking. `vice_disk_list` was **never** called — root cause unknown. **Recovery requires restarting the host-side VICE MCP server (`x64sc -mcpserver`); the container cannot do it.** Verify with:
  `curl -s -X POST http://host.docker.internal:6510/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"vice_ping","arguments":{}}}'`
  Plans 01-01 through 01-04 all need the emulator and cannot proceed until this is restored.
- [Phase 1]: **Recon finding to re-verify, not to trust** — before the outage, the executor traced `danish.d64` to a title-screen dispatcher at **$08B1**, reached via `JSR` from `$0711` and distinct from the loader's own `$0900` polling loop (confirmed by `vice_disassemble` + `vice_backtrace`). This is a strong D-06 trigger candidate. `recovery/RELEASES.json`'s `trigger` field is deliberately still `null` — the recorded value must come from the tool running live, not from these notes.
- [Phase 1]: **`vice_run_until` returns immediately/asynchronously** — confirmed live, consistent with its schema's "timeout, not yet implemented" note on `cycles`. Synchronisation needs a poll-until-paused loop plus a client-side `AbortSignal.timeout`, or a wrong target address hangs with no safety net.
- [Phase 1]: `vice_disk_list` crashes the host MCP server and needs a manual host-side VICE restart. Never call it; parse `.d64` bytes directly.
- [Phase 1]: VICE bootstrap — **tool question resolved** by Phase 1 research (verified live against the host MCP endpoint): `vice_disk_attach` and `vice_autostart` both exist, so booting does *not* require `snapshot_load` from a pre-captured `.vsf`. **Still open:** whether `autostart` actually defeats each crack's faked directory — plan 01-01 settles that empirically, with `disk_attach` + a recorded `LOAD"*",8,1` sequence as the fallback.
- [Phase 1]: `vice_snapshot_save` takes only a `name`, not a `path`; snapshots are written host-side to `~/.config/vice/mcp_snapshots/` and there is **no tool to export their bytes into this container**. A `.vsf` therefore cannot be committed as a project artifact — supersedes CONTEXT.md D-07's original wording. Snapshots are recorded by name only; reproducibility runs through the recorded procedure instead.
- [Phase 1]: `vice_run_until`'s `cycles` parameter is documented in its own live schema as "timeout, not yet implemented" — there is no safety net against hanging on a misidentified target address. Every run-to-checkpoint task needs a stated manual-recovery path.
- [Phase 3]: `.d64` writing tool unresolved (`c1541` standalone vs custom writer). If a `.prg` cannot be injected directly over MCP, this becomes a hard blocker on Phase 4, not Phase 7.
- [All phases]: VICE is a single shared host instance. `parallelization: true` does not extend to emulator work — plans marked parallel are parallel in authoring; their VICE steps serialise.
- [Phase 5/6]: `src/zeropage.a` and `src/main.a` are the highest-fan-in files. Parallel plans must not edit them concurrently; each phase's first plan allocates them for the whole phase.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-07-30T11:37:45.454Z
Stopped at: Phase 1 context gathered
Resume file: .planning/phases/01-recovery-provenance/01-CONTEXT.md
