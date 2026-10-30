// What a person can do with a change set, from the engine's own state: each
// step offered is one the engine takes, and each it would refuse is left out.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type CapturedMutation, type NextStep, SourceRefused, type Ulid } from "@oriel/core";
import { groupStore } from "@oriel/db";
import { plainError, sendLeaseMs } from "./change-sets.ts";
import { approve, nth, preview, setup, status } from "./testing.ts";

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

// Jira refuses the write of the call-th request, and changes nothing.
function refuseCall(jira: ReturnType<typeof setup>["jira"], call: number) {
  jira.hooks.before = (_request, n) => {
    if (n === call)
      throw new SourceRefused("PUT /rest/api/3/issue/SYN-3: 400 SYN-3 can't be changed right now", {
        sent: true,
      });
  };
}

// The call-th request goes out and its answer never comes back.
function loseCall(jira: ReturnType<typeof setup>["jira"], call: number) {
  jira.hooks.before = (_request, n) => {
    if (n === call) throw new TypeError("fetch failed");
  };
}

test("an open change set can be approved once a diff has shown it, rejected or trimmed", async () => {
  const { changeSets, run } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-3", 3),
  ]);
  const ids = set.mutations.map((m) => m.id);
  // Approval is of a diff the person saw, so it waits for one.
  assert.deepEqual(await changeSets.nextSteps(set.id), [
    { kind: "reject" },
    { kind: "remove", mutationIds: ids },
  ]);
  await assert.rejects(
    changeSets.decide(set.id, "approved", { via: "thread", by: "pm" }, set.hash),
    { code: "refused", message: /hasn.t been shown in a diff/ },
  );
  await changeSets.diff(set.id);
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
  assert.deepEqual(kinds(await changeSets.nextSteps(reverse.id)), ["reject"]);
  const shown = await changeSets.diff(reverse.id);
  assert.deepEqual(kinds(await changeSets.nextSteps(reverse.id)), ["approve", "reject"]);
  await changeSets.decide(reverse.id, "rejected", { via: "thread", by: "pm" }, shown.hash);
  assert.deepEqual(await changeSets.nextSteps(set.id), [{ kind: "revert" }]);
});

test("a write the source refused stops apply partway: retry, leave it out, dismiss or revert", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-3", 3),
  ]);
  await approve(changeSets, set.id);
  refuseCall(jira, 2);
  await changeSets.apply(set.id);
  const refused = nth(set.mutations, 1).id;
  const row = (await changeSets.get(set.id))?.mutations[1];
  // The source answered and changed nothing, so the row is unsent.
  assert.equal(row?.status, "pending");
  assert.equal(
    plainError(row?.error ?? ""),
    "The source refused this change: SYN-3 can't be changed right now.",
  );
  assert.deepEqual(await changeSets.nextSteps(set.id), [
    { kind: "retry" },
    { kind: "remove", mutationIds: [refused] },
    { kind: "dismiss", warnings: [] },
    { kind: "revert" },
  ]);
});

test("a write sent with no answer may have landed: dismissing names where to check", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-3", 3),
  ]);
  await approve(changeSets, set.id);
  loseCall(jira, 2);
  await changeSets.apply(set.id);
  const lost = nth(set.mutations, 1).id;
  const row = (await changeSets.get(set.id))?.mutations[1];
  assert.equal(row?.status, "failed");
  assert.equal(plainError(row?.error ?? ""), "Oriel sent this and didn't hear back.");
  // Not revertible while it may be in Jira; a retry checks before sending.
  assert.deepEqual(await changeSets.nextSteps(set.id), [
    { kind: "retry" },
    { kind: "remove", mutationIds: [lost] },
    { kind: "dismiss", warnings: ["This may already be in Jira: check SYN-3"] },
  ]);
});

test("a refusal of a change sent before keeps it unsent only once it is checked in place", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-3", 3)]);
  await approve(changeSets, set.id);
  loseCall(jira, 1);
  await changeSets.apply(set.id);
  // The lost send never reached Jira (the hook threw first), so a retry finds
  // it not in place and sends again; this time Jira refuses.
  refuseCall(jira, 2);
  await changeSets.apply(set.id);
  assert.equal((await changeSets.get(set.id))?.mutations[0]?.status, "pending");
  assert.deepEqual(kinds(await changeSets.nextSteps(set.id)), ["retry", "reject"]);
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
  await changeSets.diff(set.id);
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
  await changeSets.diff(set.id);
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
  await assert.rejects(later.apply(set.id), { code: "refused", message: /dismiss/ });
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
    plainError("PUT /rest/api/3/issue/SYN-9: 409."),
    "The source refused this change (it answered 409).",
  );
  // A source that broke while writing may have written: not a refusal.
  assert.equal(
    plainError("DELETE /rest/api/3/issue/SYN-9: 500."),
    "The source ran into a problem with this change (it answered 500).",
  );
  assert.equal(plainError("fetch failed."), "Oriel sent this and didn't hear back.");
  assert.equal(
    plainError(
      "fetch failed. This may already be in Jira: check, then dismiss what is left of this change set.",
    ),
    "Oriel sent this and didn't hear back. This may already be in Jira: check, then dismiss what is left of this change set.",
  );
  assert.equal(
    plainError(
      "Sent to Jira, with no answer recorded yet. Try again: Oriel checks whether it landed before sending it again. (sent 2026-10-29T09:00:00.000Z, 01M63E6DM079K0EBQXZS52NYS7)",
    ),
    "Sent to Jira, with no answer recorded yet. Try again: Oriel checks whether it landed before sending it again.",
  );
  // A write never sent says so, and why, without the request line.
  assert.equal(
    plainError("Nothing was sent: GET /rest/api/3/issue/SYN-9: 403 You can't see SYN-9."),
    "Oriel couldn't read the item before sending this, so nothing was sent: You can't see SYN-9.",
  );
  assert.equal(
    plainError("Nothing was sent: GET /rest/api/3/issue/SYN-9: 500."),
    "Oriel couldn't read the item before sending this, so nothing was sent (the source answered 500).",
  );
  assert.equal(
    plainError(
      "Nothing was sent: GET /rest/api/3/issue/SYN-9: unexpected response ($.key: expected a string).",
    ),
    "Oriel couldn't read the item before sending this, so nothing was sent: the source answered in a shape Oriel can't read.",
  );
  assert.equal(
    plainError("Nothing was sent: fetch failed."),
    "Oriel couldn't reach the source before sending this, so nothing was sent.",
  );
  assert.equal(
    plainError("Nothing was sent: SYN's board has no points field to estimate in."),
    "Nothing was sent: SYN's board has no points field to estimate in.",
  );
  const own = "SYN-99 was removed from the group after this was captured, so it wasn't sent.";
  assert.equal(plainError(own), own);
});

test("dismissing a change set whose create may have landed leaves revert for what applied", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    story("Pay with a gift card"),
  ]);
  const [estimated, created] = set.mutations.map((m) => m.id);
  await approve(changeSets, set.id);
  // The story lands; its answer doesn't.
  jira.hooks.after = (_request, n) => {
    if (n === 2) throw new Error("timed out");
  };
  await changeSets.apply(set.id);
  jira.hooks.after = undefined;
  const warning = "This may already be in Jira: check for “Pay with a gift card”";
  // Until the rest is dismissed, a revert would leave the story behind.
  assert.deepEqual(await changeSets.nextSteps(set.id), [
    { kind: "remove", mutationIds: [created] },
    { kind: "dismiss", warnings: [warning] },
  ]);
  await assert.rejects(changeSets.revert(set.id), {
    code: "not-revertible",
    message: /until the rest of it is dismissed/,
  });
  const dismissed = await changeSets.dismiss(set.id);
  assert.deepEqual(dismissed.warnings, [warning]);
  assert.deepEqual(await changeSets.nextSteps(set.id), [{ kind: "revert" }]);
  const reverse = await changeSets.revert(set.id);
  assert.ok(!("conflicts" in reverse));
  // Exactly what applied: the estimate, not the story that may be there.
  assert.deepEqual(
    reverse.mutations.map((m) => m.reverts),
    [estimated],
  );
  // The dismissed set keeps the row its warning names, and stays dismissed.
  const original = await changeSets.get(set.id);
  assert.equal(original?.decision?.kind, "rejected");
  assert.equal(original?.mutations[1]?.status, "failed");
  assert.deepEqual(await changeSets.nextSteps(set.id), []);
  await approve(changeSets, reverse.id);
  assert.deepEqual((await changeSets.apply(reverse.id)).failed, []);
  assert.equal(jira.issue("SYN-21")?.points, 2);
});

test("dismissing is its own event, once, and never a rejection", async () => {
  const { changeSets, run, jira, events } = setup();
  const open = await changeSets.capture(run, [estimate("jira:SYN-8", 1)]);
  // Nothing of it has landed: that is a rejection, not a dismissal.
  await assert.rejects(changeSets.dismiss(open.id), { code: "refused", message: /reject it/ });
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-3", 3),
  ]);
  await approve(changeSets, set.id);
  refuseCall(jira, 2);
  await changeSets.apply(set.id);
  const named = (name: string) => events.filter((e) => e.name === name);
  await changeSets.dismiss(set.id);
  assert.deepEqual(
    named("changeset.dismissed").map((e) => e.name === "changeset.dismissed" && e.changeSetId),
    [set.id],
  );
  assert.deepEqual(
    named("changeset.decided").filter(
      (e) => e.name === "changeset.decided" && e.decision !== "approved",
    ),
    [],
  );
  // Dismissing again changes nothing and says nothing.
  const before = events.length;
  const again = await changeSets.dismiss(set.id);
  assert.equal(again.changeSet.decision?.kind, "rejected");
  assert.equal(events.length, before);
  assert.deepEqual(await changeSets.nextSteps(set.id), [{ kind: "revert" }]);
});

test("a change set with a gone item or stale arguments offers remove and reject, not approve", async () => {
  const { changeSets, run, jira, db } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-3", 3),
    estimate("jira:SYN-8", 1),
  ]);
  const ids = set.mutations.map((m) => m.id);
  const thread = { via: "thread", by: "pm" } as const;
  jira.hide("SYN-3");
  const gone = await changeSets.diff(set.id);
  assert.deepEqual(await changeSets.nextSteps(set.id), [
    { kind: "reject" },
    { kind: "remove", mutationIds: ids },
  ]);
  await assert.rejects(changeSets.decide(set.id, "approved", thread, gone.hash), {
    code: "refused",
    message: /SYN-3 couldn.t be read/,
  });
  jira.show("SYN-3");
  await changeSets.diff(set.id);
  assert.deepEqual(kinds(await changeSets.nextSteps(set.id)), ["approve", "reject", "remove"]);

  // The third row's arguments no longer pass the catalogue, as after it
  // tightened: only that row can be left out, and nothing approved.
  db.prepare("update mutations set args = ? where id = ?").run('{"points":"many"}', nth(ids, 2));
  const stale = await changeSets.get(set.id);
  assert.deepEqual(await changeSets.nextSteps(set.id), [
    { kind: "reject" },
    { kind: "remove", mutationIds: [nth(ids, 2)] },
  ]);
  await assert.rejects(changeSets.decide(set.id, "approved", thread, stale?.hash ?? ""), {
    code: "refused",
    message: /mutation 3 \(setEstimate\): this change's stored arguments are no longer valid/,
  });
  await changeSets.edit(set.id, { remove: [nth(ids, 2)] });
  await changeSets.diff(set.id);
  assert.deepEqual(kinds(await changeSets.nextSteps(set.id)), ["approve", "reject", "remove"]);
});

test("while a change set is applying, nothing else can be done with it", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-3", 3),
  ]);
  const [first, second] = set.mutations.map((m) => m.id) as [Ulid, Ulid];
  await approve(changeSets, set.id);
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  jira.hooks.before = async (_request, n) => {
    if (n !== 1) return;
    reached.resolve();
    await release.promise;
  };
  const applying = changeSets.apply(set.id);
  await reached.promise;
  assert.equal(changeSets.applying(set.id), true);
  assert.deepEqual(await changeSets.nextSteps(set.id), []);
  const thread = { via: "thread", by: "pm" } as const;
  for (const attempt of [
    () => changeSets.edit(set.id, { remove: [second] }),
    () => changeSets.edit(set.id, { set: [{ mutationId: second, args: { points: 8 } }] }),
    () => changeSets.dismiss(set.id),
    () => changeSets.apply(set.id),
    () => changeSets.revert(set.id),
    () => changeSets.decide(set.id, "rejected", thread, set.hash),
    () => changeSets.decide(set.id, "approved", thread, set.hash),
  ])
    await assert.rejects(attempt(), { code: "busy" });
  release.resolve();
  // The apply ran to its end undisturbed, and recorded completion.
  assert.deepEqual((await applying).applied, [first, second]);
  assert.equal(changeSets.applying(set.id), false);
  assert.ok((await changeSets.get(set.id))?.completedAt);
  assert.deepEqual(await changeSets.nextSteps(set.id), [{ kind: "revert" }]);
});

test("a revert that undid part of a change set before it was dismissed ends its reverts", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-3", 3),
  ]);
  await approve(changeSets, set.id);
  await changeSets.apply(set.id);
  const reverse = await changeSets.revert(set.id);
  assert.ok(!("conflicts" in reverse));
  await approve(changeSets, reverse.id);
  // The reverse puts SYN-3 back, then Jira refuses SYN-21's.
  refuseCall(jira, 4);
  await changeSets.apply(reverse.id);
  await changeSets.dismiss(reverse.id);
  // SYN-3 no longer holds what the change set applied, so a second revert
  // could only conflict: it isn't offered, and the reverse is done with too.
  assert.deepEqual(await changeSets.nextSteps(set.id), []);
  assert.deepEqual(await changeSets.nextSteps(reverse.id), []);
  await assert.rejects(changeSets.revert(set.id), { code: "refused", message: /reverted already/ });
});

test("a write never sent, because a read before it failed, is unsent and says so", async () => {
  const { changeSets, run, jira, db } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-3", 3)]);
  const mutationId = nth(set.mutations, 0).id;
  await approve(changeSets, set.id);
  // SYN-3 can't be seen by the time apply reads it.
  jira.hide("SYN-3");
  const report = await changeSets.apply(set.id);
  assert.deepEqual(report.applied, []);
  const row = (await changeSets.get(set.id))?.mutations[0];
  assert.equal(row?.status, "pending");
  assert.equal(plainError(row?.error ?? ""), "Nothing was sent: jira:SYN-3 is gone from Jira.");
  // Nothing may have landed, so it can still be rejected, and no warning.
  assert.deepEqual(kinds(await changeSets.nextSteps(set.id)), ["retry", "reject"]);
  assert.equal(
    db.prepare("select status from mutations where id = ?").get(mutationId)?.status,
    "pending",
  );
});

test("a sent change Oriel can't check stays may-have-landed: an item it can't read", async () => {
  const { changeSets, run, jira, db } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-3", 3)]);
  const mutationId = nth(set.mutations, 0).id;
  await approve(changeSets, set.id);
  loseCall(jira, 1);
  await changeSets.apply(set.id);
  // SYN-3 can't be read now (deleted, moved, or a 403): it may hold the
  // change or not, so the row stays sent, and isn't sent again.
  jira.hide("SYN-3");
  const report = await changeSets.apply(set.id);
  assert.match(nth(report.failed, 0).error, /couldn't tell whether SYN-3 already holds this/);
  assert.equal(status(db, mutationId), "failed");
  assert.equal(jira.calls.length, 1);
  assert.deepEqual(kinds(await changeSets.nextSteps(set.id)), ["retry", "dismiss"]);
  assert.deepEqual((await changeSets.dismiss(set.id)).warnings, [
    "This may already be in Jira: check SYN-3",
  ]);
});

test("a sent change Oriel can't check stays may-have-landed: a key another item took", async () => {
  const { changeSets, run, jira, db } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const mutationId = nth(set.mutations, 0).id;
  await approve(changeSets, set.id);
  // The write lands and its answer is lost; then another item takes SYN-21,
  // holding the same estimate. That isn't Oriel's write in place.
  jira.hooks.after = () => {
    throw new Error("timed out");
  };
  await changeSets.apply(set.id);
  jira.hooks.after = undefined;
  jira.reuse("SYN-21", "99999");
  const report = await changeSets.apply(set.id);
  assert.deepEqual(report.applied, []);
  assert.match(nth(report.failed, 0).error, /couldn't tell whether SYN-21 already holds this/);
  assert.equal(status(db, mutationId), "failed");
  assert.equal(jira.calls.length, 1);
  assert.ok(!kinds(await changeSets.nextSteps(set.id)).includes("reject"));
});

test("a change sent with no answer shows what it was approved from, not what landed", async () => {
  const { changeSets, run, jira, db } = setup();
  const was = jira.issue("SYN-3")?.points ?? null;
  assert.notEqual(was, 8);
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-3", 8),
    estimate("jira:SYN-8", 1),
  ]);
  const [, sent, rest] = set.mutations.map((m) => m.id) as [Ulid, Ulid, Ulid];
  await approve(changeSets, set.id);
  // SYN-3's write lands; its answer doesn't.
  jira.hooks.after = (_request, n) => {
    if (n === 2) throw new Error("timed out");
  };
  await changeSets.apply(set.id);
  jira.hooks.after = undefined;
  assert.equal(jira.issue("SYN-3")?.points, 8);
  const line = async () => nth((await changeSets.diff(set.id)).lines, 1);
  assert.deepEqual((await line()).fields, [{ name: "points", before: was, after: 8 }]);
  assert.doesNotMatch((await line()).sentence, /from 8 points to 8 points/);
  // Neither a later diff nor an edit replaces what it was approved from.
  await changeSets.edit(set.id, { remove: [rest] });
  await changeSets.diff(set.id);
  assert.deepEqual(preview(db, sent), { points: was });
  assert.deepEqual((await line()).fields, [{ name: "points", before: was, after: 8 }]);
});

test("a sent change whose item can't be read now can't be approved again", async () => {
  const { changeSets, run, jira } = setup();
  const was = jira.issue("SYN-21")?.points ?? null;
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-3", 3),
  ]);
  const other = nth(set.mutations, 1).id;
  await approve(changeSets, set.id);
  loseCall(jira, 1);
  await changeSets.apply(set.id);
  // Leaving the other change out voids the approval; then SYN-21 can't be read.
  await changeSets.edit(set.id, { remove: [other] });
  jira.hide("SYN-21");
  const unreadable = await changeSets.diff(set.id);
  assert.ok(!kinds(await changeSets.nextSteps(set.id)).includes("approve"));
  await assert.rejects(
    changeSets.decide(set.id, "approved", { via: "thread", by: "pm" }, unreadable.hash),
    { code: "refused", message: /SYN-21 couldn.t be read/ },
  );
  // Readable again, it can be, and it still shows what it was approved from.
  jira.show("SYN-21");
  const shown = await changeSets.diff(set.id);
  assert.deepEqual(kinds(await changeSets.nextSteps(set.id)), ["approve", "dismiss"]);
  assert.deepEqual(nth(shown.lines, 0).fields, [{ name: "points", before: was, after: 5 }]);
});

test("a send found absent goes back to unsent only if no other apply sent it since", async () => {
  const { db, changeSets, instance, run, jira, groupId, indexed } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const mutationId = nth(set.mutations, 0).id;
  await approve(changeSets, set.id);
  loseCall(jira, 1);
  await changeSets.apply(set.id);
  const other = instance();
  jira.hooks.read = async () => {
    jira.hooks.read = undefined;
    // While this apply checks SYN-21, another sends the change again and
    // hears nothing back either; then SYN-21 leaves the group.
    loseCall(jira, 2);
    await other.apply(set.id);
    groupStore(db).remove(
      groupId,
      [{ id: "jira:SYN-21", stableId: indexed("SYN-21").stableId }],
      { kind: "user" },
      "2026-10-29T09:00:01.000Z" as never,
    );
  };
  const report = await changeSets.apply(set.id);
  assert.match(nth(report.failed, 0).error, /removed from the group/);
  // This apply found its own send absent, not the other's: that may have
  // landed, so the row stays sent.
  assert.equal(status(db, mutationId), "failed");
  assert.equal(jira.calls.length, 2);
  assert.deepEqual((await changeSets.dismiss(set.id)).warnings, [
    "This may already be in Jira: check SYN-21",
  ]);
});

test("a read that fails while apply checks a sent change is recorded, not thrown", async () => {
  const { changeSets, run, jira, db } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const mutationId = nth(set.mutations, 0).id;
  await approve(changeSets, set.id);
  loseCall(jira, 1);
  await changeSets.apply(set.id);
  jira.hooks.read = () => {
    throw new Error("GET /rest/api/3/issue/SYN-21: 503");
  };
  const report = await changeSets.apply(set.id);
  assert.match(nth(report.failed, 0).error, /couldn't tell whether SYN-21 already holds this/);
  assert.equal(status(db, mutationId), "failed");
  assert.match(String((await changeSets.get(set.id))?.mutations[0]?.error), /couldn't tell/);
});
