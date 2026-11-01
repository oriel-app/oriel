// A thread opens at its latest entry, and new entries keep the page there
// only while the user is there to see them.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect } from "../src/http.ts";
import { init, type Model, type Msg, update } from "../src/root.ts";
import type { ChangeSetView, ChatEntry, ThreadView } from "../src/view.ts";

const id = "01JBZ0000000000000000000T1";
const groupId = "01JBZ0000000000000000000G1";
const setId = "01JBZ0000000000000000000C1";
const at = "2026-01-01T00:00:00.000Z";

const openSet: ChangeSetView = {
  id: setId,
  status: "open",
  nextSteps: [{ kind: "approve" }, { kind: "reject" }],
  applying: false,
  sentUnapplied: false,
  decision: null,
  errors: [],
  revertOf: null,
  reverts: [],
  createdAt: at,
};

const view: ThreadView = {
  id,
  title: "Hi",
  group: { id: groupId, name: "Checkout", version: 1 },
  state: "working",
  doneBy: null,
  regionVersion: 1,
  members: [],
  entries: [
    { seq: 1, at, kind: "user", text: "Estimate these" },
    { seq: 2, at, kind: "change-set", changeSetId: setId },
  ],
  lastSeq: 2,
  running: false,
  changeSets: [openSet],
  writable: true,
};

// The update asks to hear once the page has rendered, and then scrolls.
const asks = (effects: readonly Effect[]) => effects.some((e) => e.type === "rendered");
const rendered: Msg = { type: "thread", msg: { type: "rendered" } };
const scrolls = (model: Model) => update(model, rendered)[1].some((e) => e.type === "showLatest");

function run(model: Model, ...msgs: Msg[]): [Model, Effect[]] {
  let effects: Effect[] = [];
  for (const msg of msgs) [model, effects] = update(model, msg);
  return [model, effects];
}

const loaded: Msg = { type: "replied", tag: { kind: "thread", id }, ok: true, body: view };
const entry = (seq: number): Msg => ({
  type: "streamed",
  event: { type: "entry", entry: { seq, at, kind: "text", text: "More" } satisfies ChatEntry },
});
// The chat's end `below` the window's bottom edge, after a move up (or a
// run opened) or down.
const scrolled = (below: number, up: boolean): Msg => ({
  type: "thread",
  msg: { type: "scrolled", below, up },
});
const up = scrolled(600, true);

test("a thread opens at its latest entry, from a link or its address", () => {
  const [onGroup] = init({ page: "group", id: groupId });
  const [opening, routed] = update(onGroup, { type: "routed", route: { page: "thread", id } });
  // Nothing to scroll to until it loads.
  assert.equal(asks(routed), false);
  const [shown, effects] = update(opening, loaded);
  assert.equal(asks(effects), true);
  assert.equal(scrolls(shown), true);
  assert.equal(asks(update(init({ page: "thread", id })[0], loaded)[1]), true);
});

test("new entries, and the diff that fills a change set, keep the page at the latest entry", () => {
  const [shown] = run(init({ page: "thread", id })[0], loaded);
  const [more, effects] = update(shown, entry(3));
  assert.equal(asks(effects), true);
  assert.equal(scrolls(more), true);
  const diffed = update(more, {
    type: "replied",
    tag: { kind: "diff", changeSetId: setId },
    ok: true,
    body: { changeSetId: setId, hash: "h", lines: [] },
  });
  assert.equal(asks(diffed[1]), true);
  // Typing changes nothing the chat shows.
  const typed = update(more, { type: "thread", msg: { type: "draftChanged", text: "W" } });
  assert.equal(asks(typed[1]), false);
});

test("the composer emptying once a message is sent keeps the page at the latest entry", () => {
  const [shown] = run(init({ page: "thread", id })[0], loaded);
  const [sending, asked] = run(
    shown,
    { type: "thread", msg: { type: "draftChanged", text: "Any risks?" } },
    { type: "thread", msg: { type: "sendClicked" } },
  );
  assert.equal(asks(asked), true);
  const [, sent] = update(sending, {
    type: "replied",
    tag: { kind: "sent", threadId: id },
    ok: true,
    body: { seq: 3 },
  });
  assert.equal(asks(sent), true);
});

test("scrolled up to read, new entries leave the page where it is, until the user is back", () => {
  const [away] = run(init({ page: "thread", id })[0], loaded, up);
  const [more, effects] = update(away, entry(3));
  assert.equal(more.thread?.view?.entries.length, 3);
  assert.equal(asks(effects), false);
  assert.equal(scrolls(more), false);
  const [back] = update(more, scrolled(30, false));
  assert.equal(asks(update(back, entry(4))[1]), true);
  // Opening the thread again opens it at its latest entry.
  const [again] = update(more, { type: "routed", route: { page: "thread", id } });
  assert.equal(asks(update(again, loaded)[1]), true);
});

test("scrolling up while a reply streams in isn't undone by an entry that arrived just before", () => {
  const [shown] = run(init({ page: "thread", id })[0], loaded);
  // An entry asks; before the page renders it, the user scrolls up a little.
  const [asked, effects] = update(shown, entry(3));
  assert.equal(asks(effects), true);
  const [away] = update(asked, scrolled(12, true));
  assert.equal(scrolls(away), false);
});

test("where the page counts as at the latest entry", () => {
  const [shown] = run(init({ page: "thread", id })[0], loaded);
  const at = (model: Model, ...msgs: Msg[]) => run(model, ...msgs)[0].thread?.atLatest;
  // Any move away leaves it, unless the page is right at the end, as when
  // the composer shrank there after sending.
  assert.equal(at(shown, scrolled(8, true)), false);
  assert.equal(at(shown, scrolled(0.5, true)), true);
  // A run's output opened below it.
  assert.equal(at(shown, scrolled(400, true)), false);
  // Coming back down counts within a few dozen pixels.
  assert.equal(at(shown, up, scrolled(100, false)), false);
  assert.equal(at(shown, up, scrolled(30, false)), true);
  // What arrived rendering below doesn't count as leaving; going on past the
  // chat's end, to the rail below it on a narrow screen, does, and coming
  // back up to the end from there counts as being there.
  assert.equal(at(shown, scrolled(250, false)), true);
  assert.equal(at(shown, scrolled(-300, false)), false);
  assert.equal(at(shown, scrolled(-300, false), scrolled(-25, true)), true);
});

test("a change to the thread's group reloads it at the latest entry, and nowhere else", () => {
  const groupChanged: Msg = { type: "streamed", event: { type: "group" } };
  const reloads = (effects: readonly Effect[]) =>
    effects.some((e) => e.type === "http" && e.url === `/api/threads/${id}`);
  const renamed = { ...view, group: { ...view.group, name: "Checkout v2" } };
  const reloaded: Msg = { type: "replied", tag: { kind: "thread", id }, ok: true, body: renamed };
  const [shown] = run(init({ page: "thread", id })[0], loaded);
  const [told, effects] = update(shown, groupChanged);
  assert.ok(reloads(effects));
  const [there, asked] = update(told, reloaded);
  assert.equal(there.thread?.view?.group.name, "Checkout v2");
  assert.equal(asks(asked), true);
  const [away] = run(shown, up, groupChanged);
  const [stayed, quiet] = update(away, reloaded);
  assert.equal(asks(quiet), false);
  assert.equal(scrolls(stayed), false);
});

test("opening an item's panel beside a thread leaves the page where it is", () => {
  const [shown] = run(init({ page: "thread", id })[0], loaded);
  const [, opened] = update(shown, { type: "itemOpened", id: "jira:OA-5" });
  assert.deepEqual(opened, [
    { type: "navigate", route: { page: "thread", id, item: "jira:OA-5" }, stay: true },
  ]);
  const [beside, routed] = update(shown, {
    type: "routed",
    route: { page: "thread", id, item: "jira:OA-5" },
  });
  assert.equal(asks(routed), false);
  // The thread stays as it was: not opened again, which would scroll once
  // it loaded.
  assert.equal(beside.thread, shown.thread);
});

test("a scroll that changes nothing changes nothing on screen", () => {
  const [shown] = run(init({ page: "thread", id })[0], loaded);
  assert.equal(update(shown, scrolled(0, false))[0], shown);
});
