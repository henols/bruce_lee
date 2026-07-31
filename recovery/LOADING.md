# On-demand load detection — danish.d64

**RECOVER-04.** The claim this document makes: with the mechanical detector
described below armed and a bounded, checkpoint-synchronised play-through
driven against it, **zero** on-demand load events were observed. This is a
stated, evidenced zero, not a bare "none found" — the armed set, the
coverage actually reached, and the coverage this run did **not** reach are
all recorded below, per D-10/D-11/D-12 and success criterion 2.

**Release:** `danish` (canonical-candidate release for this plan; `saeger`
is not armed or played here).

## Hit count

```
0
```

This matches `node tools/watch-loads.mjs report --release danish --json`,
which returns `[]` — verified byte-identical across two consecutive runs
(`cmp` exit 0). The persisted hit log is
`recovery/danish/dumps/danish-loading-hits.json`, an empty `hits: []` array.

## Correction made before arming (defect in the committed Task 1 registry data)

Before arming, `recovery/RELEASES.json`'s `danish.loader_ranges` was found to
contain a wrong entry: `$08F5-$08F7`, described as "cracktro animation phase
observed executing immediately post-gate." Live disassembly shows this is
**not** loader/cracktro code at all — it is the game's own permanent
joystick-poll instruction inside the title dispatcher's steady-state loop:

```
$08F5: LDA $DC01
$08F8: AND #$10
$08FA: BNE $08B1
```

Left armed, this range would log a false "loader re-entry" hit on every
ordinary title-screen idle loop iteration (measured in a prior attempt at
113 hits with nothing else happening), destroying the "did the loader
re-enter?" signal the loader-reentry checkpoints exist to provide. The entry
was removed from `danish.loader_ranges` and `danish.watch_set` was
regenerated via `recordWatchSet()` (175 sentinels, down from 176), committed
as its own change (`cfc9d83`) before any live arming. The remaining three
danish loader ranges (`$0340-$035E`, `$0900-$0901`, `$0D64-$0D82`) are
unaffected.

`saeger`'s wider `$08E0-$0900` loader-range window also contains this same
address range and is very likely subject to the identical misclassification,
but `saeger` is out of scope for this play-through (this plan arms the
canonical-candidate release only) and was not touched or re-verified here.
Flagging it so a future pass over `saeger`'s watch set does not repeat the
mistake.

## The armed set (175 sentinels)

Three kinds, per D-10 — resolved from `recovery/RELEASES.json`'s
`danish.watch_set`, never hardcoded in the detector:

- **3 loader re-entry exec checkpoints**, spanning the already-defeated
  loader/cracktro code observed during boot. Per D-10 these must never fire
  again after the dump point; a hit here is itself the finding.
- **1 `$DD00` (CIA2 port A) watch, type `both`** — the primary sentinel per
  D-10, since this release's loader bypasses the KERNAL entirely and there
  is no `$FFD5`-style vector activity to watch instead. Also trips on an
  ordinary VIC bank change, so a hit here is attributed and reasoned about,
  never counted blindly.
- **171 never-populated-range write watches**, one per range
  `danish-gameentry-run1.map.json` classified `unused` at dump time. A write
  into one of these during play is the signature of content arriving later
  — but, per the orchestrator's finding below, is also exactly what ordinary
  gameplay code does the moment it starts using RAM the title screen never
  touched, so a hit here needs attribution before it means anything.

Full sentinel-for-sentinel table, generated from `recovery/RELEASES.json`'s
`danish.watch_set` (matches the registry entry for entry):

| Name | Type | Start | End | Reason |
|---|---|---|---|---|
| loader-reentry-1-0340 | exec | $0340 | $035E | cassette-buffer loader-stub region observed executing during boot -- a classic loader-stub location (danish/NOTES.md §1 'How $08B1 was located') |
| loader-reentry-2-0900 | exec | $0900 | $0901 | cracktro 'hit any key' poll loop -- also the registered boot gate address (danish/NOTES.md §1, §5; recovery/RELEASES.json boot.gates) |
| loader-reentry-3-0D64 | exec | $0D64 | $0D82 | cracktro animation phase observed executing during the sign-off sequence (danish/NOTES.md §1 'How $08B1 was located') |
| dd00-vic-bank-and-serial-bus | both | $DD00 | $DD00 | CIA2 port A: the VIC bank-select bits AND the bit-banged serial-bus CLK/DATA/ATN lines a KERNAL-bypassing raw-sector loader toggles directly -- the primary on-demand-load sentinel per D-10, since this project's loaders have no $FFD5-style KERNAL vector activity to watch instead. Also trips on an ordinary VIC bank change, which is why every hit is attributed and reasoned about, never counted blindly. |
| unused-0016-0027 | write | $0016 | $0027 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-004B-005F | write | $004B | $005F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-0067-0094 | write | $0067 | $0094 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-00A5-00B5 | write | $00A5 | $00B5 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-00B7-00D0 | write | $00B7 | $00D0 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-00D2-00EB | write | $00D2 | $00EB | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-03A1-03FF | write | $03A1 | $03FF | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-4326-4338 | write | $4326 | $4338 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-4C99-4CB1 | write | $4C99 | $4CB1 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-4EED-4F47 | write | $4EED | $4F47 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-4F52-4FE7 | write | $4F52 | $4FE7 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-5CC7-5CD7 | write | $5CC7 | $5CD7 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-5CDD-5CF9 | write | $5CDD | $5CF9 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-5D0D-5D1C | write | $5D0D | $5D1C | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-5D23-5D3E | write | $5D23 | $5D3E | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-5D45-5D7C | write | $5D45 | $5D7C | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-62EB-6301 | write | $62EB | $6301 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-633F-6356 | write | $633F | $6356 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-643F-645B | write | $643F | $645B | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-647E-6499 | write | $647E | $6499 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-8180-83CB | write | $8180 | $83CB | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-83D6-8403 | write | $83D6 | $8403 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-8D90-8DE9 | write | $8D90 | $8DE9 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-8E04-8E33 | write | $8E04 | $8E33 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-8E53-8E89 | write | $8E53 | $8E89 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-8E9D-8FE7 | write | $8E9D | $8FE7 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9035-905F | write | $9035 | $905F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9095-90E4 | write | $9095 | $90E4 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-90E7-9125 | write | $90E7 | $9125 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9155-917F | write | $9155 | $917F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-91B5-91DF | write | $91B5 | $91DF | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9215-923F | write | $9215 | $923F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9271-92A1 | write | $9271 | $92A1 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-92B5-92C6 | write | $92B5 | $92C6 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-92D4-9301 | write | $92D4 | $9301 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9311-9327 | write | $9311 | $9327 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9335-9362 | write | $9335 | $9362 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-938F-93C6 | write | $938F | $93C6 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-93F5-9421 | write | $93F5 | $9421 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9453-9481 | write | $9453 | $9481 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-948C-94A0 | write | $948C | $94A0 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-94B1-94DF | write | $94B1 | $94DF | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9513-953F | write | $9513 | $953F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-956F-95A1 | write | $956F | $95A1 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-95D4-95FF | write | $95D4 | $95FF | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9635-965F | write | $9635 | $965F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-966E-9680 | write | $966E | $9680 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9695-96C0 | write | $9695 | $96C0 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-96F5-9720 | write | $96F5 | $9720 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-974E-9781 | write | $974E | $9781 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-97B4-97DF | write | $97B4 | $97DF | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-97F3-9808 | write | $97F3 | $9808 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9815-9846 | write | $9815 | $9846 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9855-9869 | write | $9855 | $9869 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-986E-98A8 | write | $986E | $98A8 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-98D3-9909 | write | $98D3 | $9909 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9915-9927 | write | $9915 | $9927 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9933-996D | write | $9933 | $996D | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9973-998E | write | $9973 | $998E | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9992-99CE | write | $9992 | $99CE | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-99D5-99EE | write | $99D5 | $99EE | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-99F2-9A1F | write | $99F2 | $9A1F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9A55-9A81 | write | $9A55 | $9A81 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9AB5-9AE7 | write | $9AB5 | $9AE7 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9AF6-9B09 | write | $9AF6 | $9B09 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9B16-9B3F | write | $9B16 | $9B3F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9B75-9B9F | write | $9B75 | $9B9F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9BD5-9C00 | write | $9BD5 | $9C00 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9C34-9C5F | write | $9C34 | $9C5F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9C95-9CC0 | write | $9C95 | $9CC0 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9CF5-9D20 | write | $9CF5 | $9D20 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9D54-9D7F | write | $9D54 | $9D7F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9DB0-9DDF | write | $9DB0 | $9DDF | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9E15-9E40 | write | $9E15 | $9E40 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9E75-9EAC | write | $9E75 | $9EAC | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9EAF-9EC9 | write | $9EAF | $9EC9 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9ED4-9EFF | write | $9ED4 | $9EFF | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9F35-9F5F | write | $9F35 | $9F5F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-9F92-9FC0 | write | $9F92 | $9FC0 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-A000-A037 | write | $A000 | $A037 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-A2C0-A2D7 | write | $A2C0 | $A2D7 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-A388-A39F | write | $A388 | $A39F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-A400-A447 | write | $A400 | $A447 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-A4F0-A4FF | write | $A4F0 | $A4FF | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-AAB8-AACF | write | $AAB8 | $AACF | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-AB68-AB77 | write | $AB68 | $AB77 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-ABF6-AC07 | write | $ABF6 | $AC07 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-AE68-AE77 | write | $AE68 | $AE77 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-AF2E-AF3F | write | $AF2E | $AF3F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-B010-B01F | write | $B010 | $B01F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-B050-B065 | write | $B050 | $B065 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-B2C8-B2D7 | write | $B2C8 | $B2D7 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-B348-B35B | write | $B348 | $B35B | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-B410-B41F | write | $B410 | $B41F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-B430-B43F | write | $B430 | $B43F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-B810-B81F | write | $B810 | $B81F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-B850-B865 | write | $B850 | $B865 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-B968-B97D | write | $B968 | $B97D | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-BAC8-BAD7 | write | $BAC8 | $BAD7 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-BB48-BB5B | write | $BB48 | $BB5B | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-BC10-BC1F | write | $BC10 | $BC1F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-BC30-BC3F | write | $BC30 | $BC3F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-BC4E-BC61 | write | $BC4E | $BC61 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-BF48-BF57 | write | $BF48 | $BF57 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C035-C05F | write | $C035 | $C05F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C095-C0C0 | write | $C095 | $C0C0 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C0F5-C120 | write | $C0F5 | $C120 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C155-C17F | write | $C155 | $C17F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C1B5-C1DF | write | $C1B5 | $C1DF | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C214-C23F | write | $C214 | $C23F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C275-C29F | write | $C275 | $C29F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C2D5-C2FF | write | $C2D5 | $C2FF | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C335-C363 | write | $C335 | $C363 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C38D-C3C1 | write | $C38D | $C3C1 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C3E1-C3F0 | write | $C3E1 | $C3F0 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C3F5-C430 | write | $C3F5 | $C430 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C435-C44C | write | $C435 | $C44C | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C456-C482 | write | $C456 | $C482 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C4B5-C4E1 | write | $C4B5 | $C4E1 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C515-C540 | write | $C515 | $C540 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C572-C5A3 | write | $C572 | $C5A3 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C5D5-C5FF | write | $C5D5 | $C5FF | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C632-C661 | write | $C632 | $C661 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C695-C6BF | write | $C695 | $C6BF | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C6F2-C723 | write | $C6F2 | $C723 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C755-C781 | write | $C755 | $C781 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C7B5-C7E1 | write | $C7B5 | $C7E1 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C815-C841 | write | $C815 | $C841 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C875-C89F | write | $C875 | $C89F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C8D5-C900 | write | $C8D5 | $C900 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C935-C96C | write | $C935 | $C96C | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C96E-C986 | write | $C96E | $C986 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C992-C9CF | write | $C992 | $C9CF | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C9D5-C9E6 | write | $C9D5 | $C9E6 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-C9F5-CA4F | write | $C9F5 | $CA4F | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-CA55-CA8A | write | $CA55 | $CA8A | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-CA95-CAAA | write | $CA95 | $CAAA | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-CAB1-CAE1 | write | $CAB1 | $CAE1 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-CB15-CB4E | write | $CB15 | $CB4E | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-CB50-CBFE | write | $CB50 | $CBFE | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-CC09-CD72 | write | $CC09 | $CD72 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-CD74-CE4A | write | $CD74 | $CE4A | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-CE4C-CE6D | write | $CE4C | $CE6D | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-CE6F-CEA9 | write | $CE6F | $CEA9 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-CEAB-CEBB | write | $CEAB | $CEBB | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-CEBD-CEEE | write | $CEBD | $CEEE | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-CF2B-CF3E | write | $CF2B | $CF3E | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-CFEB-CFFE | write | $CFEB | $CFFE | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-F201-F218 | write | $F201 | $F218 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-F21A-F2A3 | write | $F21A | $F2A3 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-F2A5-F31C | write | $F2A5 | $F31C | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-F323-F493 | write | $F323 | $F493 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-F495-F640 | write | $F495 | $F640 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-F652-F6A8 | write | $F652 | $F6A8 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-F6AA-F742 | write | $F6AA | $F742 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-F744-F8BF | write | $F744 | $F8BF | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-F8C1-F8E9 | write | $F8C1 | $F8E9 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-F8EB-F951 | write | $F8EB | $F951 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-F953-F96D | write | $F953 | $F96D | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-F96F-F9AD | write | $F96F | $F9AD | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-F9AF-F9C8 | write | $F9AF | $F9C8 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-F9CA-FAAF | write | $F9CA | $FAAF | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-FAB1-FAD7 | write | $FAB1 | $FAD7 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-FAD9-FB3B | write | $FAD9 | $FB3B | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-FB3D-FB98 | write | $FB3D | $FB98 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-FB9A-FBAB | write | $FB9A | $FBAB | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-FBAD-FBD8 | write | $FBAD | $FBD8 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-FBDA-FD22 | write | $FBDA | $FD22 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-FD50-FDE9 | write | $FD50 | $FDE9 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-FDEB-FF9A | write | $FDEB | $FF9A | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |
| unused-FF9C-FFF9 | write | $FF9C | $FFF9 | never-populated at dump time -- danish-gameentry-run1.map.json classified this range "unused" |

**On the unused-range sentinels' expected behaviour** (orchestrator finding,
recorded here per the plan's attribution requirement): these 171 watches are
armed against RAM the `run1` dump's `.map.json` found empty **at the title
screen**. The moment real gameplay starts, ordinary room-drawing code will
write into some of that RAM (a `STA ($04),Y` / `STA ($08),Y` character-plot
loop populating chamber graphics is the traced example from a prior attempt
at `$8E9D-$8FE7`) — that is expected, structural, and **not** evidence of an
on-demand load by itself. Every hit from this class needs its cause traced
before it can be called a load event. None fired during this run (see next
section), so this caveat is precautionary, not something this run needed to
adjudicate.

## Coverage reached

1. **Cracktro passed, title screen reached** (the dump-point-equivalent
   state, `$08B1`). Procedure: `tools/recover.mjs`'s `boot()` reused
   verbatim — `vice_disk_attach` + `vice_autostart` + `vice_execution_run`,
   then the `$0900` "hit any key" gate cleared via
   `vice_keyboard_matrix({key:"SPACE"})` held from the gate and released at
   the `$08B1` checkpoint (a program event, per the established technique —
   `danish/NOTES.md` §5). Reached `$08B1` after 47 loop iterations
   (`hit_count: 47`), landed at `$1458` after releasing SPACE.
   Screenshot: **`recovery/danish/dumps/danish-loading-01-title-armed.png`**
   — the Datasoft title screen (`DATASOFT PRESENTS / BRUCE LEE(TM) / BY RON
   J FORTIER`), with `1 PLAYER` and `COMPUTER` already the highlighted
   defaults, F3/F5/F7 options visible. Detector armed (all 175 sentinels
   live) immediately after this screenshot, before any further input.

2. **F7 pressed to begin the game.** `vice_keyboard_matrix({key:"F7",
   hold_frames:10})` (a deterministic frame-count press/release, not a
   wall-clock hold) was delivered while paused at the title dispatcher
   loop. Across two `vice_execution_run` + non-pausing-`vice_ping` poll
   rounds the PC moved from the known title-dispatcher/input-scanner
   cluster (`$08B1-$08FF`, `$1388-$1480`) to `$1556` — live disassembly at
   that address shows a VIC raster-IRQ acknowledgement / raster-split setup
   routine (`STA $0409` / `STA $D01A` / `STA $D019` / raster compare setup),
   real game code, not garbage. **However, a screenshot taken at that point
   was byte-identical (matching MD5) to the title-screen screenshot above**
   — the displayed screen had not visibly changed. This is recorded as
   inconclusive, not as a chamber transition: `$1556` most plausibly belongs
   to a periodic raster-split IRQ handler that also runs during the title
   screen's own display (sprite multiplexing / border effects), not a
   one-shot "game has started" landing point. The duplicate screenshot was
   **discarded, not committed** (see the self-check below) — it would not
   have evidenced a real milestone and keeping it would have been exactly
   the "same image, two claimed milestones" failure this plan is designed
   to catch.

### Screenshot distinctness self-check

```
md5sum recovery/danish/dumps/danish-loading-*.png
c32310cf75b09aa5122171bd3604736e  recovery/danish/dumps/danish-loading-01-title-armed.png
```

**1 committed `danish-loading-*` screenshot, 1 distinct MD5.** No duplicate
is claimed as separate coverage. (A second probe screenshot was captured
during the F7 investigation above, found byte-identical to the committed
one, and deleted before commit rather than kept as false evidence.)

## Coverage NOT reached — and why

Everything beyond the title screen: a real walked chamber transition, both
opponents, a death, a game over, a restart. **None of these were reached in
this run.** Reason: a **host-side VICE emulator hang**, discovered during
the F7-press investigation, blocked all further live interaction —

- After the F7-press probe above, direct measurement (`vice_cycles_stopwatch`
  reset/read bracketing a `vice_execution_run` + real elapsed wall time
  via multiple non-pausing `vice_ping` polls) showed **zero cycles elapsing**
  on the instance we were using (port 6510), even though `vice_ping`
  continued to report `"running"` and register reads kept returning the
  exact same frozen PC/register set. A `vice_machine_reset({mode:"hard"})`
  did **not** recover it — a genuine hang, not a transient race.
- The other two pool instances were checked as a substitution candidate:
  **all three** (6510, 6511, 6512) showed the identical zero-cycles-elapsed
  symptom when probed directly (via `VICE_MCP_URL` overrides bypassing the
  session file), ruling out "just this one instance" as the explanation.
  Port 6511 was independently already known to be unhealthy (the
  orchestrator's own pre-flight note); this run's own measurement now
  extends that finding to all three pool members.
- This matches the project's own previously-documented hazard pattern
  (`.planning/STATE.md`'s "HOST INSTABILITY" / "HARD BLOCKER" entries):
  `vice_execution_run` around the checkpoint/watch surface is the
  historically crash-prone call, and recovery is a **host-side** VICE
  restart, which this container cannot perform.
- No further joystick-driven play, chamber walking, opponent encounters,
  death, game-over or restart could be attempted once this was confirmed.
  Per the plan's own hard constraint (T-01-16), chamber transitions must be
  **walked**, never reached by poking the chamber index as a workaround —
  so this run does not manufacture a chamber-transition claim by any other
  means either.

**This is recorded as an honest partial result, not a completed bounded
play-through.** The zero hit count above is real and evidenced for the
coverage this run *did* reach (title screen, armed, one F7 probe with an
inconclusive PC-cluster exit and no visible screen change) — it is **not**
a claim that on-demand loading was ruled out across chamber transitions,
opponents, death, game over or restart, because those states were never
reached this run.

## Hand-off note

The same watch set (`danish.watch_set` in `recovery/RELEASES.json`) is
re-armed verbatim by Phase 2's plan 02-02 during its mandatory exhaustive
all-chambers trace (D-11). Because this run's coverage stopped at the title
screen, **02-02's trace is not a breadth top-up on top of an already-covered
depth here — it is the run that will actually reach every state this
document lists as not reached.** A hit there reopens this document,
exactly as D-11 anticipates; given how little of the game this run actually
exercised, 02-02 reaching the chamber-transition, opponent, death and
game-over states for the first time is the expected/likely case, not an
edge case.

## The input sequence that worked (plain notes, not a `verify/scripts/` artifact — VERIFY-01 owns that format)

1. `node tools/recover.mjs`'s `boot()` (reused verbatim): disk attach +
   autostart + `vice_execution_run`; `$0900` gate cleared with
   `vice_keyboard_matrix({key:"SPACE", pressed:true})` held, released at the
   `$08B1` checkpoint via `vice_keyboard_matrix({key:"SPACE", pressed:false})`.
2. Arm: `armWatchSet("danish", {liveArm:true})` (this plan's `tools/watch-loads.mjs`).
3. `vice_keyboard_matrix({key:"F7", hold_frames:10})` — a deterministic,
   frame-counted press+auto-release, issued once, while paused at the title
   dispatcher.
4. `vice_execution_run` + two non-pausing `vice_ping` polls, then
   `vice_registers_get` + `vice_checkpoint_list` (checking `hit_count`);
   repeated for up to 15 rounds or until either a sentinel fired or the PC
   left the known title-screen address clusters. **Caveat for whoever reuses
   this:** this per-round pattern of resume→(brief poll)→pause is a
   *tighter* resume/pause cycle than the project's own established
   `waitCheckpointHit` pattern (long run windows, few transitions), and is
   the leading suspect for triggering the emulator hang documented above.
   plan 02-02 should prefer `waitCheckpointHit`-style long windows over this
   tight-poll pattern.
5. The `$1556` PC landing was reached on round 2 of that loop (of the two
   press-and-watch rounds that ran before the emulator hang was found), with
   no sentinel hit at any point.

## Environment note for the human checkpoint

All three VICE pool instances (ports 6510, 6511, 6512) were confirmed
hung (zero CPU cycles elapsing despite `vice_ping` reporting "running") by
the end of this run. `disarm` still worked against all three (checkpoint
enumerate/delete are monitor-level operations, not dependent on CPU
execution) — see below — but no further live play is possible until the
host-side VICE processes are restarted. This is a **pre-existing,
independently-confirmed hazard** (`.planning/STATE.md`), not something this
plan's tooling caused by a wrong sequence of calls, though the tight
resume/pause loop above (item 4 in the notes) is flagged as a plausible
contributing factor for a future, more careful attempt.

## Teardown

`tools/watch-loads.mjs disarm` was found (independently, by the
orchestrator, and reconfirmed here) to **not honour `VICE_MCP_URL`** — it
acquires its own pool lease via `tools/vice-pool.mjs`'s `acquire()`, which
picks whatever port is free by the pool's own descending-port rule,
ignoring any environment override. Relying on it for teardown without an
explicit follow-up check would have silently disarmed the wrong (usually
empty) port. Teardown was therefore done by targeting each port directly:

```
port 6510: 175 checkpoint(s) present -> 175 deleted, 0 errors -> 0 remaining
port 6511: 1 checkpoint(s) present -> 1 deleted, 0 errors -> 0 remaining
port 6512: 0 checkpoint(s) present -> 0 deleted, 0 errors -> 0 remaining
```

All three pool instances now report `vice_checkpoint_list` count `0`,
verified by direct `VICE_MCP_URL`-targeted calls after the deletes, not by
trusting `disarm`'s own report. Plan 02-02's precondition (empty checkpoint
list) holds regardless of which port it lands on.
