// A review-link holder's reason, held in a thread's chat until the person
// sends it on or discards it (decision 0024).
import assert from "node:assert/strict";
import { test } from "node:test";
import { instant, type Ulid, ulid } from "@oriel/core";
import { groupStore } from "./groups.ts";
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
  const groupId = id(1);
  groupStore(db).create(
    { id: groupId, workspaceId, name: "Checkout", origin: { kind: "picked" } },
    [{ id: "jira:SYN-1", stableId: "10001" }],
    t0,
  );
  const threads = threadStore(db);
  const threadId = id(2);
  threads.open({ id: threadId, workspaceId, groupId }, t0);
  return { threads, threadId };
}

test("a held reason waits on the person until it is settled, once", () => {
  const { threads, threadId } = fresh();
  const [first, second] = [id(10), id(11)];
  threads.append(threadId, { role: "user", text: "Rename SYN-1" }, id(20), t0);
  threads.append(
    threadId,
    { role: "held", changeSet: first, by: "Ana", text: "Wrong title.", asked: true },
    id(21),
    t0,
  );
  threads.append(
    threadId,
    { role: "held", changeSet: second, by: "Ben", text: "Too many.", asked: false },
    id(22),
    t0,
  );
  assert.deepEqual(
    threads.held(threadId).map((h) => [h.changeSet, h.by, h.text, h.asked, h.outcome]),
    [
      [first, "Ana", "Wrong title.", true, null],
      [second, "Ben", "Too many.", false, null],
    ],
  );
  assert.equal(threads.settle(threadId, first, "discarded"), true);
  assert.equal(threads.settle(threadId, first, "sent"), false);
  assert.deepEqual(
    threads.held(threadId).map((h) => h.changeSet),
    [second],
  );
  // The chat keeps it where it was, with what became of it.
  const chat = threads.messages(threadId);
  assert.deepEqual(
    chat.map((m) => (m.role === "held" ? [m.seq, m.outcome] : [m.seq, m.role])),
    [
      [1, "user"],
      [2, "discarded"],
      [3, null],
    ],
  );
  assert.equal(threads.settle(threadId, second, "sent"), true);
  assert.deepEqual(threads.held(threadId), []);
});

test("a held reason's name and text are capped, as a review link's holder types both", () => {
  const { threads, threadId } = fresh();
  const held = (by: string, text: string) => () =>
    threads.append(
      threadId,
      { role: "held", changeSet: id(10), by, text, asked: true },
      id(20 + by.length + text.length),
      t0,
    );
  assert.throws(held("A".repeat(121), "Too many."), RangeError);
  assert.throws(held("Ana", "x".repeat(2_001)), RangeError);
  assert.deepEqual(threads.messages(threadId), []);
  held("A".repeat(120), "x".repeat(2_000))();
  assert.equal(threads.held(threadId).length, 1);
});

test("0010 keeps every chat entry as it was", () => {
  const db = open(":memory:");
  const migrations = loadMigrations();
  const before = migrations.filter((m) => m.version < 10);
  migrate(db, before, t0);
  ensureWorkspace(db, { id: id(0), name: "test" }, t0);
  groupStore(db).create(
    { id: id(1), workspaceId: id(0), name: "Checkout", origin: { kind: "picked" } },
    [{ id: "jira:SYN-1", stableId: "10001" }],
    t0,
  );
  threadStore(db).open({ id: id(2), workspaceId: id(0), groupId: id(1) }, t0);
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
