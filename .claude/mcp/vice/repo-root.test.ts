// node:test coverage of repo-root.ts's repoRoot() ladder, the path-anchor
// hop count it falls back to as a last resort, and the resources/-versus-
// tools/ path-agreement regression -- rescued from vice-pool.test.mjs
// (quick-260730-oga Task 2, quick-260731-p8a) before that file is deleted
// wholesale in plan 04 (D-02). repoRoot() itself SURVIVES D-02/D-05: it is
// the one shared path resolver every remaining module in this tree
// (vice.mjs, vice-probe.ts, install-resources.ts's caller) derives its
// state directory through. Nothing here imports vice-pool.mjs or
// vice-session.mjs -- both are deleted in plan 04.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { repoRoot } from "./repo-root.ts";
import { installResources } from "./install-resources.ts";

const execFileP = promisify(execFile);
const REPO_ROOT_MODULE_URL = new URL("./repo-root.ts", import.meta.url).href;
const VICE_MODULE_URL = new URL("./vice.ts", import.meta.url).href;

/** Parse `key=value` lines (one per line, as `--print-paths` emits) into a
 * plain object. */
function parseKeyValueLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.trim().split("\n")) {
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

// ============================================================================
// repoRoot() ladder (D-2) and the last-resort path-anchor hop count
// (quick-260731-p8a). Both drive repoRoot({ from, env }) injection directly
// and need no other module -- carried over unchanged from vice-pool.test.mjs.
// ============================================================================

test("repoRoot() ladder: a .git ancestor resolves with no env set; a containing CONTAINER_WORKSPACE_PATH wins over a NEARER .git; a non-containing CONTAINER_WORKSPACE_PATH loses to the .git walk", () => {
  const outer = mkdtempSync(join(tmpdir(), "reporoot-"));
  mkdirSync(join(outer, ".git"));
  const inner = join(outer, "sub", "deeper");
  mkdirSync(inner, { recursive: true });

  // 1. No env set at all -> the .git walk finds `outer`.
  assert.equal(repoRoot({ from: inner, env: {} }), outer);

  // 2. A CONTAINER_WORKSPACE_PATH containing `from` wins over an even
  //    NEARER .git ancestor -- the env var is checked FIRST and wins
  //    whenever `from` resolves inside it, regardless of what a marker walk
  //    would have found.
  const envRoot = mkdtempSync(join(tmpdir(), "reporoot-env-"));
  const envInner = join(envRoot, "a", "b");
  mkdirSync(envInner, { recursive: true });
  mkdirSync(join(envInner, ".git")); // nearer than envRoot -- must still lose
  assert.equal(repoRoot({ from: envInner, env: { CONTAINER_WORKSPACE_PATH: envRoot } }), envRoot);

  // 3. A CONTAINER_WORKSPACE_PATH that does NOT contain `from` loses to the
  //    .git walk (the ambiguous, one-time-stderr-note branch) -- silenced
  //    here since only the returned path is under test.
  const unrelated = mkdtempSync(join(tmpdir(), "reporoot-unrelated-"));
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(repoRoot({ from: inner, env: { CONTAINER_WORKSPACE_PATH: unrelated } }), outer);
  } finally {
    console.error = originalError;
  }
});

test("repoRoot() last-resort fallback (quick-260731-p8a, path-anchor regression): climbs THREE levels from a <root>/.claude/mcp/<server> path, not four", () => {
  // Deliberately has no .git ancestor and no CONTAINER_WORKSPACE_PATH, so the
  // ladder falls all the way through to branch 4 -- the fixed-hop last
  // resort this move touched. The relocated tree is one level shallower than
  // the old <root>/.claude/skills/<skill>/scripts shape (scripts/ was
  // flattened away), so a naive move that kept the old four-level hop would
  // land on <tmpdir>/.claude/mcp instead of <tmpdir> itself, which is exactly
  // the silent-wrong-directory failure this file's header forbids.
  //
  // THIS ASSERTION IS ALSO WHY authored TypeScript stayed FLAT in
  // .claude/mcp/vice/ (siblings of resources/) rather than moving into a
  // src/ subdirectory during the 01.6.1 conversion: doing so would add a
  // FOURTH level and silently break this exact hop count again. A future
  // reader proposing that move should read this comment before doing it.
  const root = mkdtempSync(join(tmpdir(), "reporoot-threelevel-"));
  const moduleDir = join(root, ".claude", "mcp", "vice");
  mkdirSync(moduleDir, { recursive: true });

  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(repoRoot({ from: moduleDir, env: {} }), root);
  } finally {
    console.error = originalError;
  }
});

// ============================================================================
// Path agreement (D-2, D-3, quick-260730-oga Task 2, narrowed for D-02):
// proves the Node side (repo-root.mjs's supervisorDir(), plus vice.mjs's
// EPOCH_FILE) and the shell side (tools/vice-supervisor.sh's, tools/vice-
// broker.sh's and tools/vice-launcher.sh's --print-paths) resolve the SAME
// .vice-supervisor directory.
//
// NARROWED from the original vice-pool.test.mjs version: that version also
// cross-checked vice-pool.sh and Node's poolDir()/sessionFilePath() (from
// vice-pool.mjs/vice-session.mjs). Both modules and vice-pool.sh are deleted
// per D-02 -- this rewrite compares the THREE scripts that survive:
// vice-supervisor.sh, vice-broker.sh (the bash broker; its own --print-paths
// still reports pool_dir=, the SAME .vice-supervisor directory, by shared
// default) and vice-launcher.sh (created in plan 01). Every structural
// property of the original regression is kept: the VICE_-prefixed env strip,
// the fresh-child-process Node evaluation, the self-sufficient
// installResources() call, the .git-walk-only variant, and the final
// not-under-.claude assertion.
// ============================================================================

test("path agreement (D-3, D-6, THE regression this task exists to catch): supervisor_dir === pool_dir (from the bash broker) === supervisorDir() === dirname(EPOCH_FILE), the resources/ and tools/ copies of the supervisor, the bash broker and the launcher agree with each other, and the agreed path is not under .claude", async () => {
  // Self-sufficient about the deployed copies (quick-260730-q4b): this makes
  // the test pass in a fresh clone that has never run any skill .mjs file,
  // rather than depending on whether the runner happened to set
  // VICE_SKIP_RESOURCE_INSTALL=1 first. installResources() never overwrites
  // an already-present target, so calling it here is safe even when the real
  // tools/ copies already exist (and were hand-verified moments ago).
  installResources({ root: repoRoot() });

  const supervisorScript = join(repoRoot(), "tools", "vice-supervisor.sh");
  const brokerScript = join(repoRoot(), "tools", "vice-broker.sh");
  const launcherScript = join(repoRoot(), "tools", "vice-launcher.sh");
  const resourcesSupervisorScript = join(repoRoot(), ".claude", "mcp", "vice", "resources", "vice-supervisor.sh");
  const resourcesBrokerScript = join(repoRoot(), ".claude", "mcp", "vice", "resources", "vice-broker.sh");
  const resourcesLauncherScript = join(repoRoot(), ".claude", "mcp", "vice", "resources", "vice-launcher.sh");
  for (const p of [supervisorScript, brokerScript, launcherScript, resourcesSupervisorScript, resourcesBrokerScript, resourcesLauncherScript]) {
    assert.ok(existsSync(p), `expected ${p} to exist (resolved via repoRoot())`);
  }

  // Strip every VICE_* env var so neither the shell scripts nor the Node
  // child below can be pointed anywhere by a sibling test's leftover
  // override -- this test asserts on the TRUE no-configuration defaults.
  const cleanEnv = { ...process.env };
  for (const k of Object.keys(cleanEnv)) {
    if (k.startsWith("VICE_")) delete cleanEnv[k];
  }

  const { stdout: supOut } = await execFileP("bash", [supervisorScript, "--print-paths"], { env: cleanEnv });
  const { stdout: brokerOut } = await execFileP("bash", [brokerScript, "--print-paths"], { env: cleanEnv });
  const { stdout: launcherOut } = await execFileP("bash", [launcherScript, "--print-paths"], { env: cleanEnv });
  const { stdout: resourcesSupOut } = await execFileP("bash", [resourcesSupervisorScript, "--print-paths"], { env: cleanEnv });
  const { stdout: resourcesBrokerOut } = await execFileP("bash", [resourcesBrokerScript, "--print-paths"], { env: cleanEnv });
  const { stdout: resourcesLauncherOut } = await execFileP("bash", [resourcesLauncherScript, "--print-paths"], { env: cleanEnv });
  const supVals = parseKeyValueLines(supOut);
  const brokerVals = parseKeyValueLines(brokerOut);
  const launcherVals = parseKeyValueLines(launcherOut);

  // D-6: the resources/ copy (the tracked source of truth) and the deployed
  // tools/ copy must print byte-identical --print-paths output per script --
  // the regression a repo-root derivation that is wrong from one of the two
  // locations would introduce.
  assert.equal(resourcesSupOut, supOut, "resources/vice-supervisor.sh and tools/vice-supervisor.sh --print-paths must be byte-identical");
  assert.equal(resourcesBrokerOut, brokerOut, "resources/vice-broker.sh and tools/vice-broker.sh --print-paths must be byte-identical");
  // The launcher's --print-paths output is NOT expected to be byte-identical
  // between the two copies: self_dir/broker_artifact are deliberately
  // resolved as SIBLINGS of whichever copy is actually running (see vice-
  // launcher.sh's own header comment -- a launcher run from resources/ must
  // launch the resources/ broker artifact, not silently reach across to a
  // possibly-stale tools/ copy). Only repo_root, the one key derived purely
  // from repoRoot() rather than from the running script's own location, must
  // agree between the two copies.
  const resourcesLauncherVals = parseKeyValueLines(resourcesLauncherOut);
  assert.equal(
    resourcesLauncherVals.repo_root,
    launcherVals.repo_root,
    "resources/vice-launcher.sh and tools/vice-launcher.sh must agree on repo_root even though self_dir/broker_artifact deliberately differ"
  );

  // Node-side values computed in a FRESH child process, not via this test
  // file's own already-imported modules -- immune to env mutation or
  // module-load ordering from sibling tests sharing this process. Narrowed
  // from the original: poolDir() (vice-pool.mjs) and sessionFilePath()
  // (vice-session.mjs) are gone with D-02; supervisorDir() (repo-root.mjs)
  // and EPOCH_FILE (vice.mjs) are the two Node-side derivations that survive.
  const nodeSrc = `
    import { supervisorDir } from ${JSON.stringify(REPO_ROOT_MODULE_URL)};
    import { EPOCH_FILE } from ${JSON.stringify(VICE_MODULE_URL)};
    import { dirname } from "node:path";
    console.log(JSON.stringify({
      supervisorDir: supervisorDir(),
      epochDir: dirname(EPOCH_FILE),
    }));
  `;
  const { stdout: nodeOut } = await execFileP(process.execPath, ["--input-type=module", "-e", nodeSrc], {
    env: cleanEnv,
  });
  const nodeLines = nodeOut.trim().split("\n").filter(Boolean);
  const nodeVals = JSON.parse(nodeLines[nodeLines.length - 1]);

  // vice-broker.sh's own pool_dir defaults to the SAME $REPO_ROOT/.vice-supervisor
  // directory as vice-supervisor.sh's supervisor_dir (both read/write the one
  // shared state directory) -- confirmed by reading both scripts' own
  // `VICE_POOL_DIR="${VICE_POOL_DIR:-$REPO_ROOT/.vice-supervisor}"` /
  // `VICE_SUPERVISOR_DIR="${VICE_SUPERVISOR_DIR:-$REPO_ROOT/.vice-supervisor}"` defaults.
  assert.equal(brokerVals.pool_dir, supVals.supervisor_dir, "the bash broker's pool_dir must equal the supervisor's supervisor_dir");
  assert.equal(nodeVals.supervisorDir, supVals.supervisor_dir, "Node supervisorDir() must equal the shell's supervisor_dir");
  assert.equal(nodeVals.epochDir, supVals.supervisor_dir, "dirname(EPOCH_FILE) must equal the shell's supervisor_dir");
  // The launcher has no supervisor_dir/pool_dir concept of its own (it only
  // resolves repo_root, self_dir and broker_artifact) -- its repo_root must
  // still agree with the supervisor's, proving all three scripts share one
  // repoRoot() derivation even though only two of them also share a state
  // directory.
  assert.equal(launcherVals.repo_root, supVals.repo_root, "the launcher's repo_root must agree with the supervisor's repo_root");
  assert.ok(
    !supVals.supervisor_dir.includes(".claude"),
    `the agreed directory must not sit under .claude -- got ${supVals.supervisor_dir} (the exact regression a naive move would introduce)`
  );
});

test("path agreement without CONTAINER_WORKSPACE_PATH (D-6): the .git-walk branch -- the ONLY branch that ever runs on the real host -- still agrees between resources/ and tools/", async () => {
  const resourcesSupervisorScript = join(repoRoot(), ".claude", "mcp", "vice", "resources", "vice-supervisor.sh");
  const supervisorScript = join(repoRoot(), "tools", "vice-supervisor.sh");

  const hostEnv = { ...process.env };
  for (const k of Object.keys(hostEnv)) {
    if (k.startsWith("VICE_")) delete hostEnv[k];
  }
  delete hostEnv.CONTAINER_WORKSPACE_PATH;

  const { stdout: resourcesOut } = await execFileP("bash", [resourcesSupervisorScript, "--print-paths"], { env: hostEnv });
  const { stdout: toolsOut } = await execFileP("bash", [supervisorScript, "--print-paths"], { env: hostEnv });
  assert.equal(resourcesOut, toolsOut, "with CONTAINER_WORKSPACE_PATH unset, resources/ and tools/ must still agree via the .git walk");
  assert.match(parseKeyValueLines(resourcesOut).repo_root, /bruce_lee$/, "the .git walk must still land on the real repo root");
});
