---
category: tooling
priority: major
date: 2026-08-01
source: 01-04 Task 2 (saeger pass)
---

# Host VICE crashed three times in one session during sustained live execution, after the spare-warming fix

## Problem

The 2026-08-01 `VICE_BROKER_SPARES=1` fix (see `2026-08-01-vice-broker-spare-warming-and-stale-grant-defects.md`)
root-caused and fixed a *warm-up-time* race: multiple simultaneous `x64sc` spawns losing the
GPU/OpenGL/PulseAudio race. The orchestrator verified this session's instance healthy before
dispatch (a 21.5M-cycle liveness bracket).

Despite that, **this same session's single, already-running instance crashed three separate times**
during 01-04 Task 2's saeger pass — not during warm-up, but partway through ordinary sustained
`vice_execution_run` + polling work:

1. Epoch 8 → 9, after ~12.5M cycles of confirmed-live danish work plus a completed saeger
   `disk_attach`/`autostart`/partial boot.
2. Epoch 9 → 10, roughly 8 minutes later, immediately after a clean 45.5M-cycle counting-tier
   probe (non-stopping checkpoint, hit_count 2513) — i.e., mid-session, well past any warm-up
   window.
3. Epoch 10 → 11, during a *single* boot attempt that had already run for ~500M cycles
   (measured via two `cycles_stopwatch read` calls: 301,839,712 then 498,181,326) without the
   `$08B1` trigger checkpoint (armed, `stop:true`) ever firing — i.e., either the boot is
   genuinely very slow this run, or the machine was silently degrading before it fully died.

Each time, the proxy's epoch-drift detection worked exactly as designed: the next forwarded call
after the crash returned a loud, unambiguous `"epoch drift detected... changed from N to N+1"`
error naming both PIDs, and every call after that transparently used the new instance with no
stale-grant caching (contrast with the OLDER documented defect where "the container proxy caches
a dead grant for the session's whole life"). So the *detection and recovery* mechanism is sound.
The *emulator's stability under sustained execution* is not.

## Open question this todo exists to flag

Is this the same GPU/OpenGL/PulseAudio race recurring under a different trigger (e.g., something
in `x64sc`'s rendering or audio path faults after a few hundred million cycles of continuous
execution, not just at spawn), or a distinct defect? The three crashes in this session all
followed a period of continuous `vice_execution_run` + tight `vice_ping` polling loops with no
intervening pause — worth checking whether prolonged unattended `running` state (as opposed to
frequent pause/resume cycles) is itself a contributing factor.

## Evidence

Recorded live in `.planning/RE-FINDINGS.md` under "a genuine mid-session host VICE crash/respawn,
self-surfaced by the proxy as an epoch-drift error, and auto-recovered on the NEXT call" (first
and second occurrence) plus this file for the third. Each occurrence's pid/epoch/cycle numbers
are in that log entry.

## Suggested next step

Host-side investigation of `x64sc` crash logs/core dumps for these PIDs (827101, 944178,
1056804) if still available under `.vice-supervisor/`'s crash evidence collection (per
`tools/vice-supervisor.sh`'s per-crash log format) — the supervisor should have captured stderr
and exit status for each. Until root-caused, treat any live-emulator plan as needing to tolerate
re-deriving a boot sequence multiple times per session, not just once.
