// broker-launch.mts
//
// C (complete, plan 02): the single `in_flight` launch-guard owner (plan 01,
// unchanged -- every launch call site in the whole broker goes through
// tryLaunchOne(), which is what makes the single-owner guarantee mechanical
// rather than a convention plan 02's own concurrency race test can silently
// violate), PLUS the readiness probe's full three-way branch, serialised
// warm-floor maintenance (one launch per pass, never more), and the
// fixed-order evaluation pass both surviving concerns run through.
import { spawn as nodeSpawn, execFile, type ChildProcess } from "node:child_process";
import { join } from "node:path";
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
}

/** The single in_flight owner. Spawns via deps.spawn (defaulting to Node's
 * own child_process.spawn), records the resolved binary path at spawn time
 * into the instance record's expectedIdentity field -- the string the kill
 * discipline (broker-kill.mts) checks identity against, and the VICE_BIN
 * binary this broker spawns directly, never any intermediate script path.
 * Logs the resolved command line before spawning, so a bad configuration
 * value is visible rather than silently mis-parsed, exactly like the bash
 * launcher's own logging discipline.
 *
 * Fully SYNCHRONOUS by design -- no `await` anywhere between the guard
 * check and the guard release. This is what makes the single-owner
 * guarantee hold even under concurrent CALLERS: JS's run-to-completion
 * semantics mean two invocations of a synchronous function can never
 * interleave, regardless of how many async callers race to reach it. The
 * moment this function itself grows an internal `await` between the check
 * and the set, that guarantee is lost -- see broker-launch.test.ts's own
 * "discriminating power" regression check for a demonstration. */
export function tryLaunchOne(reason: string, port: number, deps: TryLaunchDeps): InstanceRecord | null {
  if (inFlight) return null;
  inFlight = true;
  try {
    const spawnFn = deps.spawn ?? ((cmd: string, args: string[]) => nodeSpawn(cmd, args));
    const now = deps.now ?? ((): number => Date.now());
    const viceBin = deps.viceBin ?? process.env.VICE_BIN ?? "x64sc";
    const viceArgs = buildViceArgs(port, { mcpHost: deps.mcpHost });

    process.stderr.write(`vice-broker: launching ${viceBin} ${viceArgs.join(" ")}\n`);

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

  const portResult = await deps.allocatePort(deps.state);
  if (!portResult.ok) {
    log(`vice-broker: no free port available -- warming no further spares; ${ready} of ${warmFloor} ready`);
    return;
  }
  const port = portResult.port;
  const supervisorDir = join(deps.stateDir, String(port));
  const epochFile = join(supervisorDir, "epoch.json");

  const spawn = deps.spawnFactory ? deps.spawnFactory(port) : deps.spawn;
  const record = tryLaunchOne("spare", port, {
    state: deps.state,
    supervisorDir,
    epochFile,
    spawn,
    now: deps.now,
    viceBin: deps.viceBin,
    mcpHost: deps.mcpHost,
  });

  if (record) {
    log(`vice-broker: warmed 1 spare this pass -- ${ready + 1} of ${warmFloor} ready, remainder warmed on later passes`);
    deps.onLaunched?.(record);
  } else {
    // Should not happen given the countLaunching() check above (this is
    // the only other launch path this function itself starts within one
    // call) -- guarded defensively rather than assumed.
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
