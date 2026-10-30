import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type {
  ChangeSetView,
  DiffView,
  GroupSummary,
  GroupView,
  ReviewView,
  StreamEvent,
  ThreadSummaryView,
  ThreadView,
} from "@oriel/web/view";
import type { Agent } from "./agent.ts";
import { host, json, type Script, t0, testApp } from "./testing.ts";

// SYN-1's epic cluster is keyed by the epic's stable ID.
const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };

async function group(t: TestContext, options: Parameters<typeof testApp>[1] = {}) {
  const app = await testApp(t, options);
  const created = await app.post("/api/groups", checkout);
  assert.equal(created.status, 201);
  const summary = json<GroupSummary>(created);
  return { ...app, groupId: summary.id, summary };
}

async function thread(t: TestContext, text: string, options: Parameters<typeof testApp>[1] = {}) {
  const app = await group(t, options);
  const opened = await app.post(`/api/groups/${app.groupId}/threads`, { text });
  assert.equal(opened.status, 201);
  const { id } = json<{ id: string }>(opened);
  await app.app.settled();
  const view = async () => json<ThreadView>(await app.get(`/api/threads/${id}`));
  return { ...app, threadId: id, view };
}

const names = (app: { app: { telemetry(): { name: string }[] } }) =>
  app.app.telemetry().map((event) => event.name);

test("a cluster becomes a group in one request: a copy of its members, anchor first", async (t) => {
  const { get, groupId, summary, app } = await group(t);
  assert.equal(summary.origin.kind, "cluster");
  assert.equal(summary.version, 1);
  const view = json<GroupView>(await get(`/api/groups/${groupId}`));
  assert.equal(view.members[0]?.ref.id, "jira:SYN-1");
  assert.equal(view.members.length, summary.size);
  assert.ok(view.members.every((m) => m.row !== null));
  const listed = json<{ groups: GroupSummary[] }>(await get("/api/groups"));
  assert.deepEqual(
    listed.groups.map((g) => g.id),
    [groupId],
  );
  assert.deepEqual(app.telemetry().at(-1), {
    name: "group.created",
    at: t0,
    data: { groupId, origin: "cluster", size: summary.size },
  });
});

test("hand-picked items make a group; adding and removing each take a version", async (t) => {
  const app = await testApp(t);
  const created = await app.post("/api/groups", {
    kind: "picked",
    name: "Launch risks",
    items: ["jira:SYN-10", "jira:SYN-21"],
  });
  assert.equal(created.status, 201);
  const { id } = json<GroupSummary>(created);
  const added = json<GroupView>(
    await app.post(`/api/groups/${id}/add`, { items: ["jira:SYN-3", "jira:SYN-10"] }),
  );
  assert.equal(added.group.version, 2);
  assert.deepEqual(
    added.members.map((m) => m.ref.key),
    ["SYN-10", "SYN-21", "SYN-3"],
  );
  assert.deepEqual(
    added.changes[0]?.added.map((r) => r.key),
    ["SYN-3"],
  );
  const removed = json<GroupView>(
    await app.post(`/api/groups/${id}/remove`, { items: ["jira:SYN-21"] }),
  );
  assert.equal(removed.group.version, 3);
  assert.deepEqual(
    removed.members.map((m) => m.ref.key),
    ["SYN-10", "SYN-3"],
  );
  const renamed = json<GroupSummary>(
    await app.post(`/api/groups/${id}/rename`, { name: "Launch" }),
  );
  assert.deepEqual([renamed.name, renamed.version], ["Launch", 3]);
  assert.deepEqual(
    names(app).filter((n) => n.startsWith("group.")),
    ["group.created", "group.item-added"],
  );
  // An item the window doesn't have, or one the group doesn't hold, is refused.
  assert.equal((await app.post(`/api/groups/${id}/add`, { items: ["jira:SYN-27"] })).status, 400);
  assert.equal(
    (await app.post(`/api/groups/${id}/remove`, { items: ["jira:SYN-21"] })).status,
    400,
  );
  assert.equal(
    (await app.post("/api/groups", { kind: "picked", name: "x", items: [] })).status,
    400,
  );
});

test("every POST needs this server's Origin, JSON, and a body within its cap", async (t) => {
  const app = await testApp(t);
  const picked = { kind: "picked", name: "x", items: ["jira:SYN-10"] };
  const cross = await app.post("/api/groups", picked, { origin: "https://attacker.example" });
  assert.equal(cross.status, 403);
  const none = await app.handle({
    method: "POST",
    url: "/api/groups",
    headers: { host, "content-type": "application/json" },
    body: app.body(JSON.stringify(picked)),
  });
  assert.equal(none.status, 403);
  assert.equal(
    (await app.post("/api/groups", picked, { "content-type": "text/plain" })).status,
    415,
  );
  const huge = { ...picked, name: "x".repeat(70_000) };
  assert.equal((await app.post("/api/groups", huge)).status, 413);
  const broken = await app.handle({
    method: "POST",
    url: "/api/groups",
    headers: { host, origin: `http://${host}`, "content-type": "application/json" },
    body: app.body("{"),
  });
  assert.equal(broken.status, 400);
  assert.equal((await app.get("/api/groups", { origin: "https://attacker.example" })).status, 403);
  const wrongMethod = await app.handle({
    method: "DELETE",
    url: "/api/groups",
    headers: { host, origin: `http://${host}` },
  });
  assert.equal(wrongMethod.status, 405);
  assert.equal((await app.get("/api/groups/01ARZ3NDEKTSV4RRFFQ69G5FAV")).status, 404);
});

test("a thread answers a question: text, a run's transcript, then done", async (t) => {
  const listed: Script = async (bindings) => ({
    value: (await bindings.read("items.list", [])).value,
    logs: ["read every item"],
  });
  const app = await thread(t, "What's in here?", {
    plan: () => [{ text: "Here " }, { text: "it is." }, { run: "list" }, { text: "Done." }],
    scripts: { list: listed },
  });
  const view = await app.view();
  assert.equal(view.title, "What's in here?");
  assert.equal(view.state, "working");
  assert.equal(view.running, false);
  assert.deepEqual(
    view.entries.map((e) => e.kind),
    ["user", "text", "text", "run.started", "run.finished", "text", "done"],
  );
  const finished = view.entries.find((e) => e.kind === "run.finished");
  assert.ok(finished?.kind === "run.finished");
  assert.deepEqual(finished.run.logs, ["read every item"]);
  assert.equal(finished.run.reads[0]?.fn, "items.list");
  assert.equal(view.members.length, app.summary.size);
  assert.deepEqual(names(app).slice(-2), ["thread.opened", "question.asked"]);
  const inbox = json<{ threads: ThreadSummaryView[] }>(await app.get("/api/threads"));
  assert.deepEqual(
    inbox.threads.map((s) => [s.id, s.state, s.group.id]),
    [[app.threadId, "working", app.groupId]],
  );
});

test("a group change shows in a working thread as a marker; a done one catches up later", async (t) => {
  const app = await thread(t, "Hi");
  await app.post(`/api/groups/${app.groupId}/add`, { items: ["jira:SYN-3"] });
  const moved = await app.view();
  assert.equal(moved.regionVersion, 2);
  const marker = moved.entries.at(-1);
  assert.ok(marker?.kind === "marker");
  assert.deepEqual(
    [marker.from, marker.to, marker.added.map((r) => r.key), marker.removed],
    [1, 2, ["SYN-3"], []],
  );
  // Done, it keeps its version while the group changes.
  app.advance(1000);
  const done = json<ThreadView>(await app.post(`/api/threads/${app.threadId}/done`));
  assert.deepEqual([done.state, done.doneBy], ["done", "marked"]);
  await app.post(`/api/groups/${app.groupId}/remove`, { items: ["jira:SYN-3"] });
  assert.equal((await app.view()).regionVersion, 2);
  // A new message makes it working, after a marker that catches it up.
  assert.equal(
    (await app.post(`/api/threads/${app.threadId}/messages`, { text: "And now?" })).status,
    202,
  );
  await app.app.settled();
  const caught = await app.view();
  assert.deepEqual([caught.state, caught.regionVersion], ["working", 3]);
  const kinds = caught.entries.map((e) => e.kind);
  assert.deepEqual(kinds.slice(kinds.lastIndexOf("marker"), kinds.lastIndexOf("marker") + 2), [
    "marker",
    "user",
  ]);
});

// Proposes 3 points for the first story in the region without an estimate.
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

async function proposed(t: TestContext) {
  const app = await thread(t, "Estimate what's missing", {
    plan: () => [{ run: "estimate" }],
    scripts: { estimate },
  });
  const view = await app.view();
  const entry = view.entries.find((e) => e.kind === "change-set");
  assert.ok(entry?.kind === "change-set");
  const id = entry.changeSetId;
  const diff = async () => json<DiffView>(await app.post(`/api/change-sets/${id}/diff`));
  return { ...app, changeSetId: id, diff };
}

test("a captured change set shows as a diff; read-only, approving says writing isn't configured", async (t) => {
  const app = await proposed(t);
  const view = await app.view();
  assert.equal(view.writable, false);
  assert.deepEqual(
    view.changeSets.map((s) => [s.id, s.status]),
    [[app.changeSetId, "open"]],
  );
  const diff = await app.diff();
  assert.equal(diff.lines.length, 1);
  assert.deepEqual(diff.lines[0]?.fields, [{ name: "points", before: null, after: "3" }]);
  const approve = await app.post(`/api/change-sets/${app.changeSetId}/approve`, {
    hash: diff.hash,
  });
  assert.equal(approve.status, 409);
  assert.match(json<{ error: string }>(approve).error, /Writing to Jira isn't configured here/);
  const reject = await app.post(`/api/change-sets/${app.changeSetId}/reject`, { hash: diff.hash });
  assert.equal(json<{ changeSet: ChangeSetView }>(reject).changeSet.status, "rejected");
  assert.ok(names(app).includes("changeset.decided"));
});

test("a line can be removed from a change set, which needs a fresh diff to decide", async (t) => {
  const twice: Script = async (bindings) => {
    const first = await estimate(bindings);
    const id = (first.value as string[])[0] ?? "";
    return { value: null, writes: [...(first.writes ?? []), ["jira.setSummary", [id, "Renamed"]]] };
  };
  const app = await thread(t, "Estimate and rename", {
    plan: () => [{ run: "twice" }],
    scripts: { twice },
  });
  const entry = (await app.view()).entries.find((e) => e.kind === "change-set");
  assert.ok(entry?.kind === "change-set");
  const id = entry.changeSetId;
  const before = json<DiffView>(await app.post(`/api/change-sets/${id}/diff`));
  assert.equal(before.lines.length, 2);
  const edited = await app.post(`/api/change-sets/${id}/edit`, {
    remove: [before.lines[1]?.mutationId],
  });
  assert.equal(edited.status, 200);
  const stale = await app.post(`/api/change-sets/${id}/reject`, { hash: before.hash });
  assert.equal(stale.status, 409);
  const after = json<DiffView>(await app.post(`/api/change-sets/${id}/diff`));
  assert.equal(after.lines.length, 1);
  assert.notEqual(after.hash, before.hash);
  assert.ok(names(app).includes("changeset.edited"));
});

test("search results come back as their own block, and count as the escape hatch", async (t) => {
  // A search step runs this script.
  const script = 'return await search("weather", 10);';
  const app = await thread(t, "find weather", {
    plan: () => [{ search: "weather" }],
    scripts: {
      [script]: async (bindings) => ({
        value: (await bindings.read("search", ["weather", 10])).value,
      }),
    },
  });
  const view = await app.view();
  const found = view.entries.find((e) => e.kind === "search");
  assert.ok(found?.kind === "search");
  assert.ok(found.hits.length > 0);
  for (const hit of found.hits) {
    assert.match(hit.title ?? "", /weather/i);
    assert.ok(hit.url === null || hit.url.startsWith("https://"));
  }
  // The weather epic isn't in the checkout group.
  assert.ok(found.hits.some((hit) => !hit.inRegion));
  const used = app.app.telemetry().find((e) => e.name === "escape-hatch.used");
  assert.equal(used?.data.threadId, app.threadId);
});

test("a review link works without the thread; its GET opens and decides nothing", async (t) => {
  const app = await proposed(t);
  const minted = await app.post(`/api/change-sets/${app.changeSetId}/review-link`);
  const url = new URL(json<{ url: string }>(minted).url);
  assert.equal(url.origin, `http://${host}`);
  const token = url.pathname.split("/").at(-1) ?? "";
  const page = await app.get(url.pathname);
  assert.equal(page.status, 200);
  assert.equal(page.headers["referrer-policy"], "no-referrer");
  assert.equal(page.headers["cache-control"], "no-store");
  assert.ok(!names(app).includes("review-link.opened"));
  const opened = await app.post("/api/review/open", { token });
  assert.equal(opened.status, 200);
  const review = json<ReviewView>(opened);
  assert.equal(review.diff.lines.length, 1);
  assert.equal(review.changeSet.status, "open");
  assert.ok(names(app).includes("review-link.opened"));
  const nameless = await app.post("/api/review/decide", {
    token,
    changeSet: app.changeSetId,
    kind: "rejected",
    name: " ",
    hash: review.diff.hash,
  });
  assert.equal(nameless.status, 400);
  const decided = await app.post("/api/review/decide", {
    token,
    changeSet: app.changeSetId,
    kind: "rejected",
    name: "Ana",
    hash: review.diff.hash,
  });
  const set = json<{ changeSet: ChangeSetView }>(decided).changeSet;
  assert.deepEqual(
    [set.status, set.decision?.via, set.decision?.by],
    ["rejected", "review-link", "Ana"],
  );
  // Deciding killed the link.
  assert.equal((await app.post("/api/review/open", { token })).status, 404);
  assert.equal((await app.post("/api/review/open", { token: "nonsense" })).status, 404);
});

// Reads a stream until `until` holds for an event, returning what it read.
async function read(
  stream: AsyncIterator<string>,
  until: (event: StreamEvent) => boolean,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for (;;) {
    const next = await stream.next();
    assert.ok(!next.done, "the stream ended early");
    const data = /^data: (.*)$/m.exec(next.value)?.[1];
    if (data === undefined) continue;
    const event = JSON.parse(data) as StreamEvent;
    events.push(event);
    if (until(event)) return events;
  }
}

test("a thread's events stream: what's stored first, then each new entry as it lands", async (t) => {
  const app = await thread(t, "Hi", { plan: () => [{ text: "One" }, { text: "Two" }] });
  const reply = await app.get(`/api/threads/${app.threadId}/events?after=1`);
  assert.equal(reply.headers["content-type"], "text/event-stream; charset=utf-8");
  assert.ok(reply.stream);
  const stream = reply.stream[Symbol.asyncIterator]();
  const backlog = await read(stream, (e) => e.type === "status");
  assert.deepEqual(
    backlog.map((e) => (e.type === "entry" ? e.entry.kind : e.type)),
    ["text", "text", "done", "status"],
  );
  await app.post(`/api/threads/${app.threadId}/messages`, { text: "Again" });
  const live = await read(stream, (e) => e.type === "status" && !e.running);
  assert.deepEqual(
    live.map((e) => (e.type === "entry" ? e.entry.kind : `status ${e.running}`)),
    ["user", "status true", "text", "text", "done", "status false"],
  );
  await stream.return?.();
  assert.deepEqual(await stream.next(), { value: undefined, done: true });
  // A reconnect resumes after the last entry it saw.
  const resumed = await app.get(`/api/threads/${app.threadId}/events`, { "last-event-id": "7" });
  assert.ok(resumed.stream);
  const rest = resumed.stream[Symbol.asyncIterator]();
  const after = await read(rest, (e) => e.type === "status");
  assert.deepEqual(
    after.map((e) => (e.type === "entry" ? e.entry.seq : e.type)),
    [8, "status"],
  );
  await rest.return?.();
});

// Thinks until stopped, then ends with its `done`, as the contract asks; or,
// breaking it, throws.
function waiting(keepsContract: boolean): Agent {
  return {
    async *turn(_input, { signal }) {
      yield { kind: "text", text: "Thinking" };
      try {
        await new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason)),
        );
      } catch (error) {
        if (!keepsContract) throw error;
      }
      yield { kind: "done", usage: { inputTokens: 3, outputTokens: 4 } };
    },
  };
}

test("one turn at a time per thread, and stopping one is explicit", async (t) => {
  for (const keepsContract of [true, false]) {
    const app = await group(t, { agent: () => waiting(keepsContract) });
    const { id } = json<{ id: string }>(
      await app.post(`/api/groups/${app.groupId}/threads`, { text: "First" }),
    );
    const busy = await app.post(`/api/threads/${id}/messages`, { text: "Second" });
    assert.equal(busy.status, 409);
    assert.deepEqual(json(await app.post(`/api/threads/${id}/stop`)), { stopped: true });
    await app.app.settled();
    const view = json<ThreadView>(await app.get(`/api/threads/${id}`));
    // Every turn ends with one `done`, and a stopped one says so last.
    assert.deepEqual(
      view.entries.map((e) => (e.kind === "error" ? e.message : e.kind)),
      ["user", "text", "done", "Stopped."],
    );
    assert.equal(view.running, false);
    assert.deepEqual(json(await app.post(`/api/threads/${id}/stop`)), { stopped: false });
  }
});

test("a turn gets the index snapshot and what earlier turns spent", async (t) => {
  const inputs: Parameters<Agent["turn"]>[0][] = [];
  const counting: Agent = {
    async *turn(input) {
      inputs.push(input);
      yield { kind: "done", usage: { inputTokens: 10, outputTokens: 2 } };
    },
  };
  const app = await group(t, { agent: () => counting });
  const { id } = json<{ id: string }>(
    await app.post(`/api/groups/${app.groupId}/threads`, { text: "One" }),
  );
  await app.app.settled();
  await app.post(`/api/threads/${id}/messages`, { text: "Two" });
  await app.app.settled();
  assert.deepEqual(
    inputs.map((input) => [input.text, input.spent, input.history.length]),
    [
      ["One", { inputTokens: 0, outputTokens: 0 }, 0],
      ["Two", { inputTokens: 10, outputTokens: 2 }, 1],
    ],
  );
  assert.ok(inputs.every((input) => typeof input.snapshot === "number" && input.snapshot > 0));
});
