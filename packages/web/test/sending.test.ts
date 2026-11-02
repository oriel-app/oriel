// Sending a message takes the user to the latest entry (OA-107), and keeps
// them there for the reply; what anyone else adds never pulls a user who
// scrolled up.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect } from "../src/http.ts";
import { init, type Model, type Msg, update } from "../src/root.ts";
import type { ChatEntry } from "../src/view.ts";
import { threadView } from "../testing.ts";

const id = "01JBZ0000000000000000000T1";
const at = "2026-01-01T00:00:00.000Z";

function run(model: Model, ...msgs: Msg[]): [Model, Effect[]] {
  let effects: Effect[] = [];
  for (const msg of msgs) [model, effects] = update(model, msg);
  return [model, effects];
}

// The page, once it renders what the update asked for, goes to the latest entry.
const rendered: Msg = { type: "thread", msg: { type: "rendered" } };
const shows = ([model, effects]: [Model, Effect[]]) =>
  effects.some((e) => e.type === "rendered") &&
  update(model, rendered)[1].some((e) => e.type === "showLatest");

const held: ChatEntry = {
  seq: 2,
  at,
  kind: "held",
  from: { kind: "review-link", by: "Dana", changeSetId: "01JBZ0000000000000000000C1" },
  text: "Too big for one sprint.",
  outcome: null,
};
const loaded: Msg = {
  type: "replied",
  tag: { kind: "thread", id },
  ok: true,
  body: threadView({
    id,
    entries: [{ seq: 1, at, kind: "user", text: "Estimate these" }, held],
    lastSeq: 2,
    running: false,
  }),
};
const up: Msg = { type: "thread", msg: { type: "scrolled", below: 600, up: true } };
const entry = (entry: ChatEntry): Msg => ({ type: "streamed", event: { type: "entry", entry } });
const reply = (seq: number) => entry({ seq, at, kind: "text", text: "Here's what I found" });

function scrolledUp(): Model {
  const [away] = run(init({ page: "thread", id })[0], loaded, up);
  assert.equal(away.thread?.atLatest, false);
  return away;
}

test("sending while scrolled up lands at the latest entry, and stays there for the reply", () => {
  const typed = run(scrolledUp(), {
    type: "thread",
    msg: { type: "draftChanged", text: "Why?" },
  })[0];
  const sent = run(typed, { type: "thread", msg: { type: "sendClicked" } });
  assert.equal(shows(sent), true);
  // The message arrives, then the reply starts: each keeps the page there.
  const said = run(sent[0], entry({ seq: 3, at, kind: "user", text: "Why?" }));
  assert.equal(shows(said), true);
  assert.equal(shows(run(said[0], reply(4))), true);
});

test("sending a held message to the agent while scrolled up lands at the latest entry", () => {
  const [sent] = run(scrolledUp(), { type: "thread", msg: { type: "heldSendClicked", seq: 2 } });
  assert.equal(sent.thread?.atLatest, true);
  // It reloads once sent, which shows it sent, and the page goes there.
  const answered = run(sent, {
    type: "replied",
    tag: { kind: "held", threadId: id, seq: 2 },
    ok: true,
    body: {},
  });
  const reload = answered[1].find((e) => e.type === "http" && e.tag.kind === "thread");
  assert.ok(reload?.type === "http");
  const body = threadView({ id, entries: [{ ...held, outcome: "sent" }], lastSeq: 2 });
  assert.equal(shows(run(answered[0], { type: "replied", tag: reload.tag, ok: true, body })), true);
});

test("a reply arriving while scrolled up still doesn't move the page", () => {
  const after = run(scrolledUp(), reply(3));
  assert.equal(after[0].thread?.view?.entries.length, 3);
  assert.equal(shows(after), false);
  // Nor once the user, having sent, scrolled up again to read.
  const typed = run(scrolledUp(), {
    type: "thread",
    msg: { type: "draftChanged", text: "Why?" },
  })[0];
  const [sent] = run(typed, { type: "thread", msg: { type: "sendClicked" } }, up);
  assert.equal(shows(run(sent, reply(3))), false);
});

test("a message that isn't sent leaves the page where it is", () => {
  // Nothing typed: nothing is sent.
  const [still] = run(scrolledUp(), { type: "thread", msg: { type: "sendClicked" } });
  assert.equal(still.thread?.atLatest, false);
});
