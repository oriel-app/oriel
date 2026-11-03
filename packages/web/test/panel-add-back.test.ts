// Adding the panel's item to the workstream the page is about goes through
// workstream.add (OA-95), and its Undo is one more note in the window's
// stack (OA-152): the line beside the add and the note are one entry, so
// undoing either clears both, and it runs out and holds as every note does.
// Stepping away and back finds the add as it was, in flight or answered
// (OA-149), so nothing goes twice. Once the item is removed some other way,
// the add goes.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect } from "../src/http.ts";
import { addOf, addedText, addUndos, type PanelAdd, undoable } from "../src/panel-adds.ts";
import { init, type Model, type Msg, update } from "../src/root.ts";
import type { Route } from "../src/route.ts";
import { undoMs } from "../src/undos.ts";
import { itemRef, memberView, threadView, workstreamSummary, workstreamView } from "../testing.ts";

const workstream = "01JBZ0000000000000000000G1";
const list = ["jira:SYN-1", "jira:SYN-2", "jira:SYN-3"];
const undo = { action: "workstream.remove", input: { workstream, items: ["jira:SYN-2"] } };

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

// The timers an update starts, as the messages they send.
const timers = (effects: readonly Effect[]) =>
  effects.flatMap((effect) => (effect.type === "after" ? [[effect.ms, effect.msg] as const] : []));

const view = (version: number, ids: string[]) =>
  workstreamView({
    workstream: workstreamSummary({ id: workstream, name: "Fares", version }),
    members: ids.map((id) => memberView({ ref: itemRef({ id }) })),
  });

const opened = (route: Route): Model =>
  run(init(route)[0], { type: "itemOpened", id: "jira:SYN-2", list })[0];
const browsing = () => opened({ page: "window", grouping: "epic", addTo: workstream });

const add: Msg = {
  type: "panelAdd",
  msg: {
    type: "addClicked",
    item: { id: "jira:SYN-2", key: "SYN-2" },
    workstream: { id: workstream, name: "Fares" },
  },
};
const of = { item: "jira:SYN-2", workstreamId: workstream };
const undoClicked: Msg = { type: "panelAdd", msg: { type: "undoClicked", ...of } };
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
const undone = (ok: boolean, error = ""): Msg => ({
  type: "replied",
  tag: { kind: "panelAddUndone", id: "jira:SYN-2", workstreamId: workstream },
  ok,
  body: ok ? { undo: null } : { error },
});
const away: Msg = { type: "panelStepped", by: 1 };
const back: Msg = { type: "panelStepped", by: -1 };

// The panel's item's add, and the notes the window's stack shows.
const addHere = (model: Model): PanelAdd | null => addOf(model.panelAdds, of);
const notes = (model: Model) =>
  addUndos(model.panelAdds, () => {}).notes.map(({ said, label, disabled }) => ({
    said,
    label,
    disabled,
  }));

test("adding goes through workstream.add, and its Undo is a note in the window's stack", () => {
  const [adding, effects] = run(browsing(), add);
  assert.deepEqual(effects, [
    {
      type: "http",
      method: "POST",
      url: `/api/workstreams/${workstream}/add`,
      body: { items: ["jira:SYN-2"] },
      tag: addTag,
    },
  ]);
  assert.equal(addHere(adding)?.pending, "add");
  assert.deepEqual(notes(adding), []);
  const [added, after] = run(adding, addedAt(4, ["jira:SYN-2"]));
  assert.deepEqual(gets(after), ["/api/workstreams"]);
  const entry = addHere(added);
  assert.ok(entry);
  assert.equal(addedText(entry), "Added to “Fares”.");
  assert.deepEqual(notes(added), [
    { said: "Added SYN-2 to “Fares”.", label: "Undo: Added SYN-2 to “Fares”.", disabled: false },
  ]);
  // Its Undo runs out after as long as every note's.
  assert.deepEqual(timers(after), [
    [
      undoMs,
      {
        type: "panelAdd",
        msg: { type: "undoExpired", ...of, countdown: entry.countdown },
      },
    ],
  ]);
});

test("undoing from the note or beside the add is one Undo: it clears both, and can't go twice", () => {
  const [added] = run(browsing(), add, addedAt(4, ["jira:SYN-2"]));
  // The stack's note and the line's button send the same message, as ⌘Z does.
  const [undoing, sent] = run(added, undoClicked);
  assert.deepEqual(posts(sent), ["/api/actions/workstream.remove"]);
  assert.equal(notes(undoing)[0]?.disabled, true);
  assert.deepEqual(run(undoing, undoClicked)[1], []);
  const [gone] = run(undoing, undone(true));
  assert.equal(addHere(gone), null);
  assert.deepEqual(notes(gone), []);
});

test("an add or its Undo in flight is kept across stepping away and back, so neither goes twice", () => {
  const [adding] = run(browsing(), add, away, back);
  assert.equal(adding.panel?.id, "jira:SYN-2");
  assert.equal(addHere(adding)?.pending, "add");
  assert.deepEqual(run(adding, add)[1], []);
  // Its answer, wherever the panel is by then, shows when it comes back.
  const [answered] = run(adding, away, addedAt(4, ["jira:SYN-2"]));
  assert.equal(answered.panel?.id, "jira:SYN-3");
  assert.equal(notes(answered).length, 1);
  const [undoing] = run(answered, back, undoClicked, away, back);
  assert.equal(addHere(undoing)?.pending, "undo");
  assert.deepEqual(run(undoing, undoClicked)[1], []);
  // Closed and opened again, too.
  const [reopened] = run(
    undoing,
    { type: "panelClosed" },
    { type: "itemOpened", id: "jira:SYN-2", list },
  );
  assert.equal(addHere(reopened)?.pending, "undo");
});

test("its Undo runs out, beside the add and in the stack, unless the stack is held", () => {
  const [added, after] = run(browsing(), add, addedAt(4, ["jira:SYN-2"]));
  const [, expiry] = timers(after)[0] ?? [];
  assert.ok(expiry);
  // Held by the pointer on the stack, it stays; let go, it gets its full time
  // again, and that one's end is the one that counts.
  const [held] = run(added, { type: "undoHeld", by: "pointer", held: true });
  const [stays] = run(held, expiry);
  assert.equal(notes(stays).length, 1);
  const [left, restarted] = run(stays, { type: "undoHeld", by: "pointer", held: false });
  const [, again] = timers(restarted)[0] ?? [];
  assert.ok(again);
  assert.equal(notes(run(left, expiry)[0]).length, 1);
  // Its Undo goes from both; the add is still said beside the item, where
  // the page may not know the workstream's members.
  const [ran] = run(left, again);
  assert.deepEqual(notes(ran), []);
  const kept = addHere(ran);
  assert.ok(kept && !undoable(kept));
  assert.equal(addedText(kept), "Added to “Fares”.");
});

test("a hold on the stack holds every kind of note in it", () => {
  const [model] = run(opened({ page: "workstream", id: workstream }), {
    type: "undoHeld",
    by: "focus",
    held: true,
  });
  assert.deepEqual(model.panelAdds.held, { pointer: false, focus: true });
  assert.deepEqual(model.ending.held, { pointer: false, focus: true });
  assert.deepEqual(model.workstream?.held, { pointer: false, focus: true });
});

test("leaving the page lets go of an answered add's Undo, as every note goes; one in flight still answers", () => {
  const [added] = run(browsing(), add, addedAt(4, ["jira:SYN-2"]));
  const [left] = run(added, { type: "routed", route: { page: "done" } });
  assert.deepEqual(notes(left), []);
  assert.equal(addHere(left)?.done?.version, 4);
  const [adding] = run(browsing(), add, { type: "routed", route: { page: "done" } });
  assert.equal(addHere(adding)?.pending, "add");
  assert.equal(notes(run(adding, addedAt(4, ["jira:SYN-2"]))[0]).length, 1);
});

test("an item already in the workstream is said so, without an Undo; a refusal says why", () => {
  const [already, effects] = run(browsing(), add, {
    type: "replied",
    tag: addTag,
    ok: true,
    body: { ...view(3, ["jira:SYN-2"]), undo: null },
  });
  const entry = addHere(already);
  assert.ok(entry);
  assert.equal(addedText(entry), "Already in “Fares”.");
  assert.deepEqual(notes(already), []);
  assert.deepEqual(timers(effects), []);
  const [refused] = run(browsing(), add, {
    type: "replied",
    tag: addTag,
    ok: false,
    body: { error: "That workstream is gone." },
  });
  assert.equal(addHere(refused)?.problem, "That workstream is gone.");
  assert.equal(addHere(refused)?.pending, null);
  assert.deepEqual(notes(refused), []);
});

test("once the item is removed some other way, the add goes, here and on coming back", () => {
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
  assert.equal(notes(model).length, 1);
  const [synced] = run(model, {
    type: "replied",
    tag: { kind: "workstreamSynced", id: workstream },
    ok: true,
    body: view(4, ["jira:SYN-1", "jira:SYN-2"]),
  });
  assert.equal(notes(synced).length, 1);
  // Removed by the page's ×, or in another tab: the workstream moved on
  // without it.
  const [removed] = run(synced, {
    type: "replied",
    tag: { kind: "workstreamSynced", id: workstream },
    ok: true,
    body: view(5, ["jira:SYN-1"]),
  });
  assert.equal(addHere(removed), null);
  assert.equal(addHere(run(removed, back, away)[0]), null);
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
  assert.equal(addHere(model)?.done?.version, 5);
  assert.equal(notes(model).length, 1);
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
  const [model] = run(browsing(), add, addedAt(4, ["jira:SYN-2"]), listed(4));
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
  assert.equal(notes(kept).length, 1);
  assert.deepEqual(gets(run(kept, listed(5))[1]), []);
  // Changed again while the panel was away: coming back asks again, and
  // once it says the item was removed, the add goes.
  const [later, again] = run(kept, away, listed(6), back);
  assert.deepEqual(
    gets(again).filter((url) => !url.startsWith("/api/items")),
    [`/api/workstreams/${workstream}`],
  );
  assert.equal(notes(later).length, 1);
  const [removed] = run(later, checked(6, []));
  assert.equal(addHere(removed), null);
});

test("a failed Undo asks whether the add still stands, and the workstream decides", () => {
  const [model] = run(browsing(), add, addedAt(4, ["jira:SYN-2"]));
  const failed = (error: string): [Model, Effect[]] =>
    run(model, undoClicked, undone(false, error));
  // Refused: the item had gone from the workstream some other way.
  const [refused, asked] = failed("jira:SYN-2 isn't in this workstream.");
  assert.deepEqual(gets(asked), [`/api/workstreams/${workstream}`]);
  assert.equal(addHere(refused)?.problem, "jira:SYN-2 isn't in this workstream.");
  const [gone] = run(refused, checked(5, []));
  assert.equal(addHere(gone), null);
  // A server error: the add still stands, and its Undo stays to try again,
  // with its full time.
  const [broken, retried] = failed("Something went wrong. Try again.");
  assert.equal(timers(retried).length, 1);
  const [stands] = run(broken, checked(4, ["jira:SYN-2"]));
  assert.deepEqual(notes(stands)[0]?.disabled, false);
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
  assert.equal(notes(run(shown, away, back)[0]).length, 1);
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
  assert.equal(notes(onPage).length, 1);
});

test("a countdown from an earlier add never runs out a later one's Undo", () => {
  const [first, started] = run(browsing(), add, addedAt(4, ["jira:SYN-2"]));
  const [, earlier] = timers(started)[0] ?? [];
  assert.ok(earlier);
  const [again] = run(first, undoClicked, undone(true), add, addedAt(6, ["jira:SYN-2"]));
  assert.equal(notes(run(again, earlier)[0]).length, 1);
});

test("an Undo's own answer settles it: a reload that shows it landed first takes nothing away", () => {
  const page = opened({ page: "workstream", id: workstream });
  const [undoing] = run(
    page,
    { type: "replied", tag: { kind: "workstream", id: workstream }, ok: true, body: view(3, []) },
    add,
    addedAt(4, ["jira:SYN-2"]),
    undoClicked,
  );
  const [reloaded] = run(undoing, {
    type: "replied",
    tag: { kind: "workstreamSynced", id: workstream },
    ok: true,
    body: view(5, []),
  });
  assert.equal(addHere(reloaded)?.pending, "undo");
  // A second add can't go before it answers, and once it has, the add goes.
  assert.deepEqual(run(reloaded, add)[1], []);
  assert.equal(addHere(run(reloaded, undone(true))[0]), null);
  // An answer for a request no longer in flight changes nothing.
  const [readded] = run(run(reloaded, undone(true))[0], add);
  assert.equal(addHere(run(readded, undone(true))[0])?.pending, "add");
});

test("the same item's adds to two workstreams are two adds, each with its own Undo", () => {
  const other = "01JBZ0000000000000000000G2";
  const [both] = run(
    browsing(),
    add,
    addedAt(4, ["jira:SYN-2"]),
    {
      type: "panelAdd",
      msg: {
        type: "addClicked",
        item: { id: "jira:SYN-2", key: "SYN-2" },
        workstream: { id: other, name: "Refunds" },
      },
    },
    {
      type: "replied",
      tag: { ...addTag, workstreamId: other, name: "Refunds" },
      ok: true,
      body: {
        ...workstreamView({ workstream: workstreamSummary({ id: other, version: 2 }) }),
        undo: { ...undo, input: { workstream: other, items: ["jira:SYN-2"] } },
      },
    },
  );
  assert.deepEqual(
    notes(both).map((note) => note.said),
    ["Added SYN-2 to “Fares”.", "Added SYN-2 to “Refunds”."],
  );
  assert.equal(addOf(both.panelAdds, { item: "jira:SYN-2", workstreamId: other })?.name, "Refunds");
});

test("an Undo that fails from the stack says why there, wherever the panel is, until dismissed", () => {
  const [model] = run(
    browsing(),
    add,
    addedAt(4, ["jira:SYN-2"]),
    { type: "panelClosed" },
    undoClicked,
    undone(false, "Something went wrong. Try again."),
  );
  const said = () => addUndos(model.panelAdds, () => {}).problem?.said;
  assert.equal(said(), "Couldn't undo adding SYN-2: Something went wrong. Try again.");
  // Its Undo runs out, but what went wrong stays, here and beside the add.
  const ran = run(model, {
    type: "panelAdd",
    msg: { type: "undoExpired", ...of, countdown: addHere(model)?.countdown ?? -1 },
  })[0];
  assert.deepEqual(notes(ran), []);
  assert.equal(
    addUndos(ran.panelAdds, () => {}).problem?.said,
    "Couldn't undo adding SYN-2: Something went wrong. Try again.",
  );
  assert.equal(addHere(ran)?.problem, "Something went wrong. Try again.");
  const [dismissed] = run(model, { type: "panelAdd", msg: { type: "problemDismissed", ...of } });
  assert.equal(addUndos(dismissed.panelAdds, () => {}).problem, null);
  assert.equal(addHere(dismissed)?.problem, null);
  // A failed add, made from the panel, says so there only.
  const [refused] = run(browsing(), add, {
    type: "replied",
    tag: addTag,
    ok: false,
    body: { error: "That workstream is gone." },
  });
  assert.equal(addUndos(refused.panelAdds, () => {}).problem, null);
});
