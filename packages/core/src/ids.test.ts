import assert from "node:assert/strict";
import { test } from "node:test";
import { instant, isInstant, isItemId, isUlid, itemId, parseItemId, ulid } from "./ids.ts";

test("source-qualified IDs round-trip", () => {
  assert.equal(itemId("jira", "SYN-12"), "jira:SYN-12");
  assert.deepEqual(parseItemId("jira:SYN-12"), { source: "jira", key: "SYN-12" });
});

test("only well-formed keys of known sources are item IDs", () => {
  const bad = [
    "slack:C1",
    "jira:",
    ":SYN-1",
    "SYN-1",
    "jira:syn-1",
    "jira:SYN-0",
    "jira:SYN-1 ",
    'jira:SYN-1"; fetch("x")',
    "jira:SYN-1*/",
    "jira:SYN:1",
  ];
  for (const id of bad) assert.equal(isItemId(id), false, id);
  assert.throws(() => itemId("jira", "SYN-1\n"), RangeError);
});

test("instants are canonical UTC with milliseconds", () => {
  assert.equal(instant(new Date(Date.UTC(2026, 9, 28, 12))), "2026-10-28T12:00:00.000Z");
  assert.equal(isInstant("2026-10-28T12:00:00.000Z"), true);
  for (const value of [
    "2026-10-28T12:00:00Z",
    "2026-10-28T12:00:00.000+01:00",
    "2026-02-30T12:00:00.000Z",
    "2026-10-28T24:00:00.000Z",
    "not a date",
  ]) {
    assert.equal(isInstant(value), false, value);
  }
});

test("a ULID encodes the time it is given", () => {
  const zeros = new Uint8Array(10);
  assert.equal(ulid(0, zeros), "00000000000000000000000000");
  assert.equal(ulid(1_469_918_176_385, zeros).slice(0, 10), "01ARYZ6S41");
  assert.equal(
    ulid(Date.UTC(2026, 9, 28), new Uint8Array(10).fill(255)).slice(10),
    "ZZZZZZZZZZZZZZZZ",
  );
});

test("ULIDs sort by time and validate", () => {
  const earlier = ulid(1_000);
  const later = ulid(2_000);
  assert.ok(earlier < later);
  assert.equal(isUlid(later), true);
  assert.equal(isUlid("not-a-ulid"), false);
});

test("a ULID refuses times it can't encode", () => {
  assert.throws(() => ulid(-1), RangeError);
  assert.throws(() => ulid(2 ** 48), RangeError);
});
