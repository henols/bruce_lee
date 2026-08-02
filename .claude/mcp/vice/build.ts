// build.ts
//
// Compiles the host-bound TypeScript sources (today: vice-broker.mts only --
// see tsconfig.build.json's `include`, which IS the definition of host-bound)
// into banner-marked, committed JavaScript under resources/. Run directly as
// `node build.ts` (native type stripping, no tsc needed to run THIS file --
// only to run the compiler it shells out to).
//
// This file itself must stay inside erasableSyntaxOnly's restrictions (no
// enum/namespace/constructor parameter properties) so it can run unflagged
// under bare `node`, exactly like vice-broker.mts.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The literal expected emitted relative paths -- today exactly the one
 * broker artifact. This list IS the host-bound artifact set: build() asserts
 * the emitted file set equals this exactly, so an unexpected addition or a
 * silent omission both fail loudly rather than deploying something nobody
 * reviewed. */
export const HOST_BOUND_ARTIFACTS: string[] = ["vice-broker.mjs"];

/** The generated-file banner (01.6-RESEARCH.md §F), a function of the
 * source's relative path. Prepended to every emitted file by build() below --
 * this is the ONLY place that produces this text, so a sync test built
 * against the same build() entry point can never observe a second,
 * independently-drifted banner implementation. */
export function GENERATED_BANNER(relSourcePath: string): string {
  return (
    "// GENERATED FILE -- DO NOT EDIT.\n" +
    `// Compiled by \`tsc\` from ${relSourcePath}. Edit the TypeScript source and rebuild;\n` +
    "// changes made directly to this file are silently overwritten by the next build, and are never\n" +
    "// deployed to the host on their own -- install-resources.mjs copies THIS file's on-disk contents\n" +
    "// verbatim to tools/, so an edit made only here reaches the host but is lost on the very next\n" +
    "// rebuild.\n"
  );
}

/** Recursive walk of `dir`, returning every `.mjs` file's relative (posix,
 * "/"-joined) path underneath it. Mirrors install-resources.mjs's own walk()
 * shape -- a real directory listing, not a hardcoded list. */
function emittedMjsFilesUnder(dir: string, base = ""): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${dirent.name}` : dirent.name;
    const abs = join(dir, dirent.name);
    if (dirent.isDirectory()) {
      out.push(...emittedMjsFilesUnder(abs, rel));
    } else if (dirent.isFile() && dirent.name.endsWith(".mjs")) {
      out.push(rel);
    }
  }
  return out.sort();
}

/** Maps an emitted `.mjs` relative path back to the `.mts` source path the
 * banner should name -- the only mapping this build knows (rootDir "." means
 * emitted layout mirrors source layout 1:1, with the .mts->.mjs extension
 * swap tsc performs automatically for module: nodenext). */
function sourceRelForEmitted(emittedRel: string): string {
  return emittedRel.replace(/\.mjs$/, ".mts");
}

export interface BuildOptions {
  outDir?: string;
}

/**
 * Runs the pinned compiler against tsconfig.build.json with its out
 * directory overridden to `outDir` (default "resources", relative to this
 * module's own directory or an absolute path), asserts the emitted file set
 * is EXACTLY HOST_BOUND_ARTIFACTS (catches both a missing artifact and an
 * unexpected one), then prepends the generated-file banner to each. Fails
 * loudly, with the actual emitted file list, when the assertion fails.
 *
 * Takes an --out-dir-shaped option rather than always writing to
 * resources/, so the sync test can build into a scratch directory through
 * this EXACT code path -- the banner must never exist in two
 * implementations.
 */
export function build({ outDir = "resources" }: BuildOptions = {}): void {
  const outDirAbs = resolvePath(outDir).startsWith("/") && outDir.startsWith("/") ? outDir : join(HERE, outDir);
  mkdirSync(outDirAbs, { recursive: true });

  const tscBin = join(HERE, "node_modules", ".bin", "tsc");
  execFileSync(tscBin, ["-p", join(HERE, "tsconfig.build.json"), "--outDir", outDirAbs], {
    cwd: HERE,
    stdio: "inherit",
  });

  const emitted = emittedMjsFilesUnder(outDirAbs);
  const expected = [...HOST_BOUND_ARTIFACTS].sort();
  const missing = expected.filter((f) => !emitted.includes(f));
  const unexpected = emitted.filter((f) => !expected.includes(f));

  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      "build: emitted file set does not match HOST_BOUND_ARTIFACTS.\n" +
        `  expected:   ${JSON.stringify(expected)}\n` +
        `  emitted:    ${JSON.stringify(emitted)}\n` +
        `  missing:    ${JSON.stringify(missing)}\n` +
        `  unexpected: ${JSON.stringify(unexpected)}`
    );
  }

  for (const rel of HOST_BOUND_ARTIFACTS) {
    const target = join(outDirAbs, rel);
    const banner = GENERATED_BANNER(sourceRelForEmitted(rel));
    const content = readFileSync(target, "utf8");
    if (!content.startsWith(banner)) {
      writeFileSync(target, banner + content);
    }
  }
}

// -------------------------------------------------------------------- CLI
function parseCliArgs(argv: string[]): BuildOptions {
  let outDir: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out-dir") {
      outDir = argv[i + 1];
      i++;
    }
  }
  return outDir ? { outDir } : {};
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseCliArgs(process.argv.slice(2));
  try {
    build(opts);
    const outDirAbs = opts.outDir ? (opts.outDir.startsWith("/") ? opts.outDir : join(HERE, opts.outDir)) : join(HERE, "resources");
    process.stderr.write(`build: wrote ${HOST_BOUND_ARTIFACTS.length} artifact(s) to ${outDirAbs}\n`);
  } catch (e) {
    process.stderr.write(`build: FAILED -- ${(e as Error).message}\n`);
    process.exitCode = 1;
  }
}
