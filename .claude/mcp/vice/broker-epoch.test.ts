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
// Plan 03 extends this file with the writer's own round-trip tests. Nothing
// here imports `broker-epoch.mts` -- it does not exist yet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
