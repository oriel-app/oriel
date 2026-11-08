// Races between the walk and the open, made deterministic: each test walks,
// then changes the folder, then opens what the walk saw.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  linkSync,
  lstatSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { isSystemFailure } from "./nofollow.ts";
import { openEntry } from "./open.ts";
import { folderA, tempFolder } from "./testing.ts";
import { type FileEntry, type FolderPath, maxFileBytes, walk } from "./walk.ts";

async function walked(root: FolderPath, title: string): Promise<FileEntry> {
  const scope = await walk(root, folderA);
  const entry =
    typeof scope === "object" ? scope.files.find((file) => file.title === title) : undefined;
  assert.ok(entry, `the walk found ${title}`);
  return entry;
}

test("a file replaced by a link after the walk is refused, wherever the link points", async (t) => {
  const folder = tempFolder(t);
  const secret = folder.write("secret.md", "outside the folder", undefined, folder.outside);
  const path = folder.write("plan.md", "inside");
  const twin = folder.write("twin.md", "also inside");
  const entry = await walked(folder.root, "plan");
  for (const target of [secret, twin]) {
    rmSync(path);
    symlinkSync(target, path);
    assert.deepEqual(await openEntry(entry), { status: "changed" });
  }
});

test("a file replaced by another file after the walk is refused", async (t) => {
  const folder = tempFolder(t);
  const path = folder.write("plan.md", "the walk saw this");
  const entry = await walked(folder.root, "plan");
  const other = folder.write("other.txt", "swapped in");
  renameSync(other, path);
  assert.deepEqual(await openEntry(entry), { status: "changed" });
});

test("a file given a second hard link after the walk is refused", async (t) => {
  const folder = tempFolder(t);
  const path = folder.write("plan.md", "one name, then two");
  const entry = await walked(folder.root, "plan");
  linkSync(path, join(folder.outside, "plan.md"));
  assert.deepEqual(await openEntry(entry), { status: "changed" });
});

test("a directory swapped for a link out of the folder is refused, even if the walk was fooled", async (t) => {
  const folder = tempFolder(t);
  folder.write("sub/x.md", "inside");
  const outsideFile = folder.write("sub/x.md", "outside the folder", undefined, folder.outside);
  const entry = await walked(folder.root, "x");
  const sub = join(folder.root, "sub");
  renameSync(sub, join(folder.root, "sub-old"));
  symlinkSync(join(folder.outside, "sub"), sub);
  // As if the swap happened mid-walk: the walk saw the outside file's identity
  // at the inside path. The device and inode match; the path check must not.
  const outside = lstatSync(outsideFile, { bigint: true });
  const fooled = { ...entry, dev: outside.dev, ino: outside.ino };
  const opened = await openEntry(fooled);
  assert.notEqual(opened.status, "ok");
  assert.ok(opened.status === "changed" || opened.status === "forbidden", opened.status);
});

test("a pipe swapped in after the walk is refused without blocking", async (t) => {
  const folder = tempFolder(t);
  const path = folder.write("plan.md", "a file, then a pipe");
  const entry = await walked(folder.root, "plan");
  unlinkSync(path);
  try {
    execFileSync("mkfifo", [path]);
  } catch {
    t.skip("no mkfifo here");
    return;
  }
  assert.deepEqual(await openEntry(entry), { status: "changed" });
});

test("a file that grew past the per-file cap after the walk reads as a note", async (t) => {
  const folder = tempFolder(t);
  const path = folder.write("plan.md", "small");
  const entry = await walked(folder.root, "plan");
  truncateSync(path, maxFileBytes + 1);
  const opened = await openEntry(entry);
  assert.ok(opened.status === "ok");
  assert.equal(opened.content.text, opened.content.note);
  assert.ok(opened.content.text.length < 200);
});

test("only a failure of the system throws; an error about one path is that path's status", () => {
  const failure = (code?: string) => Object.assign(new Error("x"), code ? { code } : {});
  for (const code of ["EMFILE", "ENFILE", "ENOMEM", "EIO", "EAGAIN", "EINTR", "EBUSY", "ESTALE"])
    assert.equal(isSystemFailure(failure(code)), true, code);
  assert.equal(isSystemFailure(failure()), true, "no code");
  for (const code of ["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ENAMETOOLONG", "ELOOP", "EINVAL"])
    assert.equal(isSystemFailure(failure(code)), false, code);
});
