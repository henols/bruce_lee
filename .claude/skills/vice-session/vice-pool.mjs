#!/usr/bin/env node
// Container-side half of the VICE instance pool coordination layer (D-3).
// tools/vice-pool.sh (host-only) writes registry.json describing N supervised
// x64sc MCP instances; this module reads that registry, leases an instance
// for the caller, and hands back enough to redirect tools/vice.mjs's
// transport seam (useInstance()) at the leased instance.
//
// readRegistry()/instanceFor() treat the registry as untrusted host-written
// input, exactly like tools/vice.mjs's readEpoch() already treats epoch.json
// (T-mef-01) -- parse in try/catch, accept only integer ports in 1..65535,
// ignore every other field, never throw. acquire() takes an atomic,
// exclusive lease via a linkSync of a fully-written temp file (T-mef-04) and
// walks candidate ports in DESCENDING order, so batch/harness leases drift
// away from 6510 and leave the interactive .mcp.json instance free when
// possible. With no registry present, or no valid port in it, acquire()
// returns the single DEFAULT instance -- port 6510, the default endpoint,
// the non-port-scoped epoch file under the pool dir -- with pooled:false and
// a no-op release(): exactly today's behaviour with zero configuration, and
// explicitly not an error (D-3).
//
// Also carries a SECOND lease kind for `tools/vice-session.mjs` (D-1, D-2):
// acquire({kind:"session", ttlMs}) leases a port exactly like a `"process"`
// lease, but the resulting record is reclaimed on TTL expiry only, never on
// its holder process's pid dying or exiting -- because a session's holder is
// a short-lived CLI invocation that exits the instant `session acquire`
// returns, unlike a process lease's holder, which lives for the whole verb.
// See isReclaimable()'s session branch and acquire()'s own doc comment below
// for the two places this distinction is enforced.
//
// POLICY: blocking-with-timeout (chosen over fail-fast or wait-forever). A
// capture run is long and `reproduce` is two of them back to back, so
// failing the instant every port is busy would make routine work flaky; but
// waiting forever would hide a leaked lease. acquire() therefore polls every
// `pollMs` until `timeoutMs` elapses, then throws an error naming every
// candidate port with its holder pid, host and age -- `timeoutMs: 0` fails
// immediately, and a busy instance is never silently returned.
//
// CONTAINER-SIDE LIVENESS -- WHAT THIS DELIBERATELY DOES NOT DO: acquire()
// never tests whether a supervisor is alive by pid-probing it, because a
// supervisor pid was written on the HOST side, in a DIFFERENT pid namespace
// from this container (T-mef-03) -- process.kill(hostPid, 0) here would be
// testing a number that may coincidentally match an unrelated local
// process, or may not exist at all, and either way answers nothing about
// the host. Presence of the instance's own epoch.json is the only weak
// liveness hint used (indirectly, by the caller after redirecting), and a
// genuinely dead instance surfaces through the transport error and operator
// guidance tools/vice.mjs already produces. Do not "fix" this by adding a
// container-side pid check that appears to work against a supervisor pid --
// it does not check what it looks like it checks.
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, linkSync, renameSync, existsSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { supervisorDir } from "./repo-root.mjs";

export const DEFAULT_PORT = 6510;

/** VICE_POOL_DIR, or <repo>/.vice-supervisor -- the SAME default directory
 * tools/vice-supervisor.sh itself uses with no pool involved, which is what
 * makes the "no registry" fallback epoch path identical to today's. Resolved
 * through repo-root.mjs's supervisorDir() (see that file's header comment
 * for why the old fixed-hop-count `new URL(".", import.meta.url)` form was
 * dropped entirely) rather than restated here. */
export function poolDir() {
  return process.env.VICE_POOL_DIR ? resolve(process.env.VICE_POOL_DIR) : supervisorDir();
}

export function registryPath(dir = poolDir()) {
  return join(dir, "registry.json");
}

function leasesDir(dir = poolDir()) {
  return join(dir, "leases");
}

function leasePath(port, dir = poolDir()) {
  return join(leasesDir(dir), `${port}.lease`);
}

/**
 * Read and validate registry.json as UNTRUSTED input (T-mef-01): readFileSync
 * and JSON.parse both in try/catch, accept an "instances" entry only when its
 * `port` decodes to an integer in 1..65535, de-duplicate, ignore every other
 * field. Never throws -- an unreadable or malformed registry reports
 * `present:false` with a `reason`, which is exactly what "no pool running"
 * looks like too.
 */
export function readRegistry(path = registryPath()) {
  const absent = (reason) => ({ present: false, ports: [], reason });
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return absent("registry file absent");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return absent("registry file present but not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.instances)) {
    return absent('registry file present but its "instances" field is not an array');
  }
  const seen = new Set();
  const ports = [];
  for (const entry of parsed.instances) {
    if (entry === null || typeof entry !== "object") continue;
    const port = entry.port;
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    if (seen.has(port)) continue;
    seen.add(port);
    ports.push(port);
  }
  if (ports.length === 0) {
    return absent('registry file present but no entry had a valid integer "port" in 1..65535');
  }
  return { present: true, ports };
}

/**
 * Derive the url and epoch path FROM THE VALIDATED PORT, never from a string
 * read out of the registry file -- this is what makes a `../../` in a
 * registry's `epoch_file` field inert (T-mef-01): that field is never opened.
 */
export function instanceFor(port, dir = poolDir()) {
  const host = process.env.VICE_MCP_HOST || "host.docker.internal";
  return {
    port,
    url: `http://${host}:${port}/mcp`,
    epochFile: join(dir, String(port), "epoch.json"),
  };
}

/** The single default (non-pooled) instance: port 6510, the default
 * endpoint, and the SAME non-port-scoped epoch file tools/vice.mjs's own
 * EPOCH_FILE default resolves to when no VICE_EPOCH_FILE override is set. */
function defaultInstance(dir = poolDir()) {
  const host = process.env.VICE_MCP_HOST || "host.docker.internal";
  return {
    port: DEFAULT_PORT,
    url: `http://${host}:${DEFAULT_PORT}/mcp`,
    epochFile: join(dir, "epoch.json"),
  };
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Decide whether the lease currently occupying `lp` may be reclaimed.
 * Treats the lease file as untrusted, exactly like registry.json:
 *   - unparseable / not an object -> reclaim (a malformed file must not wedge
 *     a port forever; the caller logs a loud warning).
 *   - a SESSION lease (rec.kind === "session") -> decided FIRST, before either
 *     branch below, and by a completely different rule (D-2). See the
 *     dedicated comment just above that branch for why.
 *   - older than maxLeaseAgeMs -> reclaim, regardless of host or pid.
 *   - holder_host equals THIS host AND the pid is confirmably gone
 *     (process.kill(pid, 0) throws ESRCH) -> reclaim.
 *   - holder_host is a DIFFERENT host -> pid is NEVER used to reclaim
 *     (T-mef-03: a supervisor pid and a container pid live in different pid
 *     namespaces, so pid-testing a number written on the other side of the
 *     bind mount is meaningless and could match an unrelated local
 *     process). Only age can reclaim a cross-host lease.
 * Returns { reclaim, reason }.
 */
function isReclaimable(lp, maxLeaseAgeMs) {
  let raw;
  try {
    raw = readFileSync(lp, "utf8");
  } catch {
    return { reclaim: true, reason: "lease file vanished mid-check" };
  }
  let rec;
  try {
    rec = JSON.parse(raw);
  } catch {
    return { reclaim: true, reason: "lease file is not valid JSON" };
  }
  if (rec === null || typeof rec !== "object") {
    return { reclaim: true, reason: "lease file did not decode to an object" };
  }

  // SESSION LEASES (D-2) -- evaluated BEFORE the age branch and BEFORE the pid
  // branch below, deliberately. A session's holder is a short-lived
  // `node tools/vice.mjs session acquire` process that EXITS the instant the
  // command returns -- its pid is gone within milliseconds of a successful
  // acquire, so pid-liveness would reclaim a live, actively-used session out
  // from under itself almost immediately. maxLeaseAgeMs is wrong for the same
  // reason: a session held open for a long working day is not stale just
  // because it is old, as long as it is still being refreshed on use (see
  // vice-session.mjs's resolveInstance()). TTL expiry is therefore the ONLY
  // reclaim signal for a session lease: reclaim once expires_at has passed,
  // or immediately (with a warning) if expires_at is missing or unparseable,
  // so a malformed session record cannot wedge a port forever either.
  if (rec.kind === "session") {
    const expiresAtMs = Date.parse(rec.expires_at);
    if (!Number.isFinite(expiresAtMs)) {
      return { reclaim: true, reason: "session lease has a missing or unparseable expires_at" };
    }
    if (Date.now() >= expiresAtMs) {
      return { reclaim: true, reason: `session lease expired at ${rec.expires_at}` };
    }
    return { reclaim: false };
  }

  // Process lease -- today's rules, verbatim (see tools/recover.mjs's own
  // lease-acquisition comment for why pid-based reclaim is the right rule for
  // THIS kind: its holder is one long-running process that lives for the
  // whole verb, unlike a session's holder, which exits between commands).
  const acquiredAtMs = Date.parse(rec.acquired_at);
  if (Number.isFinite(acquiredAtMs) && Date.now() - acquiredAtMs > maxLeaseAgeMs) {
    return { reclaim: true, reason: `lease older than maxLeaseAgeMs (${maxLeaseAgeMs}ms)` };
  }
  if (rec.holder_host === hostname() && Number.isInteger(rec.holder_pid)) {
    let alive = true;
    try {
      process.kill(rec.holder_pid, 0);
    } catch (e) {
      if (e.code === "ESRCH") alive = false;
    }
    if (!alive) {
      return { reclaim: true, reason: `holder pid ${rec.holder_pid} is no longer running on this host` };
    }
  }
  return { reclaim: false };
}

/** Human-readable holder description for the "every port busy" timeout error. */
function describeHolder(port, dir) {
  const lp = leasePath(port, dir);
  try {
    const rec = JSON.parse(readFileSync(lp, "utf8"));
    const ageMs = Date.now() - Date.parse(rec.acquired_at);
    const ageStr = Number.isFinite(ageMs) ? `${Math.round(ageMs / 1000)}s ago` : "unknown age";
    return `port ${port}: held by pid ${rec.holder_pid} on ${rec.holder_host} (acquired ${ageStr})`;
  } catch {
    return `port ${port}: held (lease file unreadable)`;
  }
}

/**
 * Take an exclusive lease on `port`: write a uniquely-named temp file in the
 * leases directory, then `linkSync` it onto `<port>.lease` -- `link` is
 * atomic and fails EEXIST if the name exists, and unlike an O_EXCL create it
 * publishes fully-written content in one step, so a concurrent reader can
 * never observe an empty lease file (T-mef-04). On EEXIST, decides whether
 * the existing lease is reclaimable (see isReclaimable above); reclaiming is
 * an unlink followed by ONE retry of the link, so two simultaneous reapers
 * still produce exactly one winner -- if the retry also EEXISTs, another
 * reaper won and this call reports busy for this round rather than looping.
 * Returns `{ token }` on success, or null (occupied -- caller tries the next
 * port, or the next poll cycle).
 *
 * `kind` ("process", the default, or "session") and `ttlMs` are written
 * straight into the lease record so isReclaimable() above can tell the two
 * schemes apart from the file alone -- a session lease carries `expires_at`
 * (now + ttlMs); a process lease carries neither field.
 */
function tryAcquirePort(port, dir, holderPid, argv, maxLeaseAgeMs, kind = "process", ttlMs = null) {
  mkdirSync(leasesDir(dir), { recursive: true });
  const lp = leasePath(port, dir);
  const token = randomUUID();
  const record = {
    port,
    holder_pid: holderPid,
    holder_host: hostname(),
    token,
    acquired_at: new Date().toISOString(),
    argv,
    kind,
    expires_at: kind === "session" ? new Date(Date.now() + ttlMs).toISOString() : null,
  };
  const tmp = join(leasesDir(dir), `.tmp-${process.pid}-${token}`);
  writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n");

  const attemptLink = () => {
    try {
      linkSync(tmp, lp);
      return true;
    } catch (e) {
      if (e.code === "EEXIST") return false;
      try { unlinkSync(tmp); } catch { /* best effort */ }
      throw e;
    }
  };

  if (attemptLink()) {
    try { unlinkSync(tmp); } catch { /* best effort cleanup of the now-unneeded temp name */ }
    return { token };
  }

  const verdict = isReclaimable(lp, maxLeaseAgeMs);
  if (!verdict.reclaim) {
    try { unlinkSync(tmp); } catch { /* best effort */ }
    return null; // genuinely busy
  }
  console.error(`warn: reclaiming lease for port ${port}: ${verdict.reason}`);
  try { unlinkSync(lp); } catch { /* may already be gone -- fine, that's the point */ }

  if (attemptLink()) {
    try { unlinkSync(tmp); } catch { /* best effort */ }
    return { token };
  }
  // Another reaper won the retry -- treat as busy for this round.
  try { unlinkSync(tmp); } catch { /* best effort */ }
  return null;
}

/**
 * Release the lease at `leasePath` iff its on-disk token still matches
 * `token` (T-mef-04 / T-nh5-04): a lease that was reclaimed and reacquired by
 * someone else now carries a DIFFERENT token, and deleting it anyway would
 * steal a live lease out from under its legitimate new holder. Returns
 * `true` if this call actually removed the file, `false` for every other
 * case (mismatch, already gone, unreadable) -- all of which are treated as
 * an idempotent no-op, never an error, because "release something that's
 * already released" is the expected shape of both a double-release and a
 * post-reclaim release.
 *
 * The `acquire()` lease's own `release()` closure below delegates to this
 * function so there is exactly one implementation of "release by token" --
 * previously that logic lived only inline in the closure, which is fine for
 * an in-process release but useless to `tools/vice-session.mjs`, whose
 * `session release` runs as a BRAND NEW process with no closure to call.
 */
export function releaseLeaseByToken(leasePath, token) {
  try {
    const rec = JSON.parse(readFileSync(leasePath, "utf8"));
    if (rec.token !== token) return false;
    unlinkSync(leasePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Push `expires_at` forward to `now + ttlMs` for the lease at `leasePath`,
 * iff its on-disk token still matches `token` (T-nh5-04 -- same reasoning as
 * releaseLeaseByToken above: refreshing a reclaimed-and-reacquired lease
 * would extend someone ELSE's lease under this caller's belief that it's
 * still theirs). Writes via a temp-file-plus-rename so a concurrent reader
 * (isReclaimable's readFileSync, or another refresh) never observes a
 * partially-written record. Returns `true` on a real refresh, `false` (and
 * the file left byte-identical) on any token mismatch or read failure.
 *
 * This is the cross-process half of D-2's "TTL refreshed on each use":
 * `tools/vice-session.mjs`'s `resolveInstance()` calls this on every CLI
 * invocation that successfully resolves an active session, so a session in
 * continuous use never approaches its own `expires_at`.
 */
export function refreshLease(leasePath, token, ttlMs) {
  let rec;
  try {
    rec = JSON.parse(readFileSync(leasePath, "utf8"));
  } catch {
    return false;
  }
  if (rec.token !== token) return false;
  const updated = { ...rec, expires_at: new Date(Date.now() + ttlMs).toISOString() };
  const tmp = `${leasePath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmp, JSON.stringify(updated, null, 2) + "\n");
  renameSync(tmp, leasePath);
  return true;
}

// -------------------------------------------------------- crash-safety net
//
// Registered ONCE (guarded by exitHandlersRegistered) rather than per-lease,
// so acquiring many leases in one process (sequential CLI use, or this
// module's own tests) never approaches Node's default max-listener warning
// threshold. pendingLeases tracks every currently-held lease's path + token;
// at exit (or SIGINT/SIGTERM) each is released synchronously and only if its
// on-disk token still matches -- the real crash guarantee is reclaimability
// (isReclaimable above), this is a courtesy best-effort cleanup, not the
// mechanism the pool depends on.
const pendingLeases = new Set(); // { leasePath, token }
let exitHandlersRegistered = false;

function releasePendingSync() {
  for (const entry of pendingLeases) {
    try {
      const rec = JSON.parse(readFileSync(entry.leasePath, "utf8"));
      if (rec.token === entry.token) unlinkSync(entry.leasePath);
    } catch {
      // lease already gone, unreadable, or token mismatched -- nothing to do
    }
  }
  pendingLeases.clear();
}

function ensureExitHandlers() {
  if (exitHandlersRegistered) return;
  exitHandlersRegistered = true;
  process.on("exit", releasePendingSync);
  process.on("SIGINT", () => { releasePendingSync(); process.exit(130); });
  process.on("SIGTERM", () => { releasePendingSync(); process.exit(143); });
}

/**
 * Lease an instance. With no registry (or no valid port in it), returns the
 * default instance untouched -- pooled:false, no lease file written, a no-op
 * release() -- which is exactly today's behaviour with zero configuration
 * (D-3). Otherwise walks candidate ports in DESCENDING order every
 * `pollMs`, reclaiming stale leases as it goes, until one is free or
 * `timeoutMs` elapses (`timeoutMs: 0` fails on the first pass, immediately).
 * A busy instance is never returned.
 *
 * `kind` (default `"process"`, today's meaning) and `ttlMs` are D-2/D-1
 * additions for `tools/vice-session.mjs`'s `session acquire`. When `kind` is
 * `"session"`, the returned lease is DELIBERATELY NOT added to
 * `pendingLeases` and does NOT register the exit handlers below -- a session
 * is supposed to outlive the process that created it (that's the entire
 * distinction from a process lease); adding it to the exit-cleanup set would
 * release the lease the instant this `acquire()` call returns and the CLI
 * process exits, destroying every session before its caller could ever use
 * it. TTL expiry (isReclaimable's session branch, above) is the only reclaim
 * mechanism for a session lease -- see that function's comment for the full
 * reasoning.
 */
export async function acquire({
  dir = poolDir(),
  argv = process.argv.slice(2).join(" "),
  timeoutMs = Number(process.env.VICE_POOL_ACQUIRE_TIMEOUT_MS || 120000),
  pollMs = 500,
  maxLeaseAgeMs = Number(process.env.VICE_POOL_LEASE_MAX_AGE_MS || 3600000),
  kind = "process",
  ttlMs = null,
} = {}) {
  const reg = readRegistry(registryPath(dir));
  if (!reg.present || reg.ports.length === 0) {
    const inst = defaultInstance(dir);
    return { ...inst, pooled: false, leasePath: null, token: null, release: async () => {} };
  }

  const candidates = [...reg.ports].sort((a, b) => b - a); // descending
  const deadline = Date.now() + timeoutMs;

  while (true) {
    for (const port of candidates) {
      const result = tryAcquirePort(port, dir, process.pid, argv, maxLeaseAgeMs, kind, ttlMs);
      if (result == null) continue; // occupied -- try the next candidate port

      const inst = instanceFor(port, dir);
      const lp = leasePath(port, dir);
      const entry = { leasePath: lp, token: result.token };
      if (kind !== "session") {
        // Process-lease-only crash-safety net -- see the trap explained in
        // this function's own doc comment just above: registering a session
        // lease here would auto-release it the moment `session acquire`'s
        // short-lived process exits.
        pendingLeases.add(entry);
        ensureExitHandlers();
      }

      let released = false;
      return {
        ...inst,
        pooled: true,
        leasePath: lp,
        token: result.token,
        release: async () => {
          if (released) return;
          released = true;
          pendingLeases.delete(entry);
          releaseLeaseByToken(lp, result.token);
        },
      };
    }

    if (Date.now() >= deadline) {
      const holders = candidates.map((p) => describeHolder(p, dir)).join("; ");
      throw new Error(
        `acquire: no free instance within ${timeoutMs}ms -- every candidate port is held: ${holders}`
      );
    }
    await sleepMs(Math.max(0, Math.min(pollMs, deadline - Date.now())));
  }
}
