# `danish.d64` — Directory & BAM Evidence

Parsed directly from the disk-image bytes with `tools/d64-parse.mjs`
(`node tools/d64-parse.mjs directory --image disks/danish.d64 --json` /
`bam --image disks/danish.d64 --json`) — never `vice_disk_list`, which is
permanently off-limits (T-01-03). Machine-readable form: `DIRECTORY.json`.

## BAM (track 18, sector 0)

| Field | Value |
|---|---|
| First directory sector | 18/1 |
| DOS version byte | `$41` ("A") |
| Disk name | *(blank — all 16 bytes are the `$A0` pad byte, no name was ever written)* |
| Disk ID | `"00"` (literal ASCII `00`, not a real 2-character ID — looks like the field was never set to anything but its own placeholder) |
| DOS type | `"2A"` |
| Occupied track range | **9–18** |

## Directory (chain from track 18, sector 1)

One entry, in slot 0 of the only directory sector; the chain's own next-sector
pointer is `18/`$FF`` (track 0 conventionally marks end-of-chain — the parser's
`chain_error` is `null`, so this is a clean, one-sector directory).

| Type | Name | First T/S | Blocks | Suspicious? |
|---|---|---|---|---|
| PRG (closed) | `BRUCE LEE   (DC)` | 17/0 | 178 | **No** |

## The entry is genuinely well-formed — not a "0-block, bogus-pointer" fake

PROJECT.md's Context section states: *"Both have faked directories — 0-block
BRUCE LEE PRG entries pointing at bogus track/sector."* Direct byte-level
parsing of this disk does not reproduce that claim, and the disagreement is
recorded here rather than silently reconciled, per this plan's own instruction.

Three independent pieces of evidence, all from the raw bytes:

1. **The block count is 178, not 0.** `tools/d64-parse.mjs`'s suspicious-entry
   detector (block count 0, first T/S outside the image, or first T/S into a
   track the BAM reports as entirely free) does not fire on this entry, and
   the detector is proven to fire correctly against a synthetic fixture with a
   genuine defect (`tools/d64-parse.test.mjs`) — it is not silent because it
   is broken.
2. **The entry's own sector chain is walkable and lands exactly on 178.**
   Starting at 17/0 and following each sector's own next-T/S pointer (a
   standard CBM DOS interleave-10 pattern within each track, then moving to
   the next lower track once a track is exhausted) terminates cleanly after
   **exactly 178 sectors**, at 9/10, having visited tracks 17 down to 9 in
   order — precisely the union of "used" sectors the BAM independently
   reports for tracks 9–17 (10 from track 9's partial use + 168 from tracks
   10–17 fully used = 178). Two independent structures (the directory entry's
   block count, and the BAM's per-track free counts) agree.
3. **The pointed-to sector is the documented BASIC stub, byte-for-byte.**
   Track 17 sector 0's payload begins with load address `$0801` (the standard
   BASIC program start) followed by the tokenized line `<SYS-token> 2073
   TCS-CRUNCH!` — exactly the `SYS 2073` boot stub and `TCS-CRUNCH!` signature
   PROJECT.md's own boot-stub table already documents for this disk, at
   exactly the track/sector its own table cites (`t17/s0`). The directory
   entry names the real thing.

**The likelier explanation, per this plan's own guidance ("a duller
explanation… is more likely than a new discovery"): PROJECT.md's prose line
is imprecise or inherited from generic cracked-disk lore that does not hold
for this specific pair of images**, while PROJECT.md's own boot-stub table
(SYS 2073 at t17/s0) was independently correct all along and is exactly
corroborated here. This does not change anything about the boot procedure
already recorded in `RELEASES.json` (booting still goes through `autostart` /
the custom loader, never through this directory entry) — it only corrects a
factual claim about the directory's shape.

## Occupied-range comparison against PROJECT.md

| Source | Claim |
|---|---|
| PROJECT.md's Context table | "tracks 9–17, 180 sectors" |
| This parse (BAM, excluding the directory track's own 2-sector DOS overhead) | tracks 9–17, **178 sectors** (10 from track 9 + 168 from tracks 10–17) |
| This parse (BAM, including track 18's directory + BAM sectors) | tracks 9–18, 180 sectors |

**These are consistent, not contradictory**, once the counting basis is made
explicit: PROJECT.md's "180 sectors" matches this parse's count **only** when
track 18's 2 DOS-overhead sectors (BAM sector 0 + directory sector 1) are
included in the total, even though PROJECT.md's own track range ("9–17")
excludes track 18. The BRUCE LEE entry's own block count (178) already
excludes those 2 sectors, since a directory entry never counts the directory
track itself as part of the file. Recorded as a minor counting-basis
ambiguity in the earlier note, not a discrepancy in the underlying facts.
