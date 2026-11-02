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
import type { WindowView } from "@oriel/web/view";
import { json, testApp } from "./testing.ts";

const standup = "slack:C0FW1WEATHR-1788684000.000100";

test("Browse's Linked grouping shows SYN-54 with the messages that name it", async (t) => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-references-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const db = join(top, "oriel.db");
  const app = await testApp(t, { slack: { kind: "fixture" }, db });
  const linked = json<WindowView>(await app.get("/api/window?grouping=linked"));
  const cluster = linked.clusters.find((c) => c.row.anchor?.id === "jira:SYN-54");
  assert.ok(cluster, "SYN-54 anchors a cluster");
  assert.equal(cluster.row.origin.kind, "derived");
  assert.ok(
    cluster.list.some((row) => row.id === standup),
    "the standup that names it",
  );
  assert.ok(cluster.list.every((row) => row.id.startsWith("slack:")));
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
  handle.close();
});
