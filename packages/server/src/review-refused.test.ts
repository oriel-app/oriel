// A review link to a change set whose workstream was deleted is refused, and
// counted as refused, not as opened (OA-143): the review-link funnel counts
// only opens that showed the change.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ThreadView } from "@oriel/web/view";
import { json, type Script, testApp } from "./testing.ts";

// Proposes 3 points for the first unestimated story in the region.
const estimate: Script = async (bindings) => {
  const stories = (await bindings.read("jira.listItems", [])).value as {
    id: string;
    gone: boolean;
    points?: number | null;
    issueType?: string;
  }[];
  const story = stories.find((s) => !s.gone && s.points === null && s.issueType !== "Epic");
  assert.ok(story, "the checkout epic has an unestimated story");
  return { value: [story.id], writes: [["jira.setEstimate", [story.id, 3]]] };
};

test("a review link refused because its workstream was deleted is counted as refused, not opened", async (t) => {
  const app = await testApp(t, { scripts: { estimate }, plan: () => [{ run: "estimate" }] });
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", { kind: "cluster", grouping: "epic", cluster: "10001" }),
  );
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Estimate" }),
  );
  await app.app.settled();
  const [set] = json<ThreadView>(await app.get(`/api/threads/${threadId}`)).changeSets;
  assert.ok(set);
  const minted = json<{ url: string }>(await app.post(`/api/change-sets/${set.id}/review-link`));
  const token = new URL(minted.url).pathname.split("/").at(-1);
  const counted = () =>
    app.app
      .telemetry()
      .flatMap((event) =>
        event.name.startsWith("review-link.") ? [{ name: event.name, ...event.data }] : [],
      );

  const deleted = await app.post(`/api/workstreams/${workstreamId}/delete`, { threads: 1 });
  assert.equal(deleted.status, 200);
  assert.equal((await app.post("/api/review/open", { token })).status, 404);
  assert.deepEqual(counted(), [
    { name: "review-link.refused", changeSetId: set.id, why: "deleted" },
  ]);

  // Brought back, the same link opens, and that counts as opened.
  const { undo } = json<{ undo: { action: string; input: unknown } }>(deleted);
  assert.equal((await app.post(`/api/actions/${undo.action}`, undo.input)).status, 200);
  assert.equal((await app.post("/api/review/open", { token })).status, 200);
  assert.deepEqual(
    counted().map((event) => event.name),
    ["review-link.refused", "review-link.opened"],
  );
});
