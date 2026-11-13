import assert from "node:assert/strict";
import { test } from "node:test";
import { fixtureApi, loadSlackFixture } from "@oriel/slack";
import type { DiffView, SearchView, ThreadView } from "@oriel/web/view";
import { weather } from "../../../scripts/fixtures/slack.ts";
import { json, type Script, testApp } from "./testing.ts";

const sms = `slack:${weather}-1788782400.000100`;
const testPost = "Test post from Oriel, please ignore";

const post: Script = async () => ({
  value: null,
  writes: [["slack.postMessage", [sms, testPost]]],
});
test("the window's search events never keep the query's text", async (t) => {
  const app = await testApp(t);
  const event = { name: "threads.searched", queryLength: 6, results: 1, query: "secret" };
  await app.post("/api/telemetry", event);
  assert.ok(app.app.telemetry().some((e) => e.name === "threads.searched"));
  assert.ok(!JSON.stringify(app.app.telemetry()).includes("secret"));
});

test("a reason held from a review link's holder is never found, since it hasn't reached the agent", async (t) => {
  const app = await testApp(t, {
    writes: true,
    slack: { mode: "fixture", fetch: fixtureApi(loadSlackFixture()).fetch },
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
  const [set] = json<ThreadView>(await app.get(`/api/threads/${threadId}`)).changeSets;
  assert.ok(set);
  const minted = json<{ url: string }>(await app.post(`/api/change-sets/${set.id}/review-link`));
  const token = new URL(minted.url).pathname.split("/").at(-1);
  const opened = json<{ diff: DiffView }>(await app.post("/api/review/open", { token }));
  const decided = await app.post("/api/review/decide", {
    token,
    changeSet: set.id,
    kind: "rejected",
    name: "Someone",
    hash: opened.diff.hash,
    reason: "zebracorn instructions for the agent",
  });
  assert.equal(decided.status, 200);
  await app.app.settled();
  const view = json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  assert.ok(
    view.entries.some((e) => e.kind === "held"),
    "the reason is held in the thread",
  );
  assert.deepEqual(json<SearchView>(await app.get("/api/search?q=zebracorn")).results, []);
});
