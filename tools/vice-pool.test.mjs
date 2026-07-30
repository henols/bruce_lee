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
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { acquire, readRegistry, instanceFor, DEFAULT_PORT } from "./vice-pool.mjs";
import { call, useInstance } from "./vice.mjs";

const execFileP = promisify(execFile);
const MODULE_URL = new URL("./vice-pool.mjs", import.meta.url).href;

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
  const l = await acquire({ dir });
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
    const l = await acquire({ dir });
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
  const l = await acquire({ dir });
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
  const l1 = await acquire({ dir, timeoutMs: 0 });
  const l2 = await acquire({ dir, timeoutMs: 0 });
  const l3 = await acquire({ dir, timeoutMs: 0 });
  const ports = [l1.port, l2.port, l3.port];
  assert.equal(new Set(ports).size, 3);
  assert.deepEqual([...ports].sort((a, b) => a - b), [6710, 6711, 6712]);

  await assert.rejects(acquire({ dir, timeoutMs: 0 }), (err) => {
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
  const l1 = await acquire({ dir, timeoutMs: 0 });
  const waiterPromise = acquire({ dir, timeoutMs: 3000, pollMs: 100 });
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

  const l = await acquire({ dir, timeoutMs: 0 });
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

  const l = await acquire({ dir, timeoutMs: 0, maxLeaseAgeMs: 5000 });
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

  await assert.rejects(acquire({ dir, timeoutMs: 0 }), /6750/);
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
    l = await acquire({ dir, timeoutMs: 0 });
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
  const l1 = await acquire({ dir, timeoutMs: 0 });

  // Simulate l1 being reaped by an age-based reclaim without l1 itself ever
  // calling release(): force its own on-disk lease to look ancient.
  const rec = JSON.parse(readFileSync(l1.leasePath, "utf8"));
  writeFileSync(l1.leasePath, JSON.stringify({ ...rec, acquired_at: new Date(0).toISOString() }));

  const l2 = await acquire({ dir, timeoutMs: 0, maxLeaseAgeMs: 1000 });
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
      const l = await acquire({ dir, timeoutMs: 0 });
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
