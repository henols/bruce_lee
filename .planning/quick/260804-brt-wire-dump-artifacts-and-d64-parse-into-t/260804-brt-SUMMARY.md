---
quick_id: 260804-brt
description: Wire dump-artifacts and d64-parse into the c64-ram-capture skill
date: 2026-08-04
status: complete
---

# Summary

`.claude/skills/c64-ram-capture/SKILL.md` now calls the two committed pure-Node
modules instead of describing their behaviour in prose, and its structure was
brought into line with `c64-program-recon` at the user's request mid-task.

## What changed

| Area | Before | After |
|---|---|---|
| Opening | A single boundary sentence | Bold lead directive + a `P=`/`A=` commands-first block, matching `c64-program-recon`'s `D=` pattern |
| Disk inspection | Absent — attach and autostart blind | `d64-parse directory` / `bam` with real output, plus the `suspicious`/`suspicious_reasons` rule for faked entries |
| Capture steps 4–6 | Prose telling the agent to concatenate, count to 65536, hash, and record `$0001`/video/registers by hand | The agent still does every `mcp__vice__*` read, serialises to `chunks.json`/`raw.json`, then one `write-set` call emits all four artifacts |
| `raw.json` contract | Under-specified (three readings) | The exact key set `chip-state` derives from, including `dd00_raw`, `d018_raw`, `sprite_pointers` |
| Worked example | None | Real `assemble` output reproducing a committed digest, plus both guard failures, graded HIGH |
| Overview | None | `## The order` five-phase table |
| Cross-references | None | `## Which skill does what` table pointing at the other three skills |
| Troubleshooting | None | 9-row `Symptom | Fix` table |

## Verification

- Every command shown in the skill was run in this container; all shown output is
  real, not reconstructed.
- `assemble` on chunks re-derived from `recovery/danish/dumps/danish-gameentry-run1.bin`
  returns `sha256 e1b8428c…`, byte-identical to that dump's committed `.capture.json`.
- All three guard messages (`gap before address $3000`, `overlap at address $8000`,
  `assembled 65534 bytes`) were produced by deliberately broken chunk sets.
- `unknown release "x" -- known releases: danish, saeger` confirmed to throw before
  any write; no stray `recovery/` directory was created by the failed call.
- Every path the skill cites resolves to an existing file.
- `node --test` over the four `tools/` test files: **97 pass, 0 fail**.
- The skill-frontmatter validator reports `ok` for all six skills.

## Corrected while in progress

Two claims were written, tested, and removed rather than shipped:

1. A heuristic that a starting track outside the BAM's occupied ranges implies a
   faked directory — the module already flags this itself with named reasons, so the
   skill now cites the real mechanism.
2. A troubleshooting row blaming `no registry at …/RELEASES.json` on running from
   `tools/` instead of the repo root. False: every module derives its repo root from
   `import.meta.url`, so cwd is irrelevant. Logged as a dead end.

## Findings logged

Five entries appended to `.planning/RE-FINDINGS.md` under a new
`## Tooling findings — the pure-Node modules in tools/` section: the `--json`
fakery flags, the digest-reproduction check, the address-naming guards, the
`classification_state` tell, and the cwd dead end. Each carries `Evidence:` and
`Confidence:`.

## Hard rules honoured

No script reaches the emulator: both modules read committed files and the JSON the
agent wrote from its own `mcp__vice__*` calls, and the skill restates that boundary
explicitly. Nothing under `tools/` was modified. No wall-clock synchronisation was
introduced.

## Not done (follow-ups)

- A new skill for `tools/diff-images.mjs` (the provenance diff — mandatory ordering,
  refuse-to-emit gates).
- Updating
  `.planning/todos/pending/2026-08-01-investigate-whether-the-surviving-tooling-is-reusable-as-skills.md`,
  which assesses four modules when six now exist.

## Execution note

Ran inline rather than via `gsd-planner` + `gsd-executor` subagents: the session's
operating directives prohibit spawning subagents unless the user asks, and the
verification evidence was already in the calling context. GSD guarantees preserved —
PLAN.md, atomic commit, this SUMMARY.md, and a STATE.md row.
