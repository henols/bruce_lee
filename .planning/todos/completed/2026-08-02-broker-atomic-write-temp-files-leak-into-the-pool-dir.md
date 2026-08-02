---
created: 2026-08-02T09:00:00.000Z
title: The broker's atomic-write helper leaks temp files into the pool dir, and shutdown never sweeps them
area: tooling
severity: minor
files:
  - tools/vice-broker.sh
---

## Problem

`write_json_atomic()` runs `mktemp "$VICE_POOL_DIR/.broker.XXXXXX"`, chmods it 600, writes the
JSON, then `mv`s it to the final path. If the process dies between `mktemp` and `mv`, the temp
file survives — and `purge_protocol_state()` only sweeps `spares/`, `grants/`, `requests/`,
`leases/`, `broker-instances.json` and `broker.json`, never `.broker.*`.

Observed live on 2026-08-02: `.vice-supervisor/.broker.bXkF8L`, 0 bytes, mode 600, dated
2026-08-01 22:53, survived the entire 2026-08-02 broker lifecycle — start, four launches, a
grant, and a purging `^C` shutdown — untouched. It is inert: nothing globs `.broker.*`, so it is
neither `*.json` in a protocol directory nor a numeric port directory. The cost is unbounded
accumulation plus a misleading artifact for anyone inspecting the pool dir mid-outage — the same
class of harm as the stale `usage()` text that misdirected a live debugging session in Defect 2 of
the spare-warming defects todo.

**The `minor` severity above was the assistant's suggestion; it is not confirmed by the user.**

## Solution

Sweep `.broker.*` in `purge_protocol_state()` as the minimal fix. Better: use a deterministic
per-target temp name (`"$final_path.tmp"`) instead of `mktemp`, so a retry overwrites the same
path rather than accumulating a new one — bounded by construction rather than by cleanup. Note for
the Node rewrite: `writeFileSync` + `renameSync` with a fixed `.tmp` suffix, plus exit cleanup,
makes this class of leak structurally impossible — a point in favour of the rewrite rather than a
reason to defer this fix.

## Cross-reference

- `.planning/notes/vice-broker-lifecycle-decisions.md` — Related section links this todo from the
  2026-08-02 correction.
- `.planning/RE-FINDINGS.md` — the 2026-08-02 host validation run this defect was observed during.
- `.planning/todos/pending/2026-08-01-vice-broker-spare-warming-and-stale-grant-defects.md` —
  Defect 2, the stale `usage()` text this defect's harm class matches.
