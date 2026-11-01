import assert from "node:assert/strict";
import { test } from "node:test";
import { jiraBoards } from "./boards.ts";
import { discovery, fakeJira, jiraIssue, ok, pointsField, site } from "./fake-jira.ts";
import { jiraSource } from "./source.ts";

const fields = `summary,issuetype,status,parent,assignee,labels,updated,${pointsField},description`;
const read = (key: string) => ({
  [`GET /rest/api/3/issue/${key}?fields=${fields}&expand=transitions`]: ok(
    jiraIssue(key, { [pointsField]: null }),
  ),
  [`GET /rest/api/3/issue/${key}/comment?startAt=0&maxResults=100&orderBy=created`]: ok({
    startAt: 0,
    total: 0,
    comments: [],
  }),
  [`GET /rest/api/3/issue/${key}/remotelink`]: ok([]),
});

test("a live read has no points where its board takes no estimates, and null where unestimated", async () => {
  const { transport } = fakeJira({
    ...discovery("SYN"),
    ...discovery("OA", { type: "issueCount" }, 2),
    ...read("SYN-6"),
    ...read("OA-7"),
  });
  const source = jiraSource({ transport, site, projects: ["SYN", "OA"], log: () => {} });
  const [syn, oa] = await source.read(["jira:SYN-6", "jira:OA-7"]);
  assert.ok(syn?.status === "ok" && oa?.status === "ok");
  assert.equal(syn.content.points, null);
  assert.ok(!("points" in oa.content));
});

test("a project not listed is found on its own, and found again after a refresh", async () => {
  const { transport, calls } = fakeJira({
    ...discovery("SYN"),
    ...discovery("OA", { type: "issueCount" }, 2),
  });
  const boards = jiraBoards({ transport, projects: ["SYN"], log: () => {} });
  const boardReads = () => calls.filter((c) => c.path.includes("projectKeyOrId")).length;
  assert.equal(await boards.field("SYN"), pointsField);
  assert.equal(await boards.field("OA"), undefined);
  assert.equal(await boards.field("OA"), undefined);
  assert.equal(boardReads(), 2);
  // Only the listed projects say whether they take estimates.
  assert.deepEqual(boards.unestimating(), new Set());
  await boards.refresh();
  assert.equal(await boards.field("OA"), undefined);
  assert.equal(boardReads(), 4);
});
