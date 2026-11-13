import assert from "node:assert/strict";
import { test } from "node:test";
import { type Ended, endingReplied, initEnding, updateEnding } from "../src/ending.ts";
import type { Effect, Replied } from "../src/http.ts";

const workstreamId = "01JBZ0000000000000000000G1";
const launch: Ended = {
  id: workstreamId,
  name: "Launch",
  threads: { working: 2, done: 1, "handed-off": 0, dropped: 0 },
};

const replied = (tag: Replied["tag"], body: unknown, ok = true): Replied => ({
  type: "replied",
  tag,
  ok,
  body,
});

const requests = (effects: readonly Effect[]) =>
  effects.flatMap((e) =>
    e.type === "http" ? [`${e.method} ${e.url} ${JSON.stringify(e.body ?? null)}`] : [],
  );

const restore = { action: "workstream.restore", input: { workstream: workstreamId } };

test("Delete asks first, sends the thread count the person saw, and its Undo restores the workstream", () => {
  const [asking, none] = updateEnding(initEnding(), { type: "deleteClicked", workstream: launch });
  assert.deepEqual(none, []);
  assert.equal(updateEnding(asking, { type: "deleteCancelled" })[0].asking, null);
  const [deleting, sent] = updateEnding(asking, { type: "deleteConfirmed" });
  assert.deepEqual(requests(sent), [`POST /api/workstreams/${workstreamId}/delete {"threads":3}`]);
  const tag = { kind: "ended", id: workstreamId, how: "deleted", name: "Launch" } as const;
  const deleted = endingReplied(deleting, replied(tag, { threads: 3, undo: restore }));
  const [, undo] = updateEnding(deleted, { type: "undoClicked" });
  assert.deepEqual(requests(undo), [
    `POST /api/actions/workstream.restore {"workstream":"${workstreamId}"}`,
  ]);
});
