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
import { resolve, dirname } from "node:path";
import { readFileSync } from "node:fs";

const SELF = fileURLToPath(import.meta.url);

const ENDPOINT = process.env.VICE_MCP_URL || "http://host.docker.internal:6510/mcp";
const DEFAULT_TIMEOUT_MS = Number(process.env.VICE_MCP_TIMEOUT_MS || 30000);

// Where tools/vice-supervisor.sh (host-only) writes its restart epoch --
// resolved relative to THIS file's own location (never hardcoded), so the
// path is correct regardless of the caller's cwd. Overridable for tests and
// for anyone running the supervisor with a non-default
// VICE_SUPERVISOR_DIR.
export const EPOCH_FILE = process.env.VICE_EPOCH_FILE
  ? resolve(process.env.VICE_EPOCH_FILE)
  : resolve(dirname(SELF), "..", ".vice-supervisor", "epoch.json");

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

/**
 * Thrown when a reconnect happened and the emulator's identity across that
 * reconnect could not be proven -- either the epoch file shows it changed,
 * or nothing (no epoch file, no surviving armed checkpoint) could prove it
 * didn't (D-3, D-4). Carries the evidence a caller needs to write a void
 * note: the epochs compared, where in the pipeline the check ran, and the
 * last tool call attempted before detection (see lastToolCall() below).
 */
export class MachineRestartedError extends ViceError {
  constructor(message, { baselineEpoch, currentEpoch, where, lastToolCall } = {}) {
    super(message);
    this.name = "MachineRestartedError";
    this.baselineEpoch = baselineEpoch;
    this.currentEpoch = currentEpoch;
    this.where = where;
    this.lastToolCall = lastToolCall;
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
 *
 * Under host-side supervision (tools/vice-supervisor.sh), this retry can now
 * SUCCEED -- against a brand-new, blank machine with no disk attached, no
 * checkpoints armed and the CPU halted at the BASIC prompt. A success here is
 * therefore no longer proof that nothing happened; it is exactly the signal
 * the session-identity section below (readEpoch/assertSameMachine) exists to
 * catch. Do not remove one half of this pairing without the other.
 */
async function withReconnect(toolName, args, opts) {
  lastCallSummary = summarizeCall(toolName, args);
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
      // Session-identity signal (D-3): this is the ONLY place that knows a
      // reconnect was forced. Bump the counter every attempt, not just on
      // eventual success -- call()'s cheap epoch check and
      // assertSameMachine()'s checkpoint-fallback probe both key off this.
      reconnectCount++;
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
      `-- recovery is a HOST-SIDE restart, which this container cannot perform. Run ` +
      `tools/vice-supervisor.sh on the HOST (see its header comment) -- it restarts x64sc ` +
      `automatically and logs the crash for the still-open root-cause investigation.`
  );
}

// ------------------------------------------------------- session identity
//
// WHY this lives in the transport seam, not in tools/recover.mjs: this file
// is the only place that knows a reconnect happened at all. Once
// tools/vice-supervisor.sh is respawning x64sc on the host, withReconnect()'s
// retry-with-backoff above starts SUCCEEDING again -- but potentially against
// a completely different, freshly-booted machine. Turning that "quiet
// success" back into a loud, checkable signal is the whole point of this
// section (D-3, D-4).
//
// Module-level state, deliberately NOT per-call-argument: there is one
// active recovery session per process (recover.mjs's CLI runs one verb at a
// time), so beginSession()/assertSameMachine() read and reset this state
// directly rather than threading it through every call() site.
let currentSession = null; // set by beginSession(): { baseline, epochPath, startedAt }
let reconnectCount = 0; // reset by beginSession(); incremented by withReconnect(); "consumed" (reset) by assertSameMachine()
let lastCallSummary = null; // last tool call attempted, for D-4 evidence in a void note

/** `${toolName} ${args}`, truncated to ~120 chars -- D-4 wants the last call before a
 * detected restart, not a full transcript. */
function summarizeCall(toolName, args) {
  let argsStr;
  try {
    argsStr = JSON.stringify(args);
  } catch {
    argsStr = String(args);
  }
  const full = `${toolName} ${argsStr}`;
  return full.length > 120 ? `${full.slice(0, 117)}...` : full;
}

/**
 * Read the supervisor's epoch file. Synchronous -- this is a plain, cheap
 * file read; the whole point of the epoch check is that it costs zero MCP
 * traffic, unlike the checkpoint-fallback probe. NEVER throws: absence is
 * normal (no supervisor running at all) and must not be an error (D-3) --
 * the harness has to keep working exactly as it does today with no
 * supervisor.
 *
 * Treats the file's contents as untrusted, host-written input (T-jty-01):
 * JSON.parse in try/catch, `epoch` must decode to a finite integer, unknown
 * fields are ignored, and no path derived from the file's contents is ever
 * opened.
 */
export function readEpoch(path = EPOCH_FILE) {
  const absent = { present: false, epoch: null, spawned_at: null, pid: null, path };
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { ...absent, reason: "epoch file absent" };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...absent, reason: "epoch file present but not valid JSON" };
  }
  if (parsed === null || typeof parsed !== "object" || !Number.isInteger(parsed.epoch)) {
    return { ...absent, reason: "epoch file present but its \"epoch\" field is not a finite integer" };
  }
  return {
    present: true,
    epoch: parsed.epoch,
    spawned_at: typeof parsed.spawned_at === "string" ? parsed.spawned_at : null,
    pid: Number.isFinite(parsed.pid) ? parsed.pid : null,
    path,
  };
}

/**
 * Start a new identity-tracking session: capture the current epoch as the
 * baseline every later check compares against, and zero the reconnect
 * counter so a PRIOR session's reconnects (e.g. from a previous `recover()`
 * run inside the same `reproduce()` process) don't leak into this one.
 */
export function beginSession({ epochPath = EPOCH_FILE } = {}) {
  const baseline = readEpoch(epochPath);
  reconnectCount = 0;
  currentSession = { baseline, epochPath, startedAt: new Date().toISOString() };
  return currentSession;
}

/** Read-only accessor: how many transport-forced reconnects since the last
 * beginSession() (or the last assertSameMachine() consumption -- see there). */
export function sessionReconnects() {
  return reconnectCount;
}

/** Read-only accessor: the last tool call attempted (name + truncated args),
 * for D-4 evidence -- populated even for calls that ultimately failed. */
export function lastToolCall() {
  return lastCallSummary;
}

/**
 * Prove (or fail to prove) that the machine behind `session` is still the
 * one that was running at `beginSession()` time. See the plan's `<behavior>`
 * block for the six rules this implements; in short:
 *
 *   - If the epoch file proves a change (baseline and current both present,
 *     different values) -> MachineRestartedError, always, reconnect or not.
 *   - If the epoch file proves NO change (both present, same value) -> pass,
 *     no further (MCP) check needed.
 *   - Otherwise (no epoch evidence either way) and no reconnect happened ->
 *     pass, and no MCP call is made at all -- the whole point of gating the
 *     checkpoint probe behind `reconnected`.
 *   - Otherwise (no epoch evidence, but a reconnect DID happen): fall back to
 *     asking whether a checkpoint the harness itself already armed (never a
 *     new sentinel -- checkpoint work is itself a crash suspect) is still
 *     listed. Present -> pass. Absent, or nothing to probe with -> void.
 *
 * `reconnected` defaults to whether ANY transport-forced reconnect has
 * happened since the last beginSession()/assertSameMachine() call --
 * calling this function CONSUMES that count (resets it to 0) so a later,
 * unrelated assertSameMachine() call (e.g. after this stage's own armed
 * checkpoint has since been deleted) doesn't re-trigger a probe against
 * checkpoints that are supposed to be gone by then.
 */
export async function assertSameMachine(session, {
  where,
  armedCheckpoints = [],
  reconnected = sessionReconnects() > 0,
  call: callFn = call,
} = {}) {
  // Consume the module-level reconnect signal now -- see the doc comment
  // above for why this matters for later, unrelated checks in the same
  // session.
  reconnectCount = 0;

  const currentEpoch = readEpoch(session.epochPath);

  if (session.baseline.present && currentEpoch.present) {
    if (currentEpoch.epoch !== session.baseline.epoch) {
      throw new MachineRestartedError(
        `${where}: the emulator restarted -- epoch changed from ${session.baseline.epoch} to ` +
          `${currentEpoch.epoch}. This run is void; re-run it.`,
        { baselineEpoch: session.baseline.epoch, currentEpoch: currentEpoch.epoch, where, lastToolCall: lastCallSummary }
      );
    }
    return; // epoch proves this is still the same machine -- no MCP call needed
  }

  if (!reconnected) {
    return; // nothing to check, and nothing checked -- no MCP call made
  }

  // A reconnect happened and the epoch file could not confirm sameness
  // (either no supervisor is running at all, or its epoch file just isn't
  // there to compare against). The checkpoint-fallback probe is the only
  // identity signal left -- and it deliberately reuses checkpoints the
  // harness already armed for its own reasons; arming a new sentinel
  // checkpoint was rejected because checkpoint work is itself one of the two
  // leading crash suspects (see STATE.md's HAZARD CANDIDATE entry).
  if (armedCheckpoints.length === 0) {
    throw new MachineRestartedError(
      `${where}: a reconnect happened and identity could not be proven -- no epoch file to compare ` +
        `and no armed checkpoint to probe. Unproven is not the same as fine; re-run the capture. If ` +
        `this recurs, run tools/vice-supervisor.sh on the HOST so future runs have an epoch file to check.`,
      { baselineEpoch: session.baseline.epoch, currentEpoch: currentEpoch.epoch, where, lastToolCall: lastCallSummary }
    );
  }

  let listed;
  try {
    listed = await callFn("vice_checkpoint_list", {});
  } catch (e) {
    throw new MachineRestartedError(
      `${where}: a reconnect happened and the checkpoint-fallback probe itself failed (${e.message}) -- ` +
        `identity could not be proven. Re-run the capture.`,
      { baselineEpoch: session.baseline.epoch, currentEpoch: currentEpoch.epoch, where, lastToolCall: lastCallSummary }
    );
  }
  const liveIds = new Set((listed.checkpoints || []).map((c) => c.checkpoint_num));
  const stillPresent = armedCheckpoints.some((id) => liveIds.has(id));
  if (!stillPresent) {
    throw new MachineRestartedError(
      `${where}: a reconnect happened and none of the harness's own armed checkpoints ` +
        `(${armedCheckpoints.join(", ")}) are listed by vice_checkpoint_list -- the emulator restarted. ` +
        `This run is void; re-run it.`,
      { baselineEpoch: session.baseline.epoch, currentEpoch: currentEpoch.epoch, where, lastToolCall: lastCallSummary }
    );
  }
  // The armed checkpoint survived the reconnect -- demonstrably the same machine.
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
  const reconnectsBefore = reconnectCount;
  const result = await withReconnect(toolName, args, opts);
  // Session-identity fast path (D-3, D-4): if THIS call needed a reconnect,
  // do the cheap epoch check (a synchronous file read, zero extra MCP
  // traffic) right here -- the earliest and loudest possible detection
  // point. A changed epoch throws immediately. We deliberately do NOT run
  // the checkpoint-fallback probe here: that would be a re-entrant call(),
  // and reconnectCount staying > 0 is exactly the module flag
  // assertSameMachine() consumes at its next checkpoint instead.
  if (reconnectCount > reconnectsBefore && currentSession) {
    const nowEpoch = readEpoch(currentSession.epochPath);
    if (currentSession.baseline.present && nowEpoch.present && nowEpoch.epoch !== currentSession.baseline.epoch) {
      throw new MachineRestartedError(
        `${toolName}: the emulator restarted mid-call -- epoch changed from ` +
          `${currentSession.baseline.epoch} to ${nowEpoch.epoch} after a reconnect. This run is void; re-run it.`,
        {
          baselineEpoch: currentSession.baseline.epoch,
          currentEpoch: nowEpoch.epoch,
          where: `call(${toolName})`,
          lastToolCall: lastCallSummary,
        }
      );
    }
  }
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
