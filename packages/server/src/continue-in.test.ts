import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { ChatEntry, DiffView, ThreadView } from "@oriel/web/view";
import type { TurnInput } from "./agent.ts";
import type { Step } from "./scripted-agent.ts";
import { json, type Script, testApp } from "./testing.ts";

const bug = "jira:SYN-17";
const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };
const looking = [{ id: bug, under: null }];

const scripts: Record<string, Script> = {
  join: async () => ({ intents: [["workstream.add", [{ items: [bug] }]]] }),
  estimate: async () => ({ writes: [["jira.setEstimate", [bug, 3]]] }),
  offer: async () => ({ drafts: [["window.continue", [{ item: bug }]]] }),
};

const plan = (input: TurnInput): Step[] => {
  const about = input.about?.[0];
  if (!about) return [{ text: "Hello." }];
  if (input.windowChat) return [{ run: "offer" }, { text: "Its workstream can change it." }];
  return [...(about.outside ? [{ run: "join" }] : []), { run: "estimate" }];
};

const proposed = async (app: Awaited<ReturnType<typeof testApp>>, view: ThreadView) => {
  const set = view.entries.find((e) => e.kind === "change-set");
  assert.ok(set?.kind === "change-set", "the turn proposed a change set");
  const diff = json<DiffView>(await app.post(`/api/change-sets/${set.changeSetId}/diff`));
  return diff.lines.map((line) => line.target?.id ?? null);
};

test("a thread asked to change a looked-at item outside its region adds it, with Undo, and proposes the change in one turn", async (t: TestContext) => {
  const app = await testApp(t, { plan, scripts });
  const { id: workstreamId } = json<{ id: string }>(await app.post("/api/workstreams", checkout));
  const { id } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Hello" }),
  );
  await app.app.settled();
  await app.post(`/api/threads/${id}/messages`, { text: "Estimate it at 3", about: looking });
  await app.app.settled();
  const view = json<ThreadView>(await app.get(`/api/threads/${id}`));
  const asked = view.entries.findLast((e) => e.kind === "user");
  assert.deepEqual(asked?.kind === "user" && asked.about, [{ id: bug, outside: true }]);
  const turn = view.entries.slice(view.entries.indexOf(asked as ChatEntry));
  const lines = turn.flatMap((e) => (e.kind === "actions" ? e.lines : []));
  assert.deepEqual(
    lines.map((line) => [line.applied, line.undo !== null]),
    [[true, true]],
  );
  const kinds = turn.map((e) => e.kind);
  const marker = turn.find((e) => e.kind === "marker");
  assert.deepEqual(marker?.kind === "marker" && marker.added.map((ref) => ref.id), [bug]);
  assert.ok(kinds.indexOf("marker") < kinds.indexOf("change-set"), kinds.join(", "));
  assert.deepEqual(await proposed(app, view), [bug]);
});

test("the window chat asked to change an item offers one Continue, which lands in a thread whose change set is proposed", async (t: TestContext) => {
  const app = await testApp(t, { plan, scripts });
  const asked = await app.post("/api/window-chat/messages", {
    text: "Estimate it at 3",
    about: looking,
  });
  const { id: chat } = json<{ id: string }>(asked);
  await app.app.settled();
  const before = json<ThreadView>(await app.get(`/api/threads/${chat}`));
  const offers = before.entries.filter((e) => e.kind === "continue");
  assert.equal(offers.length, 1);
  const [offer] = offers;
  assert.ok(offer?.kind === "continue");
  assert.deepEqual(
    { item: offer.item.id, workstream: offer.workstream, outcome: offer.outcome },
    { item: bug, workstream: null, outcome: null },
  );
  assert.equal(before.changeSets.length, 0, "the window chat proposed nothing");

  app.advance(1000);
  const pressed = await app.post(`/api/threads/${chat}/held/${offer.seq}/apply`, {});
  assert.equal(pressed.status, 200);
  const { thread } = json<{ thread: string }>(pressed);
  await app.app.settled();
  const there = json<ThreadView>(await app.get(`/api/threads/${thread}`));
  assert.equal(there.workstream.name, "Crew login times out during the morning shift change");
  assert.deepEqual(
    there.members.map((m) => m.ref.id),
    [bug],
  );
  const held = there.entries.find((e) => e.kind === "held");
  assert.deepEqual(held?.kind === "held" && [held.from, held.outcome], [
    { kind: "window-chat", chatId: chat },
    "sent",
  ]);
  const said = there.entries.find((e) => e.kind === "user");
  assert.deepEqual(said?.kind === "user" && [said.text, said.about], [
    "Estimate it at 3",
    [{ id: bug, outside: false }],
  ]);
  assert.deepEqual(await proposed(app, there), [bug]);

  assert.equal(json<{ thread: string | null }>(await app.get("/api/window-chat")).thread, null);
  const after = json<ThreadView>(await app.get(`/api/threads/${chat}`));
  assert.equal(after.state, "done");
  const went = after.entries.find((e) => e.kind === "continue");
  assert.deepEqual(went?.kind === "continue" && [went.thread, went.outcome], [thread, "applied"]);
  const counted = app.app.telemetry().filter((e) => e.name === "window-chat.continued");
  assert.deepEqual(
    counted.map((e) => e.data),
    [{ threadId: chat, to: thread, made: true, kept: false }],
  );
});
