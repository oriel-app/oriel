// Connections as the server keeps them (decision 0049): a database from
// before them moves in with every item where it was, and a disconnected
// connection comes back under its ID, number and items' IDs.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
import { fileSecrets, legacySecret, memorySecrets, secretName } from "./connection.ts";
import { connectionsOf } from "./connections.ts";
import { account, jiraOf, json, t0, testApp } from "./testing.ts";

const details = {
  site: "oriel.atlassian.net",
  email: account.email,
  token: account.token,
  project: "syn",
};
const synSite = "https://oriel.atlassian.net";

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

test("a database from before connections moves in: Jira's saved connection, a folder and Slack, with every item and sync state where it was", async (t) => {
  const { top, notes } = scratch(t);
  // Today's items, as the adapters made them: synced into a database of
  // this code's own, and copied into one at today's schema.
  const made = join(top, "made.db");
  const maker = await testApp(t, { db: made, connect: {}, slack: { mode: "fixture" } });
  assert.equal((await maker.connect("jira", details)).status, 200);
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
  // A workstream that holds one of each.
  const held = [
    "jira:SYN-1",
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

  // Jira's saved connection, as the desktop app's store kept it.
  const secrets = memorySecrets(
    new Map([["jira", JSON.stringify({ site: synSite, ...account, project: "SYN" })]]),
  );
  const app = await testApp(t, {
    db: path,
    connect: { secrets, legacy: legacySecret(secrets) },
    slack: { mode: "fixture" },
  });
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
  assert.deepEqual(
    rows(path, "select workspace_id, source, cursor, synced_at from sources order by source"),
    sourcesBefore,
  );
  // Each is a connection, its kind's first; the folder under its own ID, so
  // its keys hash the same.
  assert.deepEqual(
    connectionStore(open(path))
      .list(workspaceId)
      .map((c) => [c.kind, c.prefix, c.identity, c.options, c.disconnectedAt]),
    [
      ["folder", "folder", notes, {}, null],
      ["jira", "jira", synSite, { project: "SYN" }, null],
      [
        "slack",
        "slack",
        "https://ferrowick-example.slack.com/",
        { channels: ["C0FW1WEATHR"] },
        null,
      ],
    ],
  );
  assert.equal(
    connectionStore(open(path))
      .list(workspaceId)
      .find((c) => c.kind === "folder")?.id,
    folderConnection.id,
  );
  assert.deepEqual(rows(path, "select name from sqlite_master where name = 'folders'"), []);
  // Jira's secret is its connection's now, and `jira` is gone.
  const jira = connectionStore(open(path))
    .list(workspaceId)
    .find((c) => c.kind === "jira");
  assert.ok(jira);
  assert.deepEqual([...secrets.kept.keys()], [secretName(jira.id)]);
  assert.deepEqual(JSON.parse(secrets.kept.get(secretName(jira.id)) ?? ""), account);
});

test("Jira disconnected and connected again comes back under its ID and number, with its items' IDs", async (t) => {
  const { top } = scratch(t);
  const path = join(top, "window.db");
  const secrets = memorySecrets();
  const first = await testApp(t, { db: path, connect: { secrets } });
  assert.equal((await first.connect("jira", details)).status, 200);
  const { id: workstreamId } = json<{ id: string }>(
    await first.post("/api/workstreams", {
      kind: "picked",
      name: "Checkout",
      items: ["jira:SYN-1"],
    }),
  );
  const ids = items(path).filter((row) => row.gone_at === null);
  await first.app.close();

  // Disconnected: its secret, options and items go, and a tombstone stays.
  const db = open(path);
  let n = 0;
  const connections = connectionsOf({
    db,
    index: indexStore(db),
    secrets,
    workspaceId: first.app.workspaceId,
    now: () => instant(new Date(Date.parse(t0) + ++n * 60_000)),
    newId: () => ulid(Date.parse(t0) + n, new Uint8Array(10)),
    log: () => {},
  });
  const connection = connections.first("jira");
  assert.ok(connection);
  // A second connection to the same site is refused, with the one there is.
  assert.deepEqual(
    await connections.connect({ kind: "jira", identity: synSite, options: {}, secret: "{}" }),
    { taken: connection },
  );
  assert.deepEqual([...secrets.kept.keys()], [secretName(connection.id)]);
  await connections.disconnect(connection);
  assert.deepEqual([...secrets.kept.keys()], []);
  assert.equal(connections.first("jira"), null);
  assert.deepEqual(items(path), []);
  db.close();

  const again = await testApp(t, { db: path, connect: { secrets } });
  assert.deepEqual(await jiraOf(again), {
    connected: null,
    connectable: true,
  });
  const gone = json<WorkstreamView>(await again.get(`/api/workstreams/${workstreamId}`));
  assert.deepEqual(
    gone.members.map((m) => [m.ref.id, m.row !== null]),
    [["jira:SYN-1", false]],
  );
  assert.equal((await again.connect("jira", details)).status, 200);
  // The stand-in tracker's own connection, made while Jira wasn't
  // connected, stays apart (decision 0059).
  const back = connectionStore(open(path))
    .list(again.app.workspaceId)
    .filter((c) => c.kind === "jira");
  assert.deepEqual(
    back.map((c) => [c.id, c.prefix, c.options, c.disconnectedAt]),
    [[connection.id, "jira", { project: "SYN" }, null]],
  );
  assert.deepEqual([...secrets.kept.keys()], [secretName(connection.id)]);
  assert.deepEqual(
    items(path)
      .filter((row) => row.gone_at === null)
      .map((row) => [row.item_id, row.stable_id]),
    ids.map((row) => [row.item_id, row.stable_id]),
  );
  const live = json<WorkstreamView>(await again.get(`/api/workstreams/${workstreamId}`));
  assert.deepEqual(
    live.members.map((m) => [m.ref.id, m.row !== null]),
    [["jira:SYN-1", true]],
  );
});

test("a connection's secret is named for its ID alone: no other name reaches the file store", async (t) => {
  const { top } = scratch(t);
  const files = fileSecrets(join(top, "secrets", "window"));
  for (const name of [
    "../jira.json",
    "jira.json",
    "connection.x",
    "Connection.01JC0NNECT10NSST0RED0000AB",
  ])
    await assert.rejects(files.set(name, "s"), Error, name);
});
