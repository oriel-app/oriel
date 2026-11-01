// Rejecting a change set: the thread asks what was wrong, and a reason given
// with the rejection in the thread is the thread's next message, which the
// agent answers with a revised change set. A review link's is held instead
// (held.test.ts).
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type {
  ChangeSetView,
  ChatEntry,
  DiffView,
  ThreadSummaryView,
  ThreadView,
} from "@oriel/web/view";
import type { Agent, ChatMessage } from "./agent.ts";
import { scriptedAgent } from "./scripted-agent.ts";
import { json, type Script, testApp } from "./testing.ts";

// SYN-1's epic cluster is keyed by the epic's stable ID.
const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };

// Each turn proposes a new title for SYN-23.
const rename: Script = async () => ({
  value: null,
  writes: [["jira.setSummary", ["jira:SYN-23", "Practice: reject me"]]],
});

const asked = /^You rejected this change set, so nothing in it will change\. What was wrong/;

async function proposed(t: TestContext, options: Parameters<typeof testApp>[1] = {}) {
  // What each turn's agent was given.
  const turns: { history: ChatMessage[]; text: string }[] = [];
  const app = await testApp(t, {
    plan: (input) => {
      turns.push({ history: input.history, text: input.text });
      return [{ run: "rename" }, { text: "I proposed a new title." }];
    },
    scripts: { rename },
    ...options,
  });
  const { id: groupId } = json<{ id: string }>(await app.post("/api/groups", checkout));
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/groups/${groupId}/threads`, { text: "Rename SYN-23" }),
  );
  await app.app.settled();
  const view = async () => json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  const [set] = (await view()).changeSets;
  assert.ok(set, "the first turn proposed a change set");
  const hash = json<DiffView>(await app.post(`/api/change-sets/${set.id}/diff`)).hash;
  const reject = (body: Record<string, unknown> = {}) =>
    app.post(`/api/change-sets/${set.id}/reject`, { hash, ...body });
  const waits = async () =>
    json<{ threads: ThreadSummaryView[] }>(await app.get("/api/threads")).threads.map(
      (s) => s.waitingOn,
    );
  return { ...app, turns, threadId, changeSetId: set.id, hash, view, reject, waits };
}

// What was said after the first turn ended: who said what.
const said = (entries: readonly ChatEntry[]) =>
  entries
    .slice(entries.findIndex((e) => e.kind === "done") + 1)
    .flatMap((e) => (e.kind === "user" || e.kind === "text" ? [[e.kind, e.text]] : []));

test("a rejection with no reason leaves the thread asking what was wrong, and starts no turn", async (t) => {
  const app = await proposed(t);
  const reply = await app.reject();
  assert.equal(reply.status, 200);
  const body = json<{ changeSet: ChangeSetView; problem: string | null }>(reply);
  assert.deepEqual([body.changeSet.status, body.problem], ["rejected", null]);
  await app.app.settled();
  const view = await app.view();
  const after = said(view.entries);
  assert.equal(after.length, 1);
  assert.equal(after[0]?.[0], "text");
  assert.match(after[0]?.[1] ?? "", asked);
  assert.equal(app.turns.length, 1, "no turn ran");
  // It's the user's turn: the question is it.
  assert.deepEqual(await app.waits(), ["reply"]);
  // Answered later as any message is, the agent reads its question first,
  // after what it said in its turn.
  await app.post(`/api/threads/${app.threadId}/messages`, { text: "Wrong title." });
  await app.app.settled();
  const last = app.turns.at(-1)?.history.at(-1);
  assert.equal(last?.role, "assistant");
  assert.match(last?.role === "assistant" ? last.text : "", /new title\.\n\nYou rejected/);
});

test("a reason with a rejection is the user's next message, which the agent answers with a revised change set", async (t) => {
  const app = await proposed(t);
  const reason = 'Title should be "Practice: reject you"';
  const reply = await app.reject({ reason });
  assert.equal(reply.status, 200);
  assert.equal(json<{ problem: string | null }>(reply).problem, null);
  await app.app.settled();
  const view = await app.view();
  assert.deepEqual(
    said(view.entries)
      .slice(0, 2)
      .map(([kind]) => kind),
    ["text", "user"],
  );
  assert.equal(said(view.entries)[1]?.[1], reason);
  // The agent got the reason as the message, after its question.
  const turn = app.turns.at(-1);
  assert.equal(turn?.text, reason);
  const last = turn?.history.at(-1);
  assert.match(last?.role === "assistant" ? last.text : "", /What was wrong with it\?/);
  // The rejected change set stays, above the revised one.
  assert.deepEqual(
    view.changeSets.map((s) => s.status),
    ["rejected", "open"],
  );
  const order = view.entries.flatMap((e) => (e.kind === "change-set" ? [e.changeSetId] : []));
  assert.equal(order[0], app.changeSetId);
  assert.deepEqual(await app.waits(), ["review"]);
  const asked = app.app.telemetry().filter((e) => e.name === "question.asked");
  assert.deepEqual(
    asked.map((e) => e.data.rejected),
    [undefined, app.changeSetId],
  );
});

// The first turn proposes; any later one thinks until stopped.
function thenWaits(first: Agent): Agent {
  let turns = 0;
  return {
    async *turn(input, options) {
      if (turns++ === 0) {
        yield* first.turn(input, options);
        return;
      }
      const { signal } = options;
      yield { kind: "text", text: "Thinking" };
      await new Promise((resolve) => signal.addEventListener("abort", resolve));
      yield { kind: "done", usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
}

test("while the agent answers, a rejection stands without asking, and says its reason can't be said yet", async (t) => {
  const app = await proposed(t, {
    agent: (deps) =>
      thenWaits(scriptedAgent(deps, () => [{ run: "rename" }, { text: "I proposed it." }])),
  });
  await app.post(`/api/threads/${app.threadId}/messages`, { text: "And the epic?" });
  const reply = await app.reject({ reason: "Wrong title." });
  assert.equal(reply.status, 200);
  const body = json<{ changeSet: ChangeSetView; problem: string | null }>(reply);
  assert.equal(body.changeSet.status, "rejected");
  assert.match(body.problem ?? "", /still answering/);
  await app.post(`/api/threads/${app.threadId}/stop`);
  await app.app.settled();
  const entries = (await app.view()).entries;
  assert.ok(!entries.some((e) => e.kind === "text" && asked.test(e.text)));
  assert.ok(!entries.some((e) => e.kind === "user" && e.text === "Wrong title."));
});

test("a thread with no questions left takes the rejection, says why its reason can't follow, and doesn't ask", async (t) => {
  const app = await proposed(t, { limits: { maxTurnsPerThread: 1 } });
  const reply = await app.reject({ reason: "Wrong title." });
  assert.equal(reply.status, 200);
  const body = json<{ changeSet: ChangeSetView; problem: string | null }>(reply);
  assert.equal(body.changeSet.status, "rejected");
  assert.match(body.problem ?? "", /all 1 of its questions/);
  const entries = (await app.view()).entries;
  assert.ok(!entries.some((e) => e.kind === "text" && asked.test(e.text)));
  assert.ok(!entries.some((e) => e.kind === "user" && e.text === "Wrong title."));
  assert.equal(entries.at(-1)?.kind, "limit");
});

test("two rejections in a row ask twice, each a paragraph of its own", async (t) => {
  const app = await proposed(t);
  await app.post(`/api/threads/${app.threadId}/messages`, { text: "And another" });
  await app.app.settled();
  const second = (await app.view()).changeSets[1];
  assert.ok(second);
  const hash = json<DiffView>(await app.post(`/api/change-sets/${second.id}/diff`)).hash;
  assert.equal((await app.reject()).status, 200);
  assert.equal((await app.post(`/api/change-sets/${second.id}/reject`, { hash })).status, 200);
  await app.post(`/api/threads/${app.threadId}/messages`, { text: "Both wrong." });
  await app.app.settled();
  const last = app.turns.at(-1)?.history.at(-1);
  assert.match(
    last?.role === "assistant" ? last.text : "",
    /new title\.\n\nYou rejected [^\n]+revised one\.\n\nYou rejected [^\n]+revised one\.$/,
  );
});

test("rejecting an Undo asks nothing: Oriel made it, not the agent", async (t) => {
  const app = await proposed(t, { writes: true });
  assert.equal(
    (await app.post(`/api/change-sets/${app.changeSetId}/approve`, { hash: app.hash })).status,
    200,
  );
  const undo = json<{ revert: string }>(
    await app.post(`/api/change-sets/${app.changeSetId}/revert`),
  ).revert;
  const hash = json<DiffView>(await app.post(`/api/change-sets/${undo}/diff`)).hash;
  const reply = await app.post(`/api/change-sets/${undo}/reject`, { hash });
  assert.equal(json<{ changeSet: ChangeSetView }>(reply).changeSet.status, "rejected");
  const entries = (await app.view()).entries;
  assert.ok(!entries.some((e) => e.kind === "text" && asked.test(e.text)));
});
