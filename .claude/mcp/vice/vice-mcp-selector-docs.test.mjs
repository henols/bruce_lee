// node:test gate closing out plan 01.1-04's retirement of the Bash-mediated
// emulator path. Five assertions, all built on directories walked FRESH at
// run time -- no hardcoded file-name array and no hardcoded module-name
// array anywhere in this file -- so a file or module added tomorrow is
// covered the moment it lands on disk, with nothing here to remember to
// update. This is the durable replacement for the one-shot greps that would
// otherwise rot silently the next time someone adds a document or a call
// site.
//
// REPO-ROOT RESOLUTION, DELIBERATELY NOT `repoRoot()` FROM THE SIBLING
// `repo-root.mjs`: that resolver's own documented precedence (see its
// header) checks `CONTAINER_WORKSPACE_PATH` FIRST and returns it whenever
// this file's location resolves inside it -- which, in THIS devcontainer,
// is unconditionally true (`CONTAINER_WORKSPACE_PATH=/workspaces/bruce_lee`)
// regardless of which git worktree is actually executing. A parallel
// executor running inside an isolated worktree nested under
// `.claude/worktrees/<id>/` would have every enumeration in this file
// silently redirected to the SHARED devcontainer mount's main checkout
// instead of the worktree's own tree -- exactly the kind of quiet-wrong-
// answer this project's own conventions reject elsewhere. `findRepoRoot()`
// below is the plain `.git`-marker walk ONLY (no env-var short-circuit), so
// this gate always inspects the tree it is actually running from, worktree
// or not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function findRepoRoot(from) {
  let dir = from;
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`findRepoRoot: no .git ancestor found above ${from}`);
    }
    dir = parent;
  }
}

const REPO_ROOT = findRepoRoot(HERE);
const THIS_FILE = fileURLToPath(import.meta.url);

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Recursive walk, returning absolute paths of every regular file under
 * `dir` matching `predicate(relativePosixPath)`. Missing `dir` is simply
 * "no files" -- several of assertion 2's optional locations (docs/, repo-
 * root .md files) do not exist in this project today, and their absence is
 * not a test-infrastructure error. */
function walkFiles(dir, predicate) {
  if (!isDir(dir)) return [];
  const out = [];
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, dirent.name);
    if (dirent.isDirectory()) {
      out.push(...walkFiles(abs, predicate));
    } else if (dirent.isFile() && predicate(abs)) {
      out.push(abs);
    }
  }
  return out;
}

// ============================================================================
// Assertion 1 -- criterion 2: the wiring is exactly one static entry.
// ============================================================================

test("criterion 2: .mcp.json registers exactly one static, url-less stdio entry named vice", () => {
  const mcpJsonPath = join(REPO_ROOT, ".mcp.json");
  assert.ok(existsSync(mcpJsonPath), `${mcpJsonPath} must exist`);
  const parsed = JSON.parse(readFileSync(mcpJsonPath, "utf8"));

  assert.ok(parsed && typeof parsed === "object" && parsed.mcpServers && typeof parsed.mcpServers === "object");
  const keys = Object.keys(parsed.mcpServers);
  assert.deepEqual(keys, ["vice"], `expected exactly one mcpServers key named "vice", got ${JSON.stringify(keys)}`);

  const entry = parsed.mcpServers.vice;
  assert.ok(
    !Object.prototype.hasOwnProperty.call(entry, "url"),
    "the vice entry must carry no url property -- a url changing invalidates prior project-scope approval; a stdio entry has none to change"
  );
  assert.equal(entry.command, "node", `expected command "node", got ${JSON.stringify(entry.command)}`);
  assert.ok(Array.isArray(entry.args) && entry.args.length === 1, `expected args to be a one-element array, got ${JSON.stringify(entry.args)}`);
  const scriptPath = join(REPO_ROOT, entry.args[0]);
  assert.ok(existsSync(scriptPath), `the vice entry's args[0] (${entry.args[0]}) must resolve to an existing file at ${scriptPath}`);

  // Plan 03 (Criterion 10 scaffold, T-01.6-14): the resolvability check above
  // proves SOME file exists at args[0] -- it does not prove that file is
  // still the proxy entry point rather than some other existing file the
  // path got accidentally repointed at. Tightened with a basename check: the
  // module extensions listed here are exactly what Phase 01.6.1's TypeScript
  // conversion is expected to produce for this entry point (.mjs today; .ts
  // or .mts if the conversion lets Node's native TypeScript stripping run the
  // proxy directly rather than emitting to resources/ first) -- this is not
  // yet decided, so all three are accepted without picking a winner early.
  const basename = entry.args[0].split("/").pop();
  assert.match(
    basename,
    /^vice-proxy\.(mjs|mts|ts)$/,
    `.mcp.json's vice entry resolves to an existing file, but its basename (${basename}) is not the proxy ` +
      "entry point (expected vice-proxy.<mjs|mts|ts>). THIS PATH IS HARDCODED AND READ ONCE, AT SESSION " +
      "START: a move or rename of the proxy that does not update this same path in the same commit costs " +
      "the agent ALL emulator access at the very next session start -- not degraded service, none at all."
  );
});

// ============================================================================
// Assertion 2 -- criterion 8: no document sends an agent to the shell.
// ============================================================================

// The transport module's basename, followed by whitespace and one of the
// emulator-reaching CLI verbs. Deliberately EXCLUDES the resource-deployment
// verb ("install"): it deploys host launcher scripts and touches no
// emulator, tools/README.md legitimately documents it (plan 01.1-04's own
// "programmatic seam" note), and including it in this pattern would force a
// false positive on a document that is doing exactly what it should.
const SHELL_INVOCATION_PATTERN = /vice\.mjs\s+(call|ping|tools|session|pool)\b/;

function enumerateGuardedDocuments() {
  const docs = [];
  // Every SKILL.md under .claude/skills/.
  const skillsDir = join(REPO_ROOT, ".claude", "skills");
  if (isDir(skillsDir)) {
    for (const dirent of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const skillMd = join(skillsDir, dirent.name, "SKILL.md");
      if (isFile(skillMd)) docs.push(skillMd);
    }
  }
  // Every .md under .claude/agents/, if that directory exists.
  docs.push(...walkFiles(join(REPO_ROOT, ".claude", "agents"), (p) => p.endsWith(".md")));
  // .claude/CLAUDE.md.
  const claudeMd = join(REPO_ROOT, ".claude", "CLAUDE.md");
  if (isFile(claudeMd)) docs.push(claudeMd);
  // tools/README.md.
  const toolsReadme = join(REPO_ROOT, "tools", "README.md");
  if (isFile(toolsReadme)) docs.push(toolsReadme);
  // Any .md under docs/, if that directory exists.
  docs.push(...walkFiles(join(REPO_ROOT, "docs"), (p) => p.endsWith(".md")));
  // Any .md at the repo root, if any exist.
  for (const dirent of readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (dirent.isFile() && dirent.name.endsWith(".md")) docs.push(join(REPO_ROOT, dirent.name));
  }
  // Exclude this test file itself (n/a -- it is a .test.mjs, never matched
  // by the .md-only walks above, but excluded explicitly for robustness
  // against a future change to this function) and everything under
  // .planning/, which holds historical records that must stay accurate
  // about what the old path WAS.
  const planningDir = join(REPO_ROOT, ".planning");
  return docs.filter((p) => p !== THIS_FILE && !p.startsWith(planningDir + sep));
}

test("criterion 8: no enumerated document instructs an agent to invoke the transport module from a shell", () => {
  const docs = enumerateGuardedDocuments();
  assert.ok(docs.length > 0, "document enumeration returned nothing -- path resolution is broken, not a real pass");
  for (const doc of docs) {
    const text = readFileSync(doc, "utf8");
    assert.ok(
      !SHELL_INVOCATION_PATTERN.test(text),
      `${relative(REPO_ROOT, doc)} matches the forbidden shell-invocation pattern (vice.mjs <call|ping|tools|session|pool>) -- ` +
        `mcp__vice__* tool calls are the only route to the emulator; remove the shell-invocation instruction.`
    );
  }
});

// ============================================================================
// Assertion 3 -- criterion 8: the old skill is gone and nothing imports from it.
// ============================================================================

function enumerateModules() {
  return [
    ...walkFiles(join(REPO_ROOT, ".claude", "skills"), (p) => p.endsWith(".mjs")),
    // quick-260731-p8a: the vice MCP implementation relocated out of the
    // skills tree into this new, non-skill directory. Without this line the
    // relocated modules would fall outside every enumeration below, silently
    // vacating criterion 9's hostpath-consumer closure and the vice-session
    // import ban -- a security control that would pass while enforcing
    // nothing on the modules it used to cover.
    ...walkFiles(join(REPO_ROOT, ".claude", "mcp"), (p) => p.endsWith(".mjs")),
    ...walkFiles(join(REPO_ROOT, "tools"), (p) => p.endsWith(".mjs")),
  ];
}

test("criterion 8: .claude/skills/vice-session no longer exists, and no .mjs anywhere names it in an import specifier", () => {
  assert.ok(!existsSync(join(REPO_ROOT, ".claude", "skills", "vice-session")), ".claude/skills/vice-session must not exist");

  const importSpecifierPattern = /from\s+["']([^"']+)["']/g;
  const modules = enumerateModules();
  assert.ok(modules.length > 0, "module enumeration returned nothing -- path resolution is broken, not a real pass");
  for (const mod of modules) {
    const text = readFileSync(mod, "utf8");
    for (const match of text.matchAll(importSpecifierPattern)) {
      assert.ok(
        !match[1].includes("vice-session"),
        `${relative(REPO_ROOT, mod)} imports from a specifier naming the retired vice-session skill (${match[1]})`
      );
    }
  }
});

// ============================================================================
// Assertion 4 -- criterion 9's caller-side half: the host-path consumer set
// is closed.
// ============================================================================

// PRODUCTION modules only (excludes *.test.mjs). vice-proxy.test.mjs also
// imports hostPath() -- but to independently compute the EXPECTED translated
// value its own assertions check the real proxy against, not to hand-
// translate a path it then forwards to VICE. That is a different concern
// from criterion 9's ("a caller that hand-translates a host path instead of
// going through the proxy's own translation seam"). Test files are excluded
// from this enumeration for that reason, recorded here rather than silently.
//
// 2026-08-01: the set shrank from five to FOUR. ram-capture.mjs was deleted
// with the c64-ram-capture skill's scripts, and the tools/recover.mjs
// pipeline that two of the recorded reasons cited was deleted as legacy --
// both because they reached the emulator outside the mcp__vice__* tools,
// which is now prohibited outright. hostpath.mjs and containerpath.mjs also
// moved here from .claude/skills/devcontainer-host-path/scripts/, so every
// consumer's specifier is now a bare same-directory one; importsHostpath()
// already handled that shape (see its note below) and needed no change.
const HOSTPATH_ALLOW_LIST = {
  "install-resources.mjs": "prints a host path for a human to type; never hands a path to VICE",
  // Reason rewritten 2026-08-01: this used to be justified as "reachable only
  // through the standalone tools/recover.mjs pipeline criterion 8 preserves".
  // That pipeline no longer exists, so the old reason justified nothing. What
  // keeps this entry legitimate now is narrower and worth stating plainly:
  // screenshot() names a host-side destination file for VICE to write, which
  // is the translation seam's own job, not a caller working around it.
  "vice-sync.mjs": "screenshot() names a host-side destination for VICE to write; translation is the point of the call, not a bypass of it",
  "vice-proxy.mjs": "owns translation for the MCP-mediated path",
  // Quick task 260801-ccn: the host->container INVERSE seam. It lives
  // beside hostpath.mjs (D-7) and consumes the sibling's own candidate
  // derivation (hostPathCandidates()) rather than hand-translating a host
  // path itself -- it IS the inverse direction, not a caller working around
  // the proxy's own translation seam.
  "containerpath.mjs": "the inverse seam beside hostpath.mjs; consumes hostPathCandidates() rather than hand-translating anything",
};

const importSpecifierPattern = /from\s+["']([^"']+)["']/g;

/** True iff `text` contains an actual import STATEMENT naming hostpath.mjs
 * -- not merely a substring match, which would also fire on hostpath.mjs's
 * own header prose (naming its own path) and on any comment that mentions
 * the module by path without importing it (e.g. repo-root.mjs's header,
 * which cites hostpath.mjs's import shape as a rationale for its own last-
 * resort fallback depth, without importing it itself).
 *
 * BROADENED (quick-260801-ccn) beyond the original full-path substring
 * check: containerpath.mjs lives IN THE SAME DIRECTORY as hostpath.mjs
 * (D-7), so its own import is a bare same-directory specifier
 * (`"./hostpath.mjs"`), which the original check -- looking only for the
 * `devcontainer-host-path/scripts/hostpath.mjs` substring every OTHER
 * consumer's longer relative path carries -- would never match. Without
 * this widening, containerpath.mjs would silently sit outside the closed
 * consumer set: a control that passes while enforcing nothing, exactly the
 * failure class this test exists to prevent. */
function importsHostpath(text) {
  for (const match of text.matchAll(importSpecifierPattern)) {
    const specifier = match[1];
    if (specifier.includes("devcontainer-host-path/scripts/hostpath.mjs")) return true;
    if (specifier === "./hostpath.mjs" || specifier.endsWith("/hostpath.mjs")) return true;
  }
  return false;
}

test("importsHostpath() classifies a bare same-directory sibling specifier as an import", () => {
  assert.ok(
    importsHostpath('import { hostPathCandidates } from "./hostpath.mjs";'),
    "a bare './hostpath.mjs' specifier (containerpath.mjs's own shape) must be classified as an import"
  );
  assert.ok(
    importsHostpath('import { hostPath } from "../../skills/devcontainer-host-path/scripts/hostpath.mjs";'),
    "the original full-path specifier shape must still be classified as an import"
  );
  assert.ok(
    !importsHostpath('// mentions hostpath.mjs in prose, imports nothing'),
    "prose merely naming hostpath.mjs (no import statement) must NOT be classified as an import"
  );
});

test("criterion 9 (caller-side): exactly the traced four production modules import hostpath.mjs, each with a recorded reason", () => {
  const modules = enumerateModules().filter((p) => !p.endsWith(".test.mjs"));
  const importers = modules.filter((p) => importsHostpath(readFileSync(p, "utf8")));
  const basenames = importers.map((p) => p.split(sep).pop()).sort();
  const expected = Object.keys(HOSTPATH_ALLOW_LIST).sort();
  assert.deepEqual(
    basenames,
    expected,
    `hostpath.mjs consumer set changed -- expected exactly ${JSON.stringify(expected)}, got ${JSON.stringify(basenames)}. ` +
      "A new consumer must be justified by amending HOSTPATH_ALLOW_LIST in this test, not silently allowed through."
  );
});

// ============================================================================
// Assertion 5 -- the skills table is current.
// ============================================================================

// REWRITTEN 2026-08-01. This asserted that CLAUDE.md's skills table names
// vice-mcp-selector. That skill is deleted -- it was prose wrapped around a
// tool surface the agent already holds typed schemas for, so it added a layer
// to read instead of tools to call. The invariant underneath was never "this
// row exists"; it was "CLAUDE.md tells an agent how to reach the emulator,
// and names no retired route". That is what is asserted now.
test("CLAUDE.md states the emulator route and names no retired skill", () => {
  const claudeMd = join(REPO_ROOT, ".claude", "CLAUDE.md");
  assert.ok(existsSync(claudeMd), `${claudeMd} must exist`);
  const text = readFileSync(claudeMd, "utf8");
  assert.ok(
    text.includes("mcp__vice__"),
    "CLAUDE.md must name the mcp__vice__ tool surface as the route to the emulator"
  );
  for (const retired of ["vice-session", "vice-mcp-selector", "spike-findings-bruce-lee", "devcontainer-host-path"]) {
    assert.ok(!text.includes(retired), `CLAUDE.md must not name the retired ${retired} skill`);
  }
});

// ============================================================================
// Assertion 6 -- 01.2-05/criterion 12: the skill describes the per-session
// broker route. A stable, meaning-bearing phrase rather than the section
// heading alone, so a future rewrite that drops the guidance (rather than
// merely rewording the heading) fails this test.
// ============================================================================

// REPOINTED 2026-08-01, same reason as assertion 5: the guidance outlived the
// file. vice-mcp-selector/SKILL.md is deleted, so criterion 12's requirement
// now rests on CLAUDE.md § Emulator Access, the doc that replaced it.
test("01.2-05: CLAUDE.md describes per-session boot-fresh emulator access granted on first use", () => {
  const claudeMd = join(REPO_ROOT, ".claude", "CLAUDE.md");
  assert.ok(existsSync(claudeMd), `${claudeMd} must exist`);
  const text = readFileSync(claudeMd, "utf8");
  assert.ok(
    text.includes("granted on that session's first forwarded tool call"),
    "CLAUDE.md must describe emulator access as granted on the session's first forwarded tool call -- " +
      "this is the per-session broker route added in Phase 01.2 (criterion 12); a rewrite that drops this guidance must fail here."
  );
});
