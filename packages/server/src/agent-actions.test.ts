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
import type { Step } from "./scripted-agent.ts";
import { json, type Script, testApp } from "./testing.ts";

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
    held: { sendHeld: () => assert.fail(), discardHeld: () => assert.fail() },
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
