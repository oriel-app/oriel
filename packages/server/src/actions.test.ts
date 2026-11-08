// The dispatcher of Oriel's own actions (decision 0024): it refuses an actor
// its class or doors rule out, and a direct action gives back the call that
// undoes what it actually changed.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Actor,
  isInverse,
  type WorkstreamMember,
  type IndexRecord,
  instant,
  ulid,
  type Ulid,
} from "@oriel/core";
import {
  ensureWorkspace,
  workstreamStore,
  loadMigrations,
  migrate,
  open,
  threadStore,
} from "@oriel/db";
import { ActionError, type Changed, dispatcher, refusal } from "./actions.ts";
import { unreached } from "./testing.ts";

const t0 = instant(new Date(Date.UTC(2026, 9, 29, 9)));
const id = (n: number) => ulid(n, new Uint8Array(10));
const m = (key: string, stableId: string): WorkstreamMember => ({ id: `jira:${key}`, stableId });
const user: Actor = { kind: "user" };

// A workspace with a workstream holding SYN-1 and SYN-2, a working thread on it,
// and SYN-3 in the index besides. A change set (id 50) created SYN-9, which
// the index doesn't have yet.
function world() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = id(0);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const workstreams = workstreamStore(db);
  const threads = threadStore(db);
  const workstreamId = id(1);
  const threadId = id(2);
  const changeSetId = id(50);
  workstreams.create(
    { id: workstreamId, workspaceId, name: "Launch", origin: { kind: "picked" } },
    [m("SYN-1", "10001"), m("SYN-2", "10002")],
    t0,
  );
  threads.open({ id: threadId, workspaceId, workstreamId }, t0);
  // Only what workstream membership reads of a record.
  const records = [m("SYN-1", "10001"), m("SYN-2", "10002"), m("SYN-3", "10003")].map(
    (member) => member as unknown as IndexRecord,
  );
  const published: Changed[] = [];
  let next = 100;
  const dispatch = dispatcher({
    workspaceId,
    workstreams,
    threads,
    records: () => records,
    clusters: () => [],
    created: async (set) => (set === changeSetId ? [m("SYN-9", "10009")] : []),
    // Nothing is held here; held.test.ts sends and discards held messages.
    // No turn, change set or source answers here either.
    turns: unreached("turns"),
    changeSets: unreached("changeSets"),
    applied: () => assert.fail("nothing applies here"),
    edit: () => assert.fail("nothing is edited here"),
    sources: unreached("sources"),
    kinds: unreached("kinds"),
    markSeen: () => assert.fail("the overview isn't left here"),
    // No turn runs and no change set waits here; agent-actions.test.ts
    // holds the agent to both.
    drafted: () => null,
    running: () => false,
    unsettled: async () => [],
    emit: () => {},
    later: () => () => {},
    publish: (changed) => published.push(changed),
    now: () => t0,
    newId: () => id(next++),
  });
  const held = () =>
    workstreams
      .region(workstreamId, workstreams.get(workstreamId)?.version ?? 1)
      ?.items.map((item) => item.id);
  return {
    db,
    dispatch,
    workstreams,
    workstreamId,
    threadId,
    changeSetId,
    published,
    held,
  };
}

const refused = (code: ActionError["code"]) => (error: unknown) =>
  error instanceof ActionError && error.code === code;

test("adding what's already there undoes as removing only what was new", async () => {
  const w = world();
  const added = await w.dispatch(
    "workstream.add",
    { workstream: w.workstreamId, items: ["jira:SYN-1", "jira:SYN-3"] },
    user,
  );
  assert.deepEqual(added.added, ["jira:SYN-3"]);
  assert.deepEqual(added.undo, {
    action: "workstream.remove",
    input: { workstream: w.workstreamId, items: ["jira:SYN-3"] },
  });
  assert.ok(added.undo);
  const undone = await w.dispatch(added.undo.action, added.undo.input, user);
  assert.deepEqual(w.held(), ["jira:SYN-1", "jira:SYN-2"]);
  // And the undo's own undo adds it back: Undo and Redo are one thing.
  assert.deepEqual(undone.undo, added.undo && { ...added.undo, action: "workstream.add" });
  // Nothing new to add changes nothing, so nothing undoes it.
  const again = await w.dispatch(
    "workstream.add",
    { workstream: w.workstreamId, items: ["jira:SYN-1"] },
    user,
  );
  assert.equal(again.undo, null);
});

test("a removal undoes as adding back what the index still has", async () => {
  const w = world();
  const removed = await w.dispatch(
    "workstream.remove",
    { workstream: w.workstreamId, items: ["jira:SYN-2"] },
    user,
  );
  assert.deepEqual(removed.undo, {
    action: "workstream.add",
    input: { workstream: w.workstreamId, items: ["jira:SYN-2"] },
  });
  assert.deepEqual(removed.gone, []);
  // SYN-9 joined from a change set; the index doesn't have it, so once it's
  // removed it can't come back.
  await w.dispatch(
    "workstream.add",
    { workstream: w.workstreamId, items: ["jira:SYN-9"] },
    { kind: "change-set", changeSetId: w.changeSetId },
  );
  const gone = await w.dispatch(
    "workstream.remove",
    { workstream: w.workstreamId, items: ["jira:SYN-9"] },
    user,
  );
  assert.equal(gone.undo, null);
  assert.deepEqual(gone.gone, ["jira:SYN-9"]);
});

test("a change set adds what it created before the index has it; no one else can", async () => {
  const w = world();
  const input = { workstream: w.workstreamId, items: ["jira:SYN-9" as const] };
  await assert.rejects(w.dispatch("workstream.add", input, user), refused("invalid"));
  await assert.rejects(
    w.dispatch("workstream.add", input, { kind: "agent", threadId: w.threadId }),
    refused("invalid"),
  );
  await w.dispatch("workstream.add", input, { kind: "change-set", changeSetId: w.changeSetId });
  assert.deepEqual(w.held(), ["jira:SYN-1", "jira:SYN-2", "jira:SYN-9"]);
});

test("a review link's holder, and the agent asking what only the window asks, are refused", async () => {
  const w = world();
  await assert.rejects(
    w.dispatch(
      "workstream.rename",
      { workstream: w.workstreamId, name: "x" },
      { kind: "review-link", by: "Kim" },
    ),
    refused("refused"),
  );
  const agent: Actor = { kind: "agent", threadId: w.threadId };
  await assert.rejects(
    w.dispatch("workstream.create", { kind: "thread" }, agent),
    refused("refused"),
  );
  await assert.rejects(
    w.dispatch("workstream.rename", { workstream: w.workstreamId, name: "X", oriel: true }, agent),
    refused("refused"),
  );
  assert.equal(w.workstreams.get(w.workstreamId)?.name, "Launch");
  assert.equal(w.published.length, 0);
});

test("only the person undoes a rejection, or dismisses a second look, whatever the door", () => {
  const agent: Actor = { kind: "agent", threadId: id(2) as Ulid };
  const tool: Actor = { kind: "tool", name: "a chat bot" };
  const holder: Actor = { kind: "review-link", by: "Ana" };
  for (const actor of [agent, tool, holder])
    assert.notEqual(refusal("changeset.unreject", actor), null);
  for (const actor of [agent, tool])
    assert.notEqual(refusal("changeset.dismiss-look", actor), null);
  assert.equal(refusal("changeset.unreject", { kind: "user" }), null);
  // It is an Undo, so the one path every Undo takes may call it.
  assert.ok(isInverse("changeset.unreject"));
});

test("a name the user gives a thread's new workstream is theirs, so an epic made there doesn't rename it", async () => {
  const w = world();
  const oriel: Actor = { kind: "change-set", changeSetId: id(9) as Ulid };
  const named = await w.dispatch("workstream.create", { kind: "thread", name: " Kiosk " }, user);
  const blank = await w.dispatch(
    "workstream.create",
    { kind: "thread", name: "New workstream" },
    user,
  );
  for (const made of [named, blank])
    await w.dispatch("workstream.rename", { workstream: made.workstream, name: "Epic" }, oriel);
  assert.equal(w.workstreams.get(named.workstream)?.name, "Kiosk");
  assert.equal(w.workstreams.get(blank.workstream)?.name, "Epic");
});

test("making a workstream undoes as deleting it, which only the user may, while no thread uses it", async () => {
  const w = world();
  const made = await w.dispatch(
    "workstream.create",
    { kind: "picked", name: "Later", items: ["jira:SYN-3"] },
    { kind: "agent", threadId: w.threadId },
  );
  assert.deepEqual(made.undo, {
    action: "workstream.delete",
    input: { workstream: made.workstream },
  });
  // A workstream made for a thread from nothing is that thread's.
  assert.equal((await w.dispatch("workstream.create", { kind: "thread" }, user)).undo, null);
  const agent: Actor = { kind: "agent", threadId: w.threadId };
  await assert.rejects(
    w.dispatch("workstream.delete", { workstream: made.workstream }, agent),
    refused("refused"),
  );
  await assert.rejects(
    w.dispatch("workstream.delete", { workstream: w.workstreamId }, user),
    refused("refused"),
  );
  assert.ok(w.workstreams.get(w.workstreamId));
  const deleted = await w.dispatch("workstream.delete", { workstream: made.workstream }, user);
  assert.equal(deleted.undo, null);
  assert.equal(w.workstreams.get(made.workstream), null);
});
