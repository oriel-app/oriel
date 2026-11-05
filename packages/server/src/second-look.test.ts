// A second look at a change set (decision 0054): Oriel takes one only when
// the person asks, keeps only findings whose quotes are in their items word
// for word and that don't grade the change, says what it read, marks it
// stale when the diff or its items change, and lets the person add a change
// it suggested. It never makes a change set of its own, approving never
// waits on it, and a review link never shows it.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Bindings, ItemId, RunResult, Ulid } from "@oriel/core";
import { coverageOf } from "./challenger.ts";
import type { DiffView, ThreadView } from "@oriel/web/view";
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

test("a captured change set gets no second look until the person asks", async (t) => {
  const { app, view, ask } = await setUp(t, recording([finding]));
  const before = await view();
  // None was taken: the button offers one.
  assert.equal(before.changeSets[0]?.secondLook, null);
  assert.equal(
    app.app.telemetry().filter((e) => e.name.startsWith("challenge.")).length,
    0,
    "no model call nobody asked for",
  );
  assert.equal((await ask()).status, 200);
  assert.equal((await view()).changeSets[0]?.secondLook?.state, "ready");
});

test("a second look is kept with its checked quotes, what it read and its model", async (t) => {
  answers.length = 0;
  const look = recording(
    [finding, companion],
    [["jira.setDescription", ["jira:SYN-29", "Your fare carries over to any later sailing."]]],
  );
  const dir = mkdtempSync(join(tmpdir(), "oriel-look-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "oriel.db");
  const { app, view, ask } = await setUp(t, look, { db: path });
  await ask();
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
  // The model its runs ran on is on the look.
  const db = new DatabaseSync(path, { readOnly: true });
  t.after(() => db.close());
  assert.deepEqual({ ...db.prepare("select model from challenges").get() }, { model: "scripted" });
});

test("pressed again while a look is running or still current, Oriel takes no other", async (t) => {
  const { app, view, ask } = await setUp(t, recording([finding]));
  const setId = (await view()).changeSets[0]?.id;
  assert.ok(setId);
  // Twice at once: one look.
  await Promise.all([
    app.post(`/api/change-sets/${setId}/second-look`),
    app.post(`/api/change-sets/${setId}/second-look`),
  ]);
  await app.app.settled();
  const first = (await view()).changeSets[0]?.secondLook;
  assert.equal(first?.state, "ready");
  // Current, so a third press changes nothing.
  await ask();
  assert.equal((await view()).changeSets[0]?.secondLook?.id, first?.id);
  assert.equal(app.app.telemetry().filter((e) => e.name === "challenge.made").length, 1);
});

test("approving never waits on a running second look, and a decided change set takes none", async (t) => {
  // A look that runs until the test lets it end.
  let finish = () => {};
  const held = new Promise<void>((resolve) => (finish = resolve));
  const app = await testApp(t, {
    slack: { mode: "fixture" },
    writes: true,
    scripts: { propose },
    plan: () => [{ run: "propose" }],
    challenger: () => ({
      async *turn() {
        await held;
        yield { kind: "done", usage: { inputTokens: 10, outputTokens: 1 } };
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
  assert.ok(setId);
  assert.equal((await app.post(`/api/change-sets/${setId}/second-look`)).status, 200);
  const running = json<ThreadView>(await app.get(`/api/threads/${threadId}`)).changeSets[0];
  assert.equal(running?.secondLook?.state, "running");
  const { hash } = json<DiffView>(await app.post(`/api/change-sets/${setId}/diff`));
  app.advance(1000);
  assert.equal((await app.post(`/api/change-sets/${setId}/approve`, { hash })).status, 200);
  finish();
  await app.app.settled();
  const decided = json<ThreadView>(await app.get(`/api/threads/${threadId}`)).changeSets[0];
  assert.equal(decided?.status, "applied");
  // Decided, it shows no second look and takes none.
  assert.equal(decided?.secondLook, undefined);
  assert.equal((await app.post(`/api/change-sets/${setId}/second-look`)).status, 403);
});

test("a quote not in its item, or a finding that grades the change, keeps nothing", async (t) => {
  answers.length = 0;
  const look = recording([
    { ...finding, evidence: [{ id: decision, quote: "ops agreed to everything" }] },
    { ...finding, says: "Looks good, safe to approve." },
    { ...finding, lines: [9] },
  ]);
  const { view, ask } = await setUp(t, look);
  await ask();
  const second = (await view()).changeSets[0]?.secondLook;
  assert.equal(second?.state, "failed");
  assert.deepEqual(second?.findings, []);
  const [said] = answers;
  assert.match(said ?? "", /quote 1: not in .* word for word/);
  assert.match(said ?? "", /"Looks good" grades the change/);
  assert.match(said ?? "", /the diff has no line 9/);
});

test("an edit makes the second look stale, and Look again takes another", async (t) => {
  const { app, view, ask } = await setUp(t, recording([finding]));
  await ask();
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
  assert.equal((await ask()).status, 200);
  const fresh = (await view()).changeSets[0]?.secondLook;
  assert.notEqual(fresh?.id, stale?.id);
  assert.deepEqual(fresh?.stale, { diff: false, items: [] });
});

test("the person adds a suggested change, which joins the change set for review", async (t) => {
  const look = recording(
    [companion],
    [["jira.setDescription", ["jira:SYN-29", "Your fare carries over to any later sailing."]]],
  );
  const { app, view, ask } = await setUp(t, look);
  await ask();
  const set = (await view()).changeSets[0];
  const second = set?.secondLook;
  assert.ok(set && second);
  // Two clicks at once add it once.
  const added = await Promise.all(
    [0, 1].map(() =>
      app.post(`/api/change-sets/${set.id}/suggestions`, { look: second.id, places: [0] }),
    ),
  );
  assert.deepEqual(added.map((reply) => reply.status).sort(), [200, 404]);
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
        places: [0],
      })
    ).status,
    404,
  );
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

test("with no challenger, as with the scripted dev agent, no second look is offered", async (t) => {
  const { view, ask } = await setUp(t, null);
  const [set] = (await view()).changeSets;
  assert.ok(set);
  assert.equal(set.secondLook, undefined);
  assert.equal((await ask()).status, 403);
});

test("a finding may quote what a line of the diff would write, checked word for word against it", async (t) => {
  answers.length = 0;
  const written = {
    kind: "conflict",
    lines: [1],
    says: "The new description drops next-day sailings, which a later reply extended the rule to.",
    evidence: [
      { line: 1, quote: "the same day only" },
      { id: decision, quote: amendment },
    ],
  };
  const { view, ask } = await setUp(t, recording([written]));
  await ask();
  const second = (await view()).changeSets[0]?.secondLook;
  assert.equal(second?.state, "ready");
  assert.deepEqual(
    second?.findings[0]?.evidence.map((e) => [e.id, e.line]),
    [
      [null, 1],
      [decision, null],
    ],
  );
  // Words the line wouldn't write keep nothing.
  answers.length = 0;
  const refused = await setUp(
    t,
    recording([{ ...written, evidence: [{ line: 1, quote: "next-day sailings too" }] }]),
  );
  await refused.ask();
  assert.equal((await refused.view()).changeSets[0]?.secondLook?.state, "failed");
  assert.match(answers[0] ?? "", /not in what line 1 would write word for word/);
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
  const look = json<ThreadView>(await app.get(`/api/threads/${threadId}`)).changeSets[0]
    ?.secondLook;
  assert.equal(look?.state, "failed");
  const next = await app.post(`/api/threads/${threadId}/messages`, { text: "And?" });
  assert.equal(next.status, 409);
  assert.match(String(next.body), /used its 50,000 tokens/);
});

test("an item that changes while the look runs leaves it stale", async (t) => {
  let during = async () => {};
  const look: Script = async (bindings: Bindings) => {
    await bindings.read("challenge.diff", []);
    await bindings.read("items.read", ["jira:SYN-45"]);
    await during();
    return { value: (await bindings.read("challenge.record", [[finding]])).value, writes: [] };
  };
  const { app, view, ask } = await setUp(t, look, { live: true });
  during = async () => {
    app.site?.edit("SYN-45", { status: "Done" });
    app.advance(60_000);
    assert.equal((await app.sync("jira")).status, 200);
  };
  await ask();
  const second = (await view()).changeSets[0]?.secondLook;
  assert.equal(second?.state, "ready");
  assert.deepEqual(second?.stale, { diff: false, items: ["jira:SYN-45"] });
});

test("a read that lists the region counts every item it lists toward what the look read", () => {
  const region = ["jira:SYN-29", "jira:SYN-45", "slack:C1-1.000100"] as ItemId[];
  const ran = (...fns: string[]) =>
    ({
      reads: fns.map((fn) => ({ fn, args: [], status: "answered", ms: 1 })),
    }) as unknown as RunResult;
  assert.deepEqual(coverageOf([ran("jira.listItems")], region), {
    read: ["jira:SYN-29", "jira:SYN-45"],
    of: 3,
    searches: 0,
  });
  assert.deepEqual(coverageOf([ran("items.list")], region).read, region);
});

test("Dismiss hides a look, and Second look shows it again while current, with no model call", async (t) => {
  const { app, view, ask } = await setUp(t, recording([finding]));
  await ask();
  const set = (await view()).changeSets[0];
  const shown = set?.secondLook;
  assert.ok(set && shown);
  assert.equal(shown.dismissed, false);
  const dismiss = (look: string) =>
    app.post(`/api/change-sets/${set.id}/second-look/dismiss`, { look });
  assert.equal((await dismiss(shown.id)).status, 200);
  assert.equal((await view()).changeSets[0]?.secondLook?.dismissed, true);
  // Twice is once; another look's ID is no look of this change set.
  assert.equal((await dismiss(shown.id)).status, 200);
  assert.equal((await dismiss("01JBZ00000000000000000000Z")).status, 404);
  await ask();
  const again = (await view()).changeSets[0]?.secondLook;
  assert.deepEqual([again?.id, again?.dismissed], [shown.id, false]);
  assert.equal(app.app.telemetry().filter((e) => e.name === "challenge.made").length, 1);
});

test("dismissing a running look stops it, and Look again takes another", async (t) => {
  // A look that runs until it is stopped.
  const app = await testApp(t, {
    slack: { mode: "fixture" },
    scripts: { propose },
    plan: () => [{ run: "propose" }],
    challenger: () => ({
      async *turn(_input, { signal }) {
        await new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason)),
        );
        yield { kind: "done", usage: { inputTokens: 0, outputTokens: 0 } };
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
  const view = async () => json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  const setId = (await view()).changeSets[0]?.id;
  assert.ok(setId);
  await app.post(`/api/change-sets/${setId}/second-look`);
  const running = (await view()).changeSets[0]?.secondLook;
  assert.equal(running?.state, "running");
  await app.post(`/api/change-sets/${setId}/second-look/dismiss`, { look: running?.id });
  await app.app.settled();
  const stopped = (await view()).changeSets[0]?.secondLook;
  assert.deepEqual(
    [stopped?.state, stopped?.error, stopped?.dismissed],
    ["failed", "You dismissed it before it finished.", true],
  );
  await app.post(`/api/change-sets/${setId}/second-look`);
  const next = (await view()).changeSets[0]?.secondLook;
  assert.notEqual(next?.id, running?.id);
  // Closing the app stops it.
  assert.deepEqual([next?.state, next?.dismissed], ["running", false]);
});

test("every suggestion not yet added joins the change set in one edit", async (t) => {
  const other = { ...companion, changes: [2] };
  const look = recording(
    [companion, other],
    [
      ["jira.setDescription", ["jira:SYN-29", "Your fare carries over to any later sailing."]],
      ["jira.setSummary", ["jira:SYN-29", "Compensation: any later sailing"]],
    ],
  );
  const { app, view, ask } = await setUp(t, look);
  await ask();
  const set = (await view()).changeSets[0];
  const second = set?.secondLook;
  assert.ok(set && second);
  assert.equal(second.companions.length, 2);
  const added = await app.post(`/api/change-sets/${set.id}/suggestions`, {
    look: second.id,
    places: [0, 1],
  });
  assert.equal(added.status, 200);
  const diff = json<{ lines: unknown[] }>(await app.post(`/api/change-sets/${set.id}/diff`));
  assert.equal(diff.lines.length, 4);
  const after = (await view()).changeSets[0]?.secondLook;
  assert.deepEqual(
    after?.companions.map((c) => c.added),
    [true, true],
  );
  assert.equal(app.app.telemetry().filter((e) => e.name === "challenge.companion-added").length, 2);
});

test("a rejection undone brings back the change set's second look, as it was", async (t) => {
  const { app, view, ask } = await setUp(t, recording([finding]));
  await ask();
  const set = (await view()).changeSets[0];
  const look = set?.secondLook;
  assert.ok(set && look);
  const { hash } = json<DiffView>(await app.post(`/api/change-sets/${set.id}/diff`));
  const rejected = json<{ undo: { action: string; input: unknown } }>(
    await app.post(`/api/change-sets/${set.id}/reject`, { hash }),
  );
  assert.equal((await view()).changeSets[0]?.secondLook, undefined);
  const { action, input } = rejected.undo;
  assert.equal((await app.post(`/api/actions/${action}`, input)).status, 200);
  const back = (await view()).changeSets[0];
  assert.equal(back?.status, "open");
  assert.deepEqual([back?.secondLook?.id, back?.secondLook?.stale.diff], [look.id, false]);
});

test("a look dismissed after it recorded keeps nothing, even when its turn ends as done", async (t) => {
  const runId = "01JBZ0000000000000000000R1" as Ulid;
  // As the agent's own loop does: it records, then ends a stopped turn as
  // done rather than throw.
  const app = await testApp(t, {
    slack: { mode: "fixture" },
    scripts: { propose },
    plan: () => [{ run: "propose" }],
    challenger: () => ({
      async *turn(input, { signal }) {
        const related = {
          kind: "related",
          lines: [1],
          says: "The story already says who pays the difference.",
          evidence: [{ id: "jira:SYN-45", quote: "We absorb the difference; we never charge it." }],
        };
        await input.challenge?.record(runId, [related]);
        await new Promise((resolve) => signal.addEventListener("abort", resolve));
        const result: RunResult = {
          reads: [],
          mutations: [],
          intents: [],
          drafts: [],
          transcript: [],
          outcome: "ok",
          wallMs: 1,
          coldStartMs: null,
        };
        yield { kind: "run.finished", runId, result };
        yield { kind: "done", usage: { inputTokens: 1, outputTokens: 1 } };
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
  const view = async () => json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  const setId = (await view()).changeSets[0]?.id;
  await app.post(`/api/change-sets/${setId}/second-look`);
  const running = (await view()).changeSets[0]?.secondLook;
  await app.post(`/api/change-sets/${setId}/second-look/dismiss`, { look: running?.id });
  await app.app.settled();
  const stopped = (await view()).changeSets[0]?.secondLook;
  assert.deepEqual(
    [stopped?.state, stopped?.findings, stopped?.error],
    ["failed", [], "You dismissed it before it finished."],
  );
});
