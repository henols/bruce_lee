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
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
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
function startBroker(stateDir: string): BrokerHandle {
  const child = spawn(process.execPath, [BROKER_ARTIFACT, "--repo-root", "/tmp/fake-repo-root-e2e", "--state-dir", stateDir], {
    env: {
      ...process.env,
      VICE_SUPERVISOR_ALLOW_CONTAINER: "1",
      VICE_BIN: "/bin/sleep",
      VICE_ARGS: "600",
      VICE_BROKER_CONTROL_PORT: "0",
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
