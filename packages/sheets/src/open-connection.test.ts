import assert from "node:assert/strict";
import { test } from "node:test";
import { instant, ulid } from "@oriel/core";
import { fixturePicks } from "./declared-fixture.ts";
import { loadSheetsFixture } from "./fixture.ts";
import { SecretRefused, SheetsError } from "./google.ts";
import { sheetsDeclaration } from "./declaration.ts";
import { tokenEndpoint } from "./oauth.ts";
import { openSheets } from "./open-connection.ts";
import { fixtureGoogle, standInToken } from "./stand-in.ts";

const fixture = loadSheetsFixture();
const now = instant(new Date(Date.UTC(2026, 10, 3, 9)));

const opened = (secret: string | null, options: Record<string, unknown> = {}) =>
  openSheets(
    {
      id: ulid(1, new Uint8Array(10)),
      number: 1,
      prefix: "sheets",
      identity: fixture.user.permissionId,
      options: { ...fixturePicks(fixture), ...options },
      secret,
    },
    { fetch: fixtureGoogle(fixture).fetch, kept: true, log: () => {}, now: () => now },
  );

const drain = async (source: Awaited<ReturnType<typeof opened>>["source"]) => {
  const records = [];
  for await (const page of source.sync(null)) records.push(...page.records);
  return records;
};

test("an expired or missing token fails the whole sync, read as signed out", async () => {
  for (const secret of [
    JSON.stringify({ access: standInToken, expiresAt: Date.parse(now) - 1 }),
    "not json",
    JSON.stringify({ access: "two\nlines", expiresAt: Date.parse(now) + 60_000 }),
    null,
  ]) {
    const sheets = await opened(secret);
    const failed = await drain(sheets.source).then(
      () => null,
      (error: unknown) => error,
    );
    assert.ok(failed instanceof SheetsError, String(secret));
  }
});

test("a refresh Google refuses for want of the client's secret fails the whole sync, and isn't signed out", async () => {
  const google = fixtureGoogle(fixture);
  const forms: URLSearchParams[] = [];
  const logged: string[] = [];
  const sheets = await openSheets(
    {
      id: ulid(1, new Uint8Array(10)),
      number: 1,
      prefix: "sheets",
      identity: fixture.user.permissionId,
      options: fixturePicks(fixture),
      secret: JSON.stringify({ access: standInToken, refresh: "r", expiresAt: Date.parse(now) }),
    },
    {
      fetch: async (input, init) => {
        if (String(input) !== tokenEndpoint) return google.fetch(input, init);
        forms.push(new URLSearchParams(String(init?.body)));
        return Response.json(
          { error: "invalid_request", error_description: "client_secret is missing." },
          { status: 400 },
        );
      },
      client: { GOOGLE_CLIENT_ID: "fake-client.apps.googleusercontent.com" },
      kept: true,
      log: (message) => logged.push(message),
      now: () => now,
    },
  );
  const failed = await drain(sheets.source).then(
    () => null,
    (error: unknown) => error,
  );
  assert.ok(failed instanceof SecretRefused);
  assert.equal(sheets.signedOut?.(), false);
});

const live = JSON.stringify({ access: standInToken, expiresAt: Date.parse(now) + 60_000 });

test("a connection may propose changes unless it is set read-only, when no writer can be built", async () => {
  const writable = await opened(live);
  assert.ok(writable.writes);
  assert.ok(writable.context());

  const readOnly = await opened(live, { readOnly: true });
  assert.equal(readOnly.writes, undefined);
  assert.equal(readOnly.context(), undefined);
  // Its change sets can still be shown.
  assert.ok(readOnly.fields);
  // Only off, or no option, may propose changes.
  assert.equal((await opened(live, { readOnly: "no" })).writes, undefined);
  assert.ok((await opened(live, { readOnly: false })).writes);
});

test("the read-only switch is one of the options a person sets, which configuring keeps", () => {
  const options = { ...fixturePicks(fixture), readOnly: true };
  const kept = sheetsDeclaration.options(options);
  assert.ok(kept.ok);
  assert.equal(kept.value.readOnly, true);
  assert.equal(sheetsDeclaration.options({ ...options, readOnly: "yes" }).ok, false);
});
