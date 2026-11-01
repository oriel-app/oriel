// Closing a thread from a list of threads: marking it done, or deleting it.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type {
  ChangeSetView,
  DeletedView,
  DeletionView,
  DiffView,
  GroupsView,
  GroupView,
  ThreadsView,
  StreamEvent,
  ThreadView,
} from "@oriel/web/view";
import type { Agent } from "./agent.ts";
import { json, type Script, testApp } from "./testing.ts";

const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };
const estimate: Script = async () => ({
  value: null,
  writes: [["jira.setEstimate", ["jira:SYN-23", 3]]],
});

async function thread(t: TestContext, options: Parameters<typeof testApp>[1] = {}) {
  const app = await testApp(t, options);
  const { id: groupId } = json<{ id: string }>(await app.post("/api/groups", checkout));
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/groups/${groupId}/threads`, { text: "Estimate SYN-23" }),
  );
  await app.app.settled();
  const listed = async () =>
    json<ThreadsView>(await app.get("/api/threads")).threads.map((each) => each.id);
  const lastEvent = () => app.app.telemetry().at(-1);
  return { ...app, groupId, threadId, listed, lastEvent };
}

// Reads a stream's events until it ends.
async function readAll(stream: AsyncIterator<string>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for (;;) {
    const next = await stream.next();
    if (next.done) return events;
    const data = /^data: (.*)$/m.exec(next.value)?.[1];
    if (data !== undefined) events.push(JSON.parse(data) as StreamEvent);
  }
}

test("marking a thread done from a menu is marking it done, told apart in telemetry", async (t) => {
  const app = await thread(t);
  app.advance(1000);
  const done = json<ThreadView>(
    await app.post(`/api/threads/${app.threadId}/done`, { via: "menu" }),
  );
  assert.deepEqual([done.state, done.doneBy], ["done", "marked"]);
  assert.deepEqual(app.lastEvent()?.data, { threadId: app.threadId, via: "menu" });
  // The thread's page sends nothing, and is the page.
  await app.post(`/api/threads/${app.threadId}/done`);
  assert.deepEqual(app.lastEvent()?.data, { threadId: app.threadId, via: "page" });
  const refused = await app.post(`/api/threads/${app.threadId}/done`, { via: "elsewhere" });
  assert.equal(refused.status, 400);
});

test("a thread that wrote nothing is deleted from everywhere, and its group stays", async (t) => {
  const app = await thread(t);
  const deletion = json<DeletionView>(await app.get(`/api/threads/${app.threadId}/deletion`));
  assert.deepEqual(deletion, { applied: 0, reverted: 0, unconfirmed: 0, sources: [] });
  const reply = await app.post(`/api/threads/${app.threadId}/delete`, { via: "menu" });
  assert.equal(reply.status, 200);
  assert.deepEqual(json<DeletedView>(reply), { groupId: app.groupId, groupRemoved: false });
  assert.equal((await app.get(`/api/threads/${app.threadId}`)).status, 404);
  assert.equal((await app.get(`/api/threads/${app.threadId}/deletion`)).status, 404);
  assert.equal((await app.post(`/api/threads/${app.threadId}/delete`)).status, 404);
  assert.deepEqual(await app.listed(), []);
  const group = json<GroupView>(await app.get(`/api/groups/${app.groupId}`));
  assert.deepEqual(group.threads, []);
  assert.equal(group.group.threads.working, 0);
  assert.deepEqual(app.lastEvent(), {
    name: "thread.deleted",
    at: app.lastEvent()?.at,
    data: {
      threadId: app.threadId,
      groupId: app.groupId,
      kept: false,
      groupRemoved: false,
      via: "menu",
    },
  });
});

test("deleting a thread from nothing removes the group made for it", async (t) => {
  const app = await testApp(t);
  const { id, groupId } = json<{ id: string; groupId: string }>(
    await app.post("/api/threads", { text: "Plan kiosk wallets" }),
  );
  await app.app.settled();
  const deleted = json<DeletedView>(await app.post(`/api/threads/${id}/delete`));
  assert.deepEqual(deleted, { groupId, groupRemoved: true });
  assert.equal((await app.get(`/api/groups/${groupId}`)).status, 404);
  assert.deepEqual(json<GroupsView>(await app.get("/api/groups")).groups, []);
});

test("a thread that wrote to Jira says so, and once deleted keeps its records out of reach", async (t) => {
  const app = await thread(t, {
    writes: true,
    plan: () => [{ run: "estimate" }],
    scripts: { estimate },
  });
  const entry = json<ThreadView>(await app.get(`/api/threads/${app.threadId}`)).entries.find(
    (e) => e.kind === "change-set",
  );
  assert.ok(entry?.kind === "change-set");
  const { hash } = json<DiffView>(await app.post(`/api/change-sets/${entry.changeSetId}/diff`));
  app.advance(1000);
  const approved = json<{ changeSet: ChangeSetView }>(
    await app.post(`/api/change-sets/${entry.changeSetId}/approve`, { hash }),
  );
  assert.equal(approved.changeSet.status, "applied");
  assert.deepEqual(json<DeletionView>(await app.get(`/api/threads/${app.threadId}/deletion`)), {
    applied: 1,
    reverted: 0,
    unconfirmed: 0,
    sources: ["jira"],
  });
  assert.deepEqual(json<DeletedView>(await app.post(`/api/threads/${app.threadId}/delete`)), {
    groupId: app.groupId,
    groupRemoved: false,
  });
  assert.equal(app.lastEvent()?.data.kept, true);
  assert.deepEqual(await app.listed(), []);
  assert.equal((await app.get(`/api/threads/${app.threadId}`)).status, 404);
  // Its change sets can't be acted on, here or by a review link.
  assert.equal((await app.post(`/api/change-sets/${entry.changeSetId}/revert`)).status, 404);
  assert.equal((await app.post(`/api/change-sets/${entry.changeSetId}/review-link`)).status, 404);
  assert.equal(app.site?.issue("SYN-23")?.points, 3, "what it wrote stays in Jira");
});

// Answers until stopped.
const answering: Agent = {
  async *turn(_input, { signal }) {
    await new Promise((resolve) => signal.addEventListener("abort", resolve));
    yield { kind: "done", usage: { inputTokens: 0, outputTokens: 0 } };
  },
};

test("a thread whose agent is answering isn't deleted", async (t) => {
  const app = await testApp(t, { agent: () => answering });
  const { id: groupId } = json<{ id: string }>(await app.post("/api/groups", checkout));
  const { id } = json<{ id: string }>(
    await app.post(`/api/groups/${groupId}/threads`, { text: "Think" }),
  );
  const refused = await app.post(`/api/threads/${id}/delete`);
  assert.equal(refused.status, 409);
  assert.match(json<{ error: string }>(refused).error, /still answering/);
  await app.post(`/api/threads/${id}/stop`);
  await app.app.settled();
  assert.equal((await app.post(`/api/threads/${id}/delete`)).status, 200);
});

test("a deleted thread's page hears it, and its stream ends; other pages hear a move", async (t) => {
  const app = await thread(t);
  const own = (await app.get(`/api/threads/${app.threadId}/events`)).stream;
  const any = (await app.get("/api/threads/events")).stream;
  assert.ok(own && any);
  const anyStream = any[Symbol.asyncIterator]();
  assert.equal((await anyStream.next()).value, "retry: 2000\n\n");
  await app.post(`/api/threads/${app.threadId}/delete`);
  const events = await readAll(own[Symbol.asyncIterator]());
  assert.deepEqual(events.at(-1), { type: "deleted" });
  assert.equal((await anyStream.next()).value, 'data: {"type":"threads"}\n\n');
  await anyStream.return?.();
});

test("a thread deleted while its title is on the way takes none, and nothing fails", async (t) => {
  const answer = Promise.withResolvers<string | null>();
  let asked = false;
  const app = await testApp(t, {
    titler: () => {
      asked = true;
      return answer.promise;
    },
  });
  const { id } = json<{ id: string }>(
    await app.post("/api/threads", { text: "Plan kiosk wallets" }),
  );
  assert.ok(asked);
  // Its turn ends; its title hasn't come.
  const stream = (await app.get(`/api/threads/${id}/events`)).stream?.[Symbol.asyncIterator]();
  assert.ok(stream);
  for (;;) {
    const next: IteratorResult<string> = await stream.next();
    assert.ok(!next.done);
    if (next.value.includes('"running":false')) break;
  }
  assert.equal((await app.post(`/api/threads/${id}/delete`)).status, 200);
  answer.resolve("Kiosk wallets");
  await app.app.settled();
  assert.deepEqual(
    app.logged.filter((line) => line.message.startsWith("title:")),
    [],
  );
});

test("a swipe closes a thread as the menu does, told apart in telemetry", async (t) => {
  const app = await thread(t);
  app.advance(1000);
  await app.post(`/api/threads/${app.threadId}/done`, { via: "swipe" });
  assert.deepEqual(app.lastEvent()?.data, { threadId: app.threadId, via: "swipe" });
  await app.post(`/api/threads/${app.threadId}/delete`, { via: "swipe" });
  assert.equal(app.lastEvent()?.data.via, "swipe");
});
