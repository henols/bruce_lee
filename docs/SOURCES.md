# Source Documents Registry

This registry tracks the primary and secondary source documents archived under `docs/` for the
*Bruce Lee* (1984, Datasoft) reverse-engineering project.

**A manual is a design-intent source, not a behavioural one.** This project grades correctness
by behavioural equivalence at checkpoints (see `.claude/CLAUDE.md` § Constraints — Verification).
A manual can say a thing the shipped code does not do, and different printings/ports can
legitimately disagree with each other. Nothing sourced from any document in this registry is
**HIGH** confidence until live execution against the disassembly confirms it — **MEDIUM is the
ceiling** for design-intent claims drawn from these files. **One of the two manual scans below is
the Apple II edition, not the C64 one — its game-design content (scoring, damage, hazards, moves)
is shared across ports, but its platform specifics (loading, controls hardware, memory) are not,
and citing them as C64 fact is the exact failure mode this caveat exists to prevent.**

All five files below were retrieved 2026-08-03. SHA-256 and byte size are recorded so a later
silent re-fetch or substitution is detectable.

---

## `Bruce_Lee_1984_Mastertronic_budget.pdf`

- **What it is:** Scan of the original printed manual, Mastertronic budget re-release.
- **Edition / platform:** Mastertronic budget re-release. Platform not yet confirmed from the
  scan itself (unread — see below); assumed C64 given the project's scope, not verified.
- **Origin:** Already present in the working tree prior to this task; no URL (handed to the
  project directly, not fetched from the network).
- **Retrieval date:** 2026-08-03 (date tracked into git; the file itself predates this task).
- **SHA-256:** `5393fc28aaf7379f426592c7beed62dd31e7c4edf1b58063f17b7bb8a2414c22`
- **Size:** 1,143,924 bytes (12 pages).
- **Confidence grade:** **LOW** for anything claimed from its contents — it is a pure image scan
  with no text layer (every `FlateDecode` stream was probed; none contain `Tj`/`TJ` text
  operators) and `pdftoppm` is unavailable in this container, so **it is as yet unread**. Grade
  reflects the document's unread status, not a judgment on the manual itself once it can be read.
- **Open item:** Reading this file requires `poppler-utils` (`pdftoppm`) or `tesseract-ocr`,
  deliberately **not installed by this task** — see `<decisions>` in the executing plan and the
  `register-the-primary-source-documents` todo's step 2. Diffing this printing against the
  c64online PDF below (todo step 4) is blocked on this installation.

## `Bruce_Lee_1984_manual_c64online_edition-unknown.pdf`

- **What it is:** A second scan of the original printed manual, hosted by c64online.com.
- **Edition / platform:** **Unidentified.** The filename says so deliberately — this file is
  unread, so naming it after a specific printing (e.g. "Datasoft_original") would assert an
  edition nobody has verified. Identifying which printing this is (and whether it is the
  Mastertronic re-release above, the earlier Datasoft/US Gold printing, or something else) is the
  explicit open item this filename exists to flag, and it is what the deferred OCR step
  (see above) is for.
- **Origin URL:** `https://c64online.com/wp-content/uploads/2021/03/Bruce-Lee.pdf`
- **Retrieval date:** 2026-08-03, via `curl -L -A "Mozilla/5.0 (X11; Linux x86_64)"`.
- **SHA-256:** `4fc9a38cad85545346de9c62b9b00879831e12a5d2e9fd1cc640489ac105dcce`
- **Size:** 186,709 bytes — matches the `Content-Length` observed on the live HTTP response
  (verified with `curl -sSI -L`), so the download landed intact.
- **Confidence grade:** **LOW** for anything claimed from its contents, same reasoning as the
  Mastertronic scan above — it is as yet unread (image scan, same OCR blocker).

## `Bruce_Lee_1984_manual_AppleII_Project64_etext_lemon64.html`

- **What it is:** Lemon64's HTML-converted rendering of the Project 64 etext of the Bruce Lee
  manual. Archived as the raw page (not just linked), because both `lemon64.com`'s ID-numbered
  `/doc/` path and the origin `retroarcadia.blog` post are not durable citations.
- **Edition / platform:** **Apple II — NOT the Commodore 64 edition.** Its own REQUIREMENTS
  section states outright: "Apple II(R) series computer", "Apple compatible disk drive", and its
  GETTING STARTED section instructs the reader to "Insert the BRUCE LEE(TM) diskette" — there is
  no mention of the C64 anywhere in the document body. **Game-design content (scoring table,
  damage thresholds, named hazards, movement verbs) is shared across ports and is usable at
  MEDIUM confidence; platform-specific content (loading procedure, controls hardware, memory) is
  NOT and must never be cited as C64 fact.**
- **Provenance chain** (stated in the page's own footer, preserved verbatim in the `.txt`
  extraction below): Project 64 (`https://project64.c64.org/Games/BRUCEL10.TXT`), converted to
  HTML by Lemon64; the Project 64 etext itself was "converted to etext by anonymous, obtained from
  the Asimov Apple ][ site, http://www.apple.asimov.net/site/documentation/games/brucelee/
  BRUCEL10.TXT, April 1997, etext #200#".
- **Origin URL:** `https://www.lemon64.com/doc/bruce-lee/112`
- **Retrieval date:** 2026-08-03, via `curl -L -A "Mozilla/5.0 (X11; Linux x86_64)"`.
- **SHA-256:** `25b6930cbccdd9203112be68dbc4552613373a562d6dc8fba1674d28af88b5e6`
- **Size:** 32,277 bytes.
- **Confidence grade:** **MEDIUM** for the manual's own factual claims (design intent, one
  edition, cross-checkable against the disassembly); the Apple-II-vs-C64 identification itself is
  HIGH (stated outright in the document's own hardware section).

## `Bruce_Lee_1984_manual_AppleII_Project64_etext.txt`

- **What it is:** Plain-text extraction of the manual transcription above, with the Lemon64 page's
  site navigation, sidebar and footer chrome hand-trimmed away. This — not the archived HTML page
  — is what future greps and citations should read: the manual transcription plus the Project 64
  provenance footer, preserved verbatim.
- **Edition / platform:** **Same caveat as its HTML source, restated because this is the file
  most likely to be grepped directly: this is the Apple II manual, not the C64 one.**
- **Derived from:** `Bruce_Lee_1984_manual_AppleII_Project64_etext_lemon64.html` (same session,
  2026-08-03) — not independently fetched, so it has no separate origin URL. Extracted with a
  regex-based tag strip (Python's `html`/`html.parser` modules are absent from this container's
  standard library — confirmed via direct `import html` failure — so the fallback path was used;
  no HTML entities were present in the source span, so no entity-decoding step was needed).
- **Retrieval date:** 2026-08-03.
- **SHA-256:** `8138f3081954a14309674cc19827dc6d7a8d12ffd91dcaefc1415b4f1d305629`
- **Size:** 5,034 bytes.
- **Confidence grade:** **MEDIUM**, identical to its HTML source — this is a mechanical
  re-formatting of the same text, not an independent source.

## `Bruce_Lee_C64_retroarcadia_2024_retrospective.html`

- **What it is:** A 2024 player/enthusiast retrospective blog post about playing Bruce Lee on the
  Commodore 64. Archived as a page rather than trusted as a URL, since `retroarcadia.blog` is a
  personal blog with no durability guarantee.
- **Edition / platform:** Commodore 64 (stated in its own title/URL slug).
- **Origin URL:** `https://retroarcadia.blog/2024/06/19/my-life-with-bruce-lee-on-commodore-64/`
- **Retrieval date:** 2026-08-03, via `curl -L -A "Mozilla/5.0 (X11; Linux x86_64)"`.
- **SHA-256:** `df77bf5249e455f1e7dd968faa00c141ee38293d0deb03fb797b4935d6cd12bf`
- **Size:** 232,611 bytes.
- **Confidence grade:** **LOW** — enthusiast recollection, graded on the same reasoning
  `.planning/research/FEATURES.md:221` already applies to the Spriters Resource rip: a sanity
  check against other claims, never ground truth.

## `Bruce_Lee_C64wiki_2026-08-03.html` and `Bruce_Lee_C64wiki_2026-08-03.txt`

- **What it is:** The C64-Wiki article on *Bruce Lee* — a community-authored, C64-specific
  reference page. The `.txt` is a regex tag-stripped extraction of the same page (same
  extraction constraint as the Lemon64 file: this container's `python3` is `python3-minimal`
  and has no `html`/`html.parser`). Wiki chrome was dropped; article prose and tables kept.
- **Edition / platform:** **Commodore 64** — and this is why it earns its place. It is the only
  archived document here whose platform claims apply to *this project's* target release. Where
  it and the Apple II etext disagree, this is the one that speaks to the C64.
- **Origin URL:** `https://www.c64-wiki.com/wiki/Bruce_Lee`
- **Retrieval date:** 2026-08-03, via `curl -L -A "Mozilla/5.0 (X11; Linux x86_64)"`.
- **SHA-256:** `786694dad3ede001d2871f57c9455cb1efce6005bf4b9b54024e690e9f3a9e5d` (html),
  `9a97e91448e61a399c166d8ad45e72827b8c8bfe4b86f8d22c1d8d331e6913ed` (txt).
- **Size:** 64,931 bytes (html), 8,117 bytes (txt).
- **Confidence grade:** **MEDIUM** — community-authored and unsourced, so it is corroboration,
  not ground truth. It rates above the retroarcadia blog (LOW) because it is a structured
  reference making checkable factual claims rather than recollection, and because its scoring
  table independently reproduces the Apple II manual's to the point on all eight values.
- **What it settles:** the C64 has **three** game modes, not two — 1P; 2P-versus-computer
  (turn-taking); and 2P-versus-each-other where **player two is Yamo** and the roles swap when
  Bruce loses a life. That reconciles the Apple II manual against
  `.planning/research/FEATURES.md:202`: both descriptions were right about different modes.
- **Caution — extraction hazard, recorded because it nearly landed a wrong table in this repo:**
  the points table is rendered **value-first, then label**, and a first-pass text extraction that
  filtered short lines silently dropped the two-digit values (`50`, `75`), shifting every label
  against the wrong number. Read the table from the archived `.txt` (or the raw HTML), never from
  an ad-hoc re-extraction.

---

## Summary table

| File | Edition/Platform | Retrieved | SHA-256 (first 12 hex) | Size (bytes) | Grade |
|---|---|---|---|---|---|
| `Bruce_Lee_1984_Mastertronic_budget.pdf` | Mastertronic budget re-release, unread scan | 2026-08-03 | `5393fc28aaf7` | 1,143,924 | LOW |
| `Bruce_Lee_1984_manual_c64online_edition-unknown.pdf` | **Edition unidentified**, unread scan | 2026-08-03 | `4fc9a38cad85` | 186,709 | LOW |
| `Bruce_Lee_1984_manual_AppleII_Project64_etext_lemon64.html` | **Apple II**, not C64 | 2026-08-03 | `25b6930cbccd` | 32,277 | MEDIUM |
| `Bruce_Lee_1984_manual_AppleII_Project64_etext.txt` | **Apple II**, not C64 (derived) | 2026-08-03 | `8138f3081954` | 5,034 | MEDIUM |
| `Bruce_Lee_C64_retroarcadia_2024_retrospective.html` | Commodore 64, enthusiast blog | 2026-08-03 | `df77bf5249e4` | 232,611 | LOW |
| `Bruce_Lee_C64wiki_2026-08-03.html` | **Commodore 64**, community wiki | 2026-08-03 | `786694dad3ed` | 64,931 | MEDIUM |
| `Bruce_Lee_C64wiki_2026-08-03.txt` | **Commodore 64**, community wiki (derived) | 2026-08-03 | `9a97e91448e6` | 8,117 | MEDIUM |

## Open items

- **The c64online PDF's edition is unidentified.** Identifying it (Datasoft original? US Gold?
  a second Mastertronic printing?) requires OCR or manual visual inspection, both blocked on
  installing `poppler-utils`/`tesseract-ocr` — deliberately deferred by this task (see
  `.planning/todos/pending/2026-08-03-register-the-primary-source-documents-manuals-and-writeups.md`).
  Once identified, this file should be renamed off its `edition-unknown` placeholder.
- **Diffing the two manual scans** (Mastertronic budget vs. the c64online PDF) is blocked on the
  same OCR step, and is todo step 4.
- ~~**The Apple II etext's two-player-mode description (turn-taking) disagrees with
  `.planning/research/FEATURES.md:202`'s claim that Yamo can be driven by a second human player.**~~
  **RESOLVED 2026-08-03** by `Bruce_Lee_C64wiki_2026-08-03.txt`: the C64 has three modes, and the
  two descriptions are two *different* modes of the same game, not a contradiction. `FEATURES.md:202`
  stands; the Apple II manual was describing 2P-versus-computer. Still MEDIUM — a community wiki,
  not the disassembly — so the mode set remains a live-execution check, just no longer a conflict.
</content>
