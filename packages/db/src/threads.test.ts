import assert from "node:assert/strict";
import { test } from "node:test";
import { type Instant, instant, type Ulid, ulid } from "@oriel/core";
import { workstreamStore } from "./workstreams.ts";
import { loadMigrations, migrate } from "./migrate.ts";
import { open } from "./open.ts";
import { threadStore } from "./threads.ts";
import { ensureWorkspace } from "./workspaces.ts";

const t0 = instant(new Date(Date.UTC(2026, 9, 29, 9)));
const day = 24 * 60 * 60 * 1000;
const after = (ms: number): Instant => instant(new Date(Date.parse(t0) + ms));
const id = (n: number): Ulid => ulid(n, new Uint8Array(10));

// A workspace with a workstream of two items at version 1, and a thread on it.
function fresh() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = id(0);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const workstreams = workstreamStore(db);
  const workstreamId = id(1);
  workstreams.create(
    { id: workstreamId, workspaceId, name: "Checkout", origin: { kind: "picked" } },
    [
      { id: "jira:SYN-1", stableId: "10001" },
      { id: "jira:SYN-2", stableId: "10002" },
    ],
    t0,
  );
  const threads = threadStore(db);
  const threadId = id(2);
  threads.open({ id: threadId, workspaceId, workstreamId }, t0);
  let seq = 0;
  const message = (at: Instant) =>
    db
      .prepare(
        "insert into messages (id, workspace_id, thread_id, seq, role, content, at) values (?, ?, ?, ?, 'user', '\"hi\"', ?)",
      )
      .run(id(100 + ++seq), workspaceId, threadId, seq, at);
  // A change set with one mutation per `after`, applied at `at` unless null.
  const changeSet = (mutations: { after: Record<string, unknown>; at: Instant | null }[]) => {
    const changeSetId = id(200 + ++seq);
    db.prepare(
      "insert into change_sets (id, workspace_id, thread_id, run_id, revert_of, created_at) values (?, ?, ?, null, null, ?)",
    ).run(changeSetId, workspaceId, threadId, t0);
    mutations.forEach((m, i) =>
      db
        .prepare(
          "insert into mutations (id, workspace_id, change_set_id, seq, op, target, args, status, applied) values (?, ?, ?, ?, 'op', 'jira:SYN-1', '{}', ?, ?)",
        )
        .run(
          id(300 + ++seq),
          workspaceId,
          changeSetId,
          i + 1,
          m.at === null ? "pending" : "applied",
          m.at === null
            ? null
            : JSON.stringify({
                item: { id: "jira:SYN-1", stableId: "10001" },
                before: {},
                after: m.after,
                at: m.at,
              }),
        ),
    );
  };
  const state = (now: Instant) => {
    const thread = threads.get(threadId, now);
    return [thread?.state, thread?.doneBy];
  };
  return {
    db,
    workstreams,
    workstreamId,
    threads,
    threadId,
    workspaceId,
    message,
    changeSet,
    state,
  };
}

test("a new thread is working, in its workstream's latest version", () => {
  const { workstreams, workstreamId, threads, workspaceId, state } = fresh();
  assert.deepEqual(state(t0), ["working", null]);
  workstreams.add(
    workstreamId,
    [{ id: "jira:SYN-3", stableId: "10003" }],
    { kind: "user" },
    after(1),
  );
  threads.open({ id: id(9), workspaceId, workstreamId }, after(2));
  assert.equal(threads.get(id(9), after(2))?.regionVersion, 2);
  assert.throws(
    () => threads.open({ id: id(10), workspaceId, workstreamId: id(99) }, t0),
    /no workstream/,
  );
});

test("a change set applied in full makes it done; one partly applied doesn't", () => {
  const { changeSet, state } = fresh();
  changeSet([
    { after: { points: 3 }, at: after(1000) },
    { after: { points: 5 }, at: null },
  ]);
  assert.deepEqual(state(after(2000)), ["working", null]);
  changeSet([{ after: { points: 3, updated: after(3000) }, at: after(3000) }]);
  assert.deepEqual(state(after(4000)), ["done", "applied"]);
});

test("the user can mark it done, and a later message makes it working again", () => {
  const { threads, threadId, message, state } = fresh();
  threads.markDone(threadId, after(1000));
  assert.deepEqual(state(after(2000)), ["done", "marked"]);
  // Still done long after: a settled thread isn't dropped.
  assert.deepEqual(state(after(30 * day)), ["done", "marked"]);
  message(after(3000));
  assert.deepEqual(state(after(4000)), ["working", null]);
  assert.throws(() => threads.markDone(id(99), t0), /no thread/);
});

test("an applied assignee change or attached link hands it off; a removed link doesn't", () => {
  const assigned = fresh();
  assigned.changeSet([{ after: { assignee: "amara" }, at: after(1000) }]);
  assert.deepEqual(assigned.state(after(2000)), ["handed-off", null]);
  const linked = fresh();
  linked.changeSet([
    { after: { "link:10100": { url: "https://x", title: "x" } }, at: after(1000) },
  ]);
  assert.deepEqual(linked.state(after(2000)), ["handed-off", null]);
  const unlinked = fresh();
  unlinked.changeSet([{ after: { "link:10100": null }, at: after(1000) }]);
  assert.deepEqual(unlinked.state(after(2000)), ["done", "applied"]);
});

test("a change set settles the thread when it completes, whatever its mutations' order", () => {
  const assign = (at: Instant | null) => ({ after: { assignee: "amara" }, at });
  const estimate = (at: Instant | null) => ({ after: { points: 3 }, at });
  for (const mutations of [
    [assign(after(1000)), estimate(after(2000))],
    [estimate(after(1000)), assign(after(2000))],
  ]) {
    const { changeSet, state } = fresh();
    changeSet(mutations);
    assert.deepEqual(state(after(3000)), ["handed-off", null]);
  }
  // Partly applied, it settles nothing; once it completes, it hands off.
  const { db, changeSet, state } = fresh();
  changeSet([assign(after(1000)), estimate(null)]);
  assert.deepEqual(state(after(3000)), ["working", null]);
  db.prepare("update mutations set status = 'applied', applied = ? where status = 'pending'").run(
    JSON.stringify({
      item: { id: "jira:SYN-1", stableId: "10001" },
      before: {},
      after: { points: 3 },
      at: after(4000),
    }),
  );
  assert.deepEqual(state(after(5000)), ["handed-off", null]);
  // A later set that hands nothing off makes it done.
  changeSet([estimate(after(6000))]);
  assert.deepEqual(state(after(7000)), ["done", "applied"]);
});

test("of two settlings the later counts", () => {
  const { threads, threadId, changeSet, state } = fresh();
  changeSet([{ after: { assignee: "amara" }, at: after(1000) }]);
  threads.markDone(threadId, after(2000));
  assert.deepEqual(state(after(3000)), ["done", "marked"]);
});

test("a thread 0002 carried over from a region derives its state like any other", () => {
  const db = open(":memory:");
  const [first, ...rest] = loadMigrations();
  assert.ok(first);
  migrate(db, [first], t0);
  const [w, r, t] = [id(0), id(1), id(2)];
  db.exec(`
    insert into workspaces values ('${w}', 'test', '${t0}');
    insert into regions values ('${r}', '${w}', '{"kind":"picked"}', 1, '${t0}');
    insert into threads values ('${t}', '${w}', '${r}', '${t0}');
  `);
  migrate(db, [first, ...rest], t0);
  const thread = threadStore(db).get(t, after(1000));
  assert.deepEqual(
    [thread?.state, thread?.doneBy, thread?.workstreamId, thread?.regionVersion],
    ["working", null, r, 1],
  );
  assert.equal(threadStore(db).get(t, after(8 * day))?.state, "dropped");
});

test("a working thread is dropped after 7 idle days, and activity resets the clock", () => {
  const { message, state } = fresh();
  assert.deepEqual(state(after(7 * day - 1)), ["working", null]);
  assert.deepEqual(state(after(7 * day)), ["dropped", null]);
  message(after(6 * day));
  assert.deepEqual(state(after(7 * day)), ["working", null]);
  assert.deepEqual(state(after(13 * day)), ["dropped", null]);
});

test("reopening takes the done mark off, leaving whatever else settled it", () => {
  const { db, threads, threadId, changeSet, state } = fresh();
  assert.equal(threads.reopen(threadId), false);
  threads.markDone(threadId, after(1000), { kind: "agent", threadId });
  assert.equal(threads.reopen(threadId), true);
  assert.deepEqual(state(after(2000)), ["working", null]);
  assert.equal(db.prepare("select count(*) as n from done_marks").get()?.["n"], 0);
  changeSet([{ after: { points: 3 }, at: after(3000) }]);
  threads.markDone(threadId, after(4000));
  threads.reopen(threadId);
  assert.deepEqual(state(after(5000)), ["done", "applied"]);
});

test("an agent event is rewritten in place; nothing else is", () => {
  const { threads, threadId } = fresh();
  const seq = threads.append(threadId, { role: "agent", event: { kind: "a" } }, id(50), t0);
  assert.equal(threads.rewrite(threadId, seq, { kind: "b" }), true);
  assert.deepEqual(threads.messages(threadId).at(-1), {
    seq,
    at: t0,
    role: "agent",
    event: { kind: "b" },
  });
  const said = threads.append(threadId, { role: "user", text: "hi" }, id(51), after(1));
  assert.equal(threads.rewrite(threadId, said, { kind: "c" }), false);
});

test("marking a thread done again keeps who marked it, and when; reopened or working again, it takes a new mark", () => {
  const { db, threads, threadId, message } = fresh();
  const agent = { kind: "agent", threadId } as const;
  const mark = () => {
    const row = db.prepare("select marked_by from done_marks where thread_id = ?").get(threadId) as
      | { marked_by: string }
      | undefined;
    const thread = db.prepare("select marked_done_at from threads where id = ?").get(threadId) as {
      marked_done_at: string | null;
    };
    return [row && JSON.parse(row.marked_by), thread.marked_done_at];
  };
  assert.equal(threads.markDone(threadId, after(1000)), true);
  assert.equal(threads.markDone(threadId, after(2000), agent), false);
  assert.deepEqual(mark(), [{ kind: "user" }, after(1000)]);
  // Reopened in between, the agent's is a new mark.
  assert.equal(threads.reopen(threadId, after(1000)), true);
  assert.equal(threads.markDone(threadId, after(3000), agent), true);
  assert.deepEqual(mark(), [agent, after(3000)]);
  // Working again since, as a message makes it, the user's is a new mark.
  message(after(4000));
  assert.equal(threads.markDone(threadId, after(5000)), true);
  assert.deepEqual(mark(), [{ kind: "user" }, after(5000)]);
});
