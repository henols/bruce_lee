# vice-session — maintainer notes

This records how the skill is built, for whoever maintains it. Nothing here
is needed to use the skill — see `SKILL.md` for that.

## Self-contained for both halves

This skill directory carries BOTH halves of driving VICE and can be copied
into another project as a single unit — copying it alone is now sufficient.
The CONTAINER half is the Node modules in this skill's `scripts/` directory
(`repo-root.mjs`, `vice.mjs`, `vice-pool.mjs`, `vice-probe.mjs`,
`vice-session.mjs`, `vice-pool.test.mjs`, `install-resources.mjs`). The HOST half —
`vice-supervisor.sh`, `vice-pool.sh` and `lib/container-guard.sh` — lives
tracked in `.claude/skills/vice-session/resources/`, and is deployed automatically into `tools/` at the
repo root the FIRST TIME any of this skill's `.mjs` files runs (`ensureResourcesInstalled()`,
triggered from `repo-root.mjs`). `tools/` holds disposable, gitignored
deployed copies — not a second tracked copy that could drift out of sync
with `resources/`. An existing deployed copy is **never overwritten
automatically**, whatever its contents; run
`node .claude/skills/vice-session/scripts/vice.mjs install` for a per-entry status
report (missing/present/diverged) with no side effects, or
`... install --force` to deliberately restore every entry from `resources/`.

The invariant that makes the two halves work together: the shell scripts
(from EITHER `resources/` or their deployed `tools/` copy) resolve the repo
root via `resources/lib/repo-root.sh`'s `resolve_repo_root()`; the Node
modules resolve it via `repo-root.mjs`'s `repoRoot()`. Both follow the same
ladder — `CONTAINER_WORKSPACE_PATH` when it contains the caller, otherwise
the nearest ancestor with a `.git` entry, otherwise `CONTAINER_WORKSPACE_PATH`
regardless, otherwise a location-shaped last resort — and must land on the
same `.vice-supervisor` directory, or restart detection silently stops
working with no error anywhere. `--print-paths` on either script, from
either location, prints the resolved paths (no side effects) so this can be
checked directly — `resources/vice-supervisor.sh --print-paths` and
`tools/vice-supervisor.sh --print-paths` must always agree.
