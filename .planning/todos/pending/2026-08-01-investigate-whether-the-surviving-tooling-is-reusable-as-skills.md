---
created: 2026-08-01T15:29:31.041Z
title: Investigate whether the surviving tooling is reusable as skills
area: tooling
severity: minor
files:
  - tools/d64-parse.mjs
  - tools/d64-parse.test.mjs
  - tools/releases.mjs
  - tools/recovery-schema.mjs
  - .claude/skills/
---

## Problem

After the 2026-08-01 cleanup, `tools/` holds four pure-Node modules with zero emulator
contact. None has been assessed for whether it is a project artifact or a reusable
capability that belongs in `.claude/skills/`:

| Module | Lines | What it is | First impression |
|---|---|---|---|
| `d64-parse.mjs` (+ test) | 243 + 229 | Parses `.d64` BAM, directory chain, occupied track ranges. Pure bytes, no emulator, no project data. | **Most likely candidate.** Nothing in it is Bruce-Lee-specific — it works on any 1541 image. |
| `releases.mjs` | 107 | Read/write of the `RELEASES.json` registry. | Probably project data model, not a capability. |
| `recovery-schema.mjs` | 356 | Validates registry invariants; carries the parameterisation gate that stops any `tools/` file branching on a release id. | Project-specific by construction — the invariants *are* this project's. |

The question is which of these are capabilities someone else could use, and which are just
this project's own data plumbing wearing the same file extension.

### Start from the criterion this project learned the hard way

Do not start from "could this be a skill" — start from "what makes a skill worth existing",
because two of the three skills that existed on 2026-08-01 were deleted for failing that
test, and the reasons are the actual acceptance criteria here:

- **`vice-mcp-selector`** was 99 lines of prose describing a tool surface the agent already
  holds typed schemas for. A skill that restates what the model can already see adds a layer
  to read instead of tools to call. **Criterion: a skill must add capability or judgement,
  not narration.**
- **`c64-ram-capture`'s scripts** (984 lines) reached the emulator as a library, i.e. a second
  route around the tool surface. Deleted, and the skill survived only as a procedure the agent
  performs with `mcp__vice__*` calls. **Criterion: a skill must not become a place where
  code hides from a standing rule.**
- **`devcontainer-host-path`** was usage prose wrapped around code the MCP imports as a
  production dependency. Absorbed into `.claude/mcp/vice/` and deleted. **Criterion: if the
  system imports it directly, it is a module, not a skill.**

By that third criterion alone, `releases.mjs` and `recovery-schema.mjs` look like modules —
they are imported and invoked by this project, not consulted as a capability. `d64-parse.mjs`
is the interesting one: nothing imports it as a library, it is a standalone parser, and its
knowledge (35 tracks, BAM at 18/0, directory chain from 18/1, how to spot a faked directory)
is genuinely transferable.

### Also worth deciding

- **Where the knowledge lives if the code moves.** `d64-parse.mjs`'s header and its test names
  carry real findings — that both cracked disks' `BRUCE LEE` entries are genuinely well-formed
  rather than faked, and that occupied track ranges are derivable whether or not they match
  PROJECT.md. That is provenance evidence, not parser trivia. It must not evaporate into a
  generic skill README.
- **Whether a skill is even the right container.** `.claude/mcp/vice/` is being extracted as an
  installable package ([[2026-08-01-extract-the-vice-mcp-into-an-installable-package]]). If a
  `.d64` parser is reusable, a package may be the better home than a skill — skills are for
  things an agent reads and follows, packages for things code imports.
- **The `acme-build` and `c64-memory-mapping` precedent.** Both survived the cleanup untouched.
  Whatever criterion this investigation lands on should explain *why* those two are correctly
  skills, or it is not a criterion, just a preference.

## Solution

TBD. Suggested order:

1. Write down the keep/cut criterion explicitly, derived from the three deletions above, and
   check it against `acme-build` and `c64-memory-mapping` — a criterion that would delete
   those two is wrong.
2. Apply it to each of the four modules. Expect most to stay put; the goal is a recorded
   decision, not movement for its own sake.
3. Sequence before or alongside the package-extraction todo, since both are asking "what is
   this project's, and what is generally useful" about adjacent code.
4. For anything that does move, rescue its embedded findings first — the same mistake as
   deleting a SKILL.md and losing the domain knowledge inside it.

## Investigation result (2026-08-04, quick task 260804-brt)

**This todo's own table is stale.** It assesses four modules; `tools/` now holds **six** tracked
pure-Node modules plus four test files. `diff-images.mjs` (992 lines), `dump-artifacts.mjs` (316)
and `watch-loads.mjs` (574) all landed in phases 01-04/01-05 after this todo was written, and
`diff-images.mjs` turns out to be the strongest own-skill candidate of the whole set — the opposite
of this todo's guess that `d64-parse.mjs` was "the most likely candidate".

Also worth stating plainly: **19 files sit in `tools/`, and 8 of them were never candidates.**
`broker-*.mjs`, `vice-broker.mjs`, `container-guard.mjs` and `vice-launcher.sh` are gitignored
deployment copies of `.claude/mcp/vice/resources/` (see `tools/.vice-deployed.json`). They contact
the emulator, so a skill citing them breaks the hard rule twice over. Out of scope permanently.

### The criterion, applied

This todo's own three criteria were used unchanged. The third — *if the system imports it, it is a
module, not a skill* — is mechanically decidable, so it was settled by building the import graph
rather than by judgement:

| Module | Imported by production code | Verdict |
|---|---|---|
| `releases.mjs` | `recovery-schema`, `watch-loads`, `diff-images`, `dump-artifacts` (4) | **Module.** Data plumbing, exactly as this todo predicted. |
| `watch-loads.mjs` | `diff-images`, `dump-artifacts` (2) | **Module.** Its CLI is a convenience read-out over the same data model. |
| `recovery-schema.mjs` | — (but validates *this project's* invariants) | **Module / CI gate.** Project-specific by construction, as predicted. |
| `d64-parse.mjs` | — | **Insert into an existing skill** — done, see below. |
| `dump-artifacts.mjs` | — | **Insert into an existing skill** — done, see below. |
| `diff-images.mjs` | — | **Own skill.** Not yet built. |

The criterion survives this todo's own acceptance test: it keeps `acme-build` and
`c64-memory-mapping`. Both wrap a CLI, neither is imported by project code, and both add data or
flag judgement the agent does not otherwise hold. A criterion that deleted those two would be
wrong; this one does not.

### Why `d64-parse.mjs` became an insert rather than its own skill

This todo expected it to be the standout skill candidate because its knowledge is transferable.
Transferability turned out to argue for the **package** extraction this todo itself raises, not for
a SKILL.md: the CLI is two subcommands with no ordering and no flag judgement, so a whole skill
wrapping it would be narration — which is criterion 1's failure mode, the one that deleted
`vice-mcp-selector`. Its embedded findings were rescued rather than lost, per step 4: the
faked-directory detection (`suspicious` + `suspicious_reasons`, and that both project images come
back clean) is now stated in `c64-ram-capture` **and** logged in `.planning/RE-FINDINGS.md`.

### Why `diff-images.mjs` earns its own skill

Ordering that fails closed, which is the same thing that justifies `c64-ram-capture`'s numbered
capture sequence. Its pipeline is `anchor-search` → `proveOffset` (which *refuses a majority vote*)
→ `diff` → `count-patches` → `ledger` (which refuses to emit rather than launder an assumption),
and its own header calls it "the step most able to produce confident nonsense" — an un-normalised
diff manufactures false CRACKER-PATCH verdicts wholesale. It is also the implementation of a stated
project constraint ("provenance must be reconstructed by diffing, not assumed") and is currently
undiscoverable: **before 260804-brt, no skill referenced any `tools/` script at all.**

Such a skill would drive `diff-images` as its subject and merely *name* `releases.mjs list`,
`watch-loads check-idle` and `recovery-schema validate` as surrounding steps. Those three stay
modules; nothing relocates.

## Done

`c64-ram-capture` now calls both insert candidates (commit `9f1621d`). Steps 4–6 had described
`dump-artifacts`' job — concatenate sixteen 4096-byte reads, count to 65536, hash, record
`$0001`/video/registers — as manual prose while the tested module went unmentioned.

## Still open

1. **Build the provenance-diff skill for `diff-images.mjs`.** Held deliberately on 2026-08-04: a
   concurrent session was committing to `.claude/skills/` at the time (`3e9c37a`, `191e0d9`), so
   creating a new skill risked colliding with in-flight work.
2. **Decide `.claude/skills/c64-ram-capture/scripts/compare.mjs`.** An untracked 238-line
   `compare`/`floor`/`digest` implementation of the skill's comparison rules appeared during
   260804-brt, authored by neither that task nor its user. It is genuinely pure — it contacts
   nothing — so it does **not** repeat the violation that got this skill's original `scripts/`
   deleted, and it runs correctly against the committed `danish-gameentry-run*.bin` captures.
   Left untracked by explicit decision, because adopting it would both claim another session's
   uncommitted work and reverse that earlier deliberate deletion. Two things to resolve if it is
   ever adopted: the rewritten SKILL.md does not reference it, and its `2+ bits = FAIL` rule flags
   a single 2-bit difference at `$FAD8` — never-written RAM under the banked-out KERNAL, where
   this project's own findings say drift accumulates continuously, so the rule likely needs
   loosening before it is trustworthy as a gate.
3. **Sequence against the package extraction**, per this todo's original point 3. `d64-parse.mjs`
   is the concrete case: reusable, imported by nothing, and better served by a package than by a
   skill.
