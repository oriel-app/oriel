// Git can't store hard links, and a committed link out of the repo is a hazard, so links
// and hard links are made here, never committed.
import {
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix } from "node:path";
import {
  array,
  type Infer,
  type Issue,
  isInstant,
  literal,
  number,
  object,
  optional,
  refine,
  type Result,
  string,
  union,
} from "@oriel/core";

export const folderFixtureFile = new URL("../../../fixtures/folder/tree.json", import.meta.url);

const instant = refine(string, isInstant, "expected a canonical instant");

const relativePath = refine(
  string,
  (path) =>
    path !== "" &&
    !path.startsWith("/") &&
    path.split("/").every((name) => name !== "" && name !== "." && name !== ".."),
  "expected a relative path with no empty, . or .. names",
);

const fixtureFile = refine(
  object({
    path: relativePath,
    mtime: instant,
    text: optional(string),
    latin1: optional(string),
    size: optional(refine(number, (n) => Number.isInteger(n) && n >= 0, "expected a whole number")),
  }),
  (file) => [file.text, file.latin1, file.size].filter((v) => v !== undefined).length === 1,
  "expected exactly one of text, latin1 and size",
);

const fixtureLink = object({
  path: relativePath,
  to: string,
  directory: optional(literal(true)),
});

const fixtureHardLink = object({ path: relativePath, to: relativePath });

const folderEdit = union(
  object({ kind: literal("delete"), path: relativePath }),
  object({ kind: literal("rename"), from: relativePath, to: relativePath }),
  object({ kind: literal("touch"), path: relativePath, mtime: instant }),
);

const folderFixtureShape = object({
  files: array(fixtureFile),
  skipped: array(fixtureFile),
  links: array(fixtureLink),
  hardLinks: array(fixtureHardLink),
  outside: array(fixtureFile),
  edits: array(folderEdit),
});

export type FixtureFile = Infer<typeof fixtureFile>;
export type FolderEdit = Infer<typeof folderEdit>;
export type FolderFixture = Infer<typeof folderFixtureShape>;

export function parseFolderFixture(input: unknown): Result<FolderFixture> {
  const shaped = folderFixtureShape(input);
  if (!shaped.ok) return shaped;
  const fixture = shaped.value;
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const inFolder = [
    ...fixture.files.map((f, i) => ({ path: f.path, at: `$.files[${i}].path` })),
    ...fixture.skipped.map((f, i) => ({ path: f.path, at: `$.skipped[${i}].path` })),
    ...fixture.links.map((l, i) => ({ path: l.path, at: `$.links[${i}].path` })),
    ...fixture.hardLinks.map((l, i) => ({ path: l.path, at: `$.hardLinks[${i}].path` })),
  ];
  for (const { path, at } of inFolder) {
    if (seen.has(path)) issues.push({ path: at, message: `${path} is listed twice` });
    seen.add(path);
  }
  const files = new Set(fixture.files.map((f) => f.path));
  fixture.hardLinks.forEach((l, i) => {
    if (!files.has(l.to))
      issues.push({ path: `$.hardLinks[${i}].to`, message: `${l.to} isn't one of the files` });
  });
  const folded = diskDependent(fixture);
  const linked = new Set(fixture.hardLinks.map((l) => l.to));
  fixture.edits.forEach((edit, i) => {
    const named = edit.kind === "rename" ? edit.from : edit.path;
    const at = `$.edits[${i}]`;
    if (!files.has(named))
      issues.push({ path: at, message: `${named} isn't one of the files by this edit` });
    if (folded.has(named))
      issues.push({ path: at, message: `${named} may not exist: it depends on the disk` });
    if (linked.has(named))
      issues.push({ path: at, message: `${named} is hard-linked, so the source never lists it` });
    if (edit.kind === "delete") files.delete(edit.path);
    if (edit.kind !== "rename") return;
    files.delete(edit.from);
    if (seen.has(edit.to) || files.has(edit.to))
      issues.push({ path: `${at}.to`, message: `${edit.to} is taken` });
    files.add(edit.to);
  });
  return issues.length ? { ok: false, issues } : shaped;
}

export function loadFolderFixture(file: URL = folderFixtureFile): FolderFixture {
  const result = parseFolderFixture(JSON.parse(readFileSync(file, "utf8")));
  if (result.ok) return result.value;
  const issues = result.issues.map((issue) => `${issue.path}: ${issue.message}`);
  throw new Error(`invalid folder fixture:\n${issues.join("\n")}`);
}

const folding = (path: string) => path.normalize("NFC").toLowerCase();

// A disk that folds case or normalization keeps one of each pair; one that folds neither
// keeps both, and the folder source then refuses names differing only in normalization.
export function diskDependent(fixture: Pick<FolderFixture, "files">): Set<string> {
  const counts = new Map<string, number>();
  for (const { path } of fixture.files)
    counts.set(folding(path), (counts.get(folding(path)) ?? 0) + 1);
  return new Set(
    fixture.files.map((f) => f.path).filter((path) => (counts.get(folding(path)) ?? 0) > 1),
  );
}

export function filesAfter(fixture: FolderFixture, edited: number): Map<string, FixtureFile> {
  const files = new Map(fixture.files.map((f) => [f.path, f]));
  for (const edit of fixture.edits.slice(0, edited)) {
    if (edit.kind === "delete") files.delete(edit.path);
    if (edit.kind === "touch") {
      const file = files.get(edit.path);
      if (file) files.set(edit.path, { ...file, mtime: edit.mtime });
    }
    if (edit.kind !== "rename") continue;
    const file = files.get(edit.from);
    files.delete(edit.from);
    if (file) files.set(edit.to, { ...file, path: edit.to });
  }
  return files;
}

export type BuiltFolder = {
  root: string;
  outside: string;
  folded: string[];
};

const setTime = (path: string, at: string) => {
  const time = new Date(at);
  utimesSync(path, time, time);
};

const codeOf = (error: unknown) => String((error as { code?: unknown } | null)?.code ?? "");

function writeFile(base: string, file: FixtureFile): boolean {
  const path = join(base, ...file.path.split("/"));
  mkdirSync(dirname(path), { recursive: true });
  const bytes = file.latin1 !== undefined ? Buffer.from(file.latin1, "latin1") : (file.text ?? "");
  try {
    writeFileSync(path, bytes, { flag: "wx" });
  } catch (error) {
    if (codeOf(error) === "EEXIST") return false;
    throw error;
  }
  if (file.size !== undefined) truncateSync(path, file.size);
  setTime(path, file.mtime);
  return true;
}

export function buildFolder(fixture: FolderFixture, dir: string, edited = 0): BuiltFolder {
  if (edited < 0 || edited > fixture.edits.length)
    throw new RangeError(`the folder fixture has ${fixture.edits.length} edits, not ${edited}`);
  const top = realpathSync(dir);
  const root = join(top, "folder");
  const outside = join(top, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  const at = (path: string) => join(root, ...path.split("/"));
  const folded: string[] = [];
  for (const file of fixture.files) if (!writeFile(root, file)) folded.push(file.path);
  for (const file of fixture.skipped)
    if (!writeFile(root, file)) throw new Error(`${file.path}: the disk already holds it`);
  for (const file of fixture.outside)
    if (!writeFile(outside, file)) throw new Error(`${file.path}: the disk already holds it`);
  for (const link of fixture.links) {
    const path = at(link.path);
    mkdirSync(dirname(path), { recursive: true });
    if (link.directory) mkdirSync(join(dirname(path), ...link.to.split("/")), { recursive: true });
    symlinkSync(link.to, path);
  }
  for (const link of fixture.hardLinks) linkSync(at(link.to), at(link.path));
  for (const edit of fixture.edits.slice(0, edited)) {
    if (edit.kind === "delete") rmSync(at(edit.path));
    if (edit.kind === "rename") renameSync(at(edit.from), at(edit.to));
    if (edit.kind === "touch") setTime(at(edit.path), edit.mtime);
  }
  return { root, outside, folded };
}

export const fileTitle = (path: string) =>
  posix.basename(path).normalize("NFC").replace(/\.md$/i, "");
