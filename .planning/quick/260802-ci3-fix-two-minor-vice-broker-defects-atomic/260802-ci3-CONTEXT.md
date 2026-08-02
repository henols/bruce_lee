# Quick Task 260802-ci3: fix two minor vice-broker defects: atomic-write temp file leak and sub-second boot-time log rounding — Context

**Gathered:** 2026-08-02
**Status:** Ready for planning

<domain>
## Task Boundary

Fix the two `minor` VICE-broker defects filed on 2026-08-02:

1. **Atomic-write temp-file leak** — `write_json_atomic()` uses `mktemp "$VICE_POOL_DIR/.broker.XXXXXX"`, so a death between `mktemp` and `mv` strands a `.broker.*` file that nothing ever sweeps.
2. **Boot-time log rounds sub-second to zero** — `maintain_spares()` computes `elapsed_s=$((elapsed_ns / 1000000000))`, so every sub-second boot renders as `(0s)`.

**Explicitly out of scope:** the third 2026-08-02 todo (`vice-broker-has-no-detached-run-mode`, severity `major`). It changes deployment shape, not a quick task. The reap-on-signal contract from `260801-qpq` is untouched by this task.

</domain>

<decisions>
## Implementation Decisions

### Canonical file to edit — SETTLED BY EVIDENCE, NOT DISCUSSION

Both todos' frontmatter names `tools/vice-broker.sh`. **That path is wrong.**

- `git check-ignore -v tools/vice-broker.sh` → `.gitignore:101` — it is the *generated, gitignored deployed copy*.
- `git log -- tools/vice-broker.sh` → empty. `git log -- .claude/mcp/vice/resources/vice-broker.sh` → real history (`345411b`, `d57f53b`, `11d63e5`).
- The two files are currently byte-identical (1656 lines each), which is why the stale path has gone unnoticed.

**All edits go to `.claude/mcp/vice/resources/vice-broker.sh`.** Editing `tools/vice-broker.sh` is silently overwritten on redeploy, per CLAUDE.md § Emulator Access. Do not edit the `tools/` copy, and do not add it to any commit.

### Temp-file leak fix shape

- Replace `mktemp "$VICE_POOL_DIR/.broker.XXXXXX"` with a **deterministic per-target temp name**: `tmp="$final_path.tmp"`.
- Bounded *by construction* — a retry overwrites the same path rather than accumulating a new one. This is the todo's own preferred fix.
- **Do NOT add a `.broker.*` sweep to `purge_protocol_state()`.** Sweep-only and sweep-as-well were both offered and both declined. The construction fix is the whole fix.
- **Keep the `chmod 600`.** It is the uid-parity precondition's owner-only posture (D-1.2-D), not incidental. `mktemp`'s implicit 0600 is going away with `mktemp`, so the explicit `chmod` stops being a second guarantee and becomes the only one — it must survive, and it must run before the content is exposed at the final path.
- **Glob-safety requirement:** `write_json_atomic` is called with final paths inside `spares/` (`$SPARES_DIR/$port.json`, and `$f` from `maintain_spares`). The resulting `spares/6540.json.tmp` must not match any existing `*.json` glob — verify against `maintain_spares()` and `drop_dead_instance_records()`, both of which iterate `"$SPARES_DIR"/*.json`. `.json.tmp` does not match `*.json`, so this holds; confirm rather than assume.
- The one already-stranded `.vice-supervisor/.broker.bXkF8L` from 2026-08-01 is **not** this task's problem to clean up. It is inert.

### Boot-time log format

- Print **milliseconds**, computed from the same nanosecond fields already written: `elapsed_ms=$(( elapsed_ns / 1000000 ))`.
- **Integer arithmetic only.** No `bc`, no `awk`, no float dependency — this script runs on the HOST, which may be GNU or BSD.
- Carry the **poll-quantisation caveat on the log line itself**, naming the actual interval so the figure is never mistaken for an exact boot time. `VICE_BROKER_POLL_MS` already exists (defaults to `500`, line 447) — use it, do not hardcode.
- Target shape: `vice-broker: port 6540 launching -> ready (670ms, upper bound: polled every 500ms)`
- Preserve the existing `elapsed_s="?"` fallback behaviour for a missing/unreadable `launched_at` — rename to match the new unit, but a missing timestamp must still render as `?`, not as `0ms`.
- Preserve the existing negative-clamp (`[ "$elapsed_ns" -lt 0 ] && elapsed_ns=0`).

### Todo disposition

- Move **both** todos to `.planning/todos/completed/`.
- **Correct the stale `files:` frontmatter on the way** — `tools/vice-broker.sh` → `.claude/mcp/vice/resources/vice-broker.sh` — so the archived record does not preserve a wrong path. Correct the path only; do not rewrite the todos' prose.
- Leave `2026-08-02-vice-broker-has-no-detached-run-mode.md` pending and untouched. Its `files:` field is also stale, but it is out of this task's scope.

### Verification depth

- Run the existing suite: `node --test .claude/mcp/vice/vice-broker.test.mjs`.
- Static checks on the changed script: `bash -n`, and `shellcheck` if available (do not install it if absent — report and move on).
- **Add regression tests** for both defects, in the existing file, following its established idiom: `node:test` + real spawned `resources/vice-broker.sh` run `--once --dry-run` against a `mkdtemp` pool dir, with an in-process stand-in server. No host emulator, no real `x64sc`, no `mcp__vice__*` calls anywhere in this task.
  - Test 1: after a `write_json_atomic`-driven pass, the pool dir contains no stranded `.broker.*` and no leftover `*.tmp`, and the final JSON is intact.
  - Test 2: a launching→ready transition renders a **non-zero** millisecond figure, and the line carries the poll-interval caveat. Assert on the shape (`\(\d+ms, upper bound: polled every \d+ms\)`), not on a specific duration — the number is host-timing-dependent and must not be pinned.

### Claude's Discretion

- Exact wording of the log line, so long as it carries a millisecond figure and names the real poll interval.
- Exact placement and naming of the new test cases within `vice-broker.test.mjs`.
- Whether the two code fixes land as one commit or two. Both touch the same file; two atomic commits is the GSD default and is preferred, but one is acceptable if the tests are shared.
- Whether the `elapsed_ms` variable keeps the old name or is renamed.

</decisions>

<specifics>
## Specific Ideas

Defect sites in `.claude/mcp/vice/resources/vice-broker.sh` (line numbers as of `b4ff8f5`):

- `write_json_atomic()` — lines 506–512, with its explanatory header comment at 495–505. **That header comment explicitly justifies `mktemp`'s implicit 0600 mode** ("`mktemp` already creates its file mode 0600 regardless of umask (GNU coreutils); the explicit chmod below is a second… guarantee"). Removing `mktemp` invalidates that sentence — the comment must be updated in the same edit, not left describing code that no longer exists. A stale comment misdirecting a live debugging session is the exact harm class the temp-file todo cites (Defect 2 of the spare-warming todo).
- `maintain_spares()` boot-time block — lines 1199–1211.
- `purge_protocol_state()` — lines 1398–1407. **Read for glob-safety confirmation only; not modified by this task.**
- `VICE_BROKER_POLL_MS` default — line 447.

Call sites of `write_json_atomic` to check for glob interaction: lines 784, 859, 965, 1044, 1070, 1210.

</specifics>

<canonical_refs>
## Canonical References

- `.planning/todos/pending/2026-08-02-broker-atomic-write-temp-files-leak-into-the-pool-dir.md` — defect 1, with the live 2026-08-02 observation.
- `.planning/todos/pending/2026-08-02-broker-boot-time-log-rounds-sub-second-to-zero.md` — defect 2, and the account of how the `(0s)` rendering let an ~8×-wrong boot assumption reach a design note, a todo and a spike.
- `.planning/notes/vice-broker-lifecycle-decisions.md` — the 2026-08-02 correction section both todos cross-reference.
- `.planning/RE-FINDINGS.md` — the 2026-08-02 host validation run during which both defects were observed. **Append-only.** These are tooling-hygiene fixes rather than reverse-engineering findings, so a new entry is not required; if one is added it must follow the § Reverse-Engineering Findings Log rules (dated, `Evidence:` and `Confidence:` fields, appended never edited).
- `.claude/CLAUDE.md` § Emulator Access — the rule that makes `.claude/mcp/vice/resources/` the editable location and `tools/` the generated one. This task *is* maintaining the `mcp__vice__` implementation, which is the mode in which `.claude/mcp/` is in-bounds.
- `.claude/mcp/vice/vice-broker.test.mjs` — existing harness; its header documents the spawned-real-script `--once --dry-run` idiom the new tests must follow.

</canonical_refs>
