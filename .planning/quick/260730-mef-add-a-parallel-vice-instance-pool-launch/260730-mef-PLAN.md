---
phase: 260730-mef
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - tools/lib/container-guard.sh
  - tools/vice-pool.sh
  - tools/vice-pool.mjs
  - tools/vice-pool.test.mjs
  - tools/vice-supervisor.sh
  - tools/vice.mjs
  - tools/recover.mjs
  - tools/README.md
autonomous: true
requirements: [D-1, D-2, D-3, D-4, D-5]
user_setup: []

must_haves:
  truths:
    - "Running tools/vice-pool.sh start 3 on the host leaves three supervised x64sc MCP servers listening on 6510, 6511 and 6512, each with its own epoch file, logs and crash log (D-1)."
    - "Two container-side harness processes started at the same moment never receive the same instance; the loser waits or fails loudly, and never gets a busy instance (D-3)."
    - "With no pool running, `node tools/recover.mjs recover danish` behaves exactly as it does today — default instance at 6510, zero configuration, no error (D-3)."
    - "tools/vice-pool.sh refuses to run inside the devcontainer and reports the identical per-signal verdict as tools/vice-supervisor.sh, because both read one guard (D-1)."
    - "A snapshot saved while leasing one instance cannot overwrite a snapshot saved from another instance (D-4)."
    - "vice_disk_list is still refused before serialisation after the seam is pointed at a pooled instance, and restart detection still reads THAT instance's epoch file (D-5)."
  artifacts:
    - tools/lib/container-guard.sh
    - tools/vice-pool.sh
    - tools/vice-pool.mjs
    - tools/vice-pool.test.mjs
    - tools/README.md
  key_links:
    - "registry.json (host-written) -> readRegistry() (container-read, port-validated): the only host->container channel, same bind-mount side channel as epoch.json (D-2)."
    - "acquire() -> useInstance() -> rpc()'s active endpoint: a lease must actually redirect the transport, not merely report a port number."
    - "linkSync() of a fully-written temp lease file: the single point where two concurrent racers are separated (D-3)."
    - "activeInstance().port -> snapshotName(): the namespacing that prevents silent cross-instance snapshot overwrite in the shared host snapshot directory (D-4)."
    - "Per-port epoch file -> beginSession()/assertSameMachine(): restart detection stays correct PER INSTANCE (D-5)."
---

<objective>
Add the coordination layer that lets N supervised VICE MCP instances run in parallel on the host: a `tools/vice-pool.sh` launcher (D-1), a `registry.json` host→container channel (D-2), container-side leases that stop two tasks grabbing one instance (D-3), per-instance snapshot namespacing (D-4), all while preserving every existing invariant (D-5).

Purpose: a polled emulator runs at ~0.7% duty cycle (~6,000 cycles/s vs ~991,000 left alone) — the bottleneck is MCP round-trip latency and pause-on-read, not host CPU, so instances interleave and scaling is near-linear. And six host VICE MCP outages in one session, three on `vice_execution_run`, mean one instance today blocks everything; a pool gives crash isolation.

Output: two new host-side scripts (a launcher plus a shared guard fragment), one new container-side module with its own test file, small additive edits to `tools/vice.mjs` and `tools/recover.mjs`, and a README section.

NOT in scope, deliberately: any new transport. Both sides are ALREADY parameterised — `tools/vice.mjs` honours `VICE_MCP_URL`/`VICE_EPOCH_FILE`, `tools/vice-supervisor.sh` honours `VICE_ARGS` (hence `-mcpserverport N`) and `VICE_SUPERVISOR_DIR`. A pool runs today by looping the supervisor with different env. This plan adds coordination around that, nothing underneath it. `.mcp.json` is NOT touched and no MCP server is added (D-5): the deny-list only guards `tools/vice.mjs`, so extra MCP servers would multiply unguarded paths to the tool that kills the host server.
</objective>

<execution_context>
@/workspaces/bruce_lee/.claude/gsd-core/workflows/execute-plan.md
@/workspaces/bruce_lee/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@tools/vice.mjs
@tools/vice-supervisor.sh
@tools/recover.mjs
@tools/recover.test.mjs
@tools/README.md
</context>

<interfaces>

Exact shapes the three layers agree on. Referenced by the tasks below; do not invent variations.

## Registry file — `<pool dir>/registry.json`, written atomically by `tools/vice-pool.sh`

```json
{
  "version": 1,
  "written_by": "tools/vice-pool.sh",
  "written_at": "2026-07-30T16:20:00Z",
  "pool_pid": 41231,
  "base_port": 6510,
  "size": 3,
  "instances": [
    {
      "port": 6510,
      "url": "http://127.0.0.1:6510/mcp",
      "epoch_file": "/home/henrik/dev/henrik/git/bruce_lee/.vice-supervisor/6510/epoch.json",
      "supervisor_dir": "/home/henrik/dev/henrik/git/bruce_lee/.vice-supervisor/6510",
      "supervisor_log": "6510/supervisor.log",
      "supervisor_pid": 41232,
      "started_at": "2026-07-30T16:20:00Z",
      "dry_run": false
    }
  ]
}
```

`port` is the ONLY load-bearing field for the container. `url` and `epoch_file` are absolute as seen from the HOST (satisfying D-2's "full MCP url, absolute epoch-file path") and are for host-side `status` output and human reading; the container derives its own equivalents from the validated port, because a host absolute path is meaningless inside the container and because the container must never open a path taken out of a host-written file (T-mef-01).

## Lease file — `<pool dir>/leases/<port>.lease`, written by `tools/vice-pool.mjs`

```json
{
  "port": 6511,
  "holder_pid": 8123,
  "holder_host": "b3f1c0d9e2a4",
  "token": "9f2c1e7a-...",
  "acquired_at": "2026-07-30T16:22:11.004Z",
  "argv": "node tools/recover.mjs reproduce danish"
}
```

## `tools/vice-pool.mjs` exports

```js
export const DEFAULT_PORT = 6510;
export function poolDir();                    // VICE_POOL_DIR || <repo>/.vice-supervisor
export function registryPath(dir = poolDir());
export function readRegistry(path = registryPath());
// -> { present: boolean, ports: number[], reason?: string }
export function instanceFor(port, dir = poolDir());
// -> { port, url, epochFile }  -- BOTH derived from the port, never read from the file
export async function acquire(opts = {});
// opts: { timeoutMs, pollMs, maxLeaseAgeMs, dir, now }
// -> { port, url, epochFile, pooled, leasePath, release() }
```

## `tools/vice.mjs` additions

```js
export function useInstance({ port, url, epochFile } = {});  // redirects the seam; resets the MCP handshake
export function activeInstance();                            // -> { port, url, epochFile }
```

## `tools/recover.mjs` addition

```js
export function snapshotName(port, releaseId, runLabel);     // -> "p6511_danish_gameentry_run1"
```

</interfaces>

<tasks>

<task type="tracer">
  <name>Task 1: One instance, end to end — shared guard, pool launcher, registry, lease, redirected transport</name>
  <files>tools/lib/container-guard.sh, tools/vice-supervisor.sh, tools/vice-pool.sh, tools/vice-pool.mjs, tools/vice.mjs</files>
  <reversibility rating="reversible">The registry and lease file shapes are local, gitignored state under `.vice-supervisor/`, regenerated on every `start`. Changing either later costs one edit on each side and a `stop`/`start` cycle.</reversibility>
  <action>
Wire ONE path through every layer: host launcher writes a registry, container-side module leases an instance from it, transport seam is redirected to that instance. One instance, one lease, no expansion — hardening and the rest of the surface are Task 2 and Task 3.

**(a) `tools/lib/container-guard.sh`** — extract the container guard out of `tools/vice-supervisor.sh` verbatim, so it cannot DRIFT between the two scripts (D-1 asks for exactly this and lets me choose; extracting is the choice, because two copies of a guard that already had one wrong signal is how the mountinfo bug would come back). Sourced, never executed: define `container_guard_evaluate` (populates the `CONTAINER_SIGNALS` and `CONTAINER_REPORT` arrays from the five existing signals — dockerenv, containerenv, CONTAINER_WORKSPACE_PATH, systemd-detect-virt, PID 1 cgroup), `container_guard_report <label>` (prints `<label>: container guard evaluation` then the report lines, returns 0 on a host and 3 in a container), and `container_guard_enforce <label> <host-example-path>` (prints the FATAL block naming the signals that fired and exits 2, unless `VICE_SUPERVISOR_ALLOW_CONTAINER` is 1). MOVE, do not paraphrase, the block comment recording that a mountinfo signal was removed and must not be re-added, and why it answered the wrong question — that comment is institutional memory about a bug that already cost a fix commit. The fragment must not set shell options of its own; it is sourced into scripts that already run under `set -euo pipefail`. Because these functions return non-zero as a normal outcome, document at each definition that callers must use the `rc=0; container_guard_report x || rc=$?` idiom rather than a bare call, which `set -e` would abort on.

**(b) `tools/vice-supervisor.sh`** — replace its inline guard with `source "$(dirname "${BASH_SOURCE[0]}")/lib/container-guard.sh"` (resolved against the script, never cwd) plus calls to the two functions. Its `--help`, `--check-container`, `--dry-run`, exit codes 0/1/2/3/4 and every other behaviour stay exactly as they are; the printed report must remain byte-identical apart from the script-name label, which the guard-parity check in this task's verify block asserts directly.

**(c) `tools/vice-pool.sh`** — host-only launcher (D-1). Subcommands `start [N]` (N defaults to `VICE_POOL_SIZE` or 3), `stop`, `status`, plus `--help`/`-h`, `--check-container` and `--dry-run`. `--help` is handled before the guard (it writes no state); everything else runs the guard first, with the same `VICE_SUPERVISOR_ALLOW_CONTAINER` escape hatch, so `start` inside the container exits 2. Ports are `VICE_POOL_BASE_PORT` (default 6510) plus i for i in 0..N-1, so instance 0 IS 6510 — the default single-instance port stays the default and the existing README workflow and `.mcp.json` keep working untouched, which is a hard requirement (D-1). Validate N and the base port as integers in a sane range (N 1..16, port 1024..65500) and refuse otherwise with exit 1. Each instance gets `VICE_SUPERVISOR_DIR="<pool dir>/<port>"` so epoch files, logs and crash logs never collide (D-1), and `VICE_ARGS="-mcpserver -mcpserverhost <VICE_POOL_MCP_HOST, default 0.0.0.0> -mcpserverport <port>"`. Pool dir is `VICE_POOL_DIR`, default `<repo>/.vice-supervisor` (already gitignored). Before spawning, best-effort probe the port with bash's own `/dev/tcp` redirection and refuse that instance if something already answers, naming the port — this is cheaper and clearer than letting the supervisor discover a bound port through its crash-loop give-up path; if the probe itself errors, proceed. Spawn each supervisor detached with `nohup`, redirecting to `<pool dir>/<port>/supervisor.log`, and capture its pid; `start` must return promptly rather than blocking, since `stop` and `status` are separate invocations. Print the fully resolved command line for every instance before anything spawns, the same way the supervisor already does (T-mef-05). Then write `registry.json` per the `<interfaces>` shape, ATOMICALLY — `mktemp` inside the pool dir, then `mv` — because the container polls it and must never observe a half-written document (D-2); reuse the existing `json_escape` idiom, and do not assume `jq` is present on the host. `--dry-run` creates the per-port directories and writes the registry with `supervisor_pid` null and `dry_run` true, spawning nothing; it exists so the registry contract is verifiable from inside the devcontainer where x64sc does not exist, mirroring the supervisor's own `--dry-run` rationale.

**(d) `tools/vice-pool.mjs`** — MINIMAL container-side module for this slice (D-3): `poolDir()`, `registryPath()`, `readRegistry()`, `instanceFor()`, `acquire()` and the returned `release()`, per the `<interfaces>` signatures. `readRegistry` treats the file as untrusted host-written input exactly as `readEpoch` already treats `epoch.json` (T-mef-01): `readFileSync` and `JSON.parse` both in try/catch, accept an entry only when its `port` decodes to an integer in 1..65535, de-duplicate, ignore every other field, and never throw — an unreadable or malformed registry reports `present:false` with a reason. `instanceFor` derives the url as `http://${VICE_MCP_HOST || "host.docker.internal"}:${port}/mcp` and the epoch path as `<pool dir>/<port>/epoch.json` FROM THE VALIDATED PORT, never from a string in the file, which is what makes a `../../` traversal in `epoch_file` inert. `acquire()` walks candidate ports in DESCENDING order so batch leases drift away from 6510 and leave the interactive `.mcp.json` instance free when possible. Taking a lease is: write the holder record to a uniquely-named temp file in the leases directory, `linkSync` it onto `<port>.lease`, then unlink the temp — `link` is atomic and fails EEXIST if the name exists, and unlike an O_EXCL create it publishes fully-written content in one step, so a concurrent reader can never see an empty lease (T-mef-04). EEXIST means occupied: try the next port. When no registry is present, or it yields no valid port, return the single default instance — port 6510, the default endpoint, the NON-port-scoped `.vice-supervisor/epoch.json` — with `pooled:false` and a no-op `release()`, taking no lease at all, which is exactly today's behaviour with zero configuration and is explicitly not an error (D-3).

**(e) `tools/vice.mjs`** — add the runtime redirect (D-5 requires restart detection stay correct per instance, which is impossible while the epoch path is frozen at module load). Rename the private `ENDPOINT` const to `DEFAULT_ENDPOINT`, keep the exported `EPOCH_FILE` const exactly as it is as the default, and add module-level mutable `activeUrl`/`activeEpochFile`/`activePort` initialised from those defaults. `rpc()` posts to `activeUrl`; `readEpoch(path = activeEpochFile)` and `beginSession({ epochPath = activeEpochFile })` pick up the current value because default parameters evaluate per call. `useInstance({port, url, epochFile})` sets all three and MUST set `initialized = false`, since the MCP handshake belongs to the endpoint it was performed against; warn on stderr if it is called while a session is already open. `activeInstance()` returns the three values. Update the CLI usage text to print the active endpoint. The deny-list check stays the first statement in `call()`, ahead of any serialisation, and the transport-failure-versus-RPC-error distinction in `withReconnect` is not touched (D-5).
  </action>
  <verify>
    <automated>
set -euo pipefail
cd /workspaces/bruce_lee
bash -n tools/lib/container-guard.sh
bash -n tools/vice-supervisor.sh
bash -n tools/vice-pool.sh
tools/vice-pool.sh --help >/dev/null
tools/vice-supervisor.sh --help >/dev/null
G=$(mktemp -d)
tools/vice-supervisor.sh --check-container | grep -E "^ +" > "$G/sup.txt" || true
tools/vice-pool.sh --check-container | grep -E "^ +" > "$G/pool.txt" || true
diff "$G/sup.txt" "$G/pool.txt"
echo GUARD-PARITY-OK
rc=0; tools/vice-pool.sh --check-container >/dev/null || rc=$?
test "$rc" -eq 3
rc=0; tools/vice-pool.sh start 2 >/dev/null 2>"$G/err.txt" || rc=$?
test "$rc" -eq 2
echo GUARD-REFUSES-OK
    </automated>
    <automated>
set -euo pipefail
cd /workspaces/bruce_lee
D=$(mktemp -d)
VICE_SUPERVISOR_ALLOW_CONTAINER=1 VICE_POOL_DIR="$D" tools/vice-pool.sh start 3 --dry-run >/dev/null
VICE_POOL_DIR="$D" node --input-type=module -e 'import {acquire, readRegistry} from "/workspaces/bruce_lee/tools/vice-pool.mjs"; import {useInstance, activeInstance} from "/workspaces/bruce_lee/tools/vice.mjs"; import {existsSync} from "node:fs"; const r = readRegistry(); if (!r.present || r.ports.length !== 3) throw new Error("registry not readable: " + JSON.stringify(r)); const l = await acquire(); if (l.port !== 6512) throw new Error("expected the highest port first, got " + l.port); if (l.url !== "http://host.docker.internal:6512/mcp") throw new Error("bad url " + l.url); if (!l.epochFile.endsWith("/6512/epoch.json")) throw new Error("bad epoch path " + l.epochFile); if (!existsSync(l.leasePath)) throw new Error("no lease file written"); useInstance(l); if (activeInstance().port !== 6512) throw new Error("seam not redirected"); await l.release(); if (existsSync(l.leasePath)) throw new Error("lease not released"); console.log("TRACER-OK port=" + l.port);'
    </automated>
  </verify>
  <done>Both scripts parse, print usage, and emit an identical guard report; `vice-pool.sh start` refuses inside the container with exit 2; a dry-run `start 3` writes a valid three-entry registry; and one container-side call chain reads that registry, leases the highest port, redirects the transport seam to it, and releases the lease.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Harden the lease layer — atomicity, stale reclaim, timeout, hostile registry</name>
  <files>tools/vice-pool.mjs, tools/vice-pool.test.mjs</files>
  <behavior>
    - Cross-process exclusivity: 8 concurrent `node` processes racing for a 2-port registry produce exactly 2 successes on 2 distinct ports; the other 6 report busy.
    - In-process exclusivity: three sequential acquires against a 3-port registry return three distinct ports; a fourth with `timeoutMs: 0` throws an error naming each port and its holder pid.
    - Blocking acquire: with `timeoutMs` set and a lease released mid-wait, a waiting acquire picks it up rather than failing.
    - Stale reclaim by pid: a hand-written lease whose `holder_host` matches this host and whose `holder_pid` is dead is reclaimed.
    - Stale reclaim by age: a lease newer in pid terms but older than `maxLeaseAgeMs` is reclaimed.
    - Cross-namespace safety: a lease whose `holder_host` is a DIFFERENT hostname is never pid-reclaimed, only age-reclaimed.
    - Malformed lease file: reclaimed, with a warning, rather than blocking the port forever.
    - Token safety: `release()` on a lease that was reaped and reacquired by another holder leaves the new holder's lease alone; `release()` is idempotent.
    - No registry: `acquire()` returns port 6510, `pooled:false`, the non-port-scoped default epoch file, and writes no lease file.
    - Hostile registry: not-JSON, `instances` absent, a non-integer port, a port out of range, and an `epoch_file` of `"../../../etc/passwd"` all degrade to the 6510 fallback; the returned `epochFile` is always the port-derived path under the pool dir.
    - Deny-list survives redirection: `call("vice_disk_list")` after `useInstance()` still rejects with the permanently-forbidden message, before any network request.
  </behavior>
  <action>
Write the tests first, in a new `tools/vice-pool.test.mjs`, in the existing `node --test` idiom used by `tools/recover.test.mjs` — same `mkdtempSync` temp-directory pattern, same stub-injection style, no new test framework and no new runtime dependencies. Drive everything through a synthetic registry written by hand into a temp `VICE_POOL_DIR`; the host launcher is not involved. For the cross-process race, spawn racers with `execFile(process.execPath, ["--input-type=module", "-e", src])` where `src` dynamic-imports the module by absolute file URL and the environment carries the temp `VICE_POOL_DIR`; each racer acquires with `timeoutMs: 0`, prints its outcome, then HOLDS for ~1500 ms before exiting, so a fast racer's own exit-time release cannot hand its port to a later racer and inflate the success count.

Then extend `tools/vice-pool.mjs` to satisfy them (D-3):

- **Blocking with timeout is the chosen policy** — state it in the module header. `acquire()` polls every `pollMs` (default 500) until `timeoutMs` (default `VICE_POOL_ACQUIRE_TIMEOUT_MS` or 120000) elapses, then throws an error listing every port with its holder pid, host and age. `timeoutMs: 0` fails immediately. Rationale to record in the comment: a capture run is long and a `reproduce` is two of them back to back, so failing instantly would make routine work flaky; but a silent wait forever would hide a leaked lease, so the wait is always bounded and the failure always names who is holding what. A busy instance is never returned.
- **Reclaiming.** On EEXIST, read the lease and reclaim it when: the record is unparseable (warn loudly on stderr — a malformed file must not wedge a port); or `acquired_at` is older than `maxLeaseAgeMs` (default `VICE_POOL_LEASE_MAX_AGE_MS` or 3600000); or `holder_host` equals `os.hostname()` AND the pid is gone (`process.kill(pid, 0)` throwing ESRCH). Reclaiming is an unlink followed by a retry of the link, so two simultaneous reapers still produce exactly one winner. Comment the hostname condition prominently (T-mef-03): a supervisor pid and a container pid live in DIFFERENT pid namespaces, so pid-testing a number written on the other side of the bind mount is meaningless and could match an unrelated local process — the hostname check is what keeps the pid signal honest, and without a hostname match only age can reclaim.
- **Release safety.** `release()` re-reads the lease and unlinks only when the `token` matches the one this holder wrote (T-mef-04), so a holder that was reaped mid-run cannot delete the lease of whoever legitimately took the port afterwards; a mismatch warns and leaves the file. It is idempotent, and is additionally registered on `process.on("exit")` as a synchronous best-effort unlink plus on SIGINT/SIGTERM, because `process.exit()` skips `finally` blocks. The real crash guarantee is reclaimability, not the handler.
- **Container-side liveness, and what it deliberately does NOT do.** `acquire()` does not test whether a supervisor is alive by its pid, for the pid-namespace reason above; presence of the instance's own `epoch.json` is the only weak liveness hint used, and a genuinely dead instance surfaces through the transport error and operator guidance `tools/vice.mjs` already produces. Say so in a comment so nobody later "fixes" it by adding a pid check that appears to work.
  </action>
  <verify>
    <automated>
set -euo pipefail
cd /workspaces/bruce_lee
node --test tools/vice-pool.test.mjs tools/recover.test.mjs
    </automated>
  </verify>
  <done>`node --test tools/vice-pool.test.mjs tools/recover.test.mjs` passes with zero failures, the existing 24 tests still green, and every bullet in `<behavior>` is covered by a named test — including the 8-way cross-process race resolving to exactly 2 winners.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Consume leases in recover.mjs, namespace snapshots, finish the launcher, document the pool</name>
  <files>tools/recover.mjs, tools/recover.test.mjs, tools/vice-pool.sh, tools/README.md</files>
  <behavior>
    - `snapshotName(6511, "danish", "run1")` returns `p6511_danish_gameentry_run1`; two ports never produce the same name for the same release and run label.
    - The fallback instance is namespaced too: `snapshotName(6510, ...)` yields `p6510_...`, so a name never depends on whether a pool happened to be running.
  </behavior>
  <action>
**(a) `tools/recover.mjs`** — acquire once at the CLI entry point, not inside the exported functions, so programmatic callers and the test suite are unaffected. In `main()`, `acquire()` a lease, `useInstance(lease)`, run the verb, and release in a `finally`. One lease spans a whole `reproduce`, covering both `recover()` calls — that is required, not incidental: the two runs must execute on the same machine for the epoch identity check to mean anything (D-5). Change the `reproduce` verb to set `process.exitCode` instead of calling `process.exit()`, so the `finally` actually runs; the exit hook from Task 2 remains the belt for the `die()` path.

Add and export `snapshotName(port, releaseId, runLabel)` returning `p<port>_<releaseId>_gameentry_<runLabel>`, and use it in `recover()` via `activeInstance().port` (D-4). This is the fix for a real hazard: `vice_snapshot_save` accepts only a name, not a path, and writes into a SHARED host directory (`~/.config/vice/mcp_snapshots/`), so N instances saving the same name silently overwrite each other's snapshots. The prefix is applied unconditionally, including the 6510 fallback — a conditional would mean the same run produces different names depending on whether a pool happened to be running, and the whole point is that a name is unambiguous host-side. Record `instance_port` and `pooled` in the capture record alongside the existing `snapshot_name`, so a dump carries the identity of the emulator that produced it; this is provenance, which is what this project is for.

**(b) `tools/recover.test.mjs`** — add the two `<behavior>` assertions for `snapshotName`, additively on top of the current file contents (it was modified by the determinism-proof work; do not assume an older shape). No emulator is touched.

**(c) `tools/vice-pool.sh`** — finish `stop` and `status` (D-1, D-2). `stop` reads `supervisor_pid` values out of `registry.json` with the same no-jq `grep -o`/`head` idiom `read_prev_epoch` already uses, and BEFORE signalling any pid confirms identity with `ps -o args= -p "$pid"` containing the resolved path of `tools/vice-supervisor.sh` (T-mef-02) — a pid from a stale registry may have been recycled onto an unrelated process, and killing it would be a far worse failure than not stopping a supervisor. Non-matching pids are skipped with a message naming the pid and what `ps` actually reported. Matching pids get `SIGTERM` only; the supervisors already trap INT/TERM and kill their own x64sc child, so nothing here signals x64sc directly and nothing matches processes by name. After signalling, remove `registry.json` last, so the container falls back to the single default instance exactly as it does with no pool. `status` prints, per instance: port, url, supervisor pid and whether that pid is alive AND identity-verified, whether the instance's `epoch.json` exists and its epoch value, and whether `leases/<port>.lease` is currently held and by whom. Entries whose supervisor pid is dead, null (a dry-run entry) or fails the identity check are marked STALE (D-2) and make `status` exit 5; a missing registry exits 1; otherwise 0. `stop` skips null pids the same way it skips unidentifiable ones, and still removes the registry. Document every exit code in `--help`.

**(d) `tools/README.md`** — add a section after the restart-detection one covering: why a pool exists (the ~0.7% duty cycle measurement, and crash isolation after six outages in one session); `start`/`stop`/`status` with the port scheme and 6510 staying the default so existing setup is untouched; the registry as the host→container channel over the same bind mount as `epoch.json`, with no new port or protocol; leases, the blocking-with-timeout policy and the two env knobs; the snapshot namespacing convention and the shared-host-directory hazard it exists for; the caveat that a plain `vice-supervisor.sh` on 6510 alongside a pool writes its epoch to the non-port-scoped path, so a lease on 6510 would find no epoch file and fall back to the checkpoint probe; and that `.mcp.json` and the agent's interactive MCP surface stay on the single default instance on purpose (D-5).
  </action>
  <verify>
    <automated>
set -euo pipefail
cd /workspaces/bruce_lee
bash -n tools/vice-pool.sh
tools/vice-pool.sh --help | grep -qE "stop"
node --test tools/recover.test.mjs tools/vice-pool.test.mjs
D=$(mktemp -d)
rc=0; VICE_SUPERVISOR_ALLOW_CONTAINER=1 VICE_POOL_DIR="$D" tools/vice-pool.sh status >/dev/null 2>"$D/err.txt" || rc=$?
test "$rc" -eq 1
echo STATUS-NO-REGISTRY-OK
VICE_SUPERVISOR_ALLOW_CONTAINER=1 VICE_POOL_DIR="$D" tools/vice-pool.sh start 2 --dry-run >/dev/null
rc=0; VICE_SUPERVISOR_ALLOW_CONTAINER=1 VICE_POOL_DIR="$D" tools/vice-pool.sh status >/dev/null || rc=$?
test "$rc" -eq 5
echo STATUS-STALE-OK
VICE_SUPERVISOR_ALLOW_CONTAINER=1 VICE_POOL_DIR="$D" tools/vice-pool.sh stop >/dev/null
test ! -f "$D/registry.json"
echo STOP-CLEARS-REGISTRY-OK
grep -qi "pool" tools/README.md
echo README-OK
    </automated>
    <human-check>
On the HOST, from the host workspace (this cannot be checked from the container — there is no x64sc, no display, and the guard refuses on purpose):

1. `tools/vice-pool.sh start 3` — expect three x64sc windows and three lines naming ports 6510/6511/6512 with their resolved command lines.
2. `tools/vice-pool.sh status` — expect three instances, each pid alive and identity-verified, each with an epoch present, no leases held, exit 0.
3. From the CONTAINER: `node tools/vice.mjs ping` still answers on the default instance (6510, unchanged `.mcp.json` path), and `VICE_MCP_URL=http://host.docker.internal:6512/mcp node tools/vice.mjs ping` answers on the third.
4. From the CONTAINER, run two `node tools/recover.mjs boot danish` concurrently and confirm from `tools/vice-pool.sh status` on the host that they hold two DIFFERENT ports, and that both windows show a booting disk.
5. Kill one x64sc by hand and confirm its own supervisor respawns it, its epoch increments in `<pool dir>/<port>/epoch.json`, and the other two instances are unaffected — that is the crash isolation this exists for.
6. `tools/vice-pool.sh stop` — expect all three to terminate, no orphaned x64sc in `ps`, and `registry.json` gone.
7. Confirm `~/.config/vice/mcp_snapshots/` now contains port-prefixed names and that no two instances overwrote each other.
    </human-check>
  </verify>
  <done>The CLI leases an instance for the whole verb and releases it; snapshot names carry the port unconditionally; the capture record names the instance that produced the dump; `stop` refuses to signal a pid it cannot identify and clears the registry; `status` marks stale entries and exits 5; the README documents running a pool; all tests pass.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| host → container, via `.vice-supervisor/registry.json` on the bind mount | A file written by a host process and parsed by container-side Node. Same channel and same trust posture as `epoch.json`, which `readEpoch()` already treats as untrusted input. |
| registry pid fields → `kill` on the host | `tools/vice-pool.sh stop` signals pids read out of a file that may be stale across a reboot. |
| lease files → pid liveness tests | Lease holder pids are written by whichever side took the lease; pid namespaces differ between host and container. |
| operator environment → process spawn | `VICE_POOL_*`, `VICE_ARGS` and `VICE_BIN` reach a command line. |
| pool ports → local network | N MCP listeners bound on `0.0.0.0` instead of one. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-mef-01 | Tampering | `readRegistry()` / `instanceFor()` in tools/vice-pool.mjs | high | mitigate | Parse in try/catch, accept only integer ports 1..65535, ignore all other fields, never throw. Derive url and epoch path from the validated port — never open a path read out of the file, so a `../../` in `epoch_file` is inert. Malformed → 6510 fallback. Covered by the hostile-registry tests in Task 2. |
| T-mef-02 | Denial of Service | `tools/vice-pool.sh stop` | high | mitigate | Before any signal, `ps -o args= -p "$pid"` must contain the resolved path of tools/vice-supervisor.sh; non-matching pids are skipped and reported. SIGTERM only, to supervisors only — never a name-matched kill of x64sc. |
| T-mef-03 | Spoofing | lease `holder_pid` across pid namespaces | medium | mitigate | Record `holder_host`; pid-liveness reclaim runs only when the hostname matches, otherwise age-based reclaim only. Container-side code never pid-tests a host supervisor pid. |
| T-mef-04 | Tampering | concurrent lease acquisition and release | high | mitigate | `linkSync` of a fully-written temp file (atomic, EEXIST = occupied); reclaim is unlink-then-retry-link so simultaneous reapers still yield one winner; `release()` unlinks only on a matching per-holder random token. Proven by the 8-way cross-process race test. |
| T-mef-05 | Elevation of Privilege | `VICE_POOL_*` / `VICE_ARGS` reaching a spawn | medium | mitigate | Same posture as T-jty-02: validate N and base port as integers in range, print every fully resolved command line before spawning, split args once with `read -ra`, quote at the spawn site. Runs at the operator's own privilege; the goal is visibility, not confinement. |
| T-mef-06 | Information Disclosure | N unauthenticated MCP listeners on 0.0.0.0 | medium | accept | Multiplies port count, not exposure class — the single instance already binds 0.0.0.0 by necessity from a container, as README section 3 documents. `-mcpservertoken` still passes through `VICE_ARGS` unchanged for an untrusted network. Documented in the new README pool section. |
| T-mef-SC | Tampering | npm/pip/cargo installs | high | accept | No package-manager installs in this task; zero new runtime dependencies is a hard constraint, so there is nothing to audit. |
</threat_model>

<verification>
- `bash -n` parses all three shell files.
- The container guard produces a byte-identical signal report from both scripts (`diff` of the report lines), which is the anti-drift proof D-1 asks for.
- `tools/vice-pool.sh start` refuses inside the container with exit 2; `--check-container` exits 3; `--help` exits 0.
- A dry-run `start N` writes a registry the container-side module reads, leases from, and redirects the transport to.
- `node --test tools/vice-pool.test.mjs tools/recover.test.mjs` passes, including cross-process lease exclusivity, stale reclaim, timeout behaviour, hostile-registry degradation and the surviving deny-list.
- `status` exits 1 with no registry and 5 with a stale one; `stop` clears the registry.
- Nothing in this plan requires a running emulator. Everything that does is in the `<human-check>` block on Task 3.
</verification>

<success_criteria>
- `tools/vice-pool.sh start 3` on the host runs three isolated, individually supervised instances on 6510/6511/6512; killing one does not disturb the others.
- Two concurrent container-side harness runs provably take different instances; a third with no free instance waits up to the timeout and then fails naming every holder.
- With no pool running, existing behaviour is bit-for-bit unchanged: default instance 6510, default epoch file, `.mcp.json` untouched, no new configuration.
- Snapshot names carry their instance port, so the shared host snapshot directory can no longer be silently overwritten across instances.
- `vice_disk_list` stays denied, the transport-versus-RPC retry distinction stays, and restart detection reads the leased instance's own epoch file.
</success_criteria>

<output>
Create `.planning/quick/260730-mef-add-a-parallel-vice-instance-pool-launch/260730-mef-SUMMARY.md` when done.
</output>
