// broker-epoch.test.ts
//
// Task 1 (this file, this commit): frozen-contract assertions against the
// three fixtures captured live from the running bash broker in
// `fixtures/README.md`, BEFORE `vice-supervisor.sh`'s `write_epoch()` and
// `vice-broker.sh`'s `write_broker_json()` are deleted. These assertions
// pin down the "before" shape of both records so a later plan's TypeScript
// writer (`broker-epoch.mts`, plan 03) can be held to it with something
// concrete to diff against.
//
// Task 3 (this file, this plan) extends this with the writer's own
// fixture-diff test now that `broker-epoch.mts` exists: build a record from
// the 6510 fixture's own values, write it through the real writer, and
// assert the emitted key set and each value's type match the fixture
// exactly. Plan 03 owns any further extension of this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { writeEpochRecord, type EpochRecord } from "./broker-epoch.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, "fixtures");

/** The exact eight fields the bash writer's `write_epoch()` emits
 * (`vice-supervisor.sh` lines 289-306), in the order it prints them. */
const EPOCH_FIELDS = [
  "epoch",
  "spawned_at",
  "pid",
  "supervisor_pid",
  "vice_bin",
  "vice_args",
  "log",
  "dry_run",
] as const;

interface EpochFixtureCase {
  file: string;
  port: string;
}

const EPOCH_FIXTURES: EpochFixtureCase[] = [
  { file: "bash-epoch-6510.json", port: "6510" },
  { file: "bash-epoch-6514.json", port: "6514" },
];

function readFixtureJson(name: string): unknown {
  const raw = readFileSync(join(FIXTURES_DIR, name), "utf8");
  return JSON.parse(raw);
}

for (const { file, port } of EPOCH_FIXTURES) {
  test(`frozen epoch fixture ${file}: exact eight-field key set`, () => {
    const parsed = readFixtureJson(file) as Record<string, unknown>;
    const keys = Object.keys(parsed).sort();
    assert.deepEqual(keys, [...EPOCH_FIELDS].sort());
  });

  test(`frozen epoch fixture ${file}: field types and values`, () => {
    const parsed = readFixtureJson(file) as Record<string, unknown>;

    assert.ok(Number.isInteger(parsed.epoch), "epoch must decode to a finite integer");

    assert.equal(typeof parsed.spawned_at, "string");
    assert.ok(
      Number.isFinite(Date.parse(parsed.spawned_at as string)),
      "spawned_at must parse as a date",
    );

    assert.ok(
      Number.isInteger(parsed.pid) && (parsed.pid as number) > 0,
      "pid must be a positive integer",
    );

    assert.ok(Array.isArray(parsed.vice_args), "vice_args must be an array");
    const viceArgs = parsed.vice_args as unknown[];
    assert.ok(
      viceArgs.every((v) => typeof v === "string"),
      "every vice_args element must be a string",
    );
    assert.equal(
      viceArgs[viceArgs.length - 1],
      port,
      "vice_args's last element must be the instance's own port as a string",
    );

    assert.equal(typeof parsed.log, "string");
    assert.ok(
      (parsed.log as string).startsWith("logs/"),
      "log must be a relative path beginning with the per-instance log directory name",
    );
    assert.ok(!(parsed.log as string).startsWith("/"), "log must be a relative path, not absolute");
  });
}

test("frozen broker fixture bash-broker.json: carries the fields readBrokerLiveness() reads, plus its writer field", () => {
  const parsed = readFixtureJson("bash-broker.json") as Record<string, unknown>;
  const keys = new Set(Object.keys(parsed));

  // readBrokerLiveness() (vice-broker-client.ts) reads `pid` and
  // `heartbeat_at` to classify never_started / stale / alive.
  assert.ok(keys.has("pid"), "must carry pid");
  assert.ok(keys.has("heartbeat_at"), "must carry heartbeat_at");

  // The field naming the record's writer.
  assert.ok(keys.has("written_by"), "must carry written_by");
});

test("frozen broker fixture bash-broker.json: written_by is the retiring bash daemon's filename (D-26 'before' half)", () => {
  const parsed = readFixtureJson("bash-broker.json") as Record<string, unknown>;

  // This is the pre-change record: the bash daemon's own filename, which is
  // false the moment the new broker exists (D-26). This assertion is
  // EXPECTED TO CHANGE in task 3, once the new writer names itself instead.
  assert.equal(parsed.written_by, "vice-broker.sh");
});

test("broker-epoch.mts's writeEpochRecord() round-trips a record built from the 6510 fixture's own values, matching key set and value types exactly", () => {
  const fixture = readFixtureJson("bash-epoch-6510.json") as Record<string, unknown>;
  const dir = mkdtempSync(join(tmpdir(), "broker-epoch-fixture-diff-"));
  try {
    const record: EpochRecord = {
      epoch: fixture.epoch as number,
      spawned_at: fixture.spawned_at as string,
      pid: fixture.pid as number,
      supervisor_pid: fixture.supervisor_pid as number,
      vice_bin: fixture.vice_bin as string,
      vice_args: fixture.vice_args as string[],
      log: fixture.log as string,
      dry_run: fixture.dry_run as boolean,
    };

    const path = writeEpochRecord({ supervisorDir: dir, record });
    const written = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

    assert.deepEqual(Object.keys(written).sort(), [...EPOCH_FIELDS].sort());
    for (const field of EPOCH_FIELDS) {
      assert.equal(
        typeof written[field],
        typeof (fixture as Record<string, unknown>)[field],
        `field ${field}: type must match the fixture's own type`,
      );
    }
    assert.deepEqual(written.vice_args, fixture.vice_args);
    assert.equal(written.epoch, fixture.epoch);
    assert.equal(written.pid, fixture.pid);
    assert.equal(written.supervisor_pid, fixture.supervisor_pid);
    assert.equal(written.vice_bin, fixture.vice_bin);
    assert.equal(written.log, fixture.log);
    assert.equal(written.dry_run, fixture.dry_run);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
