# Reverse-Engineering Findings Log

Append-only. Raw material for the RE skill
(`.planning/todos/pending/2026-08-01-collect-c64-reverse-engineering-findings-into-a-fast-re-skill.md`).

Governed by `.claude/CLAUDE.md` § Reverse-Engineering Findings Log. Log at discovery, not at
session end. Negative findings count. Do not suppress a finding as "probably already known" —
duplication is free, omission is not.

**Entry format**

```
### YYYY-MM-DD — one-line finding

**Type:** shortcut | trick | hazard | dead end | confirmation
**Evidence:** how it was established (live measurement, disassembly, doc) — provenance is the
difference between a fact and a guess
**Saves / costs:** what it buys, or what ignoring it costs

Detail.
```

**Status:** the full sweep of `.planning/research/`, `01-RESEARCH.md`, `01-PATTERNS.md`, the
`01-0N-SUMMARY.md` files and both `01-04-ATTEMPT-N-HALT.md` records is **outstanding** — it is
step 1 of the skill todo. What follows is a partial seed of the highest-value verified findings
already recorded in `STATE.md`, entered to establish the format and prevent further loss.

The VIC-II / SID / CIA discovery method (bank → `$D018` → mode → sprites; the SID player and
RNG idioms; the CIA#1-vs-#2 split) is written up in the skill todo's Problem section rather
than duplicated here. New findings against those chips belong in this log.

---

## Emulator technique

### 2026-07-30 — `vice_keyboard_type` is invisible to code that polls the keyboard matrix

**Type:** hazard
**Evidence:** live, during recovery work on the cracked disks
**Costs:** an afternoon, if unknown

The crack reads `$DC00`/`$DC01` directly rather than going through the KERNAL keyboard buffer,
so `vice_keyboard_type` delivers nothing it can see. Direct matrix polling is the norm in games
and cracks, not the exception — assume it until shown otherwise.

### 2026-07-30 — keypress delivery: press at the gate, HOLD, release at the trigger checkpoint

**Type:** trick
**Evidence:** three mechanisms measured against each other
**Saves:** determinism — the difference between a reproducible capture and a 264-byte diff

`vice_execution_run` + a wall-clock sleep *does* deliver the key, but the release lands on a
different CPU cycle each run: **264 of 65536 bytes differed**, including `$0049` (the exact byte
the trigger routine reads) and the whole stack page. `vice_execution_step(fixed count)` is
cycle-identical but never delivers a held matrix key — the machine sat at `$0900` for 150 s.
Releasing on a *program event* (a checkpoint) instead of a time is what makes it repeatable,
and leaves no key held in CIA state in the dump.

### 2026-07-30 — every state-reading `vice_*` call pauses the emulator and does not resume it

**Type:** hazard
**Evidence:** measured directly — 991,000 cycles/s (100% of PAL C64) with an explicit
`vice_execution_run` issued last, vs **6,000 cycles/s (0.7%)** when polling in a loop without
re-resuming
**Costs:** presents as "the checkpoint never fired"

Any poll/wait loop must re-issue `vice_execution_run` after each state read, then leave the
server alone for a real interval. `Speed:100`/`WarpMode:0` are not the cause.

### 2026-07-30 — `vice_ping` is the non-pausing poll

**Type:** shortcut
**Evidence:** 986,693 cycles/s while ping-polling vs 991,569 fully quiet — effectively free
**Saves:** cut resumes from ~20+ to 3 per capture

Poll with `vice_ping`, not with `vice_checkpoint_list` (which pauses).

### 2026-08-01 — `vice_ping`'s `execution` field is NOT a liveness signal

**Type:** hazard
**Evidence:** confirmed twice independently — a stalled host VICE kept answering
`execution: "running"` while `vice_cycles_stopwatch` measured **exactly 0 cycles** across
reset→run→poll→read
**Costs:** the orchestrator used it to wrongly reassure the developer *after* they had correctly
suspected a freeze

The only trustworthy liveness test is **a cycle count that advanced**. Every non-cycle-based
health check reads green during a silent stall.

## Capture and comparison

### 2026-07-30 — the recovery procedure is deterministic for the program image, not for 64K

**Type:** confirmation
**Evidence:** two independent cold-boot run pairs of `danish.d64`
**Saves:** makes byte-identity a usable criterion instead of an impossible one

`$0400–$CB66` (~51 KB of loaded game code+data) and zero page `$0002–$00FF` are byte-identical;
65,320 of 65,536 bytes match. Every difference is a 6510 port register, volatile scratch
(`$0100–$03FF`), or never-written RAM.

### 2026-07-30 — never-written RAM drifts continuously, so full-64K byte-identity is impossible in principle

**Type:** dead end (kills the baseline-diff approach)
**Evidence:** measured three ways with no game involved — 994 and 1014 bytes differing between
two 20 s idle runs, and **993 between two back-to-back power-on captures with the machine never
deliberately run**

Drift accumulates *during* a capture. Consequences: `mode:"hard"` reports a power cycle but does
**not** restore pristine RAM once the machine has run (real hardware behaves the same — reset
does not clear DRAM); there is no stable reference image at any instant; and drift is stochastic
per run, so it can never be excluded by address list — an idle control yielding 1014
drift-prone addresses covered only **2 of 137** real diffs.

### 2026-07-30 — the working drift discriminator is a property of the VALUE, not the address

**Type:** trick
**Evidence:** all 137 diffs in one run pair were Hamming distance exactly 1
**Saves:** a falsifiable contract instead of a tuned threshold

Drift flips *individual bits*; a program writing different data differs in ~4 bits on average.
`$0000–$0001` are excluded structurally (6510 on-chip I/O port registers, not memory). A
power-on-pattern block-fill heuristic was **rejected** despite scoring 134/137 — it is
threshold-tunable, and tuning until green manufactures the false confidence this work exists to
prevent. Known gap: one 2-bit drift byte (`$FDD9`) still fails, so the Hamming-1 rule is
slightly too tight; widening the threshold is not the fix.

### 2026-08-01 — the only trustworthy VICE liveness test is a cycle bracket, and it clears the host after the broker fix

**Type:** confirmation (live), plus the hazard it retires
**Evidence:** fresh session, orchestrator-side, four calls — `vice_cycles_stopwatch reset` →
`vice_execution_run` → three `vice_ping` polls → `vice_cycles_stopwatch read` = **21,551,860
cycles**. Same bracket read **exactly 0** twice during 01-04 attempt 2, on two different disk
images, while `vice_ping` kept answering `execution: "running"` throughout.
**Saves:** one tool call's worth of certainty before dispatching any plan that drives the
emulator — and it is the difference between a real zero and a stalled machine's worthless zero.

`vice_ping`'s `execution` field is **not** a liveness signal; neither is a transport that
answered. Only an advancing cycle count is. Run the bracket first in any session that will do
live work, before committing to a long pass — attempt 2 lost its saeger half and all of Task 3
to a stall that every non-cycle-based health check read as green.

Two facts confirmed alongside it, both cheap and worth repeating at session start:
`vice_checkpoint_list` returned `count: 0`, so no prior session's checkpoints survived into this
one; and the instance is granted on the session's **first** forwarded call (here `vice_ping` →
`3.10`/`C64SC`/`paused`), so a subagent of this session inherits *this* instance — which is why
a stalled session cannot be repaired from inside and has to be abandoned for a fresh one.

### 2026-08-01 — `vice_disk_attach` rejects a repo-relative path; an absolute container path works

**Type:** hazard
**Evidence:** live, during 01-04 Task 2's saeger pass — `vice_disk_attach({unit:8, path:"disks/saeger.d64"})`
returned an error ("Failed to attach disk image") from the proxy; the identical call with
`path` set to the absolute in-container worktree path (`git rev-parse --show-toplevel`, then
`/disks/saeger.d64` appended) succeeded immediately, no other change.
**Saves/costs:** a failed attach reads like a host-side problem (the error message even quotes the
host-side launcher path and the "ask a human to start it" boilerplate), which wastes time
suspecting the emulator when the actual defect is a relative path the host-side path-translation
layer can't resolve. Always resolve the disk image to an absolute in-container path — derive it
from `git rev-parse --show-toplevel` inside the worktree, per the project's own
worktree-path-safety rule for Edit/Write — before calling `vice_disk_attach`, never pass a
repo-relative string like `disks/<release>.d64` directly.

### 2026-08-01 — a genuine mid-session host VICE crash/respawn, self-surfaced by the proxy as an epoch-drift error, and auto-recovered on the NEXT call

**Type:** hazard, plus a confirmation that the epoch mechanism now works as designed
**Evidence:** live, during 01-04 Task 2's saeger pass, immediately after `vice_autostart` +
`vice_execution_run` on `saeger.d64` and several non-pausing `vice_ping` polls. Three consecutive
`vice_ping` calls failed — first `UND_ERR_SOCKET`, then `ECONNREFUSED` (naming lease
`req-92387-...`, port 6510, epoch 8, pid 827101, "may have crashed after being granted") — then a
fourth call returned a distinct error: `"epoch drift detected before forwarding -- the host VICE
MCP server's epoch changed from 8 to 9, pid 944178"`. Every `vice_ping` call after that fourth one
succeeded normally (`execution:"paused"`, i.e. a fresh boot). A fresh `cycles_stopwatch
reset -> execution_run -> ping x3 -> read` bracket on the new epoch-9 instance measured **13,501,532
cycles** — genuinely live, not another silent stall.
**Costs / saves:** costs the whole in-progress saeger boot (disk attach, autostart, run, and the
partial `$08F0`/PC=61024 register read taken under epoch 8) — all of it must be treated as void
and redone from `vice_disk_attach` on the new instance, because a differently-booted machine
answering the same tool calls is not the machine the earlier steps ran against. Saves: the proxy's
own epoch-drift detection means this doesn't have to be caught by comparing cycle brackets by
hand — the transport surfaces it as a loud, unambiguous error naming both epoch numbers on the
very next forwarded call, and (unlike the STATE.md-documented "proxy caches a dead grant for the
session's whole life" defect from the prior incident) subsequent calls transparently used the new
instance without the session needing to be abandoned. This is the eighth host VICE incident in
this project and the first one that self-healed within the same session rather than requiring a
fresh session.
**Rule applied:** per `.claude/CLAUDE.md` § Emulator Access ("Compare the restart epoch across a
bracket. A changed epoch voids the run.") and this plan's identity-change handling, nothing
measured between the last confirmed-good point and the epoch-drift report is trustworthy. The
correct response is not to inspect the "paused" state further as if it were a continuation — it
is to re-run the entire boot sequence from `vice_disk_attach` on the new instance.
**Confidence:** HIGH (measured live, twice independently, both self-healed the same way).

**Second occurrence, same session, ~8 minutes later (epoch 9 → 10).** Immediately after the
epoch-9 instance's re-derived idle-window checkpoints had just measured a clean counting-tier
probe (45,519,518 cycles, non-stopping checkpoint hit_count 2513), the very next two
`vice_checkpoint_add` calls failed the same way — `UND_ERR_SOCKET` then `ECONNREFUSED` naming
lease `req-92387-...`, pid 944178, epoch 9 — and the following `vice_ping` reported `"epoch drift
detected... changed from 9 to 10, pid 1056804"`. Identical shape to the first occurrence:
`vice_checkpoint_list` on the new epoch-10 instance immediately returned `count:0` (fresh, no
stale checkpoints), and a fresh cycle bracket measured 19,017,687 cycles — genuinely live. Two
crashes in roughly 20 minutes of continuous live work is a real rate, not a one-off: plan a live
session for saeger/danish work to tolerate re-deriving a boot sequence more than once, and treat
every post-crash "paused" read as a fresh machine requiring a full reboot, never a resume point.
