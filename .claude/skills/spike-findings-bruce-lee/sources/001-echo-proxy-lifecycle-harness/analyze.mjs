#!/usr/bin/env node
// Shared log analyzer for spikes 001-004. Reads an echo-proxy JSONL log and
// answers the questions the raw log makes you squint at: how many distinct
// pids appeared per experiment, what the signal ladder looked like and with
// what spacing, whether an `exit` line landed (a normal exit) or did not
// (SIGKILL), and how far a busy-wait got.
//
// Usage: node analyze.mjs <log.jsonl> [--tag <tag>] [--json]
//
// Every number printed here is derived from the log, never from a claim in a
// README -- which is the point. The READMEs quote this output.

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const logPath = args.find((a) => !a.startsWith("--"));
const wantJson = args.includes("--json");
const tagIdx = args.indexOf("--tag");
const onlyTag = tagIdx >= 0 ? args[tagIdx + 1] : null;

if (!logPath) {
  console.error("usage: node analyze.mjs <log.jsonl> [--tag <tag>] [--json]");
  process.exit(2);
}

const lines = readFileSync(logPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean)
  .filter((e) => !onlyTag || e.tag === onlyTag);

// Group by tag, then by pid. A tag is one experiment; a pid is one stdio
// server subprocess. "How many pids under one tag" is the whole
// process-identity question in spike 001.
const byTag = new Map();
for (const e of lines) {
  if (!byTag.has(e.tag)) byTag.set(e.tag, new Map());
  const pids = byTag.get(e.tag);
  if (!pids.has(e.pid)) pids.set(e.pid, []);
  pids.get(e.pid).push(e);
}

const SIGNALS = new Set(["SIGTERM", "SIGINT", "SIGHUP", "stdin_end", "stdin_close"]);

const report = [];
for (const [tag, pids] of byTag) {
  const entry = { tag, pidCount: pids.size, pids: [] };
  for (const [pid, events] of pids) {
    const first = events[0];
    const last = events[events.length - 1];
    const counts = {};
    for (const e of events) counts[e.event] = (counts[e.event] || 0) + 1;

    // Wall-clock ordering of teardown triggers, with the gap between each.
    // This is the "real ladder" measurement: the design note predicted
    // stdin EOF first, so the observed order matters more than the labels.
    const triggers = events
      .filter((e) => e.event === "teardown_trigger" || SIGNALS.has(e.event))
      .map((e) => ({ trigger: e.trigger || e.event, t: e.t, ms: e.ms, alreadyRan: e.alreadyRan }));
    const ladder = [];
    for (let i = 0; i < triggers.length; i++) {
      ladder.push({
        ...triggers[i],
        gapFromPrevMs: i === 0 ? null : Math.round((triggers[i].ms - triggers[i - 1].ms) * 1000) / 1000,
      });
    }

    const progress = events.filter((e) => e.event === "busywait_progress");
    const lastProgress = progress[progress.length - 1] || null;
    const leaseUnlink = events.find((e) => e.event === "lease_unlinked") || null;
    const exited = events.find((e) => e.event === "exit") || null;
    const firstCall = events.find((e) => e.event === "tool_call_begin") || null;
    const spawn = events.find((e) => e.event === "spawn") || null;

    entry.pids.push({
      pid,
      ppid: first.ppid,
      envSession: spawn?.env_session ?? null,
      firstEventAt: first.t,
      lastEventAt: last.t,
      lifetimeMs: Math.round((last.ms - first.ms) * 1000) / 1000,
      eventCounts: counts,
      // Eager vs lazy: a spawn with initialize but no tool_call_begin means
      // the client spawned it without any tool needing it.
      spawnedWithoutToolCall: Boolean(spawn) && !firstCall,
      toolCalls: counts.tool_call_begin || 0,
      teardownLadder: ladder,
      leaseReleased: Boolean(leaseUnlink),
      leaseUnlinkElapsedMs: leaseUnlink?.elapsedMs ?? null,
      busywaitSlices: progress.length,
      busywaitLastElapsedMs: lastProgress?.elapsedMs ?? null,
      busywaitCompleted: Boolean(events.find((e) => e.event === "busywait_complete")),
      // No `exit` line means the process never ran its exit handler, which for
      // this instrument means it was SIGKILLed (or the host died with it).
      exitObserved: Boolean(exited),
      exitCode: exited?.code ?? null,
      inferredEnd: exited ? "normal_exit" : "killed_without_exit_handler",
    });
  }
  report.push(entry);
}

if (wantJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

for (const t of report) {
  console.log(`\n=== tag: ${t.tag} ===`);
  console.log(`distinct proxy pids: ${t.pidCount}`);
  for (const p of t.pids) {
    console.log(`\n  pid ${p.pid} (ppid ${p.ppid})  lifetime ${p.lifetimeMs}ms  end=${p.inferredEnd}`);
    console.log(`    env session id exported to server: ${p.envSession ?? "(none)"}`);
    console.log(`    tool calls: ${p.toolCalls}   spawned without any tool call: ${p.spawnedWithoutToolCall}`);
    if (p.leaseReleased || p.leaseUnlinkElapsedMs !== null) {
      console.log(`    lease unlinked: ${p.leaseReleased} (${p.leaseUnlinkElapsedMs}ms)`);
    }
    if (p.busywaitSlices > 0) {
      console.log(
        `    busywait: ${p.busywaitSlices} slices, last at ${p.busywaitLastElapsedMs}ms, completed=${p.busywaitCompleted}`,
      );
    }
    if (p.teardownLadder.length) {
      console.log("    teardown ladder:");
      for (const s of p.teardownLadder) {
        const gap = s.gapFromPrevMs === null ? "first" : `+${s.gapFromPrevMs}ms`;
        console.log(`      ${s.t}  ${s.trigger.padEnd(12)} ${gap}`);
      }
    } else {
      console.log("    teardown ladder: (none observed)");
    }
    const interesting = Object.entries(p.eventCounts)
      .filter(([k]) => !["rpc_in", "rpc_out", "heartbeat", "busywait_progress"].includes(k))
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    console.log(`    events: ${interesting}`);
  }
}
console.log("");
