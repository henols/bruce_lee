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
| `vice_diagnose` | INTEGRATE | Proxy-local, no host counterpart — served entirely inside `vice-proxy.ts`, dispatched before the `DENY_LIST` branch is ever reached, absent from `tools-manifest.json` (confirmed: 0 matches in the committed 63-entry manifest). Read-mostly: answers a closed five-verdict vocabulary (`restarted`, `checkpoint_trap`, `wedged`, `stale_read_path`, `live`) with the evidence behind it. May resume the machine once or twice to measure a cycle bracket. |
| `vice_recycle` | INTEGRATE | Proxy-local, no host counterpart — same dispatch precedent as `vice_diagnose` and the pre-existing `vice_result_continue`, also absent from `tools-manifest.json`. Destructive by design: requires a non-empty `reason`, writes a permanent repo-tracked incident record under `.planning/incidents/` before anything is killed, then signals the target's emulator child through the broker's identity-verified kill path. Bumps the restart epoch by the same mechanism a crash already does (no second voiding channel). |
| `vice_disk_list` | OPT-OUT | **Restated, unchanged.** Crashes the host MCP server; recovery needs a manual VICE restart. Still deny-listed in `vice.ts`'s `DENY_LIST` before serialisation, filtered from `tools/list`, refused at `tools/call` — the identical three-layer treatment 01.1 recorded, now joined by a fourth layer this project added since (see below). Criterion 10 requires this row to be restated explicitly by any phase that touches the tool surface, rather than left to be assumed unchanged by omission. |

**Counts:** 2 new INTEGRATE rows (both proxy-local, both structurally absent from the manifest a
`refresh-manifest.ts` regenerate reads), 1 OPT-OUT row restated with its original reason unchanged.
Phase 01.1's baseline count (64 INTEGRATE, 1 OPT-OUT, 65 total client-visible capabilities) becomes
**66 INTEGRATE, 1 OPT-OUT, 67 total** after this phase's two additions — client-visible in the sense
that both new tools appear in a live `tools/list` response and are directly named in their own tool
descriptions, exactly like every row 01.1 already counted this way.

## The guard 01.1's OPT-OUT row rests on, current shape

`vice_disk_list`'s enforcement gained a layer since 01.1 recorded it, and this phase's own criterion
10 depends on the current shape being accurate, not the 2026-08-02 one:

1. **Stripped from the manifest** — `refresh-manifest.ts` filters every `DENY_LIST` name when
   snapshotting the host surface.
2. **Filtered from `tools/list`** — `vice.ts`'s discovery-time filter re-applies `DENY_LIST` to
   whatever the manifest contains.
3. **Refused at `tools/call`** — `vice.ts`'s `call()` guard checks `DENY_LIST` before any network
   request is made.
4. **Re-filtered proxy-side** — `vice-proxy.ts` re-applies the same check at its own
   `handleToolsList()`/`handleToolsCall()`, as defence-in-depth against a manifest that names the
   tool anyway.

`DENY_LIST` (`vice.ts`) now names **five** entries, not the one 01.1 recorded: `vice_disk_list` plus
four generic-surface meta-tool names (`tools_list`, `tools_call`, `initialize`,
`notifications_initialized`) added by Phase 01.4 plan 01 to close a confused-deputy bypass those
names permitted (a forbidden tool name carried as a *nested* argument to one of the four, sidestepping
the outer-name-only guard). This phase (01.3) added no new `DENY_LIST` entries of its own — criterion
9's trigger investigation confirmed no call or ordering to add, so `SEAM_HAZARDS` (the phase's own
warn-not-refuse mechanism for the armed-checkpoint hazard, distinct from `DENY_LIST`'s refuse-outright
treatment) still carries exactly the one entry plan 01.3-04 gave it.

## Baseline pointer

Full 65-row baseline, cross-cutting transforms (path translation, epoch re-check, output ceiling) and
the enforcement rationale behind every INTEGRATE row not listed here:
`.planning/phases/01.1-tool-mediated-emulator-access/COVERAGE.md`.
