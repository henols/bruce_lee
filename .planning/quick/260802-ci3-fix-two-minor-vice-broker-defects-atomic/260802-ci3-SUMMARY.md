---
phase: quick-260802-ci3
plan: 01
subsystem: infra
tags: [bash, vice-broker, atomic-write, logging]

# Dependency graph
requires: []
provides:
  - "write_json_atomic() writes a deterministic '$final_path.tmp' sibling instead of a mktemp-random name, bounding stray-file accumulation by construction"
  - "maintain_spares() boot-time promotion log renders milliseconds (with a poll-interval caveat naming VICE_BROKER_POLL_MS) instead of whole-second-rounded-to-zero"
  - "Both fixed defect todos archived under .planning/todos/completed/ with corrected files: frontmatter"
affects: [vice-broker maintenance, future host-validation runs that read the boot-time log]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Deterministic temp-file naming ('$final_path.tmp') as the bounded-by-construction alternative to mktemp for a single atomic-write choke point"
    - "Regression tests that spawn the real shell script (--once --dry-run) against a real mkdtemp pool dir and assert on-disk state, matching the existing harness idiom"

key-files:
  created: []
  modified:
    - .claude/mcp/vice/resources/vice-broker.sh
    - .claude/mcp/vice/vice-broker.test.mjs
    - .planning/todos/completed/2026-08-02-broker-atomic-write-temp-files-leak-into-the-pool-dir.md
    - .planning/todos/completed/2026-08-02-broker-boot-time-log-rounds-sub-second-to-zero.md

key-decisions:
  - "Deterministic '$final_path.tmp' with NO sweep added to purge_protocol_state() — construction fix is the whole fix (locked CONTEXT decision)"
  - "Milliseconds via integer arithmetic only (elapsed_ns / 1000000), no bc/awk — script runs on the host, which may be GNU or BSD"
  - "Both archived todos' files: frontmatter corrected from tools/vice-broker.sh (generated, gitignored, no git history) to .claude/mcp/vice/resources/vice-broker.sh (tracked canonical script)"

patterns-established:
  - "write_json_atomic(): create tmp file empty -> chmod 600 -> write content -> mv. Ordering is load-bearing since the temp file no longer inherits mktemp's implicit 0600 default."

requirements-completed:
  - TODO-ATOMIC-TMP
  - TODO-BOOTLOG-MS

coverage:
  - id: D1
    description: "write_json_atomic() uses a deterministic '$final_path.tmp' sibling instead of mktemp; a --once --dry-run pass leaves no .broker.* or *.tmp file anywhere under the pool dir, and every written protocol file is intact JSON at mode 600"
    requirement: "TODO-ATOMIC-TMP"
    verification:
      - kind: integration
        ref: ".claude/mcp/vice/vice-broker.test.mjs#write_json_atomic: a --once --dry-run pass promoting a launching spare leaves no .broker.* file and no *.tmp file anywhere under the pool dir, and every protocol file it wrote is intact JSON at mode 600"
        status: pass
    human_judgment: false
  - id: D2
    description: "maintain_spares() boot-time promotion log renders a millisecond figure plus a poll-interval caveat naming VICE_BROKER_POLL_MS, never a zero-rounded whole-second figure; a missing launched_at still renders '?'"
    requirement: "TODO-BOOTLOG-MS"
    verification:
      - kind: integration
        ref: ".claude/mcp/vice/vice-broker.test.mjs#maintain_spares boot-time log: a promotion whose spare record carries a launch timestamp 250ms in the past logs a millisecond figure >= 250 plus a poll-interval caveat that reads VICE_BROKER_POLL_MS, not a hardcoded default"
        status: pass
      - kind: integration
        ref: ".claude/mcp/vice/vice-broker.test.mjs#maintain_spares boot-time log: a spare record with no launched_at key at all renders '?' in the elapsed position and never a zero millisecond figure"
        status: pass
    human_judgment: false
  - id: D3
    description: "Both defect todos archived under completed/ with files: frontmatter pointing at the tracked canonical script; the out-of-scope detached-run-mode todo left pending and byte-unchanged"
    verification:
      - kind: other
        ref: "test -f .planning/todos/completed/2026-08-02-broker-atomic-write-temp-files-leak-into-the-pool-dir.md && test -f .planning/todos/completed/2026-08-02-broker-boot-time-log-rounds-sub-second-to-zero.md && test -f .planning/todos/pending/2026-08-02-vice-broker-has-no-detached-run-mode.md"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-08-02
status: complete
---

# Quick Task 260802-ci3: Fix Two Minor VICE-Broker Defects Summary

**Deterministic `$final_path.tmp` replaces mktemp's random temp name in `write_json_atomic()`, and `maintain_spares()`'s boot-time log now renders milliseconds with a poll-interval caveat instead of whole seconds that rounded every sub-second boot down to zero.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-08-02T09:11:22Z (plan dispatch commit)
- **Completed:** 2026-08-02T09:18:35Z
- **Tasks:** 3 (Task 3 required one follow-up commit to land a staging mistake)
- **Files modified:** 4 (2 code/test, 2 todo archival)

## Accomplishments

- `write_json_atomic()` no longer strands randomly-named `.broker.XXXXXX` temp files in the pool dir on a mid-write crash — the temp path is now a deterministic sibling of the final path, bounded by construction (a retry overwrites the same file rather than accumulating a new one).
- The header comment above `write_json_atomic()` no longer credits `mktemp`'s implicit 0600 default (which no longer exists in the code path) — it now correctly states that the explicit `chmod 600`, run before any content is written, is the *only* guarantee of the owner-only posture (D-1.2-D).
- `maintain_spares()`'s launching→ready promotion log now prints a millisecond figure with a caveat naming the real `VICE_BROKER_POLL_MS` interval, instead of `elapsed_s=$((elapsed_ns / 1000000000))` rounding every sub-second boot to `(0s)`. The `?` fallback for a missing `launched_at` and the negative-elapsed clamp are both preserved unchanged.
- Three new regression tests added to the existing `node:test` harness, all spawning the real `vice-broker.sh --once --dry-run` against a real `mkdtemp` pool dir (no emulator, no `mcp__vice__*` calls anywhere).
- Both fixed defect todos moved to `.planning/todos/completed/` with their stale `files: tools/vice-broker.sh` frontmatter corrected to the tracked canonical `.claude/mcp/vice/resources/vice-broker.sh`. The out-of-scope detached-run-mode todo was left pending and byte-unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace the random temp name in write_json_atomic, correct the header comment** - `cbb45f0` (fix)
2. **Task 2: Log boot time in milliseconds with the poll-quantisation caveat** - `91ce8d6` (fix)
3. **Task 3: Run the full verification sweep and archive both todos** - `301f58c` (chore, rename) + `67e5055` (fix, follow-up correcting a staging mistake — see Issues Encountered)

_No plan-metadata commit is made by this executor per the orchestrator's constraints — SUMMARY.md/STATE.md/PLAN.md/CONTEXT.md commits are the orchestrator's responsibility._

## Files Created/Modified

- `.claude/mcp/vice/resources/vice-broker.sh` - `write_json_atomic()` rewritten (deterministic tmp path, reordered create-empty→chmod→write, corrected header comment); `maintain_spares()` boot-time block rewritten (milliseconds + poll-interval caveat)
- `.claude/mcp/vice/vice-broker.test.mjs` - three new regression tests; `runBrokerOnce()` extended with an optional `pollMs` knob
- `.planning/todos/completed/2026-08-02-broker-atomic-write-temp-files-leak-into-the-pool-dir.md` - archived, `files:` corrected
- `.planning/todos/completed/2026-08-02-broker-boot-time-log-rounds-sub-second-to-zero.md` - archived, `files:` corrected

## Decisions Made

- Followed the plan's locked CONTEXT decisions exactly: deterministic `.tmp` sibling with no sweep added to `purge_protocol_state()`; integer-only millisecond arithmetic; both todos archived with the corrected path; regression tests added to the existing test file rather than a new one.
- Glob-safety was confirmed (not assumed) before committing to the `.tmp` suffix: `grep -n '/\*\.json' .claude/mcp/vice/resources/vice-broker.sh` shows every glob in the script is `*.json`-scoped across `spares/`, `grants/`, `requests/`, and the `$d/*.json` loops — a `.json.tmp` suffix matches none of them.
- The precondition check for Task 1 (baseline test run before any change) was executed and recorded 40/40 passing, giving a clean attribution baseline for the two new failures/passes that followed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Task 3's todo-archival commit initially missed the `files:` path correction**
- **Found during:** Task 3, immediately after committing `301f58c`
- **Issue:** A single `git add` command listed both the two now-relocated `completed/` paths and the two now-nonexistent `pending/` paths (left over from an earlier draft of the command). Git aborted the whole `add` invocation with a `fatal: pathspec ... did not match any files` error before staging anything, so the commit that followed captured only the `git mv`-staged rename — the in-place `files:` frontmatter edits (made via `Edit` after the `git mv`) were never staged and were silently absent from `301f58c`.
- **Fix:** Verified via `git show HEAD:<path>` that the committed content still read `tools/vice-broker.sh`, re-staged just the two `completed/` files (whose working-tree content already had the correction), and created a new commit `67e5055` landing exactly the two-line `files:` fix with no other change. Per the git safety protocol, this was a new commit, not an amend.
- **Files modified:** `.planning/todos/completed/2026-08-02-broker-atomic-write-temp-files-leak-into-the-pool-dir.md`, `.planning/todos/completed/2026-08-02-broker-boot-time-log-rounds-sub-second-to-zero.md`
- **Verification:** `git show HEAD:<path> | head -8` on both files confirms `files:` now reads `.claude/mcp/vice/resources/vice-broker.sh`; working tree is clean (`git status --short` empty).
- **Committed in:** `67e5055`

---

**Total deviations:** 1 auto-fixed (1 bug — self-caused staging error, not a defect in the plan)
**Impact on plan:** No scope creep; the final on-disk and committed state matches the plan's intended outcome exactly, just via one extra corrective commit.

## Issues Encountered

- The combined `git add` invocation for Task 3 (listing both old `pending/` and new `completed/` paths in one call) is a pattern worth avoiding: `git mv` already stages the rename, so a follow-up content edit only needs `git add` on the new (`completed/`) path — including the now-nonexistent `pending/` path in the same invocation causes git to abort the entire staging operation with no partial effect, which silently drops any other staged content in that same call. Caught immediately via post-commit inspection (`git show HEAD:<path>`) rather than propagating further.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Both minor VICE-broker defects are fixed, tested, and the fixed sites' regression coverage is committed. The existing 40-test suite plus 3 new tests all pass (43/43), `bash -n` exits 0, and `shellcheck` was reported absent (not installed, per the plan's explicit instruction not to install it).
- The one already-stranded `.vice-supervisor/.broker.bXkF8L` orphan from 2026-08-01 remains untouched — it was explicitly out of this task's scope per CONTEXT.md ("not this task's problem to clean up. It is inert.").
- The third 2026-08-02 todo (`vice-broker-has-no-detached-run-mode`, severity `major`) remains pending, untouched, and out of scope for this task — it changes deployment shape and is not a quick task.
- No blockers for future work. Future sessions reading the broker's boot-time log will now see a real millisecond figure instead of a misleading `(0s)`, which is the concrete fix for the root cause that let an ~8x-wrong ~8s boot assumption go unchallenged in `260802-bq6`.

## Self-Check: PASSED

- `FOUND: .claude/mcp/vice/resources/vice-broker.sh` (modified, verified via bash -n exit 0)
- `FOUND: .claude/mcp/vice/vice-broker.test.mjs` (modified, verified via node --test 43/43 pass)
- `FOUND: .planning/todos/completed/2026-08-02-broker-atomic-write-temp-files-leak-into-the-pool-dir.md`
- `FOUND: .planning/todos/completed/2026-08-02-broker-boot-time-log-rounds-sub-second-to-zero.md`
- `FOUND: .planning/todos/pending/2026-08-02-vice-broker-has-no-detached-run-mode.md` (confirmed untouched)
- Commit `cbb45f0` found in `git log --oneline --all`
- Commit `91ce8d6` found in `git log --oneline --all`
- Commit `301f58c` found in `git log --oneline --all`
- Commit `67e5055` found in `git log --oneline --all`
- `tools/vice-broker.sh` confirmed still untracked: `git ls-files --error-unmatch tools/vice-broker.sh` fails as expected

---
*Phase: quick-260802-ci3*
*Completed: 2026-08-02*
