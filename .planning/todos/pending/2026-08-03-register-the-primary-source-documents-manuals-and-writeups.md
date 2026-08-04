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

## Progress (2026-08-03)

Executed as quick task `260803-9hi`. Disposition of each step:

- **Step 1 (commit the PDF first) — DONE.** `docs/Bruce_Lee_1984_Mastertronic_budget.pdf` is
  tracked at its original 1,143,924 bytes, in its own commit, before any network call.
- **Step 2 (make it readable, `poppler-utils`/`tesseract-ocr`) — DEFERRED, not done.** Reasoning
  reproduced from the executing plan so it is not re-litigated:
  1. An apt install is ephemeral container state, not an artifact — it does not survive a
     devcontainer rebuild, so this task cannot "deliver" it; whoever does the OCR work installs
     it then, in the session that uses it.
  2. The urgency behind wanting OCR evaporated: the reason to want the manual readable *today*
     was to get at its contents, and the Lemon64 transcription (see step 3) already supplies
     them for one edition. What remains — the C64-vs-Apple-II diff — is genuine work with its
     own scope, not a side effect of archiving.
  3. This task's whole value was irreversibility-avoidance (step 1); it should not acquire an
     unrelated network/privilege failure mode that could strand it before that commit landed.
  Both `docs/Bruce_Lee_1984_Mastertronic_budget.pdf` and
  `docs/Bruce_Lee_1984_manual_c64online_edition-unknown.pdf` remain unread image scans.
- **Step 3 (fetch and archive the other three) — DONE**, with one deliberate naming deviation.
  All three archived under `docs/`: the c64online PDF as
  `docs/Bruce_Lee_1984_manual_c64online_edition-unknown.pdf` (see below — its edition, unlike
  what this todo originally guessed, is **not** assumed to be the Datasoft original), the
  Lemon64 page as `docs/Bruce_Lee_1984_manual_AppleII_Project64_etext_lemon64.html`, and the
  retroarcadia post as `docs/Bruce_Lee_C64_retroarcadia_2024_retrospective.html`. A fourth
  artifact was also produced: a plain-text extraction of the Lemon64 page at
  `docs/Bruce_Lee_1984_manual_AppleII_Project64_etext.txt` — this turned out to be a full
  transcription of the manual, not a scan, which is why it gets its own `.txt` file rather than
  only an archived HTML page.

  **Naming deviation from this todo's own step 3 suggestion:** the todo text above proposed
  `Bruce_Lee_1984_Datasoft_original.pdf` for the c64online copy. The file was named
  `..._edition-unknown.pdf` instead, because the PDF is an unread image scan (same OCR blocker
  as step 2) and nobody has actually confirmed which printing it is — naming it "Datasoft
  original" would assert an edition nobody has read. The `edition-unknown` filename is the
  rename trigger for whenever OCR happens.
- **Step 4 (diff the two manual printings) — OUTSTANDING, blocked only on step 2.** Cannot start
  until both `docs/Bruce_Lee_1984_Mastertronic_budget.pdf` and
  `docs/Bruce_Lee_1984_manual_c64online_edition-unknown.pdf` are readable.
- **Step 5 (add all four to `FEATURES.md`'s Sources list) — DONE.** Added as the list's first
  four *primary* entries (`.planning/research/FEATURES.md`, Sources section), each pointing at
  its `docs/` filename as well as its origin URL. The retroarcadia retrospective is graded LOW,
  per this todo's own instruction. `FEATURES.md:202`'s existing two-player claim was left
  standing, not overwritten — see step 6.
- **Step 6 (feed the result back into the character-names todo) — DONE.** See
  `2026-08-03-pin-canonical-character-names-bruce-lee-yamo-and-the-ninja.md`'s own progress
  note: the Lemon64 etext gives the ninja no proper name (a negative result, edition-scoped —
  the two C64 printings remain unread), and the two-player-mode asymmetry that todo flags as
  unconfirmed is now recorded as an open question in `.planning/RE-FINDINGS.md` naming both
  sources, rather than resolved.

**New outstanding item, not in the original Solution list:** the c64online PDF's edition is
unidentified (see step 3's naming note above) — identifying it is a second thing step 2's OCR
work unblocks, alongside step 4's diff. Full retrieval provenance (SHA-256, byte size, retrieval
date, confidence grade) for every archived file lives in the new `docs/SOURCES.md`, which did
not exist before this task.

This todo remains in `pending/` — steps 2 and 4 are still open.

## Do not re-extract: the facts are already in `RE-FINDINGS.md` (noted 2026-08-04, quick task 260804-elq)

`.planning/RE-FINDINGS.md`'s `## Manual and printed-documentation findings` section is **1151
lines**, and a substantial part of it is manual-derived game-domain fact already extracted, dated
and graded. When this todo runs, draw from there rather than re-reading the PDFs — and treat the
log as the provenance record, since each entry already carries its source.

Already extracted, with confidence grades attached:

- The **scoring table**, all eight values — and separately **cross-confirmed by two independent
  sources**, so this one is settled rather than single-sourced.
- **Damage thresholds and life count.**
- **Named in-fiction hazards/objects**, explicitly logged as doubling as a string-sweep target list.
- **Second-loop difficulty escalation** — instant respawn, plus one room losing its safe spots.
- **C64-specific metadata** — SID attribution, HVSC path, and the alternate title *Banzai*.
- **`POKE 5472,99` for unlimited lives** — a community cheat that hands over the **lives-counter
  address** ($1560). That is an RE lead, not just trivia.

Three cautions the log already records, which this todo must not lose:

1. **The Lemon64 / Project 64 transcription is the APPLE II manual, not the C64 one.** It is a full
   plain-text transcription rather than a scan, which makes it easy to over-trust. Several entries
   are explicitly edition-scoped to Apple II — including the credits nuance (Mirsky for
   programming, Fortier for concept) and the fact that this edition gives **the ninja no proper
   name**, logged as a dead end.
2. **The two-player disagreement was RESOLVED** — it was never a contradiction; the C64 has three
   game modes. Do not reopen it against `FEATURES.md:202`.
3. **A naive HTML-to-text extraction silently corrupted a value/label table.** If any of these
   values are re-derived from a web source, that hazard applies.

Related: [[2026-08-03-pin-canonical-character-names-bruce-lee-yamo-and-the-ninja]] — the ninja's
namelessness in the Apple II edition is directly relevant to pinning canonical names.
