import assert from "node:assert/strict";
import { test } from "node:test";
import type { IndexRecord } from "@oriel/core";
import { jiraBoards } from "./boards.ts";
import { discovery, fakeJira, jiraIssue, ok, pointsField, site } from "./fake-jira.ts";
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
  const projects = ["SYN", "OA"];
  const boards = jiraBoards({ transport, projects, log: () => {} });
  const source = jiraSource({ transport, site, projects, log: () => {}, boards });
  const before = boards.unestimating();
  const records: IndexRecord[] = [];
  for await (const page of source.sync(null)) records.push(...page.records);
  return { records, before, after: boards.unestimating() };
}

test("an item whose board takes no estimates has no estimate facet, not a missing estimate", async () => {
  const { records } = await synced();
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

test("the source says which boards its last sync found taking no estimates", async () => {
  const { before, after } = await synced();
  assert.equal(before, null);
  assert.deepEqual([...(after ?? [])], ["OA"]);
});
