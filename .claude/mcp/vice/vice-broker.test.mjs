// node:test integration coverage of the on-demand broker's tracer slice
// (Phase 01.2 plan 01): a real spawned vice-proxy.mjs child process, driven
// through one full request -> grant -> forward -> release -> teardown round
// trip against the REAL resources/vice-broker.sh (run with
// --once --dry-run), with an in-process node:http stand-in standing in for
// the host VICE MCP server. No host emulator and no real x64sc are involved
// at any point -- matching vice-pool.test.mjs's own execFile-real-subprocess
// idiom (01.2-PATTERNS.md), and vice-proxy.test.mjs's own spawned-child +
// stand-in-server harness (both duplicated here rather than imported, since
// neither file exports its internal test helpers).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  rmSync,
  utimesSync,
  chmodSync,
  cpSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { REQUEST_ID_PATTERN, isValidRequestId } from "./vice-broker-client.mjs";

const execFileP = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const PROXY_PATH = join(HERE, "vice-proxy.mjs");
const BROKER_SCRIPT = join(HERE, "resources", "vice-broker.sh");

const tmpPoolDir = () => mkdtempSync(join(tmpdir(), "vice-broker-test-"));

/** Minimal in-process stand-in for the host VICE MCP server -- same shape
 * as vice-proxy.test.mjs's own startStandInServer(): answers `initialize`
 * and `tools/call` for `vice_ping`, records every request verbatim. */
function startStandInServer() {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        msg = null;
      }
      requests.push(msg);

      if (msg && msg.method === "initialize") {
        const result = {
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: { name: "stand-in-vice", version: "0.0.0" },
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
        return;
      }
      if (msg && msg.method === "tools/call" && msg.params && msg.params.name === "vice_ping") {
        const payload = { version: "3.10", machine: "C64SC", execution: "paused" };
        const result = { content: [{ type: "text", text: JSON.stringify(payload) }] };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg && "id" in msg ? msg.id : null,
          error: { code: -32601, message: "unsupported in this test's stand-in server" },
        })
      );
    });
  });
  return { server, requests };
}

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return server.address().port;
}

/** Spawns `node vice-proxy.mjs` as a real child process -- same harness
 * shape as vice-proxy.test.mjs's own startProxy(). */
function startProxy(env) {
  const child = spawn(process.execPath, [PROXY_PATH], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const messages = [];
  let consumed = 0;
  let outBuf = "";

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    outBuf += chunk;
    let idx;
    while ((idx = outBuf.indexOf("\n")) !== -1) {
      const line = outBuf.slice(0, idx);
      outBuf = outBuf.slice(idx + 1);
      if (line.trim().length === 0) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (e) {
        parsed = { __parseError: e.message, __raw: line };
      }
      messages.push(parsed);
    }
  });

  const stderrChunks = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

  function send(msg) {
    child.stdin.write(JSON.stringify(msg) + "\n");
  }

  async function nextMessage(timeoutMs = 8000) {
    const start = Date.now();
    while (consumed >= messages.length) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`timed out waiting for a proxy stdout message (stderr so far: ${stderrChunks.join("")})`);
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    return messages[consumed++];
  }

  return { child, send, messages, nextMessage, stderr: stderrChunks };
}

/** Poll `predicate` (a zero-arg function returning truthy/falsy) to a
 * bounded deadline rather than sleeping a fixed duration, per this task's
 * own "poll for the condition" convention. */
async function waitFor(predicate, { timeoutMs = 8000, pollMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}

// ---------------------------------------------------------------------------
// quick-260802-d6v Task 2/3 shared helpers: start a real detached broker and
// reap it unconditionally. Every test using these registers cleanup via
// `t.after(() => reapDetached(dir, ref))` as its FIRST statement after
// creating the temp dir -- BEFORE anything that can throw -- because these
// tests spawn a genuinely detached, long-lived process that by construction
// ignores the signals a test runner would normally use and outlives its
// parent. `t.after` rather than `try/finally`: these tests can time out on a
// hung parent, and a `finally` behind an unresolved `await` never runs while
// an `after` hook does.

/** Starts `vice-broker.sh start --detach --dry-run` against `dir` and parses
 * the parent-only stdout announcement for the child's pid and log path.
 * Returns { pid, logPath, stdout }. */
async function startDetached(dir, opts = {}) {
  const { stdout } = await execFileP("bash", [BROKER_SCRIPT, "start", "--detach", "--dry-run"], {
    env: {
      ...process.env,
      VICE_SUPERVISOR_ALLOW_CONTAINER: "1",
      VICE_POOL_DIR: dir,
      VICE_BROKER_SPARES: "0",
      VICE_BROKER_POLL_MS: "200",
      ...opts,
    },
  });
  const pidMatch = stdout.match(/detached broker running as pid (\d+)/);
  const logMatch = stdout.match(/-- log: (\S+)/);
  assert.ok(pidMatch, `expected a parsable pid in stdout, got: ${stdout}`);
  assert.ok(logMatch, `expected a parsable log path in stdout, got: ${stdout}`);
  return { pid: Number(pidMatch[1]), logPath: logMatch[1], stdout };
}

/** Unconditional cleanup for a detached broker: collects candidate pids from
 * `ref.pid`/`ref.pids` (which may be undefined if the test failed before
 * parsing) AND from broker.json's own "pid" field if readable -- the
 * fallback is what makes a leak impossible even when the test never got far
 * enough to record a pid. Kills every candidate, waits for it to be gone,
 * asserts so (a leak must fail loudly, not pass quietly), then removes dir. */
async function reapDetached(dir, ref) {
  const candidates = new Set();
  if (ref && ref.pid) candidates.add(ref.pid);
  if (ref && Array.isArray(ref.pids)) {
    for (const p of ref.pids) candidates.add(p);
  }
  try {
    const brokerJson = JSON.parse(readFileSync(join(dir, "broker.json"), "utf8"));
    if (brokerJson && brokerJson.pid) candidates.add(brokerJson.pid);
  } catch {
    /* no broker.json, or unreadable -- nothing to add */
  }

  for (const pid of candidates) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }

  for (const pid of candidates) {
    const gone = await waitFor(
      () => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      },
      { timeoutMs: 8000 }
    );
    assert.ok(gone, `detached pid ${pid} must be gone after reapDetached -- a leaked daemon is worse than the defect being fixed`);
  }

  rmSync(dir, { recursive: true, force: true });
}

function runBrokerOnceDryRun(dir, basePort) {
  return execFileP("bash", [BROKER_SCRIPT, "--once", "--dry-run"], {
    env: {
      ...process.env,
      VICE_SUPERVISOR_ALLOW_CONTAINER: "1",
      VICE_POOL_DIR: dir,
      VICE_BROKER_BASE_PORT: String(basePort),
      VICE_BROKER_SPARES: "0",
    },
  });
}

// ---------------------------------------------------------------------------
// Plan 02 (Task 1: single teardown path; Task 2: kill-never-recycle + id
// parity) test helpers. These bypass the request->grant round trip where a
// test only needs to exercise the teardown/sweep pass in isolation --
// writing a grant (and optionally a lease) directly mirrors exactly the
// shape resources/vice-broker.sh itself writes, so the pass under test
// cannot tell the difference from a grant it wrote moments earlier.

/** Runs `vice-broker.sh --once [--dry-run]` with the given pool dir/env
 * overrides, mirroring runBrokerOnceDryRun() above but with knobs for TTL
 * and non-dry-run opt-out (dry-run is the default -- no real x64sc is ever
 * needed by this file's own tests). Plan 04 adds `spares`/`max`/`probeCmd`/
 * `script` (which broker script binary to invoke -- defaults to the real,
 * tracked one; overridden by tests exercising the missing-supervisor-script
 * denial, which run a temp copy of the whole resources/ dir instead).
 * Quick task 260802-ci3 adds `pollMs`, setting VICE_BROKER_POLL_MS only when
 * the caller passes one, so every existing caller is unaffected -- lets a
 * test prove the boot-time log line's poll-interval caveat reads the
 * variable rather than the 500 default. */
function runBrokerOnce(dir, { basePort = 7000, ttlS, dryRun = true, spares = 0, max, probeCmd, pollMs, script = BROKER_SCRIPT } = {}) {
  const env = {
    ...process.env,
    VICE_SUPERVISOR_ALLOW_CONTAINER: "1",
    VICE_POOL_DIR: dir,
    VICE_BROKER_BASE_PORT: String(basePort),
    VICE_BROKER_SPARES: String(spares),
  };
  if (ttlS !== undefined) env.VICE_BROKER_TTL_S = String(ttlS);
  if (max !== undefined) env.VICE_BROKER_MAX = String(max);
  if (probeCmd !== undefined) env.VICE_BROKER_PROBE_CMD = probeCmd;
  if (pollMs !== undefined) env.VICE_BROKER_POLL_MS = String(pollMs);
  const args = ["--once"];
  if (dryRun) args.push("--dry-run");
  return execFileP("bash", [script, ...args], { env });
}

/** Writes grants/<id>.json directly, in the exact shape vice-broker.sh's own
 * process_requests() writes -- lets a test set up a teardown/sweep scenario
 * without needing a live proxy to have requested it first. */
function writeGrantFile(dir, id, { port = 7000, supervisorPid = null, dryRun = true, launchedAt = null } = {}) {
  const gdir = join(dir, "grants");
  mkdirSync(gdir, { recursive: true });
  const record = {
    version: 1,
    id,
    port,
    url: `http://127.0.0.1:${port}/mcp`,
    epoch_file: join(dir, String(port), "epoch.json"),
    supervisor_dir: join(dir, String(port)),
    supervisor_pid: supervisorPid,
    granted_at: new Date().toISOString(),
    dry_run: dryRun,
    ...(launchedAt !== null ? { launched_at: launchedAt } : {}),
  };
  const p = join(gdir, `${id}.json`);
  writeFileSync(p, JSON.stringify(record, null, 2) + "\n");
  return p;
}

/** Writes leases/<id> directly -- existence is the claim, mtime is the
 * heartbeat, removal is the release (per this phase's own must_haves). */
function writeLeaseFile(dir, id) {
  const ldir = join(dir, "leases");
  mkdirSync(ldir, { recursive: true });
  const p = join(ldir, id);
  writeFileSync(p, JSON.stringify({ version: 1, id, created_at: new Date().toISOString() }) + "\n");
  return p;
}

/** Rewinds a lease file's mtime to simulate staleness (secondsAgo > 0) or
 * refreshes it to "now" (secondsAgo === 0), without touching its content --
 * only the mtime is the sweeper's own signal. */
function ageLeaseFile(leasePath, secondsAgo) {
  const t = new Date(Date.now() - secondsAgo * 1000);
  utimesSync(leasePath, t, t);
}

// ---------------------------------------------------------------------------
// Plan 04 (Task 1: launching/ready spare state machine; Task 2: grant from a
// ready spare, cold-launch deferral, denials) fixtures. These bypass the
// launch/probe round trip where a test only needs to plant a spare directly,
// mirroring exactly the shape resources/vice-broker.sh's own launch_instance()
// writes -- the pass under test cannot tell the difference.

/** Writes spares/<port>.json directly, in the exact shape launch_instance()
 * writes -- lets a test set up a promotion/grant scenario without needing a
 * real launch to have happened first. */
function writeSpareFile(
  dir,
  port,
  { state = "launching", reason = "spare", dryRun = true, launchedAt = null, readyAt = null, supervisorPid = null } = {}
) {
  const sdir = join(dir, "spares");
  mkdirSync(sdir, { recursive: true });
  const record = {
    version: 1,
    port,
    url: `http://127.0.0.1:${port}/mcp`,
    epoch_file: join(dir, String(port), "epoch.json"),
    supervisor_dir: join(dir, String(port)),
    supervisor_pid: supervisorPid,
    launched_at: launchedAt !== null ? launchedAt : Date.now() * 1e6,
    ready_at: readyAt,
    state,
    reason,
    dry_run: dryRun,
  };
  const p = join(sdir, `${port}.json`);
  writeFileSync(p, JSON.stringify(record, null, 2) + "\n");
  return p;
}

/** Writes a stub executable script into its OWN fresh temp dir, chmod +x --
 * the VICE_BROKER_PROBE_CMD injectable seam, invoked by vice-broker.sh as
 * `"$VICE_BROKER_PROBE_CMD" "$port"`. Returns the script's absolute path;
 * the caller is responsible for `rmSync(dirname(path), {recursive:true})`
 * once done. Using a FRESH tmp dir per stub (rather than a shared one) means
 * a stateful stub's own counter file (see failNTimesThenSucceedProbe below)
 * never collides across tests. */
function makeProbeStub(script) {
  const dir = mkdtempSync(join(tmpdir(), "vice-broker-probe-"));
  const p = join(dir, "probe.sh");
  writeFileSync(p, `#!/usr/bin/env bash\n${script}\n`);
  chmodSync(p, 0o755);
  return p;
}

const alwaysSucceedProbe = () => makeProbeStub("exit 0");
const alwaysFailProbe = () => makeProbeStub("exit 1");

/** A stub whose own persistent counter file (sitting next to the script, in
 * the same per-stub temp dir) fails the first `n` invocations and succeeds
 * on every one after -- deterministic across separate `--once` subprocess
 * invocations, which each start a brand-new bash process with no shared
 * in-memory state of their own. */
function failNTimesThenSucceedProbe(n) {
  return makeProbeStub(`
COUNTER_FILE="$(dirname "$0")/counter"
count=0
if [ -f "$COUNTER_FILE" ]; then count=$(cat "$COUNTER_FILE"); fi
count=$((count + 1))
echo "$count" > "$COUNTER_FILE"
if [ "$count" -le ${n} ]; then exit 1; else exit 0; fi
`);
}

/** Builds a curated PATH directory containing symlinks to every coreutil
 * vice-broker.sh itself needs (bash, awk, grep, sed, mkdir, mv, ps, kill,
 * date, mktemp, stat, ...) but DELIBERATELY OMITTING curl -- the only way to
 * exercise the "no readiness mechanism available at all" degradation
 * (VICE_BROKER_PROBE_CMD unset AND curl not found) without actually
 * uninstalling curl from this container, which is genuinely present here
 * (`command -v curl` succeeds) and needed by the rest of the suite. */
function pathWithoutCurl() {
  const dir = mkdtempSync(join(tmpdir(), "vice-broker-nocurl-"));
  const tools = [
    "bash", "sh", "awk", "basename", "cat", "chmod", "date", "dirname", "grep", "head", "id",
    "kill", "mkdir", "mktemp", "mv", "nohup", "printf", "ps", "pwd", "rm", "sed", "sleep",
    "stat", "env", "true", "false", "ln", "readlink", "test", "uname",
  ];
  for (const t of tools) {
    let real = null;
    try {
      real = execFileSync("bash", ["-c", `command -v ${t}`]).toString().trim();
    } catch {
      real = null;
    }
    if (real) {
      try {
        symlinkSync(real, join(dir, t));
      } catch {
        /* already linked, or unavailable -- fine either way */
      }
    }
  }
  return dir;
}

/** Copies the WHOLE resources/ directory (vice-broker.sh, lib/, vice-pool.sh)
 * into a fresh temp dir and removes vice-supervisor.sh from the copy --
 * SELF_DIR resolution (sibling-of-the-running-script, matching D-6) means
 * the copy's own vice-broker.sh resolves SUPERVISOR_SCRIPT to a path that
 * genuinely does not exist, exercising the "supervisor script missing"
 * denial without touching the real, tracked resources/ directory at all.
 * Returns the copy's own vice-broker.sh path (pass as `script` to
 * runBrokerOnce()). */
function brokerCopyMissingSupervisor() {
  const dir = mkdtempSync(join(tmpdir(), "vice-broker-nosuper-"));
  cpSync(join(HERE, "resources"), dir, { recursive: true });
  rmSync(join(dir, "vice-supervisor.sh"), { force: true });
  return join(dir, "vice-broker.sh");
}

/** Copies the WHOLE resources/ directory into a fresh temp dir and REPLACES
 * vice-supervisor.sh with a stub that exits immediately. Needed by any test
 * that must run WITHOUT --dry-run -- port_in_use() is deliberately checked
 * only outside dry-run, so exercising a bound port requires a real launch
 * path, and a real launch path would otherwise nohup the true supervisor,
 * which in this container finds no x64sc and leaks a backoff-looping
 * background process for the rest of the run. The stub keeps the launch path
 * genuine (a pid is spawned and recorded) while spawning nothing that
 * survives. Returns the copy's own vice-broker.sh path. */
function brokerCopyWithStubSupervisor() {
  const dir = mkdtempSync(join(tmpdir(), "vice-broker-stubsuper-"));
  cpSync(join(HERE, "resources"), dir, { recursive: true });
  const stub = join(dir, "vice-supervisor.sh");
  writeFileSync(stub, "#!/usr/bin/env bash\n# test stub: spawn nothing, exit immediately\nexit 0\n");
  chmodSync(stub, 0o755);
  return join(dir, "vice-broker.sh");
}

/** Copies the WHOLE resources/ directory into a fresh temp dir and REPLACES
 * vice-supervisor.sh with a stub that traps TERM/INT/HUP and sleeps 300s --
 * a genuinely LIVE process whose `ps` args name the COPY's own supervisor
 * path, which is exactly what signal_recorded_pid()'s identity check
 * requires. Distinct from brokerCopyWithStubSupervisor() above (which exits
 * immediately -- fine for exercising the LAUNCH path, useless here, since
 * there would be nothing left alive to signal by the time any test could
 * observe it). Returns { brokerScript, supervisorScript }: the copy's own
 * vice-broker.sh path (pass as `script` to runBrokerOnce()) and its own
 * vice-supervisor.sh stub path (for spawning a live "supervisor" directly,
 * for tests that need one without a broker's own launch path in the loop at
 * all). The caller is responsible for `rmSync(dirname(brokerScript), {
 * recursive: true, force: true })` once done. */
function brokerCopyWithSleepingSupervisor() {
  const dir = mkdtempSync(join(tmpdir(), "vice-broker-sleepsuper-"));
  cpSync(join(HERE, "resources"), dir, { recursive: true });
  const stub = join(dir, "vice-supervisor.sh");
  writeFileSync(
    stub,
    "#!/usr/bin/env bash\n" +
      "# test stub: a genuinely live process that traps signals and sleeps,\n" +
      "# so ps -o args= names THIS copy's own supervisor script path.\n" +
      "trap 'exit 0' TERM INT HUP\n" +
      "sleep 300 &\n" +
      "wait $!\n"
  );
  chmodSync(stub, 0o755);
  return { brokerScript: join(dir, "vice-broker.sh"), supervisorScript: stub };
}

/** Binds a real TCP listener on 127.0.0.1:<port> so port_in_use()'s
 * /dev/tcp probe genuinely succeeds. Returns a closer. */
async function occupyPort(port) {
  const srv = createServer(() => {});
  await new Promise((res, rej) => {
    srv.once("error", rej);
    srv.listen(port, "127.0.0.1", res);
  });
  return () => new Promise((res) => srv.close(res));
}

/** Writes requests/<id>.json in the exact shape vice-broker-client.mjs's own
 * writeRequest() produces, for tests that exercise the real request scan
 * rather than a directly-planted grant. */
function writeRequestFile(dir, id, { proxyPid = process.pid } = {}) {
  const rdir = join(dir, "requests");
  mkdirSync(rdir, { recursive: true });
  const record = {
    version: 1,
    id,
    op: "acquire",
    proxy_pid: proxyPid,
    session_id: null,
    client_pid: null,
    created_at: new Date().toISOString(),
  };
  writeFileSync(join(rdir, `${id}.json`), JSON.stringify(record, null, 2) + "\n");
}

/** Recursively lists every file under `dir` -- used by the id-pattern parity
 * test to prove no path-traversal-shaped file was ever created anywhere,
 * across the whole rejected-id corpus, not just at one predicted location. */
function listAllFilesRecursive(dir) {
  const out = [];
  function walk(d) {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(full);
    }
  }
  walk(dir);
  return out;
}

test("tracer: request -> grant -> forward -> SIGINT release -> teardown, end to end", async () => {
  const dir = tmpPoolDir();
  const { server, requests } = startStandInServer();
  const port = await listen(server);
  const epochFile = join(dir, "epoch.json"); // deliberately never written -- absence is normal, not a restart

  // VICE_MCP_URL intentionally UNSET -- the broker path is the one under
  // test (an explicit endpoint override would make ensureBrokerLease() a
  // no-op, per criterion "VICE_MCP_URL set -> proxy asks the broker for
  // nothing").
  const proxy = startProxy({
    VICE_POOL_DIR: dir,
    VICE_BROKER_BASE_PORT: String(port),
    VICE_EPOCH_FILE: epochFile,
    // Quick task 260801-ccn: the broker's own grant_from_spare() writes a
    // loopback url ("http://127.0.0.1:$port/mcp"). vice-proxy.mjs's
    // containerizeGrant() now inverts that to the container-visible host
    // alias before adopting it -- setting the alias to loopback here is what
    // makes the inverse an identity for THIS stand-in, which really does
    // live on this side of the boundary (see vice-proxy.test.mjs's own
    // broker-path tests for the same rationale).
    VICE_MCP_HOST: "127.0.0.1",
  });

  try {
    proxy.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    await proxy.nextMessage();

    proxy.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    await proxy.nextMessage();

    // C3: initialize + tools/list alone must write NEITHER a request NOR a
    // lease file -- acquisition is deferred to the first forwarded call.
    assert.equal(existsSync(join(dir, "requests")), false, "initialize+tools/list must create no requests directory");
    assert.equal(existsSync(join(dir, "leases")), false, "initialize+tools/list must create no leases directory");

    // A live broker must be observable BEFORE the first forwarded call. Plan
    // 01.2-03's criterion C10 makes ensureBrokerLease() classify broker
    // liveness *first*: never_started and stale both return their diagnostic
    // message immediately, writing neither a request nor a lease. Without a
    // broker.json carrying a fresh heartbeat_at, this tracer would exercise
    // the never-started path and no request would ever appear. Same fixture
    // the acquireLeaseViaBroker() helper in vice-proxy.test.mjs writes, for
    // the same reason. Deliberately written after the C3 assertions above so
    // those still prove acquisition is deferred past the handshake.
    writeFileSync(
      join(dir, "broker.json"),
      JSON.stringify({ version: 1, pid: process.pid, heartbeat_at: new Date().toISOString() }),
      "utf8"
    );

    // The first forwarded tools/call -- this is what acquires an instance.
    proxy.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "vice_ping", arguments: {} } });

    const reqDir = join(dir, "requests");
    const reqFiles = await waitFor(() => {
      if (!existsSync(reqDir)) return null;
      const files = readdirSync(reqDir).filter((f) => f.endsWith(".json"));
      return files.length > 0 ? files : null;
    });
    assert.ok(reqFiles, "a request file must appear under requests/ before the broker has run");
    assert.equal(reqFiles.length, 1, "exactly one request file must appear for one forwarded call");

    const id = reqFiles[0].replace(/\.json$/, "");
    assert.ok(REQUEST_ID_PATTERN.test(id), `request id ${id} must match the request-id pattern`);
    assert.ok(isValidRequestId(id));

    // Not yet resolved: only the two handshake responses exist so far, and
    // no grant has been written yet.
    assert.equal(proxy.messages.length, 2, "the tools/call must not have resolved before a grant exists");

    // Run the host-side broker once, in dry-run mode, against the SAME pool
    // directory and the stand-in server's own port. Plan 04: with zero ready
    // spares (VICE_BROKER_SPARES:"0" in runBrokerOnceDryRun's own env), this
    // FIRST pass finds nothing ready and launches a COLD instance instead --
    // deliberately writing NEITHER a grant NOR a denial (see
    // process_requests()'s own comment on this point). No grant exists yet.
    await runBrokerOnceDryRun(dir, port);
    const grantPath = join(dir, "grants", `${id}.json`);
    assert.equal(existsSync(grantPath), false, "the FIRST pass must not grant yet -- it only starts the cold launch");
    assert.equal(existsSync(join(dir, "denials", `${id}.json`)), false, "the first pass must not deny either");
    assert.ok(existsSync(join(dir, "requests", `${id}.json`)), "the request file must still be pending after the first pass");

    // A SECOND pass: the cold-launched instance points at the stand-in
    // server's own REAL, live port, so the default curl-based probe_ready()
    // (no VICE_BROKER_PROBE_CMD override here) succeeds against it for real
    // -- promoting launching -> ready within THIS pass's own maintain_spares
    // step, which then lets THIS SAME pass's process_requests grant it on
    // the pass immediately following (a second runBrokerOnceDryRun call is
    // exactly what production's own poll loop provides for free).
    await runBrokerOnceDryRun(dir, port);
    assert.ok(existsSync(grantPath), "a matching grant file must appear after the second broker pass");
    const grant = JSON.parse(readFileSync(grantPath, "utf8"));
    assert.equal(grant.port, port, "the grant must carry the stand-in server's own port");
    assert.equal(grant.dry_run, true, "the grant must record dry_run:true");
    assert.equal(
      existsSync(join(dir, "requests", `${id}.json`)),
      false,
      "the request file must be gone once its grant has been written"
    );

    // The previously-pending tools/call must now resolve with the stand-in's
    // own payload.
    const callResp = await proxy.nextMessage();
    assert.equal(callResp.id, 3);
    assert.equal(callResp.result.isError, false, "the forwarded call must succeed once a grant exists");
    const payload = JSON.parse(callResp.result.content[0].text);
    assert.equal(payload.version, "3.10", "the stand-in server's own ping payload must round-trip back out");

    // FOUR "tools/call" requests reach the stand-in server, not one: the
    // proxy's own pre-flight liveness probe (plan 01.1-03's vice_ping round
    // trip); the broker's OWN readiness probe_ready() (plan 04's default
    // curl-based check, fired during the FIRST pass's maintain_spares()
    // step while promoting the cold-launched spare from launching ->
    // ready); the quick-260801-qpq GRANT-TIME readiness probe (Task 2:
    // grant_from_spare() now calls probe_ready() again, immediately before
    // writing the grant, during the SECOND pass's process_requests() --
    // a record saying "ready" is bookkeeping, a probe that answers right
    // now is evidence, and the 2026-08-01 incident proved bookkeeping alone
    // survives a broker restart while the process behind it is long dead);
    // and the one real forwarded call this tracer proves.
    const toolCallsSeen = requests.filter((r) => r && r.method === "tools/call");
    assert.equal(
      toolCallsSeen.length,
      4,
      "the stand-in server must have received the pre-flight probe, the broker's readiness probe, the grant-time probe, and the real forwarded call"
    );
    assert.ok(toolCallsSeen.every((r) => r.params.name === "vice_ping"));

    // A lease file for this id must exist, with an mtime no earlier than its
    // own recorded creation time -- touchLease() runs on every forwarded
    // call (C6), in addition to createLease()'s initial write.
    const leasePath = join(dir, "leases", id);
    assert.ok(existsSync(leasePath), "a lease file for this request id must exist once the call has forwarded");
    const leaseRecord = JSON.parse(readFileSync(leasePath, "utf8"));
    const createdAtMs = Date.parse(leaseRecord.created_at);
    const leaseStat = statSync(leasePath);
    assert.ok(
      leaseStat.mtimeMs >= createdAtMs,
      "the lease file's mtime must be no earlier than its own created_at timestamp"
    );

    // SIGINT -- the FIRST signal of every graceful ending, a teardown
    // trigger here, never a plain user Ctrl-C to ignore.
    proxy.child.kill("SIGINT");

    const leaseGone = await waitFor(() => !existsSync(leasePath));
    assert.ok(leaseGone, "SIGINT must release the lease");

    // A further broker pass observes the released lease and tears the grant
    // down (the third runBrokerOnceDryRun() call in this test -- the first
    // two were the cold-launch pass and the grant pass above).
    await runBrokerOnceDryRun(dir, port);
    assert.equal(existsSync(grantPath), false, "this later broker pass must have torn the grant down");
  } finally {
    // SIGKILL, not the default SIGTERM: vice-proxy.mjs registers its own
    // SIGINT/SIGTERM/SIGHUP handlers and deliberately never calls
    // process.exit() (see its teardown comment) -- in production the
    // client's own ladder escalates to SIGKILL ~490ms after the first
    // signal if the process hasn't exited on its own. This test already
    // sent SIGINT and confirmed the lease was released; SIGKILL here is
    // this harness playing the client's role in that same ladder, not a
    // signal vice-proxy.mjs is expected to handle itself.
    try {
      proxy.child.kill("SIGKILL");
    } catch {
      /* already exited -- fine */
    }
    await new Promise((resolveClose) => server.close(resolveClose));
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Task 1: one teardown() reached by two triggers (released, swept-stale),
// the daemon lifecycle (start/stop/status), and the identity-verified kill.

test("teardown: a grant whose lease is absent is torn down and logged as released", async () => {
  const dir = tmpPoolDir();
  try {
    const id = "req-1-1000-aaaaaaaa";
    const grantPath = writeGrantFile(dir, id, { port: 7100 });
    const { stdout } = await runBrokerOnce(dir, { basePort: 7100 });
    assert.equal(existsSync(grantPath), false, "the grant must be removed once its lease is absent");
    assert.match(stdout, new RegExp(`${id}.*released`), "the pass must log this id's reason as released");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("teardown: a grant with a fresh lease survives the pass untouched", async () => {
  const dir = tmpPoolDir();
  try {
    const id = "req-2-2000-bbbbbbbb";
    const grantPath = writeGrantFile(dir, id, { port: 7101 });
    writeLeaseFile(dir, id);
    await runBrokerOnce(dir, { basePort: 7101 });
    assert.equal(existsSync(grantPath), true, "a fresh lease must survive the pass");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("teardown: released and swept-stale leave IDENTICAL resulting state, differing only in the logged reason", async () => {
  const releasedDir = tmpPoolDir();
  const sweptDir = tmpPoolDir();
  try {
    const idReleased = "req-3-3000-cccccccc";
    const idSwept = "req-3-3001-dddddddd";

    writeGrantFile(releasedDir, idReleased, { port: 7102 });
    // No lease at all for idReleased -- the "released" trigger.

    writeGrantFile(sweptDir, idSwept, { port: 7102 });
    const leasePath = writeLeaseFile(sweptDir, idSwept);
    ageLeaseFile(leasePath, 999); // far older than the tiny TTL used below

    const releasedResult = await runBrokerOnce(releasedDir, { basePort: 7102 });
    const sweptResult = await runBrokerOnce(sweptDir, { basePort: 7102, ttlS: 1 });

    const grantsReleased = existsSync(join(releasedDir, "grants"))
      ? readdirSync(join(releasedDir, "grants")).filter((f) => f.endsWith(".json"))
      : [];
    const grantsSwept = existsSync(join(sweptDir, "grants"))
      ? readdirSync(join(sweptDir, "grants")).filter((f) => f.endsWith(".json"))
      : [];
    assert.deepEqual(grantsReleased, [], "the released case must remove the grant");
    assert.deepEqual(grantsSwept, [], "the swept case must remove the grant");
    assert.equal(
      existsSync(join(sweptDir, "leases", idSwept)),
      false,
      "the sweep converts stale-but-present into missing BEFORE calling the shared teardown -- the lease itself must be gone too"
    );

    assert.match(releasedResult.stdout, new RegExp(`${idReleased}.*released`));
    assert.match(sweptResult.stdout, /swept \(stale \d+s, ttl 1s\)/, "the swept reason must be the only observable difference");
  } finally {
    rmSync(releasedDir, { recursive: true, force: true });
    rmSync(sweptDir, { recursive: true, force: true });
  }
});

test("teardown: a supervisor pid whose ps output does not name the supervisor script is refused, not signalled -- the grant is still removed", async () => {
  const dir = tmpPoolDir();
  try {
    const id = "req-4-4000-eeeeeeee";
    // process.pid (this very test runner) is a REAL, ALIVE pid whose own
    // `ps` args do not mention vice-supervisor.sh -- exactly the "possible
    // pid reuse" shape teardown() must refuse to signal.
    const grantPath = writeGrantFile(dir, id, { port: 7103, supervisorPid: process.pid });
    const { stderr } = await runBrokerOnce(dir, { basePort: 7103 });
    assert.equal(existsSync(grantPath), false, "the grant must still be removed even when the kill is refused");
    assert.match(stderr, new RegExp(`refusing to signal pid ${process.pid}`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("teardown: a lease refreshed to now survives at least three consecutive --once passes", async () => {
  const dir = tmpPoolDir();
  try {
    const id = "req-5-5000-ffffffff";
    const grantPath = writeGrantFile(dir, id, { port: 7104 });
    const leasePath = writeLeaseFile(dir, id);
    for (let i = 0; i < 3; i++) {
      ageLeaseFile(leasePath, 0); // refresh to "now" before each pass, like a heartbeat
      await runBrokerOnce(dir, { basePort: 7104 });
      assert.equal(existsSync(grantPath), true, `grant must survive pass ${i + 1}`);
      assert.equal(existsSync(leasePath), true, `lease must survive pass ${i + 1}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("broker.json and broker-instances.json are created with owner-only (0600) permissions", async () => {
  const dir = tmpPoolDir();
  try {
    await runBrokerOnce(dir, { basePort: 7105 });
    const brokerMode = statSync(join(dir, "broker.json")).mode & 0o777;
    assert.equal(brokerMode, 0o600, "broker.json must be owner-only");
    const instancesMode = statSync(join(dir, "broker-instances.json")).mode & 0o777;
    assert.equal(instancesMode, 0o600, "broker-instances.json must be owner-only, matching registry.json's own posture");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("status: prints the broker's own liveness line plus one line per broker-instances.json entry, naming its port", async () => {
  const dir = tmpPoolDir();
  try {
    const idA = "req-6-6000-11111111";
    const idB = "req-6-6001-22222222";
    writeGrantFile(dir, idA, { port: 7200 });
    writeLeaseFile(dir, idA);
    writeGrantFile(dir, idB, { port: 7201 });
    writeLeaseFile(dir, idB);
    // One pass regenerates broker-instances.json as a projection of the
    // (still-live, both leased) grants above.
    await runBrokerOnce(dir, { basePort: 7200 });

    const { stdout } = await execFileP("bash", [BROKER_SCRIPT, "status"], {
      env: { ...process.env, VICE_SUPERVISOR_ALLOW_CONTAINER: "1", VICE_POOL_DIR: dir },
    });
    assert.match(stdout, /7200/, "the first instance's port must be reported");
    assert.match(stdout, /7201/, "the second instance's port must be reported");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stop: with no broker.json present, still terminates a live recorded supervisor and purges protocol state", async () => {
  const dir = tmpPoolDir();
  const { brokerScript, supervisorScript } = brokerCopyWithSleepingSupervisor();
  let stubPid;
  try {
    const stub = spawn("bash", [supervisorScript], { stdio: "ignore", detached: true });
    stubPid = stub.pid;
    await waitFor(() => {
      try {
        process.kill(stubPid, 0);
        return true;
      } catch {
        return false;
      }
    });

    // A live, genuinely-running "supervisor" recorded in a grant, with NO
    // broker.json anywhere -- the exact shape of the ghost-grant incident
    // (a broker restarted, or never started this session, against
    // bookkeeping from an earlier one). `stop` must still reap this.
    const grantPath = writeGrantFile(dir, "req-qpq-1-9200-aaaaaaaa", { port: 9200, supervisorPid: stubPid, dryRun: false });
    assert.equal(existsSync(join(dir, "broker.json")), false, "sanity: no broker.json must exist for this scenario");

    const { stdout } = await execFileP("bash", [brokerScript, "stop"], {
      env: { ...process.env, VICE_SUPERVISOR_ALLOW_CONTAINER: "1", VICE_POOL_DIR: dir },
    });

    assert.match(stdout, /reap saw \d+ recorded instance/, "stop must report the reap even with no broker.json present");
    assert.equal(existsSync(grantPath), false, "the grant must be purged");

    const stubGone = await waitFor(() => {
      try {
        process.kill(stubPid, 0);
        return false;
      } catch {
        return true;
      }
    });
    assert.ok(stubGone, "the orphaned supervisor must be terminated even though no broker.json existed");
  } finally {
    if (stubPid) {
      try {
        process.kill(stubPid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(brokerScript), { recursive: true, force: true });
  }
});

test("stop: a supervisor pid whose ps identity does not match the supervisor script is refused, not signalled -- the process is still alive afterward and the refusal is logged", async () => {
  const dir = tmpPoolDir();
  try {
    // process.pid (this very test runner) is a REAL, ALIVE pid whose own
    // `ps` args do not mention vice-supervisor.sh -- exactly the "possible
    // pid reuse" shape signal_recorded_pid() must refuse to signal.
    const grantPath = writeGrantFile(dir, "req-qpq-2-9300-bbbbbbbb", { port: 9300, supervisorPid: process.pid, dryRun: false });
    const { stderr } = await execFileP("bash", [BROKER_SCRIPT, "stop"], {
      env: { ...process.env, VICE_SUPERVISOR_ALLOW_CONTAINER: "1", VICE_POOL_DIR: dir },
    });
    assert.match(stderr, new RegExp(`refusing to signal pid ${process.pid}`));
    // This very process must still be alive -- kill(pid, 0) throws if not.
    process.kill(process.pid, 0);
    // purge_protocol_state() still removes the whole grants/ directory
    // unconditionally, in EVERY case (matching cmd_start's broker_shutdown) --
    // the refusal above is what proves the kill itself was skipped, not
    // whether the bookkeeping file survives.
    assert.equal(existsSync(grantPath), false, "protocol state is still purged even when a signal was refused");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shutdown: a daemon sent SIGTERM terminates the supervisor pid recorded in spares/ and exits with all protocol state gone", async () => {
  const dir = tmpPoolDir();
  const { brokerScript, supervisorScript } = brokerCopyWithSleepingSupervisor();
  let stubPid;
  let daemon;
  try {
    const stub = spawn("bash", [supervisorScript], { stdio: "ignore", detached: true });
    stubPid = stub.pid;
    await waitFor(() => {
      try {
        process.kill(stubPid, 0);
        return true;
      } catch {
        return false;
      }
    });

    // state "launching", NOT "ready": drop_dead_instance_records()'s own
    // additional ready-spare/port_in_use() check (a separate must_have,
    // covered by its own test below) would otherwise drop this record
    // before broker_shutdown ever gets a chance to signal it -- this test's
    // sleeping stub never actually listens on a port, so it would look like
    // exactly the ghost-grant shape that check exists to catch. "launching"
    // is subject only to the pid liveness/identity check, which the live
    // stub genuinely satisfies.
    writeSpareFile(dir, 9100, { state: "launching", supervisorPid: stubPid, dryRun: false });

    daemon = spawn("bash", [brokerScript, "start"], {
      env: {
        ...process.env,
        VICE_SUPERVISOR_ALLOW_CONTAINER: "1",
        VICE_POOL_DIR: dir,
        VICE_BROKER_BASE_PORT: "9100",
        VICE_BROKER_SPARES: "0",
        VICE_BROKER_POLL_MS: "100",
      },
      stdio: "ignore",
    });

    const brokerJsonSeen = await waitFor(() => existsSync(join(dir, "broker.json")));
    assert.ok(brokerJsonSeen, "the daemon must write broker.json before this test proceeds");

    daemon.kill("SIGTERM");

    const daemonExited = await waitFor(() => daemon.exitCode !== null, { timeoutMs: 8000 });
    assert.ok(daemonExited, "the daemon must exit after SIGTERM");

    const stubGone = await waitFor(() => {
      try {
        process.kill(stubPid, 0);
        return false;
      } catch {
        return true;
      }
    });
    assert.ok(stubGone, "the recorded spare's supervisor pid must be terminated");

    for (const sub of ["spares", "grants", "requests", "leases"]) {
      assert.equal(existsSync(join(dir, sub)), false, `${sub}/ must be removed on shutdown`);
    }
    assert.equal(existsSync(join(dir, "broker.json")), false, "broker.json must be removed on shutdown");
    assert.equal(existsSync(join(dir, "broker-instances.json")), false, "broker-instances.json must be removed on shutdown");
  } finally {
    if (daemon && daemon.exitCode === null) {
      try {
        daemon.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
    if (stubPid) {
      try {
        process.kill(stubPid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(brokerScript), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// quick-260802-d6v Task 2: the --detach re-exec under setsid, and the
// foreground Ctrl-C warning. Every detach test here declares
// `{ timeout: 30000 }` and registers `t.after(() => reapDetached(dir, ref))`
// as its first statement -- node:test has no default timeout, so a
// regression that makes the parent block would otherwise hang the suite
// forever, and a leaked detached daemon polling every 200ms is worse than
// the defect this task fixes.

test(
  "start --detach: the promise resolves promptly, announces a live pid and log path, the child does not recurse, and a second run appends",
  { timeout: 30000 },
  async (t) => {
    const dir = tmpPoolDir();
    const ref = { pids: [] };
    t.after(() => reapDetached(dir, ref));

    const first = await startDetached(dir, { VICE_BROKER_BASE_PORT: "9500" });
    ref.pids.push(first.pid);

    // Reaching this assertion at all proves the promise resolved -- a
    // regression that made the parent block would instead time out the
    // whole test via the explicit { timeout: 30000 } above.
    process.kill(first.pid, 0); // throws if not a live process
    assert.equal(first.logPath, join(dir, "broker.log"), "the default log path must be <pool dir>/broker.log");
    assert.ok(existsSync(first.logPath), "the log file must exist");

    const logNonEmpty = await waitFor(() => {
      try {
        return readFileSync(first.logPath, "utf8").length > 0;
      } catch {
        return false;
      }
    });
    assert.ok(logNonEmpty, "the log must accumulate content from the daemon");

    // Recursion assertion: the parent-only announcement string must be
    // ABSENT from the child's own log -- its presence would mean the child
    // re-detached instead of taking the daemon path.
    const logContent = readFileSync(first.logPath, "utf8");
    assert.doesNotMatch(
      logContent,
      /detached broker running as pid/,
      "the child's own log must never contain the parent-only detach announcement -- its presence would prove recursion"
    );

    // A second --detach against the SAME dir/log must APPEND, not truncate:
    // the first run's bytes must still be present afterward.
    const second = await startDetached(dir, { VICE_BROKER_BASE_PORT: "9500" });
    ref.pids.push(second.pid);
    assert.notEqual(second.pid, first.pid, "the second run must be a genuinely different process");

    const logAfterSecond = readFileSync(second.logPath, "utf8");
    assert.ok(
      logAfterSecond.startsWith(logContent) || logAfterSecond.includes(logContent),
      "the first run's log bytes must still be present after a second --detach -- append, never truncate"
    );
  }
);

test(
  "start --detach: the detached daemon is a genuine session leader, in a DIFFERENT session than the test runner",
  { timeout: 30000 },
  async (t) => {
    const dir = tmpPoolDir();
    const ref = {};
    t.after(() => reapDetached(dir, ref));

    const { pid } = await startDetached(dir, { VICE_BROKER_BASE_PORT: "9510" });
    ref.pid = pid;

    const { stdout: childSidOut } = await execFileP("ps", ["-o", "sid=", "-p", String(pid)]);
    const { stdout: selfSidOut } = await execFileP("ps", ["-o", "sid=", "-p", String(process.pid)]);
    const childSid = childSidOut.trim();
    const selfSid = selfSidOut.trim();

    assert.notEqual(childSid, selfSid, "the detached daemon's session id must differ from the test runner's own");
    assert.equal(childSid, String(pid), "the detached daemon must be its own session leader (sid == pid)");
  }
);

test(
  "start (foreground, no --detach): warns on stderr naming Ctrl-C, other agents' sessions, and --detach, before it starts polling",
  { timeout: 30000 },
  async (t) => {
    const child = spawn("bash", [BROKER_SCRIPT, "start", "--dry-run"], {
      env: {
        ...process.env,
        VICE_SUPERVISOR_ALLOW_CONTAINER: "1",
        VICE_POOL_DIR: tmpPoolDir(),
        VICE_BROKER_SPARES: "0",
        VICE_BROKER_POLL_MS: "200",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(async () => {
      if (child.exitCode === null) {
        try {
          child.kill("SIGTERM");
        } catch {
          /* already gone */
        }
        await waitFor(() => child.exitCode !== null, { timeoutMs: 8000 });
      }
      if (child.exitCode === null) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    });

    let stderrAcc = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderrAcc += chunk;
    });

    const gotWarning = await waitFor(() => /FOREGROUND/.test(stderrAcc) && stderrAcc);
    assert.ok(gotWarning, `expected a foreground warning on stderr, got so far: ${stderrAcc}`);
    assert.match(stderrAcc, /Ctrl-C/, "the warning must name Ctrl-C");
    assert.match(stderrAcc, /other agents/i, "the warning must name other agents' sessions dying");
    assert.match(stderrAcc, /--detach/, "the warning must point at --detach as the remedy");
  }
);

// ---------------------------------------------------------------------------
// quick-260802-d6v Task 3: `stop` still reaps a detached broker -- the
// reap-on-signal contract PROVEN against a detached broker, not merely
// asserted in prose. Same non-negotiable cleanup protocol as Task 2's tests.

test(
  "stop reaps a detached broker: this is the reap-on-signal contract proven against a detached broker, not asserted in prose -- and the log survives the purge",
  { timeout: 30000 },
  async (t) => {
    const dir = tmpPoolDir();
    const ref = {};
    t.after(() => reapDetached(dir, ref));

    const { pid, logPath } = await startDetached(dir, { VICE_BROKER_BASE_PORT: "9520" });
    ref.pid = pid;

    const brokerJsonSeen = await waitFor(() => existsSync(join(dir, "broker.json")));
    assert.ok(brokerJsonSeen, "the detached daemon must write broker.json before this test proceeds");
    const brokerJson = JSON.parse(readFileSync(join(dir, "broker.json"), "utf8"));
    // Equality here is what proves `stop` will find the right process, and it
    // also confirms setsid did not fork out from under `$!` -- the pid the
    // parent printed IS the pid the daemon itself recorded.
    assert.equal(brokerJson.pid, pid, "broker.json's recorded pid must equal the pid the parent printed");

    const { stdout } = await execFileP("bash", [BROKER_SCRIPT, "stop"], {
      env: { ...process.env, VICE_SUPERVISOR_ALLOW_CONTAINER: "1", VICE_POOL_DIR: dir },
    });
    assert.match(stdout, /reap saw \d+ recorded instance/, "stop must report the reap");

    const daemonGone = await waitFor(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    });
    assert.ok(daemonGone, "stop must terminate the detached daemon");
    assert.equal(existsSync(join(dir, "broker.json")), false, "broker.json must be purged");
    for (const sub of ["spares", "grants", "requests", "leases"]) {
      assert.equal(existsSync(join(dir, sub)), false, `${sub}/ must be purged`);
    }

    // purge_protocol_state()'s untouched-ness, proven behaviourally here
    // next to the structural grep gate in the verify sweep: the log must
    // still exist after stop.
    assert.ok(existsSync(logPath), "the detached daemon's log must survive stop's purge -- purge_protocol_state() must never remove it");
  }
);

test("start --once: drops a non-dry-run record whose recorded pid is dead, drops a spare recorded ready whose port has no listener, and leaves a grant whose pid is a live, identity-matching supervisor untouched", async () => {
  const dir = tmpPoolDir();
  const { brokerScript, supervisorScript } = brokerCopyWithSleepingSupervisor();
  let stubPid;
  try {
    const stub = spawn("bash", [supervisorScript], { stdio: "ignore", detached: true });
    stubPid = stub.pid;
    await waitFor(() => {
      try {
        process.kill(stubPid, 0);
        return true;
      } catch {
        return false;
      }
    });

    // A dead pid -- chosen large and re-checked to be genuinely unused, not
    // just "probably" free, so this assertion cannot flake onto a real
    // process this host happens to be running.
    const deadPid = 999999;
    let deadPidIsFree = false;
    try {
      process.kill(deadPid, 0);
    } catch {
      deadPidIsFree = true;
    }
    assert.ok(deadPidIsFree, `test precondition failed: pid ${deadPid} is unexpectedly alive on this host`);

    // Case 1: pid is dead outright -- dropped regardless of state.
    const deadSparePath = writeSpareFile(dir, 9400, { state: "ready", supervisorPid: deadPid, dryRun: false });
    // Case 2: pid is genuinely alive and identity-matching, but recorded
    // "ready" while the sleeping stub never actually listens on its port --
    // exactly the ghost shape from the 2026-08-01 incident (bookkeeping
    // said ready; nothing answered). Must be dropped too.
    const ghostReadySparePath = writeSpareFile(dir, 9401, { state: "ready", supervisorPid: stubPid, dryRun: false });
    // Case 3: pid is genuinely alive and identity-matching, recorded as a
    // GRANT (leased) rather than a spare -- grants are validated on pid
    // liveness/identity only, never a port probe, so this must survive.
    const liveGrantPath = writeGrantFile(dir, "req-qpq-4-9402-dddddddd", { port: 9402, supervisorPid: stubPid, dryRun: false });

    await runBrokerOnce(dir, { basePort: 9403, spares: 0, dryRun: false, script: brokerScript });

    assert.equal(existsSync(deadSparePath), false, "a record whose pid is dead must be dropped at start time");
    assert.equal(existsSync(ghostReadySparePath), false, "a spare recorded ready whose port has no listener must be dropped, even with a live pid");
    assert.ok(existsSync(liveGrantPath), "a grant whose pid is a live, identity-matching supervisor must survive");
  } finally {
    if (stubPid) {
      try {
        process.kill(stubPid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(brokerScript), { recursive: true, force: true });
  }
});

test("start --once --dry-run: leaves dry-run grant and spare records untouched", async () => {
  const dir = tmpPoolDir();
  try {
    // No supervisor_pid at all is recorded for a dry-run entry in real use
    // (see launch_instance()'s own dry-run branch), but even a garbage /
    // clearly-dead pid on a dry_run:true record must be exempt from
    // drop_dead_instance_records() -- validating it at all would delete
    // every dry-run fixture this file's own suite depends on.
    const grantPath = writeGrantFile(dir, "req-qpq-3-9500-cccccccc", { port: 9500, supervisorPid: 999999, dryRun: true });
    const sparePath = writeSpareFile(dir, 9501, { state: "ready", supervisorPid: 999999, dryRun: true });

    await runBrokerOnce(dir, { basePort: 9500, spares: 0, dryRun: true });

    assert.ok(existsSync(grantPath), "a dry-run grant record must survive start-time validation");
    assert.ok(existsSync(sparePath), "a dry-run spare record must survive start-time validation");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Task 2: kill-never-recycle, and the request-id pattern parity between the
// shell script's own validation and vice-broker-client.mjs's isValidRequestId().

test("kill-never-recycle: a torn-down instance is never re-granted -- the next grant on that port is a distinct, freshly launched instance", async () => {
  const dir = tmpPoolDir();
  // quick-260801-qpq Task 2: grant_from_spare() now probes a ready spare
  // before granting it. This test's spares are fake bookkeeping (no real
  // listener behind them), so an always-succeeding probe stub keeps this
  // test exercising kill-never-recycle specifically, not the new grant-time
  // probe (which has its own dedicated tests above).
  const probe = alwaysSucceedProbe();
  try {
    const id1 = "req-7-7000-abcdef01";
    writeRequestFile(dir, id1);
    // createLease() runs BEFORE pollGrant() in vice-proxy.mjs's own
    // ensureBrokerLease() (see vice-proxy.mjs:696-699) -- a lease already
    // exists by the time the broker's own pass would grant this request, so
    // mirror that ordering here rather than granting into an immediate
    // same-pass sweep.
    writeLeaseFile(dir, id1);
    // Plan 04: grant_from_spare() only grants from a spare ALREADY in state
    // "ready" -- a bare cold-launched request needs a second pass to promote
    // (see the tracer test's own comment on this). Pre-planting a ready
    // spare at the SAME port this test's basePort would allocate first lets
    // this test keep its original one-pass-grants shape while still
    // exercising the real kill-never-recycle path this test is actually
    // about. Distinct supervisorPid/launchedAt from the second spare below
    // is what makes the "never recycled" assertions below meaningful.
    writeSpareFile(dir, 7300, { state: "ready", supervisorPid: 111111111111111, launchedAt: 111111111111111, readyAt: 111111111111111 });
    await runBrokerOnce(dir, { basePort: 7300, probeCmd: probe });

    const grant1Path = join(dir, "grants", `${id1}.json`);
    assert.ok(existsSync(grant1Path), "the first request must be granted");
    const grant1 = JSON.parse(readFileSync(grant1Path, "utf8"));
    assert.equal(grant1.dry_run, true);

    // Release: the lease goes away, exactly as releaseLease() (SIGINT) does.
    rmSync(join(dir, "leases", id1));
    await runBrokerOnce(dir, { basePort: 7300 }); // sweep pass tears the first grant down
    assert.equal(existsSync(grant1Path), false, "the released grant must be torn down");

    // A second request lands, deliberately targeting the SAME base port
    // range -- proving the port itself is not what makes an instance
    // grantable again.
    const id2 = "req-7-7001-abcdef02";
    writeRequestFile(dir, id2);
    writeLeaseFile(dir, id2);
    writeSpareFile(dir, 7300, { state: "ready", supervisorPid: 222222222222222, launchedAt: 222222222222222, readyAt: 222222222222222 });
    await runBrokerOnce(dir, { basePort: 7300, probeCmd: probe });

    const grant2Path = join(dir, "grants", `${id2}.json`);
    assert.ok(existsSync(grant2Path), "the second request must be granted");
    const grant2 = JSON.parse(readFileSync(grant2Path, "utf8"));

    assert.notEqual(
      grant2.supervisor_pid,
      grant1.supervisor_pid,
      "a torn-down instance's synthetic launch id must never reappear for a later grant -- a CONSTANT dry-run value here would make this assertion pass vacuously"
    );
    assert.ok(
      grant2.launched_at > grant1.launched_at,
      "the second grant's launched_at must be strictly later than the first, proving a fresh launch rather than a reused record"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(probe), { recursive: true, force: true });
  }
});

const ID_CORPUS = [
  { id: "req-1000-1700000000000-01234567", valid: true },
  { id: "req-1-1-abcdef01", valid: true },
  { id: "req-1000-1700000000000-../../etc", valid: false }, // ".." plus a separator
  { id: "/etc/passwd", valid: false }, // absolute-looking name
  { id: "", valid: false }, // empty id
  { id: "req-1000-1700000000000-ABCDEF01", valid: false }, // uppercase hex
  { id: "req-1000-1700000000000-01234567-extra", valid: false }, // extra trailing segment
];

test("parity: the shell script's own id validation and isValidRequestId() agree on every corpus entry", async () => {
  const dir = tmpPoolDir();
  // quick-260801-qpq Task 2: grant_from_spare() now probes each ready spare
  // before granting it. This test's pre-planted ready spares are fake
  // bookkeeping with no real listener, so an always-succeeding probe stub
  // keeps this test exercising id-validation parity, not the grant-time
  // probe itself (covered by its own dedicated tests above).
  const probe = alwaysSucceedProbe();
  try {
    const jsVerdicts = ID_CORPUS.map((c) => isValidRequestId(c.id));
    assert.deepEqual(
      jsVerdicts,
      ID_CORPUS.map((c) => c.valid),
      "sanity: the corpus's own expected verdicts must match isValidRequestId() before comparing against the shell side"
    );

    // Each candidate id is planted inside a SAFELY-NAMED request file's own
    // "id" JSON field -- several corpus entries (the ".." + separator case,
    // the absolute-looking name, the empty id) cannot themselves be real
    // filenames, so this drives the validation under test (the id CHECK)
    // rather than the filesystem's own separate restrictions, per this
    // task's own instruction.
    // Plan 04: each VALID id in this corpus also gets its own pre-planted
    // ready spare (see the kill-never-recycle test's own comment on why a
    // bare cold-launched request needs a second pass to grant) -- one
    // distinct port per valid entry, so this test can keep asserting a
    // single-pass grant/no-grant verdict per corpus entry, which is what it
    // is actually testing (id validation), not the multi-pass cold-launch
    // mechanics covered elsewhere.
    let readySparePort = 7400;
    let i = 0;
    for (const { id, valid } of ID_CORPUS) {
      writeRequestFileRaw(dir, `probe-${i}`, id);
      // A valid id needs a lease already in place, mirroring
      // vice-proxy.mjs's own createLease()-BEFORE-pollGrant() ordering --
      // otherwise this single --once pass would grant AND immediately sweep
      // it (lease absent) in the same call, which is a correct but
      // misleading-for-this-test outcome (see the kill-never-recycle test's
      // own comment on this exact ordering).
      if (valid) {
        writeLeaseFile(dir, id);
        writeSpareFile(dir, readySparePort, { state: "ready", readyAt: Date.now() * 1e6 });
        readySparePort++;
      }
      i++;
    }

    await runBrokerOnce(dir, { basePort: 7400, probeCmd: probe });

    const shellVerdicts = ID_CORPUS.map(({ id }) => existsSync(join(dir, "grants", `${id}.json`)));
    assert.deepEqual(
      shellVerdicts,
      ID_CORPUS.map((c) => c.valid),
      "the shell script's own request-scan verdicts must match isValidRequestId() for the same corpus"
    );

    // No file whose name contains ".." must ever be created anywhere under
    // the temp directory, across the WHOLE rejected-id corpus -- not just at
    // one predicted (and never-taken) path.
    const allFiles = listAllFilesRecursive(dir);
    assert.ok(
      allFiles.every((f) => !f.includes("..")),
      "no path segment containing .. may ever be created from a rejected id"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(probe), { recursive: true, force: true });
  }
});

/** Writes a request file under a SAFE outer filename (`${safeName}.json`)
 * whose JSON body's own "id" field is the (possibly filename-unsafe)
 * candidate -- the parity test's own vehicle for driving the shell script's
 * id CHECK independently of the filesystem's own path restrictions. */
function writeRequestFileRaw(dir, safeName, candidateId) {
  const rdir = join(dir, "requests");
  mkdirSync(rdir, { recursive: true });
  const record = {
    version: 1,
    id: candidateId,
    op: "acquire",
    proxy_pid: 1,
    session_id: null,
    client_pid: null,
    created_at: new Date().toISOString(),
  };
  writeFileSync(join(rdir, `${safeName}.json`), JSON.stringify(record, null, 2) + "\n");
}

test("a malformed request body is skipped with a logged reason while a well-formed request in the same pass is still granted", async () => {
  const dir = tmpPoolDir();
  // quick-260801-qpq Task 2: grant_from_spare() now probes the ready spare
  // before granting it -- an always-succeeding stub keeps this test about
  // malformed-request skipping, not the grant-time probe itself.
  const probe = alwaysSucceedProbe();
  try {
    const rdir = join(dir, "requests");
    mkdirSync(rdir, { recursive: true });
    writeFileSync(join(rdir, "garbage.json"), "not json at all {{{\n");

    const goodId = "req-8-8000-cafebabe";
    writeRequestFileRaw(dir, "good", goodId);
    writeLeaseFile(dir, goodId); // see the parity test's own comment on this ordering
    writeSpareFile(dir, 7500, { state: "ready", readyAt: Date.now() * 1e6 }); // see the parity test's own comment on this too

    const { stderr } = await runBrokerOnce(dir, { basePort: 7500, probeCmd: probe });
    assert.match(stderr, /skipping request garbage\.json/);
    assert.ok(existsSync(join(dir, "grants", `${goodId}.json`)), "a well-formed request in the same pass must still be granted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(probe), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Plan 04, Task 1: an instance is grantable only after it proves itself
// ready -- the launching -> ready state machine, the injectable probe seam,
// and the single function (maintain_spares) that owns both the ready_spares
// == N target and the total_instances <= MAX ceiling.

test("maintain_spares: with a spares target of 2 and an always-succeeding probe, warming is SERIALISED -- pass 1 records exactly one launching spare, pass 2 shows one ready plus one launching, pass 3 shows two ready -- never two launches in one pass", async () => {
  const dir = tmpPoolDir();
  const probe = alwaysSucceedProbe();
  try {
    await runBrokerOnce(dir, { basePort: 7700, spares: 2, probeCmd: probe });
    let files = existsSync(join(dir, "spares")) ? readdirSync(join(dir, "spares")).filter((f) => f.endsWith(".json")) : [];
    assert.equal(files.length, 1, "pass 1 must record exactly ONE spare -- never two or three simultaneous launches");
    let recs = files.map((f) => JSON.parse(readFileSync(join(dir, "spares", f), "utf8")));
    assert.equal(recs[0].state, "launching", "the pass-1 spare must not already be ready in this same pass");

    await runBrokerOnce(dir, { basePort: 7700, spares: 2, probeCmd: probe });
    files = readdirSync(join(dir, "spares")).filter((f) => f.endsWith(".json"));
    assert.equal(files.length, 2, "pass 2 must show exactly two spares -- one promoted, one newly launched");
    recs = files.map((f) => JSON.parse(readFileSync(join(dir, "spares", f), "utf8")));
    const states2 = recs.map((r) => r.state).sort();
    assert.deepEqual(states2, ["launching", "ready"], "pass 2 must show one ready (promoted from pass 1) plus one launching (this pass's own new launch)");

    await runBrokerOnce(dir, { basePort: 7700, spares: 2, probeCmd: probe });
    files = readdirSync(join(dir, "spares")).filter((f) => f.endsWith(".json"));
    assert.equal(files.length, 2, "no additional spares beyond the target once both are ready");
    recs = files.map((f) => JSON.parse(readFileSync(join(dir, "spares", f), "utf8")));
    for (const rec of recs) {
      assert.equal(rec.state, "ready", "pass 3 must show both entries ready");
      assert.ok(rec.ready_at, "a promoted entry must record ready_at");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(probe), { recursive: true, force: true });
  }
});

test("maintain_spares: with a spare already launching and a probe that never promotes, a pass with a spares target of 3 adds no second spare and says on stderr that it is waiting", async () => {
  const dir = tmpPoolDir();
  const probe = alwaysFailProbe();
  try {
    const port = 7705;
    writeSpareFile(dir, port, { state: "launching" });

    const { stderr } = await runBrokerOnce(dir, { basePort: port + 1, spares: 3, probeCmd: probe });

    assert.match(stderr, /spare warming waits/, "must log that warming waits for the boot already in flight");
    const files = readdirSync(join(dir, "spares")).filter((f) => f.endsWith(".json"));
    assert.equal(files.length, 1, "no second spare may be added while one is already launching, regardless of the target");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(probe), { recursive: true, force: true });
  }
});

test("process_requests: a pending request that finds no ready spare while a launch is already in flight writes neither a grant nor a denial and triggers no second launch", async () => {
  const dir = tmpPoolDir();
  try {
    const inFlightPort = 7715;
    writeSpareFile(dir, inFlightPort, { state: "launching" });

    const id = "req-20-7716-eeeeeeee";
    writeRequestFile(dir, id);
    writeLeaseFile(dir, id);

    const { stderr } = await runBrokerOnce(dir, { basePort: inFlightPort + 1, spares: 0 });

    assert.match(stderr, /already in flight/, "must log that a launch is already in flight for this request");
    assert.equal(existsSync(join(dir, "grants", `${id}.json`)), false, "no grant may be written while a launch is in flight");
    assert.equal(existsSync(join(dir, "denials", `${id}.json`)), false, "no denial may be written while a launch is in flight");
    assert.ok(existsSync(join(dir, "requests", `${id}.json`)), "the request must remain pending for a later pass");

    const spareFiles = readdirSync(join(dir, "spares")).filter((f) => f.endsWith(".json"));
    assert.equal(spareFiles.length, 1, "no second (cold) launch may be triggered while one is already in flight");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("grant_from_spare: with two ready spares and a probe that fails only for the lower port, the grant goes to the higher port, the lower spare's record is gone, and the drop is logged", async () => {
  const dir = tmpPoolDir();
  const lowerPort = 7725;
  const higherPort = 7726;
  const probe = makeProbeStub(`
if [ "$1" = "${lowerPort}" ]; then exit 1; else exit 0; fi
`);
  try {
    writeSpareFile(dir, lowerPort, { state: "ready", readyAt: Date.now() * 1e6 });
    writeSpareFile(dir, higherPort, { state: "ready", readyAt: Date.now() * 1e6 });

    const id = "req-21-7727-ffffffff";
    writeRequestFile(dir, id);
    writeLeaseFile(dir, id);

    const { stdout, stderr } = await runBrokerOnce(dir, { basePort: 7728, spares: 0, probeCmd: probe });

    assert.match(stderr, new RegExp(`dropped stale ready spare on port ${lowerPort}`), "the lower port's failed probe must be logged as a drop");
    assert.match(stdout, new RegExp(`granted request ${id} -> port ${higherPort}`), "the grant must go to the higher port, whose probe succeeded");

    const grant = JSON.parse(readFileSync(join(dir, "grants", `${id}.json`), "utf8"));
    assert.equal(grant.port, higherPort, "the grant record itself must carry the higher port");
    assert.equal(existsSync(join(dir, "spares", `${lowerPort}.json`)), false, "the lower port's stale ready record must be gone");
    assert.equal(existsSync(join(dir, "spares", `${higherPort}.json`)), false, "the higher port's spare record is consumed by the grant, same as any other grant_from_spare() success");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(probe), { recursive: true, force: true });
  }
});

test("maintain_spares: with a never-succeeding probe, no grant is ever issued and every entry remains in state launching", async () => {
  const dir = tmpPoolDir();
  const probe = alwaysFailProbe();
  try {
    const port = 7710;
    writeSpareFile(dir, port, { state: "launching" });
    for (let i = 0; i < 3; i++) {
      await runBrokerOnce(dir, { basePort: port, spares: 0, probeCmd: probe });
    }
    const rec = JSON.parse(readFileSync(join(dir, "spares", `${port}.json`), "utf8"));
    assert.equal(rec.state, "launching", "must remain launching across repeated passes");
    // grants/ itself is unconditionally mkdir -p'd on every pass (matching
    // requests/denials/leases/spares) regardless of whether anything is ever
    // written into it -- the real assertion is that it holds NO FILES.
    const grantFiles = existsSync(join(dir, "grants")) ? readdirSync(join(dir, "grants")).filter((f) => f.endsWith(".json")) : [];
    assert.deepEqual(grantFiles, [], "no grant can ever come from an entry that never becomes ready");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(probe), { recursive: true, force: true });
  }
});

test("write_json_atomic: a --once --dry-run pass promoting a launching spare leaves no .broker.* file and no *.tmp file anywhere under the pool dir, and every protocol file it wrote is intact JSON at mode 600", async () => {
  const dir = tmpPoolDir();
  const probe = alwaysSucceedProbe();
  try {
    const port = 7730;
    writeSpareFile(dir, port, { state: "launching" });

    await runBrokerOnce(dir, { basePort: port, spares: 0, probeCmd: probe });

    const allFiles = listAllFilesRecursive(dir);
    assert.ok(
      !allFiles.some((f) => /(^|\/)\.broker\./.test(f)),
      `expected no .broker.* file anywhere under the pool dir, found: ${JSON.stringify(allFiles)}`
    );
    assert.ok(
      !allFiles.some((f) => f.endsWith(".tmp")),
      `expected no leftover *.tmp file anywhere under the pool dir, found: ${JSON.stringify(allFiles)}`
    );

    const brokerJsonPath = join(dir, "broker.json");
    const brokerInstancesPath = join(dir, "broker-instances.json");
    const sparePath = join(dir, "spares", `${port}.json`);

    for (const p of [brokerJsonPath, brokerInstancesPath, sparePath]) {
      const parsed = JSON.parse(readFileSync(p, "utf8")); // throws if not valid JSON
      assert.ok(parsed, `${p} must parse as JSON`);
      assert.equal(statSync(p).mode & 0o777, 0o600, `${p} must be mode 600`);
    }
    assert.equal(JSON.parse(readFileSync(sparePath, "utf8")).state, "ready", "the planted spare must have been promoted");

    // Structural: write_json_atomic() no longer names the old random-name
    // utility, and does contain both the ".tmp" suffix and the explicit
    // chmod 600 -- slice starts at the definition line, deliberately AFTER
    // the header comment, so the comment's historical discussion of the old
    // approach cannot trip this assertion; it is about code, not prose.
    const src = readFileSync(BROKER_SCRIPT, "utf8");
    const defStart = src.indexOf("write_json_atomic() {");
    const defEnd = src.indexOf("\n}\n", defStart);
    assert.ok(defStart > 0 && defEnd > defStart, "write_json_atomic() must be found in the source");
    const body = src.slice(defStart, defEnd);
    assert.doesNotMatch(body, /mktemp/, "write_json_atomic() body must no longer call mktemp");
    assert.match(body, /\.tmp/, "write_json_atomic() body must construct a .tmp sibling path");
    assert.match(body, /chmod 600/, "write_json_atomic() body must still chmod 600 explicitly");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(probe), { recursive: true, force: true });
  }
});

test("maintain_spares boot-time log: a promotion whose spare record carries a launch timestamp 250ms in the past logs a millisecond figure >= 250 plus a poll-interval caveat that reads VICE_BROKER_POLL_MS, not a hardcoded default", async () => {
  const dir = tmpPoolDir();
  const probe = alwaysSucceedProbe();
  try {
    const port = 7740;
    // 250ms in the past, in the nanosecond units the field uses -- the same
    // Number idiom writeSpareFile()'s own default already uses -- so the
    // lower bound is deterministic instead of hoping a subprocess spawn
    // takes measurable time, while never pinning an exact value.
    writeSpareFile(dir, port, { state: "launching", launchedAt: Date.now() * 1e6 - 250e6 });

    const { stdout } = await runBrokerOnce(dir, { basePort: port, spares: 0, probeCmd: probe, pollMs: 137 });

    const match = stdout.match(/launching -> ready \((\d+)ms, upper bound: polled every (\d+)ms\)/);
    assert.ok(match, `expected the promotion log line shape in stdout, got: ${stdout}`);
    assert.ok(Number(match[1]) >= 250, `expected elapsed ms >= 250, got ${match[1]}`);
    assert.equal(Number(match[2]), 137, "the poll-interval caveat must equal the distinctive VICE_BROKER_POLL_MS passed, not the 500 default");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(probe), { recursive: true, force: true });
  }
});

test("maintain_spares boot-time log: a spare record with no launched_at key at all renders '?' in the elapsed position and never a zero millisecond figure", async () => {
  const dir = tmpPoolDir();
  const probe = alwaysSucceedProbe();
  try {
    const port = 7741;
    const sparePath = writeSpareFile(dir, port, { state: "launching" });
    // launchedAt: null is NOT sufficient -- writeSpareFile() still emits the
    // key with a null value, and what the shell branch tests is whether the
    // extracted value is EMPTY. Only deleting the key genuinely reproduces
    // that.
    const record = JSON.parse(readFileSync(sparePath, "utf8"));
    delete record.launched_at;
    writeFileSync(sparePath, JSON.stringify(record, null, 2) + "\n");

    const { stdout } = await runBrokerOnce(dir, { basePort: port, spares: 0, probeCmd: probe });

    assert.match(
      stdout,
      new RegExp(`port ${port} launching -> ready \\(\\?ms, upper bound: polled every \\d+ms\\)`),
      `expected the '?' fallback for a missing launched_at, got: ${stdout}`
    );
    assert.doesNotMatch(
      stdout,
      new RegExp(`port ${port} launching -> ready \\(0ms`),
      `a missing launched_at must never render as 0ms, got: ${stdout}`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(probe), { recursive: true, force: true });
  }
});

test("maintain_spares: with a probe that fails twice then succeeds, the entry transitions launching -> ready on the third pass and not before", async () => {
  const dir = tmpPoolDir();
  const probe = failNTimesThenSucceedProbe(2);
  try {
    const port = 7720;
    writeSpareFile(dir, port, { state: "launching" });

    await runBrokerOnce(dir, { basePort: port, spares: 0, probeCmd: probe });
    assert.equal(
      JSON.parse(readFileSync(join(dir, "spares", `${port}.json`), "utf8")).state,
      "launching",
      "pass 1 (probe fails) must not promote"
    );

    await runBrokerOnce(dir, { basePort: port, spares: 0, probeCmd: probe });
    assert.equal(
      JSON.parse(readFileSync(join(dir, "spares", `${port}.json`), "utf8")).state,
      "launching",
      "pass 2 (probe still fails) must not promote"
    );

    await runBrokerOnce(dir, { basePort: port, spares: 0, probeCmd: probe });
    assert.equal(
      JSON.parse(readFileSync(join(dir, "spares", `${port}.json`), "utf8")).state,
      "ready",
      "pass 3 (probe now succeeds) must promote"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(probe), { recursive: true, force: true });
  }
});

// The leased/total/ready table from 01.2-04-PLAN.md's own <behavior> block
// (and the design note's "What N means" table it reproduces), each row
// planted as an ALREADY-CONVERGED steady state -- this proves the invariant
// HOLDS (is not disturbed by a further pass), which is the property
// maintain_spares() exists to maintain, not the separate bootstrap-from-zero
// convergence already covered by the always-succeeding-probe test above.
const INVARIANT_TABLE = [
  { leased: 0, sparesTarget: 3, max: 16, expectTotal: 3, expectReady: 3 },
  { leased: 2, sparesTarget: 3, max: 16, expectTotal: 5, expectReady: 3 },
  { leased: 13, sparesTarget: 3, max: 16, expectTotal: 16, expectReady: 3 },
  { leased: 16, sparesTarget: 3, max: 16, expectTotal: 16, expectReady: 0 },
  { leased: 3, sparesTarget: 3, max: 4, expectTotal: 4, expectReady: 1 },
];

test("the leased/total/ready invariant table is reproduced exactly, and holds under a further pass", async () => {
  const probe = alwaysSucceedProbe();
  try {
    for (const row of INVARIANT_TABLE) {
      const dir = tmpPoolDir();
      try {
        let port = 8000;
        for (let i = 0; i < row.leased; i++) {
          writeGrantFile(dir, `req-inv-${port}`, { port });
          writeLeaseFile(dir, `req-inv-${port}`);
          port++;
        }
        for (let i = 0; i < row.expectReady; i++) {
          writeSpareFile(dir, port, { state: "ready", readyAt: Date.now() * 1e6 });
          port++;
        }

        const { stdout } = await runBrokerOnce(dir, {
          basePort: port,
          spares: row.sparesTarget,
          max: row.max,
          probeCmd: probe,
        });

        const spareFiles = existsSync(join(dir, "spares")) ? readdirSync(join(dir, "spares")).filter((f) => f.endsWith(".json")) : [];
        const grantFiles = existsSync(join(dir, "grants")) ? readdirSync(join(dir, "grants")).filter((f) => f.endsWith(".json")) : [];
        const totalNow = spareFiles.length + grantFiles.length;
        const readyNow = spareFiles.filter(
          (f) => JSON.parse(readFileSync(join(dir, "spares", f), "utf8")).state === "ready"
        ).length;

        assert.equal(totalNow, row.expectTotal, `leased=${row.leased}, max=${row.max}: total must stay ${row.expectTotal}`);
        assert.equal(readyNow, row.expectReady, `leased=${row.leased}, max=${row.max}: ready must stay ${row.expectReady}`);
        assert.doesNotMatch(
          stdout,
          /vice-broker: launched port/,
          `leased=${row.leased}, max=${row.max}: an already-converged invariant must not trigger a further launch`
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  } finally {
    rmSync(dirname(probe), { recursive: true, force: true });
  }
});

test("maintain_spares: with no readiness mechanism available (VICE_BROKER_PROBE_CMD unset, curl absent), zero spares are warmed and one line names why -- but a genuinely pending request is still satisfied", async () => {
  const dir = tmpPoolDir();
  const noCurlPath = pathWithoutCurl();
  try {
    const id = "req-9-9000-f00dcafe";
    writeRequestFile(dir, id);
    writeLeaseFile(dir, id);

    const env = {
      PATH: noCurlPath,
      VICE_SUPERVISOR_ALLOW_CONTAINER: "1",
      VICE_POOL_DIR: dir,
      VICE_BROKER_BASE_PORT: "7900",
      VICE_BROKER_SPARES: "3",
    };
    const pass1 = await execFileP("bash", [BROKER_SCRIPT, "--once", "--dry-run"], { env });
    assert.match(pass1.stderr, /no readiness probe available/, "pass 1 must log exactly why zero spares are being warmed");
    assert.match(pass1.stderr, /VICE_BROKER_PROBE_CMD/, "the log line must name the missing command");

    const spareFiles = readdirSync(join(dir, "spares")).filter((f) => f.endsWith(".json"));
    assert.equal(spareFiles.length, 1, "only the ONE cold instance for the pending request exists -- zero SPECULATIVE spares");

    const pass2 = await execFileP("bash", [BROKER_SCRIPT, "--once", "--dry-run"], { env });
    void pass2;
    assert.ok(
      existsSync(join(dir, "grants", `${id}.json`)),
      "the pending request must still be satisfied via the cold path even with no readiness mechanism at all"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(noCurlPath, { recursive: true, force: true });
  }
});

test("structural: maintain_spares has exactly one definition and one call site", () => {
  const src = readFileSync(BROKER_SCRIPT, "utf8");
  // Deliberately stricter than a bare substring count: the usage() heredoc's
  // own prose mentions "maintain_spares()" (with parens, inside a sentence)
  // several times as documentation, which is neither a definition nor a bare
  // call site. A definition line looks like `maintain_spares() {` with no
  // leading whitespace (top-level function); the one real call site is a
  // BARE name on its own line inside broker_once() (no parens, no trailing
  // text) -- neither shape occurs anywhere in the usage prose.
  const defs = (src.match(/^maintain_spares\(\)\s*\{/gm) || []).length;
  const callSites = (src.match(/^\s*maintain_spares\s*$/gm) || []).length;
  assert.equal(defs, 1, `expected exactly one maintain_spares() definition, found ${defs}`);
  assert.equal(callSites, 1, `expected exactly one bare maintain_spares call site, found ${callSites}`);
});

test("structural: port_in_use is never called inside probe_ready", () => {
  const src = readFileSync(BROKER_SCRIPT, "utf8");
  const probeReadyStart = src.indexOf("probe_ready() {");
  const probeReadyEnd = src.indexOf("\n}\n", probeReadyStart);
  assert.ok(probeReadyStart > 0 && probeReadyEnd > probeReadyStart, "probe_ready() must be found in the source");
  const probeReadyBody = src.slice(probeReadyStart, probeReadyEnd);
  assert.doesNotMatch(probeReadyBody, /port_in_use/, "probe_ready() must never reuse port_in_use() -- a TCP accept is not readiness");
});

test("structural: VICE_BROKER_PROBE_CMD is invoked with the port as a positional argument, never interpolated into a command string", () => {
  const src = readFileSync(BROKER_SCRIPT, "utf8");
  assert.match(src, /"\$VICE_BROKER_PROBE_CMD"\s+"\$port"/, "must invoke as two separate quoted arguments, not a single interpolated string");
});

test("structural: bash -n exits 0; start still refuses in-container with exit 2; --check-container still exits 3", async () => {
  await execFileP("bash", ["-n", BROKER_SCRIPT]); // rejects (throws) on a non-zero exit

  await assert.rejects(
    execFileP("bash", [BROKER_SCRIPT, "start", "--once", "--dry-run"], {
      env: { ...process.env, VICE_POOL_DIR: tmpPoolDir(), VICE_SUPERVISOR_ALLOW_CONTAINER: undefined },
    }),
    (err) => err.code === 2,
    "start must refuse with exit 2 without the escape hatch, inside this devcontainer"
  );

  await assert.rejects(
    execFileP("bash", [BROKER_SCRIPT, "--check-container"]),
    (err) => err.code === 3,
    "--check-container must exit 3 inside a container"
  );
});

// ---------------------------------------------------------------------------
// quick-260802-d6v Task 1: --detach parse surface (rejections + --help
// documentation). The re-exec itself is Task 2; none of these tests starts a
// daemon, so none needs the detach cleanup protocol.

test("--detach with --once exits 1 and stderr names both flags, for both the explicit 'start' spelling and the bare-subcommand spelling", async () => {
  await assert.rejects(
    execFileP("bash", [BROKER_SCRIPT, "start", "--detach", "--once", "--dry-run"], {
      env: { ...process.env, VICE_SUPERVISOR_ALLOW_CONTAINER: "1", VICE_POOL_DIR: tmpPoolDir() },
    }),
    (err) => err.code === 1 && /--detach/.test(err.stderr) && /--once/.test(err.stderr),
    "explicit 'start --detach --once' must exit 1 naming both flags"
  );

  await assert.rejects(
    execFileP("bash", [BROKER_SCRIPT, "--detach", "--once", "--dry-run"], {
      env: { ...process.env, VICE_SUPERVISOR_ALLOW_CONTAINER: "1", VICE_POOL_DIR: tmpPoolDir() },
    }),
    (err) => err.code === 1 && /--detach/.test(err.stderr) && /--once/.test(err.stderr),
    "bare '--detach --once' (no explicit subcommand) must exit 1 naming both flags"
  );
});

test("--detach is refused on 'stop' and on 'status', each naming 'start' as the only valid subcommand", async () => {
  await assert.rejects(
    execFileP("bash", [BROKER_SCRIPT, "stop", "--detach"], {
      env: { ...process.env, VICE_SUPERVISOR_ALLOW_CONTAINER: "1", VICE_POOL_DIR: tmpPoolDir() },
    }),
    (err) => err.code === 1 && /start/.test(err.stderr),
    "'stop --detach' must exit 1 naming 'start'"
  );

  await assert.rejects(
    execFileP("bash", [BROKER_SCRIPT, "status", "--detach"], {
      env: { ...process.env, VICE_SUPERVISOR_ALLOW_CONTAINER: "1", VICE_POOL_DIR: tmpPoolDir() },
    }),
    (err) => err.code === 1 && /start/.test(err.stderr),
    "'status --detach' must exit 1 naming 'start'"
  );
});

test("--help documents --detach and VICE_BROKER_LOG, and still documents the EXIT/HUP/INT/TERM trap -- a regression guard on the shutdown contract's documentation, not decoration", async () => {
  const { stdout } = await execFileP("bash", [BROKER_SCRIPT, "--help"]);
  assert.match(stdout, /--detach/, "--help must name --detach");
  assert.match(stdout, /VICE_BROKER_LOG/, "--help must name VICE_BROKER_LOG");
  assert.match(
    stdout,
    /EXIT\/HUP\/INT\/TERM/,
    "--help must still document the trap -- the shutdown contract must not have been documented away"
  );
});

// ---------------------------------------------------------------------------
// Plan 04, Task 2: grant from a ready spare, refill behind it, and
// distinguish "not yet" (neither grant nor denial) from "never" (denial with
// the broker's own reason verbatim).

test("grant_from_spare: with one ready spare and one incoming request, the grant is issued in the same pass, and maintain_spares launches a replacement in the same pass", async () => {
  const dir = tmpPoolDir();
  const probe = alwaysSucceedProbe();
  try {
    const id = "req-10-10000-aaaaaaaa";
    writeSpareFile(dir, 8100, { state: "ready", readyAt: Date.now() * 1e6 });
    writeRequestFile(dir, id);
    writeLeaseFile(dir, id);

    const { stdout } = await runBrokerOnce(dir, { basePort: 8100, spares: 1, probeCmd: probe });

    assert.match(stdout, new RegExp(`granted request ${id} -> port 8100`), "the grant must be issued in this same pass");
    const grant = JSON.parse(readFileSync(join(dir, "grants", `${id}.json`), "utf8"));
    assert.equal(grant.port, 8100, "the grant must carry the spare's own port");

    assert.match(stdout, /vice-broker: launched port \d+ \(reason: spare\)/, "a replacement spare must be launched in this SAME pass");
    const spareFiles = readdirSync(join(dir, "spares")).filter((f) => f.endsWith(".json"));
    assert.equal(spareFiles.length, 1, "exactly one replacement spare must exist after the grant consumed the original");
    assert.notEqual(
      Number(spareFiles[0].replace(/\.json$/, "")),
      8100,
      "the replacement must be a DIFFERENT port from the one just granted"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(probe), { recursive: true, force: true });
  }
});

test("cold path: with zero ready spares, the pass launches a cold instance and writes neither a grant nor a denial; a later pass, once the probe succeeds, writes the grant", async () => {
  const dir = tmpPoolDir();
  const probe = alwaysSucceedProbe();
  try {
    const id = "req-11-11000-bbbbbbbb";
    writeRequestFile(dir, id);
    writeLeaseFile(dir, id);

    await runBrokerOnce(dir, { basePort: 8200, spares: 0, probeCmd: probe });
    assert.equal(existsSync(join(dir, "grants", `${id}.json`)), false, "the intermediate pass must write no grant for this id");
    assert.equal(existsSync(join(dir, "denials", `${id}.json`)), false, "the intermediate pass must write no denial for this id");
    assert.ok(existsSync(join(dir, "requests", `${id}.json`)), "the request file must still exist after the intermediate pass");

    await runBrokerOnce(dir, { basePort: 8200, spares: 0, probeCmd: probe });
    assert.ok(existsSync(join(dir, "grants", `${id}.json`)), "a later pass must write the grant once the probe has succeeded");
    assert.equal(existsSync(join(dir, "requests", `${id}.json`)), false, "the request file must be gone once granted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(probe), { recursive: true, force: true });
  }
});

test("deny: the ceiling reached with nothing ready and nothing launchable produces a denial naming the ceiling and current counts", async () => {
  const dir = tmpPoolDir();
  try {
    writeGrantFile(dir, "req-12-12000-cccccccc", { port: 8300 });
    writeLeaseFile(dir, "req-12-12000-cccccccc");

    const id = "req-12-12001-dddddddd";
    writeRequestFile(dir, id);
    writeLeaseFile(dir, id);

    const { stdout } = await runBrokerOnce(dir, { basePort: 8300, spares: 0, max: 1 });
    assert.match(stdout, new RegExp(`denied request ${id}`));
    const denial = JSON.parse(readFileSync(join(dir, "denials", `${id}.json`), "utf8"));
    assert.match(denial.reason, /ceiling/i);
    assert.match(denial.reason, /1/, "the reason must name the concrete ceiling/count");
    assert.equal(existsSync(join(dir, "requests", `${id}.json`)), false, "a denied request must be unlinked");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deny: a launch failing because the target port is already bound produces a denial naming the port and the cause", async () => {
  const dir = tmpPoolDir();
  const server = createServer(() => {});
  try {
    const boundPort = await listen(server);

    const id = "req-13-13000-eeeeeeee";
    writeRequestFile(dir, id);
    writeLeaseFile(dir, id);

    // Non-dry-run: port_in_use() is checked ONLY outside --dry-run (see
    // launch_instance()'s own comment) -- but since a bound port refuses
    // BEFORE any real spawn is ever attempted, no real x64sc/supervisor
    // process is spawned here at all.
    const { stdout } = await runBrokerOnce(dir, { basePort: boundPort, spares: 0, dryRun: false });
    assert.match(stdout, new RegExp(`denied request ${id}`));
    const denial = JSON.parse(readFileSync(join(dir, "denials", `${id}.json`), "utf8"));
    assert.match(denial.reason, /already bound/);
    assert.match(denial.reason, new RegExp(String(boundPort)));
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deny: a missing supervisor script at the resolved sibling path produces a denial naming the missing path", async () => {
  const dir = tmpPoolDir();
  const brokerCopy = brokerCopyMissingSupervisor();
  try {
    const id = "req-14-14000-ffffffff";
    writeRequestFile(dir, id);
    writeLeaseFile(dir, id);

    const { stdout } = await runBrokerOnce(dir, { basePort: 8400, spares: 0, script: brokerCopy });
    assert.match(stdout, new RegExp(`denied request ${id}`));
    const denial = JSON.parse(readFileSync(join(dir, "denials", `${id}.json`), "utf8"));
    assert.match(denial.reason, /supervisor script not found/);
    assert.match(denial.reason, /vice-supervisor\.sh/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(brokerCopy), { recursive: true, force: true });
  }
});

test("grant_from_spare: never selects an entry in state launching or leased -- only ready", async () => {
  const dir = tmpPoolDir();
  try {
    writeSpareFile(dir, 8500, { state: "launching" });
    writeGrantFile(dir, "req-15-15000-11112222", { port: 8501 });
    writeLeaseFile(dir, "req-15-15000-11112222");

    const id = "req-15-15001-33334444";
    writeRequestFile(dir, id);
    writeLeaseFile(dir, id);

    await runBrokerOnce(dir, { basePort: 8500, spares: 0 });
    // No READY spare exists (only a launching one and an already-leased
    // one), so this request cannot be satisfied instantly at all -- it must
    // fall through to the cold-launch path (deferred, per the cold-path test
    // above), NOT reuse the launching or leased entry's port. Either way the
    // key assertion is the same: no grant for THIS id appears in this pass.
    assert.equal(existsSync(join(dir, "grants", `${id}.json`)), false, "no grant may be produced from a launching or leased entry");

    // The pre-existing launching (8500) and leased (8501) entries must be
    // completely undisturbed by this pass -- confirming grant_from_spare()
    // never touched either of them while looking for a ready candidate.
    const spareRec = JSON.parse(readFileSync(join(dir, "spares", "8500.json"), "utf8"));
    assert.equal(spareRec.state, "launching", "the pre-existing launching entry must be untouched");
    assert.ok(existsSync(join(dir, "grants", "req-15-15000-11112222.json")), "the pre-existing leased grant must be untouched");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("release-then-pass produces both a teardown log line and a refill launch log line", async () => {
  const dir = tmpPoolDir();
  const probe = alwaysSucceedProbe();
  try {
    const id = "req-16-16000-55556666";
    writeGrantFile(dir, id, { port: 8600 });
    writeLeaseFile(dir, id);

    rmSync(join(dir, "leases", id));
    const { stdout } = await runBrokerOnce(dir, { basePort: 8600, spares: 1, probeCmd: probe });

    assert.match(stdout, new RegExp(`${id}.*released`), "the teardown must be logged");
    assert.match(stdout, /vice-broker: launched port \d+ \(reason: spare\)/, "the refill launch must ALSO be logged in the same pass");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(probe), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Spare warming must survive a port that is bound by something outside the
// broker's own bookkeeping. Regression test for the live spin observed on
// 2026-08-01: maintain_spares() discarded launch_instance()'s return value,
// so a refused launch incremented the ready/total counters as if it had
// succeeded. The pass then reported success (no daemon backoff), count_ready()
// still read 0 on the next pass, and the same bound port was re-selected and
// re-logged on every poll, forever. Runs WITHOUT --dry-run because
// port_in_use() is deliberately skipped under dry-run, against a stub
// supervisor so no real x64sc is ever spawned.

test("spare warming: a port bound by another process is skipped, not retried forever, and the next port is used instead", async () => {
  const dir = tmpPoolDir();
  const basePort = 8730;
  const release = await occupyPort(basePort);
  try {
    const { stderr } = await runBrokerOnce(dir, {
      basePort,
      spares: 1,
      dryRun: false,
      probeCmd: "/bin/false", // a probe that exists but never promotes
      script: brokerCopyWithStubSupervisor(),
    });

    assert.match(
      stderr,
      new RegExp(`refusing to launch on port ${basePort}`),
      "the bound base port must be refused, naming that port"
    );

    // THE REGRESSION ASSERTION: the pass must advance past the bound port and
    // actually warm a spare on the next one. Under the old code the refusal
    // was swallowed, the counters advanced anyway, and no spare file was ever
    // written at any port.
    const spares = readdirSync(join(dir, "spares")).filter((f) => f.endsWith(".json"));
    assert.deepEqual(
      spares,
      [`${basePort + 1}.json`],
      `exactly one spare must exist, on port ${basePort + 1} -- got ${JSON.stringify(spares)}`
    );

    // Logged once per port, not once per attempt: the refusal names the bound
    // port a single time even though the loop iterated past it.
    const refusals = (stderr.match(new RegExp(`refusing to launch on port ${basePort}\\b`, "g")) || []).length;
    assert.equal(refusals, 1, `the bound port must be logged exactly once, saw ${refusals}`);
  } finally {
    await release();
  }
});

test("spare warming: when every candidate port is bound, the pass says so once and stops instead of spinning", async () => {
  const dir = tmpPoolDir();
  const basePort = 8760;
  // VICE_BROKER_MAX caps the attempt loop, so bounding a small window is
  // enough to prove the loop terminates rather than scanning unbounded.
  const releases = [];
  for (let p = basePort; p < basePort + 3; p++) releases.push(await occupyPort(p));
  try {
    const { stderr } = await runBrokerOnce(dir, {
      basePort,
      spares: 2,
      max: 3,
      dryRun: false,
      probeCmd: "/bin/false",
      script: brokerCopyWithStubSupervisor(),
    });
    assert.match(stderr, /stopping spare warming for this pass|no free port at or above/, "the exhausted case must be reported explicitly");
    assert.equal(existsSync(join(dir, "spares")) ? readdirSync(join(dir, "spares")).filter((f) => f.endsWith(".json")).length : 0, 0, "no spare may be recorded when every candidate port is bound");
  } finally {
    for (const r of releases) await r();
  }
});

// ---------------------------------------------------------------------------
// `start N` must actually drive the spare target. Plan 02 validated the
// positional while no warm-spares logic existed for it to drive (and said so
// in a comment); plan 04 added that logic and did not come back to wire it.
// Net effect until fixed: `start 2` wrote "spares_target": 3 to broker.json
// and warmed three instances, while reporting nothing amiss -- a
// validated-then-ignored argument, which is worse than an unsupported one.

/** Runs `start [N]` as a one-shot dry run in an isolated pool dir and returns
 * the spares_target broker.json recorded. */
async function spareTargetFor(args, extraEnv = {}) {
  const dir = tmpPoolDir();
  const env = {
    ...process.env,
    VICE_SUPERVISOR_ALLOW_CONTAINER: "1",
    VICE_POOL_DIR: dir,
    VICE_BROKER_BASE_PORT: "9800",
    ...extraEnv,
  };
  await execFileP("bash", [BROKER_SCRIPT, ...args, "--once", "--dry-run"], { env });
  const bj = JSON.parse(readFileSync(join(dir, "broker.json"), "utf8"));
  return bj.spares_target;
}

test("start N: the positional instance count actually drives the spare target", async () => {
  assert.equal(await spareTargetFor(["start", "1"]), 1, "start 1 must target 1 spare");
  assert.equal(await spareTargetFor(["start", "2"]), 2, "start 2 must target 2 spares");
  assert.equal(await spareTargetFor(["start", "5"]), 5, "start 5 must target 5 spares");
});

test("start N: a bare start keeps the documented default of 3", async () => {
  assert.equal(await spareTargetFor(["start"]), 3, "bare start must keep the documented default");
});

test("start N: an explicit positional beats the VICE_BROKER_SPARES env knob", async () => {
  assert.equal(
    await spareTargetFor(["start", "2"], { VICE_BROKER_SPARES: "7" }),
    2,
    "an explicit CLI count must win over the ambient env knob"
  );
  assert.equal(
    await spareTargetFor(["start"], { VICE_BROKER_SPARES: "7" }),
    7,
    "with no positional the env knob still applies"
  );
});

// ---------------------------------------------------------------------------
// Plan 01.3-01: vice_recycle's host-side half. These tests drive
// handle_recycle_request() (and its helpers) directly against a planted
// grant + epoch file, mirroring this file's own established fixture idiom
// (writeGrantFile, writeSpareFile) rather than depending on a live proxy or
// a real x64sc anywhere.

/** Spawns a detached, long-lived bash process whose OWN `ps -o args=` output
 * contains `marker` verbatim (the script's own basename embedded in its
 * command line) -- standing in for the x64sc child a recycle targets. Traps
 * TERM/INT/HUP so a graceful SIGTERM exits cleanly, same as a real x64sc
 * responds to (and same shape as brokerCopyWithSleepingSupervisor()'s own
 * stub above). Returns { pid, scriptPath }; the caller is responsible for
 * making sure the process is gone (SIGKILL fallback) and the temp dir is
 * removed. */
function spawnStubViceChild(marker) {
  const dir = mkdtempSync(join(tmpdir(), "vice-broker-x64sc-stub-"));
  const scriptPath = join(dir, marker);
  writeFileSync(
    scriptPath,
    "#!/usr/bin/env bash\n" +
      "trap 'exit 0' TERM INT HUP\n" +
      "sleep 300 &\n" +
      "wait $!\n"
  );
  chmodSync(scriptPath, 0o755);
  const child = spawn("bash", [scriptPath], { stdio: "ignore", detached: true });
  return { pid: child.pid, scriptPath, dir };
}

/** Writes an epoch.json at `path` in exactly the shape
 * vice-supervisor.sh's own write_epoch() produces -- the fields
 * handle_recycle_request() / read_epoch_field() read (pid, vice_bin) plus
 * the surrounding fields a real epoch file always carries. */
function writeEpochFile(path, { epoch = 1, pid, viceBin, dryRun = false } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const content =
    "{\n" +
    `  "epoch": ${epoch},\n` +
    `  "spawned_at": "${new Date().toISOString()}",\n` +
    `  "pid": ${pid},\n` +
    `  "supervisor_pid": ${pid + 1},\n` +
    `  "vice_bin": "${viceBin}",\n` +
    `  "vice_args": [],\n` +
    `  "log": null,\n` +
    `  "dry_run": ${dryRun}\n` +
    "}\n";
  writeFileSync(path, content);
}

/** Writes requests/<id>.json with op:"recycle", in exactly the shape
 * vice-broker-client.mjs's own writeRecycleRequest() produces. */
function writeRecycleRequestFile(dir, id, { targetId, reason = "test recycle", proxyPid = process.pid } = {}) {
  const rdir = join(dir, "requests");
  mkdirSync(rdir, { recursive: true });
  const record = {
    version: 1,
    id,
    op: "recycle",
    target_id: targetId,
    reason,
    proxy_pid: proxyPid,
    session_id: null,
    client_pid: null,
    created_at: new Date().toISOString(),
  };
  writeFileSync(join(rdir, `${id}.json`), JSON.stringify(record, null, 2) + "\n");
}

function readRecycleAck(dir, id) {
  return JSON.parse(readFileSync(join(dir, "recycle-acks", `${id}.json`), "utf8"));
}

test("tracer: vice_recycle captures, kills the x64sc child, and the supervisor respawns on the same port", async () => {
  const dir = tmpPoolDir();
  const marker = "x64sc-stub-tracer";
  const stub = spawnStubViceChild(marker);
  try {
    await waitFor(() => {
      try {
        process.kill(stub.pid, 0);
        return true;
      } catch {
        return false;
      }
    });

    const targetId = "req-9-9000-cafecafe";
    const recycleId = "req-9-9001-deadbeef";
    const port = 7300;

    const grantPath = writeGrantFile(dir, targetId, { port });
    const leasePath = writeLeaseFile(dir, targetId);
    const epochFile = join(dir, String(port), "epoch.json");
    writeEpochFile(epochFile, { epoch: 5, pid: stub.pid, viceBin: marker });
    writeRecycleRequestFile(dir, recycleId, { targetId, reason: "tracer: prove the whole path once" });

    await runBrokerOnce(dir, { basePort: port });

    // The stub process (standing in for the x64sc child) must be gone --
    // the identity-verified kill actually fired.
    const stubGone = await waitFor(() => {
      try {
        process.kill(stub.pid, 0);
        return false;
      } catch {
        return true;
      }
    });
    assert.ok(stubGone, "the stub x64sc child must be gone after the recycle");

    // The ack must exist and record a successful kill stage.
    const ack = readRecycleAck(dir, recycleId);
    assert.equal(ack.target_id, targetId);
    assert.equal(ack.port, port);
    assert.equal(ack.x64sc_pid, stub.pid);
    assert.equal(ack.vice_bin, marker);
    assert.match(ack.kill_stage, /^(sigterm|sigkill)$/, "a genuinely live stub must be terminated via SIGTERM (or SIGKILL escalation)");
    assert.equal(ack.epoch_before, 5);
    assert.equal(ack.outcome, "ok");

    // The request file must be gone -- handled exactly once.
    assert.equal(existsSync(join(dir, "requests", `${recycleId}.json`)), false, "the recycle request file must be consumed");

    // The grant and lease both survive the recycle -- port and lease
    // continuity is the whole point of D-01 (signal the child, not the
    // broker's own bookkeeping).
    assert.equal(existsSync(grantPath), true, "the grant must survive a recycle -- only the child is killed, never the grant");
    assert.equal(existsSync(leasePath), true, "the lease must survive a recycle");
  } finally {
    try {
      process.kill(stub.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
    rmSync(stub.dir, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recycle: the target pid comes from epoch.json, never from a grant record's own supervisor_pid", async () => {
  const dir = tmpPoolDir();
  const marker = "x64sc-stub-pid-source";
  const stub = spawnStubViceChild(marker);
  try {
    await waitFor(() => {
      try {
        process.kill(stub.pid, 0);
        return true;
      } catch {
        return false;
      }
    });

    const targetId = "req-9-9010-a1a1a1a1";
    const recycleId = "req-9-9011-b2b2b2b2";
    const port = 7301;

    // The grant's OWN recorded supervisor_pid is THIS TEST RUNNER's pid --
    // a real, alive pid whose ps args do NOT match the epoch file's own
    // vice_bin. If handle_recycle_request() ever read supervisor_pid
    // instead of the epoch file's pid, this test process itself would be
    // targeted (and refused, since its args never contain the marker) --
    // proving the wrong source was consulted. The RIGHT source (the epoch
    // file's own pid) names the genuinely live stub, which must actually
    // be killed for this test to pass.
    writeGrantFile(dir, targetId, { port, supervisorPid: process.pid });
    writeLeaseFile(dir, targetId);
    const epochFile = join(dir, String(port), "epoch.json");
    writeEpochFile(epochFile, { epoch: 3, pid: stub.pid, viceBin: marker });
    writeRecycleRequestFile(dir, recycleId, { targetId });

    await runBrokerOnce(dir, { basePort: port });

    const stubGone = await waitFor(() => {
      try {
        process.kill(stub.pid, 0);
        return false;
      } catch {
        return true;
      }
    });
    assert.ok(stubGone, "the epoch file's own pid (the stub) must be the one killed, not the grant's recorded supervisor_pid");

    // This test runner's own pid must be completely unaffected.
    process.kill(process.pid, 0);

    const ack = readRecycleAck(dir, recycleId);
    assert.equal(ack.x64sc_pid, stub.pid, "the ack must record the epoch file's pid as the target, not supervisor_pid");
  } finally {
    try {
      process.kill(stub.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
    rmSync(stub.dir, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recycle: an identity mismatch is refused and acked, and the process is still alive afterwards", async () => {
  const dir = tmpPoolDir();
  try {
    const targetId = "req-9-9020-c3c3c3c3";
    const recycleId = "req-9-9021-d4d4d4d4";
    const port = 7302;

    // process.pid (this very test runner) is a REAL, ALIVE pid whose own
    // `ps` args do not mention the fabricated binary name below -- exactly
    // the "possible pid reuse" shape signal_vice_child_pid() must refuse
    // to signal, mirroring the existing supervisor-pid refusal tests'
    // own shape (L791, L912) but through the recycle path instead.
    writeGrantFile(dir, targetId, { port });
    writeLeaseFile(dir, targetId);
    const epochFile = join(dir, String(port), "epoch.json");
    writeEpochFile(epochFile, { epoch: 2, pid: process.pid, viceBin: "definitely-not-this-process" });
    writeRecycleRequestFile(dir, recycleId, { targetId });

    const { stderr } = await runBrokerOnce(dir, { basePort: port });

    assert.match(stderr, /refusing to signal pid \d+.*possible pid reuse/);
    // This process must still be alive -- kill(pid, 0) throws if not.
    process.kill(process.pid, 0);

    const ack = readRecycleAck(dir, recycleId);
    assert.equal(ack.kill_stage, "identity_refused");
    assert.equal(ack.outcome, "identity_refused");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recycle: a target id with no grant record acks with an outcome naming that missing lookup, and a later well-formed request in the same pass is still processed", async () => {
  const dir = tmpPoolDir();
  const marker = "x64sc-stub-later-request";
  const stub = spawnStubViceChild(marker);
  try {
    await waitFor(() => {
      try {
        process.kill(stub.pid, 0);
        return true;
      } catch {
        return false;
      }
    });

    const missingTargetId = "req-9-9030-e5e5e5e5";
    const badRecycleId = "req-9-9031-f6f6f6f6";
    const goodTargetId = "req-9-9032-07070707";
    const goodRecycleId = "req-9-9033-18181818";
    const port = 7303;

    // No grant file written for missingTargetId at all.
    writeRecycleRequestFile(dir, badRecycleId, { targetId: missingTargetId });

    // A second, well-formed recycle request in the SAME pass, targeting a
    // real grant -- proving the missing-grant failure above did not abort
    // the rest of this broker pass.
    writeGrantFile(dir, goodTargetId, { port });
    writeLeaseFile(dir, goodTargetId);
    const epochFile = join(dir, String(port), "epoch.json");
    writeEpochFile(epochFile, { epoch: 1, pid: stub.pid, viceBin: marker });
    writeRecycleRequestFile(dir, goodRecycleId, { targetId: goodTargetId });

    await runBrokerOnce(dir, { basePort: port });

    const badAck = readRecycleAck(dir, badRecycleId);
    assert.equal(badAck.outcome, "grant_lookup_failed");
    assert.equal(existsSync(join(dir, "requests", `${badRecycleId}.json`)), false);

    const goodAck = readRecycleAck(dir, goodRecycleId);
    assert.equal(goodAck.outcome, "ok", "a later well-formed recycle request in the same pass must still be processed");
    assert.equal(existsSync(join(dir, "requests", `${goodRecycleId}.json`)), false);
  } finally {
    try {
      process.kill(stub.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
    rmSync(stub.dir, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recycle: a grant whose epoch file is missing acks with an outcome naming that failure and sends no signal", async () => {
  const dir = tmpPoolDir();
  try {
    const targetId = "req-9-9040-29292929";
    const recycleId = "req-9-9041-3a3a3a3a";
    const port = 7304;

    // A grant record whose epoch_file simply does not exist on disk.
    writeGrantFile(dir, targetId, { port });
    writeLeaseFile(dir, targetId);
    writeRecycleRequestFile(dir, recycleId, { targetId });

    await runBrokerOnce(dir, { basePort: port });

    const ack = readRecycleAck(dir, recycleId);
    assert.equal(ack.outcome, "epoch_lookup_failed");
    assert.equal(ack.kill_stage, "no_signal");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recycle: an epoch file with no pid acks with an outcome naming that failure and sends no signal", async () => {
  const dir = tmpPoolDir();
  try {
    const targetId = "req-9-9050-4b4b4b4b";
    const recycleId = "req-9-9051-5c5c5c5c";
    const port = 7305;

    writeGrantFile(dir, targetId, { port });
    writeLeaseFile(dir, targetId);
    const epochFile = join(dir, String(port), "epoch.json");
    writeEpochFile(epochFile, { epoch: 1, pid: "null", viceBin: "whatever" });
    writeRecycleRequestFile(dir, recycleId, { targetId });

    await runBrokerOnce(dir, { basePort: port });

    const ack = readRecycleAck(dir, recycleId);
    assert.equal(ack.outcome, "pid_lookup_failed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recycle: a target pid that has already exited acks with the already-exited stage and a successful outcome", async () => {
  const dir = tmpPoolDir();
  try {
    const targetId = "req-9-9060-6d6d6d6d";
    const recycleId = "req-9-9061-7e7e7e7e";
    const port = 7306;

    // Spawn a process and let it exit immediately, so its pid is genuinely
    // dead by the time the broker pass runs -- "the machine being gone is
    // the goal", not a failure.
    const shortLived = spawn("bash", ["-c", "exit 0"], { stdio: "ignore" });
    const deadPid = shortLived.pid;
    await new Promise((resolveExit) => shortLived.once("exit", resolveExit));
    await waitFor(() => {
      try {
        process.kill(deadPid, 0);
        return false;
      } catch {
        return true;
      }
    });

    writeGrantFile(dir, targetId, { port });
    writeLeaseFile(dir, targetId);
    const epochFile = join(dir, String(port), "epoch.json");
    writeEpochFile(epochFile, { epoch: 1, pid: deadPid, viceBin: "whatever" });
    writeRecycleRequestFile(dir, recycleId, { targetId });

    await runBrokerOnce(dir, { basePort: port });

    const ack = readRecycleAck(dir, recycleId);
    assert.equal(ack.kill_stage, "already_exited");
    assert.equal(ack.outcome, "ok", "an already-exited target is a SUCCESS -- the machine being gone is the goal");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recycle: a malformed request with an op field but no readable id is skipped, and the pass continues", async () => {
  const dir = tmpPoolDir();
  try {
    const rdir = join(dir, "requests");
    mkdirSync(rdir, { recursive: true });
    // No "id" field at all -- extract_id_field() must yield empty, and
    // process_requests() must skip this file before ever reaching the op
    // dispatch, exactly like any other id-less request.
    writeFileSync(join(rdir, "malformed.json"), JSON.stringify({ version: 1, op: "recycle", target_id: "req-1-1-aaaaaaaa" }));

    const goodTargetId = "req-9-9070-8f8f8f8f";
    writeGrantFile(dir, goodTargetId, { port: 7307 });
    writeLeaseFile(dir, goodTargetId);

    const { stderr } = await runBrokerOnce(dir, { basePort: 7307 });
    assert.match(stderr, /skipping request malformed\.json/);
    // The pass must not have crashed -- the grant above is still there
    // (nothing touched it), proving the rest of the pass ran to completion.
    assert.equal(existsSync(join(dir, "grants", `${goodTargetId}.json`)), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recycle: an acquire request with no op field at all is still granted exactly as before -- the recycle branch is additive", async () => {
  const dir = tmpPoolDir();
  const { server } = startStandInServer();
  const standInPort = await listen(server);
  try {
    const id = "req-9-9080-9a9a9a9a";
    writeRequestFile(dir, id); // op: "acquire", the pre-recycle shape
    writeLeaseFile(dir, id); // a real proxy creates the lease BEFORE polling for a grant

    await runBrokerOnce(dir, { basePort: standInPort, spares: 0 });
    await runBrokerOnce(dir, { basePort: standInPort, spares: 0 }); // promote launching -> ready, then grant

    const grantPath = join(dir, "grants", `${id}.json`);
    assert.equal(existsSync(grantPath), true, "an acquire request with no op field must still be granted");
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recycle: a target id that fails the id pattern is skipped with a logged reason and writes no file anywhere", async () => {
  const dir = tmpPoolDir();
  try {
    const recycleId = "req-9-9090-2a2a2a2a";
    // "not-a-valid-id" fails REQUEST_ID_PATTERN outright -- a malformed
    // request, distinct from a well-formed-but-nonexistent target (which
    // DOES get an ack; see the "no grant record" test above).
    writeRecycleRequestFile(dir, recycleId, { targetId: "not-a-valid-id" });

    const { stderr } = await runBrokerOnce(dir, { basePort: 7309 });

    assert.match(stderr, /skipping recycle req-9-9090-2a2a2a2a.*invalid or missing target_id/);
    assert.equal(existsSync(join(dir, "recycle-acks", `${recycleId}.json`)), false, "an invalid target_id must write no ack file");
    // The request file itself is left in place, exactly like
    // process_requests()'s own invalid-"id" skip -- never silently deleted.
    assert.equal(existsSync(join(dir, "requests", `${recycleId}.json`)), true, "a malformed recycle request must not be consumed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// signal_vice_child_pid() unit-level contract (raised at the 01.3-01 tracer
// checkpoint): an empty/null pid and a genuinely-dead pid must print the
// SAME stage word (already_exited) AND return the SAME exit code (0) --
// "the machine being gone is the goal" applies identically to both, per the
// function's own header comment. Exercised by extracting the function's own
// body via the identical sed idiom this file's acceptance criteria already
// use to inspect it (rather than sourcing the whole script, which runs its
// own argument-parsing/container-guard/mkdir side effects unconditionally
// and is not designed to be sourced as a library) -- a small, isolated
// harness for a function this file otherwise only exercises indirectly
// through handle_recycle_request(), which never reaches this branch itself
// (it writes its own pid_lookup_failed ack first).
test("signal_vice_child_pid: an empty/null pid reports already_exited and returns 0 -- identical stage word AND exit code to a genuinely-exited pid", async () => {
  const { stdout: fnBody } = await execFileP("bash", ["-c", `sed -n '/^signal_vice_child_pid() {/,/^}/p' '${BROKER_SCRIPT}'`]);
  assert.ok(fnBody.includes("signal_vice_child_pid()"), "sanity: the function body must have been extracted");

  const script = `
set -u
VICE_BROKER_KILL_WAIT_S=1
${fnBody}
out="$(signal_vice_child_pid "" "whatever" "test-empty")"
rc=$?
echo "EMPTY_STAGE:$out"
echo "EMPTY_RC:$rc"

out="$(signal_vice_child_pid "null" "whatever" "test-null")"
rc=$?
echo "NULL_STAGE:$out"
echo "NULL_RC:$rc"
`;
  const { stdout } = await execFileP("bash", ["-c", script]);
  assert.match(stdout, /EMPTY_STAGE:already_exited/);
  assert.match(stdout, /EMPTY_RC:0/, "an empty pid must return 0, matching the already_exited word it prints");
  assert.match(stdout, /NULL_STAGE:already_exited/);
  assert.match(stdout, /NULL_RC:0/, "the literal string \"null\" must return 0, matching the already_exited word it prints");
});
