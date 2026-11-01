// Every page hears a change to the workspace the same way, whoever made it
// and in whichever tab (OA-78): the lists load again, and so does a workstream's
// page on screen.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect } from "../src/http.ts";
import { init, update } from "../src/root.ts";

const workstreamId = "01JBZ0000000000000000000G1";
const threadId = "01JBZ0000000000000000000T1";

const requests = (effects: readonly Effect[]) =>
  effects.flatMap((effect) =>
    effect.type === "http" ? [`${effect.method} ${effect.url} ${effect.tag.kind}`] : [],
  );

test("a workstream's page loads its workstream again when the workspace changes", () => {
  const [model] = init({ page: "workstream", id: workstreamId });
  const [, effects] = update(model, { type: "threadsMoved" });
  assert.deepEqual(requests(effects), [
    "GET /api/threads threads",
    "GET /api/workstreams workstreams",
    `GET /api/workstreams/${workstreamId} workstreamSynced`,
  ]);
});

test("a thread's page loads its thread again when its workstream changed, moved or not", () => {
  const [opened] = init({ page: "thread", id: threadId });
  const [shown] = update(opened, {
    type: "replied",
    tag: { kind: "thread", id: threadId },
    ok: true,
    body: { id: threadId, entries: [], changeSets: [], lastSeq: 3, running: false },
  });
  assert.deepEqual(
    requests(update(shown, { type: "streamed", event: { type: "workstream" } })[1]),
    [`GET /api/threads/${threadId} thread`],
  );
});

test("the window loads only its lists", () => {
  const [window] = init({ page: "window", grouping: "epic", addTo: null });
  assert.deepEqual(requests(update(window, { type: "threadsMoved" })[1]), [
    "GET /api/threads threads",
    "GET /api/workstreams workstreams",
  ]);
});

test("a workstream deleted in another tab says so on its page here", () => {
  const [model] = init({ page: "workstream", id: workstreamId });
  const [gone] = update(model, {
    type: "replied",
    tag: { kind: "workstreamSynced", id: workstreamId },
    ok: false,
    body: { error: "no such workstream" },
  });
  assert.equal(gone.workstream?.notice, "no such workstream");
});
