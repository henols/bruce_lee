---
phase: quick-260730-ryz
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
requirements: [QUICK-260730-ryz]
files_modified:
  - .claude/skills/vice-session/SKILL.md
  - .claude/skills/vice-session/INTERNALS.md
  - .claude/CLAUDE.md

must_haves:
  truths:
    - "`.claude/skills/vice-session/SKILL.md` names no internal module file, internal function, or internal state file/directory — the leak alternation in the task gates matches zero lines of it."
    - "SKILL.md still carries every command a caller needs: all eight `vice.mjs` subcommands (`ping`, `tools`, `call`, `session acquire`/`release`/`status`, `pool status`, `install`), the host-side pool commands, and the disk-reading route."
    - "The three behaviours a caller must act on survive as positive instructions: poll with `vice_ping` and re-issue `vice_execution_run` after each state read; prefix every snapshot name with the active instance's port; read disk contents from `.d64` bytes or `vice_disk_read_sector`."
    - "`.claude/skills/vice-session/INTERNALS.md` exists and names every internal identifier and invariant that SKILL.md used to name — the material is relocated, never deleted."
    - "SKILL.md never names or points at the maintainer doc, and the skill still loads: frontmatter `name:` is `vice-session` and the file is the only `.md` with skill frontmatter in that directory."
    - "The `description:` frontmatter keeps every trigger word (emulator, VICE, x64sc, C64 debugging, memory-inspection, checkpoint, snapshot, `vice_*`) and is byte-identical to the vice-session row of `.claude/CLAUDE.md`'s Project Skills table."
    - "Nothing under `.claude/skills/vice-session/scripts/` or `.claude/skills/vice-session/resources/` changed — this is a documentation-only change."
  artifacts:
    - .claude/skills/vice-session/SKILL.md
    - .claude/skills/vice-session/INTERNALS.md
    - .claude/CLAUDE.md
  key_links:
    - "SKILL.md frontmatter `description:` <-> `.claude/CLAUDE.md` Project Skills row — that section is regenerated from skill frontmatter, so the two strings must be identical or the next regeneration silently reverts the table."
    - "SKILL.md command block <-> `vice.mjs`'s own usage output — every subcommand documented must exist in the unchanged script."
    - "INTERNALS.md <-> the internals removed from SKILL.md — one-to-one; every identifier the gate stops finding in SKILL.md must be findable in INTERNALS.md."
---

<objective>
Turn `.claude/skills/vice-session/SKILL.md` into a pure usage guide: what the skill can do and the commands to do it, phrased as instructions rather than as warnings, rationale, or architecture. Every internal mechanic it currently discloses moves to a sibling maintainer document instead of being deleted.

Purpose: SKILL.md is loaded into context to make an agent *use* VICE. Module inventories, function names, the repo-root resolution ladder, and the pool's four-question health model do not help a caller drive the emulator — they cost context and invite an agent to reason about the seam instead of calling through it. The behaviour a caller must actually act on (poll without stalling the machine, namespace snapshot names, read disks the working way) stays, restated as positive instruction.

Output: a rewritten SKILL.md, a new `INTERNALS.md` holding the removed material, and a matching Project Skills row in `.claude/CLAUDE.md`.

Documentation-only. No `.mjs` or `.sh` file is touched, nothing is renamed, nothing moves out of `scripts/` or `resources/`.
</objective>

<execution_context>
@/workspaces/bruce_lee/.claude/gsd-core/workflows/execute-plan.md
@/workspaces/bruce_lee/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@.claude/skills/vice-session/SKILL.md
@.claude/skills/acme-build/SKILL.md
@.claude/skills/devcontainer-host-path/SKILL.md
</context>

<voice_reference>
`acme-build/SKILL.md` and `devcontainer-host-path/SKILL.md` are the in-repo house style and the target voice for this rewrite. Read both before writing a line. What they do, and what this file must copy:

- Open with a title, one orienting sentence, and a single fenced command block — every command a caller needs, one per line, each with a trailing `#` comment.
- Every following section is "to do X, run Y", with real output shown where the output is what the reader needs.
- Facts appear as instructions, not as rationale: acme-build writes "Re-run `build` until it exits 0" and "Let `-o` name the output and leave `!to` out of the source" — no paragraph explaining why the tool is built that way.
- No module inventory, no function names, no architecture section. `acme.mjs` and `hostpath.mjs` are named only as things you run.
- Troubleshooting is a two-column symptom/fix table whose fix column is a command or a one-line action.
</voice_reference>

<tasks>

<!-- planner-discipline-allow: INTERNALS.md -->
<!-- planner-discipline-allow: internals -->
<!-- planner-discipline-allow: Self-contained for both halves -->

<task type="tracer">
  <name>Task 1: Migrate the densest internals block end-to-end — maintainer doc created, SKILL.md section replaced, gate proven</name>
  <files>.claude/skills/vice-session/INTERNALS.md, .claude/skills/vice-session/SKILL.md</files>
  <read_first>.claude/skills/vice-session/SKILL.md (all 141 lines), .claude/skills/acme-build/SKILL.md</read_first>
  <action>
Do the whole migration for ONE section first, so the destination format, the SKILL.md voice, and the verification gate are all proven before the rest of the file is touched.

Create `.claude/skills/vice-session/INTERNALS.md`. It is a maintainer reference, not a skill: give it NO YAML frontmatter (frontmatter would make the directory look like it holds two skills). First line is an H1 naming it as maintainer notes for the vice-session skill. Follow it with one short paragraph stating that it records how the skill is built for whoever maintains it, and that nothing here is needed to use the skill.

Then move SKILL.md's architecture section — the block spanning its current lines 24 through 53, the one whose heading claims the skill carries both halves — into INTERNALS.md as the first content section. Keep the original heading text as that section's heading. Preserve the substance word for word: every module filename and its stated job, the automatic host-script deployment behaviour and the function that triggers it, the never-overwrite-an-existing-deployed-copy rule, the two repo-root resolution entry points and the shared ladder they both follow, the consequence when the two halves disagree, and the flag that prints resolved paths for checking it. Copying the prose across verbatim and only fixing the heading level is the right amount of effort here — this is a relocation, not a rewrite.

In SKILL.md, replace those lines with a short usage section in the house voice, covering only what a caller does and nothing about how it works: this skill directory is self-sufficient and can be copied into another project as one unit; `node .claude/skills/vice-session/scripts/vice.mjs install` reports the status of the deployed host-side scripts without changing anything, and `install --force` restores them. Do not name any module file, any function, any state file, or any resolution rule. Do not mention INTERNALS.md anywhere in SKILL.md — not in prose, not in a "see also", not in a comment.

Leave the rest of SKILL.md alone in this task; Task 2 handles it.
  </action>
  <verify>
    <automated>bash -c 'S=.claude/skills/vice-session/SKILL.md; I=.claude/skills/vice-session/INTERNALS.md; test -f "$I" || { echo "no maintainer doc"; exit 1; }; head -1 "$I" | grep -q "^# " || { echo "maintainer doc must open with an H1, not frontmatter"; exit 1; }; head -1 "$I" | grep -q "^---$" && { echo "maintainer doc must not carry frontmatter"; exit 1; }; grep -qF "ensureResourcesInstalled" "$I" && grep -qF "resolve_repo_root" "$I" && grep -qF "repo-root.mjs" "$I" || { echo "moved section incomplete"; exit 1; }; grep -qiF "Self-contained for both halves" "$S" && { echo "architecture section still in SKILL.md"; exit 1; }; grep -qF "vice.mjs install" "$S" || { echo "install command dropped from SKILL.md"; exit 1; }; grep -qiF "INTERNALS" "$S" && { echo "SKILL.md must not point at the maintainer doc"; exit 1; }; echo TRACER-OK'</automated>
  </verify>
  <done>`INTERNALS.md` exists as a frontmatter-free maintainer doc holding the architecture section verbatim-in-substance; SKILL.md no longer carries that section, still documents the `install` command, and does not reference the maintainer doc.</done>
</task>

<task type="auto">
  <name>Task 2: Rewrite the remainder of SKILL.md as a usage guide, relocating every remaining internal</name>
  <files>.claude/skills/vice-session/SKILL.md, .claude/skills/vice-session/INTERNALS.md</files>
  <read_first>.claude/skills/vice-session/SKILL.md, .claude/skills/vice-session/INTERNALS.md, .claude/skills/acme-build/SKILL.md, .claude/skills/devcontainer-host-path/SKILL.md</read_first>
  <reversibility rating="reversible">Documentation-only; `git show a232c3c:.claude/skills/vice-session/SKILL.md` restores the original in one command.</reversibility>
  <action>
Rewrite SKILL.md end to end in the house voice described in `<voice_reference>`. Relocate — do not delete — every remaining internal: each mechanism paragraph you strip out gets a corresponding section in INTERNALS.md that keeps its identifiers and its reasoning intact. The gate below compares the two files' identifier sets, so anything named in the original and absent from both files fails the task.

Frontmatter: keep `name: vice-session` unchanged. Set `description:` to exactly this string, on one line — it keeps every trigger word and drops the one mechanics term:

`Drive the host's VICE emulator from this container — start a session, discover and call the vice_* tools, inspect C64 memory and machine state. Use for any emulator, VICE, x64sc, C64 debugging, memory-inspection, checkpoint or snapshot task, and whenever a vice_* tool is needed.`

Structure the body as follows. Section headings are yours to word, but the content of each is fixed:

1. Title and opening command block. One orienting sentence, then a single fenced bash block with all eight commands, one per line, each with a trailing `#` comment saying what it gives you: `session acquire` (note `--ttl-min N`), `ping`, `tools`, `tools NAME`, `call TOOL '{"k":"v"}'`, `session status`, `session release`, `pool status`. Either spell the script path in full on each line or assign it to a short variable first the way acme-build does — but the full path `.claude/skills/vice-session/scripts/vice.mjs` must appear literally at least once. Follow the block with one sentence: every emulator call goes through this script, and there is no `mcp__vice__*` tool in this project. State it as the route, not as an enforcement boundary — no mention of what the script checks, blocks, or detects.

2. Sessions. Acquire one at the start of emulator work, release it at the end. It survives across separate Bash calls, so a later command finds it without re-acquiring. It is optional — commands work without one. `session acquire` and `session status` both print the instance's port and the expiry.

3. Finding a tool. `tools` lists every tool with a one-line description; a substring argument filters (show `tools memory` as the example); a full tool name prints the input schema — params, types, required, enums and defaults; `--json` for machine-readable output.

4. Calling a tool. `call` with a tool name and a JSON argument object prints the JSON result. Give one concrete worked example against a real tool such as `vice_memory_read`.

5. Polling while the machine runs. Written as a recipe, not a warning: state-reading calls stop the machine, so write a wait loop as read → `vice_execution_run` → wait, and use `vice_ping` for the waiting, since it reports state without stopping the machine. One sentence on the payoff — a loop written this way runs the machine at full speed — is fine; do not include cycle measurements or the history of how it was discovered.

6. Naming snapshots. `vice_snapshot_save` takes a name, not a path, and every instance writes into the same host directory, so prefix each name with the active instance's port (which `session acquire`/`session status` printed). Do not name the script that already does this.

7. Reading a disk. To inspect a disk's contents, parse the `.d64` bytes directly, or call `vice_disk_read_sector` for the emulated drive's own view. State only these two routes. Do not name the disk-directory tool that is unavailable, do not describe how it is kept unavailable, and do not explain what happens if it is called — the working routes are the whole content of this section.

8. Running several instances. The host-side commands `tools/vice-pool.sh start N`, `status` and `stop`, marked host-workspace-only. `node ... vice.mjs pool status` is the container-side view: it reports launched/alive/leased/supervised per instance plus a diagnosis line, and is the command to run when an instance's usability is in question. If `tools/vice-pool.sh` is not present yet, `vice.mjs install` puts it there. Keep the column names, drop the model that explains why there are four of them.

9. Troubleshooting. A two-column symptom/fix table, fix column = a command or a one-line action, no mechanism explanation in either column. Six rows, in this order:
   - The session-expired refusal message → `session release`, then `session acquire`.
   - `transport error` / `ECONNREFUSED` / timed out after retries → the host emulator is not reachable from this container; restart it on the host, then retry.
   - The `acquire: no free instance` message → read the per-candidate reason it prints (`no answer` = not running, `leased by pid ...` = busy); wait and retry, or run `pool status`.
   - `pool status` reports an instance as not alive → follow the fix in its diagnosis line; `session acquire` skips unusable instances on its own, so no action is needed to keep working.
   - The mid-session restart message — quote it only as far as `... since this session was acquired` → `session release`, `session acquire`, redo the affected work.
   - A session nobody released → `session status` prints time to expiry; it frees itself, so nothing to clean up.

10. Optionally close with one line noting that running the script with no command prints the full usage, including the environment variables that override the endpoint, the timeout and the session TTL.

What must not appear anywhere in the finished SKILL.md: internal module filenames, internal function names, internal state file or directory names, the repo-root resolution ladder, the path-printing debug flag, the description of layered enforcement, restart-detection identifiers, liveness-checking identifiers, and the name of the unavailable disk-directory tool. The gate's alternation is the authoritative list — read it before you start writing, and treat it as the checklist.
  </action>
  <verify>
    <automated>bash -c 'S=.claude/skills/vice-session/SKILL.md; I=.claude/skills/vice-session/INTERNALS.md; B=a232c3c:.claude/skills/vice-session/SKILL.md; LEAKS="repo-root\.(mjs|sh)|vice-pool\.mjs|vice-pool\.test\.mjs|vice-probe\.mjs|vice-session\.mjs|install-resources\.mjs|container-guard|vice-supervisor|recover\.mjs|ensureResourcesInstalled|resolve_repo_root|repoRoot|serverInfo|probeAll|leaseInfo|readEpoch|snapshotName|acquire\(\)|call\(\)|registry\.json|epoch|--print-paths|deny-list|vice_disk_list|probe|Self-contained"; if grep -Eqin "$LEAKS" "$S"; then echo "LEAKS REMAIN in SKILL.md:"; grep -Eoin "$LEAKS" "$S"; exit 1; fi; LOST=$(comm -23 <(git show "$B" | grep -Eoi "$LEAKS" | sort -u) <(grep -Eoi "$LEAKS" "$I" | sort -u)); if [ -n "$LOST" ]; then echo "NOT PRESERVED in the maintainer doc:"; echo "$LOST"; exit 1; fi; echo LEAK-GATE-OK'</automated>
    <automated>bash -c 'S=.claude/skills/vice-session/SKILL.md; MISS=0; while IFS= read -r p; do [ -z "$p" ] && continue; grep -qF -- "$p" "$S" || { echo "MISSING: $p"; MISS=1; }; done <<EOF
name: vice-session
.claude/skills/vice-session/scripts/vice.mjs
ping
tools
call
session acquire
session release
session status
pool status
install
vice_ping
vice_execution_run
vice_snapshot_save
vice_disk_read_sector
vice-pool.sh
.d64
EOF
[ "$MISS" = 0 ] && echo PRESENCE-OK || exit 1'</automated>
    <automated>bash -c 'git status --porcelain -- .claude/skills/vice-session/scripts .claude/skills/vice-session/resources | grep -q . && { echo "scripts/ or resources/ modified — this change is documentation-only"; exit 1; }; echo NO-CODE-CHANGE-OK'</automated>
    <human-check>Read the finished SKILL.md top to bottom. Every paragraph should answer "how do I do X"; none should answer "how is this built" or "why must I not do Y". Judge it against acme-build/SKILL.md — it should read like a sibling, not like a design document.</human-check>
  </verify>
  <done>SKILL.md is a usage-only guide in the house voice: the leak alternation matches zero lines, every command and behavioural instruction a caller needs is present, every identifier the original disclosed is now in INTERNALS.md, and no file under `scripts/` or `resources/` changed.</done>
</task>

<task type="auto">
  <name>Task 3: Sync the Project Skills row in `.claude/CLAUDE.md` to the new description</name>
  <files>.claude/CLAUDE.md</files>
  <read_first>.claude/CLAUDE.md (the `## Project Skills` table), .claude/skills/vice-session/SKILL.md (frontmatter)</read_first>
  <action>
`.claude/CLAUDE.md`'s `## Project Skills` table carries a copy of each skill's `description:`. It is a GSD-managed section, regenerated from skill frontmatter, so the copy must match the source exactly — otherwise the next regeneration silently reverts the table and the two drift.

Edit only the Description cell of the `vice-session` row so it holds the new description string byte-for-byte as it appears in SKILL.md's frontmatter. Use a scoped `Edit` on that row's text. Change nothing else: not the other three rows, not the Skill or Path columns, not any other section of the file.
  </action>
  <verify>
    <automated>bash -c 'D=$(awk "/^description: /{sub(/^description: /,\"\"); print; exit}" .claude/skills/vice-session/SKILL.md); test -n "$D" || { echo "no description in frontmatter"; exit 1; }; grep -qF -- "$D" .claude/CLAUDE.md || { echo "CLAUDE.md Project Skills row does not match the skill description"; exit 1; }; grep -c "^| vice-session " .claude/CLAUDE.md | grep -qx 1 || { echo "expected exactly one vice-session row"; exit 1; }; test "$(grep -c "^| \(acme-build\|c64-memory-mapping\|devcontainer-host-path\|vice-session\) " .claude/CLAUDE.md)" = 4 || { echo "Project Skills table lost a row"; exit 1; }; echo CLAUDE-MD-SYNC-OK'</automated>
    <automated>bash -c 'N=$(git diff HEAD --numstat -- .claude/CLAUDE.md | awk "{s+=\$1+\$2} END{print s+0}"); test "$N" -le 2 || { echo "more than one line changed in CLAUDE.md (added+removed=$N)"; exit 1; }; echo SCOPED-EDIT-OK'</automated>
  </verify>
  <done>The vice-session row's Description cell in `.claude/CLAUDE.md` is byte-identical to SKILL.md's `description:` frontmatter, all four skill rows are intact, and exactly one line of the file changed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| SKILL.md → agent context | Whatever this file says becomes an agent's operating instructions for a shared, crash-prone host resource. Removing a behavioural instruction changes agent behaviour even though no code changed. |
| repo → maintainer | INTERNALS.md keeps the removed detail inside the same repo and the same trust zone; nothing leaves the workspace. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-ryz-01 | Information disclosure | `.claude/skills/vice-session/INTERNALS.md` | low | accept | The relocated detail stays in the same tracked repo as the code it describes; the objective is agent-context hygiene, not secrecy. No credential, host path, or endpoint secret is involved. |
| T-ryz-02 | Tampering | SKILL.md disk-inspection section | high | mitigate | Dropping the working disk route while also dropping the named-tool warning would leave an agent to rediscover the host-crashing call. Task 2 keeps both working routes and its presence gate asserts `vice_disk_read_sector` and `.d64` are still documented. Code-level unavailability of the crashing tool is untouched — no file under `scripts/` changes, asserted by a gate. |
| T-ryz-03 | Denial of service | SKILL.md polling section | high | mitigate | Losing the read → resume → wait recipe makes any future poll loop stall the emulator to a fraction of real speed. Task 2's presence gate asserts `vice_ping` and `vice_execution_run` both survive the rewrite. |
| T-ryz-04 | Tampering | SKILL.md snapshot section | medium | mitigate | Losing the port-prefix instruction lets two instances overwrite each other's snapshots on the shared host directory. Task 2's presence gate asserts `vice_snapshot_save` survives, and the section is a fixed requirement of the action. |
| T-ryz-05 | Repudiation | `.claude/CLAUDE.md` Project Skills table | low | mitigate | A description that diverges from the frontmatter is silently reverted by the next regeneration, leaving no trace of the intended change. Task 3 gates on byte-identity between the two. |

No package-manager installs occur in this plan, so no supply-chain threat row applies.
</threat_model>

<verification>
1. `bash -c 'LEAKS=...; grep -Eoin "$LEAKS" .claude/skills/vice-session/SKILL.md'` (alternation from Task 2) prints nothing.
2. The same alternation, run against `.claude/skills/vice-session/INTERNALS.md`, produces a distinct match set that is a superset of the baseline SKILL.md's — nothing was lost.
3. Task 2's presence loop prints `PRESENCE-OK` — all sixteen required commands, tools and routes survive.
4. `git status --porcelain -- .claude/skills/vice-session/scripts .claude/skills/vice-session/resources` is empty.
5. The `description:` string in SKILL.md frontmatter is found verbatim in `.claude/CLAUDE.md`.
6. `node .claude/skills/vice-session/scripts/vice.mjs install` still runs and reports deployed host-script status — a smoke check that no script was disturbed. (Requires no emulator.)
</verification>

<success_criteria>
- SKILL.md reads as a usage guide: title, one command block, then "to do X, run Y" sections and a symptom/fix table.
- Zero internal module names, function names, state file names, resolution rules or enforcement descriptions in SKILL.md.
- A reader of SKILL.md alone can acquire and release a session, discover a tool and its schema, call any `vice_*` tool, check session and pool status, deploy the host-side scripts, poll without stalling the machine, name a snapshot safely, and read a disk.
- INTERNALS.md carries every removed detail, and SKILL.md does not advertise it.
- Frontmatter `name:` unchanged; `description:` still trigger-rich and mirrored in `.claude/CLAUDE.md`.
- No behaviour change anywhere: `scripts/` and `resources/` are untouched.
</success_criteria>

<output>
Create `.planning/quick/260730-ryz-rewrite-vice-session-skill-md-as-usage-o/260730-ryz-SUMMARY.md` when done.
</output>
