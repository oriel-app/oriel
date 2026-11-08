// OA-107, fixed in c27653bc (#91): a message sent while scrolled up didn't
// take the user to the latest entry, so they didn't see it or the reply.
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
