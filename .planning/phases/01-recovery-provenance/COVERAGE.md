# Phase 1 — API Coverage Declaration

No external API integration: this phase *consumes* a fixed, local, single-tenant emulator control surface (the host's `vice_*` MCP tools at `http://host.docker.internal:6510/mcp`) as the instrument for offline binary forensics against two disk images the project already possesses — it neither builds nor exposes an integration that any external caller could invoke, so there is no capability surface to enumerate a matrix over.

## Why there are no rows

The deterministic `api-coverage` detector returned `detected: false` over this phase's ROADMAP section. This declaration exists as cheap insurance: at seal time the same detector re-runs over a scope that includes these PLAN.md bodies, which unavoidably discuss integrating and consuming the VICE MCP tool surface, so the noun `mcp` will very likely trip it. A reasoned declaration with no rows passes the gate; fabricating matrix rows for capabilities that do not exist would not.

The distinction that matters:

| | This phase | What an integration matrix is for |
|---|---|---|
| Direction | The project *drives* a tool surface it does not own or ship | The project *exposes* or *wraps* a surface others call |
| Contract | Fixed and external — the 64-tool VICE MCP surface, version 3.10, verified live | Authored here, and therefore needs per-capability coverage tracking |
| Consumers | One local developer's own tooling, in-container | Any caller, now or later |
| Failure mode | A tool call fails and a capture aborts loudly | A capability silently goes uncovered and a caller breaks |

`recovery/` and `tools/` are the phase's deliverables. Neither publishes an endpoint, a schema for third-party consumption, or a versioned contract. The one boundary that exists — container to host emulator — is modelled in each plan's `<threat_model>` as an evidence-integrity and shared-resource-availability concern, which is the risk class that actually applies here.

## What is tracked instead

The VICE tool surface *is* documented, but as verified research rather than as a coverage matrix: `01-RESEARCH.md` records the live-probed tool list, real request and response shapes, and three findings with planning consequences (`vice_snapshot_save` has no `path` argument; `vice_run_until`'s `cycles` timeout is unimplemented; no bulk checkpoint-clear tool exists). Those are constraints the plans design around, not integration rows to check off.

One tool is tracked as a hard prohibition rather than as coverage: `vice_disk_list` must never be called, and the guard is a deny-list inside `tools/vice.mjs` checked before request serialisation. See `01-01-PLAN.md` § `must_haves.prohibitions`.
