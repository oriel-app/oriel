// A rejection the person made in the thread can be undone (OA-258): the
// change set is undecided again, as it was, and its next decision is a new
// one. A review link's holder's rejection, or a dismissal of what started
// landing, can't be.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapturedMutation } from "@oriel/core";
import { approve, count, setup } from "./testing.ts";

const estimate = (target: `jira:${string}`, points: number): CapturedMutation => ({
  op: "setEstimate",
  target,
  ref: null,
  args: { points },
});

const kinds = (steps: readonly { kind: string }[]) => steps.map((step) => step.kind);

test("a rejection in the thread undone leaves the change set undecided, as it was", async () => {
  const { changeSets, run, db, events } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const { hash } = await changeSets.diff(set.id);
  const url = await changeSets.reviewLink(set.id);
  await changeSets.decide(set.id, "rejected", { via: "thread", by: "user" }, hash);
  const undone = await changeSets.undoRejection(set.id);
  assert.equal(undone.decision, null);
  assert.equal(undone.hash, set.hash);
  assert.deepEqual(kinds(await changeSets.nextSteps(set.id)), ["approve", "reject"]);
  assert.ok(events.some((e) => e.name === "changeset.unrejected" && e.changeSetId === set.id));
  // Every decision is kept; the link that died with it stays dead.
  assert.equal(count(db, "decisions"), 1);
  assert.equal(await changeSets.openReview(url.pathname.split("/").at(-1) ?? ""), null);
  // Twice is refused: it isn't rejected any more.
  await assert.rejects(changeSets.undoRejection(set.id), {
    code: "refused",
  });
  // Its next decision stands, as a new one.
  const approved = await approve(changeSets, set.id);
  assert.equal(approved.decision?.kind, "approved");
  assert.equal(count(db, "decisions"), 2);
  await assert.rejects(changeSets.undoRejection(set.id), { code: "refused" });
});

test("a rejection through a review link can't be undone", async () => {
  const { changeSets, run } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const { hash } = await changeSets.diff(set.id);
  const url = await changeSets.reviewLink(set.id);
  const token = url.pathname.split("/").at(-1) ?? "";
  await changeSets.decide(set.id, "rejected", { via: "review-link", token, by: "Ana" }, hash);
  await assert.rejects(changeSets.undoRejection(set.id), {
    code: "refused",
  });
  assert.equal((await changeSets.get(set.id))?.decision?.kind, "rejected");
});

test("a change set dismissed after part of it was sent can't be put back", async () => {
  const { changeSets, instance, run, jira } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  await approve(changeSets, set.id);
  const reached = Promise.withResolvers<void>();
  jira.hooks.after = () => {
    reached.resolve();
    return new Promise<void>(() => {});
  };
  void changeSets.apply(set.id);
  await reached.promise;
  jira.hooks.after = undefined;
  // As after a restart: the send is on record, its answer isn't.
  const later = instance();
  await later.dismiss(set.id);
  await assert.rejects(later.undoRejection(set.id), { code: "refused" });
  assert.equal((await later.get(set.id))?.decision?.kind, "rejected");
});
