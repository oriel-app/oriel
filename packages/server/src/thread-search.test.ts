// Finding your way back to a thread (OA-108, OA-110): one thread posts a
// test message in Slack through an approved change set; another thread's
// agent, and the sidebar's search, both find that change set through the one
// read layer, with a link that opens its thread at it. Jira is SYN in
// memory; Slack is the fixture's workspace in memory.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { ThreadFound } from "@oriel/core";
import { fixtureApi } from "@oriel/slack";
import type { DiffView, SearchView, ThreadView } from "@oriel/web/view";
import { loadSlackFixture, weather } from "../../../scripts/fixtures/slack.ts";
import { json, type Script, testApp } from "./testing.ts";

const sms = `slack:${weather}-1788782400.000100`;
const testPost = "Test post from Oriel, please ignore";

const post: Script = async () => ({
  value: null,
  writes: [["slack.postMessage", [sms, testPost]]],
});
// What the agent finds, as its run returns it.
const lookUp: Script = async (bindings) => {
  const found = await bindings.read("thread.find", ["slack test post"]);
  const sets = await bindings.read("thread.changeSets", []);
  const threads = await bindings.read("thread.list", []);
  const workstreams = await bindings.read("workstream.list", []);
  return {
    value: {
      found: found.value,
      sets: sets.value,
      threads: threads.value,
      workstreams: workstreams.value,
    },
  };
};

async function posted(t: TestContext) {
  const app = await testApp(t, {
    writes: true,
    slack: { kind: "fixture", workspace: fixtureApi(loadSlackFixture()) },
    plan: (input) => [{ run: input.text.startsWith("Where") ? "lookUp" : "post" }],
    scripts: { post, lookUp },
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
  const { hash } = json<DiffView>(await app.post(`/api/change-sets/${entry.changeSetId}/diff`));
  app.advance(1000);
  const approved = await app.post(`/api/change-sets/${entry.changeSetId}/approve`, { hash });
  assert.equal(approved.status, 200);
  return { ...app, workstreamId, threadId, changeSetId: entry.changeSetId };
}

test("the sidebar's search finds a change set by what it wrote, and opens its thread at it", async (t) => {
  const app = await posted(t);
  const search = json<SearchView>(await app.get("/api/search?q=test%20post%20oriel"));
  assert.equal(search.query, "test post oriel");
  const [first] = search.results;
  assert.deepEqual(first?.changeSet, { id: app.changeSetId, state: "applied" });
  assert.equal(first?.thread.id, app.threadId);
  assert.equal(first?.thread.workstream.name, "SMS updates");
  assert.equal(first?.matched, "change-set");
  assert.match(first?.excerpt ?? "", /Test post from Oriel/);
  // A thread by its name, as the window titles it.
  const byName = json<SearchView>(await app.get("/api/search?q=try%20a%20slack"));
  assert.deepEqual(
    byName.results.map((r) => [r.thread.id, r.changeSet, r.matched]),
    [[app.threadId, null, "name"]],
  );
  // Nothing typed finds nothing.
  assert.deepEqual(json<SearchView>(await app.get("/api/search?q=")).results, []);
});

test("another thread's agent finds where the user approved the post, with a link that opens it there", async (t) => {
  const app = await posted(t);
  const { id: asking } = json<{ id: string }>(
    await app.post(`/api/workstreams/${app.workstreamId}/threads`, {
      text: "Where did I approve the Slack test post?",
    }),
  );
  await app.app.settled();
  const view = json<ThreadView>(await app.get(`/api/threads/${asking}`));
  const run = view.entries.find((e) => e.kind === "run.finished");
  assert.ok(run?.kind === "run.finished");
  const value = JSON.parse(run.run.returned ?? "null") as {
    found: ThreadFound[];
    sets: { id: string; state: string; decided: { kind: string } | null }[];
    threads: { id: string; link: string }[];
    workstreams: { name: string; items: string[]; threads: number }[];
  };
  const [first] = value.found;
  assert.equal(first?.changeSet?.id, app.changeSetId);
  assert.equal(first?.changeSet?.link, `/threads/${app.threadId}?changeSet=${app.changeSetId}`);
  assert.equal(first?.changeSet?.state, "applied");
  assert.equal(first?.changeSet?.decided?.kind, "approved");
  assert.deepEqual(first?.changeSet?.changes, [
    {
      source: "Slack",
      sentence: "Post in #weather-disruptions as Amara Okafor.",
      text: [testPost],
    },
  ]);
  assert.deepEqual(
    value.sets.map((set) => set.id),
    [app.changeSetId],
  );
  assert.deepEqual(
    value.threads.map((thread) => thread.link).toSorted(),
    [`/threads/${app.threadId}`, `/threads/${asking}`].toSorted(),
  );
  assert.equal(value.workstreams[0]?.name, "SMS updates");
  assert.equal(value.workstreams[0]?.threads, 2);
  // Reading Oriel's own data reads no item: it isn't the escape hatch.
  assert.deepEqual(
    run.run.reads.map((read) => [read.fn, read.outsideRegion]),
    [
      ["thread.find", false],
      ["thread.changeSets", false],
      ["thread.list", false],
      ["workstream.list", false],
    ],
  );
});

test("the window's search events say how long the query was and what it found, never its text", async (t) => {
  const app = await posted(t);
  for (const event of [
    { name: "threads.searched", queryLength: 9, results: 1 },
    { name: "threads.search-opened", opened: "change-set", rank: 1 },
  ])
    assert.equal((await app.post("/api/telemetry", event)).status, 202);
  assert.equal(
    (await app.post("/api/telemetry", { name: "threads.searched", query: "secret", results: 1 }))
      .status,
    400,
  );
  const events = app.app
    .telemetry()
    .filter((e) => e.name.startsWith("threads."))
    .map((e) => [e.name, e.data]);
  assert.deepEqual(events, [
    ["threads.searched", { queryLength: 9, results: 1 }],
    ["threads.search-opened", { opened: "change-set", rank: 1 }],
  ]);
});

// Its script runs in the real sandbox, as `pnpm dev`'s do. This spawns Deno.
test("the dev server's scripted agent answers where something happened with a link to it", async (t) => {
  const { createSandbox } = await import("@oriel/sandbox");
  const { devPlan, scriptedAgent } = await import("./scripted-agent.ts");
  const sandbox = createSandbox();
  const asking = await testApp(t, {
    writes: true,
    slack: { kind: "fixture", workspace: fixtureApi(loadSlackFixture()) },
    agent: (deps) => scriptedAgent({ ...deps, sandbox }, devPlan),
  });
  // A post proposed through the dev plan, then a question about it.
  const { id: workstreamId } = json<{ id: string }>(
    await asking.post("/api/workstreams", { kind: "picked", name: "SMS", items: [sms] }),
  );
  const { id: poster } = json<{ id: string }>(
    await asking.post(`/api/workstreams/${workstreamId}/threads`, { text: `post: ${testPost}` }),
  );
  await asking.app.settled();
  const proposed = json<ThreadView>(await asking.get(`/api/threads/${poster}`));
  const entry = proposed.entries.find((e) => e.kind === "change-set");
  assert.ok(entry?.kind === "change-set");
  const { id: thread } = json<{ id: string }>(
    await asking.post(`/api/workstreams/${workstreamId}/threads`, {
      text: "Where did I post the test?",
    }),
  );
  await asking.app.settled();
  const view = json<ThreadView>(await asking.get(`/api/threads/${thread}`));
  const replies = view.entries.flatMap((e) => (e.kind === "text" ? [e.text] : []));
  assert.ok(
    replies.includes(
      `It was this change set, in [post: ${testPost}](/threads/${poster}?changeSet=${entry.changeSetId}).`,
    ),
    replies.join("\n"),
  );
});
