#!/usr/bin/env node
// Driver for spike 001's four experiments. Each one launches a real headless
// Claude Code session against a scratch MCP config, so what gets measured is
// Claude Code's own lifecycle handling -- not a hand-rolled MCP client's.
//
// Usage: node run-experiments.mjs [e1|e2|e3|e4|all]
//
// SAFETY, and why it is structural rather than careful:
//   - --strict-mcp-config means the project's real .mcp.json is ignored
//     entirely, so a spike can never disturb this session's own vice proxy.
//   - --tools restricts the child session to exactly the probe tool (plus the
//     Agent tool where the experiment is about subagents). No Bash, no Write,
//     no Edit reaches the child. The subagent in e3/e4 is a custom inline
//     agent whose own tool list is the probe tool alone.
//   - --model haiku because none of these measurements depend on model
//     quality; they depend on the client's process handling.

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGS = join(HERE, "logs");
const PROXY = join(HERE, "echo-proxy.mjs");
const MCP_CONFIG = join(LOGS, "scratch-mcp.json");
const LOG = join(LOGS, "001-lifecycle.jsonl");

mkdirSync(LOGS, { recursive: true });

// The scratch config. Written fresh each run so the file on disk always
// matches what the experiments actually used.
writeFileSync(
  MCP_CONFIG,
  JSON.stringify({ mcpServers: { probe: { command: "node", args: [PROXY] } } }, null, 2) + "\n",
);

const TOOL = "mcp__probe__echo_probe";

// A custom subagent whose entire tool surface is the probe tool. Used by e3
// and e4 so the subagent cannot do anything except the one call being counted.
const AGENTS = JSON.stringify({
  echoer: {
    description: "Calls the echo probe tool once with the text it is given.",
    tools: [TOOL],
    prompt: `You have exactly one job. Call the ${TOOL} tool once, with text set to the string in your instructions. Then reply with the tool's output verbatim. Do nothing else.`,
  },
  // e4b's agent. It gets Bash for one reason: to report its own working
  // directory THROUGH the probe tool, so the proxy's own log carries the
  // proof that worktree isolation took effect. Without this, e4 only shows
  // "one pid" and cannot show the agent was actually isolated -- and the temp
  // worktree is auto-removed when unchanged, so it cannot be checked after.
  cwdreporter: {
    description: "Reports its own working directory through the echo probe tool.",
    tools: [TOOL, "Bash"],
    prompt: `Run the shell command \`pwd\` to find your working directory. Then call the ${TOOL} tool once with text set to exactly "cwd=" followed by that directory. Then reply with that directory. Do nothing else.`,
  },
});

function runSession({ tag, prompt, tools, env = {}, timeoutMs = 240000, agents = false, label }) {
  return new Promise((resolve) => {
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
    ];
    // `--tools` rejects an empty list, so an experiment that wants no tools
    // omits the flag rather than passing nothing. Every experiment here does
    // restrict its surface, though: see e1's note for why it still names the
    // probe tool even while asking for no tool use.
    if (tools.length) args.push("--tools", ...tools);
    if (agents) args.push("--agents", AGENTS);

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

    const killer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("close", (code, signal) => {
      clearTimeout(killer);
      const elapsed = Date.now() - started;
      const transcript = `# ${label || tag}\n# args: ${JSON.stringify(args)}\n# exit: code=${code} signal=${signal} elapsed=${elapsed}ms\n\n## stdout\n${out}\n\n## stderr\n${err}\n`;
      writeFileSync(join(LOGS, `${tag}.cli.txt`), transcript);
      console.log(`  [${tag}] exit code=${code} signal=${signal} ${elapsed}ms`);
      if (out.trim()) console.log(`  [${tag}] said: ${out.trim().slice(0, 200).replace(/\n/g, " ")}`);
      if (err.trim()) console.log(`  [${tag}] stderr: ${err.trim().slice(0, 300).replace(/\n/g, " ")}`);
      resolve({ code, signal, out, err, elapsed });
    });
  });
}

// e1 -- EAGER OR LAZY SPAWN.
// The session is told to answer a question and given NO tools at all. If a
// spawn + initialize + tools/list appears in the log anyway, spawn is eager
// and independent of tool use. That is what forces deferred acquisition in
// the real design: an eagerly-spawned proxy that acquires an emulator on
// startup would launch one for every session, including sessions that never
// touch VICE.
async function e1() {
  console.log("\n[e1] eager-vs-lazy spawn: a session that calls nothing");
  // The probe tool is still the only tool offered -- keeping the child's tool
  // surface restricted matters more than hiding the tool, and the measurement
  // is "did a spawn happen with no tools/call", not "was a tool offered". The
  // prompt forbids tool use and the analyzer reports tool call count, so an
  // accidental call would be visible rather than silently spoiling the result.
  await runSession({
    tag: "e1-no-tool-call",
    prompt: "Reply with exactly the word: ok. Do not use any tools.",
    tools: [TOOL],
    label: "e1 eager-vs-lazy spawn",
  });
}

// e2 -- ONE SUBPROCESS PER SESSION.
// Two sessions launched concurrently, writing to the SAME log under the SAME
// tag. Distinct pid count is the answer. If sessions shared a subprocess the
// whole per-session exclusivity model collapses, because the lease could not
// be keyed on the proxy process.
async function e2() {
  console.log("\n[e2] one subprocess per session: two concurrent sessions, same log+tag");
  await Promise.all([
    runSession({
      tag: "e2-two-sessions",
      prompt: `Call the ${TOOL} tool once with text set to "session-A", then reply with just its output.`,
      tools: [TOOL],
      label: "e2 session A",
    }),
    runSession({
      tag: "e2-two-sessions",
      prompt: `Call the ${TOOL} tool once with text set to "session-B", then reply with just its output.`,
      tools: [TOOL],
      label: "e2 session B",
    }),
  ]);
}

// e3 -- DO SUBAGENTS SPAWN THEIR OWN?
// One session makes a call itself, then has a subagent make one. Two callers,
// and the pid count says whether they shared a subprocess. This is design
// finding 5, the one the intra-session-parallelism fork rests on: if a
// subagent gets no new subprocess, then process identity IS session identity
// and subagents cannot be given their own emulator by the lease mechanism.
async function e3() {
  console.log("\n[e3] subagent: parent calls the tool, then a subagent calls it");
  await runSession({
    tag: "e3-subagent",
    prompt:
      `Do these two steps in order. ` +
      `Step 1: call the ${TOOL} tool once with text set to "from-parent". ` +
      `Step 2: use the Agent tool with subagent_type "echoer" and run_in_background false, ` +
      `instructing it to call the probe tool with text "from-subagent". ` +
      `Then reply with the word done.`,
    tools: [TOOL, "Agent"],
    agents: true,
    timeoutMs: 300000,
    label: "e3 subagent shares subprocess?",
  });
}

// e4 -- WORKTREE-ISOLATED AGENTS TOO?
// Same shape as e3 but the subagent runs with isolation "worktree", which
// swaps its filesystem view. The question is whether it also swaps the MCP
// wiring. This is what decides whether a GSD executor wave -- which is
// exactly a fan-out of worktree-isolated agents -- shares one emulator.
async function e4() {
  console.log('\n[e4] worktree agent: subagent with isolation "worktree"');
  await runSession({
    tag: "e4-worktree-agent",
    prompt:
      `Use the Agent tool with subagent_type "echoer", isolation "worktree", and run_in_background false, ` +
      `instructing it to call the probe tool with text "from-worktree-agent". ` +
      `Then reply with the word done.`,
    tools: [TOOL, "Agent"],
    agents: true,
    timeoutMs: 300000,
    label: "e4 worktree agent shares subprocess?",
  });
}

// e4b -- PROVE THE WORKTREE ISOLATION ACTUALLY TOOK EFFECT.
// e4 on its own is not enough: it shows one pid, but a silently-ignored
// isolation flag would produce the identical log, and the temp worktree is
// auto-removed when unchanged so it cannot be inspected afterwards. Here the
// agent reports its own cwd through the probe tool, so the pid count and the
// proof of isolation land in the SAME log line stream. A cwd under a worktree
// path alongside a single pid is the finding; the repo root cwd would mean e4
// proved nothing.
async function e4b() {
  console.log("\n[e4b] worktree agent, self-reported cwd: proof the isolation took effect");
  await runSession({
    tag: "e4b-worktree-cwd",
    prompt:
      `Use the Agent tool with subagent_type "cwdreporter", isolation "worktree", and run_in_background false, ` +
      `instructing it to report its working directory. Then reply with the directory it reported.`,
    tools: [TOOL, "Agent"],
    agents: true,
    timeoutMs: 300000,
    label: "e4b worktree isolation proof",
  });
}

const which = process.argv[2] || "all";
const table = { e1, e2, e3, e4, e4b };

if (which === "all") {
  // Fresh log for a full run so pid counts are never contaminated by an
  // earlier run's processes.
  try {
    rmSync(LOG);
  } catch {}
  for (const k of ["e1", "e2", "e3", "e4", "e4b"]) await table[k]();
} else if (table[which]) {
  await table[which]();
} else {
  console.error(`unknown experiment: ${which} (expected e1|e2|e3|e4|e4b|all)`);
  process.exit(2);
}

console.log(`\nlog: ${LOG}`);
console.log(`analyze: node ${join(HERE, "analyze.mjs")} ${LOG}`);
