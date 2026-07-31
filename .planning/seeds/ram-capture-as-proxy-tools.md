---
title: Promote the RAM capture and compare helpers from an importable JS module to real mcp__vice__* tools
trigger_condition: The next time a capture or a two-run comparison is needed from a fresh session, or when a third consumer of ram-capture.mjs appears alongside tools/recover.mjs and tools/chip-state.mjs
planted_date: 2026-07-31
---

# The capture skill asks the agent to write a program; a tool would just take the call

Raised during the `/gsd-explore` that produced [[vice-selector-skill-doc-is-vestigial]], and **not
explored** in that conversation — the session went deep on the selector skill's doc surface and this
was parked rather than answered. What follows is the framing, not a decision.

## The observation

`.claude/skills/c64-ram-capture/SKILL.md` is 114 lines documenting the API of a JS module:
`capture`, `attachAndStart`, `findEntry`, `voidRun`, `captureBaseline`, `captureDecayReference`,
`classifyRuns`, `VOLATILE_RANGES` — all imported from
`.claude/skills/c64-ram-capture/scripts/ram-capture.mjs`.

To capture RAM at a trigger address, the agent must author a Node script, get an import path right,
call the function, and handle the result. Compare that to what the same operation costs once VICE
access is tool-mediated: one `mcp__vice__*` call with two arguments.

This is the same shape as the selector finding, one level up. There, prose documented hazards that
code could enforce. Here, prose documents an API that could be a tool call. **In both cases the doc
exists because the capability isn't reachable the way the agent naturally works.**

## Why it plausibly belongs in the proxy

The proxy already does more than forward. It owns a synthetic tool served entirely locally —
`RESULT_CONTINUE_TOOL` / `vice_result_continue` at `vice-proxy.mjs:141-160`, which appears in
`tools/list` "exactly like a real tool so an agent can discover it". So the pattern for
**proxy-local tools that never reach the host** is established and working. `capture` and
`classifyRuns` would be further instances of it.

`capture` also composes several host calls behind one operation (checkpoint, run, read 64K in
chunks, release keys at the trigger, record chip state). That is precisely the kind of sequencing an
agent gets wrong when it has to assemble it, and gets right when it is one call. The 64K read is
also already the motivating example for the output-size ceiling at `vice-proxy.mjs:511` — so the
chunking machinery a capture tool would need is present.

## What has to be answered before doing it

- **Where does the image go?** A 64K buffer cannot be a tool result. It has to be written to a path
  and the tool returns the path plus the sha256. That means a capture tool *writes files*, which no
  current `mcp__vice__*` tool does — a genuine expansion of the proxy's remit and the main reason
  this is a seed and not a todo.
- **Does the two-library-consumer seam survive?** `tools/README.md:443` documents a deliberate
  "programmatic seam: two library consumers that are not the proxy". `tools/chip-state.mjs:32-34`
  and `tools/recover.mjs` import these modules directly. Tools and library exports can coexist —
  the tool becomes a thin wrapper — but the layering was a documented decision and reversing it by
  accident would be the wrong way to find out.
- **Does `classifyRuns` even want to be a tool?** It is pure computation over two buffers, touching
  no emulator. A tool on an *emulator* server is an odd home for it. `capture` and `attachAndStart`
  are the ones with a real argument; the comparison functions may belong in a script either way.
- **What happens to the 114 lines?** If capture becomes a tool with a good description, most of
  `c64-ram-capture/SKILL.md` goes the same way as the selector's — which is the point.

## The counter-argument to weigh honestly

The capture procedure encodes real judgment: releasing held keys *at* the trigger rather than
before, the volatile-range exclusions, single-bit decay treated as expected while multi-bit
differences fail the verdict. That reasoning is why the module has 114 lines of documentation, and a
tool description is a smaller surface to carry it. Some of it is genuinely explanatory rather than
operational, and it should end up **somewhere** — possibly a note, possibly the module's own
comments — not deleted in the name of the same cleanup that was right for the selector.

## Related

- [[vice-selector-skill-doc-is-vestigial]] — the same diagnosis one layer down
- [[reusable-capture-harness-seam]] — existing thinking on the capture layer's boundaries
- [[phase3-harness-reuses-capture-layer]] — a downstream consumer whose needs should inform the shape
- [[move-drift-classification-into-ram-compare]] — an open decision about where the drift logic
  lives; that question should be settled before deciding what a tool would expose
