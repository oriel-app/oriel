// The window chat (decision 0027): New chat never drops a change set that
// still waits on the user, and no other thread reads the window.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { StartQuestion } from "@oriel/core/window-chat";
import { planQuestion } from "@oriel/web/questions";
import type { OverviewView, ThreadsView, ThreadView } from "@oriel/web/view";
import { json, type Script, testApp } from "./testing.ts";

const epic: Script = async () => ({
  value: null,
  writes: [["jira.createEpic", [{ summary: "Kiosk wallets" }], "new:1"]],
});

async function app(t: TestContext) {
  const it = await testApp(t, {
    plan: (input) => (input.text.startsWith("Plan") ? [{ run: "epic" }] : [{ text: "Hello." }]),
    scripts: { epic },
  });
  const current = async () =>
    json<{ thread: string | null }>(await it.get("/api/window-chat")).thread;
  const ask = async (text: string) => {
    const reply = await it.post("/api/window-chat/messages", { text });
    await it.app.settled();
    return { status: reply.status, ...json<{ id: string; seq: number }>(reply) };
  };
  return { ...it, current, ask };
}

test("with a change set waiting, New chat leaves the old chat working, in Needs you, out of the window chat", async (t) => {
  const it = await app(t);
  const { id } = await it.ask("Plan kiosk wallets");
  const before = json<ThreadView>(await it.get(`/api/threads/${id}`));
  assert.ok(before.changeSets.some((set) => set.status === "open"));

  await it.post("/api/window-chat/new", {});
  assert.equal(await it.current(), null);
  const kept = json<ThreadView>(await it.get(`/api/threads/${id}`));
  assert.equal(kept.state, "working");
  assert.ok(kept.changeSets.some((set) => set.status === "open"));
  const listed = json<ThreadsView>(await it.get("/api/threads")).threads.find(
    (each) => each.id === id,
  );
  assert.equal(listed?.waitingOn, "review");
});

test("a thread on any other workstream has no window namespace", async (t) => {
  const read: Script = async (bindings) => ({
    value: await bindings.read("window.overview", []).then(
      () => "read",
      (error: Error) => error.message,
    ),
  });
  const it = await testApp(t, { plan: () => [{ run: "read" }], scripts: { read } });
  const { id } = json<{ id: string }>(await it.post("/api/threads", { text: "Read the window" }));
  await it.app.settled();
  const finished = json<ThreadView>(await it.get(`/api/threads/${id}`)).entries.find(
    (e) => e.kind === "run.finished",
  );
  assert.ok(finished?.kind === "run.finished");
  assert.notEqual(finished.run.returned, JSON.stringify("read"));
});

test("a question to start from titles its thread with its button's words", async (t) => {
  const asked: string[] = [];
  const it = await testApp(t, {
    plan: () => [{ text: "Hello." }],
    titler: async (text) => {
      asked.push(text);
      return "Written by the title model";
    },
  });
  const overview = json<OverviewView>(await it.get("/api/overview"));
  const top = overview.candidates.rows[0]?.subject;
  const item = top?.kind === "item" ? top.item : top?.lead;
  assert.ok(item?.title);
  const made = await it.post("/api/workstreams", {
    kind: "picked",
    name: "Kiosk wallets",
    items: [item.id],
  });
  const { id: workstream } = json<{ id: string }>(made);
  const asks: [StartQuestion, string | undefined, string][] = [
    ["chart-moved", undefined, "Chart what moved since I looked, by workstream"],
    ["moved-most", workstream, "What moved in Kiosk wallets?"],
    ["stalled", workstream, "Why is Kiosk wallets stalled?"],
    ["candidates", item.id, `Should ${item.title} become a workstream?`],
    ["make-candidate", item.id, `Make ${item.title} a workstream`],
    ["plan", undefined, planQuestion],
  ];
  const titleOf = async (subject: string | undefined, kind: StartQuestion) => {
    await it.post("/api/window-chat/new", {});
    const question = subject === undefined ? { kind } : { kind, subject };
    const reply = await it.post("/api/window-chat/messages", { text: "A question", question });
    await it.app.settled();
    const { id } = json<{ id: string }>(reply);
    const listed = json<ThreadsView>(await it.get("/api/threads")).threads;
    return listed.find((each) => each.id === id)?.title;
  };
  for (const [kind, subject, label] of asks)
    assert.equal(await titleOf(subject, kind), label, kind);
  assert.deepEqual(asked, []);

  assert.equal(
    await titleOf("01JZZZZZZZZZZZZZZZZZZZZZZZ", "stalled"),
    "Written by the title model",
  );
  assert.deepEqual(asked, ["A question"]);
});
