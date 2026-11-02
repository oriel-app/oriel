// A page shows the newest it has heard (OA-100): a thread's reply asked for
// before its stream's latest status doesn't undo that status, and a
// workstream page's reload that works takes back what a failed one said.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect, Tag } from "../src/http.ts";
import { init, type Model, type Msg, update } from "../src/root.ts";
import type { StreamEvent, ThreadView } from "../src/view.ts";
import { threadView, workstreamView } from "../testing.ts";

const threadId = "01JBZ0000000000000000000T1";
const workstreamId = "01JBZ0000000000000000000G1";

function run(model: Model, ...msgs: Msg[]): [Model, Effect[]] {
  let effects: Effect[] = [];
  for (const msg of msgs) [model, effects] = update(model, msg);
  return [model, effects];
}

const replied = (tag: Tag, body: unknown, ok = true): Msg => ({ type: "replied", tag, ok, body });
const streamed = (event: StreamEvent): Msg => ({ type: "streamed", event });
const status = (running: boolean, regionVersion = 1): Msg =>
  streamed({ type: "status", running, state: "working", regionVersion });

// The thread loads asked for by `effects`, by their tags.
const loads = (effects: readonly Effect[]): Tag[] =>
  effects.flatMap((e) => (e.type === "http" && e.tag.kind === "thread" ? [e.tag] : []));

const idle = threadView({ id: threadId, running: false, state: "working", lastSeq: 2 });

function opened(): Model {
  return run(
    init({ page: "thread", id: threadId })[0],
    replied({ kind: "thread", id: threadId }, idle),
  )[0];
}

test("a thread's reply asked for before the stream said it's running doesn't show it idle", () => {
  // Its workstream changed: the page asks for the thread again.
  const [asked, effects] = run(opened(), streamed({ type: "workstream" }));
  const [tag] = loads(effects);
  assert.ok(tag);
  // Before the answer, the stream says a turn started.
  const [running] = run(asked, status(true));
  assert.equal(running.thread?.view?.running, true);
  // The answer, built before the turn started, still says idle.
  const older: ThreadView = { ...idle, workstream: { ...idle.workstream, name: "Renamed" } };
  const [after] = run(running, replied(tag, older));
  assert.equal(after.thread?.view?.running, true);
  // The rest of it is new to the page, and shows.
  assert.equal(after.thread?.view?.workstream.name, "Renamed");
});

test("a thread's reply asked for after the stream's latest status shows what it says", () => {
  const [running] = run(opened(), status(true));
  // The turn ended: the stream says so, and the page asks for the thread.
  const [ended, effects] = run(running, status(false));
  const [tag] = loads(effects);
  assert.ok(tag);
  // Done meanwhile, as the agent marked it.
  const done: ThreadView = { ...idle, state: "done", doneBy: "marked" };
  const [after] = run(ended, replied(tag, done));
  assert.equal(after.thread?.view?.state, "done");
  assert.equal(after.thread?.view?.running, false);
});

test("a thread's reply for a new version, asked for once the stream said so, isn't stale", () => {
  const [moved, effects] = run(opened(), status(false, 2));
  const [tag] = loads(effects);
  assert.ok(tag);
  // Its title, which the stream didn't send, shows only if the reply isn't taken as stale.
  const [after] = run(moved, replied(tag, { ...idle, regionVersion: 2, title: "Renamed" }));
  assert.equal(after.thread?.view?.regionVersion, 2);
  assert.equal(after.thread?.view?.title, "Renamed");
});

const synced = (ok: boolean, body: unknown): Msg =>
  replied({ kind: "workstreamSynced", id: workstreamId }, body, ok);
const view = workstreamView();

test("a workstream page's reload that works takes back the notice a failed one left", () => {
  const [loaded] = run(
    init({ page: "workstream", id: workstreamId })[0],
    replied({ kind: "workstream", id: workstreamId }, view),
  );
  const [gone] = run(loaded, synced(false, { error: "no such workstream" }));
  assert.equal(gone.workstream?.notice, "no such workstream");
  const [back] = run(gone, synced(true, view));
  assert.equal(back.workstream?.notice, null);
});

test("a workstream page's reload leaves a notice it didn't leave", () => {
  const [loaded] = run(
    init({ page: "workstream", id: workstreamId })[0],
    replied({ kind: "workstream", id: workstreamId }, view),
  );
  // A drop that added nothing says so; the reload the drop set off follows.
  const [dropped] = run(
    loaded,
    replied({ kind: "dropped", workstreamId }, { workstream: view, added: [], refused: [] }),
  );
  const said = dropped.workstream?.notice;
  assert.ok(said);
  const [after] = run(dropped, synced(true, view));
  assert.equal(after.workstream?.notice, said);
});
