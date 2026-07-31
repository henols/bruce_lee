# Spike Wrap-Up Summary

**Date:** 2026-07-31
**Spikes processed:** 4 (all VALIDATED)
**Feature areas:** proxy lifecycle & process identity · shutdown & lease release · timeout & latency
budgets · large-response chunking · measuring Claude Code itself
**Skill output:** `.claude/skills/spike-findings-bruce-lee/`

## Processed Spikes

| # | Name | Type | Verdict | Feature Area |
|---|------|------|---------|--------------|
| 001 | echo-proxy-lifecycle-harness | standard | ✓ VALIDATED | Proxy lifecycle & process identity (+ the shared instrument behind all five areas) |
| 002 | shutdown-grace-window | standard | ✓ VALIDATED | Shutdown & lease release |
| 003 | timeout-budgets | standard | ✓ VALIDATED | Timeout & latency budgets |
| 004 | large-response-chunking | standard | ✓ VALIDATED | Large-response chunking |

## Key Findings

**The design survives, but two of its stated findings were wrong and three new ones were added.** The
spike gate on Phase 01.2 is cleared; anything built from the pre-spike design note will be wrong in two
specific places.

### Confirmed as designed

- **One proxy subprocess per session**, spawned **eagerly** with zero tool calls, **shared by all
  subagents** including `isolation: "worktree"` ones. So the pid is the lease key, deferred acquisition
  is mandatory, and a GSD executor wave shares one emulator (findings 4/5/6, now MEASURED).
- **`unlinkSync` release is safe** — 0.065–0.171ms against a ~490ms budget, roughly 3000–7000× inside
  it. The load-bearing choice of "release is a delete, not a write" stands, and the headline risk that
  could have forced a sweeper-only design is closed.

### Corrections — the design note was wrong here

- **Finding 8 (shutdown), wrong in three ways.** There are **two** ladders and they fire **different**
  handlers. Graceful: **SIGINT** → SIGTERM +100ms → SIGKILL at **~490ms**, with stdin **never** closed
  and the `exit` handler never running. Abrupt client death: no signal at all, stdin EOF fires,
  **unbounded** time, exits cleanly with code 0. The predicted `stdin EOF → SIGTERM → SIGKILL` with
  grace "on the order of a second" is not what happens — and the note's claim that the SIGKILL path
  *"gets nothing… it leaks an orphaned `x64sc`"* is **inverted**: that is the best case, not the worst.
  **This is the correction with the most direct effect on the implementation**: a release handler wired
  only to stdin `end`/`close` — which the note's shutdown section led with — would have missed *every*
  graceful shutdown.
- **Finding 12 (output ceiling), about 2× too generous.** Assumed ~25K tokens / ~100KB; measured
  **40–60KB**. Chunk at **32KB**; 64KB sits inside the failure bracket.

### New findings

- **13** — the client exports its own identity into every MCP server's env:
  `CLAUDE_CODE_SESSION_ID` (distinct per session), `CLAUDE_PID`, `CLAUDE_PROJECT_DIR`, and more. Turns
  "record a session id in the lease as diagnostic metadata" from an aspiration into two lines, and gives
  a sweeper a liveness signal it did not know it had.
- **14** — **no startup deadline exists.** A proxy that took 10s to answer `initialize` was still asked
  for `tools/list` and its tool worked on the next turn. A slow handshake costs the turns that overlap
  it, not the session. `MCP_TIMEOUT` does not change this.
- **15** — **default tool-call budget ≥150s.** The cold path (broker launch + `x64sc` boot + MCP-ready)
  fits inside one `tools/call` with room to spare, which demotes warm spares from a correctness
  requirement to a latency optimisation.
- **16** — **nothing reaps an idle proxy.** 40.1 minutes idle, 39 heartbeats at a 60.1s interval with
  zero drift and no signal of any kind. The "a long documentation session silently loses its emulator
  mid-work" risk is closed; the heartbeat is needed only to keep the *broker's* TTL sweeper honest.

### Also worth carrying forward

- **No silent truncation at any payload size tested** — the catastrophic outcome (a truncated RAM dump
  that looks complete, corrupting a capture and every downstream provenance verdict) does not occur.
  Spills are byte-complete, but at a path the proxy cannot predict, so the spill path is unusable as
  transport.
- **An oversized response invites a retry loop.** The model called the tool again, unprompted, 2–3
  times per spilled experiment. Harmless for a memory read; not for anything with side effects.
- **`MCP_TOOL_TIMEOUT` fails *well*** — a clean *"The tool timed out after 6 seconds"* to the model,
  server surviving. That is the channel the "warming, retry" message needs.
- **The TTL sweeper stays mandatory, for revised reasons:** the proxy itself being SIGKILLed ~500ms into
  every graceful teardown, container/host death, and a wedged event loop. Abrupt client death is no
  longer the justification.

### Method lessons

**Two of the four spikes had a self-inflicted false result** that briefly looked like a real finding —
a `pgrep -f` pattern matching its own search wrapper (phantom orphans), and an output-limit knob tested
against an input that already failed without it. A third nearly did: print mode made a nonexistent
~3.5s startup timeout look real and bisectable. And with the tool absent, haiku emitted literal
`<function_calls>` markup **as prose**, which reads like a successful call. The rules that came out of
it — find a client-side or filesystem fact rather than trusting the model, test a knob against a
control known to pass, repeat any timing measurement three times, read the instrument as suspiciously
as the subject — are captured in `references/measuring-claude-code-behaviour.md` and `CONVENTIONS.md`.

## Evidence Limits

All measurements are headless (`claude -p`, or `--input-format stream-json` where an ending had to be
chosen by the driver), CLI v2.1.220, inside this devcontainer. **The VS Code extension — the client
this project actually uses — was never measured.** This was a deliberate choice (document the gap
per finding rather than block on manual IDE cross-checks). The two constants most worth re-checking at
implementation time are the **40–60KB inline ceiling** (chunk sizing depends on it) and the **~490ms
grace window** (a client-side timer), which is why setting `MAX_MCP_OUTPUT_TOKENS` and
`MCP_TOOL_TIMEOUT` explicitly is a requirement rather than a suggestion.
