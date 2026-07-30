// The ONE shared place every module in this directory resolves the repo
// root through (D-2). Everything else in this skill -- vice.mjs's
// EPOCH_FILE, vice-pool.mjs's poolDir(), vice-session.mjs's
// sessionFilePath() -- derives its `.vice-supervisor` path through
// supervisorDir() below, so there is exactly one definition of both "where
// is the repo root" and "what is the shared state directory called".
//
// WHY THIS FILE EXISTS AT ALL: before this move, each of the three modules
// resolved the repo root with a fixed `resolve(dirname(SELF), "..", ...)` --
// ONE level up from the module's own file. That was correct while the
// modules lived in `tools/` (one level up from `tools/` IS the repo root),
// but this move puts them two levels deeper, at
// `.claude/skills/vice-session/`. A naive move that kept the old fixed `".."`
// would have silently resolved to `.claude/skills/.vice-supervisor` instead
// of `<repo>/.vice-supervisor` -- a directory the host-side shell scripts
// (`tools/vice-supervisor.sh`, `tools/vice-pool.sh`) never write to. NOTHING
// would have errored: the container would just read a permanently-empty
// epoch/registry/session directory, and restart detection (and the pool,
// and sessions) would quietly stop working while every command kept
// "succeeding". That failure mode -- a broken invariant with no error
// anywhere -- is exactly the class of bug this codebase keeps rejecting
// elsewhere (see vice.mjs's MachineRestartedError, vice-session.mjs's
// epoch-continuity guard). Do not reintroduce a fixed `".."` (or any other
// relative-to-this-file hop count) in place of this resolver; if the
// directory depth of this skill ever changes again, the ladder below still
// gets the right answer without anyone having to count directories by hand.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, sep } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

// Gates the two "last resort" stderr notes below so a long-running process
// (or a test suite driving this module many times) emits each at most once,
// rather than spamming stderr on every single call.
let warnedEnvOutsideFrom = false;
let warnedNoMarkerFound = false;

/**
 * True iff `child` is `parent` itself or lies inside it, compared as plain
 * resolved path strings (no filesystem access) -- deliberately not a symlink-
 * aware realpath comparison, since CONTAINER_WORKSPACE_PATH and this file's
 * own location are both already resolved, non-symlinked container paths in
 * every case this project runs in.
 */
function isInside(child, parent) {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/**
 * Resolve the repository root. Precedence, in order (D-2):
 *
 *   1. `env.CONTAINER_WORKSPACE_PATH`, when set AND `from` resolves inside
 *      it -- this devcontainer sets it (`.devcontainer/devcontainer.json`'s
 *      `containerEnv`, value `/workspaces/bruce_lee`), and it is the most
 *      explicit signal available.
 *   2. Otherwise, walk up from `from` toward the filesystem root, returning
 *      the first directory containing a `.git` entry (`existsSync` on the
 *      joined path -- matches both a real `.git` directory and a worktree's
 *      `.git` file). This is what keeps the skill correct once exported into
 *      a project that sets no such variable at all.
 *   3. Otherwise, `env.CONTAINER_WORKSPACE_PATH` if it is set at all (just
 *      not containing `from` -- an exported copy of this skill living
 *      outside the mounted workspace the variable names). Silence here would
 *      be exactly the quiet-wrong-answer failure class this file exists to
 *      prevent, so this path emits a one-time stderr note naming both paths.
 *   4. Otherwise, three levels up from `from`, with a one-time stderr note.
 *      Last resort only -- three levels is what `<root>/.claude/skills/<skill>/`
 *      implies, and is the same shape `devcontainer-host-path/hostpath.mjs`
 *      already uses for the same reason.
 */
export function repoRoot({ from = HERE, env = process.env } = {}) {
  const cwp = env.CONTAINER_WORKSPACE_PATH;

  if (cwp && isInside(from, cwp)) {
    return resolve(cwp);
  }

  let dir = resolve(from);
  while (true) {
    if (existsSync(join(dir, ".git"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached the filesystem root -- no .git found anywhere above `from`
    dir = parent;
  }

  if (cwp) {
    if (!warnedEnvOutsideFrom) {
      warnedEnvOutsideFrom = true;
      console.error(
        `warn: CONTAINER_WORKSPACE_PATH is set (${cwp}) but does not contain ${from}, and no .git ` +
          `ancestor was found either -- falling back to CONTAINER_WORKSPACE_PATH itself as the repo root. ` +
          `This is expected for an exported copy of this skill living outside its mounted workspace; if ` +
          `that is not the situation here, the repo root this resolved to may be wrong.`
      );
    }
    return resolve(cwp);
  }

  if (!warnedNoMarkerFound) {
    warnedNoMarkerFound = true;
    const fallback = resolve(from, "..", "..", "..");
    console.error(
      `warn: could not find a .git ancestor above ${from} and CONTAINER_WORKSPACE_PATH is not set -- ` +
        `falling back to three levels up (${fallback}), the shape <root>/.claude/skills/<skill>/ implies. ` +
        `This is a last resort; if it's wrong, set CONTAINER_WORKSPACE_PATH or run from inside a git repo.`
    );
  }
  return resolve(from, "..", "..", "..");
}

/** The one shared directory name every module in this skill reads/writes
 * host-synchronised state through -- `join(repoRoot(...), ".vice-supervisor")`,
 * so the literal directory name also has exactly one definition. */
export function supervisorDir(opts = {}) {
  return join(repoRoot(opts), ".vice-supervisor");
}
