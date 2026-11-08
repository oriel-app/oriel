// What a person can do with a change set, from the engine's own state: each
// step offered is one the engine takes, and each it would refuse is left out.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type CapturedMutation, type NextStep, SourceRefused, type Ulid } from "@oriel/core";
import { workstreamStore } from "@oriel/db";
import { sendLeaseMs, writeLimitMs } from "./change-sets.ts";
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

test("an apply whose last send goes a send's lease unanswered has stalled, and stays busy until it returns", async () => {
  const { changeSets, run, jira, advance } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-3", 3),
  ]);
  await approve(changeSets, set.id);
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  jira.hooks.before = async () => {
    reached.resolve();
    await release.promise;
  };
  const applying = changeSets.apply(set.id);
  await reached.promise;
  advance(sendLeaseMs - 1);
  assert.equal(changeSets.stalled(set.id), false);
  advance(1);
  assert.equal(changeSets.stalled(set.id), true);
  // Still applying, and nothing else can be done with it: a send may land.
  assert.equal(changeSets.applying(set.id), true);
  assert.deepEqual(await changeSets.nextSteps(set.id), []);
  await assert.rejects(changeSets.dismiss(set.id), { code: "busy" });
  jira.hooks.before = undefined;
  release.resolve();
  assert.equal((await applying).applied.length, 2);
  assert.equal(changeSets.stalled(set.id), false);
});

test("a write has until a write's limit after it went, inside a send's lease, then gives up", async () => {
  assert.ok(writeLimitMs < sendLeaseMs);
  for (const [givesUp, steps] of [
    // Asked to wait past its limit: sent again by nothing, it is unsent.
    [
      new SourceRefused("Jira asked Oriel to wait 600 seconds before sending it again", {
        sent: false,
      }),
      ["retry", "reject"],
    ],
    // Hung until its limit ran out: it may have landed.
    [
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
      ["retry", "dismiss"],
    ],
  ] as const) {
    const { changeSets, run, jira, advance } = setup();
    const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
    await approve(changeSets, set.id);
    const left: number[] = [];
    jira.hooks.before = (_request, _call, limit) => {
      left.push(limit?.left() ?? -1);
      advance(writeLimitMs);
      left.push(limit?.left() ?? -1);
      throw givesUp;
    };
    assert.equal((await changeSets.apply(set.id)).failed.length, 1);
    assert.deepEqual(left, [writeLimitMs, 0]);
    // Over before the window would see it stalled, with what can be done next.
    assert.equal(changeSets.applying(set.id), false);
    assert.equal(changeSets.stalled(set.id), false);
    assert.deepEqual(kinds(await changeSets.nextSteps(set.id)), steps);
  }
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
  // Until the rest is dismissed, a revert would leave the story behind.
  const steps = await changeSets.nextSteps(set.id);
  assert.deepEqual(kinds(steps), ["remove", "dismiss"]);
  assert.deepEqual(removable(steps), [created]);
  await assert.rejects(changeSets.revert(set.id), { code: "not-revertible" });
  const dismissed = await changeSets.dismiss(set.id);
  assert.equal(dismissed.warnings.length, 1);
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
  await assert.rejects(changeSets.revert(set.id), { code: "refused" });
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
  assert.ok(nth(report.failed, 0).error);
  assert.equal(status(db, mutationId), "failed");
  assert.equal(jira.calls.length, 1);
  assert.deepEqual(kinds(await changeSets.nextSteps(set.id)), ["retry", "dismiss"]);
  assert.equal((await changeSets.dismiss(set.id)).warnings.length, 1);
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
  assert.ok(nth(report.failed, 0).error);
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
    { code: "refused" },
  );
  // Readable again, it can be, and it still shows what it was approved from.
  jira.show("SYN-21");
  const shown = await changeSets.diff(set.id);
  assert.deepEqual(kinds(await changeSets.nextSteps(set.id)), ["approve", "dismiss"]);
  assert.deepEqual(nth(shown.lines, 0).fields, [{ name: "points", before: was, after: 5 }]);
});

test("a send found absent goes back to unsent only if no other apply sent it since", async () => {
  const { db, changeSets, instance, run, jira, workstreamId, indexed } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const mutationId = nth(set.mutations, 0).id;
  await approve(changeSets, set.id);
  loseCall(jira, 1);
  await changeSets.apply(set.id);
  const other = instance();
  jira.hooks.read = async () => {
    jira.hooks.read = undefined;
    // While this apply checks SYN-21, another sends the change again and
    // hears nothing back either; then SYN-21 leaves the workstream.
    loseCall(jira, 2);
    await other.apply(set.id);
    workstreamStore(db).remove(
      workstreamId,
      [{ id: "jira:SYN-21", stableId: indexed("SYN-21").stableId }],
      { kind: "user" },
      "2026-10-29T09:00:01.000Z" as never,
    );
  };
  const report = await changeSets.apply(set.id);
  assert.ok(nth(report.failed, 0).error);
  // This apply found its own send absent, not the other's: that may have
  // landed, so the row stays sent.
  assert.equal(status(db, mutationId), "failed");
  assert.equal(jira.calls.length, 2);
  assert.equal((await changeSets.dismiss(set.id)).warnings.length, 1);
});

test("an absent read goes stale when anything writes to the row, even the same words again", async () => {
  const { db, changeSets, instance, run, jira, workstreamId, indexed } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const mutationId = nth(set.mutations, 0).id;
  await approve(changeSets, set.id);
  // 1. The row is sent and its answer lost; then its item can't be read, so
  //    apply says it couldn't tell.
  loseCall(jira, 1);
  await changeSets.apply(set.id);
  jira.hide("SYN-21");
  await changeSets.apply(set.id);
  jira.show("SYN-21");
  const said = (await changeSets.get(set.id))?.mutations[0]?.error;
  assert.ok(String(said));
  const [b, c] = [instance(), instance()];
  jira.hooks.answered = async () => {
    jira.hooks.answered = undefined;
    // 2. This apply has read SYN-21 without the change, and waits.
    // 3. Another sends it: it lands, and its answer is lost.
    jira.hooks.after = () => {
      jira.hooks.after = undefined;
      throw new Error("timed out");
    };
    await b.apply(set.id);
    // 4. A third can't read SYN-21, and says it couldn't tell in the same
    //    words as before, so only the row's version tells the two apart.
    jira.hide("SYN-21");
    await c.apply(set.id);
    jira.show("SYN-21");
    assert.equal((await changeSets.get(set.id))?.mutations[0]?.error, said);
    // And SYN-21 leaves the workstream, so this apply won't send it.
    workstreamStore(db).remove(
      workstreamId,
      [{ id: "jira:SYN-21", stableId: indexed("SYN-21").stableId }],
      { kind: "user" },
      "2026-10-29T09:00:01.000Z" as never,
    );
  };
  // 5. Its read is out of date: the other's write landed. The row stays sent.
  await changeSets.apply(set.id);
  assert.equal(jira.issue("SYN-21")?.points, 5);
  assert.equal(status(db, mutationId), "failed");
  assert.ok(!kinds(await changeSets.nextSteps(set.id)).includes("reject"));
});
