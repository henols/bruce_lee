// node:test structural coverage of the tracked host shell scripts that
// survive D-02 -- rescued from vice-pool.test.mjs (quick-260801-qpq Task 3)
// before that file is deleted wholesale in plan 04. vice-pool.sh itself is
// deleted per D-02 and dropped from this file entirely; vice-supervisor.sh
// and the bash broker (resources/vice-broker.sh) keep the assertions
// vice-pool.sh used to share, and the launcher (resources/vice-launcher.sh,
// created in plan 01) joins the shared script list. Plan 03 extends this
// file with the one-shell-script allowlist and the ignore-set parity gate.
//
// Nothing here imports vice-pool.mjs or vice-session.mjs, or drives the real
// emulator -- every process spawned below is a stub (`/bin/sleep`) or the
// script itself run with `--dry-run`/`--print-paths`/`-n`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));

/** Poll `predicate` (a zero-arg function returning truthy/falsy) to a
 * bounded deadline rather than sleeping a fixed duration -- checkpoint/frame
 * synchronisation, never wall-clock delay (this project's own stack
 * pattern). Returns the predicate's own truthy result, or null on timeout. */
async function waitFor(predicate, { timeoutMs = 8000, pollMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}

// The one shared list of tracked host scripts surviving D-02 -- plan 03 and
// 01.6.2 shrink THIS array rather than hunting individual assertions as
// scripts fold into the TypeScript broker.
const SURVIVING_HOST_SCRIPTS = ["vice-supervisor.sh", "vice-broker.sh", "vice-launcher.sh"];

// ============================================================================
// quick-260801-qpq Task 3: vice-supervisor.sh terminates what it spawned on
// SIGINT, SIGTERM, SIGHUP and on any other exit path -- not just
// SIGINT/SIGTERM as before. It registers a two-entry-point trap: a signal
// entry point (INT/TERM/HUP) and an EXIT entry point that captures $? as its
// first statement and re-exits with it, so the crash-loop give-up path's
// exit 4 survives unchanged.
// ============================================================================

test("vice-supervisor.sh: a SIGHUP terminates the running child before the supervisor itself exits", async () => {
  const supervisorScript = join(HERE, "resources", "vice-supervisor.sh");
  const supervisorDir = mkdtempSync(join(tmpdir(), "vice-supervisor-sighup-"));
  const epochFile = join(supervisorDir, "epoch.json");
  let child;
  try {
    child = spawn("bash", [supervisorScript], {
      env: {
        ...process.env,
        VICE_SUPERVISOR_ALLOW_CONTAINER: "1",
        VICE_SUPERVISOR_DIR: supervisorDir,
        VICE_BIN: "/bin/sleep",
        VICE_ARGS: "300",
      },
      stdio: "ignore",
    });

    const epoch = await waitFor(() => {
      if (!existsSync(epochFile)) return null;
      try {
        const rec = JSON.parse(readFileSync(epochFile, "utf8"));
        return typeof rec.pid === "number" ? rec : null;
      } catch {
        return null;
      }
    });
    assert.ok(epoch, "the supervisor must write an epoch record naming its child's pid");
    const childPid = epoch.pid;

    const childAliveBefore = await waitFor(() => {
      try {
        process.kill(childPid, 0);
        return true;
      } catch {
        return false;
      }
    });
    assert.ok(childAliveBefore, "the sleep child must be alive before the signal");

    child.kill("SIGHUP");

    const childGone = await waitFor(() => {
      try {
        process.kill(childPid, 0);
        return false;
      } catch {
        return true;
      }
    });
    assert.ok(childGone, "SIGHUP must terminate the running child before the supervisor exits");

    const supervisorExited = await waitFor(() => child.exitCode !== null);
    assert.ok(supervisorExited, "the supervisor itself must exit after handling SIGHUP");
    assert.equal(child.exitCode, 0, "a signal-triggered shutdown is a clean, deliberate exit -- status 0");
  } finally {
    if (child && child.exitCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
    rmSync(supervisorDir, { recursive: true, force: true });
  }
});

test("structural: vice-supervisor.sh and the bash broker (vice-broker.sh) register EXIT and HUP alongside INT and TERM; vice-launcher.sh execs into node instead, so signals reach the broker process directly with no trap of its own needed", () => {
  for (const name of SURVIVING_HOST_SCRIPTS) {
    const src = readFileSync(join(HERE, "resources", name), "utf8");

    if (name === "vice-launcher.sh") {
      // vice-launcher.sh's final action is `exec node "$BROKER_ARTIFACT" ...`
      // -- exec REPLACES the process image in place (same pid), so INT/TERM/
      // HUP/EXIT are delivered straight to the node process with no bash
      // trap in between. Asserting a trap here would assert something the
      // script deliberately does not do; the real invariant is the exec.
      assert.match(src, /\bexec\s+node\b/, `${name} must exec into node so signal delivery passes through unchanged`);
      continue;
    }

    assert.match(src, /trap\s+\S+\s+EXIT\b|trap\s+\S+[^\n]*\bEXIT\b/, `${name} must register a trap on EXIT`);
    assert.match(src, /trap\s+\S+[^\n]*\bHUP\b/, `${name} must register a trap naming HUP`);
    assert.match(src, /trap\s+\S+[^\n]*\bINT\b/, `${name} must still register a trap naming INT`);
    assert.match(src, /trap\s+\S+[^\n]*\bTERM\b/, `${name} must still register a trap naming TERM`);
  }
});

test("structural: bash -n exits 0 for every surviving tracked host script", async () => {
  for (const name of SURVIVING_HOST_SCRIPTS) {
    await execFileP("bash", ["-n", join(HERE, "resources", name)]);
  }
});
