// vice-broker.mts
//
// The long-lived host broker entry point (Phase 01.6.2). Extends the Phase
// 01.6 tracer in place rather than replacing it: parseArgs(),
// readBrokerRecordMaybe() and the atomic tmp-sibling-then-rename write
// discipline all survive; main() grows a real control listener, a
// heartbeat and a real acquire/release path spawning a real child.
//
// heartbeat_at is now MANDATORY, refreshed on a recurring timer for as long
// as this process lives. The tracer's own header comment used to forbid it
// ("DELIBERATELY OMITS heartbeat_at") because a heartbeat-less record from a
// write-once tracer that immediately exits would strand every later
// session's readBrokerLiveness() classification at never_started forever.
// That reasoning does not apply here: this broker is genuinely long-lived,
// so omitting heartbeat_at would instead make a REAL, RUNNING broker read
// as never_started -- exactly the failure this field exists to prevent.
//
// Imports node: builtins ONLY plus this phase's own sibling modules --
// mcp__vice__* stays the only route to the emulator; nothing here opens a
// connection to it.
import { readFileSync, mkdirSync, openSync, writeFileSync, chmodSync, renameSync } from "node:fs";
import { join, basename, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";

import { containerGuardReport, containerGuardEnforce } from "./container-guard.mjs";
import { createBrokerState, nextFreePort, countReady, countTotal, countLaunching, type BrokerState, type InstanceRecord } from "./broker-state.mjs";
import { acquirePortAndLaunch, maintainWarmFloor, probeReady, runBrokerPass } from "./broker-launch.mjs";
import { verifiedKill, registerShutdownHandlers, startupBanner, reapOrphanedInstances } from "./broker-kill.mjs";
import { writeEpochRecord, epochPathFor, nextEpochFor, type EpochRecord } from "./broker-epoch.mjs";
import { startControlListener, newControlToken, type AcquireGrant } from "./broker-control.mjs";

export interface ParsedArgs {
  repoRoot: string;
  stateDir: string;
  checkContainer: boolean;
  dryRun: boolean;
}

const USAGE = "usage: vice-broker.mjs --repo-root <path> [--state-dir <path>] [--check-container] [--dry-run]";

/** `--repo-root` is required UNLESS `--check-container` is given -- the
 * container guard needs no paths at all, matching the bash launcher's own
 * `--check-container` handling (answered before any path resolution).
 * `--state-dir` defaults to VICE_POOL_DIR from the environment when set,
 * otherwise `.vice-supervisor` under the repo root. */
export function parseArgs(argv: string[]): ParsedArgs {
  let repoRoot: string | null = null;
  let stateDir: string | null = null;
  let checkContainer = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--repo-root") {
      repoRoot = argv[i + 1] ?? null;
      i++;
    } else if (argv[i] === "--state-dir") {
      stateDir = argv[i + 1] ?? null;
      i++;
    } else if (argv[i] === "--check-container") {
      checkContainer = true;
    } else if (argv[i] === "--dry-run") {
      dryRun = true;
    }
  }

  if (!checkContainer && !repoRoot) {
    throw new Error(USAGE);
  }

  const resolvedStateDir = stateDir ?? process.env.VICE_POOL_DIR ?? (repoRoot ? join(repoRoot, ".vice-supervisor") : ".vice-supervisor");

  return { repoRoot: repoRoot ?? "", stateDir: resolvedStateDir, checkContainer, dryRun };
}

export interface BrokerRecord {
  version: number;
  written_by: string;
  pid: number;
  started_at: string;
  heartbeat_at: string;
  node_version: string;
  control_host: string;
  control_port: number;
  control_token: string;
}

/** The deployed JavaScript broker artifact's own name -- D-26's entire
 * point: this field used to read "vice-broker.sh" (the retiring bash
 * daemon), which was false the moment a real TypeScript broker existed.
 * It now names itself. */
export const WRITTEN_BY = "vice-broker.mjs";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read and parse a broker record, treating anything short of a
 * well-formed object as "not there yet" -- missing file, unreadable file,
 * partial write, malformed JSON, non-object shape. Never throws. */
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
 * exists. EPERM (exists, but this process lacks permission to signal it)
 * still counts as alive. */
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

/** Atomic tmp-sibling -> mode-tighten -> content -> rename, the same
 * choke-point discipline the tracer's own writeBrokerRecord() used, now
 * shared by both the initial write and every heartbeat refresh -- mode
 * stays owner-read-write on EVERY write, refresh included. */
function writeBrokerRecordFile(stateDir: string, record: BrokerRecord): string {
  mkdirSync(stateDir, { recursive: true });
  const finalPath = join(stateDir, "broker.json");
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, "");
  chmodSync(tmpPath, 0o600);
  writeFileSync(tmpPath, JSON.stringify(record, null, 2) + "\n");
  renameSync(tmpPath, finalPath);
  return finalPath;
}

/** Builds a spawn function that redirects the child's stdout/stderr into a
 * FRESH per-launch log file under logDir (D-23: per-instance boot/crash
 * logs survive under .vice-supervisor/<port>/logs/, same paths, same
 * format as the retiring bash supervisor), returning both the spawn
 * closure and the log's path relative to supervisorDir (the epoch
 * record's own `log` field). Shared by both launch paths -- a cold
 * acquire and warm-floor maintenance -- so there is exactly one place that
 * opens a launch log fd. */
function makeLoggingSpawn(logDir: string): { spawn: (cmd: string, args: string[]) => ReturnType<typeof nodeSpawn>; logRelPath: string } {
  mkdirSync(logDir, { recursive: true });
  const viceBinForLog = basename(process.env.VICE_BIN ?? "x64sc");
  const logName = `${viceBinForLog}-${Date.now()}.log`;
  const logFd = openSync(join(logDir, logName), "a");
  return {
    spawn: (cmd, cmdArgs) => nodeSpawn(cmd, cmdArgs, { stdio: ["ignore", logFd, logFd] }),
    logRelPath: `logs/${logName}`,
  };
}

/** Writes the epoch record for a just-launched instance -- shared by both
 * launch paths so D-04's contract (format, location, atomic-write
 * discipline, all unchanged -- only the writer moves) is discharged from
 * exactly one place regardless of WHY the instance was launched. A
 * granted instance and a still-warm spare are equally real processes; both
 * need a real epoch.json the moment they exist, or plan 04's grant-time
 * re-probe (which reads a spare's recorded epoch_file, per
 * grant_from_spare()'s bash original) would carry forward a path to
 * nothing. */
function writeEpochForLaunch(record: InstanceRecord, logRelPath: string): void {
  const epochRecord: EpochRecord = {
    epoch: 1,
    spawned_at: new Date(record.launchedAt).toISOString(),
    pid: record.pid as number,
    supervisor_pid: process.pid,
    vice_bin: record.viceBin,
    vice_args: record.viceArgs,
    log: logRelPath,
    dry_run: false,
  };
  writeEpochRecord({ supervisorDir: record.supervisorDir, record: epochRecord });
}

/** Allocates a port, launches through tryLaunchOne() (the single in_flight
 * owner), writes the epoch record, and records the grant. Returns null on
 * a launch failure -- the caller reports that as an `internal` control
 * error; the full denied/no_free_port/at_capacity vocabulary is plan 05's. */
async function handleAcquire(requestId: string, stateDir: string, state: BrokerState): Promise<AcquireGrant | null> {
  // acquirePortAndLaunch() holds the single in_flight owner across its own
  // async port allocation (not merely tryLaunchOne()'s synchronous spawn
  // instant) -- see that function's own header comment for the race this
  // closes between a cold acquire and a concurrent warm-floor pass. This
  // is also what restores vice-broker.sh's own process_requests() throttle:
  // a cold acquire that arrives while ANY launch (cold or warm) is already
  // under way is refused here, matching the bash original's declined-to-
  // change behaviour, rather than racing a second instance into existence.
  let lastLogRelPath = "";
  const result = await acquirePortAndLaunch("acquire", {
    state,
    stateDir,
    allocatePort: nextFreePort,
    spawnFactory: (port: number) => {
      const supervisorDir = join(stateDir, String(port));
      const { spawn, logRelPath } = makeLoggingSpawn(join(supervisorDir, "logs"));
      lastLogRelPath = logRelPath;
      return spawn;
    },
  });

  if (!result.ok || result.record.pid === null) {
    return null;
  }
  const record = result.record;

  writeEpochForLaunch(record, lastLogRelPath);

  state.grants.set(requestId, { id: requestId, port: record.port, grantedAt: Date.now() });
  record.state = "granted";

  return { port: record.port, url: record.url, epochFile: record.epochFile, supervisorDir: record.supervisorDir };
}

/** The warm-floor concern of the fixed-order evaluation pass (D-24 drops
 * the projection write; the grant sweep does not appear -- D-12's
 * connection-is-the-lease). Builds a fresh MaintainWarmFloorDeps per call
 * (never reused across passes) wiring broker-state.mjs's real
 * allocatePort/counts and broker-launch.mjs's real probeReady, and hooks
 * onLaunched to write the SAME epoch record a cold acquire writes -- a
 * warm spare is a real process the moment it exists, per D-04. */
function maintainWarmFloorForRealBroker(stateDir: string, state: BrokerState): Promise<void> {
  return maintainWarmFloor({
    state,
    stateDir,
    spawnFactory: (port: number) => {
      const supervisorDir = join(stateDir, String(port));
      const { spawn, logRelPath } = makeLoggingSpawn(join(supervisorDir, "logs"));
      return (cmd: string, args: string[]) => {
        const child = spawn(cmd, args);
        // Stash the log path where onLaunched (fired synchronously right
        // after this returns, still within the SAME maintainWarmFloor()
        // call -- at most one launch per call, per the serialised-warming
        // invariant) can find it.
        lastWarmLaunchLogRelPath = logRelPath;
        return child;
      };
    },
    probe: (port: number) => probeReady(port),
    allocatePort: nextFreePort,
    countReady,
    countTotal,
    countLaunching,
    onLaunched: (record: InstanceRecord) => {
      writeEpochForLaunch(record, lastWarmLaunchLogRelPath);
    },
    log: (line: string) => process.stderr.write(`${line}\n`),
  });
}
let lastWarmLaunchLogRelPath = "";

/** Releases a grant and identity-verified-kills its instance. Fire-and-
 * forget from the control listener's close handler's own perspective --
 * the full shutdown wiring and the startup reap are plan 04's; this task
 * only needs release-on-close to actually tear the child down. */
function handleRelease(requestId: string, state: BrokerState): void {
  const grant = state.grants.get(requestId);
  if (!grant) return;
  state.grants.delete(requestId);
  const instance = state.instances.get(grant.port);
  state.instances.delete(grant.port);
  if (instance) {
    verifiedKill({ pid: instance.pid, expectedIdentity: instance.expectedIdentity }).catch(() => {
      // best-effort; nothing further to report on this path this task
    });
  }
}

async function run(args: ParsedArgs): Promise<void> {
  const finalPath = join(args.stateDir, "broker.json");

  // Refuse-to-clobber: ONLY a currently-live pid blocks a (re)start. This is
  // narrower than the tracer's own guard, which also refused on the mere
  // PRESENCE of a heartbeat_at field -- that rule made sense for a
  // write-once tracer (any heartbeat_at meant "a real broker already wrote
  // this"), but this broker's OWN records always carry heartbeat_at, so
  // keeping that rule would make it impossible to ever restart a broker
  // that crashed or was stopped. This is NOT the CR-01 singleton guard
  // (Phase 01.6.2 plan 05's, TCP-listener-enforced) -- it only stops one
  // broker from clobbering the state of another that is still alive.
  const existing = readBrokerRecordMaybe(finalPath);
  if (existing && pidIsAlive(existing.pid)) {
    process.stderr.write(`vice-broker: refusing to overwrite broker.json naming live pid ${String(existing.pid)}\n`);
    process.exitCode = 1;
    return;
  }

  // D-25: the mandatory start-time banner, printed unconditionally and
  // BEFORE anything else in this function runs -- an operator must be told
  // what a Ctrl-C costs before there is anything running for them to Ctrl-C.
  process.stderr.write(`${startupBanner()}\n`);

  const state = createBrokerState();
  const token = newControlToken();
  const controlHost = process.env.VICE_BROKER_CONTROL_HOST ?? "0.0.0.0";

  // Criterion I / D-15: the unconditional startup reap runs BEFORE the
  // control listener accepts and before anything is launched. A SIGKILLed
  // prior broker never ran a shutdown path, so this is the only place the
  // "every emulator this project's port band could be squatting is either
  // ours or a human's own work" guarantee can be enforced -- no marker file
  // is consulted, per this reap's own header comment in broker-kill.mts.
  await reapOrphanedInstances({
    stateDir: args.stateDir,
    epochPathFor,
    nextEpochFor,
    writeEpochRecord,
  });

  let listener: Awaited<ReturnType<typeof startControlListener>>;
  try {
    listener = await startControlListener({
      host: controlHost,
      token,
      onAcquire: (requestId) => handleAcquire(requestId, args.stateDir, state),
      onRelease: (requestId) => handleRelease(requestId, state),
    });
  } catch (e) {
    process.stderr.write(`vice-broker: failed to start control listener: ${(e as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

  // C5: every catchable shutdown path (SIGTERM/SIGINT/SIGHUP, an uncaught
  // exception, an unhandled rejection, normal exit) converges on ONE
  // re-entrant-safe teardown that identity-verified-kills every instance
  // this broker launched and clears the map unconditionally
  // (kill-never-recycle). Registered once the listener is up, since there is
  // nothing to tear down before that point.
  registerShutdownHandlers({ state });

  let record: BrokerRecord = {
    version: 1,
    written_by: WRITTEN_BY,
    pid: process.pid,
    started_at: new Date().toISOString(),
    heartbeat_at: new Date().toISOString(),
    node_version: process.version,
    control_host: listener.host,
    control_port: listener.port,
    control_token: token, // never logged -- T-01.6.2-02
  };
  writeBrokerRecordFile(args.stateDir, record);
  process.stderr.write(`vice-broker: wrote ${finalPath} (node ${record.node_version}); control listener bound on ${listener.host}:${listener.port}\n`);

  const heartbeatMs = Number(process.env.VICE_BROKER_HEARTBEAT_MS) || 30000;
  setInterval(() => {
    record = { ...record, heartbeat_at: new Date().toISOString() };
    writeBrokerRecordFile(args.stateDir, record);
  }, heartbeatMs);

  // The fixed-order evaluation pass (runBrokerPass, broker-launch.mts):
  // serve pending acquires, then maintain the warm floor -- mirroring
  // vice-broker.sh's own broker_once() ordering. Ticks on
  // VICE_BROKER_POLL_MS (default 500, the SAME env var name and semantics
  // the bash daemon used). serveAcquires is a documented no-op here: under
  // this phase's TCP control plane (plan 01), an acquire is already served
  // immediately, per connection, by onAcquire above -- there is no
  // file-based request queue left to iterate. It stays a named, orderable
  // step because plan 05 adds the real arrival-ordered queue (D-08) here.
  // Re-entrancy guarded: a pass that is still running (e.g. a slow external
  // VICE_BROKER_PROBE_CMD) is never overlapped by the next tick.
  const pollMs = Number(process.env.VICE_BROKER_POLL_MS) || 500;
  let passInFlight = false;
  setInterval(() => {
    if (passInFlight) return;
    passInFlight = true;
    runBrokerPass({
      serveAcquires: () => {
        // no-op by construction -- see this block's own header comment.
      },
      maintainWarmFloor: () => maintainWarmFloorForRealBroker(args.stateDir, state),
    })
      .catch((e) => {
        process.stderr.write(`vice-broker: evaluation pass failed: ${(e as Error).message}\n`);
      })
      .finally(() => {
        passInFlight = false;
      });
  }, pollMs);
}

/** Parses argv, evaluates the container guard FIRST -- before any state
 * directory is read or written and before anything is spawned (PD-03) --
 * then runs the long-lived broker. Never calls process.exit(); always sets
 * process.exitCode so pending I/O flushes first. */
export function main(argv: string[] = process.argv.slice(2)): void {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

  if (args.checkContainer) {
    process.exitCode = containerGuardReport();
    return;
  }

  const guardRc = containerGuardEnforce();
  if (guardRc !== 0) {
    process.exitCode = guardRc;
    return;
  }

  run(args).catch((e) => {
    process.stderr.write(`vice-broker: ${(e as Error).message}\n`);
    process.exitCode = 1;
  });
}

// -------------------------------------------------------------------- CLI
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
