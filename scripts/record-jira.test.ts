import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { pathToFileURL } from "node:url";
import { recordingEnv, scrub } from "./record-jira.ts";

// A made-up account, and a value beside it the recording never takes.
const account = {
  site: "https://oriel.atlassian.net",
  email: "pm@example.com",
  token: "fake-jira-token-0123",
};
const envText = `JIRA_SITE=${account.site}\nJIRA_EMAIL=${account.email}\nJIRA_API_TOKEN=${account.token}\nANTHROPIC_API_KEY=sk-ant-fake\n`;

const realDir = (t: TestContext) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oriel-record-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test("--env names the .env to record as, a regular file with one link; else the root's", async (t) => {
  const dir = realDir(t);
  const path = join(dir, "main.env");
  writeFileSync(path, envText);
  const root = pathToFileURL(join(dir, "missing", ".env"));
  assert.deepEqual(await recordingEnv(path, root), account);
  const link = join(dir, "link.env");
  symlinkSync(path, link);
  assert.deepEqual(await recordingEnv(link, root), {
    error: `${link} is not a regular file with one link; it is refused`,
  });
  const none = join(dir, "none.env");
  assert.deepEqual(await recordingEnv(none, root), { error: `no file at ${none}` });
  // Without --env, the root's, as before: none there, or this one.
  assert.ok("error" in (await recordingEnv(undefined, root)));
  assert.deepEqual(await recordingEnv(undefined, pathToFileURL(path)), account);
  // No problem quotes a value from the file.
  writeFileSync(join(dir, "partial.env"), `JIRA_API_TOKEN=${account.token}\n`);
  const partial = await recordingEnv(join(dir, "partial.env"), root);
  assert.ok("error" in partial && !partial.error.includes(account.token));
});

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
