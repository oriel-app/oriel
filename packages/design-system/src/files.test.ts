import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { readAt, readIn, readShown } from "./files.ts";

let outside = "";
let checkout = "";
let commit = "";

const git = (...args: string[]) =>
  execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" }).trim();

before(() => {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), "ds-files-")));
  outside = join(base, "outside.txt");
  checkout = join(base, "checkout");
  writeFileSync(outside, "outside");
  mkdirSync(join(checkout, "packages/web"), { recursive: true });
  mkdirSync(join(checkout, "secrets"));
  writeFileSync(join(checkout, ".gitignore"), ".env\nsecrets/\n");
  writeFileSync(join(checkout, "packages/web/window.css"), ".button {}\n");
  writeFileSync(join(checkout, ".env"), "KEY=x\n");
  writeFileSync(join(checkout, "secrets/jira"), "token\n");
  symlinkSync(outside, join(checkout, "out-link"));
  symlinkSync(join(checkout, ".env"), join(checkout, "env-link"));
  git("init", "-q");
  git("add", ".gitignore", "packages", "out-link", "env-link");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "one");
  commit = git("rev-parse", "HEAD");
  writeFileSync(join(checkout, "packages/web/new.ts"), "export const x = 1;\n");
});

after(() => rmSync(join(checkout, ".."), { recursive: true, force: true }));

test("shows a tracked file, and a new one git would track", () => {
  assert.equal(readShown(checkout, "packages/web/window.css"), ".button {}\n");
  assert.equal(readShown(checkout, "packages/web/new.ts"), "export const x = 1;\n");
});

test("never shows what git ignores, in any case", () => {
  for (const path of [".env", ".ENV", "secrets/jira", "packages/../.env"])
    assert.equal(readShown(checkout, path), null, path);
});

test("never shows a file outside the checkout, by a path or a link", () => {
  for (const path of ["../outside.txt", outside, "out-link", "env-link", "packages", ""])
    assert.equal(readShown(checkout, path), null, path);
  assert.equal(readIn(checkout, "out-link"), null);
  assert.equal(readIn(checkout, "../outside.txt"), null);
});

test("reads a file at a full or short hex commit", () => {
  assert.equal(readAt(checkout, "packages/web/window.css", commit), ".button {}\n");
  assert.equal(readAt(checkout, "packages/web/window.css", commit.slice(0, 7)), ".button {}\n");
});

test("refuses any commit that isn't hex, and any path that leaves the tree", () => {
  for (const at of ["HEAD", "--output=/tmp/x", "-p", `${commit}~1`, `${commit.slice(0, 7)}..HEAD`])
    assert.equal(readAt(checkout, "packages/web/window.css", at), null, at);
  for (const path of ["../outside.txt", "/etc/hosts", "packages/./web/window.css", "a:b", " x"])
    assert.equal(readAt(checkout, path, commit), null, path);
});
