---
name: c64-ram-capture
description: Capture a running C64's full 64K RAM as a verified flat image, and prove two captures are equivalent. Use when asked to dump RAM, depack a program by running it, capture a memory image at a checkpoint, or compare two captures for reproducibility.
---

# Capturing and comparing C64 RAM

Reach the emulator only through the `mcp__vice__*` tools. They are the one
permitted route. Never open a connection to the emulator by any other means.

## Boot a disk

1. `mcp__vice__vice_disk_attach` with the disk image.
2. `mcp__vice__vice_autostart` with the same image.
3. `mcp__vice__vice_execution_run`.
4. `mcp__vice__vice_registers_get` and confirm the program counter has moved.

If the program counter has not moved, type `LOAD"*",8,1` with
`mcp__vice__vice_keyboard_type`, run it, then type `RUN` and run it.

## Capture at a trigger address

1. `mcp__vice__vice_checkpoint_add` at the trigger address, with execution
   breaking and stopping enabled.
2. `mcp__vice__vice_execution_run`.
3. Poll `mcp__vice__vice_ping` until the checkpoint reports a hit.
4. Read `$0000`–`$FFFF` with repeated `mcp__vice__vice_memory_read` calls of
   4096 bytes each, and concatenate the results in address order into one
   65536-byte image.
5. Confirm the image is exactly 65536 bytes, then record its SHA-256.
6. Record alongside it, in the same step: the value at `$0001`, the video
   standard from `mcp__vice__vice_vicii_get_state`, and the registers from
   `mcp__vice__vice_registers_get`.
7. `mcp__vice__vice_checkpoint_delete` the checkpoint.
8. `mcp__vice__vice_checkpoint_list` and confirm it reports zero checkpoints.
   Accept only this enumeration as proof. Record the count.
9. `mcp__vice__vice_execution_run` to leave the machine running.

Read state before you resume, and resume exactly once at the end.

Hold keys down across a gate by releasing them at the trigger checkpoint in
step 3, never earlier.

## Find an entry point

1. Press past any "hit any key" gate with `mcp__vice__vice_keyboard_matrix`.
2. Step forward in batches with `mcp__vice__vice_execution_step`, reading
   `mcp__vice__vice_registers_get` after each batch.
3. Stop when the program counter and the stack pointer both settle into a
   repeating range across three consecutive batches. That range is the
   dispatch loop; its lowest address is the entry point.
4. Confirm the address with `mcp__vice__vice_disassemble` before recording it.

Set a batch ceiling before you start. Report failure to stabilise as a
finding with the batches spent; never extend the ceiling silently.

## Prove the machine did not change under you

Read the restart epoch at the start of a capture and again at the end.
Report the same epoch to accept the capture. Report a changed epoch to void
it.

## Void a run

Void a capture whose machine identity you could not prove unchanged.

1. Rename each artifact to `<name>.VOID-<UTC timestamp>`.
2. Write a sibling note recording the reason, both epoch values, and the
   time. Keep the voided artifacts on disk.

## Compare two captures

Compare two 65536-byte images address by address.

- Treat differences at `$0000`–`$0001`, `$0100`–`$01FF` and `$0200`–`$03FF`
  as volatile. Count them, exclude them from the verdict, and report the
  count.
- Treat a difference of exactly one bit as drift. List each one with its
  address and both values, and report them as candidates.
- Treat a difference of two or more bits as a real divergence. List each one
  with its address and both values. Any such difference fails the comparison.

Report the verdict as pass or fail, with all three lists attached.

## Establish a drift floor

Capture the power-on image as the very first action against a fresh machine.

Then run the machine idle, capture, run idle again, capture again, and
compare. Report every address that differed as the drift floor for that
machine. State it as a floor, not a complete set.
