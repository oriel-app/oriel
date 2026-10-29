import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapturedMutation, ChangeSet, ChangeSets, Conflict, Ulid } from "@oriel/core";
import { approve, count, nth, setup } from "./testing.ts";

const estimate = (target: `jira:${string}`, points: number): CapturedMutation => ({
  op: "setEstimate",
  target,
  ref: null,
  args: { points },
});

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
    estimate("jira:SYN-2", 5),
    { op: "setSummary", target: "jira:SYN-3", ref: null, args: { summary: "Email a receipt" } },
  ]);
  await applied(changeSets, set);
  // Someone changes the estimate in Jira after Oriel applied it.
  jira.edit("SYN-2", { points: 8 });
  const writes = jira.calls.length;
  const changeSetCount = count(db, "change_sets");

  const result = await changeSets.revert(set.id);
  assert.ok("conflicts" in result);
  assert.deepEqual(result.conflicts, [
    {
      mutationId: nth(set.mutations, 0).id,
      target: "jira:SYN-2",
      field: "points",
      expected: 5,
      actual: 8,
    } satisfies Conflict,
  ]);
  assert.equal(jira.issue("SYN-2")?.points, 8);
  assert.equal(jira.issue("SYN-3")?.summary, "Email a receipt");
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
    {
      op: "createStory",
      target: null,
      ref: "new:1",
      args: { summary: "Retry wallet payments", epic: "jira:SYN-1", points: 2 },
    },
    {
      op: "addLink",
      target: "new:1",
      ref: null,
      args: { url: "https://docs.example.com/wallets", title: "Wallet spec" },
    },
    estimate("jira:SYN-2", 5),
    { op: "setAssignee", target: "jira:SYN-2", ref: null, args: { accountId: "acc-bo" } },
    { op: "setDescription", target: "jira:SYN-3", ref: null, args: { description: "Email it." } },
  ]);
  await applied(changeSets, set);
  const original = set.mutations.map((m) => m.id);

  const back = await reverse(changeSets, set.id);
  assert.equal(back.revertOf, set.id);
  assert.equal(back.runId, null);
  assert.equal(back.decision, null);
  assert.deepEqual(
    back.mutations.map((m) => [m.op, m.target, m.args, m.reverts]),
    [
      ["setDescription", "jira:SYN-3", { description: "" }, original[4]],
      ["setAssignee", "jira:SYN-2", { accountId: "acc-ana" }, original[3]],
      ["setEstimate", "jira:SYN-2", { points: 3 }, original[2]],
      ["removeLink", "jira:SYN-100", { linkId: "30001" }, original[1]],
      ["deleteItem", "jira:SYN-100", {}, original[0]],
    ],
  );
  const diff = await changeSets.diff(back.id);
  assert.equal(nth(diff.lines, 4).sentence, "Delete “Retry wallet payments” (SYN-100) from Jira.");

  await applied(changeSets, back);
  assert.equal(jira.issue("SYN-100"), null);
  assert.deepEqual(
    [jira.issue("SYN-2")?.points, jira.issue("SYN-2")?.accountId, jira.issue("SYN-3")?.description],
    [3, "acc-ana", ""],
  );
  await assert.rejects(changeSets.revert(back.id), { code: "not-revertible" });
});

test("a conflict that appears after the revert was built stops that reverse mutation", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-2", 5), estimate("jira:SYN-3", 2)]);
  await applied(changeSets, set);
  const back = await reverse(changeSets, set.id);
  jira.edit("SYN-2", { points: 8 });
  await approve(changeSets, back.id);
  const writes = jira.calls.length;

  const report = await changeSets.apply(back.id);
  assert.deepEqual(report.applied, [nth(back.mutations, 0).id]);
  assert.deepEqual(
    report.failed.map((f) => f.mutationId),
    [nth(back.mutations, 1).id],
  );
  assert.match(nth(report.failed, 0).error, /nothing was overwritten/);
  assert.equal(jira.issue("SYN-2")?.points, 8);
  assert.equal(jira.issue("SYN-3")?.points, null);
  assert.equal(jira.calls.length, writes + 1);
});

test("two changes to one field revert to the value before the first", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-2", 5), estimate("jira:SYN-2", 8)]);
  await applied(changeSets, set);
  const back = await reverse(changeSets, set.id);
  await applied(changeSets, back);
  assert.equal(jira.issue("SYN-2")?.points, 3);
});
