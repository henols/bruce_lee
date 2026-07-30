// node:test coverage of tools/recover.mjs's byte-assembly contract. Drives
// captureImage with a stub `call` so every behaviour below is proven without
// touching the emulator -- a deliberate, recorded deviation from
// 01-VALIDATION.md's "no test framework" line: node:test ships with Node and
// costs nothing to adopt, and this is the one place in Phase 1 where a silent
// bug corrupts every downstream provenance verdict rather than producing a
// visible failure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { assembleChunks, captureImage } from "./recover.mjs";

function syntheticChunks(chunkSize) {
  const chunks = [];
  for (let addr = 0; addr < 65536; addr += chunkSize) {
    const size = Math.min(chunkSize, 65536 - addr);
    const data = Buffer.alloc(size);
    for (let i = 0; i < size; i++) data[i] = (addr + i) & 0xff;
    chunks.push({ start: addr, data });
  }
  return chunks;
}

test("assembleChunks: ascending and descending chunk order produce equal SHA-256", () => {
  const chunks = syntheticChunks(4096);
  const ascending = assembleChunks(chunks);
  const descending = assembleChunks([...chunks].reverse());
  const hashOf = (buf) => createHash("sha256").update(buf).digest("hex");
  assert.equal(hashOf(ascending), hashOf(descending));
  assert.equal(ascending.length, 65536);
});

test("assembleChunks: throws when a chunk is shorter than its requested/claimed size, no image returned", () => {
  // A chunk claiming to cover [0, 100) but only supplying 50 bytes should
  // still fail the "every address 0x0000-0xFFFF covered" check, since the
  // remaining 50 bytes of its claimed span are never actually written.
  assert.throws(() => {
    assembleChunks([{ start: 0, data: Buffer.alloc(50) }, { start: 100, data: Buffer.alloc(65436) }]);
  });
});

test("assembleChunks: throws when two chunks overlap", () => {
  const a = { start: 0, data: Buffer.alloc(10) };
  const b = { start: 5, data: Buffer.alloc(10) };
  assert.throws(() => assembleChunks([a, b]), /overlapping chunk/);
});

test("assembleChunks: throws when the union of chunks leaves an address uncovered", () => {
  assert.throws(
    () => assembleChunks([{ start: 0, data: Buffer.alloc(100) }]),
    /is not covered by any chunk/
  );
});

test("assembleChunks: a 16-byte window straddling a chunk boundary equals the tail+head concatenation", () => {
  const chunks = syntheticChunks(4096);
  const image = assembleChunks(chunks);
  const boundary = 4096;
  const window = image.subarray(boundary - 8, boundary + 8);
  const lowerTail = chunks[0].data.subarray(chunks[0].data.length - 8);
  const upperHead = chunks[1].data.subarray(0, 8);
  assert.deepEqual(window, Buffer.concat([lowerTail, upperHead]));
});

test("captureImage: propagates a stub call's failure on the third chunk and returns no buffer", async () => {
  let calls = 0;
  const stubCall = async (toolName, args) => {
    calls++;
    assert.equal(toolName, "vice_memory_read");
    assert.equal(args.bank, "ram");
    if (calls === 3) throw new Error("stub: simulated transport failure on chunk 3");
    const size = args.size;
    return { data_hex: Buffer.alloc(size).toString("hex") };
  };
  await assert.rejects(
    captureImage({ call: stubCall, ranges: [{ start: 0, end: 0xffff }], chunkSize: 4096 }),
    /simulated transport failure/
  );
});

test("captureImage: throws when a chunk's decoded byte length is short of its requested size", async () => {
  const stubCall = async (_toolName, args) => {
    // Always return one byte fewer than requested.
    return { data_hex: Buffer.alloc(args.size - 1).toString("hex") };
  };
  await assert.rejects(
    captureImage({ call: stubCall, ranges: [{ start: 0, end: 0xffff }], chunkSize: 4096 }),
    /requested 4096 bytes, got 4095/
  );
});
