---
name: vice-mcp-selector
description: Drive the host's VICE emulator from this container through real mcp__vice__* tools — memory read/write/search, checkpoints, disassembly, register access, sprite inspection, screenshots, scripted joystick/keyboard input, snapshots. Use for any emulator, VICE, x64sc, C64-debugging, memory-inspection, checkpoint or snapshot task, and whenever a vice_* tool is needed.
---

# Driving VICE through `mcp__vice__*` tools

The emulator is reached by calling `mcp__vice__*` tools directly — this is
the only route. There is no CLI to invoke, no JSON to hand-assemble, and no
"select" step: enumerate and call the tools exactly like any other MCP tool
surface available in this session.

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
