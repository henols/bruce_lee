// broker-e2e.test.ts
//
// The tracer's own end-to-end verify -- the one test that proves the WHOLE
// path this plan wires, not one layer of it: build the real artifacts,
// spawn the emitted resources/vice-broker.mjs under bare `node`, connect
// with the real container-side TCP client (vice-broker-client.ts's
// acquireOverControlPlane()), send one `acquire`, and assert the grant, the
// spawn, the epoch write and the connection-close release all happen for
// real. No real emulator runs anywhere in this test and no test opens a
// connection to the host VICE -- VICE_BIN is stubbed to /bin/sleep.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "node:net";

import { build } from "./build.ts";
import { acquireOverControlPlane } from "./vice-broker-client.ts";
import { verifiedKill } from "./broker-kill.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const BROKER_ARTIFACT = join(HERE, "resources", "vice-broker.mjs");

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate: () => boolean, deadlineMs: number, pollMs = 25): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return predicate();
}

interface BrokerHandle {
  child: ChildProcessWithoutNullStreams;
  stateDir: string;
  stderr: string;
}

/** Spawns the EMITTED broker artifact under bare node -- never the
 * TypeScript source -- with VICE_BIN/VICE_ARGS stubbed to a real,
 * harmless, long-lived process (/bin/sleep) so a spawned "instance" is a
 * real pid without ever touching x64sc. VICE_BROKER_CONTROL_PORT=0 lets
 * the kernel pick a free port so parallel test runs never collide. */
function startBroker(stateDir: string, extraEnv: Record<string, string> = {}): BrokerHandle {
  const child = spawn(process.execPath, [BROKER_ARTIFACT, "--repo-root", "/tmp/fake-repo-root-e2e", "--state-dir", stateDir], {
    env: {
      ...process.env,
      VICE_SUPERVISOR_ALLOW_CONTAINER: "1",
      VICE_BIN: "/bin/sleep",
      VICE_ARGS: "600",
      VICE_BROKER_CONTROL_PORT: "0",
      ...extraEnv,
    },
  }) as ChildProcessWithoutNullStreams;

  const handle: BrokerHandle = { child, stateDir, stderr: "" };
  child.stderr.on("data", (chunk: Buffer) => {
    handle.stderr += chunk.toString("utf8");
  });
  return handle;
}

async function stopBroker(handle: BrokerHandle): Promise<void> {
  if (handle.child.exitCode !== null || handle.child.signalCode !== null) return;
  handle.child.kill("SIGTERM");
  const exited = await waitFor(() => handle.child.exitCode !== null || handle.child.signalCode !== null, 3000);
  if (!exited) {
    handle.child.kill("SIGKILL");
  }
}

async function waitForBrokerJson(stateDir: string, deadlineMs = 5000): Promise<Record<string, unknown>> {
  const path = join(stateDir, "broker.json");
  const appeared = await waitFor(() => existsSync(path) && typeof JSON.parse(readFileSync(path, "utf8")).control_port === "number", deadlineMs);
  assert.ok(appeared, "broker.json with a control_port did not appear within deadline");
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Sends one raw acquire request, bypassing acquireOverControlPlane() --
 * used for the token-refusal cases, which need to control (or omit) the
 * token directly. Resolves with the first response line and whether the
 * connection was destroyed by the server. */
function rawAcquire(host: string, port: number, body: Record<string, unknown>): Promise<{ response: Record<string, unknown>; serverClosed: boolean }> {
  return new Promise((resolvePromise, reject) => {
    const socket = connect({ host, port });
    let buffer = "";
    let responded = false;
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(body)}\n`);
    });
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const idx = buffer.indexOf("\n");
      if (idx !== -1 && !responded) {
        responded = true;
        const response = JSON.parse(buffer.slice(0, idx)) as Record<string, unknown>;
        // Give the server a moment to destroy the connection (it does so
        // synchronously right after writing, but the FIN/RST needs one
        // more tick to be observed on this side).
        setTimeout(() => {
          resolvePromise({ response, serverClosed: socket.destroyed || socket.readableEnded });
        }, 100);
      }
    });
    socket.on("error", reject);
  });
}

test(
  "end-to-end: one acquire over the TCP control plane spawns exactly one stub child, writes its epoch, grants, and connection-close identity-verified-kills it",
  { timeout: 20000 },
  async () => {
    build(); // ensure resources/ is a fresh build of the current TypeScript source
    const stateDir = mkdtempSync(join(tmpdir(), "broker-e2e-"));
    const handle = startBroker(stateDir);
    try {
      const brokerJson = await waitForBrokerJson(stateDir);
      assert.equal(brokerJson.control_host, "0.0.0.0", `container.json contents: ${JSON.stringify(brokerJson)}`);

      const acquired = await acquireOverControlPlane(stateDir);
      const grant = acquired.grant;

      assert.ok(Number.isInteger(grant.port) && grant.port >= 6600, `grant.port must be an integer >= 6600, got ${grant.port}`);
      assert.equal(typeof grant.url, "string");
      assert.equal(typeof grant.epoch_file, "string");
      assert.equal(typeof grant.supervisor_dir, "string");
      assert.equal(typeof grant.id, "string");

      // Exactly one child spawned: exactly one per-port directory under
      // stateDir carrying an epoch.json.
      const portDirs = readdirSync(stateDir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d+$/.test(d.name));
      assert.equal(portDirs.length, 1, `expected exactly one instance directory, found ${JSON.stringify(portDirs.map((d) => d.name))}`);

      assert.ok(existsSync(grant.epoch_file), `epoch file must exist at ${grant.epoch_file}`);
      const epoch = JSON.parse(readFileSync(grant.epoch_file, "utf8"));
      assert.equal(typeof epoch.pid, "number");
      assert.ok(isAlive(epoch.pid), `spawned child pid ${epoch.pid} must be alive right after grant`);

      const childPid: number = epoch.pid;

      // Connection close IS the release -- assert the child is gone within
      // a deadline, never on a wall-clock sleep alone.
      acquired.release();
      const gone = await waitFor(() => !isAlive(childPid), 5000);
      assert.ok(gone, `spawned child pid ${childPid} must be gone within deadline after connection close`);
    } finally {
      await stopBroker(handle);
      rmSync(stateDir, { recursive: true, force: true });
    }
  },
);

// ---------------------------------------------------------------------------
// 01.6.2-12-PLAN.md, Task 1 (gap closure -- CR-01, criterion C2, D-04): the
// end-to-end proof that per-instance crash supervision is a real, wired
// property of the RUNNING broker -- not merely of superviseChild() in
// isolation (broker-launch.test.ts already covers that function's own
// backoff/give-up/deliberate-kill behavior against a fully controlled stub;
// this test instead kills a REAL granted child out from under the REAL
// spawned broker artifact and watches the respawn happen through the whole
// stack: withCrashSupervision() -> handleExit() -> launchSupervised() ->
// tryLaunchOne() -> a fresh epoch.json on disk). VICE_RESTART_BACKOFF_S=0
// keeps the test fast without touching the respawn logic itself -- the
// backoff duration is not what this test is proving.
// ---------------------------------------------------------------------------

test(
  "wired supervision: a granted stub child killed out from under the real broker is respawned on the SAME port, its epoch advances, and exactly one instance directory remains",
  { timeout: 20000 },
  async () => {
    build();
    const stateDir = mkdtempSync(join(tmpdir(), "broker-e2e-supervise-cold-"));
    const handle = startBroker(stateDir, { VICE_RESTART_BACKOFF_S: "0" });
    try {
      await waitForBrokerJson(stateDir);
      const acquired = await acquireOverControlPlane(stateDir);
      const grant = acquired.grant;

      const epochBefore = JSON.parse(readFileSync(grant.epoch_file, "utf8"));
      const pidBefore: number = epochBefore.pid;
      assert.equal(typeof pidBefore, "number");
      assert.ok(isAlive(pidBefore), `granted child pid ${pidBefore} must be alive before the kill`);

      // Kill the granted child from OUTSIDE the broker with an uncatchable
      // signal -- the broker sees an unexplained exit, exactly the crash
      // shape withCrashSupervision()'s exit listener exists to observe.
      process.kill(pidBefore, "SIGKILL");
      const killedChildGone = await waitFor(() => !isAlive(pidBefore), 5000);
      assert.ok(killedChildGone, `killed child pid ${pidBefore} must actually exit before a respawn can be observed`);

      const respawned = await waitFor(() => {
        let epoch: Record<string, unknown>;
        try {
          epoch = JSON.parse(readFileSync(grant.epoch_file, "utf8"));
        } catch {
          return false;
        }
        return (
          typeof epoch.epoch === "number" &&
          epoch.epoch > epochBefore.epoch &&
          typeof epoch.pid === "number" &&
          epoch.pid !== pidBefore &&
          isAlive(epoch.pid as number)
        );
      }, 10000);
      assert.ok(respawned, "the killed instance must be respawned on the same port with an advanced epoch and a new, live pid within the deadline");

      const epochAfter = JSON.parse(readFileSync(grant.epoch_file, "utf8"));
      assert.equal(epochAfter.epoch, epochBefore.epoch + 1, "the epoch integer must advance by exactly one on respawn");
      assert.notEqual(epochAfter.pid, pidBefore, "the respawned child must be a DIFFERENT pid from the killed one");
      assert.ok(isAlive(epochAfter.pid), "the respawned child's pid must answer a zero-signal liveness check");

      const portDirs = readdirSync(stateDir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d+$/.test(d.name));
      assert.equal(portDirs.length, 1, `exactly one instance directory must exist after the respawn, found ${JSON.stringify(portDirs.map((d) => d.name))}`);
      assert.equal(Number(portDirs[0].name), grant.port, "the respawned instance must occupy the SAME port the original grant named");

      assert.equal(handle.child.exitCode, null, "the broker process itself must still be running after the respawn");
      assert.equal(handle.child.signalCode, null, "the broker process itself must not have been signalled");

      acquired.release();
    } finally {
      await stopBroker(handle);
      rmSync(stateDir, { recursive: true, force: true });
    }
  },
);

// ---------------------------------------------------------------------------
// 01.6.2-12-PLAN.md, Task 2: expands the proven slice to the warm-floor
// launch path. maintainWarmFloor()'s own no-mechanism branch warms ZERO
// speculative spares by design (broker-launch.mts's own comment), so this
// test supplies a trivial always-succeeding executable as
// VICE_BROKER_PROBE_CMD -- without a readiness mechanism, this test would
// observe no spare and prove nothing about the warm-floor wiring. The warm
// floor is configured to 1 via VICE_BROKER_SPARES so the instance-directory
// count assertions below are unambiguous (recorded here and in the plan's
// own SUMMARY for reproducibility).
// ---------------------------------------------------------------------------

test(
  "wired supervision: a warm-floor stub child killed out from under the real broker is respawned on the same port by the same wrapper",
  { timeout: 20000 },
  async () => {
    build();
    const WARM_FLOOR = 1;
    const stateDir = mkdtempSync(join(tmpdir(), "broker-e2e-supervise-warm-"));
    const probeDir = mkdtempSync(join(tmpdir(), "broker-e2e-probe-"));
    const probeScript = join(probeDir, "always-ready.sh");
    writeFileSync(probeScript, "#!/bin/sh\nexit 0\n");
    chmodSync(probeScript, 0o755);
    const handle = startBroker(stateDir, {
      VICE_RESTART_BACKOFF_S: "0",
      VICE_BROKER_PROBE_CMD: probeScript,
      VICE_BROKER_SPARES: String(WARM_FLOOR),
    });
    try {
      await waitForBrokerJson(stateDir);

      // The periodic evaluation pass, not this test, decides when the spare
      // actually launches -- poll for its instance directory to appear
      // rather than assuming a fixed number of poll intervals have elapsed.
      const warmInstanceAppeared = await waitFor(() => {
        const dirs = readdirSync(stateDir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d+$/.test(d.name));
        return dirs.length >= 1;
      }, 10000);
      assert.ok(warmInstanceAppeared, "a warm spare must be launched by the periodic evaluation pass within the deadline");

      const portDirsBefore = readdirSync(stateDir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d+$/.test(d.name));
      assert.equal(
        portDirsBefore.length,
        WARM_FLOOR,
        `exactly the configured warm floor (${WARM_FLOOR}) of instance directories must exist, found ${JSON.stringify(portDirsBefore.map((d) => d.name))}`,
      );
      const warmPort = Number(portDirsBefore[0].name);
      const epochPath = join(stateDir, portDirsBefore[0].name, "epoch.json");

      const epochAppeared = await waitFor(() => {
        try {
          const parsed = JSON.parse(readFileSync(epochPath, "utf8"));
          return typeof parsed.pid === "number";
        } catch {
          return false;
        }
      }, 5000);
      assert.ok(epochAppeared, "the warm spare's epoch.json must carry a pid within the deadline");

      const epochBefore = JSON.parse(readFileSync(epochPath, "utf8"));
      const pidBefore: number = epochBefore.pid;
      assert.ok(isAlive(pidBefore), `warm spare pid ${pidBefore} must be alive before the kill`);

      // Kill the warm spare from OUTSIDE the broker, exactly like the
      // cold-acquire proof above -- the SAME wrapper must observe this exit
      // regardless of which launch path produced the child.
      process.kill(pidBefore, "SIGKILL");
      const killedGone = await waitFor(() => !isAlive(pidBefore), 5000);
      assert.ok(killedGone, `killed warm spare pid ${pidBefore} must actually exit before a respawn can be observed`);

      const respawned = await waitFor(() => {
        let epoch: Record<string, unknown>;
        try {
          epoch = JSON.parse(readFileSync(epochPath, "utf8"));
        } catch {
          return false;
        }
        return (
          typeof epoch.epoch === "number" &&
          epoch.epoch > epochBefore.epoch &&
          typeof epoch.pid === "number" &&
          epoch.pid !== pidBefore &&
          isAlive(epoch.pid as number)
        );
      }, 10000);
      assert.ok(respawned, "the killed warm spare must be respawned on the same port with an advanced epoch and a new, live pid within the deadline");

      const epochAfter = JSON.parse(readFileSync(epochPath, "utf8"));
      assert.equal(epochAfter.epoch, epochBefore.epoch + 1, "the epoch integer must advance by exactly one on respawn");

      // The respawn must not be double-counted as an additional spare --
      // poll for the ABSENCE of a second instance directory within a
      // bounded deadline, using the SAME predicate-polling helper (inverted)
      // rather than sleeping a fixed duration and hoping nothing appeared.
      const extraSpareAppeared = await waitFor(() => {
        const dirs = readdirSync(stateDir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d+$/.test(d.name));
        return dirs.length > WARM_FLOOR;
      }, 1500);
      assert.equal(extraSpareAppeared, false, "the respawn must not be read as an additional spare, warming a second one on top of it");

      const portDirsAfter = readdirSync(stateDir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d+$/.test(d.name));
      assert.equal(
        portDirsAfter.length,
        WARM_FLOOR,
        `exactly the configured warm floor (${WARM_FLOOR}) of instance directories must remain after the respawn, found ${JSON.stringify(portDirsAfter.map((d) => d.name))}`,
      );
      assert.equal(Number(portDirsAfter[0].name), warmPort, "the respawned instance must occupy the SAME port the warm spare originally held");

      assert.equal(handle.child.exitCode, null, "the broker process itself must still be running after the respawn");
      assert.equal(handle.child.signalCode, null, "the broker process itself must not have been signalled");
    } finally {
      await stopBroker(handle);
      rmSync(stateDir, { recursive: true, force: true });
      rmSync(probeDir, { recursive: true, force: true });
    }
  },
);

// ---------------------------------------------------------------------------
// 01.6.2-13-PLAN.md, Task 3: the wired proof that recycle respawns and
// release does not, both against the real spawned broker artifact -- the
// direction plan 12 wired but plan 13's marker split (Tasks 1-2, above) is
// what makes SAFE to reach through the real control plane rather than only
// through superviseChild() in isolation (broker-launch.test.ts already
// covers the recycle branch's own behavior against a fully controlled
// stub).
//
// A recycle's OWNERSHIP check (broker-control.mts) requires the recycle's
// target_id to be the SAME requestId the acquiring connection itself holds
// -- both tests below therefore hold ONE connection across both requests.
// openBrokerControl()'s own session.recycle() discards the ack's
// epoch_before field (it only returns outcome/kill_stage/reason), so proving
// "epoch-before carries the recorded integer, not an absent value" needs
// the raw wire-level ack -- per this task's own instruction, this is done
// with a raw-request helper local to THIS test file (generalising
// rawAcquire() above to hold one connection across several round trips),
// never by adding a field to vice-broker-client.ts for a test's
// convenience.
// ---------------------------------------------------------------------------

/** A held raw connection supporting several sequential request/response
 * round trips over ONE socket -- generalises rawAcquire() above (which
 * sends exactly one line and is done) for this task's own proof, which
 * needs ONE connection to both acquire AND recycle (broker-control.mts's
 * own ownership discipline: a connection may only recycle the grant it
 * itself holds). Test-local infrastructure only -- never touches
 * vice-broker-client.ts. */
function makeRawSession(host: string, port: number) {
  const socket = connect({ host, port });
  const responses: Record<string, unknown>[] = [];
  const waiters: Array<(v: Record<string, unknown>) => void> = [];
  let buffer = "";
  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.trim() === "") continue;
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const waiter = waiters.shift();
      if (waiter) waiter(parsed);
      else responses.push(parsed);
    }
  });
  return {
    send(obj: Record<string, unknown>): void {
      socket.write(`${JSON.stringify(obj)}\n`);
    },
    next(timeoutMs = 5000): Promise<Record<string, unknown>> {
      if (responses.length > 0) return Promise.resolve(responses.shift()!);
      return new Promise((resolvePromise, reject) => {
        const timer = setTimeout(() => reject(new Error(`no response within ${timeoutMs}ms`)), timeoutMs);
        waiters.push((v) => {
          clearTimeout(timer);
          resolvePromise(v);
        });
      });
    },
    close(): void {
      socket.destroy();
    },
  };
}

test(
  "wired recycle: a recycle over the real control plane kills the granted child and the real broker brings a new one back on the SAME port with the epoch advanced",
  { timeout: 20000 },
  async () => {
    build();
    const stateDir = mkdtempSync(join(tmpdir(), "broker-e2e-recycle-"));
    // VICE_BROKER_SPARES=0: this test's port-count and pid-stability
    // assertions are only meaningful if NOTHING besides this test's own
    // acquire/recycle sequence ever launches or frees a port. Node's global
    // fetch gives maintainWarmFloor() a real HTTP readiness mechanism by
    // default (never "no_mechanism"), so leaving the warm floor at its
    // default of 3 would auto-launch speculative spares on other free ports
    // during this test's own wait windows -- disabling it here isolates the
    // scenario this test is actually proving.
    const handle = startBroker(stateDir, { VICE_RESTART_BACKOFF_S: "0", VICE_BROKER_POLL_MS: "100", VICE_BROKER_SPARES: "0" });
    try {
      const brokerJson = await waitForBrokerJson(stateDir);
      const host = String(brokerJson.control_host);
      const port = Number(brokerJson.control_port);
      const token = String(brokerJson.control_token);

      const client = makeRawSession(host, port);
      try {
        // Acquire and recycle over the SAME connection -- the ownership
        // check requires it (T-01.6.2-31).
        const grantId = "recycle-proof-acquire";
        client.send({ op: "acquire", id: grantId, token });
        const grantResp = await client.next();
        assert.equal(grantResp.kind, "grant", `expected a grant, got: ${JSON.stringify(grantResp)}`);
        const grantPort = Number(grantResp.port);
        const epochFile = String(grantResp.epoch_file);

        const epochBefore = JSON.parse(readFileSync(epochFile, "utf8"));
        const pidBefore: number = epochBefore.pid;
        const epochNumBefore: number = epochBefore.epoch;
        assert.equal(typeof pidBefore, "number");
        assert.ok(isAlive(pidBefore), `granted child pid ${pidBefore} must be alive before the recycle`);

        client.send({ op: "recycle", id: "recycle-proof-recycle", target_id: grantId, token });
        const ack = await client.next();
        assert.equal(ack.kind, "recycle_ack", `expected a recycle_ack, got: ${JSON.stringify(ack)}`);
        assert.equal(ack.outcome, "ok", `recycle ack outcome must be "ok": ${JSON.stringify(ack)}`);
        assert.notEqual(ack.epoch_before, null, "the epoch-before field must carry the recorded integer, not an absent value");
        assert.equal(ack.epoch_before, epochNumBefore, "the epoch-before field must carry the SAME integer the instance held before the kill");

        const respawned = await waitFor(() => {
          let epoch: Record<string, unknown>;
          try {
            epoch = JSON.parse(readFileSync(epochFile, "utf8"));
          } catch {
            return false;
          }
          return (
            typeof epoch.epoch === "number" &&
            epoch.epoch > epochNumBefore &&
            typeof epoch.pid === "number" &&
            epoch.pid !== pidBefore &&
            isAlive(epoch.pid as number)
          );
        }, 10000);
        assert.ok(respawned, "the recycled instance must be respawned on the same port with an advanced epoch and a new, live pid within the deadline");

        const epochAfter = JSON.parse(readFileSync(epochFile, "utf8"));
        assert.equal(epochAfter.epoch, epochNumBefore + 1, "the epoch integer must advance by exactly one on recycle");
        assert.notEqual(epochAfter.pid, pidBefore, "the respawned child must be a DIFFERENT pid from the killed one");

        const portDirs = readdirSync(stateDir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d+$/.test(d.name));
        assert.equal(portDirs.length, 1, `exactly one instance directory must exist after the recycle, found ${JSON.stringify(portDirs.map((d) => d.name))}`);
        assert.equal(Number(portDirs[0].name), grantPort, "the recycled instance must occupy the SAME port the grant named");

        client.send({ op: "status", token });
        const status = await client.next();
        assert.equal(status.kind, "status");
        const instances = status.instances as Array<Record<string, unknown>>;
        const onRecycledPort = instances.filter((i) => Number(i.port) === grantPort);
        assert.equal(instances.length, 1, `exactly one instance must be reported after the recycle, got ${JSON.stringify(instances)}`);
        assert.equal(onRecycledPort.length, 1, `exactly one instance must be reported on the recycled port ${grantPort}, got ${JSON.stringify(instances)}`);

        client.send({ op: "release", token });
        await client.next();
      } finally {
        client.close();
      }
    } finally {
      await stopBroker(handle);
      rmSync(stateDir, { recursive: true, force: true });
    }
  },
);

test(
  "wired release: a release over the real control plane kills the granted child and no replacement appears -- kill-never-recycle holds with supervision wired",
  { timeout: 20000 },
  async () => {
    build();
    const POLL_MS = 100;
    const stateDir = mkdtempSync(join(tmpdir(), "broker-e2e-release-"));
    // VICE_BROKER_SPARES=0: same isolation reasoning as the recycle test
    // above -- a release frees its port back to the allocator, and an
    // auto-warmed spare landing on that SAME now-free port would rewrite
    // this test's own epoch.json with an unrelated pid, corrupting the
    // exact "no replacement appears" assertion this test exists to make.
    const handle = startBroker(stateDir, { VICE_RESTART_BACKOFF_S: "0", VICE_BROKER_POLL_MS: String(POLL_MS), VICE_BROKER_SPARES: "0" });
    try {
      const brokerJson = await waitForBrokerJson(stateDir);
      const host = String(brokerJson.control_host);
      const port = Number(brokerJson.control_port);
      const token = String(brokerJson.control_token);

      const client = makeRawSession(host, port);
      try {
        client.send({ op: "acquire", id: "release-proof-acquire", token });
        const grantResp = await client.next();
        assert.equal(grantResp.kind, "grant", `expected a grant, got: ${JSON.stringify(grantResp)}`);
        const grantPort = Number(grantResp.port);
        const epochFile = String(grantResp.epoch_file);

        const epochBefore = JSON.parse(readFileSync(epochFile, "utf8"));
        const pidBefore: number = epochBefore.pid;
        assert.ok(isAlive(pidBefore), `granted child pid ${pidBefore} must be alive before the release`);

        client.send({ op: "release", token });
        const released = await client.next();
        assert.equal(released.kind, "released");

        const gone = await waitFor(() => !isAlive(pidBefore), 5000);
        assert.ok(gone, `released child pid ${pidBefore} must be gone within deadline`);

        // Past AT LEAST two evaluation passes -- the poll interval is
        // configured explicitly above (100ms) so this is a known quantity:
        // waiting 2 * POLL_MS plus margin guarantees at least two passes
        // have run since the release completed.
        await new Promise((r) => setTimeout(r, POLL_MS * 2 + 250));

        const epochAfter = JSON.parse(readFileSync(epochFile, "utf8"));
        assert.equal(epochAfter.epoch, epochBefore.epoch, "no new epoch generation may appear at this port after a release");
        assert.equal(epochAfter.pid, pidBefore, "the epoch record's own pid must not change after a release -- nothing may have respawned it");
        assert.ok(!isAlive(epochAfter.pid), "no live pid may answer at this port after a release");

        client.send({ op: "status", token });
        const status = await client.next();
        assert.equal(status.kind, "status");
        const instances = status.instances as Array<Record<string, unknown>>;
        const onReleasedPort = instances.filter((i) => Number(i.port) === grantPort);
        assert.equal(onReleasedPort.length, 0, `the status response must list no instance on the released port ${grantPort}, got ${JSON.stringify(instances)}`);
      } finally {
        client.close();
      }
    } finally {
      await stopBroker(handle);
      rmSync(stateDir, { recursive: true, force: true });
    }
  },
);

test("a control request with no token, and one with a wrong token, both return the unauthorized error code, are disconnected, and leave the spawn count unchanged", { timeout: 20000 }, async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "broker-e2e-auth-"));
  const handle = startBroker(stateDir);
  try {
    const brokerJson = await waitForBrokerJson(stateDir);
    const host = String(brokerJson.control_host);
    const port = Number(brokerJson.control_port);

    const noToken = await rawAcquire(host, port, { op: "acquire", id: "req-no-token" });
    assert.equal(noToken.response.kind, "error");
    assert.equal(noToken.response.code, "unauthorized");

    const wrongToken = await rawAcquire(host, port, { op: "acquire", id: "req-wrong-token", token: "0".repeat(64) });
    assert.equal(wrongToken.response.kind, "error");
    assert.equal(wrongToken.response.code, "unauthorized");

    // Neither request allocated an instance directory.
    const portDirs = readdirSync(stateDir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d+$/.test(d.name));
    assert.equal(portDirs.length, 0, `unauthorized requests must not spawn anything, found ${JSON.stringify(portDirs.map((d) => d.name))}`);
  } finally {
    await stopBroker(handle);
    rmSync(stateDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 01.6.2-10-PLAN.md ledger row 35 (RE-OBSERVED): the retiring bash suite's
// "bash -n exits 0; start still refuses in-container with exit 2;
// --check-container still exits 3" structural test asserted the container
// guard's exit-code contract directly against resources/vice-broker.sh. The
// new broker wires the SAME container-guard.mts functions
// (containerGuardEnforce()/containerGuardReport(), pre-existing and unchanged
// -- vice-broker.mts:650/654) but no test spawned the real emitted artifact
// to prove the wiring itself (as opposed to the guard functions in
// isolation, which container-guard.test.ts already covers). This container
// genuinely fires container signals (the retiring test's own comment already
// establishes that), so this is a real, not simulated, in-container run.
// ---------------------------------------------------------------------------

test("the emitted broker artifact refuses to start in-container without the escape hatch (exit 2), and --check-container reports the same verdict without refusing (exit 3)", { timeout: 20000 }, async () => {
  build();
  const stateDir = mkdtempSync(join(tmpdir(), "broker-e2e-guard-"));
  try {
    // No VICE_SUPERVISOR_ALLOW_CONTAINER escape hatch here -- deliberately
    // the opposite of every other test in this file, which sets it via
    // startBroker()'s own env block.
    const refused = spawn(process.execPath, [BROKER_ARTIFACT, "--repo-root", "/tmp/fake-repo-root-e2e", "--state-dir", stateDir], {
      env: { ...process.env, VICE_SUPERVISOR_ALLOW_CONTAINER: "", VICE_BIN: "/bin/sleep", VICE_ARGS: "600" },
    });
    const refusedCode = await new Promise<number | null>((resolvePromise) => {
      refused.once("exit", (code) => resolvePromise(code));
    });
    assert.equal(refusedCode, 2, "starting in-container with no escape hatch must exit 2");
    assert.equal(existsSync(join(stateDir, "broker.json")), false, "a refused start must never write broker.json");

    const reported = spawn(process.execPath, [BROKER_ARTIFACT, "--check-container"], {
      env: { ...process.env, VICE_SUPERVISOR_ALLOW_CONTAINER: "" },
    });
    const reportedCode = await new Promise<number | null>((resolvePromise) => {
      reported.once("exit", (code) => resolvePromise(code));
    });
    assert.equal(reportedCode, 3, "--check-container must report the container verdict (exit 3) without refusing outright");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// verifiedKill() (broker-kill.mts): the identity-verified kill discipline,
// exercised directly (in-process) against a real stub child -- this is the
// one test in this task's scope asserting it refuses to signal a mismatched
// identity, per this task's own acceptance criteria.
// ---------------------------------------------------------------------------

test("verifiedKill: refuses to signal when the recorded identity does not appear in the target process's own argument string", async () => {
  const child = spawn("/bin/sleep", ["30"]);
  const pid = child.pid;
  assert.ok(typeof pid === "number");
  try {
    await waitFor(() => isAlive(pid), 2000);

    const stage = await verifiedKill({ pid, expectedIdentity: "/definitely/not/the/real/binary" });
    assert.equal(stage, "identity_refused");
    assert.ok(isAlive(pid), "a pid failing the identity check must be left alive, never signalled");
  } finally {
    child.kill("SIGKILL");
  }
});

test("verifiedKill: a genuine identity match proceeds to SIGTERM and returns 'sigterm' once the process exits", async () => {
  const child = spawn("/bin/sleep", ["30"]);
  const pid = child.pid;
  assert.ok(typeof pid === "number");
  try {
    await waitFor(() => isAlive(pid), 2000);

    const stage = await verifiedKill({ pid, expectedIdentity: "/bin/sleep" });
    assert.equal(stage, "sigterm");
    const gone = await waitFor(() => !isAlive(pid), 2000);
    assert.ok(gone);
  } finally {
    if (isAlive(pid)) child.kill("SIGKILL");
  }
});

test("verifiedKill: an already-exited pid returns 'already_exited' without ever signalling", async () => {
  const child = spawn("/bin/true", []);
  const pid = child.pid;
  assert.ok(typeof pid === "number");
  await waitFor(() => !isAlive(pid), 2000);

  const stage = await verifiedKill({ pid, expectedIdentity: "/bin/true" });
  assert.equal(stage, "already_exited");
});
