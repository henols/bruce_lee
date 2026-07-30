// node:test gate keeping module names out of SKILL.md -- the usage-only
// guide this skill ships instead of a maintainer document.
//
// This REPLACES a one-shot grep that lived inside a plan file (260730-ryz).
// A check that runs once protects only that run: the next module added to
// scripts/ escapes it silently, with nothing anywhere signalling that
// coverage stopped. Enumerating the directory instead of hardcoding a name
// list is what makes that impossible -- a future module is covered the
// moment it lands on disk, with no test file to remember to update.
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
// The entry-point module (`vice.mjs`) is exempt in both directions: the
// usage guide has to give callers a command to run, so its name belongs
// there, and a rewrite that dropped it would itself be a regression this
// gate should catch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_MD = join(SCRIPTS_DIR, "..", "SKILL.md");
const ENTRY_POINT = "vice.mjs";

function scriptModules() {
  return readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith(".mjs"))
    .sort();
}

test("scripts/ enumeration is non-empty and anchored on vice-sync.mjs", () => {
  const modules = scriptModules();
  assert.ok(modules.length > 0, "scripts/ enumerated as empty -- glob or path resolution is broken");
  assert.ok(
    modules.includes("vice-sync.mjs"),
    "vice-sync.mjs not found in scripts/ -- the enumeration cannot be trusted if it misses a module known to exist"
  );
});

test("no module under scripts/ is named in SKILL.md, except the documented entry point", () => {
  const skillMd = readFileSync(SKILL_MD, "utf8");
  for (const mod of scriptModules()) {
    if (mod === ENTRY_POINT) continue;
    assert.ok(
      !skillMd.includes(mod),
      `${mod} is named in SKILL.md -- the usage-only guide must not leak internal module names. ` +
        `Remove the reference (or move the rationale into ${mod}'s own header comment).`
    );
  }
});

test("the entry point vice.mjs is still named in SKILL.md", () => {
  const skillMd = readFileSync(SKILL_MD, "utf8");
  assert.ok(
    skillMd.includes(ENTRY_POINT),
    `${ENTRY_POINT} is missing from SKILL.md -- callers need this one command path; a rewrite that ` +
      `dropped it is a regression, not a cleanup.`
  );
});
