#!/usr/bin/env node
// Container-side half of the VICE instance pool coordination layer (D-3).
// tools/vice-pool.sh (host-only) writes registry.json describing N supervised
// x64sc MCP instances; this module reads that registry, leases an instance
// for the caller, and hands back enough to redirect tools/vice.mjs's
// transport seam (useInstance()) at the leased instance.
//
// MINIMAL slice (this file, as first written): readRegistry()/instanceFor()
// treat the registry as untrusted host-written input, exactly like
// tools/vice.mjs's readEpoch() already treats epoch.json (T-mef-01) -- parse
// in try/catch, accept only integer ports in 1..65535, ignore every other
// field, never throw. acquire() takes an atomic, exclusive lease via a
// linkSync of a fully-written temp file (T-mef-04) and walks candidate ports
// in DESCENDING order, so batch/harness leases drift away from 6510 and
// leave the interactive .mcp.json instance free when possible. With no
// registry present, or no valid port in it, acquire() returns the single
// DEFAULT instance -- port 6510, the default endpoint, the non-port-scoped
// epoch file under the pool dir -- with pooled:false and a no-op release():
// exactly today's behaviour with zero configuration, and explicitly not an
// error (D-3).
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, linkSync, existsSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export const DEFAULT_PORT = 6510;

/** VICE_POOL_DIR, or <repo>/.vice-supervisor -- the SAME default directory
 * tools/vice-supervisor.sh itself uses with no pool involved, which is what
 * makes the "no registry" fallback epoch path identical to today's. */
export function poolDir() {
  return process.env.VICE_POOL_DIR
    ? resolve(process.env.VICE_POOL_DIR)
    : resolve(new URL(".", import.meta.url).pathname, "..", ".vice-supervisor");
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

/**
 * Take an exclusive lease on `port`: write a uniquely-named temp file in the
 * leases directory, then `linkSync` it onto `<port>.lease` -- `link` is
 * atomic and fails EEXIST if the name exists, and unlike an O_EXCL create it
 * publishes fully-written content in one step, so a concurrent reader can
 * never observe an empty lease file (T-mef-04). Returns the token on
 * success, or null on EEXIST (occupied -- caller tries the next port).
 */
function tryAcquirePort(port, dir, holderPid, argv) {
  mkdirSync(leasesDir(dir), { recursive: true });
  const token = randomUUID();
  const record = {
    port,
    holder_pid: holderPid,
    holder_host: hostname(),
    token,
    acquired_at: new Date().toISOString(),
    argv,
  };
  const tmp = join(leasesDir(dir), `.tmp-${process.pid}-${token}`);
  writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n");
  try {
    linkSync(tmp, leasePath(port, dir));
  } catch (e) {
    if (e.code === "EEXIST") {
      unlinkSync(tmp);
      return null;
    }
    try { unlinkSync(tmp); } catch { /* best effort */ }
    throw e;
  }
  try { unlinkSync(tmp); } catch { /* best effort cleanup of the now-unneeded temp name */ }
  return token;
}

/**
 * Lease an instance. With no registry (or no valid port in it), returns the
 * default instance untouched -- pooled:false, no lease file written, a no-op
 * release() -- which is exactly today's behaviour with zero configuration
 * (D-3). Otherwise walks candidate ports in DESCENDING order and returns the
 * first successfully leased one.
 */
export async function acquire({ dir = poolDir(), argv = process.argv.slice(2).join(" ") } = {}) {
  const reg = readRegistry(registryPath(dir));
  if (!reg.present || reg.ports.length === 0) {
    const inst = defaultInstance(dir);
    return { ...inst, pooled: false, leasePath: null, release: async () => {} };
  }

  const candidates = [...reg.ports].sort((a, b) => b - a); // descending
  for (const port of candidates) {
    const token = tryAcquirePort(port, dir, process.pid, argv);
    if (token == null) continue; // occupied -- try the next port
    const inst = instanceFor(port, dir);
    const lp = leasePath(port, dir);
    let released = false;
    return {
      ...inst,
      pooled: true,
      leasePath: lp,
      release: async () => {
        if (released) return;
        released = true;
        try {
          if (existsSync(lp)) unlinkSync(lp);
        } catch {
          // best effort -- see Task 2 for token-checked, crash-safe release
        }
      },
    };
  }

  throw new Error(
    `acquire: every registered instance (${candidates.join(", ")}) is currently leased -- ` +
      `no free instance available`
  );
}
