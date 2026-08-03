#!/usr/bin/env node
// Container-side half of the on-demand broker protocol (Phase 01.2). The
// host-side half is resources/vice-broker.sh; this module writes the
// request/lease files that script reads and reads the grant/denial/broker
// files that script writes, all on the SAME .vice-supervisor/ bind mount
// tools/vice-supervisor.sh's epoch.json already uses (and, before its
// 2026-08-02 deletion, tools/vice-pool.sh's registry.json did too) --
// deliberately not a new channel.
//
// Every read of a broker-written file is untrusted input, exactly like
// vice-pool.mjs's readRegistry()/isReclaimable() treated registry.json and
// lease files before that module's 2026-08-02 deletion: parse in try/catch,
// a malformed or half-written file is "not there yet" or "absent", never a
// thrown exception. See 01.2-PATTERNS.md's "Never-throw /
// never-cache-a-negative-result" section.
//
// MUST NOT import hostpath.ts: the host-path consumer set is closed to
// four production modules by vice-mcp-selector-docs.test.mjs's assertion 4,
// and host-path message text stays in vice-proxy.mjs, which is already on
// that list.
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

import { supervisorDir } from "./repo-root.ts";

// -------------------------------------------------------------- request ids
//
// Primary noun of this protocol (assumption-delta decision, 01.2-01-PLAN.md):
// a request/grant/lease is identified by this id, never by port -- ports are
// recycled across sessions under on-demand launch, so a port is an attribute
// OF a grant, not identity. Matched byte-for-byte against the same shape
// resources/vice-broker.sh's own request-id pattern validates (T-01.2-01);
// the request-id-pattern parity test in vice-broker.test.mjs drives one
// shared corpus through both validators so neither side can silently accept
// an id shape the other rejects.
export const REQUEST_ID_PATTERN = /^req-[0-9]+-[0-9]+-[0-9a-f]{8}$/;

export function newRequestId() {
  return `req-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export function isValidRequestId(id) {
  return typeof id === "string" && REQUEST_ID_PATTERN.test(id);
}

// -------------------------------------------------------------- directories
//
// Resolved from VICE_POOL_DIR when set, otherwise from repo-root.ts's
// supervisorDir() -- the SAME default `.vice-supervisor` directory every
// other host/container pairing in this module tree already agrees on, so
// container and host never derive two different roots for this protocol.
export function brokerRootDir() {
  return process.env.VICE_POOL_DIR ? resolve(process.env.VICE_POOL_DIR) : supervisorDir();
}

export function requestsDir(dir = brokerRootDir()) {
  return join(dir, "requests");
}

export function grantsDir(dir = brokerRootDir()) {
  return join(dir, "grants");
}

export function denialsDir(dir = brokerRootDir()) {
  return join(dir, "denials");
}

export function brokerLeasesDir(dir = brokerRootDir()) {
  return join(dir, "leases");
}

// Recycle acks (plan 01.3-01) -- one file per recycle request id, written by
// resources/vice-broker.sh's write_recycle_ack() and polled by
// pollRecycleAck() below. A sibling of grantsDir()/denialsDir() above, on
// the SAME .vice-supervisor/ bind mount -- no new channel.
export function recycleAcksDir(dir = brokerRootDir()) {
  return join(dir, "recycle-acks");
}

export function brokerJsonPath(dir = brokerRootDir()) {
  return join(dir, "broker.json");
}

export function leasePathFor(id, dir = brokerRootDir()) {
  return join(brokerLeasesDir(dir), id);
}

// ---------------------------------------------------------- atomic write
//
// Shared tmp-then-rename helper (the same shape vice-pool.mjs's
// refreshLease() used before that module's 2026-08-02 deletion): every
// protocol file this module writes goes through here, so there is
// exactly one place the atomicity rule lives on the container side, matching
// resources/vice-broker.sh's own single write_json_atomic() choke point on
// the host side.
function writeJsonAtomic(targetPath, tmpDir, data) {
  mkdirSync(tmpDir, { recursive: true });
  const tmp = join(tmpDir, `.tmp-${process.pid}-${randomUUID()}`);
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, targetPath);
}

/** Read and JSON.parse `path`, treating any failure (missing file, partial
 * write, malformed JSON, non-object shape) as "not there yet" rather than
 * throwing -- matches the posture vice-pool.mjs's readRegistry() used
 * before its 2026-08-02 deletion. */
function readJsonMaybe(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- writeRequest
//
// Writes requests/<id>.json. `id` MUST already be a newRequestId() output --
// validated here (T-01.2-01) before it is used to build any path, matching
// the host-side script's own pre-use validation.
export function writeRequest({ id, op = "acquire", sessionId = null, clientPid = null } = {}) {
  if (!isValidRequestId(id)) {
    throw new Error(`writeRequest: invalid request id: ${id}`);
  }
  const dir = requestsDir();
  const record = {
    version: 1,
    id,
    op,
    proxy_pid: process.pid,
    session_id: sessionId,
    client_pid: clientPid,
    created_at: new Date().toISOString(),
  };
  writeJsonAtomic(join(dir, `${id}.json`), dir, record);
  return record;
}

// -------------------------------------------------------- writeRecycleRequest
//
// Writes requests/<id>.json with op:"recycle" -- the first value that field
// has ever carried (plan 01.3-01). Both `id` (this request's own id) and
// `targetId` (the grant being recycled) are validated against
// REQUEST_ID_PATTERN BEFORE either is used to build any path (T-01.3-06),
// matching writeRequest()'s own precondition above.
export function writeRecycleRequest({ id, targetId, reason, sessionId = null, clientPid = null } = {}) {
  if (!isValidRequestId(id)) {
    throw new Error(`writeRecycleRequest: invalid request id: ${id}`);
  }
  if (!isValidRequestId(targetId)) {
    throw new Error(`writeRecycleRequest: invalid target id: ${targetId}`);
  }
  const dir = requestsDir();
  const record = {
    version: 1,
    id,
    op: "recycle",
    target_id: targetId,
    reason: typeof reason === "string" ? reason : "",
    proxy_pid: process.pid,
    session_id: sessionId,
    client_pid: clientPid,
    created_at: new Date().toISOString(),
  };
  writeJsonAtomic(join(dir, `${id}.json`), dir, record);
  return record;
}

// -------------------------------------------------------------- createLease
//
// Writes leases/<id>. Existence of this file IS the claim; its mtime is the
// heartbeat (touchLease below); its removal IS the release (releaseLease
// below) -- three separate jobs, one file, per the phase's own must_haves.
export function createLease({ id, sessionId = null, clientPid = null } = {}) {
  if (!isValidRequestId(id)) {
    throw new Error(`createLease: invalid request id: ${id}`);
  }
  const dir = brokerLeasesDir();
  const record = {
    version: 1,
    id,
    proxy_pid: process.pid,
    session_id: sessionId,
    client_pid: clientPid,
    created_at: new Date().toISOString(),
  };
  writeJsonAtomic(leasePathFor(id), dir, record);
  return record;
}

// --------------------------------------------------------------- touchLease
//
// Refreshes the lease's mtime by rewriting it (atomically) with its own
// existing content -- called on every forwarded call and by the unref'd
// heartbeat timer (startHeartbeat below). A lease that has already been
// released (file missing) is a silent no-op: by the time a heartbeat tick or
// a stray call lands after release, there is nothing left to touch, and that
// is not an error.
export function touchLease(id) {
  const lp = leasePathFor(id);
  let rec = readJsonMaybe(lp);
  if (rec === null) {
    // Either genuinely absent, or unreadable/malformed -- in the latter case
    // rewrite a minimal, well-formed record rather than propagate a parse
    // failure; in the former, there is nothing to touch.
    try {
      readFileSync(lp, "utf8");
    } catch {
      return false; // genuinely absent -- nothing to touch
    }
    rec = { version: 1, id };
  }
  try {
    writeJsonAtomic(lp, brokerLeasesDir(), rec);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------- releaseLease
//
// The ENTIRE release: one ATTEMPTED unlinkSync, nothing else -- no promise,
// no timer, no subprocess. The ~490ms graceful shutdown window has no room
// for anything more (see the spike-findings-bruce-lee skill's
// shutdown-and-lease-release.md). Idempotent by design: a lease already
// removed (a double release, or the broker's own sweep racing this call) is
// a silent no-op, never a throw -- "release something that's already
// released" is the expected shape of both a double-teardown (SIGINT then
// SIGTERM ~100ms later, both calling in) and a post-sweep release, matching
// the idempotent posture vice-pool.mjs's own releaseLeaseByToken() used
// before its 2026-08-02 deletion. The
// caller (vice-proxy.mjs's releaseLeaseNow()) still wraps this in its own
// try/catch that logs to stderr, as a second layer for anything this
// swallow does not anticipate (e.g. a permissions error).
export function releaseLease(id) {
  try {
    unlinkSync(leasePathFor(id));
  } catch {
    // already gone -- release is idempotent, nothing else to do
  }
}

// -------------------------------------------------------------- pollGrant
//
// Polls to a deadline for grants/<id>.json or denials/<id>.json, never
// throwing on a malformed or half-read file -- a parse failure is treated
// as "not there yet", matching the posture vice-pool.mjs's readRegistry()
// used before its 2026-08-02 deletion.
export const GRANT_POLL_TIMEOUT_MS = Number(process.env.VICE_BROKER_GRANT_TIMEOUT_MS || 25000);
export const GRANT_POLL_INTERVAL_MS = 500;

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

export async function pollGrant(id, { timeoutMs = GRANT_POLL_TIMEOUT_MS, pollMs = GRANT_POLL_INTERVAL_MS } = {}) {
  const grantPath = join(grantsDir(), `${id}.json`);
  const denialPath = join(denialsDir(), `${id}.json`);
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const grant = readJsonMaybe(grantPath);
    if (grant) {
      return { granted: true, grant, denial: null, reason: null };
    }
    const denial = readJsonMaybe(denialPath);
    if (denial) {
      return { granted: false, grant: null, denial, reason: typeof denial.reason === "string" ? denial.reason : "denied" };
    }
    if (Date.now() >= deadline) {
      return { granted: false, grant: null, denial: null, reason: `no grant or denial appeared within ${timeoutMs}ms` };
    }
    await sleepMs(Math.max(0, Math.min(pollMs, deadline - Date.now())));
  }
}

// ----------------------------------------------------------- pollRecycleAck
//
// Structurally the SAME poll-to-deadline loop as pollGrant() above, reading
// recycle-acks/<id>.json instead -- a malformed or half-written ack file is
// treated as not-yet-there rather than thrown, matching readJsonMaybe()'s
// never-throw posture throughout this module.
export const RECYCLE_ACK_TIMEOUT_MS = Number(process.env.VICE_BROKER_RECYCLE_TIMEOUT_MS || 30000);
export const RECYCLE_ACK_POLL_INTERVAL_MS = 500;

export async function pollRecycleAck(id, { timeoutMs = RECYCLE_ACK_TIMEOUT_MS, pollMs = RECYCLE_ACK_POLL_INTERVAL_MS } = {}) {
  const ackPath = join(recycleAcksDir(), `${id}.json`);
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const ack = readJsonMaybe(ackPath);
    if (ack) {
      return { acked: true, ack, reason: null };
    }
    if (Date.now() >= deadline) {
      return { acked: false, ack: null, reason: `no recycle ack appeared within ${timeoutMs}ms` };
    }
    await sleepMs(Math.max(0, Math.min(pollMs, deadline - Date.now())));
  }
}

// --------------------------------------------------------- readBrokerLiveness
//
// Classifies broker.json as never_started / stale / alive against
// BROKER_STALE_MS. Plan 04 consumes the three states for its diagnostics;
// this task only needs the classification to exist and be correct.
export const BROKER_STALE_MS = Number(process.env.VICE_BROKER_STALE_MS || 180000);

export function readBrokerLiveness(path = brokerJsonPath()) {
  const parsed = readJsonMaybe(path);
  if (parsed === null) {
    return { state: "never_started", pid: null, heartbeatAt: null, path };
  }
  const pid = Number.isFinite(parsed.pid) ? parsed.pid : null;
  const heartbeatAt = typeof parsed.heartbeat_at === "string" ? parsed.heartbeat_at : null;
  const heartbeatMs = heartbeatAt ? Date.parse(heartbeatAt) : NaN;
  if (!Number.isFinite(heartbeatMs)) {
    return { state: "never_started", pid, heartbeatAt, path };
  }
  const state = Date.now() - heartbeatMs > BROKER_STALE_MS ? "stale" : "alive";
  return { state, pid, heartbeatAt, path };
}

// --------------------------------------------------------------- heartbeat
//
// An unref'd interval timer touching the lease -- keeps a thinking session's
// lease from looking abandoned to the broker's TTL sweeper, per the measured
// "nothing reaps an idle proxy" finding. unref()'d so the TIMER never holds
// the process alive; stdin being open is what does that (see
// timeout-and-latency-budgets.md).
export const HEARTBEAT_MS = Number(process.env.VICE_BROKER_HEARTBEAT_MS || 60000);

export function startHeartbeat(id, { intervalMs = HEARTBEAT_MS } = {}) {
  const timer = setInterval(() => {
    touchLease(id);
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}
