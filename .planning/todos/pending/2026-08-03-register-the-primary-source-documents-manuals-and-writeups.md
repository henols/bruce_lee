---
created: 2026-08-03T06:45:00.953Z
title: Register the primary source documents — manuals and writeups
area: docs
severity: minor
files:
  - docs/Bruce_Lee_1984_Mastertronic_budget.pdf
  - .planning/research/FEATURES.md:210-224
  - .planning/todos/pending/2026-08-03-pin-canonical-character-names-bruce-lee-yamo-and-the-ninja.md
---

## Problem

Four documents about *Bruce Lee* were handed over on 2026-08-03 and none of them are yet
registered anywhere the project can rely on. Two are **scans of the original printed manual**,
which is the only non-code artifact that can settle questions the disassembly cannot — what the
game *intended*, what the characters are called, how the controls were described to a 1984
buyer. The other two are secondary but useful colour.

The four:

| Source | What it is | Status |
|---|---|---|
| `docs/Bruce_Lee_1984_Mastertronic_budget.pdf` | Scan of the original manual, Mastertronic budget re-release | **In the repo but untracked** (`git status` shows `??`); 12 pages, 1.1 MB |
| https://c64online.com/wp-content/uploads/2021/03/Bruce-Lee.pdf | A second version of the original manual — likely the *earlier* Datasoft/US Gold printing rather than the Mastertronic budget one | Not fetched, not archived |
| https://www.lemon64.com/doc/bruce-lee/112 | Lemon64's document entry for the game (manual/instructions scan or transcription) | Not fetched; note this is a `/doc/` page, distinct from the `/game/bruce-lee` and forum pages already cited in `FEATURES.md:219` |
| https://retroarcadia.blog/2024/06/19/my-life-with-bruce-lee-on-commodore-64/ | Player/enthusiast retrospective, 2024 | Not fetched; secondary — anecdote and received wisdom, not documentation |

Three concrete problems, in order of how much they cost:

1. **The manual PDF is untracked.** It is the single hardest artifact to re-acquire and it is
   currently one `git clean` away from gone. `docs/` is not gitignored (`git check-ignore`
   exits 1), so nothing prevents committing it — it just hasn't been.

2. **The PDF has no text layer.** Probing every `FlateDecode` stream in it found **zero**
   streams containing `Tj`/`TJ` text operators — it is a pure image scan. The Read tool cannot
   render it either: `pdftoppm` is missing from this container. Both fixes are apt-installable
   and verified available (`poppler-utils` 25.03.0-5+deb13u4, `tesseract-ocr` 5.5.0-1+b1), but
   until one is installed the manual's contents are unreadable to any agent in this session.

3. **Two manual printings will not agree, and the difference matters.** A Mastertronic budget
   re-release and the original Datasoft/US Gold printing are separate typesettings of separate
   editions. Where they diverge — character names, control descriptions, scoring rules — the
   *earlier* printing is closer to what Ron J. Fortier actually built. Treating them as one
   document silently picks a winner.

Why this is worth a todo rather than a note: **the two manuals are the designated evidence for
an already-open question.** The `pin-canonical-character-names` todo's Solution step 1 says to
establish the Ninja's proper name "from the game's own material — the manual, the title or
attract screens, and any in-game text". That step cannot start until the manual is readable.
The same applies to the two-player-mode asymmetry that todo flags as unconfirmed: whether the
Ninja is ever player-controllable is exactly the kind of thing a manual's controls page states
outright and a disassembly makes you infer.

Note also that a manual is a **design-intent** source, not a behavioural one. This project
grades correctness by behavioural equivalence at checkpoints; a manual can say a thing the
shipped code does not do. Anything taken from it is a MEDIUM-confidence claim about intent
until live execution confirms it — which is the normal promotion path, not a caveat unique to
these documents.

## Solution

1. **Commit the PDF first**, before anything else in this todo. One `git add docs/` and a
   commit — cheapest step, largest irreversibility avoided.

2. **Make it readable.** `apt-get install -y poppler-utils` gets `pdftoppm`, which both enables
   the Read tool's page rendering and gives `pdftotext` (useless on a pure scan, but free).
   Add `tesseract-ocr` if a searchable transcript is wanted rather than page-by-page visual
   reading. Both stay inside the headless-Linux constraint.

3. **Fetch and archive the other three** into `docs/` alongside the first, named so the edition
   is unambiguous — e.g. `Bruce_Lee_1984_Datasoft_original.pdf` for the c64online copy. Archive
   the two web pages as well rather than trusting the URLs to survive; `retroarcadia.blog` is a
   personal blog and `lemon64.com/doc/bruce-lee/112` is an ID-numbered path, and neither is a
   durable citation.

4. **Diff the two manual printings** once both are readable, and record where they disagree.
   The disagreements are the interesting part — they are a provenance signal about which
   edition documents which build, and they mirror the release-diffing method the project
   already uses on the two cracked disks.

5. **Add all four to `.planning/research/FEATURES.md`'s Sources list** (line 210 onward), each
   with a confidence grade matching the existing entries' style. Give the manuals their own
   line as *primary* sources — the current list is entirely prior-art and community material,
   with no in-box documentation in it at all. Grade the retroarcadia retrospective LOW, on the
   same reasoning `FEATURES.md:221` already applies to the Spriters Resource rip: enthusiast
   recollection is a sanity check, never ground truth.

6. **Feed the result back into the character-names todo** rather than duplicating the work
   there. If the manual names the Ninja, that todo's one genuinely open item closes; if it does
   not, record the negative result there so it is not re-investigated — that todo already asks
   for exactly this.

Anything the manuals reveal about *how a system works* — rather than what it is called — goes
in `.planning/RE-FINDINGS.md` at the moment it is found, graded `Evidence: manual scan,
<edition>` / `Confidence: MEDIUM`, per the findings-log rules.
