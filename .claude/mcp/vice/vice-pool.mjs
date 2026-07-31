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
//
// FOUR QUESTIONS, ANSWERED SEPARATELY (D-1, quick-260730-p5x): "the registry
// says this port exists" (LAUNCHED, from registry.json) used to be treated
// as good enough to hand a caller a port. It isn't -- the host supervisor
// died once, its epoch froze, and nothing container-side knew until a call
// burned ~50s of reconnect backoff (.planning/STATE.md's HOST INSTABILITY /
// HARD BLOCKER entries). `poolHealth()` below answers all four questions
// per instance as SEPARATE fields -- launched, ALIVE (a real `vice_ping` via
// vice-probe.mjs's probeAll(), never assumed), FREE (leaseInfo(), below),
// and SUPERVISED (readEpoch(), imported from the seam rather than
// re-implemented -- it is already hardened untrusted-input parsing and a
// second, weaker copy would be the worse outcome) -- and `acquire()` now
// probes before it leases, so a registered-but-dead candidate is skipped,
// never returned (D-2).
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, linkSync, renameSync, existsSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { supervisorDir } from "./repo-root.mjs";
import { readEpoch } from "./vice.mjs";
import { probeAll } from "./vice-probe.mjs";

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
  // `node .claude/mcp/vice/vice.mjs session acquire` process that EXITS the instant the
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

/**
 * Structured lease facts for `port` -- held, holder pid, holder host, kind,
 * acquired-at and age-in-ms (D-1's FREE question, answered as a real field
 * rather than embedded in a rendered string). The one reader of a lease file
 * for REPORTING purposes: describeHolder()'s human-readable rendering below
 * and poolHealth()'s `lease` field both go through this. Deciding whether an
 * existing lease may be RECLAIMED stays isReclaimable()'s job, above -- a
 * different question with different rules, answered nowhere near here.
 *
 * Treats the lease file as untrusted, exactly like isReclaimable() does:
 * never throws, an unreadable or malformed file reports `held:true,
 * unreadable:true` rather than crashing a health report over one bad file.
 */
export function leaseInfo(port, dir = poolDir()) {
  const lp = leasePath(port, dir);
  let raw;
  try {
    raw = readFileSync(lp, "utf8");
  } catch {
    return { held: false, port, path: lp };
  }
  let rec;
  try {
    rec = JSON.parse(raw);
  } catch {
    return { held: true, port, path: lp, unreadable: true, reason: "lease file is not valid JSON" };
  }
  if (rec === null || typeof rec !== "object") {
    return { held: true, port, path: lp, unreadable: true, reason: "lease file did not decode to an object" };
  }
  const acquiredAtMs = Date.parse(rec.acquired_at);
  return {
    held: true,
    port,
    path: lp,
    unreadable: false,
    holder_pid: Number.isInteger(rec.holder_pid) ? rec.holder_pid : null,
    holder_host: typeof rec.holder_host === "string" ? rec.holder_host : null,
    kind: rec.kind === "session" ? "session" : "process",
    acquired_at: typeof rec.acquired_at === "string" ? rec.acquired_at : null,
    age_ms: Number.isFinite(acquiredAtMs) ? Date.now() - acquiredAtMs : null,
    expires_at: typeof rec.expires_at === "string" ? rec.expires_at : null,
  };
}

/** Human-readable holder description for the "every port busy" timeout error.
 * Renders from leaseInfo() -- see that function's doc comment -- so there is
 * exactly one reader of a lease file for reporting purposes. */
function describeHolder(port, dir) {
  const info = leaseInfo(port, dir);
  if (!info.held) return `port ${port}: not held`;
  if (info.unreadable) return `port ${port}: held (lease file unreadable)`;
  const ageStr = Number.isFinite(info.age_ms) ? `${Math.round(info.age_ms / 1000)}s ago` : "unknown age";
  return `port ${port}: held by pid ${info.holder_pid} on ${info.holder_host} (acquired ${ageStr})`;
}

/**
 * Per-candidate reason for acquire()'s "every candidate rejected" error
 * (D-2): a dead candidate is described by its probe verdict PLUS its
 * supervision state (no answer with the cause, and whether anything is even
 * supervising it) -- never conflated with "leased", which is a completely
 * different, unrelated reason a candidate can be unusable. Only reached for
 * candidates that were actually rejected, so a lease-holding candidate here
 * falls through to describeHolder()'s rendering unchanged.
 */
function describeAcquireRejection(port, dir, verdict, probeEnabled) {
  if (probeEnabled && verdict && !verdict.alive) {
    const epoch = readEpoch(instanceFor(port, dir).epochFile);
    const supervision = epoch.present
      ? `supervised, epoch ${epoch.epoch}`
      : "unsupervised (no epoch file)";
    return `port ${port}: no answer (${verdict.reason}) -- ${supervision}`;
  }
  const lease = leaseInfo(port, dir);
  if (lease.held) return describeHolder(port, dir);
  return `port ${port}: answered but lost the lease race`;
}

/**
 * D-4's diagnosis, in prose: not just the finding, but the FIX. Only called
 * for a DEAD instance (`record.alive === false`) -- an alive instance's
 * diagnosis is handled directly in poolHealth() below, since "alive and
 * leased" vs "alive and free" is a lease question, not a supervision one.
 *
 * `previousRecord` is the same instance's record from an EARLIER
 * poolHealth() call (an epoch observed once, at an earlier point in time),
 * never a threshold or a tuned staleness window -- an unproven verdict that
 * names how to settle it (re-probe) is honest; a tuned threshold that
 * manufactures certainty is exactly what this project keeps rejecting (see
 * .planning/STATE.md's never-written-RAM / block-fill-heuristic entries for
 * the general pattern this is an instance of).
 */
export function diagnose(record, previousRecord = null) {
  if (!record.epoch.present) {
    return (
      "dead, no epoch file -- nothing is supervising this port. Fix: start a supervisor for it " +
      "(tools/vice-pool.sh start, or tools/vice-supervisor.sh for a single instance), or check why " +
      "one never launched here."
    );
  }
  const prevEpoch = previousRecord && previousRecord.epoch;
  if (!prevEpoch || !prevEpoch.present) {
    return (
      `dead, epoch file present (epoch ${record.epoch.epoch}` +
      (record.epoch.spawned_at ? `, written ${record.epoch.spawned_at}` : "") +
      ") but no prior observation to compare against -- supervisor status is UNPROVEN from a single " +
      "probe. Fix: re-probe (e.g. run `pool status` again shortly) to see whether the epoch has moved."
    );
  }
  if (prevEpoch.epoch === record.epoch.epoch) {
    return (
      `DEAD SUPERVISOR -- epoch unchanged since the last observation (${record.epoch.epoch}); a live ` +
      "supervisor would have respawned VICE and bumped it. Fix: restart the supervisor on the HOST " +
      "(tools/vice-supervisor.sh); this container cannot do it."
    );
  }
  return (
    `respawning -- epoch advanced since the last observation (${prevEpoch.epoch} -> ${record.epoch.epoch}), ` +
    "so a supervisor is alive and restarting VICE. Fix: wait and re-probe; nothing to do yet."
  );
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

// ------------------------------------------------------------ pool health
//
// D-1: the four questions -- LAUNCHED, ALIVE, FREE, SUPERVISED -- answered
// per instance as SEPARATE fields, never collapsed into one boolean. This is
// the read side of the pool; acquire() below is the read-then-lease side and
// shares probeAll()/leaseInfo()/readEpoch() with it so there is exactly one
// implementation of each question, not two that could drift apart.

/**
 * Health snapshot of every candidate instance -- the pooled instances from
 * registry.json, or the single unpooled default when no registry is present
 * (flagged `pooled:false`, exactly like acquire()'s own fallback). Probes
 * them all CONCURRENTLY via probeAll() (D-3: one timeout, not N), then reads
 * each one's lease facts (leaseInfo(), FREE) and epoch (readEpoch(), imported
 * from the seam rather than re-implemented -- SUPERVISED) to build one record
 * per instance with all four answers as separate fields, plus a `diagnosis`
 * string.
 *
 * `previous` is an EARLIER poolHealth() result (this same shape), used only
 * to feed diagnose() a prior epoch observation for D-4's respawning-vs-dead
 * distinction. Optional -- omitting it just means every dead instance with an
 * epoch file reports "unproven from a single probe" rather than a firm
 * verdict, which is the honest answer with no prior observation at all.
 */
export async function poolHealth({ dir = poolDir(), timeoutMs, previous = null } = {}) {
  const reg = readRegistry(registryPath(dir));
  const pooled = reg.present && reg.ports.length > 0;
  const candidates = pooled
    ? reg.ports.map((port) => ({ ...instanceFor(port, dir), pooled: true }))
    : [{ ...defaultInstance(dir), pooled: false }];

  const { byPort } = await probeAll(candidates, timeoutMs != null ? { timeoutMs } : {});

  const records = candidates.map((inst) => {
    const probe = byPort.get(inst.port) || { alive: false, reason: "not probed", ping: null, ms: null };
    const lease = leaseInfo(inst.port, dir);
    const epoch = readEpoch(inst.epochFile);
    const prevRecord = previous && Array.isArray(previous.records)
      ? previous.records.find((r) => r.port === inst.port) || null
      : null;

    const record = {
      port: inst.port,
      url: inst.url,
      pooled: inst.pooled,
      // LAUNCHED (D-1): whether registry.json claimed this port at all. The
      // unpooled default was never "launched" by anything this container
      // tracks -- null, not false, since "false" would wrongly suggest a
      // launch was attempted and failed.
      launched: inst.pooled ? true : null,
      // ALIVE (D-1): a real vice_ping this poll pass, never assumed from the
      // registry's mere existence.
      alive: probe.alive,
      alive_reason: probe.reason,
      alive_ms: probe.ms,
      ping: probe.ping,
      // FREE (D-1): from the lease file, never conflated with ALIVE -- an
      // instance can be alive-but-leased or dead-but-leaked, and those are
      // different problems with different fixes.
      lease,
      // SUPERVISED (D-1): from that instance's own epoch.json.
      epoch,
    };
    record.diagnosis = record.alive
      ? (record.lease.held
          ? `alive, leased by pid ${record.lease.holder_pid} on ${record.lease.holder_host}`
          : "alive and free")
      : diagnose(record, prevRecord);
    return record;
  });

  return { pooled, dir, checkedAt: new Date().toISOString(), records };
}

/**
 * Lease an instance. With no registry (or no valid port in it), returns the
 * default instance untouched -- pooled:false, no lease file written, a no-op
 * release() -- which is exactly today's behaviour with zero configuration
 * (D-3), now ALSO probed (see below) but never failed because of it (D-7).
 * Otherwise walks candidate ports in DESCENDING order every `pollMs`,
 * reclaiming stale leases as it goes, until one is free or `timeoutMs`
 * elapses (`timeoutMs: 0` fails on the first pass, immediately). A busy
 * instance is never returned -- and, as of D-2, neither is a dead one.
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
 *
 * `probe` (default `true`, unless `VICE_POOL_PROBE=0`) and `probeTimeoutMs`
 * are the D-2 additions: when probing, ONE concurrent probe pass runs per
 * poll cycle, BEFORE any lease attempt, and only ports that answered are
 * tried -- a registered instance that does not answer is skipped, never
 * returned. The blocking-with-timeout loop is otherwise unchanged, so a
 * supervisor that respawns mid-wait is still picked up on a later pass. On
 * deadline, the thrown error lists every candidate with ITS OWN reason: no
 * answer (with cause and supervision verdict), leased by whom, or answered
 * but lost the race -- never a bare "none free" (D-2).
 */
export async function acquire({
  dir = poolDir(),
  argv = process.argv.slice(2).join(" "),
  timeoutMs = Number(process.env.VICE_POOL_ACQUIRE_TIMEOUT_MS || 120000),
  pollMs = 500,
  maxLeaseAgeMs = Number(process.env.VICE_POOL_LEASE_MAX_AGE_MS || 3600000),
  kind = "process",
  ttlMs = null,
  probe = process.env.VICE_POOL_PROBE !== "0",
  probeTimeoutMs,
} = {}) {
  const reg = readRegistry(registryPath(dir));
  const probeOpts = probeTimeoutMs != null ? { timeoutMs: probeTimeoutMs } : {};

  if (!reg.present || reg.ports.length === 0) {
    const inst = defaultInstance(dir);
    if (probe) {
      const { byPort } = await probeAll([inst], probeOpts);
      const verdict = byPort.get(inst.port);
      if (verdict && !verdict.alive) {
        console.error(
          `warn: the default instance (port ${inst.port}) is not answering -- ${verdict.reason}. ` +
            `Proceeding anyway: with no registry, acquire() always returns the default instance (D-7).`
        );
      }
    }
    return { ...inst, pooled: false, leasePath: null, token: null, release: async () => {} };
  }

  const candidates = [...reg.ports].sort((a, b) => b - a); // descending
  const deadline = Date.now() + timeoutMs;
  let lastByPort = null;

  while (true) {
    if (probe) {
      const instances = candidates.map((port) => instanceFor(port, dir));
      const { byPort } = await probeAll(instances, probeOpts);
      lastByPort = byPort;
    }

    for (const port of candidates) {
      // D-2: a registered instance that did not answer THIS pass is skipped
      // entirely -- never handed out, never even attempted.
      if (probe && !lastByPort.get(port)?.alive) continue;

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
      const reasons = candidates
        .map((port) => describeAcquireRejection(port, dir, lastByPort ? lastByPort.get(port) : null, probe))
        .join("; ");
      throw new Error(
        `acquire: no free instance within ${timeoutMs}ms -- every candidate rejected: ${reasons}`
      );
    }
    await sleepMs(Math.max(0, Math.min(pollMs, deadline - Date.now())));
  }
}

/**
 * Pure formatter for a `poolHealth()` result (D-5) -- makes no calls itself,
 * mirroring how `tools/vice.mjs`'s `formatToolsOutput` is a pure function of
 * a `tools/list` payload, so this is testable with a synthetic object and no
 * emulator, pool, or filesystem involved. One line per instance covering all
 * four questions -- launched, alive, leased (with holder), supervised (with
 * the epoch value) -- plus the diagnosis, and a summary line comparing how
 * many were launched against how many answered.
 */
export function formatPoolHealth(health) {
  const records = Array.isArray(health?.records) ? health.records : [];
  const lines = records.map((r) => {
    const launchedStr = r.launched === null ? "n/a (unpooled default)" : r.launched ? "yes" : "no";
    const aliveStr = r.alive ? "yes" : `no (${r.alive_reason})`;
    const leaseStr = r.lease && r.lease.held
      ? r.lease.unreadable
        ? "yes (lease file unreadable)"
        : `yes (pid ${r.lease.holder_pid} on ${r.lease.holder_host}, kind ${r.lease.kind})`
      : "no (free)";
    const supervisedStr = r.epoch && r.epoch.present ? `yes (epoch ${r.epoch.epoch})` : "no (no epoch file)";
    return (
      `port ${r.port}  launched:${launchedStr}  alive:${aliveStr}  leased:${leaseStr}  ` +
      `supervised:${supervisedStr}  -- ${r.diagnosis}`
    );
  });

  const launchedCount = records.filter((r) => r.launched).length;
  const aliveCount = records.filter((r) => r.alive).length;
  const summary = health?.pooled
    ? `${aliveCount}/${launchedCount} launched instance(s) answering`
    : `unpooled default instance -- ${aliveCount ? "answering" : "not answering"}`;

  return [...lines, summary].join("\n");
}
