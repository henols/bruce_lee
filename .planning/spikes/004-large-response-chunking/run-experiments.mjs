#!/usr/bin/env node
// Driver for spike 004 -- what happens to a tool result too big for the
// client's output limit, and therefore whether chunking must live in the proxy.
//
// Usage: node run-experiments.mjs [h1|h2|all]
//
// WHY THIS MATTERS FOR PHASE 01.2. The real proxy's whole job is forwarding
// emulator calls, and the single most important one is reading memory. A full
// 64K RAM read is not a hypothetical worst case -- it is the routine operation
// this project's capture pipeline is built around. Rendered as hex pairs it is
// ~192KB of text; base64 is ~87KB. Design finding 12 says responses over ~25K
// tokens "spill to disk", which is roughly 100KB of text, so a 64K read is
// squarely over the line either way.
//
// The question is not whether a limit exists but what CROSSING it does:
//   - a hard error the agent can react to,
//   - silent truncation (the dangerous one -- a truncated RAM dump that looks
//     complete would corrupt a capture and every verdict downstream),
//   - or a spill-to-disk with a path the agent can read.
// Each implies a different obligation on the proxy.
//
// The payload sizes are chosen against that specific operation, not round
// numbers: 24KB is a page-ish read that should be comfortable, 100KB is the
// documented threshold, 192KB is the actual hex-encoded 64K RAM read, and 512KB
// is well past anything the project needs -- there to show the failure mode
// clearly rather than to be supported.

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGS = join(HERE, "logs");
const PROXY = resolve(HERE, "..", "001-echo-proxy-lifecycle-harness", "echo-proxy.mjs");
const MCP_CONFIG = join(LOGS, "scratch-mcp.json");
const LOG = join(LOGS, "004-payloads.jsonl");
const NOTES = join(LOGS, "004-observations.txt");

mkdirSync(LOGS, { recursive: true });
writeFileSync(
  MCP_CONFIG,
  JSON.stringify({ mcpServers: { probe: { command: "node", args: [PROXY] } } }, null, 2) + "\n",
);

const TOOL = "mcp__probe__echo_probe";

function note(line) {
  const stamped = `${new Date().toISOString()}  ${line}`;
  console.log(stamped);
  try {
    appendFileSync(NOTES, stamped + "\n");
  } catch {}
}

function runPrint({ tag, prompt, env = {}, timeoutMs = 240000 }) {
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
      writeFileSync(
        join(LOGS, `${tag}.cli.txt`),
        `# ${tag}\n# env: ${JSON.stringify(env)}\n# exit code=${code} signal=${signal} elapsed=${Date.now() - started}ms\n\n## stdout\n${out}\n\n## stderr\n${err}\n`,
      );
      res({ code, signal, out, err, elapsed: Date.now() - started });
    });
  });
}

// The prompt asks the model to report structural facts about the payload rather
// than to reproduce it. The payload carries BEGIN_PAYLOAD/END_PAYLOAD markers,
// so "did you see END_PAYLOAD" distinguishes a complete delivery from a
// truncated one -- and it is a question the model can answer cheaply even when
// the content is enormous.
const PROMPT =
  `Call the ${TOOL} tool once with text set to "big". The result is a large payload. ` +
  `Then reply with EXACTLY these three facts and nothing else: ` +
  `(1) whether the tool result contained the marker END_PAYLOAD, ` +
  `(2) whether you saw any notice about the result being truncated, shortened, or written to a file, ` +
  `and if so quote that notice verbatim, ` +
  `(3) the first 40 characters of the result.`;

async function h1() {
  note("[h1] payload size ladder -- default limits");
  for (const bytes of (process.env.H1_LADDER || "24000,100000,192000,512000").split(",").map(Number)) {
    const tag = `h1-payload-${bytes}`;
    const r = await runPrint({ tag, prompt: PROMPT, env: { ECHO_PAYLOAD_BYTES: String(bytes) } });
    note(`  [h1] ${bytes} bytes -> exit=${r.code} in ${r.elapsed}ms`);
    note(`  [h1] model said: ${r.out.trim().replace(/\s+/g, " ").slice(0, 500)}`);
    if (r.err.trim()) note(`  [h1] stderr: ${r.err.trim().replace(/\s+/g, " ").slice(0, 300)}`);
  }
}

// h2 -- IS MAX_MCP_OUTPUT_TOKENS THE LEVER?
// Finding 12 names the variable but never confirms it does anything.
//
// THE FIRST ATTEMPT AT THIS WAS USELESS and is kept as `h2-100k` to show why:
// it paired the knob with a 100KB payload, which already exceeded the DEFAULT
// limit, so the spill it produced proves nothing about the knob. The
// discriminating test uses a payload that PASSED at defaults (24KB, delivered
// whole with END_PAYLOAD intact) and sets the knob below it. If 24KB now spills,
// the knob governs the threshold.
async function h2() {
  note("[h2] does MAX_MCP_OUTPUT_TOKENS change the behaviour?");
  note("  [h2] control: 24KB passed at default limits, delivered whole");
  const r = await runPrint({
    tag: "h2-maxtokens-2000-payload-24000",
    prompt: PROMPT,
    env: { ECHO_PAYLOAD_BYTES: "24000", MAX_MCP_OUTPUT_TOKENS: "2000" },
  });
  note(`  [h2] MAX_MCP_OUTPUT_TOKENS=2000 vs 24KB -> exit=${r.code} in ${r.elapsed}ms`);
  note(`  [h2] model said: ${r.out.trim().replace(/\s+/g, " ").slice(0, 500)}`);
  if (r.err.trim()) note(`  [h2] stderr: ${r.err.trim().replace(/\s+/g, " ").slice(0, 300)}`);
}

const which = process.argv[2] || "all";
const table = { h1, h2 };

if (which === "all") {
  try {
    rmSync(LOG);
  } catch {}
  for (const k of ["h1", "h2"]) await table[k]();
} else if (table[which]) {
  await table[which]();
} else {
  console.error(`unknown experiment: ${which} (expected h1|h2|all)`);
  process.exit(2);
}

note(`log: ${LOG}`);
