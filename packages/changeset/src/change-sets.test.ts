import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapturedMutation } from "@oriel/core";
import { workstreamStore } from "@oriel/db";
import { sendLeaseMs } from "./change-sets.ts";
import { approve, count, nth, preview, setup, status, t0 } from "./testing.ts";

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

test("a moved item stays in the region under its old handle and its new one", async () => {
  const { changeSets, run, indexPage, indexed } = setup();
  // SYN-21 and its epic SYN-1 move to another project; nothing takes their keys.
  indexPage([
    { ...indexed("SYN-21"), id: "jira:OPS-5" },
    { ...indexed("SYN-1"), id: "jira:OPS-1" },
  ]);
  for (const [target, epic] of [
    ["jira:SYN-21", "jira:SYN-1"],
    ["jira:OPS-5", "jira:OPS-1"],
  ] as const) {
    const set = await changeSets.capture(run, [
      estimate(target, 3),
      { op: "createStory", target: null, ref: null, args: { summary: "Wallets", epic } },
    ]);
    assert.equal(nth(set.mutations, 0).target, target);
  }
});

test("apply resolves a moved item's old handle the way capture did", async () => {
  const { changeSets, run, jira, indexPage, indexed } = setup();
  indexPage([{ ...indexed("SYN-21"), id: "jira:OPS-5" }]);
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  await approve(changeSets, set.id);
  // The value is already in place, so apply records it without sending,
  // which needs the item's stable ID from the old handle.
  jira.edit("SYN-21", { points: 5 });
  const report = await changeSets.apply(set.id);
  assert.deepEqual(report.applied, [nth(set.mutations, 0).id]);
  assert.deepEqual(jira.calls, []);
});

test("a handle reused by an item outside the region names that item and is refused", async () => {
  const { changeSets, run, indexPage, indexed } = setup();
  // SYN-21 moves away and an outside item takes its key; SYN-27 was deleted
  // and an outside item now has its key too.
  indexPage([
    { ...indexed("SYN-21"), id: "jira:OPS-5" },
    { ...indexed("SYN-14"), id: "jira:SYN-21", stableId: "99999" },
    { ...indexed("SYN-14"), id: "jira:SYN-27", stableId: "99998" },
  ]);
  for (const reused of ["jira:SYN-21", "jira:SYN-27"]) {
    await assert.rejects(
      changeSets.capture(run, [estimate(reused, 3)]),
      { code: "refused" },
      reused,
    );
    await assert.rejects(
      changeSets.capture(run, [
        { op: "createStory", target: null, ref: null, args: { summary: "x", epic: reused } },
      ]),
      { code: "refused" },
      reused,
    );
  }
  const set = await changeSets.capture(run, [estimate("jira:OPS-5", 3)]);
  assert.equal(nth(set.mutations, 0).target, "jira:OPS-5");
});

test("each write names the stable ID its target must have, and a create names none", async () => {
  const { changeSets, run, jira, indexed } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    story("new:1", "Pay with a phone wallet at the kiosk", "jira:SYN-1"),
    estimate("new:1", 2),
  ]);
  await approve(changeSets, set.id);
  await changeSets.apply(set.id);
  const made = jira.issue(jira.created[0] ?? "");
  assert.deepEqual(
    jira.calls.map((call) => [call.target, call.expectedStableId]),
    [
      ["jira:SYN-21", indexed("SYN-21").stableId],
      [null, null],
      [`jira:${made?.key}`, made?.id],
    ],
  );
});

test("an item removed from the workstream after capture is never written (decision 0018)", async () => {
  const { db, changeSets, run, jira, workstreamId, indexed } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const syn21 = { id: "jira:SYN-21" as const, stableId: indexed("SYN-21").stableId };
  workstreamStore(db).remove(workstreamId, [syn21], { kind: "user" }, t0);
  await approve(changeSets, set.id);
  await assert.rejects(changeSets.apply(set.id), { code: "refused" });
  // The row says why, as a stop partway through would.
  assert.ok((await changeSets.get(set.id))?.mutations[0]?.error);
  assert.deepEqual(jira.calls, []);
});

test("a set op that landed with its answer lost is recorded on retry, even after its item left the workstream", async () => {
  const { db, changeSets, run, jira, workstreamId, indexed } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const mutationId = nth(set.mutations, 0).id;
  await approve(changeSets, set.id);
  // The write lands; its answer doesn't.
  jira.hooks.after = () => {
    throw new Error("timed out");
  };
  assert.deepEqual((await changeSets.apply(set.id)).applied, []);
  jira.hooks.after = undefined;
  const syn21 = { id: "jira:SYN-21" as const, stableId: indexed("SYN-21").stableId };
  workstreamStore(db).remove(workstreamId, [syn21], { kind: "user" }, t0);
  const retry = await changeSets.apply(set.id);
  assert.deepEqual(retry.applied, [mutationId]);
  assert.equal(status(db, mutationId), "applied");
  // Recorded in place: nothing was sent again.
  assert.equal(jira.calls.length, 1);
});

test("a sent create stays blocked and unsent, even with stored arguments the catalogue no longer takes", async () => {
  const { db, changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [story("new:1", "Wallets", "jira:SYN-1")]);
  const mutationId = nth(set.mutations, 0).id;
  await approve(changeSets, set.id);
  jira.hooks.after = () => {
    throw new Error("timed out");
  };
  await changeSets.apply(set.id);
  jira.hooks.after = undefined;
  const error = () => db.prepare("select error from mutations where id = ?").get(mutationId)?.error;
  const sent = error();
  assert.ok(sent);
  db.prepare("update mutations set args = ? where id = ?").run(
    JSON.stringify({ summary: "", epic: "jira:SYN-1" }),
    mutationId,
  );
  // As if approved before the catalogue tightened: the approval matches these rows.
  const { hash } = await changeSets.diff(set.id);
  db.prepare("update decisions set hash = ? where change_set_id = ?").run(hash, set.id);
  await assert.rejects(changeSets.apply(set.id), {
    code: "refused",
  });
  assert.equal(error(), sent);
  assert.equal(jira.calls.length, 1);
});

test("a revert still reaches an item that left the workstream, and a new item is the set's own", async () => {
  const { db, changeSets, run, jira, workstreamId, indexed } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    story("new:1", "Wallets", null),
    estimate("new:1", 2),
  ]);
  await approve(changeSets, set.id);
  assert.equal((await changeSets.apply(set.id)).applied.length, 3);
  const syn21 = { id: "jira:SYN-21" as const, stableId: indexed("SYN-21").stableId };
  workstreamStore(db).remove(workstreamId, [syn21], { kind: "user" }, t0);
  const reverse = await changeSets.revert(set.id);
  assert.ok("id" in reverse);
  await approve(changeSets, reverse.id);
  const report = await changeSets.apply(reverse.id);
  assert.deepEqual(report.failed, []);
  assert.equal(jira.issue("SYN-21")?.points, 2);
});

test("stored arguments the catalogue no longer takes are not reverted", async () => {
  const { db, changeSets, run } = setup();
  const set = await changeSets.capture(run, [
    link("jira:SYN-1", "https://docs.example.com/wallets", "Wallet spec"),
  ]);
  await approve(changeSets, set.id);
  await changeSets.apply(set.id);
  // As an http link applied before Jira's catalogue took only https.
  db.prepare("update mutations set args = ? where id = ?").run(
    JSON.stringify({ url: "http://docs.example.com/wallets", title: "Wallet spec" }),
    nth(set.mutations, 0).id,
  );
  await assert.rejects(changeSets.revert(set.id), {
    code: "not-revertible",
  });
});

test("a key another item took after capture is never written", async () => {
  const { changeSets, run, jira, indexPage, indexed } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  await approve(changeSets, set.id);
  // SYN-21 moves away and an item outside the region takes its key.
  indexPage([
    { ...indexed("SYN-21"), id: "jira:OPS-5" },
    { ...indexed("SYN-14"), id: "jira:SYN-21", stableId: "99999" },
  ]);
  await assert.rejects(changeSets.apply(set.id), {
    code: "refused",
  });
  assert.deepEqual(jira.calls, []);
});

test("a link that isn't https is refused at capture, so it never reaches a diff", async () => {
  const { changeSets, run, db } = setup();
  await assert.rejects(
    changeSets.capture(run, [
      link("jira:SYN-13", "javascript://docs.example.com/%0aalert(1)", "Countdown spec"),
    ]),
    { code: "invalid" },
  );
  assert.equal(count(db, "change_sets"), 0);
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
  assert.deepEqual(nth(diff.lines, 0).fields, [{ name: "points", before: 2, after: 5 }]);
  assert.equal(diff.hash, set.hash);
  await assert.rejects(
    changeSets.decide(set.id, "approved", { via: "thread", by: "pm" }, diff.hash),
    { code: "stale" },
  );
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

test("a change whose item couldn't be read can't be approved until a render reads it", async () => {
  const { changeSets, run, jira, db } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const mutationId = nth(set.mutations, 0).id;
  jira.hide("SYN-21");
  await assert.rejects(approve(changeSets, set.id), {
    code: "refused",
  });
  assert.deepEqual(preview(db, mutationId), { $gone: true });

  // The latest render reads it again, and that is what approval goes by.
  jira.show("SYN-21");
  await approve(changeSets, set.id);
  assert.deepEqual(preview(db, mutationId), { points: 2 });
  const report = await changeSets.apply(set.id);
  assert.deepEqual(report.applied, [mutationId]);
  assert.equal(jira.issue("SYN-21")?.points, 5);
});

test("apply itself won't send a row with no preview or one shown as gone", async () => {
  for (const shown of [null, JSON.stringify({ $gone: true })]) {
    const { changeSets, run, jira, db } = setup();
    const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
    const mutationId = nth(set.mutations, 0).id;
    await approve(changeSets, set.id);
    // Past approval's own checks, as a bug or a hand-edited database might.
    db.prepare("update mutations set preview = ? where id = ?").run(shown, mutationId);
    await assert.rejects(changeSets.apply(set.id), { code: "refused" }, String(shown));
    assert.deepEqual(jira.calls, []);
    assert.equal(status(db, mutationId), "pending");
  }
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

test("an edit after approval from outside the engine stops every write after it", async () => {
  const { changeSets, run, jira, db } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-117", 2),
  ]);
  await approve(changeSets, set.id);
  // The engine refuses edits while it applies; a row rewritten behind its
  // back still voids the approval.
  jira.hooks.after = (_request, call) => {
    if (call !== 1) return;
    db.prepare("update mutations set args = ? where id = ?").run(
      '{"points":13}',
      nth(set.mutations, 1).id,
    );
  };
  await assert.rejects(changeSets.apply(set.id), { code: "not-approved" });
  assert.equal(jira.calls.length, 1);
  assert.equal(jira.issue("SYN-21")?.points, 5);
  assert.equal(jira.issue("SYN-117")?.points, null);
});

test("a result isn't recorded on a row whose arguments changed during the send", async () => {
  const { changeSets, run, jira, db } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const mutationId = nth(set.mutations, 0).id;
  await approve(changeSets, set.id);
  // Something outside the engine rewrites the row while the write is out.
  jira.hooks.after = () => {
    db.prepare("update mutations set args = ? where id = ?").run('{"points":40}', mutationId);
  };
  await assert.rejects(changeSets.apply(set.id));
  assert.equal(status(db, mutationId), "failed");
});

test("a sent row can be removed but not edited", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    estimate("jira:SYN-117", 2),
  ]);
  const sent = nth(set.mutations, 0).id;
  await approve(changeSets, set.id);
  jira.hooks.after = () => {
    throw new Error("timed out");
  };
  await changeSets.apply(set.id);
  jira.hooks.after = undefined;
  await assert.rejects(
    changeSets.edit(set.id, { set: [{ mutationId: sent, args: { points: 40 } }] }),
    { code: "refused" },
  );
  const removed = await changeSets.edit(set.id, { remove: [sent] });
  assert.deepEqual(
    removed.mutations.map((m) => m.target),
    ["jira:SYN-117"],
  );
});

test("of two instances that both sent a row, only the later mark records it", async () => {
  const { changeSets, instance, run, jira, db, advance } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const mutationId = nth(set.mutations, 0).id;
  await approve(changeSets, set.id);
  const elsewhere = instance();

  // This instance marks its send, which then takes longer than the lease.
  // Another instance marks the row again and starts its own send; then this
  // one lands first.
  const otherMarked = Promise.withResolvers<void>();
  const releaseOther = Promise.withResolvers<void>();
  let other: Promise<unknown> | undefined;
  jira.hooks.before = async (_request, call) => {
    if (call === 1) {
      advance(sendLeaseMs);
      other = elsewhere.apply(set.id);
      await otherMarked.promise;
      return;
    }
    otherMarked.resolve();
    await releaseOther.promise;
  };
  await assert.rejects(changeSets.apply(set.id));
  releaseOther.resolve();
  const report = await other;
  assert.deepEqual(report, { changeSetId: set.id, applied: [mutationId], skipped: [], failed: [] });
  assert.equal(status(db, mutationId), "applied");
  assert.equal(jira.calls.length, 2);
  // The instance that recorded it saw the row already sent, so the source's
  // "before" may be Oriel's own write: a revert can't restore it, and isn't
  // offered.
  assert.deepEqual(await changeSets.nextSteps(set.id), []);
  await assert.rejects(changeSets.revert(set.id), {
    code: "not-revertible",
  });
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
  // Nothing is left to apply, so applying again is refused.
  await assert.rejects(changeSets.apply(set.id), { code: "refused" });
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
  assert.ok(nth(report.failed, 0).error);
  jira.hooks.after = undefined;

  await assert.rejects(changeSets.apply(set.id), {
    code: "refused",
  });
  assert.equal(jira.calls.length, 1);
  assert.deepEqual(jira.created, ["SYN-900"]);

  await changeSets.edit(set.id, { remove: [create, dependent] });
  await approve(changeSets, set.id);
  const rest = await changeSets.apply(set.id);
  assert.deepEqual(rest.applied, [other]);
  assert.deepEqual(jira.created, ["SYN-900"]);
});

test("a story can go in an epic the same change set creates, and is reverted before it", async () => {
  const { changeSets, run, jira } = setup();
  const set = await changeSets.capture(run, [
    { op: "createEpic", target: null, ref: "new:1", args: { summary: "Kiosk wallets" } },
    story("new:2", "Pay with a phone wallet at the kiosk", "new:1"),
    // A title that reads like a ref stays a title.
    story("new:3", "new:1", "new:1"),
  ]);
  // Only the epic is marked as an item made above, not a title that reads like one.
  const fields = nth((await changeSets.diff(set.id)).lines, 2).fields;
  assert.deepEqual(
    fields.map((f) => [f.name, f.after, f.createdAbove ?? false]),
    [
      ["summary", "new:1", false],
      ["epic", "new:1", true],
    ],
  );
  // Nor can an edit put a story in another new story.
  await assert.rejects(
    changeSets.edit(set.id, {
      set: [{ mutationId: nth(set.mutations, 2).id, args: { summary: "x", epic: "new:2" } }],
    }),
    { code: "refused" },
  );
  await approve(changeSets, set.id);
  assert.deepEqual((await changeSets.apply(set.id)).failed, []);
  assert.deepEqual(jira.created, ["SYN-900", "SYN-901", "SYN-902"]);
  assert.equal(jira.issue("SYN-901")?.epic, "jira:SYN-900");
  assert.equal(jira.issue("SYN-902")?.epic, "jira:SYN-900");
  assert.equal(jira.issue("SYN-902")?.summary, "new:1");
  // A new epic must come first, and a new story can't hold another.
  await assert.rejects(
    changeSets.capture(run, [
      story("new:1", "Gate change sounds", "new:2"),
      { op: "createEpic", target: null, ref: "new:2", args: { summary: "Gate changes" } },
    ]),
    { code: "invalid" },
  );
  // What was approved is kept as it was captured.
  const stored = await changeSets.get(set.id);
  assert.deepEqual(nth(stored?.mutations ?? [], 1).args, {
    summary: "Pay with a phone wallet at the kiosk",
    epic: "new:1",
  });

  const reverse = await changeSets.revert(set.id);
  assert.ok("id" in reverse);
  await approve(changeSets, reverse.id);
  assert.deepEqual((await changeSets.apply(reverse.id)).failed, []);
  assert.deepEqual(
    jira.calls.slice(3).map((call) => [call.op, call.target]),
    [
      ["deleteItem", "jira:SYN-902"],
      ["deleteItem", "jira:SYN-901"],
      ["deleteItem", "jira:SYN-900"],
    ],
  );
});

test("after a crash, apply resumes and skips what already landed", async () => {
  const { changeSets, instance, run, jira, advance } = setup();
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

  // Within the send's lease the new process won't send it again: it may
  // still be on its way. After the lease it resumes, and resolves new:1 from
  // the stored result of the create.
  const restarted = instance();
  await assert.rejects(restarted.apply(set.id), { code: "refused" });
  assert.equal(jira.calls.length, 2);
  advance(sendLeaseMs);
  const report = await restarted.apply(set.id);
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

test("a crash while a create is being sent leaves it blocked, even if it never landed", async () => {
  const { changeSets, instance, run, jira, db } = setup();
  const set = await changeSets.capture(run, [
    story("new:1", "Pay with a phone wallet at the kiosk", "jira:SYN-1"),
  ]);
  const create = nth(set.mutations, 0).id;
  await approve(changeSets, set.id);

  // The process dies with the request on its way out.
  const reached = Promise.withResolvers<void>();
  jira.hooks.before = () => {
    reached.resolve();
    return new Promise<void>(() => {});
  };
  void changeSets.apply(set.id);
  await reached.promise;
  jira.hooks.before = undefined;

  await assert.rejects(instance().apply(set.id), { code: "refused" });
  assert.equal(status(db, create), "failed");
  assert.equal(jira.calls.length, 1);
  assert.deepEqual(jira.created, []);
});

test("a send another instance started meanwhile isn't repeated or reset", async () => {
  const { changeSets, instance, run, jira, db } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const mutationId = nth(set.mutations, 0).id;
  await approve(changeSets, set.id);
  const elsewhere = instance();

  // While this apply checks whether the value is already in place, another
  // instance sends the same row and is still waiting on Jira.
  const sentElsewhere = Promise.withResolvers<void>();
  jira.hooks.read = async () => {
    jira.hooks.read = undefined;
    jira.hooks.before = () => {
      sentElsewhere.resolve();
      return new Promise<void>(() => {});
    };
    void elsewhere.apply(set.id);
    await sentElsewhere.promise;
  };
  const report = await changeSets.apply(set.id);
  assert.ok(nth(report.failed, 0).error);
  assert.equal(jira.calls.length, 1);
  assert.equal(status(db, mutationId), "failed");
});
