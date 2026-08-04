---
created: 2026-08-04T00:00:00.000Z
title: broker-control.mts's oversize-line guard measures the whole accumulated buffer, not the unterminated tail — a burst of valid small lines can destroy a well-formed connection
area: infra
severity: minor
files:
  - .claude/mcp/vice/broker-control.mts:294-299
---

## Why this is filed rather than fixed

A developer decision at 01.6.2's gap-closure planning gate (2026-08-03/04, the four plans that
became `01.6.2-12` through `01.6.2-15`) scoped that gap-closure work to the four verification-report
gaps (CR-01, CR-02, the recycle-ledger correction, WR-01) plus two of the four review warnings
(WR-01, WR-03). This defect is `01.6.2-REVIEW.md`'s **WR-02**, one of the two review warnings that
decision left open deliberately — not an oversight, and not something anyone attempted to fix as
part of that gap closure. This todo is the durable record of that deliberate exclusion, filed
because the phase's own artifacts (`01.6.2-REVIEW.md`, `01.6.2-VERIFICATION.md`) are archived at
milestone completion and a defect recorded only inside one of them is a defect lost at that
boundary.

## File and region

`.claude/mcp/vice/broker-control.mts`, the TCP control-plane connection handler's `"data"` listener,
currently around lines 294–299 (the line numbers will drift as the file changes; search for
`MAX_LINE_BYTES` and the `socket.destroy()` call immediately following it inside `socket.on("data",
...)`).

## Current behaviour, and why it is wrong

```typescript
socket.on("data", (chunk: Buffer) => {
  buffer += chunk.toString("utf8");
  if (Buffer.byteLength(buffer, "utf8") > MAX_LINE_BYTES) {
    socket.destroy();
    return;
  }
  // ... split buffer into complete newline-terminated lines, process each,
  //     then keep only the unterminated remainder in `buffer`
```

The 64KB (`MAX_LINE_BYTES`) ceiling is checked against `buffer` **before** any complete,
newline-terminated lines are split off and processed — i.e. against the whole cumulative payload a
single `"data"` event delivered, not against the bytes still awaiting a newline. The function's own
header comment states the intent as a guard against one line that never terminates ("A connection
exceeding `MAX_LINE_BYTES` without a newline is destroyed rather than buffered further"). As written,
the check fires identically for two very different situations that the comment does not distinguish:

1. one genuinely malformed, unterminated line larger than 64KB (the intended case), and
2. a single TCP `"data"` callback that happens to coalesce many small, complete, individually
   well-formed JSON request lines whose combined size exceeds 64KB (an entirely ordinary case —
   TCP makes no promise about how many application-level messages land in one read callback).

In case 2, every line in the buffer is valid and bounded, but the connection is destroyed anyway,
because the check runs against the raw accumulated `buffer` string rather than against "bytes
buffered awaiting a newline" as the comment describes.

## Consequence, evaluable without the review report

A client (the container-side proxy, or any future direct control-plane consumer) that legitimately
sends a burst of many small requests in quick succession — for example a session issuing several
`acquire`/`status`/`release` calls back to back without waiting for each response, which nothing in
the current protocol forbids — can have its connection destroyed by the broker for no reason
traceable to anything wrong with what it sent. This is reachable by ordinary, non-adversarial
client behaviour, not a crafted attack payload, and its effect (an unexplained connection drop) is
indistinguishable on the client side from a broker crash or a network fault.

## Proposed fix

Check the buffer's size **after** splitting off every complete line (i.e. after the loop that
extracts newline-terminated lines and processes each), so the bound applies to "bytes currently
buffered awaiting a newline" — the unterminated tail — rather than to "total bytes seen in one
`data` callback." Equivalently, track the length of the current unterminated tail as a running
counter updated incrementally, rather than re-measuring the whole `buffer` string on every chunk.

## Untested today, and what a test would assert

`broker-control.test.ts` has no test naming `MAX_LINE_BYTES` (confirmed by `01.6.2-REVIEW.md`'s own
WR-02 finding). A test for this fix would assert: a connection that sends N small, complete,
individually well-formed JSON lines in a single `write()`/`"data"` event, whose combined byte length
exceeds `MAX_LINE_BYTES`, is **not** destroyed and every line is processed normally; a separate
connection that sends a single line without a trailing newline whose byte length exceeds
`MAX_LINE_BYTES` is still destroyed, unchanged from today's behaviour.
