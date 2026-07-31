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
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, rmSync } from "node:fs";
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
