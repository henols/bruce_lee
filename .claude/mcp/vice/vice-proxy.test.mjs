// node:test coverage of vice-proxy.mjs's stdio-MCP-server half, driven as a
// REAL spawned child process (matching vice-pool.test.mjs's own idiom: real
// subprocess, no module-boundary mocking) with an in-process node:http
// stand-in standing in for the host VICE MCP server. This is what makes the
// phase verifiable with the host emulator completely down -- see
// 01.1-RESEARCH.md's Validation Architecture and this project's own
// STATE.md HARD BLOCKER history for why that property matters here
// specifically.
//
// Coverage note for plan 01.1-03 (never-throw hardening task): the two
// tracer-era tests immediately below do NOT directly trigger
// `process.on('uncaughtException', ...)` or an EPIPE on `process.stdout`'s
// `'error'` listener -- both handlers are installed in vice-proxy.mjs and
// exercised only incidentally (by staying silent) here. Dedicated coverage
// for those two handlers, plus the full JSON-RPC error-code matrix and the
// never-cache-a-negative-result property, lives in the "never-throw"/
// "never-cache" tests further down this file (plan 01.1-03 task 1) -- this
// section EXTENDS the harness rather than duplicating it.
//
// Coverage note for plan 01.2-01 (broker teardown task): every `finally`
// block's cleanup call is `proxy.child.kill("SIGKILL")`, not a bare
// `kill()` -- a NON-assertion change, made necessary by this task's own
// change to vice-proxy.mjs. Registering `process.on("SIGTERM", ...)` (this
// task's teardown handler) suppresses Node's default SIGTERM-terminates
// behaviour, and the handler itself deliberately never calls
// `process.exit()` (see that handler's own comment in vice-proxy.mjs) --
// in production the client's own ladder escalates to an unhandleable
// SIGKILL ~490ms after the first signal, and a plain `kill()` in a test's
// cleanup has to play that same role or the child is left running,
// hanging the file on a dangling stdio pipe. No assertion anywhere in
// this file was altered by this change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { hostPath } from "../../skills/devcontainer-host-path/scripts/hostpath.mjs";
import { repoRoot } from "./repo-root.mjs";
// Read-only import for test assertions only -- this test file does not
// modify vice-broker-client.mjs (outside this plan's file-ownership set);
// GRANT_POLL_TIMEOUT_MS is already exported for exactly this purpose.
import { GRANT_POLL_TIMEOUT_MS } from "./vice-broker-client.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROXY_PATH = join(HERE, "vice-proxy.mjs");
const BROKER_SCRIPT = join(HERE, "resources", "vice-broker.sh");
const execFileP = promisify(execFile);

/**
 * A minimal in-process stand-in for the host VICE MCP server. Answers
 * `initialize` (the proxy-as-client's own handshake to the host, distinct
 * from the Claude-Code-facing handshake the proxy itself answers) and
 * `tools/call` for `vice_ping`. Records every request it receives, verbatim
 * parsed, so tests can assert on exactly what reached the "host".
 */
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
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

/**
 * Spawns `node vice-proxy.mjs` as a real child process and gives back a
 * small harness for line-based stdin/stdout JSON-RPC exchange, matching the
 * exact framing vice-proxy.mjs itself implements (newline-delimited, one
 * JSON value per line).
 */
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

  function sendRaw(line) {
    child.stdin.write(line + "\n");
  }

  async function nextMessage(timeoutMs = 8000) {
    const start = Date.now();
    while (consumed >= messages.length) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `timed out waiting for a proxy stdout message (stderr so far: ${stderrChunks.join("")})`
        );
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    return messages[consumed++];
  }

  return { child, send, sendRaw, messages, nextMessage, stderr: stderrChunks };
}

test("tracer: one real tool call round-trips end to end", async () => {
  const { server, requests } = startStandInServer();
  const port = await listen(server);
  const proxy = startProxy({ VICE_MCP_URL: `http://127.0.0.1:${port}/mcp` });

  try {
    // 1. initialize -- must echo the requested protocolVersion, declare a
    //    tools capability, and touch the host ZERO times.
    proxy.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "claude-code", version: "test" },
      },
    });
    const initResp = await proxy.nextMessage();
    assert.equal(initResp.id, 1);
    assert.equal(initResp.result.protocolVersion, "2025-06-18", "must echo the client's requested protocolVersion when supported");
    assert.ok(
      initResp.result.capabilities && initResp.result.capabilities.tools,
      "initialize result must declare a tools capability"
    );
    assert.equal(requests.length, 0, "initialize must make zero requests to the stand-in host");

    // 2. notifications/initialized -- a notification: no response at all.
    proxy.send({ jsonrpc: "2.0", method: "notifications/initialized" });

    // 3. tools/list -- still zero host requests, per criterion 4 (tracer scope).
    proxy.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const listResp = await proxy.nextMessage();
    assert.equal(listResp.id, 2);
    assert.ok(Array.isArray(listResp.result.tools), "tools/list result must carry a tools array");
    assert.equal(
      requests.length,
      0,
      "initialize AND tools/list together must make zero requests to the stand-in host"
    );

    // 4. tools/call for vice_ping -- the one real round trip this tracer proves.
    proxy.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "vice_ping", arguments: {} },
    });
    const callResp = await proxy.nextMessage();
    assert.equal(callResp.id, 3);
    assert.equal(callResp.result.isError, false, "a successful tool call must report isError: false");
    assert.equal(callResp.result.content[0].type, "text");
    const payload = JSON.parse(callResp.result.content[0].text);
    assert.equal(payload.version, "3.10", "the stand-in server's own payload must round-trip back out");

    // Two tools/call requests reach the stand-in server, not one: plan
    // 01.1-03's pre-flight liveness probe (probeInstance()) does its own
    // vice_ping round trip BEFORE the real forwarded call -- see that
    // plan's SUMMARY for the coverage-affecting change this represents.
    const toolCallsSeen = requests.filter((r) => r && r.method === "tools/call");
    assert.equal(
      toolCallsSeen.length,
      2,
      "the stand-in server must have received the liveness probe's ping plus the one real forwarded tools/call"
    );
    assert.ok(toolCallsSeen.every((r) => r.params.name === "vice_ping"));

    // 5. The proxy process must still be alive and answering -- this is the
    //    whole point of the never-throw discipline (finding 7: a dead stdio
    //    server is never reconnected).
    assert.equal(proxy.child.exitCode, null, "the proxy process must still be running");
    assert.equal(proxy.child.killed, false);
  } finally {
    proxy.child.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
  }
});

test("stdout carries only valid JSON-RPC messages", async () => {
  const { server } = startStandInServer();
  const port = await listen(server);
  const proxy = startProxy({ VICE_MCP_URL: `http://127.0.0.1:${port}/mcp` });

  try {
    proxy.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "test" } },
    });
    await proxy.nextMessage();

    proxy.send({ jsonrpc: "2.0", method: "notifications/initialized" });

    proxy.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    await proxy.nextMessage();

    proxy.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "vice_ping", arguments: {} } });
    await proxy.nextMessage();

    // A deliberately malformed raw line -- must yield a JSON-RPC parse-error
    // RESPONSE (code -32700, id: null), never a crash and never a non-frame
    // byte on stdout.
    proxy.sendRaw("not valid json{{{");
    const parseErrorResp = await proxy.nextMessage();
    assert.equal(parseErrorResp.error && parseErrorResp.error.code, -32700);
    assert.equal(parseErrorResp.id, null);

    // An unknown method -- a genuine protocol problem, JSON-RPC error, not
    // an isError:true result.
    proxy.send({ jsonrpc: "2.0", id: 4, method: "something/unknown", params: {} });
    const unknownResp = await proxy.nextMessage();
    assert.equal(unknownResp.error && unknownResp.error.code, -32601);

    // The durable guard itself: every line collected across this whole
    // session -- covering initialize, tools/list, tools/call, a malformed
    // line, and an unknown method -- must have parsed cleanly as JSON and
    // carry jsonrpc: "2.0". This is what fails if ANY module in the import
    // graph (vice.mjs and everything it transitively imports) ever leaks a
    // stray console.log onto stdout instead of stderr.
    assert.ok(proxy.messages.length >= 5, "expected at least 5 stdout messages across this session");
    for (const msg of proxy.messages) {
      assert.ok(
        !Object.prototype.hasOwnProperty.call(msg, "__parseError"),
        `a line written to stdout failed to parse as JSON: ${msg.__raw}`
      );
      assert.equal(msg.jsonrpc, "2.0", `message missing/wrong jsonrpc field: ${JSON.stringify(msg)}`);
    }
  } finally {
    proxy.child.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
  }
});

// -----------------------------------------------------------------------
// Plan 01.1-02 task 1: tools/list answers from a committed on-disk snapshot
// with ZERO emulator involvement, and degrades to a well-formed empty list
// on any snapshot problem rather than a fetch, a throw, or a hang.
// -----------------------------------------------------------------------

test("tools/list reads the committed snapshot with no emulator", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vice-proxy-manifest-"));
  const manifestFile = join(dir, "tools-manifest.json");
  const fixture = {
    generated_at: "2026-07-31T00:00:00.000Z",
    endpoint: "http://example.invalid/mcp",
    tools: [
      { name: "vice_ping", description: "ping the emulator", inputSchema: { type: "object", properties: {} } },
      {
        name: "vice_memory_read",
        description: "read a range of C64 memory",
        inputSchema: {
          type: "object",
          properties: { address: { type: "string" }, length: { type: "number" } },
          required: ["address"],
        },
      },
    ],
  };
  writeFileSync(manifestFile, JSON.stringify(fixture), "utf8");

  const { server, requests } = startStandInServer();
  const port = await listen(server);
  const proxy = startProxy({ VICE_MCP_URL: `http://127.0.0.1:${port}/mcp`, VICE_TOOLS_MANIFEST: manifestFile });

  try {
    proxy.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    await proxy.nextMessage();

    proxy.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const resp = await proxy.nextMessage();
    const tools = resp.result.tools;
    // Both fixture tools, PLUS the always-present synthetic
    // vice_result_continue tool (task 3) -- tools/list never omits it.
    assert.equal(tools.length, 3, "both fixture tools plus the synthetic continuation tool must come back");

    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    assert.ok(byName.vice_ping, "vice_ping must be present");
    assert.ok(byName.vice_memory_read, "vice_memory_read must be present");
    assert.deepEqual(
      byName.vice_memory_read.inputSchema,
      fixture.tools[1].inputSchema,
      "inputSchema must survive intact"
    );
    for (const t of tools) {
      assert.equal(
        typeof (t._meta && t._meta["anthropic/maxResultSizeChars"]),
        "number",
        `${t.name} must carry _meta["anthropic/maxResultSizeChars"]`
      );
    }

    assert.equal(requests.length, 0, "tools/list must make ZERO requests to the stand-in host");
  } finally {
    proxy.child.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tools/list survives a missing or corrupt snapshot", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vice-proxy-manifest-bad-"));
  const missingPath = join(dir, "does-not-exist.json");
  const invalidJsonPath = join(dir, "invalid.json");
  writeFileSync(invalidJsonPath, "{ this is not valid JSON", "utf8");
  const wrongShapePath = join(dir, "wrong-shape.json");
  writeFileSync(wrongShapePath, JSON.stringify({ generated_at: null, endpoint: null, tools: "nope, a string" }), "utf8");

  const { server, requests } = startStandInServer();
  const port = await listen(server);

  try {
    for (const manifestFile of [missingPath, invalidJsonPath, wrongShapePath]) {
      const proxy = startProxy({ VICE_MCP_URL: `http://127.0.0.1:${port}/mcp`, VICE_TOOLS_MANIFEST: manifestFile });
      try {
        proxy.send({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
        });
        await proxy.nextMessage();

        proxy.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        const resp = await proxy.nextMessage();
        // "Empty tools array" means empty of MANIFEST-derived tools -- the
        // always-present synthetic vice_result_continue tool (task 3) is
        // not sourced from the manifest at all, so a broken manifest can't
        // take it down with it.
        assert.deepEqual(
          resp.result.tools.map((t) => t.name),
          ["vice_result_continue"],
          `expected only the synthetic continuation tool for ${manifestFile}`
        );

        // The child must still be alive and answer a SUBSEQUENT
        // initialize-then-tools/list correctly -- a snapshot problem must
        // never strand the session.
        proxy.send({
          jsonrpc: "2.0",
          id: 3,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
        });
        const secondInit = await proxy.nextMessage();
        assert.equal(secondInit.result.protocolVersion, "2025-06-18");

        proxy.send({ jsonrpc: "2.0", id: 4, method: "tools/list", params: {} });
        const secondList = await proxy.nextMessage();
        assert.deepEqual(secondList.result.tools.map((t) => t.name), ["vice_result_continue"]);

        assert.equal(proxy.child.exitCode, null, "the proxy process must still be running");
        assert.equal(proxy.child.killed, false);
      } finally {
        proxy.child.kill("SIGKILL");
      }
    }
    assert.equal(requests.length, 0, "no manifest-read path may ever reach the stand-in host");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------
// Plan 01.1-02 task 2: the deny-list is enforced at BOTH discovery
// (tools/list, above) and call time, as independent layers; and every
// forwarded tools/call brackets itself with an epoch comparison, loud and
// never cached.
//
// COVERAGE SPLIT (do not conflate the two): removing the proxy's call-time
// deny check makes "vice_disk_list is refused at tools/call with no request
// made" fail on its request-counter assertion, because the request would
// then reach the stand-in server. Removing the read-time filter in
// handleToolsList() makes "vice_disk_list is absent from tools/list" fail.
// Neither test covers both layers.
// -----------------------------------------------------------------------

test("vice_disk_list is refused at tools/call with no request made", async () => {
  const { server, requests } = startStandInServer();
  const port = await listen(server);
  const proxy = startProxy({ VICE_MCP_URL: `http://127.0.0.1:${port}/mcp` });

  try {
    proxy.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    await proxy.nextMessage();

    proxy.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "vice_disk_list", arguments: {} } });
    const resp = await proxy.nextMessage();
    assert.equal(resp.result.isError, true, "vice_disk_list must always be refused");
    assert.match(resp.result.content[0].text, /vice_disk_list/);
    assert.match(resp.result.content[0].text, /host-side restart|host VICE MCP server/i);
    assert.equal(requests.length, 0, "the stand-in server's request counter must be unchanged");
  } finally {
    proxy.child.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
  }
});

test("vice_disk_list is absent from tools/list", async () => {
  // A fixture manifest that DELIBERATELY includes vice_disk_list, simulating
  // a snapshot generated by some other means -- this is what makes the
  // READ-TIME filter, not merely serverInfo()'s refresh-time filter, the
  // thing under test.
  const dir = mkdtempSync(join(tmpdir(), "vice-proxy-denylist-"));
  const manifestFile = join(dir, "tools-manifest.json");
  writeFileSync(
    manifestFile,
    JSON.stringify({
      generated_at: "2026-07-31T00:00:00.000Z",
      endpoint: "http://example.invalid/mcp",
      tools: [
        { name: "vice_ping", description: "ping", inputSchema: { type: "object", properties: {} } },
        { name: "vice_disk_list", description: "list disks", inputSchema: { type: "object", properties: {} } },
      ],
    }),
    "utf8"
  );

  const { server } = startStandInServer();
  const port = await listen(server);
  const proxy = startProxy({ VICE_MCP_URL: `http://127.0.0.1:${port}/mcp`, VICE_TOOLS_MANIFEST: manifestFile });

  try {
    proxy.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    await proxy.nextMessage();

    proxy.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const resp = await proxy.nextMessage();
    const names = resp.result.tools.map((t) => t.name);
    assert.ok(names.includes("vice_ping"), "the other fixture tool must still be present");
    assert.ok(!names.includes("vice_disk_list"), "vice_disk_list must be filtered out even from a manifest that names it");
  } finally {
    proxy.child.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("epoch drift is reported loudly and not cached", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vice-proxy-epoch-"));
  const epochFile = join(dir, "epoch.json");
  writeFileSync(epochFile, JSON.stringify({ epoch: 1, pid: 111, spawned_at: "2026-07-31T00:00:00.000Z" }), "utf8");

  const { server, requests } = startStandInServer();
  const port = await listen(server);
  const proxy = startProxy({ VICE_MCP_URL: `http://127.0.0.1:${port}/mcp`, VICE_EPOCH_FILE: epochFile });

  try {
    proxy.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    await proxy.nextMessage();

    // Call 1: establishes the baseline (epoch 1) and forwards normally.
    // Each SUCCESSFUL forwarded call now costs TWO "tools/call" requests at
    // the stand-in server, not one: the pre-flight liveness probe's own
    // vice_ping round trip, plus the real forwarded call (plan 01.1-03 task
    // 2) -- a refused-before-forwarding call (call 2 below) still costs
    // zero, since the epoch check runs BEFORE the probe.
    proxy.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "vice_ping", arguments: {} } });
    const first = await proxy.nextMessage();
    assert.equal(first.result.isError, false);
    assert.equal(requests.filter((r) => r && r.method === "tools/call").length, 2);

    // Epoch changes underneath the proxy -- a restart happened.
    writeFileSync(epochFile, JSON.stringify({ epoch: 2, pid: 222, spawned_at: "2026-07-31T00:05:00.000Z" }), "utf8");

    // Call 2: refused BEFORE forwarding -- no new request reaches the host,
    // and no probe fires either (the epoch check precedes the probe).
    proxy.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "vice_ping", arguments: {} } });
    const second = await proxy.nextMessage();
    assert.equal(second.result.isError, true, "an epoch change must refuse the call");
    assert.match(second.result.content[0].text, /1/);
    assert.match(second.result.content[0].text, /2/);
    assert.equal(
      requests.filter((r) => r && r.method === "tools/call").length,
      2,
      "the drifting call must NOT have reached the stand-in server (no probe, no forward)"
    );

    // Call 3: the re-baseline took effect -- forwards normally again, at
    // the cost of two more "tools/call" requests (probe + real).
    proxy.send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "vice_ping", arguments: {} } });
    const third = await proxy.nextMessage();
    assert.equal(third.result.isError, false, "the proxy must re-baseline, not cache the restart report");
    assert.equal(requests.filter((r) => r && r.method === "tools/call").length, 4);
  } finally {
    proxy.child.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing epoch file is not a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vice-proxy-epoch-absent-"));
  const epochFile = join(dir, "epoch.json"); // deliberately never written yet

  const { server, requests } = startStandInServer();
  const port = await listen(server);
  const proxy = startProxy({ VICE_MCP_URL: `http://127.0.0.1:${port}/mcp`, VICE_EPOCH_FILE: epochFile });

  try {
    proxy.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    await proxy.nextMessage();

    proxy.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "vice_ping", arguments: {} } });
    const first = await proxy.nextMessage();
    assert.equal(first.result.isError, false, "no epoch file at all must never be treated as a restart");

    proxy.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "vice_ping", arguments: {} } });
    const second = await proxy.nextMessage();
    assert.equal(second.result.isError, false);

    // The file appears for the first time -- absent-to-present is a
    // supervisor merely starting, not a restart.
    writeFileSync(epochFile, JSON.stringify({ epoch: 7 }), "utf8");

    proxy.send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "vice_ping", arguments: {} } });
    const third = await proxy.nextMessage();
    assert.equal(third.result.isError, false, "absent -> present must not be reported as a restart");
    // Three successful forwarded calls, each costing two "tools/call"
    // requests at the stand-in server (the pre-flight liveness probe's own
    // vice_ping, plus the real forwarded call -- plan 01.1-03 task 2).
    assert.equal(requests.filter((r) => r && r.method === "tools/call").length, 6);
  } finally {
    proxy.child.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------
// Plan 01.1-02 task 3: a result larger than the declared cap comes back in
// FULL across an explicit continuation sequence -- reassembled byte-for-byte,
// served with no extra host traffic, never silently truncated.
// -----------------------------------------------------------------------

/**
 * A stand-in server that answers `initialize` normally, `vice_ping`
 * specifically with a small, recognisable ping payload, and `targetTool`
 * with the oversized `payloadText` fixture. `vice_ping` MUST be answered
 * distinctly from `targetTool`: plan 01.1-03 task 2's pre-flight liveness
 * probe always calls `vice_ping` before any real forwarded call, and if it
 * received the same oversized non-JSON blob the target tool returns, it
 * would fail probeInstance()'s "recognisable ping result" check and report
 * the host unreachable -- short-circuiting every test in this section
 * before the oversized-result logic is ever exercised.
 */
function startBigPayloadServer(payloadText, { targetTool = "vice_memory_read" } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        msg = null;
      }
      requests.push(msg);

      if (msg && msg.method === "initialize") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "stand-in-vice", version: "0.0.0" } },
          })
        );
        return;
      }
      if (msg && msg.method === "tools/call" && msg.params && msg.params.name === "vice_ping") {
        const pingPayload = { version: "3.10", machine: "C64SC", execution: "paused" };
        const result = { content: [{ type: "text", text: JSON.stringify(pingPayload) }] };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
        return;
      }
      if (msg && msg.method === "tools/call" && msg.params && msg.params.name === targetTool) {
        const result = { content: [{ type: "text", text: payloadText }] };
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

test("an oversized result is recoverable in full across continuations", async () => {
  // NOT valid JSON, so call()'s own JSON.parse-or-verbatim fallback hands it
  // back exactly as sent -- the cleanest possible byte-for-byte fixture.
  const bigPayload = "PAYLOAD-START-" + "abcdefghij".repeat(500) + "-PAYLOAD-END"; // 5026 chars
  const { server, requests } = startBigPayloadServer(bigPayload);
  const port = await listen(server);
  const proxy = startProxy({ VICE_MCP_URL: `http://127.0.0.1:${port}/mcp`, VICE_MAX_RESULT_CHARS: "1000" });

  try {
    proxy.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    await proxy.nextMessage();

    proxy.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "vice_memory_read", arguments: {} } });
    const first = await proxy.nextMessage();
    assert.equal(first.result.isError, false);
    assert.equal(first.result.content.length, 2, "an oversized result carries a chunk item plus a marker item");
    assert.match(first.result.content[1].text, /chunk 1 of \d+/);
    assert.match(first.result.content[1].text, /vice_result_continue/);

    const tokenMatch = first.result.content[1].text.match(/"token":"([^"]+)"/);
    assert.ok(tokenMatch, "the marker must name a continuation token");
    const token = tokenMatch[1];

    let reassembled = first.result.content[0].text;
    let nextMarker = first.result.content[1].text;
    let guard = 0;
    while (!/\(last chunk\)/.test(nextMarker) && guard < 100) {
      guard += 1;
      proxy.send({
        jsonrpc: "2.0",
        id: 100 + guard,
        method: "tools/call",
        params: { name: "vice_result_continue", arguments: { token } },
      });
      const cont = await proxy.nextMessage();
      assert.equal(cont.result.isError, false);
      reassembled += cont.result.content[0].text;
      nextMarker = cont.result.content[1].text;
    }
    assert.match(nextMarker, /\(last chunk\)/, "the sequence must terminate with a last-chunk marker");

    assert.equal(reassembled, bigPayload, "reassembly must equal the original payload BYTE FOR BYTE");
    // Two "tools/call" requests reach the host, not one: the pre-flight
    // liveness probe's own vice_ping round trip, plus the one real forwarded
    // vice_memory_read call (plan 01.1-03 task 2) -- every continuation
    // chunk after that is served entirely from the proxy's local store.
    const toolCallsSeen = requests.filter((r) => r && r.method === "tools/call");
    assert.equal(
      toolCallsSeen.length,
      2,
      "continuations must be served from the proxy's store, never re-forwarded -- exactly the probe plus one real host request"
    );
    assert.ok(toolCallsSeen.some((r) => r.params.name === "vice_ping"), "the liveness probe's own ping must have reached the host");
    assert.ok(
      toolCallsSeen.some((r) => r.params.name === "vice_memory_read"),
      "the real oversized call must have reached the host exactly once"
    );
    assert.ok(
      !requests.some((r) => r && r.method === "tools/call" && r.params && r.params.name === "vice_result_continue"),
      "vice_result_continue must never appear in a request the stand-in server receives"
    );
  } finally {
    proxy.child.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
  }
});

test("an exhausted continuation token fails loudly", async () => {
  const bigPayload = "Z".repeat(3000);
  const { server } = startBigPayloadServer(bigPayload);
  const port = await listen(server);
  const proxy = startProxy({ VICE_MCP_URL: `http://127.0.0.1:${port}/mcp`, VICE_MAX_RESULT_CHARS: "1000" });

  try {
    proxy.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    await proxy.nextMessage();

    proxy.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "vice_memory_read", arguments: {} } });
    const first = await proxy.nextMessage();
    const tokenMatch = first.result.content[1].text.match(/"token":"([^"]+)"/);
    const token = tokenMatch[1];

    // Drain every remaining chunk.
    let marker = first.result.content[1].text;
    let guard = 0;
    while (!/\(last chunk\)/.test(marker) && guard < 100) {
      guard += 1;
      proxy.send({
        jsonrpc: "2.0",
        id: 100 + guard,
        method: "tools/call",
        params: { name: "vice_result_continue", arguments: { token } },
      });
      const cont = await proxy.nextMessage();
      marker = cont.result.content[1].text;
    }

    // One more call with the SAME (now-exhausted) token.
    proxy.send({
      jsonrpc: "2.0",
      id: 999,
      method: "tools/call",
      params: { name: "vice_result_continue", arguments: { token } },
    });
    const exhausted = await proxy.nextMessage();
    assert.equal(exhausted.result.isError, true, "an exhausted token must fail loudly");
    assert.match(exhausted.result.content[0].text, /narrower range/);
    assert.equal(proxy.child.exitCode, null, "the proxy must still be alive after an exhausted-token error");
  } finally {
    proxy.child.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
  }
});

test("tools/list declares the same cap it enforces", async () => {
  const { server } = startStandInServer();
  const port = await listen(server);
  const proxy = startProxy({ VICE_MCP_URL: `http://127.0.0.1:${port}/mcp`, VICE_MAX_RESULT_CHARS: "12345" });

  try {
    proxy.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    await proxy.nextMessage();

    proxy.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const resp = await proxy.nextMessage();
    assert.ok(resp.result.tools.length > 0, "tools/list must return at least the synthetic continuation tool");
    for (const t of resp.result.tools) {
      assert.equal(
        t._meta && t._meta["anthropic/maxResultSizeChars"],
        12345,
        `${t.name} must declare the SAME cap the child was started with`
      );
    }
    const continueTool = resp.result.tools.find((t) => t.name === "vice_result_continue");
    assert.ok(continueTool, "vice_result_continue must appear in tools/list");
    assert.ok(
      Array.isArray(continueTool.inputSchema.required) && continueTool.inputSchema.required.includes("token"),
      "vice_result_continue's inputSchema must require token"
    );
  } finally {
    proxy.child.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
  }
});

// -----------------------------------------------------------------------
// Plan 01.1-03 task 1: nothing can kill the proxy, and nothing it does may
// cache a negative ("the host is down") result. Every hostile-input shape
// gets a well-formed JSON-RPC response, never a crash and never silence
// when the caller expected an answer.
// -----------------------------------------------------------------------

test("never-throw: malformed and hostile input is answered, not fatal", async () => {
  const { server } = startStandInServer();
  const port = await listen(server);
  const proxy = startProxy({ VICE_MCP_URL: `http://127.0.0.1:${port}/mcp` });

  try {
    proxy.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    await proxy.nextMessage();

    // 1. Raw non-JSON text -- JSON-RPC parse error, id: null.
    proxy.sendRaw("this is not { json at all");
    const parseErr = await proxy.nextMessage();
    assert.equal(parseErr.error && parseErr.error.code, -32700, "malformed JSON must yield -32700");
    assert.equal(parseErr.id, null);
    assert.equal(proxy.child.exitCode, null, "still alive after a malformed line");

    // 2. Valid JSON that is not an object at all (a bare number) -- Invalid
    //    Request. There is no id to trust, so this must still be ANSWERED
    //    (never silently dropped as if it were a notification).
    proxy.sendRaw(JSON.stringify(42));
    const bareNumberErr = await proxy.nextMessage();
    assert.equal(bareNumberErr.error && bareNumberErr.error.code, -32600, "a non-object JSON value must yield -32600");

    // 3. A well-formed object with no "method" at all.
    proxy.send({ jsonrpc: "2.0", id: 10, params: {} });
    const noMethodErr = await proxy.nextMessage();
    assert.equal(noMethodErr.error && noMethodErr.error.code, -32600, 'an object with no "method" must yield -32600');
    assert.equal(noMethodErr.id, 10, "the id, when present, must still be echoed on an Invalid Request error");

    // 4. An unknown (unimplemented) method name.
    proxy.send({ jsonrpc: "2.0", id: 11, method: "something/unimplemented", params: {} });
    const unknownErr = await proxy.nextMessage();
    assert.equal(unknownErr.error && unknownErr.error.code, -32601, "an unrecognised method must yield -32601");

    // 5. tools/call with params but no name.
    proxy.send({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { arguments: {} } });
    const noNameErr = await proxy.nextMessage();
    assert.equal(noNameErr.error && noNameErr.error.code, -32602, "tools/call with no params.name must yield -32602");

    // 6. Finally: a genuinely valid tools/call, proving the process is
    //    still fully functional after five consecutive hostile inputs.
    proxy.send({ jsonrpc: "2.0", id: 13, method: "tools/call", params: { name: "vice_ping", arguments: {} } });
    const okResp = await proxy.nextMessage();
    assert.equal(okResp.result.isError, false, "a valid call after five hostile inputs must still succeed");

    assert.equal(proxy.child.exitCode, null, "the proxy must still be running throughout");
    assert.equal(proxy.child.killed, false);
  } finally {
    proxy.child.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
  }
});

test("never-throw: a notification draws no response", async () => {
  const { server } = startStandInServer();
  const port = await listen(server);
  const proxy = startProxy({ VICE_MCP_URL: `http://127.0.0.1:${port}/mcp` });

  try {
    proxy.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    await proxy.nextMessage();

    // Two notification-shaped messages -- valid method, no `id` at all.
    proxy.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    proxy.send({ jsonrpc: "2.0", method: "notifications/some-other-thing", params: { x: 1 } });

    // A subsequent real request must still get exactly its own response,
    // correlated by id -- proving neither notification ate it or produced a
    // stray response of its own.
    proxy.send({ jsonrpc: "2.0", id: 42, method: "tools/list", params: {} });
    const listResp = await proxy.nextMessage();
    assert.equal(listResp.id, 42, "the response after two notifications must be correlated to the real request's id");
    assert.ok(Array.isArray(listResp.result.tools));

    // Exactly two stdout messages total across this whole session: the
    // initial initialize response and this tools/list response -- neither
    // notification produced a line of its own.
    assert.equal(proxy.messages.length, 2, "the two notifications must not have produced any stdout lines");
  } finally {
    proxy.child.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
  }
});

/** Reserve a free TCP port and release it immediately, so a proxy can be
 * pointed at "nothing listening here yet" before something real starts. */
function reserveFreePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

test("never-cache: host down then up succeeds without a restart", async () => {
  const port = await reserveFreePort();
  // Nothing is listening on `port` yet -- the very first call must observe
  // a refused connection, not a cached assumption from some earlier check.
  const proxy = startProxy({ VICE_MCP_URL: `http://127.0.0.1:${port}/mcp` });
  let server;

  try {
    proxy.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    await proxy.nextMessage();

    const pidBefore = proxy.child.pid;

    // Call 1: nothing listening -- must come back as a well-formed
    // isError:true RESULT (Pattern 2's two-category model: a failed tool
    // call is still an answer, never a crash and never a JSON-RPC error
    // object). Generous timeout: with no pre-flight probe yet in place this
    // exhausts the full ~50s reconnect ladder before failing; once task 2's
    // probe lands this same assertion resolves in about a second instead --
    // either way it must eventually come back as isError:true.
    proxy.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "vice_ping", arguments: {} } });
    const down = await proxy.nextMessage(65000);
    assert.equal(down.result.isError, true, "a call against nothing listening must fail as isError:true, not crash");

    // Now start the real stand-in server ON THE SAME PORT.
    const standIn = startStandInServer();
    server = standIn.server;
    await new Promise((resolveListen, rejectListen) => {
      server.listen(port, "127.0.0.1", resolveListen);
      server.once("error", rejectListen);
    });

    // Call 2, same child process, no restart: must succeed now, proving the
    // previous failure was never cached anywhere in the proxy.
    proxy.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "vice_ping", arguments: {} } });
    const up = await proxy.nextMessage(15000);
    assert.equal(up.result.isError, false, "the very next call on the SAME process must succeed once the host is up");

    assert.equal(proxy.child.pid, pidBefore, "both calls must have gone through the same child process -- no restart");
    assert.equal(proxy.child.exitCode, null);
  } finally {
    proxy.child.kill("SIGKILL");
    if (server) await new Promise((resolve) => server.close(resolve));
  }
});

test("never-throw: a broken stdout pipe does not kill the process", async () => {
  const { server } = startStandInServer();
  const port = await listen(server);
  const proxy = startProxy({ VICE_MCP_URL: `http://127.0.0.1:${port}/mcp` });

  try {
    proxy.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    await proxy.nextMessage();

    // Destroy the PARENT's read end of the child's stdout pipe. On this
    // platform/runtime this is expected to make the child's NEXT
    // process.stdout.write() fail with EPIPE -- exactly the filed
    // typescript-sdk#1564 failure class this task hardens against.
    proxy.child.stdout.destroy();
    await new Promise((r) => setTimeout(r, 200));

    // Ask for something that would normally produce a response line. We can
    // no longer read the response (the read end is destroyed), so the
    // PRIMARY signal is process liveness, not stdout content.
    proxy.sendRaw(JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/list", params: {} }));
    await new Promise((r) => setTimeout(r, 300));

    assert.equal(proxy.child.exitCode, null, "a broken stdout pipe must not kill the process");
    assert.equal(proxy.child.signalCode, null, "the process must not have been signalled");

    // Belt-and-suspenders source assertion, per this task's own documented
    // escape hatch: EPIPE-inducibility via destroy() can vary across
    // Node/platform combinations, so this independently confirms the actual
    // defensive code the plan requires is present, regardless of whether
    // this particular runtime reproduced a real EPIPE just now. See
    // 01.1-03-SUMMARY.md's coverage note for this substitution.
    const source = readFileSync(PROXY_PATH, "utf8");
    assert.match(
      source,
      /process\.stdout\.on\(\s*["']error["']/,
      "vice-proxy.mjs must register an 'error' listener on process.stdout"
    );
  } finally {
    proxy.child.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
  }
});

// -----------------------------------------------------------------------
// Plan 01.1-03 task 2: an unreachable emulator produces one of exactly three
// distinct, evidence-carrying diagnoses within about a second -- never a
// blocking wait on withReconnect()'s ~50s ladder, never a generic message
// that sends the reader to the wrong fix.
// -----------------------------------------------------------------------

test("three states: each unreachable shape gets its own message and fix", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vice-proxy-3states-"));

  // ---- Never started: refused, and no restart-epoch record exists at all. ----
  const neverStartedEpochFile = join(dir, "never-written-epoch.json"); // deliberately never written
  const refusedPort1 = await reserveFreePort();
  const proxy1 = startProxy({
    VICE_MCP_URL: `http://127.0.0.1:${refusedPort1}/mcp`,
    VICE_EPOCH_FILE: neverStartedEpochFile,
  });
  let neverStartedText;
  try {
    proxy1.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    await proxy1.nextMessage();

    const startedAt = Date.now();
    proxy1.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "vice_ping", arguments: {} } });
    const resp = await proxy1.nextMessage(10000);
    const elapsedMs = Date.now() - startedAt;

    assert.equal(resp.result.isError, true, "an unreachable host must fail as isError:true");
    neverStartedText = resp.result.content[0].text;
    assert.match(neverStartedText, /never.*started/i, "the never-started shape must say the emulator was never started");
    assert.ok(
      elapsedMs < 10000,
      `the never-started diagnosis must be fail-fast, not the ~50s reconnect ladder -- took ${elapsedMs}ms`
    );
  } finally {
    proxy1.child.kill("SIGKILL");
  }

  // ---- Dead or hung: refused, but a restart-epoch record DOES exist. ----
  const deadOrHungEpochFile = join(dir, "epoch.json");
  writeFileSync(deadOrHungEpochFile, JSON.stringify({ epoch: 5, pid: 4242, spawned_at: "2026-07-31T00:00:00.000Z" }), "utf8");
  const refusedPort2 = await reserveFreePort();
  const proxy2 = startProxy({
    VICE_MCP_URL: `http://127.0.0.1:${refusedPort2}/mcp`,
    VICE_EPOCH_FILE: deadOrHungEpochFile,
  });
  let deadOrHungText;
  try {
    proxy2.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    await proxy2.nextMessage();

    proxy2.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "vice_ping", arguments: {} } });
    const resp = await proxy2.nextMessage(10000);
    assert.equal(resp.result.isError, true);
    deadOrHungText = resp.result.content[0].text;
    assert.match(deadOrHungText, /dead or hung/i);
    assert.match(deadOrHungText, /4242/, "the pid read from the epoch file must appear in the dead-or-hung message");
  } finally {
    proxy2.child.kill("SIGKILL");
  }

  // ---- Alive, but the operation itself failed. ----
  function startAliveButFailingServer() {
    const requests = [];
    const server = createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        let msg;
        try {
          msg = JSON.parse(body);
        } catch {
          msg = null;
        }
        requests.push(msg);
        if (msg && msg.method === "initialize") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "stand-in", version: "0" } },
            })
          );
          return;
        }
        if (msg && msg.method === "tools/call" && msg.params && msg.params.name === "vice_ping") {
          const payload = { version: "3.10", machine: "C64SC", execution: "paused" };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(payload) }] } })
          );
          return;
        }
        if (msg && msg.method === "tools/call") {
          // Any OTHER tool call is rejected with a genuine JSON-RPC error --
          // "reachable, but this particular request failed".
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              error: { code: -32000, message: "no such memory range mapped: $FFFF-$FFFF" },
            })
          );
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ jsonrpc: "2.0", id: msg && "id" in msg ? msg.id : null, error: { code: -32601, message: "unsupported" } })
        );
      });
    });
    return { server, requests };
  }

  const { server: aliveServer } = startAliveButFailingServer();
  const alivePort = await listen(aliveServer);
  const proxy3 = startProxy({ VICE_MCP_URL: `http://127.0.0.1:${alivePort}/mcp` });
  let aliveButFailedText;
  try {
    proxy3.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    await proxy3.nextMessage();

    proxy3.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "vice_memory_read", arguments: {} } });
    const resp = await proxy3.nextMessage(10000);
    assert.equal(resp.result.isError, true);
    aliveButFailedText = resp.result.content[0].text;
    assert.match(
      aliveButFailedText,
      /no such memory range mapped: \$FFFF-\$FFFF/,
      "the host's own error text must be relayed verbatim, not paraphrased"
    );
    assert.doesNotMatch(
      aliveButFailedText,
      /restart/i,
      "the alive-but-failed message must NOT carry a host-restart instruction"
    );
  } finally {
    proxy3.child.kill("SIGKILL");
    await new Promise((resolve) => aliveServer.close(resolve));
  }

  // ---- Cross-cutting assertions across all three shapes. ----
  assert.notEqual(neverStartedText, deadOrHungText, "never-started and dead-or-hung messages must be pairwise distinct");
  assert.notEqual(neverStartedText, aliveButFailedText, "never-started and alive-but-failed messages must be pairwise distinct");
  assert.notEqual(deadOrHungText, aliveButFailedText, "dead-or-hung and alive-but-failed messages must be pairwise distinct");

  for (const text of [neverStartedText, deadOrHungText, aliveButFailedText]) {
    assert.match(text, /(^|\s)\/\S+/, "every unreachable-adjacent message must quote an absolute path");
    assert.match(text, /only route/i, "every unreachable-adjacent message must state this is the only route");
  }

  rmSync(dir, { recursive: true, force: true });
});

// -----------------------------------------------------------------------
// Plan 01.1-03 task 3: an absolute container path inside the workspace
// reaches the host only in its translated host form; an absolute path
// outside the workspace is refused before any forwarding; a non-path
// argument (an address, a relative path, a plain number) passes through
// byte-identical -- devcontainer-host-path itself is never modified by
// this plan (verified separately, outside this file, via `git diff
// --name-only -- .claude/skills/devcontainer-host-path`).
// -----------------------------------------------------------------------

test("path translation: container paths cannot reach the host", async () => {
  const { server, requests } = startStandInServer();
  const port = await listen(server);
  const proxy = startProxy({ VICE_MCP_URL: `http://127.0.0.1:${port}/mcp` });

  try {
    proxy.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    await proxy.nextMessage();

    const root = repoRoot();
    const containerPath = join(root, "CLAUDE.md"); // a real, stable, repo-relative file
    const expectedHostPath = hostPath(containerPath);
    assert.notEqual(
      expectedHostPath,
      containerPath,
      "hostPath() must actually translate in this environment for this test to be meaningful"
    );

    // Translated case: a top-level path, one nested inside an object, and
    // one nested inside an array, all in the SAME call.
    proxy.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "vice_ping",
        arguments: {
          path: containerPath,
          nested: { inner: containerPath },
          list: ["ok", containerPath],
        },
      },
    });
    const resp = await proxy.nextMessage();
    assert.equal(resp.result.isError, false);

    const forwarded = requests.find(
      (r) => r && r.method === "tools/call" && r.params && r.params.arguments && Object.prototype.hasOwnProperty.call(r.params.arguments, "path")
    );
    assert.ok(forwarded, "the stand-in server must have received the forwarded call carrying the translated path");
    assert.equal(forwarded.params.arguments.path, expectedHostPath, "a top-level path must be translated to hostPath(containerPath)");
    assert.notEqual(forwarded.params.arguments.path, containerPath, "the container path must NOT reach the host untranslated");
    assert.equal(forwarded.params.arguments.nested.inner, expectedHostPath, "a path nested inside an object must be translated");
    assert.equal(forwarded.params.arguments.list[1], expectedHostPath, "a path nested inside an array must be translated");
    assert.equal(forwarded.params.arguments.list[0], "ok", "a non-path element alongside a translated one is untouched");

    // Out-of-workspace case: refused before the SENSITIVE path ever reaches
    // the host. (The pre-flight liveness probe still runs -- it always
    // does, for every non-deny-listed call -- so this asserts that no
    // request carrying "/etc/passwd" appears, rather than a raw
    // before/after request-count delta that the probe's own harmless ping
    // traffic would spuriously fail.)
    proxy.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "vice_ping", arguments: { path: "/etc/passwd" } },
    });
    const refused = await proxy.nextMessage();
    assert.equal(refused.result.isError, true, "an out-of-workspace absolute path must be refused");
    assert.match(refused.result.content[0].text, /arguments\.path/, "the refusal must name the argument position");
    assert.ok(
      refused.result.content[0].text.includes(root),
      "the refusal must name the workspace root"
    );
    assert.ok(
      !requests.some((r) => r && r.method === "tools/call" && r.params && r.params.arguments && r.params.arguments.path === "/etc/passwd"),
      "the refusal must happen before forwarding -- /etc/passwd must never reach the stand-in server"
    );

    // Pass-through case: a hex address, a relative path, and an integer all
    // arrive at the host byte-identical -- the structural rule never
    // touches a non-absolute-path string or a non-string value.
    proxy.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "vice_ping", arguments: { address: "$0400", relpath: "recovery/danish/dump.bin", count: 42 } },
    });
    const passthrough = await proxy.nextMessage();
    assert.equal(passthrough.result.isError, false);
    const lastForwarded = requests.find(
      (r) => r && r.method === "tools/call" && r.params && r.params.arguments && r.params.arguments.address === "$0400"
    );
    assert.ok(lastForwarded, "the pass-through call must have reached the host");
    assert.equal(lastForwarded.params.arguments.address, "$0400", "a hex-address-shaped string must not be touched");
    assert.equal(lastForwarded.params.arguments.relpath, "recovery/danish/dump.bin", "a relative path must not be touched");
    assert.equal(lastForwarded.params.arguments.count, 42, "a non-string value must not be touched");
  } finally {
    proxy.child.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
  }
});

// Regression: the workspace boundary must be checked against a NORMALIZED
// path. Before this, isInsideWorkspace() compared the raw string, so any value
// merely beginning with the root's characters passed -- and hostPath() does not
// refuse a normalizing-outward path either (it falls through to mount-based
// translation by design), so the check here was the only boundary and a lexical
// ".." walked straight through it into a real host path outside the workspace.
//
// Both directions matter, which is why one test covers both: refuse what
// escapes, and still accept what merely LOOKS like it escapes but resolves back
// inside. A fix that only refused any string containing ".." would pass the
// first assertion and fail the second.
test("path translation: a lexical .. cannot escape the workspace, and one that resolves back inside still translates", async () => {
  const { server, requests } = startStandInServer();
  const port = await listen(server);
  const proxy = startProxy({ VICE_MCP_URL: `http://127.0.0.1:${port}/mcp` });

  try {
    proxy.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    await proxy.nextMessage();

    const root = repoRoot();

    // Built by string concatenation, NOT join()/resolve() -- both would collapse
    // the ".." here and destroy the very thing under test.
    const escaping = `${root}/../../../etc/passwd`;
    assert.ok(escaping.startsWith(root), "the probe must lexically start with the root, or it proves nothing");

    proxy.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "vice_ping", arguments: { path: escaping } },
    });
    const refused = await proxy.nextMessage();
    assert.equal(refused.result.isError, true, "a path that resolves outside the workspace must be refused");
    assert.match(refused.result.content[0].text, /arguments\.path/, "the refusal must name the argument position");
    assert.ok(
      !requests.some(
        (r) =>
          r &&
          r.method === "tools/call" &&
          r.params &&
          r.params.arguments &&
          typeof r.params.arguments.path === "string" &&
          /etc\/passwd/.test(r.params.arguments.path)
      ),
      "nothing naming /etc/passwd may reach the host -- in translated or untranslated form"
    );

    // The complement: ".." that resolves back inside is legitimate and must be
    // normalized and translated, not refused.
    const insideViaDotDot = `${root}/subdir/../CLAUDE.md`;
    const expected = hostPath(join(root, "CLAUDE.md"));
    proxy.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "vice_ping", arguments: { path: insideViaDotDot } },
    });
    const accepted = await proxy.nextMessage();
    assert.equal(accepted.result.isError, false, "a .. that resolves back inside the workspace must not be refused");
    const forwarded = requests.find(
      (r) => r && r.method === "tools/call" && r.params && r.params.arguments && r.params.arguments.path === expected
    );
    assert.ok(forwarded, "the normalized path must be forwarded as its host form");
    assert.ok(
      !forwarded.params.arguments.path.includes(".."),
      "the host must never be handed a path still carrying a .. segment"
    );
  } finally {
    proxy.child.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
  }
});

// -----------------------------------------------------------------------
// Plan 01.2-01 task 2: every session-ending path releases the lease, an
// idle session keeps it alive via the unref'd heartbeat, and the deferred-
// acquisition property (C3) has its own dedicated regression guard. Every
// test in this section that needs a REAL lease drives one forwarded
// tools/call through the full broker round trip (request -> grant ->
// forward) via acquireLeaseViaBroker() below, since ensureBrokerLease()
// only creates a lease on the FIRST forwarded call.
// -----------------------------------------------------------------------

function runBrokerOnceDryRun(dir, basePort, extraEnv = {}) {
  return execFileP("bash", [BROKER_SCRIPT, "--once", "--dry-run"], {
    env: {
      ...process.env,
      VICE_SUPERVISOR_ALLOW_CONTAINER: "1",
      VICE_POOL_DIR: dir,
      VICE_BROKER_BASE_PORT: String(basePort),
      VICE_BROKER_SPARES: "0",
      ...extraEnv,
    },
  });
}

/** Poll `predicate` to a bounded deadline rather than sleeping a fixed
 * duration -- this task's own convention for waiting on a filesystem
 * effect. Returns predicate()'s truthy result, or null on timeout. */
async function waitForCondition(predicate, { timeoutMs = 8000, pollMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}

function initThenListParams() {
  return { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } };
}

async function handshake(proxy) {
  proxy.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: initThenListParams() });
  await proxy.nextMessage();
  proxy.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  await proxy.nextMessage();
}

/** Drives ONE forwarded tools/call through the full request -> grant ->
 * forward round trip, returning the request/lease id and its lease path
 * once the call has resolved. Shared by every test below that needs a REAL
 * lease held before it can meaningfully assert that ending the session
 * releases it. */
async function acquireLeaseViaBroker(proxy, dir, port, callId) {
  // Plan 01.2-03 task 1: ensureBrokerLease() now classifies broker liveness
  // BEFORE writing any request (C10) -- never_started returns immediately
  // with no request written at all. A broker.json with a fresh heartbeat
  // must therefore already exist for this helper's request-then-grant flow
  // to reach the request-writing step -- runBrokerOnceDryRun() below would
  // write one too, but only AFTER the broker has run a pass, which is too
  // late for a request to have been written in the first place. Written
  // directly (not via the real script) so this helper stays independent of
  // needing the broker to have run first.
  writeFileSync(join(dir, "broker.json"), JSON.stringify({ version: 1, pid: process.pid, heartbeat_at: new Date().toISOString() }), "utf8");

  proxy.send({ jsonrpc: "2.0", id: callId, method: "tools/call", params: { name: "vice_ping", arguments: {} } });

  const reqDir = join(dir, "requests");
  const reqFiles = await waitForCondition(() => {
    if (!existsSync(reqDir)) return null;
    const files = readdirSync(reqDir).filter((f) => f.endsWith(".json"));
    return files.length > 0 ? files : null;
  });
  assert.ok(reqFiles, "a request file must appear before the broker has run");
  const id = reqFiles[0].replace(/\.json$/, "");

  await runBrokerOnceDryRun(dir, port);
  await proxy.nextMessage(); // the forwarded call's own response

  const leasePath = join(dir, "leases", id);
  assert.ok(existsSync(leasePath), "a lease file must exist once the call has resolved");
  return { id, leasePath };
}

const ENDING_TRIGGERS = [
  { name: "SIGINT", end: (proxy) => proxy.child.kill("SIGINT") },
  { name: "SIGTERM", end: (proxy) => proxy.child.kill("SIGTERM") },
  { name: "SIGHUP", end: (proxy) => proxy.child.kill("SIGHUP") },
  { name: "stdin end", end: (proxy) => proxy.child.stdin.end() },
  { name: "stdin close", end: (proxy) => proxy.child.stdin.destroy() },
];

for (const trigger of ENDING_TRIGGERS) {
  test(`ending path releases the lease: ${trigger.name}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "vice-proxy-ending-"));
    const { server } = startStandInServer();
    const port = await listen(server);
    const proxy = startProxy({
      VICE_POOL_DIR: dir,
      VICE_BROKER_BASE_PORT: String(port),
      VICE_EPOCH_FILE: join(dir, "epoch.json"),
    });
    try {
      await handshake(proxy);
      const { leasePath } = await acquireLeaseViaBroker(proxy, dir, port, 3);

      trigger.end(proxy);

      const gone = await waitForCondition(() => !existsSync(leasePath));
      assert.ok(gone, `${trigger.name} must release the lease`);
    } finally {
      proxy.child.kill("SIGKILL");
      await new Promise((resolve) => server.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("idempotency: SIGINT followed by SIGTERM ~50ms later releases exactly once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vice-proxy-idem-"));
  const { server } = startStandInServer();
  const port = await listen(server);
  const proxy = startProxy({
    VICE_POOL_DIR: dir,
    VICE_BROKER_BASE_PORT: String(port),
    VICE_EPOCH_FILE: join(dir, "epoch.json"),
  });
  try {
    await handshake(proxy);
    const { leasePath } = await acquireLeaseViaBroker(proxy, dir, port, 3);

    proxy.child.kill("SIGINT");
    const gone = await waitForCondition(() => !existsSync(leasePath));
    assert.ok(gone, "SIGINT must release the lease");

    await new Promise((r) => setTimeout(r, 50));
    // A sentinel written at the SAME path a second trigger arriving after
    // teardown has already run must NEVER touch -- onTeardown's own guard
    // means releaseLeaseNow isn't even called a second time, not merely
    // that a second unlink against an absent file happens to be harmless.
    writeFileSync(leasePath, JSON.stringify({ version: 1, id: "sentinel" }));
    proxy.child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(
      existsSync(leasePath),
      "a second ending trigger after teardown has already run must be a complete no-op -- the sentinel must survive"
    );
    assert.equal(proxy.child.exitCode, null, "the process stays alive throughout (no process.exit anywhere in the handler)");
  } finally {
    proxy.child.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a lease already removed out from under the proxy: teardown does not throw, process stays observable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vice-proxy-already-removed-"));
  const { server } = startStandInServer();
  const port = await listen(server);
  const proxy = startProxy({
    VICE_POOL_DIR: dir,
    VICE_BROKER_BASE_PORT: String(port),
    VICE_EPOCH_FILE: join(dir, "epoch.json"),
  });
  try {
    await handshake(proxy);
    const { leasePath } = await acquireLeaseViaBroker(proxy, dir, port, 3);

    // Simulate the broker's own sweep (or an operator) removing the lease
    // out from under the still-running proxy, BEFORE any ending trigger.
    rmSync(leasePath, { force: true });

    proxy.child.kill("SIGINT");
    await new Promise((r) => setTimeout(r, 300));

    assert.equal(
      proxy.child.exitCode,
      null,
      "the process must still be alive/observable after teardown against an already-gone lease"
    );
  } finally {
    proxy.child.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("heartbeat: with a short interval and no further tool calls, the lease's mtime advances at least twice", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vice-proxy-heartbeat-"));
  const { server } = startStandInServer();
  const port = await listen(server);
  const proxy = startProxy({
    VICE_POOL_DIR: dir,
    VICE_BROKER_BASE_PORT: String(port),
    VICE_EPOCH_FILE: join(dir, "epoch.json"),
    VICE_BROKER_HEARTBEAT_MS: "150",
  });
  try {
    await handshake(proxy);
    const { leasePath } = await acquireLeaseViaBroker(proxy, dir, port, 3);

    const mtime0 = statSync(leasePath).mtimeMs;
    // No further tool calls issued from here on -- only the unref'd
    // heartbeat timer should touch the lease.
    const mtime1 = await waitForCondition(
      () => {
        const m = statSync(leasePath).mtimeMs;
        return m > mtime0 ? m : null;
      },
      { timeoutMs: 4000 }
    );
    assert.ok(mtime1, "the lease's mtime must advance at least once via the heartbeat with no further tool calls");

    const mtime2 = await waitForCondition(
      () => {
        const m = statSync(leasePath).mtimeMs;
        return m > mtime1 ? m : null;
      },
      { timeoutMs: 4000 }
    );
    assert.ok(mtime2, "the lease's mtime must advance a SECOND time -- proving a repeating timer, not a one-off touch");
  } finally {
    proxy.child.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("heartbeat timer is unref'd: the child exits after stdin closes, even with a lease held", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vice-proxy-heartbeat-unref-"));
  const { server } = startStandInServer();
  const port = await listen(server);
  const proxy = startProxy({
    VICE_POOL_DIR: dir,
    VICE_BROKER_BASE_PORT: String(port),
    VICE_EPOCH_FILE: join(dir, "epoch.json"),
    VICE_BROKER_HEARTBEAT_MS: "100",
  });
  try {
    await handshake(proxy);
    await acquireLeaseViaBroker(proxy, dir, port, 3);

    const exitPromise = new Promise((resolveExit) => {
      proxy.child.once("exit", (code, signal) => resolveExit({ code, signal }));
    });
    proxy.child.stdin.end(); // the abrupt-ending path -- no signal, stdin closes
    const result = await Promise.race([exitPromise, new Promise((r) => setTimeout(() => r(null), 5000))]);
    assert.ok(result, "the child must exit naturally within 5s of stdin closing -- the heartbeat timer must not hold it open");
  } finally {
    proxy.child.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("C3 regression guard: initialize + tools/list alone write no request and no lease, ever", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vice-proxy-c3-"));
  const { server, requests } = startStandInServer();
  const port = await listen(server);
  const proxy = startProxy({
    VICE_POOL_DIR: dir,
    VICE_BROKER_BASE_PORT: String(port),
    VICE_EPOCH_FILE: join(dir, "epoch.json"),
  });
  try {
    await handshake(proxy);

    assert.equal(existsSync(join(dir, "requests")), false, "no requests directory may exist after handshake alone");
    assert.equal(existsSync(join(dir, "leases")), false, "no leases directory may exist after handshake alone");
    assert.equal(requests.length, 0, "the stand-in host must never have been contacted by the handshake alone");
    assert.equal(proxy.child.exitCode, null, "the proxy must still be alive");
  } finally {
    proxy.child.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("teardown region: no promise-awaiting construct, and releaseLease() called exactly once, between its markers", () => {
  const source = readFileSync(PROXY_PATH, "utf8");
  const beginIdx = source.indexOf("TEARDOWN-REGION-BEGIN");
  const endIdx = source.indexOf("TEARDOWN-REGION-END");
  assert.ok(beginIdx !== -1, "TEARDOWN-REGION-BEGIN marker must be present in vice-proxy.mjs");
  assert.ok(endIdx !== -1 && endIdx > beginIdx, "TEARDOWN-REGION-END marker must be present after the begin marker");
  const region = source.slice(beginIdx, endIdx);

  // No promise-awaiting construct anywhere in the region -- scoped to this
  // slice only, since the whole-file forwarding path (call(), pollGrant())
  // is legitimately asynchronous and would trip a whole-file scan.
  assert.doesNotMatch(region, /\bawait\b/, "the teardown region must contain no await");
  assert.doesNotMatch(region, /\.then\s*\(/, "the teardown region must contain no .then(");
  assert.doesNotMatch(region, /\basync\s+function\b|\basync\s*\(/, "the teardown region must define no async function");

  // Exactly one filesystem call: releaseLease() (vice-broker-client.mjs) IS
  // that one synchronous fs operation (an attempted unlinkSync) -- this
  // region calls INTO it rather than performing the unlink itself, so
  // asserting the call site appears exactly once is this region's own
  // version of "exactly one filesystem call".
  const releaseLeaseCalls = region.match(/releaseLease\(/g) || [];
  assert.equal(releaseLeaseCalls.length, 1, "the teardown region must call releaseLease() exactly once");
});

// -----------------------------------------------------------------------
// Plan 01.2-03 task 1: a missing/dead/denying on-demand broker produces one
// of exactly three distinct, evidence-carrying diagnoses -- never-started,
// dead-or-hung, launch-failed -- mirroring the host-unreachable triple
// above (line ~1074) but answering a DIFFERENT question (is the BROKER
// reachable, not the host VICE MCP server). never-started and dead-or-hung
// both fail fast, with no request or lease ever written; launch-failed and
// a warming timeout both clean up the request/lease they created. The
// proxy stays alive and forwards successfully on the SAME process the
// instant the broker is up (C11).
// -----------------------------------------------------------------------

test("broker three states: each broker-absent shape gets its own message and fix", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vice-proxy-broker3states-"));

  // ---- Never started: no broker.json at all. ----
  const proxy1 = startProxy({ VICE_POOL_DIR: dir, VICE_EPOCH_FILE: join(dir, "epoch.json") });
  let neverStartedText;
  try {
    await handshake(proxy1);
    const startedAt = Date.now();
    proxy1.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "vice_ping", arguments: {} } });
    const resp = await proxy1.nextMessage(10000);
    const elapsedMs = Date.now() - startedAt;
    assert.equal(resp.result.isError, true);
    neverStartedText = resp.result.content[0].text;
    assert.match(neverStartedText, /never.*started/i, "the never-started shape must say the broker was never started");
    assert.ok(
      elapsedMs < GRANT_POLL_TIMEOUT_MS / 2,
      `the never-started diagnosis must be fail-fast, well under half the grant-poll deadline (${GRANT_POLL_TIMEOUT_MS}ms) -- took ${elapsedMs}ms`
    );
    assert.equal(existsSync(join(dir, "requests")), false, "never-started must write no request file");
    assert.equal(existsSync(join(dir, "leases")), false, "never-started must write no lease file");
  } finally {
    proxy1.child.kill("SIGKILL");
  }

  // ---- Dead or hung: broker.json exists but its heartbeat is stale. ----
  const staleHeartbeat = new Date(Date.now() - 999999999).toISOString(); // far past any stale threshold
  writeFileSync(join(dir, "broker.json"), JSON.stringify({ version: 1, pid: 7777, heartbeat_at: staleHeartbeat }), "utf8");
  const proxy2 = startProxy({ VICE_POOL_DIR: dir, VICE_EPOCH_FILE: join(dir, "epoch2.json") });
  let deadOrHungText;
  try {
    await handshake(proxy2);
    proxy2.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "vice_ping", arguments: {} } });
    const resp = await proxy2.nextMessage(10000);
    assert.equal(resp.result.isError, true);
    deadOrHungText = resp.result.content[0].text;
    assert.match(deadOrHungText, /dead or hung/i);
    assert.match(deadOrHungText, /7777/, "the pid recorded in the planted broker.json must appear in the dead-or-hung message");
    assert.equal(existsSync(join(dir, "requests")), false, "dead-or-hung must write no request file");
  } finally {
    proxy2.child.kill("SIGKILL");
  }
  rmSync(join(dir, "broker.json"), { force: true });

  // ---- Alive, but the launch itself was denied. ----
  const freshHeartbeat = new Date().toISOString();
  writeFileSync(join(dir, "broker.json"), JSON.stringify({ version: 1, pid: 8888, heartbeat_at: freshHeartbeat }), "utf8");
  const proxy3 = startProxy({ VICE_POOL_DIR: dir, VICE_EPOCH_FILE: join(dir, "epoch3.json") });
  let launchFailedText;
  try {
    await handshake(proxy3);
    proxy3.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "vice_ping", arguments: {} } });

    const reqDir = join(dir, "requests");
    const reqFiles = await waitForCondition(() => {
      if (!existsSync(reqDir)) return null;
      const files = readdirSync(reqDir).filter((f) => f.endsWith(".json"));
      return files.length > 0 ? files : null;
    });
    assert.ok(reqFiles, "a request file must appear before the denial is planted -- the broker is alive");
    const deniedRequestId = reqFiles[0].replace(/\.json$/, "");
    const deniedLeasePath = join(dir, "leases", deniedRequestId);
    assert.ok(existsSync(deniedLeasePath), "a lease file must exist once the request has been written");

    const denialsDirPath = join(dir, "denials");
    mkdirSync(denialsDirPath, { recursive: true });
    const marker = "MARKER-8f2c1a-no-free-ports-available";
    writeFileSync(
      join(denialsDirPath, `${deniedRequestId}.json`),
      JSON.stringify({ version: 1, id: deniedRequestId, reason: marker, denied_at: new Date().toISOString() }),
      "utf8"
    );

    const resp = await proxy3.nextMessage(10000);
    assert.equal(resp.result.isError, true);
    launchFailedText = resp.result.content[0].text;
    assert.match(launchFailedText, new RegExp(marker), "the denial's own reason must appear unmodified in the result");
    assert.doesNotMatch(launchFailedText, /restart/i, "the launch-failed message must NOT carry a restart instruction");

    const gone = await waitForCondition(
      () => !existsSync(deniedLeasePath) && !existsSync(join(reqDir, `${deniedRequestId}.json`))
    );
    assert.ok(gone, "a denied acquisition must clean up both the request file and the lease file it created");
  } finally {
    proxy3.child.kill("SIGKILL");
  }

  // ---- Cross-cutting assertions across all three shapes. ----
  assert.notEqual(neverStartedText, deadOrHungText, "never-started and dead-or-hung messages must be pairwise distinct");
  assert.notEqual(neverStartedText, launchFailedText, "never-started and launch-failed messages must be pairwise distinct");
  assert.notEqual(deadOrHungText, launchFailedText, "dead-or-hung and launch-failed messages must be pairwise distinct");

  for (const text of [neverStartedText, deadOrHungText, launchFailedText]) {
    assert.match(text, /(^|\s)\/\S+/, "every broker-absent message must quote an absolute path");
    assert.match(text, /only route/i, "every broker-absent message must state this is the only route");
  }

  rmSync(dir, { recursive: true, force: true });
});

test("broker never-cache: absent-then-alive-and-granted succeeds on the SAME process, no restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vice-proxy-broker-nevercache-"));
  const { server } = startStandInServer();
  const port = await listen(server);
  const proxy = startProxy({
    VICE_POOL_DIR: dir,
    VICE_BROKER_BASE_PORT: String(port),
    VICE_EPOCH_FILE: join(dir, "epoch.json"),
  });
  try {
    await handshake(proxy);
    const pidBefore = proxy.child.pid;

    // Call 1: no broker.json at all -- must observe the never-started
    // message. The proxy stays alive and caches nothing.
    proxy.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "vice_ping", arguments: {} } });
    const down = await proxy.nextMessage(10000);
    assert.equal(down.result.isError, true);
    assert.match(down.result.content[0].text, /never.*started/i);
    assert.equal(proxy.child.exitCode, null, "the proxy must still be running after the never-started diagnosis");

    // Call 2, SAME process, no restart: runBrokerOnceDryRun() both marks the
    // broker alive (writes broker.json) and grants the now-pending request.
    const { leasePath } = await acquireLeaseViaBroker(proxy, dir, port, 4);
    assert.ok(existsSync(leasePath), "the second call must succeed and hold a real lease, with no restart between calls");

    assert.equal(proxy.child.pid, pidBefore, "both calls must have gone through the same child process -- no restart");
    assert.equal(proxy.child.exitCode, null);
  } finally {
    proxy.child.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("broker: a malformed broker.json (truncated, wrong type, empty) is treated as absent, never a throw", async () => {
  const malformedShapes = [
    { label: "truncated", content: '{"version": 1, "pid": 123, "heartbeat' },
    { label: "wrong type", content: "[1, 2, 3]" },
    { label: "empty", content: "" },
  ];

  for (const shape of malformedShapes) {
    const dir = mkdtempSync(join(tmpdir(), `vice-proxy-broker-malformed-${shape.label.replace(/\s+/g, "-")}-`));
    writeFileSync(join(dir, "broker.json"), shape.content, "utf8");
    const proxy = startProxy({ VICE_POOL_DIR: dir, VICE_EPOCH_FILE: join(dir, "epoch.json") });
    try {
      await handshake(proxy);
      proxy.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "vice_ping", arguments: {} } });
      const resp = await proxy.nextMessage(10000);
      assert.equal(resp.result.isError, true, `a ${shape.label} broker.json must still answer isError:true, never crash`);
      assert.match(
        resp.result.content[0].text,
        /never.*started/i,
        `a ${shape.label} broker.json must be treated as absent (never-started), not a parse error`
      );
      assert.equal(proxy.child.exitCode, null, `the proxy must stay alive against a ${shape.label} broker.json`);
    } finally {
      proxy.child.kill("SIGKILL");
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("broker warming: a poll timeout with no grant or denial is a warming-and-retry result, and cleans up after itself", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vice-proxy-broker-warming-"));
  const freshHeartbeat = new Date().toISOString();
  writeFileSync(join(dir, "broker.json"), JSON.stringify({ version: 1, pid: 9999, heartbeat_at: freshHeartbeat }), "utf8");

  const proxy = startProxy({
    VICE_POOL_DIR: dir,
    VICE_EPOCH_FILE: join(dir, "epoch.json"),
    VICE_BROKER_GRANT_TIMEOUT_MS: "300", // short deadline -- nothing will ever grant or deny this request
  });
  try {
    await handshake(proxy);
    proxy.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "vice_ping", arguments: {} } });

    const reqDir = join(dir, "requests");
    const reqFiles = await waitForCondition(() => {
      if (!existsSync(reqDir)) return null;
      const files = readdirSync(reqDir).filter((f) => f.endsWith(".json"));
      return files.length > 0 ? files : null;
    });
    assert.ok(reqFiles, "a request file must appear -- the broker is alive, so an attempt is made");
    const requestId = reqFiles[0].replace(/\.json$/, "");
    const leasePath = join(dir, "leases", requestId);
    assert.ok(existsSync(leasePath), "a lease file must exist once the request has been written");

    const resp = await proxy.nextMessage(10000);
    assert.equal(resp.result.isError, true);
    assert.match(resp.result.content[0].text, /warming/i, "a poll timeout with neither grant nor denial must read as warming-and-retry");
    assert.match(resp.result.content[0].text, /retry/i);

    const gone = await waitForCondition(
      () => !existsSync(leasePath) && !existsSync(join(reqDir, `${requestId}.json`))
    );
    assert.ok(gone, "a warming timeout must clean up both the request file and the lease file it created");
  } finally {
    proxy.child.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});
