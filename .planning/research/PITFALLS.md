# Pitfalls Research

**Domain:** C64/6502 reverse engineering and ACME reconstruction (subject: *Bruce Lee*, Datasoft 1984, recovered only from two cracked disk images)
**Researched:** 2026-07-30
**Confidence:** MEDIUM overall — ACME-specific claims verified directly against the installed ACME 0.97 documentation in this devcontainer (HIGH); C64 hardware facts are well-established community knowledge (MEDIUM-HIGH); specific-game and specific-crack claims come from web search and should be treated as illustrative, not as facts about *this* binary, until confirmed against the actual disk images (LOW-MEDIUM, flagged inline)

## Top 3 Risks Most Likely to Sink This Project

1. **Pitfall 5 — Depack-timing dump produces an incomplete or contaminated memory image.** Everything downstream (disassembly, provenance diffing, documentation, rebuild) is built on top of the recovered image. If the dump is taken at the wrong moment, or misses banked/IO-shadowed RAM, every later phase inherits corrupted ground truth silently — errors surface late, as "unexplainable" behavioural mismatches during verification, when they are cheapest to fix at the source.
2. **Pitfall 1 — Code/data misclassification, specifically RTS-dispatch and computed-jump tables left undiscovered.** This is the classic 8-bit RE killer, and *Bruce Lee*'s combat/animation engine (multiple enemy AI states, move tables, sprite frame sequencing) is exactly the kind of code that uses jump tables and RTS-trick dispatch. A missed dispatch table doesn't just leave a gap in the disassembly — it leaves a "data table" that's actually code, silently un-reconstructed, and the rebuild will diverge in exactly the state-dependent way the verification harness is supposed to catch, but only late and only in checkpoints that happen to exercise that path.
3. **Pitfall 6 — ACME reconstruction silently changes instruction lengths (zero-page vs absolute) or table byte layout, cascading address shifts through hardcoded literals.** This is the pitfall most likely to produce a rebuild that *assembles cleanly*, *looks correct on inspection*, and *fails verification* for reasons that take a long time to root-cause, because the actual bug is several hundred bytes upstream of the observed symptom.

These three interact: a bad dump (5) makes code/data analysis (1) less reliable, and any restructuring done to "clean up" the disassembly (6) is exactly where address-dependent original quirks get lost. Treat phases 3 (code/data mapping) and 6 (ACME reconstruction) as the two places to slow down and add extra verification, and treat phase 1 (recovery/depacking) as the one place a mistake is most expensive to discover late.

---

## Critical Pitfalls

### Pitfall 1: Code/data misclassification via missed computed-jump and RTS-dispatch targets

**What goes wrong:**
A disassembler (static or manual) walks code linearly from an entry point, following unconditional/conditional branches and `JSR`/`RTS` pairs. It cannot see targets reached only through `JMP (ptr,x)`-style indirection tables (not available on NMOS 6502/6510 — but hand-written equivalents are common: `JSR` to a dispatcher that indexes a table of addresses and does `JMP (addr)` via a self-built vector, or the "RTS trick" where a routine pushes `target-1` onto the stack via `LDA #>(target-1) / PHA / LDA #<(target-1) / PHA / RTS`, using RTS's `+1` behavior to reach the real address). Bytes reachable only that way are invisible to a linear/recursive-descent walker and get disassembled as if they were data, or — worse — the *table* is disassembled as instructions producing plausible-looking nonsense that a tired reviewer accepts. Inline data placed immediately after a `JSR` (return address doubling as a data pointer, common in menu/print routines) causes the opposite error: the disassembler treats data bytes as the next instructions and desyncs the entire byte stream after that point until the next branch target happens to resynchronize it.

**Why it happens:**
6502 has no reliable way to determine, in general, whether the operand of an indirect construct is a jump table or a pointer table without watching it execute. Static disassemblers default to conservative linear/recursive-descent tracing, which is precise but not complete — completeness requires knowing every entry path, and "every" is unknowable from bytes alone. Reviewers under time pressure also tend to accept a disassembly that "looks plausible" (valid opcodes, sensible operand ranges) without checking that the byte stream reconvenes with independently-confirmed code elsewhere.

**Warning signs (mechanical):**
- A "data table" region has no incoming reads that constitute its only use — i.e., nothing indexes into it (dead label) — despite being adjacent to dispatch-shaped code (a routine that loads a byte, uses it as an index, and either does an indirect jump or pushes a computed address then `RTS`s).
- Live-trace coverage (below) shows the CPU's PC visiting bytes inside a region marked "data" in the current annotated disassembly — this is the definitive, mechanical tell.
- A disassembled routine ends in `RTS` where the two preceding instructions are `PHA`/`PHA` (or push-then-push-order variants) with no matching `JSR` immediately before — recognize this pattern explicitly as the RTS trick and resolve the vector by hand rather than trusting the linear disassembly past that point.
- Byte-for-byte comparison between two independently-produced disassemblies (or between disassembly output and a live trace log) disagrees starting at a specific byte and never resynchronizes — a hallmark of an inline-data-after-JSR desync.

**Prevention:**
- Do not rely on static/recursive-descent disassembly alone as "coverage." Use VICE's execution trace/checkpoint/watch facilities (via the MCP tools available in this project) to actually run the game — through all its states: title, all 20 rooms/screens, every enemy type, every combat move, death, game over, high score entry — and log every address the PC visits. Union of static reachability and live-trace reachability is the actual coverage metric; static analysis alone is not sufficient and should be explicitly flagged as such wherever it's the only source for a region.
- Track coverage as a bitmap over the full recovered image (executed / data / unknown) and treat "unknown" as a standing todo list, not silence-implies-done. Report the percentage covered at each phase checkpoint; a region that never lights up under exhaustive play is a strong candidate for dead/unused code (crack-added trainer stub, debug leftover) worth flagging rather than ignoring.
- When a jump table or RTS-dispatch pattern is suspected, verify by single-stepping through it once under the debugger and recording the actual resolved target, rather than inferring the target from the table's apparent structure.
- Treat every label as carrying a confidence tag (see Pitfall 8) — "verified by trace" vs "inferred by static reading" — so downstream readers know which labels to re-check if something doesn't add up later.

**Phase to address:** Code/data mapping phase (primary); recovery/depacking phase (coverage instrumentation should be set up before mapping begins, so trace logs accumulate through all later exploratory play).

---

### Pitfall 2: Self-modifying code breaks static disassembly and, if not represented deliberately, breaks the ACME rebuild too

**What goes wrong:**
8-bit games routinely patch their own code at runtime: writing a computed operand into an instruction already in memory (self-relocating jump targets, unrolled-loop generation, runtime difficulty/level patches, direction-dependent sprite routines that flip a `CMP #` operand), or building an entire small routine on the fly in a scratch buffer. A static disassembly of the as-loaded image shows the *pre-patch* bytes — which may be entirely different instructions than what actually executes at that address during play, or may show plausible-but-wrong operand values that were never actually used. If this is not recognized and is instead disassembled as fixed code, the resulting "documentation" is wrong for a subset of behavior that never manifests unless you play the specific case that triggers the patch. In the rebuild, the naive approach — hardcoding the pre-patch bytes as static ACME source — silently reproduces a *different program* than the running original for any play sequence that depends on the patched state.

**Why it happens:**
6502 has no separate code/data memory (no Harvard architecture, no write-protection typically enabled on the C64 for RAM); "the code is just bytes in RAM" is exactly what self-modifying code exploits, and it is a completely idiomatic, non-exotic 8-bit technique for saving memory or avoiding runtime branch overhead in a tight loop. There is nothing about the byte stream itself that flags "this byte gets overwritten later" — it can only be discovered by watching writes to code-space addresses during execution.

**Warning signs (mechanical):**
- A memory write instruction (`STA`/`STX`/`STY`/`INC`/`DEC`/illegal RMW opcodes) targets an address that falls within a region already classified as "code" — this is detectable by a scripted pass over the annotated disassembly cross-referenced against write-target operands, and should be raised as a flag automatically, not discovered by accident.
- Live execution under VICE with a memory watchpoint set on a code region triggers unexpectedly during normal play — confirms self-modification and pinpoints exactly which byte(s) and from where.
- A disassembled routine appears to have a "dead" operand that's never meaningfully read as data and isn't itself reachable as code from any traced path, but sits directly after an opcode that would use it as an argument if patched — suggests the "operand" is really a patch target, not a real fixed argument.
- Disassembling the same address at two different points in a captured session (e.g., a snapshot taken pre- and post- a specific game event) yields different byte values — direct proof of self-modification at that address.

**Prevention:**
- Instrument code regions with VICE watchpoints on writes as a standing practice during the code/data mapping phase, not just when something looks suspicious — self-modifying code is easy to miss precisely because it doesn't look suspicious until you catch it in the act.
- Document each self-modifying site explicitly: what gets patched, by what code, under what condition, and what the possible patched values are (enumerate them if the domain is small, e.g. a direction flag with 2 states).
- In the ACME rebuild, represent self-modification *as self-modification* — write the patching code as-is (it's part of correct behavior) rather than trying to "improve" it into static branches unless equivalence is proven behaviorally. If restructuring for readability is done, add an explicit regression checkpoint in the verification harness that exercises every patched state, not just the default one.
- Never assume the as-loaded byte stream is "the" program; always ask "does anything write here during play?" before treating a code region as final.

**Phase to address:** Code/data mapping phase (detection); subsystem documentation and ACME reconstruction phases (representation — must be preserved, not "fixed").

---

### Pitfall 3: Undocumented/illegal 6502 opcodes silently misassembled, misread, or dropped

**What goes wrong:**
Commercial C64 code — including well-known titles — deliberately used undocumented NMOS 6502/6510 opcodes (verified: ACME 0.97's own `Illegals.txt`, read directly from the assembler installed in this devcontainer, documents `slo/rla/sre/rra/sax/lax/dcp/isc/las/tas/sha/shx/shy/anc/alr/arr/sbx/dop/top/nop/jam`, plus two explicitly unstable ones, `ane`/`xaa` and `lxa`/`atx`). If a disassembler doesn't recognize an illegal opcode byte, it either errors out, mis-decodes it as an unrelated legal instruction (some illegal opcode bytes alias into ranges a naive table-driven disassembler may not have populated, producing garbage operand length and desyncing everything after it — same failure shape as Pitfall 1's inline-data desync), or silently treats it as a `NOP`/`JAM` when it is actually a functional combined instruction. Separately: two of these opcodes (`ane`/`xaa` and `lxa`/`atx`) are electrically unstable — their result depends on an undocumented "magic constant" that varies by chip and even temperature. A game that (deliberately or accidentally) relies on one of these with a non-zero argument may behave differently between real hardware, VICE, and any hand-reimplemented instruction in the rebuild if the assumed constant differs.

**Why it happens:**
Illegal opcodes exist because the 6502's decode logic isn't a full 256-entry lookup table — many "undefined" opcodes decode as an ALU operation composed with a read-modify-write cycle by accident of the silicon. They are not officially documented by MOS, so tooling support is inconsistent across the ecosystem, and it's easy to build or use a disassembler that only knows the ~151 documented opcodes.

**Prevention:**
- Confirm the disassembly toolchain (whatever tool ends up producing the working disassembly — static tool, VICE's own disassembler via MCP, or hand-decoding) explicitly supports the full illegal-opcode set, not just documented opcodes, *before* trusting any of its output. VICE emulates undocumented opcodes with correct behavior (this is the emulator this project depends on, so execution will be correct even if a downstream disassembly view is wrong — but the **disassembly text itself** can still be wrong even while the game runs correctly, which is the trap: it *looks* verified because the game plays right, while the documentation/rebuild source is subtly wrong).
- Round-trip check: for any block containing a suspected illegal opcode, reassemble the annotated ACME source for that block and diff the resulting bytes against the original recovered image byte-for-byte. A silent misread shows up immediately as a byte mismatch at that offset — this is a cheap, mechanical, non-optional check and should be run for every reconstructed block, not just ones "suspected" of containing illegals (suspicion is exactly what's unreliable here).
- ACME requires `!cpu nmos6502` (or a DTV variant) to accept illegal-opcode mnemonics at all; if the source is built with the default CPU mode, illegal-opcode mnemonics will be rejected outright at assemble time — a hard, immediate, mechanical signal, which is good, but only if the illegal opcode was correctly *identified* as such in the first place rather than silently misdecoded upstream (this is the actual risk — assembly-time rejection catches "I wrote `lax` without `!cpu nmos6502`," not "the disassembler decoded byte `$A7` as something else entirely").
- If a suspected unstable opcode (`ane`/`lxa` with non-zero argument) is found, treat it as a documentation flag, not just a translation task — note explicitly that behavior may not be portable/guaranteed, and verify the specific checkpoint(s) that exercise it pass under the actual VICE version being used for verification (since correctness here is defined by matching *this* emulator's behavior, not an abstract 6502 spec).

**Phase to address:** Code/data mapping and subsystem documentation phases (detection and flagging); ACME reconstruction phase (round-trip byte verification, mandatory for every block, cheapest possible check to add and highest value for the effort).

*Confidence: HIGH for ACME's own opcode/CPU-mode behavior (verified directly against the installed assembler's documentation). MEDIUM for "commercial games commonly use these" as a general claim (well-attested pattern in the C64 scene) — LOW/unconfirmed for whether *this specific binary* uses any of them; that must be established empirically during this project, not assumed from other games.*

---

### Pitfall 4: Cracked-release contamination misattributed to the original author, and the two-crack diff technique used naively

**What goes wrong:**
Neither available disk image is an original Datasoft master; both are cracked releases (`danish.d64`: TCS-crunched, custom raw-sector loader; `saeger.d64`: SSG/XIDEX loader, uncrunched but still with a faked directory and non-KERNAL loader). Cracker modifications commonly include: protection checks NOPped out or branch-inverted, the entire loader replaced with a generic fastloader, trainers/cheats spliced in, an intro/cracktro prepended (usually a separate, obviously-different block, but sometimes it hooks the game's own reset/init vector), and — less commonly but documented in the wild — cosmetic "fixes" (raster bugs patched) or even small gameplay tweaks. Left unchecked, any of these can be documented as if they were Datasoft's original design, permanently misattributing craft decisions to the wrong author and — worse for this project's stated preservation goal — baking a cracker's patch into the "authoritative" rebuild as if it were the game.

The project's planned mitigation — diff the two independent cracks and treat agreement as evidence of originality — is sound in general but has specific failure modes:
- **Common ancestor problem:** if both `danish.d64` and `saeger.d64` derive from the same earlier crack (or from each other) rather than being independently cracked from a clean master, agreement between them proves nothing about originality — it only proves the shared modification was present in whatever they both derive from. Scene release notes, NFO-equivalent text, and cracktro credits (if any survive) are the only real evidence of independent lineage; without that, "two cracks agree" is a weaker claim than it sounds.
- **Relocation false-positives:** if the two loaders place the depacked game code at different base addresses, or the crunched copy (`danish.d64`) decompresses to a different memory layout than the uncrunched copy (`saeger.d64`), a naive byte-for-byte diff over raw memory will show differences at every address from the first relocation onward, even though the *logic* is identical — the diff becomes useless noise unless the comparison is done after normalizing for relocation (e.g., diffing disassembly text with symbolic/relative addressing, or diffing after applying a known base-address offset, not diffing raw bytes at matching absolute addresses).
- **Packer artifacts obscure alignment:** `danish.d64`'s TCS-CRUNCH! layer means its "raw" pre-decrunch bytes are not comparable to `saeger.d64`'s bytes at all — the diff is only meaningful *after* both are brought to the same fully-decompressed, fully-loaded, execution-ready memory state. Diffing before that point (e.g., diffing the two `.d64` files' raw sectors) will show near-100% difference and prove nothing.
- **Loader/protection-check regions will always differ and are expected to** — this is not a bug in the technique, but a naive read of "these regions differ, therefore suspicious" without first classifying "this is loader code, expected to differ" vs "this is game logic, unexpectedly differing" will waste time investigating the wrong things.

**Prevention:**
- Do not diff raw disk sectors or as-loaded-but-not-yet-decrunched memory. Normalize both images to the same representation first: fully depacked, fully loaded into RAM, at a moment where both are demonstrably at "game about to start" (same execution phase) before any byte comparison is attempted.
- If the two images load to different base addresses, diff must be relocation-aware — compare disassembled/symbolic instruction streams (opcode + relative operand meaning) rather than raw bytes at matching absolute addresses, or apply a known relocation offset before a raw diff. A raw diff across differently-based images is worse than useless — it actively misleads by showing false differences everywhere.
- Partition the diff output into three buckets explicitly, don't just eyeball it: (a) loader/protection-check code — expected to differ, not evidence of anything about the original game, (b) intro/cracktro-only regions — clearly bounded, exclude entirely, (c) actual game-logic regions — where agreement is meaningful evidence and disagreement is the interesting signal to chase.
- Treat "both cracks agree" as raising confidence, not as proof — record it as a confidence tier (e.g. "byte confirmed in both independent releases" vs "byte present in only one release, unconfirmed"), per the project's own stated provenance-per-byte standard. Do not silently upgrade "agrees in both" to "definitely original" without also checking for the common-ancestor risk (look for evidence the two crack groups worked independently — different loader styles/authors is itself weak positive evidence of independence, since a single group's re-release would likely reuse its own loader).
- Where the two images disagree in a game-logic region, don't default to "cracker changed it" — check for a duller explanation first: a version/revision difference in the original Datasoft release itself (multiple print runs / regional releases of Bruce Lee are known to exist for other platforms; the same may be true here), bit rot/read errors in one of the two `.d64` images, or a data table that's expected to vary in ways that don't matter (see Pitfall 7 on scratch regions).

**Phase to address:** Provenance-diffing phase (primary); recovery/depacking phase (must fully normalize both images before diffing is attempted — this is a hard sequencing dependency, not optional ordering).

*Confidence: MEDIUM. General crack-scene patterns (loader replacement, intro splicing, common-ancestor risk, relocation-induced diff noise) are well-attested principles of binary diffing and scene culture. The California Games case study (menu-count/sponsor-logo attribution, cracktro-documented "rasterbug" fixes) is a single external example (LOW confidence as applied to this project) illustrating that cracker-authored cosmetic changes do happen and are sometimes self-documented in the intro — worth checking `danish.d64`/`saeger.d64` intros for any such notes before assuming there are none.*

---

### Pitfall 5: Depacking-hazard memory dump is incomplete, premature, or misses non-RAM state

**What goes wrong:**
The plan is to run the cracked loaders under VICE, let them defeat their own protection/decrunch themselves, and dump RAM once the game is "running" — a live-memory-first strategy the project has already correctly chosen over static disk analysis (crunched data is undisassemblable before decompression). But "dump memory" has several concrete ways to be wrong:
- **Too early:** dumping before the loader has finished all its stages (`danish.d64` is a multi-stage TCS-crunched loader; decompression may itself happen in bursts, or the loader may bring in the game in multiple chained loads from different disk regions) captures a mid-transition state — some of the image will be leftover loader/decompressor bytes, not game code, in regions the game will later occupy.
- **Too late:** if the dump happens after gameplay has already begun modifying working RAM (see Pitfall 2), the captured image reflects a specific play-state's self-modifications rather than the "clean," reproducible initial state that should be the baseline for disassembly and for provenance diffing against the other crack.
- **On-demand loading missed:** if the game streams in additional data during play (level layouts, per-room graphics, music data) rather than loading everything up front, a single post-boot dump will be missing entire regions that only appear once the player reaches specific rooms/levels — an incomplete dump that looks complete because nothing appears obviously "wrong" about it structurally.
- **Banked/hidden RAM under ROM missed:** the C64's PLA can map RAM underneath BASIC/KERNAL ROM and underneath the $D000-$DFFF I/O block (controlled by the `$01` port's LORAM/HIRAM/CHAREN bits) — if any part of the game's working data or code lives in RAM that's currently shadowed by ROM/IO at dump time, a naive "read visible memory" dump silently gets ROM/IO bytes instead of the actual RAM contents underneath, and this failure is invisible unless the memory-configuration bits are checked and the RAM specifically banked in before dumping (or dumped via VICE's "true RAM" read facility rather than the CPU's-eye view, if the MCP tooling distinguishes the two).
- **IO area at $D000-$DFFF is not "empty" state** — VIC-II, SID, and CIA registers are live hardware state, not just RAM; a memory dump of that range captures register mirror values, not necessarily anything meaningful about game logic, and separately the game's *actual* runtime state that matters for verification (raster line, sprite positions, CIA timer counts, SID voice state) lives in these chips' internal registers/latches, not in the RAM dump at all.

**Warning signs:**
- Disassembly of the dumped image contains regions that don't make sense as either code or recognizable data tables anywhere near the expected loader entry/exit points — often the signature of a dump taken mid-load.
- The two crack images, once normalized (Pitfall 4), disagree in regions that "shouldn't" differ between the same game on the same target machine — could be provenance-worthy, or could just as easily be leftover-loader contamination from an inconsistent dump timing between the two capture sessions.
- Playing into a later room/level reveals code or graphics not present anywhere in the original dump — direct proof of on-demand loading that a single early dump missed.
- Checking the `$01` processor port value at dump time and finding LORAM/HIRAM/CHAREN configured to show ROM/IO instead of RAM in a region the disassembly later needs — retroactive proof the dump has ROM bytes standing in for the real RAM contents there.

**Prevention:**
- Establish an explicit, reproducible "known-good dump point" per subject (once per crack): a specific, scripted moment (e.g., "immediately after the title screen's main loop is first reached, before any player input") verified by checking a small set of "loader is done" signals (loader's own code region has stopped executing / PC is inside the confirmed game entry routine) rather than an arbitrary timeout or a human eyeballing the screen.
- Before dumping, explicitly set the `$01` port bits to bank RAM in everywhere it can be (or, if the MCP/VICE tooling supports it, use a memory-read mode that reads underlying RAM regardless of current bank configuration) and record what configuration was used, so it's reproducible and auditable later.
- Treat "does this game load anything on demand" as a question to actively answer, not assume away: play through every room/level while watching for fresh disk activity (drive LED / disk-access register activity) or newly-populated memory regions after the initial dump, and take supplementary dumps at each such point if found.
- For chip state that matters (VIC bank select, sprite pointers/positions, SID voice/ADSR state, CIA timer latches), capture register-level state explicitly alongside the RAM dump — don't rely on the RAM image alone to reconstruct what the hardware was doing, since some of that state genuinely isn't in RAM at all.
- Cross-check dump completeness against the eventual disassembly: every reachable code path (per Pitfall 1's coverage tracking) should resolve to real instructions in the dumped image with no unexplained gaps; gaps are the mechanical signal that the dump missed something.

**Phase to address:** Recovery/depacking phase (this is the phase's core job — get this wrong and every later phase is working from bad ground truth).

---

### Pitfall 6: ACME reconstruction silently diverges from original behavior through address-dependent side effects

**What goes wrong:**
Restructuring recovered bytes into readable ACME source — adding labels, splitting into multiple files, reordering routines for clarity — can change the assembled output in ways that are invisible on casual read-through but change actual behavior or layout:
- **Addressing-mode drift.** ACME's own documentation (verified locally, `AddrModes.txt`/`Errors.txt` in the installed 0.97 release) states its default behavior precisely: when a symbol isn't yet resolved at the point of use (a forward reference), ACME *assumes 16-bit (absolute) addressing* and only *warns* ("using oversized addressing mode") if it later turns out an 8-bit (zero-page) encoding would have sufficed — it does not error, and it does not silently shrink to zero-page. This means: restructured source that references a label before its definition will, by default, get 3-byte absolute encoding even where the original hand-assembled binary used 2-byte zero-page encoding for the same target — a length mismatch that shifts every subsequent address in that segment. The failure is not silent from ACME's point of view (it emits a warning) but *is* silent from the point of view of anyone not treating ACME's warnings as build-blocking.
- **Label arithmetic that happened to work only at the original address.** Original code sometimes exploits address-specific bit patterns (e.g., a table deliberately placed so its low byte is a convenient constant, or a self-modifying routine that computes an offset assuming a specific base address) — moving or relabeling such a table without preserving its alignment breaks logic that has no visible dependency in the disassembly text, only in the numeric coincidence.
- **Branch-out-of-range after restructuring.** Adding comments/labels doesn't change code size, but *reordering* routines into a more logical file layout can push a conditional branch's target beyond the ±127-byte range. ACME's documented error text for this is explicit ("Target out of range (N; M too far)" / "Target not in bank") — a hard assemble-time error, which is good, but only if the rebuild is actually re-assembled and checked after every restructuring change rather than only at the end.
- **Alignment-sensitive data placed wrong.** C64-specific hard alignment requirements: sprite pointers are single bytes selecting a 64-byte-aligned block within the current 16KB VIC bank (data must start on a 64-byte boundary, i.e., address `& $3F == 0`, or the pointer can't address it at all); screen memory and character sets must live on 1KB/2KB-aligned boundaries selectable via `$D018` within the current VIC bank; the VIC bank itself is a 16KB-aligned window selected via CIA2's `$DD00` bits. If reconstructed source relocates sprite frame data, charset, or screen buffers without preserving these alignments — easy to do by accident when letting the assembler auto-place data via sequential `*=`-free flow — the result assembles without error but is wrong at runtime (wrong graphics shown, or garbage), and the discrepancy will show up as a framebuffer-hash mismatch in verification with no assemble-time hint pointing at the cause.
- **Segment overlap during restructuring.** ACME's default behavior on a `*=` that lands inside or re-enters an already-used address range is a *warning*, not an error ("Segment reached/starts inside another one, overwriting it") — meaning two source sections can silently overwrite each other's output in the final image unless `--strict-segments` is used to make this a hard build failure.

**Prevention:**
- Build with `-Wtype-mismatch` is optional, but treat every ACME warning as build-blocking practice for this project specifically — do not allow "warning: using oversized addressing mode" or unresolved-overlap warnings to pass silently; wire the build script to fail on any warning output, not just errors, or at minimum grep the build log and gate on it. This is a one-line CI-style check with very high leverage.
- Pass `--strict-segments` on every rebuild so segment overlaps are hard errors, since the default "recommended" future behavior (per ACME's own docs) is already to make this stricter — get ahead of it rather than relying on default warning-only behavior.
- For every reconstructed block, run the round-trip check already described in Pitfall 3 (reassemble, diff resulting bytes against the original recovered image at that address range) as the actual gate for "this block is a correct transcription," not just "it assembles" or "it looks right." This single practice, applied uniformly, would catch addressing-mode drift, alignment mistakes that don't move the *label* but do move padding, and most transcription typos, immediately and mechanically, rather than waiting for behavioral verification to fail three phases later.
- For anything alignment-sensitive (sprite data, charsets, screen buffers, jump/vector tables read via computed index), assert the alignment explicitly in source (ACME's `!align` pseudo-op, or an assertion comparing `*` against a bitmask) rather than relying on manual placement staying correct through future edits — make misalignment an assemble-time error, not a runtime mystery.
- Where original code relied on a numeric coincidence (a label's low byte being used arithmetically, a self-modifying patch computing an offset from a hardcoded base), document the dependency explicitly as a comment at the point of definition ("this table's base address's low byte is assumed elsewhere to be $00 — do not relocate without checking X") so a future edit doesn't break it invisibly.
- Never fully trust "it assembles cleanly" as evidence of correctness for a restructured (non-verbatim) region — cleanly assembling and byte-identical-to-original are different claims, and only the latter (checked per-block, per Pitfall 3/6's round-trip practice) actually verifies the transcription.

**Phase to address:** ACME reconstruction phase (primary); should be gated by an automated per-block round-trip diff check established as early as this phase begins, not added retroactively.

*Confidence: HIGH for all ACME-specific behavior claims — verified directly against the ACME 0.97 documentation files (`AddrModes.txt`, `Errors.txt`, `Illegals.txt`) shipped with the assembler actually installed in this project's devcontainer at `/usr/bin/acme`. MEDIUM-HIGH for C64 hardware alignment facts (sprite pointer 64-byte blocks, VIC bank 16KB windows, $D018 charset/screen granularity) — these are extremely well-documented, stable C64 hardware facts.*

---

### Pitfall 7: Verification harness (framebuffer hash + RAM checkpoint diff) is polluted by legitimate nondeterminism and irrelevant RAM

**What goes wrong:**
The project's gate is deterministic replay: scripted joystick input, compared via framebuffer hash and game-state RAM at checkpoints. Several C64-specific sources of legitimate variation can make this comparison unreliable if not accounted for:
- **Power-on/uninitialized RAM pattern.** A real C64 (and VICE's default RAM initialization) does not start all-zero — it initializes memory in a fixed pattern of short runs of `$00`/`$FF` bytes, not true garbage, but also not the same value everywhere. If the original recovered image and the ACME rebuild are started from different initial-RAM states (e.g., one captured mid-session, one freshly booted), any region the game never explicitly initializes before use (a common 8-bit shortcut — "this scratch buffer doesn't need clearing, the code always writes it before reading") will show as a diff that's really just an artifact of two different starting conditions, not a behavioral bug.
- **Raster/timing-dependent code and CIA timers.** Game logic that reads the raster line, CIA timer latches, or free-running counters as part of its "randomness" or pacing (extremely common for enemy AI variation, spawn timing) will diverge between two runs — even two runs of the *same* binary — if input timing isn't bit-for-bit identical down to the frame, or if the emulator's warp/fast-forward mode changes frame pacing relative to real timing-sensitive polling loops.
- **SID and VIC internal state not reflected in RAM.** Sound-channel ADSR envelope state, oscillator phase, and certain VIC-II internal latches (sprite-sprite/sprite-background collision registers, raster compare state) are not addresses in the 64KB RAM map in a way a naive "dump $0000-$FFFF and hash it" approach captures consistently — if the checkpoint's "game-state RAM" is defined as a flat RAM range dump, it will miss real state divergence in these chips, or spuriously flag "differences" that are read-and-cleared side effects of the read itself (some VIC/SID/CIA registers clear-on-read).
- **Screenshot/framebuffer timing landing mid-frame.** If the framebuffer is captured at a moment that doesn't correspond to a stable, fully-drawn frame (mid-raster, during a sprite-multiplexing IRQ that hasn't finished repositioning all sprites for the current frame yet), the hash will differ between otherwise-identical runs purely due to capture-instant timing, not any real logic difference.
- **Scratch buffers and legitimately-unused space polluting the diff.** Not all RAM that differs between original and rebuild is "game state" in a meaningful sense — temporary work buffers, leftover values from a previous frame's calculation that get overwritten before being read again, and truly unused padding will differ without indicating any behavioral problem, if the checkpoint comparison naively includes all of RAM rather than a deliberately curated subset.

**Prevention:**
- Boot both the original and the rebuild from the same explicit, scripted reset sequence (not "whatever state happens to be sitting in the emulator") before each verification run, and use the same emulator RAM-init configuration for both, so the power-on pattern is identical going in.
- Design checkpoints to compare an explicitly curated set of addresses/structures known to represent actual game state (player position, health, score, room/level index, enemy state machine variables, animation frame counters) rather than a blind full-RAM hash — building this list is real analysis work (it requires the memory map from the code/data mapping phase to already exist) and should be treated as a first-class deliverable of the verification-harness design, not an afterthought bolted on at the end. This matches the project's own stated constraint ("checkpoint design is a first-class task").
- For anything read from raster/CIA-timer/SID state as part of gameplay logic (rather than purely for audiovisual effect), identify it explicitly during subsystem documentation and either (a) confirm the input script drives it deterministically (same input timing produces the same raster-relative reads on both original and rebuild, because both are being run in the same emulator under the same warp settings) or (b) exclude that specific state from checkpoint comparison with a documented reason, rather than either blindly comparing it (false failures) or blindly ignoring all timing-linked state (missed real bugs).
- Capture framebuffer state only at a moment guaranteed stable — e.g., synchronized to a known vertical-blank/raster-interrupt boundary the game itself uses for its main loop pacing, not an arbitrary "N milliseconds after input," and confirm by capturing twice in a row from the same original run and diffing them (should be byte-identical; if not, capture timing is the first thing to fix, before ever touching the rebuild).
- For CIA/SID/VIC register state that matters for correctness (as opposed to just audio/visual flavor), read via a method that's known not to trigger clear-on-read side effects unless the comparison protocol accounts for that explicitly (e.g., don't read-then-diff a collision register that's expected to have already been read-and-cleared once per frame by the game's own IRQ handler by the time the checkpoint fires).

**Phase to address:** Verification phase (harness construction); dependent on code/data mapping and subsystem documentation phases already having identified which RAM addresses are meaningful game state versus scratch/timing-linked/hardware-shadow.

*Confidence: MEDIUM. The power-on RAM pattern and clear-on-read register behavior are well-established C64 hardware facts. The specific interaction with *this* project's checkpoint design is necessarily speculative until the actual checkpoint set exists — flag this section for re-validation once the verification phase begins.*

---

### Pitfall 8: Documentation decay — speculation hardens into false fact as understanding improves

**What goes wrong:**
Early in a reverse-engineering effort, labels and comments are necessarily guesses ("probably the jump routine," "looks like enemy state"). As understanding deepens, some of those guesses turn out wrong — but if the prose documentation and the source comments aren't revisited when a correction is made elsewhere, the wrong conclusion persists in one place while the corrected understanding exists in another, and a later reader (or a future contributor extending the "base to build on") has no way to know which of two contradictory statements is current. This is especially dangerous in a project explicitly designed to be extended later (Driver 2 in the project's own motivation) — false documentation is worse than missing documentation, because it actively misleads rather than honestly signaling a gap.

**Why it happens:**
Understanding a large 8-bit binary is inherently iterative — labels get better as more of the surrounding code is understood, and there's no natural trigger that forces a re-check of everything that referenced an earlier, wrong assumption about a given routine or table. Confidence isn't naturally tracked, so a guess written down in month 1 reads identically to a fact confirmed in month 3 unless the documentation format deliberately distinguishes them.

**Warning signs:**
- A label name and its associated comment disagree with what the code actually does when re-read carefully (e.g., a label called `enemy_ai_state` that's actually indexed by room number, not enemy).
- Two documents (or a doc and a source comment) describing the same address/routine give different explanations, with no note about which is more recent or more confident.
- A "confirmed" fact turns out to rest on a single early static-disassembly read that was never checked against a live trace (ties directly to Pitfall 1's confidence-tagging practice).

**Prevention:**
- Adopt an explicit confidence marker convention from day one and apply it consistently: e.g., a suffixed `?` on speculative labels/comments (a convention already used elsewhere in 8-bit RE practice), promoted to unmarked once confirmed by live trace or round-trip reassembly. This is cheap, mechanical, and grep-able ("find every remaining `?`-marked label" is a trivial audit at any point).
- When a label or explanation is corrected, grep the whole documentation set and source tree for the old name/claim and update every occurrence in the same change, rather than leaving stale references — treat a correction as incomplete until this sweep is done.
- Prefer comments that explain *why*/*intent* over comments that just restate the instruction, since intent-comments are the ones that go stale in a detectable way (they'll visibly stop making sense if the code around them changes) while restated-instruction comments can go stale invisibly (they'll still "look right" even if wrong, since they don't add information beyond the opcode itself).
- Periodically (at natural phase boundaries) do a pass explicitly looking for `?`-marked items that are now old enough that they should have been resolved by later work, and either resolve or explicitly re-flag them with a reason they're still open.

**Phase to address:** All phases from code/data mapping onward — this is a standing practice, not a one-time fix, and should be established as a documentation convention before subsystem documentation work begins in earnest.

---

## Moderate Pitfalls

### Depacker/loader tooling gaps in the current environment

**What goes wrong:** The devcontainer explicitly lacks `c1541`, `petcat`, `exomizer`, `da65`, and `cc1541` — meaning `.d64` packaging and any static (non-live-emulator) depacking has no ready-made tool and must be solved during research/setup, not assumed available. Discovering this mid-phase (rather than during setup) stalls whichever phase first needs to write a `.d64` or statically unpack a cruncher.

**Prevention:** Resolve `.d64`-writing and depacking tooling explicitly as a setup task before the recovery/depacking phase begins substantive work, not as a surprise blocker discovered mid-phase. Since the project's own stated approach is "live-memory-first" (run under VICE, dump RAM) rather than static depacking, confirm this approach doesn't actually require `exomizer`/`da65` at all before spending effort sourcing them — the missing tools may simply be irrelevant to the chosen method, in which case the gap is a non-issue, but this should be an explicit decision, not an assumption.

**Phase to address:** Recovery/depacking phase (setup step, before analysis work begins).

---

### Tool-mediated, single-shared-emulator-instance workflow risks

**What goes wrong:** VICE runs on the host, reached only via MCP tools — a stateful, shared, single-instance emulator. This creates several concrete risks: state leaking between operations (a checkpoint/watch set during one investigation still active during an unrelated later one, producing confusing unexpected breaks); forgetting to reset between "original" and "rebuild" comparisons (comparing the rebuild against a *previous* state of the original still sitting in memory, rather than a fresh load); snapshot mismanagement (overwriting a snapshot that was actually needed as a baseline); and long operations (extended play-throughs for coverage tracing, or exhaustive checkpoint replay) timing out against whatever call-duration limits the MCP transport imposes. Additionally, this project has one already-known hard failure mode: `vice_disk_list` crashes the host MCP server and requires a manual restart — any workflow step that calls it is a guaranteed stall requiring human intervention, not a soft error to retry around.

**Warning signs:** An investigation shows a breakpoint firing that wasn't set in the current session; a "diff" between original and rebuild shows differences that vanish on a fresh, explicit reset-and-reload of both, revealing the first diff was comparing stale state; an MCP call for a long trace hangs without a clear timeout/error rather than returning partial results.

**Prevention:**
- Establish an explicit "clean slate" ritual before any comparison operation: reset, clear checkpoints/watches, reload from a known snapshot, and confirm (e.g., check PC/register state matches an expected reset condition) before proceeding — never assume the emulator is in a known state just because the previous operation "should have" finished cleanly.
- Name and version snapshots explicitly (e.g., `original_postboot_v1.vsf`, not `snapshot.vsf`) and treat overwriting an unlabeled default snapshot file as an error-prone habit to avoid entirely.
- Break long trace/replay operations into checkpointed segments with intermediate state saved, so a timeout loses at most one segment's progress rather than an entire session, and so segments can be resumed rather than restarted from scratch.
- Never call `vice_disk_list` (already-known hard failure per project memory/hazard notes) — parse `.d64` bytes directly instead, as the project has already decided.
- Because the emulator is host-side and shared, avoid any workflow that depends on truly concurrent/parallel emulator operations — serialize investigation steps explicitly rather than assuming isolation between them.

**Phase to address:** All phases that touch VICE (recovery/depacking, code/data mapping, verification) — establish the reset/snapshot discipline once, early, as a standing operating procedure rather than re-solving it per phase.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Trust static disassembly output without live-trace coverage cross-check | Faster initial progress through "obvious" code | Missed jump tables/RTS-dispatch (Pitfall 1) surface as late, hard-to-diagnose verification failures | Never as the sole source for a region that's about to be documented as "understood" — fine as a fast first pass, not as a final answer |
| Hand-transcribe a block into ACME source without a round-trip byte diff | Faster perceived progress per block | Silent addressing-mode/alignment drift (Pitfall 6) compounds invisibly across the file | Never — the round-trip check is cheap enough that skipping it is never a good trade |
| Diff the two cracked images at the raw sector/pre-decrunch level for a quick provenance signal | Fast, no depacking work needed first | Result is close to meaningless noise (Pitfall 4) and can misdirect investigation | Only as a rough sanity check that the two images are in fact different releases, never as evidence about the original game's bytes |
| Full-RAM hash comparison for verification checkpoints instead of a curated game-state subset | No memory-map research needed up front | Constant false failures from scratch/timing-linked regions (Pitfall 7) erode trust in the harness and encourage disabling/loosening it rather than fixing it | Acceptable only as a coarse early smoke-test before the curated checkpoint set exists — must be replaced, not kept as the final gate |
| Leave speculative labels unmarked, planning to "clean up documentation later" | Faster writing now | Corrections don't propagate (Pitfall 8); speculation reads as fact to future readers/contributors | Never — the marker convention costs nothing to apply as you go and is expensive to retrofit |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|-----------------|-------------------|
| VICE via MCP | Assuming emulator state is clean/reset without checking | Explicit reset-and-verify ritual before every comparison operation |
| VICE via MCP | Calling `vice_disk_list` | Never call it; parse `.d64` bytes directly (already a documented project hazard) |
| ACME assembler | Assembling with default CPU mode and expecting illegal-opcode mnemonics to work | Explicitly set `!cpu nmos6502` (or the appropriate DTV variant) wherever illegal opcodes appear |
| ACME assembler | Trusting "it assembles without errors" as proof of a correct transcription | Gate every reconstructed block on a byte-level round-trip diff against the original recovered image, and fail the build on any warning, not just errors |

## Performance/Effort Traps

Not performance in the runtime-scaling sense (this is a fixed 64KB target, not a system that grows), but effort-allocation traps specific to this project shape:

| Trap | Symptoms | Prevention | Where It Breaks |
|------|----------|------------|-------------------|
| Exhaustive documentation of cracker/loader code | Disproportionate time spent fully understanding TCS-CRUNCH!/SSG internals in depth | The project has already correctly scoped this out ("obstacle, not the object of study") — hold the line: document only enough to defeat/bypass and attribute patched bytes, resist the pull to fully reverse the cruncher algorithm itself | Any time spent beyond "get past it and identify what it touched" |
| SID/music subsystem going down a rabbit hole | Music/sound reversing is a famously deep, semi-independent skill area (player routines, custom players) that can consume large effort for a system the project scopes as lower documentation-depth priority | Cap effort explicitly: identify the player routine and data format enough to extract/document it per the "reverse data formats" requirement, but do not chase full understanding of every SID trick used, consistent with the project's own "documentation depth" prioritization | When time-boxing isn't set explicitly in advance |
| Exhaustive coverage of trivial/repetitive routines (e.g., every near-identical per-room initialization variant) | Large time spent documenting N nearly-identical routines individually | Document the pattern once, note the per-instance parameters/deltas, and treat listing every instance as a data-extraction task (Pitfall-adjacent: this is exactly the kind of "data format" the project already scopes as inspectable-extraction rather than narrative documentation) | When a routine is copy-pasted/parameterized across many call sites |
| Title screen / hi-score entry depth-creep | Spending real analysis time on something the project has explicitly deprioritized | Re-check against the project's own Out-of-Scope note ("documented lightly... execute so they are in the rebuild, but detailed analysis effort goes to systems that make the game a game") whenever tempted to dig deeper here | Any time investment beyond "runs correctly, lightly annotated" |

## "Looks Done But Isn't" Checklist

- [ ] **Disassembly "complete":** Often missing live-trace confirmation for jump-table/RTS-dispatch regions — verify coverage bitmap shows every region as either statically *and* dynamically confirmed, not just statically plausible.
- [ ] **Memory dump "clean":** Often missing on-demand-loaded regions (later rooms/levels) and RAM-under-ROM/IO shadow — verify by playing through every room/level and by checking `$01` port configuration was correct at dump time.
- [ ] **ACME source "matches original":** Often has addressing-mode or alignment drift invisible on read-through — verify via mandatory per-block round-trip byte diff against the recovered image, not visual inspection.
- [ ] **Provenance-diff "establishes originality":** Often actually diffing pre-normalization (different base addresses, or crunched-vs-uncrunched state) — verify both images are diffed only after being brought to the same fully-loaded, same-execution-phase representation.
- [ ] **Verification harness "passing":** Often passing only because checkpoints are too coarse (full-RAM hash including scratch/timing-linked regions, or so few checkpoints that the buggy path is never exercised) — verify the checkpoint set was deliberately designed against the real memory map, not defaulted to "hash everything."
- [ ] **Illegal-opcode handling "supported":** Often means "ACME accepts the mnemonic" without confirming the *disassembly text* that fed the source was actually correct in the first place — verify via round-trip diff, not via successful assembly alone.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|-----------------|
| Missed jump table / RTS-dispatch discovered late | MEDIUM | Re-run live trace targeting the specific gameplay path that exercises it; patch the annotated disassembly and re-verify the affected block's round-trip diff; check whether any already-written ACME source assumed the wrong structure and needs restructuring |
| Self-modifying code discovered after source was already written statically | MEDIUM-HIGH | Identify every checkpoint/play-path that exercises the patched state; rewrite the affected routine to perform the same patch at runtime in the rebuild rather than hardcoding one state; add a targeted verification checkpoint for the previously-missed state |
| Addressing-mode/alignment drift discovered via verification failure rather than round-trip diff | HIGH | Bisect the affected region by re-running round-trip diffs section-by-section (should have been done originally) to localize the first divergent byte; once localized, cost drops back to a normal per-block fix — the expensive part is the bisection that should have been unnecessary |
| Two-crack diff found to be contaminated by a common-ancestor or relocation artifact | MEDIUM | Re-normalize both images properly (fully decompressed/loaded, execution-phase matched) and re-run the diff; if common ancestry is confirmed, downgrade confidence on any conclusions drawn solely from "both cracks agree" and seek a third form of evidence (e.g., known facts about other-platform Bruce Lee releases, or internal consistency checks) |
| Documentation contradicts itself after a correction was made elsewhere | LOW-MEDIUM | Grep for the old label/claim across the whole documentation set and source tree; this is exactly why the confidence-marker and full-sweep-on-correction practice (Pitfall 8) exists — cost stays low only if that practice was followed from early on |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| Code/data misclassification (jump tables, RTS-dispatch) | Code/data mapping | Coverage bitmap shows static + live-trace agreement for every labeled region; no "data" region ever lights up in a live trace |
| Self-modifying code unrecognized | Code/data mapping | Automated cross-reference of write-target operands against regions marked "code" finds zero unflagged hits |
| Illegal/undocumented opcodes mishandled | Code/data mapping, ACME reconstruction | Per-block round-trip byte diff passes for every block; any `!cpu nmos6502` mnemonic used is deliberate and documented, not a guess |
| Cracker contamination misattributed / naive two-crack diff | Provenance-diffing (after recovery/depacking normalizes both images) | Diff performed only on fully-loaded, execution-phase-matched images; every provenance claim carries a confidence tier, not a blanket "confirmed" |
| Depacking/dump incomplete or contaminated | Recovery/depacking | Every reachable code path from later phases resolves to real instructions with no gaps; on-demand-loaded regions confirmed captured by full play-through |
| ACME reconstruction silently diverges | ACME reconstruction | Mandatory per-block round-trip byte diff; build treats all ACME warnings as blocking; `--strict-segments` enabled |
| Verification harness flakiness | Verification | Checkpoint set built from the actual memory map (not blind full-RAM hash); reset/snapshot discipline confirmed identical for original and rebuild before each run |
| Documentation decay | All phases from code/data mapping onward | Confidence-marker convention in use from the start; grep-based sweep performed on every correction |
| Scope/effort traps (cracker code, SID, trivial repetition, title screen) | All phases, but especially subsystem documentation | Time spent on each deprioritized area explicitly checked against the project's own Out-of-Scope section before continuing |
| Tool-mediated VICE workflow risks | All VICE-touching phases | Explicit reset/snapshot ritual documented and followed; `vice_disk_list` never called |

## Sources

- ACME 0.97 official documentation, verified directly from the installed assembler in this project's devcontainer: `/usr/share/doc/acme/Illegals.txt.gz`, `/usr/share/doc/acme/AddrModes.txt.gz`, `/usr/share/doc/acme/Errors.txt.gz`, `/usr/share/doc/acme/QuickRef.txt.gz` — HIGH confidence, primary source, same version this project builds with (0.97 "Zem", 31 Jan 2021).
- [6502disassembly.com — On Disassembly](https://6502disassembly.com/on-disassembly.html) — incremental-mapping and code/data-separation practitioner notes (MEDIUM confidence).
- [Codetapper's C64 Site — California Games Copy Protection](https://codetapper.com/c64/rants/california-games-c64-copy-protection/) — cracker-attribution case study (LOW-MEDIUM confidence, single example, illustrative not authoritative for this project's subject).
- [Crack intro — Wikipedia](https://en.wikipedia.org/wiki/Crack_intro) — general cracktro/loader-replacement background (MEDIUM confidence).
- Web search results on undocumented-opcode usage in commercial C64 titles (Wizball, Boulder Dash, Bard's Tale, Marble Madness, Last Ninja, Speedball, Test Drive II, Buggy Boy, Bomb Jack II, Fort Apocalypse) — LOW confidence as applied to *this* project's specific binary; treat as evidence the pattern exists in the ecosystem, not as a prediction about Bruce Lee specifically.
- Web search results on VICE/real-C64 power-on RAM initialization pattern (fixed short 00/FF runs, not true garbage) — LOW confidence, single-source characterization; worth confirming directly against the actual VICE version in use via the MCP tools before relying on it for checkpoint design.
- [6502.org forum — Self modifying code](https://6502.org/forum/viewtopic.php?t=1255); [6502bench Tools](https://6502bench.com/) — general self-modifying-code and disassembler-tooling background (MEDIUM confidence, well-trodden community topic).
- General 6502/C64 hardware facts (VIC bank windows, sprite pointer 64-byte alignment, `$D018` charset/screen granularity, `$01` port LORAM/HIRAM/CHAREN banking, `$D000-$DFFF` RAM-under-IO) — MEDIUM-HIGH confidence, long-stable, widely cross-confirmed community/hardware documentation; not independently re-verified against a primary Commodore hardware reference during this research pass, but consistent across all sources checked and consistent with the project's own existing `c64-memory-mapping` skill.
- Project context: `/workspaces/bruce_lee/.planning/PROJECT.md` — subject binaries, known hazards, toolchain constraints, and scope decisions already locked in for this project.

---
*Pitfalls research for: C64/6502 reverse engineering and ACME reconstruction (Bruce Lee, Datasoft 1984)*
*Researched: 2026-07-30*
