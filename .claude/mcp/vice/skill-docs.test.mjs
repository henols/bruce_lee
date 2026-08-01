// node:test gate keeping module names out of SKILL.md -- the usage-only
// guide this skill ships instead of a maintainer document.
//
// This REPLACES a one-shot grep that lived inside a plan file (260730-ryz).
// A check that runs once protects only that run: the next module added to
// this module directory escapes it silently, with nothing anywhere
// signalling that coverage stopped. Enumerating the directory instead of
// hardcoding a name list is what makes that impossible -- a future module is
// covered the moment it lands on disk, with no test file to remember to
// update.
//
// The gate is ONE-DIRECTIONAL by decision. An earlier version of this rule
// had a second half: every name removed from the usage guide had to be
// findable in a maintainer document (INTERNALS.md). That document was
// deleted deliberately (61fa835) -- a file enumerating module names,
// internal functions and state files IS the internal-mechanics disclosure
// the usage-only split exists to prevent. So there is no second document,
// nothing to cross-check names against, and rationale for each module lives
// in that module's own header comment, beside the code it explains. Do not
// add a companion document, a "see also", or a pointer to one -- that would
// silently recreate the disclosure this gate exists to prevent.
//
// INVERTED, plan 01.1-04: this file was relocated here from the now-retired
// `vice-session` skill, whose entry point (`vice.mjs`, a CLI a caller
// invoked from a shell) was exempt from the no-module-names rule in BOTH
// directions -- the usage guide had to give callers a command to run.
// `vice-mcp-selector` has no such exemption and never will: its agent-facing
// surface is `mcp__vice__*` tool calls, not a command, so `SKILL.md` must
// name NO module under this module directory at all -- including `vice.mjs`,
// which is no longer an entry point here, just one library module among many
// that happens to keep its old name. The rule this file enforces is therefore
// now fully one-directional in a second sense too: nothing under this
// directory belongs in `SKILL.md`, full stop. The replacement assertion is that
// `SKILL.md` names the REAL surface instead -- the `mcp__vice__` tool
// prefix -- so a rewrite that dropped that surface is still caught as a
// regression, just anchored on the right thing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// REPOINTED, 2026-08-01. The header above says to retire this gate together
// with vice-mcp-selector/SKILL.md. That SKILL.md is now deleted -- but
// retiring the gate with it would drop a live protection, because the thing
// it guards was never the file, it was the AGENT-FACING DOCUMENTATION of how
// the emulator is reached. That documentation still exists; it just moved.
// So the gate is repointed rather than retired, at every doc that now plays
// that role:
//
//   .claude/CLAUDE.md                        § Emulator Access
//   .claude/skills/c64-ram-capture/SKILL.md  the capture procedure
//
// Both assertions carry over unchanged in meaning: no module under this
// directory may be named in agent-facing docs, and those docs must name the
// real surface (the mcp__vice__ prefix) so a rewrite that drops it is caught.
// Add a doc to this list when a new agent-facing emulator document appears.
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(MODULE_DIR, "..", "..", "..");
const AGENT_DOCS = [
  join(REPO_ROOT, ".claude", "CLAUDE.md"),
  join(REPO_ROOT, ".claude", "skills", "c64-ram-capture", "SKILL.md"),
];
const TOOL_PREFIX = "mcp__vice__";

function scriptModules() {
  return readdirSync(MODULE_DIR)
    .filter((f) => f.endsWith(".mjs"))
    .sort();
}

test("module directory enumeration is non-empty and anchored on vice-sync.mjs", () => {
  const modules = scriptModules();
  assert.ok(modules.length > 0, "module directory enumerated as empty -- glob or path resolution is broken");
  assert.ok(
    modules.includes("vice-sync.mjs"),
    "vice-sync.mjs not found in the module directory -- the enumeration cannot be trusted if it misses a module known to exist"
  );
});

test("no module under this directory is named in any agent-facing doc -- no exemption, not even vice.mjs", () => {
  for (const doc of AGENT_DOCS) {
    const text = readFileSync(doc, "utf8");
    for (const mod of scriptModules()) {
      assert.ok(
        !text.includes(mod),
        `${mod} is named in ${doc} -- agent-facing docs must not leak internal module names. ` +
          `There is no entry-point exemption (agents call mcp__vice__* tools directly, never a ` +
          `module by name) -- remove the reference, or move the rationale into ${mod}'s own header comment.`
      );
    }
  }
});

test("agent-facing docs name the mcp__vice__ tool prefix -- the real surface", () => {
  for (const doc of AGENT_DOCS) {
    const text = readFileSync(doc, "utf8");
    assert.ok(
      text.includes(TOOL_PREFIX),
      `${TOOL_PREFIX} is missing from ${doc} -- callers need to know this is how the emulator is ` +
        `reached; a rewrite that dropped it is a regression, not a cleanup.`
    );
  }
});
