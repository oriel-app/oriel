// The agent's door onto Oriel's own actions (decision 0024): the host
// refuses what would break a change set or close a thread that waits on the
// user, and the Undo under the reply puts back what the agent did.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { type Actor, type IndexRecord, instant, ulid } from "@oriel/core";
import {
  ensureWorkspace,
  loadMigrations,
  migrate,
  open,
  threadStore,
  workstreamStore,
} from "@oriel/db";
import type {
  ActionLineView,
  ChatEntry,
  DiffView,
  ThreadView,
  WorkstreamView,
} from "@oriel/web/view";
import { dispatcher } from "./actions.ts";
import { intentsOf } from "./intents.ts";
import type { Step } from "./scripted-agent.ts";
import { json, type Script, testApp, type TestOptions, unreached } from "./testing.ts";

const t0 = instant(new Date(Date.UTC(2026, 9, 29, 9)));
const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };
const remove =
  (...items: string[]): Script =>
  async () => ({ intents: [["workstream.remove", [{ items }]]] });

// A workstream on checkout and a thread on it, whose turns follow `plan` for
// what the user says, over `scripts`. Each turn starts a second after the
// last, so what it does lands after what the user said.
async function thread(
  t: TestContext,
  scripts: Record<string, Script>,
  plan: (text: string) => Step[] = () => [{ text: "Hello." }],
  options: TestOptions = {},
) {
  let advance = (_ms: number) => {};
  const app = await testApp(t, {
    ...options,
    scripts,
    plan: (input) => {
      advance(1000);
      return plan(input.text);
    },
  });
  advance = app.advance;
  const { id: workstreamId } = json<{ id: string }>(await app.post("/api/workstreams", checkout));
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Hello" }),
  );
  await app.app.settled();
  const ask = async (text: string, id = threadId) => {
    await app.post(`/api/threads/${id}/messages`, { text });
    await app.app.settled();
    return json<ThreadView>(await app.get(`/api/threads/${id}`));
  };
  const lines = (view: ThreadView): ActionLineView[] =>
    view.entries.flatMap((e: ChatEntry) => (e.kind === "actions" ? e.lines : []));
  const members = async () =>
    json<WorkstreamView>(await app.get(`/api/workstreams/${workstreamId}`)).members.map(
      (m) => m.ref.id,
    );
  return { ...app, workstreamId, threadId, ask, lines, members };
}

test("the host refuses to close a thread that waits on the user, and its own when the turn proposed a change set", async (t) => {
  const app = await thread(
    t,
    {
      estimate: async () => ({
        writes: [["jira.setEstimate", ["jira:SYN-23", 3]]],
        intents: [["thread.done", []]],
      }),
      close: async () => ({ intents: [["thread.done", []]] }),
    },
    (text) =>
      text === "Estimate" ? [{ run: "estimate" }] : text === "Close" ? [{ run: "close" }] : [],
  );
  const proposed = await app.ask("Estimate");
  assert.deepEqual(
    app.lines(proposed).map((line) => [line.applied, line.undo]),
    [[false, null]],
  );
  assert.equal(proposed.state, "working");
  // A later turn can't close it either while that change set waits.
  const later = await app.ask("Close");
  assert.equal(app.lines(later).at(-1)?.applied, false);
  assert.equal(later.state, "working");
  // The user still may.
  app.advance(1000);
  const closed = json<ThreadView>(await app.post(`/api/threads/${app.threadId}/done`));
  assert.equal(closed.state, "done");
});

test("the host refuses to remove what a change set still to apply names, in any of the workstream's threads", async (t) => {
  const app = await thread(
    t,
    {
      estimate: async () => ({ writes: [["jira.setEstimate", ["jira:SYN-23", 3]]] }),
      remove: remove("jira:SYN-23", "jira:SYN-10"),
    },
    (text) =>
      text === "Estimate" ? [{ run: "estimate" }] : text === "Tidy" ? [{ run: "remove" }] : [],
  );
  await app.ask("Estimate");
  const { id: other } = json<{ id: string }>(
    await app.post(`/api/workstreams/${app.workstreamId}/threads`, { text: "Hi" }),
  );
  await app.app.settled();
  const view = await app.ask("Tidy", other);
  assert.deepEqual(
    app.lines(view).map((line) => line.applied),
    [false],
  );
  const members = await app.members();
  assert.ok(members.includes("jira:SYN-23") && members.includes("jira:SYN-10"));
});

test("a stopped turn applies nothing it asked for", async (t) => {
  let stop = () => {};
  const app = await thread(
    t,
    {
      remove: async () => {
        stop();
        return { intents: [["workstream.remove", [{ items: ["jira:SYN-10"] }]]] };
      },
    },
    (text) => (text === "Tidy" ? [{ run: "remove" }, { text: "Done." }] : []),
  );
  stop = () => void app.post(`/api/threads/${app.threadId}/stop`);
  const view = await app.ask("Tidy");
  assert.ok(view.entries.some((e) => e.kind === "error"));
  assert.deepEqual(app.lines(view), []);
  assert.ok((await app.members()).includes("jira:SYN-10"));
});

// The dispatcher alone, with a turn running in a second thread on the
// workstream, and the turn's starter under the test's control.
function world(startedBy: Actor | null = { kind: "user" }) {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const id = (n: number) => ulid(n, new Uint8Array(10));
  const workspaceId = id(0);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const workstreams = workstreamStore(db);
  const threads = threadStore(db);
  const workstreamId = id(1);
  const [mine, busy] = [id(2), id(3)];
  const member = (key: string, stableId: string) => ({ id: `jira:${key}` as const, stableId });
  workstreams.create(
    { id: workstreamId, workspaceId, name: "Launch", origin: { kind: "picked" } },
    [member("SYN-1", "10001"), member("SYN-2", "10002")],
    t0,
  );
  for (const thread of [mine, busy]) threads.open({ id: thread, workspaceId, workstreamId }, t0);
  let next = 100;
  const dispatch = dispatcher({
    workspaceId,
    workstreams,
    threads,
    records: () => [member("SYN-1", "10001"), member("SYN-2", "10002")] as unknown as IndexRecord[],
    clusters: () => [],
    created: async () => [],
    turns: unreached("turns"),
    changeSets: unreached("changeSets"),
    applied: () => assert.fail(),
    edit: () => assert.fail("nothing is edited here"),
    sources: unreached("sources"),
    kinds: unreached("kinds"),
    markSeen: () => assert.fail("the overview isn't left here"),
    drafted: () => null,
    running: (thread) => thread === busy || thread === mine,
    unsettled: async () => [],
    emit: () => {},
    later: () => () => {},
    publish: () => {},
    now: () => t0,
    newId: () => id(next++),
  });
  const intents = intentsOf({
    dispatch,
    workstreams,
    title: () => "Busy one",
    startedBy: () => startedBy,
  });
  const thread = threads.get(mine, t0);
  assert.ok(thread);
  return { dispatch, intents, thread, threads, busy, workstreamId, id };
}

test("the host refuses the agent what another thread's running turn needs, and the user nothing", async () => {
  const w = world();
  const lines = await w.intents.apply({ thread: w.thread, changeSetId: null }, [
    { action: "workstream.remove", input: { workstream: w.workstreamId, items: ["jira:SYN-1"] } },
    { action: "thread.done", input: { thread: w.busy } },
  ]);
  assert.deepEqual(
    lines.map((line) => line.applied),
    [false, false],
  );
  // Its own thread's turn is the one acting, so it may close it.
  const own = await w.intents.apply({ thread: w.thread, changeSetId: null }, [
    { action: "thread.done", input: { thread: w.thread.id } },
  ]);
  assert.equal(own[0]?.applied, true);
  const user: Actor = { kind: "user" };
  await w.dispatch(
    "workstream.remove",
    { workstream: w.workstreamId, items: ["jira:SYN-1"] },
    user,
  );
  await w.dispatch("thread.done", { thread: w.busy }, user);
});

test("a turn the user didn't start applies none of what its agent asked", async () => {
  const w = world({ kind: "tool", name: "a chat bot" });
  const lines = await w.intents.apply({ thread: w.thread, changeSetId: null }, [
    { action: "workstream.rename", input: { workstream: w.workstreamId, name: "Hijacked" } },
  ]);
  assert.deepEqual(
    lines.map((line) => line.applied),
    [false],
  );
  const none = world(null);
  const unstarted = await none.intents.apply({ thread: none.thread, changeSetId: null }, [
    { action: "thread.done", input: { thread: none.thread.id } },
  ]);
  assert.equal(unstarted[0]?.applied, false);
});

test("the agent can't close a thread whose held message waits on the user", async () => {
  const w = world();
  const from = { kind: "review-link", by: "Kim", changeSet: w.id(60), askFirst: false } as const;
  w.threads.append(w.thread.id, { role: "held", from, text: "Wrong sailing." }, w.id(61), t0);
  const lines = await w.intents.apply({ thread: w.thread, changeSetId: null }, [
    { action: "thread.done", input: { thread: w.thread.id } },
  ]);
  assert.deepEqual(
    lines.map((line) => line.applied),
    [false],
  );
  assert.notEqual(w.threads.get(w.thread.id, t0)?.state, "done");
});

// The list under the agent's reply at its latest, and how its Undo names a
// line there (OA-88).
const lastList = (view: ThreadView) => {
  const list = view.entries.findLast((e) => e.kind === "actions");
  assert.ok(list?.kind === "actions", "a list under the reply");
  return list;
};
const undoUrl = (action: string, thread: string, seq: number, index = 0) =>
  `/api/actions/${action}?thread=${thread}&seq=${seq}&line=${index}`;

test("Undo under the reply puts back what the agent removed, once, and Redo removes it again", async (t) => {
  const app = await thread(t, { remove: remove("jira:SYN-10", "jira:SYN-21") }, (text) =>
    text === "Tidy" ? [{ run: "remove" }, { text: "Done." }] : [],
  );
  const list = lastList(await app.ask("Tidy"));
  const undo = list.lines[0]?.undo;
  assert.ok(undo, "an Undo");
  const reply = await app.post(undoUrl(undo.action, app.threadId, list.seq), undo.input);
  assert.equal(reply.status, 200);
  const redo = json<{ undo: { action: string; input: unknown } | null }>(reply).undo;
  assert.deepEqual(redo, {
    action: "workstream.remove",
    input: { workstream: app.workstreamId, items: ["jira:SYN-10", "jira:SYN-21"] },
  });
  const back = await app.members();
  assert.ok(back.includes("jira:SYN-10") && back.includes("jira:SYN-21"));
  const view = json<ThreadView>(await app.get(`/api/threads/${app.threadId}`));
  assert.equal(lastList(view).lines[0]?.undone, true);
  // The same Undo again changes nothing: the line was already undone.
  const again = await app.post(undoUrl(undo.action, app.threadId, list.seq), undo.input);
  assert.equal(again.status, 403);
  // Redo takes them out again, and the line offers its Undo once more.
  assert.ok(redo);
  const redone = await app.post(undoUrl(redo.action, app.threadId, list.seq), redo.input);
  assert.equal(redone.status, 200);
  assert.ok(!(await app.members()).includes("jira:SYN-10"));
  const after = lastList(json<ThreadView>(await app.get(`/api/threads/${app.threadId}`)));
  assert.equal(after.lines[0]?.undone, undefined);
  assert.deepEqual(after.lines[0]?.undo, undo);
  // A line that isn't there is not found.
  const nowhere = await app.post(undoUrl(undo.action, app.threadId, list.seq, 5), undo.input);
  assert.equal(nowhere.status, 404);
});

test("a new thread adds an epic it doesn't hold and proposes a story in it in the same turn (OA-312)", async (t) => {
  const app = await testApp(t, {
    plan: () => [{ run: "join" }, { run: "story" }],
    scripts: {
      // Found by this run's search, so it may join.
      join: async (bindings) => {
        await bindings.read("search", ["Boarding passes", 5]);
        return { intents: [["workstream.add", [{ items: ["jira:SYN-2"] }]]] };
      },
      story: async () => ({
        writes: [
          ["jira.createStory", [{ summary: "Scan at the gate", epic: "jira:SYN-2" }], "new:1"],
        ],
      }),
    },
  });
  const { id: threadId, workstreamId } = json<{ id: string; workstreamId: string }>(
    await app.post("/api/threads", { text: "Add a story under SYN-2" }),
  );
  await app.app.settled();
  const view = json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  const kinds = view.entries.map((e) => e.kind);
  // The epic joined, with its Undo and its marker, before the change set the
  // same turn proposed.
  const lines = view.entries.flatMap((e) => (e.kind === "actions" ? e.lines : []));
  assert.deepEqual(
    lines.map((line) => line.applied),
    [true],
  );
  const marker = view.entries.find((e) => e.kind === "marker");
  assert.deepEqual(marker?.kind === "marker" && marker.added.map((ref) => ref.id), ["jira:SYN-2"]);
  assert.ok(kinds.indexOf("marker") < kinds.indexOf("change-set"), kinds.join(", "));
  const set = view.entries.find((e) => e.kind === "change-set");
  assert.ok(set?.kind === "change-set", "the turn proposed a change set");
  const diff = json<DiffView>(await app.post(`/api/change-sets/${set.changeSetId}/diff`));
  assert.deepEqual(
    diff.lines.map((line) => [line.kind, line.makes]),
    [["create", "story"]],
  );
  const members = json<WorkstreamView>(await app.get(`/api/workstreams/${workstreamId}`)).members;
  assert.deepEqual(
    members.map((m) => m.ref.id),
    ["jira:SYN-2"],
  );
});
