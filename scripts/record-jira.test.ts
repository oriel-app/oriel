import assert from "node:assert/strict";
import { test } from "node:test";
import { scrub } from "./record-jira.ts";

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

test("mentions, bare account IDs and zone offsets are scrubbed too", () => {
  const people = new Map<string, string>();
  const scrubbed = scrub(
    {
      created: "2026-10-29T09:30:00.000+0100",
      due: "2026-10-29",
      location: { userAccountId: "712020:real-id" },
      body: {
        type: "doc",
        content: [
          { type: "mention", attrs: { id: "712020:other", text: "@Real Other", accessLevel: "" } },
        ],
      },
    },
    people,
  );
  assert.deepEqual(scrubbed, {
    created: "2026-10-29T08:30:00.000+0000",
    due: "2026-10-29",
    location: { userAccountId: "person-1" },
    body: {
      type: "doc",
      content: [{ type: "mention", attrs: { id: "person-2", text: "@Person 2" } }],
    },
  });
  for (const secret of ["real-id", "other", "Real", "+0100"])
    assert.ok(!JSON.stringify(scrubbed).includes(secret), secret);
});
