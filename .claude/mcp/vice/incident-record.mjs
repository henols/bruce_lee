#!/usr/bin/env node
// Records a vice_recycle incident to disk BEFORE anything is killed (D-17,
// plan 01.3-01). This is the FIRST repo-tracked file any mcp__vice__* tool
// has ever written -- see .planning/incidents/README.md for why the path is
// committed rather than living under the gitignored .vice-supervisor/ tree
// every other module in this directory reads/writes through.
//
// This module makes NO network call of any kind, and never will -- the
// file-writing remit this phase adds expands, the transport remit does not
// (T-01.3-SC's package-legitimacy gate has nothing in scope here either: no
// import beyond node:fs/node:crypto/node:path and this directory's own
// repo-root.mjs).
//
// Filename safety (T-01.3-07): incidentRecordPath() below builds the
// filename ONLY from a UTC timestamp, an integer port and an integer epoch.
// No caller-supplied string -- specifically, never the caller's own
// "reason" -- ever reaches a path. A non-integer port or epoch is coerced
// to the literal "unknown" rather than passed through, so a malformed
// caller value degrades the filename's specificity, never its safety.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

import { repoRoot } from "./repo-root.mjs";

export const INCIDENT_RECORD_VERSION = 1;

/** `<repoRoot>/.planning/incidents` -- repo-tracked, never gitignored.
 * `VICE_INCIDENTS_DIR` overrides the resolved location when set, mirroring
 * vice-broker-client.mjs's own `VICE_POOL_DIR` override -- the seam this
 * module's own test suite uses to write against a disposable temp
 * directory instead of the real, permanent `.planning/incidents/` every
 * production caller resolves to. */
export function incidentsDir() {
  if (process.env.VICE_INCIDENTS_DIR) return resolve(process.env.VICE_INCIDENTS_DIR);
  return join(repoRoot(), ".planning", "incidents");
}

function sanitiseUtcTimestamp(at) {
  const d = at instanceof Date ? at : new Date(at);
  const base = Number.isNaN(d.getTime()) ? new Date() : d;
  // Strip every non-digit from the ISO string ("2026-08-02T14:30:00.123Z" ->
  // "20260802143000123") -- a UTC-compact timestamp with no punctuation a
  // filesystem could ever object to.
  return base.toISOString().replace(/[^0-9]/g, "");
}

function sanitiseInt(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : "unknown";
}

/** Builds `<UTC compact timestamp>-port<port>-epoch<epoch>.md` -- the ONLY
 * three inputs that ever reach the filename, each coerced independently and
 * with no caller-supplied string (the "reason" field) ever consulted. */
export function incidentRecordPath({ at = new Date(), port, epoch } = {}) {
  const ts = sanitiseUtcTimestamp(at);
  const p = sanitiseInt(port);
  const e = sanitiseInt(epoch);
  return join(incidentsDir(), `${ts}-port${p}-epoch${e}.md`);
}

function yamlScalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // A conservative single-quoted YAML scalar: doubling an embedded single
  // quote is the one escape single-quoted style needs, and it never
  // interprets backslashes or newlines specially -- nothing in a caller's
  // reason string can break out of the frontmatter block this way.
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Renders the incident record as markdown: a parseable YAML frontmatter
 * block carrying every field the recycle protocol produces, then a prose
 * body with the caller's own reason quoted verbatim (T-01.3-07's mitigation
 * is the FILENAME, not the body -- the body is free to carry anything). */
export function renderIncidentRecord(record = {}) {
  const {
    version = INCIDENT_RECORD_VERSION,
    at = new Date().toISOString(),
    port = null,
    epoch_before = null,
    epoch_after = null,
    outcome = "pending",
    kill_stage = null,
    session_id = null,
    reason = "",
  } = record;

  const frontmatter = [
    "---",
    `version: ${yamlScalar(version)}`,
    `at: ${yamlScalar(at)}`,
    `port: ${yamlScalar(port)}`,
    `epoch_before: ${yamlScalar(epoch_before)}`,
    `epoch_after: ${yamlScalar(epoch_after)}`,
    `outcome: ${yamlScalar(outcome)}`,
    `kill_stage: ${yamlScalar(kill_stage)}`,
    `session_id: ${yamlScalar(session_id)}`,
    "---",
  ].join("\n");

  const reasonText = reason && String(reason).trim().length > 0 ? String(reason) : "(no reason recorded)";

  const body = [
    "",
    "## Why this record exists",
    "",
    reasonText,
    "",
    "## Pre-kill evidence",
    "",
    `- port: ${port === null || port === undefined ? "unknown" : port}`,
    `- epoch before recycle: ${epoch_before === null || epoch_before === undefined ? "unknown" : epoch_before}`,
    "",
    "## Outcome",
    "",
    `- outcome: ${outcome}`,
    `- kill stage: ${kill_stage === null || kill_stage === undefined ? "(not yet known)" : kill_stage}`,
    `- epoch after recycle: ${epoch_after === null || epoch_after === undefined ? "(not yet known)" : epoch_after}`,
    "",
  ].join("\n");

  return `${frontmatter}\n${body}`;
}

// Single tmp-in-the-same-directory then rename choke point -- the same
// atomicity shape write_json_atomic() (resources/vice-broker.sh) and
// writeJsonAtomic() (vice-broker-client.mjs) already use, so a crash
// between write and rename leaves at most one stray, uniquely-named temp
// file, never a half-written record observed mid-write.
function writeAtomic(path, content) {
  mkdirSync(incidentsDir(), { recursive: true });
  const tmp = join(incidentsDir(), `.tmp-${process.pid}-${randomUUID()}`);
  writeFileSync(tmp, content);
  renameSync(tmp, path);
  return path;
}

/** Writes a NEW incident record, never clobbering an existing file at the
 * same computed path: a second recycle in the same second, on the same
 * port and epoch, appends "-2", "-3", ... rather than overwriting the
 * first record. Returns the absolute path actually written. */
export function writeIncidentRecord(record = {}) {
  mkdirSync(incidentsDir(), { recursive: true });
  const at = record.at || new Date().toISOString();
  const basePath = incidentRecordPath({ at, port: record.port, epoch: record.epoch_before });
  let path = basePath;
  let suffix = 2;
  while (existsSync(path)) {
    path = basePath.replace(/\.md$/, `-${suffix}.md`);
    suffix += 1;
  }
  const content = renderIncidentRecord({ ...record, at });
  writeAtomic(path, content);
  return path;
}

// A DELIBERATELY minimal frontmatter reader -- this module never depends on
// a YAML parser; it only needs to read back the handful of scalar fields it
// itself wrote, in the exact single-quoted shape yamlScalar() emits above.
function parseFrontmatterLoose(text) {
  const out = { reason: "" };
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    for (const line of fmMatch[1].split("\n")) {
      const m = line.match(/^([a-z_]+):\s*(.*)$/);
      if (!m) continue;
      const [, key, rawValue] = m;
      let value = rawValue;
      if (value === "null") value = null;
      else if (/^-?\d+$/.test(value)) value = Number(value);
      else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1).replace(/''/g, "'");
      out[key] = value;
    }
  }
  const reasonMatch = text.match(/## Why this record exists\n\n([\s\S]*?)\n\n## Pre-kill evidence/);
  if (reasonMatch) out.reason = reasonMatch[1] === "(no reason recorded)" ? "" : reasonMatch[1];
  return out;
}

/** Re-renders an already-written record with its outcome fields filled in,
 * through the same atomic write shape -- the record is never left saying
 * an outcome is still pending once a caller knows better. */
export function finaliseIncidentRecord(path, { outcome, kill_stage, epoch_after } = {}) {
  let existing = "";
  try {
    existing = readFileSync(path, "utf8");
  } catch {
    existing = "";
  }
  const parsed = parseFrontmatterLoose(existing);
  const merged = {
    ...parsed,
    outcome: outcome !== undefined ? outcome : parsed.outcome,
    kill_stage: kill_stage !== undefined ? kill_stage : parsed.kill_stage,
    epoch_after: epoch_after !== undefined ? epoch_after : parsed.epoch_after,
  };
  const content = renderIncidentRecord(merged);
  writeAtomic(path, content);
  return path;
}
