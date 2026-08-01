---
name: vice-mcp-selector
description: Drive the host's VICE emulator from this container through real mcp__vice__* tools — memory read/write/search, checkpoints, disassembly, register access, sprite inspection, screenshots, scripted joystick/keyboard input, snapshots. Use for any emulator, VICE, x64sc, C64-debugging, memory-inspection, checkpoint or snapshot task, and whenever a vice_* tool is needed.
---

# Driving VICE through `mcp__vice__*` tools

The emulator is reached by calling `mcp__vice__*` tools directly — this is
the only route. There is no CLI to invoke, no JSON to hand-assemble, and no
"select" step: enumerate and call the tools exactly like any other MCP tool
surface available in this session.

## Per-session, boot-fresh emulator access

Each session gets its own boot-fresh emulator: it is
granted on that session's first forwarded tool call and released when the
session ends, so a second session never shares the first session's machine.
The first call of a session may wait a few seconds for a cold launch, and may
report warming-and-retry; retrying the same call is the correct action in
that case.

Within one session, the same emulator instance is reused across every
call in that session. A procedure that needs a known-clean machine still
resets explicitly rather than assuming a fresh boot happened for that
call — only the *session's first* grant is guaranteed boot-fresh.

A tool call reporting the broker itself is absent or unreachable names
which of three states applies and the host command to run.

Namespace snapshot names by something session-scoped, never by port —
ports are recycled across sessions under on-demand launch, so a
port-prefixed snapshot name can collide with an unrelated later session.

## Polling while the machine runs

State-reading calls stop the machine, so write a wait loop as read →
`mcp__vice__execution_run` → wait — never read → wait → read. Use
`mcp__vice__ping` for the waiting step, since it reports state without
stopping the machine. A loop written this way runs the machine at full
speed; one that doesn't drops to a small fraction of that.

## Paths

Pass absolute container paths to `mcp__vice__*` tools — the translation to
host form happens automatically, before the call reaches the host. An
absolute path outside this workspace is refused, with the reason and the
argument's position named in the refusal. A relative path is forwarded as
written and will not resolve on the host — it looks identical to a
non-path argument (a tool name, a hex address) from where the translation
happens, so it is never rewritten.

## Known hazards enforced in code, not by memory

- `vice_disk_list` crashes the shared host MCP server. It is refused before
  any request reaches the host, and it never appears in a tool listing
  either — there is nothing to remember here, both layers are structural.
- A tool result that reports the host emulator as unreachable means exactly
  that: the host-side emulator process needs to be started, or restarted, on
  the host. This is the only route to the emulator — do not fall back to a
  raw HTTP call, a shell script, or any other workaround to route around it.

## Reading a disk

To inspect a disk's contents, parse the `.d64` bytes directly, or call the
disk-sector tool for the emulated drive's own view — never the forbidden
disk-listing tool above.

## Troubleshooting

**`mcp__vice__*` tools are missing from this session's tool list.** Two
independent causes — check both:

- The committed tool-manifest snapshot has never been refreshed against a
  live host. A fresh clone ships with an empty snapshot on purpose, so a
  session started before the refresh sees the server connected with zero
  tools. See `tools/README.md`'s tool-discovery section for the refresh
  step — it needs a live host and only needs running again after a
  host-side tool-set change.
- The `vice` project-scope MCP server was never approved for this
  workspace. Check `/mcp` in a fresh session and approve it if prompted, or
  check `~/.claude/settings.json`'s `enableAllProjectMcpServers` /
  `enabledMcpjsonServers` if the workspace should already be trusted —
  committed project settings are ignored until the workspace is trusted.

**A tool call returns one of three "unreachable" messages instead of a
result.** Each already carries its own diagnosis (never started on this
host / dead or hung / alive but rejected the call) and an absolute host
path to the fix, written to be actionable standalone — read the message
itself rather than guessing.

**A tool call reports the host emulator's identity changed mid-session (a
restart report).** Treat every result captured before that point as void
and redo the affected work from scratch. A restart report is never cached
and is never resolved by retrying the same call — the underlying machine
really did change.

**Inspecting a disk's contents.** Parse the `.d64` bytes directly (see
"Reading a disk" above) — never the deny-listed disk-listing tool, whatever
the symptom that sent you looking for a workaround.
