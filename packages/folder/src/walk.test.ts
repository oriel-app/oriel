import assert from "node:assert/strict";
import { mkdirSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { folderA, tempFolder } from "./testing.ts";
import {
  canonicalPath,
  maxEntries,
  maxFileBytes,
  maxTotalBytes,
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

test("a canonical path is NFC, joined with forward slashes, in the case it was listed", () => {
  const nfc = "café.md".normalize("NFC");
  const nfd = nfc.normalize("NFD");
  assert.notEqual(nfd, nfc);
  assert.equal(canonicalPath(["Notes", nfd]), `Notes/${nfc}`);
  assert.equal(canonicalPath(["Notes", nfc]), `Notes/${nfc}`);
  assert.equal(canonicalPath(["A", "B", "Plan.MD"]), "A/B/Plan.MD");
});

test("files that share a key are all left out, and counted", () => {
  const skipped = { ambiguous: 0 };
  const files = [{ key: "a" }, { key: "b" }, { key: "a" }, { key: "c" }, { key: "a" }];
  assert.deepEqual(unambiguous(files, skipped), [{ key: "b" }, { key: "c" }]);
  assert.equal(skipped.ambiguous, 3);
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
