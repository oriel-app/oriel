// References through the server (decision 0027): a Slack message naming a
// Jira item references it, and Browse's Linked grouping shows the item with
// the messages that name it.
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isItemId } from "@oriel/core";
import { open } from "@oriel/db";
import type { ClusterPageView, WindowView, WorkstreamView } from "@oriel/web/view";
import { json, testApp } from "./testing.ts";

const standup = "slack:C0FW1WEATHR-1788684000.000100";

test("Browse's Linked grouping shows SYN-54 with the messages that name it", async (t) => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-references-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const db = join(top, "oriel.db");
  const app = await testApp(t, { slack: { mode: "fixture" }, db });
  const linked = app.app.window("linked");
  const cluster = linked.clusters.find((c) => c.list[0]?.id === "jira:SYN-54");
  assert.ok(cluster, "SYN-54 heads a cluster");
  assert.equal(cluster.row.origin.kind, "derived");
  assert.equal(cluster.row.anchor, null, "a reference is no hierarchy");
  assert.ok(
    cluster.list.some((row) => row.id === standup),
    "the standup that names it",
  );
  assert.ok(cluster.list.slice(1).every((row) => row.id.startsWith("slack:")));
  // Browse's rows and its page of the cluster's items are the same cluster.
  const browse = json<WindowView>(await app.get("/api/browse?grouping=linked"));
  assert.deepEqual(
    browse.clusters.map((each) => each.row),
    linked.clusters.map((each) => each.row),
  );
  const query = new URLSearchParams({ grouping: "linked", cluster: cluster.row.key, from: "0" });
  const page = json<ClusterPageView>(await app.get(`/api/browse/items?${query}`));
  assert.deepEqual(
    page.items.map((row) => row.id),
    cluster.list.map((row) => row.id),
  );
  // A workstream made of it holds SYN-54 and the messages, and no epic.
  const made = json<{ id: string }>(
    await app.post("/api/workstreams", {
      kind: "cluster",
      grouping: "linked",
      cluster: cluster.row.key,
    }),
  );
  const view = json<WorkstreamView>(await app.get(`/api/workstreams/${made.id}`));
  assert.deepEqual(
    view.members.map((member) => member.ref.id).toSorted(),
    cluster.list.map((row) => row.id).toSorted(),
  );
  await app.app.close();
  // What the index keeps of a reference is an item's stable ID, or its
  // source and handle while unresolved, never the text around it.
  const handle = open(db);
  const stableIds = new Set(
    handle
      .prepare("select stable_id from items")
      .all()
      .map((row) => row["stable_id"]),
  );
  const rows = handle.prepare("select * from item_references").all();
  assert.ok(rows.length > 0);
  for (const row of rows) {
    const named =
      row["to_handle"] === null
        ? stableIds.has(row["to_stable_id"] ?? null)
        : isItemId(`${String(row["to_source"])}:${String(row["to_handle"])}`);
    assert.ok(named, JSON.stringify(row));
  }
  const origin = handle.prepare("select origin from workstreams where id = ?").get(made.id);
  assert.equal(JSON.parse(String(origin?.["origin"])).anchor, null);
  handle.close();
});

test("a Jira item whose description names another shows under Linked, and so does a Slack link in it", async (t) => {
  const standupLink = "https://ferrowick-example.slack.com/archives/C0FW1WEATHR/p1788684000000100";
  const app = await testApp(t, {
    live: true,
    slack: { mode: "fixture" },
    issues: (syn) =>
      syn.map((issue) =>
        issue.key === "SYN-61"
          ? {
              ...issue,
              description: `Waits on SYN-23's wallet button, as raised at ${standupLink}.`,
            }
          : issue,
      ),
  });
  const linked = app.app.window("linked");
  const headed = (id: string) => linked.clusters.find((c) => c.list[0]?.id === id);
  const wallet = headed("jira:SYN-23");
  assert.ok(wallet, "SYN-23 heads a cluster");
  assert.deepEqual(
    wallet.list.map((row) => row.id),
    ["jira:SYN-23", "jira:SYN-61"],
  );
  assert.ok(headed(standup)?.list.some((row) => row.id === "jira:SYN-61"));
  // Slack's messages name SYN-61 too, so its own cluster holds them and
  // what its description names.
  const sms = headed("jira:SYN-61")?.list.map((row) => row.id) ?? [];
  assert.ok(sms.includes("jira:SYN-23") && sms.includes(standup));
});
