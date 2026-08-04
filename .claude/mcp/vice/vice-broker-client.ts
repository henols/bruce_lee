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
import { connect, type Socket } from "node:net";

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
//
// C7 (Phase 01.6.1): this is the criterion's whole container-side
// deliverable -- a real, typed, NAMED export whose VALUE is unchanged from
// the pre-conversion .mjs (verified live, this plan's SUMMARY quotes both).
// 01.6.2's in-process broker imports this exact binding rather than
// re-stating the pattern a third time; the bash copy
// (resources/vice-broker.sh) does not retire until that phase deletes it.
export const REQUEST_ID_PATTERN: RegExp = /^req-[0-9]+-[0-9]+-[0-9a-f]{8}$/;

export function newRequestId(): string {
  return `req-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export function isValidRequestId(id: unknown): id is string {
  return typeof id === "string" && REQUEST_ID_PATTERN.test(id);
}

// -------------------------------------------------------------- directories
//
// Resolved from VICE_POOL_DIR when set, otherwise from repo-root.ts's
// supervisorDir() -- the SAME default `.vice-supervisor` directory every
// other host/container pairing in this module tree already agrees on, so
// container and host never derive two different roots for this protocol.
export function brokerRootDir(): string {
  return process.env.VICE_POOL_DIR ? resolve(process.env.VICE_POOL_DIR) : supervisorDir();
}

export function requestsDir(dir: string = brokerRootDir()): string {
  return join(dir, "requests");
}

export function grantsDir(dir: string = brokerRootDir()): string {
  return join(dir, "grants");
}

export function denialsDir(dir: string = brokerRootDir()): string {
  return join(dir, "denials");
}

export function brokerLeasesDir(dir: string = brokerRootDir()): string {
  return join(dir, "leases");
}

// Recycle acks (plan 01.3-01) -- one file per recycle request id, written by
// resources/vice-broker.sh's write_recycle_ack() and polled by
// pollRecycleAck() below. A sibling of grantsDir()/denialsDir() above, on
// the SAME .vice-supervisor/ bind mount -- no new channel.
export function recycleAcksDir(dir: string = brokerRootDir()): string {
  return join(dir, "recycle-acks");
}

export function brokerJsonPath(dir: string = brokerRootDir()): string {
  return join(dir, "broker.json");
}

export function leasePathFor(id: string, dir: string = brokerRootDir()): string {
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
function writeJsonAtomic<T>(targetPath: string, tmpDir: string, data: T): void {
  mkdirSync(tmpDir, { recursive: true });
  const tmp = join(tmpDir, `.tmp-${process.pid}-${randomUUID()}`);
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, targetPath);
}

/** True iff `value` is a well-formed, generic JSON object -- not null, not
 * an array. Shared by readJsonMaybe()'s parse step, matching
 * vice-broker.mts's readBrokerRecordMaybe()'s own isPlainObject() predicate
 * exactly (that file's own doc comment states it matches this module's
 * posture). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read and JSON.parse `path`, treating any failure (missing file, partial
 * write, malformed JSON, non-object shape) as "not there yet" rather than
 * throwing -- matches the posture vice-pool.mjs's readRegistry() used
 * before its 2026-08-02 deletion. Two nested try/catch layers, one for the
 * read and one for the parse -- never collapsed into one, never replaced by
 * a thrown error (T-01.6.1-01). */
function readJsonMaybe(path: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export interface RequestRecord {
  version: number;
  id: string;
  op: string;
  proxy_pid: number;
  session_id: string | null;
  client_pid: number | null;
  created_at: string;
}

export interface WriteRequestOptions {
  id: string;
  op?: string;
  sessionId?: string | null;
  clientPid?: number | null;
}

// ------------------------------------------------------------- writeRequest
//
// Writes requests/<id>.json. `id` MUST already be a newRequestId() output --
// validated here (T-01.2-01) before it is used to build any path, matching
// the host-side script's own pre-use validation.
export function writeRequest({ id, op = "acquire", sessionId = null, clientPid = null }: WriteRequestOptions): RequestRecord {
  if (!isValidRequestId(id)) {
    throw new Error(`writeRequest: invalid request id: ${id}`);
  }
  const dir = requestsDir();
  const record: RequestRecord = {
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

export interface RecycleRequestRecord {
  version: number;
  id: string;
  op: "recycle";
  target_id: string;
  reason: string;
  proxy_pid: number;
  session_id: string | null;
  client_pid: number | null;
  created_at: string;
}

export interface WriteRecycleRequestOptions {
  id: string;
  targetId: string;
  reason?: string;
  sessionId?: string | null;
  clientPid?: number | null;
}

// -------------------------------------------------------- writeRecycleRequest
//
// Writes requests/<id>.json with op:"recycle" -- the first value that field
// has ever carried (plan 01.3-01). Both `id` (this request's own id) and
// `targetId` (the grant being recycled) are validated against
// REQUEST_ID_PATTERN BEFORE either is used to build any path (T-01.3-06),
// matching writeRequest()'s own precondition above.
export function writeRecycleRequest({
  id,
  targetId,
  reason,
  sessionId = null,
  clientPid = null,
}: WriteRecycleRequestOptions): RecycleRequestRecord {
  if (!isValidRequestId(id)) {
    throw new Error(`writeRecycleRequest: invalid request id: ${id}`);
  }
  if (!isValidRequestId(targetId)) {
    throw new Error(`writeRecycleRequest: invalid target id: ${targetId}`);
  }
  const dir = requestsDir();
  const record: RecycleRequestRecord = {
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

export interface LeaseRecord {
  version: number;
  id: string;
  proxy_pid: number;
  session_id: string | null;
  client_pid: number | null;
  created_at: string;
}

export interface CreateLeaseOptions {
  id: string;
  sessionId?: string | null;
  clientPid?: number | null;
}

// -------------------------------------------------------------- createLease
//
// Writes leases/<id>. Existence of this file IS the claim; its mtime is the
// heartbeat (touchLease below); its removal IS the release (releaseLease
// below) -- three separate jobs, one file, per the phase's own must_haves.
export function createLease({ id, sessionId = null, clientPid = null }: CreateLeaseOptions): LeaseRecord {
  if (!isValidRequestId(id)) {
    throw new Error(`createLease: invalid request id: ${id}`);
  }
  const dir = brokerLeasesDir();
  const record: LeaseRecord = {
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
export function touchLease(id: string): boolean {
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
export function releaseLease(id: string): void {
  try {
    unlinkSync(leasePathFor(id));
  } catch {
    // already gone -- release is idempotent, nothing else to do
  }
}

export interface PollOptions {
  timeoutMs?: number;
  pollMs?: number;
}

export type PollGrantResult =
  | { granted: true; grant: Record<string, unknown>; denial: null; reason: null }
  | { granted: false; grant: null; denial: Record<string, unknown> | null; reason: string };

// -------------------------------------------------------------- pollGrant
//
// Polls to a deadline for grants/<id>.json or denials/<id>.json, never
// throwing on a malformed or half-read file -- a parse failure is treated
// as "not there yet", matching the posture vice-pool.mjs's readRegistry()
// used before its 2026-08-02 deletion.
export const GRANT_POLL_TIMEOUT_MS: number = Number(process.env.VICE_BROKER_GRANT_TIMEOUT_MS || 25000);
export const GRANT_POLL_INTERVAL_MS = 500;

const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function pollGrant(
  id: string,
  { timeoutMs = GRANT_POLL_TIMEOUT_MS, pollMs = GRANT_POLL_INTERVAL_MS }: PollOptions = {}
): Promise<PollGrantResult> {
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

export type PollRecycleAckResult =
  | { acked: true; ack: Record<string, unknown>; reason: null }
  | { acked: false; ack: null; reason: string };

// ----------------------------------------------------------- pollRecycleAck
//
// Structurally the SAME poll-to-deadline loop as pollGrant() above, reading
// recycle-acks/<id>.json instead -- a malformed or half-written ack file is
// treated as not-yet-there rather than thrown, matching readJsonMaybe()'s
// never-throw posture throughout this module.
export const RECYCLE_ACK_TIMEOUT_MS: number = Number(process.env.VICE_BROKER_RECYCLE_TIMEOUT_MS || 30000);
export const RECYCLE_ACK_POLL_INTERVAL_MS = 500;

export async function pollRecycleAck(
  id: string,
  { timeoutMs = RECYCLE_ACK_TIMEOUT_MS, pollMs = RECYCLE_ACK_POLL_INTERVAL_MS }: PollOptions = {}
): Promise<PollRecycleAckResult> {
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

export interface BrokerLivenessResult {
  state: "never_started" | "stale" | "alive";
  pid: number | null;
  heartbeatAt: string | null;
  path: string;
}

// --------------------------------------------------------- readBrokerLiveness
//
// Classifies broker.json as never_started / stale / alive against
// BROKER_STALE_MS. Plan 04 consumes the three states for its diagnostics;
// this task only needs the classification to exist and be correct.
export const BROKER_STALE_MS: number = Number(process.env.VICE_BROKER_STALE_MS || 180000);

/** Pure classification over an ALREADY-PARSED record (or null for "no file
 * read anything back") -- factored out of readBrokerLiveness() below so
 * openBrokerControl() (plan 06) can classify liveness against the SAME
 * broker.json read it already performed for control_host/control_port/
 * control_token, rather than re-reading the file a second time via a second
 * readBrokerLiveness() call. readBrokerLiveness()'s own exported behaviour is
 * unchanged by this split -- it still takes a path and returns the same
 * shape; this is purely an internal refactor. */
function classifyLivenessFromRecord(parsed: Record<string, unknown> | null, path: string): BrokerLivenessResult {
  if (parsed === null) {
    return { state: "never_started", pid: null, heartbeatAt: null, path };
  }
  const pid = typeof parsed.pid === "number" && Number.isFinite(parsed.pid) ? parsed.pid : null;
  const heartbeatAt = typeof parsed.heartbeat_at === "string" ? parsed.heartbeat_at : null;
  const heartbeatMs = heartbeatAt ? Date.parse(heartbeatAt) : NaN;
  if (!Number.isFinite(heartbeatMs)) {
    return { state: "never_started", pid, heartbeatAt, path };
  }
  const state: BrokerLivenessResult["state"] = Date.now() - heartbeatMs > BROKER_STALE_MS ? "stale" : "alive";
  return { state, pid, heartbeatAt, path };
}

export function readBrokerLiveness(path: string = brokerJsonPath()): BrokerLivenessResult {
  const parsed = readJsonMaybe(path);
  return classifyLivenessFromRecord(parsed, path);
}

export interface StartHeartbeatOptions {
  intervalMs?: number;
}

// --------------------------------------------------------------- heartbeat
//
// An unref'd interval timer touching the lease -- keeps a thinking session's
// lease from looking abandoned to the broker's TTL sweeper, per the measured
// "nothing reaps an idle proxy" finding. unref()'d so the TIMER never holds
// the process alive; stdin being open is what does that (see
// timeout-and-latency-budgets.md).
export const HEARTBEAT_MS: number = Number(process.env.VICE_BROKER_HEARTBEAT_MS || 60000);

export function startHeartbeat(id: string, { intervalMs = HEARTBEAT_MS }: StartHeartbeatOptions = {}): NodeJS.Timeout {
  const timer = setInterval(() => {
    touchLease(id);
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

// ---------------------------------------------------- TCP control plane (ADDITIVE)
//
// Phase 01.6.2: the container-side half of the new TCP control plane
// (broker-control.mts is the host-side half). This is ADDITIVE ONLY --
// nothing above this line is deleted or modified, and the proxy still runs
// on the file protocol above until plan 07 swaps it over, so the suite
// stays green continuously. Wire format confirmed at this plan's blocking
// checkpoint:decision (2026-08-03, `as-specified`; see
// .planning/RE-FINDINGS.md for the full record): newline-delimited JSON,
// per-boot capability token, connection open = claim / close = release.
export interface AcquireGrant {
  id: string;
  port: number;
  url: string;
  epoch_file: string;
  supervisor_dir: string;
}

export interface AcquireOverControlPlaneHandle {
  grant: AcquireGrant;
  /** Closes the connection -- the connection IS the lease, so this alone
   * is the release; the broker's own "close" handler tears the instance
   * down (broker-control.mts). */
  release: () => void;
}

export const CONTROL_ACQUIRE_TIMEOUT_MS: number = Number(process.env.VICE_BROKER_ACQUIRE_TIMEOUT_MS || 25000);

/** Reads broker.json ONCE for control_host/control_port/control_token,
 * opens ONE TCP connection, sends a single `acquire` request framed as one
 * JSON line, and awaits the grant line against
 * CONTROL_ACQUIRE_TIMEOUT_MS. Rejects (never throws synchronously) on any
 * failure: broker.json absent/unreadable/missing the control fields, a
 * connection error, an `error` response, or a timeout. */
export function acquireOverControlPlane(dir: string = brokerRootDir()): Promise<AcquireOverControlPlaneHandle> {
  return new Promise((resolvePromise, reject) => {
    const broker = readJsonMaybe(brokerJsonPath(dir));
    if (broker === null) {
      reject(new Error("acquireOverControlPlane: broker.json not present or unreadable"));
      return;
    }
    const host = typeof broker.control_host === "string" ? broker.control_host : null;
    const port = typeof broker.control_port === "number" ? broker.control_port : null;
    const token = typeof broker.control_token === "string" ? broker.control_token : null;
    if (host === null || port === null || token === null) {
      reject(new Error("acquireOverControlPlane: broker.json missing control_host/control_port/control_token"));
      return;
    }

    const socket = connect({ host, port });
    let buffer = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(`acquireOverControlPlane: no grant within ${CONTROL_ACQUIRE_TIMEOUT_MS}ms`));
    }, CONTROL_ACQUIRE_TIMEOUT_MS);
    if (typeof timer.unref === "function") timer.unref();

    socket.on("connect", () => {
      const requestId = newRequestId();
      socket.write(`${JSON.stringify({ op: "acquire", id: requestId, token })}\n`);
    });

    socket.on("data", (chunk: Buffer) => {
      if (settled) return;
      buffer += chunk.toString("utf8");
      const newlineIdx = buffer.indexOf("\n");
      if (newlineIdx === -1) return;
      const line = buffer.slice(0, newlineIdx);

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        reject(new Error("acquireOverControlPlane: malformed response line"));
        return;
      }
      if (typeof parsed !== "object" || parsed === null) {
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        reject(new Error("acquireOverControlPlane: response line is not a JSON object"));
        return;
      }
      const resp = parsed as Record<string, unknown>;
      if (resp.kind === "grant") {
        settled = true;
        clearTimeout(timer);
        const grant: AcquireGrant = {
          id: String(resp.id),
          port: Number(resp.port),
          url: String(resp.url),
          epoch_file: String(resp.epoch_file),
          supervisor_dir: String(resp.supervisor_dir),
        };
        resolvePromise({
          grant,
          release: () => {
            socket.destroy();
          },
        });
      } else if (resp.kind === "error") {
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        reject(new Error(`acquireOverControlPlane: ${String(resp.code)}: ${String(resp.message)}`));
      }
      // any other kind: not a terminal response to THIS request -- ignored,
      // matching pollGrant()'s own "keep waiting" posture above.
    });

    socket.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// BROKER-CONTROL-CLIENT REGION START (plan 06, task 1)
//
// openBrokerControl() completes the container-side half of D-01: session
// shape, all five request kinds, one discovery-record read, real per-request
// deadlines, and a distinct broker-gone outcome. ADDITIVE alongside
// acquireOverControlPlane() above (plan 01's tracer, kept unchanged and
// still used by broker-e2e.test.ts/broker-kill.test.ts as their own one-shot
// acquire helper for exercising the SERVER side) and alongside the entire
// file protocol earlier in this module, which the proxy still runs on until
// plan 07's swap.
//
// Deliberately never REJECTS a promise: every failure -- deadline, a
// refused connection, a malformed line, the broker going away mid-request --
// resolves an `{ ok: false, kind, message }` value instead, matching this
// module's established never-throw posture toward untrusted input (the
// broker's response lines) and network conditions, and sidestepping any
// possibility of an unhandled rejection escaping this client.
//
// A structural test in vice-broker-client.test.ts extracts exactly the
// region between this marker and REGION END below (by these marker strings,
// not a whole-file scan) and asserts it contains no filesystem-write
// construct: writeFileSync/writeJsonAtomic/renameSync/mkdirSync/unlinkSync
// all belong to the RETIRING file protocol above this marker, which plan 07
// deletes wholesale (D-12) -- nothing in this region may reintroduce a
// second on-disk authority for "is this lease alive."
// ---------------------------------------------------------------------------

/** Same value as the tracer's own CONTROL_ACQUIRE_TIMEOUT_MS above --
 * referenced directly (not re-computed from the env var a second time) so
 * the two can never drift apart. This is "the relocated value of the
 * retiring grant-poll timeout" per 01.6.2-01-PLAN.md's own environment
 * variable table (VICE_BROKER_ACQUIRE_TIMEOUT_MS, default 25000) -- carried
 * forward unchanged, not re-tuned. Choosing a final value against the
 * measured tool-call budget is explicitly Phase 01.6.2.1's item, not this
 * plan's. */
export const ACQUIRE_TIMEOUT_MS: number = CONTROL_ACQUIRE_TIMEOUT_MS;

/** Same value as the retiring pollRecycleAck()'s own RECYCLE_ACK_TIMEOUT_MS
 * above -- referenced directly for the same never-drift reason as
 * ACQUIRE_TIMEOUT_MS. "The recycle bound takes the value the retiring
 * acknowledgement poll used" per 01.6.2-01-PLAN.md's environment variable
 * table (VICE_BROKER_RECYCLE_TIMEOUT_MS, default 30000) -- carried forward
 * unchanged. Final tuning is Phase 01.6.2.1's item. */
export const RECYCLE_TIMEOUT_MS: number = RECYCLE_ACK_TIMEOUT_MS;

/** Genuinely NEW: the file protocol never "connected" anywhere, so there is
 * no retiring value to carry forward for this one. A conservative bound for
 * a TCP connect over the docker bridge to a broker broker.json has already
 * classified alive (never_started/stale are refused before a connection is
 * ever attempted) -- deliberately not read from an environment variable,
 * since 01.6.2-06-PLAN.md's own scope is "no new environment variables
 * beyond the two deadline variables named in 01.6.2-01-PLAN.md" (the two
 * above). Final tuning is Phase 01.6.2.1's item, same as the other two. */
export const CONTROL_CONNECT_TIMEOUT_MS = 5000;

/** Every way a session-level request can fail to produce its expected
 * success line: the two pre-connect liveness refusals, a refused TCP
 * connection, a per-request deadline, the broker dropping the connection
 * mid-request, a malformed/non-object response line, and the broker's own
 * ControlErrorCode vocabulary (broker-control.mts's own type, duplicated
 * here as a plain string-literal union rather than imported -- this client
 * and that host-side listener run in separate processes; the shared surface
 * between them is the wire format, not a TypeScript type, exactly like
 * AcquireGrant below already duplicates the wire's own field names rather
 * than importing a shared interface). */
export type ControlFailureKind =
  | "never_started"
  | "stale"
  | "connect_refused"
  | "deadline"
  | "broker_gone"
  | "protocol"
  | "unauthorized"
  | "bad_request"
  | "denied"
  | "no_free_port"
  | "at_capacity"
  | "internal";

export type ControlAcquireResult = { ok: true; grant: AcquireGrant } | { ok: false; kind: ControlFailureKind; message: string };

export type ControlReleaseResult = { ok: true };

interface ControlRecycleAck {
  outcome: string;
  kill_stage: string;
  reason: string;
}

export type ControlRecycleResult = { ok: true; ack: ControlRecycleAck } | { ok: false; kind: ControlFailureKind; message: string };

interface ControlStatusInstanceEntry {
  port: number;
  url: string;
  state: string;
  reason: string;
  epoch: number | null;
}

export type ControlStatusResult =
  | { ok: true; instances: ControlStatusInstanceEntry[] }
  | { ok: false; kind: ControlFailureKind; message: string };

interface ControlHostStateFields {
  pid: number;
  started_at: string;
  node_version: string;
  vice_bin: string;
  warm_floor: number;
  max_instances: number;
  base_port: number;
}

export type ControlHostStateResult =
  | { ok: true; hostState: ControlHostStateFields }
  | { ok: false; kind: ControlFailureKind; message: string };

/** Per-call deadline override -- matches PollOptions's own established shape
 * above (pollGrant()/pollRecycleAck() already take an optional `timeoutMs`
 * this same way). The MODULE-LEVEL constant (ACQUIRE_TIMEOUT_MS etc.) is the
 * real, unchanged-from-the-retiring-poll default; a caller (chiefly this
 * file's own tests, injecting a short bound to prove the deadline actually
 * elapses without waiting out the real one) may override it per call. */
export interface ControlDeadlineOptions {
  timeoutMs?: number;
}

/** The session opened by openBrokerControl(): one TCP connection, held for
 * the session's lifetime -- the connection IS the lease (the tolerance
 * decision recorded in broker-control-plane-over-tcp.md). Each method sends
 * exactly one request line and resolves against its own deadline; none of
 * them ever reject. */
export interface BrokerControlSession {
  acquire(opts?: ControlDeadlineOptions): Promise<ControlAcquireResult>;
  release(): Promise<ControlReleaseResult>;
  recycle(targetId: string, opts?: ControlDeadlineOptions): Promise<ControlRecycleResult>;
  status(opts?: ControlDeadlineOptions): Promise<ControlStatusResult>;
  hostState(opts?: ControlDeadlineOptions): Promise<ControlHostStateResult>;
}

export interface OpenBrokerControlOptions {
  connectTimeoutMs?: number;
}

export type OpenBrokerControlOutcome = { ok: true; session: BrokerControlSession } | { ok: false; kind: ControlFailureKind; message: string };

/** One in-flight request's settlement callback -- pushed onto the session's
 * FIFO pending queue in sendAndAwaitLine() below, and shifted off it by
 * EXACTLY ONE of: a response line arriving (createSession()'s own "data"
 * handler), the per-request deadline elapsing, or the broker closing/erroring
 * the connection (which drains and settles every entry still in the queue).
 * FIFO order is sound here because every session method awaits its own
 * sendAndAwaitLine() call to settle before this client ever writes a second
 * request line -- responses can therefore never arrive out of the order
 * their requests were sent in, so matching purely by arrival order (rather
 * than by echoing the request id back, which several response kinds do not
 * even carry) is correct. */
interface PendingLineEntry {
  handle(line: Record<string, unknown> | null, brokerGone: boolean): void;
}

type RawLineOutcome = { ok: true; line: Record<string, unknown> } | { ok: false; kind: ControlFailureKind; message: string };

/** Builds the session object wrapping an already-CONNECTED socket. Wires the
 * newline framing (buffer, split on "\n", one entry-per-response FIFO
 * dispatch -- structurally the same shape broker-control.mts's own
 * attachControlProtocol() uses on the host side) and the broker-gone
 * settlement on "close"/"error", then exposes the five typed request
 * methods over it. */
function createSession(socket: Socket, token: string): BrokerControlSession {
  let buffer = "";
  let closed = false;
  const pending: PendingLineEntry[] = [];

  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      if (line.trim() === "") continue;
      const entry = pending.shift();
      if (!entry) continue; // unsolicited line -- this protocol never pushes one; ignored defensively

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        entry.handle(null, false);
        continue;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        entry.handle(null, false);
        continue;
      }
      entry.handle(parsed as Record<string, unknown>, false);
    }
  });

  function settleAllBrokerGone(): void {
    closed = true;
    const all = pending.splice(0, pending.length);
    for (const entry of all) entry.handle(null, true);
  }
  socket.on("close", settleAllBrokerGone);
  socket.on("error", settleAllBrokerGone);

  /** Sends one JSON line carrying `token` and awaits the matching response,
   * settling a typed failure rather than throwing on every failure mode:
   * deadline, broker-gone, a malformed line, or the broker's own `error`
   * response (whose `code` is forwarded verbatim as this outcome's `kind`).
   * A success line is handed back UNINTERPRETED as `line` -- each public
   * method below checks its own expected `kind` and extracts its own
   * fields, so this shared helper carries none of that per-request-kind
   * knowledge. */
  function sendAndAwaitLine(payload: Record<string, unknown>, timeoutMs: number): Promise<RawLineOutcome> {
    return new Promise((resolvePromise) => {
      if (closed) {
        resolvePromise({ ok: false, kind: "broker_gone", message: "openBrokerControl: session already closed" });
        return;
      }
      let settled = false;
      const entry: PendingLineEntry = {
        handle(line, brokerGone) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (brokerGone) {
            resolvePromise({
              ok: false,
              kind: "broker_gone",
              message: "openBrokerControl: the broker closed the connection while this request was in flight",
            });
            return;
          }
          if (line === null) {
            resolvePromise({ ok: false, kind: "protocol", message: "openBrokerControl: malformed or non-object response line" });
            return;
          }
          if (line.kind === "error") {
            const code = typeof line.code === "string" ? (line.code as ControlFailureKind) : "internal";
            resolvePromise({
              ok: false,
              kind: code,
              message: typeof line.message === "string" ? line.message : "openBrokerControl: broker reported an error",
            });
            return;
          }
          resolvePromise({ ok: true, line });
        },
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const idx = pending.indexOf(entry);
        if (idx !== -1) pending.splice(idx, 1);
        resolvePromise({ ok: false, kind: "deadline", message: `openBrokerControl: no response within ${timeoutMs}ms` });
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();

      pending.push(entry);
      socket.write(`${JSON.stringify(payload)}\n`);
    });
  }

  async function acquire(opts: ControlDeadlineOptions = {}): Promise<ControlAcquireResult> {
    const requestId = newRequestId();
    const raw = await sendAndAwaitLine({ op: "acquire", id: requestId, token }, opts.timeoutMs ?? ACQUIRE_TIMEOUT_MS);
    if (!raw.ok) return raw;
    const line = raw.line;
    if (line.kind !== "grant") {
      return { ok: false, kind: "protocol", message: `openBrokerControl: acquire got unexpected response kind ${String(line.kind)}` };
    }
    const grant: AcquireGrant = {
      id: String(line.id),
      port: Number(line.port),
      url: String(line.url),
      epoch_file: String(line.epoch_file),
      supervisor_dir: String(line.supervisor_dir),
    };
    return { ok: true, grant };
  }

  /** The connection IS the lease -- closing it is the ENTIRE release, no
   * wire round trip needed (matches acquireOverControlPlane()'s own
   * release() above). socket.destroy() is itself idempotent, so a second
   * release() call is a silent no-op, matching the idempotent posture the
   * retiring file-based releaseLease() already had. */
  async function release(): Promise<ControlReleaseResult> {
    if (!socket.destroyed) socket.destroy();
    closed = true;
    return { ok: true };
  }

  async function recycle(targetId: string, opts: ControlDeadlineOptions = {}): Promise<ControlRecycleResult> {
    const requestId = newRequestId();
    const raw = await sendAndAwaitLine({ op: "recycle", id: requestId, target_id: targetId, token }, opts.timeoutMs ?? RECYCLE_TIMEOUT_MS);
    if (!raw.ok) return raw;
    const line = raw.line;
    if (line.kind !== "recycle_ack") {
      return { ok: false, kind: "protocol", message: `openBrokerControl: recycle got unexpected response kind ${String(line.kind)}` };
    }
    // Exactly the key set vice-proxy.ts's recycleAckOutcomeMessage() (lines
    // 584-611) plus its caller (lines 707-713) read from the ack: outcome,
    // kill_stage, reason -- documented at the point of use here rather than
    // only in the plan, since this IS the point of use.
    return {
      ok: true,
      ack: {
        outcome: typeof line.outcome === "string" ? line.outcome : "unknown",
        kill_stage: typeof line.kill_stage === "string" ? line.kill_stage : "unknown",
        reason: typeof line.reason === "string" ? line.reason : "",
      },
    };
  }

  async function status(opts: ControlDeadlineOptions = {}): Promise<ControlStatusResult> {
    // Reuses ACQUIRE_TIMEOUT_MS as a shared bound -- status is a synchronous,
    // in-memory read on the broker side (no launch, no kill involved), so it
    // needs no timeout of its own scale; introducing a distinct constant (or
    // environment variable) for it would be exactly the kind of new knob
    // 01.6.2-06-PLAN.md's own scope excludes.
    const raw = await sendAndAwaitLine({ op: "status", token }, opts.timeoutMs ?? ACQUIRE_TIMEOUT_MS);
    if (!raw.ok) return raw;
    const line = raw.line;
    if (line.kind !== "status") {
      return { ok: false, kind: "protocol", message: `openBrokerControl: status got unexpected response kind ${String(line.kind)}` };
    }
    const rawInstances = Array.isArray(line.instances) ? line.instances : [];
    const instances: ControlStatusInstanceEntry[] = rawInstances.map((rawEntry) => {
      const e = rawEntry && typeof rawEntry === "object" ? (rawEntry as Record<string, unknown>) : {};
      return {
        port: Number(e.port),
        url: typeof e.url === "string" ? e.url : "",
        state: typeof e.state === "string" ? e.state : "",
        reason: typeof e.reason === "string" ? e.reason : "",
        epoch: typeof e.epoch === "number" ? e.epoch : null,
      };
    });
    return { ok: true, instances };
  }

  async function hostState(opts: ControlDeadlineOptions = {}): Promise<ControlHostStateResult> {
    // Same shared-bound reasoning as status() above.
    const raw = await sendAndAwaitLine({ op: "host_state", token }, opts.timeoutMs ?? ACQUIRE_TIMEOUT_MS);
    if (!raw.ok) return raw;
    const line = raw.line;
    if (line.kind !== "host_state") {
      return { ok: false, kind: "protocol", message: `openBrokerControl: host_state got unexpected response kind ${String(line.kind)}` };
    }
    return {
      ok: true,
      hostState: {
        pid: Number(line.pid),
        started_at: String(line.started_at),
        node_version: String(line.node_version),
        vice_bin: String(line.vice_bin),
        warm_floor: Number(line.warm_floor),
        max_instances: Number(line.max_instances),
        base_port: Number(line.base_port),
      },
    };
  }

  return { acquire, release, recycle, status, hostState };
}

/** Opens ONE session against the control plane: reads broker.json ONCE for
 * control_host/control_port/control_token (and, from that SAME read,
 * classifies liveness -- never a second file read for the same record),
 * refuses to even attempt a connection when that classification is
 * never_started or stale, then opens ONE TCP connection and holds it for
 * the caller. Every failure mode resolves a typed `{ ok: false, kind,
 * message }` outcome rather than rejecting -- see this region's own header
 * comment for why. */
export function openBrokerControl(dir: string = brokerRootDir(), opts: OpenBrokerControlOptions = {}): Promise<OpenBrokerControlOutcome> {
  const connectTimeoutMs = opts.connectTimeoutMs ?? CONTROL_CONNECT_TIMEOUT_MS;
  return new Promise((resolvePromise) => {
    const path = brokerJsonPath(dir);
    const parsed = readJsonMaybe(path); // the ONE read of the discovery record for this whole session
    const liveness = classifyLivenessFromRecord(parsed, path);
    if (liveness.state === "never_started" || liveness.state === "stale") {
      resolvePromise({
        ok: false,
        kind: liveness.state,
        message: `openBrokerControl: broker.json classifies ${liveness.state} (${path}) -- refusing to attempt a connection`,
      });
      return;
    }
    if (parsed === null) {
      // Unreachable in practice -- classifyLivenessFromRecord() only ever
      // answers "alive" when it was handed a non-null record -- but keeps
      // the branch below soundly typed rather than asserting past the
      // compiler.
      resolvePromise({ ok: false, kind: "never_started", message: "openBrokerControl: broker.json unexpectedly absent" });
      return;
    }
    const host = typeof parsed.control_host === "string" ? parsed.control_host : null;
    const port = typeof parsed.control_port === "number" ? parsed.control_port : null;
    const token = typeof parsed.control_token === "string" ? parsed.control_token : null;
    if (host === null || port === null || token === null) {
      resolvePromise({
        ok: false,
        kind: "protocol",
        message: "openBrokerControl: broker.json missing control_host/control_port/control_token",
      });
      return;
    }

    let settled = false;
    const socket = connect({ host, port });

    const connectTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.removeListener("connect", onConnect);
      socket.removeListener("error", onError);
      socket.destroy();
      resolvePromise({
        ok: false,
        kind: "connect_refused",
        message: `openBrokerControl: no connection within ${connectTimeoutMs}ms`,
      });
    }, connectTimeoutMs);
    if (typeof connectTimer.unref === "function") connectTimer.unref();

    function onConnect(): void {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      socket.removeListener("error", onError);
      resolvePromise({ ok: true, session: createSession(socket, token as string) });
    }

    function onError(err: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      socket.removeListener("connect", onConnect);
      resolvePromise({ ok: false, kind: "connect_refused", message: `openBrokerControl: connection failed -- ${err.message}` });
    }

    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}

// ---------------------------------------------------------------------------
// BROKER-CONTROL-CLIENT REGION END (plan 06, task 1)
// ---------------------------------------------------------------------------
