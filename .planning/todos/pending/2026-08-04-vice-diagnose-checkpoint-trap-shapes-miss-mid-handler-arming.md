---
created: 2026-08-04T10:55:00.000Z
title: vice_diagnose's checkpoint_trap shapes miss a mid-handler arming, and no tool reads the epoch
area: tooling
severity: major
files:
  - .claude/mcp/vice/vice-proxy.ts
  - .claude/skills/c64-program-recon/references/observation-hazards.md
  - .claude/skills/vice-wedge-triage/SKILL.md
  - .claude/skills/c64-ram-capture/SKILL.md
---

## Problem

Two defects found by reading the tracked `mcp__vice__` implementation while reconciling the
skills' crash content against it (quick task `260804-eu6`). **Filed rather than fixed**, per
`.claude/CLAUDE.md` § Emulator Access: VICE MCP quirks are logged as pending todos, and `.claude/mcp/`
is edited only when the task *is* maintaining it. This task's job was the skills.

Neither was observed live — the host broker is not running (`vice_diagnose` reports no
`broker.json` record exists at all), so both are source-read findings. Both are cheap to confirm
the moment an emulator is available.

### 1. `checkpoint_trap` matches two shapes; the recorded incident may fit neither

`gatherCheckpointTrapEvidence()` in `vice-proxy.ts` decides the verdict on exactly two shapes:

| Shape | Condition |
|---|---|
| `atPc` | an enabled, stopping, exec checkpoint whose `start` **equals the current PC** |
| `atHandler` | one at the resolved live IRQ handler entry with `hit_count` **exactly `0`** |

The hazard this implements (`observation-hazards.md` § 2, from three recorded incidents) describes
the PC as pinned *"at or just past"* the checkpoint. **"Just past" is not "exactly at."** A
stopping checkpoint armed *inside* a handler rather than at its entry, with a non-zero hit count,
matches neither shape.

The consequence is the specific loss the tool exists to prevent: the verdict falls through to the
cycle bracket, measures zero, returns **`wedged`** — and `wedged`'s documented response is
`vice_recycle`, which the tool's own schema calls out as destroying a healthy instance when the
stop was self-inflicted.

**Why this is not obviously a bug to fix by widening.** Widening `atPc` to a range (say, PC within
N bytes after a checkpoint) trades a false `wedged` for a false `checkpoint_trap`, and a false
`checkpoint_trap` tells the caller *not* to recycle a machine that genuinely needs it. The
`hit_count: 0` corroboration exists precisely because "the checkpoint is near the PC" is weak
evidence on its own. So this needs a decision, not a patch:

1. Widen the shapes and accept the opposite false positive.
2. Add a third, explicitly weaker outcome — "a stopping checkpoint is armed on the live IRQ path
   but neither shape matched" — reported alongside a `wedged` verdict as a do-not-recycle caution,
   rather than changing the verdict.
3. Leave the code and rely on the skill-side mitigation already written (below).

Option 2 looks strongest: it keeps the closed five-verdict vocabulary that
`DIAGNOSE_VERDICTS` is deliberately frozen to protect, while refusing to let a `wedged` verdict
arrive without mentioning the armed checkpoint that could explain it.

**Already mitigated skill-side, so this is not blocking:** `observation-hazards.md` § 2 and
`vice-wedge-triage` both now say that a `wedged` verdict arriving with any checkpoint still armed
must be hand-checked with `vice_checkpoint_list` plus a live-handler resolve before recycling.
That is a procedure the reader has to remember, which is exactly the kind of thing worth moving
into the tool eventually.

### 2. No exposed tool reads the restart epoch

The tool surface has no epoch read. An agent learns an epoch value from exactly two places: the
proxy's own drift error text, or `vice_diagnose`'s `restarted` report.

That made a standing skill instruction unperformable. `c64-ram-capture` said *"Read the restart
epoch at the start of a capture and again at the end"*, and its capture-record template had two
rows for the values. **Corrected in this task** — the proxy already compares the epoch before and
after *every* forwarded call and raises drift itself, so the honest instruction is "record that no
drift error appeared", which is both performable and strictly stronger than two sampled reads.

So there is nothing broken here, but there is a decision worth recording: **is the absence
deliberate?** Arguments both ways:

- **Leave it absent.** A per-call guard that cannot be bypassed is better than a value an agent
  might sample at the wrong moment, and one mechanism beats two. `.claude/mcp/vice/vice-proxy.ts`'s
  own comments repeatedly reject second mechanisms for a question already answered.
- **Expose it read-only.** A capture record that cites a concrete epoch is more auditable than one
  asserting an absence, and `recovery/`'s void procedure asks for "both epoch values" in its note.
  Today those are only obtainable if a drift error happened to fire.

## Solution

1. Decide defect 1 between the three options above. Do not widen the shapes without deciding what
   the opposite false positive costs.
2. Decide whether the epoch's absence from the tool surface is deliberate, and write the decision
   down either way — in `vice-proxy.ts`'s own comments if it stays absent.
3. Confirm both live once the broker is up. Defect 1 is directly reproducible: arm a stopping exec
   checkpoint a few bytes *inside* the live IRQ handler (`$1103` on both this project's releases),
   let it fire at least once, resume, then call `vice_diagnose` and see whether it says
   `checkpoint_trap` or `wedged`. **A `wedged` verdict there confirms the defect.**
4. If defect 1 is fixed in the tool, revisit the skill-side mitigation — a procedure kept alive
   after the tool covers it is the duplication this project keeps paying for.

**Evidence:** `.claude/mcp/vice/vice-proxy.ts` read directly (`gatherCheckpointTrapEvidence`,
`DIAGNOSE_VERDICTS`, `checkEpochAndRebaseline`, `renderRestartedReport`); the live tool schemas
cross-checked against the description strings the same file builds, which is what establishes the
running proxy is built from this source; the absent epoch read confirmed against the session's own
tool list.
**Confidence:** HIGH that the code has these two shapes and no epoch tool. MEDIUM that a
mid-handler arming reaches a `wedged` verdict in practice — the fall-through is plain in the
source, but the runtime path has not been exercised.
</content>
