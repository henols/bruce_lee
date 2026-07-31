#!/usr/bin/env node
// A stdio MCP server that forwards to the host VICE MCP server over HTTP.
// Claude Code spawns exactly one copy of this per session (per its own
// `.mcp.json` `vice` entry) and speaks newline-delimited JSON-RPC 2.0 to it
// over stdin/stdout. This file owns ONLY that stdio-server-facing half --
// the HTTP-client half (retry ladder, SSE-body parsing, the vice_disk_list
// deny-list, epoch-based restart detection) is `call()` and its siblings,
// imported unchanged from the relocated `vice-session` transport module.
// Re-implementing that half here would duplicate code that has already
// survived six real host outages; see 01.1-RESEARCH.md's "Don't Hand-Roll"
// table.
//
// Cross-skill relative import, deliberate and TEMPORARY: `vice-session`
// still owns the transport module as of this task. Plan 01.1-04 relocates
// it into this skill and rewrites this import to `./vice.mjs`. Until then
// this is the same cross-skill shape `c64-ram-capture/scripts/ram-capture.mjs`
// already uses for `devcontainer-host-path`.
import { call, activeInstance } from "../../vice-session/scripts/vice.mjs";
import { readFileSync } from "node:fs";

// -------------------------------------------------------------- never-throw
//
// Per RESEARCH.md Pitfall 3: a stdio MCP server is NEVER auto-reconnected by
// Claude Code once it dies (finding 7), so any uncaught throw here strands
// the session's emulator access for the rest of the session, silently. This
// is registered FIRST, before anything else in the module runs, so it is in
// effect for every line below it -- including the ES-module import above,
// which already executed by the time this file's own body starts, but every
// subsequent async operation this file performs is covered.
//
// The one correct exit path is stdin `end`/`close` -- normal session
// shutdown -- handled separately below. Never `process.exit()` from either
// handler here.
process.on("uncaughtException", (err) => {
  console.error(`vice-proxy: uncaughtException (ignored, staying alive): ${err && err.stack ? err.stack : err}`);
});
process.on("unhandledRejection", (reason) => {
  console.error(`vice-proxy: unhandledRejection (ignored, staying alive): ${reason && reason.stack ? reason.stack : reason}`);
});
// An EPIPE on `stdout.write()` (Claude Code closing the pipe abruptly) throws
// SYNCHRONOUSLY with no listener attached -- this is the exact class of the
// filed, confirmed defect in the official MCP TypeScript SDK,
// modelcontextprotocol/typescript-sdk#1564. Attaching a listener here turns
// that into a benign, logged event instead of a crash.
process.stdout.on("error", (err) => {
  console.error(`vice-proxy: stdout write error (ignored): ${err && err.message ? err.message : err}`);
});

// ------------------------------------------------------------------ wire IO
//
// Spec-literal per modelcontextprotocol.io/specification/draft/basic/transports:
// newline-delimited JSON-RPC, one message per line, no embedded newlines,
// and the server MUST NOT write anything to stdout that is not a valid MCP
// message. All logging in this file goes to stderr, never stdout.
function writeMessage(msg) {
  let line;
  try {
    line = JSON.stringify(msg);
  } catch (e) {
    console.error(`vice-proxy: failed to serialise outgoing message (ignored): ${e.message}`);
    return;
  }
  try {
    process.stdout.write(line + "\n");
  } catch (e) {
    // Belt-and-suspenders alongside the 'error' listener above -- some
    // failure modes throw synchronously even with a listener attached on
    // certain Node versions/streams; never let this propagate.
    console.error(`vice-proxy: stdout write threw (ignored): ${e.message}`);
  }
}

function respond(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** Thrown for genuine JSON-RPC protocol problems (unknown method, malformed
 * params) -- per RESEARCH.md Pattern 2, these are the ONLY cases that become
 * a JSON-RPC `error` object rather than an `isError:true` result. */
class ProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ------------------------------------------------------------- initialize
//
// Version negotiation rule (per spec): echo back the client's requested
// version if this proxy supports it; otherwise respond with the newest
// version the proxy itself supports. Zero HTTP requests happen here -- the
// whole point of criterion 4 (enumerate/initialize with no emulator
// acquired).
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2024-11-05"];
const PROXY_VERSION = "0.1.0";

function handleInitialize(params) {
  const requested = params && typeof params.protocolVersion === "string" ? params.protocolVersion : null;
  const protocolVersion = requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : SUPPORTED_PROTOCOL_VERSIONS[0];
  return {
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "vice", version: PROXY_VERSION },
  };
}

// --------------------------------------------------------------- tools/list
//
// Tracer scope ONLY (per this task's <action>): read a static manifest file
// named by VICE_TOOLS_MANIFEST if it is set and readable, else answer an
// empty `tools` array. Deliberately does NOT call the host -- that is what
// keeps this method's zero-HTTP-request property true. Plan 01.1-02 task 1
// replaces this with the committed schema snapshot; this tracer needs only
// enough to prove the method is answered without touching the host at all.
function handleToolsList() {
  const manifestPath = process.env.VICE_TOOLS_MANIFEST;
  if (manifestPath) {
    try {
      const raw = readFileSync(manifestPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.tools)) {
        return { tools: parsed.tools };
      }
      console.error(
        `vice-proxy: VICE_TOOLS_MANIFEST (${manifestPath}) did not contain a "tools" array -- falling back to an empty list`
      );
    } catch (e) {
      console.error(
        `vice-proxy: VICE_TOOLS_MANIFEST (${manifestPath}) could not be read/parsed (${e.message}) -- falling back to an empty list`
      );
    }
  }
  return { tools: [] };
}

// --------------------------------------------------------------- tools/call
//
// Delegates every real call to the reused `call()` -- the retry ladder,
// deny-list refusal and epoch check all already live there (Pattern 1). Per
// Pattern 2, EVERY outcome of a tool invocation attempt -- success or
// failure -- becomes a JSON-RPC *result* carrying `content`/`isError`, never
// a JSON-RPC `error` object. A JSON-RPC `error` is reserved for genuinely
// missing/malformed `params` on this method itself, thrown as a
// `ProtocolError` and caught one layer up in `handleMessage()`.
async function handleToolsCall(params) {
  const name = params && params.name;
  if (!name || typeof name !== "string") {
    throw new ProtocolError(-32602, "tools/call requires params.name to be a non-empty string");
  }
  const args = params && typeof params.arguments === "object" && params.arguments !== null ? params.arguments : {};
  try {
    const payload = await call(name, args);
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    return { content: [{ type: "text", text }], isError: false };
  } catch (e) {
    // NEVER rethrow past this point -- a tool-execution failure (transport
    // error, deny-list refusal, a rejected RPC) is a normal, expected
    // outcome for this method and must come back as a well-formed result,
    // not crash the read loop.
    return { content: [{ type: "text", text: e && e.message ? e.message : String(e) }], isError: true };
  }
}

// ---------------------------------------------------------- message dispatch
async function handleMessage(msg) {
  const hasId = msg !== null && typeof msg === "object" && Object.prototype.hasOwnProperty.call(msg, "id");
  const id = hasId ? msg.id : undefined;
  const method = msg && typeof msg === "object" ? msg.method : undefined;
  const params = msg && typeof msg === "object" ? msg.params : undefined;

  try {
    if (method === "initialize") {
      const result = handleInitialize(params);
      return hasId ? respond(id, result) : null;
    }
    if (method === "notifications/initialized") {
      // A notification: consume it, write nothing at all.
      return null;
    }
    if (method === "tools/list") {
      const result = handleToolsList();
      return hasId ? respond(id, result) : null;
    }
    if (method === "tools/call") {
      const result = await handleToolsCall(params);
      return hasId ? respond(id, result) : null;
    }
    // Unknown method: a genuine protocol problem.
    return hasId ? errorResponse(id, -32601, `Method not found: ${method}`) : null;
  } catch (e) {
    if (e instanceof ProtocolError) {
      return hasId ? errorResponse(id, e.code, e.message) : null;
    }
    // Never-throw discipline extends even to bugs in this dispatcher itself:
    // an unexpected internal error becomes a JSON-RPC error response (never
    // an uncaught throw), keyed to whatever id the request carried.
    return hasId ? errorResponse(id, -32603, `internal error: ${e && e.message ? e.message : String(e)}`) : null;
  }
}

// -------------------------------------------------------------- stdin loop
//
// Spec-literal per RESEARCH.md's "Don't Hand-Roll" table: a minimal,
// line-buffered split on `\n`, one `JSON.parse` per line -- no smart
// framing, no length-prefixing, nothing beyond what the wire format actually
// requires. A malformed line yields a JSON-RPC parse-error RESPONSE (per
// spec, `id: null` since the id could not even be determined), never a
// crash.
let buffer = "";

function handleLine(line) {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch (e) {
    writeMessage({ jsonrpc: "2.0", id: null, error: { code: -32700, message: `Parse error: ${e.message}` } });
    return;
  }

  handleMessage(msg)
    .then((response) => {
      if (response) writeMessage(response);
    })
    .catch((e) => {
      // Defensive: handleMessage() itself already never rejects by design,
      // but this is the never-throw discipline applied one more layer out,
      // matching the module-level uncaughtException/unhandledRejection
      // handlers above.
      console.error(`vice-proxy: handleMessage rejected unexpectedly (ignored): ${e && e.message ? e.message : e}`);
    });
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    handleLine(line);
  }
});

// The one exit path that IS correct: stdin end/close is normal session
// shutdown (Claude Code's termination ladder is stdin EOF -> SIGTERM ->
// SIGKILL). "Never exits" means never on an error path, not never at all.
process.stdin.on("end", () => {
  process.exit(0);
});
process.stdin.on("close", () => {
  process.exit(0);
});

console.error(`vice-proxy: ready, forwarding to ${activeInstance().url} (port ${activeInstance().port})`);
