#!/usr/bin/env node
// Deploys this skill's resources/ (the host-side shell launchers) into
// <repo>/tools/ the first time any skill .mjs entry point runs, so a copy of
// this skill directory alone is sufficient -- nobody has to remember to also
// copy three shell scripts from somewhere else (D-1, quick-260730-q4b).
//
// HOSTING CHOICE (D-3): this check lives in a DEDICATED module, triggered
// from repo-root.mjs, for two reasons. First, repo-root.mjs is a pure path
// resolver, and inlining filesystem-writing side effects into it would make
// every importer of a path function also a file writer. Second and decisive:
// this module needs the repo root, and repo-root.mjs is where the repo root
// is computed -- hosting this logic INSIDE repo-root.mjs and importing it
// back from there would be a module cycle. In that cycle, this module would
// evaluate while repo-root.mjs's `const HERE` is still in its temporal dead
// zone, and every entry point would die with
// "Cannot access 'HERE' before initialization".
//
// THE CYCLE IS AVOIDED STRUCTURALLY: this module takes the repo root as an
// ARGUMENT and imports NOTHING from repo-root.mjs. Do not "clean this up" by
// adding `import { repoRoot } from "./repo-root.mjs"` here -- that importable
// convenience is exactly the cycle described above.
import { existsSync, mkdirSync, readdirSync, readFileSync, copyFileSync, statSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { hostPath, SET_ENV_HINT } from "../../skills/devcontainer-host-path/scripts/hostpath.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** This module directory's resources/ subdirectory -- a plain SIBLING of this
 * module (scripts/ was flattened away in the .claude/mcp/vice/ move), the
 * tracked source of truth every deployed tools/ file is copied from. Getting
 * this hop wrong is silent and total: readdirSync() throws inside
 * resourceEntries(), but ensureResourcesInstalled() catches everything by
 * contract (D-3 above), so every command keeps reporting success while
 * nothing is ever deployed. */
export const RESOURCES_DIR = join(HERE, "resources");

/** Where resources/ gets deployed to, for a given repo root. Always
 * `<root>/tools` -- the host's existing muscle-memory location. */
export function installTargetDir(root) {
  return join(root, "tools");
}

/** Recursive walk of RESOURCES_DIR, returning the relative path (posix-style,
 * "/"-joined) of every regular file underneath it -- a WALK, not a hardcoded
 * list, so a file added under resources/lib/ later deploys with no code
 * change here. */
function walk(dir, base = "") {
  const out = [];
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${dirent.name}` : dirent.name;
    const abs = join(dir, dirent.name);
    if (dirent.isDirectory()) {
      out.push(...walk(abs, rel));
    } else if (dirent.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

export function resourceEntries() {
  return walk(RESOURCES_DIR);
}

/** missing | present (byte-identical to the resource) | diverged (exists,
 * differs). An unreadable target is treated as "diverged" -- conservative on
 * purpose, so a permissions oddity never gets silently reported as
 * "present" and skipped. */
function statusForEntry(entry, root) {
  const src = join(RESOURCES_DIR, entry);
  const target = join(installTargetDir(root), entry);
  if (!existsSync(target)) return "missing";
  try {
    return readFileSync(src).equals(readFileSync(target)) ? "present" : "diverged";
  } catch {
    return "diverged";
  }
}

/** Per-entry status against a given repo root, without writing anything. */
export function resourcesStatus({ root } = {}) {
  const out = {};
  for (const entry of resourceEntries()) {
    out[entry] = statusForEntry(entry, root);
  }
  return out;
}

/** The D-4 host-launch instructions, as prose covering: the host path to
 * run, that it cannot run inside the container and will refuse with exit 2,
 * --check-container as the diagnostic, and that Ctrl-C stops it cleanly.
 * hostPath() (devcontainer-host-path skill) translates the deployed
 * supervisor's container path into the HOST path a human should actually
 * type -- the same cross-skill shape tools/recover.mjs already uses -- and
 * degrades to the container path plus hostpath.mjs's own SET_ENV_HINT when
 * translation fails (e.g. no /proc/self/mountinfo, or an unmapped mount). */
export function hostLaunchInstructions(root) {
  const target = join(installTargetDir(root), "vice-supervisor.sh");
  let displayPath;
  try {
    displayPath = hostPath(target);
  } catch {
    displayPath = `${target}\n  (host path could not be determined -- ${SET_ENV_HINT})`;
  }
  const brokerTarget = join(installTargetDir(root), "vice-broker.sh");
  let brokerDisplayPath;
  try {
    brokerDisplayPath = hostPath(brokerTarget);
  } catch {
    brokerDisplayPath = `${brokerTarget}\n  (host path could not be determined -- ${SET_ENV_HINT})`;
  }
  return [
    `vice-mcp-selector: deployed host launcher scripts to ${installTargetDir(root)}`,
    "vice-mcp-selector: for MCP-mediated access (mcp__vice__* tools), start the broker from the HOST workspace, e.g.:",
    `  ${brokerDisplayPath} start [N]`,
    "vice-mcp-selector: the broker launches a boot-fresh instance per session on demand and keeps N warm spares.",
    "vice-mcp-selector: for the standalone (non-MCP) recovery pipeline, run the supervisor from the HOST workspace instead, e.g.:",
    `  ${displayPath}`,
    "vice-mcp-selector: neither can run inside the container -- the container guard refuses each with exit 2.",
    "vice-mcp-selector: if either refuses when it should not, run it with --check-container for the full per-signal diagnostic.",
    "vice-mcp-selector: press Ctrl-C to stop either -- SIGINT/SIGTERM are handled and each shuts down cleanly.",
  ].join("\n");
}

/**
 * Copies every `missing` entry, and `diverged`/`present` ones only when
 * `force` is true, creating parent directories as needed and setting each
 * target's permission bits from its source (D-5: present means leave alone;
 * forcing is the only overwrite path).
 *
 * Every copy is individually wrapped in its own try/catch: a failure is
 * pushed to `failed` and warned through `log`, never thrown (D-3) -- a
 * read-only filesystem must never turn a working `ping` into an error.
 *
 * Returns { installed, skipped, diverged, failed }, arrays of the resource's
 * relative path.
 */
export function installResources({ root, force = false, log = console.error } = {}) {
  const installed = [];
  const skipped = [];
  const diverged = [];
  const failed = [];

  for (const entry of resourceEntries()) {
    const src = join(RESOURCES_DIR, entry);
    const target = join(installTargetDir(root), entry);
    const status = statusForEntry(entry, root);

    if (!force && status === "present") {
      skipped.push(entry);
      continue;
    }
    if (!force && status === "diverged") {
      diverged.push(entry);
      continue;
    }

    // Reached for status === "missing" (always copied, force or not), or for
    // "present"/"diverged" when force === true (the only overwrite path).
    try {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(src, target);
      chmodSync(target, statSync(src).mode & 0o777);
      installed.push(entry);
    } catch (e) {
      failed.push(entry);
      log(
        `warn: install-resources: failed to deploy ${entry} to ${target} -- ${e.message}. ` +
          "Continuing; a failed deployment must never break the caller."
      );
    }
  }

  // The default `log` is console.error, and NOTHING in this module writes to
  // stdout (D-4): `tools --json` and `pool status` emit machine-readable
  // output on stdout, and a stray banner there would corrupt it. This is the
  // one place that condition matters -- only print when something actually
  // changed.
  if (installed.length > 0) {
    log(hostLaunchInstructions(root));
  }

  return { installed, skipped, diverged, failed };
}

// Fire-once latch: set BEFORE any work is attempted, so a throw partway
// through installResources() can never cause a second attempt in the same
// process. ES-module caching already makes this redundant for the import
// path (a module body runs once per process no matter how many times it is
// imported) -- this latch is what also makes a direct, repeated call to
// ensureResourcesInstalled() itself a no-op, which module caching alone does
// not guarantee.
let _resourcesInstallAttempted = false;

/**
 * The fire-once entry point, wired from the bottom of repo-root.mjs's module
 * body. Never throws (D-3): the whole body runs inside a try/catch that
 * degrades to a stderr warning. Does nothing at all when
 * VICE_SKIP_RESOURCE_INSTALL=1 (D-7's env opt-out), and does nothing on any
 * call after the first in this process.
 */
export function ensureResourcesInstalled({ root } = {}) {
  if (_resourcesInstallAttempted) return;
  _resourcesInstallAttempted = true;
  if (process.env.VICE_SKIP_RESOURCE_INSTALL === "1") return;
  try {
    installResources({ root });
  } catch (e) {
    console.error(`warn: install-resources: ensureResourcesInstalled failed -- ${e.message}`);
  }
}
