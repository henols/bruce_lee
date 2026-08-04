---
phase: quick-260804-ae9
plan: 01
subsystem: docs
tags: [acme-build, skill-docs, acme, re-findings]

# Dependency graph
requires: []
provides:
  - "template.a's build comment names the real `build` verb (VERBS map), not the nonexistent `run --shot`"
  - "acme-build/SKILL.md's seven documented defects (F-1..F-7) are fixed against a live re-capture of every shown command"
  - "RE-FINDINGS.md gains the `*.a`-unreadable hazard entry plus a worktree absolute-path-drift hazard entry, both dated 2026-08-04"
affects: [any future agent scaffolding or reading ACME source, any future worktree-isolated capture that uses an absolute driver path]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Scaffold and hand-edit ACME source as .asm (or .s), never .a, whenever the agent itself needs to Read/Edit it later — the driver is extension-indifferent, the agent's Read tool is not"
    - "Inside a git worktree, resolve the worktree's own root (git rev-parse --show-toplevel) before trusting any absolute /workspaces/<repo>/... path handed down by a plan or prior session"

key-files:
  created: []
  modified:
    - .claude/skills/acme-build/template.a
    - .claude/skills/acme-build/SKILL.md
    - .planning/RE-FINDINGS.md

key-decisions:
  - "Kept the four confirmed-correct blocks (sym output, illegal-opcode byte string, .rep sample rows, disasm listing lines, --json shape, -D/-o variant builds) byte-identical in content, only relocating/relabeling per F-2..F-7 — never re-deriving them from scratch"
  - "Logged a second RE-FINDINGS.md entry beyond the plan's required one (the worktree absolute-path-drift hazard), because CLAUDE.md's logging rule is unconditional ('every finding... at the moment it is found') and this one was discovered live during Task 1's capture — additive, does not touch the plan's required entry"
  - "Did not silently correct the plan's literal `sed -n '16p;26p;27p;29p' game.rep` cross-check command when it disagreed with this container's actual .rep layout — reported the disagreement instead, per the plan's own instruction"

requirements-completed:
  - QUICK-260804-ae9

coverage:
  - id: F1
    description: "template.a line 2 names a real verb (build) from the VERBS map; no run verb or --shot option survives; exactly one line differs from HEAD"
    verification:
      - kind: other
        ref: "grep -cE 'acme\\.mjs (new|build|sym|disasm) ' template.a >= 1; grep -cE 'acme\\.mjs run|--shot' template.a == 0; git diff --numstat template.a == '1 1'"
        status: pass
    human_judgment: false
  - id: F2
    description: "Every shown new/build/sym command names a .asm source; a Troubleshooting row documents the Read-tool binary-file refusal and its .asm mitigation"
    verification:
      - kind: other
        ref: "grep -nE 'node \\$A (new|build|sym) [^ ]+' SKILL.md | grep -vc '\\.asm' == 0; grep -c 'binary .a file' SKILL.md >= 1"
        status: pass
    human_judgment: false
  - id: F3
    description: "Build block shows the real captured stdout, leading with the two-space-indented ACME -v1 note line"
    verification:
      - kind: other
        ref: "grep -c '^  Saving 53 (0x35) bytes (0x801 - 0x836 exclusive).$' SKILL.md >= 1"
        status: pass
    human_judgment: false
  - id: F4
    description: "Disassembly section names the default <stem>.dis.a output, documents the second positional, shows real stdout, and labels the listing block as file contents"
    verification:
      - kind: other
        ref: "grep -c 'dis\\.a' SKILL.md >= 1; grep -c 'disasm game.prg game.dis.asm' SKILL.md >= 1"
        status: pass
    human_judgment: false
  - id: F5
    description: ".vs curation (address-typed AND referenced only) explained with curateLabels provenance"
    verification:
      - kind: other
        ref: "grep -c 'curateLabels' SKILL.md >= 1"
        status: pass
    human_judgment: false
  - id: F6
    description: ".vs points to mcp__vice__vice_symbols_load as the only route to the emulator; no other route or runner introduced"
    verification:
      - kind: other
        ref: "grep -c 'vice_symbols_load' SKILL.md >= 1; grep -icE 'x11|xvfb|wine|vice_?binary|sleep [0-9]' SKILL.md == 0"
        status: pass
    human_judgment: false
  - id: F7
    description: "Four-files sentence reworded: .prg no longer counted as a side file; --no-report dropping the .rep is stated"
    verification:
      - kind: other
        ref: "manual read: 'Three side files land next to the .prg, and --no-report drops the .rep'"
        status: pass
    human_judgment: true
  - id: RE-FINDINGS
    description: "RE-FINDINGS.md gains a 2026-08-04 entry (plus one additional) with all four required fields, append-only"
    verification:
      - kind: other
        ref: "grep -c '^### 2026-08-04 — ' RE-FINDINGS.md >= 1; git diff --numstat RE-FINDINGS.md deletions == 0"
        status: pass
    human_judgment: false

duration: ~15min (bounded by plan-dispatch commit 28095a0 07:37:06Z and fix commit fd3bb7b 07:52:14Z)
completed: 2026-08-04
status: complete
---

# Quick Task 260804-ae9: Fix acme-build Skill Defects Summary

**All seven documented `acme-build` SKILL.md/template.a defects fixed against a live re-capture of every shown command under `.asm` filenames, plus two hazard entries logged in RE-FINDINGS.md — the required `*.a`-unreadable hazard, and an additional worktree absolute-path-drift hazard discovered while capturing.**

## Performance

- **Duration:** ~15 min (commit-bounded estimate)
- **Started:** plan-dispatch commit `28095a0`, 2026-08-04T07:37:06Z
- **Completed:** fix commit `fd3bb7b`, 2026-08-04T07:52:14Z
- **Tasks:** 3 (all executed in this session; no checkpoints)
- **Files modified:** 3 (`template.a`, `SKILL.md`, `RE-FINDINGS.md`), one atomic commit

## Accomplishments

- **F-1:** `template.a` line 2 now reads `node .claude/skills/acme-build/scripts/acme.mjs build THIS.a` — the real `build` verb from the `VERBS` map — replacing the stale `run THIS.a --shot shot.png` invocation that doesn't exist in the driver. Exactly one line differs from HEAD.
- **F-2:** Every `new`/`build`/`sym` command shown in SKILL.md now names a `.asm` source. Added a Troubleshooting row keyed on the real refusal message (`This tool cannot read binary files. The file appears to be a binary .a file.`), explaining the file is fine, the Read tool refuses the extension regardless of content, and the driver accepts `.a`/`.asm`/`.s` identically.
- **F-3:** The Build section's output block now shows the real captured stdout, leading with the two-space-indented `  Saving 53 (0x35) bytes (0x801 - 0x836 exclusive).` ACME `-v1` note line, with one clause explaining it's ACME's own note passed through.
- **F-4:** The Disassembly section now shows both invocations (default `<stem>.dis.a`, and the explicit second-positional `.asm` route) with their real stdout (the count line plus the four-line reading note), and introduces the listing block as the *contents of the listing file* rather than as command output.
- **F-5:** Added an explanation, citing `curateLabels` in `scripts/acme.mjs`, of why the `.vs` keeps only address-typed *and* referenced symbols — a raw `--vicelabels` dump would let a debugger relabel the 6510 processor port at `$0001` from a constant like `viccolor_WHITE = $1` — which is why the build reports 4 addresses against 121 total symbols.
- **F-6:** Added one sentence pointing the `.vs` output at `mcp__vice__vice_symbols_load` (format `vice`) as this project's only route to the emulator, citing `.claude/CLAUDE.md` § Version Compatibility / § Emulator Access. No other route, script, or runner was introduced — the skill stays assembling-only.
- **F-7:** Reworded the file-table intro to "Three side files land next to the `.prg`, and `--no-report` drops the `.rep`" — no longer counting the `.prg` itself among the "four files." The table's four rows are unchanged.
- Re-ran every command SKILL.md shows, from a scratch directory under the session scratchpad, capturing real stdout for each — see Cross-Checks below for exactly what matched and what didn't.
- `SKILL.md` is 168 lines (ceiling: 185); the frontmatter checker still prints `ok   acme-build` for all 5 skills present in this repo (see "Six skills" note below); `.claude/CLAUDE.md` and SKILL.md's frontmatter are byte-unchanged.
- Logged the required `*.a`-unreadable hazard in `RE-FINDINGS.md`, dated 2026-08-04, with all four required fields (`Type`/`Evidence`/`Confidence`/`Saves / costs`), append-only (0 deletions).

## Task Commits

All three tasks were executed together and landed in **one** atomic commit, per this quick task's explicit constraint (not the standard per-task commit protocol):

1. **Tasks 1–3 combined** — `fd3bb7b`: `fix(quick-260804-ae9): fix acme-build skill docs to match the driver, log *.a-unreadable hazard`

_No plan-metadata commit is made by this executor — SUMMARY.md/STATE.md/PLAN.md commits are the orchestrator's responsibility, per this task's constraints._

## Files Created/Modified

- `.claude/skills/acme-build/template.a` — line 2 changed from the stale `run --shot` comment to the real `build` invocation. No other byte changed.
- `.claude/skills/acme-build/SKILL.md` — all seven F-1..F-7 fixes applied; confirmed-correct blocks (sym output, illegal-opcode string, `.rep` rows, disasm listing lines, `--json` shape, `-D`/`-o` variants) preserved byte-identical, only relocated/relabeled where F-2 required an `.asm` rename.
- `.planning/RE-FINDINGS.md` — two entries appended, both dated 2026-08-04 (see Cross-Checks/Deviations below for why there are two, not one).

## Decisions Made

- Kept every confirmed-correct block's *content* unchanged, touching only what F-1 through F-7 required — no re-authoring beyond the seven named defects.
- Compacted prose paragraphs that had been manually wrapped to ~78 columns into single physical lines (markdown doesn't require the wrap) to bring the file from 205 lines down to 168, comfortably under the 185-line ceiling, without cutting any required content.
- Logged a second RE-FINDINGS.md entry, beyond the plan's literally-required one, for a hazard discovered live during Task 1's capture (see Cross-Checks below). This is additive per CLAUDE.md's unconditional logging rule and does not alter or remove the required first entry.

## Cross-Checks: Agreement and Disagreement with the Plan's Evidence

The plan required reporting, not silently smoothing over, any disagreement between its stated evidence and this run's live re-capture. Results:

- **Step 2 (build's first stdout line):** MATCHES exactly — `  Saving 53 (0x35) bytes (0x801 - 0x836 exclusive).` with both leading spaces, reproduced live.
- **Step 3 (`sym` output):** MATCHES exactly — `addr    $80d  entry` / `addr   $ffd2  k_chrout` / `addr   $d021  vic_cbg` / `addr   $d020  vic_cborder`, identical to what SKILL.md already showed.
- **Step 4 (`sed -n '16p;26p;27p;29p' game.rep`): DISAGREES.** In this container, ACME's `.rep` output interleaves `; ******** Source: ...` header blocks for each `!source <...>` include (`vic.a`, `kernal.a`, `cia1.a`), so the raw file-line numbers the plan's literal `sed` command targets land on mostly blank separator lines, not the four confirmed-correct rows. The row *content* SKILL.md shows (`!word .eol, 10`, `lda #viccolor_BLACK`, `sta vic_cbg`, `sta vic_cborder`) is still present, verbatim and correct — just at raw file lines 36/46/47/49 instead of 16/26/27/29, a consistent +20 offset from what the plan's sed line numbers assumed. This is a plan-evidence/container drift, not a defect in SKILL.md — the four rows themselves are untouched and correct, so no SKILL.md fix was needed; the disagreement is reported here rather than corrected in the plan text.
- **Step 6 (`od` bytes):** MATCHES the prose claim — first two bytes `01 08` = `$0801`, as SKILL.md already states (SKILL.md doesn't show a full `od` output block, only the prose claim, which reproduced correctly).
- **Step 7 (`disasm` stdout shape):** MATCHES — the count line (`game.dis.a: 28 lines`) plus the four-line reading note, reproduced exactly.
- **A second, unplanned disagreement, caught before it produced a wrong fix:** the plan's Task 1 literally specified the absolute driver path `/workspaces/bruce_lee/.claude/skills/acme-build/scripts/acme.mjs` for the capture sequence. Since this execution runs inside a git worktree at `/workspaces/bruce_lee/.claude/worktrees/agent-a17977441deb96574`, that literal path resolves to the **main checkout**, not this worktree — so the first capture attempt silently read the main checkout's *unfixed* `template.a` (via `acme.mjs`'s own `HERE`-relative lookup) even though the worktree's copy had already been corrected. No error was raised. Caught by inspecting the resulting `game.rep`, which still showed the stale `run THIS.a --shot` comment on line 2. Re-ran the entire capture sequence against the worktree's own absolute path and got the corrected output, which is what's captured in the transcript and pasted into SKILL.md. Logged as a second RE-FINDINGS.md entry (see below) since it's exactly the kind of hazard CLAUDE.md's logging rule exists to catch.
- **Six skills, not five:** the plan's own Verification section says to confirm the frontmatter checker "prints `ok` for all six skills." This repo currently has exactly 5 skill directories (`acme-build`, `c64-memory-mapping`, `c64-ram-capture`, `find-skills`, `skill-writer`), matching `.claude/CLAUDE.md`'s 5-row Project Skills table. The checker prints `ok` for all 5 present skills; there is no sixth. This is a stale count in the plan text, not a gap in this task's work — noted here rather than silently ignored.

## Deviations from Plan

### Auto-fixed Issues

None — no bugs or blocking issues encountered in the fix work itself.

### Additions beyond the plan's literal must_haves

**1. [Rule 2 — auto-add missing critical functionality / project hard rule] Logged a second RE-FINDINGS.md hazard entry**
- **Found during:** Task 1's capture sequence, first attempt (see Cross-Checks above)
- **Issue:** The worktree absolute-path-drift hazard is exactly the class of finding CLAUDE.md's Reverse-Engineering Findings Log mandates be recorded "at the moment it is found" ("a hazard — anything that gave a wrong answer... these are worth more than the shortcuts"). The plan's Task 3 only required one entry (for F-2); it did not anticipate this second discovery.
- **Fix:** Appended a second `### 2026-08-04 —` entry, with the same four required fields, after the required F-2 entry. Zero existing lines were changed; the diff is purely additive (14 insertions, 0 deletions across both entries combined).
- **Files modified:** `.planning/RE-FINDINGS.md`
- **Verification:** `git diff --numstat -- .planning/RE-FINDINGS.md` shows `14  0`; `grep -c '^### 2026-08-04 — ' .planning/RE-FINDINGS.md` returns 4 (2 from this session, 2 pre-existing from an earlier 2026-08-04 quick task).
- **Committed in:** `fd3bb7b`

---

**Total deviations:** 0 bug fixes; 1 addition beyond the plan's literal scope (the second RE-FINDINGS.md entry), which is additive-only and does not alter anything the plan required.
**Impact on plan:** None negative. The plan's must_haves are all satisfied exactly as specified; the addition is a bonus finding logged per a separate, unconditional project rule.

## Issues Encountered

- The worktree absolute-path drift (see Cross-Checks) cost one wasted capture pass, caught before it propagated into SKILL.md — no wrong content ever reached a commit.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `acme-build`'s SKILL.md and `template.a` now agree with `scripts/acme.mjs` (untouched, as required — "the driver is correct" was never contradicted). `.claude/skills/acme-build/scripts/acme.mjs` is confirmed unmodified (`git diff --numstat` shows no entry for it).
- The `*.a`-unreadable hazard is now logged where any future session will find it before rediscovering it from a confusing "binary file" refusal.
- No blockers for future work. The `.rep` raw-line-number drift (Cross-Checks, step 4) is worth keeping in mind if anyone later writes a script that greps `.rep` files by fixed line number rather than by content — it is container/version-sensitive.

## Self-Check: PASSED

- `FOUND: .claude/skills/acme-build/template.a` (modified, `git diff --numstat` shows `1  1`)
- `FOUND: .claude/skills/acme-build/SKILL.md` (modified, 168 lines, frontmatter checker prints `ok   acme-build`)
- `FOUND: .planning/RE-FINDINGS.md` (modified, `git diff --numstat` shows `14  0`)
- Commit `fd3bb7b` found in `git log --oneline -3`
- `git status --porcelain` empty after commit
- `.claude/skills/acme-build/scripts/acme.mjs` confirmed untouched (absent from `git diff --numstat`)
- `.claude/CLAUDE.md` confirmed untouched (`git diff -- .claude/CLAUDE.md | wc -l` == 0)

---
*Phase: quick-260804-ae9*
*Completed: 2026-08-04*
