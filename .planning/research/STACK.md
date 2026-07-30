# Stack Research

**Domain:** Commodore 64 reverse engineering — depacking, disassembly-to-ACME-source, asset extraction, ACME/`.d64` build, VICE-driven behavioural verification
**Researched:** 2026-07-30
**Confidence:** MEDIUM overall (HIGH where directly verified against this container's filesystem; MEDIUM where sourced from official repos/docs via web search; explicitly flagged LOW/gap where evidence was thin — see TCS-CRUNCH note)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| ACME | 0.97 "Zem" (2021-01-31), Debian pkg `1:0.97~svn20211115+ds-2` | The one true assembler for the rebuild | Already installed at `/usr/bin/acme` — **verified directly** (`acme --version`). It's the project's mandated assembler; nothing to decide here. Confidence: HIGH (verified in-container). |
| `toacme` | ships with the `acme` Debian package | Static `.prg`→ACME-source dead-listing disassembler | **Verified present** at `/usr/bin/toacme` (`dpkg -L acme` confirms it's part of the same package). The `acme-build` skill already wraps it (`node acme.mjs disasm file.prg`). Zero setup cost, but produces a **linear, untraced** listing — code and data are not separated, illegal opcodes decode as instructions. Use it as the fast first pass, not the final disassembly. Confidence: HIGH (verified in-container). |
| regenerator2000 | actively maintained, 2026, Rust, `cargo install regenerator2000` | Traced, interactive 6502 disassembler producing **reassemblable ACME source** with code/data separation | The real upgrade over `toacme`. Accepts `.prg`, `.d64`, `.crt`, `.t64`, VICE `.vsf` snapshots directly; auto-traces execution flow (x-refs, jump tables) instead of linear decode; exports directly to **ACME**, plus 64tass/KickAssembler/ca65; imports/exports **VICE label files**, so labels created here round-trip with the `vice_symbols_load`/`vice_symbols_lookup` tools. Has its own MCP server and can attach to a VICE binary monitor — that specific live-VICE feature is *not* usable in this project (our only VICE access is the host's `vice_*` MCP surface, not a raw binary-monitor socket from inside the container), but the static disassembly + ACME export + VICE label import/export works standalone. Confidence: MEDIUM (GitHub README + Hackaday coverage, cross-checked, not hands-on tested here). Install: `apt-get install -y cargo rustc` (Debian trixie ships rustc/cargo 1.85 — verified via `apt-cache policy`), then `cargo install regenerator2000`. |
| Python | 3.13.5 | Host language for depacking-dump post-processing, data extraction, `.d64` writing | **Verified present** (`python3 --version`). `pip`/`venv` are not pre-installed but are apt-installable (`python3-pip` 25.1.1, `python3-venv` 3.13.5-1 — verified via `apt-cache policy`). Confidence: HIGH (verified in-container). |
| `d64` (PyPI) | 1.10 (2023-09-17, Production/Stable) | Read **and write** `.d64`/`.d71`/`.d80`/`.d81`/`.d82` images from Python | This is the resolution to the "no `c1541`" gap. `pip install d64` gives a `DiskImage` context-manager API for directory listing, file extraction, and file writing into a disk image. It is a pure-Python library, so it works unmodified in the container. Confidence: MEDIUM (PyPI page + community references cross-checked; write-path details for building a *bootable* image from scratch were not independently exercised — validate BAM/directory-track behaviour empirically in the build phase). |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Pillow | current (`pip install Pillow`) | Turn raw C64 bitmap/sprite/charset bytes into PNG | Primary tool for priority #3 (data extraction). C64 graphics are just byte planes at known memory offsets (sprite = 63 bytes + pointer, charset = 8 bytes/char, screen = 1000 bytes + colour RAM) — a ~150-line custom script using Pillow's `Image.putpixel`/`frombytes` against a C64 palette table converts any of these to PNG directly from a `vice_memory_read` dump. Preferred over depending on a third-party ripper because the exact conversion (multicolor vs hires, VIC bank selection, `$D018` interpretation) needs to be driven by what the disassembly reveals about *this* game's actual graphics mode, not a generic guess. |
| `snaprip` (fieserWolF, github.com/fieserWolF/snaprip) | v2.00 (2022, Python 3 rewrite) | Reference implementation only, not a hard dependency | Parses VICE `.vsf` snapshots and extracts koala/hires images, sprites, font, PETSCII screens — but emits **proprietary binary formats, not PNG**, and shows only 2 commits (thin maintenance). Read its source as a worked example of "how to locate and slice each graphics structure out of a snapshot," then reimplement the slicing in the project's own Pillow script so output lands directly in PNG/JSON as required. Do not `pip install` it as a load-bearing dependency. |
| JSON (stdlib) | — | Structured export of level layout, animation/move tables, non-graphical data | Table/array data (room layouts, sprite animation-frame indices, collision tables) is better served as JSON than as an image — write a small decoder per table format once the disassembly reveals its layout, dump to `.json` next to the `.png` assets. |
| Python `hashlib` (stdlib) | — | Framebuffer / RAM-region hashing for the verification harness | `sha256` over the **decoded pixel array** (not the raw PNG bytes returned by `vice_display_screenshot`) avoids false mismatches from incidental PNG-encoder differences between runs. Decode via Pillow, hash the raw `.tobytes()`. |
| `pytest` | current | Structuring the replay/regression test suite | Standard, and matches the pattern used by the closest known prior art (`sim6502`, see below) for VICE-MCP-backed automated testing — gives fixtures, parametrization over checkpoints, and CI-friendly output for the verification harness in priority #5. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| VICE, via the host's `vice_*` MCP tool surface | All emulation: running the cracked disk, live-memory depacking, screenshot/RAM/state inspection, scripted input, snapshotting | This is not something to install — it's the given execution environment. Tool-name check: the exact 63-tool surface described in the project constraints (`memory_read/write/search/compare/fill/banks`, `checkpoint_add`+`watch_add`+`run_until`, `execution_step/pause/run`, `registers_get/set`, `sprite_get/sprite_inspect`, `vicii_get_state`/`sid_get_state`/`cia_get_state`, `display_screenshot`, `keyboard_type`/`joystick_set`/`joystick_tap`, `snapshot_save/snapshot_load`, `symbols_load/symbols_lookup`, `disk_attach/disk_detach/disk_read_sector`, `machine_reset`, `cycles_stopwatch`) matches, tool-for-tool, the **barryw/vice-mcp** project (an MCP server embedded in VICE itself, `x64sc -mcpserver`, dot-namespaced tool names like `vice.disk.list` that get flattened to `vice_disk_list` when exposed) far more closely than the alternative `simen/vice-mcp` (a separate Node wrapper around VICE's binary monitor with a much smaller tool set). Treat `vice_disk_list` as permanently off-limits per the project's own hazard note — regardless of root cause, its symptom (crashing the host MCP server) is empirically established and no research changes that. |
| `cc1541` | Fallback `.d64` writer if the `d64` Python library proves insufficient for a bootable image | C source, MIT-licensed, canonical repo at `bitbucket.org/PTV_Claus/cc1541` (GitHub mirror `TrantorHF/cc1541`). Builds with a plain `make` (small C project, no exotic deps) — buildable in this Debian container with just `build-essential`. Not needed as the primary path, but a good insurance policy: it directly replaces the missing `c1541` for "add file(s), fix interleave, write BAM/directory" duties that a from-scratch Python writer would otherwise have to get exactly right. |
| `cargo`/`rustc` | Build regenerator2000 from source or via `cargo install` | `apt-get install cargo rustc` — confirmed candidate version 1.85.0+dfsg3-1 in Debian trixie main via `apt-cache policy` (not installed by default in this container, but available). |

## Installation

```bash
# Already present — verify, don't reinstall
acme --version        # ACME 0.97 "Zem"
toacme                # ships with the acme package

# Disassembly upgrade path
apt-get install -y cargo rustc
cargo install regenerator2000

# Python side: pip/venv are not preinstalled, apt-get them first
apt-get install -y python3-pip python3-venv
python3 -m venv .venv && source .venv/bin/activate
pip install d64 Pillow pytest

# Fallback .d64 writer, only if the d64 library can't produce a bootable image
apt-get install -y build-essential
git clone https://github.com/TrantorHF/cc1541.git   # or the bitbucket canonical
cd cc1541 && make
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Live-memory depacking via `vice_*` MCP tools (attach disk, run loader/cruncher, checkpoint at decrunch-complete, `memory_read`/`snapshot_save` the flat RAM image) | Static depacking with UNP64 or Exomizer's decruncher | Only if a quick static attempt against `danish.d64`'s `TCS-CRUNCH!` payload happens to work. Neither tool has documented support for that specific, obscure signature (search turned up no reference to "TCS-CRUNCH" anywhere), both are Windows binaries needing Wine in this container, and both rely on recognizing the *specific* cruncher's decrunch-to-normal-address pattern — which is exactly what a live VICE run gets "for free" of any crunch scheme, since it just executes the real 6502 code until the game itself is running. The live route is therefore primary, not just for `danish.d64` but for `saeger.d64` too (both use custom raw-sector loaders bypassing KERNAL, so static disk-sector disassembly is a dead end regardless of crunching). |
| `toacme` for a fast first-pass dead listing, regenerator2000 for the real traced disassembly | Infiltrator / original Regenerator (Windows GUI tools referenced in prior-art writeups like `mwenge/gridrunner`) | These are the tools the community historically used for exactly this kind of project, and their output quality is proven — but both are Windows-only GUI applications with no Linux build, so they'd need Wine + a display, which is a poor fit for a headless devcontainer pipeline that should be scriptable. regenerator2000 is a modern, actively developed, cross-platform reimplementation of the same idea (by the same "Regenerator" lineage, confusingly) that keeps the traced/interactive workflow while running natively in this environment. |
| `d64` Python library (pure Python, pip-installable) for `.d64` read/write | `cc1541` (C, build-from-source) | Reach for `cc1541` if the `d64` library's write path can't reproduce the exact BAM/directory/interleave behaviour a stock C64 KERNAL loader expects for a *bootable* disk (the project's disks use non-standard raw loaders and faked directories, so the bar for "boots correctly" is unusually high). `cc1541` is a purpose-built, mature disk-mastering tool and a safe fallback if the from-scratch Python path gets fiddly. |
| Custom Pillow script for graphics extraction, informed by `snaprip`'s slicing logic | `snaprip` directly as a dependency | `snaprip` is worth reading, not installing: 2 commits total, and its output is a proprietary binary layout rather than PNG/JSON as this project requires. A ~150-line purpose-built script gets exactly the output format needed and can be adapted the moment the disassembly reveals this game's specific VIC bank/mode choices. |
| capstone-style disassembly libraries | N/A — not viable | Capstone has no 6502 support (confirmed: its architecture list covers `MOS65XX`-adjacent chips but explicitly not 6502/6510). Not a real option for this project; mentioned only to close off the question. |
| py65 (mnaberez/py65) | N/A — not needed here | py65 is a pure-Python 6502 emulator/monitor, useful for isolated instruction-level experiments, but the project already has a full, cycle-accurate C64 emulator (VICE) reachable via MCP — there's no reason to run a second, less complete 6502 simulation in Python for this project's needs. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `vice_disk_list` | Empirically crashes the host MCP server (per project memory/hazard note); recovery requires a manual VICE restart on the host. No amount of research changes this — do not call it under any circumstance, including "just to check." | Parse `.d64` bytes directly in Python (track/sector layout is public and simple — 35 tracks, BAM at 18/0, directory chain from 18/1) for directory inspection, or use `vice_disk_read_sector` if directory contents from the *emulated* drive's perspective are specifically needed. |
| UNP64 / Exomizer's unpacker as the primary depacking path | Both are effectively pattern-matchers against known crunchers; `TCS-CRUNCH!` isn't a documented signature anywhere searched, and both require Wine in this container — an extra moving part in the critical path for a step that VICE-based live execution solves more robustly. | Live-memory dump under VICE via the `vice_*` MCP surface, as the primary recommendation above. |
| Depending on wall-clock delays (`sleep`) to synchronize scripted joystick/keyboard input with game frames | The single biggest source of flakiness in emulator-driven test automation: real-time delays don't map deterministically onto emulated cycles, especially across different host loads. | Drive synchronization entirely through `vice_checkpoint_add` + `vice_watch_add` + `vice_run_until`, stopping on a known address (e.g. the main loop's input-poll routine, or a specific raster line) rather than a duration. Emulated execution between two checkpoints is deterministic given identical starting state and identical injected input — real time is not part of the loop. |
| Hashing `vice_display_screenshot`'s returned PNG bytes directly | PNG encoders can produce different byte streams for pixel-identical images across format/compression-level choices, producing false "verification failed" results. | Decode the screenshot to a pixel array (Pillow) first, then hash `.tobytes()`. |
| `snaprip` or any other ripper tool as an installed dependency for the pipeline | Thin maintenance (2 commits), no PNG output, not designed to be scripted as a library — it's a standalone CLI. | Read its slicing logic as reference, reimplement the needed slices directly with Pillow, tailored to this game's actual formats. |
| Trying to make `toacme`'s dead-listing output the final annotated disassembly | It performs no code/data separation and decodes data regions (BASIC stub, strings, tables) as bogus instruction streams — exactly as the `acme-build` skill's own documentation warns. Fine as a first-pass sanity check; not sufficient as the deliverable. | regenerator2000's traced disassembly, followed by manual code/data annotation validated against actual execution traces from VICE. |

## Stack Patterns by Variant

**If a static depack attempt is worth a quick try before committing to the live-memory route:**
- Install Wine (`apt-get install -y wine`) and fetch a Windows `unp64.exe` build, run it once against `danish.d64`'s extracted PRG payload as a five-minute experiment.
- Because it's cheap insurance — if it happens to recognize the cruncher, it saves the live-dump/checkpoint work — but do not block on it; treat a failure or unrecognized-signature result as expected, not as a problem to solve.

**If the `.d64` write path needs to reproduce this project's specific non-standard boot layout (BASIC stub `SYS 2073`/`SYS 2161`, faked directory entries, raw-sector loader):**
- Don't fight the `d64` library into mimicking the original's *faked* directory scheme — the rebuild's `.d64` doesn't need to replicate the crack's obfuscation, only to boot correctly via a standard (or the project's own clean) loader with a real, valid directory.
- Write a straightforward BASIC stub (`!byte`/`!word` tokenized `10 SYS <addr>` line, matching the pattern the existing `acme-build` scaffold already generates) plus the program's own load address, then let `d64` (or `cc1541`) place it as a normal PRG entry with a real BAM. Simpler and more maintainable than faithfully reproducing the crack loader's tricks, which the project's own scope explicitly treats as an obstacle, not the deliverable.

**If regenerator2000's auto-trace mis-identifies a data region as code (or vice versa) — a known hard problem for any auto-tracer, especially around self-modifying code, sprite-multiplexer IRQ tables, and inline data referenced only via computed offsets:**
- Cross-check against live execution: single-step/`checkpoint` through the region under the real `vice_*` MCP tools and confirm what the PC actually visits. If a byte range is never hit as an instruction stream during full gameplay coverage (title, all rooms, combat, death, both AI opponents, game over), treat it as data regardless of what the static tracer guessed.
- This is exactly the kind of judgment call the project's provenance-diffing step (comparing `danish.d64` vs `saeger.d64` after both are depacked) is well-suited to sanity-check too: a region that differs between the two cracked releases but is claimed as "code" by the auto-tracer is a red flag worth a second look.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| ACME 0.97 | `toacme` (same package) | Guaranteed matched version since both ship in the same Debian package — no separate compatibility risk. |
| ACME `--vicelabels` output (`.vs` file) | `vice_symbols_load` (format `vice`) | The `acme-build` skill already produces this via `node acme.mjs build game.a`, which passes `--vicelabels ${stem}.vs` to `acme`. This is the existing, working solution to the "symbol/label interop with VICE" question in research priority #2 — no extra tooling needed, just load the resulting `.vs` with `vice_symbols_load` (format `vice`) after each build. |
| regenerator2000's exported VICE label files | `vice_symbols_load` | regenerator2000 documents label import/export "from VICE label files," format compatible with what `symbols_load`/monitor `l` commands expect — the same channel as the ACME `.vs` output above, so labels can flow disassembler → source → build → debugger and back without translation. Confidence: MEDIUM (not hands-on verified in this project yet; verify the exact byte-for-byte format the first time it's used). |
| `d64` (PyPI) 1.10 | Python 3.13.5 (installed) | PyPI classifiers list Python 3 broadly; no version ceiling found in the search. Confirm at install time with `pip install d64` inside a venv rather than assuming; it's a small, stable, single-purpose library so risk is low. |
| Debian trixie `cargo`/`rustc` 1.85.0+dfsg3-1 | `cargo install regenerator2000` | Current stable Rust toolchains build current crates.io crates without issue; no known incompatibility, but this pairing hasn't been executed in this specific container yet — treat the first `cargo install` as the verification step. |

## Sources

- `/usr/bin/acme --version`, `dpkg -l | grep acme`, `dpkg -L acme`, `which toacme` — direct verification in this container. Confidence: HIGH.
- `apt-cache policy cargo rustc python3-pip python3-venv exomizer` — direct verification in this container (rust toolchain and python packaging tools are apt-installable but not preinstalled; no `exomizer` apt package exists). Confidence: HIGH.
- [github.com/ricardoquesada/regenerator2000](https://github.com/ricardoquesada/regenerator2000) — install method, supported formats, ACME export, VICE label import/export, MCP server. Confidence: MEDIUM.
- [restore64.dev](https://restore64.dev/) — browser-only tool, 370+ packer signatures including a "Time Cruncher," ACME/KickAssembler/64tass export, byte-exact verifier; **no CLI/source available**, so noted as informative prior art rather than a pipeline component. Confidence: MEDIUM.
- [github.com/barryw/vice-mcp](https://github.com/barryw/vice-mcp) — tool naming (`vice.category.action` → matches this project's `vice_*` surface far better than the alternative `simen/vice-mcp`), full 63-tool inventory, screenshot format (PNG/BMP, base64 option), checkpoint/run_until semantics, keyboard `hold_frames`/`hold_ms` timing, and the `sim6502` companion test framework. Confidence: MEDIUM.
- [github.com/barryw/sim6502](https://github.com/barryw/sim6502) — closest known prior-art pattern for VICE-MCP-backed automated 6502 test/verification. Confidence: MEDIUM.
- [pypi.org/project/d64](https://pypi.org/project/d64/) — version, install command, `DiskImage` API shape. Confidence: MEDIUM.
- [bitbucket.org/PTV_Claus/cc1541](https://bitbucket.org/PTV_Claus/cc1541/src/master/) via GitHub mirror `TrantorHF/cc1541` — MIT license, plain C build, usage syntax. Confidence: MEDIUM.
- [www.cc65.org/doc/da65.html](https://www.cc65.org/doc/da65.html) — `da65`'s info-file/label mechanism, considered and rejected in favor of the toacme+regenerator2000 pairing since `da65` itself is absent from the container and cc65 targets `ca65` output, not ACME, requiring an extra translation step that regenerator2000 skips. Confidence: MEDIUM.
- [github.com/mwenge/gridrunner — Disassembling.md](https://github.com/mwenge/gridrunner/blob/master/Disassembling.md) and [github.com/mwenge/iridisalpha](https://github.com/mwenge/iridisalpha) — closest available prior art for structuring this exact kind of project (byte-exact reassembly validation via MD5, Regenerator+Infiltrator+64tass workflow, code/data separation heuristics). See PITFALLS.md/FEATURES.md/ARCHITECTURE.md for fuller treatment. Confidence: MEDIUM.
- [github.com/fieserWolF/snaprip](https://github.com/fieserWolF/snaprip) — VICE `.vsf` snapshot asset-ripping reference implementation. Confidence: MEDIUM.
- [github.com/capstone-engine/capstone](https://github.com/capstone-engine/capstone) — confirms no 6502 support, closing off that option. Confidence: MEDIUM.
- Web search, no usable result: `"TCS-CRUNCH"` cruncher signature — genuinely not documented anywhere found. This is a real gap, not a resolved MEDIUM/HIGH claim; see PITFALLS.md and the Alternatives table above for how the stack routes around it (live-memory depacking doesn't need to identify the cruncher at all).

---
*Stack research for: C64 reverse engineering / ACME reconstruction pipeline*
*Researched: 2026-07-30*
