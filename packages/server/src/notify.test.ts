// Desktop notifications (OA-184): a thread that newly waits on the person,
// in Oriel's words with the thread's title as the body, opening the thread;
// nothing for what already waited, for an answer in the window chat, or
// while Settings has them off.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { ThreadSummaryView, WaitingOn } from "@oriel/web/view";
import { type Notice, newlyWaiting } from "./notify.ts";
import { memorySettings } from "./settings.ts";
import { json, type Script, testApp } from "./testing.ts";

const summary = (
  id: string,
  waitingOn: WaitingOn | null,
  title: string | null = "Plan",
): ThreadSummaryView => ({ id, title, waitingOn }) as ThreadSummaryView;

test("only what newly waits on the person is told, once, and a new way of waiting again", () => {
  const first = newlyWaiting(new Map(), [
    summary("a", "reply", "Fix <b>login</b>"),
    summary("b", "agent"),
    summary("c", "apply"),
    summary("d", null),
  ]);
  assert.deepEqual(first.notices, [
    { title: "Oriel answered, and it's your turn", body: "Fix <b>login</b>", open: "/threads/a" },
  ]);
  assert.deepEqual([...first.now], [["a", "reply"]]);
  // A thread just made, with no message yet, waits on nothing.
  assert.deepEqual(newlyWaiting(first.now, [summary("a", "reply"), summary("b", "reply", null)]), {
    now: first.now,
    notices: [],
  });
  const again = newlyWaiting(first.now, [summary("a", "reply"), summary("b", "review")]);
  assert.deepEqual(again.notices, [
    { title: "A change set waits for your review", body: "Plan", open: "/threads/b" },
  ]);
  const moved = newlyWaiting(again.now, [summary("a", "held"), summary("b", "stalled")]);
  assert.deepEqual(
    moved.notices.map((n) => n.title),
    ["A message waits for you", "A change set stopped while it was being applied"],
  );
});

const rename: Script = async () => ({
  value: null,
  writes: [["jira.setSummary", ["jira:SYN-23", "Practice: notify me"]]],
});
const epic: Script = async () => ({
  value: null,
  writes: [["jira.createEpic", [{ summary: "Kiosk wallets" }], "new:1"]],
});

async function notifying(t: TestContext) {
  const told: Notice[] = [];
  const settings = memorySettings();
  const app = await testApp(t, {
    plan: (input) =>
      input.text.startsWith("Rename")
        ? [{ run: "rename" }, { text: "Proposed." }]
        : input.text.startsWith("Plan")
          ? [{ run: "epic" }]
          : [{ text: "Hi." }],
    scripts: { rename, epic },
    settings,
    notify: async (notice) => void told.push(notice),
  });
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", { kind: "cluster", grouping: "epic", cluster: "10001" }),
  );
  const start = async (text: string) => {
    const { id } = json<{ id: string }>(
      await app.post(`/api/workstreams/${workstreamId}/threads`, { text }),
    );
    await app.app.settled();
    return id;
  };
  return { app, told, settings, start };
}

test("an answer and a change set each tell the person, and open their thread", async (t) => {
  const { app, told, start } = await notifying(t);
  const answered = await start("Hello there");
  assert.deepEqual(told, [
    {
      title: "Oriel answered, and it's your turn",
      body: "Hello there",
      open: `/threads/${answered}`,
    },
  ]);
  const proposed = await start("Rename SYN-23");
  assert.equal(told.length, 2);
  assert.deepEqual(told[1], {
    title: "A change set waits for your review",
    body: "Rename SYN-23",
    open: `/threads/${proposed}`,
  });
  // Seen again with nothing new, nothing more.
  await app.post(`/api/workstreams`, { kind: "cluster", grouping: "epic", cluster: "10002" });
  await app.app.settled();
  assert.equal(told.length, 2);
  // An answer in the window chat never waits on the person; a change set
  // proposed there does, as in Needs you.
  await app.post("/api/window-chat/messages", { text: "What moved?" });
  await app.app.settled();
  assert.equal(told.length, 2);
  await app.post("/api/window-chat/messages", { text: "Plan kiosk wallets" });
  await app.app.settled();
  assert.equal(told.length, 3);
  assert.equal(told[2]?.title, "A change set waits for your review");
  // Settings says whether, on this server, it can.
  assert.equal(json<{ notifies: boolean }>(await app.get("/api/settings")).notifies, true);
});

test("off in Settings, nothing is told, and turning it on doesn't tell what already waits", async (t) => {
  const { app, told, start } = await notifying(t);
  assert.equal((await app.post("/api/settings", { notify: false })).status, 200);
  await start("Hello there");
  assert.deepEqual(told, []);
  await app.post("/api/settings", { notify: true });
  await app.app.settled();
  assert.deepEqual(told, []);
  await start("Rename SYN-23");
  assert.equal(told.length, 1);
});

test("under pnpm dev there are no notifications to turn on", async (t) => {
  const app = await testApp(t);
  const view = json<{ notify: boolean; notifies: boolean }>(await app.get("/api/settings"));
  assert.deepEqual([view.notify, view.notifies], [true, false]);
});
