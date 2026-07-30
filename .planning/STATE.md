---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Pipeline Proven *
current_phase: 1
current_phase_name: Recovery & Provenance
status: executing
stopped_at: Phase 1 context gathered
last_updated: "2026-07-30T12:41:34.872Z"
last_activity: 2026-07-30
last_activity_desc: Milestone split applied at the Phase 4 boundary
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
**Current focus:** Phase 1 — Recovery & Provenance

## Current Position

Milestone: v1.0 — Pipeline Proven (Phases 1–4 of 7 total)
Phase: 1 of 7 overall — 1 of 4 in this milestone (Recovery & Provenance)
Plan: 0 of 6 in current phase
Status: Ready to execute
Last activity: 2026-07-30 — Phase 1 planned (6 plans, tracer-first)

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
