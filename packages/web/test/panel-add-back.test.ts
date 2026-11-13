import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect } from "../src/http.ts";
import { addOf, addUndos, type PanelAdd } from "../src/panel-adds.ts";
import { init, type Model, type Msg, update } from "../src/root.ts";
import type { Route } from "../src/route.ts";
import { itemRef, memberView, workstreamSummary, workstreamView } from "../testing.ts";

const workstream = "01JBZ0000000000000000000G1";
const list = ["jira:SYN-1", "jira:SYN-2", "jira:SYN-3"];
const undo = { action: "workstream.remove", input: { workstream, items: ["jira:SYN-2"] } };

const gets = (effects: readonly Effect[]) =>
  effects.flatMap((effect) =>
    effect.type === "http" && effect.method === "GET" ? [effect.url] : [],
  );

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

const addHere = (model: Model): PanelAdd | null => addOf(model.panelAdds, of);
const notes = (model: Model) =>
  addUndos(model.panelAdds, () => {}).notes.map(({ said, label, disabled }) => ({
    said,
    label,
    disabled,
  }));

test("undoing from the note or beside the add is one Undo: it clears both, and can't go twice", () => {
  const [added] = run(browsing(), add, addedAt(4, ["jira:SYN-2"]));
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
  const [answered] = run(adding, away, addedAt(4, ["jira:SYN-2"]));
  assert.equal(answered.panel?.id, "jira:SYN-3");
  assert.equal(notes(answered).length, 1);
  const [undoing] = run(answered, back, undoClicked, away, back);
  assert.equal(addHere(undoing)?.pending, "undo");
  assert.deepEqual(run(undoing, undoClicked)[1], []);
  const [reopened] = run(
    undoing,
    { type: "panelClosed" },
    { type: "itemOpened", id: "jira:SYN-2", list },
  );
  assert.equal(addHere(reopened)?.pending, "undo");
});

const checked = (version: number, ids: string[]): Msg => ({
  type: "replied",
  tag: { kind: "panelAddChecked", workstreamId: workstream },
  ok: true,
  body: view(version, ids),
});

test("a failed Undo asks whether the add still stands, and the workstream decides", () => {
  const [model] = run(browsing(), add, addedAt(4, ["jira:SYN-2"]));
  const failed = (error: string): [Model, Effect[]] =>
    run(model, undoClicked, undone(false, error));
  const [refused, asked] = failed("jira:SYN-2 isn't in this workstream.");
  assert.deepEqual(gets(asked), [`/api/workstreams/${workstream}`]);
  assert.ok(addHere(refused)?.problem);
  const [gone] = run(refused, checked(5, []));
  assert.equal(addHere(gone), null);
  const [broken, retried] = failed("Something went wrong. Try again.");
  assert.equal(timers(retried).length, 1);
  const [stands] = run(broken, checked(4, ["jira:SYN-2"]));
  assert.deepEqual(notes(stands)[0]?.disabled, false);
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
  assert.deepEqual(run(reloaded, add)[1], []);
  assert.equal(addHere(run(reloaded, undone(true))[0]), null);
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
  assert.equal(notes(both).length, 2);
  assert.equal(addOf(both.panelAdds, { item: "jira:SYN-2", workstreamId: other })?.name, "Refunds");
});
