// A second issue tracker beside Jira (OA-273): Tickets, a connector in a test
// helper whose items are issues of another kind, mapped onto core's issues
// shape (decision 0059). Every grouping, the overview's candidates, search,
// the panel and a change set's diff treat its items as they treat Jira's,
// with nothing outside the helper knowing it.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Cluster,
  type IndexRecord,
  instant,
  issueDeclaredFacets,
  itemOrder,
  syncSource,
  ulid,
  unknown,
} from "@oriel/core";
import {
  ensureWorkspace,
  indexStore,
  loadMigrations,
  migrate,
  open,
  runStore,
  threadStore,
  workstreamStore,
} from "@oriel/db";
import { changeSets } from "@oriel/changeset";
import {
  assigneeGrouping,
  clusterItemsOf,
  clusterRowOf,
  epicGrouping,
  linkedGrouping,
  stuckGrouping,
} from "@oriel/groupings";
import { fixtureSnapshot, jiraAttrs, jiraDeclaration, loadJiraFixture } from "@oriel/jira";
import { itemPanels } from "./panel.ts";
import { tickets, ticketsDeclaration, ticketsReader, ticketsSource } from "./tickets/testing.ts";

const now = instant(new Date("2026-10-02T11:00:00.000Z"));
const id = (n: number) => ulid(n, new Uint8Array(10));
const order = itemOrder(["jira", "tickets"]);
const sources = { jira: jiraDeclaration, tickets: ticketsDeclaration };
const all = tickets(now);

// Jira's SYN and the tickets, synced into one index.
async function world() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), now);
  const workspaceId = id(0);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, now);
  const index = indexStore(db);
  const jira = index.beginSync(workspaceId, "jira", jiraAttrs, now, issueDeclaredFacets);
  const syn = fixtureSnapshot(loadJiraFixture(), "https://oriel.atlassian.net", 0);
  jira.apply({ records: syn.records, gone: [], cursor: null });
  jira.finish(null, now);
  await syncSource({
    source: ticketsSource(all),
    attrs: unknown,
    key: ticketsDeclaration.key,
    facets: ticketsDeclaration.facets,
    recognize: ticketsDeclaration.recognizer(),
    index,
    workspaceId,
    full: true,
    clock: () => now,
    log: () => {},
  });
  const records: IndexRecord[] = [
    ...index.records(workspaceId, "jira", unknown),
    ...index.records(workspaceId, "tickets", unknown),
  ];
  return { db, workspaceId, index, records };
}

const cluster = (clusters: readonly Cluster[], key: string) => {
  const found = clusters.find((each) => each.key === key);
  assert.ok(found, key);
  return found;
};

test("a second tracker's epic is a cluster of the epic grouping, its row and items as Jira's show", async () => {
  const { records } = await world();
  const clusters = epicGrouping.group(records, now, order);
  const kiosk = cluster(clusters, "t-1");
  assert.deepEqual(
    { label: kiosk.label, anchor: kiosk.anchor, items: kiosk.itemIds, origin: kiosk.origin },
    {
      label: "Kiosk mode",
      anchor: "tickets:TK-1",
      items: ["tickets:TK-2", "tickets:TK-3"],
      origin: "source",
    },
  );
  // One "No epic" across trackers, Jira's first.
  const none = cluster(clusters, "no-epic").itemIds;
  assert.equal(none.at(-1), "tickets:TK-4");
  assert.ok(none.some((each) => each.startsWith("jira:")));
  const row = clusterRowOf(now, sources)(kiosk, records);
  assert.deepEqual(
    [row.origin, row.points, row.estimated, row.unestimated, row.status],
    [{ kind: "source", source: "Tickets" }, 3, 1, 1, { todo: 1, "in-progress": 1, done: 0 }],
  );
  assert.deepEqual(
    clusterItemsOf(now, sources)(kiosk, records).map((item) => [
      item.key,
      item.type,
      item.status,
      item.assignee,
      item.points,
    ]),
    [
      ["TK-2", "Story", { name: "Doing", category: "in-progress" }, "Ada Quill", 3],
      ["TK-3", "Task", { name: "Backlog", category: "todo" }, null, null],
    ],
  );
});

test("a second tracker's items fall under the assignee, stuck and linked groupings", async () => {
  const { records } = await world();
  const people = assigneeGrouping.group(records, now, order);
  assert.deepEqual(cluster(people, "person:u-ada").itemIds, ["tickets:TK-1", "tickets:TK-2"]);
  assert.ok(cluster(people, "unassigned").itemIds.includes("tickets:TK-3"));
  const stuck = stuckGrouping.group(records, now, order);
  const idle = cluster(stuck, "no-update-14-days").itemIds;
  assert.ok(idle.includes("tickets:TK-2") && idle.some((each) => each.startsWith("jira:")));
  const unestimated = cluster(stuck, "unestimated").itemIds;
  assert.ok(unestimated.includes("tickets:TK-3"));
  assert.ok(!unestimated.includes("tickets:TK-1"), "an epic is no work item");
  // TK-3's text names TK-2.
  assert.deepEqual(cluster(linkedGrouping.group(records, now, order), "tickets:t-2").itemIds, [
    "tickets:TK-2",
    "tickets:TK-3",
  ]);
});

test("a second tracker offers the overview the candidates Jira does, by the same rules", async () => {
  const { records } = await world();
  const own = (kind: string) => records.filter((record) => record.id.startsWith(`${kind}:`));
  const input = (kind: string) => ({
    records: own(kind),
    changes: [],
    held: () => false,
    now,
  });
  const found = ticketsDeclaration.overview(input("tickets"));
  assert.deepEqual(found, [
    {
      subject: { kind: "cluster", grouping: "epic", key: "t-1" },
      rule: "An epic no workstream holds",
      // TK-3 changed this week; TK-2 didn't.
      weight: 2,
      detail: "1 changed this week",
    },
    {
      subject: { kind: "item", id: "tickets:TK-2" },
      rule: "In progress, no update in 14 days",
      weight: 1.5,
      detail: "20 days idle",
    },
  ]);
  const rules = (candidates: readonly { rule: string }[]) =>
    [...new Set(candidates.map((candidate) => candidate.rule))].toSorted();
  assert.deepEqual(rules(found), rules(jiraDeclaration.overview(input("jira"))));
});

test("search finds a second tracker's items by key, title and text, beside Jira's", async () => {
  const { index, workspaceId } = await world();
  assert.equal(index.search(workspaceId, "TK-3", 5)[0]?.id, "tickets:TK-3");
  assert.deepEqual(
    // Title hits first, as for any source.
    index
      .search(workspaceId, "kiosk", 10)
      .slice(0, 3)
      .map((hit) => hit.id)
      .toSorted(),
    ["tickets:TK-1", "tickets:TK-2", "tickets:TK-3"],
  );
  assert.equal(index.search(workspaceId, "contactless", 5)[0]?.id, "tickets:TK-2");
});

test("the panel shows a second tracker's issue with the facts Jira's issues show", async () => {
  const { records } = await world();
  const panels = itemPanels({
    reader: ticketsSource(all),
    records: () => records,
    sources,
    now: () => now,
  });
  const view = await panels.read("tickets:TK-2");
  assert.equal(view.source, "Tickets");
  assert.ok(view.read.status === "ok");
  assert.deepEqual(view.read.blocks[0], {
    kind: "facts",
    facts: [
      { name: "Type", value: "Story" },
      { name: "Status", value: "Doing" },
      { name: "Assignee", value: "Ada Quill" },
      { name: "Estimate", value: "3 points" },
      { name: "Labels", value: "payments" },
    ],
  });
  const unassigned = await panels.read("tickets:TK-3");
  assert.ok(unassigned.read.status === "ok");
  assert.deepEqual(unassigned.read.blocks[0], {
    kind: "facts",
    facts: [
      { name: "Type", value: "Task" },
      { name: "Status", value: "Backlog" },
      { name: "Assignee", value: "Unassigned" },
      { name: "Estimate", value: "Not estimated yet" },
    ],
  });
});

test("a change set on a second tracker's issue diffs", async () => {
  const { db, workspaceId } = await world();
  const workstreamId = id(1);
  workstreamStore(db).create(
    { id: workstreamId, workspaceId, name: "Kiosk", origin: { kind: "picked" } },
    [{ id: "tickets:TK-3", stableId: "t-3" }],
    now,
  );
  const threadId = id(2);
  threadStore(db).open({ id: threadId, workspaceId, workstreamId }, now);
  const run = { id: id(3), workspaceId, threadId };
  runStore(db).record(
    {
      ...run,
      snapshot: 1,
      regionVersion: 1,
      systemPromptHash: "p",
      dtsHash: "d",
      model: "model",
      inputTokens: 0,
      outputTokens: 0,
      wallMs: 0,
      coldStartMs: null,
      outcome: "ok",
      startedAt: now,
    },
    [],
  );
  const sets = changeSets({
    db,
    writerConfig: [],
    readers: { tickets: ticketsReader(all) },
    specs: { tickets: ticketsDeclaration.specs },
    reviewBase: new URL("http://localhost:4000/review/"),
    now: () => now,
    emit: () => {},
    log: () => {},
  });
  const set = await sets.capture(run, [
    { op: "setEstimate", target: "tickets:TK-3", ref: null, args: { points: 5 } },
  ]);
  const { lines } = await sets.diff(set.id);
  assert.deepEqual(
    lines.map((line) => [line.kind, line.sentence, line.fields]),
    [
      [
        "change",
        "Estimate “Kiosk receipt layout” at 5 points.",
        [{ name: "points", before: null, after: 5 }],
      ],
    ],
  );
});
