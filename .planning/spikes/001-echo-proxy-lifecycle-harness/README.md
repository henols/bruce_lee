---
spike: 001
name: echo-proxy-lifecycle-harness
type: standard
validates: "Given an instrumented echo proxy registered in a scratch --strict-mcp-config, when two concurrent sessions run and one spawns a subagent and a worktree-isolated agent, then the log shows exactly one proxy subprocess per session, no additional subprocess for subagents or worktree agents, and a spawn line before any tools/call"
verdict: VALIDATED
related: [002, 003, 004]
tags: [mcp, lifecycle, harness, process-identity]
---

# Spike 001: Echo-Proxy Lifecycle Harness

## What This Validates

**Given** an instrumented echo proxy registered as an MCP server through a scratch `--mcp-config`
under `--strict-mcp-config`, **when** two concurrent headless sessions run and one of them spawns a
subagent and then a `worktree`-isolated agent, **then** the log shows exactly one proxy subprocess
per session, no additional subprocess for either kind of subagent, and a spawn line that lands before
any `tools/call`.

This is design findings **4, 5 and 6** from `.planning/notes/vice-mcp-selector-design.md`, and it is
also the shared instrument the other three spikes drive.

## Research

No new external research. The twelve findings this spike tests were already researched in two rounds
(recorded in the design note's findings table) — re-searching docs would restate them, and the whole
point of the spike is that docs are not the evidence being sought.

The one genuinely new discovery was about the *method*, not the subject: **the `claude` CLI is
installed inside this devcontainer** (`/home/vscode/.local/bin/claude`, v2.1.220). That was not
assumed anywhere in the design note, and it changes the spike from "ask the human to click things in
the IDE" to "measure it mechanically." Every observation below comes from a real Claude Code session,
launched from inside the container, against a scratch MCP config.

| Approach | Mechanism | Pros | Cons | Status |
|---|---|---|---|---|
| Headless `claude -p` + scratch `--mcp-config` | Real client, real MCP handshake, fully scriptable | Deterministic, repeatable, no human in the loop, cheap with `--model haiku` | Print mode may differ from the VS Code extension's teardown path | **Chosen** |
| Manual VS Code extension runs | Open sessions by hand, close windows, read the log after | Measures the exact client the project actually uses | Blocks on a human for every data point; unrepeatable; no way to bisect a timing budget | Rejected (user decision: document the gap instead) |
| Hand-rolled MCP client speaking JSON-RPC to the proxy | Full control of the handshake | No token cost at all | **Measures the wrong thing.** The question is what *Claude Code* does at teardown, not what a test harness does | Rejected |

**Chosen approach:** headless CLI, with the extension gap recorded per finding rather than closed.
See "Limits of this evidence" below for exactly which results carry that caveat.

## How to Run

```bash
cd .planning/spikes/001-echo-proxy-lifecycle-harness
node run-experiments.mjs all      # or: e1 | e2 | e3 | e4 | e4b
node analyze.mjs logs/001-lifecycle.jsonl
node render-timeline.mjs logs/001-lifecycle.jsonl   # → logs/001-lifecycle.timeline.html
```

Open `logs/001-lifecycle.timeline.html` in a browser to see one swimlane per proxy subprocess. The
lane count *is* the answer to the process-identity question; hovering any mark shows its raw record.

Each experiment restricts the child session's tool surface with `--tools`, and `--strict-mcp-config`
means the project's real `.mcp.json` is ignored entirely — a spike cannot disturb this session's own
`vice` proxy.

## What to Expect

- `e1` — one pid, **zero** tool calls, but a full `spawn → initialize → tools/list` sequence.
- `e2` — **two** pids under one tag, one per concurrent session, each with its own session id.
- `e3` — **one** pid carrying **two** tool calls, `from-parent` and `from-subagent`.
- `e4b` — **one** pid, and the tool-call text carries the agent's own cwd under `.claude/worktrees/`.

## Observability

`echo-proxy.mjs` is the forensic log layer for all four spikes. Every lifecycle event appends one
JSONL record — ISO timestamp, monotonic `ms`, pid, ppid, experiment tag, event name, plus
per-event detail — through `appendFileSync`, never a write stream. That choice is load-bearing for
spike 002: a buffered stream loses precisely the last lines, which are the ones that answer "how much
completed before SIGKILL".

`analyze.mjs` derives every number quoted below (pid counts, ladder gaps, inferred end state).
`render-timeline.mjs` emits a self-contained HTML swimlane view. Both are shared by spikes 002–004.

## Investigation Trail

**1. Feasibility probe before committing to a plan.** Before decomposing anything, a ~50-line
throwaway proxy in the scratchpad confirmed that a headless `claude -p` session really does spawn a
stdio server from a scratch config. It did — and it immediately produced a result that contradicted
the design note: the teardown ladder opened with **SIGINT**, `stdin` was **never** closed, and
SIGTERM arrived **100ms** later. The design note predicted `stdin EOF → SIGTERM → SIGKILL` with
grace "on the order of a second". That reordered the whole spike: the assumption most likely to be
wrong turned out to be wrong on the first observation.

**2. `--tools` rejects an empty list.** `e1` was written to offer no tools at all, which failed with
`option '--tools <tools...>' argument missing`. Rather than dropping the flag (which would have handed
the child session the full tool surface — Bash, Write, Edit — for no reason), `e1` now offers the
probe tool and instructs the model not to use it, and the analyzer reports the tool-call count so an
accidental call would be visible instead of silently spoiling the result. It reported 0.

**3. `e4` looked validated but proved nothing.** The first worktree run showed one pid and a tool
call, which is the expected result — but a *silently ignored* `isolation` parameter produces the
identical log, and the temp worktree is auto-removed when unchanged, so `git worktree list` after the
fact showed nothing to confirm against. The verdict would have rested on the flag being honoured,
which is exactly the assumption under test.

So `e4b` was added: a second inline agent that gets `Bash`, runs `pwd`, and passes its own working
directory **through the probe tool**, so the pid count and the proof of isolation land in the same log
line stream. It reported `cwd=/workspaces/bruce_lee/.claude/worktrees/agent-a4ceb0b0923a6dd7b` — a
genuinely different filesystem view — while still routing through the parent's single proxy pid. That
is the finding; `e4` alone was not.

**4. An unlooked-for discovery: the client exports its own identity.** The spawn record was written to
capture whatever session id the client might expose, on the assumption it probably exposed none — the
design note's finding-4/5 analysis concludes that process identity must *stand in* for session
identity. It exposes plenty:

```
CLAUDE_CODE_SESSION_ID = 59b4da43-cc7a-4261-b42f-d1d4b726dc90     (distinct per session)
CLAUDE_PID             (the client's own pid)
CLAUDE_PROJECT_DIR, CLAUDE_CONFIG_DIR, CLAUDE_CODE_ENTRYPOINT, CLAUDE_EFFORT, ...
```

This does not change the *key* — one subprocess per session means process identity is still session
identity — but it upgrades the design's "record a session id in the lease as diagnostic metadata"
from an aspiration to a two-line implementation, and `CLAUDE_PID` gives a container-side sweeper a
liveness signal it did not know it had. Noted as a new finding (13) rather than folded into an
existing one.

## Results

**Verdict: VALIDATED.** All three findings confirmed first-hand, plus one new finding and one
contradiction of the design note carried into spike 002.

| Question | Observation | Evidence |
|---|---|---|
| Eager or lazy spawn? | **Eager.** `spawn → initialize → tools/list` with `tool calls: 0` | `e1`, 1 pid, `spawned without any tool call: true` |
| One subprocess per session? | **Yes, one each.** 2 concurrent sessions → 2 pids, 2 distinct session ids | `e2`, `distinct proxy pids: 2` |
| Do subagents spawn their own? | **No.** 2 callers, 1 subprocess | `e3`, 1 pid, `tool_call_begin=2` (`from-parent`, `from-subagent`) |
| Worktree agents too? | **No.** Filesystem view swaps, MCP wiring does not | `e4b`, 1 pid, text `cwd=.../.claude/worktrees/agent-a4ceb0b0923a6dd7b` |

Raw ladder, identical across **all 6** subprocesses observed (5 experiments):

```
2026-07-31T19:08:42.727Z  SIGINT       first
2026-07-31T19:08:42.827Z  SIGTERM      +99.712ms
```

…with **no `stdin_end`, no `stdin_close`, and no `exit` record** in any run — meaning the exit
handler never ran and every proxy was killed outright. The gap was 99.7 / 100.3 / 100.5 / 100.4 /
100.2 / 100.1 ms across the six: a fixed ~100ms step, not a variable grace period.

### What this means for Phase 01.2

- **The lease key is the proxy process.** Confirmed, and the design's own correction of the initial
  research verdict (which feared release at first subagent exit) was right: nothing exits when a
  subagent finishes.
- **Deferred acquisition is mandatory, as designed.** Eager spawn is confirmed, so a proxy that
  acquires on startup would launch an emulator for every session including ones that never touch VICE.
- **A GSD executor wave shares one emulator.** Worktree-isolated agents ride the parent's connection,
  so the instance-handles seed remains the only route to intra-session parallel emulator work — and
  the finding it rests on (5) is now verified rather than assumed.
- **`ROADMAP.md`'s "subagents share their parent's MCP connections" is now measured**, not inferred.

### Surprises

1. **The teardown ladder is not the documented one.** SIGINT first, stdin never closed. A release
   handler wired only to stdin `end`/`close` — which is what the design note's shutdown section
   describes first — **would never have fired**. Spike 002 owns the full measurement.
2. **~100ms between signals, not ~1s.** Six for six. The design note's "grace window is on the order
   of a second" is optimistic by an order of magnitude.
3. **The client hands the server its session id.** Finding 13, above.

### Limits of this evidence

Every observation is from `claude -p` print mode inside the devcontainer. Print mode tears a session
down as soon as the reply is produced, and its ladder may not match the VS Code extension's (which
this project actually uses) or an interactive terminal session's. **The process-identity results
(e1–e4b) are structural and unlikely to differ** — they follow from how servers are registered and
how subagents are modelled, not from how a session ends. **The ladder observation is exactly the
result most at risk** from this gap, which is why spike 002 measures it under a long-lived
`stream-json` session as well as print mode, rather than treating these six samples as settled.
