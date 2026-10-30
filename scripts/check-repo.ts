// Repo invariants: CLAUDE.md is a symlink to AGENTS.md; every locked package
// comes from the npm registry, is on the AGENTS.md allowlist, and is listed on
// an ADR's `Adds:` line; outside packages/changeset, no code names
// `Approved` or `SourceWriter` (core defines them); and nothing but
// packages/changeset/src/writers.ts, which builds every writer, imports a
// writer by any path. An adapter's own `src/writer.ts` and its test are the
// exceptions; the test may stand in for an approval, which nothing else may
// (decision 0003). And no package imports a source adapter except the
// adapter itself, the composition root (packages/server), the eval harness
// (packages/evals) and tests: other packages get a source's behaviour as
// declarations typed by core (decision 0019). A writer import is refused by
// both rules, wherever 0003 refuses it. Packages reach each other only
// through `@oriel/<name>` and its declared exports, never a relative path into
// another package; a relative path into scripts/ (the fixture tooling) is
// fine.
import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import { posix } from "node:path";
import { sourceKinds } from "../packages/core/src/ids.ts";

// `name@version` keys from every top-level `packages:` block.
export function lockedPackages(lockfile: string): string[] {
  const keys = new Set<string>();
  let inPackages = false;
  for (const line of lockfile.replaceAll("\r\n", "\n").split("\n")) {
    if (/^\S/.test(line)) {
      inPackages = line === "packages:";
      continue;
    }
    if (inPackages && /^ {2}\S.*:$/.test(line))
      keys.add(line.trim().slice(0, -1).replaceAll("'", ""));
  }
  return [...keys].sort();
}

export function allowlist(agentsMd: string): string[] {
  const section = agentsMd.split(/^## Dependencies.*$/m)[1]?.split(/^## /m)[0] ?? "";
  return backticked(section);
}

export function adrAdds(adr: string): string[] {
  return [...adr.matchAll(/^Adds: (.*)$/gm)].flatMap((m) => backticked(m[1] ?? ""));
}

function backticked(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "");
}

const adapters: readonly string[] = sourceKinds;

// The one file that builds writers, and an adapter's own writer and its test:
// `packages/<kind>/src/writer.ts` for a kind in core's source kinds only.
const writersFile = "packages/changeset/src/writers.ts";
const ownWriterFile = new RegExp(
  `^packages/(?:${sourceKinds.join("|")})/src/writer(?:\\.test)?\\.ts$`,
);

// A specifier: a quoted string, or a template literal in `import(…)`, the one
// place a template literal can name a module, so long as it has no `${…}`,
// which can't be read without running the code. (Elsewhere, backticks are
// code in a comment.)
const open = "(?:[\"']|\\bimport\\s*\\(\\s*`)";
const inside = "[^\"'`\\s$]";
const close = "[\"'`]";
const writerImport = new RegExp(`${open}${inside}*/writer(?:\\.ts)?${close}`);
const packageSpecifier = new RegExp(`${open}@oriel/([a-z0-9-]+)(/${inside}*)?${close}`, "g");
const relativeSpecifier = new RegExp(`${open}(\\.{1,2}/${inside}*)${close}`, "g");

// The source adapters a file imports: an `@oriel/<kind>` specifier, with or
// without a subpath, or a relative path into `packages/<kind>/`, for each
// `<kind>` in core's source kinds, and whether the import is its writer.
export function importedAdapters(path: string, text: string): { kind: string; writer: boolean }[] {
  const found = new Map<string, { kind: string; writer: boolean }>();
  const add = (kind: string, target: string) => {
    const writer = /\/writer(\.ts)?$/.test(target);
    if (adapters.includes(kind)) found.set(`${kind} ${writer}`, { kind, writer });
  };
  for (const [, kind = "", sub = ""] of text.matchAll(packageSpecifier)) add(kind, sub);
  for (const [, relative = ""] of text.matchAll(relativeSpecifier)) {
    const resolved = posix.normalize(posix.join(posix.dirname(path), relative));
    add(/^packages\/([^/]+)\//.exec(resolved)?.[1] ?? "", resolved);
  }
  return [...found.values()];
}

// Where a source adapter may be imported from: its own package, the
// composition root, the eval harness, and tests and their support files. Its
// writer, only where decision 0003 allows: the file that builds writers, and
// the adapter's own writer and its test.
function mayImportAdapter(path: string, kind: string, writer: boolean): boolean {
  if (writer)
    return (
      path === writersFile || (path.startsWith(`packages/${kind}/`) && ownWriterFile.test(path))
    );
  if (path.startsWith(`packages/${kind}/`)) return true;
  if (path.startsWith("packages/server/") || path.startsWith("packages/evals/")) return true;
  return /(?:^|\/)(?:testing|[^/]+\.test)\.tsx?$/.test(path);
}

// Relative specifiers in import syntax: `from "…"`, `import "…"` and
// `import("…")`. Other strings that look like paths aren't imports.
const relativeImports = new RegExp(
  `(?:\\bfrom|\\bimport)\\s*\\(?\\s*["'\`](\\.{1,2}/${inside}*)${close}`,
  "g",
);

// The other packages a file under packages/ imports by a relative path.
export function crossPackageImports(path: string, text: string): string[] {
  const own = /^packages\/([^/]+)\//.exec(path)?.[1];
  if (!own) return [];
  const found = new Set<string>();
  for (const [, relative = ""] of text.matchAll(relativeImports)) {
    const resolved = posix.normalize(posix.join(posix.dirname(path), relative));
    const other = /^packages\/([^/]+)(?:\/|$)/.exec(resolved)?.[1];
    if (other !== undefined && other !== own) found.add(other);
  }
  return [...found];
}

export function matches(name: string, entry: string): boolean {
  if (entry.endsWith("*")) return name.startsWith(entry.slice(0, -1));
  return name === entry;
}

export function problems(repo: {
  claudeLink: string;
  lockfile: string;
  agentsMd: string;
  decisions: string[];
  sources: { path: string; text: string }[];
}): string[] {
  const found = new Set<string>();
  for (const { path, text } of repo.sources) {
    const changeset = path.startsWith("packages/changeset/");
    const core = path.startsWith("packages/core/");
    const ownWriter = ownWriterFile.test(path);
    if (!changeset && !core && /\bApproved\b/.test(text)) {
      found.add(
        `${path}: names Approved outside packages/core and packages/changeset (decision 0003)`,
      );
    }
    if (!changeset && !core && !ownWriter && /\bSourceWriter\b/.test(text)) {
      found.add(
        `${path}: names SourceWriter outside packages/core, packages/changeset and an adapter's writer (decision 0003)`,
      );
    }
    if (path !== writersFile && !ownWriter && writerImport.test(text)) {
      found.add(`${path}: imports a source writer outside ${writersFile} (decision 0003)`);
    }
    if (!path.startsWith("packages/")) continue;
    for (const { kind, writer } of importedAdapters(path, text)) {
      if (mayImportAdapter(path, kind, writer)) continue;
      found.add(
        writer
          ? `${path}: imports the ${kind} writer; only ${writersFile} builds writers (decisions 0003 and 0019)`
          : `${path}: imports the ${kind} adapter; outside packages/${kind}, packages/server, packages/evals and tests, take its declarations from the composition root (decision 0019)`,
      );
    }
    for (const other of crossPackageImports(path, text))
      found.add(
        `${path}: imports packages/${other} by a relative path; packages reach each other only through @oriel/${other} and its exports`,
      );
  }
  if (repo.claudeLink !== "AGENTS.md") {
    found.add(
      `CLAUDE.md must be a symlink to exactly "AGENTS.md", got ${JSON.stringify(repo.claudeLink)}`,
    );
  }
  const keys = lockedPackages(repo.lockfile);
  if (keys.length === 0 && /^\s+specifier:/m.test(repo.lockfile)) {
    found.add("pnpm-lock.yaml: declares dependencies but no packages could be read");
  }
  const allowed = allowlist(repo.agentsMd);
  const added = new Set(repo.decisions.flatMap(adrAdds));
  for (const key of keys) {
    const at = key.indexOf("@", 1);
    const name = key.slice(0, at);
    if (!/^\d+\.\d+\.\d+/.test(key.slice(at + 1))) {
      found.add(`${key}: not from the npm registry`);
      continue;
    }
    const entry = allowed.find((e) => matches(name, e));
    if (!entry) {
      found.add(`${name}: not on the AGENTS.md dependency allowlist`);
      continue;
    }
    if (!added.has(entry)) found.add(`${entry}: no ADR lists it on an \`Adds:\` line`);
  }
  return [...found];
}

function readLink(path: string): string {
  try {
    return readlinkSync(path);
  } catch {
    return "(not a symlink)";
  }
}

if (import.meta.main) {
  const found = problems({
    claudeLink: readLink("CLAUDE.md"),
    lockfile: readFileSync("pnpm-lock.yaml", "utf8"),
    agentsMd: readFileSync("AGENTS.md", "utf8"),
    decisions: readdirSync("docs/decisions")
      .filter((f) => f.endsWith(".md"))
      .map((f) => readFileSync(`docs/decisions/${f}`, "utf8")),
    // This check and its test spell out what they catch, so neither is scanned.
    sources: ["packages", "scripts"]
      .flatMap((dir) =>
        readdirSync(dir, { recursive: true, encoding: "utf8" }).map((f) => `${dir}/${f}`),
      )
      .filter((f) => /\.tsx?$/.test(f) && !f.split("/").includes("node_modules"))
      .filter((f) => !/^scripts\/check-repo(\.test)?\.ts$/.test(f))
      .map((path) => ({ path, text: readFileSync(path, "utf8") })),
  });
  for (const p of found) console.error(p);
  process.exitCode = found.length ? 1 : 0;
}
