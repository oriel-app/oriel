import assert from "node:assert/strict";
import { test } from "node:test";
import { type ItemId, type SourceWriter, ulid, type WriteRequest } from "@oriel/core";
import { textToAdf } from "./adf.ts";
import {
  discovery,
  issueType,
  jiraIssue,
  missing,
  ok,
  parent,
  person,
  pointsField,
  site,
} from "./fake-jira.ts";
import type { JiraRequest, JiraResponse, Transport } from "./transport.ts";
import { jiraWriter } from "./writer.ts";

// Stands in for packages/changeset, the only place that mints approvals in
// production. These tests cover the REST mapping, not the approval gate.
// scripts/check-repo.ts allows this cast only in an adapter's writer test.
const approve = (request: WriteRequest<"jira">) =>
  request as Parameters<SourceWriter<"jira">["apply"]>[0];

// The fake's update time after its nth accepted write.
const at = (n: number) => new Date(Date.UTC(2026, 9, 29, 9, 0, n)).toISOString();

let seq = 0;
const request = (op: string, target: ItemId<"jira"> | null, args: unknown) =>
  approve({ mutationId: ulid(0, new Uint8Array(10).fill(seq++ % 256)), op, target, args });

// A small stateful Jira: issues and remote links that writes change.
function fakeSite() {
  const issues = new Map<string, { id: string; fields: Record<string, unknown> }>();
  const links = new Map<string, { id: number; url: string; title: string }[]>();
  const fixed = discovery();
  const calls: JiraRequest[] = [];
  let nextIssue = 125;
  let nextLink = 10100;
  const put = (key: string, fields: Record<string, unknown>) => {
    const { id, fields: all } = jiraIssue(key, fields);
    issues.set(key, { id, fields: all });
    links.set(key, links.get(key) ?? []);
  };
  put("SYN-1", { issuetype: issueType("Epic"), summary: "Checkout v2" });
  put("SYN-12", {
    summary: "Retry a declined card",
    description: textToAdf("First paragraph.\n\nSecond."),
    parent: parent("SYN-1"),
    assignee: person("acc-amara", "Amara Okafor"),
    [pointsField]: 3,
  });
  links.get("SYN-12")?.push({ id: 10050, url: "https://design.example.com/x", title: "Designs" });

  const answer = (req: JiraRequest): JiraResponse => {
    const fixedRoute = fixed[`${req.method} ${req.path}`];
    if (fixedRoute) return typeof fixedRoute === "function" ? fixedRoute(req) : fixedRoute;
    const path = req.path.split("?")[0] ?? "";
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fields = (body.fields ?? {}) as Record<string, unknown>;
    if (req.method === "GET" && path === "/rest/api/3/issue/createmeta/SYN/issuetypes")
      return ok({
        issueTypes: ["Epic", "Story", "Task", "Subtask"].map((name) => ({
          ...issueType(name as "Story"),
          name,
        })),
      });
    if (req.method === "POST" && path === "/rest/api/3/issue") {
      const key = `SYN-${nextIssue++}`;
      const project = fields.project as { key: string };
      assert.equal(project.key, "SYN");
      const { parent: up, issuetype, project: _, ...rest } = fields;
      assert.deepEqual(issuetype, { id: "10001" });
      put(key, { ...rest, ...(up ? { parent: parent((up as { key: string }).key) } : {}) });
      return ok({ id: issues.get(key)?.id, key, self: `${site}/rest/api/3/issue/${key}` }, 201);
    }
    const match =
      /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)(\/assignee|\/remotelink(?:\/(\d+))?)?$/.exec(path);
    const key = match?.[1] ?? "";
    const issue = issues.get(key);
    if (!match || !issue) return missing;
    const [, , sub, linkId] = match;
    const issueLinks = links.get(key) ?? [];
    if (sub === undefined && req.method === "GET")
      return ok({ ...jiraIssue(key), id: issue.id, fields: issue.fields });
    if (sub === undefined && req.method === "PUT") {
      Object.assign(issue.fields, fields);
      return { status: 204, body: null };
    }
    if (sub === undefined && req.method === "DELETE") {
      issues.delete(key);
      return { status: 204, body: null };
    }
    if (sub === "/assignee" && req.method === "PUT") {
      const accountId = body.accountId as string | null;
      issue.fields.assignee = accountId ? person(accountId, `Person ${accountId}`) : null;
      return { status: 204, body: null };
    }
    if (sub === "/remotelink" && req.method === "POST") {
      const object = body.object as { url: string; title: string };
      const id = nextLink++;
      issueLinks.push({ id, ...object });
      return ok({ id, self: `${site}/rest/api/3/issue/${key}/remotelink/${id}` }, 201);
    }
    const link = issueLinks.find((l) => String(l.id) === linkId);
    if (!link) return missing;
    if (req.method === "GET")
      return ok({ id: link.id, self: "", object: { url: link.url, title: link.title, icon: {} } });
    if (req.method === "DELETE") {
      issueLinks.splice(issueLinks.indexOf(link), 1);
      return { status: 204, body: null };
    }
    return { status: 405, body: null };
  };

  // Each accepted write moves the issue's `updated` on a second, as Jira does.
  let clock = 0;
  const transport: Transport = async (req) => {
    calls.push(structuredClone(req));
    const response = answer(req);
    if (req.method !== "GET" && response.status < 300) {
      const written = /\/issue\/([A-Z]+-\d+)/.exec(req.path)?.[1];
      const made = (response.body as { key?: string } | null)?.key;
      const issue = issues.get(written ?? made ?? "");
      if (issue) issue.fields.updated = at(++clock).replace("Z", "+0000");
    }
    return structuredClone(response);
  };
  const writes = () => calls.filter((c) => c.method !== "GET");
  return { transport, calls, writes, issues };
}

const writer = (transport: Transport) => jiraWriter({ transport, project: "SYN", log: () => {} });

test("each edit reads before, sends one call, and reads after", async () => {
  const jira = fakeSite();
  const w = writer(jira.transport);
  const item = { id: "jira:SYN-12", stableId: "10012" };

  assert.deepEqual(await w.apply(request("setSummary", "jira:SYN-12", { summary: "Retry once" })), {
    item,
    before: { summary: "Retry a declined card" },
    after: { summary: "Retry once", updated: at(1) },
  });
  assert.deepEqual(
    await w.apply(request("setDescription", "jira:SYN-12", { description: "New.\n\nText." })),
    {
      item,
      before: { description: "First paragraph.\n\nSecond." },
      after: { description: "New.\n\nText.", updated: at(2) },
    },
  );
  assert.deepEqual(await w.apply(request("setEstimate", "jira:SYN-12", { points: null })), {
    item,
    before: { points: 3 },
    after: { points: null, updated: at(3) },
  });
  assert.deepEqual(await w.apply(request("setAssignee", "jira:SYN-12", { accountId: null })), {
    item,
    before: { assignee: "acc-amara" },
    after: { assignee: null, updated: at(4) },
  });
  assert.deepEqual(jira.writes(), [
    {
      method: "PUT",
      path: "/rest/api/3/issue/SYN-12",
      body: { fields: { summary: "Retry once" } },
    },
    {
      method: "PUT",
      path: "/rest/api/3/issue/SYN-12",
      body: { fields: { description: textToAdf("New.\n\nText.") } },
    },
    { method: "PUT", path: "/rest/api/3/issue/SYN-12", body: { fields: { [pointsField]: null } } },
    { method: "PUT", path: "/rest/api/3/issue/SYN-12/assignee", body: { accountId: null } },
  ]);
});

test("createStory goes under its epic with the board's points field, and deleteItem undoes it", async () => {
  const jira = fakeSite();
  const w = writer(jira.transport);
  const made = await w.apply(
    request("createStory", null, {
      summary: "Show the decline reason",
      description: "Say why.\nThen offer a retry.",
      points: 2,
      epic: "jira:SYN-1",
    }),
  );
  assert.deepEqual(made, {
    item: { id: "jira:SYN-125", stableId: "10125" },
    before: {},
    after: {
      summary: "Show the decline reason",
      description: "Say why.\nThen offer a retry.",
      points: 2,
      epic: "jira:SYN-1",
      updated: at(1),
    },
  });
  assert.deepEqual(jira.writes()[0]?.body, {
    fields: {
      project: { key: "SYN" },
      issuetype: { id: "10001" },
      summary: "Show the decline reason",
      description: textToAdf("Say why.\nThen offer a retry."),
      parent: { key: "SYN-1" },
      [pointsField]: 2,
    },
  });

  const removed = await w.apply(request("deleteItem", "jira:SYN-125", {}));
  assert.deepEqual(removed.before, {
    summary: "Show the decline reason",
    description: "Say why.\nThen offer a retry.",
    points: 2,
    assignee: null,
    epic: "jira:SYN-1",
  });
  assert.deepEqual(removed.after, {});
  assert.deepEqual(jira.writes()[1], { method: "DELETE", path: "/rest/api/3/issue/SYN-125" });
  assert.equal(await w.current("jira:SYN-125", ["summary"]), "gone");
});

test("addLink reports the new link by ID, and removeLink undoes it", async () => {
  const jira = fakeSite();
  const w = writer(jira.transport);
  const added = await w.apply(
    request("addLink", "jira:SYN-12", {
      url: "https://runbook.example.com/retry",
      title: "Runbook",
    }),
  );
  assert.deepEqual(added.before, { "link:10100": null });
  const link = { url: "https://runbook.example.com/retry", title: "Runbook" };
  assert.deepEqual(added.after, { "link:10100": link, updated: at(1) });
  const removed = await w.apply(request("removeLink", "jira:SYN-12", { linkId: "10100" }));
  assert.deepEqual(removed.before, { "link:10100": link });
  assert.deepEqual(removed.after, { "link:10100": null, updated: at(2) });
  assert.deepEqual(
    jira.writes().map((c) => `${c.method} ${c.path}`),
    [
      "POST /rest/api/3/issue/SYN-12/remotelink",
      "DELETE /rest/api/3/issue/SYN-12/remotelink/10100",
    ],
  );
  await assert.rejects(
    w.apply(request("removeLink", "jira:SYN-12", { linkId: "10100" })),
    /has no link 10100/,
  );
});

test("once Jira accepts a write, its result comes back even if reading it back fails", async () => {
  const jira = fakeSite();
  let wrote = false;
  const transport: Transport = async (req) => {
    if (wrote && req.method === "GET") return { status: 502, body: "Bad gateway" };
    const response = await jira.transport(req);
    if (req.method !== "GET") wrote = true;
    return response;
  };
  const w = writer(transport);
  const made = await w.apply(
    request("createStory", null, {
      summary: "Offline pass",
      description: "",
      points: null,
      epic: null,
    }),
  );
  assert.deepEqual(made, {
    item: { id: "jira:SYN-125", stableId: "10125" },
    before: {},
    after: {},
  });
  wrote = false;
  assert.deepEqual(await w.apply(request("setSummary", "jira:SYN-12", { summary: "Retry once" })), {
    item: { id: "jira:SYN-12", stableId: "10012" },
    before: { summary: "Retry a declined card" },
    after: {},
  });
  wrote = false;
  const linked = await w.apply(
    request("addLink", "jira:SYN-12", { url: "https://runbook.example.com/r", title: "Runbook" }),
  );
  assert.deepEqual(linked, {
    item: { id: "jira:SYN-12", stableId: "10012" },
    before: { "link:10100": null },
    after: {},
  });
  assert.equal(jira.writes().length, 3);
});

test("arguments and targets are checked before anything is written", async () => {
  const jira = fakeSite();
  const w = writer(jira.transport);
  const refused: [string, ItemId<"jira"> | null, unknown, RegExp][] = [
    ["removeLink", "jira:SYN-12", { linkId: "../../../project/SYN" }, /a link ID is a number/],
    ["addLink", "jira:SYN-12", { url: "javascript:alert(1)", title: "x" }, /http or https/],
    ["zeroAllEstimates", "jira:SYN-12", {}, /not a Jira operation/],
    ["toString", "jira:SYN-12", {}, /not a Jira operation/],
    ["setSummary", null, { summary: "x" }, /needs a target/],
    ["setEstimate", "jira:SYN-12", { points: "3" }, /bad arguments/],
    ["createStory", null, { summary: "x", epic: "SYN-1" }, /epic must be a Jira item ID/],
    ["setSummary", "jira:SYN-99", { summary: "x" }, /gone from Jira/],
  ];
  for (const [op, target, args, error] of refused)
    await assert.rejects(w.apply(request(op, target, args)), error, op);
  assert.deepEqual(jira.writes(), []);
});

test("current reads the named fields, and a gone item is gone", async () => {
  const w = writer(fakeSite().transport);
  assert.deepEqual(await w.current("jira:SYN-12", ["updated"]), {
    updated: "2026-10-01T11:00:00.000Z",
  });
  assert.deepEqual(
    await w.current("jira:SYN-12", [
      "summary",
      "points",
      "epic",
      "assignee",
      "link:10050",
      "link:1",
    ]),
    {
      summary: "Retry a declined card",
      points: 3,
      epic: "jira:SYN-1",
      assignee: "acc-amara",
      "link:10050": { url: "https://design.example.com/x", title: "Designs" },
      "link:1": null,
    },
  );
  assert.equal(await w.current("jira:SYN-99", ["summary"]), "gone");
  await assert.rejects(w.current("jira:SYN-12", ["priority"]), /not a Jira field/);
});

test("a write Jira refuses fails with Jira's own message", async () => {
  const jira = fakeSite();
  const refusing: Transport = async (req) =>
    req.method === "PUT"
      ? { status: 400, body: { errorMessages: [], errors: { summary: "Summary is too long." } } }
      : jira.transport(req);
  await assert.rejects(
    writer(refusing).apply(request("setSummary", "jira:SYN-12", { summary: "x" })),
    /PUT \/rest\/api\/3\/issue\/SYN-12: 400 summary: Summary is too long\./,
  );
});
