# `saeger.d64` — Directory & BAM Evidence

Parsed directly from the disk-image bytes with `tools/d64-parse.mjs`
(`node tools/d64-parse.mjs directory --image disks/saeger.d64 --json` /
`bam --image disks/saeger.d64 --json`) — never `vice_disk_list`, which is
permanently off-limits (T-01-03). Machine-readable form: `DIRECTORY.json`.

## BAM (track 18, sector 0)

| Field | Value |
|---|---|
| First directory sector | 18/1 |
| DOS version byte | `$41` ("A") |
| Disk name | `XIDEX` |
| Disk ID | `"1a"` |
| DOS type | `"2A"` |
| Occupied track ranges | **1–9**, plus **18** (the directory track's own 2-sector DOS overhead) |

Disk name **agrees** with PROJECT.md's Context table ("disk name `XIDEX`").

## Directory (chain from track 18, sector 1)

One entry, in slot 0 of the only directory sector; `chain_error` is `null`
(clean, one-sector directory).

| Type | Name | First T/S | Blocks | Suspicious? |
|---|---|---|---|---|
| PRG (closed) | `BRUCE LEE` | 1/0 | 186 | **No** |

## The entry is genuinely well-formed — not a "0-block, bogus-pointer" fake

Same finding as `danish.d64` (see that release's `DIRECTORY.md` for the full
reasoning against PROJECT.md's "0-block … bogus track/sector" prose claim),
reproduced here independently:

1. **Block count is 186, not 0**, and `tools/d64-parse.mjs`'s suspicious-entry
   detector — proven to fire against a synthetic defect in
   `tools/d64-parse.test.mjs` — does not fire on this entry.
2. **The entry's own sector chain is walkable and lands exactly on 186.**
   Starting at 1/0, following each sector's own next-T/S pointer (here a
   simple sequential interleave-1 pattern within each track, unlike danish's
   interleave-10) terminates cleanly after **exactly 186 sectors**, having
   visited tracks 1 through 9 in order — precisely the BAM's own occupied
   range (8 full tracks × 21 + track 9's 18 used = 186).
3. **The pointed-to sector is the documented BASIC stub, byte-for-byte.**
   Track 1 sector 0's payload begins with load address `$0801` followed by
   the tokenized line `<SYS-token> 2161  SSG` — exactly the `SYS 2161` boot
   stub and `SSG` signature PROJECT.md's own boot-stub table already
   documents for this disk, at exactly the track/sector its own table cites
   (`t1/s0`).

## Occupied-range comparison against PROJECT.md — a real, unresolved disagreement

| Source | Claim |
|---|---|
| PROJECT.md's Context table | "tracks 1–11, 216 sectors" |
| This parse (BAM) | tracks **1–9**, **186 sectors** (game data) + track 18's 2-sector DOS overhead |

Unlike `danish.d64`'s counting-basis nuance, this is a genuine numeric
disagreement, not just an inclusion/exclusion question: the BAM directly
reports tracks 10 and 11 as **entirely free** (`free = 21` = the full sector
count for that zone, on both tracks), so there is no BAM-visible occupancy on
those tracks to reconcile PROJECT.md's "1–11" range against. Recorded here as
a disagreement rather than silently reconciled, per this plan's own
instruction — the likelier explanation is an imprecise or approximate earlier
note (PROJECT.md's own table elsewhere is independently corroborated by this
same parse: disk name `XIDEX`, boot stub `SYS 2161` at `t1/s0`), but this
specific occupied-range figure does not hold up against the BAM bytes as
parsed.
