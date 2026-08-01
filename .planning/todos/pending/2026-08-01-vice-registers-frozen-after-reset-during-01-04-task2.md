# VICE MCP quirk: CPU register state froze identically across pause/resume/soft-reset/hard-reset/single-step

**Found during:** Plan 01-04, Task 2, danish release, immediately after the IRQ-handler-entry
reconnaissance checkpoint (`$1103`, exec, stop) was armed, resumed, and repeatedly polled with
`vice_ping`.

**Symptom, in order:**

1. `vice_checkpoint_add` at `$1103` (exec, stop) → `vice_execution_run` → several `vice_ping`
   calls all report `execution: "running"`.
2. `vice_execution_pause` → `vice_registers_get` reports `PC:4011 A:1 X:21 Y:38 SP:251 I:true`
   (a `DEX`/`BPL` delay loop at `$0FAB`, interrupts disabled).
3. `vice_checkpoint_list` shows the `$1103` checkpoint at `hit_count: 0` even after multiple
   resume/poll cycles — the checkpoint never fired despite this being a title screen previously
   confirmed to be IRQ-driven (backtrace `$FF41` in earlier project findings; this session's own
   reconnaissance found a live raster-split IRQ chain at `$1103`→`$1574`→`$152C`).
4. `vice_cycles_stopwatch reset` → `vice_execution_run` → two `vice_ping` (`running`) →
   `vice_cycles_stopwatch read` reports **`cycles: 0`** — no cycles advanced despite the resume.
   Repeated once more (fresh reset + resume + 2 pings): **still 0**.
5. `vice_registers_get` again: **byte-for-byte identical** `PC:4011 A:1 X:21 Y:38 SP:251` to step 2.
6. `vice_checkpoint_delete` on the `$1103` checkpoint (to rule out a stuck breakpoint) →
   reset stopwatch → resume → `vice_registers_get`: **still identical**.
7. `vice_machine_reset({mode:"soft", run_after:false})` → `status:"ok"` → `vice_registers_get`:
   **still byte-for-byte identical** to step 2 (a real soft reset must change PC to the reset
   vector; it did not).
8. `vice_machine_reset({mode:"hard", run_after:false})` → `status:"ok", message:"Machine power
   cycled"` → `vice_registers_get`: **still byte-for-byte identical**. A real hard reset cannot
   leave `PC`/`A`/`X`/`Y`/`SP` unchanged.
9. `vice_ping` after the hard reset reports `execution: "running"` (contradicts `run_after:false`,
   which should leave the machine paused at the reset vector).
10. `vice_backtrace` **did** change between calls (2 frames → 0 frames), so *some* internal state
    moved even while `vice_registers_get`'s PC/A/X/Y/SP field set did not.
11. `vice_execution_pause` → `vice_ping` correctly reports `execution: "paused"` this time (ping's
    running/paused reporting tracks real state).
12. `vice_execution_step({count:1})` → `status:"ok", instructions:1` → `vice_registers_get`:
    **still byte-for-byte identical** `PC:4011`. A single explicit step cannot leave PC unchanged
    for a one-byte `DEX` instruction.

**Read as a whole:** `vice_ping`'s running/paused field and `vice_backtrace`'s frame count both
independently reflect *some* real state change over this sequence, while `vice_registers_get`
returned the exact same byte-for-byte register snapshot across two resumes, a checkpoint delete,
a soft reset, a hard reset, and an explicit single step. This is not consistent with a genuine CPU
deadlock (a `DEX`/`BPL` loop cannot hang, and a hard reset cannot fail to move the reset vector);
it reads as the register-reporting path of the bridge returning a stale/cached snapshot while
other paths (`ping`, `backtrace`) continue reflecting live state.

**Not attempted:** no host-side restart, no direct connection to VICE outside `mcp__vice__*` tool
calls, per the project's hard rule. No further `vice_execution_run`/`vice_machine_reset` cycles
were issued once the pattern was clear, per the "Host VICE has crashed repeatedly... several times
on `vice_execution_run`... if the host dies, report it" guidance already recorded in
`.planning/STATE.md`.

**Consequence for plan 01-04:** Task 2's danish-release work (loader-range derivation, the
counting-tier probe, the small earned watch_set, idle calibration, and the IRQ-path/main-loop
reconnaissance this session's developer steering asked for) was completed and committed **before**
this quirk appeared, and is unaffected — all of that evidence was gathered and recorded while the
register-reporting path was still live (cross-checked against varying, plausible disassembly and
memory-read content throughout). Task 2's saeger-release pass and all of Task 3 (the play-through,
for both releases) could not be attempted this session because `vice_registers_get` cannot be
trusted to reflect a checkpoint hit or a milestone boundary while this quirk is present, and
`vice_execution_step`/`vice_machine_reset` no longer demonstrably affect CPU state either.

**Refinement, found immediately after logging the above:** `vice_vicii_get_state`, called right
after one more `vice_execution_run`, returned a completely different, plausible post-hard-reset
snapshot (`screen_enabled:false`, `25_rows:false`, `video_mode:0`, `border_color:240`,
`memory_pointers:1` — the classic screen-disabled state before KERNAL initializes the display,
distinct from every prior reading in this session). This proves the hard reset **did** take
effect at the hardware level and that `vice_ping`/`vice_vicii_get_state`/`vice_backtrace` all
track live state correctly. The very next `vice_registers_get` call, with no other call in
between, returned **the exact same stale `PC:4011 A:1 X:21 Y:38 SP:251` snapshot as every prior
call in this incident**. The bug is therefore isolated specifically to `vice_registers_get`'s
response path in this session, not to the emulator's actual execution state, and not to every
state-reading tool.

**Escalation: the stall became session-wide, not tool-specific, after switching to `saeger.d64`.**
After the `vice_registers_get`-only freeze documented above, this session detached `danish.d64`,
hard-reset, attached `saeger.d64`, autostarted, fed a queued PETSCII SPACE (`vice_keyboard_petscii`,
matching saeger's recorded `kernal-buffer` gate-delivery mode), and polled `vice_ping` repeatedly
(all reporting `execution:"running"`) across roughly 25 poll cycles. `vice_disassemble` at
`$08E0-$08FA` returned the **same unpopulated power-on-pattern bytes** (`00`/`FF` runs) on two
separate checks separated by further resume+poll cycles -- the raw-sector loader payload never
materialized there, consistent with the machine never genuinely advancing past early boot.
`vice_vicii_get_state` returned **byte-for-byte identical output** (`raster_line:55`,
`screen_enabled:false`, `border_color:240`, full register array identical) to the reading taken
immediately after the earlier hard reset on the *danish* side of this incident -- i.e. VIC-II
state that had previously been shown to reflect real changes was now also frozen. Most decisively:
`vice_cycles_stopwatch reset` -> `vice_execution_run` -> two `vice_ping` (`running`) ->
`vice_cycles_stopwatch read` returned **`cycles: 0`**, repeated a second time with the same
result. Both `checkpoint 1` (armed at saeger's `$08B1` trigger) and the boot itself never
progressed. This is no longer isolated to `vice_registers_get`: **no cycles are being retired by
the emulator at all**, while `vice_ping` continues to report `status:"ok", execution:"running"`
uninterrupted throughout, which is exactly the "checkpoint appears to never fire because almost no
cycles have executed" failure mode this project's own `STATE.md` already documents at a smaller
scale (~6,000 cycles/s vs ~991,000 cycles/s) -- except here the count is genuinely zero, not
merely reduced, across two independent measurement brackets on two different disk images.

**Consequence, revised:** Task 2's saeger pass and all of Task 3 could not be attempted at all
this session (not merely "not attempted due to caution" -- the boot for saeger never left its
pre-loader state, so there is no live evidence to report for that release). Per
`.claude/CLAUDE.md` and `.planning/STATE.md`'s own recorded guidance ("If the host dies, report
it -- do not try to restart it from the container" / "Host VICE has crashed repeatedly... several
times on `vice_execution_run`"), no further resume/reset cycles were attempted once this pattern
was confirmed a second time on a second disk image.

**Suggested diagnostic for a future session (not attempted here):** open a **fresh** session (new
`mcp__vice__vice_ping` as the very first call, so a fresh instance is granted per the project's
per-session boot-fresh access model) and check whether `vice_registers_get` reflects a step/resume
correctly from a clean start, before resuming this plan's remaining live work. If the same
freeze recurs immediately on a boot-fresh instance, the bug is structural rather than session-state
corruption; if it does not, this instance's specific internal state was the trigger and is worth
narrowing further (e.g., does it correlate with arming an exec checkpoint on an address that turned
out to be an IRQ handler entry, immediately followed by several read-only polls with no other
calls in between?).
