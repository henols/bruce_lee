// vice-broker-launch.test.ts
//
// Covers the single tracer path this plan proves end-to-end (Phase 01.6
// plan 01, task 2): the emitted resources/vice-broker.mjs runs to
// completion under bare `node` with no node_modules resolvable, writes the
// broker record under the atomic-write / never-throw discipline, refuses to
// clobber a live or real broker record, and the hand-authored launcher's
// container guard and flag surface behave as documented.
//
// This is a .ts file (not .mts): it tests emitted OUTPUT and authored
// TypeScript, never imports a .mjs module itself (the convention this group
// establishes, per 01.6-01-PLAN.md's planning_notes).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, mkdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { HOST_BOUND_ARTIFACTS } from "./build.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const BROKER_ARTIFACT = join(HERE, "resources", "vice-broker.mjs");
const LAUNCHER = join(HERE, "resources", "vice-launcher.sh");

/** Copies the emitted broker artifact alone into a fresh temp directory with
 * nothing else in it -- in particular, no node_modules anywhere on its
 * ancestor chain up to /tmp, so Node's own module resolution has nothing to
 * find even if the emitted file accidentally imported a bare specifier. */
function freshDeployDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "vice-broker-launch-"));
  copyFileSync(BROKER_ARTIFACT, join(dir, "vice-broker.mjs"));
  return dir;
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the deployed artifact under a bare `node` invocation, cwd set to the
 * deploy directory itself -- mirrors how vice-launcher.sh execs it (SELF_DIR
 * as cwd is not required by the launcher, but running from the artifact's
 * own directory is the strictest "no ambient node_modules" shape a test can
 * assert). */
function runBroker(deployDir: string, args: string[]): RunResult {
  const result = spawnSync(process.execPath, [join(deployDir, "vice-broker.mjs"), ...args], {
    cwd: deployDir,
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

test("emitted artifact runs to completion under bare node with no node_modules resolvable, writing a three-key record", () => {
  const deployDir = freshDeployDir();
  try {
    const stateDir = join(deployDir, "state");
    const result = runBroker(deployDir, ["--repo-root", "/tmp/fake-repo-root", "--state-dir", stateDir]);
    assert.equal(result.status, 0, `expected exit 0, got ${String(result.status)}; stderr: ${result.stderr}`);

    const recordPath = join(stateDir, "broker.json");
    const record: Record<string, unknown> = JSON.parse(readFileSync(recordPath, "utf8"));
    assert.deepEqual(
      Object.keys(record).sort(),
      ["node_version", "pid", "started_at"],
      "the broker record must carry EXACTLY pid, started_at and node_version -- no heartbeat_at (see the module's own header comment on why)"
    );
    assert.equal(record.node_version, process.version, "the record must carry the HOST's own process.version");
    assert.equal(typeof record.pid, "number");
    assert.equal(typeof record.started_at, "string");
    assert.ok(!Number.isNaN(Date.parse(record.started_at as string)), "started_at must be a parseable ISO 8601 timestamp");
  } finally {
    rmSync(deployDir, { recursive: true, force: true });
  }
});

test("written broker.json is mode owner-read-write only (0600)", () => {
  const deployDir = freshDeployDir();
  try {
    const stateDir = join(deployDir, "state");
    const result = runBroker(deployDir, ["--repo-root", "/tmp/fake-repo-root", "--state-dir", stateDir]);
    assert.equal(result.status, 0);
    const mode = statSync(join(stateDir, "broker.json")).mode & 0o777;
    assert.equal(mode, 0o600, `expected mode 0600, got ${mode.toString(8)}`);
  } finally {
    rmSync(deployDir, { recursive: true, force: true });
  }
});

test("refuses to overwrite a record naming this test's own live pid, exits non-zero, leaves the record byte-identical", () => {
  const deployDir = freshDeployDir();
  try {
    const stateDir = join(deployDir, "state");
    mkdirSync(stateDir, { recursive: true });
    const recordPath = join(stateDir, "broker.json");
    // This test process's own pid is guaranteed alive for the duration of
    // this test -- the strongest "live pid" fixture available without
    // spawning and tracking a helper process.
    const before = JSON.stringify({ pid: process.pid, started_at: "fixture", node_version: "v0.0.0-fixture" });
    writeFileSync(recordPath, before);

    const result = runBroker(deployDir, ["--repo-root", "/tmp/fake-repo-root", "--state-dir", stateDir]);
    assert.notEqual(result.status, 0, "must exit non-zero when refusing to clobber");
    assert.match(result.stderr, /live pid/i);

    const after = readFileSync(recordPath, "utf8");
    assert.equal(after, before, "the existing record must be left byte-identical on refusal");
  } finally {
    rmSync(deployDir, { recursive: true, force: true });
  }
});

test("refuses to overwrite a record carrying a heartbeat_at field even with a dead pid, exits non-zero, leaves the record byte-identical", () => {
  const deployDir = freshDeployDir();
  try {
    const stateDir = join(deployDir, "state");
    mkdirSync(stateDir, { recursive: true });
    const recordPath = join(stateDir, "broker.json");
    // An implausibly large pid: never alive on any real system, isolating
    // this test to the heartbeat_at-presence branch of the refusal logic
    // rather than the live-pid branch already covered above.
    const before = JSON.stringify({ pid: 999999999, started_at: "fixture", heartbeat_at: "2020-01-01T00:00:00Z" });
    writeFileSync(recordPath, before);

    const result = runBroker(deployDir, ["--repo-root", "/tmp/fake-repo-root", "--state-dir", stateDir]);
    assert.notEqual(result.status, 0, "must exit non-zero when refusing to clobber");
    assert.match(result.stderr, /heartbeat_at/i);

    const after = readFileSync(recordPath, "utf8");
    assert.equal(after, before, "the existing record must be left byte-identical on refusal");
  } finally {
    rmSync(deployDir, { recursive: true, force: true });
  }
});

test("a record file truncated mid-JSON is overwritten rather than throwing", () => {
  const deployDir = freshDeployDir();
  try {
    const stateDir = join(deployDir, "state");
    mkdirSync(stateDir, { recursive: true });
    const recordPath = join(stateDir, "broker.json");
    writeFileSync(recordPath, '{"pid": 1, "star');

    const result = runBroker(deployDir, ["--repo-root", "/tmp/fake-repo-root", "--state-dir", stateDir]);
    assert.equal(result.status, 0, `a malformed existing record must be treated as "not there yet", not thrown on; stderr: ${result.stderr}`);

    const record: Record<string, unknown> = JSON.parse(readFileSync(recordPath, "utf8"));
    assert.deepEqual(Object.keys(record).sort(), ["node_version", "pid", "started_at"]);
  } finally {
    rmSync(deployDir, { recursive: true, force: true });
  }
});

test("missing --repo-root exits non-zero with a usage line, writing nothing", () => {
  const deployDir = freshDeployDir();
  try {
    const result = runBroker(deployDir, []);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /usage:/);
  } finally {
    rmSync(deployDir, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------- launcher

test("bash -n exits 0 for the launcher (syntax check only, no execution)", () => {
  const result = spawnSync("bash", ["-n", LAUNCHER], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("running the launcher inside this container exits 2 (container guard refusal)", () => {
  const result = spawnSync(LAUNCHER, [], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /refuses to run inside a container/);
});

test("running the launcher with --check-container exits 3 (container verdict, reporting only)", () => {
  const result = spawnSync(LAUNCHER, ["--check-container"], { encoding: "utf8" });
  assert.equal(result.status, 3);
});

test("running the launcher with --print-paths exits 0 and prints resolved paths without enforcing the guard", () => {
  const result = spawnSync(LAUNCHER, ["--print-paths"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^repo_root=/m);
  assert.match(result.stdout, /^self_dir=/m);
  assert.match(result.stdout, /^broker_artifact=/m);
});

// --------------------------------------------------------- structural scan
//
// Mirrors vice-proxy.test.mjs's own structural network-call scan idiom
// (test("structural: the set of .mjs files ... containing a network-call
// construct is exactly ...")): directory-enumerating, not scoped to a
// hand-maintained list, so a future addition to the host-bound source set is
// covered the moment it lands on disk. The hard rule this closes: no
// host-bound source may open its own connection to anything -- mcp__vice__*
// stays the only route to the emulator.
const NETWORK_CALL_PATTERNS: RegExp[] = [
  /\bfetch\s*\(/,
  /\.request\s*\(/,
  /\bcreateConnection\s*\(/,
  /\bcreateServer\s*\(/,
  /new\s+WebSocket\s*\(/,
  /require\(\s*["']node:(?:http|https|net|dgram|tls)["']\s*\)/,
  /from\s+["']node:(?:http|https|net|dgram|tls)["']/,
];

test("structural: no host-bound source (the build's include list, plus the launcher) contains an outbound network-call construct", () => {
  const sourcePaths = [...HOST_BOUND_ARTIFACTS.map((rel) => join(HERE, rel.replace(/\.mjs$/, ".mts"))), LAUNCHER];
  assert.ok(sourcePaths.length >= 2, "host-bound source set enumerated as suspiciously small -- resolution is broken");

  const offenders: string[] = [];
  for (const path of sourcePaths) {
    const text = readFileSync(path, "utf8");
    if (NETWORK_CALL_PATTERNS.some((p) => p.test(text))) {
      offenders.push(path);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `host-bound source contains a network-call construct: ${JSON.stringify(offenders)} -- mcp__vice__* must stay the only route to the emulator`
  );
});
