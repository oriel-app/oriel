// Defect fixed in abdf6d4f: a row's count left out its epic, so the workstream held one more than it said.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { WindowView, WorkstreamSummary } from "@oriel/web/view";
import { json, testApp } from "./testing.ts";

const bigger = (t: Parameters<typeof testApp>[0]) =>
  testApp(t, {
    memory: true,
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
  assert.equal(checkout.row.size, checkout.row.count + 1);
  assert.equal(await make("epic", "10001"), checkout.row.size);
  const stuck = json<WindowView>(await app.get("/api/browse?grouping=stuck")).clusters[0];
  assert.ok(stuck && stuck.row.anchor === null && stuck.row.count > 0);
  assert.equal(stuck.row.size, stuck.row.count);
  assert.equal(await make("stuck", stuck.row.key), stuck.row.size);
});
