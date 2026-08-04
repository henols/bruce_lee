// broker-kill.test.ts
//
// Plan 04 (01.6.2): broker-kill.mts's own test file. Task 1 (above) proved
// the identity-verified kill discipline's corrected expected-identity
// parameterisation and its four-word stage contract. This section (Task 2)
// adds shutdown()/registerShutdownHandlers()/startupBanner() -- every
// catchable shutdown path converging on one re-entrant-safe teardown. Task 3
// (the startup reap) extends this file further below. Every kill and signal
// test here is driven against a real spawned stub child (/bin/sleep,
// /bin/cat) or a fully injected fake -- never a real emulator, and no test
// opens a connection to the host VICE.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn as realSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { verifiedKill, shutdown, registerShutdownHandlers, startupBanner, _HANDLED_SIGNALS, type KillStage, type VerifiedKillDeps, type ShutdownDeps } from "./broker-kill.mts";
import { createBrokerState, _snapshotState, type BrokerState, type InstanceRecord } from "./broker-state.mts";
import { build } from "./build.ts";
import { acquireOverControlPlane } from "./vice-broker-client.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const BROKER_ARTIFACT = join(HERE, "resources", "vice-broker.mjs");

/** Poll `predicate` to a bounded deadline rather than sleeping a fixed
 * duration -- this project's own stack pattern (checkpoint/frame
 * synchronisation, never wall-clock delay), matching host-scripts.test.ts's
 * and broker-launch.test.ts's own waitFor() idiom exactly. */
async function waitFor<T>(
  predicate: () => T | null | undefined,
  { timeoutMs = 8000, pollMs = 20 }: { timeoutMs?: number; pollMs?: number } = {},
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killIfAlive(pid: number | undefined): void {
  if (typeof pid !== "number") return;
  if (isAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

function makeInstance(overrides: Partial<InstanceRecord> = {}): InstanceRecord {
  return {
    port: 6600,
    url: "http://127.0.0.1:6600/mcp",
    state: "granted",
    reason: "acquire",
    epochFile: "/tmp/epoch.json",
    supervisorDir: "/tmp/6600",
    pid: null,
    expectedIdentity: "x64sc",
    launchedAt: 0,
    readyAt: null,
    viceBin: "x64sc",
    viceArgs: [],
    dryRun: false,
    ...overrides,
  };
}

// ============================================================================
// Task 1: verifiedKill() -- the corrected, parameterised identity check and
// the four-word stage contract.
// ============================================================================

test("verifiedKill: an already-exited pid returns 'already_exited' without ever signalling", async () => {
  const killCalls: Array<[number, NodeJS.Signals]> = [];
  const deps: VerifiedKillDeps = {
    isAlive: () => false,
    kill: (pid, signal) => killCalls.push([pid, signal]),
  };
  const stage = await verifiedKill({ pid: 999999, expectedIdentity: "x64sc", deps });
  assert.equal(stage, "already_exited");
  assert.deepEqual(killCalls, [], "no signal must ever be sent to a pid already reported dead");
});

test("verifiedKill: a null pid returns 'already_exited' without ever signalling", async () => {
  const killCalls: unknown[] = [];
  const stage = await verifiedKill({ pid: null, expectedIdentity: "x64sc", deps: { kill: () => killCalls.push(1) } });
  assert.equal(stage, "already_exited");
  assert.deepEqual(killCalls, []);
});

test("verifiedKill: a live pid whose own argument string does not contain the recorded expected identity is refused, never signalled, and remains alive", async () => {
  const child = realSpawn("/bin/sleep", ["300"]);
  const pid = child.pid;
  assert.ok(typeof pid === "number");
  try {
    await waitFor(() => isAlive(pid));
    const stage = await verifiedKill({ pid, expectedIdentity: "/definitely/not/the/real/binary" });
    assert.equal(stage, "identity_refused");
    assert.ok(isAlive(pid), "a pid failing the identity check must be left alive -- a test only checking the stage word is not enough");
  } finally {
    killIfAlive(pid);
  }
});

test("verifiedKill: a live pid whose own argument string contains the recorded expected identity is terminated and returns 'sigterm', gone within the poll deadline", async () => {
  const child = realSpawn("/bin/sleep", ["300"]);
  const pid = child.pid;
  assert.ok(typeof pid === "number");
  try {
    await waitFor(() => isAlive(pid));
    const stage = await verifiedKill({ pid, expectedIdentity: "/bin/sleep" });
    assert.equal(stage, "sigterm");
    const gone = await waitFor(() => !isAlive(pid));
    assert.ok(gone, "a genuine identity match must actually terminate the process");
  } finally {
    killIfAlive(pid);
  }
});

test("verifiedKill: the expected identity is a parameter, not a module constant -- two different real binaries each match only their own recorded identity", async () => {
  const sleepChild = realSpawn("/bin/sleep", ["300"]);
  const catChild = realSpawn("/bin/cat", []); // stdin is an unconnected pipe by default -- never sees EOF, so cat blocks indefinitely
  const sleepPid = sleepChild.pid;
  const catPid = catChild.pid;
  assert.ok(typeof sleepPid === "number");
  assert.ok(typeof catPid === "number");
  try {
    await waitFor(() => isAlive(sleepPid));
    await waitFor(() => isAlive(catPid));

    const sleepStage = await verifiedKill({ pid: sleepPid, expectedIdentity: "/bin/sleep" });
    const catStage = await verifiedKill({ pid: catPid, expectedIdentity: "/bin/cat" });

    assert.equal(sleepStage, "sigterm", "the sleep pid must match its OWN recorded identity");
    assert.equal(catStage, "sigterm", "the cat pid must match its OWN, DIFFERENT recorded identity -- proving the check is parameterised per call, never a shared constant");
  } finally {
    killIfAlive(sleepPid);
    killIfAlive(catPid);
  }
});

test("structural: broker-kill.mts assigns no module-scope identity-expectation constant -- expectedIdentity always arrives as a parameter", () => {
  const source = readFileSync(join(HERE, "broker-kill.mts"), "utf8");
  // Matches a TOP-LEVEL (not indented, i.e. not inside a function body)
  // `const`/`export const` whose name mentions identity/expectation and
  // whose initialiser is a string literal -- exactly the shape the bash
  // original's $SUPERVISOR_SCRIPT constant would take if it were carried
  // forward uncorrected into this module.
  const offendingConstant = /^(?:export\s+)?const\s+\w*(?:[Ii]dentity|[Ee]xpectation)\w*\s*=\s*["'`]/m;
  assert.equal(offendingConstant.test(source), false, "no top-level string-literal identity/expectation constant may exist -- the expected identity must always be a caller-supplied parameter");
});

test("verifiedKill: the escalation poll interval is 200ms and the wait bound is read from the injected kill-wait override, asserted against an injected clock", async () => {
  const killCalls: NodeJS.Signals[] = [];
  const sleepCalls: number[] = [];
  const deps: VerifiedKillDeps = {
    isAlive: () => true, // never exits on its own -- forces the full escalation
    readProcessArgs: () => "x64sc", // must pass the identity check to reach the escalation logic at all
    kill: (_pid, signal) => killCalls.push(signal),
    sleepMs: (ms) => {
      sleepCalls.push(ms);
      return Promise.resolve();
    },
    killWaitS: 0.5, // limitMs = 500 -> 3 polls of 200ms (0, 200, 400) then escalate at 600
  };
  const stage = await verifiedKill({ pid: 4242, expectedIdentity: "x64sc", deps });
  assert.equal(stage, "sigkill");
  assert.deepEqual(killCalls, ["SIGTERM", "SIGKILL"]);
  assert.deepEqual(sleepCalls, [200, 200, 200], "every poll interval must be exactly 200ms");
});

test("verifiedKill: killWaitS defaults to 5 seconds when neither the deps override nor VICE_BROKER_KILL_WAIT_S is set", async () => {
  const originalEnv = process.env.VICE_BROKER_KILL_WAIT_S;
  delete process.env.VICE_BROKER_KILL_WAIT_S;
  try {
    const sleepCalls: number[] = [];
    const stage = await verifiedKill({
      pid: 4242,
      expectedIdentity: "x64sc",
      deps: {
        isAlive: () => true,
        readProcessArgs: () => "x64sc",
        kill: () => {},
        sleepMs: (ms) => {
          sleepCalls.push(ms);
          return Promise.resolve();
        },
      },
    });
    assert.equal(stage, "sigkill");
    // 5000ms / 200ms = 25 polls before the 25th check (waitedMs=5000) escalates.
    assert.equal(sleepCalls.length, 25);
  } finally {
    if (originalEnv === undefined) delete process.env.VICE_BROKER_KILL_WAIT_S;
    else process.env.VICE_BROKER_KILL_WAIT_S = originalEnv;
  }
});

test("structural: the module's KillStage vocabulary is exactly the four words vice-proxy.ts's recycle-ack consumer switches on", () => {
  const killMts = readFileSync(join(HERE, "broker-kill.mts"), "utf8");
  const killStageMatch = /export type KillStage = ([^;]+);/.exec(killMts);
  assert.ok(killStageMatch, "broker-kill.mts must export a KillStage type alias");
  const stageWords = killStageMatch![1]
    .split("|")
    .map((s) => s.trim().replace(/^"|"$/g, ""))
    .sort();
  assert.equal(stageWords.length, 4);
  assert.deepEqual(stageWords, ["already_exited", "identity_refused", "sigkill", "sigterm"]);

  const proxyTs = readFileSync(join(HERE, "vice-proxy.ts"), "utf8");
  for (const word of stageWords) {
    assert.ok(proxyTs.includes(`"${word}"`), `vice-proxy.ts must still reference stage word "${word}" -- a renamed/added stage word silently breaks its outcome renderer`);
  }
  assert.ok(proxyTs.includes('case "identity_refused":'), 'vice-proxy.ts must still switch on the literal "identity_refused" case');

  const successfulKillLine = proxyTs.split("\n").find((l) => l.includes("const successfulKill"));
  assert.ok(successfulKillLine, "vice-proxy.ts must still define successfulKill from kill_stage");
  const successfulWords = [...successfulKillLine!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(
    successfulWords,
    stageWords.filter((w) => w !== "identity_refused").sort(),
    "the 'successful kill' subset the consumer checks must be exactly the three non-refusal stage words",
  );
});

// ============================================================================
// Task 2: shutdown()/registerShutdownHandlers() -- every catchable path
// converges on one re-entrant-safe teardown; startupBanner(); and the
// structural guarantees (no uncatchable-signal handler, no background flag,
// no self-re-exec).
// ============================================================================

test("shutdown: sets the deliberate-kill marker on every instance BEFORE any signal reaches it, and removes every instance unconditionally -- including one whose kill returns identity_refused", async () => {
  const state = createBrokerState();
  state.instances.set(6600, makeInstance({ port: 6600, pid: 111 }));
  state.instances.set(6601, makeInstance({ port: 6601, pid: 222 }));

  const markerAtCallTime = new Map<number, boolean | undefined>();
  const deps: ShutdownDeps = {
    state,
    kill: async ({ pid }) => {
      const instance = Array.from(state.instances.values()).find((i) => i.pid === pid)!;
      markerAtCallTime.set(pid!, instance.deliberateKill);
      return pid === 111 ? "sigterm" : "identity_refused";
    },
  };

  await shutdown(deps);

  assert.equal(markerAtCallTime.get(111), true, "the deliberate-kill marker must already be true by the time the kill for THIS instance runs");
  assert.equal(markerAtCallTime.get(222), true, "the deliberate-kill marker must already be true for EVERY instance, not just the first killed");
  assert.equal(_snapshotState(state).instances.length, 0, "every instance must be removed unconditionally, whatever stage word its kill returned -- this IS kill-never-recycle");
});

test("shutdown: an instance with a null pid is still removed from the map (nothing to kill, but the record must not linger)", async () => {
  const state = createBrokerState();
  state.instances.set(6600, makeInstance({ port: 6600, pid: null }));
  await shutdown({ state, kill: async () => "already_exited" });
  assert.equal(_snapshotState(state).instances.length, 0);
});

test("registerShutdownHandlers: SIGTERM/SIGINT/SIGHUP each converge on shutdown() and are registered -- exactly the three OS signals, never the uncatchable kill/stop signals", () => {
  assert.deepEqual([..._HANDLED_SIGNALS].sort(), ["SIGHUP", "SIGINT", "SIGTERM"]);
  assert.ok(!_HANDLED_SIGNALS.includes("SIGKILL" as NodeJS.Signals), "SIGKILL is uncatchable -- registering a handler for it would be a no-op that misleadingly implies otherwise");
  assert.ok(!_HANDLED_SIGNALS.includes("SIGSTOP" as NodeJS.Signals), "SIGSTOP is uncatchable for the identical reason");
});

test("registerShutdownHandlers: an injected uncaught exception reaches the shutdown path and kills every child, asserted by a real zero-signal liveness check", async () => {
  const proc = new EventEmitter() as unknown as { once: EventEmitter["once"]; removeListener: EventEmitter["removeListener"]; exitCode?: number | null; emit: EventEmitter["emit"] };
  const child = realSpawn("/bin/sleep", ["300"]);
  const pid = child.pid!;
  const state = createBrokerState();
  state.instances.set(6600, makeInstance({ port: 6600, pid, expectedIdentity: "/bin/sleep" }));

  const cleanup = registerShutdownHandlers({ state, proc });
  try {
    await waitFor(() => isAlive(pid));
    (proc as unknown as EventEmitter).emit("uncaughtException", new Error("injected for this test"));
    const gone = await waitFor(() => !isAlive(pid));
    assert.ok(gone, "an uncaught exception must reach the same shutdown path and kill every child");
    // shutdown()'s own kill() (verifiedKill) polls at a real 200ms interval
    // before confirming death and settling its promise -- the child can be
    // observed dead (above) slightly before that promise resolves and
    // exit() runs, so poll for the exit code too rather than reading it
    // immediately.
    const exited = await waitFor(() => (proc.exitCode !== undefined && proc.exitCode !== null ? true : null));
    assert.ok(exited, "shutdown must settle and record an exit code");
    assert.equal(proc.exitCode, 1, "an exception path must exit non-zero");
  } finally {
    cleanup();
    killIfAlive(pid);
  }
});

test("registerShutdownHandlers: an injected unhandled rejection reaches the shutdown path and kills every child", async () => {
  const proc = new EventEmitter() as unknown as { once: EventEmitter["once"]; removeListener: EventEmitter["removeListener"]; exitCode?: number | null; emit: EventEmitter["emit"] };
  const child = realSpawn("/bin/sleep", ["300"]);
  const pid = child.pid!;
  const state = createBrokerState();
  state.instances.set(6600, makeInstance({ port: 6600, pid, expectedIdentity: "/bin/sleep" }));

  const cleanup = registerShutdownHandlers({ state, proc });
  try {
    await waitFor(() => isAlive(pid));
    (proc as unknown as EventEmitter).emit("unhandledRejection", new Error("injected for this test"));
    const gone = await waitFor(() => !isAlive(pid));
    assert.ok(gone, "an unhandled rejection must reach the same shutdown path and kill every child");
    const exited = await waitFor(() => (proc.exitCode !== undefined && proc.exitCode !== null ? true : null));
    assert.ok(exited, "shutdown must settle and record an exit code");
    assert.equal(proc.exitCode, 1);
  } finally {
    cleanup();
    killIfAlive(pid);
  }
});

test("registerShutdownHandlers: normal exit (the injected process-like 'exit' event) reaches the shutdown path", async () => {
  const proc = new EventEmitter() as unknown as { once: EventEmitter["once"]; removeListener: EventEmitter["removeListener"]; exitCode?: number | null; emit: EventEmitter["emit"] };
  const child = realSpawn("/bin/sleep", ["300"]);
  const pid = child.pid!;
  const state = createBrokerState();
  state.instances.set(6600, makeInstance({ port: 6600, pid, expectedIdentity: "/bin/sleep" }));

  const cleanup = registerShutdownHandlers({ state, proc });
  try {
    await waitFor(() => isAlive(pid));
    (proc as unknown as EventEmitter).emit("exit");
    const gone = await waitFor(() => !isAlive(pid));
    assert.ok(gone, "a normal exit must reach the same shutdown path");
  } finally {
    cleanup();
    killIfAlive(pid);
  }
});

test("registerShutdownHandlers: two signals delivered in quick succession produce exactly one shutdown run", async () => {
  const proc = new EventEmitter() as unknown as { once: EventEmitter["once"]; removeListener: EventEmitter["removeListener"]; exitCode?: number | null; emit: EventEmitter["emit"] };
  const state = createBrokerState();
  state.instances.set(6600, makeInstance({ port: 6600, pid: 111 }));

  let killAttempts = 0;
  const cleanup = registerShutdownHandlers({
    state,
    proc,
    kill: async () => {
      killAttempts++;
      return "sigterm";
    },
  });
  try {
    (proc as unknown as EventEmitter).emit("SIGTERM");
    (proc as unknown as EventEmitter).emit("SIGINT");
    await waitFor(() => killAttempts > 0);
    // Give any accidental second run a moment to have started, if the guard
    // were broken.
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(killAttempts, 1, "a second signal arriving while shutdown is already running must not start a second shutdown");
  } finally {
    cleanup();
  }
});

test("startupBanner: names the foreground lifetime, that every emulator launched is destroyed, and that a session whose broker dies is void", () => {
  const banner = startupBanner();
  assert.match(banner, /foreground/i);
  assert.match(banner, /terminate every emulator/i);
  assert.match(banner, /voids? every session|no.*reconnect/i);
});

test("structural: the real broker prints the banner before the control listener starts, and registers shutdown handling after the listener is up", () => {
  const source = readFileSync(join(HERE, "vice-broker.mts"), "utf8");
  const bannerIdx = source.indexOf("startupBanner()");
  const listenerIdx = source.indexOf("await startControlListener(");
  const registerIdx = source.indexOf("registerShutdownHandlers(");
  assert.ok(bannerIdx !== -1 && listenerIdx !== -1 && registerIdx !== -1);
  assert.ok(bannerIdx < listenerIdx, "the banner must print before the control listener starts");
  assert.ok(registerIdx > listenerIdx, "shutdown handling is registered once the listener is up");
});

test("structural: the broker's argument parser recognises exactly --repo-root, --state-dir, --check-container and --dry-run -- no flag for running in the background", () => {
  const source = readFileSync(join(HERE, "vice-broker.mts"), "utf8");
  const parseArgsMatch = /export function parseArgs\(argv: string\[\]\): ParsedArgs \{([\s\S]*?)\n\}/.exec(source);
  assert.ok(parseArgsMatch, "vice-broker.mts must export parseArgs()");
  const body = parseArgsMatch![1];
  const flags = [...body.matchAll(/argv\[i\] === "(--[a-z-]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(flags, ["--check-container", "--dry-run", "--repo-root", "--state-dir"]);
});

test("structural: the broker never re-executes itself -- no reference to its own executable path anywhere in vice-broker.mts", () => {
  const source = readFileSync(join(HERE, "vice-broker.mts"), "utf8");
  assert.ok(!source.includes("execPath"), "no self-spawn/re-exec construct (process.execPath or similar) may appear -- detaching stays the operator's own choice (D-25)");
});

test("structural: no clean-shutdown marker file is ever referenced in broker-kill.mts or vice-broker.mts", () => {
  const killMts = readFileSync(join(HERE, "broker-kill.mts"), "utf8");
  const brokerMts = readFileSync(join(HERE, "vice-broker.mts"), "utf8");
  const forbidden = /clean.shutdown.marker|was_clean|shutdown_marker/i;
  assert.equal(forbidden.test(killMts), false, "broker-kill.mts must not reference a clean-shutdown marker file");
  assert.equal(forbidden.test(brokerMts), false, "vice-broker.mts must not reference a clean-shutdown marker file");
});

// ---------------------------------------------------------------------------
// Real end-to-end shutdown: spawn the built broker artifact with a stub
// emulator binary, grant two instances over the real TCP control plane, then
// signal the broker itself (never a real emulator) and prove BOTH stub
// children are gone and the broker exits 0. Mirrors broker-e2e.test.ts's own
// startBroker()/waitForBrokerJson() idiom.
// ---------------------------------------------------------------------------

interface BrokerHandle {
  child: ReturnType<typeof realSpawn>;
  stateDir: string;
  stderr: string;
}

function startBroker(stateDir: string): BrokerHandle {
  const child = realSpawn(process.execPath, [BROKER_ARTIFACT, "--repo-root", "/tmp/fake-repo-root-kill", "--state-dir", stateDir], {
    env: {
      ...process.env,
      VICE_SUPERVISOR_ALLOW_CONTAINER: "1",
      VICE_BIN: "/bin/sleep",
      VICE_ARGS: "600",
      VICE_BROKER_CONTROL_PORT: "0",
    },
  });
  const handle: BrokerHandle = { child, stateDir, stderr: "" };
  child.stderr?.on("data", (chunk: Buffer) => {
    handle.stderr += chunk.toString("utf8");
  });
  return handle;
}

async function waitForBrokerJson(stateDir: string, deadlineMs = 5000): Promise<Record<string, unknown>> {
  const path = join(stateDir, "broker.json");
  const appeared = await waitFor(() => (existsSync(path) && typeof JSON.parse(readFileSync(path, "utf8")).control_port === "number" ? true : null), { timeoutMs: deadlineMs });
  assert.ok(appeared, "broker.json with a control_port did not appear within deadline");
  return JSON.parse(readFileSync(path, "utf8"));
}

function instancePidsUnder(stateDir: string): number[] {
  const portDirs = readdirSync(stateDir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d+$/.test(d.name));
  const pids: number[] = [];
  for (const d of portDirs) {
    const epochPath = join(stateDir, d.name, "epoch.json");
    if (!existsSync(epochPath)) continue;
    const rec = JSON.parse(readFileSync(epochPath, "utf8"));
    if (typeof rec.pid === "number") pids.push(rec.pid);
  }
  return pids;
}

for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  test(`end-to-end: a real ${sig} to the broker kills every stub child it launched and the broker exits 0`, { timeout: 20000 }, async () => {
    build();
    const stateDir = mkdtempSync(join(tmpdir(), `broker-kill-${sig}-`));
    const handle = startBroker(stateDir);
    try {
      await waitForBrokerJson(stateDir);
      const first = await acquireOverControlPlane(stateDir);
      const second = await acquireOverControlPlane(stateDir);

      const pids = await waitFor(() => {
        const found = instancePidsUnder(stateDir);
        return found.length === 2 ? found : null;
      });
      assert.ok(pids, `expected exactly two instance directories with recorded pids, stderr:\n${handle.stderr}`);
      assert.ok(pids!.every(isAlive), "both stub children must be alive before the signal");

      handle.child.kill(sig);

      const allGone = await waitFor(() => pids!.every((p) => !isAlive(p)));
      assert.ok(allGone, `both stub children must be gone after ${sig}, stderr:\n${handle.stderr}`);

      const exited = await waitFor(() => handle.child.exitCode !== null || handle.child.signalCode !== null);
      assert.ok(exited, "the broker itself must exit after handling the signal");
      assert.equal(handle.child.exitCode, 0, `a signal-triggered shutdown must be a clean exit, stderr:\n${handle.stderr}`);

      // Leave `first`/`second` unreleased deliberately -- shutdown() must
      // kill every instance regardless of grant state, not only released
      // ones. Referencing them keeps the linter/typechecker happy about
      // "declared but never read" without performing a release.
      void first;
      void second;
    } finally {
      if (handle.child.exitCode === null && handle.child.signalCode === null) {
        handle.child.kill("SIGKILL");
      }
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
}

test("end-to-end: the broker prints its start-time banner on stderr before broker.json (and therefore before the listener accepts)", { timeout: 20000 }, async () => {
  build();
  const stateDir = mkdtempSync(join(tmpdir(), "broker-kill-banner-"));
  const handle = startBroker(stateDir);
  try {
    await waitForBrokerJson(stateDir);
    assert.match(handle.stderr, /foreground/i);
    assert.match(handle.stderr, /terminate every emulator/i);
    const bannerIdx = handle.stderr.search(/foreground/i);
    const listenerBoundIdx = handle.stderr.indexOf("control listener bound");
    assert.ok(bannerIdx !== -1 && listenerBoundIdx !== -1);
    assert.ok(bannerIdx < listenerBoundIdx, "the banner must appear before the control-listener-bound log line");
  } finally {
    if (handle.child.exitCode === null && handle.child.signalCode === null) {
      handle.child.kill("SIGKILL");
    }
    rmSync(stateDir, { recursive: true, force: true });
  }
});
