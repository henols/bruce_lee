---
created: 2026-08-07T21:10:00.000Z
title: joystick direction schema forbids the diagonal its own description promises -- blocked plan 01-04 for seven attempts
area: tooling
severity: major
files:
  - .claude/mcp/vice/
---

## Problem

Both `mcp__vice__vice_joystick_tap` and `mcp__vice__vice_joystick_set` describe their `direction`
parameter as:

> `Direction: up, down, left, right, center, or array for diagonals`

but both declare it in JSON Schema as `type: "string"`. The schema is what the transport enforces,
so **the array form the description promises can never be sent**, and no other diagonal spelling is
accepted either. Five forms are now ruled out across three sessions, all failing identically with
`Invalid direction`:

| form | tried in | result |
|---|---|---|
| `["up","right"]` as a JSON-encoded string | attempt 5 | `Invalid direction` |
| `["up","right"]` as a genuine array | attempt 6 | rejected before reaching the emulator (schema) |
| `"up-right"` | attempt 6 | `Invalid direction` |
| `"upright"` | attempt 6 | `Invalid direction` |
| `"up,right"` | attempt 8 | `Invalid direction` |
| `"9"` (numeric bitmask for up\|right) | attempt 8 | `Invalid direction` |

The numeric form was worth trying because the tool's own success response proves the underlying
representation **is** a bitmask — `up`→`value:1`, `down`→`value:2`, `right`→`value:8`, `center`→`value:0`,
which is the canonical C64 joystick bit order. The transport can clearly *hold* a combined bitmask
(`fire` composes with any direction via a separate boolean), so the limitation is specifically in
how `direction` is parsed, not in what the emulator can represent.

## Why it matters more than a cosmetic doc bug

This is the single most expensive tooling defect the project has hit. Plan 01-04 has halted **seven
times** on one chamber-1 hazard at sprite `x=296-304`. Six independent play-throughs established
the death is tied to a precise horizontal position, and the fix every one of those sessions
converged on is a **jump over a gap** — corroborated independently by the Apple II manual's own
hazard vocabulary ("electrical charges in the gaps between ledges") against a counter the game's HUD
literally labels `FALLS`.

That fix has **never once been attempted**, because a diagonal has never reached the emulator. Seven
attempts spent live budget and Bruce's lives on an input the transport silently could not express.

## What is NOT the cause (checked 2026-08-07, so nobody re-checks it)

An inverted up/down axis in the tool was the most attractive single explanation, because attempt 5
recorded that `up` taps produced "a **duck/crouch** animation" — which is what *down* should do.
**Ruled out:** `up` sets bit 0 and `down` sets bit 1, exactly as a real C64 joystick does. Verified
from the tools' own `value` responses with the machine paused. The crouch has another cause.

## Solution

1. Make `direction` accept the diagonal its description already promises. Either widen the schema to
   `oneOf: [string, array]` and parse the array, or add the four diagonal spellings as accepted
   strings, or accept a numeric bitmask. Any one of them closes this.
2. Whichever is chosen, **make the description and the schema agree** — the present contradiction is
   what cost seven attempts, because the description reads as permission and the schema silently
   refuses.
3. Add a test that sends a diagonal and asserts the applied bitmask is the OR of both axes
   (`up`+`right` → 9). A test that only exercises single axes is what let this ship.

## Verification

Probe it with the machine **paused** — a rejected call never reaches the emulator and an accepted one
does not take effect until execution resumes, so the whole accepted-encoding space costs nothing and
risks no game state. See the 2026-08-07 entry in `.planning/RE-FINDINGS.md` for the technique.
