import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { DiffView, ThreadsView, ThreadView, WorkstreamView } from "@oriel/web/view";
import type { TurnInput } from "./agent.ts";
import type { Step } from "./scripted-agent.ts";
import { json, type Script, testApp } from "./testing.ts";

const bug = "jira:SYN-17";

const scripts: Record<string, Script> = {
  plan: async () => ({
    value: null,
    writes: [
      ["jira.createEpic", [{ summary: "Kiosk wallets" }], "new:1"],
      ["jira.createStory", [{ summary: "Tap to pay", epic: "new:1" }], "new:2"],
    ],
  }),
  join: async (bindings) => {
    await bindings.read("search", ["login", 5]);
    return { intents: [["workstream.add", [{ items: [bug] }]]] };
  },
  offer: async () => ({ drafts: [["window.continue", [{ item: bug }]]] }),
};

const plan = (input: TurnInput): Step[] => {
  if (input.text.startsWith("Plan")) return [{ run: "plan" }, { text: "Below." }];
  if (input.text.startsWith("Gather")) return [{ run: "join" }, { text: "Added." }];
  if (input.windowChat && input.about?.length) return [{ run: "offer" }, { text: "Over there." }];
  return [{ text: "Hello." }];
};

async function app(t: TestContext) {
  const it = await testApp(t, { memory: true, plan, scripts });
  const current = async () =>
    json<{ thread: string | null }>(await it.get("/api/window-chat")).thread;
  const ask = async (text: string, about?: { id: string; under: null }[]) => {
    const asked = await it.post("/api/window-chat/messages", { text, about });
    await it.app.settled();
    return json<{ id: string }>(asked).id;
  };
  const listed = async (id: string) =>
    json<ThreadsView>(await it.get("/api/threads")).threads.find((each) => each.id === id);
  const handedOver = async (moved: string) => {
    assert.equal(await current(), null, "the window shows a fresh chat");
    const thread = await listed(moved);
    assert.deepEqual([thread?.state, thread?.waitingOn], ["working", "reply"]);
    assert.equal((await it.post("/api/window-chat/new", {})).status, 200);
    assert.deepEqual(
      [(await listed(moved))?.state, (await listed(moved))?.waitingOn],
      ["working", "reply"],
      "New chat leaves it open",
    );
    assert.equal(
      it.app.telemetry().filter((e) => e.name === "window-chat.new-chat").length,
      0,
      "New chat had no chat to leave",
    );
    const next = await ask("Hello again");
    assert.notEqual(next, moved);
  };
  return { ...it, current, ask, handedOver };
}

test("a plan's change set applied in the window chat moves it into its workstream, where a reply reopens it", async (t) => {
  const it = await app(t);
  const id = await it.ask("Plan kiosk wallets");
  const set = json<ThreadView>(await it.get(`/api/threads/${id}`)).entries.find(
    (e) => e.kind === "change-set",
  );
  assert.ok(set?.kind === "change-set");
  assert.equal(await it.current(), id);
  const { hash } = json<DiffView>(await it.post(`/api/change-sets/${set.changeSetId}/diff`));
  it.advance(1000);
  const approved = await it.post(`/api/change-sets/${set.changeSetId}/approve`, { hash });
  assert.equal(approved.status, 200);
  await it.app.settled();
  const workstream = json<ThreadView>(await it.get(`/api/threads/${id}`)).workstream.id;
  const members = json<WorkstreamView>(await it.get(`/api/workstreams/${workstream}`)).members;
  assert.deepEqual(
    members.map((m) => m.ref.key),
    ["SYN-900", "SYN-901"],
  );
  await it.post(`/api/threads/${id}/messages`, { text: "Thanks" });
  await it.app.settled();
  await it.handedOver(id);
});

test("the agent adding items to the window chat's workstream moves the chat into it", async (t) => {
  const it = await app(t);
  const id = await it.ask("Gather the login bug");
  const view = json<ThreadView>(await it.get(`/api/threads/${id}`));
  assert.deepEqual(
    view.members.map((m) => m.ref.id),
    [bug],
  );
  await it.handedOver(id);
});

test("Continue in… hands the request to a thread that is the user's turn, which New chat leaves open", async (t) => {
  const it = await app(t);
  const chat = await it.ask("Estimate it at 3", [{ id: bug, under: null }]);
  const offer = json<ThreadView>(await it.get(`/api/threads/${chat}`)).entries.find(
    (e) => e.kind === "continue",
  );
  assert.ok(offer?.kind === "continue");
  it.advance(1000);
  const pressed = await it.post(`/api/threads/${chat}/held/${offer.seq}/apply`, {});
  const { thread } = json<{ thread: string }>(pressed);
  await it.app.settled();
  await it.handedOver(thread);
});
