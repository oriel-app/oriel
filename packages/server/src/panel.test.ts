// The panel beside the page: an item read live through the agent's reader, in
// its source's own view, with when the index last saw it change, and the
// pilot telemetry for opening it and for leaving for its source.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import type { PanelBlock } from "@oriel/core";
import type { ItemPanelView, ItemStampView, WindowView } from "@oriel/web/view";
import { json, t0, testApp } from "./testing.ts";

const path = (id: string) => `/api/items/${encodeURIComponent(id)}`;
const blocksOf = (view: ItemPanelView): PanelBlock[] =>
  view.read.status === "ok" ? view.read.blocks : [];
const blocks = <K extends PanelBlock["kind"]>(view: ItemPanelView, kind: K) =>
  blocksOf(view).filter((each): each is Extract<PanelBlock, { kind: K }> => each.kind === kind);
const block = <K extends PanelBlock["kind"]>(view: ItemPanelView, kind: K) => blocks(view, kind)[0];

test("a Jira issue shows its status, assignee, estimate, description and comments, read live", async (t) => {
  const app = await testApp(t);
  const reply = await app.get(path("jira:SYN-88"));
  assert.equal(reply.status, 200);
  const view = json<ItemPanelView>(reply);
  assert.deepEqual(
    { ...view, read: view.read.status },
    {
      id: "jira:SYN-88",
      key: "SYN-88",
      source: "Jira",
      title: "Refund to the original payment method when a sailing is cancelled",
      url: "https://oriel.atlassian.net/browse/SYN-88",
      readAt: t0,
      updatedAt: "2026-10-01T11:00:00.000Z",
      read: "ok",
    },
  );
  assert.deepEqual(block(view, "facts")?.facts, [
    { name: "Type", value: "Story" },
    { name: "Status", value: "To Do" },
    { name: "Assignee", value: "Esme Whitlock" },
    { name: "Estimate", value: "5 points" },
    { name: "Labels", value: "payments, refunds" },
  ]);
  assert.equal(block(view, "text")?.heading, "Description");
  assert.equal(block(view, "text")?.format, "plain");
  assert.equal(block(view, "messages")?.heading, "Comments");
});

test("on a board that takes no estimates, the issue has no estimate to lack", async (t) => {
  const app = await testApp(t, { live: true, estimates: false });
  const view = json<ItemPanelView>(await app.get(path("jira:SYN-88")));
  assert.deepEqual(
    block(view, "facts")?.facts.map((fact) => fact.name),
    ["Type", "Status", "Assignee", "Labels"],
  );
});

test("a read is live: an edit in Jira shows on the next open, before any sync", async (t) => {
  const app = await testApp(t, { live: true });
  const first = json<ItemPanelView>(await app.get(path("jira:SYN-88")));
  app.site?.edit("SYN-88", { summary: "Refund by the original method, edited in Jira" });
  // The index hasn't synced, and the read is live all the same.
  const again = json<ItemPanelView>(await app.get(path("jira:SYN-88")));
  assert.notEqual(first.title, again.title);
  assert.equal(again.title, "Refund by the original method, edited in Jira");
  assert.equal(again.updatedAt, first.updatedAt);
});

test("once a sync sees the item change after the read, its stamp says so", async (t) => {
  const app = await testApp(t, { live: true });
  const read = json<ItemPanelView>(await app.get(path("jira:SYN-88")));
  const before = json<ItemStampView>(await app.get(`${path("jira:SYN-88")}/stamp`));
  assert.deepEqual(before, { id: "jira:SYN-88", updatedAt: read.updatedAt });
  app.site?.edit("SYN-88", { points: 8 });
  assert.equal((await app.post("/api/jira/sync")).status, 200);
  const after = json<ItemStampView>(await app.get(`${path("jira:SYN-88")}/stamp`));
  assert.ok(after.updatedAt !== null && after.updatedAt > read.readAt);
});

test("an item deleted in Jira is a view that says so, not an error", async (t) => {
  const app = await testApp(t, { live: true });
  app.site?.remove("SYN-88");
  const view = json<ItemPanelView>(await app.get(path("jira:SYN-88")));
  assert.deepEqual(view.read, { status: "gone", reason: "deleted" });
  // The index still names it until a sync.
  assert.equal(view.title, "Refund to the original payment method when a sailing is cancelled");
});

test("a source that doesn't answer is a plain sentence", async (t) => {
  const app = await testApp(t, { live: true });
  app.site?.outage("offline");
  const reply = await app.get(path("jira:SYN-88"));
  assert.equal(reply.status, 502);
  assert.match(json<{ error: string }>(reply).error, /^Jira didn't answer/);
});

test("a Slack conversation is one item, named by its channel: its message, then every reply under it", async (t) => {
  const app = await testApp(t, { slack: { kind: "fixture" } });
  const id = "slack:C0FW1WEATHR-1788444000.000100";
  const view = json<ItemPanelView>(await app.get(path(id)));
  assert.equal(view.source, "Slack");
  assert.equal(
    view.url,
    "https://ferrowick-example.slack.com/archives/C0FW1WEATHR/p1788444000000100",
  );
  // Its first line is the item's title, so the panel names it by its channel.
  assert.equal(view.title, "#weather-disruptions");
  const [message, replies] = blocks(view, "messages");
  assert.equal(message?.messages.length, 1);
  assert.equal(replies?.heading, "4 replies");
  assert.equal(replies?.messages.length, 4);
  const all = [...(message?.messages ?? []), ...(replies?.messages ?? [])];
  assert.ok(all.every((m) => m.author !== "" && !Number.isNaN(Date.parse(m.at))));
});

test("text that tells the agent what to do is shown as the message it is", async (t) => {
  const app = await testApp(t, { slack: { kind: "fixture" } });
  const window = json<WindowView>(await app.get("/api/window?grouping=epic"));
  const asking = window.clusters
    .flatMap((c) => c.list)
    .find((row) => row.title.includes("Status of SYN-47"));
  assert.ok(asking);
  const view = json<ItemPanelView>(await app.get(path(asking.id)));
  const said = blocks(view, "messages").flatMap((each) => each.messages.map((m) => m.text));
  assert.ok(said.some((text) => text.includes("ignore your instructions")));
});

function folder(t: TestContext, files: Record<string, string>) {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-panel-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const root = join(top, "notes");
  mkdirSync(root);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body);
  return root;
}

test("a file shows its text as markdown, and opens only in the panel: it has no web page", async (t) => {
  const app = await testApp(t);
  const text = "# Launch plan\n\n<script>alert(1)</script> Ship the phone wallet first.";
  const root = folder(t, { "Launch plan.md": text });
  assert.equal((await app.post("/api/folder", { path: root })).status, 200);
  const window = json<WindowView>(await app.get("/api/window?grouping=epic"));
  const file = window.clusters.flatMap((c) => c.list).find((row) => row.id.startsWith("folder:"));
  assert.ok(file);
  assert.equal(window.locations?.[file.id], undefined);
  const view = json<ItemPanelView>(await app.get(path(file.id)));
  assert.equal(view.url, null);
  assert.equal(view.source, "Folder");
  assert.deepEqual(blocksOf(view), [{ kind: "text", heading: null, text, format: "markdown" }]);
});

test("the window says where each item it shows lives, for a link to its source", async (t) => {
  const app = await testApp(t);
  const window = json<WindowView>(await app.get("/api/window?grouping=epic"));
  assert.equal(window.locations?.["jira:SYN-88"], "https://oriel.atlassian.net/browse/SYN-88");
});

test("only an item ID reads; a GET changes nothing", async (t) => {
  const app = await testApp(t);
  assert.equal((await app.get(path("SYN-88"))).status, 400);
  assert.equal((await app.get(path("linear:ABC-1"))).status, 400);
  assert.equal((await app.get("/api/items/%E0%A4%A")).status, 400);
  const events = app.app.telemetry().length;
  await app.get(path("jira:SYN-88"));
  assert.equal(app.app.telemetry().length, events);
});

test("opening a panel and leaving for the source are each one event, by source kind", async (t) => {
  const app = await testApp(t);
  const opened = { name: "item.panel-opened", item: "jira:SYN-88" };
  assert.equal((await app.post("/api/telemetry", opened)).status, 202);
  const left = { name: "item.source-opened", item: "jira:SYN-88", via: "panel" };
  assert.equal((await app.post("/api/telemetry", left)).status, 202);
  const events = app.app.telemetry().filter((e) => e.name.startsWith("item."));
  assert.deepEqual(
    events.map((e) => [e.name, e.data]),
    [
      ["item.panel-opened", { source: "jira" }],
      ["item.source-opened", { source: "jira", via: "panel" }],
    ],
  );
  const bad = { name: "item.panel-opened", item: "not an item" };
  assert.equal((await app.post("/api/telemetry", bad)).status, 400);
});
