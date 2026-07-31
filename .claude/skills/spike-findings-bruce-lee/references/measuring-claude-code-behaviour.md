# Measuring Claude Code's Own Behaviour

Every constant in the other four references carries a headless-CLI caveat, and two of them
(`MAX_MCP_OUTPUT_TOKENS`'s threshold, the 490ms grace window) are explicitly flagged for re-checking
at implementation time. This is the recipe for re-measuring any of them without rebuilding the rig —
and, just as importantly, the list of ways the rig lies to you.

## Requirements

- **The real `.mcp.json` is never modified by a measurement.** All registration goes through a scratch
  config file plus `--strict-mcp-config`. A probe must not be able to break the session's own emulator
  access.
- **Every finding records the command used and the raw log excerpt.** A finding without its log
  excerpt is not a finding.
- **Every finding records whether it was observed in `claude -p` print mode only**, and therefore
  whether it could differ under the VS Code extension.

## How to Build It

### The rig

The `claude` CLI is installed **inside this devcontainer** at `/home/vscode/.local/bin/claude`
(v2.1.220 when measured). This is the fact that turns "ask the human to click things in the IDE" into a
scripted measurement, and it was not assumed anywhere in the design note.

```bash
# 1. A scratch MCP config that points at the probe. Never touch .mcp.json.
cat > /tmp/scratch-mcp.json <<'JSON'
{ "mcpServers": { "probe": { "command": "node", "args": ["/abs/path/to/echo-proxy.mjs"] } } }
JSON

# 2. Drive a session against it, with the project's real config ignored entirely.
claude -p "…" \
  --strict-mcp-config --mcp-config /tmp/scratch-mcp.json \
  --model haiku --tools mcp__probe__echo_probe --permission-mode bypassPermissions
```

`sources/001-echo-proxy-lifecycle-harness/echo-proxy.mjs` is the reusable instrument — a stdio MCP
server that talks to nothing, exposes one echo tool, and appends one JSONL line per lifecycle event.
Every knob is an env var (`ECHO_TAG`, `ECHO_INIT_DELAY_MS`, `ECHO_CALL_DELAY_MS`, `ECHO_PAYLOAD_BYTES`,
`ECHO_TEARDOWN_MODE`, `ECHO_LEASE_DIR`, `ECHO_HEARTBEAT_MS`, `ECHO_BUSYWAIT_*`), so all four spikes
drove the *same* file rather than forking it — which is what makes their logs directly comparable.
`analyze.mjs` derives pid counts, ladder gaps and inferred end state; `render-timeline.mjs` emits a
self-contained HTML swimlane view (one lane per proxy subprocess).

### Flags that matter, and their traps

| Flag | Why | Trap |
|---|---|---|
| `--strict-mcp-config --mcp-config <file>` | The project's real `.mcp.json` is ignored entirely | — |
| `--tools <names…>` | A real boundary on the child session's tool surface, not a request | **Rejects an empty list.** A probe wanting "no tools" must omit the flag (full surface) or name one and forbid its use in the prompt |
| `--agents <json>` | Defines inline subagents with their own tool lists | — |
| `-p --input-format stream-json --output-format stream-json --verbose` | Keeps a session alive while stdin is open, so the **driver** chooses the ending (stdin close / SIGTERM / SIGKILL) | Print mode alone can only ever show *one* ending, and ends the session after a single turn |
| `--permission-mode bypassPermissions` | Print-mode sessions cannot answer a permission prompt | Pair it with `--tools`; bypassing permissions with a full tool surface is not acceptable |
| `--model haiku` | None of these measurements depend on model quality, only on client process handling | Where a result *does* depend on model behaviour it is a liability — see below |

### Forensic logging rules

- **`appendFileSync`, never a write stream.** Load-bearing, not stylistic: these measurements are about
  what completes before a process dies, and a buffered stream loses exactly the last lines — the ones
  that are the measurement.
- **ISO timestamp *and* a monotonic `ms`.** The ISO field correlates events across processes; every
  computed delta uses the monotonic reading, which has sub-millisecond resolution and survives clock
  adjustment.
- **A failed log write must never take the process down** — that turns a logging problem into a fake
  "the client killed us" observation.
- **One JSONL log per spike, tagged per experiment** via `ECHO_TAG`. That is what makes "how many
  distinct pids appeared under this tag" a one-line query.

### Reading the ladder vs measuring the window are different experiments

`ECHO_TEARDOWN_MODE=log` never blocks, so every signal in the ladder is recorded with its timestamp.
`busywait` blocks on the first trigger, which measures the window but **hides later signals** — a
blocked event loop cannot run another handler. You cannot get both from one run.

## What to Avoid

These are the five ways the rig produced a wrong answer that looked right. **Two of the four spikes
had a self-inflicted false result; assume the next one does too.**

- **Print mode for anything timing-related.** It ends the session when the turn ends, so a slow
  handshake looks like a ~3.5s client timeout that does not exist. Bisecting a phantom budget is a
  convincing waste of time. Use `stream-json` with stdin held open.
- **Trusting the model's word.** With the tool absent, haiku emitted literal `<function_calls>` markup
  **as prose** — which reads like a successful call. Find a client-side or filesystem fact instead: the
  criterion became *"did `tools/list` arrive at the proxy"*. Where a model's report is the only channel
  (the payload markers in 004), ask for a structural fact it cannot fake convincingly (`END_PAYLOAD`
  present or not) and cross-check against the file on disk.
- **`pgrep -f '<script>.mjs'` to detect orphans.** It also matches the `bash -lc "pgrep -f …"` wrapper
  running the search, so it reports a phantom orphan on **every** call — which for one run looked like
  evidence that proxies survive their clients, a significant and wrong finding. Require a `node`
  invocation in the matched command line. **Read the instrument as suspiciously as the subject.**
- **Testing a knob without a passing control.** Pairing `MAX_MCP_OUTPUT_TOKENS=2000` with a payload
  that already exceeded the *default* limit proved nothing. Test a knob against an input known to pass
  without it.
- **Accepting a green result without asking what else produces it.** The `isolation: "worktree"` run
  showed the expected one-pid log — but a *silently ignored* flag produces an identical log, and the
  temp worktree is auto-removed when unchanged, so nothing remains to check afterwards. The fix was to
  have the agent report its own cwd **through the instrument**, so the proof and the measurement land
  in the same log stream.

Plus one sampling rule: **repeat any timing measurement at least three times.** One sample cannot
distinguish a fixed client-side timer from scheduling noise. The 490ms window came back 490ms three
times out of three, which is what makes it a constant rather than an observation.

## Constraints

| Fact | Value |
|---|---|
| In-container CLI | `/home/vscode/.local/bin/claude`, v2.1.220 |
| Env knobs confirmed working | `MCP_TOOL_TIMEOUT`, `MAX_MCP_OUTPUT_TOKENS` |
| Env knob confirmed **not** to govern what its name suggests | `MCP_TIMEOUT` (does not extend the startup handshake) |
| Never measured | the VS Code extension — the client this project actually uses |

The extension gap is a deliberate, recorded choice (user decision, 2026-07-31): document it per finding
rather than block on manual IDE cross-checks. Manual extension runs were considered and rejected — they
block on a human for every data point, are unrepeatable, and give no way to bisect a timing budget. A
hand-rolled JSON-RPC client was also rejected as measuring the wrong thing entirely: the question is
what *Claude Code* does at teardown, not what a test harness does.

## Origin

Synthesized from spikes: 001, 002, 003, 004 — the method that is common to all four.
Source files: `sources/001-echo-proxy-lifecycle-harness/` (instrument + analyzer + timeline renderer),
and each spike's own `run-experiments.mjs` as a worked example of driving it.
Spike-session conventions in fuller form: `.planning/spikes/CONVENTIONS.md`.
