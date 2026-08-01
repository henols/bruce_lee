---
phase: quick-260801-ccn
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
requirements: [QUICK-260801-ccn]
files_modified:
  - .claude/skills/devcontainer-host-path/scripts/containerpath.mjs
  - .claude/skills/devcontainer-host-path/scripts/containerpath.test.mjs
  - .claude/skills/devcontainer-host-path/SKILL.md
  - .claude/mcp/vice/vice-proxy.mjs
  - .claude/mcp/vice/vice-proxy.test.mjs
  - .claude/mcp/vice/vice.mjs
  - .claude/mcp/vice/vice-pool.mjs
  - .claude/mcp/vice/vice-session.mjs
  - .claude/mcp/vice/vice-mcp-selector-docs.test.mjs
  - .planning/notes/vice-mcp-selector-design.md

must_haves:
  truths:
    - "A broker grant carrying host-local coordinates (loopback url, host-root-prefixed epoch_file and supervisor_dir) is inverted to container coordinates BEFORE useInstance() adopts it, so a forwarded tools/call reaches the granted emulator from inside the container (D-1, D-2)."
    - "The loopback rewrite is general: 127.0.0.0/8, localhost and ::1 all become the container-visible host name; a host that is already non-loopback is left byte-identical (D-4)."
    - "The host repo root used for the path inverse is DERIVED at runtime from hostpath.mjs's own knowledge, never written as a literal — a runtime-derived assertion in containerpath.test.mjs proves the module's source contains no copy of it (D-3)."
    - "A grant whose paths are already container-shaped (or match no known host root) is left byte-identical and translation is a no-op — every pre-existing broker test keeps testing what it intended (D-7)."
    - "A translated epoch_file that escapes the container workspace, or a translated url whose port disagrees with the validated grant port, is NOT adopted: the port-derived coordinate is used instead and the substitution is reported on stderr (T-ccn-01, T-ccn-02)."
    - "An unreachable BROKER-GRANTED instance is diagnosed as a broker problem naming the broker launcher, and never with the 01.1 fixed-port never-started wording or the retired supervisor launcher (D-5)."
    - "An unreachable FIXED-PORT instance (VICE_MCP_URL set, no lease held) still produces the unchanged 01.1 triple — the routing fix is a branch, not a blanket rename (D-5)."
    - "Every new test fails if the guard it covers is removed: the url test's stub listens ONLY on a non-loopback address, the epoch test detects drift only through the translated path, and the diagnostics tests assert on which launcher is named (D-6)."
    - "One stderr line per grant reports every field translated, from -> to, so the coordinates actually in use are observable — the absence of exactly this signal is why the bug was invisible."
  artifacts:
    - ".claude/skills/devcontainer-host-path/scripts/containerpath.mjs — the host->container inverse seam, mirroring hostpath.mjs's shape, naming and CLI"
    - ".claude/skills/devcontainer-host-path/scripts/containerpath.test.mjs — unit gate for the inverse (round-trip, loopback matrix, real captured grant record, passthrough)"
    - "vice-proxy.mjs's grant containerization at the ensureBrokerLease() seam, plus a broker-named unreachable diagnosis"
    - "mcpHost() as the single definition of the container-visible host name, exported from vice.mjs and consumed by the proxy, pool and session modules"
  key_links:
    - "vice-broker.sh (host) writes grants/<id>.json -> pollGrant() -> containerizeRecord() -> useInstance() — the inverse MUST sit between the poll and the adopt, or nothing downstream is container-correct"
    - "containerpath.mjs -> hostPathCandidates(CONTAINER_WS) from hostpath.mjs — the one place both directions agree on where the two roots are"
    - "activeInstance().url -> probeInstance() and call() — the single consumer that proves the url rewrite worked"
    - "translated grant epoch_file -> beginSession()/readEpoch() — the single consumer that proves the path inverse is actually read"
    - "brokerLeaseId != null -> which unreachable diagnosis is emitted (broker vs the retired fixed-port route)"
---

<objective>
The host-side broker writes grant records containing host-local coordinates and the
container-side proxy consumes them verbatim, so every broker-granted instance is
unreachable from the container. Add the missing HOST->CONTAINER translation at the
proxy seam, and stop a broker-granted unreachable instance from being diagnosed as a
missing fixed-port supervisor.

Purpose: this is the inverse of Phase 01.1 criterion 9 (container->host path translation
at the proxy seam) and **it was never built** — 01.1 only ever needed the outbound
direction, because a fixed port and a fixed epoch path were both container-resolved.
On-demand leasing introduced a second direction the moment the broker started handing
back its own coordinates, and nothing was added to invert them.

Output: a new inverse-translation module beside `hostpath.mjs`, its application at
`ensureBrokerLease()`, a broker-named unreachable diagnosis, and guard-removal-sensitive
tests for each.

## What this unblocks

Phase 01.2's last plan, 01.2-05, whose criteria C12 and C13 both require a
broker-granted instance to actually be reachable from the container. C12 edits the
ROADMAP Standing Constraints VICE row to narrow the reset ritual — writing "the broker
is the route now" into a constraint every later phase inherits, on top of a route that
does not work, is the failure this task prevents.

## The bug (already root-caused with live evidence, 2026-08-01 — do NOT re-diagnose)

A real grant captured from `.vice-supervisor/grants/`: `port` 6520, `url`
`http://127.0.0.1:6520/mcp`, `epoch_file` and `supervisor_dir` both prefixed with the
host's own repo root. `ensureBrokerLease()` passes those straight into
`useInstance({ port, url, epochFile, pooled: true })`. From inside the container:

- Loopback is the CONTAINER's own loopback -> ECONNREFUSED. VERIFIED: `curl` against
  loopback:6520 refused, while the same port at `host.docker.internal` answered
  `{"status":"ok","version":"3.10","machine":"C64SC","execution":"paused"}`.
- The host-rooted `epoch_file` does not resolve in the container. VERIFIED: absent at
  the host path, present at the container equivalent `.vice-supervisor/6520/epoch.json`.

SECONDARY defect, same trigger: in `handleToolsCall()` the post-lease liveness probe
fails, and because the granted url is unreachable AND the granted epoch path is
unreadable, both arms of the `isConnectionRefusedReason(probe.reason) && !epoch.present`
condition hold — so a *broker-granted* instance reports the 01.1 fixed-port diagnostic
and sends the operator to the RETIRED fixed-port route while the broker is running fine
and had already granted a working emulator.

## Locked user decisions (source: task brief, not a CONTEXT.md)

NON-NEGOTIABLE. Every task action below cites the ones it implements.

- **D-1** The inverse translation is **proxy-side**. The broker runs on the host,
  legitimately resolves its own repo root, and stays container-agnostic. Do NOT change
  `tools/vice-broker.sh` or `.claude/mcp/vice/resources/vice-broker.sh` to emit
  container coordinates.
- **D-2** Cover **all three** fields on the grant record: `url`, `epoch_file`,
  `supervisor_dir`.
- **D-3** DERIVE the host repo root; do not hardcode it. `hostpath.mjs` already knows
  how to relate the two roots — reuse that knowledge rather than duplicating a literal.
- **D-4** Handle the loopback rewrite **generally** (127.0.0.0/8, `localhost`, `::1`),
  not just the one literal observed.
- **D-5** Fix the diagnostic-routing defect so a broker-granted unreachable instance
  names the BROKER and its launcher. Keep it a **distinct concern** from the
  translation — a separate function and a separate branch, not a rename.
- **D-6** Tests must be guard-removal-sensitive, matching the style already used for the
  01.1 hazards (deny-list, epoch re-check, output ceiling, path translation): each test
  must FAIL if the translation or the routing fix is removed.
- **D-7** The new module lives **beside `hostpath.mjs`** and mirrors its shape and
  naming — it is that module's inverse. The broker-specific part (which fields, which
  host alias) stays in the proxy, which is the one seam that sees every grant exactly as
  it is already the one seam that sees every outbound path argument.
- **D-8** Do NOT touch the retired vice-supervisor fixed-port launch machinery, and do
  NOT attempt the two-session criterion-13 proof — that is 01.2-05's job and needs a
  human checkpoint.

## Environment facts measured during planning (2026-08-01)

Use these; do not re-derive them.

- `HOST_WORKSPACE_PATH` and `CONTAINER_WORKSPACE_PATH` are BOTH set in this container, so
  `hostPathCandidates()` returns the `exact: true` single-candidate branch. The
  mountinfo-guess branch (six candidates) is the portable fallback the inverse must
  still handle, ordered longest-prefix-first.
- `hostPathCandidates(CONTAINER_WS)` for the workspace root itself returns a candidate
  with a **trailing slash** (its template joins an empty relative tail). Normalize it.
- `os.networkInterfaces()` reports `eth0` at a non-internal IPv4 address alongside
  internal `lo` — that non-loopback address is what makes the url test's stub
  unreachable on loopback and reachable only via the rewrite.
- Node v24.18.1. No `package.json`: tests run as `node --test <file>`.
- No pre-existing broker-path proxy test asserts a SUCCESSFUL forwarded emulator
  response — they assert lease/file effects and error shapes — so introducing the url
  rewrite does not silently invert an existing green assertion. Verify this claim holds
  by running the full file, not by inspection.
- The literal host alias currently has three definitions in this module tree
  (`vice-pool.mjs` twice, `vice-session.mjs` once) plus `vice.mjs`'s `DEFAULT_ENDPOINT`.
  All three read the same env override, so consolidating them is a no-behaviour-change
  edit with existing coverage (`vice-pool.test.mjs`'s env-toggling helper).
</objective>

<execution_context>
@/workspaces/bruce_lee/.claude/gsd-core/workflows/execute-plan.md
@/workspaces/bruce_lee/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

# The existing container->host chokepoint. The new module is its inverse and must mirror
# its return shapes (`{ abs, candidates, exact?, reason? }`), its throw-with-a-reason
# contract, its CLI, and its "never hardcode the mapping" rule.
@.claude/skills/devcontainer-host-path/scripts/hostpath.mjs

# The design note whose "the broker needs no path translation" line is what let this gap
# through. Task 3 corrects the inference, not the premise.
@.planning/notes/vice-mcp-selector-design.md
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: containerpath.mjs — the host-&gt;container inverse, beside hostpath.mjs</name>
  <files>.claude/skills/devcontainer-host-path/scripts/containerpath.mjs, .claude/skills/devcontainer-host-path/scripts/containerpath.test.mjs</files>
  <read_first>
Read `hostpath.mjs` end to end first (it is ~230 lines). The inverse must mirror four
specific things from it: the `{ abs|raw, candidates, exact?, reason? }` return shape of
`hostPathCandidates()`, the "best candidate or throw with the reason plus the env hint"
contract of `hostPath()`, the exported `SET_ENV_HINT` (re-export it; never restate its
text), and the CLI-at-the-bottom guard that only runs when the module is the entry point.
  </read_first>
  <behavior>
Write these tests FIRST, in containerpath.test.mjs, and let them fail before implementing:

- Round-trip: for the workspace root, a `.vice-supervisor/6520/epoch.json` path under it,
  and one ordinary in-workspace file, `containerPath(hostPath(p))` equals `p`. Assert
  `hostPath(p) !== p` first, so the round-trip cannot pass by both directions being
  identity (this mirrors vice-proxy.test.mjs's existing "must actually translate in this
  environment for this test to be meaningful" assertion).
- No literal: `readFileSync` of containerpath.mjs itself does not contain the FIRST entry
  of `hostRootCandidates()` — the host root computed at runtime. This is the D-3 gate and
  it carries no literal of its own.
- The real captured grant: build a record with the derived host root as prefix, holding
  the loopback url on port 6520 plus host-rooted `epoch_file` and `supervisor_dir`, and
  assert THREE separate expectations — url host became the alias, `epoch_file` became the
  container `.vice-supervisor/6520/epoch.json`, `supervisor_dir` became the container
  `.vice-supervisor/6520`. Three assertions, so translating two fields and forgetting the
  third fails.
- Loopback matrix: `127.0.0.1`, a second 127.0.0.0/8 address, `localhost` and the IPv6
  loopback in bracket form are all rewritten to the alias with port and path preserved;
  `host.docker.internal`, the container's own eth0 address and a private 10.x address are
  all returned byte-identical; a string that is not a parseable URL is returned
  byte-identical.
- Passthrough: a `/tmp`-rooted path matching no known host root is reported untranslated
  with a reason and the record field is byte-identical — this is the property that keeps
  the pre-existing broker tests honest (D-7).
- Record purity: `containerizeRecord()` never mutates its input, never throws on a
  missing/non-string field, and reports its work as an array of from/to changes plus an
  array of untranslated fields with reasons.
  </behavior>
  <action>
Create `containerpath.mjs` beside `hostpath.mjs` (D-7) with a header stating what it is:
the inverse direction, host->container, the counterpart of `hostpath.mjs`'s outbound
translation, needed because a host process can legitimately hand back its own coordinates
(the on-demand VICE broker's grant records) and the container is the only side that can
invert them. Say in that header that this direction was missing until now and name the
failure shape it caused, so the next reader does not have to rediscover it.

Import `hostPathCandidates` and `SET_ENV_HINT` from `./hostpath.mjs`; re-export the hint
rather than restating it. Resolve the container workspace the same way `hostpath.mjs`
does, from the same env var with the same module-relative fallback.

Export, mirroring the sibling's naming:

- `hostRootCandidates()` — call `hostPathCandidates()` on the container workspace root,
  strip any trailing separator from each candidate, drop empties and duplicates, and sort
  longest-first so a short or empty guess prefix can never shadow a longer correct one.
  This is the whole of D-3: the mapping is derived here and nowhere else, and no absolute
  host path appears anywhere in this file.
- `containerPathCandidates(hostish)` — mirror the sibling's return shape. Non-absolute
  input returns no candidates with a reason saying relative strings are deliberately
  untouched (the same stated residual the sibling documents for its own direction).
  Otherwise return one candidate per matching host root, each formed by replacing the
  matched prefix with the container root and normalizing the result, carrying `exact:
  true` when the underlying `hostPathCandidates()` call was exact.
- `containerPath(hostish)` — the single best candidate, or throw with the reason plus the
  env hint, exactly as the sibling's `hostPath()` does.
- `containerHost(urlString, alias)` — parse with the WHATWG URL parser; if the hostname is
  a loopback form (any 127.0.0.0/8 address, `localhost`, or the IPv6 loopback) replace the
  hostname with `alias` and re-serialize, preserving scheme, port and path; if the hostname
  is anything else, or the string does not parse, return the input byte-identical. Match
  the loopback family structurally, not against the one observed literal (D-4).
- `containerizeRecord(record, { pathFields = [], urlFields = [], alias })` — a pure
  function returning a NEW record plus a `changes` array of `{ field, from, to }` and an
  `untranslated` array of `{ field, value, reason }`. Never throws, never mutates, skips
  absent and non-string fields. This is the shape the proxy consumes; keeping the field
  LIST out of this module is what keeps the module generic (D-7).

Add a CLI at the bottom behind the same entry-point guard the sibling uses, printing the
container path for each argument, so the mapping is hand-checkable without writing a
script.
  </action>
  <verify>
    <automated>node --test /workspaces/bruce_lee/.claude/skills/devcontainer-host-path/scripts/containerpath.test.mjs</automated>
    <automated>node /workspaces/bruce_lee/.claude/skills/devcontainer-host-path/scripts/containerpath.mjs "$(node /workspaces/bruce_lee/.claude/skills/devcontainer-host-path/scripts/hostpath.mjs --plain /workspaces/bruce_lee/.vice-supervisor 2>/dev/null | head -1)" 2>/dev/null | command grep -qx /workspaces/bruce_lee/.vice-supervisor</automated>
  </verify>
  <done>containerpath.test.mjs is green, every test above present; the CLI round-trips the supervisor directory through hostpath.mjs and back to its container form; the module contains no host-root literal (proved by the runtime-derived source assertion, not by eye).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: containerize every grant at the ensureBrokerLease() seam</name>
  <precondition>`os.networkInterfaces()` reports at least one non-internal IPv4 address (measured: eth0, 2026-08-01). The url-rewrite test binds its stub to that address and to nothing else; with only loopback available the test cannot distinguish a rewrite from its absence and must fail loudly rather than pass.</precondition>
  <files>.claude/mcp/vice/vice-proxy.mjs, .claude/mcp/vice/vice.mjs, .claude/mcp/vice/vice-pool.mjs, .claude/mcp/vice/vice-session.mjs, .claude/mcp/vice/vice-proxy.test.mjs, .claude/mcp/vice/vice-mcp-selector-docs.test.mjs</files>
  <read_first>
`vice-proxy.mjs` lines 802-892 (`ensureBrokerLease()`, including the load-bearing
lease-before-poll ordering comment) and lines 586-694 (the outbound translation seam,
whose structure and stated residuals this inbound seam should read as a mirror of).
`vice-pool.mjs` lines 138-150 — `instanceFor()`'s header states the rule this task's
safety net reuses: derive url and epoch path FROM THE VALIDATED PORT, never from a
string read out of a file, which is what makes a traversal sequence in that field inert.
`vice-proxy.test.mjs` lines 1442-1546 (`runBrokerOnceDryRun`, `waitForCondition`,
`handshake`, `acquireLeaseViaBroker`) and lines 53-172 (`startStandInServer`, `listen`,
`startProxy`) — reuse these helpers; do not fork them.
  </read_first>
  <behavior>
New tests in vice-proxy.test.mjs. Each must fail if the containerization is removed:

- Url rewrite, end to end: start the stand-in server bound ONLY to the container's
  non-internal IPv4 address (a new `listenOn(server, host)` helper beside `listen`), start
  the proxy with the host alias env var pointing at that same address, plant an alive
  broker.json, let the proxy write its request, then write `grants/<id>.json` DIRECTLY (do
  not involve the broker script — the point is to reproduce the captured host-shaped grant
  verbatim) with a loopback url on the stub's port. The forwarded `vice_ping` must return
  `isError: false` with the stand-in's version payload. Nothing listens on loopback at that
  port, so this response is only possible if the rewrite happened.
- Epoch path, end to end: same grant, with `epoch_file` set to `hostPath()` of a real epoch
  file created inside the container workspace (a temp directory under `.vice-supervisor/`,
  which is gitignored; remove it in `finally`). Do NOT set the epoch-file env override, so
  the granted path is the only one in play. First call succeeds; bump the epoch in that file;
  the second call must report epoch drift. With the path inverse removed the proxy reads a
  nonexistent host path, sees no epoch, detects no drift, and the second call succeeds —
  so the test fails, which is the point.
- Stderr evidence: the same test asserts the single translation line names all three fields
  with their before and after values, so translating two of three fails.
- Passthrough: an already-container-shaped grant (a `/tmp`-rooted `VICE_POOL_DIR`, as every
  pre-existing broker test uses) is adopted byte-identical — assert on the stderr line
  reporting no path change rather than on a network effect.
- Safety net: a grant whose `epoch_file` translates to a path escaping the container
  workspace, and a second grant whose url port disagrees with the granted port, are each
  refused adoption in favour of the port-derived coordinate, with that substitution named on
  stderr and the session still usable.

In vice-mcp-selector-docs.test.mjs: assert the broadened importer matcher classifies a bare
sibling specifier as an import (a direct assertion on the helper), so the new module cannot
sit outside the closed consumer set unnoticed.
  </behavior>
  <action>
Add an exported `mcpHost()` to `vice.mjs` — a FUNCTION, not a module-level constant, so it
stays sensitive to the runtime env override the pool tests toggle — returning the same env
var with the same `host.docker.internal` default the tree already agrees on. Repoint
`vice-pool.mjs`'s two inline copies and `vice-session.mjs`'s one at it (both already import
from `vice.mjs`), leaving `DEFAULT_ENDPOINT` alone. This gives the container-visible host
name exactly one definition before a fourth consumer is added; the pool suite's env-toggling
coverage is the proof it changed no behaviour.

In `vice-proxy.mjs`, import `containerizeRecord` from the new module, and `brokerRootDir`
from the broker client (already imported for `requestsDir`). Add a `containerizeGrant(grant)`
helper next to the existing broker-lease code that:

1. Validates `grant.port` as an integer in 1..65535 first. This ordering is the
   `instanceFor()` rule (T-mef-01): the validated port is what every fallback below derives
   from, so it must be trustworthy before anything else is used.
2. Calls `containerizeRecord()` with the url field and both path fields named here — the
   field list is broker knowledge and belongs at this seam, not in the generic module —
   and the alias from `mcpHost()`. Per D-2 all three fields are covered.
3. Applies the safety net, mirroring the outbound seam's own posture: the translated
   epoch path must resolve inside the container workspace (reuse the existing
   `isInsideWorkspace()` helper against `repoRoot()`), and the translated url must parse
   with a port equal to the validated grant port. On either failure, substitute the
   port-derived coordinate — the epoch path under `brokerRootDir()` for the validated port,
   and a url built from `mcpHost()` and that port — and record the substitution. Never open
   or connect to an unvalidated string read out of a grant file.
4. Emits exactly ONE stderr line reporting the grant id and every field's before and after
   (including "unchanged" and any substitution). This line is the signal whose absence made
   the original bug invisible; it is diagnostics, not logging noise, and it must not be a
   line per field.

Call it in `ensureBrokerLease()` between `pollGrant()` returning a grant and
`useInstance()`, and pass the CONTAINERIZED values to `useInstance()` (D-1). Do not disturb
the load-bearing lease-before-poll ordering, the `viceSession = null` re-baseline, or the
heartbeat start. Extend the comment above `useInstance()` to say why the inversion sits
exactly here: this is the last point before the coordinates become the session's identity.

In `vice-proxy.test.mjs`, add `listenOn(server, host)` beside `listen()`, a helper returning
the container's first non-internal IPv4 address (assert it exists — never skip), and a
`grantDirectly()` helper that writes a grant record of the captured host shape for a given
request id. Reuse `waitForCondition`, `handshake` and the existing request-file wait; do not
duplicate `acquireLeaseViaBroker` — the new tests need a hand-written grant, which is
precisely what that helper avoids.

Then sweep the pre-existing broker-path tests: every one whose granted url is loopback and
whose stub must stay reachable gets the host alias env var set to loopback in its
`startProxy` env, with a one-line comment saying the alias is what makes the inverse an
identity for a stub that really does live on this side of the boundary. Do not weaken any
assertion to accommodate the rewrite.

In `vice-mcp-selector-docs.test.mjs`, add the new module to the hostpath allow-list with its
recorded reason (it IS the inverse seam; it consumes the sibling's candidate derivation
rather than hand-translating anything), and broaden the importer matcher so a bare
same-directory specifier counts as an import. Without that widening the new module escapes
the closed consumer set silently — a control that passes while enforcing nothing, which is
the failure class that test exists to prevent.
  </action>
  <verify>
    <automated>node --test /workspaces/bruce_lee/.claude/mcp/vice/vice-proxy.test.mjs</automated>
    <automated>node --test /workspaces/bruce_lee/.claude/mcp/vice/vice-mcp-selector-docs.test.mjs /workspaces/bruce_lee/.claude/mcp/vice/vice-pool.test.mjs /workspaces/bruce_lee/.claude/mcp/vice/vice-broker-client.test.mjs</automated>
    <automated>test "$(command grep -cE 'epochFile: *grant\.|url: *grant\.' /workspaces/bruce_lee/.claude/mcp/vice/vice-proxy.mjs)" = 0 && test "$(command grep -c 'containerizeGrant(' /workspaces/bruce_lee/.claude/mcp/vice/vice-proxy.mjs)" -ge 2</automated>
  </verify>
  <done>All four suites green with no assertion weakened; no raw grant url/epoch field is handed to `useInstance()` any more and `containerizeGrant()` exists with at least one call site (third gate — a coarse structural check, not the real proof); the real proof is that the url test and the epoch test each go red when the containerization call is commented out — confirm that by actually removing it once, observing red, and restoring.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: a broker-granted unreachable instance names the broker, not the retired route</name>
  <files>.claude/mcp/vice/vice-proxy.mjs, .claude/mcp/vice/vice-proxy.test.mjs, .planning/notes/vice-mcp-selector-design.md, .claude/skills/devcontainer-host-path/SKILL.md</files>
  <read_first>
`vice-proxy.mjs` lines 403-584 — the whole diagnostics block: the shared only-route note,
`brokerHostPath()` and `supervisorHostPath()`, the three broker-absent messages added by
01.2-03, and the three host-unreachable messages from 01.1. The new message belongs in this
family and must obey the same house rules every message here already does: quote an absolute
host path, carry the probe's own reason verbatim, and end with the single shared only-route
sentence rather than a second copy of it. Also read lines 939-950, the probe branch being
re-routed.
  </read_first>
  <behavior>
Two new tests in vice-proxy.test.mjs, plus one preserved:

- Broker-granted and unreachable: drive a real grant (reuse Task 2's `grantDirectly()`) whose
  url points at a port that is bound and then closed, so the connection is actively refused.
  The response must name the broker launcher, must carry the probe's reason and the granted
  port, must NOT name the retired fixed-port launcher, and must NOT carry the 01.1
  never-started phrasing. Removing the new branch makes all four assertions flip at once.
- Fixed-port and unreachable, unchanged: with the endpoint override set and no lease held, a
  refused connection with no epoch on record still produces the 01.1 never-started message
  naming the supervisor launcher. This is what proves the fix is a branch and not a blanket
  rename (D-5).
- The pre-existing 01.1 three-shapes unreachable test stays byte-identical and green. Do not
  edit it.
  </behavior>
  <action>
Add ONE new message function to the diagnostics family for a broker-granted instance that
does not answer. Keep it distinct from the translation work (D-5) — a separate function and a
separate branch, so either can be removed without disturbing the other. It quotes
`brokerHostPath()`, the granted port and url from `activeInstance()`, the lease id, the
probe's reason verbatim, and whether an epoch record was found; it ends with the shared
only-route note. Deliberately ONE message, not a broker-side copy of the never-started /
dead-or-hung split: the broker has just told us it launched an instance, so "never started"
is not a state a granted instance can be in, and offering it as a diagnosis is exactly the
misdirection being fixed. Write that rationale into the function's own comment.

Route it in `handleToolsCall()`'s probe-failure branch: when a broker lease is held, this
message answers; otherwise the existing 01.1 pair answers unchanged. Put the lease check
FIRST, before the refused-and-no-epoch test, since under the bug both of that test's arms are
true for a broker grant — that ordering is the whole defect.

STATED RESIDUAL, record it in the comment rather than fixing it here:
`aliveButFailedMessage()` still names the supervisor launcher as a reference. It answers a
different question — an instance that IS reachable and answering rejected one call — where no
launcher is the fix and a restart would be the wrong advice on either route. Left alone
deliberately, not missed.

Then correct the two documents that let this gap through:

In `.planning/notes/vice-mcp-selector-design.md`, at the "The broker needs no path
translation" paragraph, keep the premise (the broker runs on the host, resolves its own repo
root, and stays container-agnostic — D-1 depends on that staying true) and correct the
inference the following sentence draws. It currently says only file CONTENTS naming paths go
through the host-path skill; in fact the grant records the broker writes carry host
coordinates in three fields, and the container-side proxy inverts them at the lease seam.
Name the new module and the direction, and note this is the inverse of Phase 01.1 criterion 9
and was never built until this task.

In `.claude/skills/devcontainer-host-path/SKILL.md`, add a short inverse-direction note
naming the new module and when to reach for it: a host-side process handed you its own
coordinates and you need them in container form. Match the document's existing usage-first
voice and keep it to a couple of lines — the module's own header carries the rationale.
  </action>
  <verify>
    <automated>node --test /workspaces/bruce_lee/.claude/mcp/vice/vice-proxy.test.mjs</automated>
    <automated>node --test /workspaces/bruce_lee/.claude/mcp/vice/skill-docs.test.mjs /workspaces/bruce_lee/.claude/mcp/vice/vice-mcp-selector-docs.test.mjs</automated>
    <automated>command grep -c "criterion 9" /workspaces/bruce_lee/.planning/notes/vice-mcp-selector-design.md</automated>
  </verify>
  <done>Both new diagnostics tests green and the 01.1 unreachable-triple test untouched and green; the design note's path-translation paragraph names the inverse direction and the 01.1 criterion it inverts; the skill guide names the inverse module.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| host broker -> container proxy (`grants/<id>.json`) | A file written by a host-side process on a shared bind mount, read by the container. Both sides run as uid 1000, so either can write the other's files (design note's own mount analysis). Every field is untrusted input, exactly as `registry.json` and lease files already are. |
| translated coordinate -> `useInstance()` | The point where a string read out of that file becomes the session's identity: the endpoint every later tool call is sent to, and the path the epoch guard opens. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-ccn-01 | Tampering | grant `epoch_file` / `supervisor_dir` -> `containerizeGrant()` | medium | mitigate | Translate, then require the result to resolve inside the container workspace via the existing `isInsideWorkspace()` check; on failure use the path derived from the validated port under `brokerRootDir()` and report the substitution. Reuses `instanceFor()`'s T-mef-01 rule: never open a string read out of a protocol file. |
| T-ccn-02 | Spoofing | grant `url` -> `useInstance()` -> every forwarded call | medium | mitigate | Validate the port as an integer first; rewrite ONLY loopback hostnames (never re-point a non-loopback host); require the translated url to parse with a port equal to the validated grant port, else fall back to the port-derived url. Without this, a bad grant could aim the session — including every translated in-workspace path argument — at an arbitrary endpoint. |
| T-ccn-03 | Information disclosure | the new stderr translation line | low | accept | It prints absolute host paths into the session's stderr. Every existing diagnostic in this file already does (`supervisorHostPath()`, `brokerHostPath()`), the paths are the operator's own, and the line's whole value is making the coordinates in use observable. |
| T-ccn-04 | Denial of service | misrouted unreachable diagnosis | medium | mitigate | Task 3's broker-named branch. The current message tells the operator to start the retired fixed-port launcher, which could bring up a second emulator competing for ports with the broker's own instances while the real fault goes unexamined. |
| T-ccn-05 | Tampering | supply chain (package installs) | n/a | accept | This task installs no packages — no `npm`/`pip`/`cargo` step exists, so the package-legitimacy gate has nothing to audit. Everything new is repo-local Node with no new dependency. |
</threat_model>

<verification>
Run from the repo root, all three green:

- `node --test .claude/skills/devcontainer-host-path/scripts/containerpath.test.mjs`
- `node --test .claude/mcp/vice/vice-proxy.test.mjs .claude/mcp/vice/vice-pool.test.mjs .claude/mcp/vice/vice-broker-client.test.mjs .claude/mcp/vice/vice-mcp-selector-docs.test.mjs .claude/mcp/vice/skill-docs.test.mjs`
- Full sweep, to catch a suite that dropped out of the runner rather than turned red:
  `node --test '.claude/**/*.test.mjs' 'tools/**/*.test.mjs'` — the count must be strictly
  HIGHER than before this task (new tests added, none removed).

Guard-removal spot check, done once and undone: comment out the `containerizeGrant()` call in
`ensureBrokerLease()` and confirm the url test and the epoch test both go red; restore, then
remove the broker branch in the probe-failure path and confirm the broker-diagnosis test goes
red. A test that stays green through its own guard's removal is not a test.

Not in scope, do not attempt (D-8): the two-session concurrent-leasing proof. That is
01.2-05's criterion 13 and needs a human checkpoint.
</verification>

<success_criteria>
- A grant carrying the captured host shape is inverted on all three fields before
  `useInstance()` adopts it, and a forwarded call over such a grant reaches the emulator.
- The host root is derived, never written down: a runtime-derived source assertion proves it.
- Loopback is matched as a family; a non-loopback host is never re-pointed.
- An already-container-shaped grant is a translation no-op and every pre-existing broker test
  still asserts what it was written to assert.
- A broker-granted unreachable instance names the broker and its launcher; a fixed-port
  unreachable instance still produces the unchanged 01.1 triple.
- Every new test fails when its guard is removed, verified by removing it once.
- The design note no longer implies the grant record needs no translation, and names the
  direction that was missing.
</success_criteria>

<output>
Create `.planning/quick/260801-ccn-translate-broker-granted-host-coordinate/260801-ccn-SUMMARY.md` when done.

Record in it: the stderr translation line as actually emitted for a real grant; whether the
`hostPathCandidates()` exact branch or the mountinfo-guess branch was in play during the test
run; the count delta on the full sweep; and any place the safety net (T-ccn-01/T-ccn-02
fallbacks) fired during testing, since a fallback firing where translation was expected to
succeed is a signal about the grant shape, not just about this code.
</output>
