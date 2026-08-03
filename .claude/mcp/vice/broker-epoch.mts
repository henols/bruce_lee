// broker-epoch.mts
//
// B / D-04: the per-instance epoch.json writer, held to the frozen
// eight-field contract captured in fixtures/ (task 1, before the bash
// writer that produced them is deleted later in this phase). Ports
// write_epoch()'s exact field shape and its atomic tmp-sibling-then-rename
// discipline -- the tmp file is created empty, mode tightened to
// owner-read-write BEFORE any content reaches it, content written, then
// renamed -- matching writeBrokerRecord()'s own choke point in
// vice-broker.mts exactly.
import { writeFileSync, chmodSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** The exact eight fields the bash writer's write_epoch() emits, unchanged
 * in this port (D-04: "contract unchanged, writer moved"). */
export interface EpochRecord {
  epoch: number;
  spawned_at: string;
  pid: number;
  supervisor_pid: number;
  vice_bin: string;
  vice_args: string[];
  log: string;
  dry_run: boolean;
}

export interface WriteEpochOptions {
  supervisorDir: string;
  record: EpochRecord;
}

/** Writes supervisorDir/epoch.json. Per RESEARCH assumption A4,
 * supervisor_pid has no consumer that reads it for behaviour -- the field
 * is kept and pointed at THIS broker's own pid, so a human reading the file
 * by hand still finds a supervising process to look up, even though this
 * broker spawns the emulator directly and there is no separate per-instance
 * supervisor process any more. */
export function writeEpochRecord({ supervisorDir, record }: WriteEpochOptions): string {
  mkdirSync(supervisorDir, { recursive: true });
  const finalPath = join(supervisorDir, "epoch.json");
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, "");
  chmodSync(tmpPath, 0o600);
  writeFileSync(tmpPath, JSON.stringify(record, null, 2) + "\n");
  renameSync(tmpPath, finalPath);
  return finalPath;
}
