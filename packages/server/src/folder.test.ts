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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type TestContext, test } from "node:test";
import type { ConnectionView, ThreadView, WindowView, WorkstreamView } from "@oriel/web/view";
import { memorySecrets } from "./connection.ts";
import { json, type Script, testApp } from "./testing.ts";

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
  const reply = await app.connect("folder", { path: dir.root });
  assert.equal(reply.status, 200);
  return { ...app, dir, folder: json<{ connection: ConnectionView }>(reply).connection };
}

const fileIds = (view: WindowView) =>
  view.clusters
    .flatMap((c) => c.list.map((row) => row.id))
    .filter((id) => id.startsWith("folder:"))
    .toSorted();

test("picking the same folder again keeps every item's ID", async (t) => {
  const app = await connected(t);
  const before = fileIds(app.app.window("epic"));
  assert.equal(before.length, 2);
  // Typed another way, it resolves to the same folder.
  const again = await app.connect("folder", { path: `${app.dir.root}/` });
  assert.equal(again.status, 200);
  const after = fileIds(app.app.window("epic"));
  assert.deepEqual(after, before);
});

// Every folder item's ID the window shows, from any folder's connection.
const allFileIds = (view: WindowView) =>
  view.clusters
    .flatMap((c) => c.list.map((row) => row.id))
    .filter((id) => /^folder(\.\d+)?:/.test(id))
    .toSorted();

test("another folder takes the place of the first as a later connection, and the first comes back under its IDs", async (t) => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-db-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const db = join(top, "oriel.db");
  const app = await connected(t, { db });
  const window = async (on: Pick<typeof app, "app"> = app) => allFileIds(on.app.window("epic"));
  const first = await window();
  assert.equal(first.length, 2);
  const [held] = first;
  assert.ok(held);
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", { kind: "picked", name: "Notes", items: [held] }),
  );
  const members = async (on: Pick<typeof app, "get"> = app) =>
    json<WorkstreamView>(await on.get(`/api/workstreams/${workstreamId}`)).members.map((m) => [
      m.ref.id,
      m.row !== null,
    ]);
  assert.deepEqual(await members(), [[held, true]]);

  // Another folder: a later connection, whose items carry its number. The
  // first's go from the window, and its workstream holds its item as gone.
  const plans = join(app.dir.top, "plans");
  mkdirSync(plans);
  writeFileSync(join(plans, "Roadmap.md"), "Q4.");
  assert.equal((await app.connect("folder", { path: plans })).status, 200);
  const second = await window();
  assert.equal(second.length, 1);
  assert.match(second[0] ?? "", /^folder\.2:[0-9a-f]{16}$/);
  assert.deepEqual(await members(), [[held, false]]);
  // The first again: the same connection, so the same IDs, and its workstream
  // holds its item again. Restarting changes nothing.
  assert.equal((await app.connect("folder", { path: app.dir.root })).status, 200);
  assert.deepEqual(await window(), first);
  assert.deepEqual(await members(), [[held, true]]);
  await app.app.close();
  const again = await testApp(t, { db });
  assert.deepEqual(await window(again), first);
  assert.deepEqual((await again.connection("folder"))?.identity, app.dir.root);
});

test("a sync asked for while another folder takes the first's place never brings the first back", async (t) => {
  const app = await connected(t);
  const plans = join(app.dir.top, "plans");
  mkdirSync(plans);
  writeFileSync(join(plans, "Roadmap.md"), "Q4.");
  for (const wait of [0, 1, 2, 5, 10, 20]) {
    const path = wait % 2 === 0 ? plans : app.dir.root;
    const replacing = app.connect("folder", { path });
    for (let i = 0; i < wait; i++) await new Promise((resolve) => setImmediate(resolve));
    const synced = app.sync("folder");
    assert.equal((await replacing).status, 200);
    // It names the connection open when it was asked for: synced, or, once
    // another took its place, not connected now.
    assert.ok([200, 409].includes((await synced).status), `after ${wait}`);
    const ids = allFileIds(app.app.window("epic"));
    const prefixes = [...new Set(ids.map((id) => id.split(":")[0]))];
    assert.deepEqual(prefixes, [path === plans ? "folder.2" : "folder"], `after ${wait}`);
  }
});

test("the first folder picked again while another takes its place comes back after it", async (t) => {
  // The other folder's connect is held while it disconnects the first.
  const deleting = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  const app = await connected(t, {
    connect: {
      secrets: {
        ...memorySecrets(),
        delete: async () => {
          deleting.resolve();
          await held.promise;
        },
      },
    },
  });
  const plans = join(app.dir.top, "plans");
  mkdirSync(plans);
  writeFileSync(join(plans, "Roadmap.md"), "Q4.");
  const replacing = app.connect("folder", { path: plans });
  await deleting.promise;
  const back = app.connect("folder", { path: app.dir.root });
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
  held.resolve();
  assert.equal((await replacing).status, 200);
  assert.equal((await back).status, 200);
  assert.equal((await app.connection("folder"))?.identity, app.dir.root);
  const ids = allFileIds(app.app.window("epic"));
  assert.deepEqual([...new Set(ids.map((id) => id.split(":")[0]))], ["folder"]);
});

test("a folder that can't be disconnected now is an error for its request, and the server goes on", async (t) => {
  const secrets = memorySecrets();
  const app = await connected(t, {
    connect: {
      secrets: {
        ...secrets,
        delete: async () => {
          throw new Error("the shell is gone");
        },
      },
    },
  });
  const plans = join(app.dir.top, "plans");
  mkdirSync(plans);
  writeFileSync(join(plans, "Roadmap.md"), "Q4.");
  const refused = await app.connect("folder", { path: plans }).then(
    (reply) => reply.status,
    () => "threw",
  );
  assert.notEqual(refused, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await app.connection("folder"))?.identity, app.dir.root);
  assert.equal((await app.sync("folder")).status, 200);
});

test("a folder that can't be listed isn't kept; the one before stays as it was", async (t) => {
  const app = await connected(t);
  const before = fileIds(app.app.window("epic"));
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
  const refused = await app.connect("folder", { path: locked });
  // Back to normal, so the temporary directory can be removed.
  chmodSync(locked, 0o700);
  assert.equal(refused.status, 400);
  assert.deepEqual(await app.connection("folder"), app.folder);
  const after = fileIds(app.app.window("epic"));
  assert.deepEqual(after, before);
});

test("a workstream mixes Jira and folder items; its thread's region binds items.* for both, jira.* for Jira's", async (t) => {
  const inspect: Script = async (bindings) => ({
    value: { dts: bindings.dts, items: (await bindings.read("items.list", [])).value },
  });
  const app = await connected(t, { plan: () => [{ run: "inspect" }], scripts: { inspect } });
  const window = app.app.window("epic");
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
