---
quick_id: 260804-brt
description: Wire dump-artifacts and d64-parse into the c64-ram-capture skill
date: 2026-08-04
status: planned
execution_note: |
  Executed inline rather than via gsd-planner + gsd-executor subagents. The
  session's operating directives prohibit spawning subagents unless the user
  asks for it, and the verification evidence this edit rests on was already
  gathered in the calling context — a subagent would have had to re-derive
  every command output below. All GSD guarantees are preserved: this PLAN.md,
  an atomic commit, a SUMMARY.md, and a STATE.md row.
---

# Wire `dump-artifacts` and `d64-parse` into `c64-ram-capture`

## Problem

`.claude/skills/c64-ram-capture/SKILL.md` describes, in prose, work that two
committed and tested modules already do:

- **Steps 4–6 of "Capture at a trigger address"** tell the agent to concatenate
  4096-byte reads into one image, confirm it is exactly 65536 bytes, record its
  SHA-256, and record `$0001` + video standard + registers alongside. That is
  exactly `tools/dump-artifacts.mjs`'s `assemble` / `chip-state` / `manifest` /
  `write-set`. The skill never mentions the tool exists, so the agent does by
  hand — and by eye — what a guarded function does correctly.
- **"Boot a disk"** attaches and autostarts with no way to inspect what is on
  the disk first. `.claude/CLAUDE.md` already mandates `tools/d64-parse.mjs`
  for reading a directory; no skill says so.

Neither module contacts the emulator, so citing them breaks no hard rule —
both are pure Node over data the agent already fetched or over disk bytes.

## Verification already performed (in the calling context)

| Claim | How established |
|---|---|
| `assemble` reproduces a committed digest | Chunks derived from `recovery/danish/dumps/danish-gameentry-run1.bin` in 16×4096-byte records → `65536 bytes, sha256 e1b8428c55bc7606b7e77846e8928bff23e9cf0c8241da479aadc1bc092faa26`, byte-identical to the `sha256` field in that dump's committed `.capture.json`. |
| Dropped-chunk guard fires | Removing one chunk → `assembleImage: gap before address $3000 -- next chunk starts at $4000`. |
| Short-read guard fires | Truncating the last chunk by 2 bytes → `assembleImage: assembled 65534 bytes ending at $FFFE, expected exactly 65536`. |
| `d64-parse directory` output | `node tools/d64-parse.mjs directory --image disks/danish.d64` → `PRG "BRUCE LEE   (DC)" first=17/0 blocks=178`. |
| `d64-parse bam` output | Same image → disk name, id, DOS type `2A`, `first dir sector: 18/1`, `occupied track ranges: 9-18`. |
| `manifest` on a fresh capture | Emits `classification_state: "ranges-only"` with `kind: "unclassified"` ranges, versus `"bucketed"` in the committed `.map.json` — the pre/post-diff distinction. |

## Tasks

### Task 1 — Add a disk-inspection step to "Boot a disk"

- **files**: `.claude/skills/c64-ram-capture/SKILL.md`
- **action**: Add a step 0 before the attach, invoking
  `node tools/d64-parse.mjs directory --image <path.d64>` with its real output,
  and a one-line note that `bam` gives the occupied track ranges. State that
  this is pure byte parsing and works whether or not VICE is up.
- **verify**: The shown command runs and its output matches the file.
- **done**: "Boot a disk" names `tools/d64-parse.mjs`.

### Task 2 — Replace hand-assembly prose with `dump-artifacts`

- **files**: `.claude/skills/c64-ram-capture/SKILL.md`
- **action**: Rewrite steps 4–6 so the agent still performs every
  `mcp__vice__*` read itself (the one permitted route), serialises the results
  as `chunks.json` / `raw.json`, and then calls `write-set` to produce the
  four artifacts. Show `assemble` as the digest-only check. Keep the ordering
  constraint (read state before resuming, resume once) intact.
- **verify**: Every command shown has been run; the digest shown is the one
  reproduced above.
- **done**: Steps 4–6 call `tools/dump-artifacts.mjs` instead of describing its
  behaviour.

### Task 3 — Record the guards and the boundary

- **files**: `.claude/skills/c64-ram-capture/SKILL.md`
- **action**: Add a `Symptom | Fix` troubleshooting table carrying the two real
  guard messages, and one line stating that these modules never contact the
  emulator so the agent's own `mcp__vice__*` calls remain the only route.
- **verify**: Both messages are quoted verbatim from a real run.
- **done**: The skill states what each guard means and how the claims were
  established.

## must_haves

- **truths**: the skill cites `tools/dump-artifacts.mjs` and
  `tools/d64-parse.mjs`; every shown command has been run; the `mcp__vice__*`
  single-route rule is preserved and restated.
- **artifacts**: modified `.claude/skills/c64-ram-capture/SKILL.md`.
- **key_links**: `tools/dump-artifacts.mjs`, `tools/d64-parse.mjs`,
  `recovery/danish/dumps/danish-gameentry-run1.capture.json`.

## Out of scope

- The new provenance-diff skill for `tools/diff-images.mjs` (follow-up).
- Updating the stale
  `.planning/todos/pending/2026-08-01-investigate-whether-the-surviving-tooling-is-reusable-as-skills.md`
  (follow-up).
- Any change to `tools/` itself.
