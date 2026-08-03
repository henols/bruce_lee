#!/usr/bin/env node
// A stdio MCP server that forwards to the host VICE MCP server over HTTP.
// Claude Code spawns exactly one copy of this per session (per its own
// `.mcp.json` `vice` entry) and speaks newline-delimited JSON-RPC 2.0 to it
// over stdin/stdout. This file owns ONLY that stdio-server-facing half --
// the HTTP-client half (retry ladder, SSE-body parsing, the vice_disk_list
// deny-list, epoch-based restart detection) is `call()` and its siblings,
// imported unchanged from the transport module, now a sibling in this
// skill's own `scripts/` directory (plan 01.1-04 relocated it from
// `vice-session`). Re-implementing that half here would duplicate code that
// has already survived six real host outages; see 01.1-RESEARCH.md's
// "Don't Hand-Roll" table.
//
// Sibling import, no longer cross-skill: `vice-session` has been retired
// (plan 01.1-04) and its transport module tree lives here now.
import { call, activeInstance, useInstance, DENY_LIST, readEpoch, beginSession, MachineRestartedError, mcpHost } from "./vice.mjs";
// Sibling import, same relocation as above. probeInstance() is the
// deliberately-fragile liveness check (see that file's own header): one
// 1500ms-budget round trip, no retry, no dependency on vice.mjs's resilient
// reconnect ladder.
import { probeInstance } from "./vice-probe.ts";
import { repoRoot } from "./repo-root.ts";
import { hostPath, SET_ENV_HINT } from "./hostpath.ts";
// The INVERSE direction (host -> container), for inverting a broker grant's
// own host-local coordinates before useInstance() ever adopts them (this
// task, quick-260801-ccn). Consuming this from the proxy -- rather than
// hand-translating a host path here -- is what keeps the host-path consumer
// set closed to a fixed, traced list (vice-mcp-selector-docs.test.mjs's
// assertion 4, amended by this task to include containerpath.ts itself as
// a fifth, sibling consumer of hostpath.mjs's own knowledge).
import { containerizeRecord } from "./containerpath.ts";
// The container-side half of the on-demand broker protocol (Phase 01.2).
// This module deliberately does NOT import hostpath.mjs itself -- the
// host-path consumer set stays closed to four production modules
// (vice-mcp-selector-docs.test.mjs's assertion 4), and this file is already
// on that list, so any broker-related host path text is built HERE.
import {
  newRequestId,
  writeRequest,
  createLease,
  touchLease,
  releaseLease,
  pollGrant,
  startHeartbeat,
  readBrokerLiveness,
  requestsDir,
  brokerRootDir,
  writeRecycleRequest,
  pollRecycleAck,
  RECYCLE_ACK_TIMEOUT_MS,
} from "./vice-broker-client.mjs";
// The recycle path's own incident record (plan 01.3-01) -- written BEFORE
// anything is killed (D-17), never through any network call of its own.
// incidentAssetPath()/incidentAssetStem() (plan 01.3-03) are the SAME stem-
// building logic incidentRecordPath() itself uses -- imported here so the
// evidence gatherer's screenshot and the pre-kill snapshot's name can never
// drift onto a second, independent naming rule.
import { writeIncidentRecord, finaliseIncidentRecord, incidentAssetPath, incidentAssetStem } from "./incident-record.mjs";
import { readFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

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
// There are TWO correct exit paths, not one (spike-findings-bruce-lee
// skill, shutdown-and-lease-release.md): a graceful client shutdown
// delivers SIGINT first (then SIGTERM ~100ms later, then SIGKILL at
// ~490ms) and never closes stdin; an abrupt client death closes stdin
// (`end` then `close`) and never signals. Both are handled separately
// below, by the teardown handler near the bottom of this file. Never
// `process.exit()` from any handler here or there -- see that handler's own
// comment for why nothing needs it.
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

// -------------------------------------------------- output-limit warning
//
// D-1.2-H (plan 01.2-03 task 2). MAX_MCP_OUTPUT_TOKENS genuinely governs
// the CLIENT's own inline-response ceiling (measured at 40-60KB --
// spike-findings-bruce-lee skill, large-response-chunking.md -- about half
// the design's original ~100KB assumption; a 64K RAM read is ~192KB as
// hex, far above either figure). It is read from the client's own process
// environment, set via `.claude/settings.json`'s `env` block, which this
// repo's `.gitignore` makes untrackable (`.claude/*`, `.gitignore` lines
// 62-67) -- the same structural wall plan 01.1-04 hit with
// `.claude/CLAUDE.md`. It genuinely cannot be committed, so this proxy
// documents the required value in a tracked file (`tools/README.md`'s
// "Per-machine setup" section) and makes its OWN inherited environment's
// view of the setting OBSERVABLE on stderr, rather than silently assuming
// it is set. This is a WARNING, never a refusal: nothing throws, no call is
// rejected, and stdout carries only MCP messages (see the stdin-loop
// comment below) -- exactly one stderr line, at most once per process.
//
// Deliberately NOT resolved here, per this task's own instruction: the
// standing 32KB chunking non-negotiable and this proxy's own 500,000-char
// `_meta` ceiling (OUTPUT_CHAR_CAP above) are only compatible if a per-tool
// override is genuinely honoured, which was never measured -- the spike
// bracketed the inline ceiling at 40-60KB with no override set. Recorded as
// a deferred item in this plan's SUMMARY (both numbers, the one open
// question), not fixed by this warning or by changing OUTPUT_CHAR_CAP.
const REQUIRED_MAX_MCP_OUTPUT_TOKENS = 25000;
let outputLimitWarned = false;

function warnOnceAboutOutputLimit() {
  if (outputLimitWarned) return;
  outputLimitWarned = true;
  const raw = process.env.MAX_MCP_OUTPUT_TOKENS;
  const n = Number(raw);
  const sufficient = raw !== undefined && Number.isFinite(n) && n >= REQUIRED_MAX_MCP_OUTPUT_TOKENS;
  if (sufficient) return;
  console.error(
    `vice-proxy: MAX_MCP_OUTPUT_TOKENS is ${raw === undefined ? "not set" : `set to ${raw}`} in this ` +
      `process's environment -- this project requires at least ${REQUIRED_MAX_MCP_OUTPUT_TOKENS}. Set it in ` +
      `.claude/settings.json's "env" block (untracked -- see tools/README.md's "Per-machine setup" ` +
      `section for why and the exact value).`
  );
}

// Two client behaviours this proxy deliberately does NOT rely on, recorded
// here so a later reader does not reach for either as a solution:
//
// 1. MCP_TIMEOUT does NOT extend the startup handshake. The measurement
//    behind that claim tested only a 60s cap against a 10s delay, so it
//    cannot distinguish "honoured but never reached" from "does nothing",
//    and current official documentation describes it as a startup timeout
//    -- genuinely OPEN, not settled. Moot for this proxy either way:
//    handleInitialize() (above) answers with zero host I/O, so there is no
//    slow handshake here that would need extending.
// 2. Automatic backgrounding of long tool calls does NOT apply to this
//    project's dominant call pattern. It covers only main-conversation
//    calls and explicitly excludes calls originating from subagents, and
//    this project's emulator work runs overwhelmingly through executor
//    waves, which are subagent-driven and share their parent session's
//    single proxy connection. brokerWarmingMessage() (below) is therefore
//    the PRIMARY cold-path mechanism, not a fallback for something the
//    client will handle on this project's behalf.

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

// The recycle tool (plan 01.3-01, task 1): the only new HOST-SIDE ACTION
// this phase adds. Served entirely proxy-local -- like RESULT_CONTINUE_TOOL
// above, it is never in tools-manifest.json (RESEARCH Key Finding 3), so a
// manifest regenerate can never drop it. Deliberately split from
// vice_diagnose (D-03): this tool NEVER gates on a verdict, so there is no
// "confirm"/"mode" argument and no shared state between the two tools to
// keep in sync -- the separation itself is the safety.
const RECYCLE_TOOL = {
  name: "vice_recycle",
  description:
    "DESTRUCTIVE. Kills and respawns THIS session's own emulator in place, on the same port, via " +
    "the host supervisor's existing respawn loop -- the same instance, not a different one. The " +
    "restart epoch changes, so any run in flight is void and must be resumed from the last recorded " +
    'milestone snapshot. A self-inflicted checkpoint stop (the emulator merely paused at an armed ' +
    "checkpoint) is NOT a wedge and must not be recycled. Requires a non-empty \"reason\" naming why " +
    "this recycle is happening; that reason is written to a permanent, repo-tracked incident record " +
    "BEFORE anything is killed.",
  inputSchema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "Why this recycle is happening -- written verbatim into the incident record.",
      },
    },
    required: ["reason"],
  },
};

// The diagnose tool (plan 01.3-02): the read-mostly companion to
// RECYCLE_TOOL above, served in the same proxy-local synthetic slot. D-03
// keeps the two structurally unlinked -- no shared verdict/confirm state,
// and recycle never reads a diagnose verdict.
const DIAGNOSE_TOOL = {
  name: "vice_diagnose",
  description:
    "Read-mostly. Answers which of five states this session's emulator is in -- restarted, " +
    "checkpoint_trap, wedged, stale_read_path, or live -- with the evidence that produced the " +
    "verdict. It may resume the machine once or twice to measure a cycle bracket, so it is never " +
    "something to call reflexively; when it runs a bracket it leaves the machine PAUSED afterward -- " +
    'resuming is your own next call. A "checkpoint_trap" verdict means the machine stopped ITSELF at ' +
    "an armed checkpoint and must NOT be recycled -- recycling a self-inflicted stop destroys a " +
    "healthy instance.",
  inputSchema: {
    type: "object",
    properties: {},
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
  const tools = [...manifestTools, RESULT_CONTINUE_TOOL, RECYCLE_TOOL, DIAGNOSE_TOOL].map((t) => ({
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
// NEVER-CACHE-A-NEGATIVE-RESULT INVARIANT (plan 01.1-03 task 1, criterion 6;
// extended to the broker path by plan 01.2-03 task 1, C11): nothing below
// this line may memoise "the host is down" -- or, as of this extension,
// "the broker is absent" -- as a fact that outlives a single tools/call.
// There is no cached probe verdict, no sticky "last known unreachable" flag,
// and no early-return short-circuit keyed off a PREVIOUS failure -- every
// forwarded tools/call re-evaluates reachability from scratch (the epoch
// check below reads the file fresh every time; the liveness probe added in
// task 2 does its own fresh network round trip every time; task 3's
// translation runs fresh every time; ensureBrokerLease()'s
// readBrokerLiveness() call reads broker.json fresh every time it is
// reached, never memoised at module scope). This is deliberate and easy to
// break by a later, performance-minded edit ("let's skip the probe if we
// just failed one 200ms ago", or "let's remember the broker was absent last
// call so we don't bother checking again") -- don't, for either path. A
// cached negative here is exactly the "quiet wrong answer" failure class
// this codebase rejects elsewhere (MachineRestartedError, the epoch
// re-check itself): the call after a human starts the broker must just
// work, with no session restart required.
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

// ------------------------------------------------------------ vice_recycle
//
// Re-baselines the proxy's own epoch tracking after a CONFIRMED recycle.
// Mirrors ensureBrokerLease()'s own `viceSession = null` re-baseline
// (further down this file) for the identical reason: a recycle is a
// DELIBERATE identity change, and without this the very next forwarded
// call would fail its own epoch drift guard against a baseline that is now
// stale by construction. Clearing epochBaseline too (not just viceSession)
// means nothing in between reads the stale value before the next
// ensureViceSession() call re-populates both from a fresh read.
function rebaselineEpochAfterRecycle() {
  viceSession = null;
  epochBaseline = null;
}

/** Renders a human-facing message for a recycle ack whose kill stage was
 * NOT a successful kill -- named per outcome so an operator reading the
 * result can tell "no grant record" from "unreadable epoch file" from "no
 * pid recorded" from "identity mismatch" without opening the broker log
 * (matches resources/vice-broker.sh's own per-outcome ack strings). */
function recycleAckOutcomeMessage(ack) {
  const outcome = ack && typeof ack.outcome === "string" ? ack.outcome : "unknown";
  const stage = ack && typeof ack.kill_stage === "string" ? ack.kill_stage : "unknown";
  const reason = ack && typeof ack.reason === "string" && ack.reason ? ` (${ack.reason})` : "";
  switch (outcome) {
    case "identity_refused":
      return (
        `vice_recycle: the host refused to signal the target -- its process identity did not match ` +
        `the binary recorded in its own epoch file (kill stage: ${stage}). The instance was NOT ` +
        `killed and is still running.`
      );
    case "target_lookup_failed":
      return `vice_recycle: the host could not resolve this session's own recycle target (kill stage: ${stage})${reason}.`;
    case "grant_lookup_failed":
      return `vice_recycle: the host found no grant record for this session's target (kill stage: ${stage})${reason}.`;
    case "epoch_lookup_failed":
      return `vice_recycle: the host could not read the target's epoch file (kill stage: ${stage})${reason}.`;
    case "pid_lookup_failed":
      return `vice_recycle: the target's own epoch file carries no pid to signal (kill stage: ${stage})${reason}.`;
    default:
      return `vice_recycle: the host reported outcome "${outcome}" (kill stage: ${stage})${reason}.`;
  }
}

/**
 * Handles the destructive vice_recycle tool. Fixed order, and the order is
 * the point (plan 01.3-01 task 1): read the current epoch first; refuse
 * (no incident record, no request) when no broker lease is held yet or an
 * explicit VICE_MCP_URL override is in effect -- there is no broker to ask
 * and no supervisor to respawn either way; write the incident record BEFORE
 * anything else touches the host (D-17); only then write the recycle
 * request; await the ack; on anything other than a successful kill,
 * finalise the record with that outcome and return a well-formed error
 * naming the stage verbatim; on a successful kill, poll for the epoch to
 * move and probe readiness as two SEPARATE facts (T-01.3-03), finalise the
 * record, re-baseline, and return success. Never throws past this point --
 * every branch is a well-formed isError result (a dead stdio proxy is
 * unrecoverable for the session).
 */
async function handleRecycle(args) {
  const rawReason = args && typeof args.reason === "string" ? args.reason : "";
  const reason = rawReason.trim();
  if (!reason) {
    return isErrorText(
      'vice_recycle requires a non-empty "reason" string naming why this recycle is happening -- it ' +
        "becomes the incident record's own explanation, written before anything is killed. No record " +
        "and no request were written."
    );
  }

  const preKillEpoch = readEpoch();

  if (process.env.VICE_MCP_URL) {
    return isErrorText(
      "vice_recycle: VICE_MCP_URL is set, so this session talks to an explicitly overridden endpoint " +
        "with no broker to ask and no supervisor to respawn it. Recycle only applies to a broker-" +
        "granted instance. No record and no request were written."
    );
  }
  if (!brokerLeaseId) {
    return isErrorText(
      "vice_recycle: no broker lease is held yet for this session -- recycle only applies to an " +
        "instance already granted to this session. Make at least one other forwarded call first. " +
        "No record and no request were written."
    );
  }

  const sessionId = process.env.CLAUDE_CODE_SESSION_ID || null;
  const clientPidRaw = Number(process.env.CLAUDE_PID);
  const clientPid = Number.isFinite(clientPidRaw) ? clientPidRaw : null;
  const { port } = activeInstance();
  const epochBefore = preKillEpoch.present ? preKillEpoch.epoch : null;
  const at = new Date().toISOString();

  // Plan 01.3-03 (D-17, extended): gather the FULL criterion-4 evidence set
  // -- including the best-effort pre-kill snapshot -- BEFORE the record is
  // written. There is no argument, environment variable or branch between
  // here and the record write that can reach the request write with any of
  // this still ungathered; every step above degrades to unavailable rather
  // than aborting, so this line always completes.
  const evidence = await gatherWedgeEvidence({ at, port, epoch: epochBefore });
  evidence.snapshot = await captureSnapshotAttempt({ at, port, epoch: epochBefore });

  // D-17: the record is written BEFORE the request -- capturing is
  // structurally impossible to skip, not a discipline to remember.
  const recordPath = writeIncidentRecord({
    at,
    port,
    epoch_before: epochBefore,
    reason,
    session_id: sessionId,
    evidence,
  });

  const id = newRequestId();
  writeRecycleRequest({ id, targetId: brokerLeaseId, reason, sessionId, clientPid });

  const pollResult = await pollRecycleAck(id);
  if (!pollResult.acked) {
    finaliseIncidentRecord(recordPath, { outcome: "timeout" });
    return isErrorText(
      `vice_recycle: no ack arrived from the host within the timeout (${pollResult.reason}). Incident ` +
        `record: ${recordPath}. The instance's state is now unknown -- treat it as neither confirmed ` +
        `killed nor confirmed alive.`
    );
  }

  const ack = pollResult.ack || {};
  const killStage = typeof ack.kill_stage === "string" ? ack.kill_stage : null;
  const successfulKill = killStage === "already_exited" || killStage === "sigterm" || killStage === "sigkill";

  if (!successfulKill) {
    finaliseIncidentRecord(recordPath, { outcome: ack.outcome || "refused", kill_stage: killStage });
    return isErrorText(`${recycleAckOutcomeMessage(ack)} Incident record: ${recordPath}.`);
  }

  // The kill succeeded -- confirm the machine actually came back. The epoch
  // bump and the readiness probe are reported as two SEPARATE facts
  // (T-01.3-03): "the epoch moved" is bookkeeping, "the instance answers"
  // is evidence, and neither substitutes for the other.
  const epochDeadline = Date.now() + RECYCLE_ACK_TIMEOUT_MS;
  let afterEpoch = readEpoch();
  const epochMoved = () =>
    afterEpoch.present && (!preKillEpoch.present || afterEpoch.epoch > preKillEpoch.epoch);
  while (Date.now() < epochDeadline && !epochMoved()) {
    await new Promise((r) => setTimeout(r, 250));
    afterEpoch = readEpoch();
  }

  const { url, port: instancePort } = activeInstance();
  const probe = await probeInstance({ url, port: instancePort });

  finaliseIncidentRecord(recordPath, {
    outcome: "ok",
    kill_stage: killStage,
    epoch_after: afterEpoch.present ? afterEpoch.epoch : null,
  });

  // Immediately before returning success -- the deliberate identity change
  // this tool exists to cause would otherwise make every subsequent
  // forwarded call fail the drift guard.
  rebaselineEpochAfterRecycle();

  const snapshotNote =
    evidence.snapshot && evidence.snapshot.available
      ? `accepted (name: ${evidence.snapshot.value.name})`
      : `unavailable (${evidence.snapshot && evidence.snapshot.reason ? evidence.snapshot.reason : "no reason recorded"})`;

  return {
    content: [
      {
        type: "text",
        text:
          `vice_recycle: kill stage "${killStage}". Epoch before: ${preKillEpoch.present ? preKillEpoch.epoch : "unknown"}, ` +
          `epoch after: ${afterEpoch.present ? afterEpoch.epoch : "unknown"} (${epochMoved() ? "moved" : "did not move within the timeout"}). ` +
          `Readiness probe: ${probe.alive ? "the respawned instance answered" : `not yet answering (${probe.reason})`}. ` +
          `Snapshot: ${snapshotNote}. ` +
          `Incident record: ${recordPath}. This run is VOID -- resume from the last recorded milestone snapshot.`,
      },
    ],
    isError: false,
  };
}

// ----------------------------------------------------------- vice_diagnose
//
// Plan 01.3-02 task 1: the read-mostly half of this phase, up to but not
// including the cycle bracket (task 2 wires that in). Every read below goes
// through the proxy's existing forwarded call() path -- no new host
// capability, no new protocol, no second route.

// The closed, five-member verdict vocabulary, in the order the checks run.
// Frozen so a future edit cannot quietly widen it -- must_have C1's whole
// point.
const DIAGNOSE_VERDICTS = Object.freeze(["restarted", "checkpoint_trap", "wedged", "stale_read_path", "live"]);

/** Normalise a checkpoint/register address to a plain number, accepting
 * either a JS number or a hex string ("$1103"/"1103"/"0x1103"). An unprefixed
 * digit string is read as HEX, matching this project's own address
 * convention (every C64 address in this project's docs and RE-FINDINGS.md is
 * hex), never decimal. Returns null, never throws, on anything unresolvable
 * (T-01.3-06: an untrusted payload degrades to "unknown", never a thrown
 * exception). */
function toAddressNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const s = value.trim().replace(/^\$/, "").replace(/^0x/i, "");
    const n = parseInt(s, 16);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function formatAddress(n) {
  return n === null || n === undefined ? "unknown" : `$${n.toString(16).toUpperCase().padStart(4, "0")}`;
}

function formatByte(n) {
  return n === null || n === undefined ? "unknown" : `$${n.toString(16).toUpperCase().padStart(2, "0")}`;
}

/** Decode a vice_memory_read result into a plain byte array, accepting
 * either the compact "hex" string encoding (requested below) or the legacy
 * per-byte "bytes" array shape -- an untrusted payload degrades to an empty
 * array, never a thrown exception (T-01.3-06). */
function bytesFromMemoryReadResult(result) {
  if (result && typeof result.hex === "string") {
    const clean = result.hex.replace(/[^0-9a-fA-F]/g, "");
    const bytes = [];
    for (let i = 0; i + 1 < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
    return bytes;
  }
  if (result && Array.isArray(result.bytes)) {
    return result.bytes
      .map((b) => (typeof b === "string" ? parseInt(b.replace(/^\$/, ""), 16) : Number(b)))
      .filter((n) => Number.isFinite(n));
  }
  return [];
}

function wordFromBytes(bytes) {
  return bytes.length >= 2 ? bytes[0] | (bytes[1] << 8) : null;
}

// Bit 1 (HIRAM) of the 6510 processor port at $01. SET -- the KERNAL ROM is
// banked in, and the RAM IRQ vector pair ($0314/$0315) is what the KERNAL's
// own dispatch actually reads (RE-FINDINGS.md's own vector-table entry).
// CLEAR -- the KERNAL is replaced by RAM and the CPU reads the hardware
// IRQ/BRK vector pair ($FFFE/$FFFF) directly, with no ROM indirection.
const HIRAM_MASK = 0x02;

/**
 * The single definition of the live-IRQ-handler lookup (Key Finding 6):
 * three forwarded reads through the normal call() path -- $01, the RAM
 * vector pair, and (only when $01 says the ROMs are banked out) the hardware
 * vector pair. Consumed by the checkpoint-trap check below and, per this
 * plan's own key_links, by plan 01.3-03's evidence gatherer. Memoises
 * NOTHING: a disk swap, a reset or a different game retargets the handler,
 * so a cached address would silently resolve the wrong pair.
 */
async function resolveLiveIrqHandler() {
  const portResult = await call("vice_memory_read", { address: "$01", size: 1, encoding: "hex" });
  const portBytes = bytesFromMemoryReadResult(portResult);
  const port01 = portBytes.length > 0 ? portBytes[0] : null;
  const bankedOut = port01 !== null && (port01 & HIRAM_MASK) === 0;

  const ramResult = await call("vice_memory_read", { address: "$0314", size: 2, encoding: "hex" });
  const ramTarget = wordFromBytes(bytesFromMemoryReadResult(ramResult));

  if (!bankedOut) {
    return {
      target: ramTarget,
      pairLabel: "the RAM KERNAL IRQ vector pair ($0314/$0315)",
      explanation:
        `$01 read as ${formatByte(port01)} -- the KERNAL ROM is banked in, so the RAM IRQ vector pair ` +
        `($0314/$0315) is the pair this session's IRQ dispatch actually reads; it resolves to ${formatAddress(ramTarget)}.`,
    };
  }

  const hwResult = await call("vice_memory_read", { address: "$FFFE", size: 2, encoding: "hex" });
  const hwTarget = wordFromBytes(bytesFromMemoryReadResult(hwResult));
  return {
    target: hwTarget,
    pairLabel: "the hardware IRQ/BRK vector pair ($FFFE/$FFFF)",
    explanation:
      `$01 read as ${formatByte(port01)} -- the KERNAL ROM is banked OUT, so the CPU dispatches ` +
      `directly through the hardware IRQ/BRK vector pair ($FFFE/$FFFF) with no ROM indirection; it ` +
      `resolves to ${formatAddress(hwTarget)}.`,
  };
}

/**
 * Enumerate armed checkpoints, read the current PC, resolve the live IRQ
 * handler, and decide the checkpoint-trap verdict on two named shapes
 * (D-14): an enabled, stopping, exec checkpoint sitting exactly at the
 * current PC; or one sitting at the resolved handler entry with a hit count
 * of exactly zero (the corroborating tell that it has never actually
 * fired). Makes NO resume and NO stopwatch call -- the whole point of
 * checking this before any cycle bracket (D-14, T-01.3-08).
 */
async function gatherCheckpointTrapEvidence() {
  const checkpointsResult = await call("vice_checkpoint_list", {});
  const checkpoints = Array.isArray(checkpointsResult && checkpointsResult.checkpoints) ? checkpointsResult.checkpoints : [];

  const regs = await call("vice_registers_get", {});
  const pc = regs && typeof regs.PC === "number" ? regs.PC : null;

  const handler = await resolveLiveIrqHandler();

  const armedStopping = checkpoints.filter((c) => c && c.enabled !== false && c.stop === true && c.exec === true);

  const atPc = pc !== null ? armedStopping.find((c) => toAddressNumber(c.start) === pc) : undefined;
  const atHandler =
    !atPc && handler.target !== null && handler.target !== undefined
      ? armedStopping.find((c) => toAddressNumber(c.start) === handler.target && c.hit_count === 0)
      : undefined;

  const trapCheckpoint = atPc || atHandler || null;
  return {
    isTrap: Boolean(trapCheckpoint),
    checkpoints,
    pc,
    handler,
    trapCheckpoint,
    trapReason: atPc ? "pc" : atHandler ? "handler" : null,
  };
}

// The recorded incident this report's own "not guaranteed" paragraph cites --
// D-15's own caveat, load-bearing per this plan's planning notes: delete,
// soft reset, hard reset and an explicit single step ALL left the machine
// frozen in this recorded case.
const CHECKPOINT_TRAP_INCIDENT_REF =
  ".planning/todos/pending/2026-08-01-vice-registers-frozen-after-reset-during-01-04-task2.md";

/** Renders the checkpoint_trap verdict's report -- an explanation, never a
 * remedy (D-15): it names the armed checkpoints, the resolved handler, the
 * PC's relation to the trap, states plainly this is self-inflicted and not a
 * wedge, names the agent's own next moves without performing any of them,
 * and closes with the not-guaranteed paragraph. */
function renderCheckpointTrapReport(evidence) {
  const { checkpoints, pc, handler, trapCheckpoint, trapReason } = evidence;
  const checkpointList =
    checkpoints.length === 0
      ? "none armed"
      : checkpoints
          .map((c) => {
            const addr = formatAddress(toAddressNumber(c && c.start));
            const flag = c && c.stop ? "stop" : "continue";
            const enabled = c && c.enabled === false ? "disabled" : "enabled";
            const hitCount = c && typeof c.hit_count === "number" ? c.hit_count : "unknown";
            return `#${c && c.checkpoint_num} ${addr} (${flag}, ${enabled}, hit_count ${hitCount})`;
          })
          .join("; ");

  const pcRelation =
    trapReason === "pc"
      ? `exactly at armed checkpoint #${trapCheckpoint.checkpoint_num} -- that is why the machine is stopped here`
      : trapReason === "handler"
        ? `not at the armed checkpoint's own address, but checkpoint #${trapCheckpoint.checkpoint_num} sits at ` +
          "the resolved live IRQ handler entry with hit_count 0 -- the corroborating tell that this checkpoint " +
          "has never actually fired, not merely that it fired between reads"
        : "no relation established";

  return [
    "vice_diagnose verdict: checkpoint_trap",
    "",
    `Armed checkpoints: ${checkpointList}.`,
    `Resolved live IRQ handler: ${handler.explanation}`,
    `Current PC: ${formatAddress(pc)} -- ${pcRelation}.`,
    "",
    "This is a self-inflicted stop, not a wedge: the machine paused because an armed checkpoint " +
      "fired or sits exactly here, not because it stopped retiring cycles on its own. Recycling now " +
      "would destroy a healthy instance -- no cycle bracket was run to reach this verdict.",
    "",
    "Next moves available to you (this report does not perform any of them): vice_checkpoint_delete " +
      "the offending checkpoint, or vice_checkpoint_toggle it disabled; vice_execution_step past it; " +
      "then re-run vice_diagnose.",
    "",
    "Not guaranteed: deleting the checkpoint is not guaranteed to unfreeze the machine. The recorded " +
      `incident (${CHECKPOINT_TRAP_INCIDENT_REF}) shows checkpoint delete, then a soft reset, then a hard ` +
      "reset, then an explicit single step ALL leaving the machine frozen in sequence -- a checkpoint " +
      "trap may be the onset without being the whole story. If a cycle bracket still measures zero " +
      "after the checkpoint is gone, the verdict becomes wedged and recycle is the fallback after all.",
  ].join("\n");
}

/** Renders the restarted verdict's report -- reached from a plain epoch-file
 * comparison alone, at zero emulator calls (D-14's ordering: this check
 * costs nothing and runs first). */
function renderRestartedReport(beforeEpoch, afterEpoch) {
  return (
    "vice_diagnose verdict: restarted\n\n" +
    `The host VICE MCP server's epoch changed from ${beforeEpoch} to ${afterEpoch} -- the emulator ` +
    "behind this session restarted. This is answered from a plain epoch comparison alone, at zero " +
    "emulator calls; no checkpoint enumeration was attempted, because a restart is this project's own " +
    "already-handled case (criterion 1) and re-deriving it here would be a second mechanism. Any run " +
    "in flight before this point is void."
  );
}

// Plan 01.3-02 task 2: the cycle bracket, the definitive liveness test, and
// the three verdicts that depend on it (wedged, stale_read_path, live).

// Three polls: the bracket needs the machine to be given real forwarded
// round trips to retire cycles across, and three is enough for the counter
// to move at any rate worth calling alive.
const CYCLE_BRACKET_PINGS = 3;
// Two brackets: criterion 2's minimum for a wedged verdict is two
// consecutive zeros, and D-04 makes every additional bracket another call to
// the tool most correlated with host death. Two is the minimum and the
// maximum.
const CYCLE_BRACKET_MAX = 2;

// ~991,000 cycles/s is the measured PAL C64 full-speed rate (RE-FINDINGS.md,
// "the only trustworthy VICE liveness test is a cycle bracket"). Printed
// only, as an observation beside a measured rate -- D-08 refuses a
// degradation threshold, and a constant that is only ever printed cannot
// become one by accident.
const BASELINE_CYCLES_PER_SECOND = 991000;

function cyclesFromStopwatchResult(result) {
  if (result && typeof result.cycles === "number") return result.cycles;
  if (result && typeof result.previous_cycles === "number") return result.previous_cycles;
  return 0;
}

/**
 * The single definition of the cycle bracket criterion 2 requires: reset the
 * stopwatch, resume execution exactly once, poll with ping
 * CYCLE_BRACKET_PINGS times, pause, read the stopwatch back. Pacing comes
 * from the forwarded round trips alone -- there is no timer, no delay and no
 * wall-clock quantity anywhere in it (the standing project rule). Every
 * stopwatch call in this file lives inside this function's body; the
 * structural test enforces it. `elapsedMs` is measured only to print an
 * observational rate afterward -- it decides nothing and paces nothing.
 */
async function runCycleBracket() {
  await call("vice_cycles_stopwatch", { action: "reset" });
  const startedAt = Date.now();
  await call("vice_execution_run", {});
  for (let i = 0; i < CYCLE_BRACKET_PINGS; i += 1) {
    await call("vice_ping", {}); // the ping EXECUTION field is never inspected here -- it decides nothing (C1, D-07)
  }
  await call("vice_execution_pause", {});
  const elapsedMs = Date.now() - startedAt;
  const readResult = await call("vice_cycles_stopwatch", { action: "read" });
  const cycles = cyclesFromStopwatchResult(readResult);
  return { cycles, elapsedMs };
}

function registersByteIdentical(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Gathers the bracket evidence: a register snapshot at each end, bracket
 * one, and -- only when bracket one retired exactly zero cycles -- bracket
 * two. A non-zero first bracket short-circuits (D-04): the answer is already
 * not wedged, and a second resume buys nothing.
 */
async function gatherBracketEvidence() {
  const regsBefore = await call("vice_registers_get", {});
  const bracket1 = await runCycleBracket();
  let bracket2 = null;
  let finalBracket = bracket1;
  if (bracket1.cycles === 0) {
    bracket2 = await runCycleBracket();
    finalBracket = bracket2;
  }
  const regsAfter = await call("vice_registers_get", {});
  return { regsBefore, regsAfter, bracket1, bracket2, finalBracket };
}

/**
 * Produces the post-bracket verdict (criterion 2/3). Two consecutive zeros
 * is wedged and nothing else is. On any non-zero result (whichever bracket
 * produced it), a byte-identical register snapshot across an advancing
 * bracket is stale_read_path -- one read path is stale while the machine is
 * demonstrably not frozen; anything else is live.
 */
function classifyLiveness(evidence) {
  const { bracket1, bracket2, regsBefore, regsAfter } = evidence;
  if (bracket1.cycles === 0 && (!bracket2 || bracket2.cycles === 0)) {
    return "wedged";
  }
  return registersByteIdentical(regsBefore, regsAfter) ? "stale_read_path" : "live";
}

/**
 * Renders the post-bracket report (wedged/stale_read_path/live). Separates
 * load-bearing evidence (the restart epoch, already checked; the stopwatch
 * delta across the bracket) from corroborating evidence (the program
 * counter, VIC-II state, checkpoint hit counts, a screenshot) explicitly --
 * criterion 3's own requirement. A status of ok with an execution state of
 * running is compatible with every one of these verdicts and is therefore
 * evidence for none of them.
 */
function renderDiagnoseReport(evidence, verdict) {
  const { bracket1, bracket2, finalBracket } = evidence;
  const bracketsRun = bracket2 ? 2 : 1;
  const ratePerSecond =
    finalBracket.cycles > 0 ? Math.round((finalBracket.cycles / Math.max(finalBracket.elapsedMs, 1)) * 1000) : 0;

  const lines = [
    `vice_diagnose verdict: ${verdict}`,
    "",
    "Load-bearing evidence: the restart epoch (already checked, at zero emulator cost) and the " +
      `stopwatch cycle delta across the bracket -- bracket 1 retired ${bracket1.cycles} cycles` +
      (bracket2 ? `, bracket 2 retired ${bracket2.cycles} cycles` : "") +
      ` (${bracketsRun} bracket${bracketsRun > 1 ? "s" : ""} run, ${bracketsRun} resume call${bracketsRun > 1 ? "s" : ""}).`,
    "Corroborating evidence only, never load-bearing on its own: the program counter, VIC-II state, " +
      "checkpoint hit counts, and a screenshot. A status of ok with an execution state of running is " +
      "compatible with every one of these verdicts and is therefore evidence for none of them.",
  ];

  if (verdict !== "wedged") {
    lines.push(
      `Measured rate this call: ~${finalBracket.cycles} cycles in ~${finalBracket.elapsedMs}ms ` +
        `(~${ratePerSecond} cycles/s), beside the baseline ~${BASELINE_CYCLES_PER_SECOND} cycles/s ` +
        "(PAL C64 full speed) -- an observation, never a threshold, and never a verdict of its own."
    );
  }

  if (verdict === "stale_read_path") {
    lines.push(
      "The register-read path returned a byte-identical snapshot across both ends of an advancing " +
        "bracket -- that read path is stale, but the machine is demonstrably not frozen."
    );
  }

  lines.push(
    verdict === "wedged"
      ? "Machine state left: paused, after two zero-cycle brackets. Resuming is your own deliberate next call."
      : "Machine state left: paused, after the bracket that reached this verdict. Resuming is your own deliberate next call."
  );

  return lines.join("\n");
}

/**
 * Handles vice_diagnose. Fixed check order, and the order is the point
 * (D-14): first the epoch comparison (zero emulator calls), then the
 * checkpoint-trap check (no resume at all). Never throws past this point --
 * every branch is a well-formed isError:false or isError:true result.
 */
async function handleDiagnose(_args) {
  try {
    const leaseResult = await ensureBrokerLease();
    if (!leaseResult.ok) {
      return isErrorText(leaseResult.message);
    }
    ensureViceSession();

    const epochNow = currentEpoch();
    if (epochChanged(epochBaseline, epochNow)) {
      const before = epochBaseline.epoch;
      epochBaseline = epochNow; // never cache a negative result (criterion 6)
      return { content: [{ type: "text", text: renderRestartedReport(before, epochNow.epoch) }], isError: false };
    }
    if (!epochBaseline.present && epochNow.present) {
      epochBaseline = epochNow;
    }

    const trapEvidence = await gatherCheckpointTrapEvidence();
    if (trapEvidence.isTrap) {
      return { content: [{ type: "text", text: renderCheckpointTrapReport(trapEvidence) }], isError: false };
    }

    // Third and last: the cycle bracket, the definitive liveness test, drives
    // the three remaining verdicts (D-14's full order: epoch, trap, bracket).
    const bracketEvidence = await gatherBracketEvidence();
    const verdict = classifyLiveness(bracketEvidence);
    return { content: [{ type: "text", text: renderDiagnoseReport(bracketEvidence, verdict) }], isError: false };
  } catch (e) {
    if (e instanceof MachineRestartedError) {
      const current = currentEpoch();
      epochBaseline = current;
      return { content: [{ type: "text", text: renderRestartedReport(e.baselineEpoch, e.currentEpoch) }], isError: false };
    }
    return isErrorText(
      `vice_diagnose: an unexpected error occurred while gathering evidence: ${e && e.message ? e.message : e}`
    );
  }
}

// -------------------------------------------- vice_recycle: evidence gather
//
// Plan 01.3-03 (criterion 4): the destructive path's own evidence set,
// composed ENTIRELY from reads already forwardable through call() -- no new
// host capability, no second route. runCycleBracket() and
// resolveLiveIrqHandler() are plan 01.3-02's own single definitions, reused
// here rather than re-derived (this plan's own key_links) -- criterion 2's
// single-bracket-definition guard is a PHASE property, not a plan one.

/**
 * Capture-step deadline (T-01.3-10): a TRANSPORT deadline bounding how long
 * ANY single evidence-gathering step (including the pre-kill snapshot
 * attempt, task 2) may wait for its own forwarded call(s) before this
 * wrapper gives up and records an explicit unavailable-with-reason entry.
 *
 * This is deliberately DIFFERENT from the project's standing prohibition on
 * WALL-CLOCK PACING (never sleep to wait for the emulated machine to reach
 * some state -- synchronise on checkpoint hits and cycle counts instead):
 * that rule governs synchronising INPUT/WAITS against the emulated game's
 * own state. This deadline governs a capture step's patience with the
 * TRANSPORT alone -- exactly the kind of deadline call()'s own
 * AbortSignal.timeout already applies per forwarded call, just bounding the
 * WHOLE step (which may issue several forwarded calls, e.g. the bracket) so
 * one non-answering read can never stall the whole gather, and the
 * snapshot attempt can never stall the recycle itself (D-19). Overridable
 * purely so this file's own test suite can exercise a "never answers"
 * fixture in milliseconds rather than minutes -- production always uses the
 * generous default.
 */
const CAPTURE_STEP_TIMEOUT_MS = Number(process.env.VICE_RECYCLE_CAPTURE_TIMEOUT_MS || 8000);

/**
 * Runs one evidence-gathering step, turning any rejection, transport
 * failure or capture-step deadline into an explicit `{ available: false,
 * reason }` entry rather than letting it abort the whole gather -- the
 * whole point (D-17, D-19) is that a wedged machine will fail SOME of these
 * and the record must still exist. Never throws.
 */
async function captureStep(fn) {
  let timer;
  try {
    const value = await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`capture step deadline of ${CAPTURE_STEP_TIMEOUT_MS}ms exceeded`)),
          CAPTURE_STEP_TIMEOUT_MS
        );
      }),
    ]);
    return { available: true, value };
  } catch (e) {
    return { available: false, reason: e && e.message ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Assembles criterion-4's evidence set for an incident record: one cycle
 * bracket (runCycleBracket(), plan 01.3-02 -- NEVER a second bracket
 * definition), the program counter and full register snapshot, the full
 * checkpoint enumeration (address, enabled flag, stop-or-continue), the
 * resolved live IRQ handler (resolveLiveIrqHandler(), plan 01.3-02), and a
 * screenshot written to a path in the incidents directory sharing the
 * record's own stem. Every step goes through captureStep() above, so no
 * step can abort the gather.
 *
 * `at`/`port`/`epoch` name the SAME triple the caller passes to
 * writeIncidentRecord(), so the screenshot's path shares that record's stem
 * (best-effort: the very rare case of a same-millisecond/port/epoch
 * collision forcing writeIncidentRecord() to append a numeric suffix onto
 * the actual .md file is not reflected here, since this path is computed
 * BEFORE that write happens).
 */
async function gatherWedgeEvidence({ at, port, epoch }) {
  const bracket = await captureStep(() => runCycleBracket());
  const registers = await captureStep(() => call("vice_registers_get", {}));
  const checkpoints = await captureStep(async () => {
    const result = await call("vice_checkpoint_list", {});
    const list = Array.isArray(result && result.checkpoints) ? result.checkpoints : [];
    return list.map((c) => ({
      checkpoint_num: c && c.checkpoint_num,
      address: formatAddress(toAddressNumber(c && c.start)),
      enabled: Boolean(c && c.enabled !== false),
      flag: c && c.stop ? "stop" : "continue",
    }));
  });
  const irqHandler = await captureStep(() => resolveLiveIrqHandler());

  // The screenshot's path argument must be translated (T-01.3-11's sibling
  // concern): handleToolsCall() applies rewriteArguments() before
  // forwarding, and this proxy-local caller does NOT pass through that seam
  // -- so it is called explicitly here. Skipping this would write the file
  // to a host path that does not exist and return a success the record
  // would then be lying about.
  const screenshotContainerPath = incidentAssetPath({ at, port, epoch, ext: "png" });
  const screenshot = await captureStep(async () => {
    const { args: translated } = rewriteArguments({ path: screenshotContainerPath }, "vice_display_screenshot");
    await call("vice_display_screenshot", translated);
    return relative(repoRoot(), screenshotContainerPath);
  });

  return { bracket, registers, checkpoints, irqHandler, screenshot };
}

/**
 * The best-effort pre-kill snapshot (plan 01.3-03 task 2, D-19): the LAST
 * capture step, run immediately before the incident record is written. It
 * takes a NAME, not a path -- vice_snapshot_save's own contract -- so the
 * file lands in the host emulator's own snapshot directory and nothing
 * container-side can confirm it landed there. The record therefore says
 * the ATTEMPT was accepted, never that a file was verified (T-01.3-11): the
 * wording must not overstate what was established. A rejection, a
 * transport failure or a capture-step deadline records unavailable with
 * the reason verbatim and moves on -- it cannot fail or stall the recycle.
 * The name is built from the SAME timestamp/port/epoch triple the incident
 * record's own stem uses, so the two artifacts are trivially correlated
 * later.
 */
async function captureSnapshotAttempt({ at, port, epoch }) {
  const name = incidentAssetStem({ at, port, epoch });
  return captureStep(async () => {
    await call("vice_snapshot_save", { name, description: "vice_recycle pre-kill evidence capture" });
    return { name };
  });
}

// --------------------------------------------------- unreachable diagnostics
//
// Plan 01.1-03 task 2 / ROADMAP criterion 7. Blocking on withReconnect()'s
// ~50s ladder turns a clear diagnosis into an opaque tool timeout, so every
// forwarded tools/call gets a pre-flight `probeInstance()` check FIRST (one
// 1500ms-budget round trip, no retry -- see vice-probe.ts's own header for
// why reusing the resilient ladder here would be wrong). When the probe
// reports the emulator unreachable, this classifies the failure into exactly
// one of three states, each with its own message and its own fix, each
// quoting an absolute host path, each closing off the "just run the
// transport module from a shell instead" workaround explicitly.
//
// This MCP tool surface is the only route to the emulator -- never named
// together with a CLI verb here, since plan 01.1-04 installs a durable gate
// matching exactly that pattern in documentation.
const ONLY_ROUTE_NOTE =
  "This MCP tool surface is the only route to the emulator. The correct action is to stop and ask " +
  "the human to start it on the host -- falling back to a direct shell invocation of the underlying " +
  "transport is not an available workaround.";

/** The absolute path of the command a human should run on the HOST to
 * start/restart the emulator -- computed via hostPath() over the deployed
 * supervisor's container path, degrading to the container path plus
 * SET_ENV_HINT exactly as install-resources.mjs's hostLaunchInstructions() does, so a
 * translation failure still yields something to act on rather than an empty
 * message. Recomputed fresh every call -- never cached (see the
 * never-cache-a-negative-result invariant above ensureViceSession()). */
function supervisorHostPath() {
  const root = repoRoot();
  const target = join(root, "tools", "vice-supervisor.sh");
  try {
    return hostPath(target, { workspaceRoot: root });
  } catch {
    return `${target}\n  (host path could not be determined -- ${SET_ENV_HINT})`;
  }
}

/** Same shape as supervisorHostPath(), for the broker launcher instead of
 * the supervisor. Recomputed fresh every call -- never cached. */
function brokerHostPath() {
  const root = repoRoot();
  const target = join(root, "tools", "vice-broker.sh");
  try {
    return hostPath(target, { workspaceRoot: root });
  } catch {
    return `${target}\n  (host path could not be determined -- ${SET_ENV_HINT})`;
  }
}

// ------------------------------------------------- broker-absent diagnostics
//
// Plan 01.2-03 task 1 / must_have C10. A missing broker answers exactly one
// generic message two times out of three sends the reader to the wrong fix
// -- mirrors the host-unreachable triple above (never-started /
// dead-or-hung / alive-but-failed), but answers a DIFFERENT question ("is
// the on-demand broker itself reachable" vs "is the host VICE MCP server
// reachable"), so both triples stay in place side by side, not one
// replacing the other. Every message here quotes brokerHostPath() (an
// absolute HOST path, recomputed fresh -- see that function's own comment)
// and the single shared ONLY_ROUTE_NOTE definition; no message below writes
// its own second only-route sentence.

/** State: readBrokerLiveness() found no broker.json at all -- the broker has
 * never been started on this host. Nothing on the other side would ever
 * read a request, so ensureBrokerLease() returns this BEFORE writing one. */
function brokerNeverStartedMessage() {
  return (
    `vice-proxy: the on-demand VICE broker has never been started on this host -- no broker.json ` +
    `record exists at all. Start it on the host with:\n` +
    `  ${brokerHostPath()}\n` +
    ONLY_ROUTE_NOTE
  );
}

/** State: broker.json exists but its heartbeat is older than the stale
 * threshold -- the broker process is dead or hung. Quotes the recorded pid
 * (readBrokerLiveness()'s own field), since checking that pid is the first
 * thing a human does on the host, mirroring deadOrHungMessage() above. */
function brokerDeadOrHungMessage(liveness) {
  const pidNote = liveness && liveness.pid != null ? ` (pid ${liveness.pid})` : "";
  return (
    `vice-proxy: the on-demand VICE broker appears to be dead or hung${pidNote} -- its last recorded ` +
    `heartbeat is older than the stale threshold. Restart it on the host with:\n` +
    `  ${brokerHostPath()}\n` +
    ONLY_ROUTE_NOTE
  );
}

/** State: the broker is alive and a request was polled, but it wrote a
 * denial rather than a grant. Relays the denial's own `reason` field
 * VERBATIM -- never paraphrased -- and deliberately carries no RESTART
 * instruction, for the same reason aliveButFailedMessage() above carries
 * none: restarting something that is answering correctly is the wrong fix.
 * Still names an absolute path (the running broker's own launcher, purely
 * as a reference, mirroring aliveButFailedMessage()'s `hostRef` note) and
 * the only-route sentence, both required of every broker-absent-adjacent
 * message this proxy emits. */
function brokerLaunchFailedMessage(reason) {
  const hostRef = brokerHostPath().split("\n")[0];
  return (
    `vice-proxy: the on-demand VICE broker (running via the host-side launcher at ${hostRef}) declined ` +
    `to grant an instance for this session: ${reason} ${ONLY_ROUTE_NOTE}`
  );
}

/** State: the broker is alive and a request was written, but neither a
 * grant nor a denial appeared before pollGrant()'s own deadline -- an
 * explicit warming-and-retry result, never a silent hang. A cold x64sc
 * launch plus boot plus readiness is seconds (spike-findings-bruce-lee
 * skill), well inside the client's own per-server timeout (.mcp.json's
 * `timeout` field, task 2), so the correct next action is simply to retry
 * the SAME call, not to treat this as a failure requiring a different fix. */
function brokerWarmingMessage(elapsedMs) {
  return (
    `vice-proxy: the on-demand VICE broker is still warming up an instance for this session -- no ` +
    `grant or denial appeared within ${elapsedMs}ms. This is expected for a cold start; retry the same ` +
    `call now, it should succeed once the instance finishes booting.`
  );
}

/** Removes requests/<id>.json, best-effort. Called when a poll resolves to
 * a denial or a warming timeout, so a failed or still-warming acquisition
 * leaves no orphan request for the sweeper to reap later -- the request
 * file's own counterpart to releaseLease(id) (vice-broker-client.mjs),
 * which already handles the lease half of this cleanup. Uses requestsDir()
 * (already exported by vice-broker-client.mjs) rather than adding a new
 * export there, so this task's file-ownership boundary (vice-proxy.mjs /
 * vice-proxy.test.mjs only) stays intact. */
function removeRequestFile(id) {
  try {
    unlinkSync(join(requestsDir(), `${id}.json`));
  } catch {
    // already gone -- the broker may have consumed/removed it, or this is a
    // second cleanup attempt; either way there is nothing left to do.
  }
}

// A causeCode-shaped reason string (e.g. "ECONNREFUSED", "ECONNRESET") is
// exactly what probeInstance() returns for a connection actively refused --
// see its own fallback `causeCode || e.message`. A timeout, an HTTP error
// status, or "didn't decode to a recognisable ping" all produce prose
// instead, never a bare all-caps E-code, which is what keeps this predicate
// precise rather than a loose substring guess.
function isConnectionRefusedReason(reason) {
  return typeof reason === "string" && /^E[A-Z]+$/.test(reason);
}

function neverStartedMessage(probe) {
  return (
    `vice-proxy: the host VICE MCP server has never been started at this configured path -- no ` +
    `restart-epoch record exists, and the connection was refused (${probe.reason}). Start it on the host with:\n` +
    `  ${supervisorHostPath()}\n` +
    ONLY_ROUTE_NOTE
  );
}

function deadOrHungMessage(probe, epoch) {
  const pidNote =
    epoch && epoch.present && epoch.pid != null
      ? ` (pid ${epoch.pid}${epoch.spawned_at ? `, spawned_at ${epoch.spawned_at}` : ""})`
      : "";
  return (
    `vice-proxy: the host VICE MCP server appears to be dead or hung${pidNote} -- ${probe.reason}. ` +
    `Restart it on the host with:\n` +
    `  ${supervisorHostPath()}\n` +
    ONLY_ROUTE_NOTE
  );
}

/** Reached only when the pre-flight probe found the host alive but the
 * forwarded call itself failed (a transport error the retry ladder gave up
 * on, or a genuine RPC error). Relays the host's own message VERBATIM --
 * never paraphrased -- and deliberately carries no restart instruction,
 * since restarting a live, correctly-answering host is the wrong fix for a
 * rejected tool call. Still names an absolute path and the only-route note
 * (both required of every unreachable-adjacent message this proxy emits),
 * worded so as never to suggest the action a restart message would. */
function aliveButFailedMessage(errMessage) {
  const hostRef = supervisorHostPath().split("\n")[0];
  return (
    `vice-proxy: the host VICE MCP server (reachable via the host-side launcher at ${hostRef}) rejected ` +
    `this call: ${errMessage} ${ONLY_ROUTE_NOTE}`
  );
}

// STATED RESIDUAL (quick-260801-ccn task 3), recorded rather than fixed
// here: aliveButFailedMessage() above still names the supervisor launcher
// as its reference path, even under a broker-granted session. It answers a
// DIFFERENT question from both the host-unreachable triple and the
// broker-granted message below -- an instance that IS reachable and
// answering rejected ONE call -- where no launcher is the fix and a
// restart would be the wrong advice on either route (broker-granted or
// fixed-port). Left alone deliberately, not missed.

// ------------------------------------------- broker-granted unreachable diagnostics
//
// Quick task 260801-ccn task 3 (D-5). Distinct from BOTH the host-unreachable
// triple above (which answers "is the host VICE MCP server reachable" with
// no broker in the picture at all) and the broker-ABSENT triple below (which
// answers "is the on-demand broker itself reachable", reached only BEFORE a
// lease exists) -- this answers a third, different question: the broker has
// ALREADY reported successfully launching an instance for this session, and
// THAT instance is not answering. Offering the fixed-port triple's
// never-started/dead-or-hung diagnosis here would send the operator to
// restart the RETIRED supervisor route while the broker is running fine and
// had already granted a working emulator -- exactly the misdirection this
// task fixes.
//
// Deliberately ONE message, not a broker-side copy of the fixed-port
// triple's own launched-vs-hung split: a granted instance cannot be in the
// "was it ever started" state that split exists to distinguish -- the
// broker has just told us it was. Quotes brokerHostPath() (an absolute HOST
// path, recomputed fresh -- see that function's own comment), the granted
// port and url (activeInstance()), the held lease id, the probe's own
// reason verbatim, and whether an epoch record was found for this instance;
// ends with the shared only-route note, never a second copy of it.
function brokerGrantedUnreachableMessage(probe, epoch) {
  const { port, url } = activeInstance();
  const epochNote = epoch && epoch.present
    ? `an epoch record is on file for it (epoch ${epoch.epoch}${epoch.pid != null ? `, pid ${epoch.pid}` : ""})`
    : "no epoch record is on file for it";
  return (
    `vice-proxy: the on-demand VICE broker's granted instance (lease ${brokerLeaseId}, port ${port}, ${url}) ` +
    `is not answering -- ${probe.reason}. ${epochNote}. The broker already reported this instance as ` +
    `launched, so it may have crashed after being granted, or the grant may be stale -- a different ` +
    `problem than a host that has not been brought up at all. Investigate on the host with:\n` +
    `  ${brokerHostPath()}\n` +
    ONLY_ROUTE_NOTE
  );
}

// ------------------------------------------------------------ path rewriting
//
// Decision D-G (plan 01.1-03 task 3 / criterion 9): container->host path
// translation moves from every caller's own discipline into this one seam,
// which sees every forwarded call. The structural rule: any string argument
// value beginning with "/" is an absolute filesystem path. One that resolves
// inside the mounted workspace is rewritten to its host form via
// hostPath() -- the host emulator can only ever be handed a HOST path,
// since it runs on the host, not in this container. One that resolves
// outside the workspace is refused outright, before any forwarding, because
// a container path is never correct on the host: forwarding it untouched
// can only produce a wrong answer with no error, which is exactly the
// silent-failure class this criterion exists to eliminate.
//
// RELATIVE paths: resolved against the workspace root, but ONLY for the
// arguments the tools manifest declares to BE paths.
//
// The original rule left every relative string byte-identical, on the
// reasoning that "a relative-looking string is indistinguishable from a
// non-path argument (a tool name, a hex address like "$0400", an arbitrary
// label) without guessing". That reasoning was sound for a walker with no
// schema, and it pointed callers at a SKILL.md "Paths" section for the
// absolute-path requirement -- but that SKILL.md was deleted in db9eed3,
// leaving the requirement stated nowhere. CLAUDE.md's surviving wording
// ("pass container paths and let the tools handle the boundary") promises
// the opposite, so callers reasonably passed "disks/foo.d64" and got a bare
// "Failed to attach disk image" from the host, with nothing anywhere
// indicating the path was the problem. That cost real session time.
//
// The premise is also no longer true. tools-manifest.json -- the same file
// tools/list is served from -- types every argument, and exactly four
// declare a path: vice_disk_attach.path, vice_autostart.path,
// vice_display_screenshot.path and vice_symbols_load.path. Consulting it
// removes the guessing the residual was protecting against: a relative
// string in a DECLARED path argument is a path, full stop, and everything
// else keeps the byte-identical pass-through unchanged.
//
// Resolution is against the workspace root, never process.cwd() -- the
// proxy is one long-lived process serving the whole session, so its cwd is
// meaningless to the caller. (hostpath.mjs:106 resolves against cwd for its
// CLI's benefit; that branch is unreachable from here, and deliberately so.)
//
// STATED RESIDUAL, narrower than before: a relative string in an argument
// the manifest does NOT declare as a path is still left byte-identical, and
// so is a relative string nested inside an object or array. Both remain
// indistinguishable from non-path data. A worktree caller also resolves
// against the MAIN workspace root, not its worktree -- correct for the
// read-only disk images this serves, and an absolute path still overrides.
const PATH_REWRITE_MAX_DEPTH = 10; // bounded so pathological nesting is left alone rather than looping forever

class PathOutOfWorkspaceError extends Error {}
class PathTranslationError extends Error {}

// The boundary check MUST run against a normalized path, never the raw
// string. `startsWith(root)` on an unnormalized value is satisfied by any
// string that merely begins with the root's characters, so a lexical `..`
// sequence -- "/workspaces/bruce_lee/../../../etc/passwd" -- passes a raw
// prefix test and is then handed to hostPath(), which does NOT refuse it:
// when relative() normalizes to a leading "..", hostpath.mjs deliberately
// falls through to generic mount-based translation instead of throwing (its
// own comment says so, for the CLI's benefit). That makes THIS check the only
// workspace boundary on the forwarding path, so it has to be the strict one.
//
// resolve() collapses "." and ".." segments; callers only reach here after
// value.startsWith("/") is confirmed, so it is pure normalization and never
// pulls in process.cwd().
//
// STATED RESIDUAL: this is lexical, not physical -- a symlink inside the
// workspace whose target lives outside it still translates. realpathSync()
// would catch that but requires the file to already exist, which is wrong for
// the write-side tools (snapshot_save and friends name a path that does not
// exist yet). Lexical normalization is the part that can be enforced for both
// directions without breaking writes.
function isInsideWorkspace(absPath, root) {
  return absPath === root || absPath.startsWith(root.endsWith("/") ? root : root + "/");
}

/**
 * Recursively walk `value`, applying decision D-G's structural rule to
 * every string found. Objects and arrays are walked (bounded by
 * PATH_REWRITE_MAX_DEPTH); numbers, booleans, null, and non-absolute
 * strings are returned byte-identical. `argPath` accumulates a
 * human-readable position (e.g. "arguments.path" or "arguments.files[2]")
 * used in a refusal message so the caller can find exactly which argument
 * was the problem.
 */
function rewritePathsIn(value, argPath, root, depth, asWritten) {
  if (depth > PATH_REWRITE_MAX_DEPTH) return value;
  if (typeof value === "string") {
    if (!value.startsWith("/")) return value; // the stated residual: undeclared relative strings untouched
    // Normalize FIRST, then check, then translate the normalized form -- so a
    // path that only looks like it is inside the workspace cannot slip through,
    // and the host is never handed a path still carrying ".." segments.
    const normalized = resolve(value);
    // `asWritten` is set only when rewriteArguments() already resolved a
    // declared-path argument from a relative string. Quoting the resolved
    // form alone would show the caller a path they never typed, so BOTH
    // failure branches below name what they wrote and what it became.
    const escapedRelative = asWritten !== undefined && asWritten !== value;
    if (!isInsideWorkspace(normalized, root)) {
      throw new PathOutOfWorkspaceError(
        (escapedRelative
          ? `vice-proxy: ${argPath} is the relative path "${asWritten}", which resolves to ${normalized} -- ` +
            `outside the mounted workspace (${root})`
          : `vice-proxy: ${argPath} is an absolute path (${value}) outside the mounted workspace (${root})` +
            (normalized === value ? "" : `; it resolves to ${normalized}`)) +
          `. The host emulator can only be handed paths that live inside the mounted workspace -- move the ` +
          `artifact inside the workspace and call again.`
      );
    }
    try {
      return hostPath(normalized, { workspaceRoot: root });
    } catch (e) {
      // Name what the CALLER wrote first, and the container path it became --
      // never lead with the host path. The caller reasons in container terms
      // and cannot act on a host-side location, so quoting only the resolved
      // form makes a fixable mistake look like an emulator fault.
      throw new PathTranslationError(
        `vice-proxy: ${argPath} ` +
          (escapedRelative ? `("${asWritten}", which resolves to ${normalized})` : `(${value})`) +
          ` could not be translated to a host path: ${e.message}\n  ${SET_ENV_HINT}`
      );
    }
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => rewritePathsIn(v, `${argPath}[${i}]`, root, depth + 1));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = rewritePathsIn(v, `${argPath}.${k}`, root, depth + 1);
    }
    return out;
  }
  return value; // numbers, booleans, null -- byte-identical, never touched
}

const NO_PATH_ARGS = new Set();
let PATH_ARGS_BY_TOOL = null; // built once per process, from the manifest

/**
 * The set of argument names `toolName` declares to be filesystem paths,
 * read off tools-manifest.json -- the SAME file tools/list is served from,
 * so this can never become a second, drifting copy of "which arguments are
 * paths". An argument qualifies when it is declared `type: "string"` and
 * either is named exactly `path` or opens its description with "Path to" /
 * "File path" (both tests agree on all four current cases; either alone
 * would also suffice, and keeping both means a future manifest entry that
 * satisfies only one is still caught).
 *
 * Deliberately name/description-driven rather than a hardcoded tool list:
 * a manifest refresh that adds a path-taking tool gets the behaviour for
 * free, which a literal list here would silently miss.
 */
function pathArgsFor(toolName) {
  if (!PATH_ARGS_BY_TOOL) {
    PATH_ARGS_BY_TOOL = new Map();
    for (const t of readManifestTools()) {
      const props = t.inputSchema && t.inputSchema.properties;
      if (!props || typeof props !== "object") continue;
      const names = new Set();
      for (const [k, v] of Object.entries(props)) {
        if (!v || v.type !== "string") continue;
        if (k === "path" || /^(path|file path)\b/i.test(v.description || "")) names.add(k);
      }
      if (names.size) PATH_ARGS_BY_TOOL.set(t.name, names);
    }
  }
  return PATH_ARGS_BY_TOOL.get(toolName) || NO_PATH_ARGS;
}

/** Rewrite every in-workspace path inside `args` to its host form. A relative
 * string in a manifest-declared path argument is resolved against the
 * workspace root first; everything else keeps the byte-identical
 * pass-through. Throws PathOutOfWorkspaceError / PathTranslationError on the
 * two refusal cases above; the caller (handleToolsCall) converts either into
 * an isError:true result rather than letting it escape. */
function rewriteArguments(args, toolName) {
  const root = repoRoot();
  const pathArgs = pathArgsFor(toolName);
  const out = {};
  const resolutions = [];
  for (const [k, v] of Object.entries(args || {})) {
    // Only a top-level, declared-path, non-empty relative string is resolved.
    // Empty stays empty (resolve() would silently turn "" into the workspace
    // root, i.e. a directory, which is never what a caller meant).
    if (pathArgs.has(k) && typeof v === "string" && v !== "" && !v.startsWith("/")) {
      const container = resolve(root, v);
      out[k] = rewritePathsIn(container, `arguments.${k}`, root, 1, v);
      resolutions.push({ arg: k, asWritten: v, container });
    } else {
      out[k] = rewritePathsIn(v, `arguments.${k}`, root, 1);
    }
  }
  return { args: out, resolutions };
}

/**
 * One line naming, in full, every relative path this call resolved -- so the
 * absolute path actually handed to the emulator is never something the caller
 * has to infer. Returned to the AGENT, not just stderr: the failure this
 * prevents ("Failed to attach disk image", with no indication which file was
 * even attempted) is one the agent has to diagnose, and it cost a real session
 * before the resolution existed at all. Empty string when nothing was resolved,
 * so a call that passed absolute paths reads exactly as it always did.
 */
function resolutionNote(resolutions) {
  if (!resolutions || !resolutions.length) return "";
  const parts = resolutions.map((r) => `${r.arg}: "${r.asWritten}" -> ${r.container}`);
  return `vice-proxy: resolved relative path${resolutions.length > 1 ? "s" : ""} against the workspace root -- ${parts.join("; ")}`;
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

// -------------------------------------------------------------- broker lease
//
// On-demand acquisition (Phase 01.2): deferred to the FIRST forwarded
// tools/call, never to initialize/tools/list, matching the measured "spawn
// is eager, acquisition must not be" finding (spike-findings-bruce-lee
// skill, proxy-lifecycle-and-process-identity.md) -- a session that never
// forwards a call never asks the broker for anything (C3).
//
// brokerLeaseId is the request id this session's lease (if any) is keyed
// by -- the PRIMARY noun of the protocol (assumption-delta decision:
// promoted from port to request id, since ports are recycled across
// sessions under on-demand launch). null means either no lease has been
// acquired yet, or VICE_MCP_URL overrides the broker entirely.
let brokerLeaseId = null;
let brokerHeartbeatTimer = null;

// ----------------------------------------------------- grant containerization
//
// Quick task 260801-ccn (the inverse of Phase 01.1 criterion 9). The broker
// runs on the HOST, legitimately resolves its own repo root, and writes a
// grant carrying host-local coordinates: a loopback `url`, and
// `epoch_file`/`supervisor_dir` paths rooted at the host's own checkout --
// entirely correct from where the broker stands. Nothing inverted them
// before this task: loopback meant the CONTAINER's own loopback
// (ECONNREFUSED, since nothing listens there) and the host-rooted epoch
// path simply never resolved, so every broker-granted instance was silently
// unreachable. containerizeGrant() is the seam that fixes this -- called in
// ensureBrokerLease() below between pollGrant() returning a grant and
// useInstance() adopting it, since that is the LAST point before the
// coordinates become the session's identity (D-1).
function containerizeGrant(grant) {
  const grantId = grant && typeof grant.id === "string" ? grant.id : "(no id)";
  const port = Number(grant && grant.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    // T-mef-01's rule, reused here: nothing downstream can be trusted
    // without a validated port, so no translation is even attempted --
    // useInstance() fails on its own terms, exactly as it would have before
    // this function existed.
    console.error(
      `vice-proxy: containerizeGrant ${grantId}: grant.port (${grant && grant.port}) is not a valid integer ` +
        `port -- skipping translation entirely.`
    );
    return grant;
  }

  const alias = mcpHost();
  // containerizeRecord() (containerpath.ts) does the translation itself:
  // `url` through the loopback-rewrite (D-4), `epoch_file`/`supervisor_dir`
  // through the host->container path inverse (D-2 -- all three fields). An
  // already container-shaped record (every pre-existing broker test's
  // tmpdir-rooted VICE_POOL_DIR) matches no known host root and comes back
  // byte-identical -- D-7's whole point.
  const { record, changes } = containerizeRecord(grant, {
    pathFields: ["epoch_file", "supervisor_dir"],
    urlFields: ["url"],
    alias,
  });

  // Safety net (T-ccn-01, T-ccn-02), mirroring the outbound seam's own
  // posture: never open/connect to an unvalidated string read out of a
  // grant file. On either failure below, substitute the coordinate DERIVED
  // FROM THE VALIDATED PORT instead (instanceFor()'s own T-mef-01 rule,
  // reused here) and report the substitution -- never silently.
  const root = repoRoot();
  const fallbackDir = join(brokerRootDir(), String(port));
  const fallbackEpochFile = join(fallbackDir, "epoch.json");
  const fallbackUrl = `http://${alias}:${port}/mcp`;
  const changedFields = new Set(changes.map((c) => c.field));
  const substituted = { url: false, epoch_file: false, supervisor_dir: false };

  // T-ccn-01: only a field that was ACTUALLY TRANSLATED (its host root
  // matched) is re-checked for workspace containment -- an already
  // container-shaped path was never translated at all (D-7's passthrough)
  // and is trusted exactly as every pre-existing broker test already relies
  // on. A translated path escaping the workspace (a lexical ".." sequence
  // in the grant's own host-rooted field) is exactly what this check
  // catches.
  if (changedFields.has("epoch_file") && !isInsideWorkspace(resolve(record.epoch_file), root)) {
    record.epoch_file = fallbackEpochFile;
    substituted.epoch_file = true;
  }
  if (changedFields.has("supervisor_dir") && !isInsideWorkspace(resolve(record.supervisor_dir), root)) {
    record.supervisor_dir = fallbackDir;
    substituted.supervisor_dir = true;
  }

  // T-ccn-02: the FINAL url's port must equal the validated grant port,
  // checked UNCONDITIONALLY (translated or not) -- a grant could simply
  // declare a mismatched port from the start, translation aside, and that
  // is exactly the spoofing shape this check exists to catch.
  let urlPortOk = false;
  if (typeof record.url === "string") {
    try {
      urlPortOk = Number(new URL(record.url).port) === port;
    } catch {
      urlPortOk = false;
    }
  }
  if (!urlPortOk) {
    record.url = fallbackUrl;
    substituted.url = true;
  }

  // Exactly ONE stderr line, naming every field's before/after (or
  // "unchanged") -- this is the signal whose absence made the original bug
  // invisible; it must never become a line per field (D-2's own reporting
  // requirement).
  const parts = ["url", "epoch_file", "supervisor_dir"].map((field) => {
    const original = grant ? grant[field] : undefined;
    const final = record[field];
    if (substituted[field]) {
      return `${field}: SUBSTITUTED ${JSON.stringify(original)} -> ${JSON.stringify(final)} (port-derived fallback)`;
    }
    if (final === original) {
      return `${field}: unchanged (${JSON.stringify(final)})`;
    }
    return `${field}: ${JSON.stringify(original)} -> ${JSON.stringify(final)}`;
  });
  console.error(`vice-proxy: containerized grant ${grantId} -- ${parts.join("; ")}`);

  return record;
}

/**
 * Acquire a broker-granted instance for this session, once. Returns
 * immediately (no broker traffic at all) when a lease is already held, and
 * immediately when VICE_MCP_URL is set -- an explicit endpoint override
 * means the caller already chose an instance, which is both the principled
 * rule and what keeps every pre-existing proxy test passing with no edit.
 *
 * Ordering is load-bearing: the lease is created BEFORE awaiting the grant,
 * not after. This is what makes the broker's own teardown logic safe --
 * process_teardowns() only tears a grant down when its lease is ABSENT, and
 * if the lease were created only after a grant arrived, a broker pass
 * landing in that narrow window would see a grant with no lease yet and
 * tear it down out from under this very acquisition.
 */
async function ensureBrokerLease() {
  if (brokerLeaseId) return { ok: true };
  if (process.env.VICE_MCP_URL) return { ok: true }; // explicit override -- broker never contacted

  // Classify liveness FIRST, before writing any request (C10). never_started
  // and stale both return their message immediately, with no request
  // written and no lease created -- there is nothing on the other side to
  // read a request, so writing one would litter the directory and delay the
  // diagnosis. readBrokerLiveness() re-reads broker.json fresh on every call
  // (see its own implementation in vice-broker-client.mjs); nothing here
  // memoises the verdict, so this is the broker-path instance of the same
  // never-cache-a-negative-result invariant the comment above
  // ensureViceSession() already states for the host path -- the call after a
  // human starts the broker just works, with no session restart required.
  const liveness = readBrokerLiveness();
  if (liveness.state === "never_started") {
    return { ok: false, message: brokerNeverStartedMessage() };
  }
  if (liveness.state === "stale") {
    return { ok: false, message: brokerDeadOrHungMessage(liveness) };
  }

  const id = newRequestId();
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID || null;
  const clientPidRaw = Number(process.env.CLAUDE_PID);
  const clientPid = Number.isFinite(clientPidRaw) ? clientPidRaw : null;

  writeRequest({ id, sessionId, clientPid });
  createLease({ id, sessionId, clientPid }); // BEFORE pollGrant() -- see comment above

  const acquireStartedAt = Date.now();
  const result = await pollGrant(id);
  if (!result.granted) {
    // Neither a grant nor a lasting reason to keep this attempt's files
    // around -- a denial or a warming timeout both leave no orphan for the
    // sweeper to reap later.
    try {
      releaseLease(id); // no grant is coming for this id -- release the lease we already created
    } catch {
      /* best effort -- the lease may already be gone */
    }
    removeRequestFile(id);
    if (result.denial) {
      return { ok: false, message: brokerLaunchFailedMessage(result.reason || "denied with no reason recorded") };
    }
    return { ok: false, message: brokerWarmingMessage(Date.now() - acquireStartedAt) };
  }

  brokerLeaseId = id;
  // Invert the grant's host-local coordinates BEFORE useInstance() adopts
  // them (D-1, this task) -- this is the LAST point before the coordinates
  // become the session's identity: the endpoint every later tool call is
  // sent to, and the path the epoch guard opens.
  const containerized = containerizeGrant(result.grant);
  useInstance({ port: containerized.port, url: containerized.url, epochFile: containerized.epoch_file, pooled: true });
  viceSession = null; // re-baseline: the next ensureViceSession() reads the GRANTED instance's own epoch file
  // startHeartbeat() (vice-broker-client.mjs) returns an unref'd interval
  // timer -- unref'd so the TIMER never holds this process alive past its
  // natural lifetime; stdin being open is what does that. Keeping the timer
  // handle here is only so a future stop-the-heartbeat path has something to
  // clear; nothing currently reads it back.
  brokerHeartbeatTimer = startHeartbeat(id);
  return { ok: true };
}

// ------------------------------------------------ D-16 seam hazard annotation
//
// Plan 01.3-04. Structurally the OPPOSITE of the deny-list refusal below (the
// DENY_LIST.includes(name) branch a little further into this same function):
// the refusal fires BEFORE forwarding and the call never reaches the host;
// this fires AFTER call() returns a real payload and appends to a
// SUCCESSFUL result. The call is never refused and the error flag is never
// set (D-16) -- a stopping checkpoint on an IRQ handler is core reverse-
// engineering technique that Phase 2's exhaustive trace depends on, so this
// warns instead of blocking it, the way the deny list blocks vice_disk_list
// (which has no legitimate use at all).

// The set of capability names whose OWN arguments can express an armed,
// stopping, exec checkpoint. Today that is vice_checkpoint_add alone.
// Re-enabling an already-armed stopping checkpoint via vice_checkpoint_toggle
// or a checkpoint group (vice_checkpoint_group_toggle/_add) can ALSO re-arm
// one, but neither call's own arguments carry the stop flag -- only the
// id/group being toggled -- so that re-enable path is NOT detectable from
// the call alone and is deliberately excluded from this set. That gap is
// covered by both tools' own descriptions and by vice_diagnose's checkpoint-
// trap check, and it is stated in the annotation text below rather than left
// for a reader to discover.
const CHECKPOINT_ARMING_TOOLS = new Set(["vice_checkpoint_add"]);

// Per-session suppression: an address (as rendered by formatAddress(), or an
// "unparseable:<raw>" key for an address that could not be parsed) already
// warned about this session maps to true. Cleared whenever the observed
// epoch changes -- a new machine has seen none of these. currentEpoch() is a
// synchronous LOCAL file read (see its own definition above), never a
// forwarded call, so consulting it here does not violate the "makes no
// forwarded call of its own" requirement below.
let seamHazardSeen = new Set();
let seamHazardEpochKey = null;

function seamHazardObserveEpoch() {
  const epoch = currentEpoch();
  const key = epoch && epoch.present ? epoch.epoch : null;
  if (seamHazardEpochKey !== null && key !== seamHazardEpochKey) {
    seamHazardSeen = new Set(); // a new machine has seen none of these
  }
  seamHazardEpochKey = key;
}

/**
 * D-16's hazard annotation. Returns the annotation text for a successful
 * checkpoint-arming call, or nothing. Returns nothing unless the capability
 * is in CHECKPOINT_ARMING_TOOLS and the arguments express an exec operation
 * with the stop flag set -- callers only reach this after a successful
 * call(), so a rejected arm never reaches here at all (a failed arm has no
 * hazard to warn about). Makes NO forwarded call of its own (T-01.3-13) --
 * the detection is entirely over the arguments the agent already supplied.
 * An unparseable address is still annotated, naming the address as unread
 * rather than silently skipping: an unparseable address is not evidence of
 * safety.
 */
function detectCheckpointArmingHazard(name, args) {
  if (!CHECKPOINT_ARMING_TOOLS.has(name)) return undefined;
  // vice_checkpoint_add's own schema: `stop` defaults true, `exec` defaults
  // true -- an ABSENT field is armed, not merely "true when written out".
  const stopArmed = !(args && args.stop === false);
  const execArmed = !(args && args.exec === false);
  if (!stopArmed || !execArmed) return undefined;

  seamHazardObserveEpoch();

  const addrNum = toAddressNumber(args && args.start);
  const addrLabel =
    addrNum === null ? `an unparseable address (raw value: ${JSON.stringify(args && args.start)})` : formatAddress(addrNum);
  const suppressionKey = addrNum === null ? `unparseable:${JSON.stringify(args && args.start)}` : addrLabel;

  const repeat = seamHazardSeen.has(suppressionKey);
  if (!repeat) seamHazardSeen.add(suppressionKey);
  return { addrLabel, repeat };
}

function renderCheckpointArmingHazard(detection) {
  const { addrLabel, repeat } = detection;
  if (repeat) {
    return (
      `vice-proxy hazard (repeat): a stopping exec checkpoint was armed again at ${addrLabel} -- the full ` +
      "hazard note for this address was already issued earlier this session; see that note."
    );
  }
  return [
    `vice-proxy hazard: a stopping exec checkpoint was just armed at ${addrLabel}, and the call was NOT ` +
      "blocked -- it will not be, because this is core reverse-engineering technique.",
    "",
    "This shape -- a stopping exec checkpoint armed, then execution resumed -- is common to every recorded " +
      "freeze on this project. Two variants are on record: a mid-routine stop that froze two independent " +
      "sessions at an identical program counter, and an IRQ-handler-entry stop whose tell was a hit count " +
      "of zero on a screen the machine must have been executing.",
    "",
    "Whether THIS address is the live IRQ handler is a question vice_diagnose answers, by resolving the " +
      "vector pair live -- this warning deliberately does not resolve it here, because doing so on every " +
      "arm would disturb the machine it is protecting.",
    "",
    "Recovery, in order: run vice_diagnose first; reach for vice_recycle only when the bracket says wedge " +
      "with no checkpoint explanation.",
    "",
    "Stated residual: re-enabling this checkpoint later via vice_checkpoint_toggle or a checkpoint group " +
      "carries no stop flag in its own arguments and is therefore NOT annotated by this mechanism -- covered " +
      "by both tools' own descriptions and by vice_diagnose's checkpoint-trap check instead.",
  ].join("\n");
}

/**
 * Plan 01.3-04 task 2: turns task 1's single hazard into the general
 * mechanism D-06 needs -- a table, so the next confirmed trigger (plan
 * 01.3-05's bounded hunt) is a single entry rather than new plumbing at this
 * seam. Each entry:
 *   - id: a short identifier that MUST be named by at least one test in
 *     vice-proxy.test.mjs (this file's own structural completeness test
 *     enforces it) -- an entry that ships without a matching test fails the
 *     suite rather than shipping unproven.
 *   - capabilities: the Set of tool names this entry's own detect() can ever
 *     match against. Used ONLY by the disjointness structural test below
 *     (never for dispatch -- the walk tries every entry against every
 *     call). Every capability named here must be ABSENT from DENY_LIST: a
 *     capability with no legitimate use is refused before forwarding, and
 *     one with a legitimate use is annotated after it, and none is both
 *     (D-16).
 *   - detect(name, args, payload): returns a truthy detection payload, or
 *     nothing. MUST make no forwarded call of its own (T-01.3-13).
 *   - render(detection): returns the annotation text for a truthy
 *     detection.
 *
 * Plan 01.3-05 is this table's expected next writer, adding the bounded
 * hunt's own confirmed trigger as one more entry here -- not new plumbing.
 */
const SEAM_HAZARDS = [
  {
    id: "checkpoint-arming",
    capabilities: CHECKPOINT_ARMING_TOOLS,
    detect: detectCheckpointArmingHazard,
    render: renderCheckpointArmingHazard,
  },
];

// TEST-ONLY escape hatch (plan 01.3-04 task 2's data-driven proof): proves
// the walk below is genuinely data-driven, not hand-wired to the one
// production entry above, by injecting a SECOND entry the same way a real
// plan 01.3-05 entry would arrive. Matches against vice_ping -- an existing,
// universally-forwardable tool -- rather than inventing a synthetic
// capability name that would need its own manifest/deny-list bookkeeping.
// Never set outside this file's own test suite.
if (process.env.VICE_SEAM_HAZARDS_TEST_FIXTURE === "1") {
  SEAM_HAZARDS.push({
    id: "test-fixture-synthetic-entry",
    capabilities: new Set(["vice_ping"]),
    detect: (name) => (name === "vice_ping" ? { fixture: true } : undefined),
    render: () => "vice-proxy hazard (TEST FIXTURE): synthetic second SEAM_HAZARDS entry, detected and annotated through the same walk.",
  });
}

/**
 * Walks SEAM_HAZARDS, concatenating every annotation a successful call
 * attracts. Short-circuits per entry on a falsy detection -- a call matching
 * no entry costs one array pass and returns undefined, leaving the payload
 * untouched.
 */
function renderSeamHazardAnnotations(name, args, payload) {
  const notes = [];
  for (const entry of SEAM_HAZARDS) {
    const detection = entry.detect(name, args, payload);
    if (detection) {
      notes.push(entry.render(detection));
    }
  }
  return notes.length ? notes.join("\n\n") : undefined;
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

  // The recycle tool: also entirely a proxy-local concern (plan 01.3-01),
  // served in the same synthetic-tool slot as vice_result_continue above --
  // before any deny-list or epoch logic, and NEVER forwarded to the host as
  // a plain tools/call (handleRecycle() drives the broker's own recycle
  // request protocol itself).
  if (name === RECYCLE_TOOL.name) {
    return handleRecycle(args);
  }

  // The diagnose tool (plan 01.3-02): also entirely a proxy-local concern,
  // served in the same synthetic-tool slot as the two above -- before any
  // deny-list or epoch logic. handleDiagnose() drives its own forwarded
  // reads via call() and its own epoch bookkeeping, rather than the generic
  // forwarding path below, because its epoch-drift and trap outcomes are
  // REPORTS (a verdict), never a refusal.
  if (name === DIAGNOSE_TOOL.name) {
    return handleDiagnose(args);
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

  const leaseResult = await ensureBrokerLease();
  if (!leaseResult.ok) {
    return isErrorText(leaseResult.message);
  }
  if (brokerLeaseId) {
    touchLease(brokerLeaseId); // touch-on-every-forwarded-call (C6), in addition to the heartbeat timer
  }

  ensureViceSession();

  const beforeDrift = checkEpochAndRebaseline("before forwarding");
  if (beforeDrift) {
    // Refused BEFORE any request is serialised -- the whole point of the
    // pre-forward check.
    return isErrorText(beforeDrift);
  }

  // Pre-flight liveness probe (task 2 / criterion 7), ordered AFTER the
  // deny-list refusal and the epoch comparison above (a refused tool and a
  // restarted machine both need answering without any network activity at
  // all) and BEFORE delegating to call() -- see vice-probe.ts's header for
  // why this is a single 1500ms-budget round trip with no retry, never
  // wrapped in withReconnect()'s ladder. One call site, not inside a loop.
  const { url, port } = activeInstance();
  const probe = await probeInstance({ url, port });
  if (!probe.alive) {
    const epoch = currentEpoch();
    // D-5 (quick-260801-ccn task 3): the lease check runs FIRST, before the
    // refused-and-no-epoch test below -- under the bug this fixes, BOTH of
    // that test's arms hold true for a fresh broker grant (a just-granted
    // instance's own epoch_file rarely has a baseline recorded yet), so a
    // broker-granted instance was being answered by the RETIRED fixed-port
    // triple instead of naming the broker. That ordering was the whole
    // defect.
    if (brokerLeaseId) {
      return isErrorText(brokerGrantedUnreachableMessage(probe, epoch));
    }
    if (isConnectionRefusedReason(probe.reason) && !epoch.present) {
      return isErrorText(neverStartedMessage(probe));
    }
    // Every other unreachable shape -- refused-with-an-epoch-on-record,
    // timed out, or something answered but didn't look like VICE -- is
    // "dead or hung"; probe.reason itself says which, verbatim.
    return isErrorText(deadOrHungMessage(probe, epoch));
  }

  // Path translation at the seam (task 3 / decision D-G / criterion 9),
  // ordered after the deny-list refusal, the epoch comparison and the
  // liveness probe above, and before delegating to call(). A refusal here
  // (out-of-workspace absolute path, or a translation failure) is returned
  // exactly like every other tools/call outcome: a well-formed isError:true
  // result, never a throw.
  let translatedArgs;
  let pathNote = "";
  try {
    const rewritten = rewriteArguments(args, name);
    translatedArgs = rewritten.args;
    pathNote = resolutionNote(rewritten.resolutions);
  } catch (e) {
    if (e instanceof PathOutOfWorkspaceError || e instanceof PathTranslationError) {
      return isErrorText(e.message);
    }
    throw e; // unexpected -- let the never-throw dispatch one layer up handle it
  }

  let payload;
  try {
    payload = await call(name, translatedArgs);
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
    // The probe above already proved the host alive, so this is the "alive
    // but the operation failed" state -- relay verbatim, no restart advice.
    // The path note rides along on the FAILURE too, and this is the case it
    // was written for: a host-side "Failed to attach disk image" says nothing
    // about which file was attempted, so naming the resolved absolute path
    // here is the difference between a one-line fix and an hour spent
    // suspecting the emulator.
    const failure = aliveButFailedMessage(e && e.message ? e.message : String(e));
    return isErrorText(pathNote ? `${failure}\n${pathNote}` : failure);
  }

  const afterDrift = checkEpochAndRebaseline("after the call returned");
  if (afterDrift) {
    // A payload read from a machine whose identity changed mid-call is not
    // trustworthy -- return the restart frame INSTEAD OF the call's result.
    return isErrorText(afterDrift);
  }

  const rawText = typeof payload === "string" ? payload : JSON.stringify(payload);
  // D-16 seam hazard annotation (plan 01.3-04): computed by walking
  // SEAM_HAZARDS and merged into the TEXT itself, BEFORE wrapPossiblyChunked()
  // runs, so an oversized annotated result still carries the note inside its
  // own chunking (T-01.3-15) -- a warning appended AFTER chunking would be
  // lost off the end. Never routes through isErrorText and never touches the
  // error flag (D-16, T-01.3-12).
  const hazardNote = renderSeamHazardAnnotations(name, args, payload);
  const text = hazardNote ? `${rawText}\n\n${hazardNote}` : rawText;
  const wrapped = wrapPossiblyChunked(text);
  // Append the path note as a trailing content item, never mixed into the
  // payload: wrapPossiblyChunked()'s contract is that the FIRST item is the
  // payload byte-for-byte, so reassembly stays a plain concatenation. Only
  // the unchunked shape is annotated -- a chunked result is already carrying
  // a continuation marker as its second item, and the four tools that can
  // resolve a path (disk_attach, autostart, display_screenshot, symbols_load)
  // never produce output anywhere near the cap.
  if (pathNote && wrapped.content.length === 1) {
    wrapped.content.push({ type: "text", text: pathNote });
  }
  return wrapped;
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

// -------------------------------------------------------------- teardown
//
// TWO ladders, not one, firing DIFFERENT handlers (spike-findings-bruce-lee
// skill, shutdown-and-lease-release.md -- measured, not assumed): a
// graceful client ending delivers SIGINT first, then SIGTERM ~100ms later,
// then SIGKILL at ~490ms total, and NEVER closes stdin. Abrupt client death
// closes stdin (`end` then `close`) and NEVER signals. Each family covers
// exactly the ending the other misses, so both are wired below; SIGINT is a
// teardown trigger here, not a user Ctrl-C to ignore -- it is the FIRST
// signal of every graceful ending.
//
// The measured numbers this depends on: ~490ms from the first signal to
// SIGKILL, ~0.1ms for the lease's unlinkSync -- roughly three orders of
// magnitude of headroom. The entire handler body below is ONE synchronous
// filesystem operation and awaits nothing (C5): introducing anything
// asynchronous here (an await, a fetch, a child process, a call to the
// broker) reintroduces leaked leases silently, since there would be no time
// left for it to complete before SIGKILL cuts the process off.
//
// This removes the file's only explicit process.exit( call: nothing needs
// it any more. The graceful path is killed by SIGKILL ~490ms after the
// first signal regardless of anything this process does, and the abrupt
// path exits naturally once stdin is gone and nothing else is listening.
//
// TEARDOWN-REGION-BEGIN -- vice-proxy.test.mjs's source assertion slices
// the file between this marker and its closing counterpart further below,
// and asserts that slice contains no promise-awaiting construct and calls
// the broker client's release function exactly once. Do not move either
// marker away from the code each one bounds.
let teardownRan = false;

function releaseLeaseNow(trigger) {
  if (!brokerLeaseId) return;
  try {
    releaseLease(brokerLeaseId);
  } catch (err) {
    console.error(`vice-proxy: lease_unlink_failed trigger=${trigger}: ${err && err.message ? err.message : err}`);
  }
}

function onTeardown(trigger) {
  if (teardownRan) return; // idempotent -- SIGINT then SIGTERM ~100ms later both call in
  teardownRan = true;
  releaseLeaseNow(trigger);
}

process.stdin.on("end", () => onTeardown("stdin_end"));
process.stdin.on("close", () => onTeardown("stdin_close"));
// Registered as three explicit calls, not a loop over an array, so a
// durable source-grep for "is SIGINT/SIGTERM/SIGHUP each really wired"
// (this task's own acceptance criteria) has a literal string to find for
// each one -- SIGINT first, since it is the first signal of every graceful
// ending and must never be mistaken for a plain user Ctrl-C to ignore.
process.on("SIGINT", () => onTeardown("SIGINT"));
process.on("SIGTERM", () => onTeardown("SIGTERM"));
process.on("SIGHUP", () => onTeardown("SIGHUP"));
// TEARDOWN-REGION-END

warnOnceAboutOutputLimit(); // D-1.2-H -- one stderr line, at most once per process, never a refusal

console.error(`vice-proxy: ready, forwarding to ${activeInstance().url} (port ${activeInstance().port})`);
