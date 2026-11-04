// The agent drafts a connection's options, and the user applies them
// (decision 0051): against the Slack fixture, a connection kept from an
// earlier start whose channels no longer fit waits for its options; the
// window chat reads its preview, shown as a block, and drafts a channel set,
// held under the reply. The thread stays in Needs you until the user applies
// it, edits it or discards it; only the user can, in the window.
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { type Call, instant, ulid } from "@oriel/core";
import { indexStore, open } from "@oriel/db";
import { fixtureApi, loadSlackFixture } from "@oriel/slack";
import {
  type ChatEntry,
  type ConnectionView,
  holding,
  type ThreadsView,
  type ThreadView,
} from "@oriel/web/view";
import { refusal } from "./actions.ts";
import { memorySecrets } from "./connection.ts";
import { connectionsOf } from "./connections.ts";
import { json, type Script, t0, testApp } from "./testing.ts";

type Waiting = { connection: string; why: string; tables: { rows: (string | null)[][] }[] };

// Reads the preview, and drafts the channels it was given, for the first
// connection that waits.
const drafting =
  (channels: string[]): Script =>
  async (bindings) => {
    const waiting = (await bindings.read("source.preview", [])).value as Waiting[];
    const connection = waiting[0]?.connection;
    return {
      value: waiting.map((each) => each.why),
      drafts: [["source.configure", [{ connection, options: { channels } }]]],
    };
  };

async function waitingSlack(t: TestContext) {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-drafts-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const db = join(top, "window.db");
  const secrets = memorySecrets();
  const first = await testApp(t, { db, connect: { secrets } });
  await first.app.close();
  // Kept as one made in the window is, naming a channel Slack no longer has.
  const fixture = loadSlackFixture();
  const store = open(db);
  const kept = await connectionsOf({
    db: store,
    index: indexStore(store),
    secrets,
    workspaceId: first.app.workspaceId,
    now: () => instant(new Date(t0)),
    newId: () => ulid(Date.parse(t0)),
    log: () => {},
  }).connect({
    kind: "slack",
    identity: fixture.team.url,
    options: { channels: ["weather-disruptions", "launch-room"] },
    secret: "xoxp-fixture",
  });
  store.close();
  assert.ok("connection" in kept);
  const it = await testApp(t, {
    db,
    connect: { secrets },
    sources: { slack: { mode: "window", fetch: fixtureApi(fixture).fetch } },
    plan: (input) =>
      input.text.startsWith("Draft") ? [{ run: "draft" }, { text: "Drafted." }] : [{ text: "Hi." }],
    scripts: { draft: drafting(["weather-disruptions"]) },
  });
  const ask = async (text: string) => {
    const reply = await it.post("/api/window-chat/messages", { text });
    await it.app.settled();
    return json<{ id: string }>(reply).id;
  };
  const thread = async (id: string) => json<ThreadView>(await it.get(`/api/threads/${id}`));
  const drafts = (view: ThreadView) =>
    view.entries.filter((e): e is Extract<ChatEntry, { kind: "draft" }> => e.kind === "draft");
  const draftOf = (view: ThreadView) => drafts(view)[0];
  const events = (name: string) =>
    it.app
      .telemetry()
      .filter((event) => event.name === name)
      .map((event) => event.data);
  return { ...it, id: kept.connection.id, ask, thread, drafts, draftOf, events };
}

test("the agent drafts a waiting Slack connection's channels, and the user applies them", async (t) => {
  const it = await waitingSlack(t);
  assert.equal((await it.connection("slack"))?.state, "signed-out");
  const id = await it.ask("Draft which Slack channels Oriel should read.");
  const view = await it.thread(id);
  // The preview it read shows as its own block, Oriel's.
  const preview = view.entries.find((e) => e.kind === "block" && e.block.form === "preview");
  assert.ok(preview?.kind === "block" && preview.block.form === "preview");
  assert.deepEqual(preview.block.tables[0]?.rows, [
    ["weather-disruptions", "2026-09-27"],
    ["random", "2026-09-05"],
  ]);
  // The draft waits on the user, drawn from Oriel's data.
  const draft = it.draftOf(view);
  assert.deepEqual(draft && { ...draft, seq: 0, at: "" }, {
    seq: 0,
    at: "",
    kind: "draft",
    connection: { id: it.id, name: "Slack" },
    changes: [
      {
        option: "channels",
        was: ["weather-disruptions", "launch-room"],
        drafted: ["weather-disruptions"],
      },
    ],
    stale: false,
    outcome: null,
  });
  assert.ok(holding(view.entries));
  const needsYou = json<ThreadsView>(await it.get("/api/threads")).threads.find((x) => x.id === id);
  assert.equal(needsYou?.waitingOn, "draft");
  // New chat leaves it working, in Needs you.
  assert.equal((await it.post("/api/window-chat/new")).status, 200);
  assert.equal((await it.thread(id)).state, "working");
  assert.deepEqual(it.events("draft.made"), [{ threadId: id, action: "source.configure" }]);

  // Applied, Slack opens with the drafted channels and syncs.
  const applied = await it.post(`/api/threads/${id}/held/${draft?.seq}/apply`);
  assert.equal(applied.status, 200);
  const { connection, undo } = json<{ connection: ConnectionView; undo: Call | null }>(applied);
  assert.deepEqual(
    [connection.state, connection.options],
    ["open", { channels: ["weather-disruptions"] }],
  );
  assert.ok(connection.items > 0);
  // Its Undo puts back the options it replaced.
  assert.deepEqual(undo, {
    action: "source.configure",
    input: { connection: it.id, options: { channels: ["weather-disruptions", "launch-room"] } },
  });
  const after = await it.thread(id);
  assert.equal(it.draftOf(after)?.outcome, "applied");
  assert.ok(!holding(after.entries));
  const settled = json<ThreadsView>(await it.get("/api/threads")).threads.find((x) => x.id === id);
  assert.notEqual(settled?.waitingOn, "draft");
  assert.deepEqual(it.events("draft.applied"), [
    { threadId: id, action: "source.configure", edited: false },
  ]);
  assert.deepEqual(it.events("source.configured"), [
    { source: "slack", later: false, options: ["channels"] },
  ]);
  // Applied once: it isn't there to apply again.
  assert.equal((await it.post(`/api/threads/${id}/held/${draft?.seq}/apply`)).status, 404);
  // Its Undo puts the old options back, though they don't fit: Slack waits
  // for its options again, and says why.
  const undone = await it.post("/api/actions/source.configure", undo?.input);
  assert.equal(undone.status, 200);
  assert.match(json<{ problem?: string }>(undone).problem ?? "", /#launch-room/);
  const waits = await it.connection("slack");
  assert.deepEqual(
    [waits?.state, waits?.options],
    ["signed-out", { channels: ["weather-disruptions", "launch-room"] }],
  );
});

test("only the user applies a draft: no review link, outside tool or agent", () => {
  for (const actor of [
    { kind: "review-link", by: "Ana" },
    { kind: "tool", name: "a bot" },
    { kind: "agent", threadId: ulid(0, new Uint8Array(10)) },
  ] as const)
    assert.match(
      refusal("held.apply", actor) ?? "",
      /isn't for a review link|only the user applies it/,
    );
  assert.equal(refusal("held.apply", { kind: "user" }), null);
});

test("an edit applies as the user's, keeping its connection; a stale draft can only go", async (t) => {
  const it = await waitingSlack(t);
  // Two turns of the window chat, each with its draft.
  const first = await it.ask("Draft the channels.");
  const second = await it.ask("Draft them again.");
  assert.equal(first, second);
  const [one, two] = it.drafts(await it.thread(first));
  // An edit keeps what the draft acts on.
  const moved = await it.post(`/api/threads/${first}/held/${one?.seq}/apply`, {
    edit: { connection: ulid(1, new Uint8Array(10)) },
  });
  assert.equal(moved.status, 400);
  const edited = await it.post(`/api/threads/${first}/held/${one?.seq}/apply`, {
    edit: { options: { channels: ["weather-disruptions", "random"] } },
  });
  assert.equal(edited.status, 200);
  assert.deepEqual(json<{ connection: ConnectionView }>(edited).connection.options, {
    channels: ["weather-disruptions", "random"],
  });
  assert.deepEqual(it.events("draft.applied"), [
    { threadId: first, action: "source.configure", edited: true },
  ]);
  // The card says what applied: the edit.
  assert.deepEqual(it.drafts(await it.thread(first))[0]?.changes, [
    {
      option: "channels",
      was: ["weather-disruptions", "launch-room"],
      drafted: ["weather-disruptions", "random"],
    },
  ]);
  // The other was drafted over options that moved since: stale, it can't
  // apply, and the user discards it.
  assert.equal(it.drafts(await it.thread(second))[1]?.stale, true);
  assert.equal((await it.post(`/api/threads/${second}/held/${two?.seq}/apply`)).status, 409);
  assert.equal((await it.post(`/api/threads/${second}/held/${two?.seq}/discard`)).status, 200);
  assert.equal(it.drafts(await it.thread(second))[1]?.outcome, "discarded");
  assert.deepEqual(it.events("draft.discarded"), [
    { threadId: second, action: "source.configure", stale: true },
  ]);
});

test("no connection waits: the window chat's module offers no preview or draft", async (t) => {
  const it = await testApp(t, {
    plan: () => [{ run: "draft" }],
    scripts: { draft: drafting(["random"]) },
  });
  const reply = await it.post("/api/window-chat/messages", { text: "Draft." });
  await it.app.settled();
  const view = json<ThreadView>(await it.get(`/api/threads/${json<{ id: string }>(reply).id}`));
  assert.ok(!view.entries.some((e) => e.kind === "draft"));
  assert.ok(view.entries.some((e) => e.kind === "error" && /source\.preview/.test(e.message)));
});
