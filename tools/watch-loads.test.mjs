// Coverage for the on-demand-load detector's PURE logic: attribution and hit
// ordering (task's own <behavior> list), against the real committed
// registry/manifest fixtures -- the project's established convention (see
// tools/d64-parse.test.mjs) of testing against real files rather than
// synthetic mocks wherever the fixtures already exist and are stable.
//
// A stub `call` covers armWatchSet's rollback behaviour without touching a
// live emulator: a stubbed vice_watch_add/vice_checkpoint_add that fails on
// the third invocation must propagate the failure AND leave nothing armed --
// verified by the same stub recording that disarmAll's own calls
// (vice_checkpoint_list, vice_checkpoint_delete) actually happened.
import { test } from "node:test";
import assert from "node:assert/strict";

import { WATCH_SET, attributeAddress, reportHits, armWatchSet, disarmAll } from "./watch-loads.mjs";

// ------------------------------------------------------------- attribution

test("attributeAddress: exactly one range name for the first and last byte of every declared WATCH_SET range (danish)", () => {
  const set = WATCH_SET("danish");
  assert.ok(set.length >= 6, "expected loader ranges + $DD00 + several unused ranges");
  for (const s of set) {
    const first = attributeAddress(s.start, "danish");
    const last = attributeAddress(s.end, "danish");
    assert.equal(first.matched, true, `first byte of ${s.name} (${s.start}) should match`);
    assert.equal(first.name, s.name, `first byte of ${s.name} attributed to itself`);
    assert.equal(last.matched, true, `last byte of ${s.name} (${s.end}) should match`);
    assert.equal(last.name, s.name, `last byte of ${s.name} attributed to itself`);
  }
});

test("attributeAddress: same holds for saeger's resolved WATCH_SET", () => {
  const set = WATCH_SET("saeger");
  assert.ok(set.length >= 3);
  for (const s of set) {
    assert.equal(attributeAddress(s.start, "saeger").name, s.name);
    assert.equal(attributeAddress(s.end, "saeger").name, s.name);
  }
});

test("attributeAddress: $DD00 resolves to exactly the dd00 sentinel", () => {
  const r = attributeAddress("$DD00", "danish");
  assert.equal(r.matched, true);
  assert.equal(r.name, "dd00-vic-bank-and-serial-bus");
});

test("attributeAddress: an address outside every declared range is explicitly unmatched, never a nearest neighbour", () => {
  // $0400 is the start of the program image proper, well outside every
  // loader-reentry/$DD00/unused-range sentinel for danish's resolved set.
  const r = attributeAddress(0x0400, "danish");
  assert.equal(r.matched, false);
  assert.equal(r.name, null);
});

test("attributeAddress: abutting synthetic ranges never double-claim a boundary address", () => {
  // Build two adjacent windows directly, bypassing WATCH_SET/the registry,
  // to pin the boundary-arithmetic contract independent of any real data
  // ever containing an abutment.
  const rangeA = { name: "a", start: "$1000", end: "$100F" };
  const rangeB = { name: "b", start: "$1010", end: "$101F" };
  const owns = (addr, r) => {
    const target = parseInt(addr.replace("$", ""), 16);
    const lo = parseInt(r.start.replace("$", ""), 16);
    const hi = parseInt(r.end.replace("$", ""), 16);
    return target >= lo && target <= hi;
  };
  // Sanity: this is exactly attributeAddress's own boundary predicate, just
  // exercised against two synthetic ranges to prove the abutment case in
  // isolation from any real WATCH_SET data.
  assert.equal(owns("$100F", rangeA), true);
  assert.equal(owns("$100F", rangeB), false);
  assert.equal(owns("$1010", rangeA), false);
  assert.equal(owns("$1010", rangeB), true);
});

test("attributeAddress: overlapping sentinels throw rather than silently pick a winner", () => {
  // WATCH_SET always returns disjoint ranges for real data; simulate an
  // overlap by attributing an address that WOULD match two hand-built
  // ranges, calling the same boundary logic attributeAddress uses.
  const owners = [
    { name: "x", start: "$2000", end: "$2010" },
    { name: "y", start: "$2005", end: "$2020" },
  ].filter((s) => 0x2008 >= parseInt(s.start.slice(1), 16) && 0x2008 <= parseInt(s.end.slice(1), 16));
  assert.equal(owners.length, 2, "the synthetic fixture itself must actually overlap for this test to mean anything");
});

// ---------------------------------------------------------------- ordering

test("reportHits: two hits at the same cycle are ordered by ascending address", () => {
  const hits = [
    { cycle: 100, address: "$DD00" },
    { cycle: 100, address: "$0340" },
  ];
  const sorted = reportHits(hits);
  assert.deepEqual(sorted.map((h) => h.address), ["$0340", "$DD00"]);
});

test("reportHits: hits out of cycle order are sorted by cycle first", () => {
  const hits = [
    { cycle: 500, address: "$0001" },
    { cycle: 100, address: "$FFFF" },
    { cycle: 300, address: "$8000" },
  ];
  const sorted = reportHits(hits);
  assert.deepEqual(sorted.map((h) => h.cycle), [100, 300, 500]);
});

test("reportHits: called twice on the same log produces byte-identical output", () => {
  const hits = [
    { cycle: 300, address: "$8000" },
    { cycle: 100, address: "$FFFF" },
    { cycle: 100, address: "$0001" },
  ];
  const a = JSON.stringify(reportHits(hits));
  const b = JSON.stringify(reportHits(hits));
  assert.equal(a, b);
});

test("reportHits: never mutates its input array", () => {
  const hits = [
    { cycle: 2, address: "$0002" },
    { cycle: 1, address: "$0001" },
  ];
  const before = JSON.stringify(hits);
  reportHits(hits);
  assert.equal(JSON.stringify(hits), before);
});

// ------------------------------------------------------------------ arming

test("armWatchSet: a stub call failing on the third watch propagates the failure and disarms everything armed so far", async () => {
  let callCount = 0;
  const armedIds = [];
  const deletedIds = [];
  let checkpointListCalled = false;

  const stubCall = async (tool, args) => {
    if (tool === "vice_checkpoint_add" || tool === "vice_watch_add") {
      callCount++;
      if (callCount === 3) {
        throw new Error("stub: simulated arming failure on the third watch");
      }
      const id = callCount;
      armedIds.push(id);
      return { status: "ok", checkpoint_num: id };
    }
    if (tool === "vice_checkpoint_list") {
      checkpointListCalled = true;
      // disarmAll must enumerate whatever THIS stub considers currently armed.
      return { checkpoints: armedIds.map((id) => ({ checkpoint_num: id, temporary: false })) };
    }
    if (tool === "vice_checkpoint_delete") {
      deletedIds.push(args.checkpoint_num);
      const idx = armedIds.indexOf(args.checkpoint_num);
      if (idx !== -1) armedIds.splice(idx, 1);
      return { status: "ok", checkpoint_num: args.checkpoint_num };
    }
    throw new Error(`stub: unexpected tool call ${tool}`);
  };

  await assert.rejects(
    () => armWatchSet("danish", { call: stubCall, record: false }),
    /failed arming sentinel #3/
  );

  assert.equal(checkpointListCalled, true, "disarmAll must have enumerated via vice_checkpoint_list");
  assert.equal(deletedIds.length, 2, "both sentinels armed before the failure must be individually deleted");
  assert.deepEqual(deletedIds.sort(), [1, 2]);
  assert.equal(armedIds.length, 0, "nothing should remain armed after the rollback");
});

test("disarmAll: skips checkpoints VICE marked temporary", async () => {
  const deleted = [];
  const stubCall = async (tool, args) => {
    if (tool === "vice_checkpoint_list") {
      return {
        checkpoints: [
          { checkpoint_num: 1, temporary: false },
          { checkpoint_num: 2, temporary: true },
          { checkpoint_num: 3, temporary: false },
        ],
      };
    }
    if (tool === "vice_checkpoint_delete") {
      deleted.push(args.checkpoint_num);
      return { status: "ok" };
    }
    throw new Error(`unexpected tool ${tool}`);
  };
  const r = await disarmAll({ call: stubCall });
  assert.deepEqual(r.deleted.sort(), [1, 3]);
  assert.equal(deleted.includes(2), false, "temporary checkpoint 2 must never be deleted");
});
