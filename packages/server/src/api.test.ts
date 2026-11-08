import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type {
  ChangeSetView,
  DiffView,
  WorkstreamSummary,
  WorkstreamView,
  ReviewView,
  ThreadView,
} from "@oriel/web/view";
import type { Agent } from "./agent.ts";
import { host, json, type Script, testApp } from "./testing.ts";

// SYN-1's epic cluster is keyed by the epic's stable ID.
const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };

async function workstream(t: TestContext, options: Parameters<typeof testApp>[1] = {}) {
  const app = await testApp(t, options);
  const created = await app.post("/api/workstreams", checkout);
  assert.equal(created.status, 201);
  const summary = json<WorkstreamSummary>(created);
  return { ...app, workstreamId: summary.id, summary };
}

async function thread(t: TestContext, text: string, options: Parameters<typeof testApp>[1] = {}) {
  const app = await workstream(t, options);
  const opened = await app.post(`/api/workstreams/${app.workstreamId}/threads`, { text });
  assert.equal(opened.status, 201);
  const { id } = json<{ id: string }>(opened);
  await app.app.settled();
  const view = async () => json<ThreadView>(await app.get(`/api/threads/${id}`));
  return { ...app, threadId: id, view };
}

const names = (app: { app: { telemetry(): { name: string }[] } }) =>
  app.app.telemetry().map((event) => event.name);

test("every POST needs this server's Origin, JSON, and a body within its cap", async (t) => {
  const app = await testApp(t);
  const picked = { kind: "picked", name: "x", items: ["jira:SYN-10"] };
  const cross = await app.post("/api/workstreams", picked, { origin: "https://attacker.example" });
  assert.equal(cross.status, 403);
  const none = await app.handle({
    method: "POST",
    url: "/api/workstreams",
    headers: { host, "content-type": "application/json" },
    body: app.body(JSON.stringify(picked)),
  });
  assert.equal(none.status, 403);
  assert.equal(
    (await app.post("/api/workstreams", picked, { "content-type": "text/plain" })).status,
    415,
  );
  const huge = { ...picked, name: "x".repeat(70_000) };
  assert.equal((await app.post("/api/workstreams", huge)).status, 413);
  const broken = await app.handle({
    method: "POST",
    url: "/api/workstreams",
    headers: { host, origin: `http://${host}`, "content-type": "application/json" },
    body: app.body("{"),
  });
  assert.equal(broken.status, 400);
  assert.equal(
    (await app.get("/api/workstreams", { origin: "https://attacker.example" })).status,
    403,
  );
  const wrongMethod = await app.handle({
    method: "DELETE",
    url: "/api/workstreams",
    headers: { host, origin: `http://${host}` },
  });
  assert.equal(wrongMethod.status, 405);
  assert.equal((await app.get("/api/workstreams/01ARZ3NDEKTSV4RRFFQ69G5FAV")).status, 404);
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

test("a drop of more links than its cap is refused and changes nothing", async (t) => {
  const app = await workstream(t);
  const id = app.workstreamId;
  const before = app.summary.version;
  const dropped = await app.post(`/api/workstreams/${id}/drop`, {
    links: Array(51).fill("SYN-3"),
    files: [],
  });
  assert.equal(dropped.status, 400);
  const after = json<WorkstreamView>(await app.get(`/api/workstreams/${id}`));
  assert.equal(after.workstream.version, before);
});

test("where writing isn't configured, approving writes nothing and leaves the change set open", async (t) => {
  const app = await proposed(t);
  assert.equal((await app.view()).writable, false);
  const diff = await app.diff();
  const approve = await app.post(`/api/change-sets/${app.changeSetId}/approve`, {
    hash: diff.hash,
  });
  assert.equal(approve.status, 409);
  assert.equal((await app.view()).changeSets[0]?.status, "open");
});

type Undo = { action: string; input: { changeSet: string; decision: string } };

test("a rejection in the thread has an Undo, which puts it back to awaiting review, once", async (t) => {
  const app = await proposed(t);
  const { hash } = await app.diff();
  const reject = await app.post(`/api/change-sets/${app.changeSetId}/reject`, { hash });
  const { undo } = json<{ undo: Undo }>(reject);
  assert.deepEqual(undo.action, "changeset.unreject");
  assert.equal(undo.input.changeSet, app.changeSetId);
  app.advance(1000);
  const undone = await app.post(`/api/actions/${undo.action}`, undo.input);
  assert.equal(undone.status, 200);
  const view = await app.view();
  assert.equal(view.changeSets[0]?.status, "open");
  // Its Undo is spent: undoing it again changes nothing.
  assert.equal((await app.post(`/api/actions/${undo.action}`, undo.input)).status, 403);
  // Rejected again, the new rejection has its own Undo, and the old one
  // can't take it back.
  const again = json<{ undo: Undo }>(
    await app.post(`/api/change-sets/${app.changeSetId}/reject`, { hash }),
  );
  assert.notEqual(again.undo.input.decision, undo.input.decision);
  assert.equal((await app.post(`/api/actions/${undo.action}`, undo.input)).status, 403);
});

test("once the person has told the agent what was wrong, a rejection's Undo is refused", async (t) => {
  const app = await proposed(t);
  const { hash } = await app.diff();
  const { undo } = json<{ undo: Undo }>(
    await app.post(`/api/change-sets/${app.changeSetId}/reject`, { hash }),
  );
  app.advance(1000);
  await app.post(`/api/threads/${app.threadId}/messages`, { text: "Not 3, it's a 5" });
  await app.app.settled();
  const refused = await app.post(`/api/actions/${undo.action}`, undo.input);
  assert.equal(refused.status, 403);
  assert.equal(
    (await app.view()).changeSets.find((set) => set.id === app.changeSetId)?.status,
    "rejected",
  );
});

test("a rejection through a review link has no Undo, in the thread or on the link", async (t) => {
  const app = await proposed(t);
  const minted = json<{ url: string }>(
    await app.post(`/api/change-sets/${app.changeSetId}/review-link`),
  );
  const token = new URL(minted.url).pathname.split("/").at(-1) ?? "";
  const review = json<ReviewView>(await app.post("/api/review/open", { token }));
  const decided = await app.post("/api/review/decide", {
    token,
    changeSet: app.changeSetId,
    kind: "rejected",
    name: "Ana",
    hash: review.diff.hash,
  });
  assert.equal(decided.status, 200);
  assert.equal("undo" in json<object>(decided), false);
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
    const app = await workstream(t, { agent: () => waiting(keepsContract) });
    const { id } = json<{ id: string }>(
      await app.post(`/api/workstreams/${app.workstreamId}/threads`, { text: "First" }),
    );
    const busy = await app.post(`/api/threads/${id}/messages`, { text: "Second" });
    assert.equal(busy.status, 409);
    assert.deepEqual(json(await app.post(`/api/threads/${id}/stop`)), { stopped: true });
    await app.app.settled();
    const view = json<ThreadView>(await app.get(`/api/threads/${id}`));
    // Every turn ends with one `done`, and a stopped one says so last.
    assert.deepEqual(
      view.entries.map((e) => e.kind),
      ["user", "text", "done", "error"],
    );
    assert.equal(view.running, false);
    assert.deepEqual(json(await app.post(`/api/threads/${id}/stop`)), { stopped: false });
  }
});
