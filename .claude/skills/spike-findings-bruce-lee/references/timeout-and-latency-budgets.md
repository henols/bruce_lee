# Timeout and Latency Budgets

How much time the proxy is allowed to spend at startup, inside a single tool call, and sitting idle.
Two of the three budgets are far more generous than the design assumed; the third turned out not to
be a deadline at all.

## Requirements

- **`MCP_TOOL_TIMEOUT` is set explicitly, not inherited.** It was measured to genuinely govern the
  tool-call cutoff, which turns a client-version-dependent surprise into a known constant that the
  "warming, retry" threshold can be derived from.
- **`MCP_TIMEOUT` was measured *not* to govern the startup handshake — do not rely on it.**

## How to Build It

### Startup: there is no deadline, so don't design around one

A proxy that took **10s** to answer `initialize` was still asked for `tools/list`, and its tool was
called successfully on the **next turn of the same session**:

```
19:26:26.708  rpc_in  initialize
19:26:26.708  init_delay_begin
19:26:36.708  init_delay_end          <- 10s late
19:26:36.715  rpc_in  tools/list      <- client came back for it anyway
19:26:57.465  tool_call_begin  g1d-turn2   <- and the tool worked on turn 2
```

**A slow handshake costs the turns that overlap it, not the session.** This matters a lot: finding 7
says a dead stdio server is unrecoverable for the session, so "slow start = session loses emulator
access" would have been a serious constraint. It is not one.

Answering `initialize`/`tools/list` from a static manifest is still the right design — a first turn
without tools is a real cost, and it is what keeps deferred acquisition possible (see
`proxy-lifecycle-and-process-identity.md`) — but it is **not load-bearing for session correctness**.
Do not add complexity to shave handshake milliseconds.

### First call: the cold path fits, with room to spare

Calls blocked for **30s, 90s and 150s all returned real results.** The cold path — broker launch +
`x64sc` boot + MCP-ready — is *seconds*. It fits comfortably inside one `tools/call`.

This **demotes warm spares from a correctness requirement to a latency optimisation.** Build the
cold path first and correctly; add spares when the wait becomes annoying, not because the design
needs them to work.

### The "warming, retry" channel

`MCP_TOOL_TIMEOUT=6000` against a 25s delay produced, to the model:

> *"The tool timed out after 6 seconds."*

A clean, readable error. **Not** a killed server, **not** a hang — the proxy survived and the session
kept working. That is exactly the channel the design's "warming, retry" message needs, so set the
threshold explicitly rather than inheriting whatever the client defaults to:

```
MCP_TOOL_TIMEOUT=<ms>   # the "warming, retry" threshold — derive it from measured cold-boot time
```

### Idle: nothing reaps a proxy, so the heartbeat is for the broker

A session was held open and **completely idle for 40.1 minutes** — past the 30-minute mark the source
todo suspected — with two independent liveness tracks agreeing:

```
driver:  minute 5 / 10 / 15 / 20 / 25 / 30 / 35 / 40  -> "client still alive, still idle"
proxy:   39 heartbeats, interval min/max 60.1s / 60.1s, continuous span 38.0 min
         signals before minute 40: NONE
         teardown only after the driver closed stdin: SIGINT -> SIGTERM
```

The heartbeat interval never drifted from 60.1s, so the event loop was never starved, never paused,
never signalled. Teardown came only when the driver caused it, following the graceful ladder exactly —
a useful cross-check that a 40-minute-old session tears down like a 4-second-old one.

**So the interval-timer heartbeat the design specifies is still needed — but to keep the *broker's*
TTL sweeper from reclaiming a thinking session, not to survive anything the client does.** A long
documentation or annotation session does not silently lose its lease. Size the heartbeat interval
against the sweeper's TTL, and nothing else.

Keep the timer `unref`'d so it never holds the process alive past its natural lifetime — stdin being
open is what does that:

```js
const timer = setInterval(() => touchLease(), HEARTBEAT_MS);
timer.unref?.();
```

## What to Avoid

- **Measuring any client budget in print mode.** This is the trap that nearly produced a false
  finding. Delays of 3s/20s/35s/65s all returned `exit=0` in 4–8 seconds — *less than the injected
  delay* — which read as "the client gives up almost immediately", and bisecting put the apparent
  budget between 3s and 4s. It was an artifact: **print mode never waits for MCP initialisation; it
  starts the turn immediately and ends the session when the turn ends.** Use
  `--input-format stream-json` for anything timing-related.
- **Relying on `MCP_TIMEOUT` to extend the handshake.** `MCP_TIMEOUT=60000` against a 10s init delay
  changed nothing — still abandoned, client still exited in 3.4s. Its documented 30s default is a red
  herring for this question.
- **Treating warm spares as a prerequisite.** The cold path fits in the call budget.
- **Trusting the model's output as evidence of a tool call.** With the tool absent, haiku emitted
  literal `<function_calls>` markup **as prose** — text that reads like a successful call. The
  criterion has to be *"did `tools/list` arrive at the proxy"*, a fact about the client that no model
  behaviour can fake.
- **Designing anti-idle machinery for the client.** There is nothing to defend against; the only
  consumer of the heartbeat is the broker's sweeper.

## Constraints

| Budget | Measured | Evidence |
|---|---|---|
| Startup handshake | **no deadline** — a 10s init still got `tools/list`, tool worked on turn 2 | `g1d` |
| Startup, print mode | *appears* to fail past ~3.5s — artifact of one-turn sessions | `g1`, `g1b`, `g1c` |
| `MCP_TIMEOUT` effect on startup | **none** | `g1c` |
| Default tool-call budget | **≥150s** (a floor, not the ceiling — nothing beyond 150s was tried) | `g2` at 30s/90s/150s |
| `MCP_TOOL_TIMEOUT` | works; cuts the call and reports cleanly to the model; server survives | `g2knob` 6000ms vs 25s delay |
| Idle reaping | **none**, 40.1 min, 39 heartbeats, zero drift, zero signals | `g3` |
| Heartbeat timer stability | 60.1s interval, min == max | `g3` |

Evidence limits: headless CLI only. Startup is the one where print mode **actively misled**, and it
took a long-lived session to correct — so any re-measurement of these budgets must use `stream-json`,
not `-p` with a single prompt. The ≥150s figure is a floor; nothing beyond it was measured because the
cold path needs seconds, so a higher ceiling would change no decision. The idle result's caveat: a
`stream-json` session with stdin held open is the closest available analogue to an interactive
session, but it is not the VS Code extension, which could plausibly impose its own idle policy. What
the result establishes **unconditionally** is that neither the CLI nor Node imposes one — which is
where the suspicion originally pointed.

## Origin

Synthesized from spike: 003.
Source files: `sources/003-timeout-budgets/run-experiments.mjs` (`g1`, `g1b`, `g1c`, `g1d`, `g2`,
`g2knob`, `g3`); driven instrument is `sources/001-echo-proxy-lifecycle-harness/echo-proxy.mjs` via
`ECHO_INIT_DELAY_MS`, `ECHO_CALL_DELAY_MS`, `ECHO_HEARTBEAT_MS`.
`g3` is wall-clock bound and cannot be shortened — run it detached and read `logs/003-observations.txt`
for its minute-by-minute notes.
Raw logs: `.planning/spikes/003-timeout-budgets/logs/`.
Design note: `.planning/notes/vice-mcp-selector-design.md` findings 12 (partly), 14, 15, 16.
