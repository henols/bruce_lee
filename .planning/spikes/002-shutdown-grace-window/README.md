---
spike: 002
name: shutdown-grace-window
type: standard
validates: "Given a shutdown handler that busy-writes 10ms progress markers, when a session ends gracefully and when it is killed abruptly, then the log yields the real signal order and the number of ms of synchronous work that completes before death — proving or refuting that a synchronous unlinkSync release lands"
verdict: VALIDATED
related: [001, 003, 004]
tags: [mcp, lifecycle, shutdown, leasing, design-critical]
---

# Spike 002: Shutdown Grace Window

## What This Validates

**Given** an echo proxy whose shutdown handler releases a lease with one `unlinkSync` and then
busy-waits in 10ms slices writing a progress line per slice, **when** a session ends gracefully and
**when** its client is killed abruptly, **then** the log yields the real signal order and the number
of milliseconds of synchronous work that complete before the process dies.

This is design finding **8**, and the source todo names it *"the one that can still invalidate the
design"*: if the real window is shorter than a synchronous `unlinkSync`, automatic release on session
end is not achievable and release becomes sweeper-only — a different design, not an adjustment.

## Research

No new external research; this spike is pure measurement. It reuses spike 001's `echo-proxy.mjs`
unchanged rather than forking it, driven through different env vars, so both spikes measure the same
instrument and their logs concatenate.

The one method question worth recording: **print mode alone cannot answer this.** `claude -p` decides
when the session is over, so it can only ever show one ending. A long-lived session started with
`--input-format stream-json` stays alive as long as its stdin is open, which puts the choice of ending
in the driver's hands — clean stdin close, client SIGTERM, or client SIGKILL. That is what makes f3–f6
possible, and it is the closest available analogue to an interactive session.

## How to Run

```bash
cd .planning/spikes/002-shutdown-grace-window
node run-experiments.mjs all      # or: f1 | f2 | f3 | f4 | f5 | f6
node ../001-echo-proxy-lifecycle-harness/analyze.mjs logs/002-shutdown.jsonl
node ../001-echo-proxy-lifecycle-harness/render-timeline.mjs logs/002-shutdown.jsonl
```

Open `logs/002-shutdown.timeline.html`. The busy-wait slices render as a dense orange run whose length
*is* the grace window; compare `f2-busywait-print-r1` (a short run, cut off) against
`f6-sigkill-busywait` (a run that goes the full distance).

| Experiment | Ending | Question |
|---|---|---|
| f1 | print mode, non-blocking handlers | the real ladder; does `unlinkSync` land? |
| f2 ×3 | print mode, busy-waiting handler | how many ms of synchronous work complete? |
| f3 | long-lived, our stdin write side closed | is stdin EOF ever the trigger? |
| f4 | long-lived, client SIGKILLed | does abrupt death get any cleanup? |
| f5 | long-lived, client SIGTERMed | closest analogue to closing the IDE window |
| f6 | long-lived, client SIGKILLed, busy-waiting | is the orphan path bounded at all? |

## What to Expect

The graceful endings show `SIGINT → +100ms SIGTERM`, an `unlinkSync` completing in well under a
millisecond, and a busy-wait cut off at 490ms. The abrupt ending shows the opposite shape: `stdin_end`,
release, and a normal exit with no bound on how long the handler ran.

## Observability

Same forensic layer as spike 001 — `appendFileSync` per event, monotonic `ms` alongside the ISO
timestamp. Two properties of the instrument are load-bearing here and were chosen deliberately:

- **Unbuffered synchronous appends.** A write stream would lose exactly the last lines, which are the
  measurement.
- **Two teardown modes.** `ECHO_TEARDOWN_MODE=log` never blocks, so every signal in the ladder is
  recorded with its timestamp. `busywait` blocks on the first trigger, which measures the window but
  *hides* later signals — a blocked event loop cannot run another handler. Reading the ladder and
  measuring the window are therefore separate experiments (f1/f3–f5 vs f2/f6), not one.

## Investigation Trail

**1. First run at 100ms slices was too coarse.** It bracketed the window at "somewhere past 400ms",
which cannot distinguish a 400ms budget from a 500ms one. Re-run at 10ms slices and repeated three
times, since one sample cannot tell a fixed client-side timer from scheduling noise. All three landed
on **exactly 49 slices / 490ms**, which settles it as a fixed timer.

**2. A bug in my own instrument nearly produced a false finding.** The orphan reaper used
`pgrep -f 'echo-proxy.mjs'`, which also matches the `bash -lc "pgrep -f echo-proxy.mjs"` wrapper
running the search — so it reported a phantom orphan on every call. For one run that looked like
evidence that proxies survive their clients, which would have been a significant (and wrong) finding.
Fixed to require a `node` invocation in the command line; after the fix, zero orphans on the graceful
paths, which is the honest result.

**3. f4 inverted the design's central claim, so f6 was added to confirm it.** The design note states
*"The SIGKILL path gets nothing… it leaks an orphaned `x64sc` eating host RAM, so the host-side sweeper
is mandatory rather than hygiene."* f4 showed the opposite: killing the client closes the pipe, the
proxy sees `stdin_end`, releases the lease in 1.4ms, and **exits normally with code 0**.

But f4 only proves ~1.4ms of work fits. If the orphan path were also bounded, this would be a minor
correction. So f6 re-ran it with the 8-second busy-wait: it completed **all 800 slices** and then
exited cleanly. The abrupt-death path is **unbounded** — there is no client left to kill the proxy.

**4. Which means the two paths are backwards from the design's model.** The path the design treats as
safe (graceful) is the constrained one at ~490ms. The path it treats as hopeless (abrupt) is the
unconstrained one. Recorded as the headline finding below.

## Results

**Verdict: VALIDATED — the design survives, but for different reasons than it states, and one of its
stated reasons is wrong.**

### The real ladder, by ending

| Ending | First trigger | Then | Release landed? | Process end |
|---|---|---|---|---|
| Print mode (f1, f2×3) | **SIGINT** | SIGTERM +100ms, SIGKILL +~500ms | ✓ | killed, exit handler never ran |
| Long-lived, stdin closed (f3) | **SIGINT** | SIGTERM +100.3ms | ✓ 0.171ms | killed, exit handler never ran |
| Long-lived, client SIGTERM (f5) | **SIGINT** | SIGTERM +100.2ms | ✓ 0.5ms | killed, exit handler never ran |
| Long-lived, client SIGKILL (f4, f6) | **`stdin_end`** | `stdin_close` +3ms | ✓ 1.4ms | **normal exit, code 0** |

### The window

```
f2 run 1:  lease unlinkSync 0.108ms | busywait 49 slices -> 490ms | killed
f2 run 2:  lease unlinkSync 0.076ms | busywait 49 slices -> 490ms | killed
f2 run 3:  lease unlinkSync 0.065ms | busywait 49 slices -> 490ms | killed
f6:        client SIGKILLed         | busywait 800 slices -> 8000ms, COMPLETED, exit 0
```

**Graceful window: ~490–500ms of synchronous work, measured from the first signal.** The
`unlinkSync` release consumes **0.065–0.171ms** of it — roughly **3000–7000× inside budget**. Release
on session end is comfortably achievable.

### The findings, restated

1. **`unlinkSync` release is safe.** ~0.1ms against a ~490ms budget. The design's load-bearing choice
   stands, and the spike's headline risk is closed.
2. **The window is ~490ms, not "on the order of a second".** Optimistic by about 2×. Still ample for
   the intended one syscall, but it rules out anything speculative — an `await fetch(...)` to the host
   would have roughly a coin's chance under load, which is precisely why the design forbids it. The
   prohibition was right; its stated margin was not.
3. **The trigger depends on how the session ended, and the two cases fire *different* handlers.**
   Graceful endings deliver **SIGINT** and never close stdin. Abrupt client death closes stdin and
   never signals. **A proxy must wire release to both `SIGINT`/`SIGTERM` and stdin `end`/`close`** —
   the design note's shutdown section leads with stdin `end`/`close`, which would have missed *every*
   graceful shutdown, and a signals-only implementation would miss every abrupt one. Neither alone is
   sufficient; this is the correction with the most direct effect on the implementation.
4. **Abrupt client death is the *best* case, not the worst.** Unbounded time and a clean exit. The
   design note's claim to the contrary is wrong and must be struck.
5. **`SIGINT` arriving first is itself notable.** A proxy that treats SIGINT as "user pressed Ctrl-C,
   ignore it" — a common idiom — would burn the first 100ms of a 490ms budget and, in the print-mode
   case, never release at all.

### Is the TTL sweeper still mandatory?

**Yes, but not for the reason the design gives.** Abrupt client death is now covered by the stdin-EOF
path, so it is no longer the justification. What remains uncovered:

- the **proxy itself** being SIGKILLed (which happens ~500ms into *every* graceful teardown — after
  its chance, but a proxy that blocks for 490ms on something else would be cut off mid-release);
- container or host death, where nothing in-process runs;
- a proxy wedged with a blocked event loop, so neither handler ever fires.

The sweeper stays mandatory. The design note's *stated* reason for it should be replaced with these.

### Limits of this evidence

All six experiments are headless — `claude -p`, in print mode or with `--input-format stream-json`.
The VS Code extension is not measured. Two reasons to think the result transfers, and one caveat:

- **f5 (client SIGTERM) and f3 (stdin closed) produced the identical ladder to print mode**, so the
  `SIGINT → +100ms SIGTERM → +~500ms SIGKILL` shape held across three different endings and two
  session modes. It looks like the client's own MCP-shutdown routine, not an artifact of print mode.
- **f4/f6's stdin-EOF path is a property of POSIX pipes**, not of Claude Code: any client death closes
  the pipe. That result is the most portable of the set.
- **Caveat:** the ~490ms figure is a client-side timer and could differ by client version or by
  extension host. Nothing in the design depends on the exact value — only on it being ≫0.1ms, which
  has 3 orders of magnitude of headroom. Re-measure if a future implementation ever wants to do real
  work in the handler.
