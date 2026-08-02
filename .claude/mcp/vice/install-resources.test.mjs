// node:test coverage of install-resources.mjs's deploy-on-first-use
// installer -- rescued from vice-pool.test.mjs (quick-260730-q4b Task 2,
// quick-260731-p8a) before that file is deleted wholesale in plan 04.
// install-resources.mjs SURVIVES D-02/D-05, and this is the ONLY test file
// its guarantees have ever had -- criterion 9 rests on it, and plan 03
// modifies install-resources.mjs and needs this file's red/green signal to
// do so safely.
//
// Every test here drives installResources()/ensureResourcesInstalled()
// against a SYNTHETIC temp root (mkdtempSync) so no test ever writes into
// the real repo's tools/ -- matching vice-pool.test.mjs's own existing
// temp-directory idiom. Nothing here imports vice-pool.mjs or
// vice-session.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, statSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  RESOURCES_DIR,
  installTargetDir,
  resourceEntries,
  installResources,
  ensureResourcesInstalled,
} from "./install-resources.mjs";

const execFileP = promisify(execFile);

test("RESOURCES_DIR (quick-260731-p8a, path-anchor regression): points at the MODULE DIRECTORY's resources/, not a scripts/-relative directory", () => {
  // A wrong hop count here is SILENT, because ensureResourcesInstalled()
  // swallows every error by contract -- see install-resources.mjs's header.
  // Asserting the exact entry set (not just "no throw") is what makes this
  // non-vacuous: a directory that resolves to somewhere with NO resources/
  // subdirectory makes readdirSync() throw loudly inside resourceEntries(),
  // so this test dies instead of quietly comparing two empty lists.
  assert.ok(
    RESOURCES_DIR.endsWith(join("mcp", "vice", "resources")),
    `expected RESOURCES_DIR to end with mcp/vice/resources, got ${RESOURCES_DIR}`
  );
  assert.ok(
    !RESOURCES_DIR.split(sep).includes("scripts"),
    `expected RESOURCES_DIR to NOT pass through a scripts/ segment, got ${RESOURCES_DIR}`
  );
  // Derived from resourceEntries() itself rather than a hardcoded list of
  // filenames -- so this test never needs an edit when a resource is added
  // or removed (plan 03's prune, plan 04's deletion of vice-pool.sh). Its
  // ONLY job is proving the anchor points somewhere non-empty and shaped
  // right, per the two structural assertions above -- a wrong hop count
  // still fails loudly there, not here.
  const entries = resourceEntries();
  assert.ok(entries.length > 0, "expected at least one deployed resource under RESOURCES_DIR");
  assert.ok(entries.includes("vice-supervisor.sh"), "expected vice-supervisor.sh to still be a tracked resource");
  assert.ok(entries.includes("vice-launcher.sh"), "expected vice-launcher.sh (plan 01) to be a tracked resource");
});

test("installResources(): install-when-missing -- every file under resources/ lands at <root>/tools/<same relative path>", () => {
  const root = mkdtempSync(join(tmpdir(), "vice-install-missing-"));
  const entries = resourceEntries();
  const result = installResources({ root, log: () => {} });
  assert.deepEqual([...result.installed].sort(), [...entries].sort());
  assert.equal(result.skipped.length, 0);
  assert.equal(result.diverged.length, 0);
  assert.equal(result.failed.length, 0);
  for (const entry of entries) {
    assert.ok(existsSync(join(installTargetDir(root), entry)), `expected ${entry} to be deployed`);
  }
});

test("installResources(): no-op-when-present -- a second run reports nothing installed and leaves mtimes untouched", () => {
  const root = mkdtempSync(join(tmpdir(), "vice-install-noop-"));
  installResources({ root, log: () => {} });
  const target = join(installTargetDir(root), "vice-supervisor.sh");
  const mtimeBefore = statSync(target).mtimeMs;

  const result = installResources({ root, log: () => {} });

  assert.equal(result.installed.length, 0, "expected nothing installed on a second run");
  assert.ok(result.skipped.includes("vice-supervisor.sh"), "expected the already-present entry to be reported skipped");
  assert.equal(statSync(target).mtimeMs, mtimeBefore, "mtime must be untouched by a no-op run");
});

test("installResources(): no-overwrite-when-diverged -- a hand-edited target is reported diverged and left byte-for-byte unchanged", () => {
  const root = mkdtempSync(join(tmpdir(), "vice-install-diverged-"));
  installResources({ root, log: () => {} });
  const target = join(installTargetDir(root), "vice-supervisor.sh");
  writeFileSync(target, "# edited by hand\n");

  const result = installResources({ root, log: () => {} });

  assert.ok(result.diverged.includes("vice-supervisor.sh"), "expected the hand-edited entry to be reported diverged");
  assert.equal(result.installed.length, 0, "a divergence must never be auto-overwritten");
  assert.equal(readFileSync(target, "utf8"), "# edited by hand\n", "the hand edit must survive byte-for-byte");
});

test("installResources({ force: true }): restores a diverged target to the resources/ content", () => {
  const root = mkdtempSync(join(tmpdir(), "vice-install-force-"));
  installResources({ root, log: () => {} });
  const target = join(installTargetDir(root), "vice-supervisor.sh");
  const original = readFileSync(target);
  writeFileSync(target, "# edited by hand\n");

  const result = installResources({ root, force: true, log: () => {} });

  assert.ok(result.installed.includes("vice-supervisor.sh"), "expected the forced overwrite to be reported as installed");
  assert.ok(readFileSync(target).equals(original), "forced install must restore the exact resources/ content");
});

test("installResources(): executable bit preserved -- both launchers (including the one plan 01 created) arrive executable, lib/container-guard.sh non-executable like its tracked source", () => {
  const root = mkdtempSync(join(tmpdir(), "vice-install-modes-"));
  installResources({ root, log: () => {} });
  const supervisor = join(installTargetDir(root), "vice-supervisor.sh");
  const launcher = join(installTargetDir(root), "vice-launcher.sh");
  const guard = join(installTargetDir(root), "lib", "container-guard.sh");

  assert.ok(statSync(supervisor).mode & 0o111, "vice-supervisor.sh must be deployed executable");
  assert.ok(statSync(launcher).mode & 0o111, "vice-launcher.sh (plan 01's launcher) must be deployed executable -- it is exec'd directly");
  assert.equal(statSync(guard).mode & 0o111, 0, "lib/container-guard.sh must NOT be executable, matching its tracked (sourced-only) source mode");
});

test("installResources(): lib/ deployed -- both lib/container-guard.sh and lib/repo-root.sh land under <root>/tools/lib/", () => {
  const root = mkdtempSync(join(tmpdir(), "vice-install-lib-"));
  installResources({ root, log: () => {} });
  assert.ok(existsSync(join(installTargetDir(root), "lib", "container-guard.sh")));
  assert.ok(existsSync(join(installTargetDir(root), "lib", "repo-root.sh")));
});

test("installResources(): a real install writes its host-launch instructions to stderr only, never stdout (D-4)", async () => {
  // Fresh process, not this test file's own already-imported module -- the
  // stdout/stderr split is only meaningful observed from outside the
  // process that's doing the writing.
  const root = mkdtempSync(join(tmpdir(), "vice-install-stderr-"));
  const src = `
    import { installResources } from ${JSON.stringify(new URL("./install-resources.mjs", import.meta.url).href)};
    installResources({ root: ${JSON.stringify(root)} });
  `;
  const { stdout, stderr } = await execFileP(process.execPath, ["--input-type=module", "-e", src]);
  assert.equal(stdout, "", "expected a real install to write an empty stdout");
  assert.match(stderr, /container/i, "expected the container refusal to be named on stderr");
  assert.match(stderr, /--check-container/, "expected the guard diagnostic flag to be named on stderr");
  assert.match(stderr, /ctrl-c/i, "expected the clean-interrupt instruction to be named on stderr");
});

test("ensureResourcesInstalled(): fire-once-per-process -- calling it twice in one process with the target deleted in between does NOT recreate it", async () => {
  const root = mkdtempSync(join(tmpdir(), "vice-install-fireonce-"));
  const src = `
    import { ensureResourcesInstalled } from ${JSON.stringify(new URL("./install-resources.mjs", import.meta.url).href)};
    import { existsSync, rmSync } from "node:fs";
    import { join } from "node:path";
    const root = ${JSON.stringify(root)};
    const target = join(root, "tools", "vice-supervisor.sh");
    ensureResourcesInstalled({ root });
    console.log("first:" + existsSync(target));
    rmSync(target);
    ensureResourcesInstalled({ root });
    console.log("second:" + existsSync(target));
  `;
  const env = { ...process.env };
  delete env.VICE_SKIP_RESOURCE_INSTALL;
  const { stdout } = await execFileP(process.execPath, ["--input-type=module", "-e", src], { env });
  assert.match(stdout, /first:true/);
  assert.match(stdout, /second:false/, "the second call must NOT recreate the deleted file -- fire-once means once per process, not once per file");
});

test("ensureResourcesInstalled(): env opt-out -- VICE_SKIP_RESOURCE_INSTALL=1 makes it do nothing at all", async () => {
  const root = mkdtempSync(join(tmpdir(), "vice-install-skipenv-"));
  const src = `
    import { ensureResourcesInstalled } from ${JSON.stringify(new URL("./install-resources.mjs", import.meta.url).href)};
    import { existsSync } from "node:fs";
    import { join } from "node:path";
    ensureResourcesInstalled({ root: ${JSON.stringify(root)} });
    console.log(existsSync(join(${JSON.stringify(root)}, "tools", "vice-supervisor.sh")));
  `;
  const env = { ...process.env, VICE_SKIP_RESOURCE_INSTALL: "1" };
  const { stdout } = await execFileP(process.execPath, ["--input-type=module", "-e", src], { env });
  assert.match(stdout.trim(), /^false$/, "VICE_SKIP_RESOURCE_INSTALL=1 must prevent any deployment at all");
});

test("installResources(): never throws when the target root is unwritable -- it warns per entry through `log` instead (D-3)", () => {
  const root = mkdtempSync(join(tmpdir(), "vice-install-unwritable-"));
  chmodSync(root, 0o500); // read+execute, no write -- mkdirSync/copyFileSync must fail for every entry
  const warnings = [];
  try {
    let result;
    assert.doesNotThrow(() => {
      result = installResources({ root, log: (msg) => warnings.push(msg) });
    });
    assert.ok(result.failed.length > 0, "expected every entry to fail against an unwritable root");
    assert.ok(warnings.length > 0, "expected at least one warning logged instead of a thrown exception");
  } finally {
    chmodSync(root, 0o700); // restore so the temp dir can be cleaned up
  }
});
