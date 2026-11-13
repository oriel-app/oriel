import assert from "node:assert/strict";
import { test } from "node:test";
import { instant, ulid } from "@oriel/core";
import { fixturePicks } from "./declared-fixture.ts";
import { loadSheetsFixture } from "./fixture.ts";
import { sheetsDeclaration } from "./declaration.ts";
import { openSheets } from "./open-connection.ts";
import { fixtureGoogle } from "./stand-in.ts";

const fixture = loadSheetsFixture();
const now = instant(new Date(Date.UTC(2026, 10, 3, 9)));

const opened = (options: Record<string, unknown> = {}) =>
  openSheets(
    {
      id: ulid(1, new Uint8Array(10)),
      number: 1,
      prefix: "sheets",
      identity: fixture.user.permissionId,
      options: { ...fixturePicks(fixture), ...options },
    },
    { fetch: fixtureGoogle(fixture).fetch, log: () => {}, now: () => now },
  );

test("a connection may propose changes unless it is set read-only, when no writer can be built", async () => {
  const writable = await opened();
  assert.ok(writable.writes);
  assert.ok(writable.context());

  const readOnly = await opened({ readOnly: true });
  assert.equal(readOnly.writes, undefined);
  assert.equal(readOnly.context(), undefined);
  assert.ok(readOnly.fields);
  assert.equal((await opened({ readOnly: "no" })).writes, undefined);
  assert.ok((await opened({ readOnly: false })).writes);
});

test("the read-only switch is one of the options a person sets, which configuring keeps", () => {
  const options = { ...fixturePicks(fixture), readOnly: true };
  const kept = sheetsDeclaration.options(options);
  assert.ok(kept.ok);
  assert.equal(kept.value.readOnly, true);
  assert.equal(sheetsDeclaration.options({ ...options, readOnly: "yes" }).ok, false);
});
