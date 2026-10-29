import assert from "node:assert/strict";
import { test } from "node:test";
import { readOnly, scrub } from "./record-jira.ts";

test("people become placeholders, the same one everywhere, with no email, avatar or zone", () => {
  const amara = {
    self: "https://oriel.atlassian.net/rest/api/3/user?accountId=712020:real-id",
    accountId: "712020:real-id",
    emailAddress: "real.person@example.com",
    avatarUrls: { "48x48": "https://avatar.example.com/real.png" },
    displayName: "Real Person",
    active: true,
    timeZone: "Europe/Lisbon",
    locale: "en_GB",
  };
  const scrubbed = scrub({
    fields: { assignee: amara, summary: "Kept as is", labels: ["x"] },
    comments: [{ author: amara, updateAuthor: { ...amara }, body: { type: "doc" } }],
    timeZone: "Europe/Lisbon",
  });
  assert.deepEqual(scrubbed, {
    fields: {
      assignee: { accountId: "person-1", displayName: "Person 1", active: true },
      summary: "Kept as is",
      labels: ["x"],
    },
    comments: [
      {
        author: { accountId: "person-1", displayName: "Person 1", active: true },
        updateAuthor: { accountId: "person-1", displayName: "Person 1", active: true },
        body: { type: "doc" },
      },
    ],
  });
  for (const secret of ["real-id", "real.person", "Real Person", "Lisbon", "avatar"])
    assert.ok(!JSON.stringify(scrubbed).includes(secret), secret);
});

test("the recorder sends only reads", async () => {
  const sent: string[] = [];
  const transport = readOnly(async (request) => {
    sent.push(`${request.method} ${request.path}`);
    return { status: 200, body: null };
  });
  await transport({ method: "GET", path: "/rest/api/3/myself" });
  await transport({ method: "POST", path: "/rest/api/3/search/jql", body: {} });
  for (const write of [
    { method: "POST" as const, path: "/rest/api/3/issue" },
    { method: "PUT" as const, path: "/rest/api/3/issue/SYN-1" },
    { method: "DELETE" as const, path: "/rest/api/3/issue/SYN-1" },
  ])
    await assert.rejects(transport(write), /refusing to record a write/);
  assert.deepEqual(sent, ["GET /rest/api/3/myself", "POST /rest/api/3/search/jql"]);
});
