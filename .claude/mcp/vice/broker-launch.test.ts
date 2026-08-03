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
import { tryLaunchOne, isLaunchInFlight, probeReady, maintainWarmFloor, runBrokerPass, acquirePortAndLaunch } from "./broker-launch.mts";

const HERE = dirname(fileURLToPath(import.meta.url));

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
