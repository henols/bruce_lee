---
title: How the RE-FINDINGS sweep runs, and why
date: 2026-08-01
context: /gsd-explore — starting the C64 RE skill
---

# How the RE-FINDINGS sweep runs, and why

Decided in exploration on 2026-08-01, before any of the sweep was executed. Step 1 of
`.planning/todos/pending/2026-08-01-collect-c64-reverse-engineering-findings-into-a-fast-re-skill.md`
is "collect first, write second"; this note settles *how*, so the sweep session does not
re-litigate it.

## The situation the sweep starts from

The skill todo's Problem section was already a near-complete draft — the vector table, the
VIC-II derivation chain, the SID idioms, the CIA split, the tool mapping. So writing was never
the bottleneck. Three things were:

1. **The sweep itself.** `.planning/RE-FINDINGS.md` openly said its source sweep was
   outstanding; it carried only a seed from `STATE.md`.
2. **Validation.** None of the method had been run. `recovery/danish/dumps/` holds three
   verified gameentry captures of the depacked image — an unusually good test bed, unused.
3. **The method/lookup split.** What belongs in the new skill versus what extends
   `c64-memory-mapping`.

Ordering chosen: **sweep → write → validate**, per the todo. The alternative considered and
rejected was validate-first (run the method on the depacked image and write the skill as the
transcript of what worked). That would ship every line pre-validated, but it risks losing the
halt-record detail, which is the material most at risk of evaporating and the material the todo
itself calls the most valuable of the set. Worth revisiting as the *shape of step 5* — a method
that does not reproduce known-good results is not ready.

## Decision 1 — log everything, graded by confidence

**Not** live-verified-only. Both this project's live measurements and the doc-derived method
knowledge become entries; every entry carries an evidence grade.

**Why:** the log's job is to be raw material, and the project's own rule is that duplication is
free while omission is not. A live-only filter would have discarded the entire VIC-II/SID/CIA
chain — the largest block of transferable knowledge in the corpus — on the grounds that nobody
had run it yet. That is exactly backwards: an unrun method with addresses attached is a
hypothesis the next session can test in minutes, which is the whole point.

**Cost accepted:** a much longer log, and the discipline to grade honestly on every line. The
grade is what does the discriminating, so a dishonest grade is worse than a missing entry.

## Decision 2 — `Confidence:` is a required field, distinct from `Evidence:`

The entry format gains a `Confidence: HIGH | MEDIUM | LOW` line. `Evidence` says *how* a
finding was established; `Confidence` says *how much to trust it*. Collapsing them loses the
second, and the second is what a reader scanning the log actually needs.

The scale reuses `.planning/research/STACK.md`'s vocabulary rather than inventing a parallel
one — one confidence language across the project, or the grades stop meaning anything.

**Promotion is by re-logging, not by editing.** A MEDIUM entry confirmed live gets a new dated
entry citing the live evidence. Silently upgrading a grade in place destroys the record of when
something stopped being a guess, in an append-only file whose entire value is that record.

## Decision 3 — parallel readers, single merging author

One subagent per source document, each returning entries already in the log's format with
`Type` / `Evidence` / `Confidence` / `Saves` filled. The orchestrator merges and writes.

**Why not sequential:** the corpus is ~300 KB across ten documents. Read inline end-to-end, it
consumes most of a context window before the first entry is written — and the entries written
last would be the ones written worst, which inverts the quality gradient. Parallel readers give
every source equal attention regardless of where it falls in the order.

**Why a single author:** an append-only file with ten concurrent writers is not append-only. The
readers return data; one process writes.

Sources, with expected grade skew:

| Source | Size | Expected |
|---|---|---|
| `01-RESEARCH.md` | 156 KB | mostly MEDIUM, doc-sourced |
| `01-04-ATTEMPT-2-HALT.md` | 27 KB | HIGH, live, negative |
| `01-04-ATTEMPT-1-HALT.md` | 12 KB | HIGH, live, negative |
| three `01-0N-SUMMARY.md` | 45 KB | HIGH/MEDIUM mixed |
| `01-PATTERNS.md` | 17 KB | LOW/MEDIUM, inferred |
| `.planning/research/` ×4 | ~60 KB | MEDIUM, doc-sourced |

The two HALT records are the priority: they document what the method got *wrong*, and negative
findings are the ones a register list can never supply.

## Decision 4 — merge duplicates, keep every provenance line

Ten readers will return the same finding several times. Identical findings merge into one entry
carrying **every** provenance line, rather than being deduped to a single source or fragmented
across five near-identical entries.

The log's "do not deduplicate" rule is about not *suppressing* a finding as probably-known. It
is not a mandate to scatter one fact across the file. A finding independently recorded in three
places is stronger evidence, and the merged entry should show that.

## What was fixed before the sweep, and why it had to be first

The chip-discovery method (~200 lines of VIC-II / SID / CIA) lived in the skill todo's Problem
section, and `RE-FINDINGS.md` *pointed at it* rather than holding it.

`.claude/CLAUDE.md` states the governing rule: *"Append-only, and never in a todo. Todos move to
`completed/` when their work is done; the log has to outlive every one of them."* Completing the
skill todo would therefore have archived the single largest block of method knowledge in the
project — the exact failure mode the rule exists to prevent, sitting inside the file that states
the rule.

Migrated on 2026-08-01, before the sweep, so that ten readers append to a log that is already
self-sufficient. The control-flow half (entry point → vectors → IRQ source → main loop →
structure) moved with it: it sat in the same todo under the same archive risk, and fixing half
of a contradiction leaves a contradiction.

All migrated entries are graded MEDIUM. Promoting them is step 5 of the todo — run the method
cold against `recovery/danish/dumps/danish-gameentry-run1.bin` and see whether it independently
rediscovers the charset, sprite set and screen layout that the extraction work already
established.

## Deliberately not decided here

**Where the derivation tables finally live.** The `$DD00` bank map, the ECM/BMM/MCM matrix and
the SID voice layout are lookup, and lookup is `c64-memory-mapping`'s job. They are in the log
so they survive; the audit of what `c64-memory-mapping` already carries is step 4 of the todo
and is not pre-empted. A second copy of a register table is the drift this project keeps paying
for — but losing the table entirely is worse, and the log is the safe holding pen.

**Whether the result is a skill at all.** The keep/cut criterion from
`2026-08-01-investigate-whether-the-surviving-tooling-is-reusable-as-skills.md` still applies,
and `2026-08-01-pack-the-whole-c64-re-toolkit-including-the-vice-mcp-into-one-package.md` is a
competing home. That question is downstream of having the material collected; it does not block
the sweep.
