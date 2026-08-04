#!/usr/bin/env node
import { readFileSync } from 'node:fs';

// Pure derivation over values the agent already fetched. Contacts nothing.
//
// The mcp__vice__* tools are the only route to the emulator (.claude/CLAUDE.md
// § Emulator Access). This script therefore takes register values as arguments
// and RAM as a file, and performs only the arithmetic that a lookup table
// cannot: register bits -> concrete addresses.

const HEX = /^(?:\$|0x)?([0-9a-f]+)h?$/i;

function parseNum(s, what) {
  if (s === undefined || s === null) return undefined;
  const t = String(s).trim();
  if (/^%[01]+$/.test(t)) return parseInt(t.slice(1), 2);
  const m = HEX.exec(t);
  // A bare decimal is only decimal when it cannot be hex; callers copy values
  // out of register dumps, which are hex. Require an explicit marker for decimal.
  if (/^\d+$/.test(t) && !/^\$|^0x/i.test(t)) return parseInt(t, 16);
  if (m) return parseInt(m[1], 16);
  throw new Error(`cannot parse ${what}: ${s}`);
}

const hex = (n, w = 4) => '$' + n.toString(16).toUpperCase().padStart(w, '0');
const bin8 = (n) => '%' + n.toString(2).padStart(8, '0');

// ---------------------------------------------------------------- VIC banking

// $DD00 bits 0-1 select the bank, INVERTED. The single most common source of a
// wrong answer in C64 graphics RE: every other pointer hangs off this base.
function bankOf(dd00) {
  const sel = dd00 & 3;
  const bank = 3 - sel;
  return { bank, base: bank * 0x4000, sel };
}

// The VIC sees character ROM at $1000-$1FFF of banks 0 and 2, regardless of the
// $01 banking the CPU sees. If CB lands there, no charset exists in RAM.
function charRomShadow(bank, cb) {
  return (bank === 0 || bank === 2) && (cb === 2 || cb === 3);
}

function modeOf(d011, d016) {
  const ecm = (d011 >> 6) & 1, bmm = (d011 >> 5) & 1, mcm = (d016 >> 4) & 1;
  const names = {
    '000': 'standard text', '001': 'multicolor text',
    '010': 'standard bitmap', '011': 'multicolor bitmap',
    '100': 'extended background text',
  };
  const key = `${ecm}${bmm}${mcm}`;
  return { ecm, bmm, mcm, name: names[key] ?? 'INVALID — screen goes black', key };
}

function vic({ dd00, d018, d011, d016 }) {
  const { bank, base, sel } = bankOf(dd00);
  const vm = (d018 >> 4) & 0x0f;
  const cb = (d018 >> 1) & 0x07;
  const mode = modeOf(d011, d016);
  const screen = base + vm * 0x0400;
  const out = [];

  out.push(`$DD00 = ${hex(dd00, 2)} ${bin8(dd00)}`);
  out.push(`  bits 0-1 = %${sel.toString(2).padStart(2, '0')} (inverted) -> VIC bank ${bank}, base ${hex(base)}`);
  out.push('');
  out.push(`$D018 = ${hex(d018, 2)} ${bin8(d018)}`);
  out.push(`  VM  bits 4-7 = ${vm.toString().padStart(2)}  -> screen RAM     ${hex(screen)}-${hex(screen + 0x3e7)}`);

  if (mode.bmm) {
    // In bitmap mode only bit 3 of $D018 matters: which 8K half of the bank.
    const half = (cb & 4) ? 0x2000 : 0x0000;
    const bmp = base + half;
    out.push(`  CB  bit  3   = ${(cb & 4) ? 1 : 0}   -> bitmap         ${hex(bmp)}-${hex(bmp + 0x1f3f)}  (8000 bytes)`);
    out.push('');
    out.push(`mode: ${mode.name}  (ECM=${mode.ecm} BMM=${mode.bmm} MCM=${mode.mcm})`);
    out.push(`  video matrix at ${hex(screen)} holds COLOUR PAIRS, not character codes`);
  } else {
    const chr = base + cb * 0x0800;
    if (charRomShadow(bank, cb)) {
      out.push(`  CB  bits 1-3 = ${cb}   -> character ROM SHADOW at ${hex(chr)}`);
      out.push('');
      out.push('  *** CHARACTER ROM, NOT RAM ***');
      out.push('  The VIC sees char ROM at $1000-$1FFF in banks 0 and 2 whatever $01 says.');
      out.push('  This game uses ROM characters here. There is no charset in RAM to extract.');
    } else {
      out.push(`  CB  bits 1-3 = ${cb}   -> charset        ${hex(chr)}-${hex(chr + 0x7ff)}  (256 chars)`);
    }
    out.push('');
    out.push(`mode: ${mode.name}  (ECM=${mode.ecm} BMM=${mode.bmm} MCM=${mode.mcm})`);
  }

  if (mode.name.startsWith('INVALID')) {
    out.push('  This bit combination blanks the screen. Re-read the registers — you');
    out.push('  probably caught them mid-update inside a raster split.');
  }
  if (mode.mcm) out.push('  multicolor: bit PAIRS, half horizontal resolution');

  out.push('');
  out.push(`sprite pointers: ${hex(screen + 0x3f8)}-${hex(screen + 0x3ff)}   (screen + $03F8, 8 bytes)`);
  out.push(`colour RAM:      $D800-$DBFF   (fixed; does NOT move with the VIC bank, low nybble only)`);
  return out.join('\n');
}

// ---------------------------------------------------------------------- sprites

function sprites({ dd00, d018, d015, ptrs }) {
  const { bank, base } = bankOf(dd00);
  const vm = (d018 >> 4) & 0x0f;
  const screen = base + vm * 0x0400;
  const out = [];
  out.push(`VIC bank ${bank} (${hex(base)}), screen ${hex(screen)}, pointer block ${hex(screen + 0x3f8)}`);
  out.push(`$D015 = ${hex(d015, 2)} ${bin8(d015)}`);
  out.push('');
  out.push('spr  enabled  ptr   data address    note');
  for (let i = 0; i < 8; i++) {
    const on = (d015 >> i) & 1;
    const p = ptrs[i];
    const addr = p === undefined ? undefined : base + p * 64;
    const note = on ? '' : 'DISABLED — other registers are stale, do not decode';
    out.push(
      `  ${i}     ${on ? 'yes' : 'no '}    ` +
      `${p === undefined ? ' -- ' : hex(p, 2).padEnd(4)}  ` +
      `${addr === undefined ? '   --------- ' : `${hex(addr)}-${hex(addr + 62)}`}  ${note}`
    );
  }
  out.push('');
  out.push('63 bytes used of each 64-byte block. $D010 carries X bit 8 for X>255.');
  return out.join('\n');
}

// ---------------------------------------------------------------------- vectors

const VECTORS = [
  ['$0314/$0315', 0x0314, 0xea31, 'CINV  — KERNAL IRQ (RAM, indirect)'],
  ['$0316/$0317', 0x0316, 0xfe66, 'CBINV — BRK'],
  ['$0318/$0319', 0x0318, 0xfe47, 'NMINV — NMI (music players retarget this)'],
  ['$FFFA/$FFFB', 0xfffa, null, 'hardware NMI'],
  ['$FFFC/$FFFD', 0xfffc, null, 'hardware RESET'],
  ['$FFFE/$FFFF', 0xfffe, null, 'hardware IRQ/BRK'],
];

function decodePort(v) {
  const loram = v & 1, hiram = (v >> 1) & 1, charen = (v >> 2) & 1;
  return { loram, hiram, charen };
}

function vectors(buf, portOverride) {
  const out = [];
  const port = portOverride !== undefined ? portOverride : buf[0x0001];
  const { loram, hiram, charen } = decodePort(port);

  out.push(`$01 = ${hex(port, 2)} ${bin8(port)}`);
  out.push(`  bit 0 LORAM  = ${loram}  BASIC ROM  ${loram ? 'in' : 'out (RAM at $A000-$BFFF)'}`);
  out.push(`  bit 1 HIRAM  = ${hiram}  KERNAL ROM ${hiram ? 'in' : 'out (RAM at $E000-$FFFF)'}`);
  out.push(`  bit 2 CHAREN = ${charen}  ${charen ? 'I/O at $D000-$DFFF' : 'character ROM at $D000-$DFFF'}`);
  out.push('');
  out.push(`LIVE VECTOR PAIR: ${hiram ? '$0314/$0315 (KERNAL path — the RAM vectors are live)'
    : '$FFFE/$FFFF (KERNAL banked OUT — the hardware vectors are live)'}`);
  out.push('');
  out.push('vector        value   default  status');
  for (const [name, addr, def, meaning] of VECTORS) {
    const v = buf[addr] | (buf[addr + 1] << 8);
    let status;
    if (def === null) status = 'RAM under ROM';
    else if (v === def) status = 'default';
    else status = '*** RETARGETED ***';
    out.push(`${name}  ${hex(v)}   ${def === null ? '  --  ' : hex(def)}   ${status}`);
    out.push(`              ${meaning}`);
  }
  out.push('');
  out.push('A retargeted $0314 is the per-frame handler. Confirm it live: the handler');
  out.push('that runs exactly once per frame is the one that matters, whatever the');
  out.push('listing suggests. $FFFA-$FFFF read out of a RAM capture are the RAM bytes');
  out.push('under KERNAL ROM — which is exactly what runs when HIRAM = 0.');
  return out.join('\n');
}

// -------------------------------------------------------------------------- cli

function flag(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

const USAGE = `usage:
  derive.mjs vic     --dd00 3E --d018 18 --d011 1B --d016 C8
  derive.mjs sprites --dd00 3E --d018 18 --d015 FF --ptrs 20,21,22,23,24,25,26,27
  derive.mjs vectors <image.bin> [--port 35]

Values are hex by default ($3E, 0x3E, 3E all work); %00111110 for binary.
Register values come from mcp__vice__vice_vicii_get_state / vice_memory_read.
<image.bin> is a 65536-byte capture (see the c64-ram-capture skill).`;

function main(argv) {
  const verb = argv[0];
  try {
    if (verb === 'vic') {
      const g = (n, d) => {
        const raw = flag(argv, n);
        if (raw === undefined && d === undefined) throw new Error(`missing --${n}`);
        return raw === undefined ? d : parseNum(raw, `--${n}`);
      };
      console.log(vic({ dd00: g('dd00'), d018: g('d018'), d011: g('d011', 0x1b), d016: g('d016', 0xc8) }));
    } else if (verb === 'sprites') {
      const raw = flag(argv, 'ptrs');
      const ptrs = raw === undefined ? [] : raw.split(',').map((s) => parseNum(s, '--ptrs'));
      console.log(sprites({
        dd00: parseNum(flag(argv, 'dd00'), '--dd00'),
        d018: parseNum(flag(argv, 'd018'), '--d018'),
        d015: parseNum(flag(argv, 'd015') ?? 'FF', '--d015'),
        ptrs,
      }));
    } else if (verb === 'vectors') {
      const path = argv[1];
      if (!path || path.startsWith('--')) throw new Error('vectors needs an image path');
      const buf = readFileSync(path);
      if (buf.length !== 65536) throw new Error(`expected a 65536-byte image, got ${buf.length}`);
      const p = flag(argv, 'port');
      console.log(vectors(buf, p === undefined ? undefined : parseNum(p, '--port')));
    } else {
      console.log(USAGE);
      process.exit(verb === undefined || verb === '--help' || verb === '-h' ? 0 : 2);
    }
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}

main(process.argv.slice(2));
