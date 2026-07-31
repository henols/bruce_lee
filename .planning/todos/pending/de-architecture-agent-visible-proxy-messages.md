---
title: Rewrite the agent-visible proxy messages to name an action instead of a three-layer topology
date: 2026-07-31
priority: medium
---

# The word "proxy" reaches the LLM through error strings, not docs

No `SKILL.md` in this repo contains the word "proxy" — the agent-facing documentation is already
clean. The leak is through **runtime strings returned as tool results**.

`vice-proxy.mjs` mentions "proxy" 39 times, and they split into two very different audiences:

| Destination | Lines | Agent sees it? |
|---|---|---|
| `console.error` → stderr | 44, 47, 55, 69, 78, 175, 184, 194, 805, 836 | **No** — invisible to the model |
| Returned as tool-result `content` | 282, 361, 374, 392, 467, 477, 535, 540, 589, 691 | **Yes** |

The second group is agent-visible by deliberate design: the Pattern 2 note at `vice-proxy.mjs:222-227`
establishes that *every* outcome of a tool invocation becomes a JSON-RPC **result** carrying
`content`/`isError`, never a JSON-RPC `error`. So these strings are read by the model on every
failure.

## The problem

They describe a topology the agent has no model of and cannot act on. For example
(`vice-proxy.mjs:361`):

> `vice-proxy: the host VICE MCP server has never been started at this configured path -- no ...`

To act on that, a reader must hold three separate concepts: a proxy, a host MCP server distinct from
the proxy, and a configured path belonging to one of them. From the agent's side there is one tool
that either worked or didn't. The `vice-proxy:` prefix is a component name the caller cannot see,
cannot reach, and cannot fix.

## The change

Every agent-visible message states **the next action**, not the architecture that produced the
failure. Prefix becomes `vice:` — one identity, matching the server name in `.mcp.json` and the
`serverInfo.name` at `vice-proxy.mjs:118`.

Rough shape:

- **Unreachable (361, 374, 392).** Preserve the three-state distinction — never started / dead or
  hung / alive but rejected the call — because it changes what a human does next. Drop the layering
  that explains *why* three states exist. Keep the absolute host path: it is the actionable part,
  and `vice-proxy.mjs:387`'s contract already requires every unreachable-adjacent message to carry
  one.
- **Path refusals (467, 477).** Already good — they name the offending argument position and a
  concrete fix. Prefix only.
- **Chunking (535, 540, 589).** Keep them mechanical; the agent's action is to call the continuation
  tool with the given token. Drop "that vice-proxy split across a continuation sequence" — the agent
  needs the token, not the reason the split exists. Same for the tool description at
  `vice-proxy.mjs:147-149`, which says "Served entirely inside this proxy -- never forwarded to the
  host VICE": true, and irrelevant to a caller.
- **Epoch drift (282, 691).** The action is *void the prior work and redo it*. That instruction
  should lead. "The host VICE MCP server's epoch changed from X to Y" is evidence supporting it, so
  keep it — but after the instruction, not instead of it.

## Deliberately not in scope

The 10 `console.error` lines. Those go to stderr, where a human debugging the proxy is the only
reader, and "vice-proxy:" is exactly the right prefix for them. **Do not sweep the file for the
string** — that would strip useful operator context. Change only the strings that become
`content`.

## Watch out

`vice-proxy.test.mjs` mentions "proxy" 211 times and is 1410 lines. Some of those are assertions on
exact message text. Expect test churn proportional to how many messages change, and treat a test
that pins a full message string as a decision point: re-pin it, or loosen it to assert the
actionable substring (the host path, the token, the argument position) rather than the prose around
it. The latter is likely the better shape — it is what the message is *for*.

## Done when

- No string returned as tool-result `content` contains "proxy".
- The three unreachable states remain distinguishable, and each still carries an absolute host path.
- Epoch-drift messages lead with "treat prior results as void".
- The stderr messages are unchanged.
