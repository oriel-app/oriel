// Every page hears a change to the workspace the same way, whoever made it
// and in whichever tab (OA-78): the lists load again, and so does a group's
// page on screen.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect } from "../src/http.ts";
import { init, update } from "../src/root.ts";

const groupId = "01JBZ0000000000000000000G1";
const threadId = "01JBZ0000000000000000000T1";

const requests = (effects: readonly Effect[]) =>
  effects.flatMap((effect) =>
    effect.type === "http" ? [`${effect.method} ${effect.url} ${effect.tag.kind}`] : [],
  );

test("a group's page loads its group again when the workspace changes", () => {
  const [model] = init({ page: "group", id: groupId });
  const [, effects] = update(model, { type: "threadsMoved" });
  assert.deepEqual(requests(effects), [
    "GET /api/threads threads",
    "GET /api/groups groups",
    `GET /api/groups/${groupId} groupSynced`,
  ]);
});

test("the window and a thread's page load only their lists; a thread's own stream says the rest", () => {
  const [window] = init({ page: "window", grouping: "epic", addTo: null });
  assert.deepEqual(requests(update(window, { type: "threadsMoved" })[1]), [
    "GET /api/threads threads",
    "GET /api/groups groups",
  ]);
  const [thread] = init({ page: "thread", id: threadId });
  assert.deepEqual(requests(update(thread, { type: "streamed", event: { type: "threads" } })[1]), [
    "GET /api/threads threads",
    "GET /api/groups groups",
  ]);
});
