// node:test coverage of incident-record.mjs (plan 01.3-01 task 2) --
// exercised entirely in-process, with NO proxy and NO broker involved:
// this module makes no network call and no host-side round trip, so its
// own test suite doesn't need either. Every test redirects incidentsDir()
// to a disposable temp directory via VICE_INCIDENTS_DIR (this module's own
// override, mirroring vice-broker-client.mjs's VICE_POOL_DIR) so nothing
// here ever touches the real, permanent .planning/incidents/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  INCIDENT_RECORD_VERSION,
  incidentsDir,
  incidentRecordPath,
  renderIncidentRecord,
  writeIncidentRecord,
  finaliseIncidentRecord,
} from "./incident-record.mjs";

function withTempIncidentsDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "vice-incidents-test-"));
  const prev = process.env.VICE_INCIDENTS_DIR;
  process.env.VICE_INCIDENTS_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (prev === undefined) delete process.env.VICE_INCIDENTS_DIR;
    else process.env.VICE_INCIDENTS_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("incidentsDir() respects VICE_INCIDENTS_DIR", () => {
  withTempIncidentsDir((dir) => {
    assert.equal(incidentsDir(), dir);
  });
});

test("incidentRecordPath() builds <UTC-compact>-port<N>-epoch<M>.md from only the timestamp/port/epoch inputs", () => {
  withTempIncidentsDir((dir) => {
    const p = incidentRecordPath({ at: "2026-08-02T14:30:00.123Z", port: 6510, epoch: 7 });
    assert.equal(p, join(dir, "20260802143000123-port6510-epoch7.md"));
  });
});

test("incidentRecordPath() coerces a non-integer port or epoch to the literal 'unknown' rather than passing it through", () => {
  withTempIncidentsDir(() => {
    const p1 = incidentRecordPath({ at: "2026-08-02T14:30:00.000Z", port: "not-a-port", epoch: 7 });
    assert.match(p1, /-portunknown-epoch7\.md$/);
    const p2 = incidentRecordPath({ at: "2026-08-02T14:30:00.000Z", port: 6510, epoch: null });
    assert.match(p2, /-port6510-epochunknown\.md$/);
    const p3 = incidentRecordPath({ at: "2026-08-02T14:30:00.000Z", port: 3.5, epoch: 7 });
    assert.match(p3, /-portunknown-epoch7\.md$/, "a non-integer NUMBER must also coerce to unknown, not truncate");
  });
});

test("a caller reason containing path separators, a parent-directory sequence and a newline cannot influence the filename", () => {
  withTempIncidentsDir((dir) => {
    const maliciousReason = "../../etc/passwd\n/absolute/path\n${injection}";
    const path = writeIncidentRecord({ port: 6510, epoch_before: 3, reason: maliciousReason });
    // The path must still land INSIDE the incidents dir, with a filename
    // matching the timestamp-port-epoch shape only -- no separator, no
    // ".." segment, no newline from the reason ever reached it.
    assert.ok(path.startsWith(dir + "/"), "the written path must stay inside the incidents directory");
    const basename = path.slice(dir.length + 1);
    assert.match(basename, /^[0-9]+-port6510-epoch3(-\d+)?\.md$/);
    assert.doesNotMatch(basename, /etc|passwd|absolute|injection/);
    // The reason DOES appear verbatim in the BODY -- the mitigation is the
    // filename, not the body.
    const content = readFileSync(path, "utf8");
    assert.ok(content.includes(maliciousReason), "the reason must still appear verbatim in the body");
  });
});

test("a record renders with parseable YAML frontmatter carrying every field, and the caller's reason appears verbatim in the body", () => {
  withTempIncidentsDir(() => {
    const rendered = renderIncidentRecord({
      version: INCIDENT_RECORD_VERSION,
      at: "2026-08-02T14:30:00.000Z",
      port: 6510,
      epoch_before: 5,
      epoch_after: 6,
      outcome: "ok",
      kill_stage: "sigterm",
      session_id: "sess-123",
      reason: "manual test recycle",
    });
    assert.match(rendered, /^---\n/);
    const fmEnd = rendered.indexOf("\n---", 4);
    assert.ok(fmEnd > 0, "frontmatter must close with its own --- delimiter");
    const frontmatter = rendered.slice(0, fmEnd);
    assert.match(frontmatter, /version: 1/);
    assert.match(frontmatter, /port: 6510/);
    assert.match(frontmatter, /epoch_before: 5/);
    assert.match(frontmatter, /epoch_after: 6/);
    assert.match(frontmatter, /outcome: 'ok'/);
    assert.match(frontmatter, /kill_stage: 'sigterm'/);
    assert.match(frontmatter, /session_id: 'sess-123'/);
    assert.match(rendered, /## Why this record exists/);
    assert.match(rendered, /manual test recycle/);
    assert.match(rendered, /## Pre-kill evidence/);
    assert.match(rendered, /## Outcome/);
  });
});

test("writing twice with an identical timestamp, port and epoch produces two distinct files and the first is byte-unchanged", () => {
  withTempIncidentsDir(() => {
    const at = "2026-08-02T14:30:00.000Z";
    const path1 = writeIncidentRecord({ at, port: 6510, epoch_before: 7, reason: "first" });
    const path2 = writeIncidentRecord({ at, port: 6510, epoch_before: 7, reason: "second" });
    assert.notEqual(path1, path2, "a second write at the identical timestamp/port/epoch must land at a distinct path");
    assert.match(path2, /-2\.md$/);
    const content1 = readFileSync(path1, "utf8");
    assert.match(content1, /first/, "the first file must be byte-unchanged -- still naming its own original reason");
    assert.doesNotMatch(content1, /second/);
    const content2 = readFileSync(path2, "utf8");
    assert.match(content2, /second/);
  });
});

test("no temporary file is left behind in the incidents directory after a write", () => {
  withTempIncidentsDir((dir) => {
    writeIncidentRecord({ port: 6510, epoch_before: 1, reason: "no leftovers" });
    const entries = readdirSync(dir);
    assert.ok(entries.length > 0, "sanity: the write must have produced at least one file");
    for (const entry of entries) {
      assert.ok(!entry.startsWith(".tmp-"), `a temporary file was left behind: ${entry}`);
    }
  });
});

test("finaliseIncidentRecord() updates the outcome fields and leaves the frontmatter parseable", () => {
  withTempIncidentsDir(() => {
    const path = writeIncidentRecord({ port: 6510, epoch_before: 5, reason: "will be finalised" });
    const before = readFileSync(path, "utf8");
    assert.match(before, /outcome: 'pending'/);

    finaliseIncidentRecord(path, { outcome: "ok", kill_stage: "sigkill", epoch_after: 6 });

    const after = readFileSync(path, "utf8");
    assert.match(after, /outcome: 'ok'/);
    assert.match(after, /kill_stage: 'sigkill'/);
    assert.match(after, /epoch_after: 6/);
    // The original reason must survive the re-render untouched.
    assert.match(after, /will be finalised/);
    // Still parseable frontmatter: exactly one opening and one closing ---
    // delimiter pair at the top of the file.
    assert.match(after, /^---\n[\s\S]*?\n---\n/);
  });
});

test("finaliseIncidentRecord() on a record with no prior outcome fields still produces a well-formed, parseable file", () => {
  withTempIncidentsDir(() => {
    const path = writeIncidentRecord({ port: 6511, epoch_before: 1, reason: "timeout case" });
    finaliseIncidentRecord(path, { outcome: "timeout" });
    const content = readFileSync(path, "utf8");
    assert.match(content, /outcome: 'timeout'/);
    assert.match(content, /kill_stage: null/, "a field never supplied to finalise must remain null, not vanish");
  });
});
