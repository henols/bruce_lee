// GENERATED FILE -- DO NOT EDIT.
// Compiled by `tsc` from broker-epoch.mts. Edit the TypeScript source and rebuild;
// changes made directly to this file are silently overwritten by the next build, and are never
// deployed to the host on their own -- install-resources.mjs copies THIS file's on-disk contents
// verbatim to tools/, so an edit made only here reaches the host but is lost on the very next
// rebuild.
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
/** Writes supervisorDir/epoch.json. Per RESEARCH assumption A4,
 * supervisor_pid has no consumer that reads it for behaviour -- the field
 * is kept and pointed at THIS broker's own pid, so a human reading the file
 * by hand still finds a supervising process to look up, even though this
 * broker spawns the emulator directly and there is no separate per-instance
 * supervisor process any more. */
export function writeEpochRecord({ supervisorDir, record }) {
    mkdirSync(supervisorDir, { recursive: true });
    const finalPath = join(supervisorDir, "epoch.json");
    const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmpPath, "");
    chmodSync(tmpPath, 0o600);
    writeFileSync(tmpPath, JSON.stringify(record, null, 2) + "\n");
    renameSync(tmpPath, finalPath);
    return finalPath;
}
