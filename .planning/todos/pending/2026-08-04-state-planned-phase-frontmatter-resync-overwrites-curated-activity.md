# `state.planned-phase`'s frontmatter re-sync overwrites curated `last_activity` / `last_activity_desc` with a stale disk-derived guess

**Found:** 2026-08-04, during `/gsd-plan-phase 01.6.2 --gaps` (step 13b, "Record Planning Completion in STATE.md").
**Verb:** `gsd-tools.cjs query state.planned-phase --phase 01.6.2 --name "The One-Process Host Broker" --plans 15`
**Returned:** `{"updated":["Status"],"phase":"01.6.2","plan_count":15}`

## What happened

The verb's own documented contract is body-only. `plannedPhaseCore`
(`.claude/gsd-core/bin/lib/state-transition.cjs:781`) strips the frontmatter, mutates body fields
(`Status`, `Total Plans in Phase`, `Last Activity`, `Last Activity Description`, `## Current
Position`), then reassembles with `existingFm` **unchanged** — so the core transition is innocent.

The damage comes from the adapter's post-write `syncStateFrontmatter`, which re-derives frontmatter
scalars from a disk snapshot. On this run it produced:

| Field | Before (curated) | After (derived) | Verdict |
|---|---|---|---|
| `status` | `executed_gaps_found` | `executing` | **Defensible.** `normalizeStateStatus` (`state-document.cjs:112`) maps "ready to execute" → `executing`, and `executed_gaps_found` matches no branch, so it would have normalized to `unknown` and routed `/gsd-next` to the `unknown` situation. The new value routes correctly. |
| `progress.total_plans` | `44` | `48` | **Correct.** +4 gap-closure plans. |
| `last_activity` | `2026-08-04` | `2026-08-03` | **Regression — went backwards in time.** |
| `last_activity_desc` | A detailed, accurate description of the 11/11 execution, the suite delta, the review counts and the `gaps_found 16/20` outcome | `Phase 01.6.2 execution started` | **Regression — a stale, generic description of a *different, earlier* event.** |

`last_updated` was correctly bumped to the real wall-clock time (`2026-08-04T06:58:04.925Z`), which is
what makes the `last_activity: 2026-08-03` regression self-contradictory *within the same
frontmatter block*: the file claims it was updated on the 4th and that the last activity was on the
3rd, in a run whose only activity was on the 4th.

## Why it matters

STATE.md's entire job is telling the next session the truth after a `/clear`. A `last_activity_desc`
that names execution-start when the actual last activity was gap-closure planning points the next
session at the wrong stage of the workflow — and because `last_activity` also moved backwards, a
staleness heuristic (`smart-entry.cjs`'s `IDLE_STALE_MS`, 72h) is being fed a date that is a day
older than reality. This is the second time in two days that this phase's STATE.md needed hand
repair after a write verb (see the 2026-08-03 note in `.planning/STATE.md`'s `## Current Position`,
where the same verb returned `updated: []` and wrote nothing at all).

Note the two failures are *opposite*: on 2026-08-03 the verb under-wrote (body untouched), on
2026-08-04 it over-wrote (frontmatter clobbered). A fix that only addresses one direction will leave
the other.

## Suspected cause

`syncStateFrontmatter` treats `last_activity` / `last_activity_desc` as **system-derived** and
recomputes them, when the field-classification table (ADR-1769 §4) should have them as
**preserve-unless-newer** — a derived value must never replace a curated one that is *more recent*.
`plannedPhaseCore` even validates that these three keys exist in `FIELD_CLASSIFICATION` before
touching the body (`state-transition.cjs:784-791`), which suggests the classification is present but
the re-sync path is not honouring it.

The adapter is documented as `readModifyWriteStateMd({ resync: false })` specifically so that
"milestone-wide `progress.*` frontmatter is NOT re-derived from a half-planned disk snapshot (#500
RC1)". The `progress.total_plans` update did land correctly, so either `resync` is not actually
`false` on this path, or a second sync runs after it.

## Reproduction

Any phase where the curated `last_activity` is **more recent than** whatever the disk snapshot infers
— i.e. any planning run that follows a same-day execution or verification whose outcome was recorded
by hand. Gap-closure runs (`--gaps`) hit this reliably, because they *always* follow an execution and
a verification on an already-executed phase.

## Fix direction

Make `last_activity` / `last_activity_desc` preserve-unless-newer in the re-sync, not recompute-always:
never move `last_activity` backwards, and never replace a non-empty `last_activity_desc` with a
generic template string. If the derived value is genuinely wanted, it should lose to a curated value
whose date is equal or later. Same-family as the `phase insert` / `roadmap analyze` write-verb
defects already filed here.

## Related

- `.planning/STATE.md` `## Current Position` — carries both the 2026-08-03 and 2026-08-04 notes inline
  so a reader of STATE.md alone sees that those lines are hand-maintained.
- Existing pending todos for `phase insert` / `roadmap analyze`: read verbs resolve this ROADMAP fine,
  write verbs do not see its phases. This is the same class (write verbs mishandling a ROADMAP with
  decimal phase numbers and a large curated STATE.md), reported separately because the mechanism here
  is a frontmatter re-sync rather than a phase-section parser.

**Evidence:** Observed live during `/gsd-plan-phase 01.6.2 --gaps`; before/after captured from
`git diff .planning/STATE.md` immediately after the verb ran, with the verb's own JSON return
recorded above. Cause is read from `state-transition.cjs:781-834` and `state-document.cjs:112-136`.
**Confidence:** HIGH for the symptom and the reproduction condition (both directly observed).
MEDIUM for the suspected cause — the classification table and the second sync path were not read.
