import assert from "node:assert/strict";
import { test } from "node:test";
import { instant, ulid } from "@oriel/core";
import { fixturePicks } from "./declared-fixture.ts";
import { loadSheetsFixture } from "./fixture.ts";
import { SheetsError } from "./google.ts";
import { openSheets, sheetsProblem } from "./open-connection.ts";
import { fixtureGoogle, standInToken } from "./stand-in.ts";

const fixture = loadSheetsFixture();
const now = instant(new Date(Date.UTC(2026, 10, 3, 9)));

const opened = (secret: string | null) =>
  openSheets(
    {
      id: ulid(1, new Uint8Array(10)),
      number: 1,
      prefix: "sheets",
      identity: fixture.user.permissionId,
      options: fixturePicks(fixture),
      secret,
    },
    { fetch: fixtureGoogle(fixture).fetch, kept: true, log: () => {}, now: () => now },
  );

const drain = async (source: Awaited<ReturnType<typeof opened>>["source"]) => {
  const records = [];
  for await (const page of source.sync(null)) records.push(...page.records);
  return records;
};

test("a connection reads with its access token while it lasts", async () => {
  const sheets = await opened(
    JSON.stringify({ access: standInToken, refresh: "r", expiresAt: Date.parse(now) + 60_000 }),
  );
  assert.equal(sheets.incremental, true);
  assert.ok((await drain(sheets.source)).length > 0);
});

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
    assert.match(sheetsProblem(failed), /signing in again/);
  }
});
