// node:test coverage of vice-broker-client.mjs in ISOLATION -- no broker
// script and no proxy involved, matching vice-pool.test.mjs's own
// in-process, synthetic-temp-dir style (mkdtempSync fixtures, no subprocess
// needed for pure function coverage). Every exported function here reads
// its target directory from VICE_POOL_DIR (per the plan's own documented
// signatures, none of which take a `dir` parameter), so each test sets and
// restores that env var around its own temp directory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  REQUEST_ID_PATTERN,
  newRequestId,
  isValidRequestId,
  requestsDir,
  grantsDir,
  denialsDir,
  brokerLeasesDir,
  brokerJsonPath,
  leasePathFor,
  writeRequest,
  createLease,
  touchLease,
  releaseLease,
  pollGrant,
  readBrokerLiveness,
} from "./vice-broker-client.mjs";

const tmpPoolDir = () => mkdtempSync(join(tmpdir(), "vice-broker-client-test-"));

/** Runs `fn` with VICE_POOL_DIR pointed at a fresh temp directory, restoring
 * the prior value (or deleting the var entirely) afterwards regardless of
 * how `fn` exits -- every exported function under test reads this env var
 * at call time, so this is the isolation seam for in-process testing. */
async function withPoolDir(fn) {
  const dir = tmpPoolDir();
  const prev = process.env.VICE_POOL_DIR;
  process.env.VICE_POOL_DIR = dir;
  try {
    await fn(dir);
  } finally {
    if (prev === undefined) delete process.env.VICE_POOL_DIR;
    else process.env.VICE_POOL_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// -------------------------------------------------------------- request ids

test("newRequestId()/isValidRequestId(): accepts its own output and rejects a hostile corpus", () => {
  const id = newRequestId();
  assert.ok(REQUEST_ID_PATTERN.test(id), `newRequestId() output must match REQUEST_ID_PATTERN: ${id}`);
  assert.ok(isValidRequestId(id), `newRequestId() output must be accepted: ${id}`);

  const hostile = {
    "empty string": "",
    "path traversal with a separator": `req-1-2-${"a".repeat(8)}/../../etc/passwd`,
    "absolute path": "/etc/passwd",
    "trailing suffix beyond eight hex characters": `req-1-2-${"a".repeat(8)}xx`,
    "uppercase hex": `req-1-2-${"A".repeat(8)}`,
  };
  for (const [label, bad] of Object.entries(hostile)) {
    assert.equal(isValidRequestId(bad), false, `must reject (${label}): ${JSON.stringify(bad)}`);
  }
});

// --------------------------------------------------------- writeRequest/createLease

test("writeRequest()/createLease(): write final files with every documented field, no tmp file left behind", async () => {
  await withPoolDir(async (dir) => {
    const id = newRequestId();
    const reqRecord = writeRequest({ id, op: "acquire", sessionId: "sess-abc", clientPid: 4242 });
    for (const field of ["version", "id", "op", "proxy_pid", "session_id", "client_pid", "created_at"]) {
      assert.ok(Object.prototype.hasOwnProperty.call(reqRecord, field), `request record missing field ${field}`);
    }
    assert.equal(reqRecord.id, id);
    assert.equal(reqRecord.op, "acquire");
    assert.equal(reqRecord.session_id, "sess-abc");
    assert.equal(reqRecord.client_pid, 4242);

    const requestPath = join(requestsDir(dir), `${id}.json`);
    const onDisk = JSON.parse(readFileSync(requestPath, "utf8"));
    assert.deepEqual(onDisk, reqRecord, "the file on disk must match the returned record");

    const leaseRecord = createLease({ id, sessionId: "sess-abc", clientPid: 4242 });
    for (const field of ["version", "id", "proxy_pid", "session_id", "client_pid", "created_at"]) {
      assert.ok(Object.prototype.hasOwnProperty.call(leaseRecord, field), `lease record missing field ${field}`);
    }
    const leasePath = leasePathFor(id, dir);
    assert.deepEqual(JSON.parse(readFileSync(leasePath, "utf8")), leaseRecord);

    // No temp files left behind in either directory.
    const reqEntries = readdirSync(requestsDir(dir));
    const leaseEntries = readdirSync(brokerLeasesDir(dir));
    assert.ok(reqEntries.every((f) => !f.startsWith(".tmp-")), `stray tmp file in requests/: ${reqEntries}`);
    assert.ok(leaseEntries.every((f) => !f.startsWith(".tmp-")), `stray tmp file in leases/: ${leaseEntries}`);
  });
});

test("writeRequest()/createLease(): reject an invalid request id before touching the filesystem", () => {
  assert.throws(() => writeRequest({ id: "not-a-valid-id" }), /invalid request id/);
  assert.throws(() => createLease({ id: "../../etc/passwd" }), /invalid request id/);
});

// -------------------------------------------------------------------- touchLease

test("touchLease(): advances the lease file's mtime", async () => {
  await withPoolDir(async (dir) => {
    const id = newRequestId();
    createLease({ id });
    const before = statSync(leasePathFor(id, dir)).mtimeMs;
    await sleepMs(10);
    const touched = touchLease(id);
    assert.equal(touched, true, "touchLease() must report success against an existing lease");
    const after = statSync(leasePathFor(id, dir)).mtimeMs;
    assert.ok(after > before, `mtime must advance: before=${before} after=${after}`);
  });
});

test("touchLease(): a silent no-op against a lease that does not exist", async () => {
  await withPoolDir(async () => {
    const id = newRequestId();
    assert.equal(touchLease(id), false, "touchLease() against a missing lease must report false, not throw");
  });
});

// ----------------------------------------------------------------- releaseLease

test("releaseLease(): the entire release removes the lease file", async () => {
  await withPoolDir(async (dir) => {
    const id = newRequestId();
    createLease({ id });
    assert.ok(readFileSync(leasePathFor(id, dir), "utf8"));
    releaseLease(id);
    assert.throws(() => readFileSync(leasePathFor(id, dir), "utf8"), /ENOENT/);
  });
});

test("releaseLease(): a silent no-op on a missing lease file -- idempotent double release", async () => {
  await withPoolDir(async () => {
    const id = newRequestId();
    // Never created at all -- must not throw.
    assert.doesNotThrow(() => releaseLease(id));
    createLease({ id });
    releaseLease(id);
    // Second release of the SAME id, already gone -- still must not throw.
    assert.doesNotThrow(() => releaseLease(id));
  });
});

// -------------------------------------------------------------------- pollGrant

test("pollGrant(): resolves granted:true once a grant appears mid-poll", async () => {
  await withPoolDir(async (dir) => {
    const id = newRequestId();
    const grantsPath = join(grantsDir(dir), `${id}.json`);
    mkdirSync(grantsDir(dir), { recursive: true });
    setTimeout(() => {
      writeFileSync(grantsPath, JSON.stringify({ version: 1, id, port: 6510, dry_run: true }));
    }, 100);
    const result = await pollGrant(id, { timeoutMs: 5000, pollMs: 30 });
    assert.equal(result.granted, true);
    assert.equal(result.grant.port, 6510);
    assert.equal(result.denial, null);
  });
});

test("pollGrant(): resolves granted:false and surfaces the denial's reason verbatim", async () => {
  await withPoolDir(async (dir) => {
    const id = newRequestId();
    mkdirSync(denialsDir(dir), { recursive: true });
    writeFileSync(join(denialsDir(dir), `${id}.json`), JSON.stringify({ version: 1, id, reason: "max_instances reached" }));
    const result = await pollGrant(id, { timeoutMs: 5000, pollMs: 30 });
    assert.equal(result.granted, false);
    assert.equal(result.reason, "max_instances reached");
    assert.equal(result.denial.reason, "max_instances reached");
  });
});

test("pollGrant(): treats a truncated, half-written grant file as not-yet-there, not a throw", async () => {
  await withPoolDir(async (dir) => {
    const id = newRequestId();
    mkdirSync(grantsDir(dir), { recursive: true });
    const grantsPath = join(grantsDir(dir), `${id}.json`);
    writeFileSync(grantsPath, '{"version": 1, "id": "' + id + '", "por'); // deliberately truncated
    setTimeout(() => {
      writeFileSync(grantsPath, JSON.stringify({ version: 1, id, port: 6511, dry_run: true }));
    }, 100);
    const result = await pollGrant(id, { timeoutMs: 5000, pollMs: 30 });
    assert.equal(result.granted, true, "the eventual well-formed grant must still be picked up");
    assert.equal(result.grant.port, 6511);
  });
});

test("pollGrant(): resolves granted:false with a reason after its deadline, never hanging", async () => {
  await withPoolDir(async () => {
    const id = newRequestId();
    const startedAt = Date.now();
    const result = await pollGrant(id, { timeoutMs: 200, pollMs: 30 });
    const elapsed = Date.now() - startedAt;
    assert.equal(result.granted, false);
    assert.match(result.reason, /200ms/);
    assert.ok(elapsed < 2000, `must resolve promptly after its own deadline, took ${elapsed}ms`);
  });
});

// -------------------------------------------------------------- readBrokerLiveness

test("readBrokerLiveness(): classifies an absent broker.json as never_started", async () => {
  await withPoolDir(async (dir) => {
    const result = readBrokerLiveness(brokerJsonPath(dir));
    assert.equal(result.state, "never_started");
    assert.equal(result.pid, null);
  });
});

test("readBrokerLiveness(): classifies a fresh heartbeat as alive", async () => {
  await withPoolDir(async (dir) => {
    const path = brokerJsonPath(dir);
    writeFileSync(path, JSON.stringify({ version: 1, pid: 4242, heartbeat_at: new Date().toISOString() }));
    const result = readBrokerLiveness(path);
    assert.equal(result.state, "alive");
    assert.equal(result.pid, 4242);
  });
});

test("readBrokerLiveness(): classifies a stale heartbeat as stale", async () => {
  await withPoolDir(async (dir) => {
    const path = brokerJsonPath(dir);
    const longAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
    writeFileSync(path, JSON.stringify({ version: 1, pid: 4242, heartbeat_at: longAgo }));
    const result = readBrokerLiveness(path);
    assert.equal(result.state, "stale");
  });
});
