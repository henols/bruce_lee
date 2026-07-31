#!/usr/bin/env node
// Driver for spike 003 -- the timeout budgets a real proxy has to fit inside.
//
// Usage: node run-experiments.mjs [g1|g2|g2knob|g3|all]
//
// THREE BUDGETS, THREE CONSEQUENCES:
//
//   g1 startup    How long may a server take to answer `initialize` before the
//                 client gives up on it? The real proxy answers immediately by
//                 design (it lists tools from a manifest and defers acquiring
//                 an emulator), so this is the budget it must never spend --
//                 measuring it says how much slack that design choice buys.
//
//   g2 first call The budget the COLD path gets: broker launch + x64sc boot +
//                 MCP-ready, all inside one tools/call. Warm spares are meant
//                 to keep this off the common path, so this measurement sets
//                 the threshold at which the proxy should stop waiting and
//                 return "warming, retry" instead.
//
//   g3 idle       Does anything reap a proxy that sits idle? A long
//                 documentation session that silently loses its lease
//                 mid-session is the failure this rules in or out. It is the
//                 one MEDIUM in the source todo that no amount of reasoning
//                 can settle -- only wall-clock waiting.
//
// Reuses spike 001's echo-proxy.mjs unchanged, via ECHO_INIT_DELAY_MS /
// ECHO_CALL_DELAY_MS / ECHO_HEARTBEAT_MS.

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGS = join(HERE, "logs");
const PROXY = resolve(HERE, "..", "001-echo-proxy-lifecycle-harness", "echo-proxy.mjs");
const MCP_CONFIG = join(LOGS, "scratch-mcp.json");
const LOG = join(LOGS, "003-timeouts.jsonl");
const NOTES = join(LOGS, "003-observations.txt");

mkdirSync(LOGS, { recursive: true });
writeFileSync(
  MCP_CONFIG,
  JSON.stringify({ mcpServers: { probe: { command: "node", args: [PROXY] } } }, null, 2) + "\n",
);

const TOOL = "mcp__probe__echo_probe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function note(line) {
  const stamped = `${new Date().toISOString()}  ${line}`;
  console.log(stamped);
  try {
    appendFileSync(NOTES, stamped + "\n");
  } catch {}
}

function runPrint({ tag, prompt, env = {}, timeoutMs }) {
  return new Promise((res) => {
    const args = [
      "-p",
      prompt,
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
    const started = Date.now();
    const child = spawn("claude", args, {
      cwd: HERE,
      env: { ...process.env, ECHO_LOG: LOG, ECHO_TAG: tag, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const killer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(killer);
      const elapsed = Date.now() - started;
      writeFileSync(
        join(LOGS, `${tag}.cli.txt`),
        `# ${tag}\n# env: ${JSON.stringify(env)}\n# exit code=${code} signal=${signal} elapsed=${elapsed}ms\n\n## stdout\n${out}\n\n## stderr\n${err}\n`,
      );
      res({ code, signal, out, err, elapsed });
    });
  });
}

// g1 -- STARTUP BUDGET.
// The proxy blocks synchronously before answering `initialize`. Two tells in
// the log: an `init_delay_end` record means the delay was allowed to finish;
// its absence means the client killed the server mid-handshake. Separately,
// whether the model can then USE the tool says whether a slow-but-completed
// handshake still leaves a working server or a dropped one.
async function g1() {
  note("[g1] startup budget: how long may `initialize` take?");
  for (const delayMs of [3000, 20000, 35000, 65000]) {
    const tag = `g1-init-${delayMs}ms`;
    const r = await runPrint({
      tag,
      prompt: `Call the ${TOOL} tool once with text set to "g1", then reply with just its output.`,
      env: { ECHO_INIT_DELAY_MS: String(delayMs) },
      timeoutMs: delayMs + 180000,
    });
    const said = r.out.trim().replace(/\n/g, " ").slice(0, 120);
    note(`  [g1] init delay ${delayMs}ms -> client exit=${r.code} in ${r.elapsed}ms; said: ${said}`);
  }
}

// g2 -- FIRST-CALL BUDGET (the cold path).
// The tool handler blocks before answering. A completed `call_delay_end`
// means the client waited; its absence means it gave up on the call.
async function g2() {
  note("[g2] first-call budget: how long may a tools/call take?");
  for (const delayMs of [30000, 90000, 150000]) {
    const tag = `g2-call-${delayMs}ms`;
    const r = await runPrint({
      tag,
      prompt: `Call the ${TOOL} tool once with text set to "g2", then reply with just its output.`,
      env: { ECHO_CALL_DELAY_MS: String(delayMs) },
      timeoutMs: delayMs + 240000,
    });
    const said = r.out.trim().replace(/\n/g, " ").slice(0, 160);
    note(`  [g2] call delay ${delayMs}ms -> client exit=${r.code} in ${r.elapsed}ms; said: ${said}`);
  }
}

// g2knob -- IS MCP_TOOL_TIMEOUT ACTUALLY HONOURED?
// Finding 12 lists the env var as existing but unconfirmed. Setting it well
// BELOW the injected delay makes the answer unambiguous: if the knob works the
// call is cut off early, and the log shows no `call_delay_end`. This matters
// because it is the lever a "warming, retry" threshold would be built on.
async function g2knob() {
  note("[g2knob] does MCP_TOOL_TIMEOUT cut a call short?");
  const r = await runPrint({
    tag: "g2knob-timeout-6s-delay-25s",
    prompt: `Call the ${TOOL} tool once with text set to "g2knob", then reply with just its output.`,
    env: { ECHO_CALL_DELAY_MS: "25000", MCP_TOOL_TIMEOUT: "6000" },
    timeoutMs: 240000,
  });
  note(`  [g2knob] MCP_TOOL_TIMEOUT=6000 vs 25s delay -> exit=${r.code} in ${r.elapsed}ms; said: ${r.out.trim().replace(/\n/g, " ").slice(0, 200)}`);
}

// g3 -- IDLE REAPING.
// A long-lived stream-json session that answers ONE message and is then left
// completely alone. The proxy heartbeats every 60s, so the log becomes a
// continuous liveness record: if anything reaps an idle server, a heartbeat gap
// followed by a signal (or by nothing at all) marks the moment.
//
// Runs for `idleMinutes`, default 40 -- past the 30-minute mark the source todo
// names. This is wall-clock bound and cannot be shortened.
async function g3() {
  const idleMinutes = Number(process.env.G3_IDLE_MINUTES || 40);
  note(`[g3] idle reaping: holding a session open and idle for ${idleMinutes} minutes`);
  const tag = "g3-idle";
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
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
  const started = Date.now();
  const child = spawn("claude", args, {
    cwd: HERE,
    env: { ...process.env, ECHO_LOG: LOG, ECHO_TAG: tag, ECHO_HEARTBEAT_MS: "60000" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  child.on("close", (code, signal) => {
    const mins = ((Date.now() - started) / 60000).toFixed(1);
    note(`  [g3] CLIENT EXITED after ${mins} min: code=${code} signal=${signal}`);
    writeFileSync(join(LOGS, `${tag}.cli.txt`), `# ${tag}\n# exit code=${code} signal=${signal} after ${mins} min\n\n## stdout\n${out}\n\n## stderr\n${err}\n`);
  });

  // One message to get the session fully established, then silence. stdin is
  // held OPEN for the whole idle period -- closing it would be the graceful
  // ending measured in spike 002, not an idle test.
  child.stdin.write(
    JSON.stringify({
      type: "user",
      message: { role: "user", content: `Call the ${TOOL} tool once with text set to "g3-start", then reply with just its output.` },
    }) + "\n",
  );

  for (let m = 1; m <= idleMinutes; m++) {
    await sleep(60000);
    if (child.exitCode !== null || child.signalCode !== null) {
      note(`  [g3] client is gone at minute ${m} (exitCode=${child.exitCode} signalCode=${child.signalCode})`);
      break;
    }
    if (m % 5 === 0) note(`  [g3] minute ${m}/${idleMinutes}: client still alive, still idle`);
  }

  note(`  [g3] idle period over; ending the session by closing stdin`);
  child.stdin.end();
  await sleep(4000);
  note(`  [g3] done`);
}

// g1b -- PIN THE STARTUP BUDGET.
// g1 bracketed it between 3s (handshake completed, tools/list served) and 20s
// (initialize answered, then EPIPE -- the client had already hung up). This
// bisects the gap.
//
// THE CRITERION IS `tools/list`, NOT THE MODEL'S REPLY. g1's CLI output turned
// out to be worthless as evidence: with the probe tool absent, haiku emitted
// literal `<function_calls>` markup as prose, which reads like a successful
// call to a careless eye. Whether the client came back for `tools/list` after
// `initialize` is a fact about the client, independent of what any model said.
async function g1b() {
  note("[g1b] pinning the startup budget between 3s and 20s (criterion: was tools/list requested?)");
  for (const delayMs of (process.env.G1B_LADDER || "8000,12000,16000").split(",").map(Number)) {
    const tag = `g1b-init-${delayMs}ms`;
    const r = await runPrint({
      tag,
      prompt: `Call the ${TOOL} tool once with text set to "g1b", then reply with just its output.`,
      env: { ECHO_INIT_DELAY_MS: String(delayMs) },
      timeoutMs: delayMs + 180000,
    });
    note(`  [g1b] init delay ${delayMs}ms -> client exit=${r.code} in ${r.elapsed}ms`);
  }
}

// g1c -- DOES MCP_TIMEOUT RAISE THE STARTUP BUDGET?
// g1b pinned the default budget between 3s and 4s -- an order of magnitude
// below the 30s that MCP_TIMEOUT's documented default implies. So either the
// documented default is not what governs this, or something else gives up
// first. Either way the actionable question is whether the knob moves it: a
// proxy that needs a few seconds to read a large tool manifest has to know
// whether it can buy room.
async function g1c() {
  note("[g1c] does MCP_TIMEOUT raise the startup budget? 10s init delay, knob at 60s");
  const r = await runPrint({
    tag: "g1c-mcptimeout-60s-init-10s",
    prompt: `Call the ${TOOL} tool once with text set to "g1c", then reply with just its output.`,
    env: { ECHO_INIT_DELAY_MS: "10000", MCP_TIMEOUT: "60000" },
    timeoutMs: 240000,
  });
  note(`  [g1c] MCP_TIMEOUT=60000 vs 10s init -> exit=${r.code} in ${r.elapsed}ms`);
}

// g1d -- IS A SLOW SERVER DROPPED PERMANENTLY, OR JUST LATE?
// The most consequential unknown left by g1/g1b. In print mode the session ends
// immediately, so "abandoned" and "too late for this turn" look identical -- and
// they are very different for the real proxy. If a server that finishes its
// handshake late is still usable on a LATER turn, a slow start costs one turn's
// tool access. If the client has closed the pipe for good, a slow start costs
// the whole session its emulator access, which finding 7 says is unrecoverable.
//
// A long-lived session makes them distinguishable: send a message immediately
// (the proxy is still mid-handshake), wait past the delay, then send a second
// message asking for the tool again.
async function g1d() {
  note("[g1d] long-lived session, 10s init delay: is the server usable on a later turn?");
  const tag = "g1d-late-init-recovery";
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
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
  const child = spawn("claude", args, {
    cwd: HERE,
    env: { ...process.env, ECHO_LOG: LOG, ECHO_TAG: tag, ECHO_INIT_DELAY_MS: "10000" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  let err = "";
  child.stderr.on("data", (d) => (err += d));

  const ask = (text) =>
    child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n");

  ask(`Call the ${TOOL} tool once with text set to "g1d-turn1", then reply with just its output.`);
  await sleep(30000); // well past the 10s handshake delay
  note("  [g1d] 30s elapsed, sending a second message on the same session");
  ask(`Call the ${TOOL} tool once with text set to "g1d-turn2", then reply with just its output.`);
  await sleep(30000);
  child.stdin.end();
  await sleep(5000);
  try {
    child.kill("SIGKILL");
  } catch {}
  writeFileSync(join(LOGS, `${tag}.cli.txt`), `# ${tag}\n\n## stdout\n${out}\n\n## stderr\n${err}\n`);
  note("  [g1d] done -- check the log for a tool_call_begin with text g1d-turn2");
}

const which = process.argv[2] || "all";
const table = { g1, g1b, g1c, g1d, g2, g2knob, g3 };

if (which === "all") {
  try {
    rmSync(LOG);
  } catch {}
  for (const k of ["g1", "g2", "g2knob", "g3"]) await table[k]();
} else if (table[which]) {
  await table[which]();
} else {
  console.error(`unknown experiment: ${which} (expected g1|g2|g2knob|g3|all)`);
  process.exit(2);
}

note(`log: ${LOG}`);
