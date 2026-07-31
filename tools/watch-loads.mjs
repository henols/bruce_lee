#!/usr/bin/env node
// The mechanical on-demand-load detector (RECOVER-04, D-10/D-11). Play is
// merely what drives it -- the detector is three kinds of sentinel, all
// resolved per release from `recovery/RELEASES.json` and the release's own
// `run1` range manifest, never hardcoded here:
//
//   1. Loader re-entry exec checkpoints, one per range in the registry's
//      `loader_ranges` field -- the release's already-defeated loader/
//      cracktro code, observed executing during boot and recorded in that
//      release's NOTES.md. Per D-10 these must never fire again after the
//      dump point; if one does, that is itself the finding.
//   2. A single $DD00 (CIA2 port A) watch, type "both" -- the VIC bank-select
//      bits AND the bit-banged serial-bus CLK/DATA/ATN lines a KERNAL-
//      bypassing raw-sector loader toggles directly. The primary sentinel,
//      since these releases have no $FFD5-style KERNAL vector activity to
//      watch instead. A hit here can also be an ordinary VIC bank change, so
//      every hit is attributed and reasoned about, never counted blindly.
//   3. One write-watch per range the release's `run1` capture classified
//      `unused` (never-populated at dump time) -- a write there is the
//      signature of content arriving later.
//
// Verbs: arm, disarm, report, attribute. Exports match 01-01-PLAN.md's own
// declared surface for this file: armWatchSet, disarmAll, attributeAddress,
// reportHits, WATCH_SET.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { call as defaultCall, useInstance } from "../.claude/skills/vice-session/scripts/vice.mjs";
import { acquire } from "../.claude/skills/vice-session/scripts/vice-pool.mjs";
import { release, releaseDir, upsertRelease } from "./releases.mjs";
import { addrNum, hex4 } from "../.claude/skills/vice-session/scripts/vice-sync.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

const die = (m) => { console.error(`error: ${m}`); process.exit(1); };

// -------------------------------------------------------------- resolution

/** The `label` dump's range manifest for `releaseId`, filtered to `kind: "unused"` ranges. */
function unusedRangesFor(releaseId, label = "run1") {
  const rel = release(releaseId);
  const dump = (rel.dumps || []).find((d) => d.label === label);
  if (!dump || !dump.range_manifest) {
    throw new Error(`unusedRangesFor: release "${releaseId}" has no "${label}" dump with a range_manifest`);
  }
  const manifestPath = join(REPO_ROOT, dump.range_manifest);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return (manifest.ranges || [])
    .filter((r) => r.kind === "unused")
    .map((r) => ({ start: r.start, end: r.end }));
}

const slug = (n) => addrNum(n).toString(16).toUpperCase().padStart(4, "0");

/**
 * The resolved sentinel list for `releaseId` -- pure, no emulator call, no
 * file write. Every sentinel: { name, kind, type, start, end, reason }, with
 * `start`/`end` normalised to "$XXXX" hex4 strings so downstream comparisons
 * (attributeAddress, the registry record) never mix numeric and string forms.
 *
 * `type` is "exec" for a loader-reentry checkpoint (armed via
 * vice_checkpoint_add) or "read"/"write"/"both" for a watch (armed via
 * vice_watch_add) -- armWatchSet below dispatches on this field.
 */
export function WATCH_SET(releaseId) {
  const rel = release(releaseId);
  const loaderRanges = rel.loader_ranges || [];
  if (loaderRanges.length === 0) {
    throw new Error(
      `WATCH_SET: release "${releaseId}" has no loader_ranges recorded in recovery/RELEASES.json -- ` +
        `record the observed boot/cracktro execution addresses from ${releaseId}/NOTES.md there first (D-10)`
    );
  }

  const sentinels = [];

  loaderRanges.forEach((lr, i) => {
    const start = hex4(addrNum(lr.start));
    const end = hex4(addrNum(lr.end ?? lr.start));
    sentinels.push({
      name: `loader-reentry-${i + 1}-${slug(lr.start)}`,
      kind: "loader-reentry",
      type: "exec",
      start,
      end,
      reason:
        lr.note ||
        "already-defeated loader/cracktro code range; per D-10 it must never execute again after the dump point",
    });
  });

  sentinels.push({
    name: "dd00-vic-bank-and-serial-bus",
    kind: "dd00-sentinel",
    type: "both",
    start: "$DD00",
    end: "$DD00",
    reason:
      "CIA2 port A: the VIC bank-select bits AND the bit-banged serial-bus CLK/DATA/ATN lines a KERNAL-" +
      "bypassing raw-sector loader toggles directly -- the primary on-demand-load sentinel per D-10, since " +
      "this project's loaders have no $FFD5-style KERNAL vector activity to watch instead. Also trips on an " +
      "ordinary VIC bank change, which is why every hit is attributed and reasoned about, never counted blindly.",
  });

  for (const r of unusedRangesFor(releaseId, "run1")) {
    const start = hex4(r.start);
    const end = hex4(r.end);
    sentinels.push({
      name: `unused-${slug(r.start)}-${slug(r.end)}`,
      kind: "unused-range",
      type: "write",
      start,
      end,
      reason: `never-populated at dump time -- ${releaseId}-gameentry-run1.map.json classified this range "unused"`,
    });
  }

  return sentinels;
}

/**
 * Persist the resolved sentinel list into the registry, in a form plan
 * 02-02 can re-arm verbatim during Phase 2's exhaustive all-chambers trace
 * (D-11) -- the whole point of not paying for the expensive play-through
 * twice. A description of what SHOULD be armed, independent of whether this
 * process has (yet) actually armed it live.
 */
export function recordWatchSet(releaseId, sentinels = WATCH_SET(releaseId)) {
  upsertRelease(releaseId, (r) => ({
    ...r,
    watch_set: sentinels.map(({ name, kind, type, start, end, reason }) => ({ name, kind, type, start, end, reason })),
  }));
  return sentinels;
}

// ------------------------------------------------------------- attribution

/**
 * Resolve `addr` to exactly one WATCH_SET sentinel for `releaseId`, or an
 * explicit unmatched result -- never the nearest neighbour. Overlapping
 * sentinels are a configuration bug and throw loudly rather than silently
 * picking a winner: D-10's whole point is that a hit resolves to exactly one
 * named range.
 */
export function attributeAddress(addr, releaseId) {
  const target = addrNum(addr);
  const set = WATCH_SET(releaseId);
  const owners = set.filter((s) => target >= addrNum(s.start) && target <= addrNum(s.end));
  if (owners.length === 0) {
    return { address: hex4(target), name: null, matched: false };
  }
  if (owners.length > 1) {
    throw new Error(
      `attributeAddress: ${hex4(target)} matches ${owners.length} sentinels in release "${releaseId}" ` +
        `(${owners.map((o) => o.name).join(", ")}) -- WATCH_SET ranges must be disjoint`
    );
  }
  return { address: hex4(target), name: owners[0].name, matched: true, sentinel: owners[0] };
}

// ------------------------------------------------------------------- arming

/**
 * Arm every WATCH_SET sentinel for `releaseId` against the live instance,
 * via the injectable `call` (default: the real MCP seam) so this is testable
 * with a stub. On ANY failure partway through, calls `disarmAll` so the
 * shared instance is never left holding half an armed set (T-01-17) -- no
 * bulk checkpoint-clear tool exists, so a partial teardown is the default
 * failure rather than the exception unless this is enforced here.
 *
 * `record` (default true) persists the resolved set into the registry
 * before any emulator call is made, independent of whether arming itself
 * succeeds -- callers that only want the registry updated for Phase 2's
 * re-arm (D-11) without touching the shared instance can pass
 * `{ liveArm: false }` to skip the emulator entirely.
 */
export async function armWatchSet(releaseId, { call = defaultCall, record = true, liveArm = true } = {}) {
  const set = WATCH_SET(releaseId);
  if (record) recordWatchSet(releaseId, set);
  if (!liveArm) return { release: releaseId, recorded: record, liveArmed: false, sentinels: set };

  const armed = [];
  try {
    for (const s of set) {
      let result;
      if (s.type === "exec") {
        result = await call("vice_checkpoint_add", { start: s.start, end: s.end, exec: true, stop: true });
      } else {
        const size = addrNum(s.end) - addrNum(s.start) + 1;
        result = await call("vice_watch_add", { address: s.start, size, type: s.type });
      }
      const id = result?.checkpoint_num ?? result?.checkpoint?.checkpoint_num;
      if (id == null) {
        throw new Error(`sentinel "${s.name}" armed but returned no checkpoint_num (result: ${JSON.stringify(result)})`);
      }
      armed.push({ ...s, checkpoint_num: id });
    }
  } catch (e) {
    const { deleted, errors } = await disarmAll({ call });
    throw new Error(
      `armWatchSet(${releaseId}): failed arming sentinel #${armed.length + 1}/${set.length} -- ${e.message}. ` +
        `Disarmed ${deleted.length} already-armed sentinel(s) so no partial watch set is left on the shared ` +
        `instance${errors.length ? ` (${errors.length} teardown error(s): ${JSON.stringify(errors)})` : ""}.`
    );
  }
  return { release: releaseId, recorded: record, liveArmed: true, sentinels: armed };
}

/**
 * The counterpart of the missing bulk-clear tool (T-01-17): enumerate with
 * vice_checkpoint_list and delete each returned id individually. Never
 * deletes a checkpoint VICE marked `temporary` -- those are created and
 * auto-reaped by vice_run_until, and deleting a stale id is a hazard
 * (matches tools/recover.mjs's own reset() convention).
 */
export async function disarmAll({ call = defaultCall } = {}) {
  const { checkpoints } = await call("vice_checkpoint_list", {});
  const deleted = [];
  const errors = [];
  for (const cp of checkpoints || []) {
    if (cp.temporary) continue;
    try {
      await call("vice_checkpoint_delete", { checkpoint_num: cp.checkpoint_num });
      deleted.push(cp.checkpoint_num);
    } catch (e) {
      errors.push({ checkpoint_num: cp.checkpoint_num, error: e.message });
    }
  }
  return { deleted, errors };
}

// ------------------------------------------------------------------ report

function hitLogPath(releaseId) {
  return join(REPO_ROOT, "recovery", releaseId, "dumps", `${releaseId}-loading-hits.json`);
}

/** Read the persisted hit log for `releaseId`, or an empty log if none was ever written. */
export function readHitLog(releaseId) {
  const p = hitLogPath(releaseId);
  if (!existsSync(p)) return { release: releaseId, hits: [] };
  return JSON.parse(readFileSync(p, "utf8"));
}

export function writeHitLog(releaseId, hits) {
  const p = hitLogPath(releaseId);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ release: releaseId, hits }, null, 2) + "\n");
  return p;
}

/**
 * Sort hits by emulated cycle ascending, then address ascending -- so two
 * hits at the same cycle have a defined order and the report is
 * reproducible. Pure: never mutates its argument, always returns a fresh
 * array, so calling this twice on the same log is byte-identical.
 */
export function reportHits(hits) {
  return [...hits].sort((a, b) => {
    if (a.cycle !== b.cycle) return a.cycle - b.cycle;
    return addrNum(a.address) - addrNum(b.address);
  });
}

/** The full report for `releaseId`: the persisted hits, sorted and each attributed to exactly one sentinel. */
export function report(releaseId) {
  const { hits } = readHitLog(releaseId);
  const sorted = reportHits(hits);
  return sorted.map((h) => ({ ...h, attribution: attributeAddress(h.address, releaseId) }));
}

// -------------------------------------------------------------------- CLI

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = rest.indexOf(`--${name}`);
    return i === -1 ? fallback : rest[i + 1];
  };
  const jsonFlag = rest.includes("--json");
  const positional = rest.filter((a, i) => !a.startsWith("--") && rest[i - 1] !== "--release");

  async function runCommand() {
    if (cmd === "attribute") {
      const releaseId = opt("release");
      const addr = positional[0];
      if (!releaseId || addr == null) die("usage: attribute --release <id> <address> [--json]");
      const r = attributeAddress(addr, releaseId);
      if (jsonFlag) console.log(JSON.stringify(r, null, 2));
      else console.log(r.matched ? `${r.address}: ${r.name}` : `${r.address}: (unmatched)`);
      process.exitCode = r.matched ? 0 : 0;
      return;
    }
    if (cmd === "arm") {
      const releaseId = opt("release");
      if (!releaseId) die("usage: arm --release <id> [--record-only] [--json]");
      const recordOnly = rest.includes("--record-only");
      const r = await armWatchSet(releaseId, { liveArm: !recordOnly });
      if (jsonFlag) {
        console.log(JSON.stringify(r, null, 2));
      } else {
        console.log(`arm ${releaseId}: ${r.sentinels.length} sentinel(s) ${recordOnly ? "recorded (not live-armed)" : "armed"}`);
        for (const s of r.sentinels) console.log(`  ${s.type.padEnd(5)} ${s.start}-${s.end}  ${s.name}`);
      }
      return;
    }
    if (cmd === "disarm") {
      const r = await disarmAll({});
      if (jsonFlag) console.log(JSON.stringify(r, null, 2));
      else console.log(`disarm: deleted ${r.deleted.length} checkpoint(s)${r.errors.length ? `, ${r.errors.length} error(s)` : ""}`);
      process.exitCode = r.errors.length ? 1 : 0;
      return;
    }
    if (cmd === "report") {
      const releaseId = opt("release");
      if (!releaseId) die("usage: report --release <id> [--json]");
      const r = report(releaseId);
      if (jsonFlag) {
        console.log(JSON.stringify(r, null, 2));
      } else {
        console.log(`report ${releaseId}: ${r.length} hit(s)`);
        for (const h of r) console.log(`  cycle ${h.cycle} ${h.address} -> ${h.attribution.name ?? "(unmatched)"}`);
      }
      return;
    }
    console.log(`usage: node ${fileURLToPath(import.meta.url)} <command> [args]

  attribute --release <id> <address> [--json]        resolve an address to exactly one WATCH_SET sentinel
  arm --release <id> [--record-only] [--json]         resolve + record + (unless --record-only) live-arm the set
  disarm [--json]                                     delete every checkpoint on the shared instance individually
  report --release <id> [--json]                      the persisted hit log, sorted and attributed`);
    process.exitCode = cmd ? 1 : 0;
  }

  async function main() {
    if (cmd === "attribute" || cmd === "report" || (cmd === "arm" && rest.includes("--record-only"))) {
      // Pure, offline commands -- no lease, no emulator contact.
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
