#!/usr/bin/env node
// Single MCP client seam for the host VICE MCP server.  Every emulator
// interaction in this project goes through `call()` -- no other file speaks
// MCP JSON-RPC or raw HTTP to the VICE endpoint directly.
//
// Why a seam at all: Phase 1 tooling and Phase 3's verify/runner.mjs both
// depend on this one transport.  If the handshake shape ever needs to change
// (session header, SSE framing, a curl fallback), it changes here once.
//
// The deny-list is the other reason this file exists: vice_disk_list crashes
// the shared host MCP server (see CLAUDE.md's hazard note and STATE.md's
// blocker entry).  The guard below runs *before* any request is serialised,
// so no caller -- however indirect -- can reach that tool by accident.
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const SELF = fileURLToPath(import.meta.url);

const ENDPOINT = process.env.VICE_MCP_URL || "http://host.docker.internal:6510/mcp";
const DEFAULT_TIMEOUT_MS = Number(process.env.VICE_MCP_TIMEOUT_MS || 30000);

// Forbidden tool names.  Checked by exact string match before any network
// call is made -- see call() below.  Never remove vice_disk_list from this
// list; see the project's own hazard note (CLAUDE.md, STATE.md blockers).
export const DENY_LIST = ["vice_disk_list"];

export class ViceError extends Error {
  constructor(message, { code, data } = {}) {
    super(message);
    this.name = "ViceError";
    this.code = code;
    this.data = data;
  }
}

const die = (m) => { console.error(`error: ${m}`); process.exit(1); };

let reqId = 0;

/**
 * Raw JSON-RPC round trip. Wraps every call in a client-side abort timeout --
 * vice_run_until's own `cycles` timeout is documented as "not yet
 * implemented", so nothing upstream protects us from a hung request; this is
 * that protection, at the transport layer, for every call this seam makes.
 */
async function rpc(method, params, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const id = ++reqId;
  const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      throw new ViceError(
        `${method} timed out after ${timeoutMs}ms -- the host VICE MCP server may be hung or unreachable. ` +
          `Manual recovery: a host-side VICE restart (this container cannot perform it; see recovery/*/NOTES.md).`
      );
    }
    throw new ViceError(`transport error calling ${method}: ${e.message}`);
  }
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();
  let payload;
  if (contentType.includes("text/event-stream")) {
    // SSE-framed body: parse `data:` lines, take the last JSON payload.
    const dataLines = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter(Boolean);
    if (!dataLines.length) {
      throw new ViceError(`no data: lines in SSE response for ${method}`);
    }
    payload = JSON.parse(dataLines[dataLines.length - 1]);
  } else {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ViceError(`non-JSON response for ${method}: ${text.slice(0, 200)}`);
    }
  }
  if (payload.error) {
    throw new ViceError(payload.error.message || `RPC error calling ${method}`, {
      code: payload.error.code,
      data: payload.error.data,
    });
  }
  return payload.result;
}

let initialized = false;
async function ensureInitialized() {
  if (initialized) return;
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "bruce-lee-recover", version: "1.0" },
  });
  initialized = true;
}

// The host server has been observed to drop connections and recover on its own,
// but the outage outlasts a short backoff -- a 6s total budget was measured as
// too short. These values give it ~50s to come back before we declare it dead
// and ask for a manual restart.
const RECONNECT_ATTEMPTS = 5;
const RECONNECT_BACKOFF_MS = [2000, 5000, 12000, 30000, 0];
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A single dropped connection used to be fatal: the error propagated straight
 * out and, worse, `initialized` stayed true, so every later call spoke into a
 * dead session. The host server has been observed both to drop a connection
 * mid-request and to come back moments later, so transport failures are
 * retried with backoff and the session handshake is redone.
 *
 * Only TRANSPORT failures are retried. An RPC-level error (the server answered
 * and said no) is a real answer and is never retried -- retrying a rejected
 * tool call would just repeat a mistake, and for a tool with side effects could
 * repeat it destructively.
 */
async function withReconnect(toolName, args, opts) {
  let lastErr;
  for (let attempt = 0; attempt < RECONNECT_ATTEMPTS; attempt++) {
    try {
      await ensureInitialized();
      return await rpc("tools/call", { name: toolName, arguments: args }, opts);
    } catch (e) {
      const transport = /transport error|timed out|no data: lines|non-JSON response/i.test(e.message);
      if (!transport) throw e;
      lastErr = e;
      initialized = false; // force a fresh handshake -- the old session is gone
      if (attempt < RECONNECT_ATTEMPTS - 1) {
        console.error(
          `warn: ${toolName} transport failure (attempt ${attempt + 1}/${RECONNECT_ATTEMPTS}), ` +
            `reconnecting in ${RECONNECT_BACKOFF_MS[attempt]}ms: ${e.message}`
        );
        await nap(RECONNECT_BACKOFF_MS[attempt]);
      }
    }
  }
  throw new ViceError(
    `${toolName} failed after ${RECONNECT_ATTEMPTS} transport attempts: ${lastErr.message} ` +
      `-- if this persists the host VICE MCP server needs a restart (this container cannot perform it).`
  );
}

/**
 * Call a vice_* tool by name and return its parsed JSON result.
 *
 * Refuses any tool on DENY_LIST before any network request is made -- this
 * check is the first line of the function body, deliberately, so the deny
 * list is enforced even if a future edit reorders the rest of the function.
 */
export async function call(toolName, args = {}, opts = {}) {
  if (DENY_LIST.includes(toolName)) {
    throw new ViceError(
      `${toolName} is permanently forbidden -- it is known to crash the shared host VICE MCP server ` +
        `(see CLAUDE.md's hazard note). Refusing to serialise this request.`
    );
  }
  const result = await withReconnect(toolName, args, opts);
  const content = result?.content?.[0];
  if (!content || content.type !== "text") {
    throw new ViceError(`unexpected tool result shape from ${toolName}: ${JSON.stringify(result)}`);
  }
  try {
    return JSON.parse(content.text);
  } catch {
    return content.text; // a few tools may return plain text; hand it back verbatim
  }
}

// Alias -- some call sites read more naturally as callTool(...).
export const callTool = call;

/** The server's tools/list result (name, description, inputSchema per tool). */
export async function serverInfo() {
  await ensureInitialized();
  return rpc("tools/list", {});
}

// -------------------------------------------------------------------- CLI

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  const [cmd, ...rest] = process.argv.slice(2);

  async function main() {
    if (cmd === "ping") {
      const res = await call("vice_ping", {});
      console.log(`VICE ${res.version} (${res.machine}) -- ${res.execution}`);
      return;
    }
    if (cmd === "call") {
      const toolName = rest[0];
      if (!toolName) die("usage: call <tool-name> [json-args]");
      const args = rest[1] ? JSON.parse(rest[1]) : {};
      const res = await call(toolName, args);
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    console.log(`usage: node ${SELF} <command>

  ping                       print server version, machine, execution state
  call <tool> [json-args]    invoke any vice_* tool and print its JSON result

env: VICE_MCP_URL          override the MCP endpoint (default ${ENDPOINT})
     VICE_MCP_TIMEOUT_MS   per-request abort timeout in ms (default ${DEFAULT_TIMEOUT_MS})`);
    process.exit(cmd ? 1 : 0);
  }

  main().catch((e) => die(e.message));
}
