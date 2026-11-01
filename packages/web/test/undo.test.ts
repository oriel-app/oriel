import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type GroupModel,
  groupReplied,
  initGroup,
  latestUndo,
  undoMs,
  updateGroup,
} from "../src/group.ts";
import type { Effect, Replied } from "../src/http.ts";
import { init as initRoot, type Model, update as updateRoot } from "../src/root.ts";
import type { GroupView, MemberView } from "../src/view.ts";

const groupId = "01JBZ0000000000000000000G1";
const at = "2026-10-31T09:00:00.000Z";

const member = (key: string, inIndex = true): MemberView => ({
  ref: { id: `jira:${key}`, key, title: `Story ${key}`, url: null },
  row: inIndex
    ? {
        id: `jira:${key}`,
        key,
        title: `Story ${key}`,
        type: "Story",
        status: null,
        assignee: null,
        points: null,
        idleDays: 0,
      }
    : null,
});

const view = (version: number, members: MemberView[]): GroupView => ({
  group: {
    id: groupId,
    name: "Launch",
    origin: { kind: "picked" },
    version,
    size: members.length,
    createdAt: at,
    threads: { working: 0, done: 0, "handed-off": 0, dropped: 0 },
  },
  members,
  changes: [],
  threads: [],
});

const [a, b, c] = [member("OA-11"), member("OA-12"), member("OA-13")];

const replied = (tag: Replied["tag"], body: unknown, ok = true): Replied => ({
  type: "replied",
  tag,
  ok,
  body,
});
// The server's answer to removing `gone`, with the call that undoes it: none
// for an item the window no longer has.
const undoOf = (action: string, item: MemberView) => ({
  action,
  input: { group: groupId, items: [item.ref.id] },
});
const removed = (body: GroupView, gone: MemberView) =>
  replied(
    { kind: "groupChanged", id: groupId },
    { ...body, undo: gone.row ? undoOf("group.add", gone) : null },
  );
const restored = (back: MemberView) =>
  replied({ kind: "restored", id: groupId }, { undo: undoOf("group.remove", back) });
const addedBack = (item: MemberView) =>
  `POST /api/actions/group.add {"group":"${groupId}","items":["${item.ref.id}"]}`;

function loaded(members = [a, b, c], version = 3): GroupModel {
  const [model] = initGroup(groupId);
  return groupReplied(model, replied({ kind: "group", id: groupId }, view(version, members)))[0];
}

const requests = (effects: readonly Effect[]) =>
  effects.flatMap((e) =>
    e.type === "http" ? [`${e.method} ${e.url} ${JSON.stringify(e.body)}`] : [],
  );

test("× hides the item at once; its answer offers an undo that runs out after a few seconds", () => {
  const [removing, sent] = updateGroup(loaded(), { type: "memberRemoved", id: b.ref.id });
  assert.deepEqual(
    removing.removing.map((each) => each.id),
    [b.ref.id],
  );
  assert.deepEqual(requests(sent), [`POST /api/groups/${groupId}/remove {"items":["jira:OA-12"]}`]);
  const [shown, timers] = groupReplied(removing, removed(view(4, [a, c]), b));
  assert.deepEqual(shown.removing, []);
  assert.deepEqual(shown.removals, [
    { member: b, version: 4, countdown: 0, undo: undoOf("group.add", b) },
  ]);
  assert.deepEqual(timers, [
    {
      type: "after",
      ms: undoMs,
      msg: { type: "group", msg: { type: "undoExpired", groupId, version: 4, countdown: 0 } },
    },
  ]);
  assert.ok(undoMs >= 5_000 && undoMs <= 10_000, "a few seconds");
  const [gone] = updateGroup(shown, { type: "undoExpired", groupId, version: 4, countdown: 0 });
  assert.deepEqual(gone.removals, []);
});

test("undo adds the item back, as a new version the group's threads follow", () => {
  const [removing] = updateGroup(loaded(), { type: "memberRemoved", id: b.ref.id });
  const [shown] = groupReplied(removing, removed(view(4, [a, c]), b));
  const [undoing, sent] = updateGroup(shown, { type: "undoClicked", version: 4 });
  assert.deepEqual(undoing.removals, []);
  assert.deepEqual(requests(sent), [addedBack(b)]);
  // Once it lands, the group loads again. The server orders members by
  // item, so it's back where it was.
  const [, reload] = groupReplied(undoing, restored(b));
  assert.deepEqual(requests(reload), [`GET /api/groups/${groupId} undefined`]);
  const [back] = groupReplied(undoing, replied({ kind: "group", id: groupId }, view(5, [a, b, c])));
  assert.deepEqual(
    back.view?.members.map((each) => each.ref.key),
    ["OA-11", "OA-12", "OA-13"],
  );
  // The sidebar's counts move with it.
  const root: Model = { ...initRoot({ page: "group", id: groupId })[0], group: undoing };
  const [, reloads] = updateRoot(root, restored(b));
  assert.ok(requests(reloads).some((each) => each.startsWith("GET /api/groups ")));
  // Undone once is undone: a second click, or ⌘Z after it, sends nothing.
  assert.deepEqual(updateGroup(undoing, { type: "undoClicked", version: 4 })[1], []);
});

test("removals in a row go one at a time, and each can be undone", () => {
  let [model, sent] = updateGroup(loaded(), { type: "memberRemoved", id: a.ref.id });
  assert.equal(requests(sent).length, 1);
  // Clicked before the first answered: hidden now, sent once it has.
  [model, sent] = updateGroup(model, { type: "memberRemoved", id: c.ref.id });
  assert.deepEqual(sent, []);
  assert.deepEqual(
    model.removing.map((each) => each.id),
    [a.ref.id, c.ref.id],
  );
  // The same × twice is one removal.
  assert.deepEqual(updateGroup(model, { type: "memberRemoved", id: c.ref.id })[0], model);
  [model, sent] = groupReplied(model, removed(view(4, [b, c]), a));
  assert.deepEqual(requests(sent), [`POST /api/groups/${groupId}/remove {"items":["jira:OA-13"]}`]);
  [model] = groupReplied(model, removed(view(5, [b]), c));
  assert.deepEqual(
    model.removals.map((each) => [each.member.ref.key, each.version]),
    [
      ["OA-11", 4],
      ["OA-13", 5],
    ],
  );
  // ⌘Z takes the latest; the other stays undoable.
  assert.equal(latestUndo(model)?.version, 5);
  [model, sent] = updateGroup(model, { type: "undoClicked", version: 5 });
  assert.deepEqual(requests(sent), [addedBack(c)]);
  assert.equal(latestUndo(model)?.version, 4);
  [, sent] = updateGroup(model, { type: "undoClicked", version: 4 });
  assert.deepEqual(requests(sent), [addedBack(a)]);
});

test("a removal that fails comes back with why, and the next one still goes", () => {
  let [model] = updateGroup(loaded(), { type: "memberRemoved", id: a.ref.id });
  [model] = updateGroup(model, { type: "memberRemoved", id: b.ref.id });
  const [failed, sent] = groupReplied(
    model,
    replied(
      { kind: "groupChanged", id: groupId },
      { error: "jira:OA-11 isn't in this group" },
      false,
    ),
  );
  assert.equal(failed.notice, "jira:OA-11 isn't in this group");
  assert.deepEqual(failed.removals, []);
  assert.deepEqual(
    failed.removing.map((each) => each.id),
    [b.ref.id],
  );
  assert.deepEqual(requests(sent), [`POST /api/groups/${groupId}/remove {"items":["jira:OA-12"]}`]);
});

test("an undo that fails says why", () => {
  const [removing] = updateGroup(loaded(), { type: "memberRemoved", id: b.ref.id });
  const [shown] = groupReplied(removing, removed(view(4, [a, c]), b));
  const [undoing] = updateGroup(shown, { type: "undoClicked", version: 4 });
  const [failed] = groupReplied(
    undoing,
    replied({ kind: "restored", id: groupId }, { error: "jira:OA-12 isn't in the window" }, false),
  );
  assert.equal(failed.notice, "jira:OA-12 isn't in the window");
});

test("an item the window no longer has is removed with no undo", () => {
  const gone = member("OA-14", false);
  const [removing] = updateGroup(loaded([a, gone]), { type: "memberRemoved", id: gone.ref.id });
  const [shown] = groupReplied(removing, removed(view(4, [a]), gone));
  assert.equal(shown.removals.length, 1);
  assert.equal(latestUndo(shown), null);
  assert.deepEqual(updateGroup(shown, { type: "undoClicked", version: 4 })[1], []);
});

test("no undo runs out while the user is on them; let go of, each gets its full time again", () => {
  let [model] = updateGroup(loaded(), { type: "memberRemoved", id: b.ref.id });
  [model] = groupReplied(model, removed(view(4, [a, c]), b));
  [model] = updateGroup(model, { type: "undoHeld", by: "pointer", held: true });
  [model] = updateGroup(model, { type: "undoHeld", by: "focus", held: true });
  const expired = { type: "undoExpired", groupId, version: 4, countdown: 0 } as const;
  assert.equal(updateGroup(model, expired)[0].removals.length, 1);
  // The pointer leaving while the keyboard is still on them holds them.
  const [pointerOff, none] = updateGroup(model, { type: "undoHeld", by: "pointer", held: false });
  assert.deepEqual(none, []);
  assert.equal(updateGroup(pointerOff, expired)[0].removals.length, 1);
  const [released, timers] = updateGroup(pointerOff, {
    type: "undoHeld",
    by: "focus",
    held: false,
  });
  assert.deepEqual(timers, [
    {
      type: "after",
      ms: undoMs,
      msg: { type: "group", msg: { ...expired, countdown: 1 } },
    },
  ]);
  // Only the countdown that started last hides it, and only on its own group.
  assert.equal(updateGroup(released, expired)[0].removals.length, 1);
  assert.equal(
    updateGroup(released, { ...expired, countdown: 1, groupId: "01JBZ0000000000000000000G2" })[0]
      .removals.length,
    1,
  );
  assert.equal(updateGroup(released, { ...expired, countdown: 1 })[0].removals.length, 0);
  // Letting go of nothing held starts nothing.
  assert.deepEqual(updateGroup(released, { type: "undoHeld", by: "focus", held: false })[1], []);
});

test("undoing one lets go of the rest, as its Undo leaving may take the focus without a word", () => {
  let [model] = updateGroup(loaded(), { type: "memberRemoved", id: a.ref.id });
  [model] = groupReplied(model, removed(view(4, [b, c]), a));
  [model] = updateGroup(model, { type: "memberRemoved", id: b.ref.id });
  [model] = groupReplied(model, removed(view(5, [c]), b));
  [model] = updateGroup(model, { type: "undoHeld", by: "focus", held: true });
  const [undoing, effects] = updateGroup(model, { type: "undoClicked", version: 5 });
  assert.deepEqual(undoing.held, { pointer: false, focus: false });
  assert.deepEqual(
    effects.map((e) => (e.type === "after" ? e.msg : e.type)),
    ["http", { type: "group", msg: { type: "undoExpired", groupId, version: 4, countdown: 1 } }],
  );
});

test("an answer older than the view shown doesn't replace it", () => {
  const [removing] = updateGroup(loaded(), { type: "memberRemoved", id: b.ref.id });
  const [shown] = groupReplied(removing, removed(view(4, [a, c]), b));
  const [undoing] = updateGroup(shown, { type: "undoClicked", version: 4 });
  const [back] = groupReplied(undoing, replied({ kind: "group", id: groupId }, view(5, [a, b, c])));
  const [stale] = groupReplied(back, replied({ kind: "group", id: groupId }, view(4, [a, c])));
  assert.equal(stale.view?.group.version, 5);
});

test("a pointer still on the undos holds them through an Undo click", () => {
  let [model] = updateGroup(loaded(), { type: "memberRemoved", id: a.ref.id });
  [model] = groupReplied(model, removed(view(4, [b, c]), a));
  [model] = updateGroup(model, { type: "memberRemoved", id: b.ref.id });
  [model] = groupReplied(model, removed(view(5, [c]), b));
  [model] = updateGroup(model, { type: "undoHeld", by: "pointer", held: true });
  const [undoing, effects] = updateGroup(model, { type: "undoClicked", version: 5 });
  assert.deepEqual(
    effects.map((e) => e.type),
    ["http"],
  );
  const expired = { type: "undoExpired", groupId, version: 4, countdown: 0 } as const;
  assert.equal(updateGroup(undoing, expired)[0].removals.length, 1);
});

test("an answer that still holds the item waiting isn't its answer", () => {
  // The page opened again while an earlier removal was in flight: its late
  // answer still holds the item just removed here.
  const [removing] = updateGroup(loaded(), { type: "memberRemoved", id: c.ref.id });
  const [late, sent] = groupReplied(removing, removed(view(4, [b, c]), c));
  assert.deepEqual(sent, []);
  assert.deepEqual(
    late.removing.map((each) => each.id),
    [c.ref.id],
  );
  assert.deepEqual(late.removals, []);
  // Its own answer then lands.
  const [own] = groupReplied(late, removed(view(5, [b]), c));
  assert.deepEqual(
    own.removals.map((each) => [each.member.ref.key, each.version]),
    [["OA-13", 5]],
  );
});
