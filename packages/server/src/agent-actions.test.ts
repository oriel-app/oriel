// The agent's door onto Oriel's own actions (decision 0024): what a turn's
// last run asked for applies when the turn ends, after its change set, as
// the thread's agent, through the one dispatcher; the host refuses what
// would break a change set or close a thread that waits on the user; and the
// list under the reply says what it did.
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
import { history } from "./turns.ts";
import type { Step } from "./scripted-agent.ts";
import { json, type Script, testApp, unreached } from "./testing.ts";

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
) {
  let advance = (_ms: number) => {};
  const app = await testApp(t, {
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

test("a removal the agent asked for applies at the turn's end, as the agent's, and says so", async (t) => {
  const app = await thread(t, { remove: remove("jira:SYN-10", "jira:SYN-21") }, (text) =>
    text === "Tidy" ? [{ run: "remove" }, { text: "I've asked Oriel to take those out." }] : [],
  );
  const view = await app.ask("Tidy");
  assert.ok(!(await app.members()).includes("jira:SYN-10"));
  assert.ok(!(await app.members()).includes("jira:SYN-21"));
  // Under the reply, the host's own record, naming where it acted, with
  // the call that undoes it.
  const kinds = view.entries.map((e) => e.kind);
  assert.ok(kinds.indexOf("actions") > kinds.lastIndexOf("text"));
  assert.deepEqual(app.lines(view), [
    {
      text: "Removed SYN-10 and SYN-21 from this workstream.",
      applied: true,
      why: null,
      touched: { kind: "workstream", id: app.workstreamId },
      undo: {
        action: "workstream.add",
        input: { workstream: app.workstreamId, items: ["jira:SYN-10", "jira:SYN-21"] },
      },
    },
  ]);
  // The workstream's log says who; telemetry counts it once, as the agent's.
  const workstream = json<WorkstreamView>(await app.get(`/api/workstreams/${app.workstreamId}`));
  assert.equal(workstream.changes[0]?.cause, "agent");
  assert.deepEqual(app.app.telemetry().at(-1)?.data, {
    action: "workstream.remove",
    by: { kind: "agent", threadId: app.threadId },
  });
  // The thread moved to the new version, with its marker, which says it is
  // the agent's own change, for the list of what it did to fold in.
  const marker = view.entries.find((e) => e.kind === "marker");
  assert.ok(marker?.kind === "marker" && marker.ownAgent === true);
});

test("the turn's last run that asked for actions gives them, adjacent calls merge, and marking its own thread done comes last", async (t) => {
  const app = await thread(
    t,
    {
      first: remove("jira:SYN-74"),
      second: async () => ({
        intents: [
          ["thread.done", []],
          ["workstream.remove", [{ items: ["jira:SYN-10"] }]],
          ["workstream.remove", [{ items: ["jira:SYN-21", "jira:SYN-10"] }]],
        ],
      }),
      read: async () => ({ value: "nothing asked" }),
    },
    (text) => (text === "Go" ? [{ run: "first" }, { run: "second" }, { run: "read" }] : []),
  );
  const view = await app.ask("Go");
  assert.deepEqual(
    app.lines(view).map((line) => line.text),
    ["Removed SYN-10 and SYN-21 from this workstream.", "Marked this thread done."],
  );
  // The first run's ask was replaced; a run that asked nothing replaced none.
  assert.ok((await app.members()).includes("jira:SYN-74"));
  assert.deepEqual([view.state, view.doneBy], ["done", "marked"]);
});

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
  assert.deepEqual(app.lines(proposed), [
    {
      text: "Didn't mark this thread done: this turn proposed a change set, which waits on you.",
      applied: false,
      why: "this turn proposed a change set, which waits on you",
      touched: null,
      undo: null,
    },
  ]);
  assert.equal(proposed.state, "working");
  // A later turn can't close it either while that change set waits.
  const later = await app.ask("Close");
  assert.equal(
    app.lines(later).at(-1)?.text,
    "Didn't mark this thread done: a change set in it waits on you, so it stays in Needs you.",
  );
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
    app.lines(view).map((line) => line.text),
    [
      "Didn't remove SYN-23 and SYN-10 from this workstream: SYN-23 is in a change set that hasn't applied yet, in one of its threads.",
    ],
  );
  assert.ok((await app.members()).includes("jira:SYN-10"));
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
  assert.ok(view.entries.some((e) => e.kind === "error" && e.message === "Stopped."));
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
    sources: unreached("sources"),
    running: (thread) => thread === busy || thread === mine,
    unsettled: async () => [],
    emit: () => {},
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
    lines.map((line) => (line.applied ? "applied" : line.why)),
    ["the agent is answering in another of its threads", "the agent is answering in it"],
  );
  assert.deepEqual(lines[1]?.touched, { kind: "thread", id: w.busy, name: "Busy one" });
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
    lines.map((line) => !line.applied && line.why),
    ["this turn wasn't started by you, so Oriel applied none of it"],
  );
  const none = world(null);
  const unstarted = await none.intents.apply({ thread: none.thread, changeSetId: null }, [
    { action: "thread.done", input: { thread: none.thread.id } },
  ]);
  assert.equal(unstarted[0]?.applied, false);
});

test("an item the agent found and added is in the next turn's region, and the diff says who put it there", async (t) => {
  const app = await thread(
    t,
    {
      bring: async (bindings) => {
        await bindings.read("search", ["SYN-80"]);
        return { intents: [["workstream.add", [{ items: ["jira:SYN-80"] }]]] };
      },
      estimate: async () => ({ writes: [["jira.setEstimate", ["jira:SYN-80", 2]]] }),
    },
    (text) =>
      text === "Bring" ? [{ run: "bring" }] : text === "Estimate" ? [{ run: "estimate" }] : [],
  );
  const brought = await app.ask("Bring");
  assert.deepEqual(
    app.lines(brought).map((line) => line.text),
    ["Added SYN-80 to this workstream."],
  );
  const workstream = json<WorkstreamView>(await app.get(`/api/workstreams/${app.workstreamId}`));
  assert.deepEqual(workstream.changes[0]?.thread, { id: app.threadId, title: "Hello" });
  const view = await app.ask("Estimate");
  const set = view.entries.find((e) => e.kind === "change-set");
  assert.ok(set?.kind === "change-set");
  const diff = json<DiffView>(await app.post(`/api/change-sets/${set.changeSetId}/diff`));
  assert.deepEqual(diff.lines[0]?.brought, [{ key: "SYN-80", by: "agent" }]);
});

test("the agent can't close a thread whose held message waits on the user", async () => {
  const w = world();
  const from = { kind: "review-link", by: "Kim", changeSet: w.id(60), askFirst: false } as const;
  w.threads.append(w.thread.id, { role: "held", from, text: "Wrong sailing." }, w.id(61), t0);
  const lines = await w.intents.apply({ thread: w.thread, changeSetId: null }, [
    { action: "thread.done", input: { thread: w.thread.id } },
  ]);
  assert.deepEqual(
    lines.map((line) => !line.applied && line.why),
    ["a message held in it waits on you, so it stays in Needs you"],
  );
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

test("Undo under the reply puts back what the agent removed, the line says so, and Redo removes it again", async (t) => {
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
  assert.deepEqual(lastList(view).lines[0], {
    text: "Removed SYN-10 and SYN-21 from this workstream, which you undid.",
    applied: true,
    undone: true,
    why: null,
    touched: { kind: "workstream", id: app.workstreamId },
    undo: redo,
  });
  // Counted by the events that count an add, as the user's undoing the agent's.
  const added = app.app.telemetry().filter((e) => e.name === "workstream.item-added");
  assert.deepEqual(
    added.slice(-2).map((e) => e.data),
    [1, 2].map(() => ({
      workstreamId: app.workstreamId,
      source: "jira",
      cause: "user",
      undoes: { kind: "agent", threadId: app.threadId },
    })),
  );
  // The same Undo again changes nothing: the line was already undone.
  const again = await app.post(undoUrl(undo.action, app.threadId, list.seq), undo.input);
  assert.equal(again.status, 403);
  // Redo takes them out again, and the line offers its Undo once more.
  assert.ok(redo);
  const redone = await app.post(undoUrl(redo.action, app.threadId, list.seq), redo.input);
  assert.equal(redone.status, 200);
  assert.ok(!(await app.members()).includes("jira:SYN-10"));
  const after = lastList(json<ThreadView>(await app.get(`/api/threads/${app.threadId}`)));
  assert.equal(after.lines[0]?.text, "Removed SYN-10 and SYN-21 from this workstream.");
  assert.equal(after.lines[0]?.undone, undefined);
  assert.deepEqual(after.lines[0]?.undo, undo);
  // A line that isn't there is not found.
  const nowhere = await app.post(undoUrl(undo.action, app.threadId, list.seq, 5), undo.input);
  assert.equal(nowhere.status, 404);
});

test("Undo reopens a thread its agent marked done, and Redo marks it done again", async (t) => {
  const app = await thread(
    t,
    { close: async () => ({ intents: [["thread.done", []]] }) },
    (text) => (text === "Wrap up" ? [{ run: "close" }] : []),
  );
  const closed = await app.ask("Wrap up");
  assert.deepEqual([closed.state, closed.doneBy], ["done", "marked"]);
  const list = lastList(closed);
  const undo = list.lines[0]?.undo;
  assert.deepEqual(undo?.action, "thread.reopen");
  assert.ok(undo);
  const reply = await app.post(undoUrl(undo.action, app.threadId, list.seq), undo.input);
  assert.equal(reply.status, 200);
  const view = json<ThreadView>(await app.get(`/api/threads/${app.threadId}`));
  assert.equal(view.state, "working");
  assert.equal(lastList(view).lines[0]?.text, "Marked this thread done, which you undid.");
  assert.deepEqual(app.app.telemetry().at(-1)?.data, {
    action: "thread.reopen",
    by: { kind: "user" },
    undoes: { kind: "agent", threadId: app.threadId },
  });
  const redo = lastList(view).lines[0]?.undo;
  assert.deepEqual(redo, { action: "thread.done", input: { thread: app.threadId } });
  assert.ok(redo);
  await app.post(undoUrl(redo.action, app.threadId, list.seq), redo.input);
  const again = json<ThreadView>(await app.get(`/api/threads/${app.threadId}`));
  assert.deepEqual([again.state, again.doneBy], ["done", "marked"]);
});

test("a workstream the agent made is deleted by its Undo, unless a thread uses it", async (t) => {
  const make =
    (name: string): Script =>
    async () => ({
      intents: [["workstream.create", [{ kind: "picked", name, items: ["jira:SYN-10"] }]]],
    });
  const app = await thread(t, { first: make(" Boarding "), second: make("Gates") }, (text) =>
    text === "First" ? [{ run: "first" }] : text === "Second" ? [{ run: "second" }] : [],
  );
  const list = lastList(await app.ask("First"));
  const line = list.lines[0];
  // The name as the workstream has it, trimmed.
  assert.equal(line?.text, "Made the workstream “Boarding” with SYN-10.");
  const made = line?.touched?.id;
  assert.ok(made && line.undo);
  assert.deepEqual(line.undo, { action: "workstream.delete", input: { workstream: made } });
  const reply = await app.post(undoUrl(line.undo.action, app.threadId, list.seq), line.undo.input);
  assert.deepEqual([reply.status, json<{ undo: unknown }>(reply).undo], [200, null]);
  assert.equal((await app.get(`/api/workstreams/${made}`)).status, 404);
  // Undone, with nothing to do it again and nowhere to link to.
  const view = json<ThreadView>(await app.get(`/api/threads/${app.threadId}`));
  assert.deepEqual(lastList(view).lines[0], {
    text: "Made the workstream “Boarding” with SYN-10, which you undid.",
    applied: true,
    undone: true,
    why: null,
    touched: null,
    undo: null,
  });

  // One the user has opened a thread on stays, and its line offers Undo still.
  const second = lastList(await app.ask("Second"));
  const used = second.lines[0];
  assert.ok(used?.touched && used.undo);
  await app.post(`/api/workstreams/${used.touched.id}/threads`, { text: "Hello" });
  await app.app.settled();
  const refused = await app.post(
    undoUrl(used.undo.action, app.threadId, second.seq),
    used.undo.input,
  );
  assert.deepEqual(
    [refused.status, json<{ error: string }>(refused).error],
    [403, "a thread uses it, so it stays"],
  );
  assert.equal((await app.get(`/api/workstreams/${used.touched.id}`)).status, 200);
  const still = lastList(json<ThreadView>(await app.get(`/api/threads/${app.threadId}`)));
  assert.equal(still.lines[0]?.undone, undefined);
});

test("the agent may reopen another thread marked done; one that isn't is refused", async (t) => {
  let other = "";
  const reopen: Script = async () => ({ intents: [["thread.reopen", [{ thread: other }]]] });
  const app = await thread(t, { reopen }, (text) =>
    text === "Reopen it" ? [{ run: "reopen" }] : [{ text: "Hello." }],
  );
  other = json<{ id: string }>(
    await app.post(`/api/workstreams/${app.workstreamId}/threads`, { text: "Another" }),
  ).id;
  await app.app.settled();
  const refused = lastList(await app.ask("Reopen it")).lines[0];
  assert.deepEqual([refused?.applied, refused?.why], [false, "it isn't marked done"]);
  app.advance(1000);
  await app.post(`/api/threads/${other}/done`);
  app.advance(1000);
  const reopened = lastList(await app.ask("Reopen it")).lines[0];
  assert.equal(reopened?.applied, true);
  assert.deepEqual(reopened?.undo, { action: "thread.done", input: { thread: other } });
  // The agent's module leaves out which mark to take off: only Oriel gives it.
  assert.equal(reopened?.why, null);
  const view = json<ThreadView>(await app.get(`/api/threads/${other}`));
  assert.equal(view.state, "working");
});

test("the agent's history says which of its actions the user undid", () => {
  const thread = ulid(2, new Uint8Array(10));
  const call = { action: "thread.done" as const, input: { thread } };
  const lines = [
    {
      call,
      touched: { kind: "thread", id: thread, name: null },
      applied: true,
      undo: { action: "thread.reopen", input: { thread } },
      since: { undone: true, next: call },
    },
  ];
  const told = history(
    [{ seq: 1, at: t0, role: "agent", event: { kind: "actions", runId: thread, lines } }],
    () => "",
  );
  assert.deepEqual(told, [
    { role: "actions", text: `applied ${JSON.stringify(call)}, which the user then undid`, at: t0 },
  ]);
});

test("Undo never takes off a done mark made after the agent's, and Redo keeps the line's words", async (t) => {
  const rename: Script = async () => ({
    intents: [
      ["workstream.rename", [{ name: "Gates" }]],
      ["thread.done", []],
    ],
  });
  const app = await thread(t, { rename }, (text) => (text === "Rename" ? [{ run: "rename" }] : []));
  const list = lastList(await app.ask("Rename"));
  const [renamed, closed] = list.lines;
  assert.ok(renamed?.undo && closed?.undo);
  // The user worked in the thread, then marked it done themselves.
  app.advance(1000);
  await app.ask("More");
  app.advance(1000);
  await app.post(`/api/threads/${app.threadId}/done`);
  const stale = await app.post(
    undoUrl(closed.undo.action, app.threadId, list.seq, 1),
    closed.undo.input,
  );
  assert.deepEqual(
    [stale.status, json<{ error: string }>(stale).error],
    [403, "it was marked done again since"],
  );
  const view = json<ThreadView>(await app.get(`/api/threads/${app.threadId}`));
  assert.deepEqual([view.state, view.doneBy], ["done", "marked"]);
  // Undo, then the user names it as the agent did, then Redo: the line still
  // says what the agent did.
  const undone = json<{ undo: { action: string; input: unknown } | null }>(
    await app.post(undoUrl(renamed.undo.action, app.threadId, list.seq, 0), renamed.undo.input),
  ).undo;
  assert.ok(undone);
  await app.post(`/api/workstreams/${app.workstreamId}/rename`, { name: "Gates" });
  await app.post(undoUrl(undone.action, app.threadId, list.seq, 0), undone.input);
  const after = lastList(json<ThreadView>(await app.get(`/api/threads/${app.threadId}`)));
  assert.equal(after.lines[0]?.text, renamed.text);
});

test("an Undo under the reply moves its thread to the workstream's new version, done or not", async (t) => {
  const tidy: Script = async () => ({
    intents: [
      ["workstream.remove", [{ items: ["jira:SYN-10"] }]],
      ["thread.done", []],
    ],
  });
  const app = await thread(t, { tidy }, (text) => (text === "Tidy" ? [{ run: "tidy" }] : []));
  const done = await app.ask("Tidy");
  assert.deepEqual([done.state, done.regionVersion], ["done", 2]);
  const list = lastList(done);
  const undo = list.lines[0]?.undo;
  assert.ok(undo);
  const redo = json<{ undo: { action: string; input: unknown } | null }>(
    await app.post(undoUrl(undo.action, app.threadId, list.seq), undo.input),
  ).undo;
  const view = json<ThreadView>(await app.get(`/api/threads/${app.threadId}`));
  // Still done, at the version the Undo made, with its marker.
  assert.deepEqual([view.state, view.regionVersion], ["done", 3]);
  assert.ok(view.members.some((m) => m.ref.id === "jira:SYN-10"));
  const marker = view.entries.findLast((e) => e.kind === "marker");
  assert.ok(marker?.kind === "marker" && marker.to === 3 && marker.ownAgent === undefined);
  assert.ok(redo);
  await app.post(undoUrl(redo.action, app.threadId, list.seq), redo.input);
  const again = json<ThreadView>(await app.get(`/api/threads/${app.threadId}`));
  assert.equal(again.regionVersion, 4);
  // Undoing the done mark changes no version.
  const reopen = lastList(again).lines[1]?.undo;
  assert.ok(reopen);
  await app.post(undoUrl(reopen.action, app.threadId, list.seq, 1), reopen.input);
  const reopened = json<ThreadView>(await app.get(`/api/threads/${app.threadId}`));
  assert.deepEqual([reopened.state, reopened.regionVersion], ["working", 4]);
});
