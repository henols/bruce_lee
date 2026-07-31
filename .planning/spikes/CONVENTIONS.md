# Spike Conventions

Patterns and stack choices established across spike sessions. New spikes follow these unless the
question requires otherwise.

**Wrapped as of 2026-07-31:** spikes 001–004 are packaged into
`.claude/skills/spike-findings-bruce-lee/`. Their *findings* live there (five reference blueprints, plus
the sources); this file stays the record of *how we spike*. The reusable rig is documented as a recipe in
that skill's `references/measuring-claude-code-behaviour.md` — reach for it before rebuilding a probe.
The conventions below were derived from these same four spikes, so the wrap-up added no new patterns.

## Stack

**Node ESM `.mjs`, stdlib only.** No package.json, no dependencies, no build step in any spike so far.
This matches the repo's existing tooling (`.claude/mcp/vice/*.mjs`), so a spike's code can be lifted
into the real implementation without a language or idiom change — which is the point, since these
spikes measure the same runtime the real proxy runs in.

**Python 3 only for ad-hoc log slicing** at the shell, never as spike source. One-liners piping JSONL
through `python3 -c` are fine for a quick cross-check; anything worth re-running goes in an `.mjs`.

**`--model haiku` for every driven session.** None of these measurements depend on model quality —
they depend on client process handling — so the cheapest model is the correct one. Where a result *did*
depend on model behaviour it turned out to be a liability, not a help (see "Never trust the model's
word" below).

## Structure

```
NNN-spike-name/
  README.md              frontmatter + Research + How to Run + Investigation Trail + Results
  run-experiments.mjs     the driver: one function per experiment, `node run-experiments.mjs [id|all]`
  logs/                  JSONL event log, per-experiment .cli.txt transcripts, rendered timeline HTML
```

**One shared instrument, many drivers.** `001-echo-proxy-lifecycle-harness/echo-proxy.mjs` is the
measuring device for all four spikes; 002–004 drive it through env vars and never fork it. Its
analyzer (`analyze.mjs`) and timeline renderer (`render-timeline.mjs`) are shared the same way,
referenced by relative path. Four divergent copies of a lifecycle probe would have made the logs
incomparable, which is most of their value.

**Experiment ids are letter-prefixed per spike** (`e1…e4b` in 001, `f1…f6` in 002, `g1…g3` in 003,
`h1…h2` in 004) so an id is unambiguous across the whole spike set, and a follow-up probe added later
gets a suffix (`e4b`, `g1b`) that records it as a refinement of a specific earlier experiment rather
than renumbering the sequence.

**Every experiment writes to one JSONL log per spike**, tagged with the experiment id via `ECHO_TAG`.
One log per spike (not per experiment) is what makes "how many distinct pids appeared under this tag"
a one-line query.

## Patterns

**Forensic logging: `appendFileSync`, never a write stream.** Load-bearing, not stylistic. These
spikes measure what completes before a process dies, and a buffered stream loses exactly the last
lines — the ones that are the measurement.

**ISO timestamp *and* a monotonic `ms`.** The ISO field correlates events across processes; every
computed delta uses the monotonic reading, which has sub-millisecond resolution and survives clock
adjustment.

**Never trust the model's word; find a client-side or filesystem fact.** Established the hard way in
003: with a tool absent, haiku emitted literal `<function_calls>` markup as prose, which reads like a
successful call. The criterion became "did `tools/list` arrive at the proxy" — a fact about the client,
independent of anything a model said. Where a model's report *is* the only channel (004's payload
markers), it is asked for a structural fact it cannot fake convincingly (`END_PAYLOAD` present or not)
and cross-checked against the file on disk.

**A control that isolates the variable, or the experiment is void.** 004's first knob test paired
`MAX_MCP_OUTPUT_TOKENS` with a payload that already exceeded the default limit, proving nothing. The
rule: test a knob against an input that is known to *pass* without it.

**Prove the mechanism engaged, don't infer it from a plausible result.** 001's worktree experiment
showed the expected result while a silently-ignored `isolation` flag would have produced an identical
log. The fix was to have the agent report its own cwd *through the instrument*, so the proof and the
measurement land in the same log stream. Ask of any green result: what else produces this exact
output?

**Repeat any timing measurement at least three times.** One sample cannot distinguish a fixed
client-side timer from scheduling noise. 002's window came back 490ms three times out of three, which
is what makes it a constant rather than an observation.

**Read the instrument as suspiciously as the subject.** 002's orphan detector used
`pgrep -f 'echo-proxy.mjs'`, which matched the `bash -lc` wrapper running the search and reported a
phantom orphan every call — briefly looking like a real finding. Two of the four spikes had a
self-inflicted false result; assume the next one does too.

## Tools & Libraries

**In-container `claude` CLI (`/home/vscode/.local/bin/claude`, v2.1.220) is the driver for anything
about Claude Code's own behaviour.** This was not known when the spikes were scoped, and it converts
"ask the human to click things in the IDE" into a scripted measurement.

Flags that matter, and their traps:

| Flag | Why | Trap |
|---|---|---|
| `--strict-mcp-config --mcp-config <file>` | The project's real `.mcp.json` is ignored entirely, so a spike cannot disturb the session's own `vice` proxy | — |
| `--tools <names…>` | Restricts the child session's tool surface — a real boundary, not a request | **Rejects an empty list.** A spike wanting "no tools" must omit the flag (full surface) or name one and forbid its use in the prompt |
| `--agents <json>` | Defines inline subagents with their own tool lists, so a subagent's surface is restricted too | — |
| `-p --input-format stream-json --output-format stream-json --verbose` | Keeps a session alive while stdin is open, so the *driver* chooses the ending (stdin close / SIGTERM / SIGKILL) | Print mode alone can only ever show one ending, and it ends the session after a single turn — which made a startup measurement look like a 3.5s timeout that does not exist |
| `--permission-mode bypassPermissions` | Print-mode sessions cannot answer a permission prompt | Pair it with `--tools`; bypassing permissions with a full tool surface is not acceptable in a spike |

**Environment knobs confirmed to work** (measured, not documented): `MCP_TOOL_TIMEOUT` (cuts a call
short and reports it cleanly to the model), `MAX_MCP_OUTPUT_TOKENS` (governs the inline-response
ceiling). **Confirmed NOT to govern what it looks like it governs:** `MCP_TIMEOUT` did not extend the
startup handshake window.

**Rendered HTML timelines over reading raw JSONL** when the answer is a shape rather than a value —
signal order, spacing, how far a run got before dying. `render-timeline.mjs` inlines the data at render
time because a `file://` page cannot fetch a sibling file.
