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
 * denial, which run a temp copy of the whole resources/ dir instead). */
function runBrokerOnce(dir, { basePort = 7000, ttlS, dryRun = true, spares = 0, max, probeCmd, script = BROKER_SCRIPT } = {}) {
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

    // THREE "tools/call" requests reach the stand-in server, not one: the
    // proxy's own pre-flight liveness probe (plan 01.1-03's vice_ping round
    // trip), the broker's OWN readiness probe_ready() (plan 04's default
    // curl-based check, fired once against this same real, live port while
    // promoting the cold-launched spare from launching -> ready), and the
    // one real forwarded call this tracer proves.
    const toolCallsSeen = requests.filter((r) => r && r.method === "tools/call");
    assert.equal(
      toolCallsSeen.length,
      3,
      "the stand-in server must have received the pre-flight probe, the broker's readiness probe, and the real forwarded call"
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
    await runBrokerOnce(dir, { basePort: 7300 });

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
    await runBrokerOnce(dir, { basePort: 7300 });

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

    await runBrokerOnce(dir, { basePort: 7400 });

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
  try {
    const rdir = join(dir, "requests");
    mkdirSync(rdir, { recursive: true });
    writeFileSync(join(rdir, "garbage.json"), "not json at all {{{\n");

    const goodId = "req-8-8000-cafebabe";
    writeRequestFileRaw(dir, "good", goodId);
    writeLeaseFile(dir, goodId); // see the parity test's own comment on this ordering
    writeSpareFile(dir, 7500, { state: "ready", readyAt: Date.now() * 1e6 }); // see the parity test's own comment on this too

    const { stderr } = await runBrokerOnce(dir, { basePort: 7500 });
    assert.match(stderr, /skipping request garbage\.json/);
    assert.ok(existsSync(join(dir, "grants", `${goodId}.json`)), "a well-formed request in the same pass must still be granted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Plan 04, Task 1: an instance is grantable only after it proves itself
// ready -- the launching -> ready state machine, the injectable probe seam,
// and the single function (maintain_spares) that owns both the ready_spares
// == N target and the total_instances <= MAX ceiling.

test("maintain_spares: with VICE_BROKER_SPARES=2 and an always-succeeding probe, two passes bring broker-instances.json to exactly two ready entries", async () => {
  const dir = tmpPoolDir();
  const probe = alwaysSucceedProbe();
  try {
    await runBrokerOnce(dir, { basePort: 7700, spares: 2, probeCmd: probe });
    let files = existsSync(join(dir, "spares")) ? readdirSync(join(dir, "spares")).filter((f) => f.endsWith(".json")) : [];
    assert.equal(files.length, 2, "pass 1 must launch exactly VICE_BROKER_SPARES=2 spares");
    for (const f of files) {
      const rec = JSON.parse(readFileSync(join(dir, "spares", f), "utf8"));
      assert.equal(rec.state, "launching", "an instance launched in THIS pass must not already be ready in this same pass");
    }

    await runBrokerOnce(dir, { basePort: 7700, spares: 2, probeCmd: probe });
    files = readdirSync(join(dir, "spares")).filter((f) => f.endsWith(".json"));
    assert.equal(files.length, 2, "no additional spares beyond the target once ready");
    for (const f of files) {
      const rec = JSON.parse(readFileSync(join(dir, "spares", f), "utf8"));
      assert.equal(rec.state, "ready", "pass 2 must promote both entries to ready");
      assert.ok(rec.ready_at, "a promoted entry must record ready_at");
    }
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
