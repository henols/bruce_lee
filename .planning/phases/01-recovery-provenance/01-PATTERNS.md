# Phase 1: Recovery & Provenance - Pattern Map

**Mapped:** 2026-07-30
**Files analyzed:** 10 (tools + docs planned per CONTEXT.md/RESEARCH.md)
**Analogs found:** 3 real code analogs (all from `.claude/skills/`) / 10 — this is a near-greenfield phase; most files establish new patterns rather than copying existing ones.

## Grounding note

Outside `.planning/` and `.claude/`, this repository has **no application source code**. The only genuine analogs available are the three existing skill scripts (`acme.mjs`, `hostpath.mjs`, `driver.mjs`) and `.mcp.json`. Everything under `tools/` and `recovery/` this phase creates is the *first* code of its kind in the repo. Where no real analog exists, this document says so explicitly rather than inventing one.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `tools/hostpath-boot.mjs` | utility (CLI wrapper around MCP tool calls) | request-response (MCP JSON-RPC round trip) | `.claude/skills/devcontainer-host-path/hostpath.mjs` (path translation) + `.claude/skills/acme-build/acme.mjs` (CLI/subprocess shape) | role-match (composite: no file in repo already calls a `vice_*` MCP tool, so the MCP-call half is new pattern) |
| `tools/dump-capture.mjs` | utility (file I/O — assembles a flat binary from many reads) | file-I/O / batch (chunked reads assembled into one `Buffer`) | `.claude/skills/acme-build/acme.mjs` (`build()`'s file-assembly + CLI verb shape) | role-match — no chunked-read/assemble-buffer analog exists; CLI conventions carry over, the read-loop logic does not |
| `tools/chip-state.mjs` | utility (structured JSON sidecar writer) | transform (raw tool responses -> derived JSON) | `.claude/skills/c64-memory-mapping/driver.mjs` (`memmap.json` merge-and-write pattern) | role-match — same "call something, derive fields, write JSON" shape; different data source |
| `tools/diff-images.mjs` | utility (batch byte diff / ledger generator) | batch / transform | `.claude/skills/acme-build/acme.mjs` (`parseSymbols`/`curateLabels` parse-and-filter shape) | partial — closest thing to "parse two artifacts, coalesce ranges, emit report," but nothing in-repo does byte diffing today |
| `tools/d64-parse.mjs` | utility (binary format parser) | file-I/O / transform | NO ANALOG — new pattern | none |
| `recovery/danish/NOTES.md`, `recovery/saeger/NOTES.md` | doc (procedure record) | — | NO ANALOG — new pattern | none |
| `recovery/LOADING.md` | doc (evidence-of-absence record) | — | NO ANALOG — new pattern | none |
| `recovery/PROVENANCE.md` | doc (generated-ledger + prose tier) | — | NO ANALOG — new pattern (structure specified directly by CONTEXT.md D-14, not by any existing file) | none |
| `recovery/clean/README.md` | doc (measured-decision record) | — | NO ANALOG — new pattern | none |
| `recovery/clean/bruce-lee.bin` + `*.map.json` + `*-state.json` | data artifact (binary image + JSON sidecars) | file-I/O | NO ANALOG — new pattern (schema specified by D-02/D-04, not derived from any file) | none |

## Pattern Assignments

### `tools/hostpath-boot.mjs` (utility, request-response)

**Analog 1 — CLI/module conventions:** `.claude/skills/acme-build/acme.mjs`
**Analog 2 — host-path translation (mandatory, load-bearing):** `.claude/skills/devcontainer-host-path/hostpath.mjs`

**Module/shebang/import pattern** (`acme.mjs` lines 1-11):
```js
#!/usr/bin/env node
// ACME -> C64 assembler driver.  Target is fixed: C64, 6510 CPU, cbm output.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, basename, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const HERE = dirname(SELF);
```
Every Phase 1 `tools/*.mjs` should follow this exact shape: `#!/usr/bin/env node` shebang, ESM `node:`-prefixed imports only, `SELF`/`HERE` derived via `fileURLToPath(import.meta.url)`, zero third-party dependencies (matches D-18 and RESEARCH.md's "no npm install" finding).

**Error/die convention** (`acme.mjs` line 36):
```js
const die = (m) => { console.error(`error: ${m}`); process.exit(1); };
```
Copy this verbatim-style helper into each new tool — it is the repo's one existing error convention (also used identically in `hostpath.mjs` lines 227-228: `console.error(\`error: ${e.message}\`); process.exit(1);`).

**Verb dispatch / usage pattern** (`acme.mjs` lines 245-261):
```js
const [cmd, ...rest] = process.argv.slice(2);
const VERBS = { new: cmdNew, build: cmdBuild, sym: cmdSym, disasm: cmdDisasm };
if (!cmd || !VERBS[cmd]) {
  console.log(`usage: node ${selfPath()} <command> [options]
  ...`);
  process.exit(cmd ? 1 : 0);
}
VERBS[cmd](rest);
```
Use this `VERBS` object + argv-dispatch shape for any multi-verb tool (e.g. `hostpath-boot.mjs attach|autostart|status`).

**Mandatory host-path translation** (must be used by every call that hands a path to `vice_disk_attach`/`vice_autostart`) — `hostpath.mjs` lines 133-140 and 160-178:
```js
export function hostPath(containerPath) {
  const { abs, candidates, reason } = hostPathCandidates(containerPath);
  if (!candidates.length) {
    throw new Error(`${reason || `cannot determine a host path for ${abs}`}\n  Or ${SET_ENV_HINT}`);
  }
  return candidates[0];
}

export async function tryHostPaths(containerPath, fn, { fatal } = {}) {
  const { abs, candidates, reason, exact } = hostPathCandidates(containerPath);
  if (!candidates.length) throw new Error(...);
  if (!exact) process.stderr.write(guessNote());
  const errors = [];
  for (const p of candidates) {
    try { return { result: await fn(p), hostPath: p }; }
    catch (e) { errors.push(`  ${p}\n    -> ${e.message}`); if (fatal?.(e)) throw e; }
  }
  throw new Error(`no candidate host path worked for ${abs}:\n${errors.join("\n")}\n  ${SET_ENV_HINT}`);
}
```
`tools/hostpath-boot.mjs` should `import { hostPath, tryHostPaths } from "../.claude/skills/devcontainer-host-path/hostpath.mjs"` (or copy the module per its own header comment, which explicitly invites copying: "copy this file into any devcontainer-based project and it works") and wrap every `vice_disk_attach({unit, path})` / `vice_autostart({path})` call through `tryHostPaths`, trying each host-path candidate until VICE accepts it, exactly as `tryHostPaths`'s docstring describes ("Run `fn(hostPath)` against each candidate until one succeeds").

**No analog exists for the MCP-call half itself** — no file in this repo currently invokes a `vice_*` tool. That part of `hostpath-boot.mjs` is new pattern: call the tool via whatever MCP client surface the execution agent has (the `vice_*` tools directly, per RESEARCH.md's Code Examples section), not raw HTTP (raw HTTP was only used by the research subagent because it lacked registered `vice_*` tools).

---

### `tools/dump-capture.mjs` (utility, file-I/O/batch)

**Analog:** `.claude/skills/acme-build/acme.mjs` — `build()`'s output-assembly and CLI-verb conventions (lines 93-154, 179-184). No analog exists for the chunked-read-and-assemble loop itself.

**Conventions to copy:**
- Same shebang/import/die pattern as above.
- Directory-creation-before-write pattern (`acme.mjs` lines 99-100):
```js
const outDir = dirname(prg);
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
```
Apply this before writing into `recovery/{danish,saeger}/dumps/`.
- Result-object + `reportBuild`-style separation of "compute result" from "print result" (`acme.mjs` lines 93-175): build a plain result object (`{ok, image, size, ranges, ...}`), then a separate `report()` function that prints either human text or `JSON.stringify(res, null, 2)` when `--json` is passed (see `parseOpts`'s `o.json` flag, lines 224-243). Every Phase 1 tool should support `--json` for scriptability, matching this existing convention.

**New pattern (no analog) — chunked bank-scoped read loop.** Per RESEARCH.md's Code Examples section (verified live):
```js
const CHUNK = 4096;
const image = Buffer.alloc(65536);
for (let addr = 0; addr < 65536; addr += CHUNK) {
  const size = Math.min(CHUNK, 65536 - addr);
  const { data_hex } = await viceMemoryRead({
    address: `$${addr.toString(16).padStart(4, "0")}`,
    size, bank: "ram", encoding: "hex",
  });
  Buffer.from(data_hex, "hex").copy(image, addr);
}
```
This is RESEARCH.md's own conceptual shape (not yet written), included here because it is the load-bearing loop for RECOVER-02/03 and D-01/D-03 and there is no existing repo file to imitate for it.

---

### `tools/chip-state.mjs` (utility, transform)

**Analog:** `.claude/skills/c64-memory-mapping/driver.mjs` — the "call/derive/merge/write JSON" shape used to build `memmap.json` (lines 22-46 show the merge-table setup: `SOURCES`, `SRC_RANK`, `GRAFT_FIELDS` as the pattern for combining several raw inputs into one ranked/merged JSON output).

**Conventions to copy:**
- Same shebang/HERE-relative-path pattern (`driver.mjs` lines 1-23):
```js
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMMAP_JSON = join(HERE, "memmap.json");
```
- Comment-driven "why," not just "what," at the top of the file, matching `driver.mjs`'s header block (lines 2-16) — this repo's established doc-comment style for `.mjs` tools.
- Self-contained, offline-first: `chip-state.mjs` should write only from data already returned by the `vice_*` calls (`vicii_get_state`, `sid_get_state`, `cia_get_state`, `sprite_get`×8, plus derived VIC-bank/sprite-pointer math per RESEARCH.md's "Nuance for D-04" section) — no network calls, matching `driver.mjs`'s "no dependencies on purpose" discipline (line 16).

**No analog** for deriving VIC-bank/sprite-pointer bytes from `$DD00`/`$D018` — this math is specified in RESEARCH.md (lines ~213-215) and the `c64-memory-mapping` skill's own documented derivation, not copied from working code, since no code in the repo does this derivation yet. Consult `.claude/skills/c64-memory-mapping/SKILL.md` for the exact bit-level rules when writing this file.

---

### `tools/diff-images.mjs` (utility, batch/transform)

**Analog:** `.claude/skills/acme-build/acme.mjs` — `parseSymbols`/`curateLabels` (lines 62-91) as the closest existing "parse a byte/line stream, filter/keep by a rule, coalesce into a smaller output" shape.

```js
function curateLabels(vsPath, symbols) {
  if (!existsSync(vsPath)) return { kept: 0, dropped: 0 };
  const addr = new Set(symbols.filter((s) => s.isAddress && s.used).map((s) => s.name));
  const kept = [];
  let dropped = 0;
  for (const l of readFileSync(vsPath, "utf8").split("\n")) {
    const m = l.match(/^al\s+C:[0-9a-f]+\s+\.(\S+)/i);
    if (!m) continue;
    if (addr.has(m[1])) kept.push(l); else dropped++;
  }
  writeFileSync(vsPath, kept.join("\n") + (kept.length ? "\n" : ""));
  return { kept: kept.length, dropped };
}
```
The "iterate, test a predicate, accumulate kept-vs-dropped counts, report both" shape is worth copying for D-14's coalesced-range logic (accumulate identical-byte runs, coalesce across gaps < 16 identical bytes, report kept-range-count vs coalesced-count).

**No analog** for the actual byte-diff/anchor-search algorithm (D-17's `Buffer.indexOf`-based offset proof, D-14's range coalescing). RESEARCH.md's Normalisation/Diffing section and Don't-Hand-Roll table confirm this is plain `Buffer.indexOf` over two 64KB buffers — write it fresh; there is nothing in-repo to imitate here beyond general Node/CLI conventions above.

---

### `tools/d64-parse.mjs` (utility, file-I/O/transform)

**NO ANALOG — new pattern.** No file in this repo parses a binary disk-image format. Establish convention from scratch, but stay consistent with the CLI/shebang/die/`--json` conventions extracted from `acme.mjs` above (this is the one cross-cutting convention this repo does have). Structural facts to implement come from RESEARCH.md/STACK.md directly (35 tracks, BAM at track 18 sector 0, directory chain from 18/1), not from any existing code.

---

### `recovery/*.md` documents (NOTES.md, LOADING.md, PROVENANCE.md, README.md)

**NO ANALOG — new pattern.** No `recovery/` tree exists yet and no prior Markdown-artifact convention in this repo matches (`.planning/` documents are GSD-workflow artifacts with a different audience/purpose, not a good pattern source). Structure for each is instead fully specified by CONTEXT.md's decisions:
- `NOTES.md` — D-06 (dump trigger), D-08 ($01 config), D-09 (reproducibility hashes) as required fields; structure otherwise left to Claude's Discretion per CONTEXT.md.
- `LOADING.md` — D-10/D-11 (what was armed, how far played, zero-found-as-evidence framing).
- `PROVENANCE.md` — D-14 (coalesced generated ranges + prose tier, explicit gap-coalescing tolerance stated in the doc itself).
- `recovery/clean/README.md` — D-16 (measured patch-count comparison as the stated reason, both counts recorded).

## Shared Patterns

### CLI script shape (applies to every `tools/*.mjs` file this phase creates)
**Source:** `.claude/skills/acme-build/acme.mjs` lines 1-11, 36, 245-261
```js
#!/usr/bin/env node
import { ... } from "node:fs";
...
const die = (m) => { console.error(`error: ${m}`); process.exit(1); };
...
const [cmd, ...rest] = process.argv.slice(2);
const VERBS = { ... };
if (!cmd || !VERBS[cmd]) { console.log(`usage: ...`); process.exit(cmd ? 1 : 0); }
VERBS[cmd](rest);
```
Apply to: `dump-capture.mjs`, `chip-state.mjs`, `diff-images.mjs`, `d64-parse.mjs`, `hostpath-boot.mjs`.

### Host-path translation (mandatory, security/correctness-critical)
**Source:** `.claude/skills/devcontainer-host-path/hostpath.mjs` (whole file; especially `hostPath()` lines 133-140 and `tryHostPaths()` lines 160-178)
**Apply to:** every call that hands a filesystem path to a host-side `vice_*` tool — `vice_disk_attach`, `vice_autostart`, and (per `.mcp.json`'s single HTTP endpoint `http://host.docker.internal:6510/mcp`) any future path-bearing MCP call this phase adds. Never construct a container-style path directly for these calls.

### `--json` output flag convention
**Source:** `.claude/skills/acme-build/acme.mjs` `parseOpts` (lines 224-243) and `reportBuild` (lines 158-175)
**Apply to:** all `tools/*.mjs` scripts, so downstream phases (2/3/4) can consume Phase 1 tool output programmatically rather than screen-scraping prose.

### Zero-dependency, `node:`-prefixed imports only
**Source:** both `acme.mjs` and `hostpath.mjs` headers; explicitly required by D-18 ("Node, zero install... nothing here needs a package.json dependency" per RESEARCH.md's tooling-layout section)
**Apply to:** all Phase 1 tooling. Do not add a `package.json` dependency for hashing (use `node:crypto`), diffing (use `Buffer.indexOf`), or JSON (use the global `JSON`).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `tools/d64-parse.mjs` | utility | file-I/O/transform | No binary-format parser exists anywhere in this repo; only CLI-shape conventions carry over. |
| `tools/diff-images.mjs`'s core diff/coalesce algorithm | utility | batch | No byte-diffing code exists in this repo; only the "iterate/filter/report kept-vs-dropped" shape from `acme.mjs` transfers. |
| `tools/dump-capture.mjs`'s chunked-read-assemble loop | utility | file-I/O | No file in this repo calls a `vice_*` MCP tool yet; RESEARCH.md's own (not-yet-written) conceptual snippet is the only precedent. |
| `tools/chip-state.mjs`'s VIC-bank/sprite-pointer derivation | utility | transform | Derivation rule is documented in the `c64-memory-mapping` skill's reference tables, not implemented in any working code yet. |
| `recovery/{danish,saeger}/NOTES.md`, `recovery/LOADING.md`, `recovery/PROVENANCE.md`, `recovery/clean/README.md` | doc | — | No `recovery/` tree or comparable Markdown-ledger convention exists; structure is specified directly by CONTEXT.md's D-06/D-08/D-09/D-10/D-11/D-14/D-16, not derived from prior art. |
| `recovery/clean/bruce-lee.bin` + `.map.json` + `-state.json` | data artifact | file-I/O | Schema specified fresh by D-01/D-02/D-03/D-04; no prior binary-artifact-plus-sidecar convention exists in this repo. |

## Metadata

**Analog search scope:** `.claude/skills/acme-build/`, `.claude/skills/devcontainer-host-path/`, `.claude/skills/c64-memory-mapping/`, `.mcp.json`, repo root (confirmed via CONTEXT.md's own greenfield inventory: no `src/`, `tools/`, `recovery/`, `docs/`, `verify/` directories exist yet).
**Files scanned:** `acme.mjs` (262 lines, read in full), `hostpath.mjs` (231 lines, read in full), `driver.mjs` (first 80 lines, header/setup section), `.mcp.json` (full).
**Pattern extraction date:** 2026-07-30
