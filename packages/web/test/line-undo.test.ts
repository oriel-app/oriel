// Undo under the agent's reply (OA-88): each line that applied sends its
// Undo, or once undone its Redo, through the one path every Undo takes,
// naming the line, which then says what came of it.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Replied } from "../src/http.ts";
import { initThread, threadReplied, type ThreadModel, updateThread } from "../src/thread.ts";
import type { ChatEntry, ThreadView } from "../src/view.ts";
import { actionLine, threadView } from "../testing.ts";

const threadId = "01JBZ0000000000000000000T1";
const workstreamId = "01JBZ0000000000000000000G1";
const seq = 4;
const viewWith = (entries: ChatEntry[]): ThreadView =>
  threadView({
    id: threadId,
    workstream: { id: workstreamId, name: "Launch", version: 1 },
    entries,
    lastSeq: entries.at(-1)?.seq ?? 0,
  });
const undo = {
  action: "workstream.add",
  input: { workstream: workstreamId, items: ["jira:SYN-10"] },
};
const list: ChatEntry = {
  seq,
  at: "2026-10-29T09:00:00.000Z",
  kind: "actions",
  lines: [
    actionLine({ text: "Removed SYN-10 from this workstream.", undo }),
    actionLine({
      text: "Didn't mark this thread done: no.",
      applied: false,
      why: "no",
      undo: null,
    }),
  ],
};

function loaded(): ThreadModel {
  const [model] = initThread(threadId);
  const body = viewWith([list]);
  const reply: Replied = { type: "replied", tag: { kind: "thread", id: threadId }, ok: true, body };
  return threadReplied(model, reply)[0];
}

test("Undo on a line posts its call to the shared Undo path, naming the line, once", () => {
  const [busy, effects] = updateThread(loaded(), { type: "lineUndoClicked", seq, index: 0 });
  assert.deepEqual(effects, [
    {
      type: "http",
      method: "POST",
      url: `/api/actions/workstream.add?thread=${threadId}&seq=${seq}&line=0`,
      body: undo.input,
      tag: { kind: "lineUndone", threadId, seq, index: 0 },
    },
  ]);
  // A second click waits for the first.
  assert.deepEqual(updateThread(busy, { type: "lineUndoClicked", seq, index: 0 })[1], []);
  // A line with nothing to undo sends nothing.
  assert.deepEqual(updateThread(loaded(), { type: "lineUndoClicked", seq, index: 1 })[1], []);
});

test("once answered the thread reloads to show the line; a refusal says why", () => {
  const [busy] = updateThread(loaded(), { type: "lineUndoClicked", seq, index: 0 });
  const tag = { kind: "lineUndone", threadId, seq, index: 0 } as const;
  const refused: Replied = {
    type: "replied",
    tag,
    ok: false,
    body: { error: "it was already undone" },
  };
  const [after, effects] = threadReplied(busy, refused);
  assert.deepEqual([after.undoing, after.notice], [[], "it was already undone"]);
  assert.deepEqual(effects, [
    {
      type: "http",
      method: "GET",
      url: `/api/threads/${threadId}`,
      tag: { kind: "thread", id: threadId },
    },
  ]);
  const ok: Replied = { type: "replied", tag, ok: true, body: { undo: null } };
  assert.deepEqual(threadReplied(busy, ok)[0].notice, null);
});
