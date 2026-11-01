import assert from "node:assert/strict";
import { test } from "node:test";
import { type IndexRecord, instant, sourceKinds } from "@oriel/core";
import { itemDocs, namespacesFor, sources, specs } from "./index.ts";

test("every source kind declares its name and what its items are, in source order", () => {
  assert.deepEqual(Object.keys(sources).toSorted(), [...sourceKinds].toSorted());
  assert.deepEqual(Object.keys(itemDocs), [...sourceKinds]);
  for (const kind of sourceKinds) {
    assert.ok(sources[kind].name.length > 0, kind);
    assert.equal(itemDocs[kind], sources[kind].itemDoc);
  }
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
