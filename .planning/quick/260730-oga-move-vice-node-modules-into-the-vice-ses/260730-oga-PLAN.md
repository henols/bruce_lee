---
phase: quick-260730-oga
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .claude/skills/vice-session/vice.mjs
  - .claude/skills/vice-session/vice-pool.mjs
  - .claude/skills/vice-session/vice-session.mjs
  - .claude/skills/vice-session/vice-pool.test.mjs
  - .claude/skills/vice-session/repo-root.mjs
  - .claude/skills/vice-session/SKILL.md
  - tools/recover.mjs
  - tools/recover.test.mjs
  - tools/vice-supervisor.sh
  - tools/vice-pool.sh
  - tools/README.md
autonomous: true
requirements: [D-1, D-2, D-3, D-4, D-5, D-6]
user_setup: []

must_haves:
  truths:
    - "The `vice-session` skill directory contains its own Node modules and its own tests, so the skill can be copied into another project as a unit (D-1)."
    - "The `.vice-supervisor` directory the Node modules compute is byte-identical to the one `tools/vice-supervisor.sh` and `tools/vice-pool.sh` compute, and a test proves it rather than a human assuming it (D-2, D-3)."
    - "Repo-root resolution survives the modules sitting two directories deeper than they used to, and survives being exported into a project that does not set `CONTAINER_WORKSPACE_PATH` (D-2)."
    - "`VICE_EPOCH_FILE`, `VICE_POOL_DIR` and `VICE_SESSION_FILE` still win over everything else, exactly as today (D-2, D-6)."
    - "With no session file and no registry, the CLI still resolves to port 6510 with zero configuration (D-6)."
    - "`vice_disk_list` is still refused before any request is serialised, and still renders FORBIDDEN in the tools listing (D-6)."
    - "All 60 pre-existing tests still pass from the new location, unmodified in intent (D-6)."
    - "Every command a human or agent is told to run names a path that exists after the move — SKILL.md, `tools/README.md`, and the CLI's own error strings (D-4)."
    - "SKILL.md states plainly that the host-side shell launchers stay in `tools/` and must travel with the skill for the host half to work (D-5)."
  artifacts:
    - .claude/skills/vice-session/repo-root.mjs
    - .claude/skills/vice-session/vice.mjs
    - .claude/skills/vice-session/vice-pool.mjs
    - .claude/skills/vice-session/vice-session.mjs
    - .claude/skills/vice-session/vice-pool.test.mjs
    - .claude/skills/vice-session/SKILL.md
    - "tools/vice-supervisor.sh (--print-paths)"
    - "tools/vice-pool.sh (--print-paths)"
  key_links:
    - "repo-root.mjs's supervisorDir() <-> the shell scripts' `$REPO_ROOT/.vice-supervisor` — if these two ever disagree, restart detection silently stops working and NOTHING errors. This is the single most important connection in the change."
    - "the moved modules' sibling imports (`./vice-pool.mjs`, `./vice.mjs`, `./vice-session.mjs`) <-> their new directory — they only keep working because all four files move together and keep their basenames."
    - "tools/recover.mjs + tools/recover.test.mjs <-> `../.claude/skills/vice-session/*.mjs` — the only outward importers; the same cross-tree import shape recover.mjs already uses for `hostpath.mjs`."
    - "vice-session.mjs's recovery error strings <-> SKILL.md's troubleshooting table — both tell a human which command to run, so both must name the new path."
---

<objective>
Move the three VICE Node modules and their test file into `.claude/skills/vice-session/`
so the skill is self-contained and exportable, and fix the repo-root derivation they
depend on as part of the same move.

Purpose: every other skill in this project carries its own code — `acme-build/acme.mjs`,
`c64-memory-mapping/driver.mjs`, `devcontainer-host-path/hostpath.mjs`. `vice-session` is
SKILL.md pointing at `tools/`, so it cannot be exported. More urgently: all three modules
locate the shared `.vice-supervisor` state directory with a fixed `".."` relative to their
own file. That single `".."` reaches the repo root from `tools/` and reaches
`.claude/skills/` from the new location — so after a naive move the container would read a
DIFFERENT epoch/registry/session directory than the host scripts write, and **nothing would
error**. Restart detection would quietly stop working. Moving the files without fixing this
is worse than not moving them at all.

Output: four files relocated with `git mv` (history preserved), one new shared
`repo-root.mjs`, a test that proves the Node side and the shell side land on the same
directory, and every live reference repointed.
</objective>

<execution_context>
@/workspaces/bruce_lee/.claude/gsd-core/workflows/execute-plan.md
@/workspaces/bruce_lee/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md

Style reference for how a skill invokes its own scripts (full path from repo root):
@.claude/skills/devcontainer-host-path/SKILL.md

Precedent for the cross-tree import shape `tools/recover.mjs` will use:
`tools/recover.mjs` line 18 already does
`import { tryHostPaths } from "../.claude/skills/devcontainer-host-path/hostpath.mjs";`

The path invariant both sides must agree on, from `tools/vice-supervisor.sh` (line 33) and
`tools/vice-pool.sh` (line 30), identically:
`REPO_ROOT="$(cd "$(dirname "$SELF_PATH")/.." && pwd)"` — one level up from `tools/`.

`.gitignore` ignores `.claude/*` but re-includes `!.claude/skills/`, so files added under
`.claude/skills/vice-session/` are tracked (verified: `git check-ignore` does not match).
</context>

<tasks>

<task type="tracer">
  <name>Task 1: Move the four modules and make repo-root resolution survive the move</name>
  <files>.claude/skills/vice-session/vice.mjs, .claude/skills/vice-session/vice-pool.mjs, .claude/skills/vice-session/vice-session.mjs, .claude/skills/vice-session/vice-pool.test.mjs, .claude/skills/vice-session/repo-root.mjs, tools/recover.mjs, tools/recover.test.mjs</files>
  <action>
Relocate the cluster with `git mv` (D-1, history preservation is the reason — do not
copy-then-delete): `tools/vice.mjs`, `tools/vice-pool.mjs`, `tools/vice-session.mjs` and
`tools/vice-pool.test.mjs` into `.claude/skills/vice-session/`, keeping their basenames
unchanged. The basenames are load-bearing: the three modules import each other as
`./vice-pool.mjs`, `./vice.mjs`, `./vice-session.mjs`, and the test file derives its child-
process module URLs with `new URL("./vice-pool.mjs", import.meta.url)` — all of which keep
working untouched precisely because the whole cluster moves together under the same names.
Nothing else moves: the shell scripts, `tools/lib/container-guard.sh`, `recover.mjs`,
`recover.test.mjs`, `releases.mjs` and `tools/README.md` stay in `tools/`.

Create `.claude/skills/vice-session/repo-root.mjs` as the ONE shared place all three
modules resolve the repo root through (D-2). Export two functions, both pure with respect
to their arguments so the ladder is directly unit-testable without spawning anything:

- `repoRoot({ from = HERE, env = process.env } = {})` where `HERE` is this module's own
  directory. Precedence, in order:
  1. `env.CONTAINER_WORKSPACE_PATH` when it is set AND `from` resolves inside it — this
     devcontainer sets it (`.devcontainer/devcontainer.json` `containerEnv`, value
     `/workspaces/bruce_lee`), and it is the most explicit signal available.
  2. Otherwise walk up from `from` toward the filesystem root, returning the first
     directory containing a `.git` entry (`existsSync` on the joined path — matches both a
     `.git` directory and a worktree's `.git` file). This is what keeps the skill correct
     when exported into a project that sets no such variable.
  3. Otherwise `env.CONTAINER_WORKSPACE_PATH` if set at all (set, but not containing
     `from` — an exported copy living outside the mounted workspace), with a one-time
     stderr note naming both paths. Silence here would be the quiet wrong answer.
  4. Otherwise three levels up from `from`, with a one-time stderr note. Last resort only;
     three levels is what `<root>/.claude/skills/<skill>/` implies, and is the same shape
     `devcontainer-host-path/hostpath.mjs` uses.
  Gate both stderr notes behind a module-level "already warned" flag so a long-running
  process emits each at most once.
- `supervisorDir({ from, env } = {})` returning `join(repoRoot(...), ".vice-supervisor")`,
  so the literal directory name also has exactly one definition.

Follow the heavy explanatory comment idiom already in these modules. The comment on this
file must say WHY the fixed `".."` is gone — that it reached the repo root from `tools/`
and would reach `.claude/skills/` from here, pointing the container at a directory the host
scripts never write, with no error anywhere — so nobody reintroduces it.

Rewire the three derivations to use the shared helper, changing nothing else about them.
The explicit env overrides keep HIGHEST precedence exactly as today (D-2, D-6 — the test
suite depends on them):
- `vice.mjs`'s `EPOCH_FILE`: `VICE_EPOCH_FILE` if set, else
  `join(supervisorDir(), "epoch.json")`.
- `vice-pool.mjs`'s `poolDir()`: `VICE_POOL_DIR` if set, else `supervisorDir()`. Drop the
  `new URL(".", import.meta.url).pathname` form entirely.
- `vice-session.mjs`'s `sessionFilePath()`: `VICE_SESSION_FILE` if set, else
  `join(supervisorDir(), "session.json")`.
Do not add a fourth env knob for the repo root — the three existing per-path overrides are
the documented escape hatches and adding another would be a new, untested surface.

Repoint the only two outward importers (D-4): in `tools/recover.mjs` and
`tools/recover.test.mjs`, change the `./vice.mjs` and `./vice-pool.mjs` specifiers to
`../.claude/skills/vice-session/vice.mjs` and
`../.claude/skills/vice-session/vice-pool.mjs`. This matches the cross-tree import
`recover.mjs` already uses for `hostpath.mjs`, so it is an established shape in this file,
not a new one.

Leave every behaviour untouched (D-6): the `DENY_LIST` guard stays the first statement in
`call()`, the transport-vs-RPC retry distinction stays, session/lease/TTL semantics stay.
This task is a move plus a path fix.
  </action>
  <verify>
    <automated>node --test .claude/skills/vice-session/vice-pool.test.mjs tools/recover.test.mjs</automated>
    <automated>test "$(git status --porcelain | grep -c '^R')" -eq 4</automated>
    <automated>node -e 'import("./.claude/skills/vice-session/repo-root.mjs").then(m=>{const d=m.supervisorDir();if(d!=="/workspaces/bruce_lee/.vice-supervisor")throw new Error("supervisorDir resolved to "+d);})'</automated>
  </verify>
  <done>
All four files are tracked at their new paths as renames (`git status --porcelain` shows
exactly 4 `R` entries), all 60 pre-existing tests pass unchanged from the new location, and
`supervisorDir()` resolves to `/workspaces/bruce_lee/.vice-supervisor` — the repo root, not
`.claude/skills/.vice-supervisor`.
  </done>
  <reversibility rating="reversible">A `git mv` back plus reverting three one-line path derivations undoes the whole change.</reversibility>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Prove the Node side and the shell side compute the same directory</name>
  <files>tools/vice-supervisor.sh, tools/vice-pool.sh, .claude/skills/vice-session/vice-pool.test.mjs</files>
  <precondition>`bash` can execute `tools/vice-supervisor.sh` and `tools/vice-pool.sh` from inside this container. Both refuse their real work here (the container guard), so the new flag must be handled BEFORE the guard is sourced, alongside `--help`.</precondition>
  <behavior>
    - `tools/vice-supervisor.sh --print-paths` exits 0 inside the container, spawns nothing,
      writes nothing (no `mkdir`, no epoch record), and prints `repo_root=`,
      `supervisor_dir=` and `epoch_file=` as one `key=value` line each.
    - `tools/vice-pool.sh --print-paths` behaves the same, printing `repo_root=`,
      `pool_dir=` and `registry_path=`.
    - Both honour their existing env overrides (`VICE_SUPERVISOR_DIR`, `VICE_POOL_DIR`), so
      the printed value is the value the script would actually use.
    - The directory the Node modules compute with no overrides equals `supervisor_dir` from
      the supervisor script AND `pool_dir` from the pool script, string-for-string.
    - That agreed directory does not sit under `.claude` — the exact regression a naive move
      would have introduced.
    - `repoRoot()` prefers a `CONTAINER_WORKSPACE_PATH` that contains the starting
      directory; falls back to the nearest ancestor holding a `.git` entry when the variable
      is absent; and reports the variable (not the marker walk) only when the start point
      lies outside it.
    - With no registry and no session file, `acquire()` still returns port 6510 unpooled with
      a no-op release, and `resolveInstance()` still reports the default source.
  </behavior>
  <action>
Add a `--print-paths` flag to both `tools/vice-supervisor.sh` and `tools/vice-pool.sh`,
following the `--help` precedent exactly: detected in the FIRST argument loop, acted on
BEFORE `tools/lib/container-guard.sh` is sourced, because printing resolved paths writes no
state and spawns nothing — there is no reason to make anyone set
`VICE_SUPERVISOR_ALLOW_CONTAINER=1` to ask a script which directory it will use. Print
`key=value` lines (one per line, no decoration) and exit 0.

To print the value the script would really use without duplicating its definition, hoist
the single default assignment above the guard: in `vice-supervisor.sh` move
`VICE_SUPERVISOR_DIR="${VICE_SUPERVISOR_DIR:-$REPO_ROOT/.vice-supervisor}"` to just after
`REPO_ROOT`, and in `vice-pool.sh` move `VICE_POOL_DIR` and `REGISTRY_PATH` likewise. Leave
a pointer comment where each was, so the configuration block still documents the knob.
Derive `epoch_file` from the hoisted variable rather than restating the filename.

Add `--print-paths` to each script's usage text (noting it writes nothing and spawns
nothing) and to the "already handled above" case arm in the later argument loops — in
`vice-pool.sh` that loop treats any unrecognised argument as the pool-size positional, so
omitting it would make the flag a usage error.

Then add the tests to `.claude/skills/vice-session/vice-pool.test.mjs`, in the existing
`node --test` idiom already in that file (`mkdtempSync` temp dirs, `execFileP` children —
no new framework, no new dependency):

1. **The agreement test (D-3, the regression that would otherwise go unnoticed.)** Locate
   the two scripts as `join(repoRoot(), "tools", ...)` and assert they exist first with a
   clear message — resolving the script through the very function under test cannot produce
   a false pass, only a loud ENOENT, and a comment should say so. Run each with
   `execFileP("bash", [script, "--print-paths"])` and parse the `key=value` lines. Compute
   the Node-side values in a FRESH child process (`execFileP(process.execPath,
   ["--input-type=module", "-e", src], { env: cleanEnv })` where `cleanEnv` is
   `process.env` with every `VICE_*` key deleted) so the assertion is immune to env
   mutation or module-load ordering from sibling tests in the same file. Assert
   `supervisor_dir === pool_dir === supervisorDir() === dirname(EPOCH_FILE) ===
   poolDir() === dirname(sessionFilePath())`, and assert the agreed path does not contain a
   `.claude` segment.
2. **The `repoRoot()` ladder.** Drive it purely through its `from`/`env` arguments against
   `mkdtempSync` fixtures: a temp tree with a `.git` directory resolves to that tree with no
   env set; a `CONTAINER_WORKSPACE_PATH` containing `from` wins over a nearer `.git`; a
   `CONTAINER_WORKSPACE_PATH` that does not contain `from` loses to the `.git` walk.
3. **The no-configuration fallback.** Only add what the file does not already assert — do
   not duplicate existing coverage. With `VICE_POOL_DIR` and `VICE_SESSION_FILE` pointed at
   an empty temp dir, `acquire()` returns port 6510 with `pooled:false`, and the CLI's
   no-argument usage output (run as a child from the new path) reports port 6510.
  </action>
  <verify>
    <automated>bash tools/vice-supervisor.sh --print-paths | grep -q '^supervisor_dir=/workspaces/bruce_lee/.vice-supervisor$'</automated>
    <automated>bash tools/vice-pool.sh --print-paths | grep -q '^pool_dir=/workspaces/bruce_lee/.vice-supervisor$'</automated>
    <automated>node --test .claude/skills/vice-session/vice-pool.test.mjs tools/recover.test.mjs</automated>
  </verify>
  <done>
Both scripts answer `--print-paths` from inside the container with exit 0 and no side
effects, and the test suite is green with more than 60 tests — the added ones failing if the
Node modules and the shell scripts are ever pointed at different `.vice-supervisor`
directories.
  </done>
</task>

<task type="auto">
  <name>Task 3: Repoint every live reference and state the export caveat</name>
  <files>.claude/skills/vice-session/SKILL.md, .claude/skills/vice-session/vice-session.mjs, .claude/skills/vice-session/vice.mjs, tools/README.md, tools/vice-supervisor.sh, tools/vice-pool.sh</files>
  <action>
Repoint every instruction that names a path a human or agent is expected to run (D-4).
Anything still naming the old `tools/`-relative module path is now a command that does not
exist — the same class of quiet wrong answer this codebase keeps rejecting.

- `.claude/skills/vice-session/SKILL.md`: rewrite every command example to the full path
  from the repo root, matching how `devcontainer-host-path/SKILL.md` writes its own
  invocations (`node .claude/skills/vice-session/vice.mjs ...`). Cover the session verbs,
  `ping`, `tools`, `call`, and the troubleshooting table's recovery commands. Leave the
  host-only pool commands as `tools/vice-pool.sh ...`, because that is where they still
  live.
- `.claude/skills/vice-session/SKILL.md`, new short section (D-5): state plainly that the
  skill is self-contained for the CONTAINER side only, and that the host-side launchers —
  `tools/vice-supervisor.sh`, `tools/vice-pool.sh` and `tools/lib/container-guard.sh` —
  deliberately remain in `tools/` and must be copied alongside the skill for restart
  detection and the instance pool to work. Say it plainly rather than implying the skill
  directory alone suffices. Note the invariant that makes them work together: the shell
  scripts resolve the repo root one level up from `tools/`, the Node modules resolve it via
  `CONTAINER_WORKSPACE_PATH` or the nearest `.git`, and both must land on the same
  `.vice-supervisor`.
- Runtime error strings inside the moved modules: `vice-session.mjs`'s "release it first",
  expired-session and epoch-changed messages, and any equivalent in `vice.mjs`, each tell an
  operator which recovery command to run — update those paths. The tests assert on
  `/session release/` and `/session acquire/` substrings only, so this is safe.
- `vice.mjs`'s usage block: the `VICE_SESSION_FILE` line still describes the default as
  `<repo>/.vice-supervisor/session.json`, which remains accurate — confirm rather than
  change, and make sure the `usage:` line prints the new self path (it already derives it
  from `SELF`).
- `tools/README.md`: update every invocation example and every relative markdown link that
  points at a moved module (the `[tools/vice.mjs](vice.mjs)` style links now need
  `../.claude/skills/vice-session/vice.mjs`), and add a sentence where the layout is
  described saying which files moved and why the shell scripts did not.
- `tools/vice-supervisor.sh` and `tools/vice-pool.sh`: update the prose and the
  operator-visible `echo` line that name the container-side modules, so the path they print
  at runtime is one that exists.

Do NOT rewrite historical planning documents under `.planning/` (D-4) — past PLANs and
SUMMARYs record what was true when they were written.
  </action>
  <verify>
    <automated>! grep -rn 'node tools/vice' tools/README.md .claude/skills/vice-session/ tools/vice-supervisor.sh tools/vice-pool.sh</automated>
    <automated>grep -q 'tools/vice-supervisor.sh' .claude/skills/vice-session/SKILL.md &amp;&amp; grep -q 'node .claude/skills/vice-session/vice.mjs' .claude/skills/vice-session/SKILL.md</automated>
    <automated>node .claude/skills/vice-session/vice.mjs | grep -q 'port 6510'</automated>
    <automated>bash -c 'out=$(VICE_MCP_URL=http://127.0.0.1:9/mcp node .claude/skills/vice-session/vice.mjs ping 2>&amp;1); rc=$?; [ "$rc" -ne 0 ] &amp;&amp; printf "%s" "$out" | grep -q "vice-supervisor.sh on the HOST"'</automated>
    <automated>node --test .claude/skills/vice-session/vice-pool.test.mjs tools/recover.test.mjs</automated>
  </verify>
  <done>
No file outside `.planning/` tells anyone to run a module path that no longer exists,
SKILL.md documents the host-side dependency honestly, the no-argument CLI still reports port
6510 from the new location, and a dead endpoint still fails non-zero pointing at the
host-side supervisor. (The last check exercises the full reconnect ladder and takes roughly
50 seconds — that is the backoff working, not a hang.)
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| host → container, via the bind mount | `epoch.json`, `registry.json` and lease files are written on the host and parsed in the container. Unchanged by this work; the existing untrusted-input posture (`readEpoch`, `readRegistry`, `readSession`) is preserved verbatim. |
| environment → path resolution | New: `CONTAINER_WORKSPACE_PATH` now participates in deciding which directory the harness reads state from. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-oga-01 | Tampering | `repo-root.mjs` `repoRoot()` | medium | mitigate | The env var is accepted as the repo root only when the calling module actually lives inside it; otherwise the `.git` marker walk wins. A value pointing somewhere unrelated cannot silently redirect state reads, and the one case where it is used without containment emits a stderr note naming both paths. Operator-supplied, same-privilege input — never used to open a path read out of a file's contents. |
| T-oga-02 | Spoofing | `repoRoot()` marker walk | medium | mitigate | A nested or unrelated ancestor repository could be picked. Contained by preferring the explicit env var first, and pinned by Task 2's agreement test, which compares the answer against what the shell scripts independently compute. |
| T-oga-03 | Elevation of Privilege | `--print-paths` in both HOST-ONLY shell scripts | low | mitigate | A new pre-guard code path in a script whose guard is load-bearing. Restricted to printing already-resolved variables and exiting: no `mkdir`, no file write, no spawn, no change to the guard for any other verb — the same shape `--help` already has. |
| T-oga-04 | Information Disclosure | `--print-paths` output | low | accept | Prints absolute workspace paths only, to whoever can already run the script and read the repo. No secret material is involved. |
| T-oga-SC | Tampering | npm/pip/cargo installs | high | mitigate | Not applicable: this change installs no packages and adds no runtime dependency. Node stdlib only, as today. |
</threat_model>

<verification>
- `node --test .claude/skills/vice-session/vice-pool.test.mjs tools/recover.test.mjs` — all
  60 pre-existing tests pass, plus the new path-agreement, `repoRoot()` ladder and
  no-configuration cases.
- `bash tools/vice-supervisor.sh --print-paths` and `bash tools/vice-pool.sh --print-paths`
  both report `/workspaces/bruce_lee/.vice-supervisor`, matching what the Node modules
  compute.
- `git status --porcelain` shows the four modules as renames, not as delete-plus-add.
- `node .claude/skills/vice-session/vice.mjs` reports port 6510 with no session file and no
  registry present.
- A dead endpoint fails non-zero with the existing host-side recovery wording.
</verification>

<success_criteria>
- The `vice-session` skill directory holds `SKILL.md`, `repo-root.mjs`, `vice.mjs`,
  `vice-pool.mjs`, `vice-session.mjs` and `vice-pool.test.mjs`; the shell scripts and
  `recover.*` remain in `tools/`.
- The fixed `".."` repo-root derivation is gone from all three modules, replaced by one
  shared resolver whose comment explains why it must never come back.
- A test fails loudly if the Node side and the shell side ever disagree about
  `.vice-supervisor`.
- No behaviour changed: deny-list, retry semantics, session/lease/TTL rules and the port-6510
  zero-configuration fallback are all as before.
- No command in SKILL.md, `tools/README.md`, the shell scripts, or a runtime error string
  names a path that no longer exists.
</success_criteria>

<output>
Create `.planning/quick/260730-oga-move-vice-node-modules-into-the-vice-ses/260730-oga-SUMMARY.md` when done
</output>
