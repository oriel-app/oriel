import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapturedMutation } from "@oriel/core";
import { approve, count, nth, setup } from "./testing.ts";

const estimate = (target: string, points: number | null): CapturedMutation => ({
  op: "setEstimate",
  target: target as CapturedMutation["target"],
  ref: null,
  args: { points },
});

test("capture stores mutations in seq order with their validated arguments", async () => {
  const { changeSets, run } = setup();
  const set = await changeSets.capture(run, [
    { op: "setEstimate", target: "jira:SYN-2", ref: null, args: { points: 5, note: "dropped" } },
    {
      op: "createStory",
      target: null,
      ref: "new:1",
      args: { summary: "Retry wallet payments", epic: "jira:SYN-1" },
    },
    {
      op: "addLink",
      target: "new:1",
      ref: null,
      args: { url: "https://docs.example.com/wallets", title: "Wallet spec" },
    },
  ]);
  assert.deepEqual(
    set.mutations.map((m) => [m.seq, m.op, m.target, m.ref, m.status]),
    [
      [1, "setEstimate", "jira:SYN-2", null, "pending"],
      [2, "createStory", null, "new:1", "pending"],
      [3, "addLink", "new:1", null, "pending"],
    ],
  );
  assert.deepEqual(nth(set.mutations, 0).args, { points: 5 });
  assert.equal(set.runId, run.id);
  assert.equal(set.decision, null);
});

test("capture refuses refs no earlier create gives, and keeps nothing", async () => {
  const { changeSets, run, db } = setup();
  const create = (ref: string | null): CapturedMutation => ({
    op: "createStory",
    target: null,
    ref: ref as CapturedMutation["ref"],
    args: { summary: "Retry wallet payments", epic: null },
  });
  const refused: CapturedMutation[][] = [
    // used before the create that names it
    [estimate("new:1", 3), create("new:1")],
    // never created
    [create("new:1"), estimate("new:2", 3)],
    // named twice
    [create("new:1"), create("new:1")],
    // a non-create naming a new item
    [{ ...estimate("jira:SYN-2", 3), ref: "new:1" }],
    // a create with a target
    [{ ...create(null), target: "jira:SYN-2" }],
    // arguments the op doesn't take
    [estimate("jira:SYN-2", "3" as unknown as number)],
  ];
  for (const mutations of refused) {
    await assert.rejects(
      changeSets.capture(run, mutations),
      { code: "invalid" },
      JSON.stringify(mutations),
    );
  }
  assert.equal(count(db, "change_sets"), 0);
});

test("a diff says what each mutation will do, in plain words", async () => {
  const { changeSets, run } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-2", 5),
    { op: "setAssignee", target: "jira:SYN-2", ref: null, args: { accountId: "acc-bo" } },
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
    estimate("jira:SYN-2", 8),
    {
      op: "setDescription",
      target: "jira:SYN-3",
      ref: null,
      args: { description: "Email it too." },
    },
  ]);
  const diff = await changeSets.diff(set.id);
  assert.deepEqual(
    diff.lines.map((line) => line.sentence),
    [
      "Change the estimate of “Retry failed card payments” (SYN-2) from 3 points to 5 points.",
      "Reassign “Retry failed card payments” (SYN-2) from Ana Lima to Bo Chen.",
      "Create a story “Retry wallet payments” in the epic “Checkout reliability” (SYN-1), estimated at 2 points.",
      "Add the link “Wallet spec” (docs.example.com) to the new story “Retry wallet payments”.",
      "Change the estimate of “Retry failed card payments” (SYN-2) from 5 points to 8 points.",
      "Add a description to “Show a receipt after checkout” (SYN-3).",
    ],
  );
  assert.deepEqual(nth(diff.lines, 0).fields, [{ name: "points", before: 3, after: 5 }]);
  assert.equal(diff.hash, set.hash);
});

test("a diff's hash is the hash of the rows it rendered, even when an edit lands meanwhile", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-2", 5)]);
  const mutationId = nth(set.mutations, 0).id;
  jira.hooks.read = async () => {
    jira.hooks.read = undefined;
    await changeSets.edit(set.id, { set: [{ mutationId, args: { points: 13 } }] });
  };
  const diff = await changeSets.diff(set.id);
  assert.equal(
    nth(diff.lines, 0).sentence,
    "Change the estimate of “Retry failed card payments” (SYN-2) from 3 points to 5 points.",
  );
  assert.equal(diff.hash, set.hash);
  await assert.rejects(
    changeSets.decide(set.id, "approved", { via: "thread", by: "pm" }, diff.hash),
    { code: "stale" },
  );
});

test("an edit changes the derived hash", async () => {
  const { changeSets, run, events } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-2", 5), estimate("jira:SYN-3", 2)]);
  const edited = await changeSets.edit(set.id, {
    set: [{ mutationId: nth(set.mutations, 0).id, args: { points: 8 } }],
  });
  assert.notEqual(edited.hash, set.hash);
  const trimmed = await changeSets.edit(set.id, { remove: [nth(set.mutations, 1).id] });
  assert.notEqual(trimmed.hash, edited.hash);
  assert.deepEqual(
    trimmed.mutations.map((m) => m.args),
    [{ points: 8 }],
  );
  assert.equal(events.filter((e) => e.name === "changeset.edited").length, 2);
});

test("a decision on a stale reviewed hash is refused", async () => {
  const { changeSets, run, db } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-2", 5)]);
  const diff = await changeSets.diff(set.id);
  await changeSets.edit(set.id, {
    set: [{ mutationId: nth(set.mutations, 0).id, args: { points: 40 } }],
  });
  await assert.rejects(
    changeSets.decide(set.id, "approved", { via: "thread", by: "pm" }, diff.hash),
    { code: "stale" },
  );
  assert.equal(count(db, "decisions"), 0);
});

test("an edit after approval voids it: apply refuses and writes nothing", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-2", 5)]);
  const approved = await approve(changeSets, set.id);
  assert.equal(approved.decision?.kind, "approved");
  const edited = await changeSets.edit(set.id, {
    set: [{ mutationId: nth(set.mutations, 0).id, args: { points: 40 } }],
  });
  assert.equal(edited.decision, null);
  await assert.rejects(changeSets.apply(set.id), { code: "not-approved" });
  assert.deepEqual(jira.calls, []);
  assert.equal(jira.issue("SYN-2")?.points, 3);
});

test("an edit during apply stops every write after it", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-2", 5), estimate("jira:SYN-3", 2)]);
  await approve(changeSets, set.id);
  jira.hooks.after = async (_request, call) => {
    if (call !== 1) return;
    await changeSets.edit(set.id, {
      set: [{ mutationId: nth(set.mutations, 1).id, args: { points: 13 } }],
    });
  };
  await assert.rejects(changeSets.apply(set.id), { code: "not-approved" });
  assert.equal(jira.calls.length, 1);
  assert.equal(jira.issue("SYN-2")?.points, 5);
  assert.equal(jira.issue("SYN-3")?.points, null);
});

test("apply replays exactly the captured arguments, in seq order", async () => {
  const { changeSets, run, jira, events } = setup();
  const set = await changeSets.capture(run, [
    { op: "setSummary", target: "jira:SYN-3", ref: null, args: { summary: "Email a receipt" } },
    estimate("jira:SYN-2", 5),
    {
      op: "setDescription",
      target: "jira:SYN-1",
      ref: null,
      args: { description: "Fewer retries." },
    },
  ]);
  await approve(changeSets, set.id);
  const report = await changeSets.apply(set.id);
  assert.deepEqual(
    jira.calls.map(({ mutationId, op, target, args }) => ({ mutationId, op, target, args })),
    set.mutations.map(({ id, op, target, args }) => ({ mutationId: id, op, target, args })),
  );
  assert.deepEqual(report, {
    changeSetId: set.id,
    applied: set.mutations.map((m) => m.id),
    skipped: [],
    failed: [],
  });
  assert.deepEqual(
    events.filter((e) => e.name === "changeset.applied").map((e) => e.changeSetId),
    [set.id],
  );
  const again = await changeSets.apply(set.id);
  assert.deepEqual(
    again.skipped,
    set.mutations.map((m) => m.id),
  );
  assert.equal(jira.calls.length, 3);
});

test("NewRef chains resolve to the items earlier creates made", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [
    {
      op: "createStory",
      target: null,
      ref: "new:1",
      args: { summary: "Retry wallet payments", epic: "jira:SYN-1" },
    },
    {
      op: "createStory",
      target: null,
      ref: "new:2",
      args: { summary: "Wallet receipts", epic: "jira:SYN-1" },
    },
    estimate("new:1", 3),
    {
      op: "addLink",
      target: "new:2",
      ref: null,
      args: { url: "https://docs.example.com/wallets", title: "Wallet spec" },
    },
    { op: "setAssignee", target: "new:1", ref: null, args: { accountId: "acc-bo" } },
  ]);
  await approve(changeSets, set.id);
  const report = await changeSets.apply(set.id);
  assert.deepEqual(report.failed, []);
  assert.deepEqual(
    jira.calls.map((c) => c.target),
    [null, null, "jira:SYN-100", "jira:SYN-101", "jira:SYN-100"],
  );
  assert.equal(jira.issue("SYN-100")?.points, 3);
  assert.equal(jira.issue("SYN-100")?.accountId, "acc-bo");
  assert.equal(jira.issue("SYN-101")?.links.length, 1);
});

test("after a crash, apply resumes and skips what already landed", async () => {
  const { changeSets, instance, run, jira } = setup();
  const set = await changeSets.capture(run, [
    {
      op: "createStory",
      target: null,
      ref: "new:1",
      args: { summary: "Retry wallet payments", epic: "jira:SYN-1" },
    },
    estimate("jira:SYN-2", 5),
    {
      op: "addLink",
      target: "new:1",
      ref: null,
      args: { url: "https://docs.example.com/wallets", title: "Wallet spec" },
    },
    estimate("jira:SYN-3", 2),
  ]);
  await approve(changeSets, set.id);
  const ids = set.mutations.map((m) => m.id);

  // The process dies during the third write, before it lands.
  const reached = Promise.withResolvers<void>();
  jira.hooks.before = (_request, call) => {
    if (call !== 3) return;
    reached.resolve();
    return new Promise<void>(() => {});
  };
  void changeSets.apply(set.id);
  await reached.promise;
  jira.hooks.before = undefined;

  const report = await instance().apply(set.id);
  assert.deepEqual(report.skipped, ids.slice(0, 2));
  assert.deepEqual(report.applied, ids.slice(2));
  assert.deepEqual(
    jira.calls.map((c) => [c.op, c.target]),
    [
      ["createStory", null],
      ["setEstimate", "jira:SYN-2"],
      ["addLink", "jira:SYN-100"],
      ["addLink", "jira:SYN-100"],
      ["setEstimate", "jira:SYN-3"],
    ],
  );
  assert.equal(jira.issue("SYN-101"), null);
  assert.equal(jira.issue("SYN-100")?.links.length, 1);
});
