#!/usr/bin/env node
// The container-side session layer for tools/vice.mjs (D-1).
//
// WHY THIS FILE EXISTS AT ALL: the agent's shell environment does NOT
// persist between Bash invocations -- every `node .claude/skills/vice-mcp-selector/scripts/vice.mjs ...` call
// is a brand-new process with no memory of anything an earlier call
// `export`ed. So a "session" that is supposed to survive across separate
// commands cannot live in an environment variable; it has to be a FILE that
// every later invocation reads by default. That file, and the resolution
// logic around it, is everything in this module.
//
// A session wraps a `tools/vice-pool.mjs` lease of `kind:"session"` (see
// that module's isReclaimable() for why session leases are reclaimed by TTL
// only, never by pid death) plus its own JSON record on disk, so a session
// works identically whether a pool is running (a real leased port) or not
// (the single default port-6510 instance, D-1's zero-configuration case).
import { readFileSync, writeFileSync, unlinkSync, renameSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

import { acquire, releaseLeaseByToken, refreshLease, instanceFor, poolDir } from "./vice-pool.mjs";
import { useInstance, readEpoch } from "./vice.mjs";
import { supervisorDir } from "./repo-root.mjs";

/**
 * Default TTL for a new session: 30 minutes. Overridable per-acquire via
 * `--ttl-min` on the CLI, or globally via `VICE_SESSION_TTL_MS`.
 */
export const DEFAULT_TTL_MS = Number(process.env.VICE_SESSION_TTL_MS || 30 * 60 * 1000);

/**
 * Where the session record lives: `VICE_SESSION_FILE` if set, else
 * `<repo>/.vice-supervisor/session.json` -- resolved through repo-root.mjs's
 * supervisorDir(), never from cwd, exactly like `vice.mjs`'s `EPOCH_FILE`
 * and `vice-pool.mjs`'s `poolDir()` already do. That directory is already
 * gitignored (local machine state). The env override is the mechanism that
 * lets two concurrent workstreams each hold their own session without
 * stepping on each other -- point each at a different `VICE_SESSION_FILE`.
 */
export function sessionFilePath() {
  return process.env.VICE_SESSION_FILE ? resolve(process.env.VICE_SESSION_FILE) : join(supervisorDir(), "session.json");
}

function writeSessionAtomic(path, record) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n");
  renameSync(tmp, path); // atomic on the same filesystem -- no reader ever sees a half-written session
}

function isExpired(session) {
  const ms = Date.parse(session.expires_at);
  return !Number.isFinite(ms) || Date.now() >= ms;
}

/**
 * Read and validate the session file as UNTRUSTED input (T-nh5-01), modelled
 * directly on `vice.mjs`'s `readEpoch()`: NEVER throws, absence is normal and
 * reports `present:false` with a `reason`. `port` must decode to an integer
 * in 1..65535; `session_id` and `expires_at` must be strings; any other
 * shape is treated as unusable. Unknown fields are ignored.
 *
 * Same posture `readRegistry()` already takes toward `registry.json`: the
 * URL and epoch path are derived from the VALIDATED PORT via
 * `vice-pool.mjs`'s `instanceFor()` (or the equivalent non-pooled default),
 * never trusted as strings read out of the file -- so a hostile
 * `epoch_file` (e.g. `"../../etc/passwd"`) is simply never looked at, let
 * alone opened.
 */
export function readSession(path = sessionFilePath()) {
  const absent = (reason) => ({ present: false, reason, path });
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return absent("session file absent");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return absent("session file present but not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object") {
    return absent("session file present but did not decode to an object");
  }
  const port = parsed.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return absent('session file present but its "port" field is not an integer in 1..65535');
  }
  if (typeof parsed.session_id !== "string" || typeof parsed.expires_at !== "string") {
    return absent("session file present but session_id/expires_at are not strings");
  }
  const pooled = parsed.pooled === true;
  const dir = poolDir();
  const host = process.env.VICE_MCP_HOST || "host.docker.internal";
  // Derived, never trusted, per T-nh5-01 -- see the doc comment above.
  const url = `http://${host}:${port}/mcp`;
  const epochFile = pooled ? instanceFor(port, dir).epochFile : resolve(dir, "epoch.json");
  return {
    present: true,
    path,
    session_id: parsed.session_id,
    port,
    url,
    epochFile,
    pooled,
    lease_path: typeof parsed.lease_path === "string" ? parsed.lease_path : null,
    lease_token: typeof parsed.lease_token === "string" ? parsed.lease_token : null,
    created_at: typeof parsed.created_at === "string" ? parsed.created_at : null,
    expires_at: parsed.expires_at,
    ttl_ms: Number.isFinite(parsed.ttl_ms) ? parsed.ttl_ms : null,
    epoch_at_acquire:
      parsed.epoch_at_acquire && typeof parsed.epoch_at_acquire === "object"
        ? parsed.epoch_at_acquire
        : { present: false, epoch: null },
  };
}

/**
 * Start a new session: refuse if one is already active (never silently
 * steal it -- tell the operator to release it first), otherwise take a
 * `kind:"session"` pool lease (TTL-reclaimed, never pid-reclaimed -- see
 * `vice-pool.mjs`'s `isReclaimable()`), record the epoch at acquire time
 * (Task 2's cross-invocation epoch guard compares against this baseline),
 * and write the session record with a temp-file-plus-rename so a concurrent
 * reader never observes a half-written session.
 */
export async function acquireSession({ ttlMs = DEFAULT_TTL_MS, dir = poolDir(), sessionPath = sessionFilePath() } = {}) {
  const existing = readSession(sessionPath);
  if (existing.present && !isExpired(existing)) {
    throw new Error(
      `a session is already active (id ${existing.session_id}, port ${existing.port}, expires ${existing.expires_at}) -- ` +
        `release it first: \`node .claude/skills/vice-mcp-selector/scripts/vice.mjs session release\`. Refusing to silently steal an active session.`
    );
  }

  const lease = await acquire({ dir, kind: "session", ttlMs });
  const epochAtAcquire = readEpoch(lease.epochFile);
  const now = new Date();
  const record = {
    session_id: randomUUID(),
    port: lease.port,
    url: lease.url,
    epoch_file: lease.epochFile,
    pooled: lease.pooled,
    lease_path: lease.pooled ? lease.leasePath : null,
    lease_token: lease.pooled ? lease.token : null,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlMs).toISOString(),
    ttl_ms: ttlMs,
    epoch_at_acquire: { present: epochAtAcquire.present, epoch: epochAtAcquire.epoch },
  };
  writeSessionAtomic(sessionPath, record);
  return record;
}

/**
 * Free the session's pool lease (if any -- an unpooled session over the
 * default instance has none) and delete the session file. Idempotent:
 * releasing nothing (no session file, or an already-reclaimed lease) is a
 * success, not an error.
 */
export async function releaseSession({ sessionPath = sessionFilePath() } = {}) {
  const existing = readSession(sessionPath);
  if (existing.present && existing.lease_path && existing.lease_token) {
    releaseLeaseByToken(existing.lease_path, existing.lease_token);
  }
  try {
    unlinkSync(sessionPath);
  } catch {
    // already gone -- fine, that's the point of idempotent release
  }
  return { released: existing.present, sessionId: existing.present ? existing.session_id : null };
}

/**
 * PURE FILE READ (D-1 requirement): reports port, url, session id, age,
 * time-to-expiry and whether the session is expired WITHOUT making a single
 * MCP call, so this stays useful for diagnosing a session even when the
 * host emulator is completely unreachable.
 */
export function sessionStatus({ sessionPath = sessionFilePath() } = {}) {
  const s = readSession(sessionPath);
  if (!s.present) {
    return { active: false, present: false, reason: s.reason, path: s.path };
  }
  const expiresAtMs = Date.parse(s.expires_at);
  const expired = !Number.isFinite(expiresAtMs) || Date.now() >= expiresAtMs;
  const createdAtMs = s.created_at ? Date.parse(s.created_at) : NaN;
  return {
    active: !expired,
    present: true,
    expired,
    session_id: s.session_id,
    port: s.port,
    url: s.url,
    pooled: s.pooled,
    created_at: s.created_at,
    expires_at: s.expires_at,
    age_ms: Number.isFinite(createdAtMs) ? Date.now() - createdAtMs : null,
    ttl_remaining_ms: Number.isFinite(expiresAtMs) ? expiresAtMs - Date.now() : null,
    path: s.path,
  };
}

/**
 * The single resolution point every `tools/vice.mjs` CLI invocation goes
 * through before talking to the emulator. Precedence, in order:
 *
 *   1. `VICE_MCP_URL` set -> wins, unconditionally. It is the most explicit
 *      signal available and is the documented escape hatch; a session file
 *      is ignored with a stderr warning naming it, never silently.
 *   2. Otherwise, a present, UNEXPIRED session file -> wins. Resolution
 *      calls `vice.mjs`'s `useInstance()` with the session's port/url/
 *      epochFile/pooled, so `ping` and `call` transparently target it.
 *   3. Otherwise, the default -- port 6510, the default endpoint, no lease.
 *      This is exactly today's zero-configuration behaviour (D-1, HARD
 *      REQUIREMENT): with no session file present, nothing about this
 *      resolution step may change what a bare `node .claude/skills/vice-mcp-selector/scripts/vice.mjs ping`
 *      does.
 *
 * An EXPIRED session file is an ERROR, not a silent fallback: retargeting
 * from a leased port back to 6510 without telling anyone is precisely the
 * "quiet wrong answer" failure class this codebase keeps rejecting
 * elsewhere (see `vice.mjs`'s `MachineRestartedError`). The command refuses
 * and names both recovery verbs; nothing is auto-released or auto-reacquired.
 *
 * Two more checks run once a session is confirmed active and unexpired, in
 * this order, both BEFORE any network call is made:
 *
 *   - The cross-invocation EPOCH GUARD (D-1, D-3). `vice.mjs`'s own
 *     `beginSession()`/`assertSameMachine()` solve the analogous problem for
 *     ONE process's lifetime by keeping a baseline in module state -- which
 *     is worthless here, because every CLI invocation is a fresh process
 *     with no module state surviving from the last one. The session FILE
 *     carries the baseline instead (`epoch_at_acquire`, captured once at
 *     `session acquire` time). If both the baseline and the CURRENT epoch
 *     file are present and differ, the emulator restarted since this
 *     session was acquired: refuse, name both epochs, do not auto-recover.
 *     If both are present and equal, proceed silently -- proven same
 *     machine. If either side is missing (no supervisor running now, or
 *     none was running at acquire time), the signal is AMBIGUOUS, not
 *     proof of anything: warn on stderr and proceed, because failing every
 *     future read on an ambiguous signal would make sessions unusable the
 *     moment nobody happens to be running a supervisor.
 *   - TTL REFRESH-ON-USE (D-2): a session is only dead when nobody is using
 *     it, and use is the only signal available across separate processes --
 *     there is no "still open" flag a fresh CLI invocation could check
 *     instead. So every successful resolution pushes both the lease's and
 *     the session file's `expires_at` out to `now + ttl_ms` via the
 *     token-checked `refreshLease()` (T-nh5-04: never refresh a lease that
 *     was reclaimed and reacquired by someone else) plus a
 *     temp-file-plus-rename session rewrite. A session in continuous use
 *     therefore never approaches its own expiry.
 */
export function resolveInstance({ sessionPath = sessionFilePath() } = {}) {
  if (process.env.VICE_MCP_URL) {
    const s = readSession(sessionPath);
    if (s.present) {
      console.error(
        `warn: VICE_MCP_URL is set (${process.env.VICE_MCP_URL}) -- ignoring active session ${s.session_id} ` +
          `(port ${s.port}). VICE_MCP_URL is the most explicit signal available and is the documented escape hatch.`
      );
    }
    return { source: "env", session: null };
  }

  const s = readSession(sessionPath);
  if (!s.present) {
    return { source: "default", session: null }; // D-1: no session file -> today's behaviour, unchanged
  }

  if (isExpired(s)) {
    throw new Error(
      `session ${s.session_id} (port ${s.port}) expired at ${s.expires_at} -- refusing to fall back to the ` +
        `default instance silently. Recover with: \`node .claude/skills/vice-mcp-selector/scripts/vice.mjs session release\` then ` +
        `\`node .claude/skills/vice-mcp-selector/scripts/vice.mjs session acquire\`.`
    );
  }

  assertEpochContinuity(s);
  refreshOnUse(sessionPath, s);

  useInstance({ port: s.port, url: s.url, epochFile: s.epochFile, pooled: s.pooled });
  return { source: "session", session: s };
}

/**
 * The cross-invocation epoch guard (D-1, D-3) -- see resolveInstance()'s doc
 * comment above for the full four-rule explanation. A synchronous file
 * read only (readEpoch() never makes network traffic), so a refusal here
 * arrives before any MCP call is even attempted -- the fast-refusal
 * behaviour a dead/restarted target needs.
 */
function assertEpochContinuity(s) {
  const baseline = s.epoch_at_acquire && typeof s.epoch_at_acquire === "object"
    ? s.epoch_at_acquire
    : { present: false, epoch: null };
  const current = readEpoch(s.epochFile);

  if (baseline.present && current.present) {
    if (baseline.epoch !== current.epoch) {
      throw new Error(
        `session ${s.session_id} (port ${s.port}): the emulator restarted since this session was acquired -- ` +
          `epoch changed from ${baseline.epoch} to ${current.epoch}. This session's results are suspect; do not ` +
          `trust them. Recover with: \`node .claude/skills/vice-mcp-selector/scripts/vice.mjs session release\` then ` +
          `\`node .claude/skills/vice-mcp-selector/scripts/vice.mjs session acquire\`.`
      );
    }
    return; // both present, both equal -- proven same machine, proceed silently
  }

  if (baseline.present !== current.present) {
    // Ambiguous: one side has evidence, the other doesn't (supervisor
    // stopped, or started, somewhere between acquire and now). Not proof of
    // a restart, and not proof of safety either -- warn loudly and proceed,
    // rather than making every future read fail just because a supervisor
    // happened not to be running at one of the two points compared.
    console.error(
      `warn: session ${s.session_id} (port ${s.port}): epoch continuity is ambiguous -- ` +
        `${baseline.present ? `baseline epoch ${baseline.epoch}` : "no baseline epoch recorded at acquire time"} vs ` +
        `${current.present ? `current epoch ${current.epoch}` : "no current epoch file"}. Proceeding, but this ` +
        `session's restart-safety could not be confirmed either way.`
    );
    return;
  }
  // Both absent -- no supervisor running now, and none at acquire time
  // either. Nothing changed; nothing to warn about.
}

/**
 * TTL refresh-on-use (D-2) -- see resolveInstance()'s doc comment above.
 * Refreshes the pool lease (only if this session actually holds one --
 * unpooled sessions over the default instance don't) and always rewrites
 * the session file's own `expires_at`, via temp-file-plus-rename so a
 * concurrent reader never observes a half-written record.
 */
function refreshOnUse(sessionPath, s) {
  const ttlMs = Number.isFinite(s.ttl_ms) ? s.ttl_ms : DEFAULT_TTL_MS;
  if (s.lease_path && s.lease_token) {
    refreshLease(s.lease_path, s.lease_token, ttlMs);
  }
  writeSessionAtomic(sessionPath, {
    session_id: s.session_id,
    port: s.port,
    url: s.url,
    epoch_file: s.epochFile,
    pooled: s.pooled,
    lease_path: s.lease_path,
    lease_token: s.lease_token,
    created_at: s.created_at,
    expires_at: new Date(Date.now() + ttlMs).toISOString(),
    ttl_ms: ttlMs,
    epoch_at_acquire: s.epoch_at_acquire,
  });
}
