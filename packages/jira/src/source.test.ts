import assert from "node:assert/strict";
import { test } from "node:test";
import type { Log, SyncPage } from "@oriel/core";
import type { JiraAttrs } from "./attrs.ts";
import {
  discovery,
  fakeJira,
  jiraIssue,
  missing,
  ok,
  pointsField,
  type Route,
  site,
} from "./fake-jira.ts";
import { jiraSource } from "./source.ts";
import type { JiraRequest } from "./transport.ts";

const search = "POST /rest/api/3/search/jql";

function logged() {
  const lines: { message: string; fields?: Record<string, unknown> }[] = [];
  const log: Log = (message, fields) => lines.push({ message, ...(fields ? { fields } : {}) });
  return { lines, log };
}

// Search pages, chained by nextPageToken like Jira's enhanced search.
function pages(...issues: unknown[][]): Route {
  return (request: JiraRequest) => {
    const body = request.body as { nextPageToken?: string };
    const at = body.nextPageToken ? Number(body.nextPageToken.slice(1)) : 0;
    const next = at + 1 < issues.length ? `p${at + 1}` : undefined;
    return ok({ issues: issues[at] ?? [], ...(next ? { nextPageToken: next } : { isLast: true }) });
  };
}

async function listAll(source: ReturnType<typeof jiraSource>, cursor: string | null) {
  const listed: SyncPage<"jira", JiraAttrs>[] = [];
  for await (const page of source.sync(cursor)) listed.push(page);
  return listed;
}

test("an issue in a shape Oriel can't read is skipped and logged; odd values degrade", async () => {
  const { transport } = fakeJira({
    ...discovery(),
    [search]: pages([
      jiraIssue("SYN-30", { summary: null }),
      jiraIssue("SYN-31", {
        status: { name: "Parked", statusCategory: { key: "undefined" } },
        [pointsField]: "3",
      }),
      { id: "10032", key: "not a key", fields: {} },
    ]),
  });
  const { lines, log } = logged();
  const listed = await listAll(jiraSource({ transport, site, projects: ["SYN"], log }), null);
  assert.deepEqual(
    listed[0]?.records.map((r) => [r.id, r.attrs.status, r.facets.state, r.facets.estimate]),
    [["jira:SYN-31", "Parked", "todo", null]],
  );
  assert.equal(lines.length, 2);
  // Logs carry where the shape broke, never the content.
  assert.ok(!JSON.stringify(lines).includes("Summary of"));
});

test("a missing ID is a result, never a throw: deleted, forbidden or moved", async () => {
  const fields = `summary,issuetype,status,parent,assignee,labels,updated,${pointsField},description`;
  const { transport } = fakeJira({
    ...discovery(),
    [`GET /rest/api/3/issue/SYN-27?fields=${fields}&expand=transitions`]: missing,
    [`GET /rest/api/3/issue/SYN-28?fields=${fields}&expand=transitions`]: {
      status: 403,
      body: { errorMessages: [] },
    },
    // Jira answers an old key with the issue under its new one.
    [`GET /rest/api/3/issue/SYN-29?fields=${fields}&expand=transitions`]: ok(jiraIssue("OA-4")),
  });
  const { log } = logged();
  const source = jiraSource({ transport, site, projects: ["SYN"], log });
  assert.deepEqual(await source.read(["jira:SYN-27", "jira:SYN-28", "jira:SYN-29"]), [
    { id: "jira:SYN-27", status: "gone", reason: "deleted" },
    { id: "jira:SYN-28", status: "gone", reason: "forbidden" },
    { id: "jira:SYN-29", status: "moved", to: "jira:OA-4" },
  ]);
});

test("a failed credential is an error, not a missing item", async () => {
  const fields = `summary,issuetype,status,parent,assignee,labels,updated,${pointsField},description`;
  const { transport } = fakeJira({
    ...discovery(),
    [`GET /rest/api/3/issue/SYN-1?fields=${fields}&expand=transitions`]: {
      status: 401,
      body: "Unauthorized",
    },
  });
  const { log } = logged();
  const source = jiraSource({ transport, site, projects: ["SYN"], log });
  await assert.rejects(source.read(["jira:SYN-1"]), /401/);
});

test("project keys are checked before they reach JQL", () => {
  const { transport } = fakeJira({});
  const { log } = logged();
  for (const projects of [[], ['SYN") OR project is not EMPTY OR ("'], ["syn"]])
    assert.throws(() => jiraSource({ transport, site, projects, log }), RangeError);
});

test("records fails when Jira won't answer, and skips an issue it can't read, neither one gone", async () => {
  const fields = `summary,issuetype,status,parent,assignee,labels,updated,${pointsField},description`;
  const { transport } = fakeJira({
    ...discovery(),
    [`GET /rest/api/3/issue/SYN-1?fields=${fields}`]: { status: 401, body: "Unauthorized" },
    [`GET /rest/api/3/issue/SYN-2?fields=${fields}`]: ok({ id: "10002", key: "SYN-2", fields: {} }),
  });
  const { lines, log } = logged();
  const source = jiraSource({ transport, site, projects: ["SYN"], log });
  assert.ok(source.records);
  await assert.rejects(source.records(["jira:SYN-1"]), /401/);
  assert.deepEqual(await source.records(["jira:SYN-2"]), { records: [], gone: [], texts: {} });
  assert.equal(lines.length, 1);
});
