// The dispatcher of Oriel's own actions (decision 0024): it checks input,
// refuses an actor its class or doors rule out, records who acted, counts
// each call once and publishes once, and a direct action gives back the call
// that undoes what it actually changed.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Actor,
  actions,
  type GroupMember,
  type IndexRecord,
  instant,
  shapeOf,
  type TelemetryEvent,
  typeText,
  ulid,
  type Ulid,
} from "@oriel/core";
import { ensureWorkspace, groupStore, loadMigrations, migrate, open, threadStore } from "@oriel/db";
import { ActionError, type Changed, dispatcher, refusal } from "./actions.ts";

const t0 = instant(new Date(Date.UTC(2026, 9, 29, 9)));
const id = (n: number) => ulid(n, new Uint8Array(10));
const m = (key: string, stableId: string): GroupMember => ({ id: `jira:${key}`, stableId });
const user: Actor = { kind: "user" };

// A workspace with a group holding SYN-1 and SYN-2, a working thread on it,
// and SYN-3 in the index besides. A change set (id 50) created SYN-9, which
// the index doesn't have yet.
function world() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = id(0);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const groups = groupStore(db);
  const threads = threadStore(db);
  const groupId = id(1);
  const threadId = id(2);
  const changeSetId = id(50);
  groups.create(
    { id: groupId, workspaceId, name: "Launch", origin: { kind: "picked" } },
    [m("SYN-1", "10001"), m("SYN-2", "10002")],
    t0,
  );
  threads.open({ id: threadId, workspaceId, groupId }, t0);
  // Only what group membership reads of a record.
  const records = [m("SYN-1", "10001"), m("SYN-2", "10002"), m("SYN-3", "10003")].map(
    (member) => member as unknown as IndexRecord,
  );
  const events: TelemetryEvent[] = [];
  const published: Changed[] = [];
  let next = 100;
  const dispatch = dispatcher({
    workspaceId,
    groups,
    threads,
    records: () => records,
    clusters: () => [],
    created: async (set) => (set === changeSetId ? [m("SYN-9", "10009")] : []),
    emit: (event) => events.push(event),
    publish: (changed) => published.push(changed),
    now: () => t0,
    newId: () => id(next++),
  });
  const held = () =>
    groups.region(groupId, groups.get(groupId)?.version ?? 1)?.items.map((item) => item.id);
  return { db, dispatch, groups, groupId, threadId, changeSetId, events, published, held };
}

const refused = (code: ActionError["code"]) => (error: unknown) =>
  error instanceof ActionError && error.code === code;

test("adding what's already there undoes as removing only what was new", async () => {
  const w = world();
  const added = await w.dispatch(
    "group.add",
    { group: w.groupId, items: ["jira:SYN-1", "jira:SYN-3"] },
    user,
  );
  assert.deepEqual(added.added, ["jira:SYN-3"]);
  assert.deepEqual(added.undo, {
    action: "group.remove",
    input: { group: w.groupId, items: ["jira:SYN-3"] },
  });
  assert.ok(added.undo);
  const undone = await w.dispatch(added.undo.action, added.undo.input, user);
  assert.deepEqual(w.held(), ["jira:SYN-1", "jira:SYN-2"]);
  // And the undo's own undo adds it back: Undo and Redo are one thing.
  assert.deepEqual(undone.undo, added.undo && { ...added.undo, action: "group.add" });
  // Nothing new to add changes nothing, so nothing undoes it.
  const again = await w.dispatch("group.add", { group: w.groupId, items: ["jira:SYN-1"] }, user);
  assert.equal(again.undo, null);
});

test("a removal undoes as adding back what the index still has", async () => {
  const w = world();
  const removed = await w.dispatch(
    "group.remove",
    { group: w.groupId, items: ["jira:SYN-2"] },
    user,
  );
  assert.deepEqual(removed.undo, {
    action: "group.add",
    input: { group: w.groupId, items: ["jira:SYN-2"] },
  });
  // SYN-9 joined from a change set; the index doesn't have it, so once it's
  // removed it can't come back.
  await w.dispatch(
    "group.add",
    { group: w.groupId, items: ["jira:SYN-9"] },
    { kind: "change-set", changeSetId: w.changeSetId },
  );
  const gone = await w.dispatch("group.remove", { group: w.groupId, items: ["jira:SYN-9"] }, user);
  assert.equal(gone.undo, null);
});

test("a rename undoes as renaming it back, to whoever named it; one that changes nothing has no undo", async () => {
  const w = world();
  const named = () => {
    const group = w.groups.get(w.groupId);
    return [group?.name, group?.namedBy];
  };
  // Oriel named it; once the user does, Oriel can't, until the Undo gives
  // the name back.
  assert.deepEqual(named(), ["Launch", "oriel"]);
  const renamed = await w.dispatch("group.rename", { group: w.groupId, name: " Beta " }, user);
  assert.deepEqual(named(), ["Beta", "user"]);
  assert.deepEqual(renamed.undo, {
    action: "group.rename",
    input: { group: w.groupId, name: "Launch", oriel: true },
  });
  assert.ok(renamed.undo);
  const redo = await w.dispatch(renamed.undo.action, renamed.undo.input, user);
  assert.deepEqual(named(), ["Launch", "oriel"]);
  const changeSet: Actor = { kind: "change-set", changeSetId: w.changeSetId };
  await w.dispatch("group.rename", { group: w.groupId, name: "Kiosk wallets" }, changeSet);
  assert.deepEqual(named(), ["Kiosk wallets", "oriel"]);
  // Redone, the name is the user's again, and Oriel's naming leaves it be.
  assert.deepEqual(redo.undo, {
    action: "group.rename",
    input: { group: w.groupId, name: "Beta" },
  });
  await w.dispatch("group.rename", { group: w.groupId, name: "Beta" }, user);
  const same = await w.dispatch("group.rename", { group: w.groupId, name: "Beta" }, user);
  assert.equal(same.undo, null);
  await w.dispatch("group.rename", { group: w.groupId, name: "Other" }, changeSet);
  assert.deepEqual(named(), ["Beta", "user"]);
});

test("who acted is in the group's log, the done record and telemetry", async () => {
  const w = world();
  const agent: Actor = { kind: "agent", threadId: w.threadId };
  await w.dispatch("group.add", { group: w.groupId, items: ["jira:SYN-3"] }, agent);
  await w.dispatch("group.remove", { group: w.groupId, items: ["jira:SYN-1"] }, user);
  assert.deepEqual(
    w.groups.changes(w.groupId, 1).map((change) => change.cause),
    [agent, user],
  );
  await w.dispatch("thread.done", { thread: w.threadId }, agent);
  const mark = w.db
    .prepare("select marked_by from done_marks where thread_id = ?")
    .get(w.threadId) as { marked_by: string };
  assert.deepEqual(JSON.parse(mark.marked_by), agent);
  const { group: made } = await w.dispatch(
    "group.create",
    { kind: "picked", name: "Risks", items: ["jira:SYN-2"] },
    agent,
  );
  assert.deepEqual(w.groups.changes(made, 0)[0]?.cause, agent);
  // Each call counted once: by its SPEC §7 event, naming anyone but the
  // user, or by `action.called`.
  assert.deepEqual(
    w.events.map(({ at: _at, workspaceId: _ws, ...event }) => event),
    [
      { name: "group.item-added", groupId: w.groupId, source: "jira", cause: "agent" },
      { name: "action.called", action: "group.remove", by: user },
      // The agent closed nothing in the window.
      { name: "thread.marked-done", threadId: w.threadId, by: agent },
      { name: "group.created", groupId: made, origin: "picked", size: 1, by: agent },
    ],
  );
});

test("each call publishes once, and only what changed", async () => {
  const w = world();
  await w.dispatch("group.add", { group: w.groupId, items: ["jira:SYN-3"] }, user);
  await w.dispatch("group.add", { group: w.groupId, items: ["jira:SYN-3"] }, user);
  await w.dispatch("group.rename", { group: w.groupId, name: "Beta" }, user);
  await w.dispatch("thread.done", { thread: w.threadId }, user);
  assert.deepEqual(w.published, [
    { group: w.groupId, members: true },
    { group: w.groupId, members: false },
    { thread: w.threadId },
  ]);
});

test("a change set adds what it created before the index has it; no one else can", async () => {
  const w = world();
  const input = { group: w.groupId, items: ["jira:SYN-9"] };
  await assert.rejects(w.dispatch("group.add", input, user), refused("invalid"));
  await assert.rejects(
    w.dispatch("group.add", input, { kind: "agent", threadId: w.threadId }),
    refused("invalid"),
  );
  await w.dispatch("group.add", input, { kind: "change-set", changeSetId: w.changeSetId });
  assert.deepEqual(w.held(), ["jira:SYN-1", "jira:SYN-2", "jira:SYN-9"]);
});

test("bad input, a missing group or thread, and a review link's holder are refused", async () => {
  const w = world();
  await assert.rejects(
    w.dispatch("group.remove", { group: w.groupId, items: [] }, user),
    (error) =>
      refused("invalid")(error) &&
      error instanceof Error &&
      error.message === "$.items: expected 1 to 500 items",
  );
  await assert.rejects(
    w.dispatch("group.remove", { group: w.groupId, items: ["jira:SYN-3"] }, user),
    refused("invalid"),
  );
  await assert.rejects(
    w.dispatch("group.rename", { group: id(99), name: "x" }, user),
    refused("not-found"),
  );
  await assert.rejects(w.dispatch("thread.done", { thread: id(99) }, user), refused("not-found"));
  await assert.rejects(
    w.dispatch("group.rename", { group: w.groupId, name: "x" }, { kind: "review-link", by: "Kim" }),
    refused("refused"),
  );
  assert.equal(w.events.length, 0);
  assert.equal(w.published.length, 0);
});

test("every action is declared with a doc, its class and, if closed, why", () => {
  for (const [name, declared] of Object.entries(actions)) {
    assert.match(declared.doc, /^[A-Z].*\.$/, name);
    assert.equal(shapeOf(declared.input).kind === "unknown", false, name);
    if (declared.class.kind === "direct" && declared.class.inverse !== null)
      assert.ok(Object.hasOwn(actions, declared.class.inverse), `${name}'s inverse`);
  }
  // A direct action open to every door is open to the agent and tools.
  const agent: Actor = { kind: "agent", threadId: id(2) as Ulid };
  assert.equal(refusal("group.remove", agent), null);
  assert.equal(refusal("thread.done", { kind: "tool", name: "a chat bot" }), null);
  // One declaration gives the type an action's input has.
  assert.equal(
    typeText(shapeOf(actions["group.remove"].input)),
    "{ group: GroupId; items: ItemId[] }",
  );
});
