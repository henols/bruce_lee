# API Coverage — `@mastra/mcp` (adopted per CONTEXT.md D-01)

> Full coverage by default. Opt-outs are explicit, reasoned decisions.

**Why this file exists.** The api-coverage detector fired on this phase (`{"detected":true}`,
signals: `adopt`+`mcp`, `(surface)`+`sdk`). D-01 adopts `@mastra/mcp` deliberately narrowly — only
the ~6–12% generic JSON-RPC framing seam RESEARCH.md §B4 measured in `vice-proxy.mjs`. That
narrowness is a *decision*, and this matrix is what makes it a recorded one rather than an
invisible hole.

**Scope note.** Every OPT-OUT below is a capability of the library that this proxy has no
corresponding surface for — not a capability that was skipped for time. `vice-proxy` is a
stdio-only MCP server that translates tool calls into VICE's own (non-MCP) binary monitor
protocol; it holds no Mastra agents, tools, workflows, prompts or resources to expose.
RESEARCH.md §B5 develops this in full.

| capability | decision | reason |
|---|---|---|
| `MCPServer` — stdio transport | INTEGRATE | The proxy's only transport, and the one `.mcp.json` launches it under. |
| `MCPServer` — `initialize` / protocol-version negotiation | INTEGRATE | `handleInitialize()` is inside the D-01 seam (RESEARCH.md §B4). |
| `MCPServer` — `tools/list` | INTEGRATE | Inside the seam. Note Phase 01.4 owns the *reachability* defect on this surface; this phase must not change its observable output. |
| `MCPServer` — `tools/call` routing skeleton | INTEGRATE | Inside the seam (`handleToolsCall()` routing only — the deny-list, path rewriting and broker leasing wrapped around it stay hand-rolled). |
| `MCPServer` — JSON-RPC 2.0 message framing | INTEGRATE | `writeMessage()`/`respond()`/`errorResponse()` — the largest single item in the seam. |
| `MCPServer` — Streamable HTTP transport | OPT-OUT | The proxy is stdio-only and adds no HTTP listener; transport change is Phase 01.7's scope, explicitly out of this phase. |
| `MCPServer` — SSE transport | OPT-OUT | Same as Streamable HTTP — no HTTP surface exists or is added here. |
| `MCPServer` — prompts | OPT-OUT | The proxy exposes no prompts; nothing in the VICE tool surface is prompt-shaped. Adding one would change the surface this phase must hold constant. |
| `MCPServer` — resources | OPT-OUT | The proxy exposes no MCP resources. Same surface-stability reason. |
| `MCPServer` — agents | OPT-OUT | No Mastra agents exist in this repo (RESEARCH.md §B5) and none is created here. |
| `MCPServer` — workflows | OPT-OUT | No Mastra workflows exist in this repo. |
| `MCPServer` — elicitation / sampling | OPT-OUT | Would add a new agent-visible surface during a phase whose central unverified claim is that the agent-visible surface is unchanged. Deliberately not added. |
| `MCPClient` (consume other MCP servers) | OPT-OUT | Conceptually inapplicable: the host side this proxy dials is VICE's own binary monitor protocol, which is not an MCP server (RESEARCH.md §B5). |
| Auth / OAuth helpers | OPT-OUT | Single-operator, single-host trust boundary; RESEARCH.md § Security Domain marks ASVS V2 as not applicable. No auth surface exists to integrate. |

## The 88–94% that is NOT an SDK capability at all

Recorded here so a later reader does not mistake it for un-decided coverage. These are
`vice-proxy`'s own functions; no MCP SDK has any concept of them, so they are outside this
matrix entirely and must keep working **unchanged** across the swap (RESEARCH.md §B4,
01.6-PATTERNS.md § D-01 Seam):

broker leasing (`ensureBrokerLease`, `containerizeGrant`, `releaseLeaseNow`, `onTeardown`),
epoch/liveness (`currentEpoch`, `epochChanged`, `checkEpochAndRebaseline`,
`rebaselineEpochAfterRecycle`), recycle/diagnose (`handleRecycle`, `handleDiagnose`,
`gatherCheckpointTrapEvidence`, `gatherWedgeEvidence`, `captureSnapshotAttempt`), deny-list
enforcement, path rewriting (`rewriteArguments`, `rewritePathsIn`, `pathArgsFor`,
`isInsideWorkspace`), incident capture, and the ten broker-state message builders.

*Matrix produced at plan time, 2026-08-02, per the api-coverage checkpoint.*
