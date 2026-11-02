// What every door shares now that each window action is dispatched (OA-70):
// a person's actions, a review link's holder's, a thread marked done again
// (OA-119), and the window's routes counting what they do.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Actor,
  type ChangeSet,
  type ChangeSets,
  instant,
  type TelemetryEvent,
  ulid,
} from "@oriel/core";
import {
  ensureWorkspace,
  loadMigrations,
  migrate,
  open,
  threadStore,
  workstreamStore,
} from "@oriel/db";
import type { ThreadView } from "@oriel/web/view";
import { ActionError, type ActionDeps, dispatcher, refusal } from "./actions.ts";
import { json, testApp, unreached } from "./testing.ts";

const t0 = instant(new Date(Date.UTC(2026, 9, 29, 9)));
const id = (n: number) => ulid(n, new Uint8Array(10));
const user: Actor = { kind: "user" };
const holder: Actor = { kind: "review-link", by: "Ana" };

// A workstream with a thread on it, and a change set (id 50) of that thread,
// which the engine stand-in only finds.
function world() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = id(0);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const workstreams = workstreamStore(db);
  const threads = threadStore(db);
  const [workstreamId, threadId, changeSetId] = [id(1), id(2), id(50)];
  workstreams.create(
    { id: workstreamId, workspaceId, name: "Launch", origin: { kind: "picked" } },
    [],
    t0,
  );
  threads.open({ id: threadId, workspaceId, workstreamId }, t0);
  const set = { id: changeSetId, workspaceId, threadId } as ChangeSet;
  const decided: string[] = [];
  const changeSets = unreached<ChangeSets>("changeSets", {
    get: async (asked) => (asked === changeSetId ? set : null),
    decide: async (_id, kind, approver) => {
      decided.push(`${kind} via ${approver.via}`);
      return set;
    },
  });
  const events: TelemetryEvent[] = [];
  const dispatch = dispatcher({
    workspaceId,
    workstreams,
    threads,
    records: () => [],
    clusters: () => [],
    created: async () => [],
    turns: unreached<ActionDeps["turns"]>("turns", { rejected: () => {} }),
    changeSets,
    applied: () => assert.fail("nothing applies here"),
    sources: unreached("sources"),
    running: () => false,
    unsettled: async () => [],
    emit: (event) => events.push(event),
    publish: () => {},
    now: () => t0,
    newId: () => id(100),
  });
  return { db, dispatch, threadId, changeSetId, decided, events };
}

test("a thread marked done again keeps who marked it: the agent's mark after the user's changes nothing, and counts as the call it was", async () => {
  const w = world();
  const agent: Actor = { kind: "agent", threadId: w.threadId };
  const markedBy = () =>
    JSON.parse(
      (
        w.db.prepare("select marked_by from done_marks where thread_id = ?").get(w.threadId) as {
          marked_by: string;
        }
      ).marked_by,
    );
  await w.dispatch("thread.done", { thread: w.threadId }, user);
  const again = await w.dispatch("thread.done", { thread: w.threadId }, agent);
  assert.equal(again.undo, null);
  assert.deepEqual(markedBy(), user);
  const counted = () => w.events.map(({ at: _at, workspaceId: _ws, ...event }) => event);
  assert.deepEqual(counted(), [
    { name: "thread.marked-done", threadId: w.threadId, via: "page" },
    { name: "action.called", action: "thread.done", by: agent },
  ]);
  // Reopened in between, the agent's mark is a new one, and its own.
  await w.dispatch("thread.reopen", { thread: w.threadId }, user);
  const marked = await w.dispatch("thread.done", { thread: w.threadId }, agent);
  assert.equal(marked.undo?.action, "thread.reopen");
  assert.deepEqual(markedBy(), agent);
  assert.deepEqual(counted().at(-1), {
    name: "thread.marked-done",
    threadId: w.threadId,
    by: agent,
  });
});

test("a review link's holder may decide or dismiss a change set and nothing else, and the agent none of a person's actions", () => {
  const agent: Actor = { kind: "agent", threadId: id(2) };
  for (const action of ["changeset.approve", "changeset.reject", "changeset.dismiss"] as const)
    assert.equal(refusal(action, holder), null);
  for (const action of [
    "changeset.apply",
    "changeset.revert",
    "review-link.create",
    "thread.done",
  ] as const)
    assert.match(refusal(action, holder) ?? "", /isn't for a review link/);
  for (const action of [
    "changeset.approve",
    "source.connect",
    "thread.delete",
    "review-link.revoke",
  ] as const)
    assert.match(refusal(action, agent) ?? "", /is the user's/);
  // Direct, but closed to the agent, each saying why.
  for (const action of ["thread.open", "thread.say", "thread.stop", "source.sync"] as const)
    assert.match(refusal(action, agent) ?? "", /is closed to agents: \S/);
  // A sync renames a workstream after its anchor, as a change set may.
  assert.equal(refusal("workstream.rename", { kind: "sync", source: "jira" }), null);
});

test("only a review link's holder gives its token, and they must", async () => {
  const w = world();
  const invalid = (error: unknown) => error instanceof ActionError && error.code === "invalid";
  const decision = { changeSet: w.changeSetId, hash: "h" };
  await assert.rejects(w.dispatch("changeset.reject", { ...decision, token: "t" }, user), invalid);
  await assert.rejects(w.dispatch("changeset.reject", decision, holder), invalid);
  // A holder's reason waits for the user, and is shorter than the user's.
  await assert.rejects(
    w.dispatch("changeset.reject", { ...decision, token: "t", reason: "x".repeat(2001) }, holder),
    invalid,
  );
  await w.dispatch("changeset.reject", decision, user);
  await w.dispatch("changeset.reject", { ...decision, token: "t", reason: "No." }, holder);
  assert.deepEqual(w.decided, ["rejected via thread", "rejected via review-link"]);
  // The engine counts each decision; the dispatcher counts it again nowhere.
  assert.deepEqual(w.events, []);
});

test("the window's routes count what they do: a stop as the call it is, and a sync as asked for", async (t) => {
  const app = await testApp(t);
  const { id: threadId } = json<{ id: string }>(
    await app.post("/api/threads", { text: "What's left?" }),
  );
  await app.app.settled();
  assert.deepEqual(json(await app.post(`/api/threads/${threadId}/stop`)), { stopped: false });
  assert.deepEqual(app.app.telemetry().at(-1)?.data, {
    action: "thread.stop",
    by: { kind: "user" },
  });
  // No folder is connected, so there's nothing to sync, and nothing counted.
  const before = app.app.telemetry().length;
  assert.equal((await app.post("/api/folder/sync")).status, 409);
  assert.equal(app.app.telemetry().length, before);
  assert.equal(json<ThreadView>(await app.get(`/api/threads/${threadId}`)).state, "working");
});
