# Phase 01.3 — API Coverage Delta

**No external API, SDK or service is integrated by this phase.** Phase 01.3 extends the in-repo MCP
proxy (`.claude/mcp/vice/vice-proxy.ts`) and the host broker that serves it (`vice-broker.mts` and
siblings) with two new capabilities served entirely proxy-local — it touches the client-visible
`mcp__vice__*` tool surface, not a third-party integration boundary.

Phase 01.1 is the phase that *authors* that tool surface and recorded it as a real matrix
(`.planning/phases/01.1-tool-mediated-emulator-access/COVERAGE.md` — 65 capabilities: 64 INTEGRATE,
1 OPT-OUT). This file is a **delta against that matrix**, not a fresh baseline and not a bare
declaration: it lists only the capabilities Phase 01.3 changes, restates the one permanent OPT-OUT
because criterion 10 requires any tool this phase adds to inherit the same treatment, and points back
at 01.1's file for the full 65-row baseline.

## Delta rows

| capability | decision | reason |
|---|---|---|
| `vice_diagnose` | INTEGRATE | Proxy-local, no host counterpart — served entirely inside `vice-proxy.ts`, dispatched proxy-locally (the `DENY_LIST` check in the `CallToolRequestSchema` override runs first and passes it through, since neither this name nor `vice_recycle` is denied — an earlier draft had this ordering reversed), absent from `tools-manifest.json` (confirmed: 0 matches in the committed 63-entry manifest). Read-mostly: answers a closed five-verdict vocabulary (`restarted`, `checkpoint_trap`, `wedged`, `stale_read_path`, `live`) with the evidence behind it. May resume the machine once or twice to measure a cycle bracket. |
| `vice_recycle` | INTEGRATE | Proxy-local, no host counterpart — same dispatch precedent as `vice_diagnose` and the pre-existing `vice_result_continue`, also absent from `tools-manifest.json`. Destructive by design: requires a non-empty `reason`, writes a permanent repo-tracked incident record under `.planning/incidents/` before anything is killed, then signals the target's emulator child through the broker's identity-verified kill path. Bumps the restart epoch by the same mechanism a crash already does (no second voiding channel). |
| `vice_disk_list` | OPT-OUT | **Restated, unchanged.** Crashes the host MCP server; recovery needs a manual VICE restart. Still deny-listed in `vice.ts`'s `DENY_LIST`, refused at `tools/call`, excluded from `tools/list`, and absent from the committed manifest file — three layers, the same count 01.1 recorded, though the mechanics of two of them changed since (see below; **corrected from an earlier draft that claimed a fourth layer** — the layer count is unchanged, only how two of the three are implemented today differs). Criterion 10 requires this row to be restated explicitly by any phase that touches the tool surface, rather than left to be assumed unchanged by omission. |

**Counts:** 2 new INTEGRATE rows (both proxy-local, both structurally absent from the manifest a
`refresh-manifest.ts` regenerate reads), 1 OPT-OUT row restated with its original reason unchanged.
Phase 01.1's baseline count (64 INTEGRATE, 1 OPT-OUT, 65 total client-visible capabilities) becomes
66 INTEGRATE, 1 OPT-OUT, 67 total after this phase's two additions **considered in isolation — but
that figure is stale as published below.** Phase 01.4 plan 01 (see "The guard 01.1's OPT-OUT row
rests on, current shape" below) subsequently moved four more names — `tools_list`, `tools_call`,
`initialize`, `notifications_initialized` — from INTEGRATE to OPT-OUT by adding them to `DENY_LIST`,
which this file's own next section already reports. **Corrected: 62 INTEGRATE / 5 OPT-OUT / 67
total** is the accurate current split — the total capability count (67) is unchanged, only the
disposition of four rows moved. Client-visible in the sense that every one of the 67 either appears
in a live `tools/list` response (true of all of them before the four were deny-listed, and still true
of the 62 INTEGRATE rows today) or is directly named in its own tool description, exactly like every
row 01.1 already counted this way.

## The guard 01.1's OPT-OUT row rests on, current shape

`vice_disk_list`'s enforcement mechanics changed since 01.1 recorded them, and this phase's own
criterion 10 depends on the current shape being accurate, not the 2026-08-02 one. **Corrected from an earlier
four-point description** that named `handleToolsList()`/`handleToolsCall()` as a fourth, independent
layer and described a discovery-time filter re-applying `DENY_LIST` "to whatever the manifest
contains" — checked directly against today's source (see `01.3-RECORDED-ANSWERS.md`'s Criterion 10
section for the full derivation), neither claim holds: those two functions were retired by Phase
01.6.3, and the discovery-time filter (`vice.ts`'s `serverInfo()`) filters the host's live
`tools/list` RPC response, not the manifest file — `refresh-manifest.ts` calls that same function to
build the manifest, so it is one mechanism, not two independent layers. What is actually true today:

1. **Call-time refusal** — the `CallToolRequestSchema` override's `DENY_LIST` check, the literal
   first statement of the handler, before any tool lookup or network attempt.
2. **Construction-time exclusion** — `if (DENY_LIST.includes(def.name)) continue;` when the
   in-memory `tools` object is built from the manifest at proxy startup; `tools/list` is served
   entirely from this object by `@mastra/mcp`'s own unmodified handler, so a name excluded here never
   appears in a live listing regardless of what the manifest file itself contains.
3. **Absent from the manifest file itself, for `vice_disk_list` specifically** — `refresh-manifest.ts`
   uses `serverInfo()` (the same host-RPC filter as layer 1 above) when writing the committed
   manifest, so `vice_disk_list` does not appear in `tools-manifest.json` at all. This third property
   is **not** shared by the other four `DENY_LIST` names today: a direct check of the committed
   63-entry manifest shows `tools_list`, `tools_call`, `initialize` and `notifications_initialized`
   all still present in the file — layers 1 and 2 keep them out of any served response regardless, but
   the manifest file itself still names them.

`DENY_LIST` (`vice.ts`) now names **five** entries, not the one 01.1 recorded: `vice_disk_list` plus
four generic-surface meta-tool names (`tools_list`, `tools_call`, `initialize`,
`notifications_initialized`) added by Phase 01.4 plan 01 to close a confused-deputy bypass those
names permitted (a forbidden tool name carried as a *nested* argument to one of the four, sidestepping
the outer-name-only guard). This phase (01.3) added no new `DENY_LIST` entries of its own.

**Corrected:** an earlier draft of this paragraph said "criterion 9's trigger investigation confirmed
no call or ordering to add." It confirmed nothing — `01.3-TRIGGER-HUNT.md`'s own verdict is
"Denominator: 0 of 6 attempts... The budget is entirely unspent," blocked before its first attempt when
`vice_diagnose`/`vice_recycle` proved unreachable from that session's tool surface (see
`01.3-RECORDED-ANSWERS.md`'s corrected Criterion 9 and 11 sections for the full record). No trigger was
confirmed, so nothing was added to `DENY_LIST` — but "nothing was confirmed" is not the same claim as
"confirmed nothing to add," and only the first is true here. `SEAM_HAZARDS` (the phase's own
warn-not-refuse mechanism for the armed-checkpoint hazard, distinct from `DENY_LIST`'s refuse-outright
treatment) still carries exactly the one entry plan 01.3-04 gave it, unchanged by this correction.

## Baseline pointer

Full 65-row baseline, cross-cutting transforms (path translation, epoch re-check, output ceiling) and
the enforcement rationale behind every INTEGRATE row not listed here:
`.planning/phases/01.1-tool-mediated-emulator-access/COVERAGE.md`.
