---
phase: quick-260803-9hi
plan: 01
subsystem: docs
tags: [provenance, source-archival, manual, findings-log]

requires: []
provides:
  - "Five archived Bruce Lee source documents under docs/, with docs/SOURCES.md as their retrieval-provenance registry (origin, retrieval date, SHA-256, byte size, confidence grade per file)"
  - "A plain-text extraction of the Apple II Project 64 manual etext, greppable for scoring/damage/hazard/credits claims"
  - "Eight new dated findings-log entries in .planning/RE-FINDINGS.md, each with separate Evidence and Confidence fields, under a new 'Manual and printed-documentation findings' section"
  - "Both dependent todos annotated with progress and cross-references, left in pending/"
affects: [phase-5-documentation, character-naming, source-registry]

tech-stack:
  added: []
  patterns:
    - "Archive-then-register: irreversible/hard-to-reacquire artifacts get committed alone, first, before any network call that could fail"
    - "Edition-unknown filename as a deferred-work trigger, rather than asserting an unread document's provenance"

key-files:
  created:
    - docs/SOURCES.md
    - docs/Bruce_Lee_1984_manual_c64online_edition-unknown.pdf
    - docs/Bruce_Lee_1984_manual_AppleII_Project64_etext_lemon64.html
    - docs/Bruce_Lee_1984_manual_AppleII_Project64_etext.txt
    - docs/Bruce_Lee_C64_retroarcadia_2024_retrospective.html
  modified:
    - docs/Bruce_Lee_1984_Mastertronic_budget.pdf
    - .planning/research/FEATURES.md
    - .planning/RE-FINDINGS.md
    - .planning/todos/pending/2026-08-03-register-the-primary-source-documents-manuals-and-writeups.md
    - .planning/todos/pending/2026-08-03-pin-canonical-character-names-bruce-lee-yamo-and-the-ninja.md

key-decisions:
  - "poppler-utils/tesseract-ocr installation deliberately deferred (ephemeral container state, not an artifact; urgency evaporated once the Lemon64 transcription supplied the manual's contents for one edition; kept the network/archival task from acquiring an unrelated privilege failure mode)"
  - "c64online PDF named with an explicit edition-unknown placeholder rather than asserting it is the Datasoft original, since the PDF is an unread image scan"
  - "Two-player-mode disagreement between the Apple II manual (turn-taking) and FEATURES.md:202 (Yamo-controllable) recorded as an open question naming both sources, not resolved by overwriting either"

requirements-completed: [TODO-SOURCE-REGISTRY, TODO-NINJA-NAME-NEGATIVE]

duration: 25min
completed: 2026-08-03
status: complete
---

# Quick Task 260803-9hi: Archive Bruce Lee Source Documents Summary

**Archived all four Bruce Lee source documents under `docs/` with a SHA-256/provenance registry, extracted the Lemon64 page's full manual transcription as greppable plain text, and logged eight graded findings — most importantly that the transcription is the Apple II manual, not the C64 one.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-03T06:45:00Z (per todo creation time; execution began ~06:55Z)
- **Completed:** 2026-08-03T07:05:25Z
- **Tasks:** 3/3 completed
- **Files modified:** 10

## Accomplishments

- The Mastertronic manual scan — the single hardest artifact in this project to re-acquire, previously untracked and one `git clean` away from gone — is now tracked in git, in a commit of its own, landed before any network call.
- Three more documents (c64online PDF, Lemon64 manual page, retroarcadia retrospective) are archived locally under `docs/`, plus a fourth derived artifact: a hand-trimmed plain-text extraction of the Lemon64 manual transcription.
- `docs/SOURCES.md` registers all five files with origin, retrieval date, SHA-256, byte size, and a HIGH/MEDIUM/LOW grade, carrying the Apple-II-not-C64 caveat in bold in both the file's own section and its preamble.
- `.planning/research/FEATURES.md`'s Sources list gained its first four *primary* entries, introduced by a one-line note distinguishing them from the prior-art/community material below; line 202's existing two-player claim was left untouched.
- `.planning/RE-FINDINGS.md` gained a new "Manual and printed-documentation findings" section with eight dated 2026-08-03 entries, each carrying separate `Evidence:`/`Confidence:` fields — including the ninja-has-no-proper-name negative result (edition-scoped) and the two-player-mode open question (naming both sources, resolving neither).
- Both dependent todos were annotated with dated progress notes and left in `pending/`: the source-registry todo records steps 1/3/5/6 done, step 2 explicitly deferred with its reasoning, and step 4 outstanding-and-blocked-on-step-2; the character-names todo points its Solution step 1 at the new negative finding and records the two-player asymmetry as an open question.

## Task Commits

Each task was committed atomically:

1. **Task 1: Commit the Mastertronic manual scan, alone, before anything else** - `468891b` (docs)
2. **Task 2: Fetch and archive the other three sources, then write docs/SOURCES.md** - `062c778` (docs)
3. **Task 3: Wire the sources into FEATURES.md, RE-FINDINGS.md, and both todos** - `44a6278` (docs)

**Plan metadata commit:** pending (orchestrator handles the docs commit for PLAN.md/SUMMARY.md/STATE.md per this task's instructions)

## Files Created/Modified

- `docs/Bruce_Lee_1984_Mastertronic_budget.pdf` - Now tracked at its original 1,143,924 bytes (Task 1)
- `docs/Bruce_Lee_1984_manual_c64online_edition-unknown.pdf` - Second manual scan, 186,709 bytes, edition deliberately left unidentified in the filename
- `docs/Bruce_Lee_1984_manual_AppleII_Project64_etext_lemon64.html` - Archived source page (Lemon64's HTML rendering of the Project 64 etext)
- `docs/Bruce_Lee_1984_manual_AppleII_Project64_etext.txt` - Plain-text extraction, chrome trimmed, provenance footer preserved verbatim
- `docs/Bruce_Lee_C64_retroarcadia_2024_retrospective.html` - Archived 2024 enthusiast blog retrospective
- `docs/SOURCES.md` - New registry: what each file is, edition/platform, origin URL, retrieval date, SHA-256, size, confidence grade, with the Apple II caveat in bold
- `.planning/research/FEATURES.md` - Added four primary Sources entries ahead of the existing prior-art list; line 202 untouched
- `.planning/RE-FINDINGS.md` - New "Manual and printed-documentation findings" section, eight dated entries
- `.planning/todos/pending/2026-08-03-register-the-primary-source-documents-manuals-and-writeups.md` - Progress section appended, still pending
- `.planning/todos/pending/2026-08-03-pin-canonical-character-names-bruce-lee-yamo-and-the-ninja.md` - Two dated notes appended under Solution step 1, still pending

## Decisions Made

- **`poppler-utils`/`tesseract-ocr` installation deferred, not performed.** Reasoning (reproduced from the plan's own `<decisions>` block, and now also in the source-registry todo): an apt install is ephemeral container state, not a deliverable artifact; the urgency evaporated once the Lemon64 transcription supplied the manual's contents for one edition; and this task's whole value (irreversibility-avoidance) should not acquire an unrelated network/privilege failure mode. Both scanned PDFs remain unread image scans.
- **The c64online PDF is named `..._edition-unknown.pdf`, not `..._Datasoft_original.pdf`.** The PDF is unread; asserting an edition it hasn't been read to confirm would be a false claim. The filename itself is the trigger for the deferred rename once OCR happens.
- **The two-player-mode disagreement was recorded, not resolved.** The Apple II manual describes turn-taking two-player; `FEATURES.md:202` describes a C64 mode where a second human player drives Yamo. Both may be true across different ports — this is logged as an open question naming both sources in `.planning/RE-FINDINGS.md`, and `FEATURES.md:202` was deliberately left standing.

## Deviations from Plan

None — plan executed as written, including its extraction-tooling contingency.

**Environment note (not a deviation, matches the plan's own anticipated fallback):** this container's `python3` is missing the `html`/`html.parser`/`shutil` standard-library modules entirely (`import html` fails with `ModuleNotFoundError` even when run from the repo root, not only from the scratchpad as the plan's constraint anticipated). The plain-text extraction of the Lemon64 page was therefore produced with a regex-based tag stripper and a small fixed HTML-entity table, exactly as the plan's fallback instructed. No HTML entities were actually present in the extracted span, so entity-decoding was a no-op in practice; this is recorded in `docs/SOURCES.md`'s own entry for the `.txt` file so a future session doesn't re-diagnose the same missing-module surprise.

## Known Stubs

None. This is a pure documentation-and-archival task; no code, no UI, no rendered data paths.

## Threat Flags

None. All three downloads used HTTPS with no `-k`, byte sizes and SHA-256 hashes were recorded for every archived file in `docs/SOURCES.md` (closing T-9HI-01), and the two archived HTML pages are inert artifacts under `docs/`, never served or opened in a browser by any part of this project (closing T-9HI-03). No package-manager installs occurred (T-9HI-SC does not apply). No credentials or emulator contact were involved (T-9HI-04 does not apply).

## Self-Check: PASSED

All created/modified files verified present on disk; all three commit hashes verified in `git log --oneline --all`. See verification transcript below.
</content>
