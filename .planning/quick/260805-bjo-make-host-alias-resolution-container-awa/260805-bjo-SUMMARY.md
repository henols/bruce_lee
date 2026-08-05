---
phase: quick-260805-bjo
plan: inline (no PLAN.md — see Deviations)
subsystem: infra
tags: [vice-mcp, container-detection, host-alias, docker-bridge]
status: complete
completed: 2026-08-05
---

# Quick Task 260805-bjo: Container-aware host-address resolution

`mcpHost()` returned `host.docker.internal` unconditionally — a Docker-published alias that does not
resolve on the host — so the default was correct in exactly one of the two environments this tree runs
in. Now: container → `host.docker.internal`, otherwise → `127.0.0.1`, with both env overrides still
winning.

Full reasoning is in commit `ac5e079`'s message, which is deliberately the primary record.

## Decisions

- **Reused `container-guard.mts`** via a new `isInsideContainer()` rather than writing a second
  detector. That module's header records why: a `/proc/self/mountinfo` signal was removed from it for
  answering "is Docker installed" instead of "am I in a container", firing on the very host the guard
  exists to permit. The verdict rule (`>=1 fired = CONTAINER`) is the module's own, not invented.
- **Memoised the default-deps verdict** — one signal spawns `systemd-detect-virt`, and `mcpHost()` is
  read fresh per forwarded tool call. The env read stays uncached, preserving override sensitivity.
  Explicit deps bypass the cache, asserted by an alternating test.
- **Fixed at `mcpHost()`**, the documented single definition, not only at `resolveControlTarget()` —
  the narrower fix would have left the data plane wrong and created two notions of "the host".
- **`DEFAULT_ENDPOINT` given the same treatment** — it was the last unconditional literal in the tree.
- **`127.0.0.1` over `localhost`** — `localhost` may resolve `::1` first, and the broker binds
  `0.0.0.0` (IPv4 only), so an IPv6 connect would be refused by a live listener.

## Verification

- Suite **417 tests / 412 pass / 0 fail / 5 todo**, run twice.
- `npx tsc --noEmit` clean.
- `resources/container-guard.mjs` regenerated — a **non-empty** diff is correct here, because
  `container-guard.mts` is one of `build.ts`'s seven host-bound artifacts. Not hand-edited.
- 6 new tests, all through injected deps, so the non-container branch is provable from inside this
  container and no test depends on its own environment.

## NOT verified — stated plainly

**Real cross-boundary connectivity is still unproven.** No test may dial the host broker (the hard
rule covers reimplementing the route), so the suite cannot establish it by design. The only sanctioned
proof is a forwarded `mcp__vice__*` call, and every running proxy process started 2026-08-04
(14:48/19:56) — before both fixes — so this session's proxy still runs pre-fix code. Confirmed by
`vice_ping` returning the OLD heartbeat wording rather than the new address-naming message.

**Requires a vice MCP server restart, then one `vice_ping`.** If it still fails after that, the new
message names the address and port it could not reach, so the next failure diagnoses itself instead of
sending a reader after a stale-threshold theory. Firewall policy and control-token auth over the
bridge both remain untested.

## Deviations

- **No PLAN.md.** `gsd-planner` failed twice with API 529 Overloaded, so this ran inline with the
  orchestrator taking the four recorded decisions itself, having already gathered the evidence
  (`HOST_BOUND_ARTIFACTS` membership, the host-side consumer, the DI seam). Recorded as a deviation
  rather than presented as a planned task.
