---
created: 2026-08-03T06:21:11.565Z
title: Pin canonical character names — Bruce Lee, Yamo, and the Ninja
area: docs
severity: minor
files:
  - .planning/REQUIREMENTS.md:75-76
  - .planning/ROADMAP.md:97,785,791,793,803-804
  - .planning/research/ARCHITECTURE.md:110-111,150-151,213-214,260,284
  - .planning/research/FEATURES.md:197-198,202,204
  - .planning/PROJECT.md:25
---

## Problem

The three actors need one canonical set of names, fixed once and used identically in
`docs/systems/*.md`, in `src/` label prefixes, and in every checkpoint description. Naming
that drifts between prose and source is exactly the failure the one-to-one
`src/` ↔ `docs/systems/` mapping in `.planning/research/ARCHITECTURE.md:187` exists to
prevent.

What the user stated (2026-08-03):

- **The player character is Bruce Lee** — and it is the *real* Bruce Lee, i.e. a licensed
  likeness of the person, not a generic martial-artist protagonist. Worth saying once in the
  docs, because it explains why the title, the character, and the marketing are all built
  around a real individual rather than an invented one.
- **The green AI opponent is Yamo** — visually a sumo wrestler.
- **The black AI opponent is a ninja, and he has a specific name** — the user is certain a
  proper name exists but did not recall it. This is the one genuinely open item here.
- **Both opponents are AI-driven** (user, restated 2026-08-03) — the Ninja is not a scripted
  hazard or a patrol pattern; he runs his own state machine, distinct from Yamo's. Already
  reflected in DOCS-05 and plan 05-04, and in the two separate `ai/yamo.a` / `ai/ninja.a`
  source files.

  The asymmetry that follows, and which the glossary should state outright: per
  `FEATURES.md:202` **Yamo can be driven by a second human player** in one of the two-player
  modes, while nothing in the research set says the Ninja ever can. So "AI opponent" is an
  unconditional description of the Ninja and a mode-dependent one of Yamo. Confirm the Ninja
  is never player-controllable in either two-player mode before writing it down as fact —
  `FEATURES.md:202`'s silence on the point is not evidence.

Current state of the repo: `Yamo` and `the Ninja` are already the names in use across the
planning set — `REQUIREMENTS.md` DOCS-04/DOCS-05, `ROADMAP.md` Phase 5 and plans 05-03/05-04,
`ARCHITECTURE.md`'s `ai/yamo.a` / `ai/ninja.a` files and `ai_yamo_*` / `ai_ninja_*` label
prefixes, and `FEATURES.md`'s subsystem list (which also records Yamo's sumo styling and the
Ninja's bokken-stick attack). So this is not a rename of what exists; it is closing the gap
between "the Ninja" as a description and whatever his actual name is, and writing the whole
thing down in one place so nothing drifts.

Why it matters beyond naming: `ROADMAP.md:803-804` splits Yamo's AI and the Ninja's AI into
two parallel plans precisely because they are two distinct state machines. A shared glossary
is what keeps those two documents, their two source files, and their checkpoints from
cross-contaminating.

## Solution

1. Establish the Ninja's proper name from the game's own material — the manual, the title or
   attract screens, and any in-game text found while the RAM images are being combed for
   strings during the disassembly. A live string sweep over a captured 64K image is the
   cheapest route and costs nothing extra if done while a capture is already open. Record the
   provenance and a confidence grade alongside the name, as with every other claim in this
   project. If no in-game name is found, say so explicitly and keep "the Ninja" as the
   documented name, with the negative result written down so it is not re-investigated.

   **2026-08-03:** The Apple II Project 64 etext manual (`docs/Bruce_Lee_1984_manual_AppleII_Project64_etext.txt`,
   archived this session) gives the ninja no proper name — "the ninja" throughout, lowercase and
   often plural, against "the Yamo" with a definite article and a capitalised name. See finding
   `.planning/RE-FINDINGS.md` § "Manual and printed-documentation findings", entry "dead end /
   negative result: this edition's manual gives the ninja no proper name (edition-scoped)".
   **This narrows the item, it does not close it:** the negative result is scoped to this one
   Apple II edition. The two Commodore 64 manual scans
   (`docs/Bruce_Lee_1984_Mastertronic_budget.pdf`, `docs/Bruce_Lee_1984_manual_c64online_edition-unknown.pdf`)
   remain unread image scans (OCR deferred — see
   `.planning/todos/pending/2026-08-03-register-the-primary-source-documents-manuals-and-writeups.md`),
   so step 1 is still open pending either those two printings or a live in-game string sweep.

   **2026-08-03, second note:** the two-player-mode asymmetry this item already flags as
   unconfirmed now has a documented data point, not a resolution — the same Apple II manual
   describes a **turn-taking** two-player mode ("you and another person take turns being
   Bruce"), which disagrees with `.planning/research/FEATURES.md:202`'s claim that the C64
   release lets a second human player drive Yamo. See `.planning/RE-FINDINGS.md`'s "open
   question, not a conclusion" entry naming both sources. Neither source is confirmed as the
   definitive C64 truth; `FEATURES.md:202` was deliberately left standing, not overwritten.
   Confirming whether the Ninja is ever player-controllable in either C64 two-player mode — this
   item's actual open question — is unaffected and still requires live disassembly/execution.
2. Write the result into a single glossary — a short `docs/glossary.md`, or a named section
   of whichever docs entry point exists when Phase 5 starts — covering all three actors, each
   with its canonical name, its visual description, and the `src/` label prefix that belongs
   to it.
3. Sweep the planning set and any written docs for descriptive stand-ins ("the green
   opponent", "the black opponent", "the sumo") and replace them with the canonical names.
   Leave the *descriptions* in place where they aid recognition — "Yamo, the sumo-styled green
   opponent" is better than either half alone on first mention.
4. Keep the existing `ai_yamo_*` / `ai_ninja_*` label prefixes unless the Ninja's real name
   turns out to differ, in which case rename the prefix, the source file, and the doc
   filename together so the one-to-one mapping survives.
5. Add the "real Bruce Lee likeness" point to the docs' introductory framing — one sentence,
   not a section.

Best done at the start of Phase 5, when the actor documentation is written and the names get
used for the first time in anger.

## Relevant already-logged evidence (noted 2026-08-04, quick task 260804-elq)

`.planning/RE-FINDINGS.md` records a dead end that bears directly on this todo: **the Apple II
edition's manual gives the ninja no proper name**, logged explicitly as edition-scoped. So the
printed manual cannot settle the third actor's name on its own, and a canonical choice will have to
be made rather than found — which is worth stating in the decision itself rather than leaving the
absence of evidence looking like an unfinished search.

Note also that the widely-linked Lemon64 / Project 64 plain-text transcription is the **Apple II**
manual, not the C64 one. Any naming evidence taken from it is edition-scoped.

See [[2026-08-03-register-the-primary-source-documents-manuals-and-writeups]] for the full list of
already-extracted manual facts and their cautions.
