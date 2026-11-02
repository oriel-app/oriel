import assert from "node:assert/strict";
import { test } from "node:test";
import { type DeclaredFacets, facetChanges, facetChangesShape, keptSince } from "./change-log.ts";
import { instant } from "./ids.ts";
import type { Facets, IndexRecord } from "./source.ts";

const at = instant(new Date(Date.UTC(2026, 9, 29, 9)));
const item = (facets: Facets, attrs: unknown = {}): IndexRecord => ({
  id: "jira:SYN-1",
  stableId: "10001",
  title: "Checkout",
  location: "https://example.invalid/browse/SYN-1",
  updatedAt: at,
  facets,
  attrs,
});
const ada = { role: "assignee", id: "a", name: "Ada" };
const bo = { role: "reporter", id: "b", name: "Bo" };
// A declared facet read from the source's own attrs, as core never names one.
const declared: DeclaredFacets = {
  size: { label: "Size", of: (record) => (record.attrs as { size?: number }).size ?? null },
};

test("an item whose facets didn't change changes nothing, whatever else did", () => {
  const before = item({ state: "todo", people: [ada, bo] }, { size: 3 });
  const after = { ...item({ state: "todo", people: [bo, ada] }, { size: 3 }), title: "Renamed" };
  assert.equal(facetChanges(declared, before, after), null);
});

test("only the facets that changed are kept, before and after, declared ones by their keys", () => {
  const container = { id: "jira:SYN-3" as const, stableId: "10003" };
  const before = item({ state: "todo", people: [ada], container: null }, {});
  const after = item({ state: "done", people: [ada], container }, { size: 5 });
  assert.deepEqual(facetChanges(declared, before, after), {
    state: { before: "todo", after: "done" },
    container: { before: null, after: container },
    declared: { size: { before: null, after: 5 } },
  });
});

test("a facet the item didn't have, or no longer has, is left out on that side", () => {
  assert.deepEqual(facetChanges({}, item({}), item({ state: "in-progress" })), {
    state: { after: "in-progress" },
  });
  assert.deepEqual(facetChanges({}, item({ people: [ada] }), item({})), {
    people: { before: [ada] },
  });
});

test("an entry's facets read back as they were written, and nothing else does", () => {
  const changes = facetChanges(
    declared,
    item({ state: "todo", people: [] }, { size: 1 }),
    item({ state: "done", people: [ada] }, { size: 2 }),
  );
  const read = facetChangesShape(JSON.parse(JSON.stringify(changes)));
  assert.deepEqual(read, { ok: true, value: changes });
  assert.equal(facetChangesShape({ state: { after: "shipped" } }).ok, false);
  assert.equal(facetChangesShape({ declared: { size: { after: { text: "x" } } } }).ok, false);
});

test("the change log keeps 90 days", () => {
  assert.equal(keptSince(at), "2026-07-31T09:00:00.000Z");
});
