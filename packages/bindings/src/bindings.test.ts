import assert from "node:assert/strict";
import { test } from "node:test";
import type { Region } from "@oriel/core";
import { bindingsFor } from "./bindings.ts";
import {
  fixture,
  fixtureReader,
  fixtureRegion,
  namespaces,
  movingReader,
  pickedWithEpic,
  snapshotAfter,
} from "./testing.ts";

const base = fixtureReader(snapshotAfter(0));
const boarding = () => bindingsFor(fixtureRegion("boarding-epic"), { reader: base, namespaces });

const summary = (key: string) => fixture.issues.find((issue) => issue.key === key)?.summary;

test("writes outside the region, to unmade refs, or with bad arguments are refused", () => {
  const bindings = boarding();
  assert.throws(() => bindings.capture("jira.setEstimate", ["jira:SYN-80", 3], null));
  assert.throws(() => bindings.capture("jira.setSummary", ["new:1", "x"], null));
  assert.throws(() => bindings.capture("jira.setEstimate", ["jira:SYN-13", "3"], null));
  assert.throws(() => bindings.capture("jira.setEstimate", ["jira:SYN-13", 3, 4], null));
  assert.throws(() => bindings.capture("jira.setEstimate", ["jira:SYN-13", 3], "new:1"));
});

test("only offered writes capture: no revert-only ops, reads or inherited names", () => {
  const bindings = boarding();
  for (const fn of ["jira.deleteItem", "jira.removeLink", "jira.listStories", "search", "toString"])
    assert.throws(() => bindings.capture(fn, ["jira:SYN-13"], null), fn);
});

test("a create is new:N, binds the region's epic, and makes its ref writable", () => {
  const bindings = boarding();
  const create = bindings.capture(
    "jira.createStory",
    [{ summary: "A", epic: "jira:SYN-80" }],
    "new:1",
  );
  assert.deepEqual(create, {
    op: "createStory",
    target: null,
    ref: "new:1",
    args: { summary: "A", epic: "jira:SYN-2" },
    into: "jira",
  });
  assert.equal(bindings.capture("jira.setEstimate", ["new:1", 2], null).target, "new:1");
  assert.throws(() => bindings.capture("jira.createStory", [{ summary: "B" }], "new:3"));
  assert.throws(() => bindings.capture("jira.createStory", [{ summary: "B" }], null));
});

test("without an anchor, a create's epic must be one of the region's epics, or none", () => {
  const bindings = bindingsFor(pickedWithEpic(), { reader: base, namespaces });
  const inside = bindings.capture(
    "jira.createStory",
    [{ summary: "A", epic: "jira:SYN-1" }],
    "new:1",
  );
  assert.deepEqual(inside.args, { summary: "A", epic: "jira:SYN-1" });
  const loose = bindings.capture("jira.createStory", [{ summary: "B", points: 2 }], "new:2");
  assert.deepEqual(loose.args, { summary: "B", points: 2, epic: null });
  // A story in the region, and an epic outside it.
  for (const [ref, epic] of [
    ["new:3", "jira:SYN-13"],
    ["new:4", "jira:SYN-2"],
  ] as const)
    assert.throws(() => bindings.capture("jira.createStory", [{ summary: "C", epic }], ref));
});

test("only search() reaches outside the region, and other reads refuse what's outside it", async () => {
  const bindings = boarding();
  const one = await bindings.read("jira.getItem", ["jira:SYN-13"]);
  assert.equal(one.outsideRegion, false);

  const found = await bindings.read("search", ["checkout", 3]);
  assert.equal(found.outsideRegion, true);
  const results = found.value as object[];
  assert.ok(results.length > 0 && results.length <= 3);
  for (const result of results)
    assert.deepEqual(Object.keys(result), ["id", "title", "location", "updatedAt"]);

  await assert.rejects(bindings.read("jira.getItem", ["jira:SYN-80"]));
  await assert.rejects(bindings.read("jira.setEstimate", ["jira:SYN-13", 1]));
});

test("an item that moved project is followed and keeps its region handle", async () => {
  const reader = movingReader(base, "jira:SYN-13", "jira:FER-7");
  const bindings = bindingsFor(fixtureRegion("boarding-epic"), { reader, namespaces });
  const { value } = await bindings.read("jira.getItem", ["jira:SYN-13"]);
  const view = value as { id: string; gone: boolean; summary: string };
  assert.deepEqual([view.id, view.gone, view.summary], ["jira:SYN-13", false, summary("SYN-13")]);
});

test("an epic that moved projects is still the anchor, by stable ID, under its new handle", () => {
  const checkout = fixtureRegion("checkout-epic");
  // SYN-1 moved and was added back as OPS-1; the origin still names SYN-1.
  const region: Region = {
    ...checkout,
    items: checkout.items.map((item) =>
      item.id === "jira:SYN-1" ? { id: "jira:OPS-1", stableId: item.stableId } : item,
    ),
  };
  const bindings = bindingsFor(region, { reader: base, namespaces });
  assert.deepEqual(bindings.capture("jira.createStory", [{ summary: "Wallets" }], "new:1").args, {
    summary: "Wallets",
    epic: "jira:OPS-1",
  });
});
