// GENERATED FILE -- DO NOT EDIT.
// Compiled by `tsc` from broker-launch.mts. Edit the TypeScript source and rebuild;
// changes made directly to this file are silently overwritten by the next build, and are never
// deployed to the host on their own -- install-resources.mjs copies THIS file's on-disk contents
// verbatim to tools/, so an edit made only here reaches the host but is lost on the very next
// rebuild.
// broker-launch.mts
//
// C (minimal, this task -- warming, the serialised-warming break and
// probeReady()'s full three-way branch are plan 02's; this task launches on
// ONE cold acquire only). The single `in_flight` launch-guard owner: every
// launch call site in the whole broker goes through tryLaunchOne(), which
// is what makes the single-owner guarantee mechanical rather than a
// convention plan 02's concurrency race test can silently violate.
import { spawn as nodeSpawn } from "node:child_process";
// Module-level: this file, not the caller, owns the single boolean --
// synchronous check, synchronous set, released in a finally, with no
// `await` between the check and the set.
let inFlight = false;
/** True while a launch is in progress -- exported for the race test plan 02
 * writes against two concurrent tryLaunchOne() calls. */
export function isLaunchInFlight() {
    return inFlight;
}
/** Resolves the emulator's own argument vector. Two shapes, matching
 * resources/vice-supervisor.sh's own VICE_ARGS convention exactly: if
 * VICE_ARGS is set in the environment (a single space-separated string,
 * fully overridable -- vice-supervisor.sh's own header comment), it is used
 * AS-IS; otherwise the MCP server flags are constructed the way the bash
 * launcher builds them -- the MCP server flag, the MCP server host from
 * VICE_BROKER_MCP_HOST (default 0.0.0.0), and the MCP server port set to
 * the allocated port. The override exists because this broker's own tests
 * (and an operator's manual dry runs) need to launch a stand-in binary
 * (e.g. /bin/sleep) that does not understand -mcpserver flags. */
export function buildViceArgs(port, { mcpHost, viceArgsEnv } = {}) {
    const rawViceArgs = viceArgsEnv ?? process.env.VICE_ARGS;
    if (typeof rawViceArgs === "string" && rawViceArgs.trim() !== "") {
        return rawViceArgs.trim().split(/\s+/);
    }
    const host = mcpHost ?? process.env.VICE_BROKER_MCP_HOST ?? "0.0.0.0";
    return ["-mcpserver", "-mcpserverhost", host, "-mcpserverport", String(port)];
}
/** The single in_flight owner. Spawns via deps.spawn (defaulting to Node's
 * own child_process.spawn), records the resolved binary path at spawn time
 * into the instance record's expectedIdentity field -- the string the kill
 * discipline (broker-kill.mts) checks identity against, and the VICE_BIN
 * binary this broker spawns directly, never any intermediate script path.
 * Logs the resolved command line before spawning, so a bad configuration
 * value is visible rather than silently mis-parsed, exactly like the bash
 * launcher's own logging discipline. */
export function tryLaunchOne(reason, port, deps) {
    if (inFlight)
        return null;
    inFlight = true;
    try {
        const spawnFn = deps.spawn ?? ((cmd, args) => nodeSpawn(cmd, args));
        const now = deps.now ?? (() => Date.now());
        const viceBin = deps.viceBin ?? process.env.VICE_BIN ?? "x64sc";
        const viceArgs = buildViceArgs(port, { mcpHost: deps.mcpHost });
        process.stderr.write(`vice-broker: launching ${viceBin} ${viceArgs.join(" ")}\n`);
        const child = spawnFn(viceBin, viceArgs);
        const record = {
            port,
            url: `http://127.0.0.1:${port}/mcp`,
            state: "launching",
            reason,
            epochFile: deps.epochFile,
            supervisorDir: deps.supervisorDir,
            pid: child.pid ?? null,
            expectedIdentity: viceBin,
            launchedAt: now(),
            readyAt: null,
            viceBin,
            viceArgs,
            dryRun: false,
        };
        deps.state.instances.set(port, record);
        return record;
    }
    finally {
        inFlight = false;
    }
}
