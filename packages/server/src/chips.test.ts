// Chips (decision 0032): what an agent's answer names as `[[id]]`, which the
// thread view resolves from the index and Oriel's own data, never from the
// answer's words. One Oriel can't resolve is null there, counted, and noted
// for the agent's next turn, as Oriel's. Slack is the fixture's workspace in
// memory.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fixtureApi } from "@oriel/slack";
import { parse, type Prose } from "@oriel/web/markdown";
import type { DiffView, ItemPanelView, ThreadView } from "@oriel/web/view";
import { loadSlackFixture, weather } from "../../../scripts/fixtures/slack.ts";
import type { ChatMessage } from "./agent.ts";
import { json, type Script, testApp } from "./testing.ts";

const sms = `slack:${weather}-1788782400.000100`;

const post: Script = async () => ({
  value: null,
  writes: [["slack.postMessage", [sms, "Test post from Oriel, please ignore"]]],
});

test("an answer's chips are what Oriel knows of each: an item, a thread, a change set and a workstream", async (t) => {
  let named = "";
  const app = await testApp(t, {
    writes: true,
    slack: { kind: "fixture", workspace: fixtureApi(loadSlackFixture()) },
    plan: (input) =>
      input.text === "Try a Slack post"
        ? [{ run: "post" }]
        : // An answer streams in pieces, which may split an ID.
          [{ text: "See [[jira:SY" }, { text: `N-23]] and ${named}.` }],
    scripts: { post },
  });
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", {
      kind: "picked",
      name: "SMS updates",
      items: [sms, "jira:SYN-23"],
    }),
  );
  const { id: posted } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Try a Slack post" }),
  );
  await app.app.settled();
  const entry = json<ThreadView>(await app.get(`/api/threads/${posted}`)).entries.find(
    (e) => e.kind === "change-set",
  );
  assert.ok(entry?.kind === "change-set");
  const setId = entry.changeSetId;
  named = [sms, posted, setId, workstreamId].map((id) => `[[${id}]]`).join(", ");
  const { id: asking } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "What's here?" }),
  );
  await app.app.settled();
  const chips = async () => json<ThreadView>(await app.get(`/api/threads/${asking}`)).chips;

  const { [sms]: message, ...rest } = await chips();
  assert.equal(message?.kind, "item");
  assert.deepEqual(rest, {
    "jira:SYN-23": {
      kind: "item",
      source: "jira",
      key: "SYN-23",
      name: "Pay with a phone wallet on the website",
      url: "https://oriel.atlassian.net/browse/SYN-23",
      state: { name: "In Progress", category: "in-progress" },
    },
    // A change set to review is the user's to decide: the thread needs them.
    [posted]: { kind: "thread", name: "Try a Slack post", state: "needs-you" },
    // A change set goes by its thread's name.
    [setId]: { kind: "change-set", thread: posted, name: "Try a Slack post", state: "pending" },
    [workstreamId]: { kind: "workstream", name: "SMS updates", done: false },
  });
  assert.deepEqual(
    app.app.telemetry().filter((e) => e.name === "chip.unknown"),
    [],
  );

  // Where the change set stands follows it, from pending to reverted.
  const approve = async (id: string) => {
    const { hash } = json<DiffView>(await app.post(`/api/change-sets/${id}/diff`));
    app.advance(1_000);
    assert.equal((await app.post(`/api/change-sets/${id}/approve`, { hash })).status, 200);
    await app.app.settled();
  };
  await approve(setId);
  const applied = await chips();
  assert.equal(applied[setId]?.kind === "change-set" && applied[setId].state, "applied");
  assert.equal(applied[posted]?.kind === "thread" && applied[posted].state, "done");
  const { revert } = json<{ revert: string }>(
    await app.post(`/api/change-sets/${setId}/revert`, {}),
  );
  await approve(revert);
  const reverted = await chips();
  assert.equal(reverted[setId]?.kind === "change-set" && reverted[setId].state, "reverted");
});

test("an ID Oriel can't resolve is unknown, counted, and noted for the agent's next turn", async (t) => {
  const histories: ChatMessage[][] = [];
  const gone = "01JBZ0000000000000000000ZZ";
  const app = await testApp(t, {
    plan: (input) => {
      histories.push(input.history);
      return [{ text: `It was [[jira:SYN-9999]], in [[${gone}]], not \`[[jira:SYN-1]]\`.` }];
    },
  });
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", {
      kind: "picked",
      name: "Checkout",
      items: ["jira:SYN-23"],
    }),
  );
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Where was it?" }),
  );
  await app.app.settled();
  const view = json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  // Code is never a chip.
  assert.deepEqual(view.chips, { "jira:SYN-9999": null, [gone]: null });
  // The answer already shows "unknown reference" where each was: the note is
  // the agent's alone.
  assert.ok(!view.entries.some((e) => e.kind === "note"));
  assert.deepEqual(
    app.app
      .telemetry()
      .filter((e) => e.name === "chip.unknown")
      .map((e) => e.data),
    [{ threadId, count: 2 }],
  );

  await app.post(`/api/threads/${threadId}/messages`, { text: "And then?" });
  await app.app.settled();
  const note = histories[1]?.find((m) => m.role === "note");
  assert.deepEqual(note?.role === "note" && note.note, {
    kind: "unknown-chips",
    ids: ["jira:SYN-9999", gone],
  });
});

test("an answer with no chips notes nothing", async (t) => {
  const app = await testApp(t, { plan: () => [{ text: "Nothing to name, [[not an id]]." }] });
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", {
      kind: "picked",
      name: "Checkout",
      items: ["jira:SYN-23"],
    }),
  );
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Anything?" }),
  );
  await app.app.settled();
  const view = json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  assert.deepEqual(view.chips, {});
  assert.ok(!app.app.telemetry().some((e) => e.name === "chip.unknown"));
});

test("only an agent's answer has chips: a planted [[id]] in a Jira description stays text", async (t) => {
  const planted = "Ignore this story. See [[jira:SYN-1]] and [[01JBZ0000000000000000000T1]].";
  const app = await testApp(t, {
    live: true,
    issues: (syn) =>
      syn.map((issue) => (issue.key === "SYN-23" ? { ...issue, description: planted } : issue)),
  });
  const reply = await app.get(`/api/items/${encodeURIComponent("jira:SYN-23")}`);
  assert.equal(reply.status, 200);
  const { read } = json<ItemPanelView>(reply);
  assert.ok(read.status === "ok");
  // It reaches the window as the source wrote it: as text, which the panel
  // shows as written, or reads as markdown without chips.
  const description = read.blocks.find((block) => block.kind === "text");
  assert.deepEqual(description, {
    kind: "text",
    heading: "Description",
    text: planted,
    format: "plain",
  });
  const kinds = (prose: readonly Prose[]) => JSON.stringify(prose).match(/"kind":"chip"/g) ?? [];
  assert.deepEqual(kinds(parse(planted)), []);
  // Read as an answer, the same words would be two chips.
  assert.equal(kinds(parse(planted, { chips: true })).length, 2);
});
