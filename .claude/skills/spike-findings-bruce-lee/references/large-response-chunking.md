# Large-Response Handling and Chunking

What happens when a forwarded result exceeds the client's output limit. This decides the transport for
the proxy's most important call — a memory read — because **a full 64K RAM read is routine in this
project, not a worst case**: the capture pipeline is built around it.

## Requirements

- **A forwarded memory read is chunked at 32KB by the proxy.** The measured inline ceiling is
  40–60KB, about half the design note's assumed ~100KB, and a 64K RAM read is ~192KB as hex.
- **`MAX_MCP_OUTPUT_TOKENS` is set explicitly, not inherited.** It was measured to genuinely govern
  the threshold, which is what makes chunk sizing a known constant instead of a client-version-
  dependent surprise.

## How to Build It

### Chunk at 32KB, in the proxy, with an explicit continuation token

```
64K RAM read as hex pairs  ≈ 192 KB of text
64K RAM read as base64     ≈  87 KB
measured inline ceiling      40–60 KB
```

Either encoding is over the ceiling, so the proxy chunks. **32KB leaves comfortable headroom across
the whole 40–60KB bracket; 64KB would not.** Return each chunk with:

- the chunk payload,
- an explicit continuation token (offset or opaque cursor),
- the total size, so the caller knows how many chunks to expect and can detect a short read.

This keeps the whole 64K read inside the working conversation, which is the actual goal.

### Set the threshold rather than discovering it

```
MAX_MCP_OUTPUT_TOKENS=<n>   # governs the inline ceiling — confirmed working
```

Verified by a control: 24KB passes at defaults, and 24KB paired with
`MAX_MCP_OUTPUT_TOKENS=2000` **spills**. The knob genuinely moves the threshold.

### The failure mode is safe, so chunking is about usability not data loss

Crossing the ceiling produces an explicit error naming the exact character count and a file path:

```
Error: result (59,999 characters across 3 lines) exceeds maximum allowed tokens.
Output has been saved to ~/.claude/projects/<project>/<session>/tool-results/<tool>-<id>.txt
```

And the spilled file is **byte-complete** — verified off disk rather than assumed, because a spill that
quietly dropped the tail would be nearly as bad as inline truncation and much harder to notice:

```
file: .../tool-results/mcp-probe-echo_probe-1785526483920.txt   bytes: 511999
BEGIN_PAYLOAD bytes=512000
MEM $0000 LDA #$00 STA $D020 ; ME ...[snip]... 2 LDA #$00 STA $D
END_PAYLOAD
```

## What to Avoid

- **Using the spill path as transport.** It is unusable for that, for three compounding reasons: the
  proxy **cannot predict the path** (it is keyed by the client's session and tool-call id, in the
  client's project directory); the agent then has to read a 192KB file it will also struggle to
  consume; and the model retries the call meanwhile.
- **A 64KB chunk size.** Inside the 40–60KB failure bracket. 32KB or smaller.
- **Trusting the design note's ~25K-token / ~100KB figure.** Measured at roughly half that. Chunk
  sizing must be built on 40–60KB.
- **Oversized responses from any call with side effects.** Each spilled experiment left **2–3 spill
  files**, because after being told the result went to a file, the model called the tool **again**,
  unprompted, trying to get the content inline. For a memory read that is harmless; for a call that
  writes memory, resets the machine, or steps execution it would not be. Any forwarded call with side
  effects must return a small result, always.
- **Testing an output-limit knob against an input that already fails without it.** The first `h2`
  paired `MAX_MCP_OUTPUT_TOKENS=2000` with a 100KB payload — already over the *default* limit — so the
  resulting spill proved nothing. Always test a knob against an input known to **pass** without it.

## Constraints

| Payload | Delivered inline? | `END_PAYLOAD` seen | Notice |
|---|---|---|---|
| 24,000 B | ✓ whole | ✓ | none |
| 40,000 B | ✓ whole | ✓ | none |
| 60,000 B | ✗ spilled | — | explicit `Error:` + file path |
| 80,000 B | ✗ spilled | — | same shape |
| 100,000 B | ✗ spilled | — | same shape |
| 192,000 B (real 64K hex read) | ✗ spilled | — | same shape |
| 512,000 B | ✗ spilled | — | same shape, file verified byte-complete |
| 24,000 B + `MAX_MCP_OUTPUT_TOKENS=2000` | ✗ spilled | — | knob confirmed working |

- **No silent truncation at any size tested.** The catastrophic outcome — a truncated RAM dump that
  looks complete, corrupting a capture and every provenance verdict downstream — does not occur.
- **Inline ceiling: between 40KB and 60KB** (~10–15K tokens).
- Spilled content is byte-complete on disk, but at a path the proxy cannot know.

Evidence limits: all headless `claude -p`. The threshold is a client-side constant and could differ by
client version or in the extension — **this is the finding most worth re-checking at implementation
time**, since chunk sizing depends on the number, which is exactly why setting
`MAX_MCP_OUTPUT_TOKENS` explicitly is a requirement rather than a suggestion. Sizes were bracketed to
40–60KB, not bisected to a single value, because the actionable output is a safe chunk size and 32KB is
safe across the whole bracket. Payload content was repetitive 6502-ish ASCII; if the client's
accounting is token-based rather than character-based, higher-entropy content could shift the byte
threshold. The error message quotes *characters*, which suggests a character count, but this was not
tested with high-entropy input.

## Origin

Synthesized from spike: 004.
Source files: `sources/004-large-response-chunking/run-experiments.mjs` (`h1`, `h2`); the instrument's
payload generator is `bigPayload()` in `sources/001-echo-proxy-lifecycle-harness/echo-proxy.mjs`,
driven by `ECHO_PAYLOAD_BYTES`. The `BEGIN_PAYLOAD`/`END_PAYLOAD` markers are the instrument — "did
you see `END_PAYLOAD`" separates complete delivery from truncation and is cheap for a model to answer
even when the content is enormous.
Raw model replies and the proxy's own byte-count view:
`.planning/spikes/004-large-response-chunking/logs/`.
Design note: `.planning/notes/vice-mcp-selector-design.md` finding 12 (corrected).
