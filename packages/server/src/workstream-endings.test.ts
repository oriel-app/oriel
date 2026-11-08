// Deleting a workstream (decision 0028): only the user's, never mid-turn or
// mid-apply, and one threads use comes back whole with its Undo.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { type Actor, type ChangeSet, type ChangeSets, instant, ulid } from "@oriel/core";
import {
  ensureWorkspace,
  loadMigrations,
  migrate,
  open,
  threadStore,
  workstreamStore,
} from "@oriel/db";
import type { DiffView, ThreadView, UndoView } from "@oriel/web/view";
import { ActionError, type Changed, dispatcher, refusal } from "./actions.ts";
import type { Step } from "./scripted-agent.ts";
import { ThreadBusy } from "./turns.ts";
import { json, type Script, testApp, unreached } from "./testing.ts";

const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };

// Proposes 3 points for the first unestimated story in the region.
const estimate: Script = async (bindings) => {
  const stories = (await bindings.read("jira.listItems", [])).value as {
    id: string;
    gone: boolean;
    points?: number | null;
    issueType?: string;
  }[];
  const story = stories.find((s) => !s.gone && s.points === null && s.issueType !== "Epic");
  assert.ok(story, "the checkout epic has an unestimated story");
  return { value: [story.id], writes: [["jira.setEstimate", [story.id, 3]]] };
};
const plans: Record<string, Step[]> = { Estimate: [{ run: "estimate" }] };

// The checkout workstream with two threads on it, each answered.
async function workstream(t: TestContext) {
  const app = await testApp(t, {
    scripts: { estimate },
    plan: (input) => {
      app.advance(1000);
      return plans[input.text] ?? [{ text: "Hello." }];
    },
  });
  const { id: workstreamId } = json<{ id: string }>(await app.post("/api/workstreams", checkout));
  const openThread = async (text: string, on = workstreamId) => {
    const { id } = json<{ id: string }>(await app.post(`/api/workstreams/${on}/threads`, { text }));
    await app.app.settled();
    app.advance(1000);
    return id;
  };
  const first = await openThread("First");
  const second = await openThread("Second");
  const thread = async (id: string) => json<ThreadView>(await app.get(`/api/threads/${id}`));
  const ask = async (id: string, text: string) => {
    await app.post(`/api/threads/${id}/messages`, { text });
    await app.app.settled();
    app.advance(1000);
    return thread(id);
  };
  const undo = (call: UndoView) => app.post(`/api/actions/${call.action}`, call.input);
  return {
    ...app,
    workstreamId,
    first,
    second,
    thread,
    ask,
    undo,
  };
}

test("deleting a workstream threads use hides it and them, and refuses its review link, until its Undo brings everything back", async (t) => {
  const app = await workstream(t);
  // A change set with a review link out, in one of its threads.
  const proposed = await app.ask(app.first, "Estimate");
  const [set] = proposed.changeSets;
  assert.ok(set);
  const minted = json<{ url: string }>(await app.post(`/api/change-sets/${set.id}/review-link`));
  const token = new URL(minted.url).pathname.split("/").at(-1);
  const delete_ = (body: unknown) => app.post(`/api/workstreams/${app.workstreamId}/delete`, body);

  // Told one thread goes, when two would, and told none.
  assert.equal((await delete_({ threads: 1 })).status, 409);
  assert.equal((await delete_({})).status, 403);

  const deleted = await delete_({ threads: 2 });
  assert.equal(deleted.status, 200);
  const { undo } = json<{ undo: UndoView }>(deleted);
  assert.equal((await app.get(`/api/threads/${app.first}`)).status, 404);
  assert.equal((await app.post("/api/review/open", { token })).status, 404);
  assert.equal((await app.post(`/api/threads/${app.first}/messages`, { text: "Hi" })).status, 404);

  assert.equal((await app.undo(undo)).status, 200);
  const back = await app.thread(app.first);
  assert.equal(back.changeSets[0]?.status, "open");
  assert.equal((await app.get(`/api/threads/${app.second}`)).status, 200);
  const reopened = await app.post("/api/review/open", { token });
  assert.equal(reopened.status, 200);
  assert.equal(json<{ diff: DiffView }>(reopened).diff.changeSetId, set.id);
});

// The dispatcher alone, over a workstream with one thread on it, and one no
// thread uses.
function world({ running = false, applying = false } = {}) {
  const t0 = instant(new Date(Date.UTC(2026, 9, 29, 9)));
  const id = (n: number) => ulid(n, new Uint8Array(10));
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = id(0);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const workstreams = workstreamStore(db);
  const threads = threadStore(db);
  const [used, empty, threadId] = [id(1), id(2), id(3)];
  for (const workstream of [used, empty])
    workstreams.create(
      { id: workstream, workspaceId, name: "Launch", origin: { kind: "picked" } },
      [],
      t0,
    );
  threads.open({ id: threadId, workspaceId, workstreamId: used }, t0);
  const events: string[] = [];
  const published: Changed[] = [];
  const dispatch = dispatcher({
    workspaceId,
    workstreams,
    threads,
    records: () => [],
    clusters: () => [],
    created: async () => [],
    turns: unreached("turns"),
    changeSets: unreached<ChangeSets>("changeSets", {
      // One change set in each thread, applying or not.
      ofThread: async (thread) => [{ id: thread } as ChangeSet],
      applying: () => applying,
    }),
    applied: () => assert.fail("nothing applies here"),
    edit: () => assert.fail("nothing is edited here"),
    sources: unreached("sources"),
    kinds: unreached("kinds"),
    markSeen: () => assert.fail("the overview isn't left here"),
    drafted: () => null,
    running: () => running,
    unsettled: async () => [],
    emit: (event) => events.push(event.name),
    later: () => () => {},
    publish: (changed) => published.push(changed),
    now: () => t0,
    newId: () => id(100),
  });
  return { dispatch, workstreams, used, empty, threadId, events, published };
}

test("deleting and restoring a workstream are the user's, and not while a turn runs or a change set applies in one of its threads", async () => {
  const agent: Actor = { kind: "agent", threadId: ulid(3, new Uint8Array(10)) };
  for (const action of ["workstream.delete", "workstream.restore"] as const)
    for (const actor of [agent, { kind: "tool", name: "bot" } as const])
      assert.notEqual(refusal(action, actor), null);
  // Marking done and reopening are open to them.
  assert.equal(refusal("workstream.done", agent), null);
  assert.equal(refusal("workstream.reopen", agent), null);
  const busy = world({ running: true });
  await assert.rejects(
    busy.dispatch("workstream.delete", { workstream: busy.used, threads: 1 }, { kind: "user" }),
    (error: unknown) => error instanceof ThreadBusy,
  );
  assert.ok(busy.workstreams.get(busy.used));
  const applying = world({ applying: true });
  await assert.rejects(
    applying.dispatch(
      "workstream.delete",
      { workstream: applying.used, threads: 1 },
      { kind: "user" },
    ),
    (error: unknown) => error instanceof ActionError && error.code === "conflict",
  );
  assert.ok(applying.workstreams.get(applying.used));
});
