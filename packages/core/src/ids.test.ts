import assert from "node:assert/strict";
import { test } from "node:test";
import {
  instant,
  isInstant,
  isItemId,
  isPrefix,
  isUlid,
  itemId,
  itemOrder,
  kindOf,
  parseItemId,
  ulid,
} from "./ids.ts";

test("item IDs round-trip, as a kind's first connection and a later one", () => {
  assert.equal(itemId("jira", "SYN-12"), "jira:SYN-12");
  assert.deepEqual(parseItemId("jira:SYN-12"), { kind: "jira", prefix: "jira", key: "SYN-12" });
  assert.equal(itemId("jira.2", "ACME-4"), "jira.2:ACME-4");
  assert.deepEqual(parseItemId("jira.2:ACME-4"), { kind: "jira", prefix: "jira.2", key: "ACME-4" });
  assert.deepEqual(parseItemId("sheets.10:1aB_c-9.x"), {
    kind: "sheets",
    prefix: "sheets.10",
    key: "1aB_c-9.x",
  });
  assert.equal(kindOf("jira.2"), "jira");
  assert.equal(kindOf("jira"), "jira");
  assert.ok(isPrefix("jira") && isPrefix("jira.2"));
  assert.ok(!isPrefix("jira.1") && !isPrefix("Jira") && !isPrefix("jira:"));
});

// Decision 0049's one-way door: every ID that exists now keeps its meaning,
// as its kind's first connection's.
test("today's IDs parse as they did, each its kind's first connection", () => {
  const today = [
    ["jira:SYN-12", "jira", "SYN-12"],
    ["jira:ORL_2-1009", "jira", "ORL_2-1009"],
    ["folder:3f9a00c1d2e4b5a6", "folder", "3f9a00c1d2e4b5a6"],
    ["slack:C0A1B2C3D-1759309200.000100", "slack", "C0A1B2C3D-1759309200.000100"],
    ["slack:G0FW1WEATHR-1788444000.000100", "slack", "G0FW1WEATHR-1788444000.000100"],
  ] as const;
  for (const [id, kind, key] of today) {
    assert.deepEqual(parseItemId(id), { kind, prefix: kind, key }, id);
    assert.equal(itemId(kind, key), id);
  }
});

test("only IDs safe in generated code are item IDs, whatever their kind", () => {
  const bad = [
    "jira:",
    ":SYN-1",
    "SYN-1",
    "j:SYN-1",
    "Jira:SYN-1",
    "jira2:SYN-1",
    "averyveryverylongkind:SYN-1",
    "jira.1:SYN-1",
    "jira.0:SYN-1",
    "jira.02:SYN-1",
    "jira.:SYN-1",
    "jira.2.3:SYN-1",
    "jira:SYN-1 ",
    'jira:SYN-1"; fetch("x")',
    "jira:SYN-1*/",
    "jira:SYN:1",
    "jira:../../etc/passwd",
    "folder:Q3 plan.md",
    `jira:${"A".repeat(129)}`,
  ];
  for (const id of bad) assert.equal(isItemId(id), false, id);
  assert.throws(() => itemId("jira", "SYN-1\n"), RangeError);
  assert.throws(() => itemId("folder", "Q3 plan.md"), RangeError);
  assert.throws(() => itemId("jira.1", "SYN-1"), RangeError);
});

test("item IDs order by declared kind, then connection, then key, numbers as numbers", () => {
  const order = itemOrder(["jira", "folder", "slack"]);
  const ids = [
    "slack:C0A1B2C3D-1759309200.000100",
    "sheets:b",
    "jira.2:ACME-1",
    "jira:SYN-10",
    "folder:3f9a00c1d2e4b5a6",
    "jira:SYN-9",
    "notes:a",
    "jira.10:ACME-1",
  ];
  assert.deepEqual(ids.toSorted(order), [
    "jira:SYN-9",
    "jira:SYN-10",
    "jira.2:ACME-1",
    "jira.10:ACME-1",
    "folder:3f9a00c1d2e4b5a6",
    "slack:C0A1B2C3D-1759309200.000100",
    "notes:a",
    "sheets:b",
  ]);
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
