// node:test structural coverage of the tracked host shell scripts that
// survive D-02 -- rescued from vice-pool.test.mjs (quick-260801-qpq Task 3)
// before that file is deleted wholesale in plan 04. vice-pool.sh itself is
// deleted per D-02 and dropped from this file entirely; vice-supervisor.sh
// and the bash broker (resources/vice-broker.sh) keep the assertions
// vice-pool.sh used to share, and the launcher (resources/vice-launcher.sh,
// created in plan 01) joins the shared script list. Plan 03 extends this
// file with the one-shell-script allowlist and the ignore-set parity gate.
//
// Nothing here imports vice-pool.mjs or vice-session.mjs, or drives the real
// emulator -- every process spawned below is a stub (`/bin/sleep`) or the
// script itself run with `--dry-run`/`--print-paths`/`-n`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { DEPLOY_MANIFEST_NAME, resourceEntries } from "./install-resources.mjs";

const execFileP = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));

// REPO-ROOT RESOLUTION, DELIBERATELY NOT `repoRoot()` FROM THE SIBLING
// `repo-root.mjs`: that resolver's documented precedence checks
// `CONTAINER_WORKSPACE_PATH` FIRST and returns it whenever this file's
// location resolves inside it -- which, in THIS devcontainer, is
// unconditionally true regardless of which git worktree is actually
// executing. A parallel executor running inside an isolated worktree would
// have `.gitignore`/`git ls-files` below silently redirected to the SHARED
// devcontainer mount's main checkout instead of the worktree's own tree --
// exactly the quiet-wrong-answer class this project's own conventions
// reject elsewhere (see vice-mcp-selector-docs.test.mjs's identical
// rationale). `findRepoRoot()` is the plain `.git`-marker walk ONLY (no
// env-var short-circuit), so this gate always inspects the tree it is
// actually running from, worktree or not.
function findRepoRoot(from) {
  let dir = from;
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`findRepoRoot: no .git ancestor found above ${from}`);
    }
    dir = parent;
  }
}

const REPO_ROOT = findRepoRoot(HERE);

/** Poll `predicate` (a zero-arg function returning truthy/falsy) to a
 * bounded deadline rather than sleeping a fixed duration -- checkpoint/frame
 * synchronisation, never wall-clock delay (this project's own stack
 * pattern). Returns the predicate's own truthy result, or null on timeout. */
async function waitFor(predicate, { timeoutMs = 8000, pollMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}

// The one shared list of tracked host scripts surviving D-02 -- plan 03 and
// 01.6.2 shrink THIS array rather than hunting individual assertions as
// scripts fold into the TypeScript broker.
const SURVIVING_HOST_SCRIPTS = ["vice-supervisor.sh", "vice-broker.sh", "vice-launcher.sh"];

// ============================================================================
// quick-260801-qpq Task 3: vice-supervisor.sh terminates what it spawned on
// SIGINT, SIGTERM, SIGHUP and on any other exit path -- not just
// SIGINT/SIGTERM as before. It registers a two-entry-point trap: a signal
// entry point (INT/TERM/HUP) and an EXIT entry point that captures $? as its
// first statement and re-exits with it, so the crash-loop give-up path's
// exit 4 survives unchanged.
// ============================================================================

test("vice-supervisor.sh: a SIGHUP terminates the running child before the supervisor itself exits", async () => {
  const supervisorScript = join(HERE, "resources", "vice-supervisor.sh");
  const supervisorDir = mkdtempSync(join(tmpdir(), "vice-supervisor-sighup-"));
  const epochFile = join(supervisorDir, "epoch.json");
  let child;
  try {
    child = spawn("bash", [supervisorScript], {
      env: {
        ...process.env,
        VICE_SUPERVISOR_ALLOW_CONTAINER: "1",
        VICE_SUPERVISOR_DIR: supervisorDir,
        VICE_BIN: "/bin/sleep",
        VICE_ARGS: "300",
      },
      stdio: "ignore",
    });

    const epoch = await waitFor(() => {
      if (!existsSync(epochFile)) return null;
      try {
        const rec = JSON.parse(readFileSync(epochFile, "utf8"));
        return typeof rec.pid === "number" ? rec : null;
      } catch {
        return null;
      }
    });
    assert.ok(epoch, "the supervisor must write an epoch record naming its child's pid");
    const childPid = epoch.pid;

    const childAliveBefore = await waitFor(() => {
      try {
        process.kill(childPid, 0);
        return true;
      } catch {
        return false;
      }
    });
    assert.ok(childAliveBefore, "the sleep child must be alive before the signal");

    child.kill("SIGHUP");

    const childGone = await waitFor(() => {
      try {
        process.kill(childPid, 0);
        return false;
      } catch {
        return true;
      }
    });
    assert.ok(childGone, "SIGHUP must terminate the running child before the supervisor exits");

    const supervisorExited = await waitFor(() => child.exitCode !== null);
    assert.ok(supervisorExited, "the supervisor itself must exit after handling SIGHUP");
    assert.equal(child.exitCode, 0, "a signal-triggered shutdown is a clean, deliberate exit -- status 0");
  } finally {
    if (child && child.exitCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
    rmSync(supervisorDir, { recursive: true, force: true });
  }
});

test("structural: vice-supervisor.sh and the bash broker (vice-broker.sh) register EXIT and HUP alongside INT and TERM; vice-launcher.sh execs into node instead, so signals reach the broker process directly with no trap of its own needed", () => {
  for (const name of SURVIVING_HOST_SCRIPTS) {
    const src = readFileSync(join(HERE, "resources", name), "utf8");

    if (name === "vice-launcher.sh") {
      // vice-launcher.sh's final action is `exec node "$BROKER_ARTIFACT" ...`
      // -- exec REPLACES the process image in place (same pid), so INT/TERM/
      // HUP/EXIT are delivered straight to the node process with no bash
      // trap in between. Asserting a trap here would assert something the
      // script deliberately does not do; the real invariant is the exec.
      assert.match(src, /\bexec\s+node\b/, `${name} must exec into node so signal delivery passes through unchanged`);
      continue;
    }

    assert.match(src, /trap\s+\S+\s+EXIT\b|trap\s+\S+[^\n]*\bEXIT\b/, `${name} must register a trap on EXIT`);
    assert.match(src, /trap\s+\S+[^\n]*\bHUP\b/, `${name} must register a trap naming HUP`);
    assert.match(src, /trap\s+\S+[^\n]*\bINT\b/, `${name} must still register a trap naming INT`);
    assert.match(src, /trap\s+\S+[^\n]*\bTERM\b/, `${name} must still register a trap naming TERM`);
  }
});

test("structural: bash -n exits 0 for every surviving tracked host script", async () => {
  for (const name of SURVIVING_HOST_SCRIPTS) {
    await execFileP("bash", ["-n", join(HERE, "resources", name)]);
  }
});

// ============================================================================
// Plan 03, Task 2, gate 1: `.gitignore` and the deployed set are in two-way
// parity. A one-way check would let a stale entry survive a deletion (plan
// 04's removal of vice-pool.sh must be able to shrink the ignore list with
// it); this gate enforces BOTH directions.
// ============================================================================

/** The deployed-path lines in `.gitignore` -- every line under the "deployed
 * copies of .claude/mcp/vice/resources/" block starts with `/tools/`.
 * Filtering on that prefix (rather than reading the whole file) keeps this
 * gate from tripping on unrelated entries elsewhere in .gitignore
 * (.vice-supervisor/, node_modules/, ...). */
function deployedIgnoreLines(gitignoreText) {
  return gitignoreText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("/tools/"));
}

test("`.gitignore` and install-resources.mjs's deployed set (resourceEntries() + the deploy manifest) are in two-way parity", () => {
  const gitignoreText = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");
  const ignoreLines = deployedIgnoreLines(gitignoreText);
  const ignoreSet = new Set(ignoreLines);

  const expectedLines = new Set([
    ...resourceEntries().map((entry) => `/tools/${entry}`),
    `/tools/${DEPLOY_MANIFEST_NAME}`,
  ]);

  // Direction 1: every current resource (and the manifest) has an ignore line.
  for (const expected of expectedLines) {
    assert.ok(
      ignoreSet.has(expected),
      `.gitignore is missing ${expected} -- a deployed artifact with no ignore line shows up as ` +
        "untracked noise in git status in whatever commit happens to follow. Add the line to " +
        ".gitignore's deployed-path block (see install-resources.mjs's resourceEntries())."
    );
  }

  // Direction 2: every deployed-path ignore line still names something real.
  for (const line of ignoreLines) {
    assert.ok(
      expectedLines.has(line),
      `.gitignore's ${line} names neither a current resources/ entry nor the deployment manifest -- ` +
        "a stale ignore line silently outlives the deleted artifact it used to cover. Remove it from " +
        ".gitignore's deployed-path block."
    );
  }
});

// ============================================================================
// Plan 03, Task 2, gate 2: the one-shell-script structural check, using the
// RIGHT predicate. C6's own phrasing ("find . -name '*.sh' ... excluding
// gitignored tools/") is wrong: tools/ is a MIXED directory holding both
// gitignored deployment output (the .sh copies this same file's other tests
// read straight out of resources/) AND tracked reverse-engineering tooling
// (d64-parse.mjs, diff-images.mjs, watch-loads.mjs, recovery-schema.mjs,
// releases.mjs and their tests) -- a directory-exclusion predicate cannot
// tell those apart and would pass a gate that should fail. `git ls-files`
// enumerates TRACKED files instead, which is the right question: deployed
// copies under the real (untracked, gitignored) tools/ and any stray
// `.claude/worktrees/` copy are excluded structurally, not by a hand-
// maintained exclusion list.
// ============================================================================

// Named constant per plan 03's instruction: this array SHRINKS as scripts
// retire -- by one in plan 04 (vice-pool.sh's deletion), down to a single
// entry once Phase 01.6.2 folds the remaining bash daemons into the
// TypeScript broker. Every change to it must be a deliberate edit with a
// commit behind it, not a silent widening to make a red gate pass.
const EXPECTED_TRACKED_SHELL_SCRIPTS = [
  ".claude/mcp/vice/resources/lib/container-guard.sh",
  ".claude/mcp/vice/resources/lib/repo-root.sh",
  ".claude/mcp/vice/resources/vice-broker.sh",
  ".claude/mcp/vice/resources/vice-launcher.sh",
  ".claude/mcp/vice/resources/vice-supervisor.sh",
].sort();

test("structural: git ls-files enumerates the tracked shell-script set as exactly EXPECTED_TRACKED_SHELL_SCRIPTS plus the container-provisioning scripts", async () => {
  const { stdout } = await execFileP("git", ["ls-files", "--", "*.sh"], { cwd: REPO_ROOT });
  const tracked = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // Drop the container-provisioning directory -- .devcontainer/'s scripts
  // are a separate concern (image setup, not the vice MCP deployment
  // contract this gate polices) and are expected to exist alongside the
  // allowlist, not be folded into it.
  const nonDevcontainer = tracked.filter((p) => !p.startsWith(".devcontainer/"));

  assert.deepEqual(
    [...nonDevcontainer].sort(),
    EXPECTED_TRACKED_SHELL_SCRIPTS,
    "the tracked shell-script set (excluding .devcontainer/) has drifted from EXPECTED_TRACKED_SHELL_SCRIPTS -- " +
      "this array shrinks deliberately as scripts retire (plan 04, then Phase 01.6.2); update it only as part of " +
      "the commit that actually retires the script, never to silently paper over an unexpected drift."
  );

  const devcontainerScripts = tracked.filter((p) => p.startsWith(".devcontainer/"));
  assert.equal(
    devcontainerScripts.length,
    2,
    `expected exactly 2 container-provisioning shell scripts under .devcontainer/, got ${devcontainerScripts.length}: ${JSON.stringify(devcontainerScripts)}`
  );
});
