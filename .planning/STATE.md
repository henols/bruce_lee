---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Pipeline Proven *
current_phase: 01
current_phase_name: recovery-provenance
status: executing
stopped_at: "Completed quick task 260730-mef: parallel VICE instance pool launch"
last_updated: "2026-07-30T16:40:57.998Z"
last_activity: 2026-07-30
last_activity_desc: "Completed quick task 260730-jty: host-side VICE crash supervision + container-side restart detection"
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
Last activity: 2026-07-30 — Completed quick task 260730-ryz: `vice-session/SKILL.md` rewritten as a usage-only guide, internals moved to `INTERNALS.md`

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
- [Phase ?]: [quick-260730-mef]: Container guard extracted into tools/lib/container-guard.sh (sourced by both vice-supervisor.sh and vice-pool.sh) to prevent detection-logic drift; vice-pool.mjs's acquire() takes atomic linkSync-based leases, walking ports in descending order, with blocking-with-timeout semantics and hostname-gated stale-lease reclaim (cross-host pid comparison is never trusted); snapshotName() namespaces every vice_snapshot_save call by instance port unconditionally, since the host snapshot directory is shared across instances.

### Pending Todos

None yet.

### Blockers/Concerns

- **[MAJOR FINDING — Phase 1, 2026-07-30]: the recovery procedure IS deterministic for the program image.** Confirmed on two independent cold-boot run pairs of `danish.d64`: **`$0400–$CB66` (~51 KB of loaded game code+data) and zero page `$0002–$00FF` are byte-identical**; 65,320 of 65,536 bytes match. Every difference is a 6510 port register, volatile scratch (`$0100–$03FF`), or never-written RAM.
- **[MAJOR FINDING — Phase 1, 2026-07-30]: never-written RAM drifts CONTINUOUSLY while the emulator runs, so full-64K byte-identity is impossible in principle.** Measured three ways with **no game involved**: 994 and 1014 bytes differing between two 20 s idle runs, and **993 between two back-to-back power-on "baseline" captures with the machine never deliberately run** — drift accumulates *during* a capture. Consequences, all learned the hard way: (a) `mode:"hard"` reports "Machine power cycled" but does **not** restore pristine RAM once the machine has run — real hardware behaves the same, reset does not clear DRAM; (b) **there is no stable reference image at any instant**, so baseline-diff classification cannot work; (c) drift is **stochastic per run** — an idle control yielding 1014 drift-prone addresses covered only **2 of 137** real diffs, so it can never be excluded by address list. Developer approved redefining criterion 1 over the program image.
- **[Phase 1, 2026-07-30]: the working drift discriminator is a property of the VALUE, not the address.** Drift flips *individual bits* — all 137 diffs in one run pair were Hamming distance exactly 1, while a program writing different data differs in ~4 bits on average. So multi-bit differences fail and the contract stays falsifiable. A power-on-pattern **block-fill heuristic was REJECTED** despite scoring 134/137: it is threshold-tunable, and tuning until green manufactures the false confidence this phase exists to prevent. `$0000–$0001` are excluded structurally (6510 on-chip I/O port registers, not memory). **Open gap:** one 2-bit drift byte (`$FDD9`, provably inside a power-on pattern block) still fails, so the Hamming-1 rule is slightly too tight — the fix is a design decision (structural never-written detection vs an N-run agreement rule), deliberately not resolved by widening the threshold.
- **[MAJOR FINDING — Phase 1, 2026-07-30]: every state-reading `vice_*` MCP call PAUSES the emulator and does not resume it.** Measured directly: with an explicit `vice_execution_run` issued as the *last* call before a quiet interval, the machine sustains **~991,000 cycles/s (100% of PAL C64)**. Poll in a loop without re-resuming and it drops to **~6,000 cycles/s (0.7%)** — which is why a checkpoint appeared to "never fire". Any poll/wait loop MUST re-issue `vice_execution_run` after each state read, and must then leave the server alone for a real interval. `Speed:100`/`WarpMode:0` in `vice_machine_config_get` are not the problem. **Phase 3's replay harness will hit this too — design for it.**
- **[HOST INSTABILITY — Phase 1, 2026-07-30]: SIX host VICE MCP outages in one session.** Two needed a manual restart, four self-recovered (one outlasting a 49 s retry budget). Outages 4, 5 and 6 **all died on `vice_execution_run`** — the resume-from-monitor transition. `vice_disk_list` was never called. This is now the dominant schedule risk for Phase 1: plans 01-02 → 01-04 need far more emulator time than 01-01, and 01-04 additionally needs a human-driven play-through. **Mitigation in code:** resumes cut from ~20+ to 3 per capture by polling with `vice_ping` (measured non-pausing: 986,693 cycles/s while ping-polling vs 991,569 fully quiet) instead of `vice_checkpoint_list` (which does pause). Transport retries transport-only failures over a ~50 s budget and redoes the session handshake. **Open question for the developer: whether to keep pushing or investigate the host VICE/MCP build first.** Not a code problem this container can reach.
- **[Phase 1, 2026-07-30]: keypress delivery — three mechanisms measured, only one works.** `vice_keyboard_type` is invisible to the crack (it polls `$DC00/$DC01` directly). `vice_execution_run` + a wall-clock sleep *does* deliver the key but the release lands on a different CPU cycle each run — measured as **264 of 65536 bytes differing**, including `$0049`, the exact byte the trigger routine reads, plus the whole stack page. `vice_execution_step(fixed count)` is cycle-identical but **never delivers a held matrix key** (machine sat at `$0900` for 150 s). **Working design: press at the gate, HOLD, release at the trigger checkpoint** — a program event, so the same cycle every run, and the dump has no key held in CIA state.
- **[Phase 1, 2026-07-30]: VICE power-on RAM init is DETERMINISTIC** — two cold `machine_reset(hard, run_after:false)` cycles read byte-identical 64K (`8175cd4d…`, 0 bytes differing). This **refutes** "scattered single-bit diffs are emulator DRAM noise" and means any dump mismatch is *our* nondeterminism, hence fixable. Useful as a control experiment whenever a diff looks like hardware randomness.
- **[HAZARD CANDIDATE — Phase 1, 2026-07-30]: earlier hypothesis, now WEAKENED.** The first two crashes both happened during checkpoint + `vice_run_until` work, suggesting `run_until`'s competing `temporary` checkpoint (two live checkpoints at `$08B1`, one `temporary`, were observed) was the trigger. Outages 3–6 happened with `run_until` already removed, so it is **not** the sole cause. `capture()` still avoids `run_until` (an armed checkpoint plus one resume is simpler and equally signal-based), and `reset()` still skips `temporary` checkpoints and tolerates delete/detach failures — but do not treat `run_until` as the explanation. `vice_disk_list` was never called either time. Leading suspects, in order: (1) `vice_run_until` creates its **own `temporary` checkpoint** at the target address — two live checkpoints at `$08B1` (one `temporary`) were observed after a failed attempt, so arming a permanent checkpoint *and* calling `run_until` on the same address (which plan 01-01 explicitly instructs as "belt and suspenders") may be the trigger; (2) `vice_checkpoint_delete` on an already-auto-reaped `temporary` id. Mitigations now in code: `capture()` no longer calls `run_until` at all (armed checkpoint + `execution_run` only — still a signal, not a duration), and `reset()` skips `temporary` checkpoints and tolerates delete/detach failures. **Unconfirmed — treat as a hypothesis with two supporting data points, not a diagnosis.**
- **[quick-260730-jty, 2026-07-30]: host-side VICE crash supervision now exists (`tools/vice-supervisor.sh`, HOST-ONLY — run it from the host workspace, never in this container).** It respawns x64sc on crash with backoff and a crash-loop give-up threshold, and collects per-crash evidence under `.vice-supervisor/` (a timestamped log with x64sc's stderr plus decoded exit status/signal per death, and a `crashes.log` line per death) — this is the evidence trail for the still-unconfirmed `vice_run_until` / `vice_execution_run` hypothesis in the HAZARD CANDIDATE entry above, not a replacement for it. Critically, supervision alone would have been a *regression*: `withReconnect()` in `tools/vice.mjs` retries transport failures, and under a respawning supervisor that retry can start SUCCEEDING again against a brand-new, blank machine (no disk attached, no checkpoints armed) instead of the one a capture actually started with. The harness now detects this: every spawn writes a monotonically increasing "epoch" to `.vice-supervisor/epoch.json`, `tools/vice.mjs` reads it back (`readEpoch()`/`assertSameMachine()`), and `tools/recover.mjs` voids (renames to `*.VOID-<timestamp>` plus a sibling `.VOID.json` evidence note) any capture whose emulator identity changed — or could not be proven unchanged, via a checkpoint-presence fallback when no supervisor is running — rather than silently writing a dump from a fresh blank machine. Nothing is auto-reset, auto-rebooted or auto-resumed after a detected restart; the operator re-runs the capture. Absence of the epoch file (no supervisor running) remains completely normal and non-fatal.
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

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260730-jty | Add host-side VICE crash supervision and container-side restart detection | 2026-07-30 | 6694cb1 | [260730-jty-add-host-side-vice-crash-supervision-and](./quick/260730-jty-add-host-side-vice-crash-supervision-and/) |
| 260730-jty-fix | Fix `vice-supervisor.sh` container guard false-positiving on the host (mountinfo signal removed; `--check-container` added) | 2026-07-30 | 362a710 | — |
| 260730-mef | Add a parallel VICE instance pool launch (shared container guard, host launcher, container-side leases, port-namespaced snapshots) | 2026-07-30 | 9ea95f9 | [260730-mef-add-a-parallel-vice-instance-pool-launch](./quick/260730-mef-add-a-parallel-vice-instance-pool-launch/) |
| 260730-nh5 | Add `vice-session` skill and make the Node seam the only path to the emulator (`.mcp.json` emptied; session leases, TTL refresh, tool discovery) | 2026-07-30 | 3d814a4 | [260730-nh5-add-vice-session-skill-and-make-the-node](./quick/260730-nh5-add-vice-session-skill-and-make-the-node/) |
| 260730-oga | Move vice Node modules into the `vice-session` skill so it is self-contained (shared `repo-root.mjs`; shell/Node path-agreement test) | 2026-07-30 | c31b07d | [260730-oga-move-vice-node-modules-into-the-vice-ses](./quick/260730-oga-move-vice-node-modules-into-the-vice-ses/) |
| 260730-p5x | Pool discovers live instances by ping-probing at acquire time (standalone fast probe; four-question health; supervisor-vs-VICE diagnosis) | 2026-07-30 | acf0a83 | [260730-p5x-pool-discovers-live-instances-by-ping-pr](./quick/260730-p5x-pool-discovers-live-instances-by-ping-pr/) |
| 260730-q4b | Shell scripts move to skill `resources/` and auto-install into `tools/` on any skill .mjs entry (gitignored deployment; never overwrites; `install --force` to refresh) | 2026-07-30 | e01531b | [260730-q4b-shell-scripts-move-to-skill-resources-an](./quick/260730-q4b-shell-scripts-move-to-skill-resources-an/) |
| 260730-r0u | Every skill's `.mjs` modules now live in a per-skill `scripts/` directory (`resources/` and data files stay at skill root; two path-anchor regression tests added) | 2026-07-30 | bbb3dd7 | [260730-r0u-all-the-scripts-that-are-used-by-the-ski](./quick/260730-r0u-all-the-scripts-that-are-used-by-the-ski/) |
| 260730-ryz | `vice-session/SKILL.md` rewritten as a usage-only guide; every internal mechanic relocated to a new `INTERNALS.md` maintainer doc | 2026-07-30 | 6341df6 | [260730-ryz-rewrite-vice-session-skill-md-as-usage-o](./quick/260730-ryz-rewrite-vice-session-skill-md-as-usage-o/) |

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-07-30T16:39:36.379Z
Stopped at: Completed quick task 260730-mef: parallel VICE instance pool launch
Resume file: None
