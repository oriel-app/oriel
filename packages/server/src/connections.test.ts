// Connections as the server keeps them (decision 0049): a database from
// before them moves in with every item where it was, a disconnected
// connection comes back under its ID, number and items' IDs, and what was
// kept of their secrets before decision 0059 is retired.
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { instant, ulid } from "@oriel/core";
import {
  connectionStore,
  ensureWorkspace,
  indexStore,
  loadMigrations,
  migrate,
  open,
} from "@oriel/db";
import type { WorkstreamView } from "@oriel/web/view";
import { oldSecretFiles } from "./connection.ts";
import { connectionsOf } from "./connections.ts";
import { json, t0, testApp } from "./testing.ts";

function scratch(t: TestContext) {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-connections-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const notes = join(top, "notes");
  mkdirSync(notes);
  writeFileSync(join(notes, "Launch plan.md"), "# Launch plan\n\nShip the phone wallet first.");
  writeFileSync(join(notes, "Interviews.md"), "Five PMs, three asked for saved cards.");
  return { top, notes };
}

const rows = (path: string, sql: string) => {
  const db = open(path);
  try {
    return db
      .prepare(sql)
      .all()
      .map((row) => ({ ...row }));
  } finally {
    db.close();
  }
};
const items = (path: string) =>
  rows(path, "select source, stable_id, item_id, gone_at from items order by source, stable_id");

test("a database from before connections moves in: a folder and Slack, with every item and sync state where it was", async (t) => {
  const { top, notes } = scratch(t);
  // Today's items, as the adapters made them: synced into a database of
  // this code's own, and copied into one at today's schema.
  const made = join(top, "made.db");
  const maker = await testApp(t, { db: made, memory: true, slack: { mode: "fixture" } });
  assert.equal((await maker.connect("folder", { path: notes })).status, 200);
  const workspaceId = maker.app.workspaceId;
  const [folderConnection] = connectionStore(open(made))
    .list(workspaceId)
    .filter((c) => c.kind === "folder");
  assert.ok(folderConnection);
  await maker.app.close();

  const path = join(top, "window.db");
  const today = open(path);
  migrate(
    today,
    loadMigrations().filter((m) => m.version <= 19),
    instant(new Date(t0)),
  );
  ensureWorkspace(today, { id: workspaceId, name: "Oriel" }, instant(new Date(t0)));
  today.exec(`attach database '${made}' as made`);
  // Only the columns items had then.
  const columns = today
    .prepare("select name from pragma_table_info('items')")
    .all()
    .map((row) => String(row.name))
    .join(", ");
  today.exec(`insert into items (${columns}) select ${columns} from made.items`);
  today.exec(
    "insert into sources (workspace_id, kind, cursor, synced_at) select workspace_id, source, cursor, synced_at from made.sources",
  );
  today
    .prepare("insert into folders (id, workspace_id, path, connected_at) values (?, ?, ?, ?)")
    .run(folderConnection.id, workspaceId, notes, t0);
  today.exec("detach database made");
  // A workstream that holds a file and a message.
  const held = [
    rows(path, "select item_id from items where source = 'folder'")[0]?.item_id,
    rows(path, "select item_id from items where source = 'slack'")[0]?.item_id,
  ];
  today.close();
  const before = items(path);
  const sourcesBefore = rows(
    path,
    "select workspace_id, kind as source, cursor, synced_at from sources order by kind",
  );
  assert.deepEqual([...new Set(before.map((row) => row.source))], ["folder", "jira", "slack"]);

  // Jira, which turns on through its server since decision 0059, is off:
  // its items stay, for when it's on.
  const app = await testApp(t, { db: path, jira: false, slack: { mode: "fixture" } });
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", { kind: "picked", name: "Mixed", items: held }),
  );
  const members = json<WorkstreamView>(await app.get(`/api/workstreams/${workstreamId}`)).members;
  assert.deepEqual(
    members.map((m) => [m.ref.id, m.row !== null]),
    held.map((id) => [id, true]),
  );
  await app.app.close();

  // Every item, and every source's sync state, as it was.
  assert.deepEqual(items(path), before);
  // Every cursor starts over (migration 0025), and the next sync sets it:
  // Jira's, which is off, once it's on.
  assert.deepEqual(
    rows(path, "select workspace_id, source, cursor, synced_at from sources order by source"),
    sourcesBefore.map((row) => (row.source === "jira" ? { ...row, cursor: null } : row)),
  );
  // Each is a connection, its kind's first; the folder under its own ID, so
  // its keys hash the same.
  assert.deepEqual(
    connectionStore(open(path))
      .list(workspaceId)
      .map((c) => [c.kind, c.prefix, c.identity, c.options, c.disconnectedAt]),
    [
      ["folder", "folder", notes, {}, null],
      [
        "slack",
        "slack",
        "https://ferrowick-example.slack.com/",
        { channels: ["C0FW1WEATHR"] },
        null,
      ],
      // The stand-in tracker's, on as no tracker is (decision 0059).
      ["tracker", "tracker", "oriel", {}, null],
    ],
  );
  assert.equal(
    connectionStore(open(path))
      .list(workspaceId)
      .find((c) => c.kind === "folder")?.id,
    folderConnection.id,
  );
  assert.deepEqual(rows(path, "select name from sqlite_master where name = 'folders'"), []);
});

test("a folder disconnected and connected again comes back under its ID and number, with its items' IDs", async (t) => {
  const { top, notes } = scratch(t);
  const path = join(top, "window.db");
  const first = await testApp(t, { db: path, jira: false });
  assert.equal((await first.connect("folder", { path: notes })).status, 200);
  const held = first.app
    .window("epic")
    .clusters.flatMap((cluster) => cluster.list)
    .find((row) => row.id.startsWith("folder:"))?.id;
  assert.ok(held);
  const { id: workstreamId } = json<{ id: string }>(
    await first.post("/api/workstreams", { kind: "picked", name: "Plan", items: [held] }),
  );
  const ids = items(path).filter((row) => row.gone_at === null && row.source === "folder");
  await first.app.close();

  // Disconnected: its options and items go, and a tombstone stays.
  const db = open(path);
  let n = 0;
  const connections = connectionsOf({
    db,
    index: indexStore(db),
    workspaceId: first.app.workspaceId,
    now: () => instant(new Date(Date.parse(t0) + ++n * 60_000)),
    newId: () => ulid(Date.parse(t0) + n, new Uint8Array(10)),
    log: () => {},
  });
  const connection = connections.first("folder");
  assert.ok(connection);
  // A second connection to the same folder is refused, with the one there is.
  assert.deepEqual(connections.connect({ kind: "folder", identity: notes, options: {} }), {
    taken: connection,
  });
  connections.disconnect(connection);
  assert.equal(connections.first("folder"), null);
  assert.deepEqual(
    items(path).filter((row) => row.source === "folder"),
    [],
  );
  db.close();

  const again = await testApp(t, { db: path, jira: false });
  const gone = json<WorkstreamView>(await again.get(`/api/workstreams/${workstreamId}`));
  assert.deepEqual(
    gone.members.map((m) => [m.ref.id, m.row !== null]),
    [[held, false]],
  );
  assert.equal((await again.connect("folder", { path: notes })).status, 200);
  const back = connectionStore(open(path))
    .list(again.app.workspaceId)
    .filter((c) => c.kind === "folder");
  assert.deepEqual(
    back.map((c) => [c.id, c.prefix, c.options, c.disconnectedAt]),
    [[connection.id, "folder", {}, null]],
  );
  assert.deepEqual(
    items(path)
      .filter((row) => row.gone_at === null && row.source === "folder")
      .map((row) => [row.item_id, row.stable_id]),
    ids.map((row) => [row.item_id, row.stable_id]),
  );
  const live = json<WorkstreamView>(await again.get(`/api/workstreams/${workstreamId}`));
  assert.deepEqual(
    live.members.map((m) => [m.ref.id, m.row !== null]),
    [[held, true]],
  );
});

test("retiring deletes every database's connection secrets, a fresh one's too, and nothing else", (t) => {
  const { top } = scratch(t);
  const root = join(top, "secrets");
  const id = ulid(Date.parse(t0), new Uint8Array(10));
  const window = join(root, "window");
  const fresh = join(root, "fresh", "pm", "live");
  for (const dir of [window, fresh]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `connection.${id}`), "a secret kept before");
  }
  writeFileSync(join(root, "jira.json"), "a saved connection");
  // Neither a name that isn't a ULID's, nor anything else, nor a link.
  writeFileSync(join(window, "connection.x"), "not a connection's");
  writeFileSync(join(root, "keep.txt"), "not a connection's");
  // Nor anything a link leads to, nor a folder of a secret's name.
  const outside = join(top, "elsewhere");
  mkdirSync(join(outside, "pm", "live"), { recursive: true });
  writeFileSync(join(outside, "pm", "live", `connection.${id}`), "not under secrets/");
  writeFileSync(join(outside, "jira.json"), "not under secrets/");
  symlinkSync(join(outside, "pm", "live"), join(root, "linked"));
  const retire = oldSecretFiles(root);
  assert.equal(retire.retire(), 3);
  assert.deepEqual(readdirSync(join(outside, "pm", "live")), [`connection.${id}`]);
  assert.ok(existsSync(join(outside, "jira.json")));
  rmSync(join(root, "linked"));
  assert.deepEqual(readdirSync(root).toSorted(), ["fresh", "keep.txt", "window"]);
  assert.deepEqual(readdirSync(window), ["connection.x"]);
  assert.deepEqual(readdirSync(join(root, "fresh")), [], "an emptied database folder goes");
  // Nothing left: nothing to do.
  assert.equal(retire.retire(), 0);
});

test("retiring follows no link, not even one where a fresh database's folder would be", (t) => {
  const { top } = scratch(t);
  const root = join(top, "secrets");
  const outside = join(top, "elsewhere");
  const id = ulid(Date.parse(t0), new Uint8Array(10));
  mkdirSync(join(outside, "pm", "live"), { recursive: true });
  writeFileSync(join(outside, "pm", "live", `connection.${id}`), "not under secrets/");
  writeFileSync(join(outside, "pm", "jira.json"), "not under secrets/");
  mkdirSync(root);
  symlinkSync(outside, join(root, "fresh"));
  // A folder of the saved one's name isn't it.
  mkdirSync(join(root, "jira.json"));
  assert.equal(oldSecretFiles(root).retire(), 0);
  assert.deepEqual(readdirSync(join(outside, "pm", "live")), [`connection.${id}`]);
  assert.ok(existsSync(join(outside, "pm", "jira.json")));
  // Nor `secrets/` itself, a link to a folder that looks like one.
  const linked = join(top, "linked-secrets");
  symlinkSync(join(outside, "pm"), linked);
  assert.equal(oldSecretFiles(linked).retire(), 0);
  assert.deepEqual(readdirSync(join(outside, "pm", "live")), [`connection.${id}`]);
  assert.ok(existsSync(join(outside, "pm", "jira.json")));
});
