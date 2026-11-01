// A folder of markdown files, connected by its typed path: its items join
// the window beside Jira's, and a workstream can mix both.
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type TestContext, test } from "node:test";
import type { DiffView, FolderView, WorkstreamView, ThreadView, WindowView } from "@oriel/web/view";
import { host, json, type Script, testApp } from "./testing.ts";

// A fresh folder for each test, removed when it ends.
function folder(t: TestContext, files: Record<string, string>) {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-folder-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const root = join(top, "notes");
  mkdirSync(root);
  const write = (rel: string, body: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  for (const [rel, body] of Object.entries(files)) write(rel, body);
  return { top, root, write };
}

const notes = {
  "Launch plan.md": "# Launch plan\n\nShip the phone wallet first.",
  "research/Interviews.md": "Five PMs, three asked for saved cards.",
  ".env": "SECRET=1",
  "todo.txt": "not markdown",
};

async function connected(t: TestContext, options: Parameters<typeof testApp>[1] = {}) {
  const app = await testApp(t, options);
  const dir = folder(t, notes);
  const reply = await app.post("/api/folder", { path: dir.root });
  assert.equal(reply.status, 200);
  return { ...app, dir, folder: json<{ folder: FolderView }>(reply).folder };
}

test("connecting a folder by its path syncs its markdown files into the window", async (t) => {
  const app = await connected(t);
  assert.deepEqual([app.folder.path, app.folder.items], [app.dir.root, 2]);
  assert.deepEqual(json(await app.get("/api/folder")), { folder: app.folder });
  const window = json<WindowView>(await app.get("/api/window?grouping=epic"));
  const own = window.clusters.find((c) => c.row.key === "no-epics-in-source");
  assert.deepEqual(own?.list.map((row) => row.title).toSorted(), ["Interviews", "Launch plan"]);
  assert.equal(own?.row.origin.kind, "derived");
  const connects = app.app.telemetry().filter((e) => e.name === "source.connected");
  assert.deepEqual(
    connects.map((e) => e.data.source),
    ["jira", "folder"],
  );
});

test("only a folder can be connected, by a full path, from this window", async (t) => {
  const app = await testApp(t);
  const dir = folder(t, { "a.md": "a" });
  const refused = async (path: string) =>
    json<{ error: string }>(await app.post("/api/folder", { path }));
  assert.match((await refused(join(dir.top, "missing"))).error, /There's no folder/);
  assert.match((await refused(join(dir.root, "a.md"))).error, /a file, not a folder/);
  assert.match((await refused("notes")).error, /full path/);
  assert.equal((await app.post("/api/folder", { path: "x".repeat(5000) })).status, 413);
  assert.equal(
    (await app.post("/api/folder", { path: dir.root }, { origin: "https://attacker.example" }))
      .status,
    403,
  );
  const unsigned = await app.handle({
    method: "POST",
    url: "/api/folder",
    headers: { host, "content-type": "application/json" },
    body: app.body(JSON.stringify({ path: dir.root })),
  });
  assert.equal(unsigned.status, 403);
  assert.equal(
    (
      await app.handle({
        method: "PUT",
        url: "/api/folder",
        headers: { host, origin: `http://${host}` },
      })
    ).status,
    405,
  );
  assert.deepEqual(json(await app.get("/api/folder")), { folder: null });
});

const fileIds = (view: WindowView) =>
  view.clusters
    .flatMap((c) => c.list.map((row) => row.id))
    .filter((id) => id.startsWith("folder:"))
    .toSorted();

test("picking the same folder again keeps every item's ID", async (t) => {
  const app = await connected(t);
  const before = fileIds(json<WindowView>(await app.get("/api/window?grouping=epic")));
  assert.equal(before.length, 2);
  // Typed another way, it resolves to the same folder.
  const again = await app.post("/api/folder", { path: `${app.dir.root}/` });
  assert.equal(again.status, 200);
  const after = fileIds(json<WindowView>(await app.get("/api/window?grouping=epic")));
  assert.deepEqual(after, before);
});

test("a folder that can't be listed isn't kept; the one before stays as it was", async (t) => {
  const app = await connected(t);
  const before = fileIds(json<WindowView>(await app.get("/api/window?grouping=epic")));
  const locked = join(app.dir.top, "locked");
  mkdirSync(locked);
  writeFileSync(join(locked, "Secret plan.md"), "Not for Oriel.");
  // Enterable, but not listable.
  chmodSync(locked, 0o311);
  let listable = true;
  try {
    readdirSync(locked);
  } catch {
    listable = false;
  }
  // Running as root, permissions don't bind.
  if (listable) {
    chmodSync(locked, 0o700);
    t.skip("permissions don't bind here");
    return;
  }
  const refused = await app.post("/api/folder", { path: locked });
  // Back to normal, so the temporary directory can be removed.
  chmodSync(locked, 0o700);
  assert.equal(refused.status, 400);
  assert.match(json<{ error: string }>(refused).error, /couldn't read the folder/);
  assert.deepEqual(json(await app.get("/api/folder")), { folder: app.folder });
  const after = fileIds(json<WindowView>(await app.get("/api/window?grouping=epic")));
  assert.deepEqual(after, before);
});

test("a folder syncs again on demand, and when the server starts", async (t) => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-db-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const db = join(top, "oriel.db");
  const app = await connected(t, { db });
  app.dir.write("Retro.md", "What went well.");
  const synced = json<{ folder: FolderView }>(await app.post("/api/folder/sync"));
  assert.equal(synced.folder.items, 3);
  await app.app.close();
  app.dir.write("Later.md", "Written while Oriel was off.");
  const again = await testApp(t, { db });
  assert.equal(json<{ folder: FolderView }>(await again.get("/api/folder")).folder.items, 4);
});

test("a file dropped that the index doesn't have yet is found by syncing the folder once", async (t) => {
  const app = await connected(t);
  const created = await app.post("/api/workstreams", {
    kind: "picked",
    name: "Launch",
    items: ["jira:SYN-10"],
  });
  const { id } = json<{ id: string }>(created);
  app.dir.write("Retro.md", "What went well.");
  const modified = Math.trunc(statSync(join(app.dir.root, "Retro.md")).mtimeMs);
  const dropped = json<{ workstream: WorkstreamView; added: string[]; refused: unknown[] }>(
    await app.post(`/api/workstreams/${id}/drop`, {
      links: [],
      files: [{ name: "Retro.md", modified }],
    }),
  );
  assert.equal(dropped.added.length, 1);
  assert.deepEqual(dropped.refused, []);
  assert.ok(dropped.workstream.members.some((m) => m.ref.title === "Retro"));
});

test("a workstream mixes Jira and folder items; its thread's region binds items.* for both, jira.* for Jira's", async (t) => {
  const inspect: Script = async (bindings) => ({
    value: { dts: bindings.dts, items: (await bindings.read("items.list", [])).value },
  });
  const app = await connected(t, { plan: () => [{ run: "inspect" }], scripts: { inspect } });
  const window = json<WindowView>(await app.get("/api/window?grouping=epic"));
  const file = window.clusters
    .flatMap((c) => c.list)
    .find((row) => row.title === "Launch plan" && row.id.startsWith("folder:"))?.id;
  assert.ok(file);
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", {
      kind: "picked",
      name: "Launch",
      items: ["jira:SYN-10", file],
    }),
  );
  const workstream = json<WorkstreamView>(await app.get(`/api/workstreams/${workstreamId}`));
  assert.deepEqual(
    workstream.members.map((m) => [m.ref.id, m.row?.title]),
    [
      ["jira:SYN-10", "Remove the legacy web-view checkout"],
      [file, "Launch plan"],
    ],
  );
  const { id } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "What's the plan?" }),
  );
  await app.app.settled();
  const thread = json<ThreadView>(await app.get(`/api/threads/${id}`));
  const finished = thread.entries.find((e) => e.kind === "run.finished");
  assert.ok(finished?.kind === "run.finished");
  const value = JSON.parse(finished.run.returned ?? "null") as {
    dts: string;
    items: { id: string; gone: boolean; text?: string }[];
  };
  assert.match(value.dts, /declare const items: \{/);
  assert.match(value.dts, /declare const jira: \{/);
  assert.doesNotMatch(value.dts, /declare const folder/);
  assert.ok(value.dts.includes(JSON.stringify("jira:SYN-10")));
  assert.ok(value.dts.includes(JSON.stringify(file)));
  // A file's name is data: it never reaches the declarations.
  assert.doesNotMatch(value.dts, /Launch plan/);
  const read = new Map(value.items.map((item) => [item.id, item]));
  assert.match(read.get(file)?.text ?? "", /Ship the phone wallet first/);
  assert.equal(read.get("jira:SYN-10")?.gone, false);
});

test("an epic picked beside a plan lets the agent create stories in it, and shows once per grouping", async (t) => {
  const story: Script = async (bindings) => ({
    value: bindings.dts,
    writes: [
      ["jira.createStory", [{ summary: "Pay with a gift card", epic: "jira:SYN-1" }], "new:1"],
    ],
  });
  const app = await connected(t, {
    writes: true,
    plan: () => [{ run: "story" }],
    scripts: { story },
  });
  // The epic shows once: as its cluster's heading, which picks it, under the
  // epic grouping; as an item under its assignee; not at all as stuck work.
  for (const [grouping, times] of [
    ["epic", 1],
    ["assignee", 1],
    ["stuck", 0],
  ] as const) {
    const window = json<WindowView>(await app.get(`/api/window?grouping=${grouping}`));
    const shown = window.clusters.flatMap((c) => [
      ...(c.row.anchor ? [c.row.anchor.id] : []),
      ...c.list.map((row) => row.id),
    ]);
    assert.equal(shown.filter((id) => id === "jira:SYN-1").length, times, grouping);
  }
  const window = json<WindowView>(await app.get("/api/window?grouping=epic"));
  assert.ok(window.clusters.some((c) => c.row.anchor?.id === "jira:SYN-1"));
  const plan = window.clusters
    .flatMap((c) => c.list)
    .find((row) => row.title === "Launch plan" && row.id.startsWith("folder:"))?.id;
  assert.ok(plan);
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", {
      kind: "picked",
      name: "Launch",
      items: [plan, "jira:SYN-1"],
    }),
  );
  const { id } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, {
      text: "Turn the plan into stories",
    }),
  );
  await app.app.settled();
  const thread = json<ThreadView>(await app.get(`/api/threads/${id}`));
  const finished = thread.entries.find((e) => e.kind === "run.finished");
  assert.ok(finished?.kind === "run.finished");
  assert.match(
    JSON.parse(finished.run.returned ?? "null") as string,
    /type EpicId =\n {2}\| "jira:SYN-1";/,
  );
  const entry = thread.entries.find((e) => e.kind === "change-set");
  assert.ok(entry?.kind === "change-set", "the run captured a change set");
  const diff = json<DiffView>(await app.post(`/api/change-sets/${entry.changeSetId}/diff`));
  assert.deepEqual(
    diff.lines.map((line) => line.sentence),
    [
      "Create a story “Pay with a gift card” in the epic “Checkout v2: phone wallets and saved cards” (SYN-1).",
    ],
  );
});
