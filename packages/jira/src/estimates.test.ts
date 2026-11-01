import assert from "node:assert/strict";
import { test } from "node:test";
import type { IndexRecord } from "@oriel/core";
import { discovery, fakeJira, jiraIssue, ok, pointsField, site } from "./fake-jira.ts";
import { estimateless } from "./namespace.ts";
import { jiraSource } from "./source.ts";

const search = "POST /rest/api/3/search/jql";

// SYN estimates in story points; OA's board counts issues, as a team-managed
// board with no points field does.
async function synced() {
  const { transport } = fakeJira({
    ...discovery("SYN"),
    ...discovery("OA", { type: "issueCount" }, 2),
    [search]: ok({
      issues: [
        jiraIssue("SYN-5", { [pointsField]: 5 }),
        jiraIssue("SYN-6"),
        jiraIssue("OA-7"),
        jiraIssue("OA-8", { [pointsField]: 3 }),
      ],
      isLast: true,
    }),
  });
  const source = jiraSource({ transport, site, projects: ["SYN", "OA"], log: () => {} });
  const records: IndexRecord[] = [];
  for await (const page of source.sync(null)) records.push(...page.records);
  return records;
}

test("an item whose board takes no estimates has no estimate facet, not a missing estimate", async () => {
  const records = await synced();
  assert.deepEqual(
    records.map((r) => [r.id, "estimate" in r.facets, r.facets.estimate]),
    [
      ["jira:SYN-5", true, 5],
      ["jira:SYN-6", true, null],
      // A value in a field the board doesn't estimate in isn't an estimate.
      ["jira:OA-7", false, undefined],
      ["jira:OA-8", false, undefined],
    ],
  );
});

test("the projects that take no estimates are those whose items have no estimate facet", async () => {
  const records = await synced();
  assert.deepEqual([...estimateless(records)], ["OA"]);
  // Another source's items, which never estimate, aren't projects.
  const file = { ...records[0], id: "folder:0123456789abcdef", facets: {} } as IndexRecord;
  assert.deepEqual([...estimateless([...records, file])], ["OA"]);
  assert.deepEqual([...estimateless(records.filter((r) => r.id.startsWith("jira:SYN")))], []);
});
