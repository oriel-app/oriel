import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapturedMutation } from "@oriel/core";
import { groupStore } from "@oriel/db";
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

test("an assignee is the field the Jira writer reports, `assignee`", async () => {
  const { changeSets, run } = setup();
  const set = await changeSets.capture(run, [
    { op: "setAssignee", target: "jira:SYN-21", ref: null, args: { accountId: "amara" } },
  ]);
  const diff = await changeSets.diff(set.id);
  assert.deepEqual(nth(diff.lines, 0).fields, [
    { name: "assignee", before: "dara", after: "amara" },
  ]);
});

test("an item removed from the group after capture is never written (decision 0018)", async () => {
  const { db, changeSets, run, jira, groupId, indexed } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const syn21 = { id: "jira:SYN-21" as const, stableId: indexed("SYN-21").stableId };
  groupStore(db).remove(groupId, [syn21], { kind: "user" }, t0);
  await approve(changeSets, set.id);
  const report = await changeSets.apply(set.id);
  assert.deepEqual(report.applied, []);
  assert.match(
    nth(report.failed, 0).error,
    /^SYN-21 was removed from the group after this was captured, so it wasn't sent\.$/,
  );
  assert.deepEqual(jira.calls, []);
});

test("a set op that landed with its answer lost is recorded on retry, even after its item left the group", async () => {
  const { db, changeSets, run, jira, groupId, indexed } = setup();
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
  groupStore(db).remove(groupId, [syn21], { kind: "user" }, t0);
  const retry = await changeSets.apply(set.id);
  assert.deepEqual(retry.applied, [mutationId]);
  assert.equal(status(db, mutationId), "applied");
  // Recorded in place: nothing was sent again.
  assert.equal(jira.calls.length, 1);
});

test("a sent create keeps its own message, even with stored arguments the catalogue no longer takes", async () => {
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
  assert.match(String(sent), /may have been made in Jira/);
  db.prepare("update mutations set args = ? where id = ?").run(
    JSON.stringify({ summary: "", epic: "jira:SYN-1" }),
    mutationId,
  );
  // As if approved before the catalogue tightened: the approval matches these rows.
  const { hash } = await changeSets.diff(set.id);
  db.prepare("update decisions set hash = ? where change_set_id = ?").run(hash, set.id);
  const retry = await changeSets.apply(set.id);
  assert.deepEqual(retry.failed, [{ mutationId, error: sent }]);
  assert.equal(error(), sent);
  assert.equal(jira.calls.length, 1);
});

test("a revert still reaches an item that left the group, and a new item is the set's own", async () => {
  const { db, changeSets, run, jira, groupId, indexed } = setup();
  const set = await changeSets.capture(run, [
    estimate("jira:SYN-21", 5),
    story("new:1", "Wallets", null),
    estimate("new:1", 2),
  ]);
  await approve(changeSets, set.id);
  assert.equal((await changeSets.apply(set.id)).applied.length, 3);
  const syn21 = { id: "jira:SYN-21" as const, stableId: indexed("SYN-21").stableId };
  groupStore(db).remove(groupId, [syn21], { kind: "user" }, t0);
  const reverse = await changeSets.revert(set.id);
  assert.ok("id" in reverse);
  await approve(changeSets, reverse.id);
  const report = await changeSets.apply(reverse.id);
  assert.deepEqual(report.failed, []);
  assert.equal(jira.issue("SYN-21")?.points, 2);
});

test("stored arguments the catalogue no longer takes are shown as such, and not reverted", async () => {
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
    message: /not revertible: stored arguments no longer valid/,
  });
  const diff = await changeSets.diff(set.id);
  assert.match(nth(diff.lines, 0).sentence, /stored arguments are no longer valid/);
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
  const report = await changeSets.apply(set.id);
  assert.deepEqual(report.applied, []);
  assert.match(
    nth(report.failed, 0).error,
    /SYN-21 no longer names an item in the region this change was made in/,
  );
  assert.deepEqual(jira.calls, []);
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
    link("jira:SYN-13", "https://docs.example.com@links.example.net/countdown", "Countdown spec"),
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
      "Add the link “Countdown spec” (links.example.net) to “🚢 Show a countdown to departure on the home screen” (SYN-13).",
      `Change the estimate of ${declined} (SYN-21) from 5 points to 8 points.`,
      "Rename “運航状況のプッシュ通知を日本語で送る” (SYN-31) to “運航状況のプッシュ通知を日本語と英語で送る”.",
      "Rewrite the description of “Cache the winter timetable on the device” (SYN-103).",
      "SYN-27 is no longer in Jira, so this change can't be made.",
    ],
  );
  assert.deepEqual(nth(diff.lines, 0).fields, [{ name: "points", before: 2, after: 5 }]);
  assert.ok(String(nth(nth(diff.lines, 8).fields, 0).before).length > 10_000);
  assert.equal(diff.hash, set.hash);
  // Jira's catalogue takes only https links, so this one never reaches a diff.
  await assert.rejects(
    changeSets.capture(run, [
      link("jira:SYN-13", "javascript://docs.example.com/%0aalert(1)", "Countdown spec"),
    ]),
    { code: "invalid", message: /https URL/ },
  );
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

test("an edit that changes nothing leaves the approval and the previews standing", async () => {
  const { changeSets, run, jira, db, events } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const mutationId = nth(set.mutations, 0).id;
  await approve(changeSets, set.id);
  const same = await changeSets.edit(set.id, { set: [{ mutationId, args: { points: 5 } }] });
  assert.equal(same.hash, set.hash);
  assert.equal(same.decision?.kind, "approved");
  assert.deepEqual(preview(db, mutationId), { points: 2 });
  assert.equal(events.filter((e) => e.name === "changeset.edited").length, 0);
  const report = await changeSets.apply(set.id);
  assert.deepEqual(report.applied, [mutationId]);
  assert.equal(jira.issue("SYN-21")?.points, 5);
});

test("a change whose item couldn't be read can't be approved until a render reads it", async () => {
  const { changeSets, run, jira, db } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const mutationId = nth(set.mutations, 0).id;
  jira.hide("SYN-21");
  await assert.rejects(approve(changeSets, set.id), {
    code: "refused",
    message:
      "SYN-21 couldn't be read when this was last reviewed: remove that change, or review it again once it can be read",
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
    const report = await changeSets.apply(set.id);
    assert.deepEqual(
      report.failed.map((f) => f.mutationId),
      [mutationId],
      String(shown),
    );
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

test("a result isn't recorded on a row whose arguments changed during the send", async () => {
  const { changeSets, run, jira, db } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const mutationId = nth(set.mutations, 0).id;
  await approve(changeSets, set.id);
  // Something outside the engine rewrites the row while the write is out.
  jira.hooks.after = () => {
    db.prepare("update mutations set args = ? where id = ?").run('{"points":40}', mutationId);
  };
  await assert.rejects(changeSets.apply(set.id), /landed in the source/);
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
    { code: "refused", message: /this change may already be in Jira: check, then remove it/ },
  );
  const removed = await changeSets.edit(set.id, { remove: [sent] });
  assert.deepEqual(
    removed.mutations.map((m) => m.target),
    ["jira:SYN-117"],
  );
});

test("a send still unanswered isn't repeated by another instance within its lease", async () => {
  const { changeSets, instance, run, jira, db } = setup();
  const set = await changeSets.capture(run, [estimate("jira:SYN-21", 5)]);
  const mutationId = nth(set.mutations, 0).id;
  await approve(changeSets, set.id);
  let other: unknown;
  jira.hooks.before = async (_request, call) => {
    if (call === 1) other = await instance().apply(set.id);
  };
  const report = await changeSets.apply(set.id);
  assert.deepEqual(report.applied, [mutationId]);
  assert.match(
    String((other as { failed: { error: string }[] }).failed[0]?.error),
    /it may still be on its way/,
  );
  assert.equal(jira.calls.length, 1);
  assert.equal(status(db, mutationId), "applied");
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
  await assert.rejects(changeSets.apply(set.id), /landed in the source/);
  releaseOther.resolve();
  const report = await other;
  assert.deepEqual(report, { changeSetId: set.id, applied: [mutationId], skipped: [], failed: [] });
  assert.equal(status(db, mutationId), "applied");
  assert.equal(jira.calls.length, 2);
  // The instance that recorded it saw the row already sent, so the source's
  // "before" may be Oriel's own write: a revert reports it, not restores it.
  const result = await changeSets.revert(set.id);
  assert.ok("conflicts" in result);
  assert.deepEqual(
    result.conflicts.map((c) => [c.target, c.field, c.expected]),
    [["jira:SYN-21", "points", undefined]],
  );
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
  const early = await restarted.apply(set.id);
  assert.match(nth(early.failed, 0).error, /it may still be on its way/);
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

  const report = await instance().apply(set.id);
  assert.deepEqual(
    report.failed.map((f) => f.mutationId),
    [create],
  );
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
  assert.match(nth(report.failed, 0).error, /Another apply is sending this change/);
  assert.equal(jira.calls.length, 1);
  assert.equal(status(db, mutationId), "failed");
  assert.match(
    String(db.prepare("select error from mutations where id = ?").get(mutationId)?.error),
    /^Sent to Jira, with no answer recorded yet/,
  );
});
