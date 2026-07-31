---
name: spike-findings-bruce-lee
description: Implementation blueprint from spike experiments — measured facts about Claude Code's stdio-MCP lifecycle (process identity, the two shutdown ladders and the ~490ms grace window, startup/tool-call/idle budgets, the 40–60KB inline response ceiling) for building the per-session VICE MCP proxy and on-demand host broker. Use when implementing or planning Phase 01.2, the vice-mcp-selector proxy, lease acquisition or release, chunked memory reads, or any work that depends on when a Claude Code MCP server spawns, dies, times out, or truncates.
---

<context>
## Project: bruce_lee

The spike set measured Claude Code's stdio-MCP lifecycle so that Phase 01.2 — the on-demand host
broker and per-session leasing described in `.planning/notes/vice-mcp-selector-design.md` — can be
built on verified facts instead of four load-bearing MEDIUM-confidence assumptions. The design rests
on twelve researched findings; eight were HIGH from docs, four were MEDIUM and unverified. If any of
the four were wrong, 01.2 would change *shape* rather than need a patch — most acutely the shutdown
grace window, which decides whether automatic lease release on session end is achievable at all or
whether release becomes sweeper-only.

The instrument was a throwaway echo proxy: a stdio MCP server that talks to nothing, exposes one
trivial tool, and appends a timestamped, pid-tagged JSONL line on every lifecycle event, registered
through a scratch `--mcp-config` under `--strict-mcp-config` so the real `vice` proxy was never
touched.

**Outcome: the design survives. Two of its stated findings were wrong and are corrected; three new
findings were added.** Release on session end is achievable with ~3000× headroom, but only if release
is wired to two different handler families — the correction with the most direct effect on the
implementation.

Spike session wrapped: 2026-07-31 (spikes 001–004, all VALIDATED).
</context>

<requirements>
## Requirements

Non-negotiable design decisions that emerged during spiking. Every reference file honours these.

- **Release must be wired to BOTH signal handlers and stdin `end`/`close`.** A graceful ending
  delivers SIGINT and never closes stdin; abrupt client death closes stdin and never signals. Each
  path fires only one of the two, so either handler alone misses an entire class of session ending.
- **Nothing but one synchronous filesystem operation goes in the shutdown handler.** The graceful
  window is ~490ms (measured 3/3). `unlinkSync` uses ~0.1ms of it; a host round trip would not
  reliably fit.
- **SIGINT must be treated as a teardown trigger, not ignored as a user Ctrl-C.** It is the *first*
  signal every graceful teardown delivers.
- **The teardown trigger the proxy keys on must be whatever was actually observed, not the documented
  ladder.** The very first probe showed SIGINT arriving first with stdin never closing — a release
  handler wired only to stdin `end`/`close` would never have fired.
- **The lease records `CLAUDE_CODE_SESSION_ID` as diagnostic metadata, not as the lease key.** One
  subprocess per session means process identity already is session identity.
- **A forwarded memory read is chunked at 32KB by the proxy.** The measured inline ceiling is 40–60KB,
  about half the design note's assumed ~100KB; a 64K RAM read is ~192KB as hex. Oversized results are
  never silently truncated, but the client's spill-to-disk path is unusable as transport.
- **`MAX_MCP_OUTPUT_TOKENS` and `MCP_TOOL_TIMEOUT` are set explicitly, not inherited.** Both were
  measured to genuinely govern their thresholds, which turns two client-version-dependent surprises
  into known constants. **`MCP_TIMEOUT` was measured *not* to govern the startup handshake — do not
  rely on it.**
- **Measurement is headless-CLI-based; the extension gap is documented, not closed.** Every finding
  records whether it was observed in `claude -p` print mode only, and therefore whether it could
  differ under the VS Code extension. (User choice, 2026-07-31.)
- **The real `.mcp.json` is never modified by a spike or probe.** All registration goes through a
  scratch config plus `--strict-mcp-config`.
- **Every finding carries the command used and the raw log excerpt.** A finding without its log
  excerpt is not a finding.
- **Findings that contradict the design note are written back into the note in the same change.** A
  stale design note is worse than no design note.
</requirements>

<findings_index>
## Feature Areas

| Area | Reference | Key Finding |
|------|-----------|-------------|
| Proxy lifecycle & process identity | `references/proxy-lifecycle-and-process-identity.md` | One subprocess per session, spawned **eagerly** with zero tool calls, shared by all subagents including worktree-isolated ones — so the pid is the lease key and acquisition must be deferred to the first forwarded call |
| Shutdown & lease release | `references/shutdown-and-lease-release.md` | **Two** ladders firing **different** handlers: graceful = SIGINT → +100ms SIGTERM → SIGKILL at ~490ms with stdin never closed; abrupt client death = stdin EOF, no signal, **unbounded** time, clean exit. `unlinkSync` release costs ~0.1ms — safe by 3 orders of magnitude |
| Timeout & latency budgets | `references/timeout-and-latency-budgets.md` | There is **no** startup deadline (a slow handshake costs turns, not the session), the tool-call budget is **≥150s** so the cold `x64sc` path fits, and **nothing reaps an idle proxy** (40.1 min, zero signals) |
| Large-response chunking | `references/large-response-chunking.md` | Inline ceiling is **40–60KB, not ~100KB** — chunk at 32KB. No silent truncation at any size; spills are byte-complete but land at a path the proxy cannot predict, so the spill path is unusable as transport |
| Measuring Claude Code itself | `references/measuring-claude-code-behaviour.md` | The reusable rig for re-checking any constant above, plus the five ways it produced a wrong answer that looked right — two of four spikes had a self-inflicted false result |

## Corrections to the design note

Both are already written back into `.planning/notes/vice-mcp-selector-design.md`; they are listed here
because anything built from the *pre-spike* version of the design will be wrong:

- **Finding 8 (shutdown) was wrong in three ways.** The predicted ladder (`stdin EOF → SIGTERM →
  SIGKILL`, grace "on the order of a second") is not what happens. And its claim that *"the SIGKILL
  path gets nothing… it leaks an orphaned `x64sc`"* is **inverted** — abrupt death is the *best* case,
  with unbounded time and a clean exit. The TTL sweeper is still mandatory, but for different reasons
  (proxy SIGKILLed ~500ms into every graceful teardown, container/host death, a wedged event loop).
- **Finding 12 (output ceiling) was about 2× too generous.** ~25K tokens / ~100KB assumed; 40–60KB
  measured.

New findings added: **13** (the client exports `CLAUDE_CODE_SESSION_ID` and `CLAUDE_PID` into every
MCP server's environment), **14** (no startup deadline), **15** (≥150s call budget), **16** (nothing
reaps an idle proxy).

## Source Files

Original spike source is preserved in `sources/` — four drivers plus the shared instrument.
`sources/001-echo-proxy-lifecycle-harness/echo-proxy.mjs` is the measuring device for all four spikes;
002–004 drive it through env vars and never fork it. Raw JSONL logs, per-experiment CLI transcripts and
rendered HTML timelines stay in `.planning/spikes/NNN-*/logs/`.
</findings_index>

<metadata>
## Processed Spikes

- 001-echo-proxy-lifecycle-harness (VALIDATED)
- 002-shutdown-grace-window (VALIDATED)
- 003-timeout-budgets (VALIDATED)
- 004-large-response-chunking (VALIDATED)
</metadata>
