import assert from "node:assert/strict";
import { test } from "node:test";
import { isItemId, itemId, parseItemId } from "./ids.ts";

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
