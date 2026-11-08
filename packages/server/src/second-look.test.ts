// A second look at a change set (decision 0054) never makes a change set of
// its own, and a review link never shows it.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Bindings } from "@oriel/core";
import type { ThreadView } from "@oriel/web/view";
import { scriptedAgent } from "./scripted-agent.ts";
import { json, type Script, testApp } from "./testing.ts";

// The fare decision in Slack, with its later amendment as a reply.
const decision = "slack:C0FW1WEATHR-1788444000.000100";
const amendment = "ops agreed that next-day sailings now follow the same rule";
const sameDay = "Fares are kept on later sailings the same day only.";

// The thread's agent narrows SYN-45 to same-day sailings, and retitles it.
const propose: Script = async () => ({
  writes: [
    ["jira.setDescription", ["jira:SYN-45", sameDay]],
    ["jira.setSummary", ["jira:SYN-45", "Rebooking: keep the fare on the same day"]],
  ],
});

const finding = {
  kind: "conflict",
  lines: [1],
  says: "A later reply extends the decision to next-day sailings, which this drops.",
  evidence: [{ id: decision, quote: amendment }],
};
const companion = {
  kind: "companion",
  lines: [1],
  says: "The compensation copy should say the same as the story.",
  evidence: [{ id: "jira:SYN-45", quote: "We absorb the difference; we never charge it." }],
  changes: [1],
};

const recording =
  (findings: unknown, writes: [string, unknown[]][] = []): Script =>
  async (bindings: Bindings) => {
    await bindings.read("challenge.diff", []);
    await bindings.read("items.read", ["jira:SYN-45"]);
    const said = (await bindings.read("challenge.record", [findings])).value;
    return { value: said, writes };
  };

const setUp = async (
  t: Parameters<typeof testApp>[0],
  look: Script | null,
  options: Omit<Parameters<typeof testApp>[1], "slack" | "scripts" | "plan" | "challenger"> = {},
) => {
  const app = await testApp(t, {
    ...options,
    slack: { mode: "fixture" },
    scripts: { propose, ...(look ? { look } : {}) },
    plan: () => [{ run: "propose" }],
    ...(look ? { challenger: (deps) => scriptedAgent(deps, () => [{ run: "look" }]) } : {}),
  });
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", {
      kind: "picked",
      name: "Fares",
      items: ["jira:SYN-45", "jira:SYN-29", decision],
    }),
  );
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Same day only" }),
  );
  await app.app.settled();
  const view = async () => json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  // The person presses Second look, and the look runs to its end.
  const ask = async () => {
    const setId = (await view()).changeSets[0]?.id;
    assert.ok(setId);
    const asked = await app.post(`/api/change-sets/${setId}/second-look`);
    await app.app.settled();
    return asked;
  };
  return { app, threadId, view, ask };
};

test("a second look's writes make no change set of its own: they wait as a suggestion", async (t) => {
  const look = recording(
    [finding, companion],
    [["jira.setDescription", ["jira:SYN-29", "Your fare carries over to any later sailing."]]],
  );
  const { view, ask } = await setUp(t, look);
  await ask();
  const thread = await view();
  assert.equal(thread.changeSets.length, 1);
  const second = thread.changeSets[0]?.secondLook;
  assert.equal(second?.state, "ready");
  assert.equal(second?.companions.length, 1);
});

test("a review link's holder never sees the second look", async (t) => {
  const { app, view, ask } = await setUp(t, recording([finding]));
  await ask();
  const set = (await view()).changeSets[0];
  assert.ok(set?.secondLook);
  const minted = json<{ url: string }>(await app.post(`/api/change-sets/${set.id}/review-link`));
  const token = new URL(minted.url).pathname.split("/").at(-1);
  const opened = await app.post("/api/review/open", { token });
  assert.equal(opened.status, 200);
  assert.doesNotMatch(String(opened.body), /secondLook|next-day/);
});

test("what a thread's second looks spend counts toward the thread's token cap", async (t) => {
  const app = await testApp(t, {
    slack: { mode: "fixture" },
    scripts: { propose },
    plan: () => [{ run: "propose" }],
    limits: { maxTokensPerThread: 50_000 },
    // A look that spends the thread's budget and records nothing.
    challenger: () => ({
      async *turn() {
        yield { kind: "done", usage: { inputTokens: 40_000, outputTokens: 10_000 } };
      },
    }),
  });
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", { kind: "picked", name: "Fares", items: ["jira:SYN-45"] }),
  );
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Same day only" }),
  );
  await app.app.settled();
  const setId = json<ThreadView>(await app.get(`/api/threads/${threadId}`)).changeSets[0]?.id;
  await app.post(`/api/change-sets/${setId}/second-look`);
  await app.app.settled();
  const next = await app.post(`/api/threads/${threadId}/messages`, { text: "And?" });
  assert.equal(next.status, 409);
});
