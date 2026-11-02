// A reply's link to a change set shows where it stands (OA-113): the list
// of threads the window keeps says, beside each thread, where each of its
// change sets stands, in a person's words, as it moves. Slack is the
// fixture's workspace in memory.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fixtureApi } from "@oriel/slack";
import type { DiffView, ThreadsView, ThreadView } from "@oriel/web/view";
import { loadSlackFixture, weather } from "../../../scripts/fixtures/slack.ts";
import { json, type Script, testApp } from "./testing.ts";

const sms = `slack:${weather}-1788782400.000100`;

const post: Script = async () => ({
  value: null,
  writes: [["slack.postMessage", [sms, "Test post from Oriel, please ignore"]]],
});

test("the threads list says where each change set stands, from pending to reverted", async (t) => {
  const app = await testApp(t, {
    writes: true,
    slack: { kind: "fixture", workspace: fixtureApi(loadSlackFixture()) },
    plan: () => [{ run: "post" }],
    scripts: { post },
  });
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", { kind: "picked", name: "SMS updates", items: [sms] }),
  );
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Try a Slack post" }),
  );
  await app.app.settled();
  const view = json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  const entry = view.entries.find((e) => e.kind === "change-set");
  assert.ok(entry?.kind === "change-set");
  const posted = entry.changeSetId;
  const states = async () =>
    json<ThreadsView>(await app.get("/api/threads"))
      .changeSets.map((set) => [set.id, set.thread, set.state])
      .toSorted();
  const approve = async (id: string) => {
    const { hash } = json<DiffView>(await app.post(`/api/change-sets/${id}/diff`));
    app.advance(1_000);
    assert.equal((await app.post(`/api/change-sets/${id}/approve`, { hash })).status, 200);
    await app.app.settled();
  };

  assert.deepEqual(await states(), [[posted, threadId, "pending"]]);
  await approve(posted);
  assert.deepEqual(await states(), [[posted, threadId, "applied"]]);
  // Its Undo is a change set of the same thread, pending until approved,
  // and once it lands, the post it undid is reverted.
  const { revert } = json<{ revert: string }>(
    await app.post(`/api/change-sets/${posted}/revert`, {}),
  );
  assert.deepEqual(
    await states(),
    [
      [posted, threadId, "applied"],
      [revert, threadId, "pending"],
    ].toSorted(),
  );
  await approve(revert);
  assert.deepEqual(
    await states(),
    [
      [posted, threadId, "reverted"],
      [revert, threadId, "applied"],
    ].toSorted(),
  );
});
