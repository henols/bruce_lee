// broker-state.mts
//
// C4 (minimal, this task -- plan 02 owns the full port scan, the running
// counts (countReady/countTotal/countLaunching) and the real port-in-use
// check). In-memory grants/instances state for the long-lived broker: two
// Maps plus a process-scoped Set, replacing the bash broker's
// spares/grants/leases directory trees with state that lives in the
// process rather than on disk (D-01, D-24).
//
// BrokerDeps is the injectable spawn/clock/readiness-probe seam every
// launch, kill and probe test uses -- an architectural feature from this,
// the FIRST commit that defines BrokerState, rather than a retrofit once a
// test needs it.
import type { ChildProcess } from "node:child_process";

export type InstanceState = "launching" | "ready" | "granted";

export interface InstanceRecord {
  port: number;
  url: string;
  state: InstanceState;
  reason: string;
  epochFile: string;
  supervisorDir: string;
  pid: number | null;
  expectedIdentity: string;
  launchedAt: number;
  readyAt: number | null;
  viceBin: string;
  viceArgs: string[];
  dryRun: boolean;
}

export interface GrantRecord {
  id: string;
  port: number;
  grantedAt: number;
}

export interface BrokerState {
  instances: Map<number, InstanceRecord>;
  grants: Map<string, GrantRecord>;
  /** Process-scoped, never persisted -- ports blocked for the lifetime of
   * this broker process only (e.g. a port that failed to bind once). */
  blockedPorts: Set<number>;
}

export function createBrokerState(): BrokerState {
  return { instances: new Map(), grants: new Map(), blockedPorts: new Set() };
}

/** The spawn/clock/readiness-probe seam every launch, kill and probe test
 * uses. `spawn` and `now` are used by this task (broker-launch.mts);
 * `probeReady` is plan 02's readiness probe and is defined here now so the
 * interface shape does not change out from under plan 02's tests. */
export interface BrokerDeps {
  spawn: (command: string, args: string[]) => ChildProcess;
  now: () => number;
  probeReady: (record: InstanceRecord) => Promise<boolean>;
}

export interface StateSnapshot {
  instances: InstanceRecord[];
  grants: GrantRecord[];
  blockedPorts: number[];
}

/** Deep, plain-object copy of `state` for tests -- a real, typed, named
 * export imported directly by test files, modelled on build.ts's own
 * exported build(). Never a global, never a subprocess-and-inspect round
 * trip. */
export function _snapshotState(state: BrokerState): StateSnapshot {
  return {
    instances: Array.from(state.instances.values()).map((r) => ({ ...r, viceArgs: [...r.viceArgs] })),
    grants: Array.from(state.grants.values()).map((g) => ({ ...g })),
    blockedPorts: Array.from(state.blockedPorts).sort((a, b) => a - b),
  };
}

/** VICE_BROKER_BASE_PORT's default (D-18): the broker's port band moves
 * from 6510 to 6600 in this phase. */
export const DEFAULT_BASE_PORT = 6600;

function resolveBasePort(): number {
  const raw = process.env.VICE_BROKER_BASE_PORT;
  if (raw === undefined || raw === "") return DEFAULT_BASE_PORT;
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_BASE_PORT;
}

/** Allocates the lowest free port at or above the base port, skipping ports
 * already present in the instance map or the blocked set. This is the
 * MINIMUM the single tracer path needs -- the full scan, the running
 * counts and the real port-in-use check are plan 02's. */
export function nextFreePort(state: BrokerState, { basePort = resolveBasePort() }: { basePort?: number } = {}): number {
  let port = basePort;
  while (state.instances.has(port) || state.blockedPorts.has(port)) {
    port++;
  }
  return port;
}
