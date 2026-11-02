// Browse's item search and filters (decision 0027): by search()'s match, by
// source, by status category and by assignee, on the first reply and on every
// page of a cluster's items.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClusterPageView, ItemRow, WindowView } from "@oriel/web/view";
import { json, testApp } from "./testing.ts";

type App = Awaited<ReturnType<typeof testApp>>;

// Every item Browse shows under a filter, each cluster's pages in turn.
async function shown(app: App, query: string): Promise<{ view: WindowView; items: ItemRow[] }> {
  const view = json<WindowView>(await app.get(`/api/browse?${query}`));
  const items: ItemRow[] = [];
  for (const { row } of view.clusters)
    for (let from = 0; ;) {
      const params = new URLSearchParams(query);
      params.set("cluster", row.key);
      params.set("from", String(from));
      const page = json<ClusterPageView>(await app.get(`/api/browse/items?${params}`));
      items.push(...page.items);
      from += page.items.length;
      if (page.items.length < 50) break;
    }
  return { view, items };
}

test("/browse?q=sms&source=slack shows Slack's messages about SMS, in their cluster", async (t) => {
  const app = await testApp(t, { slack: { kind: "fixture" } });
  const { view, items } = await shown(app, "grouping=epic&q=sms&source=slack");
  assert.deepEqual(
    view.clusters.map(({ row, matched }) => [row.key, matched]),
    [["no-epics-in-source", 2]],
  );
  assert.equal(view.items, 2);
  assert.ok(items.length === 2 && items.every((item) => item.id.startsWith("slack:")));
  assert.ok(items.every((item) => /sms/i.test(item.title)));
  // Without the source, SYN-61's epic shows too, with only SYN-61.
  const all = await shown(app, "grouping=epic&q=sms");
  assert.deepEqual(
    all.items.map((item) => item.key).filter((key) => key.startsWith("SYN-")),
    ["SYN-61"],
  );
  // The row still counts its whole cluster.
  const epic = all.view.clusters.find(({ matched }) => matched === 1);
  assert.ok(epic && epic.row.count > 1);
});

test("the search matches as search() does: any case, every term, a full item ID", async (t) => {
  const app = await testApp(t);
  const keys = async (q: string) =>
    (await shown(app, `grouping=assignee&${new URLSearchParams({ q })}`)).items.map((i) => i.key);
  assert.deepEqual(await keys("SMS"), ["SYN-61"]);
  assert.deepEqual(await keys("jira:SYN-61"), ["SYN-61"]);
  assert.deepEqual(await keys("sms passengers"), ["SYN-61"]);
  assert.deepEqual(await keys("sms nothing-like-this"), []);
  // A source's prefix alone is no term, and finds nothing.
  assert.deepEqual(await keys("jira:"), []);
});

test("status and assignee keep only their items, and the choices are what the index has", async (t) => {
  const app = await testApp(t, { slack: { kind: "fixture" } });
  const done = await shown(app, "grouping=epic&status=done");
  assert.ok(done.items.length > 0);
  assert.ok(done.items.every((item) => item.status?.category === "done"));
  const { choices } = json<WindowView>(await app.get("/api/browse?grouping=epic"));
  assert.deepEqual(
    choices?.sources.map((source) => source.id),
    ["jira", "slack"],
  );
  const person = choices?.people[0];
  assert.ok(person);
  const theirs = await shown(app, `grouping=epic&assignee=${encodeURIComponent(person.id)}`);
  assert.ok(theirs.items.length > 0);
  assert.ok(theirs.items.every((item) => item.assignee === person.name));
  const nothing = json<WindowView>(await app.get("/api/browse?grouping=epic&assignee=nobody"));
  assert.deepEqual([nothing.clusters, nothing.items], [[], 0]);
});

test("Browse refuses a status it doesn't know; a source it doesn't have shows nothing", async (t) => {
  const app = await testApp(t);
  for (const path of ["/api/browse", "/api/browse/items"])
    assert.equal((await app.get(`${path}?grouping=epic&cluster=10001&status=blocked`)).status, 400);
  const none = json<WindowView>(await app.get("/api/browse?grouping=epic&source=email"));
  assert.deepEqual([none.clusters, none.items], [[], 0]);
  // A query past 200 characters is cut, as the threads' search cuts it.
  const long = await app.get(`/api/browse?grouping=epic&q=SYN-61${"%20".repeat(300)}x`);
  assert.equal(long.status, 200);
  assert.equal(json<WindowView>(long).items, 1);
});

test("an item search is counted by how long its query was and what it found, never its text", async (t) => {
  const app = await testApp(t);
  const event = { name: "items.searched", queryLength: 3, results: 2 };
  assert.equal((await app.post("/api/telemetry", event)).status, 202);
  // A query sent along isn't kept.
  assert.equal((await app.post("/api/telemetry", { ...event, query: "sms" })).status, 202);
  assert.deepEqual(
    app.app
      .telemetry()
      .filter((e) => e.name === "items.searched")
      .map((e) => e.data),
    [
      { queryLength: 3, results: 2 },
      { queryLength: 3, results: 2 },
    ],
  );
});
