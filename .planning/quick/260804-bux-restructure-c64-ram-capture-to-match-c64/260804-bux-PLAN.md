---
quick_id: 260804-bux
description: Restructure c64-ram-capture to match c64-program-recon's shape
date: 2026-08-04
status: executed
blocked_on: none — 260804-brt landed (9f1621d) mid-task and unblocked Part B
---

> **RECONCILIATION, written after execution.** Part B was unblocked when
> `260804-brt` committed (`9f1621d`) while Part A was being validated, and was
> then executed — but **not as B1 below describes**. Two things changed the
> plan, both discovered after it was written:
>
> 1. **`260804-brt` had already done most of the structural alignment.** Its
>    commit added an order table, a worked example, a "Which skill does what"
>    table and a Troubleshooting table. The only recon-shape element still
>    missing was a `References` section.
> 2. **`260804-ae9-b` set a precedent for this exact job on `acme-build`**
>    (`3e9c37a`) and deliberately invented no `references/` or `templates/`
>    directory, reasoning that the workflow fits in one file — which
>    `skill-writer` explicitly endorses — and that a References section should
>    name what the skill actually ships rather than files created to fill a
>    table. At 221 lines `c64-ram-capture` is the same size as `acme-build`, so
>    **B1's three-file `references/` split was dropped** for consistency with
>    that precedent. Splitting one skill and not its same-sized sibling would
>    have made the family less uniform, which is the opposite of the ask.
>
> B2 (trim to an index) therefore became "add the missing References section
> and wire the new script in". B3 and B4 were done as written. Net SKILL.md
> change: 79 insertions, 15 deletions, with `260804-brt`'s wiring preserved.

# Restructure `c64-ram-capture` to `c64-program-recon`'s shape

## Why this plan is split in two

A concurrent session holds **uncommitted** edits to
`.claude/skills/c64-ram-capture/SKILL.md` under quick task `260804-brt`
("Wire dump-artifacts and d64-parse into the c64-ram-capture skill") — 96
insertions, 6 deletions, PLAN.md written, no SUMMARY yet. Restructuring
`SKILL.md` now would collide with in-flight work and one side would lose.

So the work is split by conflict risk, on the user's instruction to plan only:

| Part | Touches | Status |
|---|---|---|
| A — net-new siblings | files that do not exist yet | **DONE this task** |
| B — the `SKILL.md` trim + `references/` split | `SKILL.md` | **BLOCKED on `260804-brt`** |

Part A duplicates nothing and conflicts with nothing. Part B moves prose *out
of* `SKILL.md`, so its reference files must land in the same commit as the
trim — creating them early would leave the skill saying everything twice.

## The target shape

`c64-program-recon` is the model:

```
SKILL.md                       index only
references/*.md                detail, loaded on demand
scripts/derive.mjs             pure arithmetic, contacts nothing
templates/*.template.md        artifact shape
```

Gap as measured on 2026-08-04:

| Element | c64-program-recon | c64-ram-capture (committed) |
|---|---|---|
| `SKILL.md` as a real index | yes | no — 135 lines, all detail inline |
| `scripts/` pure-logic module | `derive.mjs` | none |
| `references/` | 5 files | none |
| `templates/` | `memory-map.template.md` | none |
| Command block at the top with a `D=`/`C=` var | yes | none |
| Worked output shown | yes | partial |
| "Which skill does what" table | yes | none |
| References table | yes | none |
| Troubleshooting `Symptom \| Fix` table | yes | **none** |

The number of reference files should follow the content. `c64-program-recon`
has five because it covers eight steps across four chips; `c64-ram-capture` is
narrower and three is the natural split. Matching five-for-five would be
cargo-culting the shape instead of adopting it.

---

## Part A — DONE

### A1. `scripts/compare.mjs` (new, 0 → ~200 lines)

The load-bearing addition. `SKILL.md`'s "Compare two captures" and "Establish a
drift floor" sections state real classification rules **in prose only**, so
every session re-implements them by hand and can get them subtly wrong. This is
pure logic over two files the agent already captured — legal under the hard
rules, and the exact analogue of `derive.mjs`.

Three subcommands: `compare` (two images, three classified lists, pass/fail
verdict, exit 1 on FAIL), `floor` (N images, every address that differed in any
pairing, stated as a floor), `digest` (sha256 + size for the capture record).

Imports `node:fs`, `node:crypto`, `node:path`. No socket, no fetch, no broker
state. Header comment defers to `mcp__vice__*` as the only emulator route.

**Validated against real data, not asserted:**

- All six committed gameentry captures are 65536 bytes and their sha256s match
  their committed `.capture.json` manifests exactly — independent proof the
  reader and digest are right.
- `compare` and `floor` run over all six pairings and produce the table logged
  in `RE-FINDINGS.md`.
- One bug found and fixed during validation: `--limit 0` documented as
  "print every row" was slicing to zero rows and reporting "… N more".

`tools/diff-images.mjs` was checked and is **not** a substitute: it does
anchor-search / patch-count / ledger work, and its `VOLATILE_END` biases anchor
*selection* while explicitly never excluding volatile bytes from its diff.
Different concern, different rules.

### A2. `templates/capture-record.template.md` (new)

Mirrors `memory-map.template.md`. Fixes the shape of a capture record: identity
(path, size, sha256, trigger address, run N of total), machine state read in the
same paused window (`$01`, video standard, registers, epoch at start **and**
end, checkpoints-armed-at-exit), a four-box verdict checklist, the voiding
procedure, and a per-pairing comparison table.

### A3. `RE-FINDINGS.md` — the hazard found while building A1

Building `compare.mjs` surfaced a correctness defect in the skill, not just a
structural one. Logged at discovery per `CLAUDE.md`. Summary: the documented
volatile-span list omits `$D000-$DFFF`, so the documented rule **fails 5 of the
6 pairings** of this project's own three-run-verified captures. Every divergence
across all pairings sits at one of five addresses — `$D344` (VIC-II register
image), `$D625`/`$D628` (SID images), `$FAD8`/`$FC51` (RAM under KERNAL ROM).
Reading register images samples live hardware and can never be stable.

Graded HIGH for the `$D000-$DFFF` half, MEDIUM for `$E000-$FFFF` — only two
addresses out of 8192 differ there, too few for power-on garbage and not yet
explained.

---

## Part B — BLOCKED on `260804-brt`

Apply only once `260804-brt` has committed. Re-read `SKILL.md` first: it will
have gained the `d64-parse` and `dump-artifacts` wiring, and this plan must
preserve that, not revert it.

### B1. Split detail into `references/` (3 files)

| File | Absorbs from `SKILL.md` |
|---|---|
| `references/booting-and-disks.md` | "Boot a disk" in full — `d64-parse` directory/BAM/`--json` fakery detection, the attach/autostart/run sequence, and the `LOAD"*",8,1` fallback. Includes whatever `260804-brt` adds. |
| `references/capture-procedure.md` | The 9-step capture at a trigger address, the `dump-artifacts` wiring, "Find an entry point" with its batch ceiling, and holding keys across a gate. |
| `references/verification-and-voiding.md` | The epoch bracket, voiding a run, artifact naming, the comparison rules in full, and the drift-floor procedure. |

### B2. Trim `SKILL.md` to an index

Keep, in `c64-program-recon`'s order: frontmatter unchanged (it passes the
checker and its trigger surface is good — do **not** touch it); the
`mcp__vice__*`-only opening; a command block assigning `C=` and showing the
three `compare.mjs` invocations; a short ordered overview of the capture
sequence with the load-bearing constraints inline ("read state before you
resume, and resume exactly once at the end"; "accept only
`vice_checkpoint_list`'s enumeration as proof"); one worked `compare` output;
a "Which skill does what" table; a References table; and a closing
Troubleshooting table.

### B3. Correct the volatile-span rule

The A3 finding has to reach the skill, not only the findings log. `SKILL.md`
and `compare.mjs` must both classify `$D000-$DFFF` as volatile, with the reason
stated: it is register images, not RAM. Decide explicitly how to treat
`$E000-$FFFF` — the evidence does not yet support blanket-volatile, so the
default is to leave it failing and let the record carry the explanation.

**This changes `compare.mjs`'s verdicts**, so re-run all six pairings after and
record the new table. Do not quietly widen the volatile list without saying the
verdicts moved.

### B4. Fix the abridged `--json` block

`260804-brt`'s pending edit shows a `--json` example that drops five fields
(`dir_track`, `dir_sector`, `entry_index`, `closed`, `locked`) and reformats.
Real output was verified 2026-08-04. Either show it verbatim or mark the
elision with `…` the way `c64-program-recon`'s worked example does.

## Verification for Part B

- Every command in the restructured `SKILL.md` re-run, output byte-for-byte.
- Frontmatter checker `ok` for all six skills.
- Every cited path resolves — including the three new `references/` files.
- No content silently lost in the trim: diff the pre-trim `SKILL.md` against the
  concatenation of the new `SKILL.md` plus the three reference files and account
  for every removed line.
- `compare.mjs` still passes the six-capture validation after B3.

## Out of scope

- Restructuring `acme-build` or `c64-memory-mapping` to this shape. Same
  argument applies to both, but they are separate tasks — and `acme-build` also
  has uncommitted concurrent edits right now.
- Explaining `$FAD8`/`$FC51`. Worth a look at what writes them; not this task.
- Adding a `templates/` row to `skill-writer`'s layout table, which currently
  says data and templates live at the skill root while both
  `c64-program-recon` and now `c64-ram-capture` use `templates/`.
