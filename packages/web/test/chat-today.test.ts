// The review link's one button: nothing is sent until the person picks an
// answer, and what is sent is that answer, bound to the diff they saw.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Replied } from "../src/http.ts";
import { initReview, type ReviewModel, reviewReplied, updateReview } from "../src/review.ts";
import type { ChangeSetView, ReviewView } from "../src/view.ts";
import { changeSetView, diffLine, diffView } from "../testing.ts";

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

test("the one button sends what the answer says, and the note only with Reject", () => {
  let model = opened(changeSetView({ id: "01JBZ0000000000000000000C1" }));
  [model] = updateReview(model, { type: "nameChanged", name: "Dana" });
  const [unpicked, none] = updateReview(model, { type: "submitClicked" });
  assert.ok(unpicked.problem);
  assert.deepEqual(none, []);
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
