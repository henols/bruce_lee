#!/usr/bin/env node
// Renders an echo-proxy JSONL log as a self-contained HTML lifecycle timeline.
// Shared by spikes 001-004.
//
// Usage: node render-timeline.mjs <log.jsonl> [out.html]
//
// WHY THIS EXISTS rather than just reading the JSONL: the answers in this
// spike are about ORDER and SPACING -- SIGINT before SIGTERM, 100ms apart,
// stdin EOF never arriving, and in spike 002 exactly how far a busy-wait got
// before the process died. Those are shapes, and a swimlane per process makes
// them one glance instead of a column of timestamps. The data is inlined at
// render time because a file:// page cannot fetch a sibling file.

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const logPath = process.argv[2];
const outPath = process.argv[3] || logPath.replace(/\.jsonl$/, "") + ".timeline.html";
if (!logPath) {
  console.error("usage: node render-timeline.mjs <log.jsonl> [out.html]");
  process.exit(2);
}

const events = readFileSync(logPath, "utf8")
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
  .map((e) => ({ ...e, epoch: Date.parse(e.t) }));

// Category drives colour. Grouping is by what a reader is looking for, not by
// the event name: every teardown-ish event reads as one family so the ladder
// stands out from ordinary traffic.
function category(ev) {
  const e = ev.event;
  if (["teardown_trigger", "SIGTERM", "SIGINT", "SIGHUP", "stdin_end", "stdin_close", "exit"].includes(e)) return "teardown";
  if (e.startsWith("lease")) return "lease";
  if (e.startsWith("busywait")) return "busywait";
  if (e.startsWith("tool_call") || e.includes("call_delay")) return "tool";
  if (e.startsWith("rpc") || e === "notification_ignored") return "rpc";
  if (e === "heartbeat" || e === "heartbeat_armed") return "heartbeat";
  if (e.includes("delay")) return "delay";
  return "meta";
}

function labelFor(ev) {
  if (ev.event === "teardown_trigger") return ev.trigger + (ev.alreadyRan ? " (dup)" : "");
  if (ev.event === "rpc_in" || ev.event === "rpc_out") return `${ev.event === "rpc_in" ? "◂" : "▸"} ${ev.method}`;
  if (ev.event === "busywait_progress") return `+${ev.elapsedMs}ms`;
  return ev.event;
}

const tags = [...new Set(events.map((e) => e.tag))];
const blocks = tags.map((tag) => {
  const evs = events.filter((e) => e.tag === tag);
  const pids = [...new Set(evs.map((e) => e.pid))];
  const t0 = Math.min(...evs.map((e) => e.epoch));
  const t1 = Math.max(...evs.map((e) => e.epoch));
  const span = Math.max(1, t1 - t0);
  return {
    tag,
    pidCount: pids.length,
    spanMs: span,
    lanes: pids.map((pid) => {
      const pe = evs.filter((e) => e.pid === pid);
      const exited = pe.some((e) => e.event === "exit");
      const ladder = pe.filter((e) => e.event === "teardown_trigger");
      const progress = pe.filter((e) => e.event === "busywait_progress");
      return {
        pid,
        end: exited ? "normal exit" : "killed (no exit handler ran)",
        toolCalls: pe.filter((e) => e.event === "tool_call_begin").length,
        ladder: ladder.map((e) => e.trigger),
        lastBusywaitMs: progress.length ? progress[progress.length - 1].elapsedMs : null,
        marks: pe.map((e) => ({
          x: ((e.epoch - t0) / span) * 100,
          cat: category(e),
          label: labelFor(e),
          title: `${e.t}  +${Math.round(e.ms)}ms (proc)\n${e.event}${e.method ? " " + e.method : ""}${e.trigger ? " " + e.trigger : ""}${e.text ? "\ntext: " + e.text : ""}${e.elapsedMs != null ? "\nelapsed: " + e.elapsedMs + "ms" : ""}`,
        })),
      };
    }),
  };
});

const html = `<title>MCP proxy lifecycle — ${basename(logPath)}</title>
<style>
  :root {
    --bg: #fbfbfa; --fg: #1b1a17; --muted: #6f6b63; --line: #d9d5cd; --card: #ffffff;
    --rpc: #3b6ea5; --tool: #2f7d57; --teardown: #b3452f; --lease: #7a4fa3;
    --busywait: #c07c1e; --heartbeat: #8a8578; --delay: #a06a2c; --meta: #8a8578;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #16161a; --fg: #ece9e3; --muted: #9a958c; --line: #33323a; --card: #1e1e24;
      --rpc: #7fb0e0; --tool: #6cc294; --teardown: #f08a6e; --lease: #bb92e0;
      --busywait: #e5b25d; --heartbeat: #9a958c; --delay: #d9a05e; --meta: #9a958c;
    }
  }
  :root[data-theme="dark"] {
    --bg: #16161a; --fg: #ece9e3; --muted: #9a958c; --line: #33323a; --card: #1e1e24;
    --rpc: #7fb0e0; --tool: #6cc294; --teardown: #f08a6e; --lease: #bb92e0;
    --busywait: #e5b25d; --heartbeat: #9a958c; --delay: #d9a05e; --meta: #9a958c;
  }
  :root[data-theme="light"] {
    --bg: #fbfbfa; --fg: #1b1a17; --muted: #6f6b63; --line: #d9d5cd; --card: #ffffff;
    --rpc: #3b6ea5; --tool: #2f7d57; --teardown: #b3452f; --lease: #7a4fa3;
    --busywait: #c07c1e; --heartbeat: #8a8578; --delay: #a06a2c; --meta: #8a8578;
  }
  body { margin: 0; padding: 2rem 1.25rem 4rem; background: var(--bg); color: var(--fg);
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 1.4rem; margin: 0 0 .2rem; letter-spacing: -.01em; }
  .sub { color: var(--muted); font-size: .85rem; margin-bottom: 2rem; }
  .legend { display: flex; flex-wrap: wrap; gap: .75rem 1.25rem; margin: 0 0 2rem;
    font-size: .78rem; color: var(--muted); }
  .legend span { display: inline-flex; align-items: center; gap: .35rem; }
  .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
  .block { background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 1.1rem 1.25rem 1.4rem; margin-bottom: 1.25rem; }
  .block h2 { font-size: .95rem; margin: 0 0 .15rem; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .meta { color: var(--muted); font-size: .8rem; margin-bottom: 1rem; }
  .pill { display: inline-block; border: 1px solid var(--line); border-radius: 999px;
    padding: .05rem .5rem; margin-right: .35rem; font-size: .75rem; }
  .lane { margin: 1.1rem 0 0; }
  .lanehead { display: flex; flex-wrap: wrap; gap: .5rem; align-items: baseline;
    font-family: ui-monospace, Menlo, monospace; font-size: .78rem; color: var(--muted); margin-bottom: .3rem; }
  .lanehead b { color: var(--fg); }
  .track { position: relative; height: 34px; border-bottom: 1px solid var(--line); overflow: visible; }
  .track::before { content: ""; position: absolute; left: 0; right: 0; top: 16px; height: 1px; background: var(--line); }
  .mark { position: absolute; top: 11px; width: 11px; height: 11px; border-radius: 50%;
    transform: translateX(-50%); cursor: help; border: 2px solid var(--card); }
  .mark.rpc { background: var(--rpc); } .mark.tool { background: var(--tool); }
  .mark.teardown { background: var(--teardown); width: 13px; height: 13px; top: 10px; }
  .mark.lease { background: var(--lease); } .mark.busywait { background: var(--busywait); width: 7px; height: 7px; top: 13px; }
  .mark.heartbeat { background: var(--heartbeat); width: 7px; height: 7px; top: 13px; }
  .mark.delay { background: var(--delay); } .mark.meta { background: var(--meta); }
  .ladder { font-family: ui-monospace, Menlo, monospace; font-size: .75rem; color: var(--muted); margin-top: .3rem; }
  .ladder b { color: var(--teardown); }
  .scroller { overflow-x: auto; }
</style>
<main>
  <h1>Stdio MCP proxy lifecycle</h1>
  <div class="sub">${basename(logPath)} — ${events.length} events, ${tags.length} experiment${tags.length === 1 ? "" : "s"}. Each lane is one proxy subprocess; time is normalised per experiment. Hover any mark for its raw record.</div>
  <div class="legend">
    <span><i class="dot" style="background:var(--rpc)"></i> JSON-RPC</span>
    <span><i class="dot" style="background:var(--tool)"></i> tool call</span>
    <span><i class="dot" style="background:var(--teardown)"></i> teardown / signal</span>
    <span><i class="dot" style="background:var(--lease)"></i> lease</span>
    <span><i class="dot" style="background:var(--busywait)"></i> shutdown busy-wait</span>
    <span><i class="dot" style="background:var(--delay)"></i> injected delay</span>
    <span><i class="dot" style="background:var(--heartbeat)"></i> heartbeat</span>
  </div>
${blocks
  .map(
    (b) => `  <section class="block">
    <h2>${b.tag}</h2>
    <div class="meta">
      <span class="pill">${b.pidCount} proxy subprocess${b.pidCount === 1 ? "" : "es"}</span>
      <span class="pill">${b.spanMs} ms wall</span>
    </div>
    <div class="scroller">
${b.lanes
  .map(
    (l) => `      <div class="lane">
        <div class="lanehead"><b>pid ${l.pid}</b>
          <span>${l.toolCalls} tool call${l.toolCalls === 1 ? "" : "s"}</span>
          <span>ended: ${l.end}</span>
          ${l.lastBusywaitMs !== null ? `<span>busy-wait reached ${l.lastBusywaitMs}ms</span>` : ""}
        </div>
        <div class="track">
${l.marks.map((m) => `          <div class="mark ${m.cat}" style="left:${m.x.toFixed(3)}%" title="${m.title.replace(/"/g, "&quot;").replace(/</g, "&lt;")}"></div>`).join("\n")}
        </div>
        ${l.ladder.length ? `<div class="ladder">ladder: <b>${l.ladder.join("</b> → <b>")}</b></div>` : ""}
      </div>`,
  )
  .join("\n")}
    </div>
  </section>`,
  )
  .join("\n")}
</main>
`;

writeFileSync(outPath, html);
console.log(`wrote ${outPath}`);
