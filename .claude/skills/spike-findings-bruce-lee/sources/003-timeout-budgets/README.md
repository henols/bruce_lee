---
spike: 003
name: timeout-budgets
type: standard
validates: "Given handlers that sleep in increasing increments, when initialize and tools/call are delayed and a session sits idle past 30 minutes, then the log shows where the startup and tool-call budgets cut off and whether anything reaps an idle proxy"
verdict: VALIDATED
related: [001, 002, 004]
tags: [mcp, lifecycle, timeouts, idle]
---

# Spike 003: Timeout Budgets

## What This Validates

**Given** an echo proxy with injected delays before `initialize` and before `tools/call`, and a
long-lived session left completely idle, **when** each budget is exceeded, **then** the log shows where
the client cuts off and whether anything reaps an idle server.

Three budgets, three consequences for Phase 01.2:

| Budget | Why the design cares |
|---|---|
| **Startup** | The proxy answers `initialize`/`tools/list` from a manifest specifically to avoid spending this. How much slack does that buy? |
| **First call** | The cold path — broker launch + `x64sc` boot + MCP-ready, all inside one `tools/call`. Sets the "warming, retry" threshold. |
| **Idle** | A long documentation session that silently loses its lease mid-session. The one MEDIUM that only wall-clock waiting can settle. |

## Research

No new external research; the relevant env vars (`MCP_TIMEOUT`, `MCP_TOOL_TIMEOUT`,
`MAX_MCP_OUTPUT_TOKENS`) come from design finding 12, which lists them as existing but **unconfirmed**.
Confirming whether each one actually governs what its name suggests is part of the measurement here
rather than something to look up — the documented default for `MCP_TIMEOUT` turned out to be a red
herring (see g1c).

Reuses spike 001's `echo-proxy.mjs` via `ECHO_INIT_DELAY_MS`, `ECHO_CALL_DELAY_MS` and
`ECHO_HEARTBEAT_MS`.

## How to Run

```bash
cd .planning/spikes/003-timeout-budgets
node run-experiments.mjs g1     # startup ladder: 3s / 20s / 35s / 65s
G1B_LADDER=4000,5000,6000,7000 node run-experiments.mjs g1b   # bisect
node run-experiments.mjs g1c    # does MCP_TIMEOUT raise it?
node run-experiments.mjs g1d    # long-lived: is a late server usable on a later turn?
node run-experiments.mjs g2     # call budget: 30s / 90s / 150s
node run-experiments.mjs g2knob # does MCP_TOOL_TIMEOUT cut a call short?
G3_IDLE_MINUTES=40 node run-experiments.mjs g3   # ~40 min wall clock
```

`g3` is wall-clock bound and cannot be shortened; run it detached and read
`logs/003-observations.txt` for its minute-by-minute liveness notes.

## What to Expect

Startup delays appear to fail fast in print mode and *don't* in a long-lived session — that
discrepancy is the finding. Tool calls survive delays far longer than expected. `MCP_TOOL_TIMEOUT`
produces a readable timeout message to the model; `MCP_TIMEOUT` does nothing observable.

## Observability

Beyond the shared JSONL log, this spike adds `logs/003-observations.txt` — a timestamped narrative
written by the driver itself. It exists for `g3`: a 40-minute idle watch needs a human-readable record
of "still alive at minute N" that survives the driver being detached, and the proxy's own 60-second
`heartbeat` records provide the independent, in-process liveness track to cross-check it against.

## Investigation Trail

**1. The startup ladder looked decisive and was misleading.** Delays of 3s / 20s / 35s / 65s all
returned `exit=0` in 4–8 seconds — far less than the injected delay. First reading: the client gives up
on a slow server almost immediately. The 20s case even showed the proxy taking `write EPIPE` after
finishing its handshake, proving the client had hung up.

**2. The model's output was worthless as evidence.** With the tool absent, haiku emitted literal
`<function_calls>` markup **as prose** — text that reads like a successful tool call to a careless eye.
The criterion was changed to *"did `tools/list` arrive at the proxy"*, a fact about the client that no
model behaviour can fake. That single change is what made the rest of the spike trustworthy.

**3. Bisecting put the apparent budget between 3s and 4s** — an order of magnitude below
`MCP_TIMEOUT`'s documented 30s default. That gap was suspicious rather than satisfying.

**4. `MCP_TIMEOUT=60000` changed nothing** (g1c): still abandoned, client still exited in 3.4s — *less
than the 10s delay*. So the number was not a timeout at all. It matched the client's own turn duration,
which suggested the real explanation: **print mode never waits for MCP initialisation; it starts the
turn immediately and ends the session when the turn ends.** The "3.5s budget" was an artifact of the
measurement, not a property of the client.

**5. g1d settled it, and it is the most consequential result here.** A long-lived session with a 10s
init delay:

```
19:26:26.708  rpc_in  initialize
19:26:26.708  init_delay_begin
19:26:36.708  init_delay_end          <- 10s late
19:26:36.715  rpc_in  tools/list      <- client came back for it anyway
19:26:57.465  tool_call_begin  g1d-turn2   <- and the tool worked on turn 2
```

Turn 1 (issued while the proxy was mid-handshake) got no tool. Turn 2 did. **A slow handshake costs the
turns that overlap it, not the session.** The distinction matters enormously: finding 7 says a dead
stdio server is unrecoverable for the session, so "slow start = session loses emulator access" would
have been a serious constraint. It isn't one.

**6. The call budget is far larger than feared.** 30s, 90s and **150s** delays all returned real
results (`echo:g2`). A cold `x64sc` launch is seconds, so the cold path fits with room to spare —
which demotes warm spares from a correctness requirement to a latency optimisation.

**7. `MCP_TOOL_TIMEOUT` works and fails *well*.** Set to 6000ms against a 25s delay, the model was
told: *"The tool timed out after 6 seconds."* A clean, readable error — not a killed server, not a
hang. That is exactly the channel the design's "warming, retry" message needs.

## Results

**Verdict: VALIDATED.** Two of the three budgets are far more generous than the design assumed, the
third — startup — turned out not to be a deadline at all, and the idle risk does not exist.

### Startup

| Init delay | `init` finished | `tools/list` arrived | Outcome |
|---|---|---|---|
| 3s | ✓ | ✓ | tool available |
| 4s–65s (print mode) | ✓ (EPIPE after) | ✗ | server abandoned *for that one-turn session* |
| 10s (long-lived, g1d) | ✓ | ✓ | **tool worked on the next turn** |
| 10s + `MCP_TIMEOUT=60000` | — | ✗ | knob has no effect |

**There is no client-side startup deadline that drops a server.** Answering `initialize`/`tools/list`
from a manifest remains the right design — a first turn without tools is a real cost — but it is not
load-bearing for session correctness.

### First call

| Call delay | Result |
|---|---|
| 30s | real result returned |
| 90s | real result returned |
| 150s | real result returned |
| 25s with `MCP_TOOL_TIMEOUT=6000` | *"The tool timed out after 6 seconds."* — clean error, server survives |

**Default tool-call budget ≥150s.** `MCP_TOOL_TIMEOUT` is confirmed as the lever for the
"warming, retry" threshold.

### Idle

**Nothing reaps an idle proxy.** A session was held open and completely idle for **40.1 minutes** —
past the 30-minute mark the source todo names — with two independent liveness tracks agreeing:

```
driver:  minute 5 / 10 / 15 / 20 / 25 / 30 / 35 / 40  -> "client still alive, still idle"
proxy:   39 heartbeats, interval min/max 60.1s / 60.1s, continuous span 38.0 min
         signals before minute 40: NONE
         teardown only after the driver closed stdin: SIGINT -> SIGTERM
```

The heartbeat interval never drifted from 60.1s, so the proxy's event loop was never starved, never
paused, and never signalled. The only teardown was the one the driver caused, and it followed spike
002's graceful ladder exactly (`SIGINT → SIGTERM`), which is a useful cross-check that a 40-minute-old
session tears down the same way a 4-second-old one does.

**Consequence for Phase 01.2:** a long documentation or annotation session does **not** silently lose
its lease to an idle timeout. The interval-timer heartbeat the design already specifies (lifecycle step
5) is still needed — but to keep the *broker's* TTL sweeper from reclaiming a thinking session, not to
survive anything the client does. The MEDIUM risk of "a long session silently loses its emulator
mid-work" is closed.

### Limits of this evidence

Headless CLI only. The startup result is the one where print mode actively *misled*, and it took a
long-lived session to correct — so any future re-measurement of these budgets should use the
`stream-json` mode, not `-p` with a single prompt. The ≥150s call budget is a floor, not the actual
ceiling: nothing was measured beyond 150s because the cold path needs seconds, so a longer ceiling
would not change any decision.

The idle result carries one caveat worth naming: a `stream-json` session with stdin held open is the
closest available analogue to an interactive session, but it is not the VS Code extension. An extension
host could plausibly impose its own idle policy that this cannot see. What the result *does* establish
unconditionally is that **neither the CLI nor Node imposes one** — there is no timer inside the client
or the server that fires, which is where the suspicion originally pointed.
