---
phase: quick-260804-bux
plan: 01
subsystem: skills
tags: [skills, c64-ram-capture, compare, drift, re-findings]

requires: []
provides:
  - "scripts/compare.mjs — difference classification, drift floor, digest"
  - "templates/capture-record.template.md"
  - "c64-ram-capture aligned with c64-program-recon's shape"
  - "the volatile-span rule corrected to include $D000-$DFFF"
affects: [c64-ram-capture skill, .planning/RE-FINDINGS.md]

tech-stack:
  added: []
  patterns:
    - "Region classification before bit-count when comparing captures: an I/O read can never be stable, so no bit-count threshold makes it meaningful"

key-files:
  created:
    - .claude/skills/c64-ram-capture/scripts/compare.mjs
    - .claude/skills/c64-ram-capture/templates/capture-record.template.md
  modified:
    - .claude/skills/c64-ram-capture/SKILL.md
    - .planning/RE-FINDINGS.md

key-decisions:
  - "Dropped the planned three-file references/ split. 260804-ae9-b had just done this same alignment on acme-build and deliberately invented no references/ directory, citing skill-writer's 'put the whole workflow in SKILL.md when it fits'. At 221 lines c64-ram-capture is the same size as acme-build, so splitting one and not the other would have made the skill family less uniform — the opposite of the request."
  - "Made $D000-$DFFF volatile (HIGH confidence, structural) but deliberately left $E000-$FFFF failing (MEDIUM). Blanket-excluding 8 KB on the strength of two unexplained addresses would hide real divergence; leaving it failing keeps the open question visible."
  - "Did not touch SKILL.md until 260804-brt committed, on the user's instruction, and preserved its d64-parse/dump-artifacts wiring intact."

requirements-completed: [STRUCT-ALIGN, SCRIPTS, TEMPLATES, REFERENCES-SECTION, VOLATILE-FIX]

coverage:
  - id: S1
    description: "compare.mjs implements the three classification rules and the drift floor as pure logic, contacting nothing"
    verification:
      - kind: unit
        ref: "imports node:fs/node:crypto/node:path only, no socket/fetch/broker-state; all six committed captures are 65536 bytes and their sha256s match their committed .capture.json manifests exactly; identical-image, PASS, FAIL, wrong-size, missing-arg and bad-verb paths all exercised with correct exit codes"
        status: pass
    human_judgment: false
  - id: S2
    description: "c64-ram-capture carries every element of c64-program-recon's shape"
    verification:
      - kind: unit
        ref: "command block with C= var, order table, worked example, References section, Which-skill-does-what table, Troubleshooting table, scripts/, templates/ — all present; frontmatter checker ok on all six skills; all 6 cited paths resolve"
        status: pass
    human_judgment: false
  - id: S3
    description: "Shown output in SKILL.md matches reality byte-for-byte"
    verification:
      - kind: unit
        ref: "the compare worked-output block diffed against a live run: IDENTICAL. Two invented sample rows were caught and replaced during verification"
        status: pass
    human_judgment: false
  - id: S4
    description: "The volatile-rule correction is applied, its effect measured, and both findings logged at discovery"
    verification:
      - kind: unit
        ref: "all six pairings re-run after the change: PASS count 1 -> 3, every remaining failure isolated to $FAD8 (danish) / $FC51 (saeger); two graded RE-FINDINGS entries appended"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-08-04
status: complete
---

# Quick Task 260804-bux: Align `c64-ram-capture` With `c64-program-recon`

**Gave the skill the two directories it lacked (`scripts/`, `templates/`) and the one section it
lacked (`References`) — and, while building the script, found and fixed a correctness defect in
the comparison rule the skill had carried as prose.**

## The defect, which was the real find

`SKILL.md` stated the difference-classification rules in prose only: volatile spans
`$0000-$0001`, `$0100-$01FF`, `$0200-$03FF` excluded from the verdict; one differing bit is
drift and passes; two or more is divergence and fails.

Implementing those rules exactly and running them over the project's own six committed
three-run-verified gameentry captures produced **five FAILs out of six pairings**. Every
divergence across every pairing sat at one of five addresses:

| Address | What it is |
|---|---|
| `$D344` | VIC-II register image (registers repeat every `$40` across `$D000-$D3FF`) |
| `$D625`, `$D628` | SID images (`$D400-$D7FF`) |
| `$FAD8`, `$FC51` | RAM under KERNAL ROM (`$01 = $40`, HIRAM 0) |

`$D000-$DFFF` is not RAM. Reading it samples live hardware — the same mechanism this project
already exploits by using `$D41B` as an RNG — so two captures of one checkpoint can never agree
there. The documented volatile list omitted the entire range, so the rule condemned good
captures over differences that were structurally guaranteed. **Region classification, not
bit-count, decides whether a difference matters:** a 2-bit difference at `$D625` is meaningless
and a 1-bit difference in game code is not, which is the exact inverse of what the rule said.

Adding `$D000-$DFFF` moves the PASS count from 1 to 3 and isolates every remaining failure to
two addresses — `$FAD8` on danish, `$FC51` on saeger.

`$E000-$FFFF` was deliberately **not** excluded. Those two addresses do differ, but two out of
8192 is far too few for power-on garbage and is unexplained; blanket-excluding 8 KB would hide
real divergence. They still fail, so the question stays visible. `vice_watch_add` on each finds
the writer cheaply — recorded as the next step.

## What shipped

- `scripts/compare.mjs` — `compare` / `floor` / `digest`. Pure logic in `derive.mjs`'s shape:
  `node:fs`, `node:crypto`, `node:path`, no socket, no broker state, exits 1 on FAIL.
- `templates/capture-record.template.md` — identity, machine state read in the same paused
  window, void checklist, per-pairing comparison table.
- `SKILL.md` — `C=` in the command block, the prose rules replaced by the command plus real
  worked output plus a three-class table, a `References` section, four new troubleshooting rows.
- Two graded `RE-FINDINGS.md` entries, appended at discovery.

## Validated, not asserted

All six captures' sha256s match their committed `.capture.json` manifests exactly — independent
proof the reader is right. The worked-output block in `SKILL.md` was diffed against a live run:
identical. Frontmatter checker `ok` on all six skills. All cited paths resolve.

**Three bugs in my own script, caught by verification rather than review:** `--limit 0`
documented as "print every row" was slicing to zero; the `floor` limit had the same shape; and
the worst-pairing line read "1 divergences". Also caught: two sample rows in the SKILL.md
worked output were carried over from a pre-fix run and were not real output — replaced.

## Deviation from the plan

The plan called for a three-file `references/` split. Dropped, because `260804-ae9-b` had just
done this same alignment on `acme-build` and deliberately created no `references/`, citing
`skill-writer`'s "put the whole workflow in SKILL.md when it fits". At 221 lines
`c64-ram-capture` is the same size as `acme-build`; splitting one and not its same-sized sibling
would have made the family less uniform, which is the opposite of the request. Full
reconciliation at the top of `260804-bux-PLAN.md`.

## Concurrency

`260804-brt` held uncommitted edits to this same `SKILL.md` when the task started. Per the
user's instruction the file was left untouched until `brt` committed (`9f1621d`); its
`d64-parse` and `dump-artifacts` wiring is preserved intact (verified by grep and by the
79-insert/15-delete diff shape).

## Not done

- Explaining `$FAD8` / `$FC51`. Next step named above; needs the emulator.
- `c64-memory-mapping` is now the only skill not aligned to this shape (199 lines, no
  `References` section). Separate task.
- A `templates/` row for `skill-writer`'s layout table, which still says data and templates live
  at the skill root while two skills now use `templates/`.

---

*Phase: quick-260804-bux*
*Completed: 2026-08-04*
