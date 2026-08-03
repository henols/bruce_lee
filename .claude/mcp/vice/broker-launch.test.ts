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
import { tryLaunchOne, isLaunchInFlight, probeReady, maintainWarmFloor, runBrokerPass } from "./broker-launch.mts";

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
