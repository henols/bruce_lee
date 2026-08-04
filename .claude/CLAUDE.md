<!-- GSD:project-start source:PROJECT.md -->

## Project

**Bruce Lee — Reverse Engineering & ACME Reconstruction**

A complete reverse engineering of the 1984 Commodore 64 game *Bruce Lee* (Datasoft / Ron J. Fortier), taking it apart down to individual bytes and rebuilding it from annotated ACME assembly source. The output is two intertwined artifacts: a documentation set that explains how every gameplay system works, and a buildable source tree that produces a game which plays identically to the original.

The documentation and the rebuild are not separate deliverables — the rebuild is the proof that the documentation is correct.

**Core Value:** An ACME source tree that rebuilds a Bruce Lee which plays identically to the original, where every gameplay system is explained well enough that someone could change it.

### Constraints

- **Tech stack**: ACME cross-assembler as the only assembler — Explicit project goal; the rebuild must assemble with ACME, so all source idioms must be ACME-compatible.
- **Tooling**: VICE lives on the host, reached only via the `mcp__vice__*` tools — This is a hard rule. Those tools are the single permitted access point to the emulator. No script, module, test or driver may open its own connection to the host VICE, read broker state to find a port, or import a transport module as a library. Reimplementing that route cleanly is the same violation as importing it. If a design needs a Node process to reach VICE, the design is dead — say so and replan.
- **Tooling**: Everything runs headless in this Linux container — Any tool that needs a GUI, a display, or a Windows runtime is out of scope and stays out. There is no fallback to a desktop application.
- **Tooling**: `.d64` packaging is done from Python — The `d64` library reads and writes disk images; `cc1541` builds from source as a fallback for a bootable image.
- **Source material**: Only cracked releases available, no original master — Provenance must be *reconstructed* by diffing, not assumed. Every documented byte carries a confidence level.
- **Verification**: Behavioural equivalence only — Correctness is defined by replay + checkpoint comparison. Anything not observable at a checkpoint is not verified, so checkpoint design is a first-class task, not an afterthought.
- **Compatibility**: Rebuild must run on stock C64 in VICE — No host-side helpers, no emulator-only behaviour.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

Everything here runs natively in this headless Linux container. Nothing in this project needs a
GUI, a display, or a Windows runtime, and nothing that does will be adopted — if a capability
appears to require one, the answer is to find a scriptable route or to say the capability is
unavailable, never to reach for a desktop application.

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| ACME | 0.97 "Zem" (2021-01-31), Debian pkg `1:0.97~svn20211115+ds-2` | The one true assembler for the rebuild | Already installed at `/usr/bin/acme` — **verified directly** (`acme --version`). It's the project's mandated assembler; nothing to decide here. Confidence: HIGH (verified in-container). |
| `toacme` | ships with the `acme` Debian package | Static `.prg`→ACME-source dead-listing disassembler | **Verified present** at `/usr/bin/toacme` (`dpkg -L acme` confirms it's part of the same package). The `acme-build` skill already wraps it (`node acme.mjs disasm file.prg`). Zero setup cost, but produces a **linear, untraced** listing — code and data are not separated, illegal opcodes decode as instructions. Use it as the fast first pass, not the final disassembly. Confidence: HIGH (verified in-container). |
| regenerator2000 | actively maintained, 2026, Rust, `cargo install regenerator2000` | Traced 6502 disassembler producing **reassemblable ACME source** with code/data separation | The real upgrade over `toacme`, and it runs natively on Linux with no display. Accepts `.prg`, `.d64`, `.crt`, `.t64` and VICE `.vsf` snapshots; auto-traces execution flow (x-refs, jump tables) instead of linear decode; exports directly to **ACME**, plus 64tass/KickAssembler/ca65; imports and exports **VICE label files**, so labels round-trip with `mcp__vice__vice_symbols_load` / `mcp__vice__vice_symbols_lookup`. Use its static disassembly, ACME export and label interchange only. Confidence: MEDIUM (documentation cross-checked, not hands-on tested here). Install: `apt-get install -y cargo rustc` (Debian trixie ships rustc/cargo 1.85 — verified via `apt-cache policy`), then `cargo install regenerator2000`. |
| Python | 3.13.5 | Host language for depacking-dump post-processing, data extraction, `.d64` writing | **Verified present** (`python3 --version`). `pip`/`venv` are not pre-installed but are apt-installable (`python3-pip` 25.1.1, `python3-venv` 3.13.5-1 — verified via `apt-cache policy`). Confidence: HIGH (verified in-container). |
| `d64` (PyPI) | 1.10 (2023-09-17, Production/Stable) | Read **and write** `.d64`/`.d71`/`.d80`/`.d81`/`.d82` images from Python | This is the resolution to the "no `c1541`" gap. `pip install d64` gives a `DiskImage` context-manager API for directory listing, file extraction, and file writing into a disk image. It is a pure-Python library, so it works unmodified in the container. Confidence: MEDIUM (PyPI page + community references cross-checked; write-path details for building a *bootable* image from scratch were not independently exercised — validate BAM/directory-track behaviour empirically in the build phase). |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Pillow | current (`pip install Pillow`) | Turn raw C64 bitmap/sprite/charset bytes into PNG | Primary tool for data extraction. C64 graphics are byte planes at known offsets (sprite = 63 bytes + pointer, charset = 8 bytes/char, screen = 1000 bytes + colour RAM), so a small script using `Image.putpixel`/`frombytes` against a C64 palette table converts any of them to PNG straight from a memory dump. Write it per-format rather than adopting a generic ripper: the exact conversion (multicolor vs hires, VIC bank selection, `$D018` interpretation) has to follow what the disassembly reveals about *this* game's graphics mode. |
| JSON (stdlib) | — | Structured export of level layout, animation/move tables, non-graphical data | Table and array data (room layouts, sprite animation-frame indices, collision tables) is better served as JSON than as an image — write a small decoder per table format once the disassembly reveals its layout, dump to `.json` next to the `.png` assets. |
| Python `hashlib` (stdlib) | — | Framebuffer / RAM-region hashing for the verification harness | `sha256` over the **decoded pixel array**, never over returned PNG bytes — PNG encoders can emit different byte streams for pixel-identical images, which reads as a verification failure that isn't one. Decode via Pillow, hash the raw `.tobytes()`. |
| `pytest` | current | Structuring the replay/regression test suite | Standard, and gives fixtures, parametrization over checkpoints, and CI-friendly output for the verification harness. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| VICE, via the `mcp__vice__*` tools | All emulation: running the cracked disk, live-memory depacking, screenshot/RAM/state inspection, scripted input, snapshotting | Not something to install — it is the given execution environment, and the only route to it. The tool schemas are already in front of you; read parameters off them rather than off any description or manifest. See § Emulator Access for the rules that govern their use. |
| `cc1541` | Fallback `.d64` writer if the `d64` Python library proves insufficient for a bootable image | C source, MIT-licensed, canonical repo at `bitbucket.org/PTV_Claus/cc1541` (GitHub mirror `TrantorHF/cc1541`). Builds with a plain `make` (small C project, no exotic deps) — buildable in this Debian container with just `build-essential`. Not needed as the primary path, but a good insurance policy: it directly replaces the missing `c1541` for "add file(s), fix interleave, write BAM/directory" duties that a from-scratch Python writer would otherwise have to get exactly right. |
| `cargo`/`rustc` | Build regenerator2000 from source or via `cargo install` | `apt-get install cargo rustc` — confirmed candidate version 1.85.0+dfsg3-1 in Debian trixie main via `apt-cache policy` (not installed by default in this container, but available). |

## Installation

# Already present — verify, don't reinstall

# Disassembly upgrade path

# Python side: pip/venv are not preinstalled, apt-get them first

# Fallback .d64 writer, only if the d64 library can't produce a bootable image

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Depacking by execution: attach the disk, run the loader, checkpoint once decrunching is complete, read the flat RAM image | Static depacking | Never, for this project. Both disks use custom raw-sector loaders that bypass KERNAL, so static disk-sector disassembly is a dead end regardless of crunching — and `danish.d64`'s `TCS-CRUNCH!` signature is not documented anywhere. Running the real 6502 code until the game is up gets past any crunch scheme without having to identify it. This is already proven for both releases. |
| `toacme` for a fast first-pass dead listing, regenerator2000 for the real traced disassembly | — | No alternative. The tools the C64 community historically used for this are Windows GUI applications; they cannot run here and are not to be pursued. regenerator2000 covers the same traced-disassembly ground natively and scriptably. |
| `d64` Python library for `.d64` read/write | `cc1541` (C, build-from-source) | Reach for `cc1541` if the `d64` library's write path can't reproduce the BAM/directory/interleave behaviour a stock KERNAL loader expects for a *bootable* disk. It is a mature CLI disk-mastering tool that builds with a plain `make`. |
| A purpose-written Pillow script per graphics format | A third-party ripper | Never. Rippers emit their own formats and guess at the graphics mode; this project needs PNG/JSON driven by what the disassembly actually says about VIC banking and `$D018`. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Any tool requiring a GUI, a display, or a Windows runtime — including Wine to host one | This is a headless Linux container and the pipeline must stay scriptable. A tool that needs a desktop cannot be automated, cannot run in CI, and cannot be re-run by someone else to reproduce a result. Prior-art writeups for this kind of project lean on such tools; that is not a reason to adopt them. | The native Linux equivalents already in this table. If there is no equivalent, report the capability as unavailable rather than reaching for a desktop application. |
| Wall-clock delays (`sleep`) to synchronise scripted input with game frames | The biggest source of flakiness in emulator automation: real time does not map deterministically onto emulated cycles, and the mapping shifts with host load. | Synchronise on checkpoint hits and frame counts only. Execution between two checkpoints is deterministic given identical starting state and identical injected input; real time is not part of the loop. |
| Hashing returned screenshot PNG bytes | PNG encoders can produce different byte streams for pixel-identical images, which reads as a verification failure that isn't one. | Decode to a pixel array with Pillow first, then hash `.tobytes()`. |
| `toacme`'s dead listing as the final annotated disassembly | It performs no code/data separation and decodes data regions (BASIC stub, strings, tables) as bogus instruction streams — as the `acme-build` skill's own documentation warns. Fine as a first-pass sanity check; not the deliverable. | regenerator2000's traced disassembly, then manual code/data annotation validated against real execution traces. |

## Stack Patterns

- Don't fight the `d64` library into mimicking the original's *faked* directory scheme — the rebuild's `.d64` only needs to boot correctly via a real, valid directory. Reproducing the crack loader's tricks is an obstacle this project's scope explicitly excludes, not a deliverable.
- Write a straightforward BASIC stub (`!byte`/`!word` tokenized `10 SYS <addr>` line, matching what the `acme-build` scaffold already generates) plus the program's own load address, then let `d64` or `cc1541` place it as a normal PRG entry with a real BAM.
- Cross-check every static claim against live execution: checkpoint through the region and confirm what the program counter actually visits. If a byte range is never hit as an instruction stream across full gameplay coverage (title, all rooms, combat, death, both AI opponents, game over), treat it as data regardless of what the tracer guessed.
- The provenance diff is a second check on the same question: a region that differs between the two cracked releases but is claimed as code by the auto-tracer is worth a closer look.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| ACME 0.97 | `toacme` (same package) | Guaranteed matched version since both ship in the same Debian package — no separate compatibility risk. |
| ACME `--vicelabels` output (`.vs` file) | `mcp__vice__vice_symbols_load` (format `vice`) | The `acme-build` skill already produces this via `node acme.mjs build game.a`, which passes `--vicelabels ${stem}.vs` to `acme`. This is the working answer to symbol/label interop — no extra tooling, just load the resulting `.vs` after each build. |
| regenerator2000's exported VICE label files | `mcp__vice__vice_symbols_load` | Same channel as the ACME `.vs` output above, so labels flow disassembler → source → build → debugger and back without translation. Confidence: MEDIUM (not hands-on verified here; check the exact format the first time it is used). |
| `d64` (PyPI) 1.10 | Python 3.13.5 (installed) | PyPI classifiers list Python 3 broadly; no version ceiling found in the search. Confirm at install time with `pip install d64` inside a venv rather than assuming; it's a small, stable, single-purpose library so risk is low. |
| Debian trixie `cargo`/`rustc` 1.85.0+dfsg3-1 | `cargo install regenerator2000` | Current stable Rust toolchains build current crates.io crates without issue; no known incompatibility, but this pairing hasn't been executed in this specific container yet — treat the first `cargo install` as the verification step. |

## Sources

- `/usr/bin/acme --version`, `dpkg -L acme`, `which toacme`, `python3 --version` — direct verification in this container. Confidence: HIGH.
- `apt-cache policy cargo rustc python3-pip python3-venv` — direct verification in this container; the rust toolchain and python packaging tools are apt-installable but not preinstalled. Confidence: HIGH.
- [github.com/ricardoquesada/regenerator2000](https://github.com/ricardoquesada/regenerator2000) — install method, supported formats, ACME export, VICE label interchange. Confidence: MEDIUM.
- [pypi.org/project/d64](https://pypi.org/project/d64/) — version, install command, `DiskImage` API shape. Confidence: MEDIUM.
- [bitbucket.org/PTV_Claus/cc1541](https://bitbucket.org/PTV_Claus/cc1541/src/master/) — MIT license, plain C build, usage syntax. Confidence: MEDIUM.
- [github.com/mwenge/gridrunner](https://github.com/mwenge/gridrunner) and [github.com/mwenge/iridisalpha](https://github.com/mwenge/iridisalpha) — closest available prior art for structuring this kind of project: byte-exact reassembly validation via checksum, and code/data separation heuristics. Its specific tooling choices are Windows GUI applications and do not transfer; the structural lessons do. Confidence: MEDIUM.
- `"TCS-CRUNCH"` cruncher signature — searched, genuinely undocumented anywhere found. A real gap, recorded as one. It costs nothing here, because depacking by execution never needs to identify the cruncher.

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

| Skill | Description | Path |
|-------|-------------|------|
| acme-build | Assemble Commodore 64 6510 assembly with the ACME cross assembler. Use when asked to assemble, build, compile or link .a/.asm 6502/6510 source, produce a C64 .prg, scaffold a new C64 program, list the symbols a program uses, or turn a .prg back into ACME source. | `.claude/skills/acme-build/SKILL.md` |
| c64-memory-mapping | Look up what any C64 address means and turn raw 6502 disassembly into documented assembly, by resolving every address against the C64 memory map, KERNAL ROM routine list, canonical assembler symbols, and per-bit VIC-II/SID/CIA register tables. Use when asked to annotate or comment assembly, document a disassembly listing, or look up an address like $D020, $EA24 or $FFD2. | `.claude/skills/c64-memory-mapping/SKILL.md` |
| c64-program-recon | Work out how an unknown C64 program is structured at runtime — entry point, interrupt handlers, main loop, game states, graphics and sound — in a fixed order, before disassembling anything. Use when asked to reverse engineer a C64 game, find the main loop, entry point or IRQ handler, locate the player sprite, charset or music player, identify a game state machine, work out which memory regions are code versus data, or decide where to start on a depacked image. | `.claude/skills/c64-program-recon/SKILL.md` |
| c64-provenance-diff | Decide whether a byte in a cracked C64 release is original game code or something a cracker changed, by diffing two or more independently-cracked releases at an anchor-proven offset. Use when asked to diff two releases or disk images, work out which bytes the cracker patched, tell loader or cracktro code from game code, prove a byte is original, establish provenance or confidence for a memory range, regenerate the provenance ledger, or run anchor-search, count-patches or diff-images. | `.claude/skills/c64-provenance-diff/SKILL.md` |
| c64-ram-capture | Capture a running C64's full 64K RAM as a verified flat image, and prove two captures are equivalent. Use when asked to dump RAM, depack a program by running it, capture a memory image at a checkpoint, or compare two captures for reproducibility. | `.claude/skills/c64-ram-capture/SKILL.md` |
| find-skills | Helps users discover and install capabilities from the open agent skills ecosystem. Use when users ask "how do I do X" for specialized tasks, request "find a skill for X", want to extend agent capabilities, or need help with specific domains (testing, design, deployment, etc.). | `.claude/skills/find-skills/SKILL.md` |
| skill-writer | Write a new skill for this repo, or fix one that never triggers. Use when asked to create, author, add or scaffold a skill, to turn a repeated procedure into a skill, to review or rewrite an existing SKILL.md, or to work out why a skill is not being picked up. | `.claude/skills/skill-writer/SKILL.md` |
| vice-wedge-triage | Decide whether a VICE emulator that has stopped responding is genuinely wedged, stopped itself at your own checkpoint, crashed and respawned, or merely paused — and what is safe to do about each. Use when asked why the emulator is stuck, frozen, hung, wedged, dead or not advancing, when a cycle bracket reads zero, when vice_ping says running but nothing happens, when a checkpoint never fires, when deciding whether to recycle or restart VICE, or when a run has to be voided and its evidence recorded. | `.claude/skills/vice-wedge-triage/SKILL.md` |
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->

## Emulator Access

Kept outside the GSD-managed blocks above so a regeneration does not drop it.

The `mcp__vice__*` tools are the only allowed way to reach the emulator. Rely on them; never
try to break out of them.

Access is per-session and boot-fresh: an instance is
granted on that session's first forwarded tool call, and it is yours for the session. Nothing
needs starting by hand, and host paths are translated for you — pass container paths and let
the tools handle the boundary.

- **Paths: pass a container path, relative or absolute, and read back what it resolved to.**
  `path` arguments (`vice_disk_attach`, `vice_autostart`, `vice_display_screenshot`,
  `vice_symbols_load`) accept `disks/saeger.d64` as readily as
  `/workspaces/bruce_lee/disks/saeger.d64`; a relative one resolves against the **workspace
  root**, never the caller's directory, so a worktree gets the main workspace's copy unless it
  passes an absolute path. When a relative path is resolved the result says so, naming what was
  written and the absolute container path it became — check that line rather than assuming.
  A path outside the mounted workspace (`/tmp`, the scratchpad) is refused before forwarding,
  because the host cannot see it under any name; move the artifact inside the workspace.
  Everything else stays byte-identical, so an argument that merely looks path-shaped is never
  rewritten.
- Use the tools that are exposed to you, and only those. If a capability you expect is not in
  the tool list, it is not available — do not look for another way to obtain it.
- Read a disk's directory by parsing `.d64` bytes with `tools/d64-parse.mjs`, or with
  `mcp__vice__vice_disk_read_sector` when the emulated drive's own view is what matters.
- Most state reads pause the emulator. Read state first, poll with `mcp__vice__vice_ping`, and
  resume exactly once at the end.
- Do not try to read the restart epoch — **no exposed tool does.** The proxy compares it around
  every forwarded call and refuses the call, or discards its result, with a loud error naming both
  values. A clean run is one during which no epoch-drift error appeared; record that, not a pair of
  hand-read numbers. `mcp__vice__vice_recycle` changes the epoch by design, so it voids any run in
  flight. See the `vice-wedge-triage` skill.
- Synchronise input on checkpoint hits and frame counts. Never on wall-clock delay.
- `tools/` holds pure logic only — resolution, attribution, ordering, rendering — over data the
  agent fetched through the tools and passed in. Nothing under `tools/` contacts the emulator.
- Log VICE MCP quirks observed while driving the emulator as a file in `.planning/todos/pending/`
  rather than fixing them inline — a triage rule about not derailing a plan, not a ban on
  maintaining the implementation.
- `.claude/mcp/` is the tracked `mcp__vice__` implementation. It is read and edited only when the
  task at hand *is* maintaining that implementation, as opposed to using it to reach the emulator.
  Three tiers exist, in the order a maintainer touches them: **authored TypeScript** source lives
  flat in `.claude/mcp/vice/` (`.ts`/`.mts` files, siblings of `resources/`) — this is what a
  maintainer edits. **`resources/` is generated, but committed** — `tsc` emits here, every
  generated file carries a banner naming its source and warning that edits are overwritten, it is
  never hand-edited, and never trusted without rebuilding first, since a stale build looks
  identical to a fresh one until you diff it (`resources-sync.test.ts` does that diff on every
  test run). The one exception is `resources/vice-launcher.sh`, which stays hand-authored — it is
  not generated, and lives there only because the installer deploys the whole directory as a unit.
  **`tools/` remains generated and gitignored**, exactly as before — a disposable host deployment
  target, copied from `resources/` by the existing deployment mechanism, never hand-edited either.
- `.vice-supervisor/` is runtime state written by the running broker/supervisor/pool; nobody
  hand-edits it, in either mode of work.

## Reverse-Engineering Findings Log

Also kept outside the GSD-managed blocks, for the same reason.

**Every finding that makes reverse engineering faster goes in `.planning/RE-FINDINGS.md`, at
the moment it is found.** That file is the raw material for the RE skill this project is going
to build (`.planning/todos/pending/2026-08-01-collect-c64-reverse-engineering-findings-into-a-fast-re-skill.md`).
A trick that is not written down when it is discovered is re-derived from scratch next session,
which is the exact cost the skill exists to remove.

**What must be logged:**

- A shortcut — a read, a tool call, or an ordering that got to an answer faster than the
  obvious route.
- A trick — a non-obvious way to use a register, a tool, or a checkpoint. `$D41B` as the RNG
  rather than audio is the shape of this.
- A hazard — anything that gave a wrong answer, or that changed the running machine by being
  observed. These are worth more than the shortcuts; they are what a register list cannot tell
  you.
- A dead end — an approach that looked right and was not, with the reason. **Negative findings
  count.** Not recording them means the next session pays for the same detour.
- A confirmation — a fact that was uncertain and is now verified live, with how it was
  verified.

**Rules for the log:**

- **Append-only, and never in a todo.** Todos move to `completed/` when their work is done; the
  log has to outlive every one of them. `.planning/RE-FINDINGS.md` is the safe place precisely
  because nothing archives it.
- **Log at discovery, not at session end.** A finding recalled at wrap-up has already lost the
  detail that made it useful.
- **One entry per finding**, dated, stating the finding and what it saves or costs. If it came
  from live execution, say so — provenance is the difference between a fact and a guess, and
  this project grades every claim by confidence.
- **Grade every entry.** `Evidence:` and `Confidence:` are separate required fields.
  `Evidence` says *how* the finding was established; `Confidence` says *how much to trust it*,
  on `.planning/research/STACK.md`'s existing HIGH / MEDIUM / LOW scale — one confidence
  vocabulary across the project. Doc-derived method belongs in the log at MEDIUM; an unrun
  method with addresses attached is a hypothesis the next session can test in minutes, which is
  the point. **Promote by re-logging with the live evidence, never by editing a grade in
  place** — silently upgrading destroys the record of when something stopped being a guess,
  in a file whose whole value is that record.
- **Do not deduplicate against the skill.** The log is raw input; curation happens when the
  skill is written. A finding logged twice is free, a finding suppressed as "probably already
  known" is gone. This is a rule against *suppressing* findings, not a mandate to scatter one
  fact across the file: the same finding arriving from several sources merges into one entry
  that carries every provenance line.
