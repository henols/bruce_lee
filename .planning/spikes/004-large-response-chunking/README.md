---
spike: 004
name: large-response-chunking
type: standard
validates: "Given a tool returning a payload over the client's output limit, when a session calls it, then the observed behaviour (hard error / silent truncation / spill to disk) decides whether chunking must live in the proxy for 64K RAM reads"
verdict: VALIDATED
related: [001, 002, 003]
tags: [mcp, output-limits, chunking, memory-read]
---

# Spike 004: Large-Response Handling

## What This Validates

**Given** a tool that returns a payload larger than the client's output limit, **when** a session
calls it, **then** the observed behaviour decides whether chunking must live in the proxy.

This is design finding **12**. It matters because the real proxy's most important forwarded call is a
memory read, and a **full 64K RAM read is routine in this project, not a worst case** — the capture
pipeline is built around it. As hex pairs that is ~192KB of text; base64 is ~87KB. Either way it is
over any plausible limit, so the question is what crossing the limit *does*.

Three possible answers, three different obligations:

| Behaviour | Obligation on the proxy |
|---|---|
| Hard error | Proxy must chunk, but failures are at least loud |
| **Silent truncation** | **Catastrophic** — a truncated RAM dump that looks complete would corrupt a capture and every provenance verdict downstream |
| Spill to disk with a path | Proxy may be able to hand off the path instead of chunking |

## Research

No new external research. The measurement reuses spike 001's `echo-proxy.mjs` via
`ECHO_PAYLOAD_BYTES`, which generates a marked payload: `BEGIN_PAYLOAD bytes=N` … `END_PAYLOAD`. The
markers are the instrument — "did you see `END_PAYLOAD`" separates a complete delivery from a
truncated one, and it is a question the model can answer cheaply even when the content is enormous.

Payload sizes were chosen against the actual operation rather than as round numbers: **24KB** as a
comfortable page-ish read, **100KB** as the ~25K-token threshold the design note names, **192KB** as
the real hex-encoded 64K RAM read, and **512KB** as well past anything the project needs — included to
show the failure mode clearly, not to be supported.

## How to Run

```bash
cd .planning/spikes/004-large-response-chunking
node run-experiments.mjs h1        # payload ladder at default limits
H1_LADDER=40000,60000,80000 node run-experiments.mjs h1   # bracket the threshold
node run-experiments.mjs h2        # is MAX_MCP_OUTPUT_TOKENS the lever?
```

Raw model replies are in `logs/*.cli.txt`; the proxy's own view (payload bytes actually written per
call) is in `logs/004-payloads.jsonl`.

## What to Expect

At 24KB and 40KB the payload arrives whole, `END_PAYLOAD` included, with no notice. At 60KB and above
the model instead reports an error naming an exact character count and a file path under
`~/.claude/projects/<project>/<session>/tool-results/`.

## Observability

The proxy logs `bytes` on every `rpc_out` for a `tools/call`, so what the proxy *sent* is recorded
independently of what the client *delivered*. That separation is what makes "the client spilled it"
distinguishable from "the proxy generated less than asked".

## Investigation Trail

**1. The ladder gave a clean split immediately.** 24KB whole; 100KB, 192KB, 512KB all spilled with an
explicit error. No silent truncation at any size — the dangerous outcome does not occur.

**2. Verified the spill file is complete rather than assuming it.** A spill that quietly dropped the
tail would be nearly as bad as inline truncation, just harder to notice. Read directly off disk:

```
file: .../tool-results/mcp-probe-echo_probe-1785526483920.txt   bytes: 511999
BEGIN_PAYLOAD bytes=512000
MEM $0000 LDA #$00 STA $D020 ; ME ...[snip]... 2 LDA #$00 STA $D
END_PAYLOAD
```

511,999 bytes with `END_PAYLOAD` intact. **The spill is byte-complete.**

**3. Bracketed the threshold, because the design note's number was wrong.** The note says ~25K tokens
(≈100KB). Measured: 40KB delivered whole, 60KB spilled. So the real inline ceiling is between **40KB
and 60KB** — roughly 10–15K tokens, about half the assumed figure. Chunk sizing has to be built on the
measured number, not the documented one.

**4. The first `h2` was a worthless test and was replaced.** It paired `MAX_MCP_OUTPUT_TOKENS=2000`
with a 100KB payload — which already exceeded the *default* limit, so the resulting spill proved
nothing about the knob. Re-run against 24KB, a size that had already been shown to pass at defaults:
it spilled. **The knob genuinely governs the threshold.** Kept in the driver's comments as a note on
why the control matters.

**5. The model retried the call unprompted.** Each spilled experiment left 2–3 spill files, because
after being told the result went to a file the model called the tool again trying to get the content
inline. Worth knowing: an oversized response does not just fail once, it invites a retry loop, and each
retry is a *real forwarded emulator call*. For a memory read that is harmless; for a call with side
effects it would not be.

## Results

**Verdict: VALIDATED.** Chunking must live in the proxy, and the failure mode is safe.

| Payload | Delivered inline? | `END_PAYLOAD` seen | Notice |
|---|---|---|---|
| 24,000 B | ✓ whole | ✓ | none |
| 40,000 B | ✓ whole | ✓ | none |
| 60,000 B | ✗ spilled | — | `result (59,999 characters across 3 lines) exceeds maximum allowed tokens. Output has been saved to …` |
| 80,000 B | ✗ spilled | — | same shape |
| 100,000 B | ✗ spilled | — | same shape |
| 192,000 B | ✗ spilled | — | same shape |
| 512,000 B | ✗ spilled | — | same shape, file verified byte-complete |
| 24,000 B + `MAX_MCP_OUTPUT_TOKENS=2000` | ✗ spilled | — | knob confirmed working |

### The findings, restated

1. **No silent truncation, at any size tested.** The worst outcome is ruled out. Crossing the limit
   produces an explicit `Error:` naming the exact character count and a file path.
2. **The inline ceiling is ~40–60KB, not ~100KB.** The design note's ~25K-token figure is roughly
   double the measured value. **A chunk size of 32KB leaves comfortable headroom; 64KB would not.**
3. **Spilled content is byte-complete on disk.** Nothing is lost — but the file lands in the *client's*
   project directory, keyed by session and tool-call id, not somewhere the proxy chose or knows about.
4. **Chunking belongs in the proxy, as the design says.** Not because spill loses data, but because
   the spill path is unusable as a transport: the proxy cannot predict the path, the agent then has to
   read a 192KB file it will also struggle to consume, and the model retries the call meanwhile. A
   proxy that returns 32KB chunks with an explicit continuation token keeps the whole 64K read inside
   the working conversation.
5. **`MAX_MCP_OUTPUT_TOKENS` works and is worth setting deliberately.** It is the lever that makes the
   threshold a known constant instead of a client-version-dependent surprise — useful precisely because
   chunk sizing depends on it.

### Limits of this evidence

- All measurements are headless `claude -p`. The threshold is a client-side constant and could differ
  by client version or in the extension. **This is the finding most worth re-checking** at
  implementation time, since chunk sizing depends on the number — hence recommending
  `MAX_MCP_OUTPUT_TOKENS` be set explicitly rather than inferred.
- Sizes were bracketed to 40–60KB, not bisected to a single value. A tighter number was not pursued
  because the actionable output is a safe chunk size, and 32KB is safe across the whole bracket.
- Payload content is repetitive 6502-ish ASCII. If the client's accounting is token-based rather than
  character-based, a payload with different entropy could shift the byte threshold. The error message
  quotes *characters*, which suggests a character count, but this was not tested with high-entropy
  input.
