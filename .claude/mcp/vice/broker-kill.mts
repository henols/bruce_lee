// broker-kill.mts
//
// D (minimal, this task -- the full shutdown wiring and the startup reap
// are plan 04's). The identity-verified kill discipline, ported from
// resources/vice-broker.sh's signal_recorded_pid()/signal_vice_child_pid():
// zero-signal liveness check, identity check against the process's own
// argument string, SIGTERM, poll-then-SIGKILL. The expected-identity string
// always comes from the instance record (the resolved binary path recorded
// at spawn time by broker-launch.mts), never a module constant -- this
// broker spawns the emulator directly and there is no intermediate
// supervising script for an identity check to match against.
import { execFileSync } from "node:child_process";

/** The same four-value vocabulary resources/vice-broker.sh's
 * signal_vice_child_pid() already returns -- the recycle ack contract
 * (plan 05) depends on this exact set of words, never a fifth. */
export type KillStage = "already_exited" | "identity_refused" | "sigterm" | "sigkill";

export interface VerifiedKillDeps {
  isAlive?: (pid: number) => boolean;
  readProcessArgs?: (pid: number) => string;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  sleepMs?: (ms: number) => Promise<void>;
  killWaitS?: number;
}

export interface VerifiedKillOptions {
  pid: number | null;
  expectedIdentity: string;
  deps?: VerifiedKillDeps;
}

const defaultIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const defaultReadProcessArgs = (pid: number): string => {
  try {
    return execFileSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8" });
  } catch {
    return "";
  }
};

const defaultKill = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(pid, signal);
  } catch {
    // already gone -- idempotent by design, matching the bash version's `|| true`
  }
};

const defaultSleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function resolveKillWaitS(override?: number): number {
  if (typeof override === "number") return override;
  const raw = process.env.VICE_BROKER_KILL_WAIT_S;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) ? n : 5;
}

/** Implements the discipline exactly as signal_recorded_pid()/
 * signal_vice_child_pid() do. An empty/null/non-positive pid, or a pid
 * already gone, returns "already_exited" without ever signalling -- "the
 * machine being gone is the goal", per the bash version's own comment. A
 * live pid whose OWN argument string does not contain expectedIdentity is
 * REFUSED -- never signalled -- and returns "identity_refused", the one
 * outcome a caller must be able to tell apart from every other stage
 * (possible pid reuse). Only a genuine identity match proceeds: SIGTERM,
 * poll every 200ms up to killWaitS (default VICE_BROKER_KILL_WAIT_S / 5),
 * SIGKILL on a survivor. */
export async function verifiedKill({ pid, expectedIdentity, deps = {} }: VerifiedKillOptions): Promise<KillStage> {
  const isAlive = deps.isAlive ?? defaultIsAlive;
  const readProcessArgs = deps.readProcessArgs ?? defaultReadProcessArgs;
  const kill = deps.kill ?? defaultKill;
  const sleepMs = deps.sleepMs ?? defaultSleepMs;
  const killWaitS = resolveKillWaitS(deps.killWaitS);

  if (pid === null || !Number.isFinite(pid) || pid <= 0) {
    return "already_exited";
  }
  if (!isAlive(pid)) {
    return "already_exited";
  }

  const args = readProcessArgs(pid);
  if (!args.includes(expectedIdentity)) {
    process.stderr.write(
      `vice-broker: refusing to signal pid ${pid} -- ps reports "${args.trim()}", which does not match expected identity "${expectedIdentity}" (possible pid reuse)\n`,
    );
    return "identity_refused";
  }

  kill(pid, "SIGTERM");
  const limitMs = killWaitS * 1000;
  let waitedMs = 0;
  while (isAlive(pid)) {
    if (waitedMs >= limitMs) {
      process.stderr.write(`vice-broker: pid ${pid} did not exit within ${killWaitS}s of SIGTERM -- sending SIGKILL\n`);
      kill(pid, "SIGKILL");
      return "sigkill";
    }
    await sleepMs(200);
    waitedMs += 200;
  }
  return "sigterm";
}
