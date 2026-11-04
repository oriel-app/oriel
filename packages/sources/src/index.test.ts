import assert from "node:assert/strict";
import { test } from "node:test";
import { type IndexRecord, instant } from "@oriel/core";
import {
  byItemId,
  itemDocs,
  namespacesFor,
  parseDeclared,
  sourceKinds,
  sources,
  specs,
} from "./index.ts";

test("every source kind declares its name and what its items are, in source order", () => {
  assert.deepEqual(Object.keys(sources).toSorted(), [...sourceKinds].toSorted());
  assert.deepEqual(Object.keys(itemDocs), [...sourceKinds]);
  for (const kind of sourceKinds) {
    assert.ok(sources[kind].name.length > 0, kind);
    assert.equal(itemDocs[kind], sources[kind].itemDoc);
  }
});

test("each source is listed under the kind it declares, a short lowercase word", () => {
  for (const kind of sourceKinds) {
    assert.equal(sources[kind].kind, kind);
    assert.match(kind, /^[a-z]{2,16}$/);
  }
});

test("each kind's keys have its declared shape, stricter than core's", () => {
  const good = [
    "jira:SYN-12",
    "jira.2:ACME-4",
    "folder:0123456789abcdef",
    "slack:C0A1B2C3D-1759309200.000100",
  ];
  for (const id of good) assert.ok(parseDeclared(id), id);
  assert.deepEqual(parseDeclared("jira.2:ACME-4"), {
    kind: "jira",
    prefix: "jira.2",
    key: "ACME-4",
  });
  const bad = [
    "slack:C1",
    "jira:syn-1",
    "jira:SYN-0",
    "folder:plan.md",
    "folder:0123456789ABCDEF",
    "folder:0123456789abcde",
    "folder:0123456789abcdef0",
    "sheets:anything",
  ];
  for (const id of bad) assert.equal(parseDeclared(id), null, id);
});

test("item IDs order by the declared kinds", () => {
  const ids = ["slack:C0A1B2C3D-1759309200.000100", "folder:0123456789abcdef", "jira:SYN-2"];
  assert.deepEqual(ids.toSorted(byItemId), [
    "jira:SYN-2",
    "folder:0123456789abcdef",
    "slack:C0A1B2C3D-1759309200.000100",
  ]);
});

test("only a source that declares a namespace gets one, and op specs likewise", () => {
  const namespaces = namespacesFor([], { jira: { none: new Set(), home: null } });
  const declaring = sourceKinds.filter((kind) => sources[kind].namespace);
  assert.deepEqual(Object.keys(namespaces), declaring);
  assert.deepEqual(Object.keys(specs), declaring);
  assert.equal(namespaces.jira?.name, sources.jira.name);
});

test("a source's namespace reads the kinds of its items from the index it is given", () => {
  const record = (key: string, kind: string): IndexRecord => ({
    id: `jira:${key}`,
    stableId: key,
    title: key,
    location: `https://example.invalid/browse/${key}`,
    updatedAt: instant(new Date(Date.UTC(2026, 9, 30))),
    facets: { kind },
    attrs: {},
  });
  const createStory = (index: IndexRecord[]) =>
    namespacesFor(index, { jira: { none: new Set(), home: "SYN" } })
      .jira?.fns({ ids: ["jira:SYN-1", "jira:SYN-2"], anchor: null })
      .find((fn) => fn.name === "createStory")?.doc ?? "";
  const epic = [record("SYN-1", "epic"), record("SYN-2", "story")];
  const stories = [record("SYN-1", "story"), record("SYN-2", "story")];
  assert.match(createStory(epic), /in one of this region's epics/);
  assert.doesNotMatch(createStory(stories), /epics/);
});

test("a source with a namespace can't be left out of the contexts", () => {
  // @ts-expect-error Jira's namespace needs its estimates and home project.
  assert.ok(namespacesFor([], {}));
});
