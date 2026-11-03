// Browse: its first reply is the clusters as rows, and a cluster's items
// come a page at a time as it opens (decision 0027). Checked against the
// whole list in one reply, over SYN with 120 more stories in its checkout
// epic, so a cluster runs to several pages.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClusterPageView, ItemRow, WindowView, WorkstreamSummary } from "@oriel/web/view";
import { json, testApp } from "./testing.ts";

const groupings = ["epic", "assignee", "stuck"] as const;

// SYN, with 120 more stories in SYN-1, the checkout epic (cluster 10001).
const bigger = (t: Parameters<typeof testApp>[0]) =>
  testApp(t, {
    live: true,
    issues: (syn) => {
      const story = syn.find((issue) => issue.epic === "SYN-1" && issue.issueType === "Story");
      assert.ok(story);
      return [
        ...syn,
        ...Array.from({ length: 120 }, (_, n) => ({
          ...story,
          key: `SYN-${900 + n}`,
          id: String(90_000 + n),
          summary: `More checkout work ${n}`,
        })),
      ];
    },
  });

// Every page of a cluster's items, from the first, until one is short.
async function pages(app: Awaited<ReturnType<typeof bigger>>, grouping: string, cluster: string) {
  const all: ClusterPageView[] = [];
  for (let from = 0; ;) {
    const query = new URLSearchParams({ grouping, cluster, from: String(from) });
    const reply = await app.get(`/api/browse/items?${query}`);
    assert.equal(reply.status, 200);
    const page = json<ClusterPageView>(reply);
    all.push(page);
    from += page.items.length;
    if (page.items.length < 50) return all;
  }
}

test("Browse's first reply has every cluster the whole list has, as rows, with no items", async (t) => {
  const app = await bigger(t);
  for (const grouping of groupings) {
    const whole = json<WindowView>(await app.get(`/api/window?grouping=${grouping}`));
    const first = json<WindowView>(await app.get(`/api/browse?grouping=${grouping}`));
    assert.deepEqual(
      first.clusters.map(({ row }) => row),
      whole.clusters.map(({ row }) => row),
      grouping,
    );
    assert.ok(first.clusters.every(({ list }) => list.length === 0));
    assert.deepEqual(
      [first.grouping, first.items, first.asOf, first.fixture],
      [whole.grouping, whole.items, whole.asOf, whole.fixture],
    );
    // Where only the anchors live, since only they are shown.
    const anchors = new Set(first.clusters.flatMap(({ row }) => row.anchor?.id ?? []));
    assert.ok(Object.keys(first.locations ?? {}).every((id) => anchors.has(id)));
  }
});

test("a cluster's pages, 50 items each, are its whole list in order", async (t) => {
  const app = await bigger(t);
  for (const grouping of groupings) {
    const whole = json<WindowView>(await app.get(`/api/window?grouping=${grouping}`));
    for (const { row, list } of whole.clusters) {
      const got = await pages(app, grouping, row.key);
      assert.ok(got.every((page) => page.items.length <= 50 && page.total === row.count));
      // Every page names the same list.
      assert.equal(new Set(got.map((page) => page.of)).size, 1);
      assert.deepEqual(
        got.flatMap((page) => page.items),
        list,
        `${grouping}: ${row.label}`,
      );
      const shown = new Set(list.map((item: ItemRow) => item.id));
      for (const page of got) assert.ok(Object.keys(page.locations).every((id) => shown.has(id)));
    }
  }
  // SYN's 14 checkout stories and the 120 more: three pages.
  const checkout = await pages(app, "epic", "10001");
  assert.deepEqual(
    checkout.map((page) => [page.from, page.items.length, page.total]),
    [
      [0, 50, 134],
      [50, 50, 134],
      [100, 34, 134],
    ],
  );
});

test("a cluster made a workstream holds as many items as its row says, not the page shown", async (t) => {
  const app = await bigger(t);
  const make = async (grouping: string, cluster: string) => {
    const made = await app.post("/api/workstreams", { kind: "cluster", grouping, cluster });
    assert.equal(made.status, 201);
    return json<WorkstreamSummary>(made).size;
  };
  const { clusters } = json<WindowView>(await app.get("/api/browse?grouping=epic"));
  const checkout = clusters.find(({ row }) => row.key === "10001");
  assert.ok(checkout && checkout.row.count > 50);
  // Its items, and the epic itself.
  assert.equal(checkout.row.size, checkout.row.count + 1);
  assert.equal(await make("epic", "10001"), checkout.row.size);
  // A cluster with no anchor holds its items.
  const stuck = json<WindowView>(await app.get("/api/browse?grouping=stuck")).clusters[0];
  assert.ok(stuck && stuck.row.anchor === null && stuck.row.count > 0);
  assert.equal(stuck.row.size, stuck.row.count);
  assert.equal(await make("stuck", stuck.row.key), stuck.row.size);
});

test("Browse refuses a grouping or a start it doesn't know, and a cluster it doesn't have", async (t) => {
  const app = await testApp(t);
  for (const url of ["/api/browse", "/api/browse?grouping=toString", "/api/browse/items"])
    assert.equal((await app.get(url)).status, 400, url);
  for (const from of ["-1", "1.5", "x", "1e400"])
    assert.equal(
      (await app.get(`/api/browse/items?grouping=epic&cluster=10001&from=${from}`)).status,
      400,
      from,
    );
  const missing = await app.get("/api/browse/items?grouping=epic&cluster=nothing");
  assert.equal(missing.status, 404);
  const past = json<ClusterPageView>(
    await app.get("/api/browse/items?grouping=epic&cluster=10001&from=1000"),
  );
  assert.deepEqual([past.items, past.from], [[], 1000]);
  assert.ok(past.total > 0);
});
