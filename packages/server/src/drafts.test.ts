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
import { instant, ulid } from "@oriel/core";
import { indexStore, open } from "@oriel/db";
import { fixtureApi, loadSlackFixture } from "@oriel/slack";
import type { ChatEntry, ConnectionView, ThreadView } from "@oriel/web/view";
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

test("only the user applies a draft: no review link, outside tool or agent", () => {
  for (const actor of [
    { kind: "review-link", by: "Ana" },
    { kind: "tool", name: "a bot" },
    { kind: "agent", threadId: ulid(0, new Uint8Array(10)) },
  ] as const)
    assert.notEqual(refusal("held.apply", actor), null, actor.kind);
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
