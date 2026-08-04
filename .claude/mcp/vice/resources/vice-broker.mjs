// GENERATED FILE -- DO NOT EDIT.
// Compiled by `tsc` from vice-broker.mts. Edit the TypeScript source and rebuild;
// changes made directly to this file are silently overwritten by the next build, and are never
// deployed to the host on their own -- install-resources.mjs copies THIS file's on-disk contents
// verbatim to tools/, so an edit made only here reaches the host but is lost on the very next
// rebuild.
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
import { spawn as nodeSpawn } from "node:child_process";
import { containerGuardReport, containerGuardEnforce } from "./container-guard.mjs";
import { createBrokerState, nextFreePort, countReady, countTotal, countLaunching, atCapacity, resolveBasePort, } from "./broker-state.mjs";
import { acquirePortAndLaunch, maintainWarmFloor, probeReady, runBrokerPass, withCrashSupervision, } from "./broker-launch.mjs";
import { verifiedKill, registerShutdownHandlers, startupBanner, reapOrphanedInstances } from "./broker-kill.mjs";
import { writeEpochRecord, epochPathFor, nextEpochFor, instanceLogDirFor } from "./broker-epoch.mjs";
import { startControlListener, newControlToken, drainPendingAcquires, resolveControlPort, } from "./broker-control.mjs";
const USAGE = "usage: vice-broker.mjs --repo-root <path> [--state-dir <path>] [--check-container] [--dry-run]";
/** `--repo-root` is required UNLESS `--check-container` is given -- the
 * container guard needs no paths at all, matching the bash launcher's own
 * `--check-container` handling (answered before any path resolution).
 * `--state-dir` defaults to VICE_POOL_DIR from the environment when set,
 * otherwise `.vice-supervisor` under the repo root. */
export function parseArgs(argv) {
    let repoRoot = null;
    let stateDir = null;
    let checkContainer = false;
    let dryRun = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--repo-root") {
            repoRoot = argv[i + 1] ?? null;
            i++;
        }
        else if (argv[i] === "--state-dir") {
            stateDir = argv[i + 1] ?? null;
            i++;
        }
        else if (argv[i] === "--check-container") {
            checkContainer = true;
        }
        else if (argv[i] === "--dry-run") {
            dryRun = true;
        }
    }
    if (!checkContainer && !repoRoot) {
        throw new Error(USAGE);
    }
    const resolvedStateDir = stateDir ?? process.env.VICE_POOL_DIR ?? (repoRoot ? join(repoRoot, ".vice-supervisor") : ".vice-supervisor");
    return { repoRoot: repoRoot ?? "", stateDir: resolvedStateDir, checkContainer, dryRun };
}
/** The deployed JavaScript broker artifact's own name -- D-26's entire
 * point: this field used to read "vice-broker.sh" (the retiring bash
 * daemon), which was false the moment a real TypeScript broker existed.
 * It now names itself. */
export const WRITTEN_BY = "vice-broker.mjs";
// ---------------------------------------------------------------------------
// Small, locally-duplicated env-var readers (plan 05) -- the SAME pattern
// broker-kill.mts's own resolveBasePortForReap()/resolveViceBinForReap()
// already established: this module cannot import broker-launch.mts's
// PRIVATE resolveWarmFloor()/resolveCeiling() (they are not exported, and
// this file is already the top-level wiring module value-importing every
// sibling .mjs directly -- exporting them would widen broker-launch.mts's
// own surface for a one-line env-var read this file can duplicate exactly
// as cheaply). Both mirror broker-launch.mts's defaults precisely
// (VICE_BROKER_SPARES/3, VICE_BROKER_MAX/16) so broker.json's config echo
// and host_state's own answer can never disagree with what maintainWarmFloor
// itself actually enforces.
// ---------------------------------------------------------------------------
function resolveWarmFloorForRecord() {
    const raw = process.env.VICE_BROKER_SPARES;
    if (raw === undefined || raw === "")
        return 3;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 3;
}
function resolveCeilingForRecord() {
    const raw = process.env.VICE_BROKER_MAX;
    if (raw === undefined || raw === "")
        return 16;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 16;
}
function resolveViceBinForHostState() {
    return process.env.VICE_BIN ?? "x64sc";
}
/** Duplicates vice-broker-client.ts's readBrokerLiveness() classification
 * logic (never_started / stale / alive against BROKER_STALE_MS) rather than
 * importing it -- confirmed empirically (plan 02's own SUMMARY) that
 * importing vice-broker-client.ts into a HOST-BOUND module pulls its
 * transitive dependents (repo-root.ts, install-resources.ts, hostpath.ts)
 * into the SAME tsc build program, which either fails to compile under
 * tsconfig.build.json's allowImportingTsExtensions:false or forces those
 * container-side files to be committed under resources/ as if host-bound.
 * This is the SAME classification a test can drive the REAL
 * readBrokerLiveness() over (broker-control.test.ts does exactly that,
 * against records this function's own caller writes), proving the two never
 * diverge -- this module only needs the classification NAME (never_started
 * / stale / alive), never the pid/heartbeatAt fields readBrokerLiveness()
 * also returns. */
const BROKER_STALE_MS = Number(process.env.VICE_BROKER_STALE_MS || 180000);
function classifyBrokerLivenessLocal(path) {
    const parsed = readBrokerRecordMaybe(path);
    if (parsed === null)
        return "never_started";
    const heartbeatAt = typeof parsed.heartbeat_at === "string" ? parsed.heartbeat_at : null;
    const heartbeatMs = heartbeatAt ? Date.parse(heartbeatAt) : NaN;
    if (!Number.isFinite(heartbeatMs))
        return "never_started";
    return Date.now() - heartbeatMs > BROKER_STALE_MS ? "stale" : "alive";
}
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Read and parse a broker record, treating anything short of a
 * well-formed object as "not there yet" -- missing file, unreadable file,
 * partial write, malformed JSON, non-object shape. Never throws. */
export function readBrokerRecordMaybe(path) {
    let raw;
    try {
        raw = readFileSync(path, "utf8");
    }
    catch {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        return isPlainObject(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
/** Atomic tmp-sibling -> mode-tighten -> content -> rename, the same
 * choke-point discipline the tracer's own writeBrokerRecord() used, now
 * shared by both the initial write and every heartbeat refresh -- mode
 * stays owner-read-write on EVERY write, refresh included. */
function writeBrokerRecordFile(stateDir, record) {
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
function makeLoggingSpawn(logDir) {
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
function writeEpochForLaunch(record, logRelPath) {
    const epochRecord = {
        epoch: 1,
        spawned_at: new Date(record.launchedAt).toISOString(),
        pid: record.pid,
        supervisor_pid: process.pid,
        vice_bin: record.viceBin,
        vice_args: record.viceArgs,
        log: logRelPath,
        dry_run: false,
    };
    writeEpochRecord({ supervisorDir: record.supervisorDir, record: epochRecord });
    // The in-memory record's own epoch field must carry the SAME value the
    // epoch record was just written with -- without this, every
    // first-generation instance reports an absent epoch to the status
    // response and an absent epoch-before in a recycle acknowledgement,
    // making a later respawn's advance unobservable at the one place a
    // caller reads it (handleStatus(), handleRecycleForRealBroker()).
    record.epoch = epochRecord.epoch;
}
/** Builds the supervision dependency object for withCrashSupervision(),
 * once per launch, so both real launch paths (handleAcquire here; Task 2's
 * maintainWarmFloorForRealBroker) pass a structurally identical
 * SuperviseChildDeps object into the SAME shared wrapper. Deliberately does
 * NOT set spawnFactory: on a respawn, launchSupervised() (broker-launch.mts)
 * derives its own per-instance log path from instanceLogDirFor and names
 * that same path in the epoch record it writes -- supplying a competing
 * spawn factory here would produce two log files per respawn with the
 * epoch record naming the wrong one. Leaving it unset means a respawn's
 * output lands in the supervision module's own log file under the same
 * per-instance logs directory D-23 requires, and the epoch record names
 * the file that actually received the output. */
function superviseDepsFor(stateDir, state) {
    return {
        state,
        stateDir,
        epoch: { epochPathFor, instanceLogDirFor, nextEpochFor, writeEpochRecord },
        log: (line) => process.stderr.write(`${line}\n`),
    };
}
/** Sets the deliberate-death marker and its respawn-after-kill answer
 * TOGETHER -- the single place in this module that ever writes either
 * field, so a call site can never set one and forget the other, which is
 * the exact shape of the defect this closes (T-01.6.2-80). Called BEFORE
 * any signal reaches the target child in both handlers below, never after:
 * the exit handler (broker-launch.mts) runs on the child's OWN exit event,
 * so a marker set after the signal arrives too late to be read
 * (T-01.6.2-84). */
function markDeliberateDeath(instance, respawnAfterKill) {
    instance.deliberateKill = true;
    instance.respawnAfterKill = respawnAfterKill;
}
/** Allocates a port, launches through tryLaunchOne() (the single in_flight
 * owner), writes the epoch record, and records the grant. Answers the full
 * discriminated AcquireOutcome (plan 05): `at_capacity` when the instance
 * ceiling is already reached (checked BEFORE ever touching the port
 * allocator or spawning anything), `no_free_port`/`launch_in_flight` passed
 * straight through from acquirePortAndLaunch()'s own typed failure, and
 * `internal` only for a genuine, otherwise-unclassified fault. A
 * `launch_in_flight` outcome is NOT a control-plane error -- broker-
 * control.mts's own attemptAcquire()/enqueueAcquire() queue the request and
 * retry it later rather than refusing it. */
async function handleAcquire(requestId, stateDir, state) {
    if (atCapacity(state)) {
        return { ok: false, reason: "at_capacity" };
    }
    // acquirePortAndLaunch() holds the single in_flight owner across its own
    // async port allocation (not merely tryLaunchOne()'s synchronous spawn
    // instant) -- see that function's own header comment for the race this
    // closes between a cold acquire and a concurrent warm-floor pass. This
    // is also what restores vice-broker.sh's own process_requests() throttle:
    // a cold acquire that arrives while ANY launch (cold or warm) is already
    // under way is queued here (plan 05), matching the bash original's
    // declined-to-change behaviour of never racing a second instance into
    // existence, but answered LATER instead of refused outright.
    let lastLogRelPath = "";
    const result = await acquirePortAndLaunch("acquire", {
        state,
        stateDir,
        allocatePort: nextFreePort,
        spawnFactory: (port) => {
            const supervisorDir = join(stateDir, String(port));
            const { spawn, logRelPath } = makeLoggingSpawn(join(supervisorDir, "logs"));
            lastLogRelPath = logRelPath;
            return withCrashSupervision("acquire", port, spawn, superviseDepsFor(stateDir, state));
        },
    });
    if (!result.ok) {
        return { ok: false, reason: result.reason };
    }
    if (result.record.pid === null) {
        return { ok: false, reason: "internal" };
    }
    const record = result.record;
    writeEpochForLaunch(record, lastLogRelPath);
    state.grants.set(requestId, { id: requestId, port: record.port, grantedAt: Date.now() });
    record.state = "granted";
    return {
        ok: true,
        grant: { port: record.port, url: record.url, epochFile: record.epochFile, supervisorDir: record.supervisorDir },
    };
}
/** Answers the `status` control-plane request: one entry per instance,
 * computed on demand from the SAME in-memory map every other count reads --
 * strictly better than the dropped broker-instances.json projection, which
 * could go stale between passes (D-24). */
function handleStatus(state) {
    return Array.from(state.instances.values()).map((r) => ({
        port: r.port,
        url: r.url,
        state: r.state,
        reason: r.reason,
        epoch: typeof r.epoch === "number" ? r.epoch : null,
    }));
}
/** Resolves a recycle target's emulator child pid from THIS broker's own
 * in-memory instance record -- record.pid is, by construction, exactly the
 * same value broker-epoch.mts's writer puts in epoch.json's own `pid` field
 * (both are set from the same spawned child's own pid at launch time, and
 * both are updated together on every respawn) -- so reading it here is
 * reading "the epoch record's pid", never the supervising broker's own
 * process.pid (T-01.6.2-17; there is no intermediate supervisor process in
 * this topology at all, per broker-kill.mts's own header comment). A
 * recycle's OWNERSHIP check (does this connection hold this grant) already
 * happened in broker-control.mts before this function is ever called -- this
 * function only resolves, marks and kills.
 *
 * Marks the death as broker-ordered AND to be replaced, with a TRUE
 * respawn-after-kill answer, BEFORE the kill -- the actual replacement is
 * then carried out by the per-child supervision exit handler
 * (broker-launch.mts's handleExit(), wired in by plan 12) on the SAME port,
 * asynchronously, after this function has already returned its own
 * acknowledgement. This is exactly what the tool description's own "via the
 * host supervisor's existing respawn loop" wording describes: this function
 * marks and kills; the respawn loop is the exit handler, not this function.
 * Neither the grant nor the instance entry is deleted here -- the grant is
 * what keeps the recycled port belonging to this same session, and the
 * instance entry is what the exit handler reads to decide the relaunch;
 * both must still exist once this function returns for the exit handler to
 * have anything to act on. */
async function handleRecycleForRealBroker(targetId, state) {
    const grant = state.grants.get(targetId);
    if (!grant) {
        return {
            port: null,
            pid: null,
            viceBin: null,
            killStage: "no_signal",
            epochBefore: null,
            outcome: "grant_lookup_failed",
            reason: `no grant record found for target ${targetId}`,
        };
    }
    const instance = state.instances.get(grant.port);
    if (!instance) {
        return {
            port: grant.port,
            pid: null,
            viceBin: null,
            killStage: "no_signal",
            epochBefore: null,
            outcome: "epoch_lookup_failed",
            reason: `no resolvable epoch record for target ${targetId} (port ${grant.port})`,
        };
    }
    if (instance.pid === null) {
        return {
            port: instance.port,
            pid: null,
            viceBin: instance.viceBin,
            killStage: "no_signal",
            epochBefore: typeof instance.epoch === "number" ? instance.epoch : null,
            outcome: "pid_lookup_failed",
            reason: `epoch record carries no pid for target ${targetId}`,
        };
    }
    const epochBefore = typeof instance.epoch === "number" ? instance.epoch : null;
    markDeliberateDeath(instance, true);
    const killStage = await verifiedKill({ pid: instance.pid, expectedIdentity: instance.expectedIdentity });
    const outcome = killStage === "identity_refused" ? "identity_refused" : "ok";
    const reason = killStage === "identity_refused" ? "process identity did not match the recorded emulator binary -- the target was NOT signalled and is still running" : "";
    return { port: instance.port, pid: instance.pid, viceBin: instance.viceBin, killStage, epochBefore, outcome, reason };
}
/** The warm-floor concern of the fixed-order evaluation pass (D-24 drops
 * the projection write; the grant sweep does not appear -- D-12's
 * connection-is-the-lease). Builds a fresh MaintainWarmFloorDeps per call
 * (never reused across passes) wiring broker-state.mjs's real
 * allocatePort/counts and broker-launch.mjs's real probeReady, and hooks
 * onLaunched to write the SAME epoch record a cold acquire writes -- a
 * warm spare is a real process the moment it exists, per D-04. */
function maintainWarmFloorForRealBroker(stateDir, state) {
    return maintainWarmFloor({
        state,
        stateDir,
        spawnFactory: (port) => {
            const supervisorDir = join(stateDir, String(port));
            const { spawn, logRelPath } = makeLoggingSpawn(join(supervisorDir, "logs"));
            const stashingSpawn = (cmd, args) => {
                const child = spawn(cmd, args);
                // Stash the log path where onLaunched (fired synchronously right
                // after this returns, still within the SAME maintainWarmFloor()
                // call -- at most one launch per call, per the serialised-warming
                // invariant) can find it. withCrashSupervision() below composes
                // AROUND this function, so the stash still runs (and still
                // completes before onLaunched reads it) before the exit listener
                // is ever attached.
                lastWarmLaunchLogRelPath = logRelPath;
                return child;
            };
            return withCrashSupervision("spare", port, stashingSpawn, superviseDepsFor(stateDir, state));
        },
        probe: (port) => probeReady(port),
        allocatePort: nextFreePort,
        countReady,
        countTotal,
        countLaunching,
        onLaunched: (record) => {
            writeEpochForLaunch(record, lastWarmLaunchLogRelPath);
        },
        log: (line) => process.stderr.write(`${line}\n`),
    });
}
let lastWarmLaunchLogRelPath = "";
/** Releases a grant and identity-verified-kills its instance. Marks the
 * death as broker-ordered with a FALSE respawn-after-kill answer BEFORE the
 * kill -- the opposite answer from the recycle handler above, since a
 * release wants no replacement. The instance entry is still deleted here on
 * purpose, exactly as before: the exit handler's own final-death branch
 * would also delete it, and both deleting is harmless, whereas neither
 * deleting would leak the record if the exit event were never delivered.
 * Fire-and-forget from the control listener's close handler's own
 * perspective -- the full shutdown wiring and the startup reap are plan
 * 04's; this task only needs release-on-close to actually tear the child
 * down. */
function handleRelease(requestId, state) {
    const grant = state.grants.get(requestId);
    if (!grant)
        return;
    const instance = state.instances.get(grant.port);
    if (instance) {
        markDeliberateDeath(instance, false);
    }
    state.grants.delete(requestId);
    state.instances.delete(grant.port);
    if (instance) {
        verifiedKill({ pid: instance.pid, expectedIdentity: instance.expectedIdentity }).catch(() => {
            // best-effort; nothing further to report on this path this task
        });
    }
}
async function run(args) {
    const finalPath = join(args.stateDir, "broker.json");
    // Plan 05 (criterion K, D-17): the tracer/plan-04-era "refuse to overwrite
    // a record naming a currently-live pid" pre-check is GONE -- REPLACED by
    // the bind-before-write singleton guard below, not merely extended
    // alongside it (this phase's own plan-time note is explicit: the
    // refuse-to-clobber heuristic is replaced, not extended). That old check
    // read broker.json's OWN recorded pid and asked "is that process alive" --
    // a heuristic that can never tell "a live broker legitimately holds this
    // port" apart from "a live but unrelated process happens to share a pid
    // number with a stale record" (pids get reused). The kernel-enforced bind
    // below asks the ONLY question that actually matters -- "is the control
    // port itself already held" -- and broker.json becomes a pure ARBITER of
    // that question's two possible causes, never a gate in its own right.
    //
    // D-25: the mandatory start-time banner, printed unconditionally and
    // BEFORE anything else in this function runs -- an operator must be told
    // what a Ctrl-C costs before there is anything running for them to Ctrl-C.
    process.stderr.write(`${startupBanner()}\n`);
    const state = createBrokerState();
    const token = newControlToken();
    const controlHost = process.env.VICE_BROKER_CONTROL_HOST ?? "0.0.0.0";
    const startedAt = new Date().toISOString(); // FIXED across every heartbeat refresh -- see writeBrokerRecordFile()'s callers below
    const pollMs = Number(process.env.VICE_BROKER_POLL_MS) || 500;
    const controlPort = resolveControlPort();
    // Criterion I / D-15: the unconditional startup reap runs BEFORE the
    // control listener accepts and before anything is launched. A SIGKILLed
    // prior broker never ran a shutdown path, so this is the only place the
    // "every emulator this project's port band could be squatting is either
    // ours or a human's own work" guarantee can be enforced -- no marker file
    // is consulted, per this reap's own header comment in broker-kill.mts.
    //
    // NOTE (plan 05): this reap runs UNCONDITIONALLY, before the bind attempt
    // below -- including for a process that goes on to LOSE the singleton
    // race a moment later (see the EADDRINUSE handling below). That ordering
    // is D-15's own, already established and tested by plan 04
    // (broker-kill.test.ts's own structural source-order check); this task
    // does not change it. A losing second broker's own reap pass is an
    // accepted, pre-existing consequence of "the reap is unconditional" --
    // not something the singleton guard below is required to prevent.
    await reapOrphanedInstances({
        stateDir: args.stateDir,
        epochPathFor,
        nextEpochFor,
        writeEpochRecord,
    });
    // D-18: the singleton guarantee holds only while the control port keeps its default -- two brokers deliberately configured onto different ports are two brokers, and no code prevents that.
    let listener;
    try {
        listener = await startControlListener({
            host: controlHost,
            port: controlPort,
            token,
            onAcquire: (requestId) => handleAcquire(requestId, args.stateDir, state),
            onRelease: (requestId) => handleRelease(requestId, state),
            onRecycle: (targetId) => handleRecycleForRealBroker(targetId, state),
            onStatus: () => handleStatus(state),
            onHostState: () => ({
                pid: process.pid,
                startedAt,
                nodeVersion: process.version,
                viceBin: resolveViceBinForHostState(),
                warmFloor: resolveWarmFloorForRecord(),
                maxInstances: resolveCeilingForRecord(),
                basePort: resolveBasePort(),
            }),
        });
    }
    catch (e) {
        // Criterion K / D-17 / D-18: CR-01 closes here. A well-known TCP port
        // cannot be bound twice, so EADDRINUSE is the kernel enforcing the
        // singleton -- but the guarantee holds only while the control port
        // keeps its default (two brokers deliberately configured onto
        // DIFFERENT ports are two brokers, and no code here or anywhere else
        // prevents that). On EADDRINUSE, broker.json arbitrates via the SAME
        // never_started/stale/alive classification vice-broker-client.ts's
        // readBrokerLiveness() uses (duplicated locally above -- see
        // classifyBrokerLivenessLocal()'s own header comment for why this
        // cannot be a value import), and takes exactly one of two DISTINCT
        // paths: a record classified alive means this process lost a genuine
        // race against a live broker -- exit quietly, status 0, as designed.
        // A record classified stale or never_started means the port is held by
        // something that does not answer as a broker at all -- fail loudly,
        // naming the port and what to check. Conflating these two would let a
        // squatted port masquerade as a healthy singleton, permanently and
        // silently (T-01.6.2-34). Neither path writes the discovery record,
        // launches an instance, or reaps again -- both simply exit.
        const err = e;
        if (err.code === "EADDRINUSE") {
            const liveness = classifyBrokerLivenessLocal(finalPath);
            if (liveness === "alive") {
                process.stderr.write(`vice-broker: another broker is already running and holds control port ${controlPort} -- exiting quietly as a second instance (record: ${finalPath})\n`);
                process.exitCode = 0;
                return;
            }
            process.stderr.write(`vice-broker: FATAL -- control port ${controlPort} is held by something that does not answer as a broker (discovery record classified "${liveness}"). ` +
                `Check what is bound to port ${controlPort} on the host (e.g. \`lsof -i :${controlPort}\` or \`ss -ltnp\`) before restarting. Record: ${finalPath}\n`);
            process.exitCode = 1;
            return;
        }
        process.stderr.write(`vice-broker: failed to start control listener: ${err.message}\n`);
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
    // A successful bind writes the record UNCONDITIONALLY, overwriting
    // whatever was there -- the bind itself is the proof of singleton status
    // (D-17). The fourteen-field set (D-27, criterion G): the lease
    // time-to-live field the bash original carried is gone -- the connection
    // is the lease now (D-12) -- and every other config-echo field survives
    // even though no consumer parses it beyond a status message, because a
    // human reading this file by hand benefits from the full echo.
    let record = {
        version: 1,
        written_by: WRITTEN_BY,
        pid: process.pid,
        started_at: startedAt,
        heartbeat_at: new Date().toISOString(),
        node_version: process.version,
        control_host: listener.host,
        control_port: listener.port,
        control_token: token, // never logged -- T-01.6.2-02
        spares_target: resolveWarmFloorForRecord(),
        max_instances: resolveCeilingForRecord(),
        base_port: resolveBasePort(),
        poll_ms: pollMs,
        dry_run: args.dryRun,
    };
    writeBrokerRecordFile(args.stateDir, record);
    process.stderr.write(`vice-broker: wrote ${finalPath} (node ${record.node_version}); control listener bound on ${listener.host}:${listener.port}\n`);
    const heartbeatMs = Number(process.env.VICE_BROKER_HEARTBEAT_MS) || 30000;
    setInterval(() => {
        // The refresh path goes through the SAME atomic tmp-then-rename choke
        // point as the initial write (writeBrokerRecordFile() itself), and the
        // mode is tightened to owner-read-write on EVERY write, refresh
        // included -- never only on the first.
        record = { ...record, heartbeat_at: new Date().toISOString() };
        writeBrokerRecordFile(args.stateDir, record);
    }, heartbeatMs);
    // The fixed-order evaluation pass (runBrokerPass, broker-launch.mts):
    // serve pending acquires, then maintain the warm floor -- mirroring
    // vice-broker.sh's own broker_once() ordering. Ticks on
    // VICE_BROKER_POLL_MS (default 500, the SAME env var name and semantics
    // the bash daemon used). serveAcquires now drains the arrival-ordered
    // pending-acquire structure this listener instance owns (D-08's
    // mechanism; plan 02's own `serveAcquires: () => {}` comment reserved
    // exactly this room) -- an acquire queued because a launch was already in
    // flight is retried here, on the SAME pass that also maintains the warm
    // floor, so a stalled pass shows up as a stale record rather than a
    // silently wrong one. Re-entrancy guarded: a pass that is still running
    // (e.g. a slow external VICE_BROKER_PROBE_CMD) is never overlapped by the
    // next tick.
    let passInFlight = false;
    setInterval(() => {
        if (passInFlight)
            return;
        passInFlight = true;
        runBrokerPass({
            serveAcquires: () => drainPendingAcquires(listener.pendingAcquires),
            maintainWarmFloor: () => maintainWarmFloorForRealBroker(args.stateDir, state),
        })
            .catch((e) => {
            process.stderr.write(`vice-broker: evaluation pass failed: ${e.message}\n`);
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
export function main(argv = process.argv.slice(2)) {
    let args;
    try {
        args = parseArgs(argv);
    }
    catch (e) {
        process.stderr.write(`${e.message}\n`);
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
        process.stderr.write(`vice-broker: ${e.message}\n`);
        process.exitCode = 1;
    });
}
// -------------------------------------------------------------------- CLI
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
