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
    return changeSetId;
  };
  let decided = 0;
  // A decision on a change set, as the change set engine records one.
  const decide = (changeSetId: Ulid, kind: "approved" | "rejected", at: Instant) =>
    db
      .prepare(
        "insert into decisions (id, workspace_id, change_set_id, seq, kind, via, review_link, by_name, hash, at) values (?, ?, ?, ?, ?, 'thread', null, '', '', ?)",
      )
      .run(id(500 + ++decided), workspaceId, changeSetId, decided, kind, at);
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
    decide,
    state,
  };
}

test("a change set applied in full makes it done; one partly applied doesn't, until it's dismissed", () => {
  const { changeSet, decide, state } = fresh();
  const partly = changeSet([
    { after: { points: 3 }, at: after(1000) },
    { after: { points: 5 }, at: null },
  ]);
  decide(partly, "approved", after(500));
  assert.deepEqual(state(after(2000)), ["working", null]);
  // The rest of the first still awaits review, so the second settles nothing.
  changeSet([{ after: { points: 3, updated: after(3000) }, at: after(3000) }]);
  assert.deepEqual(state(after(4000)), ["working", null]);
  decide(partly, "rejected", after(5000));
  assert.deepEqual(state(after(6000)), ["done", "applied"]);
});

test("a rejection undone puts its change set back awaiting review, so the thread isn't done", () => {
  const { db, changeSet, decide, state } = fresh();
  const rejected = changeSet([{ after: { points: 5 }, at: null }]);
  decide(rejected, "rejected", after(500));
  changeSet([{ after: { points: 3 }, at: after(1000) }]);
  assert.deepEqual(state(after(2000)), ["done", "applied"]);
  db.prepare("update decisions set undone_at = ? where change_set_id = ?").run(
    after(2500),
    rejected,
  );
  assert.deepEqual(state(after(3000)), ["working", null]);
});

test("of two change sets, applying one leaves the thread working while the other awaits review", () => {
  const pending = { after: { points: 3 }, at: null };
  const apply = (db: ReturnType<typeof fresh>["db"], changeSetId: Ulid, at: Instant) =>
    db.prepare("update mutations set status = 'applied', applied = ? where change_set_id = ?").run(
      JSON.stringify({
        item: { id: "jira:SYN-1", stableId: "10001" },
        before: {},
        after: { points: 3 },
        at,
      }),
      changeSetId,
    );
  // Decided in either order: done only once both have applied.
  for (const order of ["earlier first", "later first"]) {
    const { db, changeSet, decide, state } = fresh();
    const earlier = changeSet([pending]);
    const later = changeSet([pending]);
    const [first, second] = order === "earlier first" ? [earlier, later] : [later, earlier];
    decide(first, "approved", after(1000));
    apply(db, first, after(1500));
    assert.deepEqual(state(after(2000)), ["working", null], order);
    decide(second, "approved", after(3000));
    // Decided and not yet applied: it is being applied.
    assert.deepEqual(state(after(3200)), ["working", null], order);
    apply(db, second, after(3500));
    assert.deepEqual(state(after(4000)), ["done", "applied"], order);
  }
  // One approved, the other rejected, in either order: done.
  for (const order of ["reject first", "approve first"]) {
    const { db, changeSet, decide, state } = fresh();
    const kept = changeSet([pending]);
    const dropped = changeSet([pending]);
    const approve = (at: number) => {
      decide(kept, "approved", after(at));
      apply(db, kept, after(at + 500));
    };
    if (order === "reject first") decide(dropped, "rejected", after(1000));
    else approve(1000);
    assert.deepEqual(state(after(2000)), ["working", null], order);
    if (order === "reject first") approve(3000);
    else decide(dropped, "rejected", after(3000));
    assert.deepEqual(state(after(4000)), ["done", "applied"], order);
  }
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
