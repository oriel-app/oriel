import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { folderA, folderB, tempFolder } from "./testing.ts";
import {
  canonicalPath,
  canonicalTime,
  folderKey,
  maxDepth,
  maxEntries,
  maxFileBytes,
  maxFiles,
  maxTotalBytes,
  resolveFolder,
  skipsName,
  unambiguous,
  type FolderPath,
  type Walk,
  walk,
} from "./walk.ts";

async function walkOf(root: FolderPath): Promise<Walk> {
  const scope = await walk(root, folderA);
  assert.ok(typeof scope === "object", `walked, not ${String(scope)}`);
  return scope;
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

test("a key is 16 hex digits of a hash of the folder's ID and the canonical path", () => {
  const key = folderKey(folderA, "notes/plan.md");
  assert.equal(key, sha(`${folderA}\u0000notes/plan.md`).slice(0, 16));
  assert.match(key, /^[0-9a-f]{16}$/);
  // Another folder, another key; another path, another key.
  assert.notEqual(folderKey(folderB, "notes/plan.md"), key);
  assert.notEqual(folderKey(folderA, "notes/Plan.md"), key);
  // The separator keeps the folder ID and the path apart.
  assert.notEqual(folderKey(folderA, "a/b.md"), sha(`${folderA}a/b.md`).slice(0, 16));
});

test("a canonical path is NFC, joined with forward slashes, in the case it was listed", () => {
  const nfc = "café.md".normalize("NFC");
  const nfd = nfc.normalize("NFD");
  assert.notEqual(nfd, nfc);
  assert.equal(canonicalPath(["Notes", nfd]), `Notes/${nfc}`);
  assert.equal(canonicalPath(["Notes", nfc]), `Notes/${nfc}`);
  assert.equal(canonicalPath(["A", "B", "Plan.MD"]), "A/B/Plan.MD");
});

test("a modification time is whole milliseconds in UTC, clamped to four-digit years", () => {
  assert.equal(canonicalTime(1_767_225_600_123.9), "2026-01-01T00:00:00.123Z");
  assert.equal(canonicalTime(-5), "1970-01-01T00:00:00.000Z");
  assert.equal(canonicalTime(Number.NaN), "1970-01-01T00:00:00.000Z");
  assert.equal(canonicalTime(1e20), "9999-12-31T23:59:59.999Z");
});

test("dotfiles, dot-directories, node_modules and undecodable names are skipped by name", () => {
  for (const name of [
    ".env",
    ".git",
    ".obsidian",
    ".draft.md",
    "node_modules",
    `bad${String.fromCodePoint(0xfffd)}.md`,
  ])
    assert.equal(skipsName(name), true, name);
  for (const name of ["plan.md", "node_modules.md", "a.b.md", "notes"])
    assert.equal(skipsName(name), false, name);
});

test("files that share a key are all left out, and counted", () => {
  const skipped = { ambiguous: 0 };
  const files = [{ key: "a" }, { key: "b" }, { key: "a" }, { key: "c" }, { key: "a" }];
  assert.deepEqual(unambiguous(files, skipped), [{ key: "b" }, { key: "c" }]);
  assert.equal(skipped.ambiguous, 3);
});

test("the walk goes no deeper than the depth cap", async (t) => {
  const folder = tempFolder(t);
  const dirs = Array.from({ length: maxDepth + 2 }, (_, i) => `d${i + 1}`);
  folder.write("top.md", "depth 0");
  for (let depth = 1; depth <= dirs.length; depth++)
    folder.write(join(...dirs.slice(0, depth), `at-${depth}.md`), `depth ${depth}`);
  const scope = await walkOf(folder.root);
  const titles = scope.files.map((file) => file.title);
  assert.deepEqual(titles, ["top", ...Array.from({ length: maxDepth }, (_, i) => `at-${i + 1}`)]);
  assert.deepEqual(scope.capped, ["depth"]);
});

test("the walk stops at the file cap, keeping the first files in walk order", async (t) => {
  const folder = tempFolder(t);
  const names = Array.from({ length: maxFiles + 3 }, (_, i) => `n${String(i).padStart(4, "0")}`);
  for (const name of names) writeFileSync(join(folder.root, `${name}.md`), name);
  const scope = await walkOf(folder.root);
  assert.equal(scope.files.length, maxFiles);
  assert.deepEqual(
    scope.files.map((file) => file.title),
    names.slice(0, maxFiles),
  );
  assert.deepEqual(scope.capped, ["files"]);
});

test("the walk stops at the total size; a file over the per-file cap doesn't count", async (t) => {
  const folder = tempFolder(t);
  // Sparse files: sizes without writing the bytes.
  const sized = (name: string, size: number) => {
    const path = folder.write(name, "");
    truncateSync(path, size);
  };
  sized("0-huge.md", maxFileBytes * 4);
  const fit = maxTotalBytes / maxFileBytes;
  for (let i = 0; i < fit; i++) sized(`a${String(i).padStart(3, "0")}.md`, maxFileBytes);
  sized("b-one-byte-too-many.md", 1);
  sized("c-never-reached.md", 1);
  const scope = await walkOf(folder.root);
  assert.equal(scope.files.length, fit + 1);
  assert.deepEqual(
    scope.files.filter((file) => file.tooLarge).map((file) => file.title),
    ["0-huge"],
  );
  assert.equal(
    scope.files.reduce((sum, file) => sum + (file.tooLarge ? 0 : file.size), 0),
    maxTotalBytes,
  );
  assert.ok(
    !scope.files.some((file) => file.title.startsWith("b-") || file.title.startsWith("c-")),
  );
  assert.deepEqual(scope.capped, ["bytes"]);
});

test("the walk stops after looking at its cap of entries, of any kind", async (t) => {
  const folder = tempFolder(t);
  folder.write("first.md", "listed before the cap");
  const crowded = join(folder.root, "crowded");
  mkdirSync(crowded);
  for (let i = 0; i < maxEntries; i++) writeFileSync(join(crowded, `${i}.txt`), "");
  folder.write("crowded2/never.md", "a directory the walk doesn't reach");
  const scope = await walkOf(folder.root);
  assert.deepEqual(
    scope.files.map((file) => file.title),
    ["first"],
  );
  assert.deepEqual(scope.capped, ["entries"]);
});

test("a folder that is missing, isn't a directory, or is reached through a link isn't walked", async (t) => {
  const folder = tempFolder(t);
  const at = (path: string) => walk(path as FolderPath, folderA);
  assert.equal(await at(join(folder.root, "nowhere")), "missing");
  assert.equal(await at(folder.write("file.md", "x")), "missing");
  const link = join(folder.outside, "link");
  symlinkSync(folder.root, link);
  assert.equal(await at(link), "forbidden");
  // A loop of links where the folder was is refused, not thrown.
  const loop = join(folder.outside, "loop");
  symlinkSync(loop, loop);
  assert.equal(await at(loop), "forbidden");
  assert.equal(await resolveFolder(link), folder.root);
  await assert.rejects(resolveFolder(join(folder.root, "file.md")), /isn't a directory/);
});

test("directories and files Oriel may not read are skipped and counted", async (t) => {
  const folder = tempFolder(t);
  folder.write("open.md", "readable");
  const closedFile = folder.write("closed.md", "no read permission");
  const closedDir = join(folder.root, "closed");
  folder.write("closed/inner.md", "in a directory with no permissions");
  const binds = folder.lock(closedDir);
  folder.lock(closedFile);
  if (!binds) {
    t.skip("permissions don't bind here (running as root)");
    return;
  }
  const scope = await walkOf(folder.root);
  assert.deepEqual(
    scope.files.map((file) => file.title),
    ["open"],
  );
  assert.equal(scope.skipped.unreadable, 2);
});

test("a folder that can't be listed isn't walked, rather than walked as empty", async (t) => {
  const folder = tempFolder(t);
  folder.write("plan.md", "plan");
  if (!folder.lock(folder.root)) {
    t.skip("permissions don't bind here (running as root)");
    return;
  }
  assert.equal(await walk(folder.root, folderA), "forbidden");
});
