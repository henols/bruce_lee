// vice-broker-acquire.test.ts
//
// 01.6.2.1-01-PLAN.md, Task 1 (P-01/P-02/P-03/P-04): unit-level proof that
// handleAcquire() consults the warm floor before ever cold-launching. Covers
// the EMITTED resources/vice-broker.mjs directly -- vice-broker.mts cannot be
// imported unbuilt (it value-imports its siblings by their ".mjs" specifier,
// which resolves only once tsc has compiled the whole tree into resources/,
// exactly like every other host-bound module's own header comment already
// explains for the opposite direction) -- so this file follows
// vice-broker-launch.test.ts's own established convention: a `.ts` file that
// tests emitted OUTPUT, never the unbuilt `.mts` source directly. Unlike that
// file, this one imports the built module (dynamic `import()`, after a fresh
// build()) to call handleAcquire()/handleRelease() as plain functions against
// a hand-built BrokerState -- there is no TCP control plane or real spawn
// anywhere in this file; every probe, kill and cold-launch spawn is injected
// through HandleAcquireDeps, the SAME dependency-seam shape
// broker-launch.mts's own BrokerDeps/TryLaunchDeps/MaintainWarmFloorDeps
// already establish. No test in this file opens a real connection to
// anything (`.claude/CLAUDE.md` § Emulator Access) and no `x64sc` runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";

import { build } from "./build.ts";
import type { BrokerState, InstanceRecord } from "./broker-state.mts";
import type { HandleAcquireDeps } from "./vice-broker.mts";
import type { AcquireOutcome } from "./broker-control.mts";
import type { KillStage } from "./broker-kill.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const BROKER_ARTIFACT_URL = new URL("./resources/vice-broker.mjs", import.meta.url).href;

interface BrokerModule {
  handleAcquire: (requestId: string, stateDir: string, state: BrokerState, deps?: HandleAcquireDeps) => Promise<AcquireOutcome>;
  handleRelease: (requestId: string, state: BrokerState) => void;
}

/** Rebuilds resources/ from the current TypeScript source, then imports the
 * FRESH emitted vice-broker.mjs -- matching broker-e2e.test.ts's own
 * `build();` idiom at the top of every test. Node's ESM loader caches a
 * module by resolved URL for the lifetime of this process, so every test in
 * this file (and any OTHER file importing the same URL in the same `node
 * --test` run) shares one loaded instance -- harmless here, since this
 * module holds no test-visible mutable top-level state of its own (every
 * call site threads its own fresh BrokerState through). */
async function loadBrokerModule(): Promise<BrokerModule> {
  build();
  return (await import(BROKER_ARTIFACT_URL)) as unknown as BrokerModule;
}

function createState(): BrokerState {
  return { instances: new Map(), grants: new Map(), blockedPorts: new Set() };
}

function makeReadyInstance(overrides: Partial<InstanceRecord> = {}): InstanceRecord {
  return {
    port: 6600,
    url: "http://127.0.0.1:6600/mcp",
    state: "ready",
    reason: "spare",
    epochFile: join(HERE, "fixtures", "does-not-need-to-exist-epoch.json"),
    supervisorDir: join(HERE, "fixtures"),
    pid: 4242,
    expectedIdentity: "x64sc",
    launchedAt: 0,
    readyAt: 0,
    viceBin: "x64sc",
    viceArgs: [],
    dryRun: false,
    ...overrides,
  };
}

function stubColdSpawnFactory(spawnCalls: number[]): (port: number) => (command: string, args: string[]) => ChildProcess {
  return (port: number) => {
    return (): ChildProcess => {
      spawnCalls.push(port);
      return { pid: 9000 + spawnCalls.length } as unknown as ChildProcess;
    };
  };
}

function alwaysReadyProbe(): (port: number) => Promise<boolean> {
  return () => Promise.resolve(true);
}

// ---------------------------------------------------------------------------
// RED-first (P-04): this test must fail against today's (pre-P-01)
// handleAcquire(), which never consults state.instances at all -- every
// acquire cold-launches regardless of how many "ready" records exist. The
// observed RED output, captured before this task's own implementation
// commit, is quoted verbatim in 01.6.2.1-01-SUMMARY.md.
// ---------------------------------------------------------------------------

test("handleAcquire: an acquire arriving with one probe-live ready instance available is served from it and spawns nothing (P-01, Defect 5)", async () => {
  const { handleAcquire } = await loadBrokerModule();
  const state = createState();
  state.instances.set(6600, makeReadyInstance({ port: 6600, url: "http://127.0.0.1:6600/mcp", epochFile: "/tmp/vice-broker-acquire-test/6600/epoch.json", supervisorDir: "/tmp/vice-broker-acquire-test/6600" }));

  const spawnCalls: number[] = [];
  const outcome = await handleAcquire("req-1", "/tmp/vice-broker-acquire-test", state, {
    probe: alwaysReadyProbe(),
    buildColdSpawnFactory: stubColdSpawnFactory(spawnCalls),
  });

  assert.equal(spawnCalls.length, 0, "the stubbed cold-launch spawn must never be called when a probe-live ready instance is available");
  assert.equal(outcome.ok, true, `expected a successful grant, got ${JSON.stringify(outcome)}`);
  if (outcome.ok) {
    assert.equal(outcome.grant.port, 6600, "the grant must name the PRE-WARMED port, not a freshly allocated one");
    assert.equal(outcome.grant.url, "http://127.0.0.1:6600/mcp");
    assert.equal(outcome.grant.epochFile, "/tmp/vice-broker-acquire-test/6600/epoch.json");
    assert.equal(outcome.grant.supervisorDir, "/tmp/vice-broker-acquire-test/6600");
  }
  assert.equal(state.instances.get(6600)?.state, "granted", "the pre-warmed instance must be marked granted, not left ready");
});

// ---------------------------------------------------------------------------
// P-02/P-03: a failed grant-time probe drops and identity-verified-kills the
// candidate, then the walk continues to the next ready record.
// ---------------------------------------------------------------------------

test("handleAcquire: a failed grant-time probe on the first of two ready records drops+kills it, grants the second, and spawns nothing", async () => {
  const { handleAcquire } = await loadBrokerModule();
  const state = createState();
  state.instances.set(6600, makeReadyInstance({ port: 6600, pid: 5001, expectedIdentity: "x64sc" }));
  state.instances.set(6601, makeReadyInstance({ port: 6601, pid: 5002, expectedIdentity: "x64sc", url: "http://127.0.0.1:6601/mcp" }));

  const spawnCalls: number[] = [];
  const killCalls: Array<{ pid: number | null; expectedIdentity: string }> = [];
  const outcome = await handleAcquire("req-2", "/tmp/vice-broker-acquire-test", state, {
    probe: (port: number) => Promise.resolve(port !== 6600),
    kill: (opts) => {
      killCalls.push(opts);
      return Promise.resolve("sigterm" as KillStage);
    },
    buildColdSpawnFactory: stubColdSpawnFactory(spawnCalls),
  });

  assert.equal(spawnCalls.length, 0, "no cold launch -- the second ready record must satisfy the acquire");
  assert.equal(outcome.ok, true, `expected a successful grant, got ${JSON.stringify(outcome)}`);
  if (outcome.ok) {
    assert.equal(outcome.grant.port, 6601, "the grant must name the SECOND (probe-live) port, not the failed first one");
  }
  assert.equal(state.instances.has(6600), false, "the failed candidate's record must be gone from state (and therefore from _snapshotState())");
  assert.equal(killCalls.length, 1, "the identity-verified kill must be invoked exactly once");
  assert.deepEqual(killCalls[0], { pid: 5001, expectedIdentity: "x64sc" }, "the kill must target the FAILED record's own recorded pid and identity");
});

test("handleAcquire: a failed grant-time probe with no other ready record drops+kills it and falls through to exactly one cold launch on a different port", async () => {
  const { handleAcquire } = await loadBrokerModule();
  const state = createState();
  state.instances.set(6600, makeReadyInstance({ port: 6600, pid: 5001, expectedIdentity: "x64sc" }));

  const spawnCalls: number[] = [];
  const killCalls: Array<{ pid: number | null; expectedIdentity: string }> = [];
  const outcome = await handleAcquire("req-3", "/tmp/vice-broker-acquire-test", state, {
    probe: () => Promise.resolve(false),
    kill: (opts) => {
      killCalls.push(opts);
      return Promise.resolve("sigterm" as KillStage);
    },
    buildColdSpawnFactory: stubColdSpawnFactory(spawnCalls),
  });

  assert.equal(spawnCalls.length, 1, "exactly one cold launch must follow the exhausted walk");
  assert.equal(outcome.ok, true, `expected a successful grant, got ${JSON.stringify(outcome)}`);
  // NOT asserted: that the cold-launched port NUMBER differs from the
  // failed candidate's own port. Dropping the failed record frees its port
  // number legitimately -- nextFreePort() (broker-state.mts) scans only
  // state.instances and the blocked set, so reallocating the SAME port
  // number to a FRESH process (a NEW record, a NEW pid) is correct,
  // expected behaviour, not a bug. This task's own plan prose's "a
  // different port" means a different INSTANCE, which spawnCalls.length
  // and the fresh pid recorded below already prove.
  assert.equal(killCalls.length, 1, "the identity-verified kill must be invoked exactly once, for the FAILED candidate only");
  assert.deepEqual(killCalls[0], { pid: 5001, expectedIdentity: "x64sc" });
  if (outcome.ok) {
    const freshRecord = state.instances.get(outcome.grant.port);
    assert.ok(freshRecord, "the cold-launched record must be present in state");
    assert.notEqual(freshRecord!.pid, 5001, "the cold-launched instance must be a FRESH process, not the killed candidate's own pid");
  }
});

// ---------------------------------------------------------------------------
// Kill-never-recycle survives the new promotion path: a released instance's
// record is gone from state.instances (handleRelease() deletes it outright),
// so it is structurally unselectable by handleAcquire()'s warm-instance
// selection arm -- no separate guard is needed, and this test asserts the
// property rather than assuming it.
// ---------------------------------------------------------------------------

test("handleAcquire: an instance released through handleRelease() is never promoted on a later acquire -- kill-never-recycle", async () => {
  const { handleAcquire, handleRelease } = await loadBrokerModule();
  const state = createState();
  state.instances.set(6600, makeReadyInstance({ port: 6600, state: "granted", pid: 5001, expectedIdentity: "x64sc" }));
  state.grants.set("req-4", { id: "req-4", port: 6600, grantedAt: Date.now() });

  // The real release path -- deletes the grant and the instance record
  // synchronously; the identity-verified kill it fires is a fire-and-forget
  // best-effort against the seeded pid, never awaited by this test (matching
  // handleRelease()'s own real call sites, which never await it either).
  handleRelease("req-4", state);
  assert.equal(state.instances.has(6600), false, "handleRelease() must delete the instance record outright");
  assert.equal(state.grants.has("req-4"), false, "handleRelease() must delete the grant outright");

  const spawnCalls: number[] = [];
  const outcome = await handleAcquire("req-5", "/tmp/vice-broker-acquire-test", state, {
    probe: alwaysReadyProbe(), // would succeed if (incorrectly) offered a candidate -- there must be none
    buildColdSpawnFactory: stubColdSpawnFactory(spawnCalls),
  });

  assert.equal(spawnCalls.length, 1, "with no ready candidate left, the acquire must cold-launch exactly once");
  assert.equal(outcome.ok, true, `expected a successful grant, got ${JSON.stringify(outcome)}`);
});

// ---------------------------------------------------------------------------
// D-07's standing constraint: the grant-time-probe-failure log line must be
// distinguishable from the shutdown kill's own line.
// ---------------------------------------------------------------------------

test("handleAcquire: the grant-time-probe-failure log line is distinct from broker-kill.mts's shutdown wording", async () => {
  const { handleAcquire } = await loadBrokerModule();
  const state = createState();
  state.instances.set(6600, makeReadyInstance({ port: 6600, pid: 5001, expectedIdentity: "x64sc" }));

  const logs: string[] = [];
  const outcome = await handleAcquire("req-6", "/tmp/vice-broker-acquire-test", state, {
    probe: () => Promise.resolve(false),
    kill: () => Promise.resolve("sigterm" as KillStage),
    buildColdSpawnFactory: stubColdSpawnFactory([]),
    log: (line: string) => logs.push(line),
  });
  assert.equal(outcome.ok, true);

  const failureLine = logs.find((l) => /grant-time probe failed/.test(l));
  assert.ok(failureLine, `expected a grant-time-probe-failure log line, got: ${JSON.stringify(logs)}`);
  assert.match(failureLine!, /port 6600/);
  assert.match(failureLine!, /pid 5001/);
  assert.match(failureLine!, /dropped the record and identity-verified-killed the pid/);
  for (const line of logs) {
    assert.doesNotMatch(line, /shutdown complete/, "the grant-time-probe-failure line must never read like the shutdown kill's own line");
  }
});
