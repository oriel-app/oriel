// An Undo or Redo under the agent's reply is said by its line there (OA-118):
// the marker it leaves in that thread says it came from there, so the chat
// can fold it into the list. A marker for anyone else's change doesn't.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { ChatEntry, ThreadView } from "@oriel/web/view";
import { json, type Script, testApp } from "./testing.ts";

const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };
const tidy: Script = async () => ({
  intents: [["workstream.remove", [{ items: ["jira:SYN-10"] }]]],
});
const tidyAndClose: Script = async () => ({
  intents: [
    ["workstream.remove", [{ items: ["jira:SYN-10"] }]],
    ["thread.done", []],
  ],
});

// A workstream on checkout and two threads on it; the first one's agent
// runs `tidy` when asked to.
async function threads(t: TestContext) {
  let advance = (_ms: number) => {};
  const app = await testApp(t, {
    scripts: { tidy, tidyAndClose },
    plan: (input) => {
      advance(1000);
      if (input.text === "Tidy") return [{ run: "tidy" }, { text: "Done." }];
      if (input.text === "Tidy and close") return [{ run: "tidyAndClose" }, { text: "Done." }];
      return [{ text: "Hello." }];
    },
  });
  advance = app.advance;
  const { id: workstreamId } = json<{ id: string }>(await app.post("/api/workstreams", checkout));
  const open = async () =>
    json<{ id: string }>(
      await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Hello" }),
    ).id;
  const [threadId, otherId] = [await open(), await open()];
  await app.app.settled();
  const view = async (id = threadId) => json<ThreadView>(await app.get(`/api/threads/${id}`));
  const ask = async (text: string) => {
    await app.post(`/api/threads/${threadId}/messages`, { text });
    await app.app.settled();
    return view();
  };
  // The line at `index` under the agent's latest reply, undone or done again.
  const undoLine = async (index = 0) => {
    const list = (await view()).entries.findLast((e) => e.kind === "actions");
    assert.ok(list?.kind === "actions");
    const undo = list.lines[index]?.undo;
    assert.ok(undo);
    const url = `/api/actions/${undo.action}?thread=${threadId}&seq=${list.seq}&line=${index}`;
    assert.equal((await app.post(url, undo.input)).status, 200);
  };
  return { ...app, workstreamId, threadId, otherId, view, ask, undoLine };
}

const lastMarker = (view: ThreadView) => {
  const marker = view.entries.findLast((e: ChatEntry) => e.kind === "marker");
  assert.ok(marker?.kind === "marker", "a marker");
  return marker;
};

test("an Undo and a Redo under the reply leave markers that say they came from there", async (t) => {
  const app = await threads(t);
  await app.ask("Tidy");
  await app.undoLine();
  const undone = lastMarker(await app.view());
  assert.deepEqual([undone.added.map((ref) => ref.key), undone.fromLine], [["SYN-10"], true]);
  await app.undoLine();
  const redone = lastMarker(await app.view());
  assert.deepEqual([redone.removed.map((ref) => ref.key), redone.fromLine], [["SYN-10"], true]);
  // The other thread on the workstream follows it, but its chat never showed
  // that line: its marker says what changed.
  assert.equal(lastMarker(await app.view(app.otherId)).fromLine, undefined);
});

test("a done thread's Undo under the reply catches it up with a marker that came from there", async (t) => {
  const app = await threads(t);
  const done = await app.ask("Tidy and close");
  assert.equal(done.state, "done");
  await app.undoLine();
  const view = await app.view();
  assert.equal(view.regionVersion, view.workstream.version);
  assert.equal(lastMarker(view).fromLine, true);
});

test("a change the user made anywhere else leaves a marker of its own", async (t) => {
  const app = await threads(t);
  await app.ask("Tidy");
  await app.post(`/api/workstreams/${app.workstreamId}/add`, { items: ["jira:SYN-10"] });
  const marker = lastMarker(await app.view());
  assert.deepEqual([marker.added.map((ref) => ref.key), marker.fromLine], [["SYN-10"], undefined]);
});
