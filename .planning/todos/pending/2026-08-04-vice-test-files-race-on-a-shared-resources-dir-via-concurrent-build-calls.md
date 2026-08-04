---
created: 2026-08-04
kind: tooling-hazard
observed_during: Phase 01.6.2.1 execution (wave 1 post-merge gate)
supersedes_note: promotes the phase-scoped note in .planning/phases/01.6.2.1-broker-lifecycle-policy/deferred-items.md to a repo-level todo
---

# Several `.claude/mcp/vice/*.test.*` files each call `build()` into the *shared* `resources/`, so the default concurrent runner produces false failures

## What happened

Phase 01.6.2.1's wave-1 post-merge test gate **failed** on two tests:

```
✖ handleAcquire: the grant-time-probe-failure log line is distinct from broker-kill.mts's shutdown wording
  SyntaxError: The requested module './broker-state.mjs' does not provide an export named 'atCapacity'
✖ a record file truncated mid-JSON is treated as absent and overwritten rather than throwing
```

Neither was real. `atCapacity` *is* exported by both the authored `broker-state.mts:347` and the
generated `resources/broker-state.mjs:171`, and `git status` showed `resources/` byte-clean against
the commit. Two independent re-runs passed — one serialized, one concurrent — at
402/397/0/5.

## Why

`node --test` runs test **files** concurrently by default. Several files in
`.claude/mcp/vice/` each independently call `build()` (`build.ts`), which runs `tsc` and writes into
the **same** `resources/` directory:

- `resources-sync.test.ts`
- `broker-e2e.test.ts`
- `vice-broker-launch.test.ts`
- `vice-broker-acquire.test.ts`

A file that imports or diffs `resources/` can therefore transiently read a sibling process's
half-written module. Symptoms seen so far: a bogus `does not provide an export named X`
`SyntaxError`, a bogus `resources-sync` *"the committed tree is STALE"* claim, and an unrelated
assertion failing exactly once.

## Why this matters more than a flaky test usually does

1. `resources-sync.test.ts` is the mechanism enforcing CLAUDE.md's hard rule that `resources/` is
   generated-but-committed and never hand-edited. A gate that cries wolf gets discounted, and this
   one is load-bearing.
2. The false symptom is **indistinguishable by shape** from a genuine one. A real rename that
   forgets to rebuild produces the identical `does not provide an export named X` error. Phase
   01.6.2.1 plan 05 was a rename touching four `resources/*.mjs` files — its executor had to be
   explicitly warned not to dismiss a real missing export as the flake.
3. The orchestrator had to run every subsequent wave gate with `--test-concurrency=1` to get a
   trustworthy signal, and pre-warn all five later executors in their dispatch prompts. Neither
   workaround survives the session.

## Candidate fixes

1. **Per-process scratch build, atomic rename.** Have `build()` emit into a per-process temp
   directory and only `rename()` into `resources/` once complete. Fixes the race at the source;
   concurrency stays on and the suite stays fast.
2. **Serialize just the builders.** Split the four `build()`-calling files into their own
   `node --test` invocation (a `pretest` step), or document "these must not run concurrently".
   Simpler, but leaves a trap for the next test file that calls `build()`.
3. **Set `--test-concurrency=1` for the whole suite** via `workflow.test_command`. Cheapest and
   makes the gate trustworthy immediately; costs wall-clock on the e2e tests, which spawn real
   brokers. Serialized full-suite runs measured ~36 s in this phase, so the cost is small today.

Option 1 is the real fix; option 3 is a one-line stopgap that makes the gate honest in the
meantime.

## Evidence

Wave-1 post-merge gate failure reproduced live, then cleared by two re-runs (one
`--test-concurrency=1`, one default-concurrency) with `git status` confirming `resources/` clean —
so the tree was never actually stale. Waves 2–6 gates all run serialized: 0 failures across
394 → 402 tests. Cause originally diagnosed by the wave-1 executor and recorded in
`.planning/phases/01.6.2.1-broker-lifecycle-policy/deferred-items.md`; independently reproduced by
the orchestrator.

Confidence: HIGH (observed, reproduced, and the shared-write mechanism identified in `build.ts`'s
call sites).
