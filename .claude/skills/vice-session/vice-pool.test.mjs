// node:test coverage of tools/vice-pool.mjs's lease layer -- the coordination
// primitive that lets N supervised VICE instances run in parallel without two
// container-side callers ever taking the same instance (D-3). Same
// mkdtempSync temp-directory pattern and stub-injection style as
// tools/recover.test.mjs -- no new test framework, no new runtime
// dependencies.
//
// Everything here is driven through a SYNTHETIC registry written by hand into
// a temp VICE_POOL_DIR; tools/vice-pool.sh (the host launcher) is never
// involved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

import { acquire, readRegistry, instanceFor, refreshLease, DEFAULT_PORT, poolHealth, diagnose, leaseInfo } from "./vice-pool.mjs";
import { call, useInstance, formatToolsOutput } from "./vice.mjs";
import { repoRoot } from "./repo-root.mjs";
import { probeInstance, probeAll, PROBE_TOOL, DEFAULT_PROBE_TIMEOUT_MS } from "./vice-probe.mjs";

const execFileP = promisify(execFile);
const MODULE_URL = new URL("./vice-pool.mjs", import.meta.url).href;
const VICE_SESSION_MODULE_URL = new URL("./vice-session.mjs", import.meta.url).href;
const VICE_MODULE_URL = new URL("./vice.mjs", import.meta.url).href;
const REPO_ROOT_MODULE_URL = new URL("./repo-root.mjs", import.meta.url).href;
const VICE_CLI = fileURLToPath(VICE_MODULE_URL);

const tmpPoolDir = () => mkdtempSync(join(tmpdir(), "vice-pool-"));

function writeRegistry(dir, ports) {
  mkdirSync(dir, { recursive: true });
  const nowIso = new Date().toISOString();
  writeFileSync(
    join(dir, "registry.json"),
    JSON.stringify(
      {
        version: 1,
        written_by: "test",
        written_at: nowIso,
        pool_pid: 1,
        base_port: Math.min(...ports),
        size: ports.length,
        instances: ports.map((port) => ({
          port,
          url: `http://127.0.0.1:${port}/mcp`,
          epoch_file: join(dir, String(port), "epoch.json"),
          supervisor_dir: join(dir, String(port)),
          supervisor_log: `${port}/supervisor.log`,
          supervisor_pid: 424242,
          started_at: nowIso,
          dry_run: false,
        })),
      },
      null,
      2
    )
  );
}

const leasesDirOf = (dir) => join(dir, "leases");
const leasePathOf = (dir, port) => join(leasesDirOf(dir), `${port}.lease`);

// ------------------------------------------------------- readRegistry / instanceFor

test("readRegistry: a well-formed registry reports present:true with the port list", () => {
  const dir = tmpPoolDir();
  writeRegistry(dir, [6700, 6701, 6702]);
  const r = readRegistry(join(dir, "registry.json"));
  assert.equal(r.present, true);
  assert.deepEqual([...r.ports].sort((a, b) => a - b), [6700, 6701, 6702]);
});

test("instanceFor: derives url/epochFile purely from the validated port, never from a registry-provided path", () => {
  const dir = tmpPoolDir();
  const inst = instanceFor(6690, dir);
  assert.equal(inst.port, 6690);
  assert.equal(inst.epochFile, join(dir, "6690", "epoch.json"));
  assert.match(inst.url, /6690\/mcp$/);
});

// ------------------------------------------------------------ no registry (D-3)

test("no registry: acquire() returns port 6510, pooled:false, the non-port-scoped default epoch file, and writes no lease file", async () => {
  const dir = tmpPoolDir();
  const l = await acquire({ dir, probe: false });
  assert.equal(l.port, DEFAULT_PORT);
  assert.equal(l.pooled, false);
  assert.equal(l.epochFile, join(dir, "epoch.json"));
  assert.equal(l.leasePath, null);
  assert.equal(existsSync(leasesDirOf(dir)), false, "no registry -- must not even create a leases dir");
  await assert.doesNotReject(l.release());
});

// ------------------------------------------------------------- hostile registry (T-mef-01)

test("hostile registry: malformed shapes with no valid port all degrade to the 6510 fallback", async () => {
  const hostileBodies = [
    "not valid json {{{",
    JSON.stringify({ version: 1 }),
    JSON.stringify({ instances: "not-an-array" }),
    JSON.stringify({ instances: [{ port: "not-a-number" }] }),
    JSON.stringify({ instances: [{ port: 999999 }] }),
    JSON.stringify({ instances: [{ port: -1 }] }),
    JSON.stringify({ instances: [{ noPortField: true }] }),
  ];
  for (const body of hostileBodies) {
    const dir = tmpPoolDir();
    writeFileSync(join(dir, "registry.json"), body);
    const l = await acquire({ dir, probe: false });
    assert.equal(l.port, DEFAULT_PORT, `expected fallback for body: ${body}`);
    assert.equal(l.pooled, false);
    assert.equal(l.epochFile, join(dir, "epoch.json"));
    await l.release();
  }
});

test("hostile registry: a traversal epoch_file field is inert -- epochFile is always derived from the validated port", async () => {
  const dir = tmpPoolDir();
  writeFileSync(
    join(dir, "registry.json"),
    JSON.stringify({ instances: [{ port: 6691, epoch_file: "../../../etc/passwd" }] })
  );
  const l = await acquire({ dir, probe: false });
  assert.equal(l.port, 6691);
  assert.equal(l.pooled, true);
  assert.equal(l.epochFile, join(dir, "6691", "epoch.json"));
  assert.ok(!l.epochFile.includes("etc/passwd"));
  await l.release();
});

// -------------------------------------------------------- in-process exclusivity

test("in-process exclusivity: three sequential acquires against a 3-port registry return three distinct ports; a fourth with timeoutMs:0 throws naming each port and its holder pid", async () => {
  const dir = tmpPoolDir();
  writeRegistry(dir, [6710, 6711, 6712]);
  const l1 = await acquire({ dir, timeoutMs: 0, probe: false });
  const l2 = await acquire({ dir, timeoutMs: 0, probe: false });
  const l3 = await acquire({ dir, timeoutMs: 0, probe: false });
  const ports = [l1.port, l2.port, l3.port];
  assert.equal(new Set(ports).size, 3);
  assert.deepEqual([...ports].sort((a, b) => a - b), [6710, 6711, 6712]);

  await assert.rejects(acquire({ dir, timeoutMs: 0, probe: false }), (err) => {
    for (const p of [6710, 6711, 6712]) assert.match(err.message, new RegExp(String(p)));
    assert.match(err.message, new RegExp(String(process.pid)));
    return true;
  });

  await l1.release();
  await l2.release();
  await l3.release();
});

// ------------------------------------------------------------------ blocking acquire

test("blocking acquire: with timeoutMs set and a lease released mid-wait, a waiting acquire picks it up rather than failing", async () => {
  const dir = tmpPoolDir();
  writeRegistry(dir, [6720]);
  const l1 = await acquire({ dir, timeoutMs: 0, probe: false });
  const waiterPromise = acquire({ dir, timeoutMs: 3000, pollMs: 100, probe: false });
  await new Promise((r) => setTimeout(r, 300));
  await l1.release();
  const l2 = await waiterPromise;
  assert.equal(l2.port, 6720);
  await l2.release();
});

// --------------------------------------------------------------- stale reclaim (pid)

test("stale reclaim by pid: a hand-written lease whose holder_host matches this host and whose holder_pid is dead is reclaimed", async () => {
  const dir = tmpPoolDir();
  writeRegistry(dir, [6730]);
  const { stdout } = await execFileP(process.execPath, ["-e", "console.log(process.pid)"]);
  const deadPid = Number(stdout.trim());

  mkdirSync(leasesDirOf(dir), { recursive: true });
  writeFileSync(
    leasePathOf(dir, 6730),
    JSON.stringify({
      port: 6730,
      holder_pid: deadPid,
      holder_host: hostname(),
      token: "stale-pid-token",
      acquired_at: new Date().toISOString(),
      argv: "test",
    })
  );

  const l = await acquire({ dir, timeoutMs: 0, probe: false });
  assert.equal(l.port, 6730);
  await l.release();
});

// --------------------------------------------------------------- stale reclaim (age)

test("stale reclaim by age: a lease newer in pid terms but older than maxLeaseAgeMs is reclaimed", async () => {
  const dir = tmpPoolDir();
  writeRegistry(dir, [6740]);
  mkdirSync(leasesDirOf(dir), { recursive: true });
  writeFileSync(
    leasePathOf(dir, 6740),
    JSON.stringify({
      port: 6740,
      holder_pid: process.pid, // alive -- but on a DIFFERENT host, so pid-liveness must not matter
      holder_host: "some-other-host-xyz",
      token: "stale-age-token",
      acquired_at: new Date(Date.now() - 10000).toISOString(),
      argv: "test",
    })
  );

  const l = await acquire({ dir, timeoutMs: 0, maxLeaseAgeMs: 5000, probe: false });
  assert.equal(l.port, 6740);
  await l.release();
});

// ---------------------------------------------------------- cross-namespace safety

test("cross-namespace safety: a lease whose holder_host is a DIFFERENT hostname is never pid-reclaimed, only age-reclaimed", async () => {
  const dir = tmpPoolDir();
  writeRegistry(dir, [6750]);
  mkdirSync(leasesDirOf(dir), { recursive: true });
  writeFileSync(
    leasePathOf(dir, 6750),
    JSON.stringify({
      port: 6750,
      holder_pid: 999999, // almost certainly dead on THIS host too -- must not matter
      holder_host: "totally-different-host",
      token: "cross-ns-token",
      acquired_at: new Date().toISOString(), // fresh -- not age-reclaimable either
      argv: "test",
    })
  );

  await assert.rejects(acquire({ dir, timeoutMs: 0, probe: false }), /6750/);
});

// ------------------------------------------------------------------- malformed lease

test("malformed lease file: reclaimed, with a warning, rather than blocking the port forever", async () => {
  const dir = tmpPoolDir();
  writeRegistry(dir, [6760]);
  mkdirSync(leasesDirOf(dir), { recursive: true });
  writeFileSync(leasePathOf(dir, 6760), "{not valid json at all");

  const originalError = console.error;
  let warned = false;
  console.error = (...args) => {
    warned = true;
    originalError.apply(console, args);
  };
  let l;
  try {
    l = await acquire({ dir, timeoutMs: 0, probe: false });
  } finally {
    console.error = originalError;
  }
  assert.equal(l.port, 6760);
  assert.equal(warned, true, "a malformed lease file must warn on stderr, not silently wedge the port");
  await l.release();
});

// ----------------------------------------------------------------------- token safety

test("token safety: release() on a lease that was reaped and reacquired by another holder leaves the new holder's lease alone; release() is idempotent", async () => {
  const dir = tmpPoolDir();
  writeRegistry(dir, [6770]);
  const l1 = await acquire({ dir, timeoutMs: 0, probe: false });

  // Simulate l1 being reaped by an age-based reclaim without l1 itself ever
  // calling release(): force its own on-disk lease to look ancient.
  const rec = JSON.parse(readFileSync(l1.leasePath, "utf8"));
  writeFileSync(l1.leasePath, JSON.stringify({ ...rec, acquired_at: new Date(0).toISOString() }));

  const l2 = await acquire({ dir, timeoutMs: 0, maxLeaseAgeMs: 1000, probe: false });
  assert.equal(l2.port, 6770);

  await l1.release(); // l1's token no longer matches what's on disk -- must be a no-op
  assert.equal(existsSync(l2.leasePath), true, "l1's stale release must not delete l2's live lease");

  await l2.release();
  await assert.doesNotReject(l1.release()); // idempotent
  await assert.doesNotReject(l2.release()); // idempotent
});

// -------------------------------------------------------- cross-process exclusivity

test("cross-process exclusivity: 8 concurrent racers against a 2-port registry produce exactly 2 successes on 2 distinct ports", async () => {
  const dir = tmpPoolDir();
  writeRegistry(dir, [6780, 6781]);

  const racerSrc = `
    import { acquire } from ${JSON.stringify(MODULE_URL)};
    const dir = process.env.VICE_POOL_DIR;
    try {
      const l = await acquire({ dir, timeoutMs: 0, probe: false });
      console.log(JSON.stringify({ ok: true, port: l.port }));
      // Hold for the whole race window -- a fast racer's own exit-time
      // release must not hand its port to a later racer and inflate the
      // success count.
      await new Promise((r) => setTimeout(r, 1500));
    } catch (e) {
      console.log(JSON.stringify({ ok: false, error: e.message }));
    }
  `;

  const racers = Array.from({ length: 8 }, () =>
    execFileP(process.execPath, ["--input-type=module", "-e", racerSrc], {
      env: { ...process.env, VICE_POOL_DIR: dir },
    })
  );
  const outcomes = await Promise.all(
    racers.map(async (p) => {
      const { stdout } = await p;
      const lines = stdout.trim().split("\n").filter(Boolean);
      return JSON.parse(lines[lines.length - 1]);
    })
  );

  const successes = outcomes.filter((o) => o.ok);
  const ports = new Set(successes.map((o) => o.port));
  assert.equal(successes.length, 2, `expected exactly 2 successes, got ${JSON.stringify(outcomes)}`);
  assert.equal(ports.size, 2);
  assert.deepEqual([...ports].sort((a, b) => a - b), [6780, 6781]);
});

// ------------------------------------------------------------- deny-list survives

test("deny-list survives redirection: call('vice_disk_list') after useInstance() still rejects with the permanently-forbidden message, before any network request", async () => {
  useInstance({ port: 9999, url: "http://127.0.0.1:9999/mcp", epochFile: "/tmp/does-not-matter" });
  await assert.rejects(call("vice_disk_list", {}), /permanently forbidden/);
});

// ============================================================================
// Session layer (D-1, D-2, quick-260730-nh5): tools/vice-session.mjs's
// `kind:"session"` pool lease, driven end-to-end through `tools/vice.mjs`'s
// CLI. Every test drives a temp VICE_POOL_DIR (a synthetic registry, no host
// launcher) and a temp VICE_SESSION_FILE -- no emulator involved anywhere in
// this section.
// ============================================================================

test("session cross-process survival (D-1, THE load-bearing test): a session acquired in one child process is visible to a second, separate child process sharing only env", async () => {
  const dir = tmpPoolDir();
  writeRegistry(dir, [6810]);
  const sessionFile = join(dir, "session.json");
  const env = { ...process.env, VICE_POOL_DIR: dir, VICE_SESSION_FILE: sessionFile, VICE_POOL_PROBE: "0" };

  const { stdout: acquireOut } = await execFileP(process.execPath, [VICE_CLI, "session", "acquire"], { env });
  const acquireMatch = acquireOut.match(/session acquired: (\S+) on port (\d+)/);
  assert.ok(acquireMatch, `unexpected acquire output: ${acquireOut}`);
  const [, sessionId, port] = acquireMatch;
  assert.equal(port, "6810");

  // A SEPARATE child process, sharing only VICE_POOL_DIR/VICE_SESSION_FILE in
  // env -- nothing an `export` inside the first child could have carried.
  const { stdout: statusOut } = await execFileP(process.execPath, [VICE_CLI, "session", "status"], { env });
  assert.match(statusOut, new RegExp(`session ${sessionId}: port ${port}`));

  await execFileP(process.execPath, [VICE_CLI, "session", "release"], { env });
});

test("session lease survives its creator's exit: the lease file remains after the acquiring child exits, decodes with kind:session and a parseable expires_at", async () => {
  const dir = tmpPoolDir();
  writeRegistry(dir, [6811]);
  const sessionFile = join(dir, "session.json");
  const env = { ...process.env, VICE_POOL_DIR: dir, VICE_SESSION_FILE: sessionFile, VICE_POOL_PROBE: "0" };

  await execFileP(process.execPath, [VICE_CLI, "session", "acquire"], { env });

  const lp = leasePathOf(dir, 6811);
  assert.equal(existsSync(lp), true, "lease file must still exist after the acquiring process exited");
  const rec = JSON.parse(readFileSync(lp, "utf8"));
  assert.equal(rec.kind, "session");
  assert.ok(Number.isFinite(Date.parse(rec.expires_at)), "expires_at must be a parseable date");

  await execFileP(process.execPath, [VICE_CLI, "session", "release"], { env });
});

test("a second acquire() cannot take a port held by a live session lease -- session and process leases share one lease namespace", async () => {
  const dir = tmpPoolDir();
  writeRegistry(dir, [6812]);
  const l = await acquire({ dir, kind: "session", ttlMs: 60000, probe: false });
  assert.equal(l.pooled, true);
  await assert.rejects(acquire({ dir, timeoutMs: 0, probe: false }), /6812/);
  await l.release();
});

test("session lease is NOT pid-reclaimable (D-2): a confirmably-dead holder_pid does not free it, but the same fixture with kind omitted (a process lease) is reclaimed", async () => {
  const dir = tmpPoolDir();
  writeRegistry(dir, [6813]);
  const { stdout } = await execFileP(process.execPath, ["-e", "console.log(process.pid)"]);
  const deadPid = Number(stdout.trim());
  mkdirSync(leasesDirOf(dir), { recursive: true });

  const sessionRec = {
    port: 6813,
    holder_pid: deadPid,
    holder_host: hostname(),
    token: "dead-pid-session-token",
    acquired_at: new Date().toISOString(),
    argv: "test",
    kind: "session",
    expires_at: new Date(Date.now() + 60000).toISOString(),
  };
  writeFileSync(leasePathOf(dir, 6813), JSON.stringify(sessionRec));
  await assert.rejects(acquire({ dir, timeoutMs: 0, probe: false }), /6813/, "a session lease must not be pid-reclaimed");

  const processRec = { ...sessionRec, token: "dead-pid-process-token" };
  delete processRec.kind;
  delete processRec.expires_at;
  writeFileSync(leasePathOf(dir, 6813), JSON.stringify(processRec));
  const l = await acquire({ dir, timeoutMs: 0, probe: false });
  assert.equal(l.port, 6813, "the same dead-pid fixture as a plain process lease must still be pid-reclaimed");
  await l.release();
});

test("session lease outlives maxLeaseAgeMs: a two-hour-old but unexpired session lease is not stolen by the age-based reclaim rule", async () => {
  const dir = tmpPoolDir();
  writeRegistry(dir, [6814]);
  mkdirSync(leasesDirOf(dir), { recursive: true });
  writeFileSync(
    leasePathOf(dir, 6814),
    JSON.stringify({
      port: 6814,
      holder_pid: process.pid,
      holder_host: hostname(),
      token: "long-session-token",
      acquired_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      argv: "test",
      kind: "session",
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    })
  );
  await assert.rejects(acquire({ dir, timeoutMs: 0, maxLeaseAgeMs: 1000, probe: false }), /6814/);
});

test("expired session lease IS reclaimed: acquire() succeeds once expires_at has passed", async () => {
  const dir = tmpPoolDir();
  writeRegistry(dir, [6815]);
  mkdirSync(leasesDirOf(dir), { recursive: true });
  writeFileSync(
    leasePathOf(dir, 6815),
    JSON.stringify({
      port: 6815,
      holder_pid: process.pid,
      holder_host: hostname(),
      token: "expired-session-token",
      acquired_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      argv: "test",
      kind: "session",
      expires_at: new Date(Date.now() - 1000).toISOString(),
    })
  );
  const l = await acquire({ dir, timeoutMs: 0, probe: false });
  assert.equal(l.port, 6815);
  await l.release();
});

test("malformed session lease (kind session, unparseable expires_at) is reclaimed with a stderr warning, not wedged forever", async () => {
  const dir = tmpPoolDir();
  writeRegistry(dir, [6816]);
  mkdirSync(leasesDirOf(dir), { recursive: true });
  writeFileSync(
    leasePathOf(dir, 6816),
    JSON.stringify({
      port: 6816,
      holder_pid: process.pid,
      holder_host: hostname(),
      token: "malformed-session-token",
      acquired_at: new Date().toISOString(),
      argv: "test",
      kind: "session",
      expires_at: "not-a-date",
    })
  );
  const originalError = console.error;
  let warned = false;
  console.error = (...args) => {
    warned = true;
    originalError.apply(console, args);
  };
  let l;
  try {
    l = await acquire({ dir, timeoutMs: 0, probe: false });
  } finally {
    console.error = originalError;
  }
  assert.equal(l.port, 6816);
  assert.equal(warned, true, "a malformed session lease must warn on stderr, not silently wedge the port");
  await l.release();
});

test("no session file at all: resolveInstance() leaves the default port 6510 active and writes no lease anywhere (D-1, hard requirement)", async () => {
  const dir = tmpPoolDir();
  const sessionFile = join(dir, "does-not-exist", "session.json");
  const src = `
    import { resolveInstance } from ${JSON.stringify(VICE_SESSION_MODULE_URL)};
    import { activeInstance } from ${JSON.stringify(VICE_MODULE_URL)};
    resolveInstance();
    console.log(JSON.stringify(activeInstance()));
  `;
  const { stdout } = await execFileP(process.execPath, ["--input-type=module", "-e", src], {
    env: { ...process.env, VICE_POOL_DIR: dir, VICE_SESSION_FILE: sessionFile },
  });
  const lines = stdout.trim().split("\n").filter(Boolean);
  const inst = JSON.parse(lines[lines.length - 1]);
  assert.equal(inst.port, DEFAULT_PORT);
  assert.equal(inst.pooled, false);
  assert.equal(existsSync(leasesDirOf(dir)), false, "no session file -- must not even create a leases dir");
});

test("session release frees the port: after the release child exits, both the lease file and the session file are gone", async () => {
  const dir = tmpPoolDir();
  writeRegistry(dir, [6817]);
  const sessionFile = join(dir, "session.json");
  const env = { ...process.env, VICE_POOL_DIR: dir, VICE_SESSION_FILE: sessionFile, VICE_POOL_PROBE: "0" };

  await execFileP(process.execPath, [VICE_CLI, "session", "acquire"], { env });
  assert.equal(existsSync(sessionFile), true);
  assert.equal(existsSync(leasePathOf(dir, 6817)), true);

  await execFileP(process.execPath, [VICE_CLI, "session", "release"], { env });
  assert.equal(existsSync(sessionFile), false);
  assert.equal(existsSync(leasePathOf(dir, 6817)), false);
});

test("untrusted session file (T-nh5-01): a string or negative port is reported unusable; a traversal epoch_file is never opened -- the epoch path used is derived from the validated port only", async () => {
  const dir = tmpPoolDir();
  const sessionFile = join(dir, "session.json");
  const { readSession } = await import("./vice-session.mjs");

  for (const bad of [
    JSON.stringify({ session_id: "x", port: "6510", expires_at: new Date().toISOString() }),
    JSON.stringify({ session_id: "x", port: -1, expires_at: new Date().toISOString() }),
    JSON.stringify({ session_id: "x", port: 999999, expires_at: new Date().toISOString() }),
    "not valid json {{{",
  ]) {
    writeFileSync(sessionFile, bad);
    const s = readSession(sessionFile);
    assert.equal(s.present, false, `expected present:false for: ${bad}`);
  }

  writeFileSync(
    sessionFile,
    JSON.stringify({
      session_id: "y",
      port: 6818,
      expires_at: new Date(Date.now() + 60000).toISOString(),
      pooled: true,
      epoch_file: "../../../etc/passwd",
    })
  );
  const s2 = readSession(sessionFile);
  assert.equal(s2.present, true);
  assert.equal(s2.port, 6818);
  assert.ok(!s2.epochFile.includes("etc/passwd"), "the hostile epoch_file string must never be opened or reflected");
  assert.ok(s2.epochFile.includes("6818"), "the epoch path actually used must be derived from the validated port");
});

// ============================================================================
// TTL refresh-on-use, the cross-invocation epoch guard, and the tool-listing
// formatter (D-2, D-3, quick-260730-nh5 Task 2). Same posture as the Task 1
// block above: everything offline and deterministic, no emulator involved.
// ============================================================================

function writeEpochFile(path, epoch) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ epoch, spawned_at: new Date().toISOString(), pid: 1 }) + "\n");
}

/** Hand-write a session.json fixture with full control over every field --
 * readSession() derives url/epochFile from port+pooled itself, so this only
 * needs to supply the fields readSession() actually trusts. */
function writeSessionFixture(sessionFile, { port, pooled = true, epochAtAcquire = { present: false, epoch: null }, expiresAt, leasePath = null, leaseToken = null, ttlMs = 1800000, sessionId } = {}) {
  writeFileSync(
    sessionFile,
    JSON.stringify({
      session_id: sessionId || `test-session-${port}`,
      port,
      url: `http://127.0.0.1:${port}/mcp`,
      epoch_file: "should-never-be-opened",
      pooled,
      lease_path: leasePath,
      lease_token: leaseToken,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
      ttl_ms: ttlMs,
      epoch_at_acquire: epochAtAcquire,
    })
  );
}

function withPoolDirEnv(dir, fn) {
  const prev = process.env.VICE_POOL_DIR;
  process.env.VICE_POOL_DIR = dir;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prev === undefined) delete process.env.VICE_POOL_DIR;
      else process.env.VICE_POOL_DIR = prev;
    });
}

test("TTL refreshed on each use (D-2): a session in continuous use never approaches its own expires_at", async () => {
  const dir = tmpPoolDir();
  writeRegistry(dir, [6825]);
  const sessionFile = join(dir, "session.json");
  const env = { ...process.env, VICE_POOL_DIR: dir, VICE_SESSION_FILE: sessionFile, VICE_SESSION_TTL_MS: "1000", VICE_POOL_PROBE: "0" };

  await execFileP(process.execPath, [VICE_CLI, "session", "acquire"], { env });
  const leaseFirst = JSON.parse(readFileSync(leasePathOf(dir, 6825), "utf8"));
  const sessionFirst = JSON.parse(readFileSync(sessionFile, "utf8"));

  await new Promise((r) => setTimeout(r, 400)); // a fraction of the 1000ms TTL

  // Drive resolveInstance() directly -- exactly what every ping/call
  // invocation does at the top of main() -- in a SEPARATE process, so this
  // stays fully offline (no live network round trip needed to prove the
  // refresh side effect) while still being a genuinely separate invocation.
  const resolveSrc = `
    import { resolveInstance } from ${JSON.stringify(VICE_SESSION_MODULE_URL)};
    resolveInstance();
  `;
  await execFileP(process.execPath, ["--input-type=module", "-e", resolveSrc], { env });

  const leaseSecond = JSON.parse(readFileSync(leasePathOf(dir, 6825), "utf8"));
  const sessionSecond = JSON.parse(readFileSync(sessionFile, "utf8"));
  assert.ok(
    Date.parse(leaseSecond.expires_at) > Date.parse(leaseFirst.expires_at),
    "the lease file's expires_at must move forward on use"
  );
  assert.ok(
    Date.parse(sessionSecond.expires_at) > Date.parse(sessionFirst.expires_at),
    "the session file's expires_at must move forward on use"
  );

  await execFileP(process.execPath, [VICE_CLI, "session", "release"], { env });
});

test("refresh is token-checked (T-nh5-04): refreshLease() against a lease with a mismatched on-disk token returns false and leaves the file byte-identical", async () => {
  const dir = tmpPoolDir();
  writeRegistry(dir, [6826]);
  const l = await acquire({ dir, kind: "session", ttlMs: 60000, probe: false });
  const before = readFileSync(l.leasePath, "utf8");

  const ok = refreshLease(l.leasePath, "not-the-real-token", 120000);
  assert.equal(ok, false);
  const after = readFileSync(l.leasePath, "utf8");
  assert.equal(after, before, "a token-mismatched refresh must leave the lease file byte-identical");

  await l.release();
});

test("epoch continuity, hard refusal (D-1): a session whose epoch_at_acquire differs from the live epoch file refuses fast, with no MCP call attempted", async () => {
  const dir = tmpPoolDir();
  const sessionFile = join(dir, "session.json");
  const port = 6819; // nothing listens here -- the point is that no network call is ever attempted
  const epochFile = join(dir, String(port), "epoch.json");
  writeEpochFile(epochFile, 4);
  writeSessionFixture(sessionFile, {
    port,
    pooled: true,
    epochAtAcquire: { present: true, epoch: 3 },
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  const env = { ...process.env, VICE_POOL_DIR: dir, VICE_SESSION_FILE: sessionFile, VICE_MCP_TIMEOUT_MS: "5000" };

  const start = Date.now();
  try {
    await execFileP(process.execPath, [VICE_CLI, "ping"], { env });
    assert.fail("expected ping to exit non-zero against a session with a proven epoch mismatch");
  } catch (e) {
    const elapsedMs = Date.now() - start;
    assert.ok(elapsedMs < 3000, `expected a fast refusal well inside the transport timeout, took ${elapsedMs}ms`);
    assert.match(e.stderr, /restarted/);
    assert.match(e.stderr, /3/);
    assert.match(e.stderr, /4/);
  }
});

test("epoch continuity, same value: baseline and current epoch equal -> no warning, no refusal, resolution proceeds", async () => {
  const dir = tmpPoolDir();
  const sessionFile = join(dir, "session.json");
  const port = 6820;
  writeEpochFile(join(dir, String(port), "epoch.json"), 3);
  writeSessionFixture(sessionFile, {
    port,
    pooled: true,
    epochAtAcquire: { present: true, epoch: 3 },
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });

  await withPoolDirEnv(dir, async () => {
    const { resolveInstance } = await import("./vice-session.mjs");
    const originalError = console.error;
    let warned = false;
    console.error = () => {
      warned = true;
    };
    let result;
    try {
      result = resolveInstance({ sessionPath: sessionFile });
    } finally {
      console.error = originalError;
    }
    assert.equal(result.source, "session");
    assert.equal(warned, false, "matching epochs must not produce any warning");
  });
});

test("epoch continuity, warn-only: an ambiguous signal (only one side has evidence) warns but still proceeds, in both directions", async () => {
  const dir = tmpPoolDir();
  const sessionFile = join(dir, "session.json");

  await withPoolDirEnv(dir, async () => {
    const { resolveInstance } = await import("./vice-session.mjs");
    const originalError = console.error;

    // baseline present, current absent (supervisor stopped mid-session)
    writeSessionFixture(sessionFile, {
      port: 6821,
      pooled: true,
      epochAtAcquire: { present: true, epoch: 5 },
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    let warnedA = false;
    console.error = () => {
      warnedA = true;
    };
    let resultA;
    try {
      resultA = resolveInstance({ sessionPath: sessionFile });
    } finally {
      console.error = originalError;
    }
    assert.equal(resultA.source, "session");
    assert.equal(warnedA, true, "baseline-present/current-absent must warn");

    // baseline absent, current present (a supervisor started mid-session)
    const portB = 6822;
    writeEpochFile(join(dir, String(portB), "epoch.json"), 1);
    writeSessionFixture(sessionFile, {
      port: portB,
      pooled: true,
      epochAtAcquire: { present: false, epoch: null },
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    let warnedB = false;
    console.error = () => {
      warnedB = true;
    };
    let resultB;
    try {
      resultB = resolveInstance({ sessionPath: sessionFile });
    } finally {
      console.error = originalError;
    }
    assert.equal(resultB.source, "session");
    assert.equal(warnedB, true, "baseline-absent/current-present must warn");
  });
});

test("expired session refuses rather than silently falling back: a ping child exits non-zero and names both recovery verbs", async () => {
  const dir = tmpPoolDir();
  const sessionFile = join(dir, "session.json");
  writeSessionFixture(sessionFile, {
    port: 6823,
    pooled: false,
    epochAtAcquire: { present: false, epoch: null },
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  const env = { ...process.env, VICE_POOL_DIR: dir, VICE_SESSION_FILE: sessionFile, VICE_MCP_TIMEOUT_MS: "5000" };

  try {
    await execFileP(process.execPath, [VICE_CLI, "ping"], { env });
    assert.fail("expected ping to exit non-zero for an expired session");
  } catch (e) {
    assert.match(e.stderr, /session release/);
    assert.match(e.stderr, /session acquire/);
  }
});

test("VICE_MCP_URL beats a session file, with a stderr warning naming the session that was ignored", async () => {
  const dir = tmpPoolDir();
  const sessionFile = join(dir, "session.json");
  writeSessionFixture(sessionFile, {
    port: 6824,
    pooled: false,
    epochAtAcquire: { present: false, epoch: null },
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    sessionId: "test-session-env-override",
  });

  await withPoolDirEnv(dir, async () => {
    const prevUrl = process.env.VICE_MCP_URL;
    process.env.VICE_MCP_URL = "http://127.0.0.1:1/mcp";
    try {
      const { resolveInstance } = await import("./vice-session.mjs");
      const originalError = console.error;
      let warning = "";
      console.error = (msg) => {
        warning += msg;
      };
      let result;
      try {
        result = resolveInstance({ sessionPath: sessionFile });
      } finally {
        console.error = originalError;
      }
      assert.equal(result.source, "env");
      assert.match(warning, /VICE_MCP_URL/);
      assert.match(warning, /test-session-env-override/);
    } finally {
      if (prevUrl === undefined) delete process.env.VICE_MCP_URL;
      else process.env.VICE_MCP_URL = prevUrl;
    }
  });
});

test("tool listing marks the forbidden tool: a synthetic tools/list payload containing vice_disk_list renders it FORBIDDEN, never as a plain callable option, with no network reached", () => {
  const payload = {
    tools: [
      { name: "vice_ping", description: "Ping the server" },
      { name: "vice_disk_list", description: "List files on a disk" },
    ],
  };
  const listing = formatToolsOutput(payload);
  const diskListLine = listing.split("\n").find((l) => l.startsWith("vice_disk_list"));
  assert.ok(diskListLine, "vice_disk_list must appear in the listing");
  assert.match(diskListLine, /FORBIDDEN/);
  assert.notEqual(diskListLine.trim(), "vice_disk_list", "must never be rendered as a bare, callable name");

  const schemaView = formatToolsOutput(payload, { query: "vice_disk_list" });
  assert.match(schemaView, /FORBIDDEN/);
});

test("tools <name> renders a matching tool's full input schema: parameter names, types, required-ness, enum and default", () => {
  const payload = {
    tools: [
      {
        name: "vice_memory_read",
        description: "Read memory",
        inputSchema: {
          type: "object",
          properties: {
            address: { type: "string" },
            size: { type: "number" },
            bank: { type: "string", enum: ["ram", "rom"], default: "ram" },
          },
          required: ["address", "size"],
        },
      },
    ],
  };
  const out = formatToolsOutput(payload, { query: "vice_memory_read" });
  assert.match(out, /address: string \[required\]/);
  assert.match(out, /size: number \[required\]/);
  assert.match(out, /bank: string \[optional\].*enum: ram\|rom.*default: "ram"/);
});

// ============================================================================
// Path agreement (D-2, D-3, quick-260730-oga Task 2): proves the Node side
// (repo-root.mjs's supervisorDir(), plus everything derived from it) and the
// shell side (tools/vice-supervisor.sh, tools/vice-pool.sh's --print-paths)
// resolve the SAME .vice-supervisor directory. This is the regression a
// naive move of these modules into .claude/skills/vice-session/ would
// otherwise have introduced silently -- see repo-root.mjs's header comment.
// ============================================================================

/** Parse `key=value` lines (one per line, as --print-paths emits) into a
 * plain object. */
function parseKeyValueLines(text) {
  const out = {};
  for (const line of text.trim().split("\n")) {
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

test("path agreement (D-3, THE regression this task exists to catch): supervisor_dir === pool_dir === supervisorDir() === dirname(EPOCH_FILE) === poolDir() === dirname(sessionFilePath()), and the agreed path is not under .claude", async () => {
  // Resolved through repoRoot() itself -- a missing script here means
  // repoRoot() picked the wrong repo root, not a false pass; existsSync
  // makes that loud (ENOENT-shaped) rather than a silent script-not-found.
  const supervisorScript = join(repoRoot(), "tools", "vice-supervisor.sh");
  const poolScript = join(repoRoot(), "tools", "vice-pool.sh");
  assert.ok(existsSync(supervisorScript), `expected ${supervisorScript} to exist (resolved via repoRoot())`);
  assert.ok(existsSync(poolScript), `expected ${poolScript} to exist (resolved via repoRoot())`);

  // Strip every VICE_* env var so neither the shell scripts nor the Node
  // child below can be pointed anywhere by a sibling test's leftover
  // override -- this test asserts on the TRUE no-configuration defaults.
  const cleanEnv = { ...process.env };
  for (const k of Object.keys(cleanEnv)) {
    if (k.startsWith("VICE_")) delete cleanEnv[k];
  }

  const { stdout: supOut } = await execFileP("bash", [supervisorScript, "--print-paths"], { env: cleanEnv });
  const { stdout: poolOut } = await execFileP("bash", [poolScript, "--print-paths"], { env: cleanEnv });
  const supVals = parseKeyValueLines(supOut);
  const poolVals = parseKeyValueLines(poolOut);

  // Node-side values computed in a FRESH child process, not via this test
  // file's own already-imported modules -- immune to env mutation or
  // module-load ordering from sibling tests sharing this process (several of
  // which set process.env.VICE_POOL_DIR / VICE_MCP_URL directly).
  const nodeSrc = `
    import { supervisorDir } from ${JSON.stringify(REPO_ROOT_MODULE_URL)};
    import { EPOCH_FILE } from ${JSON.stringify(VICE_MODULE_URL)};
    import { poolDir } from ${JSON.stringify(MODULE_URL)};
    import { sessionFilePath } from ${JSON.stringify(VICE_SESSION_MODULE_URL)};
    import { dirname } from "node:path";
    console.log(JSON.stringify({
      supervisorDir: supervisorDir(),
      epochDir: dirname(EPOCH_FILE),
      poolDir: poolDir(),
      sessionDir: dirname(sessionFilePath()),
    }));
  `;
  const { stdout: nodeOut } = await execFileP(process.execPath, ["--input-type=module", "-e", nodeSrc], {
    env: cleanEnv,
  });
  const nodeLines = nodeOut.trim().split("\n").filter(Boolean);
  const nodeVals = JSON.parse(nodeLines[nodeLines.length - 1]);

  assert.equal(poolVals.pool_dir, supVals.supervisor_dir, "shell: pool_dir must equal supervisor_dir");
  assert.equal(nodeVals.supervisorDir, supVals.supervisor_dir, "Node supervisorDir() must equal the shell's supervisor_dir");
  assert.equal(nodeVals.epochDir, supVals.supervisor_dir, "dirname(EPOCH_FILE) must equal the shell's supervisor_dir");
  assert.equal(nodeVals.poolDir, supVals.supervisor_dir, "poolDir() must equal the shell's supervisor_dir");
  assert.equal(nodeVals.sessionDir, supVals.supervisor_dir, "dirname(sessionFilePath()) must equal the shell's supervisor_dir");
  assert.ok(
    !supVals.supervisor_dir.includes(".claude"),
    `the agreed directory must not sit under .claude -- got ${supVals.supervisor_dir} (the exact regression a naive move would introduce)`
  );
});

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

test("no-configuration fallback: the CLI's no-argument usage output reports port 6510 from the new .claude/skills/vice-session location", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vice-noconfig-"));
  const env = { ...process.env, VICE_POOL_DIR: dir, VICE_SESSION_FILE: join(dir, "session.json") };
  delete env.VICE_MCP_URL;
  const { stdout } = await execFileP(process.execPath, [VICE_CLI], { env });
  assert.match(stdout, /port 6510/);
});

// ============================================================================
// Probe (Task 1, quick-260730-p5x): tools/vice-probe.mjs's single-shot,
// short-timeout, no-ladder liveness check -- the deliberately FRAGILE
// counterpart to withReconnect(). Every test here drives a real node:http
// stub server on an ephemeral port; only the final "dead default endpoint"
// timing test touches the real host VICE endpoint, and it asserts ONLY on
// elapsed time, never on the verdict.
// ============================================================================

/** Start a stub http server driven by `handler(req, res)`, run `fn(port)`
 * against it, then shut down -- closeAllConnections() BEFORE close() so a
 * hanging-response test (a handler that never calls res.end()) cannot wedge
 * the suite waiting for a socket that will never close on its own. */
async function withStubServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    return await fn(port);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

/** A well-formed MCP handler: answers `initialize` with an empty result and
 * `tools/call` of vice_ping with `pingResult` (default a plausible ping
 * payload), wrapped in the same content-array shape the real seam expects. */
function mcpHandler({ pingResult = { version: "3.10", machine: "C64SC", execution: "running" } } = {}) {
  return (req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = {};
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      if (parsed.method === "initialize") {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: {} }));
        return;
      }
      if (parsed.method === "tools/call") {
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: parsed.id,
            result: { content: [{ type: "text", text: JSON.stringify(pingResult) }] },
          })
        );
        return;
      }
      res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: {} }));
    });
  };
}

/** An ephemeral port that is bound and immediately released -- nothing is
 * listening there for the probe to reach, giving a real ECONNREFUSED. */
async function freeEphemeralPort() {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

test("PROBE_TOOL is the frozen constant vice_ping", () => {
  assert.equal(PROBE_TOOL, "vice_ping");
});

test("probeInstance: a stub server answering a well-formed vice_ping payload reports alive:true with the parsed ping result and an elapsed-ms figure", async () => {
  await withStubServer(mcpHandler(), async (port) => {
    const verdict = await probeInstance({ url: `http://127.0.0.1:${port}/mcp`, port });
    assert.equal(verdict.alive, true);
    assert.equal(verdict.port, port);
    assert.equal(verdict.reason, null);
    assert.equal(verdict.ping.version, "3.10");
    assert.ok(Number.isFinite(verdict.ms) && verdict.ms >= 0);
  });
});

test("probeInstance: nothing listening on the port reports alive:false fast, with a reason carrying the underlying cause code (ECONNREFUSED)", async () => {
  const freePort = await freeEphemeralPort();
  const start = Date.now();
  const verdict = await probeInstance({ url: `http://127.0.0.1:${freePort}/mcp`, port: freePort, timeoutMs: 1500 });
  const elapsedMs = Date.now() - start;
  assert.equal(verdict.alive, false);
  assert.match(verdict.reason, /ECONNREFUSED/);
  assert.ok(elapsedMs < 1500, `expected a fast refusal, took ${elapsedMs}ms`);
});

test("probeInstance: a stub that accepts the connection and never responds reports alive:false with a timeout reason, elapsed bounded by timeoutMs plus slack -- never the ~50s a retry ladder would cost", async () => {
  await withStubServer(
    () => {
      // Never call res.end() or res.write() -- the connection is accepted
      // but nothing is ever sent back.
    },
    async (port) => {
      const start = Date.now();
      const verdict = await probeInstance({ url: `http://127.0.0.1:${port}/mcp`, port, timeoutMs: 300 });
      const elapsedMs = Date.now() - start;
      assert.equal(verdict.alive, false);
      assert.match(verdict.reason, /timeout|300/i);
      assert.ok(
        elapsedMs < 3000,
        `expected elapsed time bounded by timeoutMs plus slack, took ${elapsedMs}ms -- never the ~50s a retry ladder would cost`
      );
    }
  );
});

test("probeInstance: a stub answering HTTP 500 reports alive:false with a reason saying what was wrong", async () => {
  await withStubServer(
    (req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end("internal error");
      });
    },
    async (port) => {
      const verdict = await probeInstance({ url: `http://127.0.0.1:${port}/mcp`, port });
      assert.equal(verdict.alive, false);
      assert.match(verdict.reason, /500/);
    }
  );
});

test("probeInstance: a stub answering HTTP 200 with something that is not a ping result reports alive:false -- something else listening is not the same as VICE being up (T-p5x-04)", async () => {
  await withStubServer(
    (req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = {};
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        if (parsed.method === "initialize") {
          res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: {} }));
          return;
        }
        // tools/call answered, but with something that decodes fine yet has
        // no "version" field -- e.g. some other HTTP service on that port.
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: parsed.id,
            result: { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] },
          })
        );
      });
    },
    async (port) => {
      const verdict = await probeInstance({ url: `http://127.0.0.1:${port}/mcp`, port });
      assert.equal(verdict.alive, false);
      assert.match(verdict.reason, /version/);
    }
  );
});

test("probeAll: four hanging stub endpoints probed together finish in about one timeout, not four -- proof the candidates go out concurrently (D-3)", async () => {
  const hangingHandler = () => {
    /* never respond */
  };
  const servers = await Promise.all(
    Array.from({ length: 4 }, () => {
      return new Promise((resolve) => {
        const s = createServer(hangingHandler);
        s.listen(0, "127.0.0.1", () => resolve(s));
      });
    })
  );
  try {
    const instances = servers.map((s) => ({
      port: s.address().port,
      url: `http://127.0.0.1:${s.address().port}/mcp`,
    }));
    const start = Date.now();
    const { results, byPort } = await probeAll(instances, { timeoutMs: 300 });
    const elapsedMs = Date.now() - start;
    assert.equal(results.length, 4);
    assert.ok(results.every((r) => r.alive === false));
    assert.equal(byPort.size, 4);
    // Serial cost would be ~4*300=1200ms; concurrent cost is ~300ms plus
    // slack -- comfortably under the serial sum proves the fan-out.
    assert.ok(elapsedMs < 900, `expected concurrent cost well under the 1200ms serial sum, took ${elapsedMs}ms`);
  } finally {
    for (const s of servers) {
      s.closeAllConnections();
      await new Promise((resolve) => s.close(resolve));
    }
  }
});

test("probeInstance never throws: a dead-port failure is a verdict object, not an exception", async () => {
  const freePort = await freeEphemeralPort();
  await assert.doesNotReject(probeInstance({ url: `http://127.0.0.1:${freePort}/mcp`, port: freePort, timeoutMs: 500 }));
});

test("probeInstance: probing the real default (currently down) endpoint completes in under 3 seconds whatever the verdict -- THE assertion that D-3 was implemented rather than the resilient path reused", async () => {
  const url = process.env.VICE_MCP_URL || "http://host.docker.internal:6510/mcp";
  const start = Date.now();
  const verdict = await probeInstance({ url, port: 6510, timeoutMs: DEFAULT_PROBE_TIMEOUT_MS });
  const elapsedMs = Date.now() - start;
  // Assert ONLY on elapsed time -- the endpoint's liveness is not under this
  // repo's control (see .planning/STATE.md's HARD BLOCKER entry), but the
  // bound on how long a verdict takes is exactly what this task delivers.
  assert.ok(
    elapsedMs < 3000,
    `expected a verdict (either way) in under 3s -- never the ~50s a retry ladder would cost, took ${elapsedMs}ms`
  );
  assert.equal(typeof verdict.alive, "boolean");
});

// ============================================================================
// Task 2 (quick-260730-p5x): probing acquire() and poolHealth()'s four-
// question health model. instanceFor() derives its URL from
// VICE_MCP_HOST + the validated port, so every test here that needs a real
// stub server to be reachable points VICE_MCP_HOST at 127.0.0.1 for the
// duration of that test, then restores whatever was there before.
// ============================================================================

async function withMcpHostEnv(host, fn) {
  const prev = process.env.VICE_MCP_HOST;
  process.env.VICE_MCP_HOST = host;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.VICE_MCP_HOST;
    else process.env.VICE_MCP_HOST = prev;
  }
}

/** A free ephemeral port strictly greater than `minExclusive` -- used to
 * force a "dead" candidate to sort BEFORE a "live" one in acquire()'s
 * descending-port walk, so a test can prove probing (not just reporting)
 * changed the selection. */
async function greaterFreeEphemeralPort(minExclusive) {
  for (let i = 0; i < 50; i++) {
    const p = await freeEphemeralPort();
    if (p > minExclusive) return p;
  }
  throw new Error(`could not find a free ephemeral port greater than ${minExclusive} after 50 attempts`);
}

test("acquire(): a two-port registry with only one live stub returns the LIVE port even when descending order would have preferred the dead one", async () => {
  await withStubServer(mcpHandler(), async (livePort) => {
    const deadPort = await greaterFreeEphemeralPort(livePort);
    await withMcpHostEnv("127.0.0.1", async () => {
      const dir = tmpPoolDir();
      writeRegistry(dir, [deadPort, livePort]);
      const l = await acquire({ dir, timeoutMs: 0, probeTimeoutMs: 500 });
      assert.equal(l.port, livePort, "descending order would try deadPort first -- probing must skip it");
      await l.release();
    });
  });
});

test("acquire(): every candidate dead rejects with a per-candidate reason naming the cause and supervision verdict for each port -- never a bare 'none free'", async () => {
  const deadPortA = await freeEphemeralPort();
  const deadPortB = await greaterFreeEphemeralPort(deadPortA);
  await withMcpHostEnv("127.0.0.1", async () => {
    const dir = tmpPoolDir();
    writeRegistry(dir, [deadPortA, deadPortB]);
    await assert.rejects(acquire({ dir, timeoutMs: 0, probeTimeoutMs: 500 }), (err) => {
      for (const p of [deadPortA, deadPortB]) assert.match(err.message, new RegExp(String(p)));
      assert.match(err.message, /no answer/);
      assert.match(err.message, /ECONNREFUSED/);
      assert.match(err.message, /unsupervised/);
      assert.doesNotMatch(err.message, /none free/i);
      return true;
    });
  });
});

test("acquire(): a candidate that is alive but leased is reported as LEASED, not dead -- the two rejection reasons are distinguishable (D-1)", async () => {
  await withStubServer(mcpHandler(), async (port) => {
    await withMcpHostEnv("127.0.0.1", async () => {
      const dir = tmpPoolDir();
      writeRegistry(dir, [port]);
      const holder = await acquire({ dir, timeoutMs: 0, probeTimeoutMs: 500 });
      assert.equal(holder.port, port);

      await assert.rejects(acquire({ dir, timeoutMs: 0, probeTimeoutMs: 500 }), (err) => {
        assert.match(err.message, new RegExp(String(port)));
        assert.match(err.message, /held by pid/);
        assert.doesNotMatch(err.message, /no answer/, "an alive-but-leased candidate must not be described as dead");
        return true;
      });

      await holder.release();
    });
  });
});

test("acquire(): a hostile registry url field is never probed -- the target is derived from the validated port only (T-p5x-01)", async () => {
  await withStubServer(mcpHandler(), async (port) => {
    await withMcpHostEnv("127.0.0.1", async () => {
      const dir = tmpPoolDir();
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "registry.json"),
        JSON.stringify({
          instances: [{ port, url: "http://evil.example.invalid:1/mcp", epoch_file: "../../../etc/passwd" }],
        })
      );
      const l = await acquire({ dir, timeoutMs: 0, probeTimeoutMs: 500 });
      assert.equal(l.port, port, "probing must have reached the REAL stub, derived from the port, not the hostile url");
      await l.release();
    });
  });
});

test("acquire(): zero-config path still returns port 6510 with no registry, probes it, and warns on stderr rather than failing when it is not answering (D-7)", async () => {
  const dir = tmpPoolDir();
  const originalError = console.error;
  let warning = "";
  console.error = (msg) => {
    warning += msg;
  };
  let l;
  try {
    l = await acquire({ dir });
  } finally {
    console.error = originalError;
  }
  assert.equal(l.port, DEFAULT_PORT);
  assert.equal(l.pooled, false);
  assert.match(warning, /not answering/);
  await l.release();
});

test("poolHealth(): pooled instance answers all four questions as separate fields -- launched, alive, lease, supervised (epoch)", async () => {
  await withStubServer(mcpHandler(), async (port) => {
    await withMcpHostEnv("127.0.0.1", async () => {
      const dir = tmpPoolDir();
      writeRegistry(dir, [port]);
      writeEpochFile(join(dir, String(port), "epoch.json"), 7);

      const health = await poolHealth({ dir, timeoutMs: 500 });
      assert.equal(health.pooled, true);
      assert.equal(health.records.length, 1);
      const rec = health.records[0];
      assert.equal(rec.port, port);
      assert.equal(rec.launched, true);
      assert.equal(rec.alive, true);
      assert.equal(rec.lease.held, false);
      assert.equal(rec.epoch.present, true);
      assert.equal(rec.epoch.epoch, 7);
      assert.match(rec.diagnosis, /alive/);
    });
  });
});

test("poolHealth(): with no registry, reports the single unpooled default instance with launched:null", async () => {
  const dir = tmpPoolDir();
  const health = await poolHealth({ dir, timeoutMs: 500 });
  assert.equal(health.pooled, false);
  assert.equal(health.records.length, 1);
  assert.equal(health.records[0].port, DEFAULT_PORT);
  assert.equal(health.records[0].launched, null);
});

test("diagnose (D-4): dead with no epoch file -- nothing is supervising this port", () => {
  const record = { alive: false, epoch: { present: false, epoch: null } };
  assert.match(diagnose(record, null), /nothing is supervising/);
});

test("diagnose (D-4): dead with an epoch file and no prior observation -- unproven, re-probe to settle", () => {
  const record = { alive: false, epoch: { present: true, epoch: 3, spawned_at: "2026-01-01T00:00:00Z" } };
  const verdict = diagnose(record, null);
  assert.match(verdict, /unproven/i);
  assert.match(verdict, /re-probe/);
});

test("diagnose (D-4): dead with a prior observation showing the SAME epoch -- DEAD SUPERVISOR (a live one would have bumped it)", () => {
  const record = { alive: false, epoch: { present: true, epoch: 3 } };
  const previous = { epoch: { present: true, epoch: 3 } };
  const verdict = diagnose(record, previous);
  assert.match(verdict, /DEAD SUPERVISOR/);
});

test("diagnose (D-4): dead with an ADVANCED epoch -- a supervisor is alive and respawning, wait", () => {
  const record = { alive: false, epoch: { present: true, epoch: 5 } };
  const previous = { epoch: { present: true, epoch: 3 } };
  const verdict = diagnose(record, previous);
  assert.match(verdict, /respawning/);
  assert.match(verdict, /wait/);
});

test("poolHealth(): D-4 end-to-end -- a dead pooled instance's diagnosis moves from unproven to DEAD SUPERVISOR across two calls with the same epoch", async () => {
  const deadPort = await freeEphemeralPort();
  await withMcpHostEnv("127.0.0.1", async () => {
    const dir = tmpPoolDir();
    writeRegistry(dir, [deadPort]);
    writeEpochFile(join(dir, String(deadPort), "epoch.json"), 2);

    const first = await poolHealth({ dir, timeoutMs: 500 });
    assert.equal(first.records[0].alive, false);
    assert.match(first.records[0].diagnosis, /unproven/i);

    const second = await poolHealth({ dir, timeoutMs: 500, previous: first });
    assert.equal(second.records[0].alive, false);
    assert.match(second.records[0].diagnosis, /DEAD SUPERVISOR/);
  });
});
