// An add from the panel keeps its line and Undo (OA-149): stepping away and
// back shows them again, for as long as the add can be undone, and Undo goes
// the one way every Undo does. Once the item is removed some other way, the
// line goes.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect } from "../src/http.ts";
import { init, type Model, type Msg, update } from "../src/root.ts";
import type { Route } from "../src/route.ts";
import { itemRef, memberView, threadView, workstreamSummary, workstreamView } from "../testing.ts";

const workstream = "01JBZ0000000000000000000G1";
const list = ["jira:SYN-1", "jira:SYN-2", "jira:SYN-3"];
const undo = { action: "workstream.remove", input: { workstream, items: ["jira:SYN-2"] } };
const added = { workstreamId: workstream, name: "Fares", undo };

const gets = (effects: readonly Effect[]) =>
  effects.flatMap((effect) =>
    effect.type === "http" && effect.method === "GET" ? [effect.url] : [],
  );

// Runs each message in turn, then each navigate it asks for, as the browser
// would.
function run(model: Model, ...msgs: Msg[]): [Model, Effect[]] {
  return msgs.reduce<[Model, Effect[]]>(
    ([at, all], msg) => {
      const [next, effects] = update(at, msg);
      return effects.reduce<[Model, Effect[]]>(
        ([now, sent], effect) => {
          if (effect.type !== "navigate") return [now, [...sent, effect]];
          const [routed, more] = update(now, { type: "routed", route: effect.route });
          return [routed, [...sent, effect, ...more]];
        },
        [next, all],
      );
    },
    [model, []],
  );
}

const posts = (effects: readonly Effect[]) =>
  effects.flatMap((effect) =>
    effect.type === "http" && effect.method === "POST" && effect.tag.kind !== "telemetry"
      ? [effect.url]
      : [],
  );

const view = (version: number, ids: string[]) =>
  workstreamView({
    workstream: workstreamSummary({ id: workstream, name: "Fares", version }),
    members: ids.map((id) => memberView({ ref: itemRef({ id }) })),
  });

const opened = (route: Route): Model =>
  run(init(route)[0], { type: "itemOpened", id: "jira:SYN-2", list })[0];

const add: Msg = {
  type: "panel",
  msg: { type: "addClicked", workstream: { id: workstream, name: "Fares" } },
};
const addTag = {
  kind: "panelAdded" as const,
  id: "jira:SYN-2",
  workstreamId: workstream,
  name: "Fares",
};
const addedAt = (version: number, ids: string[]): Msg => ({
  type: "replied",
  tag: addTag,
  ok: true,
  body: { ...view(version, ids), undo },
});
const away: Msg = { type: "panelStepped", by: 1 };
const back: Msg = { type: "panelStepped", by: -1 };

test("stepping away and back shows the add's line and Undo again, and Undo still works", () => {
  const start = opened({ page: "window", grouping: "epic", addTo: workstream });
  const [model] = run(start, add, addedAt(4, ["jira:SYN-1", "jira:SYN-2"]), away);
  assert.equal(model.panel?.id, "jira:SYN-3");
  assert.equal(model.panel?.add, undefined);
  const [returned] = run(model, back);
  assert.equal(returned.panel?.id, "jira:SYN-2");
  assert.deepEqual(returned.panel?.add, { adding: false, added, problem: null });
  // Closed and opened again, too.
  const [reopened] = run(
    returned,
    { type: "panelClosed" },
    { type: "itemOpened", id: "jira:SYN-2", list },
  );
  assert.deepEqual(reopened.panel?.add?.added, added);
  // Its Undo goes the one way every Undo does, and then the line is gone for
  // good.
  const [undoing, sent] = run(reopened, { type: "panel", msg: { type: "addUndoClicked" } });
  assert.deepEqual(posts(sent), ["/api/actions/workstream.remove"]);
  const [undone] = run(undoing, {
    type: "replied",
    tag: { kind: "panelAddUndone", id: "jira:SYN-2" },
    ok: true,
    body: { undo: null },
  });
  assert.deepEqual(undone.panelAdds, []);
  const [again] = run(undone, away, back);
  assert.equal(again.panel?.add, undefined);
});

test("an add that answers once the panel has moved on still shows when it comes back", () => {
  const start = opened({ page: "window", grouping: "epic", addTo: workstream });
  const [model] = run(start, add, away, addedAt(4, ["jira:SYN-2"]));
  assert.equal(model.panel?.add, undefined);
  assert.deepEqual(run(model, back)[0].panel?.add?.added, added);
});

test("an item already in the workstream, or an add that failed, keeps nothing", () => {
  const start = opened({ page: "window", grouping: "epic", addTo: workstream });
  const [already] = run(start, add, {
    type: "replied",
    tag: addTag,
    ok: true,
    body: { ...view(3, ["jira:SYN-2"]), undo: null },
  });
  assert.deepEqual(already.panelAdds, []);
  const [refused] = run(start, add, {
    type: "replied",
    tag: addTag,
    ok: false,
    body: { error: "That workstream is gone." },
  });
  assert.deepEqual(refused.panelAdds, []);
});

test("once the item is removed some other way, its line is gone, here and on coming back", () => {
  const page = opened({ page: "workstream", id: workstream });
  const [loaded] = run(page, {
    type: "replied",
    tag: { kind: "workstream", id: workstream },
    ok: true,
    body: view(3, ["jira:SYN-1"]),
  });
  // The page still shows the version before the add until it loads again:
  // that says nothing of the add.
  const [model] = run(loaded, add, addedAt(4, ["jira:SYN-1", "jira:SYN-2"]));
  assert.deepEqual(model.panel?.add?.added, added);
  const [synced] = run(model, {
    type: "replied",
    tag: { kind: "workstreamSynced", id: workstream },
    ok: true,
    body: view(4, ["jira:SYN-1", "jira:SYN-2"]),
  });
  assert.deepEqual(synced.panel?.add?.added, added);
  // Removed by the page's ×, or in another tab: the workstream moved on
  // without it.
  const [removed] = run(synced, {
    type: "replied",
    tag: { kind: "workstreamSynced", id: workstream },
    ok: true,
    body: view(5, ["jira:SYN-1"]),
  });
  assert.deepEqual(removed.panelAdds, []);
  assert.deepEqual(removed.panel?.add, { adding: false, added: null, problem: null });
  assert.equal(run(removed, back, away)[0].panel?.add, undefined);
});

test("another item's removal leaves the add standing", () => {
  const page = opened({ page: "workstream", id: workstream });
  const [model] = run(
    page,
    {
      type: "replied",
      tag: { kind: "workstream", id: workstream },
      ok: true,
      body: view(3, ["jira:SYN-1"]),
    },
    add,
    addedAt(4, ["jira:SYN-1", "jira:SYN-2"]),
    {
      type: "replied",
      tag: { kind: "workstreamSynced", id: workstream },
      ok: true,
      body: view(5, ["jira:SYN-2"]),
    },
  );
  assert.deepEqual(model.panel?.add?.added, added);
  assert.equal(model.panelAdds.length, 1);
});

const listed = (version: number): Msg => ({
  type: "replied",
  tag: { kind: "workstreams" },
  ok: true,
  body: { workstreams: [workstreamSummary({ id: workstream, name: "Fares", version })] },
});
const checked = (version: number, ids: string[]): Msg => ({
  type: "replied",
  tag: { kind: "panelAddChecked", workstreamId: workstream },
  ok: true,
  body: view(version, ids),
});

test("in Browse, a workstream that changed since the add is loaded again, which says whether it stands", () => {
  const start = opened({ page: "window", grouping: "epic", addTo: workstream });
  const [model] = run(start, add, addedAt(4, ["jira:SYN-2"]), listed(4));
  // The list shows the version the add made: nothing to ask.
  assert.deepEqual(
    gets(run(model, away, back)[1]).filter((url) => !url.startsWith("/api/items")),
    [],
  );
  // Another tab changed it: the open item's add is checked.
  const [moved, asked] = run(model, listed(5));
  assert.deepEqual(gets(asked), [`/api/workstreams/${workstream}`]);
  // Still in it: the add stands as of that version, and isn't asked about again.
  const [kept] = run(moved, checked(5, ["jira:SYN-2"]));
  assert.deepEqual(kept.panel?.add?.added, added);
  assert.deepEqual(gets(run(kept, listed(5))[1]), []);
  // Changed again while the panel was away: coming back asks again, and
  // once it says the item was removed, the line goes.
  const [later, again] = run(kept, away, listed(6), back);
  assert.deepEqual(
    gets(again).filter((url) => !url.startsWith("/api/items")),
    [`/api/workstreams/${workstream}`],
  );
  assert.deepEqual(later.panel?.add?.added, added);
  const [removed] = run(later, checked(6, []));
  assert.deepEqual(removed.panelAdds, []);
  assert.deepEqual(removed.panel?.add, { adding: false, added: null, problem: null });
});

test("a failed Undo asks whether the add still stands, and the workstream decides", () => {
  const start = opened({ page: "window", grouping: "epic", addTo: workstream });
  const [model] = run(start, add, addedAt(4, ["jira:SYN-2"]));
  const failed = (error: string): [Model, Effect[]] =>
    run(
      model,
      { type: "panel", msg: { type: "addUndoClicked" } },
      {
        type: "replied",
        tag: { kind: "panelAddUndone", id: "jira:SYN-2" },
        ok: false,
        body: { error },
      },
    );
  // Refused: the item had gone from the workstream some other way.
  const [refused, asked] = failed("jira:SYN-2 isn't in this workstream.");
  assert.deepEqual(gets(asked), [`/api/workstreams/${workstream}`]);
  assert.equal(refused.panel?.add?.problem, "jira:SYN-2 isn't in this workstream.");
  const [gone] = run(refused, checked(5, []));
  assert.deepEqual(gone.panelAdds, []);
  assert.equal(gone.panel?.add?.added, null);
  // A server error: the add still stands, and its Undo stays to try again.
  const [broken] = failed("Something went wrong. Try again.");
  const [stands] = run(broken, checked(4, ["jira:SYN-2"]));
  assert.equal(stands.panelAdds.length, 1);
  assert.deepEqual(stands.panel?.add?.added, added);
});

test("a workstream's page that merged a rename, or a thread's view, retires nothing", () => {
  const thread = "01JBZ0000000000000000000T1";
  const page = opened({ page: "thread", id: thread });
  const [model] = run(page, add, addedAt(4, ["jira:SYN-2"]));
  // Its region says the workstream's latest version, but its members are
  // older.
  const [shown] = run(model, {
    type: "replied",
    tag: { kind: "thread", id: thread },
    ok: true,
    body: threadView({
      id: thread,
      workstream: { id: workstream, name: "Fares", version: 4 },
      regionVersion: 4,
      members: [memberView({ ref: itemRef({ id: "jira:SYN-1" }) })],
    }),
  });
  assert.equal(shown.thread?.view?.regionVersion, 4);
  assert.deepEqual(run(shown, away, back)[0].panel?.add?.added, added);
  // A rename puts the latest version over members loaded before the add.
  const [onPage] = run(
    opened({ page: "workstream", id: workstream }),
    { type: "replied", tag: { kind: "workstream", id: workstream }, ok: true, body: view(3, []) },
    add,
    addedAt(4, ["jira:SYN-2"]),
    {
      type: "replied",
      tag: { kind: "renamed", id: workstream },
      ok: true,
      body: workstreamSummary({ id: workstream, name: "Fares", version: 5 }),
    },
  );
  assert.equal(onPage.workstream?.view?.workstream.version, 5);
  assert.deepEqual(onPage.panel?.add?.added, added);
  assert.equal(onPage.panelAdds.length, 1);
});
