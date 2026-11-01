// A Slack conversation is one item (OA-49): its message, with its replies as
// part of it. The window shows how many replies it has and links to them, and
// a reply's link, dropped on a group, adds the conversation.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GroupView, WindowView } from "@oriel/web/view";
import { json, testApp } from "./testing.ts";

const message = "slack:C0FW1WEATHR-1788444000.000100";
const archive = "https://ferrowick-example.slack.com/archives/C0FW1WEATHR";
const replies = { count: 4, url: `${archive}/p1788444000000100` };

test("a message's row counts its replies and links to them, under every grouping that lists it; replies aren't rows", async (t) => {
  const app = await testApp(t, { slack: { kind: "fixture" } });
  for (const grouping of ["epic", "assignee"]) {
    const view = json<WindowView>(await app.get(`/api/window?grouping=${grouping}`));
    const rows = view.clusters.flatMap((c) => c.list).filter((row) => row.id.startsWith("slack:"));
    assert.deepEqual(rows.find((row) => row.id === message)?.replies, replies, grouping);
    // A message nobody replied to shows no count.
    assert.ok(
      rows.some((row) => row.replies === undefined),
      grouping,
    );
    assert.ok(!rows.some((row) => row.title.startsWith("Ines Carvalho: Thank you!")), grouping);
  }
});

test("a group's member shows its message's replies", async (t) => {
  const app = await testApp(t, { slack: { kind: "fixture" } });
  const { id } = json<{ id: string }>(
    await app.post("/api/groups", { kind: "picked", name: "Fares", items: [message] }),
  );
  const group = json<GroupView>(await app.get(`/api/groups/${id}`));
  assert.deepEqual(
    group.members.map((m) => [m.ref.id, m.row?.replies]),
    [[message, replies]],
  );
});

test("a dropped reply link, as Slack copies it, adds its conversation", async (t) => {
  const app = await testApp(t, { slack: { kind: "fixture" } });
  const { id } = json<{ id: string }>(
    await app.post("/api/groups", { kind: "picked", name: "Fares", items: ["jira:SYN-45"] }),
  );
  const link = `${archive}/p1788445500000100?thread_ts=1788444000.000100&cid=C0FW1WEATHR`;
  const dropped = json<{ added: string[]; refused: unknown[] }>(
    await app.post(`/api/groups/${id}/drop`, { links: [link], files: [] }),
  );
  assert.deepEqual(dropped.added, [message]);
  assert.deepEqual(dropped.refused, []);
  const added = app.app.telemetry().filter((e) => e.name === "group.item-added");
  assert.deepEqual(
    added.map((e) => [e.data.source, e.data.cause]),
    [["slack", "user"]],
  );
});
