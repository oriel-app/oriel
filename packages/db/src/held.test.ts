import assert from "node:assert/strict";
import { test } from "node:test";
import { instant, type Ulid, ulid } from "@oriel/core";
import { workstreamStore } from "./workstreams.ts";
import { loadMigrations, migrate } from "./migrate.ts";
import { open } from "./open.ts";
import { threadStore } from "./threads.ts";
import { ensureWorkspace } from "./workspaces.ts";

const t0 = instant(new Date(Date.UTC(2026, 10, 1, 9)));
const id = (n: number): Ulid => ulid(n, new Uint8Array(10));

function fresh() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = id(0);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const workstreamId = id(1);
  workstreamStore(db).create(
    { id: workstreamId, workspaceId, name: "Checkout", origin: { kind: "picked" } },
    [{ id: "jira:SYN-1", stableId: "10001" }],
    t0,
  );
  const threads = threadStore(db);
  const threadId = id(2);
  threads.open({ id: threadId, workspaceId, workstreamId }, t0);
  return { threads, threadId };
}

const fromLink = (by: string, changeSet: Ulid, askFirst = false) =>
  ({ kind: "review-link", by, changeSet, askFirst }) as const;

test("a held message waits on the user until it is settled, once, by its place in the chat", () => {
  const { threads, threadId } = fresh();
  const [first, second] = [id(10), id(11)];
  threads.append(threadId, { role: "user", text: "Rename SYN-1" }, id(20), t0);
  threads.append(
    threadId,
    { role: "held", from: fromLink("Ana", first), text: "Wrong title." },
    id(21),
    t0,
  );
  threads.append(
    threadId,
    { role: "held", from: fromLink("Ben", second, true), text: "Too many." },
    id(22),
    t0,
  );
  assert.deepEqual(
    threads.held(threadId).map((h) => ("from" in h ? [h.seq, h.from, h.text, h.outcome] : h)),
    [
      [2, fromLink("Ana", first), "Wrong title.", null],
      [3, fromLink("Ben", second, true), "Too many.", null],
    ],
  );
  assert.equal(threads.settle(threadId, 2, "discarded"), true);
  assert.equal(threads.settle(threadId, 2, "sent"), false);
  assert.equal(threads.settle(threadId, 1, "sent"), false);
  assert.deepEqual(
    threads.held(threadId).map((h) => h.seq),
    [3],
  );
  const chat = threads.messages(threadId);
  assert.deepEqual(
    chat.map((m) => (m.role === "held" ? [m.seq, m.outcome] : [m.seq, m.role])),
    [
      [1, "user"],
      [2, "discarded"],
      [3, null],
    ],
  );
  assert.equal(threads.settle(threadId, 3, "sent"), true);
  assert.deepEqual(threads.held(threadId), []);
});

test("a draft is held as a held message is, and only applied or discarded (decision 0051)", () => {
  const { threads, threadId } = fresh();
  const draft = {
    action: "source.configure",
    input: { connection: id(30), options: { channels: ["weather-disruptions"] } },
  } as const;
  const over = { channels: ["weather-disruptions", "launch-room"] };
  threads.append(threadId, { role: "held", draft, over }, id(21), t0);
  threads.append(threadId, { role: "held", draft, over }, id(22), t0);
  assert.deepEqual(
    threads.held(threadId).map((h) => ("draft" in h ? [h.seq, h.draft, h.over, h.outcome] : h)),
    [
      [1, draft, over, null],
      [2, draft, over, null],
    ],
  );
  assert.equal(threads.settle(threadId, 1, "sent"), false);
  assert.equal(threads.settle(threadId, 1, "applied"), true);
  assert.equal(threads.settle(threadId, 2, "discarded"), true);
  assert.deepEqual(threads.held(threadId), []);
  assert.deepEqual(
    threads.messages(threadId).map((m) => (m.role === "held" ? m.outcome : m.role)),
    ["applied", "discarded"],
  );
  assert.throws(
    () =>
      threads.append(
        threadId,
        { role: "held", draft: { action: "source.connect", input: {} } as never, over: null },
        id(23),
        t0,
      ),
    RangeError,
  );
  threads.append(
    threadId,
    { role: "held", from: fromLink("Ana", id(10)), text: "No." },
    id(24),
    t0,
  );
  assert.equal(threads.settle(threadId, 3, "applied"), false);
});

test("a review link's holder's name and reason are capped, as they type both", () => {
  const { threads, threadId } = fresh();
  const held = (by: string, text: string) => () =>
    threads.append(
      threadId,
      { role: "held", from: fromLink(by, id(10)), text },
      id(20 + by.length + text.length),
      t0,
    );
  assert.throws(held("A".repeat(121), "Too many."), RangeError);
  assert.throws(held("Ana", "x".repeat(2_001)), RangeError);
  assert.deepEqual(threads.messages(threadId), []);
  held("A".repeat(120), "x".repeat(2_000))();
  assert.equal(threads.held(threadId).length, 1);
});

const oldWorkstreamAndThread = (db: ReturnType<typeof open>) =>
  db.exec(`
    insert into groups values ('${id(1)}', '${id(0)}', 'Checkout', '{"kind":"picked"}', '${t0}');
    insert into group_changes values ('${id(0)}', '${id(1)}', 1, '${t0}', '{"kind":"user"}');
    insert into group_members values ('${id(0)}', '${id(1)}', 'jira', '10001', 'jira:SYN-1', 1, null);
    insert into threads (id, workspace_id, group_id, region_version, created_at)
      values ('${id(2)}', '${id(0)}', '${id(1)}', 1, '${t0}');
  `);

test("0011 moves what a review link's holder sent under who it is from, and whether Oriel asks first", () => {
  const db = open(":memory:");
  const migrations = loadMigrations();
  migrate(
    db,
    migrations.filter((m) => m.version < 11),
    t0,
  );
  ensureWorkspace(db, { id: id(0), name: "test" }, t0);
  oldWorkstreamAndThread(db);
  const insert = db.prepare(
    "insert into messages (id, workspace_id, thread_id, seq, role, content, at) values (?, ?, ?, ?, ?, ?, ?)",
  );
  const was = (changeSet: Ulid, asked: boolean, outcome: string | null) =>
    JSON.stringify({ changeSet, by: "Ana", text: "Wrong title.", asked, outcome });
  insert.run(id(20), id(0), id(2), 1, "user", '{"text":"hi"}', t0);
  insert.run(id(21), id(0), id(2), 2, "held", was(id(10), true, "sent"), t0);
  insert.run(id(22), id(0), id(2), 3, "held", was(id(11), false, null), t0);
  migrate(db, migrations, t0);
  const chat = threadStore(db).messages(id(2));
  assert.deepEqual(
    chat.map((m) => (m.role === "held" && "from" in m ? [m.from, m.text, m.outcome] : m.role)),
    [
      "user",
      [fromLink("Ana", id(10)), "Wrong title.", "sent"],
      [fromLink("Ana", id(11), true), "Wrong title.", null],
    ],
  );
});

test("0010 keeps every chat entry as it was", () => {
  const db = open(":memory:");
  const migrations = loadMigrations();
  const before = migrations.filter((m) => m.version < 10);
  migrate(db, before, t0);
  ensureWorkspace(db, { id: id(0), name: "test" }, t0);
  oldWorkstreamAndThread(db);
  const insert = db.prepare(
    "insert into messages (id, workspace_id, thread_id, seq, role, content, at) values (?, ?, ?, ?, ?, ?, ?)",
  );
  insert.run(id(20), id(0), id(2), 1, "user", '{"text":"hi"}', t0);
  insert.run(id(21), id(0), id(2), 2, "agent", '{"kind":"text","text":"Hello."}', t0);
  insert.run(id(22), id(0), id(2), 3, "marker", '{"from":1,"to":2}', t0);
  assert.throws(() => insert.run(id(23), id(0), id(2), 4, "held", "{}", t0), /CHECK/);
  const rows = () =>
    db
      .prepare("select id, seq, role, content, at from messages order by seq")
      .all()
      .map((row) => ({ ...row }));
  const kept = rows();
  migrate(db, migrations, t0);
  assert.deepEqual(rows(), kept);
  assert.equal(threadStore(db).messages(id(2)).length, 3);
});
