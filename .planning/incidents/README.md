# Incident Records

An incident record is what `vice_recycle` writes to disk **before it kills anything** (D-17,
phase 01.3). The write happens first, structurally: `handleRecycle()`
(`.claude/mcp/vice/vice-proxy.mjs`) calls `writeIncidentRecord()`
(`.claude/mcp/vice/incident-record.mjs`) before it ever writes a recycle request, so capturing a
record is not something an agent has to remember to do — it is impossible to skip.

## What the file is

Markdown with a YAML frontmatter block:

- `version`, `at`, `port`, `epoch_before`, `epoch_after`, `outcome`, `kill_stage`, `session_id` —
  parseable structured data, so the file greps and scripts as a data record without inventing a
  second format.
- A prose body with the caller's own reason for the recycle, quoted verbatim under
  "## Why this record exists", plus "## Pre-kill evidence" and "## Outcome" sections. The
  outcome section is re-rendered once the recycle actually resolves (`finaliseIncidentRecord()`),
  so a record is never left claiming an outcome is still pending once the tool knows better.

Markdown rather than pure JSON because `.planning/RE-FINDINGS.md` may cite these records by path
and a human reads them directly; frontmatter rather than plain prose because the same file then
greps as structured data with no second format to maintain.

## Filename

`<UTC-compact-timestamp>-port<N>-epoch<M>.md` — for example
`20260802143000123-port6510-epoch7.md`. The filename is built ONLY from a UTC timestamp, an
integer port and an integer epoch; no caller-supplied string (including the recycle's own
"reason" argument) ever reaches it. A second recycle landing in the same second on the same port
and epoch gets `-2`, `-3`, and so on appended rather than overwriting the first record.

## These files are never archived

Unlike the stall todos they replace (`.planning/todos/pending/*wedged*.md`, which move to
`todos/completed/` once resolved), incident records are never moved or deleted. They are a
permanent log of every deliberate recycle this project has ever performed, kept for the same
reason `.planning/RE-FINDINGS.md` is append-only: the value of the record is proportional to how
completely it survives.

## Why this directory is repo-tracked, not gitignored runtime state

Every other file the `mcp__vice__*` tool surface reads or writes lives under the gitignored
`.vice-supervisor/` tree — request/grant/lease/epoch files that exist only for the lifetime of a
running broker and carry no lasting value once a session ends. An incident record is different:
it is evidence of something that happened, and a record written to gitignored runtime state is
exactly as lost as no record at all (D-18) — the next `git clone`, the next fresh container, or
simply `.vice-supervisor/` being wiped between sessions would erase it silently. Committing
`.planning/incidents/` is what makes "a session recycled its own emulator, and here is proof"
survive past the session that produced it.

`.planning/RE-FINDINGS.md` may cite incident records by their path under this directory.
