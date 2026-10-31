import assert from "node:assert/strict";
import { test } from "node:test";
import type { IndexRecord, Instant, ItemId } from "@oriel/core";
import { resolveDropped } from "./dropped.ts";

const record = (id: ItemId, location: string): IndexRecord => ({
  id,
  stableId: id,
  title: id,
  location,
  updatedAt: "2026-10-30T00:00:00.000Z" as Instant,
  facets: {},
  attrs: null,
});

const records = [
  record("jira:OA-5", "https://oriel.atlassian.net/browse/OA-5"),
  record("jira:OA-12", "https://oriel.atlassian.net/browse/OA-12"),
  record("folder:a1", "file:///notes/plans/q3-launch.md"),
  record("folder:b2", "file:///notes/Plan.md"),
  record("folder:c3", "file:///notes/archive/Plan.md"),
  record("folder:d4", "file:///notes/caf%C3%A9.md"),
];

test("a dropped Jira card is its issue's link; query, fragment and a trailing slash don't matter", () => {
  assert.deepEqual(
    resolveDropped(records, {
      links: [
        "https://oriel.atlassian.net/browse/OA-5",
        "https://oriel.atlassian.net/browse/OA-12/?focusedCommentId=1#c",
      ],
      files: [],
    }),
    { ids: ["jira:OA-5", "jira:OA-12"], refused: [] },
  );
});

test("text or a page that names an item by its handle finds it; each item once", () => {
  assert.deepEqual(
    resolveDropped(records, {
      links: [
        "https://oriel.atlassian.net/jira/software/projects/OA/boards/1?selectedIssue=OA-12",
        "test ticket\nOA-5",
        "OA-5",
      ],
      files: [],
    }).ids,
    ["jira:OA-12", "jira:OA-5"],
  );
});

test("a file matches the one folder file with its name, in either Unicode form", () => {
  assert.deepEqual(resolveDropped(records, { links: [], files: ["q3-launch.md", "café.md"] }).ids, [
    "folder:a1",
    "folder:d4",
  ]);
});

test("what names nothing, or a name two files share, is refused with why", () => {
  const { ids, refused } = resolveDropped(records, {
    links: ["https://example.com/doc", "just some words", "javascript:alert(1)"],
    files: ["Plan.md", "elsewhere.md"],
  });
  assert.deepEqual(ids, []);
  assert.deepEqual(
    refused.map((r) => [r.what, r.why.split(".")[0]]),
    [
      ["https://example.com/doc", "Oriel doesn't have this page"],
      ["just some words", "This doesn't name anything Oriel has"],
      ["javascript:alert(1)", "This doesn't name anything Oriel has"],
      ["Plan.md", "The connected folder has more than one file by this name"],
      [
        "elsewhere.md",
        "Only files in the connected folder can be added, and it has no file by this name",
      ],
    ],
  );
});
