// The window chat (decisions 0027 and 0030): the overview asks which chat it
// shows and makes none; a question makes or continues one, which then loads
// and opens beside the overview; New chat leaves it; the questions to start
// from are computed from the overview, and counted when used.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect } from "../src/http.ts";
import { init, type Model, type Msg, update } from "../src/root.ts";
import { waitingOn } from "../src/view.ts";
import { questionsFrom } from "../src/window-chat.ts";
import { overviewView } from "../testing.ts";

function run(model: Model, ...msgs: Msg[]): [Model, Effect[]] {
  let effects: Effect[] = [];
  for (const msg of msgs) [model, effects] = update(model, msg);
  return [model, effects];
}

const posts = (effects: Effect[]) =>
  effects.flatMap((effect) =>
    effect.type === "http" && effect.method === "POST" ? [[effect.url, effect.body]] : [],
  );
const gets = (effects: Effect[]) =>
  effects.flatMap((effect) =>
    effect.type === "http" && effect.method === "GET" ? [effect.url] : [],
  );

const thread = "01JBZ0000000000000000000T1";
const replied = (kind: "windowChat" | "windowChatAsked" | "windowChatNew", body: unknown): Msg => ({
  type: "replied",
  tag: { kind },
  ok: true,
  body,
});

test("the overview asks which window chat it shows, and with none, shows none", () => {
  const [model, effects] = init({ page: "overview" });
  assert.ok(gets(effects).includes("/api/window-chat"));
  assert.ok(!posts(effects).some(([url]) => String(url).startsWith("/api/window-chat")));
  const [none] = run(model, replied("windowChat", { thread: null }));
  assert.equal(none.thread, null);
  assert.equal(none.chat.open, false);
});

test("a question from the bar makes the chat, opens it beside the overview and loads its thread", () => {
  const [start] = init({ page: "overview" });
  const [asking, effects] = run(
    start,
    { type: "chat", msg: { type: "draftChanged", text: "What moved?" } },
    { type: "chat", msg: { type: "askClicked" } },
  );
  assert.deepEqual(posts(effects), [["/api/window-chat/messages", { text: "What moved?" }]]);
  assert.deepEqual([asking.chat.asking, asking.chat.open], [true, true]);
  const [made, loading] = run(asking, replied("windowChatAsked", { id: thread, seq: 1 }));
  assert.equal(made.thread?.id, thread);
  assert.equal(made.chat.draft, "");
  assert.ok(gets(loading).includes(`/api/threads/${thread}`));
  // Its workstream shows in the sidebar.
  assert.ok(gets(loading).includes("/api/workstreams"));
});

test("New chat leaves the thread's stream and asks the server to start afresh", () => {
  const [shown] = run(init({ page: "overview" })[0], replied("windowChat", { thread }));
  assert.equal(shown.thread?.id, thread);
  const [left, effects] = run(shown, { type: "chat", msg: { type: "newChatClicked" } });
  assert.equal(left.thread, null);
  assert.ok(effects.some((effect) => effect.type === "unsubscribe"));
  assert.deepEqual(posts(effects), [["/api/window-chat/new", {}]]);
});

test("the questions to start from come from the overview's superlatives, never send a row's name, and are counted", () => {
  const view = overviewView({
    changed: { workstreams: [{ id: "w1", name: "Checkout", moved: 3 }], elsewhere: 0 },
    headlines: [
      {
        id: "quiet",
        label: "Quiet longest",
        rule: "r",
        subject: { kind: "workstream", id: "w2", name: "Status page pilot" },
        detail: "nothing moved in 27 days",
      },
    ],
  });
  const questions = questionsFrom(view);
  assert.deepEqual(
    questions.map((q) => q.label),
    ["Chart what moved since I looked, by workstream", "Why is Status page pilot stalled?"],
  );
  // A row's name is only on its button: what is sent is fixed wording.
  assert.deepEqual(
    questions.map((q) => q.text),
    [
      "Chart what moved since I looked, by workstream",
      "Why has the workstream that's been quiet longest stalled?",
    ],
  );
  const [start] = init({ page: "overview" });
  const [first] = questions;
  assert.ok(first);
  const [, effects] = run(start, {
    type: "chat",
    msg: { type: "questionPicked", question: first },
  });
  assert.deepEqual(posts(effects), [
    ["/api/window-chat/messages", { text: "Chart what moved since I looked, by workstream" }],
    ["/api/telemetry", { name: "window-chat.question-used", question: "chart-moved" }],
  ]);
});

test("a window chat waits on the user only for a held message or a change set, never for its turn", () => {
  const answered = { state: "working" as const, running: false, changeSets: [] };
  assert.equal(waitingOn(answered), "reply");
  assert.equal(waitingOn({ ...answered, windowChat: true }), null);
  assert.equal(waitingOn({ ...answered, windowChat: true, held: true }), "held");
});
