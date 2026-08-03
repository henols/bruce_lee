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
