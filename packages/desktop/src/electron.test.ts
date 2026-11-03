import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { electronTypes, electronVersion, electronZips, target, zipUrl } from "./electron.ts";

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
