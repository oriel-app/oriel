import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type CapturedMutation,
  type ChangeSet,
  type ChangeSets,
  type Conflict,
  type FieldValues,
  type SourceWriter,
  type Ulid,
  ulid,
} from "@oriel/core";
import { explainConflicts } from "./change-sets.ts";
import { approve, count, nth, setup, status } from "./testing.ts";

const estimate = (target: `jira:${string}`, points: number): CapturedMutation => ({
  op: "setEstimate",
  target,
  ref: null,
  args: { points },
});

const kiosk: CapturedMutation = {
  op: "createStory",
  target: null,
  ref: "new:1",
  args: { summary: "Pay with a phone wallet at the kiosk", epic: "jira:SYN-1", points: 2 },
};

const kioskLink: CapturedMutation = {
  op: "addLink",
  target: "new:1",
  ref: null,
  args: { url: "https://docs.example.com/wallets", title: "Wallet spec" },
};

async function applied(changeSets: ChangeSets, set: ChangeSet) {
  await approve(changeSets, set.id);
  const report = await changeSets.apply(set.id);
  assert.deepEqual(report.failed, []);
}

async function reverse(changeSets: ChangeSets, id: Ulid): Promise<ChangeSet> {
  const result = await changeSets.revert(id);
  if ("conflicts" in result)
    assert.fail(`unexpected conflicts: ${JSON.stringify(result.conflicts)}`);
  return result;
}

test("eval #5: a revert after an external edit reports the conflict and overwrites nothing", async () => {
  const { changeSets, run, jira, db, events } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    {
      op: "setSummary",
      target: "jira:SYN-117",
      ref: null,
      args: { summary: "Waitlist for the next sailing" },
    },
  ]);
  await applied(changeSets, set);
  // Someone changes the estimate in Jira after Oriel applied it.
  jira.edit("SYN-21", { points: 8 });
  const writes = jira.calls.length;
  const changeSetCount = count(db, "change_sets");

  const result = await changeSets.revert(set.id);
  assert.ok("conflicts" in result);
  assert.deepEqual(result.conflicts, [
    {
      mutationId: nth(set.mutations, 0).id,
      target: "jira:SYN-21",
      field: "points",
      expected: 5,
      actual: 8,
    } satisfies Conflict,
  ]);
  assert.equal(jira.issue("SYN-21")?.points, 8);
  assert.equal(jira.issue("SYN-117")?.summary, "Waitlist for the next sailing");
  assert.equal(jira.calls.length, writes);
  assert.equal(count(db, "change_sets"), changeSetCount);
  assert.deepEqual(
    events.filter((e) => e.name === "changeset.reverted").map((e) => e.conflicts),
    [1],
  );
});

test("a revert is a change set of reverse mutations that puts things back once approved", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [
    kiosk,
    kioskLink,
    estimate("jira:SYN-21", 5),
    { op: "setAssignee", target: "jira:SYN-21", ref: null, args: { accountId: "amara" } },
    { op: "setDescription", target: "jira:SYN-117", ref: null, args: { description: "Email it." } },
    {
      op: "addLink",
      target: "jira:SYN-1",
      ref: null,
      args: { url: "https://docs.example.com/wallet-designs", title: "Wallet designs" },
    },
  ]);
  await applied(changeSets, set);
  const original = set.mutations.map((m) => m.id);

  const back = await reverse(changeSets, set.id);
  assert.equal(back.revertOf, set.id);
  assert.equal(back.runId, null);
  assert.equal(back.decision, null);
  // The story's link goes with the story: one delete undoes both.
  assert.deepEqual(
    back.mutations.map((m) => [m.op, m.target, m.args, m.reverts]),
    [
      ["removeLink", "jira:SYN-1", { linkId: "90002" }, original[5]],
      ["setDescription", "jira:SYN-117", { description: "" }, original[4]],
      ["setAssignee", "jira:SYN-21", { accountId: "dara" }, original[3]],
      ["setEstimate", "jira:SYN-21", { points: 2 }, original[2]],
      ["deleteItem", "jira:SYN-900", {}, original[0]],
    ],
  );
  const diff = await changeSets.diff(back.id);
  assert.equal(
    nth(diff.lines, 0).sentence,
    "Remove the link “Wallet designs” from “Checkout v2: phone wallets and saved cards” (SYN-1).",
  );
  assert.equal(
    nth(diff.lines, 4).sentence,
    "Delete “Pay with a phone wallet at the kiosk” (SYN-900) from Jira.",
  );

  await applied(changeSets, back);
  assert.equal(jira.issue("SYN-900"), null);
  assert.deepEqual([jira.issue("SYN-21")?.points, jira.issue("SYN-21")?.accountId], [2, "dara"]);
  assert.equal(jira.issue("SYN-117")?.description, "");
  assert.deepEqual(
    jira.issue("SYN-1")?.links.map((l) => l.linkId),
    ["30001"],
  );
  await assert.rejects(changeSets.revert(back.id), { code: "not-revertible" });
});

test("reverting an untouched story Oriel created deletes it, once", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [kiosk, kioskLink]);
  await applied(changeSets, set);
  const back = await reverse(changeSets, set.id);
  assert.deepEqual(
    back.mutations.map((m) => [m.op, m.target, m.reverts]),
    [["deleteItem", "jira:SYN-900", nth(set.mutations, 0).id]],
  );
  await applied(changeSets, back);
  assert.equal(jira.issue("SYN-900"), null);
});

test("a story Oriel created that a teammate touched since isn't deleted", async () => {
  const { changeSets, run, jira, db } = setup();
  const set = await changeSets.capture(run, [kiosk, kioskLink]);
  await applied(changeSets, set);
  jira.comment("SYN-900");
  const changeSetCount = count(db, "change_sets");

  const result = await changeSets.revert(set.id);
  assert.ok("conflicts" in result);
  assert.deepEqual(
    result.conflicts.map((c) => [c.mutationId, c.target, c.field]),
    [[nth(set.mutations, 1).id, "jira:SYN-900", "updated"]],
  );
  assert.notEqual(jira.issue("SYN-900"), null);
  assert.equal(count(db, "change_sets"), changeSetCount);
});

test("a story touched after the revert was built isn't deleted when it is applied", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [kiosk]);
  await applied(changeSets, set);
  const back = await reverse(changeSets, set.id);
  jira.comment("SYN-900");
  await approve(changeSets, back.id);
  const report = await changeSets.apply(back.id);
  assert.deepEqual(report.applied, []);
  assert.match(nth(report.failed, 0).error, /SYN-900 was touched since Oriel created it/);
  assert.notEqual(jira.issue("SYN-900"), null);
});

test("a created story whose update time the source never reported isn't deleted", async () => {
  const { instance, run, jira } = setup();
  const without = (values: FieldValues): FieldValues =>
    Object.fromEntries(Object.entries(values).filter(([field]) => field !== "updated"));
  const blind: SourceWriter<"jira"> = {
    kind: "jira",
    apply: async (request) => {
      const result = await jira.writer.apply(request);
      return { ...result, after: without(result.after) };
    },
    current: async (id, fields) => {
      const values = await jira.writer.current(id, fields);
      return values === "gone" ? values : without(values);
    },
  };
  const changeSets = instance(blind);
  const set = await changeSets.capture(run, [kiosk]);
  await applied(changeSets, set);
  const result = await changeSets.revert(set.id);
  assert.ok("conflicts" in result);
  assert.deepEqual(
    result.conflicts.map((c) => [c.target, c.field]),
    [["jira:SYN-900", "updated"]],
  );
});

test("a field conflict that appears after the revert was built stops that reverse mutation", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-117", 2),
  ]);
  await applied(changeSets, set);
  const back = await reverse(changeSets, set.id);
  jira.edit("SYN-21", { points: 8 });
  await approve(changeSets, back.id);
  const writes = jira.calls.length;

  const report = await changeSets.apply(back.id);
  assert.deepEqual(report.applied, [nth(back.mutations, 0).id]);
  assert.deepEqual(
    report.failed.map((f) => f.mutationId),
    [nth(back.mutations, 1).id],
  );
  assert.match(nth(report.failed, 0).error, /nothing was overwritten/);
  assert.equal(jira.issue("SYN-21")?.points, 8);
  assert.equal(jira.issue("SYN-117")?.points, null);
  assert.equal(jira.calls.length, writes + 1);
});

test("two changes to one field revert to the value before the first", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-21", 8),
  ]);
  await applied(changeSets, set);
  const back = await reverse(changeSets, set.id);
  await applied(changeSets, back);
  assert.equal(jira.issue("SYN-21")?.points, 2);
});

test("a reverse set op whose answer was lost is recorded on retry, not reported as a conflict", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  await applied(changeSets, set);
  const back = await reverse(changeSets, set.id);
  await approve(changeSets, back.id);
  // The reverse lands, then its answer is lost.
  jira.hooks.after = () => {
    throw new Error("timed out");
  };
  const lost = await changeSets.apply(back.id);
  assert.equal(lost.failed.length, 1);
  assert.equal(jira.issue("SYN-21")?.points, 2);
  jira.hooks.after = undefined;
  const writes = jira.calls.length;

  const retry = await changeSets.apply(back.id);
  assert.deepEqual(retry.failed, []);
  assert.deepEqual(retry.applied, [nth(back.mutations, 0).id]);
  assert.equal(jira.calls.length, writes);
});

test("a set op whose result didn't report the field it set can't be reverted blind", async () => {
  const { instance, run, jira } = setup();
  // The writer reports only `updated` after a set op.
  const terse: SourceWriter<"jira"> = {
    kind: "jira",
    apply: async (request) => {
      const result = await jira.writer.apply(request);
      return {
        ...result,
        after: Object.fromEntries(Object.entries(result.after).filter(([f]) => f === "updated")),
      };
    },
    current: jira.writer.current,
  };
  const changeSets = instance(terse);
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    { op: "setEstimate", target: "jira:SYN-8", ref: null, args: { points: null } },
  ]);
  await applied(changeSets, set);
  const result = await changeSets.revert(set.id);
  assert.ok("conflicts" in result);
  assert.deepEqual(result.conflicts, [
    {
      mutationId: nth(set.mutations, 0).id,
      target: "jira:SYN-21",
      field: "points",
      expected: undefined,
      actual: 5,
    },
    // Even when the value now is the one Oriel wrote: it never heard so.
    {
      mutationId: nth(set.mutations, 1).id,
      target: "jira:SYN-8",
      field: "points",
      expected: undefined,
      actual: null,
    },
  ]);
});

test("a change set can't be reverted while it is being applied", async () => {
  const { changeSets, run, jira, db } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-117", 2),
  ]);
  await approve(changeSets, set.id);
  const reached = Promise.withResolvers<void>();
  jira.hooks.before = (_request, call) => {
    if (call !== 2) return;
    reached.resolve();
    return new Promise<void>(() => {});
  };
  void changeSets.apply(set.id);
  await reached.promise;
  const changeSetCount = count(db, "change_sets");
  await assert.rejects(changeSets.revert(set.id), { code: "busy" });
  assert.equal(count(db, "change_sets"), changeSetCount);
});

test("reverting a partly applied change set drops what didn't land, so it can't land later", async () => {
  const { changeSets, run, jira, db } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-117", 2),
  ]);
  const [landed, stuck] = [nth(set.mutations, 0).id, nth(set.mutations, 1).id];
  await approve(changeSets, set.id);
  jira.hooks.before = (_request, call) => {
    if (call === 2) throw new Error("503: Jira is busy");
  };
  const report = await changeSets.apply(set.id);
  assert.deepEqual(report.applied, [landed]);
  jira.hooks.before = undefined;

  const back = await reverse(changeSets, set.id);
  assert.deepEqual(
    back.mutations.map((m) => [m.op, m.target, m.args, m.reverts]),
    [["setEstimate", "jira:SYN-21", { points: 2 }, landed]],
  );
  assert.equal(status(db, stuck), undefined);
  await assert.rejects(changeSets.apply(set.id), { code: "not-approved" });
  assert.equal(jira.issue("SYN-117")?.points, null);
});

test("a revert built while more of the change set lands is refused", async () => {
  const { changeSets, run, jira, db } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-117", 2),
  ]);
  await approve(changeSets, set.id);
  jira.hooks.before = (_request, call) => {
    if (call === 2) throw new Error("503: Jira is busy");
  };
  await changeSets.apply(set.id);
  jira.hooks.before = undefined;
  // While the revert reads Jira, a retry lands the rest.
  jira.hooks.read = async () => {
    jira.hooks.read = undefined;
    await changeSets.apply(set.id);
  };
  const changeSetCount = count(db, "change_sets");
  await assert.rejects(changeSets.revert(set.id), { code: "busy" });
  assert.equal(count(db, "change_sets"), changeSetCount);
  assert.equal(jira.issue("SYN-117")?.points, 2);
});

test("a change set with a create that may have landed can't be reverted until that's settled", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    {
      op: "createStory",
      target: null,
      ref: "new:1",
      args: { summary: "Pay with a phone wallet at the kiosk", epic: "jira:SYN-1" },
    },
  ]);
  await approve(changeSets, set.id);
  jira.hooks.after = (_request, call) => {
    if (call === 2) throw new Error("timed out");
  };
  await changeSets.apply(set.id);
  await assert.rejects(changeSets.revert(set.id), { code: "not-revertible" });
});

test("a reverse mutation stopped before sending is checked again next time", async () => {
  const { changeSets, run, jira, db } = setup();
  const set = await changeSets.capture(run, [
    {
      op: "addLink",
      target: "jira:SYN-1",
      ref: null,
      args: { url: "https://docs.example.com/wallet-designs", title: "Wallet designs" },
    },
  ]);
  await applied(changeSets, set);
  const back = await reverse(changeSets, set.id);
  const removal = nth(back.mutations, 0).id;
  await approve(changeSets, back.id);

  jira.retitleLink("SYN-1", "90001", "Wallet designs, v2");
  const stopped = await changeSets.apply(back.id);
  assert.match(nth(stopped.failed, 0).error, /nothing was overwritten/);
  assert.equal(status(db, removal), "pending");

  jira.retitleLink("SYN-1", "90001", "Wallet designs");
  const retry = await changeSets.apply(back.id);
  assert.deepEqual(retry.applied, [removal]);
  assert.deepEqual(
    jira.issue("SYN-1")?.links.map((l) => l.linkId),
    ["30001"],
  );
});

test("conflicts read in plain words, including what Oriel never learned", () => {
  const mutationId = ulid(0, new Uint8Array(10));
  const conflict = (field: string, expected: unknown, actual: unknown): Conflict => ({
    mutationId,
    target: "jira:SYN-900",
    field,
    expected,
    actual,
  });
  assert.equal(
    explainConflicts([
      conflict("updated", null, "2026-10-29T09:00:05.000Z"),
      conflict("updated", "2026-10-29T09:00:01.000Z", "2026-10-29T09:00:05.000Z"),
      conflict("points", undefined, 5),
      conflict("points", 5, 8),
      conflict("item", "present", "gone"),
    ]),
    "Stopped, so nothing was overwritten: " +
      "Oriel never learned when SYN-900 was last updated, so it can't tell whether anyone touched it; " +
      "SYN-900 was touched since Oriel created it; " +
      "Jira didn't report SYN-900's points after the change, so Oriel can't tell whether anyone changed it; " +
      "SYN-900's points is now 8, not 5; " +
      "SYN-900 is no longer there.",
  );
});
