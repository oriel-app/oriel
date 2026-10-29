import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  CapturedMutation,
  ChangeSet,
  ChangeSets,
  Conflict,
  FieldValues,
  SourceWriter,
  Ulid,
} from "@oriel/core";
import { approve, count, nth, setup } from "./testing.ts";

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
