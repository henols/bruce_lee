---
id: 260804-eu6
status: complete
date: 2026-08-04
title: Process RE-FINDINGS into the waiting skills; match crash content against the rewritten VICE MCP
---

# What landed

## 1. `vice-wedge-triage` — the eighth skill, and the last one that was waiting

Part 1 of the `blocker` supervisor-skill todo. Four states look identical from outside and the
intuitive fix destroys a healthy machine in one of them; the skill is the decision tree, not a
restatement of `vice_diagnose`'s schema. Carries: verdict → response one row at a time, the fact
that `vice_recycle`'s required `reason` **is** the evidence record (written to `.planning/incidents/`
before anything is killed), what is not recoverable, the manual four-call cycle bracket for a
session where `vice_diagnose` cannot answer, and a per-claim provenance table separating the HIGH
incident-derived content from the MEDIUM tool contract.

Registered by hand in `.claude/CLAUDE.md` — one-line diff, verified to touch only the
`GSD:skills-*` block. The generator was **not** run; it regresses this file's constraints.

Also registered in `.claude/mcp/vice/skill-docs.test.ts`'s `AGENT_DOCS`, under that file's own
standing instruction to add new agent-facing emulator docs. It passed both of that gate's
assertions when added, so the registration locks in a property that was already true. Gate re-run:
3/3 pass.

## 2. The widened vector sweep found two facts phase 01 missed

`derive.mjs vectors` went from six pairs to all six blocks (`$0300-$030B`, `$0314-$0319`,
`$031A-$0333`, `$8000`/`$8002` with a real `CBM80` check, `$A000/$A002`, `$FFFA-$FFFF`), with
`$0328` STOP and `$0330`/`$0332` LOAD/SAVE flagged as cracker-hook sites. Default output prints the
IRQ and hardware blocks; `--all` prints everything, so the common case did not get longer.

Run over all six committed gameentry captures, every value stable across all three runs of its
release:

| Vector | danish | saeger | |
|---|---|---|---|
| `$FFFA/$FFFB` NMI | `$1116` | `$1116` | **New** |
| `$FFFC/$FFFD` RESET | `$1116` | `$1116` | **New — same address as NMI** |
| `$0328/$0329` ISTOP | `$F6FC` | `$F6ED` | **New divergence**, but residue |
| `$8004` `CBM80` | absent | absent | Nothing catches a reset |

NMI and RESET sharing an entry point is the shape of an anti-tamper trap — logged at **LOW** for the
interpretation, HIGH for the values, with the perturbation experiment fully specified against a
concrete address for when the emulator is available.

**A near-miss worth recording:** the first draft shouted `CRACKER-HOOK SITES DIVERTED` at danish's
`$0328` and was wrong — with HIRAM 0 that whole block is dormant, so a non-default byte there is
leftover KERNAL boot value, not a hook. The script now labels dormant blocks and reports *residue*,
firing a hook alarm only for a live block.

## 3. Non-game-layer scope rule — `c64-program-recon` step 0

Ahead of the entry-point → vectors → main-loop chain, because tracing a depacker's IRQ handler is
wasted work. Three layers named (loader / cruncher / cracktro), the rule as a standing default, and
the evidence bar in **both** directions with both recorded failures as worked examples. Cites
`c64-provenance-diff`'s machinery rather than restating it.

## 4. Four corrections against the rewritten MCP

| Was | Now |
|---|---|
| "Read the restart epoch at the start of a capture and again at the end" | **No exposed tool does that.** The proxy compares it around every forwarded call and raises drift itself; record that no drift error appeared |
| Hazard 2's manual checkpoint enumeration | `vice_diagnose` does it with no resume — call it first — plus the shape-coverage caveat |
| `vice_run_until` unqualified | Its `cycles` timeout is "not yet implemented"; an unreachable address reads exactly like a wedge |
| Vector target in a ROM window: "check `$01`" and stop | Read it twice, default bank and `bank: "ram"`, and compare |

## 5. Two MCP defects — filed, not fixed

`.planning/todos/pending/2026-08-04-vice-diagnose-checkpoint-trap-shapes-miss-mid-handler-arming.md`,
per CLAUDE.md's triage rule. The load-bearing one: `checkpoint_trap` matches two shapes, and a
checkpoint armed *mid*-handler with a non-zero hit count matches neither, falls through to `wedged`,
whose response is the destructive one. Mitigated skill-side; three options recorded for the fix
rather than a patch, because widening the shapes trades one false positive for a worse one.

## Verification

- All 8 skills pass the frontmatter checker.
- Every command shown in the modified skills was re-run; the four changed output lines quoted in
  `c64-program-recon`'s worked example were diffed against real output.
- `skill-docs.test.ts` 3/3 pass with the new doc registered.
- `.claude/CLAUDE.md` diff is 1 insertion, inside the skills block only.
- `derive.mjs` imports `node:fs` alone and opens nothing — the `mcp__vice__*` single-route rule holds.

## Not done, deliberately

- **Live verification of anything.** `vice_diagnose` reports no `broker.json` record exists on this
  host, so the emulator was unreachable for the whole task. Every MCP-derived claim is graded from
  source-read plus one schema cross-check and labelled unexercised; nothing is claimed as live.
- **The cracktro todo's step 4** — widening `.claude/CLAUDE.md` § Stack Patterns to cover the whole
  non-game layer. It is not broad enough today, but that section is inside a GSD-managed block whose
  generator is known to regress this file, so hand-editing it is the user's call.
- **The N≥3 drift-stability gate.** Its todo is explicitly a decision, not a move, and left so.
</content>
