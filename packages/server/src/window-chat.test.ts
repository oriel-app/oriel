// The window chat's lifecycle (decision 0027): its first question makes its
// thread and workstream; New chat starts afresh, marking the old one done
// unless it waits on the user; an empty one's workstream is hidden from every
// list, and its chat still opens.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { OverviewView, ThreadsView, ThreadView, WorkstreamsView } from "@oriel/web/view";
import { agent, type ModelEvent, type Provider, runToolName, type Usage } from "@oriel/agent";
import { json, type Script, testApp } from "./testing.ts";

const epic: Script = async () => ({
  value: null,
  writes: [["jira.createEpic", [{ summary: "Kiosk wallets" }], "new:1"]],
});

const usage: Usage = { inputTokens: 40, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };

// A model that asks for one run of `script`, then says something.
function runsThenSays(script: string): Provider {
  return {
    converse() {
      let responses = 0;
      return {
        async *next(): AsyncGenerator<ModelEvent> {
          responses += 1;
          if (responses === 1) {
            yield { kind: "call", call: { id: "call-1", name: runToolName, input: { script } } };
            yield { kind: "end", stop: "calls", detail: null, model: "scripted-model", usage };
            return;
          }
          yield { kind: "text", text: "Done." };
          yield { kind: "end", stop: "done", detail: null, model: "scripted-model", usage };
        },
      };
    },
  };
}

const list: Script = async (bindings) => ({
  value: (await bindings.read("workstream.list", [])).value,
});

async function app(t: TestContext) {
  const it = await testApp(t, {
    plan: (input) =>
      input.text.startsWith("Plan")
        ? [{ run: "epic" }]
        : input.text.startsWith("List")
          ? [{ run: "list" }]
          : [{ text: "Hello." }],
    scripts: { epic, list },
  });
  const current = async () =>
    json<{ thread: string | null }>(await it.get("/api/window-chat")).thread;
  const listed = async () =>
    json<WorkstreamsView>(await it.get("/api/workstreams")).workstreams.map((w) => w.name);
  const ask = async (text: string) => {
    const reply = await it.post("/api/window-chat/messages", { text });
    await it.app.settled();
    return { status: reply.status, ...json<{ id: string; seq: number }>(reply) };
  };
  const events = (name: string) =>
    it.app
      .telemetry()
      .filter((event) => event.name === name)
      .map((event) => event.data);
  return { ...it, current, listed, ask, events };
}

test("opening the overview makes no thread; the first question makes one, on a workstream the sidebar lists", async (t) => {
  const it = await app(t);
  assert.equal((await it.get("/api/overview")).status, 200);
  assert.equal(await it.current(), null);
  assert.deepEqual(json<ThreadsView>(await it.get("/api/threads")).threads, []);
  assert.deepEqual(await it.listed(), []);

  const first = await it.ask("What moved?");
  assert.equal(first.status, 201);
  assert.equal(await it.current(), first.id);
  assert.deepEqual(await it.listed(), ["Window chat"]);
  const [made] = json<WorkstreamsView>(await it.get("/api/workstreams")).workstreams;
  assert.equal(made?.origin.kind, "window");
  assert.equal(json<ThreadView>(await it.get(`/api/threads/${first.id}`)).workstream.id, made.id);
  assert.deepEqual(it.events("window-chat.opened"), [{ threadId: first.id }]);

  // The next question goes to the same chat.
  const second = await it.ask("And since Monday?");
  assert.deepEqual([second.status, second.id], [202, first.id]);
  assert.equal(it.events("question.asked").length, 2);
});

test("New chat marks the old chat done, hides its empty workstream everywhere, and the chat still opens", async (t) => {
  const it = await app(t);
  const { id } = await it.ask("What moved?");
  const workstreamId = json<ThreadView>(await it.get(`/api/threads/${id}`)).workstream.id;
  it.advance(1000);

  const reply = await it.post("/api/window-chat/new", {});
  assert.deepEqual(json(reply), { left: id });
  assert.equal(await it.current(), null);
  const old = json<ThreadView>(await it.get(`/api/threads/${id}`));
  assert.deepEqual([old.state, old.doneBy], ["done", "marked"]);
  assert.deepEqual(it.events("thread.marked-done"), [{ threadId: id, via: "new-chat" }]);
  assert.deepEqual(it.events("window-chat.new-chat"), [{ threadId: id, kept: false }]);

  // Gone from every list: the sidebar's and the pickers'.
  assert.deepEqual(await it.listed(), []);
  // Still there, so the Done page opens it.
  const done = json<ThreadsView>(await it.get("/api/threads")).threads.find(
    (each) => each.id === id,
  );
  assert.equal(done?.state, "done");
  assert.equal((await it.get(`/api/workstreams/${workstreamId}`)).status, 200);

  // The next question starts a fresh chat on a workstream of its own.
  const fresh = await it.ask("Who is busiest?");
  assert.equal(fresh.status, 201);
  assert.notEqual(fresh.id, id);
  assert.equal(
    json<ThreadView>(await it.get(`/api/threads/${fresh.id}`)).entries.filter(
      (e) => e.kind === "user",
    ).length,
    1,
  );
  assert.deepEqual(await it.listed(), ["Window chat"]);

  // And from Oriel's reads: the agent sees only the fresh chat's own.
  await it.ask("List the workstreams");
  const run = json<ThreadView>(await it.get(`/api/threads/${fresh.id}`)).entries.findLast(
    (e) => e.kind === "run.finished",
  );
  assert.ok(run?.kind === "run.finished");
  assert.deepEqual(
    (JSON.parse(run.run.returned ?? "[]") as { id: string }[]).map((w) => w.id),
    [json<ThreadView>(await it.get(`/api/threads/${fresh.id}`)).workstream.id],
  );
});

test("with a change set waiting, New chat leaves the old chat working, in Needs you, out of the window chat", async (t) => {
  const it = await app(t);
  const { id } = await it.ask("Plan kiosk wallets");
  const before = json<ThreadView>(await it.get(`/api/threads/${id}`));
  assert.ok(before.changeSets.some((set) => set.status === "open"));

  await it.post("/api/window-chat/new", {});
  assert.equal(await it.current(), null);
  const kept = json<ThreadView>(await it.get(`/api/threads/${id}`));
  assert.equal(kept.state, "working");
  assert.deepEqual(it.events("thread.marked-done"), []);
  assert.deepEqual(it.events("window-chat.new-chat"), [{ threadId: id, kept: true }]);
  const listed = json<ThreadsView>(await it.get("/api/threads")).threads.find(
    (each) => each.id === id,
  );
  assert.equal(listed?.waitingOn, "review");
  // It has a working thread, so its workstream still shows.
  assert.deepEqual(await it.listed(), ["Window chat"]);
});

test("New chat with no window chat does nothing", async (t) => {
  const it = await app(t);
  assert.deepEqual(json(await it.post("/api/window-chat/new", {})), { left: null });
  assert.deepEqual(it.events("window-chat.new-chat"), []);
});

test("a window chat's workstream takes its thread's title, until the user names it", async (t) => {
  const it = await testApp(t, { titler: async (text) => `About ${text.slice(0, 5)}` });
  const names = async () =>
    json<WorkstreamsView>(await it.get("/api/workstreams")).workstreams.map((w) => w.name);
  const first = json<{ id: string }>(
    await it.post("/api/window-chat/messages", { text: "Moved since Monday?" }),
  );
  await it.app.settled();
  assert.deepEqual(await names(), ["About Moved"]);
  const workstream = json<ThreadView>(await it.get(`/api/threads/${first.id}`)).workstream.id;
  await it.post("/api/actions/workstream.rename", { workstream, name: "Mine" });
  assert.deepEqual(await names(), ["Mine"]);
});

test("the window chat's agent reads the overview: its items show as the escape-hatch block, and one can become a workstream", async (t) => {
  const read: Script = async (bindings) => {
    const answer = await bindings.read("window.overview", []);
    const view = answer.value as {
      candidates: {
        rows: {
          subject:
            | { kind: "item"; item: { id: string } }
            | { kind: "cluster"; lead: { id: string } | null };
        }[];
      };
    };
    const subject = view.candidates.rows[0]?.subject;
    const anchor = (subject?.kind === "item" ? subject.item : subject?.lead)?.id ?? "";
    return {
      value: anchor,
      intents: [["workstream.create", [{ kind: "picked", name: "Reservations", items: [anchor] }]]],
    };
  };
  // The real loop, which shows what a read reached as the escape-hatch block.
  const it = await testApp(t, {
    scripts: { read },
    agent: (deps) => agent({ ...deps, provider: runsThenSays("read") }),
  });
  const { id } = json<{ id: string }>(
    await it.post("/api/window-chat/messages", { text: "What should become a workstream?" }),
  );
  await it.app.settled();
  const view = json<ThreadView>(await it.get(`/api/threads/${id}`));
  const finished = view.entries.find((e) => e.kind === "run.finished");
  assert.ok(finished?.kind === "run.finished");
  assert.deepEqual(finished.run.reads, [
    { fn: "window.overview", status: "answered", outsideRegion: true },
  ]);
  const anchor = JSON.parse(finished.run.returned ?? "null") as string;
  const block = view.entries.find((e) => e.kind === "block" && e.block.outside);
  assert.ok(block?.kind === "block" && block.block.form === "rows");
  assert.ok(block.block.items.some((hit) => hit.ref.id === anchor && !hit.inRegion));
  assert.ok(it.app.telemetry().some((e) => e.name === "escape-hatch.used"));
  const actions = view.entries.find((e) => e.kind === "actions");
  assert.ok(actions?.kind === "actions");
  assert.equal(actions.lines[0]?.applied, true);
  assert.ok(actions.lines[0]?.undo !== null);
  assert.ok(
    json<WorkstreamsView>(await it.get("/api/workstreams")).workstreams.some(
      (w) => w.name === "Reservations",
    ),
  );
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
  assert.match(finished.run.returned ?? "", /isn't a read here/);
});

test("only the window chat's first thread is the window chat; one opened on its workstream later is ordinary", async (t) => {
  const it = await testApp(t);
  const { id } = json<{ id: string }>(
    await it.post("/api/window-chat/messages", { text: "What moved?" }),
  );
  await it.app.settled();
  const workstream = json<ThreadView>(await it.get(`/api/threads/${id}`)).workstream.id;
  const { id: other } = json<{ id: string }>(
    await it.post(`/api/workstreams/${workstream}/threads`, { text: "Something else" }),
  );
  await it.app.settled();
  assert.equal(
    json<{ thread: string | null }>(await it.get("/api/window-chat")).thread,
    id,
    "the window still shows its own chat",
  );
  assert.notEqual(other, id);
});

test("a window chat left with New chat can still be deleted, with its empty workstream", async (t) => {
  const it = await testApp(t);
  const { id } = json<{ id: string }>(
    await it.post("/api/window-chat/messages", { text: "What moved?" }),
  );
  await it.app.settled();
  await it.post("/api/window-chat/new", {});
  const reply = await it.post(`/api/threads/${id}/delete`, { via: "menu" });
  assert.equal(reply.status, 200);
  assert.equal(json<{ workstreamRemoved: boolean }>(reply).workstreamRemoved, true);
});

test("New chat stops a turn still running in the old chat, so it proposes nothing", async (t) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const slow: Script = async (bindings) => {
    await held;
    void bindings;
    return { value: null, writes: [["jira.createEpic", [{ summary: "Kiosk wallets" }], "new:1"]] };
  };
  const it = await testApp(t, { plan: () => [{ run: "slow" }], scripts: { slow } });
  const { id } = json<{ id: string }>(
    await it.post("/api/window-chat/messages", { text: "Plan kiosk wallets" }),
  );
  it.advance(1000);
  await it.post("/api/window-chat/new", {});
  release();
  await it.app.settled();
  const view = json<ThreadView>(await it.get(`/api/threads/${id}`));
  assert.deepEqual(view.changeSets, []);
  assert.equal(view.state, "done");
});

test("an answered window chat isn't in Needs you, and its empty workstream isn't one of the overview's", async (t) => {
  const it = await app(t);
  const before = json<OverviewView>(await it.get("/api/overview"));
  const { id } = await it.ask("What moved?");
  const listed = json<ThreadsView>(await it.get("/api/threads")).threads.find(
    (each) => each.id === id,
  );
  assert.deepEqual([listed?.state, listed?.waitingOn], ["working", null]);
  const after = json<OverviewView>(await it.get("/api/overview"));
  assert.equal(after.counts.needsYou, before.counts.needsYou);
  assert.ok(!after.workstreams.some((row) => row.name === "Window chat"));
  // The sidebar still lists it, so the chat is one click away.
  assert.deepEqual(await it.listed(), ["Window chat"]);
});
