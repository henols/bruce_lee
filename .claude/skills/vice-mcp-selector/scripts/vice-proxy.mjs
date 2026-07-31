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
import { call, activeInstance, DENY_LIST, readEpoch, beginSession, MachineRestartedError } from "../../vice-session/scripts/vice.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE_DIR = dirname(fileURLToPath(import.meta.url));

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
// A pure, offline read of the committed schema snapshot (decision D-C).
// `refresh-manifest.mjs` is the ONLY writer of that file -- this handler
// never fetches, never awaits a network call, and never throws. Any problem
// with the snapshot (absent, unparseable, wrong shape) degrades to a
// well-formed empty `tools` array plus one stderr line naming the path and
// the reason, never a fetch and never a hang.
//
// The output-size ceiling this proxy enforces (task 3's continuation logic)
// is declared here too, on every tool entry via `_meta`, so the ceiling a
// caller is TOLD about and the ceiling actually enforced are the same single
// number -- see OUTPUT_CHAR_CAP below, the one definition both sites read.
const OUTPUT_CHAR_CAP = (() => {
  const n = Number(process.env.VICE_MAX_RESULT_CHARS);
  return Number.isFinite(n) && n > 0 ? n : 500000;
})();

// The synthetic continuation tool (task 3, decision D-E): served entirely
// inside this proxy, NEVER forwarded to the host, and advertised in every
// tools/list response exactly like a real tool so an agent can discover it
// the same way it discovers everything else.
const RESULT_CONTINUE_TOOL = {
  name: "vice_result_continue",
  description:
    "Retrieve the next chunk of an oversized tools/call result that vice-proxy split across a " +
    "continuation sequence. Served entirely inside this proxy -- never forwarded to the host VICE " +
    "MCP server, and has no counterpart there.",
  inputSchema: {
    type: "object",
    properties: {
      token: {
        type: "string",
        description: "the continuation token named in the previous chunk's trailing marker",
      },
    },
    required: ["token"],
  },
};

function manifestPath() {
  return process.env.VICE_TOOLS_MANIFEST
    ? resolve(process.env.VICE_TOOLS_MANIFEST)
    : join(HERE_DIR, "tools-manifest.json");
}

function readManifestTools() {
  const path = manifestPath();
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    console.error(
      `vice-proxy: tools-manifest not readable at ${path} (${e.message}) -- answering tools/list with an empty tools array`
    );
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error(
      `vice-proxy: tools-manifest at ${path} is not valid JSON (${e.message}) -- answering tools/list with an empty tools array`
    );
    return [];
  }
  const shapeOk =
    parsed &&
    Array.isArray(parsed.tools) &&
    parsed.tools.every((t) => t && typeof t === "object" && typeof t.name === "string");
  if (!shapeOk) {
    console.error(
      `vice-proxy: tools-manifest at ${path} has an unexpected shape ("tools" must be an array of objects ` +
        `each carrying a string "name") -- answering tools/list with an empty tools array`
    );
    return [];
  }
  return parsed.tools;
}

function handleToolsList() {
  // Two independent transforms applied at READ time, not write time, so a
  // stale or hand-edited snapshot can never leak either property:
  //   1. re-filter DENY_LIST -- refresh-manifest.mjs's serverInfo() call
  //      already filters at write time; this is the second, independent
  //      layer that catches a snapshot generated by any other means.
  //   2. stamp the same output-size ceiling this proxy enforces onto every
  //      tool, not a curated subset -- the host's tool set is not this
  //      repo's to enumerate.
  const manifestTools = readManifestTools().filter((t) => !DENY_LIST.includes(t.name));
  const tools = [...manifestTools, RESULT_CONTINUE_TOOL].map((t) => ({
    ...t,
    _meta: { ...(t._meta || {}), "anthropic/maxResultSizeChars": OUTPUT_CHAR_CAP },
  }));
  return { tools };
}

// --------------------------------------------------------------- tools/call
//
// Delegates every real call to the reused `call()` -- the retry ladder
// already lives there (Pattern 1). Per Pattern 2, EVERY outcome of a tool
// invocation attempt -- success or failure -- becomes a JSON-RPC *result*
// carrying `content`/`isError`, never a JSON-RPC `error` object. A JSON-RPC
// `error` is reserved for genuinely missing/malformed `params` on this
// method itself, thrown as a `ProtocolError` and caught one layer up in
// `handleMessage()`.
//
// Two hazards are enforced HERE, at the proxy seam, as independent layers on
// top of what `call()` already does internally:
//
//   1. vice_disk_list refusal. `call()` already refuses it (throwing a
//      ViceError), but this proxy refuses it FIRST, before any forwarding
//      logic runs and before any network attempt, so the refusal is
//      observable with zero HTTP traffic and a well-formed MCP frame rather
//      than one more layer of catch between the hazard and the answer.
//
//   2. Per-call epoch re-check (decision D-D). The proxy does NOT call
//      assertSameMachine() and does NOT probe vice_checkpoint_list -- a
//      state-reading call that pauses the emulated CPU and never resumes it,
//      and the proxy arms no checkpoints of its own to probe with anyway.
//      The narrowed contract is a plain readEpoch() comparison, before AND
//      after every forwarded call: a changed epoch refuses the call (or
//      discards its result, if the change happened mid-call) with a loud,
//      evidence-carrying error naming both epoch values, then adopts the new
//      value as the baseline so the SESSION stays usable -- a restart report
//      is never cached, per criterion 6.
// NEVER-CACHE-A-NEGATIVE-RESULT INVARIANT (plan 01.1-03 task 1, criterion 6):
// nothing below this line may memoise "the host is down" as a fact that
// outlives a single tools/call. There is no cached probe verdict, no sticky
// "last known unreachable" flag, and no early-return short-circuit keyed off
// a PREVIOUS failure -- every forwarded tools/call re-evaluates reachability
// from scratch (the epoch check below reads the file fresh every time; the
// liveness probe added in task 2 does its own fresh network round trip every
// time; task 3's translation runs fresh every time). This is deliberate and
// easy to break by a later, performance-minded edit ("let's skip the probe
// if we just failed one 200ms ago") -- don't. A cached negative here is
// exactly the "quiet wrong answer" failure class this codebase rejects
// elsewhere (MachineRestartedError, the epoch re-check itself).
let viceSession = null; // beginSession()'s return value, set lazily on the first forwarded call
let epochBaseline = null; // the rolling comparison point; updated on every re-baseline

function ensureViceSession() {
  if (!viceSession) {
    viceSession = beginSession();
    epochBaseline = viceSession.baseline;
  }
}

function currentEpoch() {
  return readEpoch(viceSession.epochPath);
}

function epochChanged(baseline, current) {
  return Boolean(baseline?.present) && Boolean(current?.present) && baseline.epoch !== current.epoch;
}

function epochDriftMessage(when, baseline, current) {
  const pidNote = current && current.pid != null ? `, pid ${current.pid}` : "";
  const spawnedNote = current && current.spawned_at ? `, spawned_at ${current.spawned_at}` : "";
  return (
    `vice-proxy: epoch drift detected ${when} -- the host VICE MCP server's epoch changed from ` +
    `${baseline.epoch} to ${current.epoch}${pidNote}${spawnedNote}. Any work done since the previous ` +
    `call may have hit a different, freshly-booted machine and should be redone.`
  );
}

/**
 * Compare the rolling baseline against a fresh epoch read. Returns an error
 * MESSAGE string if the comparison proves a restart (and re-baselines to the
 * new value so the next call is not refused again), or `null` if the call
 * may proceed (including the "absent baseline, now present" case, which is
 * adopted silently -- a supervisor merely started, not a restart, mirroring
 * vice.mjs's own "only compare when both are present" rule).
 */
function checkEpochAndRebaseline(when) {
  const current = currentEpoch();
  if (epochChanged(epochBaseline, current)) {
    const msg = epochDriftMessage(when, epochBaseline, current);
    epochBaseline = current; // never cache a negative result (criterion 6)
    return msg;
  }
  if (!epochBaseline.present && current.present) {
    epochBaseline = current;
  }
  return null;
}

function isErrorText(text) {
  return { content: [{ type: "text", text }], isError: true };
}

// ------------------------------------------------------- oversized results
//
// Decision D-E: the `_meta["anthropic/maxResultSizeChars"]` declaration
// above raises the real limit far past the 25,000-token default, but a
// second, proxy-side cap catches whatever still overruns it (a 64K RAM read
// in any plausible encoding, per ROADMAP criterion 5). Nothing on this path
// may silently shorten a payload -- there is no truncation branch. An
// oversized result is split and served in full across an explicit
// continuation sequence via one synthetic tool (`vice_result_continue`,
// declared above), so the caller can always reassemble the whole payload.
//
// The store is bounded so a long session cannot grow it without limit: at
// most MAX_CONTINUATIONS outstanding sequences, oldest evicted first (a
// `Map` preserves insertion order, so its first key is always the oldest).
// An evicted or exhausted token fails loudly with advice to narrow the
// original call rather than resume it -- there is nothing left to resume.
const CONTINUATION_STORE = new Map(); // token -> { chunks: string[], nextIndex: number, totalChunks: number, totalChars: number }
const MAX_CONTINUATIONS = 5;
let continuationCounter = 0;

function nextContinuationToken() {
  continuationCounter += 1;
  return `cont-${process.pid}-${Date.now()}-${continuationCounter}`;
}

function chunkMarkerText({ chunkIndex, totalChunks, totalChars, token }) {
  if (chunkIndex >= totalChunks) {
    return (
      `vice-proxy: chunk ${chunkIndex} of ${totalChunks} (last chunk) -- ${totalChars} total characters ` +
      `served across this continuation sequence.`
    );
  }
  return (
    `vice-proxy: chunk ${chunkIndex} of ${totalChunks} -- ${totalChars} total characters. Call ` +
    `vice_result_continue with arguments {"token":"${token}"} to retrieve the next chunk.`
  );
}

/**
 * Wrap a successful call's serialised text, splitting it across a
 * continuation sequence if (and only if) it exceeds OUTPUT_CHAR_CAP. Under
 * the cap, behaves exactly as an unchunked result always has: a single
 * `content` item, nothing else appended. Over the cap, the FIRST content
 * item is the pure payload chunk -- byte-for-byte, no marker text mixed in,
 * so reassembly is a plain concatenation -- and a SECOND content item
 * carries the marker, naming the exact next call to make.
 */
function wrapPossiblyChunked(text) {
  if (text.length <= OUTPUT_CHAR_CAP) {
    return { content: [{ type: "text", text }], isError: false };
  }

  const totalChars = text.length;
  const pieces = [];
  for (let i = 0; i < text.length; i += OUTPUT_CHAR_CAP) {
    pieces.push(text.slice(i, i + OUTPUT_CHAR_CAP));
  }
  const totalChunks = pieces.length;
  const [first, ...remaining] = pieces;

  const token = nextContinuationToken();
  while (CONTINUATION_STORE.size >= MAX_CONTINUATIONS) {
    const oldestToken = CONTINUATION_STORE.keys().next().value;
    CONTINUATION_STORE.delete(oldestToken);
  }
  CONTINUATION_STORE.set(token, { chunks: remaining, nextIndex: 2, totalChunks, totalChars });

  return {
    content: [
      { type: "text", text: first },
      { type: "text", text: chunkMarkerText({ chunkIndex: 1, totalChunks, totalChars, token }) },
    ],
    isError: false,
  };
}

/** Handles `vice_result_continue` -- served entirely inside this proxy;
 * NEVER reaches `call()` or the network. */
function handleResultContinue(args) {
  const token = args && typeof args.token === "string" ? args.token : null;
  if (!token || !CONTINUATION_STORE.has(token)) {
    return isErrorText(
      `vice-proxy: continuation token "${token}" is unknown or has already expired. Re-issue the ` +
        `original tools/call with a narrower range instead of resuming.`
    );
  }
  const entry = CONTINUATION_STORE.get(token);
  const chunk = entry.chunks.shift();
  const chunkIndex = entry.nextIndex;
  entry.nextIndex += 1;
  const isLast = entry.chunks.length === 0;
  if (isLast) {
    CONTINUATION_STORE.delete(token);
  }
  return {
    content: [
      { type: "text", text: chunk },
      {
        type: "text",
        text: chunkMarkerText({ chunkIndex, totalChunks: entry.totalChunks, totalChars: entry.totalChars, token }),
      },
    ],
    isError: false,
  };
}

async function handleToolsCall(params) {
  const name = params && params.name;
  if (!name || typeof name !== "string") {
    throw new ProtocolError(-32602, "tools/call requires params.name to be a non-empty string");
  }
  const args = params && typeof params.arguments === "object" && params.arguments !== null ? params.arguments : {};

  // The synthetic continuation tool: entirely a proxy-local concern, served
  // before any deny-list or epoch logic and NEVER forwarded to the host.
  if (name === "vice_result_continue") {
    return handleResultContinue(args);
  }

  // Layer 1: call-time deny-list refusal, before any forwarding logic and
  // before any network attempt. Independent from handleToolsList()'s
  // discovery-time filter -- removing either one leaves the other standing.
  if (DENY_LIST.includes(name)) {
    return isErrorText(
      `${name} is permanently forbidden -- it is known to crash the shared host VICE MCP server. ` +
        `Recovery requires a manual, host-side restart. This refusal is permanent; retrying will not help.`
    );
  }

  ensureViceSession();

  const beforeDrift = checkEpochAndRebaseline("before forwarding");
  if (beforeDrift) {
    // Refused BEFORE any request is serialised -- the whole point of the
    // pre-forward check.
    return isErrorText(beforeDrift);
  }

  let payload;
  try {
    payload = await call(name, args);
  } catch (e) {
    if (e instanceof MachineRestartedError) {
      // call()'s own post-reconnect fast path detected this first -- convert
      // to the same isError frame shape and re-baseline identically. Two
      // layers, one observable behaviour.
      const current = currentEpoch();
      epochBaseline = current;
      return isErrorText(
        `vice-proxy: epoch drift detected mid-call -- the host VICE MCP server's epoch changed from ` +
          `${e.baselineEpoch} to ${e.currentEpoch}. Any work done since the previous call may have hit ` +
          `a different, freshly-booted machine and should be redone. (${e.message})`
      );
    }
    // NEVER rethrow past this point -- a tool-execution failure (transport
    // error, a rejected RPC) is a normal, expected outcome for this method
    // and must come back as a well-formed result, not crash the read loop.
    return isErrorText(e && e.message ? e.message : String(e));
  }

  const afterDrift = checkEpochAndRebaseline("after the call returned");
  if (afterDrift) {
    // A payload read from a machine whose identity changed mid-call is not
    // trustworthy -- return the restart frame INSTEAD OF the call's result.
    return isErrorText(afterDrift);
  }

  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return wrapPossiblyChunked(text);
}

// ---------------------------------------------------------- message dispatch
//
// Structural validation runs BEFORE the hasId/method dispatch below, and is
// deliberately stricter than "does this look like a notification": a value
// that parsed as valid JSON but is not an object at all (a bare number, a
// string, an array), or an object with a missing/non-string "method", is not
// a well-formed JSON-RPC message of EITHER kind (request or notification) --
// there is no `id` field to trust as evidence of intent either way, so per
// spec this is always answered with an Invalid Request (-32600) error,
// keyed to whatever `id` the malformed value happens to carry (or `null`
// if it carries none / isn't even an object). Silently dropping it as if it
// were a "notification we don't understand" would hide a caller bug behind
// the never-throw discipline instead of surfacing it.
async function handleMessage(msg) {
  if (msg === null || typeof msg !== "object" || Array.isArray(msg)) {
    return errorResponse(null, -32600, "Invalid Request: message is not a JSON object");
  }
  const hasId = Object.prototype.hasOwnProperty.call(msg, "id");
  const id = hasId ? msg.id : null;
  const method = msg.method;
  if (typeof method !== "string" || method.length === 0) {
    return errorResponse(id, -32600, 'Invalid Request: missing or non-string "method"');
  }
  const params = msg.params;

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
    // A well-formed message (valid object, valid string method) naming a
    // method this proxy does not implement. Answered ONLY if the caller
    // expected an answer -- a notification-shaped message with an unknown
    // method name is still just consumed, per the same "never respond to a
    // message with no id" rule as notifications/initialized above.
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
//
// A single shared `shutdown()` function is the ONLY place `process.exit(`
// appears in this file -- both listeners call it rather than each carrying
// their own `process.exit(0)` literal, so the source assertion this task's
// acceptance criteria specify ("excluding comment lines, vice-proxy.mjs
// contains exactly one `process.exit(` occurrence, and it is on the stdin
// end/close path") stays true even though there are two listeners.
function shutdown() {
  process.exit(0);
}
process.stdin.on("end", shutdown);
process.stdin.on("close", shutdown);

console.error(`vice-proxy: ready, forwarding to ${activeInstance().url} (port ${activeInstance().port})`);
