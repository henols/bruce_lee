// vice-broker.mts
//
// Host-bound TRACER module (Phase 01.6 plan 01). This is NOT the real
// one-process broker -- that is Phase 01.6.2's. Its job here is narrower and
// deliberately small: prove the entire build pipeline (authored TypeScript ->
// tsc -> banner-marked committed JS under resources/ -> install-resources.mjs
// -> the host's gitignored tools/ -> a container-guarded launcher that execs
// bare `node`) on ONE real module before 16,000 lines ride on it.
//
// Imports node: builtins ONLY -- the host needs `node` and never `npm`/`tsc`
// (criterion 3, C3). Nothing here opens a network connection of any kind;
// `mcp__vice__*` stays the only route to the emulator.
//
// The broker record this writes carries pid/started_at/node_version and
// DELIBERATELY OMITS heartbeat_at: vice-broker-client.mjs's
// readBrokerLiveness() (around line 317-318) classifies a record with no
// parseable heartbeat_at as never_started, which is the honest verdict for a
// tracer run that isn't a real running broker. Adding a heartbeat field here
// would make an inert record read as "alive" to every session's proxy and
// strand it on a request nobody serves. DO NOT add heartbeat_at.
//
// The refuse-to-clobber guard below is NOT the CR-01 singleton guard (that is
// Phase 01.7's, TCP-listener-enforced). It is narrower: don't overwrite a
// record another process is relying on -- a live pid, or any record that
// already carries a heartbeat (i.e. a real broker's record).
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

export interface ParsedArgs {
  repoRoot: string;
  stateDir: string;
}

const USAGE = "usage: vice-broker.mjs --repo-root <path> [--state-dir <path>]";

/** `--repo-root` is REQUIRED -- taking it as an argument rather than
 * re-deriving it is the same structural cycle-avoidance
 * install-resources.mjs's own header documents, and stops this becoming a
 * fourth copy of the repo-root ladder. `--state-dir` defaults to
 * VICE_POOL_DIR from the environment when set, otherwise to `.vice-supervisor`
 * under the repo root -- matching both vice-broker.sh's own variable and
 * repo-root.mjs's supervisorDir(). */
export function parseArgs(argv: string[]): ParsedArgs {
  let repoRoot: string | null = null;
  let stateDir: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--repo-root") {
      repoRoot = argv[i + 1] ?? null;
      i++;
    } else if (argv[i] === "--state-dir") {
      stateDir = argv[i + 1] ?? null;
      i++;
    }
  }

  if (!repoRoot) {
    throw new Error(USAGE);
  }

  const resolvedStateDir = stateDir ?? process.env.VICE_POOL_DIR ?? join(repoRoot, ".vice-supervisor");

  return { repoRoot, stateDir: resolvedStateDir };
}

export interface BrokerRecord {
  pid: number;
  started_at: string;
  node_version: string;
}

/** True iff `value` is a well-formed, generic JSON object -- not null, not an
 * array. Shared by readBrokerRecordMaybe()'s parse step. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read and parse a broker record, treating anything short of a well-formed
 * object as "not there yet" -- missing file, unreadable file, partial write,
 * malformed JSON, non-object shape. Two nested try/catch layers, one for the
 * read and one for the parse, matching vice-broker-client.mjs's
 * readJsonMaybe() posture exactly (V5). Never throws. */
export function readBrokerRecordMaybe(path: string): Record<string, unknown> | null {
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

/** Zero-signal liveness probe: true iff a process with this pid currently
 * exists. Wrapped in try/catch -- ESRCH (no such process) means not alive;
 * EPERM (exists, but this process lacks permission to signal it) still means
 * the pid IS alive, just not signalable by us, so it counts as alive too. */
function pidIsAlive(pid: unknown): boolean {
  if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

export type WriteResult =
  | { ok: true; path: string; record: BrokerRecord }
  | { ok: false; reason: string };

/** Writes stateDir/broker.json. Refuses -- returning { ok: false, reason } --
 * when an existing record names a currently-live pid, or carries a
 * heartbeat_at property AT ALL (regardless of whether it parses as a valid
 * timestamp -- presence alone is the signal of a real broker record, per
 * this task's own must_haves). Otherwise writes a record whose keys are
 * exactly pid, started_at (ISO 8601) and node_version.
 *
 * The write is tmp sibling -> mode set to owner-read-write -> content ->
 * rename, in that order, never in place -- the same choke-point discipline
 * write_json_atomic() uses on the bash side (V4/V5). */
export function writeBrokerRecord({ stateDir }: { stateDir: string }): WriteResult {
  mkdirSync(stateDir, { recursive: true });
  const finalPath = join(stateDir, "broker.json");

  const existing = readBrokerRecordMaybe(finalPath);
  if (existing) {
    if (pidIsAlive(existing.pid)) {
      return { ok: false, reason: `refusing to overwrite broker.json naming live pid ${String(existing.pid)}` };
    }
    if (Object.prototype.hasOwnProperty.call(existing, "heartbeat_at")) {
      return { ok: false, reason: "refusing to overwrite broker.json that carries a heartbeat_at field" };
    }
  }

  const record: BrokerRecord = {
    pid: process.pid,
    started_at: new Date().toISOString(),
    node_version: process.version,
  };

  // tmp sibling -> chmod 600 -> content -> rename. The tmp file is created
  // empty first and mode-tightened BEFORE any content reaches it, so the
  // record is never briefly world-readable (V4).
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, "");
  chmodSync(tmpPath, 0o600);
  writeFileSync(tmpPath, JSON.stringify(record, null, 2) + "\n");
  renameSync(tmpPath, finalPath);

  return { ok: true, path: finalPath, record };
}

/** Parses, writes, and reports the outcome to stderr -- NEVER stdout, per the
 * same D-4 discipline install-resources.mjs observes (stdout is reserved for
 * machine-readable output elsewhere in this module tree; a stray banner here
 * would corrupt it were this ever composed into such a pipeline). Exits zero
 * or non-zero accordingly via process.exitCode (never process.exit(), so any
 * pending I/O flushes first). */
export function main(argv: string[] = process.argv.slice(2)): void {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

  const result = writeBrokerRecord({ stateDir: args.stateDir });
  if (!result.ok) {
    process.stderr.write(`vice-broker: ${result.reason}\n`);
    process.exitCode = 1;
    return;
  }

  process.stderr.write(`vice-broker: wrote ${result.path} (node ${result.record.node_version})\n`);
  process.exitCode = 0;
}

// -------------------------------------------------------------------- CLI
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
