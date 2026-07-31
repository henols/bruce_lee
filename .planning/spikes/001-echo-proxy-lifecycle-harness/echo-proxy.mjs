#!/usr/bin/env node
// THE INSTRUMENT. A throwaway stdio MCP server that talks to nothing.
//
// This is the shared measuring device for spikes 001-004. It registers as an
// MCP server through a scratch --mcp-config under --strict-mcp-config, exposes
// one trivial echo tool, and appends a timestamped, pid-tagged JSONL line for
// every lifecycle event it can observe. Spikes 002-004 drive THIS file with
// different env vars rather than forking it, so all four spikes measure the
// same instrument and their logs are directly comparable.
//
// WHY appendFileSync EVERYWHERE, never a write stream: the whole point of
// spike 002 is measuring what completes before SIGKILL. A buffered stream
// loses exactly the lines that matter most -- the last ones. Every log line is
// an unbuffered synchronous append, which is also what makes the busy-wait
// progress measurement trustworthy.
//
// WHY IT NEVER THROWS: mirrors the real proxy's hard requirement (design
// finding 7 -- a dead stdio server is never reconnected by Claude Code). An
// uncaught throw here would also silently truncate a measurement run, which
// would look identical to "the client killed us", corrupting the result.

import { appendFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// ------------------------------------------------------------------ config
//
// Every knob is an env var so the drivers can reconfigure the instrument
// without editing it. Defaults are all "inert": with no env set, this is a
// plain echo proxy that logs and does nothing surprising.
const CFG = {
  log: process.env.ECHO_LOG || "/tmp/echo-proxy.jsonl",
  // Free-text label for the run, so one log file can hold several
  // experiments and the analyzer can still separate them.
  tag: process.env.ECHO_TAG || "untagged",
  // Spike 003: delay before answering initialize / tools/call, to find where
  // the client gives up.
  initDelayMs: Number(process.env.ECHO_INIT_DELAY_MS || 0),
  callDelayMs: Number(process.env.ECHO_CALL_DELAY_MS || 0),
  // Spike 004: size of the payload the echo tool returns.
  payloadBytes: Number(process.env.ECHO_PAYLOAD_BYTES || 0),
  // Spike 002: "log" = handlers only record (observes the full signal ladder,
  // since nothing blocks the event loop). "busywait" = the first teardown
  // signal blocks synchronously, writing a progress line every sliceMs, to
  // measure how much synchronous work completes before SIGKILL.
  teardownMode: process.env.ECHO_TEARDOWN_MODE || "log",
  busywaitBudgetMs: Number(process.env.ECHO_BUSYWAIT_BUDGET_MS || 5000),
  busywaitSliceMs: Number(process.env.ECHO_BUSYWAIT_SLICE_MS || 100),
  // Spike 002: the real design mechanism under test -- a lease file whose
  // ABSENCE is the release signal, unlinked by one synchronous syscall in the
  // shutdown handler. Set to a directory to enable.
  leaseDir: process.env.ECHO_LEASE_DIR || "",
  // Spike 003: periodic liveness line, so an idle session that gets reaped
  // shows a heartbeat gap followed by a signal (or by nothing at all).
  heartbeatMs: Number(process.env.ECHO_HEARTBEAT_MS || 0),
};

// ------------------------------------------------------------------ logging
//
// `ms` is a monotonic clock reading. The ISO timestamp is for humans and for
// correlating across processes; every DELTA in the analysis comes from `ms`,
// because that is the reading that stays sane under clock adjustment and has
// sub-millisecond resolution -- and spike 002's answer is measured in ms.
const t0 = performance.now();
function log(event, extra = {}) {
  try {
    appendFileSync(
      CFG.log,
      JSON.stringify({
        t: new Date().toISOString(),
        ms: Math.round((performance.now() - t0) * 1000) / 1000,
        pid: process.pid,
        ppid: process.ppid,
        tag: CFG.tag,
        event,
        ...extra,
      }) + "\n",
    );
  } catch {
    // A failed log write must never take the process down: that would turn a
    // logging problem into a fake "client killed us" observation.
  }
}

try {
  mkdirSync(dirname(CFG.log), { recursive: true });
} catch {}

// ------------------------------------------------------- never-throw, first
//
// Registered before anything else so it covers every line below it.
process.on("uncaughtException", (err) => {
  log("uncaught_exception", { message: String(err?.message || err), stack: String(err?.stack || "").split("\n").slice(0, 3) });
});
process.on("unhandledRejection", (reason) => {
  log("unhandled_rejection", { reason: String(reason).slice(0, 300) });
});

// ------------------------------------------------------------------- lease
//
// The mechanism spike 002 exists to test. Created at spawn, unlinked in the
// teardown handler. In the real design this file does three jobs at once: its
// existence is the lease, its mtime is the heartbeat, its removal is the
// release signal that tells the host broker to kill the emulator.
let leaseFile = "";
if (CFG.leaseDir) {
  try {
    mkdirSync(CFG.leaseDir, { recursive: true });
    leaseFile = join(CFG.leaseDir, `${process.pid}.lease`);
    writeFileSync(leaseFile, JSON.stringify({ pid: process.pid, tag: CFG.tag, created: new Date().toISOString() }));
    log("lease_created", { leaseFile });
  } catch (err) {
    log("lease_create_failed", { message: String(err?.message || err) });
  }
}

log("spawn", {
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  node: process.version,
  // Claude Code's own session id, if it exports one into the server's env.
  // Whether this is present at all is itself an observation: it decides
  // whether a lease can record "who holds this" as diagnostic metadata.
  env_session: process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CODE_SESSION_ID || null,
  // Which variable actually carried it, and what else the client hands a
  // server. Recorded as key names plus the session-ish values only -- never a
  // blanket env dump, which would drag credentials into a committed log.
  env_claude_keys: Object.keys(process.env).filter((k) => k.startsWith("CLAUDE")).sort(),
  env_session_var: process.env.CLAUDE_SESSION_ID
    ? "CLAUDE_SESSION_ID"
    : process.env.CLAUDE_CODE_SESSION_ID
      ? "CLAUDE_CODE_SESSION_ID"
      : null,
  teardownMode: CFG.teardownMode,
});

// ------------------------------------------------------------------- rpc io
function send(obj) {
  try {
    process.stdout.write(JSON.stringify(obj) + "\n");
  } catch (err) {
    log("stdout_write_failed", { message: String(err?.message || err) });
  }
}

// Synchronous sleep. Deliberately blocking rather than an await: spike 003 is
// measuring the CLIENT's patience, and a blocked event loop is the honest
// simulation of a proxy waiting on a slow host round trip in the pre-warm
// case. It also keeps the delay measurable from the log alone.
function blockMs(ms) {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    /* spin */
  }
}

function bigPayload(bytes) {
  // ~4 chars/token is the usual rule of thumb, so token count is roughly
  // bytes/4. Repeating a short varied token keeps it from compressing into
  // something unrepresentative, and the marker lets the analyzer confirm
  // whether the tail survived or the payload was cut.
  const unit = "MEM $%%%% LDA #$00 STA $D020 ; ";
  let out = `BEGIN_PAYLOAD bytes=${bytes}\n`;
  let i = 0;
  while (out.length < bytes) {
    out += unit.replace("%%%%", (i++).toString(16).padStart(4, "0"));
  }
  return out.slice(0, Math.max(0, bytes - 14)) + "\nEND_PAYLOAD\n";
}

const TOOL = {
  name: "echo_probe",
  description:
    "Lifecycle probe. Echoes back its text argument. Talks to nothing and has no side effects.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string", description: "Text to echo back" } },
    required: ["text"],
  },
};

let callCount = 0;

function handle(msg) {
  const { method, id } = msg;
  log("rpc_in", { method, id: id ?? null });

  if (method === "initialize") {
    if (CFG.initDelayMs > 0) {
      log("init_delay_begin", { delayMs: CFG.initDelayMs });
      blockMs(CFG.initDelayMs);
      log("init_delay_end", { delayMs: CFG.initDelayMs });
    }
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: msg.params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "echo-probe", version: "0.1.0" },
      },
    });
    log("rpc_out", { method, id: id ?? null });
    return;
  }

  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: [TOOL] } });
    log("rpc_out", { method, id: id ?? null, toolCount: 1 });
    return;
  }

  if (method === "tools/call") {
    callCount += 1;
    const n = callCount;
    const text = msg.params?.arguments?.text ?? "";
    log("tool_call_begin", { id: id ?? null, callIndex: n, name: msg.params?.name, text: String(text).slice(0, 120) });
    if (CFG.callDelayMs > 0) {
      log("call_delay_begin", { callIndex: n, delayMs: CFG.callDelayMs });
      blockMs(CFG.callDelayMs);
      log("call_delay_end", { callIndex: n, delayMs: CFG.callDelayMs });
    }
    const body = CFG.payloadBytes > 0 ? bigPayload(CFG.payloadBytes) : `echo:${text}`;
    send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: body }] } });
    log("rpc_out", { method, id: id ?? null, callIndex: n, bytes: body.length });
    return;
  }

  // Empty-but-well-shaped answers for the other list methods. A bare `{}`
  // here would be a protocol error on a client that asks, and a protocol
  // error looks like a crash in the log -- noise in a lifecycle measurement.
  if (method === "resources/list") {
    send({ jsonrpc: "2.0", id, result: { resources: [] } });
    log("rpc_out", { method, id: id ?? null });
    return;
  }
  if (method === "prompts/list") {
    send({ jsonrpc: "2.0", id, result: { prompts: [] } });
    log("rpc_out", { method, id: id ?? null });
    return;
  }
  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    log("rpc_out", { method, id: id ?? null });
    return;
  }

  // Notifications carry no id and must not be answered.
  if (id == null) {
    log("notification_ignored", { method });
    return;
  }

  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  log("rpc_out", { method, id: id ?? null, note: "method-not-found" });
}

// --------------------------------------------------------------- stdin loop
let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      log("parse_error", { line: line.slice(0, 200) });
      continue;
    }
    try {
      handle(msg);
    } catch (err) {
      log("handler_error", { method: msg?.method, message: String(err?.message || err) });
    }
  }
});

// ------------------------------------------------------------------ teardown
//
// Every trigger is logged unconditionally, even after teardown has already
// run, because the ORDER and SPACING of the triggers is the measurement in
// spike 002 -- the first probe already showed SIGINT arriving before SIGTERM
// with stdin never closing, which the design note did not predict.
let teardownRan = false;

function releaseLease(trigger) {
  if (!leaseFile) return;
  const before = performance.now();
  try {
    unlinkSync(leaseFile);
    const after = performance.now();
    log("lease_unlinked", { trigger, elapsedMs: Math.round((after - before) * 1000) / 1000 });
  } catch (err) {
    log("lease_unlink_failed", { trigger, message: String(err?.message || err) });
  }
}

function busywait(trigger) {
  // Blocking on purpose. Writes a progress line every sliceMs so the log
  // records exactly how far this got before the process was killed. The last
  // progress line in the log IS the answer to "how long is the grace window".
  const start = performance.now();
  let slice = 0;
  log("busywait_begin", { trigger, budgetMs: CFG.busywaitBudgetMs, sliceMs: CFG.busywaitSliceMs });
  while (performance.now() - start < CFG.busywaitBudgetMs) {
    const target = start + (slice + 1) * CFG.busywaitSliceMs;
    while (performance.now() < target) {
      /* spin */
    }
    slice += 1;
    log("busywait_progress", { trigger, slice, elapsedMs: Math.round(performance.now() - start) });
  }
  log("busywait_complete", { trigger, slices: slice, elapsedMs: Math.round(performance.now() - start) });
}

function onTeardown(trigger) {
  log("teardown_trigger", { trigger, alreadyRan: teardownRan });
  if (teardownRan) return;
  teardownRan = true;
  // Order matters and mirrors the real design: the one cheap synchronous
  // release op happens FIRST, before anything that could be interrupted.
  releaseLease(trigger);
  if (CFG.teardownMode === "busywait") busywait(trigger);
}

process.stdin.on("end", () => onTeardown("stdin_end"));
process.stdin.on("close", () => onTeardown("stdin_close"));
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(sig, () => onTeardown(sig));
}
// An `exit` line proves a normal exit. Its ABSENCE is how SIGKILL is
// detected -- SIGKILL cannot be observed from inside the process, so the
// missing line is the evidence.
process.on("exit", (code) => log("exit", { code, teardownRan }));

if (CFG.heartbeatMs > 0) {
  const timer = setInterval(() => log("heartbeat", { callCount }), CFG.heartbeatMs);
  timer.unref?.();
  // unref'd so the heartbeat alone never keeps the process alive past its
  // natural lifetime -- stdin being open is what holds it.
  log("heartbeat_armed", { heartbeatMs: CFG.heartbeatMs });
}
