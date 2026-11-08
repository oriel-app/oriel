import assert from "node:assert/strict";
import { test } from "node:test";
import { nav } from "../src/nav.ts";
import { init, type Model, update } from "../src/root.ts";
import { waitingOn } from "../src/view.ts";
import { threadSummary } from "../testing.ts";

const workstreamA = "01JBZ0000000000000000000G1";

// OA-82, fixed in bfcb68c8 (#117): an apply stalled on its source counted as
// still applying, so its thread dropped out of Needs you.
test("a thread whose apply stalled is in Needs you", () => {
  const applying = { status: "applying" as const, nextSteps: [] };
  const state = (stalled: boolean) =>
    waitingOn({
      state: "working",
      running: false,
      changeSets: [applying, { ...applying, stalled }],
    });
  const stuck = threadSummary({ id: "01JBZ0000000000000000000T7", waitingOn: state(true) });
  const moving = threadSummary({ id: "01JBZ0000000000000000000T8", waitingOn: state(false) });
  const [start] = init({ page: "done" });
  assert.deepEqual(
    nav({ ...start, threads: [stuck, moving] }).waiting.map((each) => each.id),
    [stuck.id],
  );
});

function typedDraft(text: string): Model {
  const [draft] = update(init({ page: "done" })[0], {
    type: "routed",
    route: { page: "new-thread" },
  });
  return update(draft, { type: "newThread", msg: { type: "draftChanged", text } })[0];
}

test("a first message that fails says why and keeps the draft", () => {
  const [sending] = update(typedDraft("Plan kiosk wallets"), {
    type: "newThread",
    msg: { type: "sendClicked", workstream: null },
  });
  const [failed, none] = update(sending, {
    type: "replied",
    tag: { kind: "threadStarted", draft: 1 },
    ok: false,
    body: { error: "down" },
  });
  assert.deepEqual(none, []);
  assert.equal(failed.newThread?.draft, "Plan kiosk wallets");
  assert.equal(failed.newThread?.sending, false);
  assert.ok(failed.newThread?.notice);
  // It can be sent again.
  assert.equal(
    update(failed, { type: "newThread", msg: { type: "sendClicked", workstream: null } })[1].length,
    1,
  );
});

test("a first message answered after New thread again leaves the newer draft as it is", () => {
  const [sending] = update(typedDraft("Plan kiosk wallets"), {
    type: "newThread",
    msg: { type: "sendClicked", workstream: null },
  });
  const [again] = update(sending, { type: "routed", route: { page: "new-thread" } });
  const [newer] = update(again, {
    type: "newThread",
    msg: { type: "draftChanged", text: "Plan gift cards" },
  });
  const [kept] = update(newer, {
    type: "replied",
    tag: { kind: "threadStarted", draft: 1 },
    ok: true,
    body: { id: "01JBZ0000000000000000000T9", workstreamId: workstreamA },
  });
  assert.deepEqual(kept.newThread, newer.newThread);
  assert.equal(kept.newThread?.draft, "Plan gift cards");
});
