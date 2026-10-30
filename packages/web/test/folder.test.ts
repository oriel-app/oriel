import assert from "node:assert/strict";
import { test } from "node:test";
import { folderReplied, initFolder, loadFolder, updateFolder } from "../src/folder.ts";
import type { Replied } from "../src/http.ts";
import { init as initRoot, update as updateRoot } from "../src/root.ts";

const notes = { path: "/Users/pm/notes", items: 2, syncedAt: "2026-10-30T09:00:00.000Z" };
const ok = (tag: Replied["tag"], body: unknown): Replied => ({
  type: "replied",
  tag,
  ok: true,
  body,
});

test("a folder is added by its typed path, once", () => {
  const opened = updateFolder(initFolder(), { type: "opened" })[0];
  assert.deepEqual(updateFolder(opened, { type: "connectClicked" })[1], []);
  const typed = updateFolder(opened, { type: "pathChanged", path: "  ~/notes " })[0];
  const [pending, effects] = updateFolder(typed, { type: "connectClicked" });
  assert.deepEqual(effects, [
    {
      type: "http",
      method: "POST",
      url: "/api/folder",
      body: { path: "~/notes" },
      tag: { kind: "folderConnected" },
    },
  ]);
  assert.deepEqual(updateFolder(pending, { type: "connectClicked" })[1], []);
  const refused = folderReplied(pending, {
    type: "replied",
    tag: { kind: "folderConnected" },
    ok: false,
    body: { error: "That path is a file, not a folder." },
  });
  assert.deepEqual(
    [refused.model.problem, refused.model.open, refused.synced],
    ["That path is a file, not a folder.", true, false],
  );
  const added = folderReplied(pending, ok({ kind: "folderConnected" }, { folder: notes }));
  assert.deepEqual(
    [added.model.view, added.model.open, added.model.path, added.synced],
    [notes, false, "", true],
  );
});

test("a connected folder syncs again on demand", () => {
  const shown = folderReplied(initFolder(), ok({ kind: "folder" }, { folder: notes })).model;
  assert.deepEqual(updateFolder(initFolder(), { type: "syncClicked" })[1], []);
  assert.deepEqual(updateFolder(shown, { type: "syncClicked" })[1], [
    {
      type: "http",
      method: "POST",
      url: "/api/folder/sync",
      body: {},
      tag: { kind: "folderSynced" },
    },
  ]);
});

test("the window shows the folder, and loads again once it synced", () => {
  const [model, effects] = initRoot({ page: "window", grouping: "epic", addTo: null });
  assert.ok(effects.includes(loadFolder));
  const [synced, after] = updateRoot(model, ok({ kind: "folderConnected" }, { folder: notes }));
  assert.equal(synced.folder.view?.items, 2);
  assert.deepEqual(
    after.map((e) => e.type),
    ["loadWindow"],
  );
});
