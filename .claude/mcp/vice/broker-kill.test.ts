// broker-kill.test.ts
//
// Plan 04 (01.6.2), Task 1: the identity-verified kill discipline's own test
// file -- proving its CORRECTED expected-identity parameterisation (never a
// module constant) and its four-word stage contract. Every kill test here is
// driven against a real spawned stub child (/bin/sleep, /bin/cat) or a fully
// injected fake -- never a real emulator, and no test opens a connection to
// the host VICE. Task 2 (shutdown wiring) and Task 3 (the startup reap)
// extend this file with their own sections below this one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn as realSpawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { verifiedKill, type KillStage, type VerifiedKillDeps } from "./broker-kill.mts";

const HERE = dirname(fileURLToPath(import.meta.url));

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
