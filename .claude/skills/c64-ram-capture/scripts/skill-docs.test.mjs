// node:test gate keeping module names out of SKILL.md -- the usage-only
// guide this skill ships instead of a maintainer document.
//
// This is a deliberate COPY of the sibling gate `vice-mcp-selector` ships
// (.claude/skills/vice-mcp-selector/scripts/skill-docs.test.mjs -- originally
// `vice-session`'s, before that skill was retired in plan 01.1-04), not a
// shared helper. Each skill has to carry its own doc-hygiene gate for the skill to
// stay copyable on its own terms -- a gate living in a sibling and reaching
// across directories would make each skill's exportability a lie, the same
// false-copyability trap already corrected once in this repo (260730-u9w).
//
// Enumerating the directory instead of hardcoding a name list is what makes
// a module added later covered the moment it lands on disk, with no test
// file to remember to update.
//
// The gate is ONE-DIRECTIONAL by decision: there is no companion maintainer
// document to cross-check removed names against. A file enumerating module
// names, internal functions and state files IS the internal-mechanics
// disclosure the usage-only split exists to prevent, so none exists here
// either. Rationale for each module lives in that module's own header
// comment, beside the code it explains. Do not add a companion document, a
// "see also", or a pointer to one -- that would silently recreate the
// disclosure this gate exists to prevent.
//
// The entry-point module (`ram-capture.mjs`) is exempt in both directions:
// the usage guide has to give callers an import path, so its name belongs
// there, and a rewrite that dropped it would itself be a regression this
// gate should catch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_MD = join(SCRIPTS_DIR, "..", "SKILL.md");
const ENTRY_POINT = "ram-capture.mjs";

function scriptModules() {
  return readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith(".mjs"))
    .sort();
}

test("scripts/ enumeration is non-empty and anchored on ram-compare.mjs", () => {
  const modules = scriptModules();
  assert.ok(modules.length > 0, "scripts/ enumerated as empty -- glob or path resolution is broken");
  assert.ok(
    modules.includes("ram-compare.mjs"),
    "ram-compare.mjs not found in scripts/ -- the enumeration cannot be trusted if it misses a module known to exist"
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

test("the entry point ram-capture.mjs is still named in SKILL.md", () => {
  const skillMd = readFileSync(SKILL_MD, "utf8");
  assert.ok(
    skillMd.includes(ENTRY_POINT),
    `${ENTRY_POINT} is missing from SKILL.md -- callers need this one command path; a rewrite that ` +
      `dropped it is a regression, not a cleanup.`
  );
});
