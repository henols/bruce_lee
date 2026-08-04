---
name: skill-writer
description: Write a new skill for this repo, or fix one that never triggers. Use when asked to create, author, add or scaffold a skill, to turn a repeated procedure into a skill, to review or rewrite an existing SKILL.md, or to work out why a skill is not being picked up.
---

# Writing a skill

A skill is one directory under `.claude/skills/`, holding one `SKILL.md`. The
frontmatter decides whether the skill is ever reached; the body decides whether it
helps once it is. Both fail silently, so both are checked below.

```bash
mkdir -p .claude/skills/<name>          # directory name IS the skill name
$EDITOR .claude/skills/<name>/SKILL.md  # frontmatter + body
$EDITOR .claude/CLAUDE.md               # add one row to the Project Skills table
```

## Frontmatter contract

Two keys, both required, nothing else needed:

| Key | Rule |
|---|---|
| `name` | Lowercase, hyphenated. **Must equal the directory name.** A mismatch is the single most common reason a skill never loads. |
| `description` | One sentence or two. Names the capability *and* the phrasings that should route to it. This is the only part of the skill that is always in context — everything else is loaded on demand. |

`allowed-tools` exists as an optional restriction on what the skill may call. No
skill in this repo uses it; reach for it only when a skill must be prevented from
writing.

Write the description in the third person, about the task, not about the reader:

```yaml
# Reaches the skill.
description: Capture a running C64's full 64K RAM as a verified flat image, and prove
  two captures are equivalent. Use when asked to dump RAM, depack a program by running
  it, capture a memory image at a checkpoint, or compare two captures for reproducibility.

# Never reaches it — no trigger surface, and "helps you" describes the reader.
description: Helps you work with memory.
```

The pattern every working skill here follows: **what it does**, then `Use when
asked to …` followed by the concrete verbs and nouns a request would actually
contain. Include the vocabulary you would not choose yourself — `dump`, `depack`,
`disasm`, `$D020` — because the request will use it. A skill that only matches its
own preferred wording is a skill that never fires.

## Where files go

| Path | Holds | Notes |
|---|---|---|
| `<skill>/SKILL.md` | The index. Always loaded when the skill triggers. | Keep it to what a reader needs every time. |
| `<skill>/scripts/*.mjs` | Every executable module. | Node ≥18, run as `node .claude/skills/<skill>/scripts/x.mjs`. Paths anchor from the skill root via one `..` hop — see `c64-memory-mapping`. |
| `<skill>/resources/` | Hand-authored shell deployed as a unit. | Only where something outside the repo consumes it. |
| `<skill>/<data>.json`, `template.a` | Data and templates. | Skill root, not `scripts/`. |
| `<skill>/references/*.md` | Detail loaded on demand. | Reference by path from SKILL.md so it is fetched only when needed. |

Commit generated data that the skill needs to run offline — `memmap.json` is
committed precisely so `lookup` needs nothing but Node.

## Progressive disclosure

`SKILL.md` is an index, not a manual. Everything in it costs context on every
trigger; everything outside it costs nothing until named.

- Put the whole workflow in `SKILL.md` when it fits in roughly a screen or two.
- Move per-format tables, long reference material, and rarely-needed edge cases
  into sibling files, and name the path where the reader would want them.
- Never inline something a script can produce. `node … lookup '$D011'` beats
  pasting a register table into the skill.

## House style

Match the four skills already here. They read the same way on purpose:

- **Imperative and terse.** "Read state before you resume, and resume exactly once
  at the end." Not "it is recommended that you consider…".
- **Commands first.** Open with the fenced block that does the thing, then explain.
  Assign the long path to a variable (`D=.claude/skills/…/scripts/driver.mjs`) and
  use it throughout.
- **Worked output, not description.** Show what the command actually prints.
- **Tables for contracts** — options, file meanings, troubleshooting. `acme-build`
  ends in a `Symptom | Fix` table; copy that.
- **Numbered steps for anything ordered**, especially where order is load-bearing
  (`c64-ram-capture`'s capture sequence).
- **State the provenance of any claim.** This project grades every fact; a skill
  asserting something about the machine says how it was established. Say which
  source a table came from, and mark what is verified versus assumed.

## Hard rules a new skill must not break

These are project constraints, not preferences. A skill that violates one is wrong
however well it is written.

| Rule | What it forbids in a skill |
|---|---|
| `mcp__vice__*` is the only route to the emulator | No script, test or module may open its own connection to the host VICE, read broker state to find a port, or import a transport module as a library. A skill that needs a Node process to reach VICE is not implementable — say so instead of designing around it. |
| Everything runs headless in this Linux container | No GUI, no display, no Windows runtime, no Wine. If the capability needs a desktop, the skill reports it unavailable. |
| ACME is the only assembler | Source idioms stay ACME-compatible. |
| No wall-clock synchronisation | Skills that drive the emulator synchronise on checkpoint hits and frame counts. Never `sleep`. |
| A skill's `scripts/` hold pure logic only | Resolution, attribution, ordering, rendering — over data the agent already fetched. Nothing there contacts the emulator; an import-purity test enforces it. |
| Skills must be portable | No reference to this project's game, releases or disk images. Resolve the project root by walking up for `.git`, never by counting hops; make data locations overridable; let corpus-dependent tests skip rather than fail. |
| `.claude/mcp/` is off-limits unless the task *is* maintaining it | A skill about using the emulator does not read or edit that tree. |

Two more that apply to the skill's own content: findings that make RE faster
belong in `.planning/RE-FINDINGS.md` at the moment they are found, and file-changing
work enters through a GSD command (`/gsd-quick`, `/gsd-debug`,
`/gsd-execute-phase`) — a skill should route the reader there rather than editing
around the gate.

## Register it

The Project Skills table in `.claude/CLAUDE.md` lives between
`<!-- GSD:skills-start source:skills/ -->` and `<!-- GSD:skills-end -->`. A row is
the skill's directory name, its `description`, and its `SKILL.md` path — so add one
row per new skill, in alphabetical order.

**Add the row by hand. Do not run `gsd-tools generate-claude-md` to do it.**

That command is the nominal generator, and the marker comments invite it, but it
regenerates *every* managed block — `project`, `stack`, `skills`, `workflow` — from
`.planning/PROJECT.md` and `.planning/research/STACK.md`. Those sources are stale
relative to CLAUDE.md, which has been hand-refined past them. Running it to
register a skill silently regresses the project's hard rules: measured on
2026-08-04 it rewrote the `mcp__vice__*` single-route constraint into a weaker
form citing a `devcontainer-host-path` skill that no longer exists, deleted the
headless-container constraint outright, and reverted the settled `.d64`-from-Python
decision to "needs a solution chosen during research" — 62 insertions, 36
deletions for a one-row change.

If you run it anyway, diff before committing:

```bash
git diff .claude/CLAUDE.md          # must touch ONLY the GSD:skills-* block
git checkout .claude/CLAUDE.md      # if it touched anything else
```

The generator becomes safe once `PROJECT.md` and `STACK.md` are brought up to date
with CLAUDE.md's constraint list. Until then hand-editing the table is the correct
route, and it is the one exception to "never hand-edit a generated block" in this
repo.

## Validation checklist

Before calling a skill done:

- [ ] `name` matches the directory name exactly.
- [ ] `description` names the capability and the trigger phrasings, in the third
      person, including vocabulary you would not have chosen.
- [ ] Every command in the skill has been run, and the shown output is real.
- [ ] Every path the skill cites resolves to a file that exists.
- [ ] Scripts are under `scripts/`; data and templates are at the skill root.
- [ ] Nothing in it breaks a hard rule above.
- [ ] It says how its claims were established, and marks what is unverified.
- [ ] The Project Skills table in `.claude/CLAUDE.md` has the new row, added by
      hand, with no other part of that file changed.

The mechanical half of that list is checkable:

```bash
node -e '
const fs=require("fs"),p=".claude/skills";
for (const d of fs.readdirSync(p)) {
  const f=`${p}/${d}/SKILL.md`;
  if (!fs.existsSync(f)) { console.log(`FAIL ${d}: no SKILL.md`); continue; }
  const m=fs.readFileSync(f,"utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) { console.log(`FAIL ${d}: no frontmatter`); continue; }
  const name=(m[1].match(/^name:\s*(.+)$/m)||[])[1]?.trim();
  const desc=(m[1].match(/^description:\s*([\s\S]+?)(?=\n\S+:|$)/m)||[])[1]?.trim();
  const bad=[];
  if (name!==d) bad.push(`name "${name}" != dir "${d}"`);
  if (!desc) bad.push("no description");
  else if (!/\buse when\b/i.test(desc)) bad.push("description has no \"Use when\" trigger clause");
  console.log(bad.length ? `FAIL ${d}: ${bad.join("; ")}` : `ok   ${d}`);
}'
```

It catches the name/directory mismatch, a missing or unparseable frontmatter, and
a description with no trigger surface — the three failures that make a skill
invisible rather than merely unhelpful. Everything else on the list needs reading.

## Skeleton

````markdown
---
name: my-skill
description: <What it does, in one clause.> Use when asked to <verb> <noun>,
  <alternate phrasing>, or <the term someone else would use>.
---

# <Imperative title>

<One or two sentences: what goes in, what comes out.>

```bash
S=.claude/skills/my-skill/scripts/driver.mjs

node $S <verb> <arg>      # the common case
```

## <The main operation>

<Command, then real output, then how to read it.>

## Troubleshooting

| Symptom | Fix |
|---|---|
| … | … |
````
