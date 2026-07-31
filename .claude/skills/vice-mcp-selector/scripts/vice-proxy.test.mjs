// node:test coverage of vice-proxy.mjs's stdio-MCP-server half, driven as a
// REAL spawned child process (matching vice-pool.test.mjs's own idiom: real
// subprocess, no module-boundary mocking) with an in-process node:http
// stand-in standing in for the host VICE MCP server. This is what makes the
// phase verifiable with the host emulator completely down -- see
// 01.1-RESEARCH.md's Validation Architecture and this project's own
// STATE.md HARD BLOCKER history for why that property matters here
// specifically.
//
// Coverage note for plan 01.1-03 (never-throw hardening task): NEITHER test
// below directly triggers `process.on('uncaughtException', ...)` or an
// EPIPE on `process.stdout`'s `'error'` listener -- both handlers are
// installed in vice-proxy.mjs and exercised only incidentally (by staying
// silent) in this file. Plan 01.1-03 task 1 is where dedicated tests for
// those two handlers land; this comment exists so that work EXTENDS this
// file rather than duplicating its harness.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROXY_PATH = join(HERE, "vice-proxy.mjs");

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

    const toolCallsSeen = requests.filter((r) => r && r.method === "tools/call");
    assert.equal(toolCallsSeen.length, 1, "the stand-in server must have received exactly one tools/call");
    assert.equal(toolCallsSeen[0].params.name, "vice_ping");

    // 5. The proxy process must still be alive and answering -- this is the
    //    whole point of the never-throw discipline (finding 7: a dead stdio
    //    server is never reconnected).
    assert.equal(proxy.child.exitCode, null, "the proxy process must still be running");
    assert.equal(proxy.child.killed, false);
  } finally {
    proxy.child.kill();
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
    proxy.child.kill();
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
    assert.equal(tools.length, 2, "both fixture tools must come back");

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
    proxy.child.kill();
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
        assert.deepEqual(resp.result.tools, [], `expected an empty tools array for ${manifestFile}`);

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
        assert.deepEqual(secondList.result.tools, []);

        assert.equal(proxy.child.exitCode, null, "the proxy process must still be running");
        assert.equal(proxy.child.killed, false);
      } finally {
        proxy.child.kill();
      }
    }
    assert.equal(requests.length, 0, "no manifest-read path may ever reach the stand-in host");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
