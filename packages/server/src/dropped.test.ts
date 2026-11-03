import assert from "node:assert/strict";
import { test } from "node:test";
import type { IndexRecord, Instant, ItemId } from "@oriel/core";
import { sources } from "@oriel/sources";
import { resolveDropped } from "./dropped.ts";

const changed = "2026-10-30T00:00:00.000Z";
const at = Date.parse(changed);

const record = (id: ItemId, location: string): IndexRecord => ({
  id,
  stableId: id,
  title: id,
  location,
  updatedAt: changed as Instant,
  facets: {},
  attrs: null,
});

const records = [
  record("jira:OA-5", "https://oriel.atlassian.net/browse/OA-5"),
  record("jira:OA-12", "https://oriel.atlassian.net/browse/OA-12"),
  record("jira:MY_APP-3", "https://oriel.atlassian.net/browse/MY_APP-3"),
  record("jira:A-7", "https://oriel.atlassian.net/browse/A-7"),
  record("folder:00000000000000a1", "file:///notes/plans/q3-launch.md"),
  record("folder:00000000000000b2", "file:///notes/Plan.md"),
  record("folder:00000000000000c3", "file:///notes/archive/Plan.md"),
  record("folder:00000000000000d4", "file:///notes/caf%C3%A9.md"),
];

const links = (...dropped: string[]) =>
  resolveDropped(records, { links: dropped, files: [] }, sources);

test("a dropped Jira card is its issue's link; query, fragment and a trailing slash don't matter", () => {
  assert.deepEqual(
    links(
      "https://oriel.atlassian.net/browse/OA-5",
      "https://oriel.atlassian.net/browse/OA-12/?focusedCommentId=1#c",
    ),
    { ids: ["jira:OA-5", "jira:OA-12"], refused: [] },
  );
});

test("a link to an indexed site names an item by a whole path segment or query value", () => {
  assert.deepEqual(
    links("https://oriel.atlassian.net/jira/software/projects/OA/boards/1?selectedIssue=OA-12").ids,
    ["jira:OA-12"],
  );
  // A key inside a longer segment, or on another site, isn't the item.
  const { ids, refused } = links(
    "https://oriel.atlassian.net/wiki/spaces/OA/pages/1/OA-5+postmortem",
    "https://github.com/oriel-app/oriel/tree/OA-5",
  );
  assert.deepEqual(ids, []);
  assert.deepEqual(
    refused.map((r) => r.syncMightHelp),
    [true, false],
  );
});

test("text names the items whose handles are words in it, whatever their shape; each once", () => {
  assert.deepEqual(links("test ticket\nOA-5", "OA-5", "MY_APP-3 and A-7.").ids, [
    "jira:OA-5",
    "jira:MY_APP-3",
    "jira:A-7",
  ]);
});

test("a file is the folder file with its name and time, in either Unicode form", () => {
  const files = [
    { name: "q3-launch.md", modified: at + 900 },
    { name: "café.md", modified: at },
  ];
  assert.deepEqual(resolveDropped(records, { links: [], files }, sources).ids, [
    "folder:00000000000000a1",
    "folder:00000000000000d4",
  ]);
});

test("what names nothing, another file by a folder file's name, or two like it, is refused with why", () => {
  const { ids, refused } = resolveDropped(
    records,
    {
      links: ["https://example.com/doc", "just some words", "javascript:alert(1)"],
      files: [
        { name: "q3-launch.md", modified: at - 60_000 },
        { name: "Plan.md", modified: at },
        { name: "elsewhere.md", modified: at },
      ],
    },
    sources,
  );
  assert.deepEqual(ids, []);
  assert.deepEqual(
    refused.map((r) => [r.what, r.why.split(/[.;,]/)[0], r.syncMightHelp]),
    [
      ["https://example.com/doc", "Only Jira and Folder items can be added", false],
      ["just some words", "This doesn't name anything Oriel has", false],
      ["javascript:alert(1)", "This doesn't name anything Oriel has", true],
      ["q3-launch.md", "This isn't the connected folder's file by this name", true],
      ["Plan.md", "The connected folder has more than one file like this one", false],
      ["elsewhere.md", "Only files in the connected folder can be added", true],
    ],
  );
});

test("a file is refused as not in the connected folder, or as having no folder to be in", () => {
  const why = (from: readonly IndexRecord[]) =>
    resolveDropped(from, { links: [], files: [{ name: "elsewhere.md", modified: at }] }, sources)
      .refused[0];
  assert.deepEqual(why(records), {
    what: "elsewhere.md",
    why: "Only files in the connected folder can be added, and it has no file by this name.",
    syncMightHelp: true,
  });
  const jira = records.filter((r) => r.id.startsWith("jira:"));
  for (const from of [jira, []])
    assert.deepEqual(why(from), {
      what: "elsewhere.md",
      why: "No folder of markdown files is connected, so no file can be added. Add one at the foot of the sidebar.",
      syncMightHelp: false,
    });
});

test("a link to a site Oriel doesn't index is refused by naming each source it has items from", () => {
  const why = (from: readonly IndexRecord[]) =>
    resolveDropped(from, { links: ["https://example.com/doc"], files: [] }, sources).refused[0]
      ?.why;
  assert.equal(why(records), "Only Jira and Folder items can be added, not other pages.");
  const message = record(
    "slack:C0FW1WEATHR-1788444000.000100",
    "https://ferrowick-example.slack.com/archives/C0FW1WEATHR/p1788444000000100",
  );
  assert.equal(
    why([...records, message]),
    "Only Jira, Folder and Slack items can be added, not other pages.",
  );
  assert.equal(why([message]), "Only Slack items can be added, not other pages.");
  assert.equal(why([]), "Oriel has no items yet, so nothing can be added.");
});
