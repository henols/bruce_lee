---
type: defect
severity: major
area: vice-mcp
files:
  - .claude/mcp/vice/install-resources.ts
found: 2026-08-05
found_by: orchestrator, while refreshing an 11-hour-stale host deploy
---

# `installResources()`'s default can never refresh a stale deploy — it reads "source moved forward" as "someone hand-edited the host copy"

`statusForEntry()` classifies each deployed file as `missing` | `present` (byte-identical) |
**`diverged`** (exists, differs). Without `force`, `installResources()` copies **only `missing`**
entries: `present` is skipped, and `diverged` is *refused* and merely reported.

**So once `resources/` moves forward, every deployed file becomes `diverged`, and the default install
is a silent no-op for exactly the files that most need updating.** Verified live on 2026-08-05:

```
installResources({ root })            -> installed: [], diverged: [6 files]
installResources({ root, force:true }) -> installed: [all 8]
```

## Why this is major rather than cosmetic

It is **how the host came to be running an 11-hour-stale broker without anyone noticing.** The
deployed copy predated 01.6.2.1 entirely, which meant the **CR-01 cross-session-kill fix was absent
from the running broker** while being present and sealed in the tree — the most consequential fix of
the day, silently not deployed. The install path reported success-shaped output (`failed: []`) while
having deployed nothing.

The refusal is *defensible as written* — "do not clobber a local edit" is a reasonable instinct — but
it is **the wrong default for this directory specifically**, because `.claude/CLAUDE.md` states that
`tools/` is "purely a generated, gitignored deployment target … never hand-edited". If nothing may be
hand-edited there, then `diverged` cannot mean "a hand-edit worth protecting"; it can only mean
**stale**. Defaulting to refuse protects against a state the directory's own contract forbids, at the
cost of silently failing at the one job the installer exists to do.

## Fix direction

1. **Invert the default for generated entries.** A `diverged` generated artifact should be overwritten
   by default, because staleness is the only thing divergence can mean for it.
2. **Keep the protection where it is real.** `resources/vice-launcher.sh` is the documented exception —
   hand-authored, not generated. That one deserves the current refuse-on-divergence posture, and
   distinguishing the two is the whole substance of this fix.
3. **Make the no-op loud.** Whatever the default becomes, `diverged: [6 files]` alongside
   `installed: []` and `failed: []` must not read as success. A caller that deployed nothing while
   six artifacts were stale should say so in a way an operator cannot skim past.
4. Consider whether anything **automatically** invokes the installer (its own header says it deploys
   "the first time any skill .mjs entry point runs"). If so, that automatic path has been silently
   no-op'ing on every stale artifact since the first divergence — which would explain the staleness
   without anyone having skipped a step.

## Note on what was done 2026-08-05

The deploy was refreshed with `force: true`, so `tools/` now matches committed `resources/` for all
seven generated artifacts (CR-01's fix and the `warm_floor` rename included). The **running** broker
still holds the old code — a disk swap is inert until restart, confirmed: the live record still reports
`spares_target`, and the emulator kept answering throughout. **Rollback**, if the new deploy ever
misbehaves, does not need a saved copy: check out an earlier commit of `resources/` and force-install
from it.
