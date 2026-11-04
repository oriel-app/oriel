// A second look at a change set (the challenger spike): Oriel starts it once
// a turn captures a change set, keeps only findings whose quotes are in
// their items word for word and that don't grade the change, says what it
// read, marks it stale when the diff or its items change, and lets the
// person add a change it suggested. It never makes a change set of its own,
// and a review link never shows it.
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

// What each record() answered, in order.
const answers: string[] = [];
const recording =
  (findings: unknown, writes: [string, unknown[]][] = []): Script =>
  async (bindings: Bindings) => {
    await bindings.read("challenge.diff", []);
    await bindings.read("items.read", ["jira:SYN-45"]);
    const said = (await bindings.read("challenge.record", [findings])).value;
    answers.push(String(said));
    return { value: said, writes };
  };

const setUp = async (
  t: Parameters<typeof testApp>[0],
  look: Script | null,
  plan = [{ run: "propose" }],
) => {
  const app = await testApp(t, {
    slack: { mode: "fixture" },
    scripts: { propose, ...(look ? { look } : {}) },
    plan: () => plan,
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
  return { app, threadId, view };
};

test("a captured change set gets one second look, kept with its checked quotes and what it read", async (t) => {
  answers.length = 0;
  const look = recording(
    [finding, companion],
    [["jira.setDescription", ["jira:SYN-29", "Your fare carries over to any later sailing."]]],
  );
  const { app, view } = await setUp(t, look);
  const thread = await view();
  // The second look made no change set of its own.
  assert.equal(thread.changeSets.length, 1);
  const [set] = thread.changeSets;
  const second = set?.secondLook;
  assert.ok(second);
  assert.equal(second.state, "ready");
  assert.deepEqual(
    second.findings.map((f) => [f.kind, f.evidence.map((e) => [e.id, e.outside])]),
    [
      ["conflict", [[decision, false]]],
      ["companion", [["jira:SYN-45", false]]],
    ],
  );
  assert.equal(second.findings[1]?.changes.length, 1);
  assert.equal(second.companions.length, 1);
  assert.match(second.companions[0]?.sentence ?? "", /SYN-29/);
  // What it read is Oriel's count, from its runs' records.
  assert.deepEqual(second.coverage, { read: ["jira:SYN-45"], of: 3, searches: 0 });
  assert.deepEqual(second.stale, { diff: false, items: [] });
  // Its evidence is drawn as chips.
  assert.ok(thread.chips[decision]);
  assert.match(answers[0] ?? "", /kept 2 findings/);
  const made = app.app.telemetry().filter((e) => e.name === "challenge.made");
  assert.equal(made.length, 1);
  assert.deepEqual(made[0]?.data["kinds"], { conflict: 1, companion: 1 });
});

test("a quote not in its item, or a finding that grades the change, keeps nothing", async (t) => {
  answers.length = 0;
  const look = recording([
    { ...finding, evidence: [{ id: decision, quote: "ops agreed to everything" }] },
    { ...finding, says: "Looks good, safe to approve." },
    { ...finding, lines: [9] },
  ]);
  const { view } = await setUp(t, look);
  const second = (await view()).changeSets[0]?.secondLook;
  assert.equal(second?.state, "failed");
  assert.deepEqual(second?.findings, []);
  const [said] = answers;
  assert.match(said ?? "", /quote 1: not in .* word for word/);
  assert.match(said ?? "", /"Looks good" grades the change/);
  assert.match(said ?? "", /the diff has no line 9/);
});

test("an edit makes the second look stale, and Look again takes another", async (t) => {
  const { app, view } = await setUp(t, recording([finding]));
  const set = (await view()).changeSets[0];
  assert.ok(set);
  // Its diff first, as the person sees it, then one line left out.
  const diff = json<{ lines: { mutationId: string }[] }>(
    await app.post(`/api/change-sets/${set.id}/diff`),
  );
  const second = diff.lines[1]?.mutationId;
  assert.equal(
    (await app.post(`/api/change-sets/${set.id}/edit`, { remove: [second] })).status,
    200,
  );
  const stale = (await view()).changeSets[0]?.secondLook;
  assert.deepEqual(stale?.stale, { diff: true, items: [] });
  assert.equal((await app.post(`/api/change-sets/${set.id}/look-again`)).status, 200);
  await app.app.settled();
  const fresh = (await view()).changeSets[0]?.secondLook;
  assert.notEqual(fresh?.id, stale?.id);
  assert.deepEqual(fresh?.stale, { diff: false, items: [] });
});

test("the person adds a suggested change, which joins the change set for review", async (t) => {
  const look = recording(
    [companion],
    [["jira.setDescription", ["jira:SYN-29", "Your fare carries over to any later sailing."]]],
  );
  const { app, view } = await setUp(t, look);
  const set = (await view()).changeSets[0];
  const second = set?.secondLook;
  assert.ok(set && second);
  const added = await app.post(`/api/change-sets/${set.id}/suggestions`, {
    look: second.id,
    place: 0,
  });
  assert.equal(added.status, 200);
  const after = (await view()).changeSets[0];
  const diff = json<{ lines: { target: { key: string } | null }[] }>(
    await app.post(`/api/change-sets/${set.id}/diff`),
  );
  assert.deepEqual(
    diff.lines.map((line) => line.target?.key),
    ["SYN-45", "SYN-45", "SYN-29"],
  );
  assert.equal(after?.secondLook?.companions[0]?.added, true);
  // It read a diff without that change: it says so.
  assert.equal(after?.secondLook?.stale.diff, true);
  // Twice is refused.
  assert.equal(
    (
      await app.post(`/api/change-sets/${set.id}/suggestions`, {
        look: second.id,
        place: 0,
      })
    ).status,
    404,
  );
});

test("a review link's holder never sees the second look", async (t) => {
  const { app, view } = await setUp(t, recording([finding]));
  const set = (await view()).changeSets[0];
  assert.ok(set?.secondLook);
  const minted = json<{ url: string }>(await app.post(`/api/change-sets/${set.id}/review-link`));
  const token = new URL(minted.url).pathname.split("/").at(-1);
  const opened = await app.post("/api/review/open", { token });
  assert.equal(opened.status, 200);
  assert.doesNotMatch(String(opened.body), /secondLook|next-day/);
});

test("with no challenger, as with the scripted dev agent, no second look is taken", async (t) => {
  const { view } = await setUp(t, null);
  const [set] = (await view()).changeSets;
  assert.ok(set);
  assert.equal(set.secondLook, undefined);
});
