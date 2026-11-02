// Oriel's own lines in a thread are notes, never the agent's text (OA-91).
import assert from "node:assert/strict";
import { test } from "node:test";
import { instant, type Ulid, ulid } from "@oriel/core";
import { loadMigrations, migrate } from "./migrate.ts";
import { open } from "./open.ts";
import { threadStore } from "./threads.ts";
import { ensureWorkspace } from "./workspaces.ts";
import { workstreamStore } from "./workstreams.ts";

const t0 = instant(new Date(Date.UTC(2026, 10, 1, 9)));
const at = (minutes: number) => instant(new Date(Date.parse(t0) + minutes * 60_000));
const id = (n: number): Ulid => ulid(n, new Uint8Array(10));

const asked = (who: string) =>
  JSON.stringify({
    kind: "text",
    text: `${who}, so nothing in it will change. What was wrong with it? Say what to change, and I'll propose a revised one.`,
  });

test("0013 turns each line Oriel wrote after a rejection into a note naming the change set, and keeps everything else", () => {
  const db = open(":memory:");
  const migrations = loadMigrations();
  migrate(
    db,
    migrations.filter((m) => m.version < 13),
    t0,
  );
  const workspaceId = id(0);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  workstreamStore(db).create(
    { id: id(1), workspaceId, name: "Checkout", origin: { kind: "picked" } },
    [{ id: "jira:SYN-1", stableId: "10001" }],
    t0,
  );
  const threadId = id(2);
  threadStore(db).open({ id: threadId, workspaceId, workstreamId: id(1) }, t0);
  db.exec(`
    insert into change_sets (id, workspace_id, thread_id, created_at) values
      ('${id(10)}', '${workspaceId}', '${threadId}', '${t0}'),
      ('${id(11)}', '${workspaceId}', '${threadId}', '${t0}');
    insert into change_sets (id, workspace_id, thread_id, revert_of, created_at)
      values ('${id(12)}', '${workspaceId}', '${threadId}', '${id(10)}', '${t0}');
    insert into review_links (token_hash, workspace_id, change_set_id, created_at)
      values ('h', '${workspaceId}', '${id(11)}', '${t0}');
    insert into decisions (id, workspace_id, change_set_id, seq, kind, via, review_link, by_name, hash, at) values
      ('${id(20)}', '${workspaceId}', '${id(10)}', 1, 'rejected', 'thread', null, 'pm', 'x', '${at(1)}'),
      ('${id(21)}', '${workspaceId}', '${id(11)}', 1, 'rejected', 'review-link', 'h', 'Ana', 'x', '${at(3)}'),
      ('${id(22)}', '${workspaceId}', '${id(12)}', 1, 'rejected', 'thread', null, 'pm', 'x', '${at(6)}');
  `);
  const insert = db.prepare(
    "insert into messages (id, workspace_id, thread_id, seq, role, content, at) values (?, ?, ?, ?, ?, ?, ?)",
  );
  const done = '{"kind":"done","usage":{"inputTokens":0,"outputTokens":0}}';
  const rows: [string, string, string][] = [
    ["user", '{"text":"Rename SYN-23"}', t0],
    ["agent", '{"kind":"text","text":"I proposed a new title."}', t0],
    ["agent", done, t0],
    ["agent", asked("You rejected this change set"), at(1)],
    ["agent", done, at(1)],
    // Before #72, a review link's holder was named.
    ["agent", asked("Ana rejected this change set"), at(3)],
    ["agent", asked("This change set was rejected on its review link"), at(4)],
    // The agent's own words, even about a rejection, stay its own.
    ["agent", '{"kind":"text","text":"You rejected this change set, so I will stop."}', at(5)],
    // Oriel never asked about an Undo, nor about a review link's rejection
    // in the user's words.
    ["agent", asked("You rejected this change set"), at(7)],
  ];
  rows.forEach(([role, content, when], i) =>
    insert.run(id(30 + i), workspaceId, threadId, i + 1, role, content, when),
  );
  migrate(db, migrations, t0);
  const chat = threadStore(db).messages(threadId);
  assert.deepEqual(
    chat.map((m) =>
      m.role === "note"
        ? [m.note.changeSet, m.note.via]
        : m.role === "agent"
          ? Reflect.get(Object(m.event), "kind")
          : m.role,
    ),
    [
      "user",
      "text",
      "done",
      [id(10), "thread"],
      "done",
      [id(11), "review-link"],
      [id(11), "review-link"],
      "text",
      [id(10), "thread"],
    ],
  );
  // Each entry keeps its place and time.
  assert.deepEqual(
    chat.map((m) => [m.seq, m.at]),
    rows.map(([, , when], i) => [i + 1, when]),
  );
});

test("a note's shape is checked as it is stored", () => {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = id(0);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  workstreamStore(db).create(
    { id: id(1), workspaceId, name: "Checkout", origin: { kind: "picked" } },
    [{ id: "jira:SYN-1", stableId: "10001" }],
    t0,
  );
  const threads = threadStore(db);
  threads.open({ id: id(2), workspaceId, workstreamId: id(1) }, t0);
  const note = { kind: "rejected", changeSet: id(10), via: "thread" } as const;
  const seq = threads.append(id(2), { role: "note", note }, id(3), t0);
  assert.deepEqual(threads.messages(id(2)), [{ seq, at: t0, role: "note", note }]);
});
