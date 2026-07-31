# Proxy Lifecycle and Process Identity

When the per-session stdio MCP proxy exists, who it is, and what that means for lease keying.

## Requirements

- **The lease records `CLAUDE_CODE_SESSION_ID` as diagnostic metadata, not as the lease key.** One
  subprocess per session means process identity already *is* session identity. The session id makes
  "who holds this instance" answerable; it is not what the broker keys on.
- **Measurement is headless-CLI-based; the extension gap is documented, not closed.** Every constant
  below records whether it came from `claude -p` print mode or a long-lived `stream-json` session, and
  therefore whether it could differ under the VS Code extension that this project actually uses.

## How to Build It

### 1. The lease key is the proxy process

Measured: two concurrent sessions in one project → **two** proxy subprocesses, two distinct
`CLAUDE_CODE_SESSION_ID` values (spike 001 `e2`). There is no daemon and no multiplexing. So:

```js
// One lease file per proxy process. The pid IS the key.
leaseFile = join(LEASE_DIR, `${process.pid}.lease`);
writeFileSync(leaseFile, JSON.stringify({
  pid: process.pid,
  sessionId: process.env.CLAUDE_CODE_SESSION_ID ?? null,  // metadata, not the key
  clientPid: process.env.CLAUDE_PID ?? null,              // liveness signal for the sweeper
  created: new Date().toISOString(),
}));
```

The file does three jobs at once: **existence = the lease, mtime = the heartbeat, removal = the
release signal.** See `shutdown-and-lease-release.md` for the removal half.

### 2. Deferred acquisition is mandatory, because spawn is eager

Measured: a session that made **zero** tool calls still produced a full
`spawn → initialize → tools/list` sequence (spike 001 `e1`). Every session gets a proxy whether or
not it ever touches VICE.

Therefore `initialize` and `tools/list` must be answered from a **static in-proxy manifest** — no
host round trip, no broker contact, no `x64sc` launch. The first *forwarded tool call* is what
acquires an instance:

```js
if (method === "initialize") {
  send({ jsonrpc: "2.0", id, result: {
    protocolVersion: msg.params?.protocolVersion || "2024-11-05",
    capabilities: { tools: {} },
    serverInfo: { name: "vice-proxy", version: "…" },
  }});
  return;                       // nothing host-side has happened yet
}
if (method === "tools/list") {
  send({ jsonrpc: "2.0", id, result: { tools: STATIC_MANIFEST } });
  return;                       // still nothing host-side
}
```

A proxy that acquired on startup would launch an emulator for every documentation session, every
`/gsd-plan-phase` run, every session that only edits assembly.

### 3. Subagents get no proxy of their own

Measured: a parent plus a subagent produced **1** pid carrying **2** tool calls (spike 001 `e3`).
A `isolation: "worktree"` agent reported its own cwd
(`/workspaces/bruce_lee/.claude/worktrees/agent-a4ceb0b0923a6dd7b`) *through the probe tool* while
still routing over the parent's single pid (spike 001 `e4b`) — the filesystem view swaps, the MCP
wiring does not.

Consequences that must be built in:

- **No per-subagent lease.** Nothing releases when a subagent finishes; do not wire release to
  anything subagent-shaped.
- **A GSD executor wave shares one emulator.** Parallel plans in one phase all reach the same
  `x64sc`. Intra-session parallel emulator work needs the deferred *instance handles* seed, not
  per-subagent leases.
- Nested subagents were **not** tested. The rule is expected to hold (they are additional model loops
  in the same process) but it is an inference, not a measurement.

### 4. The proxy must never throw

Stdio MCP servers are **not** auto-reconnected when they die mid-session — HTTP/SSE reconnect with
backoff, stdio stays dead for the rest of the session. Register the safety net before anything else,
so it covers every line below it:

```js
process.on("uncaughtException", (err) => log("uncaught_exception", { message: String(err?.message || err) }));
process.on("unhandledRejection", (reason) => log("unhandled_rejection", { reason: String(reason).slice(0, 300) }));
```

Spike 003 corroborates the consequence rather than the rule: a proxy that took `write EPIPE` after
the client hung up survived only because of exactly this handler. Wrap the per-message dispatch too —
a bad `tools/call` argument must not be able to end emulator access for the session.

### 5. The client hands the server its own identity

Available in the proxy's `process.env` with no work at all:

```
CLAUDE_CODE_SESSION_ID   distinct per session
CLAUDE_PID               the client's own pid — a liveness signal for a container-side sweeper
CLAUDE_PROJECT_DIR, CLAUDE_CONFIG_DIR, CLAUDE_CODE_ENTRYPOINT, CLAUDE_EFFORT
```

`CLAUDE_PID` is the one worth noticing: a sweeper can check whether the client that owns a lease is
still alive, rather than relying on TTL alone.

## What to Avoid

- **Acquiring an emulator during `initialize`.** Spawn is eager; this launches `x64sc` for sessions
  that never use it. This is the single most consequential thing to get right in the proxy.
- **Treating the session id as the lease key.** It is metadata. The pid is the key, and conflating
  them invites a design where two things claim to identify the same lease.
- **Wiring anything to subagent lifetime.** Nothing observable happens in the proxy when a subagent
  starts or finishes.
- **Assuming a worktree-isolated agent has its own MCP connection** because it has its own
  filesystem. It does not.
- **Letting any code path throw.** A dead stdio proxy is unrecoverable for the whole session, and
  there is no reconnect to fall back on.
- **Verifying `isolation: "worktree"` by its result alone.** Spike 001's first attempt showed the
  expected one-pid log — but a *silently ignored* `isolation` flag produces an identical log, and the
  temp worktree is auto-removed when unchanged, so there is nothing to check afterwards. Have the
  agent report its own cwd *through the instrument* so the proof and the measurement land in the same
  log stream.

## Constraints

| Fact | Value | Evidence |
|---|---|---|
| Subprocesses per session | exactly 1 | 001 `e2`: 2 sessions → 2 pids |
| Subprocesses per subagent | 0 | 001 `e3`: 1 pid, 2 calls |
| Spawn timing | eager, at session start | 001 `e1`: handshake with 0 tool calls |
| Session id exposed to server | yes, `CLAUDE_CODE_SESSION_ID` | 001 spawn record |
| Stdio server auto-reconnect | none | design finding 7 (HIGH, doc-derived) |
| MCP config re-read mid-session | never — read once at session start | design finding 1 (HIGH) |
| Nested subagents | untested | — |

All observations are from `claude -p` inside this devcontainer (CLI v2.1.220). The process-identity
results are structural — they follow from how servers are registered and how subagents are modelled,
not from how a session ends — so they are the set *least* likely to differ in the VS Code extension.

## Origin

Synthesized from spike: 001 (with the idle-liveness cross-check from 003 `g3`).
Source files: `sources/001-echo-proxy-lifecycle-harness/` — `echo-proxy.mjs` is the instrument,
`run-experiments.mjs` the driver, `analyze.mjs` derives every number quoted here.
Raw JSONL logs and rendered timelines: `.planning/spikes/001-echo-proxy-lifecycle-harness/logs/`.
Design note: `.planning/notes/vice-mcp-selector-design.md` findings 4, 5, 6, 13.
