// The agent drafts a connection's options, and the user applies them
// (decision 0051): against the Sheets fixture through sheets-mcp (decision
// 0059), a connection whose spreadsheet was just picked waits for its
// mapping; the window chat reads its preview, shown as a block, and drafts
// how to read a tab, held under the reply. The thread stays in Needs you
// until the user applies it, edits it or discards it; only the user can, in
// the window.
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type TestContext, test } from "node:test";
import { ulid } from "@oriel/core";
import { loadSheetsFixture } from "@oriel/sheets";
import type { ChatEntry, ConnectionView, ThreadView } from "@oriel/web/view";
import { refusal } from "./actions.ts";
import { json, type Script, testApp } from "./testing.ts";

const tracker = loadSheetsFixture().spreadsheets.find((s) => s.slug === "tracker")?.id ?? "";

type Waiting = { connection: string; why: string; tables: { at?: string }[] };

// How the tracker's first tab reads, by letter, with `title` its title's
// column.
const tab = (title: string) => ({
  at: `${tracker}/1100`,
  header: 1,
  end: "blank",
  hidden: false,
  key: "A",
  title,
  status: "D",
  states: { todo: ["To do"], "in-progress": ["In progress", "Blocked"], done: ["Done"] },
});

// Reads the preview, and drafts the tracker's first tab, for the first
// connection that waits.
const drafting =
  (title: string): Script =>
  async (bindings) => {
    const waiting = (await bindings.read("source.preview", [])).value as Waiting[];
    const connection = waiting[0]?.connection;
    return {
      value: waiting.map((each) => each.why),
      drafts: [["source.configure", [{ connection, options: { tabs: [tab(title)] } }]]],
    };
  };

async function waitingSheets(t: TestContext) {
  const it = await testApp(t, {
    jira: false,
    sheetsMcp: true,
    plan: (input) =>
      input.text.startsWith("Draft") ? [{ run: "draft" }, { text: "Drafted." }] : [{ text: "Hi." }],
    scripts: { draft: drafting("C") },
  });
  assert.equal((await it.turnOn("sheets")).status, 200);
  const id = (await it.connection("sheets"))?.id ?? "";
  // The tracker picked through sheets-mcp, with no tab mapped yet.
  const picked = await it.post(`/api/connections/${id}/options`, {
    options: { spreadsheets: [tracker] },
  });
  assert.equal(picked.status, 200);
  await it.app.settled();
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
  return { ...it, id, ask, thread, drafts, draftOf, events };
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
  const it = await waitingSheets(t);
  // Two turns of the window chat, each with its draft.
  const first = await it.ask("Draft how the tracker reads.");
  const second = await it.ask("Draft it again.");
  assert.equal(first, second);
  const [one, two] = it.drafts(await it.thread(first));
  // An edit keeps what the draft acts on.
  const moved = await it.post(`/api/threads/${first}/held/${one?.seq}/apply`, {
    edit: { connection: ulid(1, new Uint8Array(10)) },
  });
  assert.equal(moved.status, 400);
  const edited = await it.post(`/api/threads/${first}/held/${one?.seq}/apply`, {
    edit: { options: { tabs: [tab("B")] } },
  });
  assert.equal(edited.status, 200);
  const spreadsheets = json<{ connection: ConnectionView }>(edited).connection.options
    .spreadsheets as { tabs: { title: string }[] }[];
  assert.equal(spreadsheets[0]?.tabs[0]?.title, "Epic", "column B's header, as the user edited it");
  assert.deepEqual(it.events("draft.applied"), [
    { threadId: first, action: "source.configure", edited: true },
  ]);
  // The card says what applied: the edit, settled into the options.
  const [change] = it.drafts(await it.thread(first))[0]?.changes ?? [];
  assert.equal(change?.option, "spreadsheets");
  assert.match(JSON.stringify(change?.drafted), /"title":"Epic"/);
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

test("a Sheets connection kept waiting while its server isn't on isn't one the agent drafts for", async (t) => {
  const db = join(realpathSync(mkdtempSync(join(tmpdir(), "oriel-drafts-"))), "window.db");
  t.after(() => rmSync(dirname(db), { recursive: true, force: true }));
  const before = await testApp(t, { jira: false, sheetsMcp: true, db });
  assert.equal((await before.turnOn("sheets")).status, 200);
  const id = (await before.connection("sheets"))?.id ?? "";
  // The tracker picked through sheets-mcp, with no tab mapped yet.
  const picked = await before.post(`/api/connections/${id}/options`, {
    options: { spreadsheets: [tracker] },
  });
  assert.equal(picked.status, 200);
  await before.app.settled();
  await before.app.close();
  // Started again with no Sheets server, the kind is off: nothing waits.
  let dts = "";
  const it = await testApp(t, {
    jira: false,
    db,
    plan: () => [{ run: "look" }, { text: "Looked." }],
    scripts: {
      look: async (bindings) => {
        dts = bindings.dts;
        return { value: null };
      },
    },
  });
  assert.equal(await it.connection("sheets"), null);
  assert.equal((await it.post("/api/window-chat/messages", { text: "Hi" })).status, 201);
  await it.app.settled();
  // No preview is offered of it, so none fails to open it (Sol S1 on #232:
  // the preview was offered, and threw, as the connection opens only
  // through its server).
  assert.ok(dts.length > 0);
  assert.doesNotMatch(dts, /WaitingConnection/);
});
