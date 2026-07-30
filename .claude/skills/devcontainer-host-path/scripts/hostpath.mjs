#!/usr/bin/env node
// Build a path that something OUTSIDE this devcontainer can use to reach a file
// INSIDE the workspace.
//
// The problem this solves is generic. Anything running on the host -- an MCP
// server, a GUI app, a viewer, a debugger, a browser -- resolves paths on the
// host filesystem, so a container path like /workspaces/foo/bar.d64 means
// nothing to it and the call fails on a file it cannot find. The workspace is a
// bind mount, though: the same bytes exist on the host under a different prefix,
// so the container path only needs its prefix translated.
//
// The prefix is never hardcoded -- always discovered at runtime, so this is
// portable across machines and users. Two mechanisms, best first:
//
//   1. HOST_WORKSPACE_PATH, exported from devcontainer.json as
//        "containerEnv": { "HOST_WORKSPACE_PATH": "${localWorkspaceFolder}" }
//      Exact, no guessing, resolved per-machine by the devcontainer CLI. Needs a
//      container rebuild to take effect.
//
//   2. Fallback: /proc/self/mountinfo, which leaks the bind-mount source and so
//      works with no rebuild. Its 4th field is the path *within the source
//      device*:
//        <path-within-device> <container-mountpoint> rw,... - ext4 /dev/<device>
//      That is not yet a host path -- the device is itself mounted somewhere on
//      the host, which mountinfo cannot reveal. So we emit one candidate per
//      plausible device mountpoint and let the consumer adjudicate: a wrong path
//      fails fast and unambiguously. Heuristic by nature, hence the nudge
//      towards mechanism 1.
//
// Node >= 18. No dependencies, no network, nothing machine-specific: copy this
// file into any devcontainer-based project's
// .claude/skills/devcontainer-host-path/scripts/ and it works.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative, isAbsolute } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
// <workspace>/.claude/skills/devcontainer-host-path/scripts/hostpath.mjs -> <workspace>
const WORKSPACE_ROOT = resolve(HERE, "..", "..", "..", "..");
const CONTAINER_WS = process.env.CONTAINER_WORKSPACE_PATH || WORKSPACE_ROOT;

// Where a bind-mount source device is *itself* mounted on the host. Ordered by
// how often each turns out to be right; "" covers a source path that is already
// absolute on the host.
const DEVICE_MOUNT_GUESSES = ["/home", "", "/Users", "/mnt", "/media", "/host"];

// Filesystems that exist only inside the container: a path on one of these has
// no host-side counterpart at all, so translation is impossible rather than
// merely unknown -- and saying so beats emitting six wrong candidates.
const CONTAINER_ONLY_FS = new Set([
  "overlay", "tmpfs", "proc", "sysfs", "devtmpfs", "devpts", "cgroup", "cgroup2",
  "mqueue", "squashfs", "ramfs",
]);

export const SET_ENV_HINT =
  'set the mapping explicitly in .devcontainer/devcontainer.json and rebuild:\n' +
  '    "containerEnv": { "HOST_WORKSPACE_PATH": "${localWorkspaceFolder}" }';

/**
 * The mount backing `containerPath`, per /proc/self/mountinfo: the longest
 * matching mountpoint, its path within the source device, and its fstype.
 */
export function mountFor(containerPath) {
  let info;
  try {
    info = readFileSync("/proc/self/mountinfo", "utf8");
  } catch {
    return null;
  }
  let best = null;
  for (const line of info.split("\n")) {
    // <id> <parent> <maj:min> <root> <mountpoint> <opts> ... - <fstype> <source> ...
    const [pre, post] = line.split(" - ");
    if (!post) continue;
    const f = pre.split(" ");
    if (f.length < 5) continue;
    const [, , , root, mountPoint] = f;
    const fstype = post.split(" ")[0];
    if (containerPath === mountPoint || containerPath.startsWith(mountPoint.replace(/\/?$/, "/"))) {
      if (!best || mountPoint.length > best.mountPoint.length) best = { root, mountPoint, fstype };
    }
  }
  return best;
}

/**
 * Candidate host paths for a container path, best first.
 *
 * Returns { abs, candidates, exact?, mount?, reason? }. `exact` means the single
 * candidate came from HOST_WORKSPACE_PATH and needs no adjudication; `reason`
 * explains an empty candidate list.
 *
 * Deliberately not tied to any repo, workspace layout or file type: translation
 * is driven by whichever bind mount happens to back the path, so any shared
 * location works.
 */
export function hostPathCandidates(containerPath) {
  const abs = isAbsolute(containerPath) ? containerPath : resolve(process.cwd(), containerPath);

  // 1. Explicit workspace mapping, when the path falls inside the workspace.
  const hostWs = process.env.HOST_WORKSPACE_PATH;
  if (hostWs) {
    const rel = relative(CONTAINER_WS, abs);
    if (!rel.startsWith("..")) {
      return { abs, candidates: [`${hostWs.replace(/\/$/, "")}/${rel}`], exact: true };
    }
    // Outside the workspace: fall through to the generic mount-based path rather
    // than refusing -- the file may still be shared by some other mount.
  }

  // 2. Generic: derive from whichever mount backs this specific path.
  const m = mountFor(abs);
  if (!m) return { abs, candidates: [], reason: "could not read /proc/self/mountinfo" };
  if (CONTAINER_ONLY_FS.has(m.fstype)) {
    return {
      abs,
      candidates: [],
      reason:
        `${abs} lives on a container-only filesystem (${m.fstype} at ${m.mountPoint}), ` +
        "so nothing outside the container can see it under any path. Move or copy it " +
        "into a directory that is bind-mounted from the host.",
    };
  }
  const tail = relative(m.mountPoint, abs);
  const rootForPath = tail ? `${m.root.replace(/\/$/, "")}/${tail}` : m.root;
  return {
    abs,
    candidates: [...new Set(DEVICE_MOUNT_GUESSES.map((p) => `${p}${rootForPath}`))],
    mount: m,
  };
}

/** The single best host path, or throw with the reason it cannot be built. */
export function hostPath(containerPath) {
  const { abs, candidates, reason } = hostPathCandidates(containerPath);
  if (!candidates.length) {
    throw new Error(`${reason || `cannot determine a host path for ${abs}`}\n  Or ${SET_ENV_HINT}`);
  }
  return candidates[0];
}

/** Printed once when a mapping is guessed, since a guess can silently misfire. */
export function guessNote() {
  return (
    "note: HOST_WORKSPACE_PATH is unset, so the host path is being guessed from\n" +
    "      /proc/self/mountinfo. For an exact, portable mapping, " +
    SET_ENV_HINT.replace(/\n/g, "\n  ") +
    "\n"
  );
}

/**
 * Run `fn(hostPath)` against each candidate until one succeeds, letting the
 * consumer -- which is the only thing that can actually resolve a host path --
 * adjudicate. Returns { result, hostPath }.
 *
 * `fatal(err)` marks an error as "not a wrong-path signal" (a connection
 * failure, say), so probing stops instead of retrying five more times.
 */
export async function tryHostPaths(containerPath, fn, { fatal } = {}) {
  const { abs, candidates, reason, exact } = hostPathCandidates(containerPath);
  if (!candidates.length) {
    throw new Error(`${reason || `cannot determine a host path for ${abs}`}\n  Or ${SET_ENV_HINT}`);
  }
  if (!exact) process.stderr.write(guessNote());
  const errors = [];
  for (const p of candidates) {
    try {
      return { result: await fn(p), hostPath: p };
    } catch (e) {
      errors.push(`  ${p}\n    -> ${e.message}`);
      if (fatal?.(e)) throw e;
    }
  }
  throw new Error(
    `no candidate host path worked for ${abs}:\n${errors.join("\n")}\n  ${SET_ENV_HINT}`
  );
}

/** Human-readable report: the mapping, and how it was arrived at. */
export function describe(paths, log = console.log) {
  const explicit = process.env.HOST_WORKSPACE_PATH;
  log(`HOST_WORKSPACE_PATH: ${explicit || "(unset — falling back to /proc/self/mountinfo)"}`);
  if (explicit) log(`maps container path: ${CONTAINER_WS}`);
  for (const p of paths.length ? paths : [process.cwd()]) {
    const { abs, candidates, reason, mount, exact } = hostPathCandidates(p);
    log(`\n${abs}`);
    if (mount) log(`  backed by: ${mount.fstype} mount at ${mount.mountPoint} (source ${mount.root})`);
    if (reason) log(`  UNRESOLVABLE: ${reason}`);
    for (const [i, c] of candidates.entries()) {
      log(`  ${i === 0 ? "->" : "  "} ${c}${exact ? "  (exact, from env)" : ""}`);
    }
  }
}

// -------------------------------------------------------------------------- CLI

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const plain = argv.includes("--plain");
  const paths = argv.filter((a) => !a.startsWith("--"));
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`usage: node hostpath.mjs [--plain] <path...>

Print the host path(s) for files inside this workspace, for handing to anything
running outside the container.

  (default)   report the mapping and how it was derived
  --plain     print candidate host paths only, best first, one per line

env: HOST_WORKSPACE_PATH   host location of the workspace (exact mapping)
     CONTAINER_WORKSPACE_PATH   container location it maps to (default ${CONTAINER_WS})`);
    process.exit(0);
  }
  try {
    if (plain) {
      for (const p of paths.length ? paths : [process.cwd()]) {
        const { candidates, reason, abs, exact } = hostPathCandidates(p);
        if (!candidates.length) throw new Error(reason || `cannot determine a host path for ${abs}`);
        if (!exact) process.stderr.write(guessNote());
        for (const c of candidates) console.log(c);
      }
    } else {
      describe(paths);
    }
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}
