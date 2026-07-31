# Shutdown and Lease Release

How a session actually ends, and what the proxy can get done before it dies. This is the
design-critical area — the source todo named it *"the one that can still invalidate the design."*
It survived, but for different reasons than the design note originally gave, and one of those
reasons was wrong.

## Requirements

- **Release must be wired to BOTH signal handlers and stdin `end`/`close`.** A graceful ending
  delivers SIGINT and never closes stdin; abrupt client death closes stdin and never signals. Each
  path fires only one of the two, so either handler alone misses an entire class of session ending.
- **Nothing but one synchronous filesystem operation goes in the shutdown handler.** The graceful
  window is ~490ms. `unlinkSync` uses ~0.1ms of it; a host round trip would not reliably fit.
- **SIGINT must be treated as a teardown trigger, not ignored as a user Ctrl-C.** It is the *first*
  signal every graceful teardown delivers.

## How to Build It

### The two ladders

There is not one termination ladder, there are two, and **they fire different handlers**:

| Ending | First trigger | Then | Release landed | Process end |
|---|---|---|---|---|
| Print mode (`f1`, `f2`×3) | **SIGINT** | SIGTERM +100ms, SIGKILL ~490ms | ✓ | killed — `exit` handler never ran |
| Long-lived, stdin closed (`f3`) | **SIGINT** | SIGTERM +100.3ms | ✓ 0.171ms | killed — `exit` never ran |
| Long-lived, client SIGTERM (`f5`) | **SIGINT** | SIGTERM +100.2ms | ✓ 0.5ms | killed — `exit` never ran |
| Long-lived, client SIGKILL (`f4`, `f6`) | **`stdin_end`** | `stdin_close` +3ms | ✓ 1.4ms | **normal exit, code 0** |

Graceful endings **never close stdin**. Abrupt client death **never signals**. This is the single
most implementation-relevant correction the spike set produced.

### The handler set, verbatim

```js
let teardownRan = false;

function releaseLease(trigger) {
  if (!leaseFile) return;
  try { unlinkSync(leaseFile); }        // the ENTIRE release. ~0.1ms.
  catch (err) { log("lease_unlink_failed", { trigger, message: String(err?.message || err) }); }
}

function onTeardown(trigger) {
  if (teardownRan) return;              // idempotent — several triggers can arrive
  teardownRan = true;
  releaseLease(trigger);                // FIRST, before anything interruptible
}

process.stdin.on("end",   () => onTeardown("stdin_end"));      // abrupt client death
process.stdin.on("close", () => onTeardown("stdin_close"));    //   "
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {           // graceful — SIGINT arrives FIRST
  process.on(sig, () => onTeardown(sig));
}
```

Four things in that snippet are load-bearing:

1. **Both trigger families are wired.** Drop either and half of all session endings leak a lease.
2. **`SIGINT` is in the signal list.** It is the first signal of every graceful teardown.
3. **The guard makes it idempotent.** SIGINT then SIGTERM 100ms later both call in.
4. **Release runs before anything else.** There is 490ms total; spend the first 0.1ms of it on the
   only thing that matters.

Log every trigger *unconditionally*, even after teardown has already run — the order and spacing of
triggers is what makes a future re-measurement possible.

### Do not use the `exit` handler for release

On all three graceful paths the process is **killed**, so `process.on("exit")` never runs. Its
absence in the log is precisely how SIGKILL was detected (SIGKILL cannot be observed from inside a
process — the missing line is the evidence). An `exit`-based release fires only on the abrupt path.

### The TTL sweeper is still mandatory — for revised reasons

Abrupt client death is now *covered* by the stdin-EOF path, so it is no longer the justification. The
design note's stated reason should be replaced with what actually remains uncovered:

- The **proxy itself** being SIGKILLed — which happens ~500ms into *every* graceful teardown, after
  its chance. A proxy that blocked for 490ms on something else would be cut off mid-release.
- **Container or host death**, where nothing in-process runs at all.
- A proxy **wedged with a blocked event loop**, so neither handler ever fires.

## What to Avoid

- **Wiring release to stdin `end`/`close` only.** This is what the design note's shutdown section
  led with, and it would have missed **every graceful shutdown** — the common case.
- **Wiring release to signals only.** Misses every abrupt client death.
- **Ignoring SIGINT as "user pressed Ctrl-C".** A common idiom, and here it burns the first 100ms of a
  490ms budget — and in the print-mode case never releases at all.
- **Anything asynchronous in the handler.** No `await`, no `fetch`, no child process, no HTTP call to
  the broker. At ~490ms under host load an `await fetch(...)` has roughly a coin's chance. The design's
  prohibition was right; its stated margin ("on the order of a second") was optimistic by about 2×.
- **Relying on `process.on("exit")`.** Never runs on the graceful path.
- **Believing that abrupt death is the worst case.** It is the *best* case — see below. The design
  note's original claim that "the SIGKILL path gets nothing… it leaks an orphaned `x64sc`" is wrong
  and has been struck.
- **Using a buffered write stream for the shutdown log.** A stream loses exactly the last lines,
  which are the measurement. `appendFileSync`, always.

## Constraints

| Fact | Value | Evidence |
|---|---|---|
| Graceful grace window | **~490ms** of synchronous work from the first signal | `f2` ×3, all 49 slices / 490ms — a fixed timer, not noise |
| SIGINT → SIGTERM gap | ~100ms (99.7–100.5ms across 6 subprocesses) | 001 + 002 |
| SIGTERM → SIGKILL | ~+390ms (SIGKILL at ~490ms total) | `f2` |
| `unlinkSync` release cost | **0.065–0.171ms** | `f2` ×3 — ~3000–7000× inside budget |
| Abrupt-death window | **unbounded** — 8000ms of busy-wait completed, then exit 0 | `f6` |
| stdin closed on graceful path? | **never** | `f1`, `f2`, `f3`, `f5` |
| Signal on abrupt path? | **never** | `f4`, `f6` |
| `exit` handler on graceful path? | **never runs** | all graceful runs |

**Inverted from the design's model:** the path it treats as safe (graceful) is the constrained one;
the path it treats as hopeless (abrupt) is the unconstrained one.

Evidence limits: all six experiments are headless (`claude -p`, or `--input-format stream-json`). The
VS Code extension is not measured. Two reasons the result should transfer, and one caveat:

- `f5` (client SIGTERM) and `f3` (stdin closed) produced the **identical** ladder to print mode, so
  `SIGINT → +100ms SIGTERM → ~490ms SIGKILL` held across three endings and two session modes. That
  looks like the client's own MCP-shutdown routine, not a print-mode artifact.
- `f4`/`f6`'s stdin-EOF path is a property of **POSIX pipes**, not of Claude Code — any client death
  closes the pipe. It is the most portable result in the set.
- **Caveat:** 490ms is a client-side timer and could differ by client version or extension host.
  Nothing in the design depends on the exact value, only on it being ≫0.1ms — three orders of
  magnitude of headroom. Re-measure only if an implementation ever wants to do real work in the
  handler (see `measuring-claude-code-behaviour.md`).

## Origin

Synthesized from spike: 002.
Source files: `sources/002-shutdown-grace-window/run-experiments.mjs` (the `f1`–`f6` driver);
the instrument it drives is `sources/001-echo-proxy-lifecycle-harness/echo-proxy.mjs`
(`ECHO_TEARDOWN_MODE`, `ECHO_LEASE_DIR`, `ECHO_BUSYWAIT_*`).
Raw JSONL and the rendered timeline (the busy-wait slices render as a dense run whose length *is* the
window): `.planning/spikes/002-shutdown-grace-window/logs/`.
Design note: `.planning/notes/vice-mcp-selector-design.md` finding 8 (corrected), and the
"Shutdown: what the handler can and cannot do" and "Why release is a delete, not a write" sections.
