# Phase 01.1 — API Coverage Declaration

This phase authors a surface, so this file carries a real matrix rather than a reasoned no-rows
declaration (which is what [phase 01](../01-recovery-provenance/COVERAGE.md) correctly used — that
phase only *consumed* the host's tool surface as an instrument).

**The surface enumerated here:** `.claude/skills/vice-mcp-selector/scripts/vice-proxy.mjs` is a
stdio MCP server registered in `.mcp.json` as the `vice` entry. It re-exposes the host emulator's
VICE MCP surface to the Claude Code client as `mcp__vice__*` tools. The client's tool list is
therefore authored *here*, by this proxy — not by the host — which is precisely the "project exposes
or wraps a surface others call" direction that a coverage matrix exists to track.

**Source of truth:** `.claude/skills/vice-mcp-selector/scripts/tools-manifest.json` — 63 entries,
`generated_at: 2026-07-31T15:56:00.302Z`, refreshed against the live host in commit `447847a`,
endpoint `http://host.docker.internal:6510/mcp`. The rows below were generated from that file, not
transcribed by hand.

## Matrix

65 capabilities: the 63 committed manifest entries, plus one proxy-synthetic addition, plus the one
host capability this project refuses to expose.

| capability | decision | reason |
|---|---|---|
| initialize | INTEGRATE | MCP lifecycle method the host additionally exposes as a callable tool; forwarded unchanged. |
| notifications_initialized | INTEGRATE | MCP lifecycle method the host additionally exposes as a callable tool; forwarded unchanged. |
| tools_list | INTEGRATE | MCP lifecycle method the host additionally exposes as a callable tool; forwarded unchanged. |
| tools_call | INTEGRATE | MCP lifecycle method the host additionally exposes as a callable tool; forwarded unchanged. |
| vice_ping | INTEGRATE |  |
| vice_execution_run | INTEGRATE |  |
| vice_execution_pause | INTEGRATE |  |
| vice_execution_step | INTEGRATE |  |
| vice_registers_get | INTEGRATE |  |
| vice_registers_set | INTEGRATE |  |
| vice_memory_read | INTEGRATE |  |
| vice_memory_write | INTEGRATE |  |
| vice_memory_banks | INTEGRATE |  |
| vice_memory_search | INTEGRATE |  |
| vice_checkpoint_add | INTEGRATE |  |
| vice_checkpoint_delete | INTEGRATE |  |
| vice_checkpoint_list | INTEGRATE |  |
| vice_checkpoint_toggle | INTEGRATE |  |
| vice_checkpoint_set_condition | INTEGRATE |  |
| vice_checkpoint_set_ignore_count | INTEGRATE |  |
| vice_sprite_get | INTEGRATE |  |
| vice_sprite_set | INTEGRATE |  |
| vice_vicii_get_state | INTEGRATE |  |
| vice_vicii_set_state | INTEGRATE |  |
| vice_sid_get_state | INTEGRATE |  |
| vice_sid_set_state | INTEGRATE |  |
| vice_cia_get_state | INTEGRATE |  |
| vice_cia_set_state | INTEGRATE |  |
| vice_disk_attach | INTEGRATE | Absolute container path in `path` is rewritten to its host form at the proxy seam before forwarding. |
| vice_disk_detach | INTEGRATE |  |
| vice_disk_read_sector | INTEGRATE |  |
| vice_autostart | INTEGRATE | Absolute container path in `path` is rewritten to its host form at the proxy seam before forwarding. |
| vice_machine_reset | INTEGRATE |  |
| vice_display_screenshot | INTEGRATE | Absolute container path in `path` is rewritten to its host form at the proxy seam before forwarding. |
| vice_display_get_dimensions | INTEGRATE |  |
| vice_keyboard_type | INTEGRATE |  |
| vice_keyboard_petscii | INTEGRATE |  |
| vice_keyboard_key_press | INTEGRATE |  |
| vice_keyboard_key_release | INTEGRATE |  |
| vice_keyboard_restore | INTEGRATE |  |
| vice_joystick_set | INTEGRATE |  |
| vice_joystick_tap | INTEGRATE |  |
| vice_disassemble | INTEGRATE |  |
| vice_symbols_load | INTEGRATE | Absolute container path in `path` is rewritten to its host form at the proxy seam before forwarding. |
| vice_symbols_lookup | INTEGRATE |  |
| vice_watch_add | INTEGRATE |  |
| vice_backtrace | INTEGRATE |  |
| vice_run_until | INTEGRATE | `cycles` is accepted but unimplemented host-side; `address` is the only reliable stop condition. |
| vice_keyboard_matrix | INTEGRATE |  |
| vice_keyboard_chord | INTEGRATE |  |
| vice_snapshot_save | INTEGRATE | Takes `name`, not a path -- the file lands in the host emulator's own directory, so nothing to translate. |
| vice_snapshot_load | INTEGRATE | Takes `name`, not a path -- resolved on the host side. |
| vice_snapshot_list | INTEGRATE |  |
| vice_cycles_stopwatch | INTEGRATE |  |
| vice_memory_fill | INTEGRATE |  |
| vice_memory_compare | INTEGRATE |  |
| vice_checkpoint_group_create | INTEGRATE |  |
| vice_checkpoint_group_add | INTEGRATE |  |
| vice_checkpoint_group_toggle | INTEGRATE |  |
| vice_checkpoint_group_list | INTEGRATE |  |
| vice_machine_config_get | INTEGRATE |  |
| vice_machine_config_set | INTEGRATE |  |
| vice_sprite_inspect | INTEGRATE |  |
| vice_result_continue | INTEGRATE | Proxy-synthetic, no host counterpart: served inside vice-proxy.mjs and never forwarded. Recovers an oversized result in full. |
| vice_disk_list | OPT-OUT | Crashes the host MCP server; recovery needs a manual VICE restart. Deny-listed in vice.mjs before serialisation, filtered from tools/list, refused at tools/call. |

**Counts:** 64 INTEGRATE, 1 OPT-OUT. A client `tools/list` therefore sees **64** `mcp__vice__*`
tools — the figure recorded in `01.1-CRITERION-3-EVIDENCE.md`, which also confirms
`mcp__vice__disk_list` absent from a real client's discovery layer.

## How the one OPT-OUT is enforced

`vice_disk_list` is refused at three independent layers, so no single edit re-exposes it:

1. **Stripped from the manifest** — `refresh-manifest.mjs` filters it when snapshotting the host
   surface, so it is not in `tools-manifest.json` at all.
2. **Filtered from `tools/list`** — `vice-proxy.mjs:211` re-applies `DENY_LIST` to whatever the
   manifest contains, as defence-in-depth against a manifest refresh that forgets to strip it.
3. **Refused at `tools/call`** — `vice-proxy.mjs:629` checks `DENY_LIST` before any network attempt,
   and `vice.mjs:477` checks it again as the first statement of `call()` before request
   serialisation.

`DENY_LIST` itself is one line — `vice.mjs:106` — so the prohibition has a single definition that
all three layers read. The guard-removal-sensitive regression test
`"vice_disk_list is refused at tools/call with no request made"` asserts both `isError: true` **and**
`requests.length === 0` against a stand-in host, so deleting the guard fails the test rather than
silently passing.

## Cross-cutting transforms applied to every INTEGRATE row

These are properties of the seam, not of individual capabilities, which is why they appear here
rather than repeated down the reason column:

- **Path translation** (criterion 9) — the structural rule is applied to *any* string argument
  beginning with `/`, at any nesting depth up to 10: normalise via `resolve()`, check the workspace
  boundary on the normalised form, then rewrite to the host form via `hostPath()`. A path resolving
  outside the mounted workspace is refused before forwarding. Four capabilities are known to carry a
  `path` argument today (`vice_disk_attach`, `vice_symbols_load`, `vice_display_screenshot`,
  `vice_autostart`), but the rule is structural, so a capability added later is covered without a
  code change. **Stated residual:** a *relative* path string is left byte-identical, because it is
  indistinguishable from a non-path argument without guessing.
- **Epoch re-check** — `checkEpochAndRebaseline()` runs both before and after every forwarded call.
  A host restart mid-session is reported loudly with both epoch values and never cached.
- **Output ceiling** — every advertised capability carries
  `_meta["anthropic/maxResultSizeChars"] = OUTPUT_CHAR_CAP` (500000 by default, overridable via
  `VICE_MAX_RESULT_CHARS`), read from the same single constant that the chunking logic enforces. An
  oversized result is split into a `vice_result_continue` sequence, never truncated.

## Known host-side constraints carried in the matrix

Recorded as reasons on their rows rather than as separate findings, so a caller reading the matrix
sees them at the point of use:

- `vice_snapshot_save` / `vice_snapshot_load` take `name`, not a path — snapshots resolve inside the
  host emulator's own directory, so there is nothing for the path seam to translate.
- `vice_run_until` accepts a `cycles` argument that is unimplemented host-side; `address` is the only
  reliable stop condition.
- `initialize`, `notifications_initialized`, `tools_list`, `tools_call` appear as *callable tools*
  because the host exposes them that way. They are forwarded unchanged. The proxy answers the real
  JSON-RPC `initialize` and `tools/list` methods locally with zero I/O (criterion 4) — a separate
  path from these four tool entries.

There is no bulk checkpoint-clear capability on the host surface. That is an absence, not a row —
callers delete checkpoints individually via `vice_checkpoint_delete`, or group them with
`vice_checkpoint_group_*`.
