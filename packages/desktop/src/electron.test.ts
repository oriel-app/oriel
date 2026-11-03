import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  electronNode,
  electronTypes,
  electronVersion,
  electronZips,
  target,
  zipCache,
  zipUrl,
} from "./electron.ts";

test("the vendored Electron types are the pinned release's own", () => {
  const types = readFileSync(new URL("../vendor/electron.d.ts", import.meta.url));
  assert.equal(createHash("sha256").update(types).digest("hex"), electronTypes);
  assert.match(
    types.toString("utf8", 0, 200),
    new RegExp(`Electron ${electronVersion.replaceAll(".", "\\.")}\\b`),
  );
});

test("every pinned zip is a SHA-256 from the release, and a target names one", () => {
  for (const hash of Object.values(electronZips)) assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(target("darwin", "arm64"), "darwin-arm64");
  assert.throws(() => target("freebsd", "x64"), /no build pinned for freebsd-x64/);
  assert.equal(
    zipUrl("darwin-arm64"),
    `https://github.com/electron/electron/releases/download/v${electronVersion}/electron-v${electronVersion}-darwin-arm64.zip`,
  );
});

test("the zip is cached outside the repo, once for every worktree, by its hash", () => {
  assert.equal(
    zipCache("/Users/p", "darwin-arm64"),
    `/Users/p/Library/Caches/oriel/electron/${electronZips["darwin-arm64"]}.zip`,
  );
});

test("the repo pins the Node inside the pinned Electron, and its types are that Node's", () => {
  const mise = readFileSync(new URL("../../../mise.toml", import.meta.url), "utf8");
  assert.match(mise, new RegExp(`^node = "${electronNode.replaceAll(".", "\\.")}"$`, "m"));
  const root = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
  const types = (root as { devDependencies: Record<string, string> }).devDependencies[
    "@types/node"
  ];
  assert.equal(types?.split(".")[0], electronNode.split(".")[0]);
});
