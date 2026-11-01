// Undoing a removal on a workstream's page adds the item back through the same
// route as picking it: a new version, not a rewrite of the old one.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkstreamView, ThreadView } from "@oriel/web/view";
import { json, testApp } from "./testing.ts";

test("an undone removal puts the item back where it was, with markers in working threads", async (t) => {
  const app = await testApp(t);
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", {
      kind: "picked",
      name: "Launch",
      items: ["jira:SYN-3", "jira:SYN-10", "jira:SYN-21"],
    }),
  );
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Hi" }),
  );
  await app.app.settled();
  const keys = (view: WorkstreamView) => view.members.map((m) => m.ref.key);
  const before = keys(json<WorkstreamView>(await app.get(`/api/workstreams/${workstreamId}`)));
  await app.post(`/api/workstreams/${workstreamId}/remove`, { items: ["jira:SYN-10"] });
  const back = json<WorkstreamView>(
    await app.post(`/api/workstreams/${workstreamId}/add`, { items: ["jira:SYN-10"] }),
  );
  assert.deepEqual(keys(back), before);
  assert.equal(back.workstream.version, 3);
  const thread = json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  assert.equal(thread.regionVersion, 3);
  assert.deepEqual(
    thread.entries.flatMap((e) =>
      e.kind === "marker"
        ? [[e.from, e.to, e.added.map((r) => r.key), e.removed.map((r) => r.key)]]
        : [],
    ),
    [
      [1, 2, [], ["SYN-10"]],
      [2, 3, ["SYN-10"], []],
    ],
  );
  // Counted as the user adding it, which it is.
  const added = app.app.telemetry().filter((e) => e.name === "workstream.item-added");
  assert.deepEqual(
    added.map((e) => e.data.cause),
    ["user"],
  );
});
