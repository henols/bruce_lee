# Quick Task 260730-r0u: all the scripts that are used by the skills shall be located in a scripts folder under each skill - Context

**Gathered:** 2026-07-30
**Status:** Ready for planning

<domain>
## Task Boundary

Every script a skill under `.claude/skills/` uses must live in a `scripts/`
subdirectory of that skill, rather than loose at the skill root.

In scope — the four skills that currently carry loose scripts:

| Skill | Moves into `scripts/` | Stays at skill root |
|-------|-----------------------|---------------------|
| `acme-build` | `acme.mjs` | `SKILL.md`, `template.a` |
| `c64-memory-mapping` | `driver.mjs` | `SKILL.md`, `memmap.json` |
| `devcontainer-host-path` | `hostpath.mjs` | `SKILL.md` |
| `vice-session` | `vice.mjs`, `vice-pool.mjs`, `vice-probe.mjs`, `vice-session.mjs`, `repo-root.mjs`, `install-resources.mjs`, `vice-pool.test.mjs` | `SKILL.md`, `resources/` |

</domain>

<decisions>
## Implementation Decisions

### What counts as "a script" (LOCKED — user answered)
- Only the `.mjs` Node modules move into `scripts/`.
- `vice-session/resources/` does **NOT** move. It keeps its established
  meaning as the tracked deployment payload for the host's `tools/`
  directory (see commits `4c1bec8`, `b1f49fd`, `e01531b`, `4d8fff8` which
  deliberately created that arrangement). It stays at the skill root, and
  the shell scripts inside it keep their current relative layout
  (`resources/vice-pool.sh`, `resources/lib/*.sh`).
- Non-script data files stay at the skill root: `acme-build/template.a`,
  `c64-memory-mapping/memmap.json`.
- Deployed paths under `tools/` are unchanged. `.gitignore`'s
  `/tools/...` entries must keep working untouched; only the tracked
  source location of the `.mjs` files moves.

### Move mechanics
- Use `git mv` so history follows the files.
- The move must be behaviour-preserving. Every entry point that works today
  must work from its new path, and every cross-module and cross-skill
  import must still resolve.

### Known path-resolution consequences the plan must handle
- `install-resources.mjs` resolves its `resources/` source directory
  relative to its own module directory. Once it sits in `scripts/`, that
  resolution must walk up one level to the skill root, or resource
  deployment silently breaks.
- `install-resources.mjs` imports `../devcontainer-host-path/hostpath.mjs`
  — a cross-skill import whose depth changes on both ends.
- `repo-root.mjs` imports `./install-resources.mjs`; `vice-session.mjs`
  imports `./vice-pool.mjs`, `./vice.mjs`, `./repo-root.mjs`. Same-directory
  imports survive the move as a set, but must be confirmed, not assumed.
- Any `.mjs` that locates the repo root or a sibling data file by walking up
  from its own module directory gains one extra level of nesting.
- `acme.mjs` and `driver.mjs` read `template.a` / `memmap.json`, which stay
  at the skill root — those reads must gain the `..` hop.

### Documentation that must follow the move
- `.claude/skills/vice-session/SKILL.md` — many `node .claude/skills/vice-session/vice.mjs ...`
  invocation lines, plus prose naming the modules and describing the
  container/host split.
- The other three `SKILL.md` files, for their own invocation paths.
- `tools/README.md` and `tools/vice-pool.sh`'s pointer line, where they cite
  container-side `.mjs` paths.
- `.claude/CLAUDE.md`'s Project Skills table lists `SKILL.md` paths only —
  those do not change.

### Claude's Discretion
- Whether `scripts/` also gets a short README, or whether SKILL.md alone
  documents the layout.
- Exact ordering of the moves (per-skill vs all-at-once) and how the work
  is split across commits.

</decisions>

<specifics>
## Specific Ideas

Historical `.planning/quick/**/PLAN.md` and `SUMMARY.md` artifacts reference
the old `.mjs` paths. Those are point-in-time records of completed work, not
live references — do not rewrite them.

</specifics>

<canonical_refs>
## Canonical References

No external specs. The authority for the current `resources/` → `tools/`
arrangement is this repo's own recent history (`4c1bec8`, `b1f49fd`,
`e01531b`, `4d8fff8`) and `.claude/skills/vice-session/SKILL.md`.

</canonical_refs>
