import assert from "node:assert/strict";
import { test } from "node:test";
import { folderReplied, initFolder, loadFolder, updateFolder } from "../src/folder.ts";
import type { Replied } from "../src/http.ts";
import { init as initRoot, update as updateRoot } from "../src/root.ts";
import { connectionView } from "../testing.ts";

const notes = { path: "/Users/pm/notes", items: 2, syncedAt: "2026-10-30T09:00:00.000Z" };
// The folder's connection, as the server sends it.
const connection = connectionView({
  kind: "folder",
  prefix: "folder",
  name: "Folder",
  about: notes.path,
  identity: notes.path,
  options: {},
  items: notes.items,
  syncedAt: notes.syncedAt,
});
const listed = (picker: boolean) => ({ connections: [], connectable: ["folder"], picker });
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
      url: "/api/connections",
      body: { kind: "folder", given: { path: "~/notes" } },
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
  const added = folderReplied(pending, ok({ kind: "folderConnected" }, { connection }));
  assert.deepEqual(
    [added.model.view, added.model.open, added.model.path, added.synced],
    [notes, false, "", true],
  );
});

test("the window shows the folder, and loads again once one is added", () => {
  const [model, effects] = initRoot({ page: "window", grouping: "epic", addTo: null });
  assert.ok(effects.includes(loadFolder));
  const [synced, after] = updateRoot(model, ok({ kind: "folderConnected" }, { connection }));
  assert.equal(synced.folder.view?.items, 2);
  assert.deepEqual(
    after.map((e) => (e.type === "http" ? e.url : e.type)),
    ["loadWindow", "/api/connections"],
  );
});

test("on the desktop app, Choose a folder asks the server's picker once; cancelling changes nothing", () => {
  const loaded = folderReplied(initFolder(), ok({ kind: "folder" }, listed(true))).model;
  assert.equal(loaded.picker, true);
  const opened = updateFolder(loaded, { type: "opened" })[0];
  const [pending, effects] = updateFolder(opened, { type: "pickClicked" });
  assert.deepEqual(effects, [
    {
      type: "http",
      method: "POST",
      url: "/api/connections/picker",
      body: { kind: "folder" },
      tag: { kind: "folderPicked" },
    },
  ]);
  assert.deepEqual(updateFolder(pending, { type: "pickClicked" })[1], []);
  const cancelled = folderReplied(pending, ok({ kind: "folderPicked" }, { picked: false }));
  assert.deepEqual(
    [cancelled.model.pending, cancelled.model.open, cancelled.model.view, cancelled.synced],
    [false, true, null, false],
  );
  const picked = folderReplied(pending, ok({ kind: "folderPicked" }, { connection, picked: true }));
  assert.deepEqual([picked.model.view, picked.model.open, picked.synced], [notes, false, true]);
  // Under pnpm dev, no picker: the path form.
  assert.equal(
    folderReplied(initFolder(), ok({ kind: "folder" }, listed(false))).model.picker,
    false,
  );
});
