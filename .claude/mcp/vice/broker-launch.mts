// broker-launch.mts
//
// C (complete, plan 02): the single `in_flight` launch-guard owner (plan 01,
// unchanged -- every launch call site in the whole broker goes through
// tryLaunchOne(), which is what makes the single-owner guarantee mechanical
// rather than a convention plan 02's own concurrency race test can silently
// violate), PLUS the readiness probe's full three-way branch, serialised
// warm-floor maintenance (one launch per pass, never more), and the
// fixed-order evaluation pass both surviving concerns run through.
//
// Plan 03, Task 2 grows this module into a real per-child supervisor
// (C2/D-23), absorbing resources/vice-supervisor.sh wholesale: superviseChild()
// launches an instance through tryLaunchOne() (the SAME single guarded
// primitive above) and installs an exit handler on the spawned child that
// respawns on crash (doubling backoff, clamped at a ceiling), gives up
// cleanly after too many crashes inside a window, never respawns a
// deliberately-killed instance, and writes the per-instance boot/crash log
// D-23 preserves at the exact path shape the retiring bash supervisor used.
import { spawn as nodeSpawn, execFile, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync, closeSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { promisify } from "node:util";
// TYPE-ONLY import, deliberately -- this module must be importable and
// runnable directly (native Node type-stripping, no build step) by its own
// unit tests, exactly like every other host-bound module's test file
// already does. A VALUE import of broker-state's own exports (nextFreePort,
// countReady, countTotal, countLaunching) would need "./broker-state.mjs"
// to resolve at RUNTIME when this file is executed unbuilt -- and it
// cannot: that path only exists once `tsc` compiles both siblings into
// resources/. `import type` is fully erased under this project's
// verbatimModuleSyntax, so Node's native stripping never attempts to
// resolve it at all (verified empirically this task). The functions
// themselves are therefore REQUIRED, injected fields on
// MaintainWarmFloorDeps below -- vice-broker.mts (which already imports
// broker-state.mjs's real values for its own wiring) supplies the real
// ones; tests inject their own.
import type { BrokerState, InstanceRecord, PortAllocationResult } from "./broker-state.mjs";
// SAME type-only reasoning applies to broker-epoch.mts's own exports --
// superviseChild() below never imports epochPathFor/instanceLogDirFor/
// nextEpochFor/writeEpochRecord as VALUES (that would break this module's
// own unbuilt unit test the identical way a broker-state.mjs value import
// would); they are required, injected fields on SuperviseChildDeps
// (EpochWriterDeps) instead. Tests inject the REAL functions via a direct
// "./broker-epoch.mts" source import (safe -- test files reference the
// literal .mts extension, never the post-build .mjs specifier).
import type { EpochRecord } from "./broker-epoch.mjs";

const execFileAsync = promisify(execFile);

// Module-level: this file, not the caller, owns the single boolean --
// synchronous check, synchronous set, released in a finally, with no
// `await` between the check and the set.
let inFlight = false;

/** True while a launch is in progress -- exported for the race test plan 02
 * writes against two concurrent tryLaunchOne() calls. */
export function isLaunchInFlight(): boolean {
  return inFlight;
}

/** Resolves the emulator's own argument vector. Two shapes, matching
 * resources/vice-supervisor.sh's own VICE_ARGS convention exactly: if
 * VICE_ARGS is set in the environment (a single space-separated string,
 * fully overridable -- vice-supervisor.sh's own header comment), it is used
 * AS-IS; otherwise the MCP server flags are constructed the way the bash
 * launcher builds them -- the MCP server flag, the MCP server host from
 * VICE_BROKER_MCP_HOST (default 0.0.0.0), and the MCP server port set to
 * the allocated port. The override exists because this broker's own tests
 * (and an operator's manual dry runs) need to launch a stand-in binary
 * (e.g. /bin/sleep) that does not understand -mcpserver flags. */
export function buildViceArgs(port: number, { mcpHost, viceArgsEnv }: { mcpHost?: string; viceArgsEnv?: string } = {}): string[] {
  const rawViceArgs = viceArgsEnv ?? process.env.VICE_ARGS;
  if (typeof rawViceArgs === "string" && rawViceArgs.trim() !== "") {
    return rawViceArgs.trim().split(/\s+/);
  }
  const host = mcpHost ?? process.env.VICE_BROKER_MCP_HOST ?? "0.0.0.0";
  return ["-mcpserver", "-mcpserverhost", host, "-mcpserverport", String(port)];
}

export interface TryLaunchDeps {
  state: BrokerState;
  supervisorDir: string;
  epochFile: string;
  spawn?: (command: string, args: string[]) => ChildProcess;
  now?: () => number;
  viceBin?: string;
  mcpHost?: string;
  /** Overrides the resolved-command-line log line's destination -- default
   * writes to stderr exactly like before this field existed. Added (plan
   * 03) so superviseChild()'s own tests can capture "the resolved spawn
   * command line is logged before every spawn, including every respawn"
   * (T-jty-02's mitigation) without scraping process.stderr. */
  log?: (line: string) => void;
}

/** The unguarded spawn+record primitive -- no in_flight check here at all.
 * Called from exactly two places: tryLaunchOne() below (which wraps it in
 * the standalone synchronous guard) and acquirePortAndLaunch() further
 * down (which holds that SAME guard across its own async port-allocation
 * step first, then calls this directly so the guard is never
 * double-checked against itself). Spawns via deps.spawn (defaulting to
 * Node's own child_process.spawn), records the resolved binary path at
 * spawn time into the instance record's expectedIdentity field -- the
 * string the kill discipline (broker-kill.mts) checks identity against,
 * and the VICE_BIN binary this broker spawns directly, never any
 * intermediate script path. Logs the resolved command line before
 * spawning, so a bad configuration value is visible rather than silently
 * mis-parsed, exactly like the bash launcher's own logging discipline. */
function spawnAndRecordInstance(reason: string, port: number, deps: TryLaunchDeps): InstanceRecord {
  const spawnFn = deps.spawn ?? ((cmd: string, args: string[]) => nodeSpawn(cmd, args));
  const now = deps.now ?? ((): number => Date.now());
  const viceBin = deps.viceBin ?? process.env.VICE_BIN ?? "x64sc";
  const viceArgs = buildViceArgs(port, { mcpHost: deps.mcpHost });
  const log = deps.log ?? defaultLog;

  log(`vice-broker: launching ${viceBin} ${viceArgs.join(" ")}`);

  const child = spawnFn(viceBin, viceArgs);
  const record: InstanceRecord = {
    port,
    url: `http://127.0.0.1:${port}/mcp`,
    state: "launching",
    reason,
    epochFile: deps.epochFile,
    supervisorDir: deps.supervisorDir,
    pid: child.pid ?? null,
    expectedIdentity: viceBin,
    launchedAt: now(),
    readyAt: null,
    viceBin,
    viceArgs,
    dryRun: false,
  };
  deps.state.instances.set(port, record);
  return record;
}

/** The single in_flight owner, for a caller that ALREADY knows its port.
 * Fully SYNCHRONOUS by design -- no `await` anywhere between the guard
 * check and the guard release. This is what makes the single-owner
 * guarantee hold even under concurrent CALLERS: JS's run-to-completion
 * semantics mean two invocations of a synchronous function can never
 * interleave, regardless of how many async callers race to reach it. The
 * moment this function itself grows an internal `await` between the check
 * and the set, that guarantee is lost -- see broker-launch.test.ts's own
 * "discriminating power" regression check for a demonstration.
 *
 * This is the RIGHT primitive when the port is already decided and fixed
 * (most tests; any future caller with its own allocation scheme). It is
 * deliberately NOT what handleAcquire or maintainWarmFloor call for a
 * FRESH port, because nextFreePort() itself is asynchronous (a real
 * port-in-use probe requires it) -- see acquirePortAndLaunch()'s own
 * header comment for the race that creates and how it is closed. */
export function tryLaunchOne(reason: string, port: number, deps: TryLaunchDeps): InstanceRecord | null {
  if (inFlight) return null;
  inFlight = true;
  try {
    return spawnAndRecordInstance(reason, port, deps);
  } finally {
    inFlight = false;
  }
}

export interface AcquirePortAndLaunchDeps {
  state: BrokerState;
  stateDir: string;
  allocatePort: (state: BrokerState) => Promise<PortAllocationResult>;
  spawn?: (command: string, args: string[]) => ChildProcess;
  spawnFactory?: (port: number) => (command: string, args: string[]) => ChildProcess;
  now?: () => number;
  viceBin?: string;
  mcpHost?: string;
}

export type AcquireLaunchResult =
  | { ok: true; record: InstanceRecord }
  | { ok: false; reason: "launch_in_flight" | "no_free_port" };

/** Holds the SAME single in_flight owner across the ENTIRE
 * allocate-a-port-then-launch sequence -- not merely the synchronous spawn
 * instant tryLaunchOne() alone guards. This closes a genuine race window
 * tryLaunchOne() cannot: nextFreePort()'s own port-in-use probe is
 * asynchronous (plan 02, C4 -- a real bind-and-release check), so two
 * overlapping callers (a cold acquire arriving over the TCP control
 * listener at any moment, and a warm-floor pass on its own poll timer)
 * could otherwise BOTH be told the SAME candidate port is free before
 * either commits it to state.instances -- a double-launch on one port,
 * silently overwriting the earlier record. The guard is checked and set
 * SYNCHRONOUSLY before the first `await`, exactly like tryLaunchOne()'s
 * own discipline, so a second concurrent call is refused immediately
 * (`launch_in_flight`) rather than racing on the allocation.
 *
 * This is also the function that restores vice-broker.sh's own
 * process_requests() throttle (its `in_flight` local, checked before a
 * COLD launch, not only before a warm one): a cold acquire and a
 * warm-floor pass can never launch simultaneously, matching the bash
 * original's declined-to-change behaviour (RESEARCH.md §A1/§C) -- the
 * PRIORITY question (should a cold request preempt or queue ahead of a
 * warm one) is explicitly Phase 01.6.2.1's D-07, untouched here; this
 * function only says "one at a time," never "which one wins first." */
export async function acquirePortAndLaunch(reason: string, deps: AcquirePortAndLaunchDeps): Promise<AcquireLaunchResult> {
  if (inFlight) return { ok: false, reason: "launch_in_flight" };
  inFlight = true;
  try {
    const portResult = await deps.allocatePort(deps.state);
    if (!portResult.ok) {
      return { ok: false, reason: "no_free_port" };
    }
    const port = portResult.port;
    const supervisorDir = join(deps.stateDir, String(port));
    const epochFile = join(supervisorDir, "epoch.json");
    const spawn = deps.spawnFactory ? deps.spawnFactory(port) : deps.spawn;
    const record = spawnAndRecordInstance(reason, port, {
      state: deps.state,
      supervisorDir,
      epochFile,
      spawn,
      now: deps.now,
      viceBin: deps.viceBin,
      mcpHost: deps.mcpHost,
    });
    return { ok: true, record };
  } finally {
    inFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Readiness probe (D-05's permitted-route note applies throughout this
// section): this is HOST-SIDE broker code inspecting the emulator instance
// IT ITSELF spawned, on 127.0.0.1, as part of owning that instance's
// lifecycle -- exactly like vice-broker.sh's own probe_ready() does today.
// mcp__vice__*-only governs CONTAINER-SIDE code reaching the emulator; this
// is not that. No test in this module ever opens a real connection -- every
// probe test injects its own stub.
// ---------------------------------------------------------------------------

export type ProbeMechanism = "external_command" | "http" | "no_mechanism";

export interface ProbeOutcome {
  ready: boolean;
  mechanism: ProbeMechanism;
}

export interface ProbeDeps {
  /** Overrides VICE_BROKER_PROBE_CMD for this call -- test seam. */
  probeCmdEnv?: string;
  /** Overrides VICE_BROKER_PROBE_TIMEOUT_S for this call -- test seam. */
  probeTimeoutSEnv?: string;
  /** Runs the external probe command with the port as its OWN
   * argument-vector element -- never interpolated into a shell string
   * (T-01.6.2-11), matching vice-broker.sh's own no-injection care.
   * Defaults to a real execFile-based invocation. */
  runProbeCmd?: (cmd: string, port: number, timeoutMs: number) => Promise<boolean>;
  /** The HTTP readiness check. Defaults to a real POST against the
   * instance's own /mcp endpoint using the global fetch. Tests inject a
   * stub to control success/failure directly; pass `httpProbe: null`
   * (not simply omitted) to simulate vice-broker.sh's own degenerate
   * "neither VICE_BROKER_PROBE_CMD nor curl available" case -- there is
   * no equivalent "fetch is missing" condition in a real Node 24 process
   * (global fetch always exists), so this is the injectable stand-in for
   * that historical bash condition. */
  httpProbe?: ((port: number, timeoutMs: number) => Promise<boolean>) | null;
  log?: (line: string) => void;
}

const DEFAULT_PROBE_TIMEOUT_S = 5;

function defaultLog(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** Runs `cmd` with the port as a SEPARATE argv element -- e.g.
 * execFile("check-ready", ["6600"]), never execFile(`check-ready ${port}`)
 * or any shell-string interpolation -- so there is no injection surface
 * regardless of what the port value happens to be. Exit 0 means ready,
 * matching the bash version's own `"$VICE_BROKER_PROBE_CMD" "$port"`. */
async function defaultRunProbeCmd(cmd: string, port: number, timeoutMs: number): Promise<boolean> {
  try {
    await execFileAsync(cmd, [String(port)], { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/** A single POST of a tools/call for vice_ping at the instance's own URL,
 * bounded by the probe timeout -- matching the exact single-POST curl form
 * vice-broker.sh's own probe_ready() used. Treated as ready ONLY when the
 * response body carries BOTH the "version" and "machine" substrings a real
 * vice_ping reply contains; a bare TCP accept is explicitly not sufficient
 * (a C64 can accept a connection before it has finished booting). */
async function defaultHttpProbe(port: number, timeoutMs: number): Promise<boolean> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "vice_ping", arguments: {} },
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
      signal: controller.signal,
    });
    const text = await response.text();
    return text.includes("version") && text.includes("machine");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Which of the three branches probeReady() will take, WITHOUT actually
 * running the probe -- shared by probeReady() itself and maintainWarmFloor()
 * (which needs to know, once per pass, whether ANY mechanism exists at all,
 * separately from whether any individual instance's probe currently
 * succeeds). */
function resolveProbeMechanism(deps: ProbeDeps): ProbeMechanism {
  const probeCmd = deps.probeCmdEnv ?? process.env.VICE_BROKER_PROBE_CMD;
  if (typeof probeCmd === "string" && probeCmd !== "") return "external_command";
  if (deps.httpProbe === null) return "no_mechanism";
  if (deps.httpProbe !== undefined) return "http";
  if (typeof fetch === "function") return "http";
  return "no_mechanism";
}

/** The three-way branch, ported in order and in full (D-05's permitted-
 * route note; the exact seam RESEARCH.md names as one that must survive
 * unchanged in env var name, timeout var name and ordering):
 *
 * 1. VICE_BROKER_PROBE_CMD named -> run it, port as its own argv element.
 * 2. Otherwise -> an HTTP readiness POST requiring both substrings.
 * 3. Neither available -> report ready unconditionally, log why.
 *
 * Branch 3 exists because there is genuinely nothing else to check: a COLD
 * instance launched for an already-pending real request must eventually be
 * usable even on a host with no readiness mechanism at all -- refusing to
 * ever promote it would mean the host could never satisfy any request,
 * strictly worse than trusting the launch itself. maintainWarmFloor() below
 * treats this same condition very differently for NEW speculative
 * launches: it warms zero rather than guessing (see its own comment). */
export async function probeReady(port: number, deps: ProbeDeps = {}): Promise<ProbeOutcome> {
  const mechanism = resolveProbeMechanism(deps);
  const timeoutS = Number(deps.probeTimeoutSEnv ?? process.env.VICE_BROKER_PROBE_TIMEOUT_S) || DEFAULT_PROBE_TIMEOUT_S;
  const timeoutMs = timeoutS * 1000;
  const log = deps.log ?? defaultLog;

  if (mechanism === "external_command") {
    const probeCmd = (deps.probeCmdEnv ?? process.env.VICE_BROKER_PROBE_CMD) as string;
    const runProbeCmd = deps.runProbeCmd ?? defaultRunProbeCmd;
    const ready = await runProbeCmd(probeCmd, port, timeoutMs);
    return { ready, mechanism };
  }

  if (mechanism === "http") {
    const httpProbe = deps.httpProbe ?? defaultHttpProbe;
    const ready = await httpProbe(port, timeoutMs);
    return { ready, mechanism };
  }

  log(
    `vice-broker: no readiness probe available (VICE_BROKER_PROBE_CMD is unset and no HTTP mechanism is available) -- ` +
      `reporting port ${port} ready unconditionally; there is nothing else this probe could check`
  );
  return { ready: true, mechanism };
}

// ---------------------------------------------------------------------------
// Serialised warm-floor maintenance
// ---------------------------------------------------------------------------

function resolveWarmFloor(override?: number): number {
  if (typeof override === "number") return override;
  const raw = process.env.VICE_BROKER_SPARES;
  if (raw === undefined || raw === "") return 3;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 3;
}

function resolveCeiling(override?: number): number {
  if (typeof override === "number") return override;
  const raw = process.env.VICE_BROKER_MAX;
  if (raw === undefined || raw === "") return 16;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 16;
}

export interface MaintainWarmFloorDeps {
  state: BrokerState;
  /** Root state directory -- per-port supervisorDir/epochFile are derived
   * from this exactly like handleAcquire's own cold-launch path does. */
  stateDir: string;
  spawn?: (command: string, args: string[]) => ChildProcess;
  /** Alternative to `spawn` -- when both are given, spawnFactory wins.
   * Receives the ALLOCATED port directly (no need to parse it back out of
   * an argv array) so a caller can open a per-port log file BEFORE
   * spawning -- exactly what vice-broker.mts's real wiring needs for
   * D-23's forensic per-instance logs, mirroring handleAcquire's own
   * cold-launch path. */
  spawnFactory?: (port: number) => (command: string, args: string[]) => ChildProcess;
  now?: () => number;
  viceBin?: string;
  mcpHost?: string;
  /** Probes a PORT (not a full InstanceRecord) -- defaults to a thin call
   * into probeReady() above with no overrides. */
  probe?: (port: number) => Promise<ProbeOutcome>;
  /** VICE_BROKER_SPARES override -- default 3, UNCHANGED in this plan; the
   * default itself and the variable's name are both Phase 01.6.2.1's
   * criterion L. */
  warmFloor?: number;
  /** VICE_BROKER_MAX override -- default 16, untouched by this phase. */
  ceiling?: number;
  log?: (line: string) => void;
  /** REQUIRED, injected -- broker-state.mts's real nextFreePort()/
   * countReady()/countTotal()/countLaunching(), threaded in by the caller
   * rather than imported as values here (see this file's own header
   * comment on why: a runtime VALUE import of a sibling host-bound module
   * only resolves once both are compiled, which breaks this module's own
   * ability to run unbuilt under its unit tests). vice-broker.mts's real
   * wiring passes broker-state.mjs's actual exports; tests inject stubs. */
  allocatePort: (state: BrokerState) => Promise<PortAllocationResult>;
  countReady: (state: BrokerState) => number;
  countTotal: (state: BrokerState) => number;
  countLaunching: (state: BrokerState) => number;
  /** Called once, synchronously, right after a successful warm launch --
   * vice-broker.mts's real wiring hooks this to write the instance's
   * epoch.json (broker-epoch.mts), exactly like handleAcquire's cold path
   * already does. Kept as a callback rather than importing broker-epoch.mjs
   * directly here, for the same reason this module avoids importing
   * broker-state.mjs's values: this module's own tests run it unbuilt. */
  onLaunched?: (record: InstanceRecord) => void;
}

/** Promotes launching instances via probe, then -- unless no readiness
 * mechanism exists at all, or a launch is already in flight -- launches AT
 * MOST ONE instance toward the warm floor and returns. Never loops to reach
 * the floor in one call: reaching VICE_BROKER_SPARES this way costs one
 * additional CALL per spare instead of one call total, which is the exact
 * trade the 2026-08-01 outage made non-negotiable (three simultaneous
 * x64sc launches: one SEGV, one exit 1, one exit 0 at the identical spawn
 * second). `async`/`await` makes launching everything needed in one go
 * look free and idiomatic; it is actively dangerous here. DO NOT gather
 * several pending launches into a single concurrent await, and do not
 * "helpfully" loop this function internally until the floor is met.
 *
 * D-05's probe-live floor evaluation (count_ready() trusting probe-live
 * instances rather than a recorded `ready` state) is explicitly Phase
 * 01.6.2.1's criterion L, NOT this plan's -- countReady() here still
 * counts by RECORDED state, exactly like the bash original's count_ready()
 * before Decision 5.2. A reviewer must not mistake this for an oversight:
 * it is the declined-for-this-phase choice RESEARCH.md §A1 recommends, and
 * grant_from_spare()'s own live re-probe at GRANT time (broker-kill.mts /
 * plan 04's territory) is a separate, already-correct mechanism this plan
 * does not touch. */
export async function maintainWarmFloor(deps: MaintainWarmFloorDeps): Promise<void> {
  const log = deps.log ?? defaultLog;
  const now = deps.now ?? ((): number => Date.now());
  const probe = deps.probe ?? ((port: number) => probeReady(port));

  // Step 1: promote every "launching" instance whose probe now succeeds.
  // Runs regardless of whether a launch is in flight or a mechanism exists
  // at all -- see probeReady()'s own header comment for why an
  // ALREADY-launched cold instance still gets promoted (trust-the-launch)
  // even in the no-mechanism case; step 2 below treats that same condition
  // very differently for NEW speculative launches.
  for (const record of deps.state.instances.values()) {
    if (record.state !== "launching") continue;
    const outcome = await probe(record.port);
    if (outcome.ready) {
      const readyAt = now();
      const elapsedMs = readyAt - record.launchedAt;
      record.state = "ready";
      record.readyAt = readyAt;
      log(`vice-broker: port ${record.port} launching -> ready (${elapsedMs}ms)`);
    }
  }

  // Step 2: with no readiness mechanism whatsoever, warm ZERO speculative
  // spares and log exactly one line naming what is missing and the
  // consequence -- spares are a latency optimisation, never a correctness
  // requirement, so guessing here trades a real hazard for a marginal
  // latency win.
  const mechanism = resolveProbeMechanism({});
  if (mechanism === "no_mechanism") {
    log(
      "vice-broker: no readiness probe available (VICE_BROKER_PROBE_CMD is unset and no HTTP mechanism is available) -- " +
        "warming ZERO speculative spares; every acquisition will pay a cold launch until this is fixed " +
        "(set VICE_BROKER_PROBE_CMD to an executable readiness check)"
    );
    return;
  }

  // Step 3: no new boot starts while one is already under way -- THE
  // single in-flight counter (countLaunching) both this function and a
  // cold acquire (vice-broker.mts's handleAcquire) consult.
  if (deps.countLaunching(deps.state) > 0) {
    log("vice-broker: spare warming waits -- a boot is already in flight this pass");
    return;
  }

  const ready = deps.countReady(deps.state);
  const total = deps.countTotal(deps.state);
  const warmFloor = resolveWarmFloor(deps.warmFloor);
  const ceiling = resolveCeiling(deps.ceiling);

  if (!(ready < warmFloor && total < ceiling)) {
    return;
  }

  // acquirePortAndLaunch() holds the SAME single in_flight owner across
  // its own async port allocation -- not merely tryLaunchOne()'s
  // synchronous spawn instant. This is what actually closes the race
  // between this warm-floor launch and a cold acquire (vice-broker.mts's
  // handleAcquire) arriving over the TCP control listener at any moment:
  // the countLaunching() check just above is a cheap PRE-check (bails
  // early when a launch is already recorded), but nextFreePort() is
  // itself asynchronous, so without the guard held across the allocation
  // too, two overlapping callers could still both be told the same
  // candidate port is free before either commits it.
  const result = await acquirePortAndLaunch("spare", {
    state: deps.state,
    stateDir: deps.stateDir,
    allocatePort: deps.allocatePort,
    spawn: deps.spawn,
    spawnFactory: deps.spawnFactory,
    now: deps.now,
    viceBin: deps.viceBin,
    mcpHost: deps.mcpHost,
  });

  if (result.ok) {
    log(`vice-broker: warmed 1 spare this pass -- ${ready + 1} of ${warmFloor} ready, remainder warmed on later passes`);
    deps.onLaunched?.(result.record);
  } else if (result.reason === "no_free_port") {
    log(`vice-broker: no free port available -- warming no further spares; ${ready} of ${warmFloor} ready`);
  } else {
    // A launch started (cold or warm) between this function's own
    // countLaunching() check above and this call -- a narrow window
    // closed by the guard rather than assumed impossible.
    log("vice-broker: spare warming attempted but a launch was already in flight -- deferring to a later pass");
  }
}

// ---------------------------------------------------------------------------
// The fixed-order evaluation pass
// ---------------------------------------------------------------------------

export interface BrokerPassDeps {
  /** Serves pending acquires for this pass. Under this phase's TCP control
   * plane (plan 01), an acquire is already served immediately, per
   * connection, by vice-broker.mts's own onAcquire callback -- there is no
   * file-based request queue left to iterate (D-01). This concern stays a
   * named, orderable step (rather than being dropped) because plan 05 adds
   * the real arrival-ordered queue (D-08) here; until then it is a no-op
   * by construction, not a stub standing in for missing work. */
  serveAcquires: () => Promise<void> | void;
  maintainWarmFloor: () => Promise<void> | void;
}

/** The fixed pass order (mirrors vice-broker.sh's own broker_once(), whose
 * comment names the ordering as load-bearing: "the spare invariant is
 * always re-evaluated against the freshest possible grant/teardown
 * state"). The bash version's third concern, the grant sweep, does NOT
 * appear here -- it is one of criterion F's six retiring file-lease
 * mechanisms; the TCP connection itself is the lease (D-12). The
 * broker-instances.json projection write does not appear either, per D-24
 * (see broker-state.mts's own FINDING 2 comment). Takes plain callbacks
 * rather than the full BrokerState/deps shape so a test can inject two
 * instrumented no-op functions and assert call ORDER without needing a
 * real broker, a real port or a real launch. */
export async function runBrokerPass(deps: BrokerPassDeps): Promise<void> {
  await deps.serveAcquires();
  await deps.maintainWarmFloor();
}

// ===========================================================================
// Per-child supervision (Plan 03, Task 2 -- C2/D-23): absorbs
// resources/vice-supervisor.sh WHOLESALE. The respawn loop becomes an
// exit-event handler installed on the spawned child; the backoff shape
// (initial delay, doubling, ceiling), the crash-loop give-up (too many
// crashes inside a window), and the per-instance boot/crash log are ported
// exactly, per D-1's own configuration knobs -- VICE_RESTART_BACKOFF_S,
// VICE_RESTART_BACKOFF_MAX_S, VICE_MAX_RESTARTS, VICE_CRASH_WINDOW_S all
// keep their exact names and semantics.
// ===========================================================================

function resolveMs(envVar: string, defaultSeconds: number, override?: number): number {
  if (typeof override === "number") return override;
  const raw = process.env[envVar];
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return (Number.isFinite(n) ? n : defaultSeconds) * 1000;
}

function resolveCount(envVar: string, defaultValue: number, override?: number): number {
  if (typeof override === "number") return override;
  const raw = process.env[envVar];
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) ? n : defaultValue;
}

/** The four-value outcome vocabulary a single exit event resolves to --
 * exported so a caller (this module's own tests, and any future real-broker
 * wiring) can assert which branch a given crash took without inspecting
 * private state. */
export type RespawnOutcome = "respawned" | "deliberate_teardown" | "given_up" | "recycled";

/** broker-epoch.mts's own exports, injected rather than value-imported --
 * see this file's own header comment for why (the same unbuilt-test-import
 * constraint plan 02 already solved for broker-state.mts's exports). The
 * real broker wires broker-epoch.mjs's actual functions here; tests inject
 * broker-epoch.mts's REAL functions via a direct source import (safe for a
 * test file) or their own stubs. */
export interface EpochWriterDeps {
  epochPathFor: (stateDir: string, port: number) => string;
  instanceLogDirFor: (stateDir: string, port: number) => string;
  nextEpochFor: (supervisorDir: string) => number;
  writeEpochRecord: (opts: { supervisorDir: string; record: EpochRecord }) => string;
}

export interface SuperviseChildDeps {
  state: BrokerState;
  /** Root state directory -- per-port supervisorDir/epochFile/logDir are
   * all derived from this, exactly like every other launch path. */
  stateDir: string;
  epoch: EpochWriterDeps;
  spawn?: (command: string, args: string[]) => ChildProcess;
  spawnFactory?: (port: number) => (command: string, args: string[]) => ChildProcess;
  now?: () => number;
  /** Injected delay for the respawn backoff wait -- tests supply an
   * immediately-resolving stub so the backoff VALUES can be asserted
   * against the injected clock, never real wall time (this project's own
   * stack pattern: synchronise on injected time, never sleep()). */
  sleepMs?: (ms: number) => Promise<void>;
  viceBin?: string;
  mcpHost?: string;
  /** VICE_RESTART_BACKOFF_S override, in MILLISECONDS (the env var itself
   * stays seconds, matching the retiring supervisor exactly). */
  initialBackoffMs?: number;
  /** VICE_RESTART_BACKOFF_MAX_S override, in milliseconds. */
  maxBackoffMs?: number;
  /** VICE_MAX_RESTARTS override. */
  maxRestarts?: number;
  /** VICE_CRASH_WINDOW_S override, in milliseconds. */
  crashWindowMs?: number;
  log?: (line: string) => void;
  /** Test/observability hook -- fired once per exit event, after this
   * module has fully resolved the outcome (state already updated). Never
   * consulted for behaviour by this module itself. */
  onOutcome?: (outcome: RespawnOutcome, port: number) => void;
}

/** The exit-driven respawn step. Reads the JUST-crashed record (still in
 * state.instances -- nothing here deletes it before this runs), decides
 * among the four outcomes, and acts:
 *
 * - deliberateKill set AND respawnAfterKill set -> "recycled": a
 *   broker-ordered death that wants a replacement, relaunched on the SAME
 *   port through launchSupervised() -- but called DIRECTLY, bypassing every
 *   crash-accounting step below (no appended crash timestamp, no give-up
 *   evaluation, no backoff wait, no doubling): a deliberate recycle is not
 *   evidence of instability, and the crash-loop machinery exists for an
 *   UNEXPLAINED exit, not this one. The pre-kill crash history and backoff
 *   are carried forward UNCHANGED, and a pre-kill "granted" state is
 *   restored on the fresh record -- the relaunch primitive always creates a
 *   new record in the "launching" state, and leaving it there would let the
 *   warm floor's own ready-count numerator mistake a recycled session's own
 *   machine for an available spare.
 * - deliberateKill set WITHOUT respawnAfterKill -> "deliberate_teardown":
 *   drop the instance, no respawn. This is T-01.6.2-21's whole point --
 *   without reading this flag, every deliberate teardown would respawn
 *   exactly what it just killed, silently breaking kill-never-recycle (a
 *   released instance must be killed and stay gone).
 * - crash count (this instance's crash timestamps still inside the window,
 *   INCLUDING this one) at or above the configured maximum ->
 *   "given_up": drop the instance, log a line naming it and the count.
 *   Mirrors vice-supervisor.sh's own `>= VICE_MAX_RESTARTS` check exactly
 *   (T-01.6.2-20).
 * - otherwise -> "respawned": wait the CURRENT backoff (from the crashed
 *   record, so the doubling carries forward across respawns), then relaunch
 *   through launchSupervised() below -- the SAME tryLaunchOne() primitive
 *   plan 02 established, with the crash history and the NEXT (doubled,
 *   clamped) backoff threaded into the new record. */
async function handleExit(reason: string, port: number, deps: SuperviseChildDeps): Promise<void> {
  const record = deps.state.instances.get(port);
  if (!record) {
    // Already gone by some other path (e.g. a release that removed the
    // instance outright rather than merely marking it) -- nothing to do.
    return;
  }

  const log = deps.log ?? defaultLog;

  if (record.deliberateKill) {
    if (record.respawnAfterKill) {
      // Recycle. Capture the pre-kill state, crash history and backoff
      // BEFORE launchSupervised() replaces the map entry at this port key
      // with a brand new InstanceRecord -- nothing about those three facts
      // survives once that overwrite happens.
      const preKillState = record.state;
      const preKillCrashTimes = record.crashTimes ?? [];
      const preKillBackoffMs = record.backoffMs ?? resolveMs("VICE_RESTART_BACKOFF_S", 3, deps.initialBackoffMs);

      const respawned = launchSupervised(reason, port, deps, preKillCrashTimes, preKillBackoffMs);
      if (respawned && preKillState === "granted") {
        respawned.state = "granted";
      }
      deps.onOutcome?.("recycled", port);
      return;
    }
    deps.state.instances.delete(port);
    deps.onOutcome?.("deliberate_teardown", port);
    return;
  }

  const now = deps.now ?? ((): number => Date.now());
  const nowMs = now();
  const crashWindowMs = resolveMs("VICE_CRASH_WINDOW_S", 120, deps.crashWindowMs);
  const crashTimes = [...(record.crashTimes ?? []), nowMs].filter((t) => nowMs - t <= crashWindowMs);

  const maxRestarts = resolveCount("VICE_MAX_RESTARTS", 5, deps.maxRestarts);
  if (crashTimes.length >= maxRestarts) {
    log(
      `vice-broker: giving up on port ${port} after ${crashTimes.length} crashes within ${crashWindowMs}ms -- ` +
        `this is not a transient crash; check VICE_ARGS and whether the port is already bound`,
    );
    deps.state.instances.delete(port);
    deps.onOutcome?.("given_up", port);
    return;
  }

  const sleepMs = deps.sleepMs ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)));
  const currentBackoffMs = record.backoffMs ?? resolveMs("VICE_RESTART_BACKOFF_S", 3, deps.initialBackoffMs);
  await sleepMs(currentBackoffMs);

  const maxBackoffMs = resolveMs("VICE_RESTART_BACKOFF_MAX_S", 30, deps.maxBackoffMs);
  const nextBackoffMs = Math.min(currentBackoffMs * 2, maxBackoffMs);

  const respawned = launchSupervised(reason, port, deps, crashTimes, nextBackoffMs);
  deps.onOutcome?.(respawned ? "respawned" : "given_up", port);
}

/** The single exit-listener installation point in the whole module tree.
 * Wraps `baseSpawn` (a plain spawn function of the same shape
 * `(command, args) => ChildProcess` every launch path already threads
 * through) so the returned spawn function, when called, attaches a
 * one-shot "exit" listener that drives handleExit() above -- the SAME
 * respawn/give-up/deliberate-teardown resolution launchSupervised()'s own
 * relaunch path already uses. Returns the child object baseSpawn produced,
 * UNCHANGED -- a caller's own handle to the child (e.g. its pid) is never
 * replaced or wrapped itself; only the spawn FUNCTION is composed.
 *
 * This is the extraction the phase's own gap closure exists to make: before
 * this function existed, launchSupervised() built this exact listener
 * inline, and it was the ONLY place in the tree that ever did -- both real
 * launch paths in vice-broker.mts instead spawned through a bare,
 * unwrapped spawn with no exit observation at all. Composing a real launch
 * path's own spawn factory through THIS function, rather than reaching for
 * a second inline listener, is what keeps the "exactly one installation
 * point" invariant a structural gate (broker-launch.test.ts) can hold. */
export function withCrashSupervision(
  reason: string,
  port: number,
  baseSpawn: (command: string, args: string[]) => ChildProcess,
  deps: SuperviseChildDeps,
): (command: string, args: string[]) => ChildProcess {
  return (cmd: string, args: string[]): ChildProcess => {
    const child = baseSpawn(cmd, args);
    child.once("exit", () => {
      void handleExit(reason, port, deps);
    });
    return child;
  };
}

/** Launches (or relaunches) a supervised instance: spawns through
 * tryLaunchOne() (the SAME single guarded primitive plan 02 established --
 * "spawn again through the SAME single guarded launch function", never a
 * second, parallel spawn path), writes the per-instance boot/crash log at
 * the path shape the retiring supervisor used (a `logs/` directory under
 * the instance directory, named for the binary and a timestamp -- derived
 * from broker-epoch.mts's instanceLogDirFor so this file and the epoch
 * record's own `log` field can never disagree), bumps the epoch through
 * the epoch writer (broker-epoch.mts's nextEpochFor + writeEpochRecord),
 * and installs the exit handler that drives the NEXT crash's outcome.
 *
 * crashTimes/backoffMs are threaded through explicitly (not reset to
 * defaults) so a respawn's crash history and doubling backoff survive the
 * fact that spawnAndRecordInstance() creates a BRAND NEW InstanceRecord
 * object on every launch, replacing the old one at the same port key. */
function launchSupervised(
  reason: string,
  port: number,
  deps: SuperviseChildDeps,
  crashTimes: number[],
  backoffMs: number,
): InstanceRecord | null {
  const supervisorDir = join(deps.stateDir, String(port));
  const epochFile = deps.epoch.epochPathFor(deps.stateDir, port);
  const logDir = deps.epoch.instanceLogDirFor(deps.stateDir, port);
  mkdirSync(logDir, { recursive: true });

  const epoch = deps.epoch.nextEpochFor(supervisorDir);
  const viceBin = deps.viceBin ?? process.env.VICE_BIN ?? "x64sc";
  // Timestamp PLUS the epoch number: Date.now() alone can collide across
  // two respawns inside the same millisecond when the injected sleepMs
  // resolves immediately (exactly what this module's own tests do to stay
  // fast and deterministic) -- the epoch, guaranteed strictly increasing
  // per instance, makes every respawn's log filename distinct regardless
  // of wall-clock resolution.
  const logFileName = `${basename(viceBin)}-${Date.now()}-e${epoch}.log`;
  const logPath = join(logDir, logFileName);
  const logRelPath = `logs/${logFileName}`;

  const defaultRealSpawn = (cmd: string, args: string[]): ChildProcess => {
    const fd = openSync(logPath, "a");
    return nodeSpawn(cmd, args, { stdio: ["ignore", fd, fd] });
  };
  const baseSpawn = deps.spawnFactory ? deps.spawnFactory(port) : (deps.spawn ?? defaultRealSpawn);
  const wrappedSpawn = withCrashSupervision(reason, port, baseSpawn, deps);

  const record = tryLaunchOne(reason, port, {
    state: deps.state,
    supervisorDir,
    epochFile,
    spawn: wrappedSpawn,
    now: deps.now,
    viceBin: deps.viceBin,
    mcpHost: deps.mcpHost,
    log: deps.log,
  });
  if (!record) return null;

  // The log file's EXISTENCE and the epoch record's `log` field naming it
  // must never disagree, regardless of which spawn implementation actually
  // produced output -- a test-injected stub child never writes through
  // defaultRealSpawn's own fd, so this touches the file into existence
  // when nothing else has.
  if (!existsSync(logPath)) {
    closeSync(openSync(logPath, "a"));
  }

  record.epoch = epoch;
  record.deliberateKill = false;
  record.crashTimes = crashTimes;
  record.backoffMs = backoffMs;
  record.logPath = logPath;

  deps.epoch.writeEpochRecord({
    supervisorDir,
    record: {
      epoch,
      spawned_at: new Date(record.launchedAt).toISOString(),
      pid: record.pid as number,
      supervisor_pid: process.pid,
      vice_bin: record.viceBin,
      vice_args: record.viceArgs,
      log: logRelPath,
      dry_run: false,
    },
  });

  return record;
}

/** The public entry point: launches a NEW instance under full supervision
 * (crash respawn with backoff, crash-loop give-up, kill-never-recycle via
 * the deliberate-kill marker, and the per-instance boot/crash log), exactly
 * mirroring resources/vice-supervisor.sh's own respawn loop but expressed
 * as an event-loop exit handler instead of a `while true` poll. */
export function superviseChild(reason: string, port: number, deps: SuperviseChildDeps): InstanceRecord | null {
  const initialBackoffMs = resolveMs("VICE_RESTART_BACKOFF_S", 3, deps.initialBackoffMs);
  return launchSupervised(reason, port, deps, [], initialBackoffMs);
}
