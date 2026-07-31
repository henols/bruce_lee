#!/usr/bin/env node
// Driver for spike 002 -- the measurement that can still invalidate the
// Phase 01.2 design.
//
// Usage: node run-experiments.mjs [f1|f2|f3|f4|f5|all]
//
// THE QUESTION. The design makes lease release a single synchronous
// `unlinkSync` in the proxy's shutdown handler, because the host broker can
// only be told "this session is over" by the lease file's absence. If the real
// shutdown window is too short for even that one syscall, automatic release on
// session end is not achievable and release becomes sweeper-only -- a
// different design, not an adjustment.
//
// Spike 001 already showed, six times out of six, that the ladder is NOT the
// documented `stdin EOF -> SIGTERM -> SIGKILL`: it opened with SIGINT, stdin
// was never closed, and SIGTERM followed 100ms later. So this spike measures
// two things the design note gets wrong or does not know:
//   1. Which trigger actually fires first, under BOTH print mode and a
//      long-lived stream-json session (closer to the interactive client).
//   2. How many milliseconds of synchronous work complete before the process
//      is killed outright.
//
// It reuses spike 001's echo-proxy.mjs rather than forking it, so both spikes
// measure the same instrument and their logs are directly comparable.

import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGS = join(HERE, "logs");
const PROXY = resolve(HERE, "..", "001-echo-proxy-lifecycle-harness", "echo-proxy.mjs");
const MCP_CONFIG = join(LOGS, "scratch-mcp.json");
const LOG = join(LOGS, "002-shutdown.jsonl");
const LEASES = join(LOGS, "leases");

mkdirSync(LOGS, { recursive: true });
mkdirSync(LEASES, { recursive: true });
writeFileSync(
  MCP_CONFIG,
  JSON.stringify({ mcpServers: { probe: { command: "node", args: [PROXY] } } }, null, 2) + "\n",
);

const TOOL = "mcp__probe__echo_probe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function leaseFiles() {
  try {
    return readdirSync(LEASES);
  } catch {
    return [];
  }
}

// Any proxy left running after an experiment is an orphan by definition: its
// client is gone. Reaping them between experiments keeps one experiment's
// leftovers out of the next one's pid count -- and the reap count is itself
// evidence for how the abrupt-death cases behave.
//
// NOTE ON THE MATCH PATTERN, learned the hard way: `pgrep -f echo-proxy.mjs`
// also matches the `bash -lc "pgrep -f echo-proxy.mjs"` wrapper running the
// search, so it reports a phantom orphan on every single call -- which briefly
// made it look as though proxies were surviving their clients. The match must
// require the process to be a `node` invocation, and must exclude this
// process's own children.
function reapOrphanProxies(label) {
  const ps = spawnSync(
    "bash",
    ["-c", `ps -eo pid=,args= | grep -E '[0-9]+ +[^ ]*node .*echo-proxy\\.mjs' | awk '{print $1}' || true`],
    { encoding: "utf8" },
  );
  const pids = (ps.stdout || "").trim().split("\n").filter(Boolean);
  if (pids.length) {
    console.log(`  [${label}] reaping ${pids.length} orphaned proxy pid(s): ${pids.join(",")}`);
    spawnSync("bash", ["-lc", `kill -9 ${pids.join(" ")} 2>/dev/null || true`]);
  }
  return pids.length;
}

function baseArgs() {
  return [
    "--strict-mcp-config",
    "--mcp-config",
    MCP_CONFIG,
    "--model",
    "haiku",
    "--permission-mode",
    "bypassPermissions",
    "--tools",
    TOOL,
  ];
}

function childEnv(tag, extra) {
  return {
    ...process.env,
    ECHO_LOG: LOG,
    ECHO_TAG: tag,
    ECHO_LEASE_DIR: LEASES,
    ...extra,
  };
}

// ---------------------------------------------------------------- print mode
// A normal `claude -p` run. The client decides when the session is over and
// tears the server down on its own schedule -- which is what spike 001 saw.
function runPrint({ tag, prompt, env = {}, timeoutMs = 240000 }) {
  return new Promise((resolve) => {
    const args = ["-p", prompt, ...baseArgs()];
    const started = Date.now();
    const child = spawn("claude", args, { cwd: HERE, env: childEnv(tag, env), stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const killer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(killer);
      writeFileSync(join(LOGS, `${tag}.cli.txt`), `# ${tag}\n# exit code=${code} signal=${signal} elapsed=${Date.now() - started}ms\n\n## stdout\n${out}\n\n## stderr\n${err}\n`);
      console.log(`  [${tag}] client exit code=${code} signal=${signal} ${Date.now() - started}ms`);
      resolve({ code, signal, out, err });
    });
  });
}

// ----------------------------------------------------- long-lived stream mode
// `--input-format stream-json` keeps the session alive for as long as stdin
// stays open, which is the closest thing available to an interactive session:
// the CLIENT does not decide when to stop, WE do. That makes it the only way
// to test a specific ending -- clean stdin close, SIGTERM, or SIGKILL -- rather
// than whatever print mode happens to do.
//
// `ending` is applied once the session has answered one message:
//   "stdin-close" -> end our write side, the documented graceful path
//   "sigterm"     -> SIGTERM the client, as a window-close might
//   "sigkill"     -> SIGKILL the client, the abrupt-death case
function runStream({ tag, prompt, ending, env = {}, settleMs = 2500, timeoutMs = 240000 }) {
  return new Promise((resolve) => {
    const args = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      ...baseArgs(),
    ];
    const started = Date.now();
    const child = spawn("claude", args, { cwd: HERE, env: childEnv(tag, env), stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let sawResult = false;
    let endingApplied = null;

    const applyEnding = async () => {
      if (endingApplied) return;
      endingApplied = ending;
      // Let the client settle before ending it, so the teardown is not racing
      // the tail of a turn -- otherwise a missing release could be blamed on
      // the window when it was really mid-flight work.
      await sleep(settleMs);
      console.log(`  [${tag}] applying ending: ${ending} (client pid ${child.pid})`);
      if (ending === "stdin-close") child.stdin.end();
      else if (ending === "sigterm") child.kill("SIGTERM");
      else if (ending === "sigkill") child.kill("SIGKILL");
    };

    child.stdout.on("data", (d) => {
      out += d;
      // The `result` message marks the end of a turn.
      if (!sawResult && /"type"\s*:\s*"result"/.test(out)) {
        sawResult = true;
        applyEnding();
      }
    });
    child.stderr.on("data", (d) => (err += d));

    child.stdin.write(
      JSON.stringify({
        type: "user",
        message: { role: "user", content: `Call the ${TOOL} tool once with text set to "${tag}", then reply with just its output.` },
      }) + "\n",
    );

    const killer = setTimeout(() => {
      console.log(`  [${tag}] timeout reached, forcing ending`);
      applyEnding().then(() => setTimeout(() => child.kill("SIGKILL"), 3000));
    }, timeoutMs);

    child.on("close", (code, signal) => {
      clearTimeout(killer);
      writeFileSync(
        join(LOGS, `${tag}.cli.txt`),
        `# ${tag}\n# ending=${ending} sawResult=${sawResult}\n# exit code=${code} signal=${signal} elapsed=${Date.now() - started}ms\n\n## stdout\n${out}\n\n## stderr\n${err}\n`,
      );
      console.log(`  [${tag}] client exit code=${code} signal=${signal} ${Date.now() - started}ms (sawResult=${sawResult})`);
      resolve({ code, signal, out, err, sawResult });
    });
  });
}

async function report(tag, note) {
  // Give any post-death handler a moment to write before reading the aftermath.
  await sleep(1500);
  const leftover = leaseFiles();
  console.log(`  [${tag}] lease files left behind: ${leftover.length}${leftover.length ? " -> " + leftover.join(",") : ""}`);
  console.log(`  [${tag}] ${note}`);
  const reaped = reapOrphanProxies(tag);
  // Clear leases between experiments so each aftermath check is unambiguous.
  for (const f of leaseFiles()) {
    try {
      rmSync(join(LEASES, f));
    } catch {}
  }
  return { leftover, reaped };
}

// f1 -- THE LADDER, PRINT MODE, NON-BLOCKING HANDLERS.
// teardownMode=log means nothing blocks the event loop, so every signal that
// arrives is recorded with its timestamp. This is the clean read of the ladder,
// and it also answers the primary question: does the one synchronous
// `unlinkSync` release land?
async function f1() {
  console.log("\n[f1] print mode, non-blocking handlers: the real ladder + does unlinkSync land?");
  await runPrint({
    tag: "f1-ladder-print",
    prompt: `Call the ${TOOL} tool once with text set to "f1", then reply with just its output.`,
    env: { ECHO_TEARDOWN_MODE: "log" },
  });
  await report("f1-ladder-print", "expect: lease unlinked in-handler, so 0 left behind");
}

// f2 -- HOW MUCH SYNCHRONOUS WORK FITS IN THE WINDOW.
// The handler releases the lease, then busy-waits in 100ms slices writing a
// progress line each time, up to a 5s budget it is not expected to reach. The
// LAST progress line in the log is the answer: that many ms of synchronous
// work completed before the process was killed.
// The slice is 10ms rather than the 100ms the source todo suggested: the first
// run at 100ms showed the window closing at ~400ms, which 100ms granularity
// can only bracket to ±100ms. Repeated three times because a single sample
// cannot distinguish a fixed client-side timer from scheduling noise.
async function f2() {
  console.log("\n[f2] print mode, busy-waiting handler: how many ms of sync work complete?");
  for (const run of [1, 2, 3]) {
    await runPrint({
      tag: `f2-busywait-print-r${run}`,
      prompt: `Call the ${TOOL} tool once with text set to "f2r${run}", then reply with just its output.`,
      env: { ECHO_TEARDOWN_MODE: "busywait", ECHO_BUSYWAIT_BUDGET_MS: "8000", ECHO_BUSYWAIT_SLICE_MS: "10" },
    });
    await report(`f2-busywait-print-r${run}`, "the last busywait_progress line is the measured window");
  }
}

// f3 -- IS stdin EOF EVER THE TRIGGER?
// A long-lived stream-json session, ended by closing our write side of stdin.
// This is the documented graceful path and the one the design note describes
// first. If stdin_end fires here but never in print mode, then the trigger a
// proxy must key on depends on how the session was started -- which means it
// has to handle both.
async function f3() {
  console.log("\n[f3] long-lived stream session, ended by closing stdin: does stdin EOF fire?");
  await runStream({ tag: "f3-stdin-close", ending: "stdin-close", env: { ECHO_TEARDOWN_MODE: "log" } });
  await report("f3-stdin-close", "expect: stdin_end/stdin_close observed, lease released");
}

// f4 -- ABRUPT CLIENT DEATH.
// SIGKILL the client outright. The design note asserts "the SIGKILL path gets
// nothing", which makes the host sweeper mandatory. But when a parent dies its
// pipes close, so the proxy may well observe stdin closing and get to release
// after all. Whether it does decides whether the sweeper is the ONLY
// protection or merely the backstop.
async function f4() {
  console.log("\n[f4] long-lived stream session, client SIGKILLed: does anything clean up?");
  await runStream({ tag: "f4-client-sigkill", ending: "sigkill", env: { ECHO_TEARDOWN_MODE: "log" } });
  await report("f4-client-sigkill", "if a lease is left behind, the TTL sweeper is the only protection");
}

// f5 -- POLITE CLIENT TERMINATION.
// SIGTERM the client, the shape a closed window or a `kill` takes. Between f3
// (clean stdin close) and f4 (SIGKILL), this is the ending most likely to
// resemble what the VS Code extension actually does.
async function f5() {
  console.log("\n[f5] long-lived stream session, client SIGTERMed: what reaches the proxy?");
  await runStream({ tag: "f5-client-sigterm", ending: "sigterm", env: { ECHO_TEARDOWN_MODE: "log" } });
  await report("f5-client-sigterm", "closest available analogue to closing the IDE window");
}

// f6 -- HOW LONG DOES THE ABRUPT-DEATH PATH ACTUALLY GET?
// f4 revealed that a SIGKILLed client does NOT starve the proxy: the pipe
// closes, stdin_end fires, and the proxy releases and exits normally. That
// inverts the design note's claim that "the SIGKILL path gets nothing". But
// f4 only shows that ~1.4ms of work fit. The follow-up question is whether
// there is any budget at all on that path -- because if there is none, the
// proxy is orphaned and alive, and could do work that the 490ms graceful
// window forbids. Same busy-wait, same 8s budget, abrupt ending.
async function f6() {
  console.log("\n[f6] client SIGKILLed with a busy-waiting handler: is the orphan path bounded at all?");
  await runStream({
    tag: "f6-sigkill-busywait",
    ending: "sigkill",
    env: { ECHO_TEARDOWN_MODE: "busywait", ECHO_BUSYWAIT_BUDGET_MS: "8000", ECHO_BUSYWAIT_SLICE_MS: "10" },
    timeoutMs: 240000,
  });
  // Longer settle than the other experiments: the whole point is to see work
  // continue past the point where a graceful teardown would have been killed.
  await sleep(9000);
  await report("f6-sigkill-busywait", "8000ms reached => the orphan path is unbounded, unlike the ~490ms graceful window");
}

const which = process.argv[2] || "all";
const table = { f1, f2, f3, f4, f5, f6 };

if (which === "all") {
  try {
    rmSync(LOG);
  } catch {}
  reapOrphanProxies("pre");
  for (const k of ["f1", "f2", "f3", "f4", "f5", "f6"]) await table[k]();
} else if (table[which]) {
  await table[which]();
} else {
  console.error(`unknown experiment: ${which} (expected f1|f2|f3|f4|f5|f6|all)`);
  process.exit(2);
}

console.log(`\nlog: ${LOG}`);
console.log(`analyze: node ${resolve(HERE, "..", "001-echo-proxy-lifecycle-harness", "analyze.mjs")} ${LOG}`);
