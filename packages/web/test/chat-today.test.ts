// Quiet chat, loud decisions: the one ChatInput's Send, a change set's head
// counted from its diff, a diff line naming its item once, the actions that
// stick above the composer while their card shows, and the review link's
// form in its order.
import assert from "node:assert/strict";
import { test } from "node:test";
import { namedOnce, type Observe, watchStuck, writes } from "../src/change-set.ts";
import type { Replied } from "../src/http.ts";
import { sendable } from "../src/settings.ts";
import {
  answerOf,
  initReview,
  type ReviewModel,
  reviewParts,
  reviewReplied,
  updateReview,
} from "../src/review.ts";
import type { ChangeSetView, ReviewView } from "../src/view.ts";
import { changeSetView, diffLine, diffView } from "../testing.ts";

test("Send is live only with something written and nothing on its way", () => {
  assert.equal(sendable("", false), false);
  assert.equal(sendable("  \n ", false), false);
  assert.equal(sendable("Which stories need estimates?", false), true);
  assert.equal(sendable("Which stories need estimates?", true), false);
});

test("a change set's head says what Approve writes, counted from its diff", () => {
  const edit = (n: number) => diffLine({ mutationId: `e${n}` });
  const story = (n: number) => diffLine({ mutationId: `s${n}`, kind: "create", makes: "story" });
  assert.equal(
    writes(diffView({ lines: [edit(1), edit(2), edit(3), story(1), story(2)] })),
    "5 changes in Jira · 3 edits, 2 new stories",
  );
  // One kind of change says it once.
  assert.equal(writes(diffView({ lines: [story(1)] })), "1 new story in Jira");
  assert.equal(writes(diffView({ lines: [edit(1), edit(2)] })), "2 edits in Jira");
  // The source is the set's own, whichever it is, and every one it writes to.
  const tracker = diffLine({ mutationId: "t", source: "the tracker", kind: "delete" });
  assert.equal(writes(diffView({ lines: [tracker] })), "1 deletion in the tracker");
  const post = diffLine({ mutationId: "p", source: "Slack", kind: "create", makes: "message" });
  assert.equal(
    writes(diffView({ lines: [edit(1), post] })),
    "2 changes in Jira and Slack · 1 edit, 1 new message",
  );
  assert.equal(writes(diffView({ lines: [] })), null);
});

test("a diff line names its item once: its chip stands where the sentence named it", () => {
  const target = { id: "jira:SYN-1", key: "SYN-1", title: "Checkout v2", url: "https://syn/SYN-1" };
  const line = (sentence: string) => ({ sentence, target });
  assert.deepEqual(namedOnce(line("Rename “Checkout v2” (SYN-1) to “Checkout v3”.")), [
    "Rename ",
    " to “Checkout v3”.",
  ]);
  assert.deepEqual(namedOnce(line("Estimate SYN-1 at 3 points.")), ["Estimate ", " at 3 points."]);
  // A key inside another key isn't it; nor does a sentence without it name it.
  assert.equal(namedOnce(line("Estimate SYN-12 at 3 points.")), null);
  assert.equal(namedOnce({ sentence: "Create a story.", target: null }), null);
  // A source that names items by title alone: the quoted title, whole or cut.
  const message = {
    id: "slack:C1-17",
    key: "C1-17",
    title: "Phone wallets are live",
    url: "https://s/1",
  };
  assert.deepEqual(
    namedOnce({
      sentence: "Reply in “Phone wallets are live” in #launch as Ana.",
      target: message,
    }),
    ["Reply in ", " in #launch as Ana."],
  );
  assert.deepEqual(
    namedOnce({ sentence: "Delete the message “Phone wallets…” from #launch.", target: message }),
    ["Delete the message ", " from #launch."],
  );
  assert.equal(namedOnce({ sentence: "Post in #launch as Ana.", target: message }), null);
});

// A stand-in for the window's observers: each target's last callback, to
// call as the page would scroll.
function observers() {
  const seen = new Map<
    string,
    { margin: number; call: (above: boolean, below: boolean) => void }
  >();
  const observe: Observe<string> = (target, margin, call) => {
    seen.set(target, { margin, call });
    return () => seen.delete(target);
  };
  return { seen, observe };
}

test("a card's actions stick above the composer while the card shows and its foot doesn't", () => {
  const card = "card";
  const foot = "foot";
  const { seen, observe } = observers();
  const said: boolean[] = [];
  const stop = watchStuck({
    card,
    foot,
    hidden: 90,
    bar: 40,
    observe,
    onChange: (on) => said.push(on),
  });
  // The card needs room for the bar above the composer; its foot, the composer's top.
  assert.equal(seen.get(card)?.margin, 130);
  assert.equal(seen.get(foot)?.margin, 90);
  const at = (target: string, above: boolean, below: boolean) =>
    seen.get(target)?.call(above, below);
  // All of it below the composer: nothing sticks.
  at(card, false, true);
  at(foot, false, true);
  assert.deepEqual(said, []);
  // Its head scrolls into view while its foot is still under the composer: on.
  at(card, true, false);
  assert.deepEqual(said, [true]);
  // Its foot comes up past the composer: the bar is in its own place, off.
  at(foot, true, false);
  assert.deepEqual(said, [true, false]);
  // Scrolled past, above the window: its foot is above, not under, so off.
  at(foot, false, false);
  at(card, false, false);
  assert.deepEqual(said, [true, false]);
  stop();
  assert.equal(seen.size, 0);
});

const ok = (tag: Replied["tag"], body: unknown): Replied => ({
  type: "replied",
  tag,
  ok: true,
  body,
});

function opened(changeSet: ChangeSetView): ReviewModel {
  const [opening] = updateReview(initReview("tok")[0], { type: "openClicked" });
  const view: ReviewView = { changeSet, diff: diffView({ hash: "h1", lines: [diffLine()] }) };
  return reviewReplied(opening, ok({ kind: "reviewOpened" }, view))[0];
}

test("the review link asks for the answer first, and only Reject opens the note", () => {
  let model = opened(changeSetView());
  // The change comes before the form; then the answer, the name, and no
  // button until there's an answer for it to send.
  assert.deepEqual(reviewParts(model), ["answer", "name"]);
  [model] = updateReview(model, { type: "answerPicked", answer: "approve" });
  assert.deepEqual(reviewParts(model), ["answer", "name", "submit"]);
  [model] = updateReview(model, { type: "answerPicked", answer: "reject" });
  assert.deepEqual(reviewParts(model), ["answer", "note", "name", "submit"]);
  // An undo's rejection has no note, as before.
  const undo = opened(changeSetView({ revertOf: "01JBZ0000000000000000000C0" }));
  const [picked] = updateReview(undo, { type: "answerPicked", answer: "reject" });
  assert.deepEqual(reviewParts(picked), ["answer", "name", "submit"]);
});

test("the one button sends what the answer says, and the note only with Reject", () => {
  let model = opened(changeSetView({ id: "01JBZ0000000000000000000C1" }));
  [model] = updateReview(model, { type: "nameChanged", name: "Dana" });
  const [unpicked, none] = updateReview(model, { type: "submitClicked" });
  assert.deepEqual([unpicked.problem, none], ["Pick your answer first.", []]);
  [model] = updateReview(model, {
    type: "reasonChanged",
    reason: " Plan only the gift card story. ",
  });
  const decided = (answer: "approve" | "reject") =>
    updateReview(updateReview(model, { type: "answerPicked", answer })[0], {
      type: "submitClicked",
    })[1];
  const body = (answer: "approve" | "reject") => (decided(answer)[0] as { body: unknown }).body;
  assert.deepEqual(body("reject"), {
    token: "tok",
    changeSet: "01JBZ0000000000000000000C1",
    kind: "rejected",
    name: "Dana",
    hash: "h1",
    reason: "Plan only the gift card story.",
  });
  // Typed, then switched to Approve and apply: the note isn't sent.
  assert.deepEqual(body("approve"), {
    token: "tok",
    changeSet: "01JBZ0000000000000000000C1",
    kind: "approved",
    name: "Dana",
    hash: "h1",
  });
});

test("with one step offered, it's the answer, and there's nothing to pick", () => {
  const model = opened(
    changeSetView({ status: "partial", nextSteps: [{ kind: "dismiss", warnings: [] }] }),
  );
  assert.equal(answerOf(model), "dismiss");
  assert.deepEqual(reviewParts(model), ["name", "submit"]);
});
