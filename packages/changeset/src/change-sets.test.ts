import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapturedMutation } from "@oriel/core";
import { approve, count, nth, preview, setup, status } from "./testing.ts";

const estimate = (target: string, points: number | null): CapturedMutation => ({
  op: "setEstimate",
  target: target as CapturedMutation["target"],
  ref: null,
  args: { points },
});

const story = (ref: string | null, summary: string, epic: string | null): CapturedMutation => ({
  op: "createStory",
  target: null,
  ref: ref as CapturedMutation["ref"],
  args: { summary, epic },
});

const link = (target: string, url: string, title: string): CapturedMutation => ({
  op: "addLink",
  target: target as CapturedMutation["target"],
  ref: null,
  args: { url, title },
});

// SYN-21 and SYN-8 share the title "Update the payment declined error message"
// and both start at 2 points; SYN-21 is Dara Nikolaidis's, in the SYN-1 epic.
const declined = "“Update the payment declined error message”";

test("capture stores mutations in seq order with their validated arguments", async () => {
  const { changeSets, run } = setup();
  const set = await changeSets.capture(run, [
    { ...estimate("jira:SYN-21", 5), args: { points: 5, note: "dropped" } },
    story("new:1", "Pay with a phone wallet at the kiosk", "jira:SYN-1"),
    link("new:1", "https://docs.example.com/wallets", "Wallet spec"),
  ]);
  assert.deepEqual(
    set.mutations.map((m) => [m.seq, m.op, m.target, m.ref, m.status]),
    [
      [1, "setEstimate", "jira:SYN-21", null, "pending"],
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
  const refused: CapturedMutation[][] = [
    // used before the create that names it
    [estimate("new:1", 3), story("new:1", "Wallet refunds", null)],
    // never created
    [story("new:1", "Wallet refunds", null), estimate("new:2", 3)],
    // named twice
    [story("new:1", "Wallet refunds", null), story("new:1", "Wallet receipts", null)],
    // a non-create naming a new item
    [{ ...estimate("jira:SYN-21", 3), ref: "new:1" }],
    // a create with a target
    [{ ...story(null, "Wallet refunds", null), target: "jira:SYN-21" }],
    // arguments the op doesn't take
    [estimate("jira:SYN-21", "3" as unknown as number)],
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

test("capture refuses ops that exist only to revert", async () => {
  const { changeSets, run, db } = setup();
  const refused: CapturedMutation[] = [
    { op: "deleteItem", target: "jira:SYN-21", ref: null, args: {} },
    { op: "removeLink", target: "jira:SYN-1", ref: null, args: { linkId: "30001" } },
  ];
  for (const mutation of refused) {
    await assert.rejects(changeSets.capture(run, [mutation]), { code: "invalid" }, mutation.op);
  }
  assert.equal(count(db, "change_sets"), 0);
});

test("a change set reaches only its region: targets and item IDs in arguments", async () => {
  const { changeSets, run, db } = setup();
  await assert.rejects(changeSets.capture(run, [estimate("jira:SYN-14", 3)]), {
    code: "refused",
  });
  await assert.rejects(
    changeSets.capture(run, [story("new:1", "Gate change alerts", "jira:SYN-2")]),
    { code: "refused" },
  );
  await assert.rejects(
    changeSets.capture(run, [
      story("new:1", "Gate change alerts", "jira:SYN-1"),
      story("new:2", "Gate change sounds", "new:1"),
    ]),
    { code: "refused" },
  );
  assert.equal(count(db, "change_sets"), 0);

  const set = await changeSets.capture(run, [story("new:1", "Gate change alerts", "jira:SYN-1")]);
  await assert.rejects(
    changeSets.edit(set.id, {
      set: [{ mutationId: nth(set.mutations, 0).id, args: { summary: "x", epic: "jira:SYN-2" } }],
    }),
    { code: "refused" },
  );
});

test("region membership follows stable IDs, not handles", async () => {
  const { changeSets, run, indexPage, indexed } = setup();
  // SYN-21 moves to another project, and an item from outside the region
  // takes the key it left behind.
  const moved = indexed("SYN-21");
  // SYN-27 was deleted, and a new item outside the region now has its key.
  indexPage([
    { ...moved, id: "jira:OPS-5" },
    { ...indexed("SYN-14"), id: "jira:SYN-21", stableId: "99999" },
    { ...indexed("SYN-14"), id: "jira:SYN-27", stableId: "99998" },
  ]);
  const set = await changeSets.capture(run, [estimate("jira:OPS-5", 3)]);
  assert.equal(nth(set.mutations, 0).target, "jira:OPS-5");
  for (const reused of ["jira:SYN-21", "jira:SYN-27"]) {
    await assert.rejects(
      changeSets.capture(run, [estimate(reused, 3)]),
      { code: "refused" },
      reused,
    );
  }
});

test("a diff says what each mutation will do, in plain words", async () => {
  const { changeSets, run } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-8", 3),
    { op: "setAssignee", target: "jira:SYN-21", ref: null, args: { accountId: "amara" } },
    {
      ...story("new:1", "Pay with a phone wallet at the kiosk", "jira:SYN-1"),
      args: { summary: "Pay with a phone wallet at the kiosk", epic: "jira:SYN-1", points: 2 },
    },
    link("new:1", "https://docs.example.com/wallets", "Wallet spec"),
    link("jira:SYN-13", "javascript://docs.example.com/%0aalert(1)", "Countdown spec"),
    estimate("jira:SYN-21", 8),
    {
      op: "setSummary",
      target: "jira:SYN-31",
      ref: null,
      args: { summary: "運航状況のプッシュ通知を日本語と英語で送る" },
    },
    {
      op: "setDescription",
      target: "jira:SYN-103",
      ref: null,
      args: { description: "Cache it for a week." },
    },
    estimate("jira:SYN-27", 3),
  ]);
  const diff = await changeSets.diff(set.id);
  assert.deepEqual(
    diff.lines.map((line) => line.sentence),
    [
      `Change the estimate of ${declined} (SYN-21) from 2 points to 5 points.`,
      `Change the estimate of ${declined} (SYN-8) from 2 points to 3 points.`,
      `Reassign ${declined} (SYN-21) from Dara Nikolaidis to Amara Okafor.`,
      "Create a story “Pay with a phone wallet at the kiosk” in the epic “Checkout v2: phone wallets and saved cards” (SYN-1), estimated at 2 points.",
      "Add the link “Wallet spec” (docs.example.com) to the new story “Pay with a phone wallet at the kiosk”.",
      "Add the link “Countdown spec” (“javascript://docs.example.com/%0aalert(1)”) to “🚢 Show a countdown to departure on the home screen” (SYN-13).",
      `Change the estimate of ${declined} (SYN-21) from 5 points to 8 points.`,
      "Rename “運航状況のプッシュ通知を日本語で送る” (SYN-31) to “運航状況のプッシュ通知を日本語と英語で送る”.",
      "Rewrite the description of “Cache the winter timetable on the device” (SYN-103).",
      "SYN-27 is no longer in Jira, so this change can't be made.",
    ],
  );
  assert.deepEqual(nth(diff.lines, 0).fields, [{ name: "points", before: 2, after: 5 }]);
  assert.ok(String(nth(nth(diff.lines, 8).fields, 0).before).length > 10_000);
  assert.equal(diff.hash, set.hash);
});

test("a diff's hash is the hash of the rows it rendered, even when an edit lands meanwhile", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const mutationId = nth(set.mutations, 0).id;
  jira.hooks.read = async () => {
    jira.hooks.read = undefined;
    await changeSets.edit(set.id, { set: [{ mutationId, args: { points: 13 } }] });
  };
  const diff = await changeSets.diff(set.id);
  assert.equal(
    nth(diff.lines, 0).sentence,
    `Change the estimate of ${declined} (SYN-21) from 2 points to 5 points.`,
  );
  assert.equal(diff.hash, set.hash);
  await assert.rejects(
    changeSets.decide(set.id, "approved", { via: "thread", by: "pm" }, diff.hash),
    { code: "stale" },
  );
});

test("an edit changes the derived hash", async () => {
  const { changeSets, run, events } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-117", 2),
  ]);
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
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
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

test("a diff after an approval leaves the preview the person approved", async () => {
  const { changeSets, run, jira, db } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const mutationId = nth(set.mutations, 0).id;
  await approve(changeSets, set.id);
  assert.deepEqual(preview(db, mutationId), { points: 2 });
  jira.edit("SYN-21", { points: 8 });
  await changeSets.diff(set.id);
  assert.deepEqual(preview(db, mutationId), { points: 2 });
});

test("a diff after a rejection is recorded", async () => {
  const { changeSets, run, jira, db } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const mutationId = nth(set.mutations, 0).id;
  const shown = await changeSets.diff(set.id);
  await changeSets.decide(set.id, "rejected", { via: "thread", by: "pm" }, shown.hash);
  jira.edit("SYN-21", { points: 8 });
  await changeSets.diff(set.id);
  assert.deepEqual(preview(db, mutationId), { points: 8 });
});

test("an approval needs a diff shown since the last edit", async () => {
  const { changeSets, run, db } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const thread = { via: "thread", by: "pm" } as const;
  await assert.rejects(changeSets.decide(set.id, "approved", thread, set.hash), {
    code: "refused",
  });

  await changeSets.diff(set.id);
  const edited = await changeSets.edit(set.id, {
    set: [{ mutationId: nth(set.mutations, 0).id, args: { points: 8 } }],
  });
  await assert.rejects(changeSets.decide(set.id, "approved", thread, edited.hash), {
    code: "refused",
  });
  assert.equal(count(db, "decisions"), 0);
  await changeSets.diff(set.id);
  const approved = await changeSets.decide(set.id, "approved", thread, edited.hash);
  assert.equal(approved.decision?.kind, "approved");
});

test("an edit after approval voids it: apply refuses and writes nothing", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const approved = await approve(changeSets, set.id);
  assert.equal(approved.decision?.kind, "approved");
  const edited = await changeSets.edit(set.id, {
    set: [{ mutationId: nth(set.mutations, 0).id, args: { points: 40 } }],
  });
  assert.equal(edited.decision, null);
  await assert.rejects(changeSets.apply(set.id), { code: "not-approved" });
  assert.deepEqual(jira.calls, []);
  assert.equal(jira.issue("SYN-21")?.points, 2);
});

test("an edit during apply stops every write after it", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-117", 2),
  ]);
  await approve(changeSets, set.id);
  jira.hooks.after = async (_request, call) => {
    if (call !== 1) return;
    await changeSets.edit(set.id, {
      set: [{ mutationId: nth(set.mutations, 1).id, args: { points: 13 } }],
    });
  };
  await assert.rejects(changeSets.apply(set.id), { code: "not-approved" });
  assert.equal(jira.calls.length, 1);
  assert.equal(jira.issue("SYN-21")?.points, 5);
  assert.equal(jira.issue("SYN-117")?.points, null);
});

test("the mutation being written can't be edited or removed", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-117", 2),
  ]);
  const mutationId = nth(set.mutations, 0).id;
  await approve(changeSets, set.id);
  const outcome = (edit: Promise<unknown>) =>
    edit.then(
      () => "edited",
      (error: unknown) => (error instanceof Error && "code" in error ? error.code : error),
    );
  const attempts: Promise<unknown>[] = [];
  jira.hooks.before = (_request, call) => {
    if (call !== 1) return;
    attempts.push(
      outcome(changeSets.edit(set.id, { set: [{ mutationId, args: { points: 40 } }] })),
      outcome(changeSets.edit(set.id, { remove: [mutationId] })),
    );
  };
  const report = await changeSets.apply(set.id);
  assert.deepEqual(await Promise.all(attempts), ["refused", "refused"]);
  assert.deepEqual(report.applied, [mutationId, nth(set.mutations, 1).id]);
  assert.equal(jira.issue("SYN-21")?.points, 5);
});

test("a write that lands after its row vanished is an error, not a silent success", async () => {
  const { changeSets, run, jira, db } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const mutationId = nth(set.mutations, 0).id;
  await approve(changeSets, set.id);
  // Another process removes the row while the write is in flight.
  jira.hooks.before = () => {
    db.prepare("delete from mutations where id = ?").run(mutationId);
  };
  await assert.rejects(changeSets.apply(set.id), /landed in the source/);
});

test("an edit from another instance during the write isn't recorded as applied", async () => {
  const { changeSets, instance, run, jira, db } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const mutationId = nth(set.mutations, 0).id;
  await approve(changeSets, set.id);
  const elsewhere = instance();
  jira.hooks.after = async () => {
    await elsewhere.edit(set.id, { set: [{ mutationId, args: { points: 40 } }] });
  };
  await assert.rejects(changeSets.apply(set.id), /landed in the source/);
  assert.equal(status(db, mutationId), "pending");
});

test("apply replays exactly the captured arguments, in seq order", async () => {
  const { changeSets, run, jira, events } = setup();
  const set = await changeSets.capture(run, [
    {
      op: "setSummary",
      target: "jira:SYN-117",
      ref: null,
      args: { summary: "Waitlist for the next sailing" },
    },
    estimate("jira:SYN-21", 5),
    {
      op: "setDescription",
      target: "jira:SYN-8",
      ref: null,
      args: { description: "Say which card failed." },
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
  // Once applied, a line shows what Jira reported, without its update time.
  const shown = await changeSets.diff(set.id);
  assert.deepEqual(nth(shown.lines, 1).fields, [{ name: "points", before: 2, after: 5 }]);
  const again = await changeSets.apply(set.id);
  assert.deepEqual(
    again.skipped,
    set.mutations.map((m) => m.id),
  );
  assert.equal(jira.calls.length, 3);
});

test("apply stops at the first failure, so a retry keeps seq order", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-21", 8),
  ]);
  const first = nth(set.mutations, 0).id;
  const second = nth(set.mutations, 1).id;
  await approve(changeSets, set.id);
  jira.hooks.before = (_request, call) => {
    if (call === 1) throw new Error("503: Jira is busy");
  };
  const report = await changeSets.apply(set.id);
  assert.deepEqual(report.applied, []);
  assert.deepEqual(
    report.failed.map((f) => f.mutationId),
    [first],
  );
  assert.equal(jira.calls.length, 1);

  jira.hooks.before = undefined;
  const retry = await changeSets.apply(set.id);
  assert.deepEqual(retry.applied, [first, second]);
  assert.equal(jira.issue("SYN-21")?.points, 8);
});

test("a create that failed may have landed, so it is never sent again", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [
    story("new:1", "Pay with a phone wallet at the kiosk", "jira:SYN-1"),
    estimate("new:1", 3),
    estimate("jira:SYN-21", 5),
  ]);
  const create = nth(set.mutations, 0).id;
  const dependent = nth(set.mutations, 1).id;
  const other = nth(set.mutations, 2).id;
  await approve(changeSets, set.id);
  // The story lands, then the answer is lost.
  jira.hooks.after = (_request, call) => {
    if (call === 1) throw new Error("timed out");
  };
  const report = await changeSets.apply(set.id);
  assert.match(nth(report.failed, 0).error, /may have been made in Jira: check, then remove it/);
  jira.hooks.after = undefined;

  const retry = await changeSets.apply(set.id);
  assert.deepEqual(
    retry.failed.map((f) => f.mutationId),
    [create],
  );
  assert.equal(jira.calls.length, 1);
  assert.deepEqual(jira.created, ["SYN-900"]);

  await changeSets.edit(set.id, { remove: [create, dependent] });
  await approve(changeSets, set.id);
  const rest = await changeSets.apply(set.id);
  assert.deepEqual(rest.applied, [other]);
  assert.deepEqual(jira.created, ["SYN-900"]);
});

test("a line shown as gone stays gone until an edit, so apply doesn't send it", async () => {
  const { changeSets, run, jira, db } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const mutationId = nth(set.mutations, 0).id;
  jira.hide("SYN-21");
  await changeSets.diff(set.id);
  jira.show("SYN-21");
  // The approver's own render shows the item back, but the earlier one stands.
  await approve(changeSets, set.id);
  assert.deepEqual(preview(db, mutationId), { $gone: true });

  const report = await changeSets.apply(set.id);
  assert.match(nth(report.failed, 0).error, /was gone when reviewed/);
  assert.deepEqual(jira.calls, []);
  assert.equal(jira.issue("SYN-21")?.points, 2);
  // Nothing was sent, so the row stays pending and is checked again next time.
  assert.equal(status(db, mutationId), "pending");
});

test("NewRef chains resolve to the items earlier creates made", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [
    story("new:1", "Pay with a phone wallet at the kiosk", "jira:SYN-1"),
    story("new:2", "Email a wallet receipt", "jira:SYN-1"),
    estimate("new:1", 3),
    link("new:2", "https://docs.example.com/receipts", "Receipt spec"),
    { op: "setAssignee", target: "new:1", ref: null, args: { accountId: "amara" } },
  ]);
  await approve(changeSets, set.id);
  const report = await changeSets.apply(set.id);
  assert.deepEqual(report.failed, []);
  assert.deepEqual(jira.created, ["SYN-900", "SYN-901"]);
  assert.deepEqual(
    jira.calls.map((c) => c.target),
    [null, null, "jira:SYN-900", "jira:SYN-901", "jira:SYN-900"],
  );
  assert.equal(jira.issue("SYN-900")?.points, 3);
  assert.equal(jira.issue("SYN-900")?.accountId, "amara");
  assert.equal(jira.issue("SYN-901")?.links.length, 1);
});

test("after a crash, apply resumes and skips what already landed", async () => {
  const { changeSets, instance, run, jira } = setup();
  const set = await changeSets.capture(run, [
    story("new:1", "Pay with a phone wallet at the kiosk", "jira:SYN-1"),
    estimate("jira:SYN-21", 5),
    estimate("new:1", 3),
    estimate("jira:SYN-117", 2),
  ]);
  await approve(changeSets, set.id);
  const ids = set.mutations.map((m) => m.id);

  // The process dies during the second write, before it lands.
  const reached = Promise.withResolvers<void>();
  jira.hooks.before = (_request, call) => {
    if (call !== 2) return;
    reached.resolve();
    return new Promise<void>(() => {});
  };
  void changeSets.apply(set.id);
  await reached.promise;
  jira.hooks.before = undefined;

  // The new process resolves new:1 from the stored result of the create.
  const report = await instance().apply(set.id);
  assert.deepEqual(report.skipped, ids.slice(0, 1));
  assert.deepEqual(report.applied, ids.slice(1));
  assert.deepEqual(
    jira.calls.map((c) => [c.op, c.target]),
    [
      ["createStory", null],
      ["setEstimate", "jira:SYN-21"],
      ["setEstimate", "jira:SYN-21"],
      ["setEstimate", "jira:SYN-900"],
      ["setEstimate", "jira:SYN-117"],
    ],
  );
  assert.deepEqual(jira.created, ["SYN-900"]);
  assert.equal(jira.issue("SYN-900")?.points, 3);
});

test("a crash after a create was sent leaves it blocked, not sent twice", async () => {
  const { changeSets, instance, run, jira, db } = setup();
  const set = await changeSets.capture(run, [
    story("new:1", "Pay with a phone wallet at the kiosk", "jira:SYN-1"),
    estimate("new:1", 3),
  ]);
  const create = nth(set.mutations, 0).id;
  await approve(changeSets, set.id);

  // The story lands, then the process dies before recording the answer.
  const reached = Promise.withResolvers<void>();
  jira.hooks.after = () => {
    reached.resolve();
    return new Promise<void>(() => {});
  };
  void changeSets.apply(set.id);
  await reached.promise;
  jira.hooks.after = undefined;

  const report = await instance().apply(set.id);
  assert.deepEqual(report.applied, []);
  assert.deepEqual(
    report.failed.map((f) => f.mutationId),
    [create],
  );
  assert.match(nth(report.failed, 0).error, /may have been made in Jira: check, then remove it/);
  assert.equal(status(db, create), "failed");
  assert.equal(jira.calls.length, 1);
  assert.deepEqual(jira.created, ["SYN-900"]);
});
