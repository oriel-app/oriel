// A workstream ends done or deleted (decision 0028): marking it done marks
// its open threads done, and reopening brings back only those; deleting one
// threads use hides it with them everywhere, from the agent too, until its
// Undo restores it; an empty one still goes for good.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { type Actor, type ChangeSet, type ChangeSets, instant, ulid } from "@oriel/core";
import {
  ensureWorkspace,
  loadMigrations,
  migrate,
  open,
  rehearsalStore,
  threadStore,
  workstreamStore,
} from "@oriel/db";
import type {
  ActionLineView,
  ChatEntry,
  DiffView,
  SearchView,
  ThreadsView,
  ThreadView,
  UndoView,
  WorkstreamEndedView,
  WorkstreamsView,
} from "@oriel/web/view";
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
const wrapUp: Script = async () => ({ intents: [["workstream.done", [{}]]] });
// What the agent reads of Oriel's own data.
const look: Script = async (bindings) => ({
  value: {
    workstreams: (await bindings.read("workstream.list", [])).value,
    threads: (await bindings.read("thread.list", [])).value,
  },
});

const plans: Record<string, Step[]> = {
  Estimate: [{ run: "estimate" }],
  "Wrap up": [{ run: "wrapUp" }, { text: "Marked." }],
  Look: [{ run: "look" }],
};

// The checkout workstream with two threads on it, each answered.
async function workstream(t: TestContext) {
  const app = await testApp(t, {
    scripts: { estimate, wrapUp, look },
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
  const summary = async () =>
    json<WorkstreamsView>(await app.get("/api/workstreams")).workstreams.find(
      (each) => each.id === workstreamId,
    );
  const listed = async () =>
    json<ThreadsView>(await app.get("/api/threads")).threads.map((each) => each.id);
  const ask = async (id: string, text: string) => {
    await app.post(`/api/threads/${id}/messages`, { text });
    await app.app.settled();
    app.advance(1000);
    return thread(id);
  };
  const counted = (name: string) =>
    app.app.telemetry().flatMap((event) => (event.name === name ? [event.data] : []));
  const undo = (call: UndoView) => app.post(`/api/actions/${call.action}`, call.input);
  return {
    ...app,
    workstreamId,
    first,
    second,
    openThread,
    thread,
    summary,
    listed,
    ask,
    counted,
    undo,
  };
}

const lines = (view: ThreadView): ActionLineView[] =>
  view.entries.flatMap((e: ChatEntry) => (e.kind === "actions" ? e.lines : []));

test("marking a workstream done marks its open threads done, and reopening brings back only those", async (t) => {
  const app = await workstream(t);
  await app.post(`/api/threads/${app.second}/done`, { via: "page" });
  app.advance(1000);
  const reply = await app.post(`/api/workstreams/${app.workstreamId}/done`);
  assert.equal(reply.status, 200);
  const done = json<WorkstreamEndedView & { undo: UndoView }>(reply);
  // Only the thread still working: the other was done already.
  assert.equal(done.carried, 1);
  assert.equal(done.workstream.done?.by, "user");
  assert.equal(done.undo.action, "workstream.reopen");
  assert.equal((await app.thread(app.first)).state, "done");
  assert.ok((await app.summary())?.done);
  // Its members stay.
  assert.ok(done.workstream.size > 0);
  assert.deepEqual(app.counted("workstream.marked-done"), [
    { workstreamId: app.workstreamId, threads: 1 },
  ]);
  // The thread it marked counts as marked done, with its workstream.
  assert.deepEqual(app.counted("thread.marked-done").at(-1), {
    threadId: app.first,
    workstreamId: app.workstreamId,
  });
  // Marked done again changes nothing, and has nothing to undo.
  const again = json<{ undo: unknown; carried: number }>(
    await app.post(`/api/workstreams/${app.workstreamId}/done`),
  );
  assert.deepEqual([again.undo, again.carried], [null, 0]);

  const undone = await app.undo(done.undo);
  assert.equal(undone.status, 200);
  assert.deepEqual(json<{ undo: unknown }>(undone).undo, {
    action: "workstream.done",
    input: { workstream: app.workstreamId },
  });
  assert.equal((await app.thread(app.first)).state, "working");
  // Done before the workstream was, it stays done.
  assert.equal((await app.thread(app.second)).state, "done");
  assert.equal((await app.summary())?.done, null);
  // Spent, the same Undo is refused.
  assert.equal((await app.undo(done.undo)).status, 403);
});

test("a done workstream opens again once one of its threads works again; marked again, Reopen brings back what each mark closed, and an Undo only its own", async (t) => {
  const app = await workstream(t);
  await app.post(`/api/workstreams/${app.workstreamId}/done`);
  app.advance(1000);
  await app.ask(app.first, "One more thing");
  assert.equal((await app.summary())?.done, null);
  assert.equal((await app.thread(app.second)).state, "done");
  // Marked again, it marks only the thread working now; the first mark stays.
  const again = json<WorkstreamEndedView & { undo: UndoView }>(
    await app.post(`/api/workstreams/${app.workstreamId}/done`),
  );
  assert.equal(again.carried, 1);
  // Its Undo takes off only its own mark.
  await app.undo(again.undo);
  assert.equal((await app.thread(app.first)).state, "working");
  assert.equal((await app.thread(app.second)).state, "done");
  await app.post(`/api/workstreams/${app.workstreamId}/done`);
  app.advance(1000);
  const reopened = json<WorkstreamEndedView>(
    await app.post(`/api/workstreams/${app.workstreamId}/reopen`),
  );
  // Both marks come off, and both threads are back.
  assert.equal(reopened.carried, 2);
  assert.equal((await app.thread(app.first)).state, "working");
  assert.equal((await app.thread(app.second)).state, "working");
  const nothing = await app.post(`/api/workstreams/${app.workstreamId}/reopen`);
  assert.deepEqual(
    [nothing.status, json<{ error: string }>(nothing).error],
    [403, "it isn't marked done"],
  );
});

test("the agent marks its workstream done, with Undo under its reply, unless a thread of it waits on the user", async (t) => {
  const app = await workstream(t);
  const view = await app.ask(app.first, "Wrap up");
  const [line] = lines(view);
  assert.equal(line?.text, "Marked this workstream done.");
  assert.ok(line?.undo);
  assert.equal((await app.thread(app.second)).state, "done");
  assert.equal((await app.summary())?.done?.by, "agent");
  const [marked] = app.counted("workstream.marked-done");
  assert.deepEqual(marked?.["by"], { kind: "agent", threadId: app.first });
  // Its Undo, from the list under the reply, reopens both.
  const list = view.entries.findLast((e) => e.kind === "actions");
  assert.ok(list);
  const params = new URLSearchParams({ thread: app.first, seq: `${list.seq}`, line: "0" });
  const undone = await app.post(`/api/actions/${line.undo.action}?${params}`, line.undo.input);
  assert.equal(undone.status, 200);
  assert.equal((await app.thread(app.second)).state, "working");
  assert.equal((await app.summary())?.done, null);

  // A change set waiting in one of its threads keeps them all open.
  await app.ask(app.second, "Estimate");
  const refused = lines(await app.ask(app.first, "Wrap up")).at(-1);
  assert.equal(
    refused?.text,
    "Didn't mark this workstream done: a change set in one of its threads waits on you, so it stays in Needs you.",
  );
  assert.equal((await app.summary())?.done, null);
});

test("deleting a workstream threads use hides it and them everywhere, from the agent too, until its Undo brings everything back", async (t) => {
  const app = await workstream(t);
  // A change set with a review link out, in one of its threads.
  const proposed = await app.ask(app.first, "Estimate");
  const [set] = proposed.changeSets;
  assert.ok(set);
  const minted = json<{ url: string }>(await app.post(`/api/change-sets/${set.id}/review-link`));
  const token = new URL(minted.url).pathname.split("/").at(-1);
  // Another workstream's thread, whose agent looks around.
  const { id: elsewhere } = json<{ id: string }>(
    await app.post("/api/workstreams", { kind: "picked", name: "Other", items: ["jira:SYN-61"] }),
  );
  const looker = await app.openThread("Hi", elsewhere);
  const looked = async () => {
    const view = await app.ask(looker, "Look");
    const run = view.entries.findLast((e) => e.kind === "run.finished");
    assert.ok(run?.kind === "run.finished");
    const value = JSON.parse(run.run.returned ?? "{}") as {
      workstreams: { id: string }[];
      threads: { id: string }[];
    };
    return [...value.workstreams, ...value.threads].map((each) => each.id);
  };
  const ours = [app.workstreamId, app.first, app.second];
  const delete_ = (body: unknown) => app.post(`/api/workstreams/${app.workstreamId}/delete`, body);

  // Told one thread goes, when two would, and told none.
  const stale = await delete_({ threads: 1 });
  assert.deepEqual(
    [stale.status, json<{ error: string }>(stale).error],
    [409, "It has 2 threads now. Look again before deleting it."],
  );
  const unseen = await delete_({});
  assert.deepEqual(
    [unseen.status, json<{ error: string }>(unseen).error],
    [403, "a thread uses it, so it stays"],
  );

  const deleted = await delete_({ threads: 2 });
  assert.equal(deleted.status, 200);
  const { threads, undo } = json<{ threads: number; undo: UndoView }>(deleted);
  assert.deepEqual(
    [threads, undo],
    [2, { action: "workstream.restore", input: { workstream: app.workstreamId } }],
  );
  assert.equal((await app.get(`/api/workstreams/${app.workstreamId}`)).status, 404);
  assert.equal((await app.get(`/api/threads/${app.first}`)).status, 404);
  assert.equal(await app.summary(), undefined);
  assert.ok(!(await app.listed()).some((id) => ours.includes(id)));
  assert.deepEqual(json<SearchView>(await app.get("/api/search?q=First")).results, []);
  assert.ok(!(await looked()).some((id) => ours.includes(id)));
  const review = await app.post("/api/review/open", { token });
  assert.deepEqual(
    [review.status, json<{ error: string }>(review).error],
    [404, "The workstream this change set is in was deleted, so it can't be reviewed now."],
  );
  assert.equal((await app.post(`/api/threads/${app.first}/messages`, { text: "Hi" })).status, 404);
  assert.deepEqual(app.counted("workstream.deleted"), [
    { workstreamId: app.workstreamId, threads: 2, kept: true },
  ]);

  const restored = await app.undo(undo);
  assert.equal(restored.status, 200);
  assert.deepEqual(json<{ undo: unknown }>(restored).undo, {
    action: "workstream.delete",
    input: { workstream: app.workstreamId, threads: 2 },
  });
  const back = await app.thread(app.first);
  assert.equal(back.changeSets[0]?.status, "open");
  assert.ok((await app.listed()).includes(app.second));
  assert.ok((await looked()).includes(app.workstreamId));
  assert.ok(json<SearchView>(await app.get("/api/search?q=First")).results.length > 0);
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
    rehearsals: rehearsalStore(db),
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
    sources: unreached("sources"),
    markSeen: () => assert.fail("the overview isn't left here"),
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
      assert.match(refusal(action, actor) ?? "", /is closed to (agents|tools): It/);
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

test("an empty workstream still goes for good, with no Undo, and says where its threads went when one does", async () => {
  const w = world();
  const gone = await w.dispatch("workstream.delete", { workstream: w.empty }, { kind: "user" });
  assert.equal(gone.undo, null);
  assert.equal(w.workstreams.get(w.empty), null);
  await assert.rejects(
    w.dispatch("workstream.restore", { workstream: w.empty }, { kind: "user" }),
    (error: unknown) => error instanceof ActionError && error.code === "not-found",
  );
  const hidden = await w.dispatch(
    "workstream.delete",
    { workstream: w.used, threads: 1 },
    { kind: "user" },
  );
  assert.equal(hidden.undo?.action, "workstream.restore");
  assert.deepEqual(w.published.at(-1), { workstream: w.used, deleted: [w.threadId] });
  assert.deepEqual(w.events, ["workstream.deleted", "workstream.deleted"]);
});
