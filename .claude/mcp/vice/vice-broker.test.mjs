// node:test integration coverage of the on-demand broker's tracer slice
// (Phase 01.2 plan 01): a real spawned vice-proxy.mjs child process, driven
// through one full request -> grant -> forward -> release -> teardown round
// trip against the REAL resources/vice-broker.sh (run with
// --once --dry-run), with an in-process node:http stand-in standing in for
// the host VICE MCP server. No host emulator and no real x64sc are involved
// at any point -- matching vice-pool.test.mjs's own execFile-real-subprocess
// idiom (01.2-PATTERNS.md), and vice-proxy.test.mjs's own spawned-child +
// stand-in-server harness (both duplicated here rather than imported, since
// neither file exports its internal test helpers).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  rmSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { REQUEST_ID_PATTERN, isValidRequestId } from "./vice-broker-client.mjs";

const execFileP = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const PROXY_PATH = join(HERE, "vice-proxy.mjs");
const BROKER_SCRIPT = join(HERE, "resources", "vice-broker.sh");

const tmpPoolDir = () => mkdtempSync(join(tmpdir(), "vice-broker-test-"));

/** Minimal in-process stand-in for the host VICE MCP server -- same shape
 * as vice-proxy.test.mjs's own startStandInServer(): answers `initialize`
 * and `tools/call` for `vice_ping`, records every request verbatim. */
function startStandInServer() {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        msg = null;
      }
      requests.push(msg);

      if (msg && msg.method === "initialize") {
        const result = {
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: { name: "stand-in-vice", version: "0.0.0" },
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
        return;
      }
      if (msg && msg.method === "tools/call" && msg.params && msg.params.name === "vice_ping") {
        const payload = { version: "3.10", machine: "C64SC", execution: "paused" };
        const result = { content: [{ type: "text", text: JSON.stringify(payload) }] };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg && "id" in msg ? msg.id : null,
          error: { code: -32601, message: "unsupported in this test's stand-in server" },
        })
      );
    });
  });
  return { server, requests };
}

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return server.address().port;
}

/** Spawns `node vice-proxy.mjs` as a real child process -- same harness
 * shape as vice-proxy.test.mjs's own startProxy(). */
function startProxy(env) {
  const child = spawn(process.execPath, [PROXY_PATH], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const messages = [];
  let consumed = 0;
  let outBuf = "";

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    outBuf += chunk;
    let idx;
    while ((idx = outBuf.indexOf("\n")) !== -1) {
      const line = outBuf.slice(0, idx);
      outBuf = outBuf.slice(idx + 1);
      if (line.trim().length === 0) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (e) {
        parsed = { __parseError: e.message, __raw: line };
      }
      messages.push(parsed);
    }
  });

  const stderrChunks = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

  function send(msg) {
    child.stdin.write(JSON.stringify(msg) + "\n");
  }

  async function nextMessage(timeoutMs = 8000) {
    const start = Date.now();
    while (consumed >= messages.length) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`timed out waiting for a proxy stdout message (stderr so far: ${stderrChunks.join("")})`);
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    return messages[consumed++];
  }

  return { child, send, messages, nextMessage, stderr: stderrChunks };
}

/** Poll `predicate` (a zero-arg function returning truthy/falsy) to a
 * bounded deadline rather than sleeping a fixed duration, per this task's
 * own "poll for the condition" convention. */
async function waitFor(predicate, { timeoutMs = 8000, pollMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}

function runBrokerOnceDryRun(dir, basePort) {
  return execFileP("bash", [BROKER_SCRIPT, "--once", "--dry-run"], {
    env: {
      ...process.env,
      VICE_SUPERVISOR_ALLOW_CONTAINER: "1",
      VICE_POOL_DIR: dir,
      VICE_BROKER_BASE_PORT: String(basePort),
      VICE_BROKER_SPARES: "0",
    },
  });
}

// ---------------------------------------------------------------------------
// Plan 02 (Task 1: single teardown path; Task 2: kill-never-recycle + id
// parity) test helpers. These bypass the request->grant round trip where a
// test only needs to exercise the teardown/sweep pass in isolation --
// writing a grant (and optionally a lease) directly mirrors exactly the
// shape resources/vice-broker.sh itself writes, so the pass under test
// cannot tell the difference from a grant it wrote moments earlier.

/** Runs `vice-broker.sh --once [--dry-run]` with the given pool dir/env
 * overrides, mirroring runBrokerOnceDryRun() above but with knobs for TTL
 * and non-dry-run opt-out (dry-run is the default -- no real x64sc is ever
 * needed by this file's own tests). */
function runBrokerOnce(dir, { basePort = 7000, ttlS, dryRun = true } = {}) {
  const env = {
    ...process.env,
    VICE_SUPERVISOR_ALLOW_CONTAINER: "1",
    VICE_POOL_DIR: dir,
    VICE_BROKER_BASE_PORT: String(basePort),
    VICE_BROKER_SPARES: "0",
  };
  if (ttlS !== undefined) env.VICE_BROKER_TTL_S = String(ttlS);
  const args = ["--once"];
  if (dryRun) args.push("--dry-run");
  return execFileP("bash", [BROKER_SCRIPT, ...args], { env });
}

/** Writes grants/<id>.json directly, in the exact shape vice-broker.sh's own
 * process_requests() writes -- lets a test set up a teardown/sweep scenario
 * without needing a live proxy to have requested it first. */
function writeGrantFile(dir, id, { port = 7000, supervisorPid = null, dryRun = true, launchedAt = null } = {}) {
  const gdir = join(dir, "grants");
  mkdirSync(gdir, { recursive: true });
  const record = {
    version: 1,
    id,
    port,
    url: `http://127.0.0.1:${port}/mcp`,
    epoch_file: join(dir, String(port), "epoch.json"),
    supervisor_dir: join(dir, String(port)),
    supervisor_pid: supervisorPid,
    granted_at: new Date().toISOString(),
    dry_run: dryRun,
    ...(launchedAt !== null ? { launched_at: launchedAt } : {}),
  };
  const p = join(gdir, `${id}.json`);
  writeFileSync(p, JSON.stringify(record, null, 2) + "\n");
  return p;
}

/** Writes leases/<id> directly -- existence is the claim, mtime is the
 * heartbeat, removal is the release (per this phase's own must_haves). */
function writeLeaseFile(dir, id) {
  const ldir = join(dir, "leases");
  mkdirSync(ldir, { recursive: true });
  const p = join(ldir, id);
  writeFileSync(p, JSON.stringify({ version: 1, id, created_at: new Date().toISOString() }) + "\n");
  return p;
}

/** Rewinds a lease file's mtime to simulate staleness (secondsAgo > 0) or
 * refreshes it to "now" (secondsAgo === 0), without touching its content --
 * only the mtime is the sweeper's own signal. */
function ageLeaseFile(leasePath, secondsAgo) {
  const t = new Date(Date.now() - secondsAgo * 1000);
  utimesSync(leasePath, t, t);
}

/** Writes requests/<id>.json in the exact shape vice-broker-client.mjs's own
 * writeRequest() produces, for tests that exercise the real request scan
 * rather than a directly-planted grant. */
function writeRequestFile(dir, id, { proxyPid = process.pid } = {}) {
  const rdir = join(dir, "requests");
  mkdirSync(rdir, { recursive: true });
  const record = {
    version: 1,
    id,
    op: "acquire",
    proxy_pid: proxyPid,
    session_id: null,
    client_pid: null,
    created_at: new Date().toISOString(),
  };
  writeFileSync(join(rdir, `${id}.json`), JSON.stringify(record, null, 2) + "\n");
}

/** Recursively lists every file under `dir` -- used by the id-pattern parity
 * test to prove no path-traversal-shaped file was ever created anywhere,
 * across the whole rejected-id corpus, not just at one predicted location. */
function listAllFilesRecursive(dir) {
  const out = [];
  function walk(d) {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(full);
    }
  }
  walk(dir);
  return out;
}

test("tracer: request -> grant -> forward -> SIGINT release -> teardown, end to end", async () => {
  const dir = tmpPoolDir();
  const { server, requests } = startStandInServer();
  const port = await listen(server);
  const epochFile = join(dir, "epoch.json"); // deliberately never written -- absence is normal, not a restart

  // VICE_MCP_URL intentionally UNSET -- the broker path is the one under
  // test (an explicit endpoint override would make ensureBrokerLease() a
  // no-op, per criterion "VICE_MCP_URL set -> proxy asks the broker for
  // nothing").
  const proxy = startProxy({
    VICE_POOL_DIR: dir,
    VICE_BROKER_BASE_PORT: String(port),
    VICE_EPOCH_FILE: epochFile,
  });

  try {
    proxy.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    await proxy.nextMessage();

    proxy.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    await proxy.nextMessage();

    // C3: initialize + tools/list alone must write NEITHER a request NOR a
    // lease file -- acquisition is deferred to the first forwarded call.
    assert.equal(existsSync(join(dir, "requests")), false, "initialize+tools/list must create no requests directory");
    assert.equal(existsSync(join(dir, "leases")), false, "initialize+tools/list must create no leases directory");

    // The first forwarded tools/call -- this is what acquires an instance.
    proxy.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "vice_ping", arguments: {} } });

    const reqDir = join(dir, "requests");
    const reqFiles = await waitFor(() => {
      if (!existsSync(reqDir)) return null;
      const files = readdirSync(reqDir).filter((f) => f.endsWith(".json"));
      return files.length > 0 ? files : null;
    });
    assert.ok(reqFiles, "a request file must appear under requests/ before the broker has run");
    assert.equal(reqFiles.length, 1, "exactly one request file must appear for one forwarded call");

    const id = reqFiles[0].replace(/\.json$/, "");
    assert.ok(REQUEST_ID_PATTERN.test(id), `request id ${id} must match the request-id pattern`);
    assert.ok(isValidRequestId(id));

    // Not yet resolved: only the two handshake responses exist so far, and
    // no grant has been written yet.
    assert.equal(proxy.messages.length, 2, "the tools/call must not have resolved before a grant exists");

    // Run the host-side broker once, in dry-run mode, against the SAME pool
    // directory and the stand-in server's own port.
    await runBrokerOnceDryRun(dir, port);

    const grantPath = join(dir, "grants", `${id}.json`);
    assert.ok(existsSync(grantPath), "a matching grant file must appear after one broker pass");
    const grant = JSON.parse(readFileSync(grantPath, "utf8"));
    assert.equal(grant.port, port, "the grant must carry the stand-in server's own port");
    assert.equal(grant.dry_run, true, "the grant must record dry_run:true");
    assert.equal(
      existsSync(join(dir, "requests", `${id}.json`)),
      false,
      "the request file must be gone once its grant has been written"
    );

    // The previously-pending tools/call must now resolve with the stand-in's
    // own payload.
    const callResp = await proxy.nextMessage();
    assert.equal(callResp.id, 3);
    assert.equal(callResp.result.isError, false, "the forwarded call must succeed once a grant exists");
    const payload = JSON.parse(callResp.result.content[0].text);
    assert.equal(payload.version, "3.10", "the stand-in server's own ping payload must round-trip back out");

    // Two "tools/call" requests reach the stand-in server, not one: the
    // pre-flight liveness probe's own vice_ping round trip (plan 01.1-03),
    // plus the one real forwarded call this tracer proves.
    const toolCallsSeen = requests.filter((r) => r && r.method === "tools/call");
    assert.equal(toolCallsSeen.length, 2, "the stand-in server must have received the probe ping plus the real forwarded call");
    assert.ok(toolCallsSeen.every((r) => r.params.name === "vice_ping"));

    // A lease file for this id must exist, with an mtime no earlier than its
    // own recorded creation time -- touchLease() runs on every forwarded
    // call (C6), in addition to createLease()'s initial write.
    const leasePath = join(dir, "leases", id);
    assert.ok(existsSync(leasePath), "a lease file for this request id must exist once the call has forwarded");
    const leaseRecord = JSON.parse(readFileSync(leasePath, "utf8"));
    const createdAtMs = Date.parse(leaseRecord.created_at);
    const leaseStat = statSync(leasePath);
    assert.ok(
      leaseStat.mtimeMs >= createdAtMs,
      "the lease file's mtime must be no earlier than its own created_at timestamp"
    );

    // SIGINT -- the FIRST signal of every graceful ending, a teardown
    // trigger here, never a plain user Ctrl-C to ignore.
    proxy.child.kill("SIGINT");

    const leaseGone = await waitFor(() => !existsSync(leasePath));
    assert.ok(leaseGone, "SIGINT must release the lease");

    // A second broker pass observes the released lease and tears the grant
    // down.
    await runBrokerOnceDryRun(dir, port);
    assert.equal(existsSync(grantPath), false, "the second broker pass must have torn the grant down");
  } finally {
    // SIGKILL, not the default SIGTERM: vice-proxy.mjs registers its own
    // SIGINT/SIGTERM/SIGHUP handlers and deliberately never calls
    // process.exit() (see its teardown comment) -- in production the
    // client's own ladder escalates to SIGKILL ~490ms after the first
    // signal if the process hasn't exited on its own. This test already
    // sent SIGINT and confirmed the lease was released; SIGKILL here is
    // this harness playing the client's role in that same ladder, not a
    // signal vice-proxy.mjs is expected to handle itself.
    try {
      proxy.child.kill("SIGKILL");
    } catch {
      /* already exited -- fine */
    }
    await new Promise((resolveClose) => server.close(resolveClose));
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Task 1: one teardown() reached by two triggers (released, swept-stale),
// the daemon lifecycle (start/stop/status), and the identity-verified kill.

test("teardown: a grant whose lease is absent is torn down and logged as released", async () => {
  const dir = tmpPoolDir();
  try {
    const id = "req-1-1000-aaaaaaaa";
    const grantPath = writeGrantFile(dir, id, { port: 7100 });
    const { stdout } = await runBrokerOnce(dir, { basePort: 7100 });
    assert.equal(existsSync(grantPath), false, "the grant must be removed once its lease is absent");
    assert.match(stdout, new RegExp(`${id}.*released`), "the pass must log this id's reason as released");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("teardown: a grant with a fresh lease survives the pass untouched", async () => {
  const dir = tmpPoolDir();
  try {
    const id = "req-2-2000-bbbbbbbb";
    const grantPath = writeGrantFile(dir, id, { port: 7101 });
    writeLeaseFile(dir, id);
    await runBrokerOnce(dir, { basePort: 7101 });
    assert.equal(existsSync(grantPath), true, "a fresh lease must survive the pass");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("teardown: released and swept-stale leave IDENTICAL resulting state, differing only in the logged reason", async () => {
  const releasedDir = tmpPoolDir();
  const sweptDir = tmpPoolDir();
  try {
    const idReleased = "req-3-3000-cccccccc";
    const idSwept = "req-3-3001-dddddddd";

    writeGrantFile(releasedDir, idReleased, { port: 7102 });
    // No lease at all for idReleased -- the "released" trigger.

    writeGrantFile(sweptDir, idSwept, { port: 7102 });
    const leasePath = writeLeaseFile(sweptDir, idSwept);
    ageLeaseFile(leasePath, 999); // far older than the tiny TTL used below

    const releasedResult = await runBrokerOnce(releasedDir, { basePort: 7102 });
    const sweptResult = await runBrokerOnce(sweptDir, { basePort: 7102, ttlS: 1 });

    const grantsReleased = existsSync(join(releasedDir, "grants"))
      ? readdirSync(join(releasedDir, "grants")).filter((f) => f.endsWith(".json"))
      : [];
    const grantsSwept = existsSync(join(sweptDir, "grants"))
      ? readdirSync(join(sweptDir, "grants")).filter((f) => f.endsWith(".json"))
      : [];
    assert.deepEqual(grantsReleased, [], "the released case must remove the grant");
    assert.deepEqual(grantsSwept, [], "the swept case must remove the grant");
    assert.equal(
      existsSync(join(sweptDir, "leases", idSwept)),
      false,
      "the sweep converts stale-but-present into missing BEFORE calling the shared teardown -- the lease itself must be gone too"
    );

    assert.match(releasedResult.stdout, new RegExp(`${idReleased}.*released`));
    assert.match(sweptResult.stdout, /swept \(stale \d+s, ttl 1s\)/, "the swept reason must be the only observable difference");
  } finally {
    rmSync(releasedDir, { recursive: true, force: true });
    rmSync(sweptDir, { recursive: true, force: true });
  }
});

test("teardown: a supervisor pid whose ps output does not name the supervisor script is refused, not signalled -- the grant is still removed", async () => {
  const dir = tmpPoolDir();
  try {
    const id = "req-4-4000-eeeeeeee";
    // process.pid (this very test runner) is a REAL, ALIVE pid whose own
    // `ps` args do not mention vice-supervisor.sh -- exactly the "possible
    // pid reuse" shape teardown() must refuse to signal.
    const grantPath = writeGrantFile(dir, id, { port: 7103, supervisorPid: process.pid });
    const { stderr } = await runBrokerOnce(dir, { basePort: 7103 });
    assert.equal(existsSync(grantPath), false, "the grant must still be removed even when the kill is refused");
    assert.match(stderr, new RegExp(`refusing to signal pid ${process.pid}`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("teardown: a lease refreshed to now survives at least three consecutive --once passes", async () => {
  const dir = tmpPoolDir();
  try {
    const id = "req-5-5000-ffffffff";
    const grantPath = writeGrantFile(dir, id, { port: 7104 });
    const leasePath = writeLeaseFile(dir, id);
    for (let i = 0; i < 3; i++) {
      ageLeaseFile(leasePath, 0); // refresh to "now" before each pass, like a heartbeat
      await runBrokerOnce(dir, { basePort: 7104 });
      assert.equal(existsSync(grantPath), true, `grant must survive pass ${i + 1}`);
      assert.equal(existsSync(leasePath), true, `lease must survive pass ${i + 1}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("broker.json and broker-instances.json are created with owner-only (0600) permissions", async () => {
  const dir = tmpPoolDir();
  try {
    await runBrokerOnce(dir, { basePort: 7105 });
    const brokerMode = statSync(join(dir, "broker.json")).mode & 0o777;
    assert.equal(brokerMode, 0o600, "broker.json must be owner-only");
    const instancesMode = statSync(join(dir, "broker-instances.json")).mode & 0o777;
    assert.equal(instancesMode, 0o600, "broker-instances.json must be owner-only, matching registry.json's own posture");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("status: prints the broker's own liveness line plus one line per broker-instances.json entry, naming its port", async () => {
  const dir = tmpPoolDir();
  try {
    const idA = "req-6-6000-11111111";
    const idB = "req-6-6001-22222222";
    writeGrantFile(dir, idA, { port: 7200 });
    writeLeaseFile(dir, idA);
    writeGrantFile(dir, idB, { port: 7201 });
    writeLeaseFile(dir, idB);
    // One pass regenerates broker-instances.json as a projection of the
    // (still-live, both leased) grants above.
    await runBrokerOnce(dir, { basePort: 7200 });

    const { stdout } = await execFileP("bash", [BROKER_SCRIPT, "status"], {
      env: { ...process.env, VICE_SUPERVISOR_ALLOW_CONTAINER: "1", VICE_POOL_DIR: dir },
    });
    assert.match(stdout, /7200/, "the first instance's port must be reported");
    assert.match(stdout, /7201/, "the second instance's port must be reported");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stop: with no broker.json present, exits 0 with a plain message that there is nothing to stop", async () => {
  const dir = tmpPoolDir();
  try {
    const { stderr } = await execFileP("bash", [BROKER_SCRIPT, "stop"], {
      env: { ...process.env, VICE_SUPERVISOR_ALLOW_CONTAINER: "1", VICE_POOL_DIR: dir },
    });
    assert.match(stderr, /nothing to stop/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Task 2: kill-never-recycle, and the request-id pattern parity between the
// shell script's own validation and vice-broker-client.mjs's isValidRequestId().

test("kill-never-recycle: a torn-down instance is never re-granted -- the next grant on that port is a distinct, freshly launched instance", async () => {
  const dir = tmpPoolDir();
  try {
    const id1 = "req-7-7000-abcdef01";
    writeRequestFile(dir, id1);
    // createLease() runs BEFORE pollGrant() in vice-proxy.mjs's own
    // ensureBrokerLease() (see vice-proxy.mjs:696-699) -- a lease already
    // exists by the time the broker's own pass would grant this request, so
    // mirror that ordering here rather than granting into an immediate
    // same-pass sweep.
    writeLeaseFile(dir, id1);
    await runBrokerOnce(dir, { basePort: 7300 });

    const grant1Path = join(dir, "grants", `${id1}.json`);
    assert.ok(existsSync(grant1Path), "the first request must be granted");
    const grant1 = JSON.parse(readFileSync(grant1Path, "utf8"));
    assert.equal(grant1.dry_run, true);

    // Release: the lease goes away, exactly as releaseLease() (SIGINT) does.
    rmSync(join(dir, "leases", id1));
    await runBrokerOnce(dir, { basePort: 7300 }); // sweep pass tears the first grant down
    assert.equal(existsSync(grant1Path), false, "the released grant must be torn down");

    // A second request lands, deliberately targeting the SAME base port
    // range -- proving the port itself is not what makes an instance
    // grantable again.
    const id2 = "req-7-7001-abcdef02";
    writeRequestFile(dir, id2);
    writeLeaseFile(dir, id2);
    await runBrokerOnce(dir, { basePort: 7300 });

    const grant2Path = join(dir, "grants", `${id2}.json`);
    assert.ok(existsSync(grant2Path), "the second request must be granted");
    const grant2 = JSON.parse(readFileSync(grant2Path, "utf8"));

    assert.notEqual(
      grant2.supervisor_pid,
      grant1.supervisor_pid,
      "a torn-down instance's synthetic launch id must never reappear for a later grant -- a CONSTANT dry-run value here would make this assertion pass vacuously"
    );
    assert.ok(
      grant2.launched_at > grant1.launched_at,
      "the second grant's launched_at must be strictly later than the first, proving a fresh launch rather than a reused record"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const ID_CORPUS = [
  { id: "req-1000-1700000000000-01234567", valid: true },
  { id: "req-1-1-abcdef01", valid: true },
  { id: "req-1000-1700000000000-../../etc", valid: false }, // ".." plus a separator
  { id: "/etc/passwd", valid: false }, // absolute-looking name
  { id: "", valid: false }, // empty id
  { id: "req-1000-1700000000000-ABCDEF01", valid: false }, // uppercase hex
  { id: "req-1000-1700000000000-01234567-extra", valid: false }, // extra trailing segment
];

test("parity: the shell script's own id validation and isValidRequestId() agree on every corpus entry", async () => {
  const dir = tmpPoolDir();
  try {
    const jsVerdicts = ID_CORPUS.map((c) => isValidRequestId(c.id));
    assert.deepEqual(
      jsVerdicts,
      ID_CORPUS.map((c) => c.valid),
      "sanity: the corpus's own expected verdicts must match isValidRequestId() before comparing against the shell side"
    );

    // Each candidate id is planted inside a SAFELY-NAMED request file's own
    // "id" JSON field -- several corpus entries (the ".." + separator case,
    // the absolute-looking name, the empty id) cannot themselves be real
    // filenames, so this drives the validation under test (the id CHECK)
    // rather than the filesystem's own separate restrictions, per this
    // task's own instruction.
    let i = 0;
    for (const { id } of ID_CORPUS) {
      writeRequestFileRaw(dir, `probe-${i}`, id);
      i++;
    }

    await runBrokerOnce(dir, { basePort: 7400 });

    const shellVerdicts = ID_CORPUS.map(({ id }) => existsSync(join(dir, "grants", `${id}.json`)));
    assert.deepEqual(
      shellVerdicts,
      ID_CORPUS.map((c) => c.valid),
      "the shell script's own request-scan verdicts must match isValidRequestId() for the same corpus"
    );

    // No file whose name contains ".." must ever be created anywhere under
    // the temp directory, across the WHOLE rejected-id corpus -- not just at
    // one predicted (and never-taken) path.
    const allFiles = listAllFilesRecursive(dir);
    assert.ok(
      allFiles.every((f) => !f.includes("..")),
      "no path segment containing .. may ever be created from a rejected id"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Writes a request file under a SAFE outer filename (`${safeName}.json`)
 * whose JSON body's own "id" field is the (possibly filename-unsafe)
 * candidate -- the parity test's own vehicle for driving the shell script's
 * id CHECK independently of the filesystem's own path restrictions. */
function writeRequestFileRaw(dir, safeName, candidateId) {
  const rdir = join(dir, "requests");
  mkdirSync(rdir, { recursive: true });
  const record = {
    version: 1,
    id: candidateId,
    op: "acquire",
    proxy_pid: 1,
    session_id: null,
    client_pid: null,
    created_at: new Date().toISOString(),
  };
  writeFileSync(join(rdir, `${safeName}.json`), JSON.stringify(record, null, 2) + "\n");
}

test("a malformed request body is skipped with a logged reason while a well-formed request in the same pass is still granted", async () => {
  const dir = tmpPoolDir();
  try {
    const rdir = join(dir, "requests");
    mkdirSync(rdir, { recursive: true });
    writeFileSync(join(rdir, "garbage.json"), "not json at all {{{\n");

    const goodId = "req-8-8000-cafebabe";
    writeRequestFileRaw(dir, "good", goodId);

    const { stderr } = await runBrokerOnce(dir, { basePort: 7500 });
    assert.match(stderr, /skipping request garbage\.json/);
    assert.ok(existsSync(join(dir, "grants", `${goodId}.json`)), "a well-formed request in the same pass must still be granted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
