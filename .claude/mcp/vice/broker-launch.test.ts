// broker-launch.test.ts
//
// Plan 02, Task 2: broker-launch.mts completed -- the readiness probe's
// three-way branch, serialised warm-floor maintenance (one launch per
// pass), and the fixed-order evaluation pass. Task 3 adds this file's
// concurrency race test (the required deliverable criterion C names)
// alongside these fixtures rather than duplicating them.
//
// Every launch/probe test uses the injected spawn/probe seam with a stub;
// no real x64sc runs anywhere in this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync, existsSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn as realSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

import { HOST_BOUND_ARTIFACTS } from "./build.ts";
import {
  createBrokerState,
  countReady as realCountReady,
  countTotal as realCountTotal,
  countLaunching as realCountLaunching,
  type BrokerState,
  type InstanceRecord,
  type PortAllocationResult,
} from "./broker-state.mts";
import {
  tryLaunchOne,
  isLaunchInFlight,
  probeReady,
  maintainWarmFloor,
  runBrokerPass,
  acquirePortAndLaunch,
  superviseChild,
  withCrashSupervision,
} from "./broker-launch.mts";
// Direct SOURCE import (".mts", not ".mjs") -- safe for a test file, which
// always references the literal extension the file is actually saved
// under, regardless of the same-module-to-sibling-module ".mjs"-only
// constraint superviseChild() itself is subject to (see broker-launch.mts's
// own header comment). These are the REAL broker-epoch.mts functions,
// injected into superviseChild()'s EpochWriterDeps below exactly like
// vice-broker.mts's real wiring will eventually inject them.
import { epochPathFor, instanceLogDirFor, nextEpochFor, writeEpochRecord } from "./broker-epoch.mts";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Poll `predicate` to a bounded deadline rather than sleeping a fixed
 * duration -- this project's own stack pattern (checkpoint/frame
 * synchronisation, never wall-clock delay), reused here for "wait for an
 * async respawn chain to reach an observable state" the same way
 * host-scripts.test.ts's own waitFor() is used for a real spawned child. */
async function waitFor<T>(
  predicate: () => T | null | undefined,
  { timeoutMs = 8000, pollMs = 10 }: { timeoutMs?: number; pollMs?: number } = {},
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}

function makeEpochDeps() {
  return { epochPathFor, instanceLogDirFor, nextEpochFor, writeEpochRecord };
}

/** A fully-controlled stand-in ChildProcess for the deterministic
 * backoff/crash-window/give-up tests below: a real EventEmitter (so
 * superviseChild()'s own `child.once("exit", ...)` wiring works exactly as
 * it would against a real ChildProcess), with a FAKE pid and no real OS
 * process behind it at all -- the test itself decides exactly when this
 * "child" exits by calling `.emit("exit", ...)` on it, giving the precise
 * ordering control the backoff-sequence and crash-window-exclusion
 * assertions need. Real subprocesses (`/bin/true`, `/bin/sleep`) are used
 * instead, per host-scripts.test.ts's own idiom, wherever a REAL pid is the
 * point (the "no orphaned child" liveness check; the plain
 * exits-on-its-own case). */
let fakePidCounter = 90000;
function fakeChild(): ChildProcess {
  const emitter = new EventEmitter();
  (emitter as unknown as { pid: number }).pid = fakePidCounter++;
  return emitter as unknown as ChildProcess;
}

function stubChild(pid = 4242): ChildProcess {
  return { pid } as unknown as ChildProcess;
}

// ---------------------------------------------------------- structural

test("structural: only tryLaunchOne() ever adds an instance record to state.instances -- the single guarded function every launch call site must route through", () => {
  // Enumerated from the build's OWN artifact set (build.ts's
  // HOST_BOUND_ARTIFACTS), never a hand-maintained list of source files --
  // a new host-bound module added later is covered automatically.
  assert.ok(HOST_BOUND_ARTIFACTS.length >= 2, "host-bound artifact set enumerated as suspiciously small -- resolution is broken");

  for (const rel of HOST_BOUND_ARTIFACTS) {
    const sourceRel = rel.replace(/\.mjs$/, ".mts");
    const text = readFileSync(join(HERE, sourceRel), "utf8");
    const matches = text.match(/\.instances\.set\(/g) ?? [];
    if (sourceRel === "broker-launch.mts") {
      assert.equal(matches.length, 1, `broker-launch.mts must register exactly one instance record (inside tryLaunchOne() itself); found ${matches.length}`);
    } else {
      assert.equal(matches.length, 0, `${sourceRel} must not register an instance record directly -- every launch must route through tryLaunchOne()`);
    }
  }
});

// 01.6.2-12-PLAN.md, Task 3: strips BOTH `/* ... */` (including JSDoc
// `/** ... */`) block comments AND whole `//` comment lines before any of
// this file's own count-based structural assertions run. A naive
// line-anchored `^\s*//` strip alone (this project's own established
// idiom elsewhere) is NOT enough here: a `/** ... */` doc comment that
// happens to mention the counted token inline (e.g. a header comment
// explaining "the wrapper this file uses is withCrashSupervision()") is
// invisible to that filter and silently inflates the count -- a real
// instance of exactly this trap was found and fixed while writing this
// task's own gate (see this task's own findings-log entry). Only whole
// `//` comment LINES are stripped (never a trailing inline "// ..." after
// real code on the same line) so a string literal containing "//" (e.g.
// this file's own "http://127.0.0.1:<port>/mcp" URL construction) is never
// truncated mid-line.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

// ===========================================================================
// 01.6.2-12-PLAN.md, Task 3: the structural anti-regression gate. Promotes
// 01.6.2-VERIFICATION.md's own diagnostic grep (a zero-hit search for
// superviseChild/withCrashSupervision in the real broker entry point) from a
// one-off finding into a standing test: an unwrapped spawn factory added to
// EITHER real launch path in vice-broker.mts must fail this test, not ship
// silently the way CR-01 did the first time.
// ===========================================================================

test("structural: broker-launch.mts's child exit listener is installed in exactly one place, and vice-broker.mts's spawn-factory count equals its withCrashSupervision call-site count, importing the wrapper by name", () => {
  const launchSource = stripComments(readFileSync(join(HERE, "broker-launch.mts"), "utf8"));
  const brokerSource = stripComments(readFileSync(join(HERE, "vice-broker.mts"), "utf8"));

  // Assertion 1: the child exit listener exists in exactly ONE place in the
  // whole supervision module -- inside withCrashSupervision() itself. Two
  // installation points (e.g. a regressed inline copy alongside the shared
  // wrapper) is the same shape of hazard this whole gap closure exists to
  // remove, one level down.
  const exitListenerCount = (launchSource.match(/\.once\("exit"/g) ?? []).length;
  assert.equal(
    exitListenerCount,
    1,
    `assertion 1 (exit-listener installation count) FAILED: expected exactly 1 comment-stripped '.once("exit"' call in broker-launch.mts, found ${exitListenerCount} -- the child exit listener must be installed in exactly ONE place in the whole module tree`,
  );

  // Assertion 2: the real broker entry point's spawn-factory count must
  // equal its supervision-wrapper call-site count. This is the load-bearing
  // check -- a third spawnFactory added to a future launch path without a
  // matching withCrashSupervision() composition changes this equality and
  // fails HERE, rather than shipping an unsupervised launch path silently.
  const spawnFactoryCount = (brokerSource.match(/\bspawnFactory:/g) ?? []).length;
  const wrapperCallSiteCount = (brokerSource.match(/\bwithCrashSupervision\(/g) ?? []).length;
  assert.ok(spawnFactoryCount > 0, "assertion 2 setup FAILED: found zero spawnFactory properties in vice-broker.mts -- the equality check below would pass vacuously against a broker with no launch paths at all");
  assert.equal(
    spawnFactoryCount,
    wrapperCallSiteCount,
    `assertion 2 (spawn-factory count vs supervision-wrapper call-site count) FAILED: vice-broker.mts declares ${spawnFactoryCount} comment-stripped spawnFactory propert${spawnFactoryCount === 1 ? "y" : "ies"} but composes through withCrashSupervision( at only ${wrapperCallSiteCount} comment-stripped call site${wrapperCallSiteCount === 1 ? "" : "s"} -- every real launch path's spawn factory must be wrapped by the shared supervision primitive`,
  );

  // Assertion 3: the real broker entry point must import the wrapper BY
  // NAME from the supervision module -- a differently-named local
  // re-implementation could satisfy assertion 2's raw count without ever
  // being the shared, unit-tested wrapper.
  const importsWrapperByName = /import\s*\{[^}]*\bwithCrashSupervision\b[^}]*\}\s*from\s*["']\.\/broker-launch\.mjs["']/.test(brokerSource);
  assert.ok(importsWrapperByName, "assertion 3 (import by name) FAILED: vice-broker.mts must import withCrashSupervision by name from ./broker-launch.mjs");
});

function makeInstance(overrides: Partial<InstanceRecord> = {}): InstanceRecord {
  return {
    port: 6600,
    url: "http://127.0.0.1:6600/mcp",
    state: "launching",
    reason: "acquire",
    epochFile: "/tmp/epoch.json",
    supervisorDir: "/tmp/6600",
    pid: 4242,
    expectedIdentity: "x64sc",
    launchedAt: 0,
    readyAt: null,
    viceBin: "x64sc",
    viceArgs: [],
    dryRun: false,
    ...overrides,
  };
}

// -------------------------------------------------------------- tryLaunchOne

test("tryLaunchOne: records a launching instance and returns it, spawning exactly once", () => {
  const state = createBrokerState();
  let spawnCount = 0;
  const record = tryLaunchOne("acquire", 6600, {
    state,
    supervisorDir: "/tmp/6600",
    epochFile: "/tmp/6600/epoch.json",
    spawn: (cmd, args) => {
      spawnCount++;
      assert.equal(cmd, "x64sc");
      assert.ok(Array.isArray(args));
      return stubChild(9999);
    },
    now: () => 1000,
  });
  assert.equal(spawnCount, 1);
  assert.ok(record);
  assert.equal(record!.state, "launching");
  assert.equal(record!.pid, 9999);
  assert.equal(state.instances.get(6600), record);
});

test("tryLaunchOne: a launch that rejects still clears the in-flight owner so a following launch succeeds", () => {
  const state = createBrokerState();
  assert.equal(isLaunchInFlight(), false);
  assert.throws(() => {
    tryLaunchOne("acquire", 6600, {
      state,
      supervisorDir: "/tmp/6600",
      epochFile: "/tmp/6600/epoch.json",
      spawn: () => {
        throw new Error("spawn failed");
      },
    });
  });
  assert.equal(isLaunchInFlight(), false, "the guard must be released even when spawn throws");

  const record = tryLaunchOne("acquire", 6601, {
    state,
    supervisorDir: "/tmp/6601",
    epochFile: "/tmp/6601/epoch.json",
    spawn: () => stubChild(1234),
  });
  assert.ok(record, "a following launch request must succeed once the guard has cleared");
});

// ---------------------------------------------------------------- probeReady

test("probeReady: prefers the external command when named, passing the port as its own argv element", async () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-argv-"));
  try {
    const argvFile = join(dir, "argv.json");
    const stubScript = join(dir, "stub-probe.sh");
    writeFileSync(
      stubScript,
      `#!/bin/sh\nprintf '%s\\n' "$@" > "${argvFile}"\nexit 0\n`
    );
    chmodSync(stubScript, 0o755);

    const outcome = await probeReady(6600, { probeCmdEnv: stubScript });
    assert.equal(outcome.mechanism, "external_command");
    assert.equal(outcome.ready, true);
    assert.ok(existsSync(argvFile));
    assert.equal(readFileSync(argvFile, "utf8").trim(), "6600");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("probeReady: external command failure (non-zero exit) reports not ready", async () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-fail-"));
  try {
    const stubScript = join(dir, "stub-fail.sh");
    writeFileSync(stubScript, `#!/bin/sh\nexit 1\n`);
    chmodSync(stubScript, 0o755);

    const outcome = await probeReady(6600, { probeCmdEnv: stubScript });
    assert.equal(outcome.mechanism, "external_command");
    assert.equal(outcome.ready, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("probeReady: with no external command named, issues an HTTP readiness request and succeeds only when BOTH substrings are present", async () => {
  const calls: Array<{ port: number; timeoutMs: number }> = [];
  const bothPresent = await probeReady(6600, {
    httpProbe: (port, timeoutMs) => {
      calls.push({ port, timeoutMs });
      return Promise.resolve(true);
    },
  });
  assert.deepEqual(bothPresent, { ready: true, mechanism: "http" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].port, 6600);

  const onlyOnePresent = await probeReady(6601, {
    httpProbe: () => Promise.resolve(false),
  });
  assert.deepEqual(onlyOnePresent, { ready: false, mechanism: "http" });
});

test("probeReady: with neither mechanism available, reports success unconditionally and logs the reason", async () => {
  const logs: string[] = [];
  const outcome = await probeReady(6600, { httpProbe: null, log: (l) => logs.push(l) });
  assert.deepEqual(outcome, { ready: true, mechanism: "no_mechanism" });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /no readiness probe available/);
});

// ----------------------------------------------------------- maintainWarmFloor

function makeWarmFloorDeps(state: BrokerState, overrides: Partial<Parameters<typeof maintainWarmFloor>[0]> = {}) {
  const spawnCalls: string[][] = [];
  return {
    deps: {
      state,
      stateDir: "/tmp/vice-supervisor-test",
      spawn: (cmd: string, args: string[]) => {
        spawnCalls.push(args);
        return stubChild(1000 + spawnCalls.length);
      },
      now: () => 5000,
      probe: () => Promise.resolve({ ready: true, mechanism: "http" as const }),
      allocatePort: (async (s: BrokerState): Promise<PortAllocationResult> => {
        let port = 6600;
        while (s.instances.has(port)) port++;
        return { ok: true, port };
      }) as (s: BrokerState) => Promise<PortAllocationResult>,
      countReady: realCountReady,
      countTotal: realCountTotal,
      countLaunching: realCountLaunching,
      log: () => {},
      ...overrides,
    },
    spawnCalls,
  };
}

test("maintainWarmFloor: a pass with a floor of 3 and zero warm instances launches exactly one", async () => {
  const state = createBrokerState();
  const { deps, spawnCalls } = makeWarmFloorDeps(state, { warmFloor: 3, ceiling: 16 });
  await maintainWarmFloor(deps);
  assert.equal(spawnCalls.length, 1);
  assert.equal(countInstances(state), 1);
});

test("maintainWarmFloor: three consecutive passes with a floor of 3 launch exactly three, one per pass", async () => {
  const state = createBrokerState();
  const { deps, spawnCalls } = makeWarmFloorDeps(state, { warmFloor: 3, ceiling: 16 });
  await maintainWarmFloor(deps);
  await maintainWarmFloor(deps);
  await maintainWarmFloor(deps);
  assert.equal(spawnCalls.length, 3);
  assert.equal(countInstances(state), 3);
});

test("maintainWarmFloor: a pass with no readiness mechanism at all warms zero instances and logs exactly one line naming why", async () => {
  const state = createBrokerState();
  const logs: string[] = [];
  const { deps, spawnCalls } = makeWarmFloorDeps(state, {
    warmFloor: 3,
    probe: () => Promise.resolve({ ready: true, mechanism: "no_mechanism" as const }),
    log: (l: string) => logs.push(l),
  });
  // Force the module's own mechanism resolution (not the injected `probe`
  // callback, which only governs promotion) to see "no mechanism" too --
  // achieved by not naming a probe command and stubbing httpProbe out via
  // the environment being clean of VICE_BROKER_PROBE_CMD in this test
  // process, combined with overriding global fetch detection is not
  // available here, so exercise the real no-mechanism path by asserting
  // against the actual env-driven resolution instead.
  const savedProbeCmd = process.env.VICE_BROKER_PROBE_CMD;
  const savedFetch = globalThis.fetch;
  delete process.env.VICE_BROKER_PROBE_CMD;
  // @ts-expect-error -- deliberately removing the global to simulate "no
  // HTTP mechanism available" for this one test, restored in `finally`.
  delete globalThis.fetch;
  try {
    await maintainWarmFloor(deps);
  } finally {
    if (savedProbeCmd !== undefined) process.env.VICE_BROKER_PROBE_CMD = savedProbeCmd;
    globalThis.fetch = savedFetch;
  }
  assert.equal(spawnCalls.length, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /warming ZERO speculative spares/);
});

test("maintainWarmFloor: a launching instance whose probe succeeds is promoted to ready with a readiness timestamp", async () => {
  const state = createBrokerState();
  state.instances.set(6600, makeInstance({ port: 6600, state: "launching", launchedAt: 1000 }));
  const { deps } = makeWarmFloorDeps(state, {
    warmFloor: 0, // nothing more to warm -- isolates the promotion behaviour
    now: () => 1500,
    probe: () => Promise.resolve({ ready: true, mechanism: "http" as const }),
  });
  await maintainWarmFloor(deps);
  const record = state.instances.get(6600)!;
  assert.equal(record.state, "ready");
  assert.equal(record.readyAt, 1500);
});

// 01.6.2-10-PLAN.md ledger row 27 (RE-OBSERVED): the retiring bash suite's
// "maintain_spares boot-time log" test asserted the promotion log line
// carried an elapsed-ms figure. maintainWarmFloor()'s own promotion log line
// (broker-launch.mts) still names the elapsed time -- this was the one
// surviving half of that retiring test with no dedicated assertion in this
// file until now; the retiring test's OTHER half (a poll-interval caveat
// reading VICE_BROKER_POLL_MS) has no equivalent, since this design is not
// discrete-poll-interval based (ledger row 27's own DELETED-adjacent note).
test("maintainWarmFloor: promoting a launching instance to ready logs the elapsed time in milliseconds", async () => {
  const state = createBrokerState();
  state.instances.set(6600, makeInstance({ port: 6600, state: "launching", launchedAt: 1000 }));
  const logs: string[] = [];
  const { deps } = makeWarmFloorDeps(state, {
    warmFloor: 0, // nothing more to warm -- isolates the promotion log line
    now: () => 1250,
    probe: () => Promise.resolve({ ready: true, mechanism: "http" as const }),
    log: (l: string) => logs.push(l),
  });
  await maintainWarmFloor(deps);
  const promotionLine = logs.find((l) => /launching -> ready/.test(l));
  assert.ok(promotionLine, `expected a promotion log line, got: ${JSON.stringify(logs)}`);
  assert.match(
    promotionLine!,
    /port 6600 launching -> ready \(250ms\)/,
    `expected the elapsed-ms figure in the promotion line, got: ${promotionLine}`
  );
});

test("maintainWarmFloor: a launching instance whose probe fails stays launching and is not promoted", async () => {
  const state = createBrokerState();
  state.instances.set(6600, makeInstance({ port: 6600, state: "launching" }));
  const { deps } = makeWarmFloorDeps(state, {
    warmFloor: 0,
    probe: () => Promise.resolve({ ready: false, mechanism: "http" as const }),
  });
  await maintainWarmFloor(deps);
  assert.equal(state.instances.get(6600)!.state, "launching");
  assert.equal(state.instances.get(6600)!.readyAt, null);
});

test("maintainWarmFloor: a pass overlapping an in-flight launch produces no second spawn; the following pass produces one", async () => {
  const state = createBrokerState();
  // Simulate an in-flight cold launch already recorded (as tryLaunchOne
  // would have done synchronously before this pass ever runs).
  state.instances.set(6600, makeInstance({ port: 6600, state: "launching" }));
  const { deps, spawnCalls } = makeWarmFloorDeps(state, {
    warmFloor: 3,
    probe: () => Promise.resolve({ ready: false, mechanism: "http" as const }), // stays launching
  });
  await maintainWarmFloor(deps);
  assert.equal(spawnCalls.length, 0, "no new spawn while one instance is still launching");

  // Now let the in-flight one become ready, then run again -- warming
  // should proceed on this LATER pass.
  const { deps: deps2, spawnCalls: spawnCalls2 } = makeWarmFloorDeps(state, {
    warmFloor: 3,
    probe: () => Promise.resolve({ ready: true, mechanism: "http" as const }),
  });
  await maintainWarmFloor(deps2);
  assert.equal(spawnCalls2.length, 1, "warming proceeds once the earlier launch is no longer in flight");
});

function countInstances(state: BrokerState): number {
  return state.instances.size;
}

// ------------------------------------------------------------- runBrokerPass

test("runBrokerPass: calls the acquire-serving concern before the warm-floor concern", async () => {
  const order: string[] = [];
  await runBrokerPass({
    serveAcquires: () => {
      order.push("serveAcquires");
    },
    maintainWarmFloor: () => {
      order.push("maintainWarmFloor");
    },
  });
  assert.deepEqual(order, ["serveAcquires", "maintainWarmFloor"]);
});

test("runBrokerPass: awaits an async serveAcquires before starting maintainWarmFloor", async () => {
  const order: string[] = [];
  await runBrokerPass({
    serveAcquires: async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push("serveAcquires");
    },
    maintainWarmFloor: () => {
      order.push("maintainWarmFloor");
    },
  });
  assert.deepEqual(order, ["serveAcquires", "maintainWarmFloor"]);
});

// ===========================================================================
// Task 3: criterion C's required deliverable -- the 2026-08-01 triple-launch
// regression, reproduced live rather than hypothesised (RESEARCH.md §C: the
// bash outage was three simultaneous x64sc launches racing the SAME
// count_launching() check -- one SEGV, one exit 1, one exit 0 at the
// identical spawn second).
//
// These tests target acquirePortAndLaunch(), not tryLaunchOne() directly.
// tryLaunchOne() is fully synchronous (no `await` between its own guard
// check and set), which means two SEPARATE calls to it can never actually
// overlap in JS's single-threaded, run-to-completion model, REGARDLESS of
// how they are scheduled -- proven empirically while writing this test:
// two tryLaunchOne() calls racing on DIFFERENT ports via a shared deferred
// gate always produced two spawns, correctly, because launching two
// different instances for two different requests is not a bug. The REAL
// race this criterion must guard is nextFreePort()'s own asynchronous
// port-in-use probe (plan 02, C4): two overlapping callers could otherwise
// both be told the SAME candidate port is free before either commits it,
// which is exactly what acquirePortAndLaunch() closes by holding the
// SAME single in_flight owner across the ENTIRE allocate-then-launch
// sequence, not merely the synchronous spawn instant.
//
// CROSS-PHASE DEPENDENCY, stated explicitly rather than left as an
// assumption: this test's own GREEN state is Phase 01.6.2.1's stated
// prerequisite for D-07 (non-preemptive launch priority layered on top of
// this exact lock). When D-07's priority layer is added in that phase and
// something goes red, this file is the first place to look -- if THIS test
// is also red, the priority layer broke the lock; if this test is still
// green, the regression is somewhere in the new priority logic instead.
// Named as a dependency this phase's own work satisfies, never as an
// assumption that this phase "sealed" concurrency safety for all time.
// ===========================================================================

test("criterion C: two concurrent launch requests against a stubbed, deferred port allocator produce exactly one spawn (2026-08-01 triple-launch regression)", async () => {
  const state = createBrokerState();
  let spawnCallCount = 0;
  let allocatePortCallCount = 0;
  const stubSpawn = (_cmd: string, _args: string[]) => {
    spawnCallCount++;
    return stubChild(5000 + spawnCallCount);
  };
  // Both requests' allocator would return the SAME port 6600 if either
  // ever reached it -- the realistic shape of the race: two overlapping
  // callers, both told the identical candidate is free.
  const stubAllocatePort = async (): Promise<PortAllocationResult> => {
    allocatePortCallCount++;
    return { ok: true, port: 6600 };
  };

  // A SHARED, test-controlled deferred resolution: both launch requests are
  // constructed as `.then()` continuations off the SAME pending promise, so
  // neither request "starts" (i.e. reaches its own call into
  // acquirePortAndLaunch()) before the other -- releasing the gate
  // schedules BOTH continuations as separate microtasks from the identical
  // resolved promise. This is what makes the concurrency real rather than
  // nominal: a test that simply called the function twice in a row, with
  // no scheduling gap at all, would pass even against a genuinely broken
  // guard, for the boring reason that two back-to-back synchronous calls
  // in the same tick can never interleave regardless of correctness.
  let releaseGate: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });

  const request1 = gate.then(() =>
    acquirePortAndLaunch("acquire", {
      state,
      stateDir: "/tmp/race-cold",
      allocatePort: stubAllocatePort,
      spawn: stubSpawn,
    })
  );
  const request2 = gate.then(() =>
    acquirePortAndLaunch("spare", {
      state,
      stateDir: "/tmp/race-warm",
      allocatePort: stubAllocatePort,
      spawn: stubSpawn,
    })
  );

  // Both continuations are already queued before either has run -- NOW
  // release them together.
  releaseGate!();
  const [result1, result2] = await Promise.all([request1, request2]);

  assert.equal(spawnCallCount, 1, `exactly one spawn must occur for two concurrent launch requests; got ${spawnCallCount}`);
  const successes = [result1, result2].filter((r) => r.ok);
  assert.equal(successes.length, 1, "exactly one of the two concurrent requests must succeed");
  const refused = [result1, result2].filter((r) => !r.ok) as Array<{ ok: false; reason: string }>;
  assert.equal(refused.length, 1);
  assert.equal(refused[0].reason, "launch_in_flight", "the losing request must be refused as launch_in_flight, not silently dropped or errored");
  assert.equal(isLaunchInFlight(), false, "the guard must be clear once both requests have settled");
});

test("criterion C: a warming pass overlapping a cold acquire's still-in-flight launch produces no second spawn; the next pass, once promoted, produces one", async () => {
  const state = createBrokerState();

  // A real cold acquire launch, via acquirePortAndLaunch() itself (not a
  // seeded fixture) -- it lands in state.instances as "launching"
  // synchronously once its (immediately-resolving) allocatePort settles,
  // exactly as vice-broker.mts's handleAcquire would leave it mid-boot.
  const coldResult = await acquirePortAndLaunch("acquire", {
    state,
    stateDir: "/tmp/race-cold-6600",
    allocatePort: async () => ({ ok: true, port: 6600 }),
    spawn: () => stubChild(9001),
  });
  assert.ok(coldResult.ok, "the cold acquire launch itself must succeed to set up this scenario");
  assert.equal(state.instances.get(6600)!.state, "launching");

  const { deps, spawnCalls } = makeWarmFloorDeps(state, {
    warmFloor: 3,
    probe: () => Promise.resolve({ ready: false, mechanism: "http" as const }), // still not ready
  });
  await maintainWarmFloor(deps);
  assert.equal(spawnCalls.length, 0, "no second spawn while the cold acquire's launch is still in flight");
  assert.equal(state.instances.get(6600)!.state, "launching", "the cold instance must still be launching, untouched by this pass");

  // The SAME instance's probe now succeeds -- the next pass promotes it to
  // ready, sees countLaunching()===0, and warming may proceed.
  const { deps: deps2, spawnCalls: spawnCalls2 } = makeWarmFloorDeps(state, {
    warmFloor: 3,
    probe: () => Promise.resolve({ ready: true, mechanism: "http" as const }),
  });
  await maintainWarmFloor(deps2);
  assert.equal(state.instances.get(6600)!.state, "ready", "the earlier cold instance must now be promoted");
  assert.equal(spawnCalls2.length, 1, "warming proceeds on the pass after the earlier launch is no longer in flight");
});

// Task 3's third required assertion -- "an injected spawn rejection leaves
// the guard clear, and the next launch request spawns" -- is ALREADY
// covered above by Task 2's own "tryLaunchOne: a launch that rejects still
// clears the in-flight owner so a following launch succeeds" test, and
// holds identically for acquirePortAndLaunch() since it shares the exact
// same module-level guard and the exact same try/finally release
// discipline; it is not duplicated here.
//
// DISCRIMINATING-POWER CHECK (performed during Task 3's execution, recorded
// here and in the plan's own SUMMARY rather than left implicit): the guard's
// `if (inFlight) return ...` check and `inFlight = true;` set were
// temporarily moved to AFTER `await deps.allocatePort(...)` instead of
// before it (the realistic shape of this exact mistake: "let me just
// allocate the port first, then check if something else is already
// launching"). The FIRST "criterion C" test above -- the two-concurrent-
// requests test -- FAILED against that regressed version (spawnCallCount
// observed as 2, both requests succeeding instead of one being refused as
// launch_in_flight), proving it has real discriminating power against the
// exact regression it exists to catch, rather than passing vacuously
// regardless of the guard's correctness. The SECOND test (the cross-pass
// overlap) did NOT fail against this same regression -- correctly so, and
// recorded here rather than silently: that test's own "no second spawn"
// property is enforced by maintainWarmFloor()'s independent
// countLaunching()>0 pre-check (a RECORDED-STATE throttle, checked before
// acquirePortAndLaunch() is ever reached), not by the in_flight guard this
// specific regression broke -- the cold instance was already fully
// launched and recorded before the warm pass ever ran, so there was no
// overlap window for this particular mistake to exploit. The two tests
// therefore discriminate two DIFFERENT invariants, both real. The
// regression was reverted immediately after this check; no trace of it
// remains in the committed source. This mirrors Phase 01.6.1's own
// practice of proving a guard's tests against an injected regression
// before trusting them.

// ===========================================================================
// Plan 03, Task 2: superviseChild() -- the per-child supervisor absorbed
// wholesale from resources/vice-supervisor.sh (C2/D-23). No real emulator
// runs anywhere in this file: `/bin/true`/`/bin/sleep` stand in for a REAL
// pid wherever a genuine liveness check is the point; a fully test-
// controlled EventEmitter stands in wherever exact backoff/crash-window
// ordering is the point.
// ===========================================================================

function makeSuperviseDeps(stateDir: string, overrides: Partial<Parameters<typeof superviseChild>[2]> = {}) {
  return {
    state: createBrokerState(),
    stateDir,
    epoch: makeEpochDeps(),
    sleepMs: async () => {}, // instant by default -- tests that care override this
    now: () => 1000,
    initialBackoffMs: 5,
    maxBackoffMs: 20,
    maxRestarts: 50, // high by default so give-up never fires unless a test wants it to
    crashWindowMs: 60000,
    log: () => {},
    ...overrides,
  };
}

// ===========================================================================
// 01.6.2-12-PLAN.md, Task 1 (gap closure): withCrashSupervision() is the
// single exit-listener installation point extracted from launchSupervised()
// -- this test proves the wrapper's own return-value contract in isolation
// (never replaces or wraps the child object itself), independent of
// launchSupervised()'s respawn-chain tests above, which already exercise
// the same wrapper transitively via superviseChild().
// ===========================================================================

test("withCrashSupervision: the wrapper returns the base spawn's own child object unchanged, so a caller's own handle is never replaced", () => {
  const child = fakeChild();
  const deps = {
    state: createBrokerState(),
    stateDir: "/tmp/withCrashSupervision-unused",
    epoch: makeEpochDeps(),
    log: () => {},
  };
  const wrapped = withCrashSupervision("acquire", 6600, () => child, deps);
  const returned = wrapped("x64sc", ["-mcpserverport", "6600"]);
  assert.equal(returned, child, "the wrapper must return the exact child object baseSpawn produced, unchanged -- never a new or wrapped object");
});

test("superviseChild: a stub child that exits on its own is respawned, and the instance's epoch record advances by one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "supervise-respawn-"));
  try {
    // The FIRST spawn exits immediately (/bin/true) to trigger exactly one
    // crash; every spawn AFTER that is a long-lived process (/bin/sleep)
    // so the chain settles at epoch 2 instead of racing uncontrolled
    // through further crashes (maxRestarts is high specifically so THIS
    // test is about "a crash is respawned," not about give-up).
    let spawnCount = 0;
    const deps = makeSuperviseDeps(dir, {
      spawn: () => {
        spawnCount++;
        return spawnCount === 1 ? realSpawn("/bin/true", []) : realSpawn("/bin/sleep", ["300"]);
      },
    });
    const record = superviseChild("acquire", 6600, deps);
    assert.ok(record, "the initial launch must succeed");
    assert.equal(record!.epoch, 1, "the first launch records epoch 1");

    const supervisorDir = join(dir, "6600");
    const respawned = await waitFor(() => {
      const rec = deps.state.instances.get(6600);
      return rec && rec.epoch === 2 ? rec : null;
    });
    assert.ok(respawned, "the instance must be respawned (epoch advances to 2) after the child exits on its own");

    const epochOnDisk = JSON.parse(readFileSync(join(supervisorDir, "epoch.json"), "utf8"));
    assert.equal(epochOnDisk.epoch, 2, "the epoch.json on disk must also reflect the respawn's bumped epoch");

    // Clean up the long-lived respawned /bin/sleep so it doesn't linger.
    // Mark deliberateKill FIRST -- exactly like T-01.6.2-21's own
    // discipline -- so this cleanup kill is read as a deliberate teardown,
    // not another crash; killing it without that flag would trigger
    // ANOTHER automatic respawn (correctly, per this module's own crash
    // handling) and leak a fresh, untracked /bin/sleep in its place.
    const finalRecord = deps.state.instances.get(6600);
    if (finalRecord) {
      finalRecord.deliberateKill = true;
      if (typeof finalRecord.pid === "number") {
        try {
          process.kill(finalRecord.pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("superviseChild: a stub child whose instance carries the deliberate-kill marker causes zero respawns and the instance is absent from _snapshotState() afterwards", async () => {
  const dir = mkdtempSync(join(tmpdir(), "supervise-deliberate-kill-"));
  try {
    const deps = makeSuperviseDeps(dir, {
      spawn: () => realSpawn("/bin/sleep", ["300"]),
    });
    const record = superviseChild("acquire", 6600, deps);
    assert.ok(record, "the initial launch must succeed");
    const pid = record!.pid as number;

    const aliveBefore = await waitFor(() => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
    assert.ok(aliveBefore, "the sleep child must be alive before the deliberate kill");

    // Mark deliberate-kill BEFORE sending any signal -- exactly the
    // ordering T-01.6.2-21 requires: the exit handler must see this flag
    // set by the time the exit event it is racing against actually fires.
    deps.state.instances.get(6600)!.deliberateKill = true;
    process.kill(pid, "SIGTERM");

    const gone = await waitFor(() => (deps.state.instances.has(6600) ? null : true));
    assert.ok(gone, "a deliberately-killed instance must be dropped from the map, never respawned");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("superviseChild: the first respawn waits the configured initial backoff; the second waits twice that; the delay is clamped at the configured ceiling however many crashes follow", async () => {
  const dir = mkdtempSync(join(tmpdir(), "supervise-backoff-"));
  try {
    const spawnedChildren: ChildProcess[] = [];
    const delays: number[] = [];
    const deps = makeSuperviseDeps(dir, {
      initialBackoffMs: 100,
      maxBackoffMs: 250,
      maxRestarts: 50,
      sleepMs: async (ms: number) => {
        delays.push(ms);
      },
      spawn: () => {
        const child = fakeChild();
        spawnedChildren.push(child);
        return child;
      },
    });

    superviseChild("acquire", 6600, deps);
    assert.equal(spawnedChildren.length, 1, "the initial launch must spawn exactly one child");

    // Crash #1 -> respawn #1 (initial backoff).
    (spawnedChildren[0] as unknown as EventEmitter).emit("exit", 1, null);
    await waitFor(() => (spawnedChildren.length >= 2 ? true : null));
    // Crash #2 -> respawn #2 (doubled).
    (spawnedChildren[1] as unknown as EventEmitter).emit("exit", 1, null);
    await waitFor(() => (spawnedChildren.length >= 3 ? true : null));
    // Crash #3 -> respawn #3 (clamped at the ceiling, NOT 400).
    (spawnedChildren[2] as unknown as EventEmitter).emit("exit", 1, null);
    await waitFor(() => (spawnedChildren.length >= 4 ? true : null));

    assert.deepEqual(delays, [100, 200, 250], "the observed delays must be the initial value, twice it, then the clamped ceiling");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("superviseChild: an instance crashing one more than the configured maximum inside the configured window is absent from _snapshotState() afterwards and a give-up line naming it appears in the captured log output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "supervise-giveup-"));
  try {
    const spawnedChildren: ChildProcess[] = [];
    const logs: string[] = [];
    const deps = makeSuperviseDeps(dir, {
      initialBackoffMs: 1,
      maxBackoffMs: 10,
      maxRestarts: 3,
      crashWindowMs: 60000,
      log: (l: string) => logs.push(l),
      spawn: () => {
        const child = fakeChild();
        spawnedChildren.push(child);
        return child;
      },
    });

    superviseChild("acquire", 6600, deps);
    assert.equal(spawnedChildren.length, 1);

    // Crash #1 (count 1, <3 -> respawn), crash #2 (count 2, <3 -> respawn),
    // crash #3 (count 3, >=3 -> GIVE UP; one more than "2 respawns
    // allowed" mirrors vice-supervisor.sh's own `>= VICE_MAX_RESTARTS`
    // check exactly).
    (spawnedChildren[0] as unknown as EventEmitter).emit("exit", 1, null);
    await waitFor(() => (spawnedChildren.length >= 2 ? true : null));
    (spawnedChildren[1] as unknown as EventEmitter).emit("exit", 1, null);
    await waitFor(() => (spawnedChildren.length >= 3 ? true : null));
    (spawnedChildren[2] as unknown as EventEmitter).emit("exit", 1, null);

    const gone = await waitFor(() => (deps.state.instances.has(6600) ? null : true));
    assert.ok(gone, "the instance must be given up on and dropped from the map");
    // No fourth spawn must ever occur -- give-up means give-up, not "one
    // more attempt."
    assert.equal(spawnedChildren.length, 3, "no spawn beyond the give-up point may occur");

    const giveUpLine = logs.find((l) => /giving up/.test(l));
    assert.ok(giveUpLine, "a give-up line must appear in the captured log output");
    assert.match(giveUpLine!, /6600/, "the give-up line must name the port");
    assert.match(giveUpLine!, /3 crashes/, "the give-up line must name the crash count");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("superviseChild: a crash whose timestamp falls outside the configured window does not push the instance over the give-up threshold", async () => {
  const dir = mkdtempSync(join(tmpdir(), "supervise-window-"));
  try {
    const spawnedChildren: ChildProcess[] = [];
    let currentTime = 0;
    const deps = makeSuperviseDeps(dir, {
      initialBackoffMs: 1,
      maxBackoffMs: 10,
      maxRestarts: 2,
      crashWindowMs: 1000,
      now: () => currentTime,
      spawn: () => {
        const child = fakeChild();
        spawnedChildren.push(child);
        return child;
      },
    });

    superviseChild("acquire", 6600, deps);
    assert.equal(spawnedChildren.length, 1);

    // Crash #1 at t=0 -- crashTimes=[0], length 1 < maxRestarts(2) -> respawn.
    currentTime = 0;
    (spawnedChildren[0] as unknown as EventEmitter).emit("exit", 1, null);
    await waitFor(() => (spawnedChildren.length >= 2 ? true : null));

    // Crash #2 at t=5000 -- FAR outside the 1000ms window relative to the
    // first crash at t=0, so it must be filtered OUT rather than pushing
    // the count to 2. If the window logic were broken (never excluding
    // old crashes), this would incorrectly reach the give-up threshold
    // here instead of on crash #3 below.
    currentTime = 5000;
    (spawnedChildren[1] as unknown as EventEmitter).emit("exit", 1, null);
    await waitFor(() => (spawnedChildren.length >= 3 ? true : null));
    assert.equal(spawnedChildren.length, 3, "the distant first crash must not count toward give-up -- a third spawn must occur");
    assert.ok(deps.state.instances.has(6600), "the instance must still be alive after the second crash");

    // Crash #3 at t=5001 -- now WITHIN the window of crash #2 (t=5000), so
    // the pruned count reaches 2 (>= maxRestarts) and give-up fires.
    currentTime = 5001;
    (spawnedChildren[2] as unknown as EventEmitter).emit("exit", 1, null);
    const gone = await waitFor(() => (deps.state.instances.has(6600) ? null : true));
    assert.ok(gone, "two crashes within the window must trigger give-up");
    assert.equal(spawnedChildren.length, 3, "no fourth spawn may occur once given up");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("superviseChild: for every spawn and respawn in a test run, the captured log output contains a line naming the resolved binary and its full argument vector", async () => {
  const dir = mkdtempSync(join(tmpdir(), "supervise-logging-"));
  try {
    const spawnedChildren: ChildProcess[] = [];
    const logs: string[] = [];
    const deps = makeSuperviseDeps(dir, {
      initialBackoffMs: 1,
      maxBackoffMs: 10,
      maxRestarts: 50,
      viceBin: "x64sc",
      log: (l: string) => logs.push(l),
      spawn: () => {
        const child = fakeChild();
        spawnedChildren.push(child);
        return child;
      },
    });

    superviseChild("acquire", 6600, deps);
    (spawnedChildren[0] as unknown as EventEmitter).emit("exit", 1, null);
    await waitFor(() => (spawnedChildren.length >= 2 ? true : null));
    (spawnedChildren[1] as unknown as EventEmitter).emit("exit", 1, null);
    await waitFor(() => (spawnedChildren.length >= 3 ? true : null));

    const launchLines = logs.filter((l) => /^vice-broker: launching x64sc /.test(l));
    assert.equal(launchLines.length, 3, "every spawn AND every respawn must log its own resolved command line");
    for (const line of launchLines) {
      assert.match(line, /-mcpserverport 6600/, "the logged line must name the full resolved argument vector");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("superviseChild: after a spawn, a file exists inside that instance's logs directory and the epoch record's log field names exactly that file relative to the instance directory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "supervise-logfile-"));
  try {
    const deps = makeSuperviseDeps(dir, {
      spawn: () => realSpawn("/bin/true", []),
    });
    const record = superviseChild("acquire", 6600, deps);
    assert.ok(record);
    assert.ok(record!.logPath, "the record must carry a logPath");

    const supervisorDir = join(dir, "6600");
    const epochOnDisk = JSON.parse(readFileSync(join(supervisorDir, "epoch.json"), "utf8"));
    const resolvedLogPath = join(supervisorDir, epochOnDisk.log);
    assert.ok(existsSync(resolvedLogPath), "the log file the epoch record names must actually exist on disk");
    assert.equal(resolvedLogPath, record!.logPath, "the record's own logPath must match the epoch record's log field, joined onto the instance directory");
    assert.ok(epochOnDisk.log.startsWith("logs/"), "the epoch record's log field must be relative, starting with the per-instance logs directory name");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("superviseChild: the give-up path leaves no live child pid, asserted by a zero-signal liveness check on every pid the test's stub spawn handed out", async () => {
  const dir = mkdtempSync(join(tmpdir(), "supervise-no-orphan-"));
  try {
    const pids: number[] = [];
    const deps = makeSuperviseDeps(dir, {
      initialBackoffMs: 1,
      maxBackoffMs: 10,
      maxRestarts: 2,
      crashWindowMs: 60000,
      spawn: () => {
        const child = realSpawn("/bin/true", []);
        if (typeof child.pid === "number") pids.push(child.pid);
        return child;
      },
    });

    const record = superviseChild("acquire", 6600, deps);
    assert.ok(record);

    const gone = await waitFor(() => (deps.state.instances.has(6600) ? null : true), { timeoutMs: 10000 });
    assert.ok(gone, "the instance must eventually be given up on (each /bin/true exits immediately, exceeding maxRestarts quickly)");
    assert.ok(pids.length >= 2, "at least two real children must have been spawned across the crash sequence");

    for (const pid of pids) {
      const deadline = Date.now() + 2000;
      let alive = true;
      while (Date.now() < deadline) {
        try {
          process.kill(pid, 0);
        } catch {
          alive = false;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(!alive, `pid ${pid} must not still be alive after give-up -- /bin/true always exits on its own, and give-up must not leave anything running`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
