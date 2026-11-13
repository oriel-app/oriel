import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDeclared, sourceKinds, specs } from "./index.ts";

test("an item ID outside its kind's declared shape is refused", () => {
  // A folder key is a hash, never a path.
  for (const id of ["jira:SYN-12", "folder:0123456789abcdef", "linear:ENG-4"])
    assert.ok(parseDeclared(id), id);
  const bad = [
    "slack:C1",
    "jira:syn-1",
    "jira:SYN-0",
    "folder:plan.md",
    "folder:0123456789ABCDEF",
    "folder:0123456789abcde",
    "folder:0123456789abcdef0",
    "sheets:anything",
    "linear:eng-4",
    "linear:ENG-0",
    "linear:P-5E2A9C41B7D0",
    "linear:P-summer-timetable-launch",
  ];
  for (const id of bad) assert.equal(parseDeclared(id), null, id);
});

test("an untagged create from before migration 0031 goes to the source it was made for", () => {
  const first = (op: string) => sourceKinds.find((kind) => specs[kind]?.ops[op]);
  assert.equal(first("createEpic"), "jira");
  assert.equal(first("createStory"), "jira");
  assert.equal(first("createIssue"), "linear");
  assert.equal(first("createProject"), "linear");
});
