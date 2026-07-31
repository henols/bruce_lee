#!/usr/bin/env node
// Chip-state sidecar writer, and the D-02 range-manifest writer that rides
// alongside it. Neither knows about releases beyond the label passed in --
// `tools/recover.mjs` is the only place that decides WHEN these run (right
// at the dump trigger, before anything else touches the machine) and WHERE
// the results are filed.
//
// Two facts drive this file's shape, both from D-04:
//   - The RAM image (`tools/recover.mjs`'s `.bin`) is a pure memory dump. The
//     facts that matter and are NOT in that image -- which 16KB the VIC-II is
//     looking at, where the screen/charset live inside it, what the eight
//     sprite pointer bytes resolve to, the `$01` port decode, and the raw SID/
//     CIA/CPU register state -- exist only at the dump instant and must be
//     captured separately, at the same instant.
//   - `vice_sprite_get` returns position/colour/mode flags but NEVER the raw
//     pointer byte (01-RESEARCH.md's "Chip-level state capture" section, and
//     01-01-PLAN.md's own nuance note). The pointer bytes come from a plain
//     `vice_memory_read` at the resolved screen base + `$3F8`, size 8 --
//     `vice_sprite_inspect` is a reasonable human cross-check but is never the
//     source of record.
//
// Follows the same "call, derive fields, merge, write JSON" shape as
// `.claude/skills/c64-memory-mapping/scripts/driver.mjs`, and takes an
// injectable `call` (default: the real MCP seam) so `captureChipState` and
// `buildRangeManifest` are unit-testable without a live emulator -- the
// derivation helpers below take no `call` at all and are pure functions over
// plain numbers/bytes.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { call as defaultCall, useInstance } from "../.claude/skills/vice-mcp-selector/scripts/vice.mjs";
import { acquire } from "../.claude/skills/vice-mcp-selector/scripts/vice-pool.mjs";
import { hex4 } from "../.claude/skills/vice-mcp-selector/scripts/vice-sync.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

const die = (m) => { console.error(`error: ${m}`); process.exit(1); };

// ------------------------------------------------------------- derivations

/**
 * CIA2 port A's low two bits select the 16KB VIC bank, INVERTED -- `%11`
 * (both bits set) is bank 0, `$0000-$3FFF` (01-RESEARCH.md, live-verified).
 */
export function deriveVicBank(dd00Raw) {
  return 3 - (dd00Raw & 0b11);
}

/**
 * `$D018` bits 4-7 select one of 16 1KB screen blocks WITHIN the selected
 * 16KB VIC bank -- resolve against the bank, never against absolute zero.
 */
export function deriveScreenBase(vicBank, d018Raw) {
  const bankBase = vicBank * 0x4000;
  const screenBlock = (d018Raw >> 4) & 0x0f;
  return bankBase + screenBlock * 0x400;
}

/**
 * `$D018` bits 1-3 select one of 8 2KB charset/bitmap blocks WITHIN the
 * selected 16KB VIC bank.
 */
export function deriveCharsetBase(vicBank, d018Raw) {
  const bankBase = vicBank * 0x4000;
  const charsetBlock = (d018Raw >> 1) & 0x07;
  return bankBase + charsetBlock * 0x800;
}

/**
 * Each of the 8 raw sprite-pointer bytes multiplied by 64 and offset into
 * the selected VIC bank -- the standard C64 sprite-pointer resolution.
 */
export function deriveSpritePointers(pointerBytes, vicBank) {
  const bankBase = vicBank * 0x4000;
  return [...pointerBytes].map((p) => bankBase + p * 64);
}

// ------------------------------------------------------------------ capture

/**
 * Capture the D-04 sidecar: the raw register halves plus every derived fact
 * that is not in RAM, each recorded next to the raw byte it came from.
 *
 * `call` defaults to the real MCP seam but is always accepted as an argument
 * -- this is what makes the function testable against a fake in principle,
 * following driver.mjs's pattern, even though this repository's actual test
 * suites exercise it against the live emulator (there is no synthetic VICE
 * to fake against yet).
 */
export async function captureChipState({ call = defaultCall, release, label, snapshotName = null } = {}) {
  if (!release) throw new Error("captureChipState: release is required");
  if (!label) throw new Error("captureChipState: label is required");

  const vicii = await call("vice_vicii_get_state", {});
  const sid = await call("vice_sid_get_state", {});
  const cia = await call("vice_cia_get_state", {});
  const cpu = await call("vice_registers_get", {});

  const sprites = [];
  for (let n = 0; n < 8; n++) {
    sprites.push(await call("vice_sprite_get", { sprite: n }));
  }
  if (sprites.length !== 8) {
    throw new Error(`captureChipState: expected 8 sprite reads, got ${sprites.length}`);
  }

  // -- derived half: the facts that matter and are not in RAM --

  const port01Read = await call("vice_memory_read", { address: "$01", size: 1, encoding: "hex" });
  const port01Raw = parseInt(port01Read.data_hex, 16);
  const port01 = {
    raw: port01Raw,
    loram: !!(port01Raw & 0x01),
    hiram: !!(port01Raw & 0x02),
    charen: !!(port01Raw & 0x04),
  };

  // $DD00 is read TWICE, through independent tools, and must agree -- a
  // disagreement fails the capture rather than picking a winner (T-01-11).
  const dd00Raw = cia.cia2.port_a;
  const dd00Direct = await call("vice_memory_read", { address: "$DD00", size: 1, encoding: "hex" });
  const dd00DirectValue = parseInt(dd00Direct.data_hex, 16);
  if ((dd00Raw & 0b11) !== (dd00DirectValue & 0b11)) {
    throw new Error(
      `captureChipState: $DD00 bank-select bits disagree -- cia2.port_a=${dd00Raw} (low 2 bits ` +
        `${(dd00Raw & 0b11).toString(2).padStart(2, "0")}) vs direct memory read=${dd00DirectValue} ` +
        `(low 2 bits ${(dd00DirectValue & 0b11).toString(2).padStart(2, "0")})`
    );
  }
  const vicBank = deriveVicBank(dd00Raw);

  const d018Raw = vicii.memory_pointers;
  const screenBase = deriveScreenBase(vicBank, d018Raw);
  const charsetBase = deriveCharsetBase(vicBank, d018Raw);

  // The 8 raw sprite-pointer bytes -- NEVER from vice_sprite_get, which
  // returns position/colour/mode flags and never the pointer byte itself.
  const spritePointerRead = await call("vice_memory_read", {
    address: hex4(screenBase + 0x3f8),
    size: 8,
    bank: "ram",
    encoding: "hex",
  });
  const spritePointerBytes = Buffer.from(spritePointerRead.data_hex, "hex");
  if (spritePointerBytes.length !== 8) {
    throw new Error(`captureChipState: expected 8 sprite-pointer bytes, got ${spritePointerBytes.length}`);
  }
  const spriteDataAddresses = deriveSpritePointers(spritePointerBytes, vicBank);

  return {
    schema_version: 1,
    release,
    label,
    snapshot_name: snapshotName,
    registers: {
      vicii,
      sid,
      cia1: cia.cia1,
      cia2: cia.cia2,
    },
    sprites,
    cpu,
    derived: {
      port01,
      dd00_raw: dd00Raw,
      dd00_direct_read: dd00DirectValue,
      vic_bank: vicBank,
      d018_raw: d018Raw,
      screen_base: screenBase,
      charset_base: charsetBase,
      sprite_pointers: [...spritePointerBytes],
      sprite_data_addresses: spriteDataAddresses,
    },
    captured_at: new Date().toISOString(),
  };
}

// ------------------------------------------------------------- range manifest

// Reuses D-14's gap-coalescing tolerance (documented elsewhere in this phase
// as "coalesced across gaps < 16 identical bytes") as this manifest's own
// minimum run length for calling a stretch `unused` -- consistent with the
// only other numeric threshold this phase has already settled on, rather
// than inventing a second, unrelated number.
export const MIN_UNUSED_RUN = 16;

/**
 * Maximal contiguous runs of `image[start..end]` where every byte is $00 or
 * $FF (mixed $00/$FF allowed within one run, matching the "power-on pattern
 * block" notion already established in `tools/recover.mjs`), at least
 * `minRun` bytes long.
 */
export function findUnusedRuns(image, { start, end }, minRun = MIN_UNUSED_RUN) {
  const ranges = [];
  let runStart = null;
  const flush = (until) => {
    if (runStart !== null && until - runStart >= minRun) ranges.push({ start: runStart, end: until - 1 });
    runStart = null;
  };
  for (let a = start; a <= end; a++) {
    const isPattern = image[a] === 0x00 || image[a] === 0xff;
    if (isPattern) {
      if (runStart === null) runStart = a;
    } else {
      flush(a);
    }
  }
  flush(end + 1);
  return ranges;
}

const IO_START = 0xd000;
const IO_END = 0xdfff;

/**
 * Build the D-02 range manifest for a just-captured 65536-byte image. Only
 * what is ALREADY determinable at this stage gets a real kind: `io` for the
 * fixed `$D000-$DFFF` window (the image holds the RAM shadowed beneath it
 * per D-03, not register values -- those live in the chip-state sidecar),
 * and `unused` for any run the capture found entirely uniform in the
 * power-on `$00`/`$FF` pattern. Everything else is the transient
 * `unclassified` -- a sixth value on top of D-02's five (game/loader/
 * cracktro/io/unused), rejected by `recovery-schema.mjs validate --final`
 * so it cannot survive to the end of the phase.
 */
export function buildRangeManifest({ image, release, label, snapshotName = null } = {}) {
  if (!image || image.length !== 65536) {
    throw new Error(`buildRangeManifest: image must be exactly 65536 bytes, got ${image ? image.length : "none"}`);
  }

  const ranges = [];
  const push = (start, end, kind, note) => ranges.push({ start, end, kind, source: "capture", note });
  const UNCLASSIFIED_NOTE = "awaiting the loader/cracktro/game three-bucket partition";
  const UNUSED_NOTE = `contiguous $00/$FF power-on-pattern run of at least ${MIN_UNUSED_RUN} bytes`;

  const fillGaps = (from, to, runs) => {
    let cursor = from;
    for (const r of runs) {
      if (r.start > cursor) push(cursor, r.start - 1, "unclassified", UNCLASSIFIED_NOTE);
      push(r.start, r.end, "unused", UNUSED_NOTE);
      cursor = r.end + 1;
    }
    if (cursor <= to) push(cursor, to, "unclassified", UNCLASSIFIED_NOTE);
  };

  fillGaps(0x0000, IO_START - 1, findUnusedRuns(image, { start: 0x0000, end: IO_START - 1 }));
  push(
    IO_START,
    IO_END,
    "io",
    "VIC-II/SID/CIA I/O window; the image holds the RAM shadowed beneath these registers (D-03), " +
      "not register values -- those live in the chip-state sidecar"
  );
  fillGaps(IO_END + 1, 0xffff, findUnusedRuns(image, { start: IO_END + 1, end: 0xffff }));

  ranges.sort((a, b) => a.start - b.start);

  return {
    schema_version: 1,
    release,
    label,
    snapshot_name: snapshotName,
    image_bytes: 65536,
    offset_equals_address: true,
    classification_state: "ranges-only",
    ranges,
    note:
      "`unclassified` is a sixth, explicitly transient value on top of D-02's five (game/loader/" +
      "cracktro/io/unused); `recovery-schema.mjs validate --final` rejects it, so it cannot survive " +
      "to the end of the phase.",
    generated_at: new Date().toISOString(),
  };
}

// -------------------------------------------------------------------- CLI

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = rest.indexOf(`--${name}`);
    return i === -1 ? fallback : rest[i + 1];
  };
  const jsonFlag = rest.includes("--json");

  async function runCommand() {
    if (cmd === "capture") {
      const release = rest[0];
      const label = opt("label");
      const snapshotName = opt("snapshot-name", null);
      const out = opt("out");
      if (!release || !label) die("usage: capture <release> --label <label> [--snapshot-name <name>] [--out <path>]");
      const state = await captureChipState({ release, label, snapshotName });
      if (out) {
        mkdirSync(dirname(resolve(REPO_ROOT, out)), { recursive: true });
        writeFileSync(resolve(REPO_ROOT, out), JSON.stringify(state, null, 2) + "\n");
      }
      if (jsonFlag || !out) console.log(JSON.stringify(state, null, 2));
      else console.log(`capture: wrote ${out}`);
      return;
    }
    if (cmd === "map") {
      const imagePath = opt("image");
      const release = opt("release");
      const label = opt("label");
      const snapshotName = opt("snapshot-name", null);
      const out = opt("out");
      if (!imagePath || !release || !label) die("usage: map --image <path.bin> --release <id> --label <label> [--out <path>]");
      const image = readFileSync(resolve(REPO_ROOT, imagePath));
      const manifest = buildRangeManifest({ image, release, label, snapshotName });
      if (out) {
        mkdirSync(dirname(resolve(REPO_ROOT, out)), { recursive: true });
        writeFileSync(resolve(REPO_ROOT, out), JSON.stringify(manifest, null, 2) + "\n");
      }
      if (jsonFlag || !out) console.log(JSON.stringify(manifest, null, 2));
      else console.log(`map: wrote ${out}`);
      return;
    }
    console.log(`usage: node ${fileURLToPath(import.meta.url)} <command> [args]

  capture <release> --label <label> [--snapshot-name <name>] [--out <path>]   capture chip state live
  map --image <path.bin> --release <id> --label <label> [--out <path>]        build the range manifest from a .bin`);
    process.exitCode = cmd ? 1 : 0;
  }

  // Same lease discipline as tools/recover.mjs's CLI (D-4, D-5): one lease
  // per verb invocation, acquired at the CLI entry point only, so
  // programmatic callers (recover.mjs importing captureChipState directly)
  // never trigger a lease they didn't ask for.
  async function main() {
    if (cmd === "map") {
      // Pure Node, no emulator needed -- skip the lease entirely.
      await runCommand();
      return;
    }
    const lease = await acquire();
    useInstance(lease);
    try {
      await runCommand();
    } finally {
      await lease.release();
    }
  }

  main().catch((e) => die(e.message));
}
