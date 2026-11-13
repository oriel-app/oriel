import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { instant, type SourceKind, ulid, type Ulid, unknown } from "@oriel/core";
import {
  connectionStore,
  indexStore,
  loadMigrations,
  migrate,
  open,
  workstreamStore,
} from "@oriel/db";
import { sources } from "@oriel/sources";
import { oldSecretFiles } from "./connection.ts";
import { json, type Logged, testApp } from "./testing.ts";

const t0 = instant(new Date(Date.UTC(2026, 10, 1, 9)));
const site = "https://oriel.atlassian.net";

async function before(t: TestContext) {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-retire-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const made = join(top, "made.db");
  const first = await testApp(t, { db: made, jira: false });
  const workspaceId = first.app.workspaceId;
  await first.app.close();
  const notes = join(top, "notes");
  mkdirSync(notes);
  writeFileSync(join(notes, "plan.md"), "# Plan\n\nKiosk wallets first.\n");
  const db = open(made);
  migrate(db, loadMigrations(), t0);
  const store = connectionStore(db);
  const index = indexStore(db);
  const connected = new Map<SourceKind, { id: Ulid; identity: string; options: object }>();
  const kinds: [SourceKind, string, Record<string, unknown>][] = [
    ["jira", site, { project: "SYN" }],
    ["slack", "https://ferrowick-example.slack.com/", { channels: ["weather-disruptions"] }],
    ["sheets", "permission-0123", sources.sheets.fixture.connection().options],
    ["folder", notes, {}],
  ];
  for (const [n, [kind, identity, options]] of kinds.entries()) {
    const id = ulid(Date.parse(t0), new Uint8Array(10).fill(n + 1));
    const kept = store.connect(workspaceId, { id, kind, identity, options }, t0);
    assert.ok("connection" in kept);
    connected.set(kind, { id, identity, options });
    if (kind === "folder") continue;
    const items = await sources[kind as "jira"].fixture.load().connect(0);
    const sync = index.beginSync(workspaceId, kind, unknown, t0);
    sync.apply({ records: [...items.records], gone: [], cursor: null });
    sync.finish(null, t0);
    items.close();
  }
  db.close();
  const copy = (name: string) => {
    const path = join(top, `${name}.db`);
    copyFileSync(made, path);
    const secrets = join(top, "secrets", name);
    mkdirSync(secrets, { recursive: true });
    for (const { id } of connected.values())
      writeFileSync(join(secrets, `connection.${id}`), "a secret kept before");
    const saved = join(top, "secrets", "jira.json");
    writeFileSync(saved, "a saved connection");
    return { path, secrets, saved };
  };
  const records = (path: string, kind: SourceKind) => {
    const db = open(path);
    try {
      return indexStore(db)
        .records(workspaceId, kind, unknown)
        .map((record) => record.id)
        .toSorted();
    } finally {
      db.close();
    }
  };
  return { connected, copy, records, workspaceId, made };
}

const retired = (logged: readonly Logged[]) =>
  logged.filter((each) => each.message === "connections: secrets kept before retired");

test("the start retires every connection's secret and the saved one, once, and keeps the connections and their items", async (t) => {
  const old = await before(t);
  const { path, secrets, saved } = old.copy("live");
  const items = {
    jira: old.records(path, "jira"),
    slack: old.records(path, "slack"),
    sheets: old.records(path, "sheets"),
  };
  assert.ok(items.jira.length > 20 && items.slack.length > 0 && items.sheets.length > 0);
  const it = await testApp(t, {
    db: path,
    jira: false,
    retire: oldSecretFiles(join(secrets, "..")),
  });
  await it.app.settled();
  assert.equal(existsSync(secrets), false);
  assert.equal(existsSync(saved), false);
  assert.deepEqual(
    retired(it.logged).map((each) => each.fields),
    [{ deleted: 5 }],
  );
  const rows = connectionStore(open(path))
    .list(it.app.workspaceId)
    .filter((each) => each.kind !== "tracker");
  assert.deepEqual(
    rows.map((each) => [each.kind, each.id, each.identity, each.options, each.disconnectedAt]),
    [...old.connected]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([kind, each]) => [kind, each.id, each.identity, each.options, null]),
  );
  assert.deepEqual(
    (await it.connections()).connections.map((each) => [each.kind, each.state]),
    [
      ["folder", "open"],
      ["tracker", "open"],
    ],
  );
  assert.equal((await it.connection("folder"))?.id, old.connected.get("folder")?.id);
  await it.app.close();
  for (const kind of ["jira", "slack", "sheets"] as const)
    assert.deepEqual(old.records(path, kind), items[kind], kind);

  const again = await testApp(t, {
    db: path,
    jira: false,
    retire: oldSecretFiles(join(secrets, "..")),
  });
  await again.app.settled();
  assert.deepEqual(retired(again.logged), []);
  assert.equal((await again.connections()).connections.length, 2);
});

test("a folder for secrets that holds something else is kept, and only the connections' secrets go", async (t) => {
  const old = await before(t);
  const { path, secrets, saved } = old.copy("window");
  writeFileSync(join(secrets, "notes.txt"), "the person's own");
  const it = await testApp(t, {
    db: path,
    jira: false,
    retire: oldSecretFiles(join(secrets, "..")),
  });
  await it.app.settled();
  assert.deepEqual(readdirSync(secrets), ["notes.txt"]);
  assert.equal(existsSync(saved), false);
});

test("turned on through its server, a kind opens the connection it had before, under its ID, prefix and options", async (t) => {
  const old = await before(t);
  const { path, secrets } = old.copy("live");
  const jiraBefore = old.records(path, "jira");
  const it = await testApp(t, {
    db: path,
    atlassian: true,
    retire: oldSecretFiles(join(secrets, "..")),
  });
  assert.equal(await it.connection("jira"), null, "off until a person turns it on");
  assert.equal((await it.turnOn("jira")).status, 200);
  const jira = await it.connection("jira");
  const had = old.connected.get("jira");
  assert.deepEqual(
    [jira?.id, jira?.prefix, jira?.identity, jira?.options, jira?.through, jira?.state],
    [had?.id, "jira", site, { project: "SYN" }, "atlassian", "open"],
  );
  assert.match(jira?.about ?? "", /^SYN on oriel\.atlassian\.net, through /);
  const rows = it.app
    .window("epic")
    .clusters.flatMap((cluster) => cluster.list)
    .filter((row) => row.id.startsWith("jira:"))
    .map((row) => row.id);
  assert.ok(rows.length > 20);
  assert.ok(rows.every((id) => (jiraBefore as string[]).includes(id)));
  assert.deepEqual(
    jira?.picks.map((pick) => [pick.name, pick.picked]),
    [["project", ["SYN"]]],
  );
});

test("Jira and Slack turned on through their servers reuse the rows the window had, under number 1, and what held their items still finds them", async (t) => {
  const old = await before(t);
  const { path, secrets } = old.copy("live");
  const had = { jira: old.records(path, "jira"), slack: old.records(path, "slack") };
  const held = await (async () => {
    const db = open(path);
    try {
      const index = indexStore(db);
      const members = (["jira", "slack"] as const).map((kind) => {
        const record = index.records(old.workspaceId, kind, unknown)[0];
        assert.ok(record, kind);
        return { id: record.id, stableId: record.stableId };
      });
      const made = workstreamStore(db).create(
        {
          id: ulid(Date.parse(t0), new Uint8Array(10).fill(9)),
          workspaceId: old.workspaceId,
          name: "Both",
          origin: { kind: "picked" },
        },
        members,
        t0,
      );
      return { id: made.id, items: members.map((each) => each.id as string) };
    } finally {
      db.close();
    }
  })();
  const it = await testApp(t, {
    db: path,
    atlassian: true,
    slackServer: true,
    retire: oldSecretFiles(join(secrets, "..")),
  });
  for (const kind of ["jira", "slack"] as const) {
    assert.equal((await it.turnOn(kind)).status, 200, kind);
    const on = await it.connection(kind);
    assert.deepEqual(
      [on?.id, on?.number, on?.prefix, on?.state],
      [old.connected.get(kind)?.id, 1, kind, "open"],
      kind,
    );
  }
  await it.app.settled();
  const rows = connectionStore(open(path))
    .list(it.app.workspaceId)
    .filter((each) => each.kind === "jira" || each.kind === "slack");
  assert.deepEqual(
    rows.map((each) => [each.kind, each.number, each.identity.startsWith("through:")]),
    [
      ["jira", 1, false],
      ["slack", 1, false],
    ],
  );
  const workstream = json<{ members: { ref: { id: string }; row: unknown }[] }>(
    await it.get(`/api/workstreams/${held.id}`),
  );
  assert.deepEqual(
    workstream.members.map((member) => [member.ref.id, member.row !== null]),
    held.items.map((id) => [id, true]),
  );
  await it.app.close();
  for (const kind of ["jira", "slack"] as const) {
    const now = old.records(path, kind);
    assert.deepEqual(
      had[kind].filter((id) => !now.includes(id)),
      kind === "jira" ? ["jira:SYN-27"] : [],
      kind,
    );
    assert.ok(
      now.every((id) => id.startsWith(`${kind}:`)),
      kind,
    );
  }
});
