---
phase: 1
slug: recovery-provenance
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-30
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `01-RESEARCH.md` § Validation Architecture (lines 474–507).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — greenfield repo, no test runner. Phase 1's checks are the mechanical assertions success criteria 1 and 3 already demand (byte-identical re-run; 100% provenance coverage), implemented as small Node scripts using built-ins only. |
| **Config file** | none — Wave 0 creates the scripts |
| **Quick run command** | `node tools/diff-images.mjs recovery/danish/dumps/run1.bin recovery/danish/dumps/run2.bin` |
| **Full suite command** | Re-run the full recorded procedure for both images, twice each; diff all four `.bin`s pairwise; then run the cross-image provenance diff |
| **Estimated runtime** | Dominated by emulated boot + decrunch per capture, not by the scripts |

**Note on framework choice:** Node built-ins were chosen over `pytest` (which the project STACK lists) because every Wave 0 tool here orchestrates the `vice_*` MCP surface and does byte math — no fixtures, parametrization, or assertion library is load-bearing. `pytest` remains the right choice for the later replay/regression harness; this phase does not need it, and installing it here would be unused surface. Revisit at the phase that builds the behavioural-equivalence harness.

---

## Sampling Rate

- **After every task commit:** Re-run the specific dump/diff script just touched; confirm it still exits cleanly against already-captured fixtures.
- **After every plan wave:** Re-run the byte-identical reproducibility check (D-09) end-to-end for whichever image(s) that wave touched.
- **Before `/gsd-verify-work`:** Both images captured; both reproducibility checks green; `PROVENANCE.md` at 100% coverage; canonical image chosen with a recorded number.
- **Max feedback latency:** Script-only checks are seconds. Any check that requires a fresh capture is bounded by emulated boot + decrunch and is therefore a wave-level, not per-task, sample.

---

## Per-Task Verification Map

Task IDs do not exist until the plans are written. This map is seeded at **requirement** level from research; `/gsd-validate-phase` fills the per-task rows once `*-PLAN.md` exists.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | 01-01 | 1 | RECOVER-01 | — | N/A | manual (one-time, scripted) | `node tools/hostpath-boot.mjs danish.d64`, then assert `vice_registers_get` PC advanced | ❌ W0 | ⬜ pending |
| TBD | 01-02 | — | RECOVER-02 | — | N/A | scripted capture + SHA-256 | `node tools/dump-capture.mjs danish` | ❌ W0 | ⬜ pending |
| TBD | 01-03 | — | RECOVER-03 | — | N/A | scripted capture + SHA-256 | `node tools/dump-capture.mjs saeger` | ❌ W0 | ⬜ pending |
| TBD | 01-04 | — | RECOVER-04 | — | N/A | scripted watch-arm + bounded manual play, logged to `LOADING.md` | `node tools/watch-loads.mjs` | ❌ W0 | ⬜ pending |
| TBD | 01-04 | — | RECOVER-05 | — | N/A | scripted anchor-search + offset proof | `node tools/diff-images.mjs --anchor-search danish.bin saeger.bin` | ❌ W0 | ⬜ pending |
| TBD | 01-05 | — | RECOVER-06 | — | N/A | scripted coalesced-diff → `PROVENANCE.md` | `node tools/diff-images.mjs --gap-tolerance 16` | ❌ W0 | ⬜ pending |
| TBD | 01-05 | — | RECOVER-07 | — | N/A | **manual — analytical, not automatable** | n/a (CSDb + binary inspection, written to `PROVENANCE.md`) | ❌ W0 | ⬜ pending |
| TBD | 01-05 | — | RECOVER-08 | — | N/A | scripted count from generated ranges | `node tools/diff-images.mjs --count-patches` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Waves:** Only plan 01-01 carries a wave number here. Every other plan in this phase is strictly sequential — each touches the single shared VICE instance or hard-depends on the prior plan's output — so wave numbering is not the mechanism that orders them; `depends_on` is. Plan-level ordering is authoritative.

---

## Wave 0 Requirements

- [ ] `tools/hostpath-boot.mjs` — wraps `devcontainer-host-path` + `disk_attach`/`autostart` — covers RECOVER-01
- [ ] `tools/dump-capture.mjs` — bank-scoped RAM capture + sidecar writer — covers RECOVER-02/03
- [ ] `tools/chip-state.mjs` — chip-state sidecar (VIC/SID/CIA/sprites) — covers RECOVER-02/03 (D-04)
- [ ] `tools/watch-loads.mjs` — on-demand-load watch arming/reporting — covers RECOVER-04
- [ ] `tools/diff-images.mjs` — anchor search, coalesced diff, patch count — covers RECOVER-05/06/08
- [ ] Framework install: **none** — Node built-ins only

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Crack-independence verdict | RECOVER-07 | Analytical judgement over external attribution evidence (CSDb records, cracktro text, loader byte-signatures, directory/BAM quirks). There is no oracle to assert against. | Gather the artifacts named in `01-RESEARCH.md` § "Crack-independence evidence", record each with its confidence tier, then state the verdict and the confidence weight it lends every "both releases agree" provenance call. Evidence list must be in `PROVENANCE.md`, not just the conclusion. |
| On-demand load absence | RECOVER-04 | Proving a *negative* over gameplay requires actually playing. A script can arm the watches but cannot cover the state space. | Arm watches via `tools/watch-loads.mjs`, then play through far enough to exercise every room, both opponents, death, and game-over. Record coverage achieved *and* the watch configuration, so "zero found" is a claim with evidence behind it. |
| Boot procedure defeats faked directories | RECOVER-01 | `vice_autostart`'s behaviour against a crack's faked directory is empirically unknown (research Pitfall 1). | Attempt `autostart`; if it fails, fall back to `disk_attach` + a recorded `LOAD"*",8,1` keyboard sequence. Record which path worked per image. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency bounded (script checks in seconds; capture checks at wave level)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

---

## Note on the Security Domain

`01-RESEARCH.md` § Security Domain argues ASVS is genuinely inapplicable to this phase: offline binary forensics against two already-possessed disk images via one trusted local MCP endpoint, producing no network surface, no untrusted input path, and no auth/authz. `workflow.security_enforcement` is nonetheless active (ASVS L1, block on `high`), so each PLAN.md still carries a `<threat_model>` block — expected to record the inapplicability with that reasoning rather than to enumerate fabricated web-app threats. The one real integrity concern worth modelling is **evidence integrity**: a mis-recorded dump trigger, an un-normalised diff, or a silently truncated `memory_read` would corrupt every downstream provenance verdict in the project.
