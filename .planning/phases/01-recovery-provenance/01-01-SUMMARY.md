---
phase: 01-recovery-provenance
plan: 01
subsystem: recovery
tags: [vice, mcp, c64, 6510, ram-capture, reproducibility, provenance]

requires: []
provides:
  - "A reproducible 64K RAM recovery procedure driven by one command, proven against danish.d64"
  - "Three committed 65536-byte captures at a recorded, re-armable dump trigger"
  - "recovery/RELEASES.json — the N-way release registry with `canonical` as a boolean field"
  - "The reproducibility contract: program-image identity across N>=3 captures under RAM drift"
  - "recovery/danish/NOTES.md — the recorded procedure, concrete enough for a stranger to re-run"
  - "Tier-1 provenance evidence for danish.d64 (DC-011/P), captured during boot"
affects: [01-02, 01-03, 01-04, 01-05, 01-06, phase-02, phase-03, phase-04]

tech-stack:
  added: ["node:test (built-in, zero install)"]
  patterns:
    - "Single MCP client seam; the vice_disk_list deny-list lives inside it, checked before serialisation"
    - "Release identity is registry data, never tool control flow — a third release is one entry plus one invocation"
    - "Synchronisation is always a program event (checkpoint), never elapsed time"

key-files:
  created:
    - tools/recover.mjs
    - tools/recover.test.mjs
    - tools/releases.mjs
    - recovery/RELEASES.json
    - recovery/danish/NOTES.md
    - recovery/danish/dumps/danish-gameentry-run1.bin
    - recovery/danish/dumps/danish-gameentry-run2.bin
    - recovery/danish/dumps/danish-gameentry-run3.bin
  modified:
    - .planning/STATE.md

key-decisions:
  - "Criterion 1 redefined (developer-approved) from full 64K byte-identity to program-image identity, because never-written RAM drifts continuously while the emulator runs — proven with no game involved"
  - "N>=3 captures required to call a byte stable; 93 bytes were identical in runs 1+2 yet differed in run 3"
  - "Drift is accepted only via three independently-justified clauses, none of them a tunable number"
  - "A power-on-pattern block-fill heuristic was REJECTED despite scoring 134/137 — threshold-tunable"
  - "vice_run_until is not used at all; an armed checkpoint plus one resume is simpler and equally signal-based"
  - "A snapshot failure can never discard a capture — the snapshot is a host-side convenience, the dump is the artifact"

patterns-established:
  - "Signal not duration: every wait is a checkpoint hit whose hit_count is verified; a duration cannot be re-armed, so a duration-triggered dump is unfalsifiable"
  - "Poll with vice_ping (which does not pause the machine) and resume exactly once per wait"
  - "Refuted approaches are committed with their evidence so they are not retried"
  - "Reclassified-as-drift bytes are always listed with their values and matched clauses — auditable, not a boolean"

requirements-completed: [RECOVER-01, RECOVER-02]

coverage:
  - id: D1
    description: "One release goes from cold hard reset to a committed 65536-byte pure-RAM image via a single command"
    requirement: "RECOVER-02"
    verification:
      - kind: integration
        ref: "node tools/recover.mjs recover danish --run-label run1; stat -c%s recovery/danish/dumps/danish-gameentry-run1.bin == 65536"
        status: pass
    human_judgment: false
  - id: D2
    description: "Both disk images boot under host VICE through the MCP surface by a documented, repeatable procedure that never calls vice_disk_list"
    requirement: "RECOVER-01"
    verification:
      - kind: integration
        ref: "node tools/recover.mjs boot danish (autostart, no fallback needed); DENY_LIST contains vice_disk_list, rejected before serialisation"
        status: pass
    human_judgment: false
  - id: D3
    description: "The dump trigger is a recorded, re-armable PC address with its locating evidence — a signal, never a duration"
    requirement: "RECOVER-02"
    verification:
      - kind: integration
        ref: "$08B1 armed via vice_checkpoint_add(exec,stop); hit_count verified before any read; how_located recorded in RELEASES.json"
        status: pass
    human_judgment: false
  - id: D4
    description: "Re-running the recorded procedure reproduces the program image byte-for-byte under RAM drift"
    requirement: "RECOVER-02"
    verification:
      - kind: integration
        ref: "node tools/recover.mjs reproduce danish --runs 3 => 0 real divergences; $0400-$CB66 and $0002-$00FF identical in all 3"
        status: pass
      - kind: unit
        ref: "tools/recover.test.mjs (11 tests, incl. 'NOT VACUOUS -- a real divergence in program-like memory fails')"
        status: pass
    human_judgment: false
  - id: D5
    description: "The byte-assembly contract is pinned by tests that run without the emulator"
    requirement: "RECOVER-02"
    verification:
      - kind: unit
        ref: ".claude/skills/c64-ram-capture/scripts/ram-capture.test.mjs (27 tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The procedure is written down concretely enough for a stranger to re-run it and get the same bytes"
    requirement: "RECOVER-02"
    verification:
      - kind: manual_procedural
        ref: "recovery/danish/NOTES.md — trigger $08B1, $01=$23 decoded, ranges, 3 digests, snapshot name, exact command"
        status: pass
    human_judgment: true
    rationale: "Whether the write-up is genuinely sufficient for an unfamiliar reader is a judgement no assertion can make. The mechanical checks (concrete hex trigger, concrete $01 byte, explicit ranges, 64-char digests, snapshot name, runnable command) all pass, but they cannot confirm the prose is understandable."

duration: ~4h (across two sessions, including 6 host VICE outages)
completed: 2026-07-31
status: complete
---

# Phase 01 Plan 01: Recovery Tracer Summary

**One cracked release now goes from a cold emulator to a committed 64K RAM image whose program content is provably identical across three independent boots — and the two mechanisms that made that hard, monitor-pausing reads and continuous RAM drift, are documented rather than worked around.**

## Performance

- **Duration:** ~4h across two sessions
- **Tasks:** 2 of 2
- **Files created:** 8 (3 tools, 1 registry, 1 procedure record, 3 captures + records)

## Accomplishments

- **The tracer's claim holds.** `$0400–$CB66` (~51 KB of loaded game code and data) and zero page `$0002–$00FF` are **byte-identical across three independent cold boots**. 65,140 of 65,536 bytes stable.
- **The dump trigger is a signal.** `$08B1`, the game's title-screen input dispatcher, armed as an exec checkpoint whose `hit_count` is verified before a single byte is read. Confirmed as a genuine routine entry by disassembly, and distinct from the loader's own `$0900` poll.
- **`bank:"ram"` verified against the *running* game**, which research could only test on an idle machine: `$E000` reads `4C00E34C06E3…` as RAM versus `8556200FBCA5…` as ROM. No `$01` write was performed anywhere, so D-08's fallback stays documented and unexercised.
- **Tier-1 provenance evidence captured for free during boot.** The cracktro carries "Danish Crackers", release id **DC-011/P**, and "They make'em, We break'em" — independently corroborating the CSDb record found during research. Feeds RECOVER-07 in plan 01-06.

## Task Commits

1. **Task 1: end-to-end recovery tracer** — `a5ec1de`, `a81cc70`, `40f8ed9`, `f7976e6`, `9fb7c00` (wip/fix)
2. **Task 2: procedure record + assembly contract** — `63e5819`, `d1014c6`, `dcfa478` (feat/evidence)

## Decisions Made

**Criterion 1 was redefined, with developer approval.** Full 64K byte-identity is unachievable here, proven without involving the game at all: a bare C64 idling for 20 s produces 994 differing bytes; a repeat gave 1014; two back-to-back power-on captures with the machine never deliberately run gave 993, because drift accumulates *during* the capture. The new bar — program-image identity, with exclusions recorded as evidence — is both achievable and more informative, since it states which bytes are evidence and which are emulator noise.

**Three captures, not two.** 93 bytes were identical in runs 1+2 and differed in run 3. Two samples cannot separate "the program writes this" from "it drifted the same way twice", so `classifyRunSet` refuses fewer than three.

**Drift is accepted only via three clauses, none of them a tunable number:** inside volatile scratch; a shared single-bit drift origin (searched exhaustively over all 256 candidates); or a *pure* power-on pattern block (every neighbour exactly `$00`/`$FF`, binary rather than a percentage). On the three captures, zero differences failed all three, and the only two needing clauses 2 or 3 satisfied **both**.

## Deviations from Plan

**1. `vice_run_until` removed entirely** — the plan instructed arming a checkpoint *and* calling `run_until` on the same address as "belt and suspenders". `run_until` creates its own competing `temporary` checkpoint (two live checkpoints at `$08B1`, one temporary, were observed), and the first two host crashes happened during that work. An armed checkpoint plus one resume is simpler and equally signal-based. Outages continued without it, so it is not the sole cause — recorded as weakened, not proven.

**2. D-07 corrected, surfaced in the plan itself** — a `.vsf` cannot be committed. `vice_snapshot_save` takes only a `name`, writes host-side, and nothing exports snapshot bytes into the container. Snapshots are recorded by name; reproducibility runs through the recorded procedure, which is strictly stronger.

**3. `node:test` adopted** — a recorded deviation from `01-VALIDATION.md`'s "no test framework" line, justified because it is a Node built-in (zero install, D-18-compliant) and the byte-assembly and comparison functions are the one place where a silent bug corrupts every downstream verdict invisibly.

**4. A `sleep` remains in the poll loop's run-window** — not a trigger. Every state-reading MCP call pauses the machine, so the interval is the only window in which the CPU advances. The trigger itself is a checkpoint whose `hit_count` is verified; nothing on the path to the dump measures time.

**Impact:** all four were necessary for correctness. No scope creep.

## Issues Encountered

**Six host VICE MCP outages.** Two needed manual restarts; four self-recovered. Outages 4–6 all died on `vice_execution_run`. Root cause unresolved — the supervisor's one logged death shows `exit_status=0 signal=none`, i.e. a *clean exit* rather than a crash, which suggests the emulator is being asked to quit. Mitigated by a developer-authored host-side supervisor plus epoch-based restart detection, and by cutting resumes from ~20 to 3 per capture. **Zero outages** across the final four captures.

**A hazard the supervisor introduced, and how it was closed.** Auto-restart plus my transport retry meant a retry could *succeed* against a brand-new blank machine — no disk, no checkpoints, halted CPU — and produce a full-size file that looked entirely valid. Retry success was no longer proof of continuity. The epoch check makes it safe; the two are one mitigation in two halves and neither may be removed alone.

**Three refuted theories, committed with their evidence:** address-set exclusion of drift (stochastic per run — 1014 measured drift-prone addresses covered only 2 of 137 real diffs); a power-on baseline (reset does not restore pristine RAM, and no stable reference exists at any instant); and a structural argument that `$FDD9` was never-written (withdrawn — the loader demonstrably writes RAM under KERNAL ROM, so "under banked-in ROM" proves nothing).

**A documentation trap worth carrying forward:** `$0000`/`$0001` in the `.bin` are the 6510's on-chip DDR and port, **not** the banking state. `bank:"ram"` returned `$a9/$40`, `$70/$40`, `$0f/$40` across the three runs while the live `$01` is `$23`. Reading offset 1 of the image as the banking register gives a wrong answer.

## Notes for Future Phases

- **Phase 3's replay harness will hit the pause-on-read behaviour.** Resume must be the last call before a quiet interval; poll with `vice_ping`, which does not pause the machine (~987k cycles/s while ping-polling versus ~991k fully quiet, against ~6k/s when polling without resuming).
- **This machine is PAL, ~50.125 Hz.** Several MCP docstrings quote "~16.7 ms at 60 Hz". That figure is wrong here.
- **`recovery/clean/bruce-lee.bin` is a projection, not an artifact** — a byte-identical copy of whichever release carries `canonical: true`. Enforced by plan 01-02's validator.
