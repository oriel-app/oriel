// What a person can do with a change set, from the engine's own state: each
// step offered is one the engine takes, and each it would refuse is left out.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapturedMutation, NextStep, Ulid } from "@oriel/core";
import { groupStore } from "@oriel/db";
import { plainError, sendLeaseMs } from "./change-sets.ts";
import { approve, nth, setup } from "./testing.ts";

const estimate = (target: string, points: number): CapturedMutation => ({
  op: "setEstimate",
  target: target as CapturedMutation["target"],
  ref: null,
  args: { points },
});

const story = (summary: string): CapturedMutation => ({
  op: "createStory",
  target: null,
  ref: "new:1",
  args: { summary, epic: "jira:SYN-1" },
});

const kinds = (steps: NextStep[]) => steps.map((step) => step.kind);
const removable = (steps: NextStep[]) =>
  steps.flatMap((step) => (step.kind === "remove" ? step.mutationIds : []));

// Jira refuses the write of the call-th request.
function refuseCall(jira: ReturnType<typeof setup>["jira"], call: number) {
  jira.hooks.before = (_request, n) => {
    if (n === call) throw new Error("400: SYN-3 can't be changed right now");
  };
}

test("an open change set can be approved, rejected or trimmed; an approved one applied", async () => {
  const { changeSets, run } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-3", 3),
  ]);
  assert.deepEqual(await changeSets.nextSteps(set.id), [
    { kind: "approve" },
    { kind: "reject" },
    { kind: "remove", mutationIds: set.mutations.map((m) => m.id) },
  ]);
  await approve(changeSets, set.id);
  assert.deepEqual(kinds(await changeSets.nextSteps(set.id)), ["retry", "reject"]);
});

test("an applied change set is complete and can be reverted, once at a time", async () => {
  const { changeSets, run, events } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  await approve(changeSets, set.id);
  await changeSets.apply(set.id);
  assert.ok((await changeSets.get(set.id))?.completedAt);
  assert.equal(events.filter((e) => e.name === "changeset.applied").length, 1);
  assert.deepEqual(await changeSets.nextSteps(set.id), [{ kind: "revert" }]);
  const reverse = await changeSets.revert(set.id);
  assert.ok(!("conflicts" in reverse));
  // While its revert is live, there is nothing more to do with it.
  assert.deepEqual(await changeSets.nextSteps(set.id), []);
  assert.deepEqual(kinds(await changeSets.nextSteps(reverse.id)), ["approve", "reject"]);
  const shown = await changeSets.diff(reverse.id);
  await changeSets.decide(reverse.id, "rejected", { via: "thread", by: "pm" }, shown.hash);
  assert.deepEqual(await changeSets.nextSteps(set.id), [{ kind: "revert" }]);
});

test("a write the source refused stops apply partway: retry, leave it out, or dismiss", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-3", 3),
  ]);
  await approve(changeSets, set.id);
  refuseCall(jira, 2);
  await changeSets.apply(set.id);
  const refused = nth(set.mutations, 1).id;
  assert.deepEqual(await changeSets.nextSteps(set.id), [
    { kind: "retry" },
    { kind: "remove", mutationIds: [refused] },
    { kind: "dismiss", warnings: ["This may already be in Jira: check SYN-3"] },
  ]);
});

test("leaving out the last unapplied change completes the set", async () => {
  const { changeSets, run, jira, events } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-3", 3),
  ]);
  await approve(changeSets, set.id);
  refuseCall(jira, 2);
  await changeSets.apply(set.id);
  assert.equal((await changeSets.get(set.id))?.completedAt, null);
  assert.equal(events.filter((e) => e.name === "changeset.applied").length, 0);
  const edited = await changeSets.edit(set.id, { remove: [nth(set.mutations, 1).id] });
  assert.ok(edited.completedAt);
  assert.equal(events.filter((e) => e.name === "changeset.applied").length, 1);
  assert.deepEqual(await changeSets.nextSteps(set.id), [{ kind: "revert" }]);
});

test("after a stopped change is left out, the rest is approved again; nothing else is removable", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-3", 3),
    estimate("jira:SYN-8", 1),
  ]);
  await approve(changeSets, set.id);
  refuseCall(jira, 2);
  await changeSets.apply(set.id);
  const [, refused, pending] = set.mutations.map((m) => m.id);
  assert.deepEqual(removable(await changeSets.nextSteps(set.id)), [refused, pending]);
  await changeSets.edit(set.id, { remove: [refused as Ulid] });
  const steps = await changeSets.nextSteps(set.id);
  assert.deepEqual(kinds(steps), ["approve-rest", "remove", "dismiss", "revert"]);
  assert.deepEqual(removable(steps), [pending]);
});

test("a line that can't be removed isn't offered once an edit leaves it alone", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-3", 3),
    estimate("jira:SYN-21", 5),
  ]);
  await approve(changeSets, set.id);
  refuseCall(jira, 1);
  await changeSets.apply(set.id);
  const [refused, other] = set.mutations.map((m) => m.id);
  assert.deepEqual(removable(await changeSets.nextSteps(set.id)), [refused, other]);
  await changeSets.edit(set.id, { remove: [refused as Ulid] });
  // A diff shown before the edit offered both; the engine now refuses the other.
  const steps = await changeSets.nextSteps(set.id);
  assert.deepEqual(kinds(steps), ["approve", "reject"]);
  await assert.rejects(changeSets.edit(set.id, { remove: [other as Ulid] }), { code: "invalid" });
});

test("a one-line create sent with no answer can only be dismissed, with a warning", async () => {
  const { changeSets, instance, run, jira } = setup();
  const set = await changeSets.capture(run, [story("Pay with a gift card")]);
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
  const steps = await later.nextSteps(set.id);
  assert.deepEqual(steps, [
    {
      kind: "dismiss",
      warnings: ["This may already be in Jira: check for “Pay with a gift card”"],
    },
  ]);
  // Trying again is refused by the engine, so it isn't offered.
  const report = await later.apply(set.id);
  assert.equal(report.applied.length, 0);
  assert.match(nth(report.failed, 0).error, /dismiss/);
  const dismissed = await later.dismiss(set.id);
  assert.equal(dismissed.changeSet.decision?.kind, "rejected");
  assert.deepEqual(dismissed.warnings, [
    "This may already be in Jira: check for “Pay with a gift card”",
  ]);
  assert.deepEqual(await later.nextSteps(set.id), []);
  await assert.rejects(later.apply(set.id), { code: "not-approved" });
});

test("a send still within its lease isn't retried until the lease runs out", async () => {
  const { changeSets, instance, run, jira, advance } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-3", 3),
  ]);
  await approve(changeSets, set.id);
  const reached = Promise.withResolvers<void>();
  jira.hooks.before = () => {
    reached.resolve();
    return new Promise<void>(() => {});
  };
  void changeSets.apply(set.id);
  await reached.promise;
  jira.hooks.before = undefined;
  const later = instance();
  assert.deepEqual(kinds(await later.nextSteps(set.id)), ["remove", "dismiss"]);
  const stored = (await later.get(set.id))?.mutations[0]?.error ?? "";
  assert.match(stored, /\(sent \S+, [0-9A-Z]{26}\)$/);
  assert.equal(
    plainError(stored),
    "Sent to Jira, with no answer recorded yet. Try again: Oriel checks whether it landed before sending it again.",
  );
  advance(sendLeaseMs);
  assert.deepEqual(kinds(await later.nextSteps(set.id)), ["retry", "remove", "dismiss"]);
  assert.equal((await later.apply(set.id)).applied.length, 2);
});

test("a revert drops what never landed, which completes the set", async () => {
  const { db, changeSets, run, groupId, events, indexed } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-3", 3),
  ]);
  await approve(changeSets, set.id);
  // SYN-3 leaves the group before apply, so apply stops at it.
  groupStore(db).remove(
    groupId,
    [{ id: "jira:SYN-3", stableId: indexed("SYN-3").stableId }],
    { kind: "user" },
    "2026-10-29T09:00:01.000Z" as never,
  );
  await changeSets.apply(set.id);
  const steps = await changeSets.nextSteps(set.id);
  // Nothing was sent, so nothing may have landed: no warnings, and revert.
  assert.deepEqual(steps, [
    { kind: "remove", mutationIds: [nth(set.mutations, 1).id] },
    { kind: "dismiss", warnings: [] },
    { kind: "revert" },
  ]);
  const reverse = await changeSets.revert(set.id);
  assert.ok(!("conflicts" in reverse));
  const original = await changeSets.get(set.id);
  assert.equal(original?.mutations.length, 1);
  assert.ok(original?.completedAt);
  assert.equal(events.filter((e) => e.name === "changeset.applied").length, 1);
});

test("a reason a change stopped reads as plain words, from the forms apply stores", () => {
  assert.equal(
    plainError("PUT /rest/api/3/issue/SYN-99: 400 SYN-99 can't be changed right now."),
    "The source refused this change: SYN-99 can't be changed right now.",
  );
  assert.equal(
    plainError("DELETE /rest/api/3/issue/SYN-9: 500."),
    "The source refused this change (it answered 500).",
  );
  assert.equal(
    plainError(
      "Sent to Jira, with no answer recorded yet. Try again: Oriel checks whether it landed before sending it again. (sent 2026-10-29T09:00:00.000Z, 01M63E6DM079K0EBQXZS52NYS7)",
    ),
    "Sent to Jira, with no answer recorded yet. Try again: Oriel checks whether it landed before sending it again.",
  );
  const own = "SYN-99 was removed from the group after this was captured, so it wasn't sent.";
  assert.equal(plainError(own), own);
});
