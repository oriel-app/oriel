// OA-100, fixed in c27653bc (#91): a thread's reply asked for before its
// stream's latest status undid that status, showing a running thread idle;
// and a workstream page's reload that worked kept the notice a failed one left.
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
const status = (running: boolean): Msg =>
  streamed({ type: "status", running, state: "working", regionVersion: 1 });

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

const synced = (ok: boolean, body: unknown): Msg =>
  replied({ kind: "workstreamSynced", id: workstreamId }, body, ok);
const view = workstreamView();

test("a workstream page's reload that works takes back the notice a failed one left", () => {
  const [loaded] = run(
    init({ page: "workstream", id: workstreamId })[0],
    replied({ kind: "workstream", id: workstreamId }, view),
  );
  const [gone] = run(loaded, synced(false, { error: "no such workstream" }));
  assert.ok(gone.workstream?.notice);
  const [back] = run(gone, synced(true, view));
  assert.equal(back.workstream?.notice, null);
});
