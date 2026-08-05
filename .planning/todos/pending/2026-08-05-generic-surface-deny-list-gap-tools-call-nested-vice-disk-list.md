# vice-proxy's DENY_LIST guard is outer-name-only; the manifest's own generic-surface meta-tool (`tools_call`) can carry `vice_disk_list` as a nested argument, unrefused

**Found during:** Phase 01.6.3 (mastra-mcp-adoption) Plan 03, full-manifest registration. Registering
every manifest tool through the generic `buildViceTool()` loop made the host's own generic-surface
meta-tools (`tools_call`, `tools_list`, `initialize`, `notifications_initialized` — the manifest lists
all four as ordinary tools) reachable through this proxy's own dispatch for the first time, since
Plan 02's tracer only registered `vice_ping` plus the three synthetics.

**The gap, precisely:** Every deny-list guard in this codebase — this proxy's own
`CallToolRequestSchema` override (`.claude/mcp/vice/vice-proxy.ts`) AND `call()`'s own internal guard
(`.claude/mcp/vice/vice.ts`, `DENY_LIST.includes(toolName)`, line ~632) — inspects only the OUTER tool
name being forwarded. Neither has ever inspected a tool's own ARGUMENTS. The manifest's own
`tools_call` meta-tool takes `{name: string, arguments: object}` as its input shape — the exact same
shape this proxy's own `tools/call` envelope takes. Calling this proxy's `tools_call` tool with
`arguments: {name: "vice_disk_list", arguments: {}}` is therefore:

1. NOT refused by this proxy's own `DENY_LIST.includes(name)` check (the outer name is `"tools_call"`,
   not `"vice_disk_list"`).
2. Forwarded via `call("tools_call", {name: "vice_disk_list", arguments: {}})`, which ALSO passes
   `call()`'s own internal guard for the identical reason.
3. Reaches the real host VICE MCP server's own `tools_call` meta-tool with the nested argument intact,
   where the host's own internal dispatch (opaque to this proxy) presumably routes it to the real
   `vice_disk_list` implementation — the same one that crashes the shared host server, per every
   refusal message this proxy's own deny-list produces.

**Provenance / confirmed pre-existing:** This is NOT introduced or widened by Phase 01.6.3's
`@mastra/mcp` swap. Read `call()`'s guard directly (unchanged by either Plan 02 or Plan 03) and
confirmed the RETIRED pre-swap `handleToolsCall()` (deleted in Plan 02) had the byte-for-byte identical
outer-name-only check. A dedicated live test
(`vice-proxy.test.ts#"known, pre-existing, NOT widened: tools_call's own nested vice_disk_list
argument is not refused at this layer and reaches the stand-in host"`) proves the request reaches a
stand-in host with the nested argument intact, unchanged from what a bare `call("tools_call", {...})`
has always done. This matches "Phase 01.4 criterion 3," which the phase 01.6.3 coordinator brief
described as "an open breach concern, confirmed present in a live agent session today" — i.e. this
was ALREADY a known, live, unfixed risk before this phase touched anything; this phase's contribution
is making it newly, explicitly PROVEN (via a passing test) rather than merely asserted from memory.

**Why not fixed here:** Closing this for real requires a genuine design decision, not a registration-
loop tweak:
- **Option A — refuse forwarding the generic-surface meta-tools entirely.** Simple, but changes the
  observable tool surface this and prior phases have gone to lengths to keep unchanged (COVERAGE.md's
  own framing), and removes real functionality (an agent legitimately wanting to call `tools_call`
  for some other tool loses that path through this proxy).
- **Option B — teach the deny-list check to parse nested argument shapes** for `tools_call`
  specifically (and any future meta-tool with the same shape), recursively re-checking
  `arguments.name` against `DENY_LIST` before forwarding. Correct in principle, but is the first
  instance in this codebase of a deny-list check that understands a TOOL'S OWN SEMANTICS rather than
  treating every tool as an opaque `(name, args)` pair — a real precedent-setting change, not a
  one-line fix.

Either option is a legitimate architectural decision for whoever owns Phase 01.4's criterion 3 to
make, not something a full-manifest-registration plan (chartered only to prove the registration
mechanism scales, with "no per-tool special case" as an explicit must_have) should decide unilaterally.

**Evidence:** Live (spawned real proxy process against an in-process stand-in host, per this file's
own test harness) — `vice-proxy.test.ts`, test named above, in
`.claude/mcp/vice/vice-proxy.test.ts`. Source-read confirmation of `call()`'s guard in `vice.ts` line
~632, and of the retired `handleToolsCall()`'s identical guard via `git show <pre-swap-commit>`.

**Confidence:** HIGH (live test passing, source read directly, cross-checked against the pre-swap
commit's own identical code).

**Suggested next step:** Whoever next works Phase 01.4 criterion 3 should decide between Option A/B
above (or a third option this todo's author didn't consider) and implement it as its own scoped plan
— not folded into a future mastra-mcp-adoption plan whose own scope is the seam swap, not the deny-list
mechanism's own design.
