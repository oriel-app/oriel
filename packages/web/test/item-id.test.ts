// The page reads an item ID's kind the way core does, though it can't import
// core's code.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseItemId } from "@oriel/core";
import { isItemId, kindOfItem } from "../src/item-id.ts";

test("the page reads an item ID's kind as core does, numbered connections included", () => {
  const ids = [
    "jira:SYN-12",
    "jira.2:ACME-4",
    "folder:3f9a00c1d2e4b5a6",
    "slack:C0A1B2C3D-1759309200.000100",
    "slack.12:C0A1B2C3D-1759309200.000100",
    "jira.1:SYN-12",
    "jira.02:SYN-12",
    "jira.0:SYN-12",
    "Jira:SYN-12",
    "j:SYN-12",
    "jira:",
    "jira:SYN 12",
    "jira:SYN-12/x",
    "01JBZ0000000000000000000T1",
    "https://example.com/x",
  ];
  for (const id of ids) {
    assert.equal(isItemId(id), parseItemId(id) !== null, id);
    assert.equal(kindOfItem(id), parseItemId(id)?.kind ?? null, id);
  }
});
