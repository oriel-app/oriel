import assert from "node:assert/strict";
import { test } from "node:test";
import { iconset, type Manifest, shipped, workspaceClosure } from "./bundle.ts";

test("the app takes the workspace packages the server reaches, and no others", () => {
  const manifests = new Map<string, Manifest>([
    [
      "@oriel/server",
      {
        name: "@oriel/server",
        dependencies: { "@oriel/core": "workspace:*", "@oriel/web": "workspace:*" },
      },
    ],
    [
      "@oriel/web",
      { name: "@oriel/web", dependencies: { "@oriel/core": "workspace:*", preact: "11.0.1" } },
    ],
    ["@oriel/core", { name: "@oriel/core" }],
    ["@oriel/evals", { name: "@oriel/evals", dependencies: { "@oriel/server": "workspace:*" } }],
  ]);
  assert.deepEqual(workspaceClosure("@oriel/server", manifests), [
    "@oriel/core",
    "@oriel/server",
    "@oriel/web",
  ]);
});

test("a workspace dependency that isn't a package stops the build", () => {
  const manifests = new Map<string, Manifest>([
    ["@oriel/server", { name: "@oriel/server", dependencies: { "@oriel/gone": "workspace:*" } }],
  ]);
  assert.throws(
    () => workspaceClosure("@oriel/server", manifests),
    /@oriel\/gone isn't a workspace package/,
  );
});

test("the app leaves tests, their support files and build state behind", () => {
  for (const path of [
    "src/app.ts",
    "migrations/0001-init.sql",
    "dist/main.js",
    "files.ts",
    "package.json",
  ])
    assert.equal(shipped(path), true, path);
  for (const path of [
    "src/app.test.ts",
    "src/view.test.tsx",
    "testing.ts",
    "src/testing.ts",
    "test/page.test.ts",
    "test",
    "node_modules/preact/package.json",
    "tsconfig.tsbuildinfo",
  ])
    assert.equal(shipped(path), false, path);
});

test("the icon is drawn at every size iconutil packs, up to 1024 pixels", () => {
  const set = iconset();
  assert.equal(set.length, 10);
  assert.deepEqual(set.slice(0, 2), [
    { name: "icon_16x16.png", pixels: 16 },
    { name: "icon_16x16@2x.png", pixels: 32 },
  ]);
  assert.deepEqual(set.at(-1), { name: "icon_512x512@2x.png", pixels: 1024 });
});
