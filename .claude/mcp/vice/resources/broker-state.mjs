// GENERATED FILE -- DO NOT EDIT.
// Compiled by `tsc` from broker-state.mts. Edit the TypeScript source and rebuild;
// changes made directly to this file are silently overwritten by the next build, and are never
// deployed to the host on their own -- install-resources.mjs copies THIS file's on-disk contents
// verbatim to tools/, so an edit made only here reaches the host but is lost on the very next
// rebuild.
export function createBrokerState() {
    return { instances: new Map(), grants: new Map(), blockedPorts: new Set() };
}
/** Deep, plain-object copy of `state` for tests -- a real, typed, named
 * export imported directly by test files, modelled on build.ts's own
 * exported build(). Never a global, never a subprocess-and-inspect round
 * trip. */
export function _snapshotState(state) {
    return {
        instances: Array.from(state.instances.values()).map((r) => ({ ...r, viceArgs: [...r.viceArgs] })),
        grants: Array.from(state.grants.values()).map((g) => ({ ...g })),
        blockedPorts: Array.from(state.blockedPorts).sort((a, b) => a - b),
    };
}
/** VICE_BROKER_BASE_PORT's default (D-18): the broker's port band moves
 * from 6510 to 6600 in this phase. */
export const DEFAULT_BASE_PORT = 6600;
function resolveBasePort() {
    const raw = process.env.VICE_BROKER_BASE_PORT;
    if (raw === undefined || raw === "")
        return DEFAULT_BASE_PORT;
    const n = Number(raw);
    return Number.isFinite(n) ? n : DEFAULT_BASE_PORT;
}
/** Allocates the lowest free port at or above the base port, skipping ports
 * already present in the instance map or the blocked set. This is the
 * MINIMUM the single tracer path needs -- the full scan, the running
 * counts and the real port-in-use check are plan 02's. */
export function nextFreePort(state, { basePort = resolveBasePort() } = {}) {
    let port = basePort;
    while (state.instances.has(port) || state.blockedPorts.has(port)) {
        port++;
    }
    return port;
}
