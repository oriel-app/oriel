import assert from "node:assert/strict";
import { test } from "node:test";
import type { Region } from "@oriel/core";
import { bindingsFor } from "./bindings.ts";
import { fixture, fixtureReader, fixtureRegion, movingReader, snapshotAfter } from "./testing.ts";

const base = fixtureReader(snapshotAfter(0));
// After every source edit: SYN-88 moved to SYN-3's epic, SYN-27 deleted.
const edited = fixtureReader(snapshotAfter(fixture.edits.length));
const boarding = () => bindingsFor(fixtureRegion("boarding-epic"), { reader: base });
const picked = () => bindingsFor(fixtureRegion("picked"), { reader: base });

const summary = (key: string) => fixture.issues.find((issue) => issue.key === key)?.summary;

test("a write to a region item is captured with the op's checked arguments", () => {
  const bindings = boarding();
  assert.deepEqual(bindings.capture("jira.setEstimate", ["jira:SYN-13", 3], null), {
    op: "setEstimate",
    target: "jira:SYN-13",
    ref: null,
    args: { points: 3 },
  });
  assert.deepEqual(bindings.capture("jira.setEstimate", ["jira:SYN-13", null], null).args, {
    points: null,
  });
  assert.deepEqual(
    bindings.capture("jira.addLink", ["jira:SYN-2", "https://example.com/a", "Spec"], null).args,
    { url: "https://example.com/a", title: "Spec" },
  );
});

test("writes outside the region, to unmade refs, or with bad arguments are refused", () => {
  const bindings = boarding();
  assert.throws(
    () => bindings.capture("jira.setEstimate", ["jira:SYN-80", 3], null),
    /jira\.setEstimate: "jira:SYN-80" isn't in this region/,
  );
  assert.throws(
    () => bindings.capture("jira.setSummary", ["new:1", "x"], null),
    /new:1 isn't a story created earlier in this run/,
  );
  assert.throws(
    () => bindings.capture("jira.setEstimate", ["jira:SYN-13", "3"], null),
    /points: expected a finite number/,
  );
  assert.throws(
    () => bindings.capture("jira.setEstimate", ["jira:SYN-13", 3, 4], null),
    /expected at most 2 arguments/,
  );
  assert.throws(
    () => bindings.capture("jira.setEstimate", ["jira:SYN-13", 3], "new:1"),
    /only createStory names a new item/,
  );
});

test("only offered writes capture: no revert-only ops, reads or inherited names", () => {
  const bindings = boarding();
  for (const fn of ["jira.deleteItem", "jira.removeLink", "jira.listStories", "search", "toString"])
    assert.throws(() => bindings.capture(fn, ["jira:SYN-13"], null), /isn't a write here/, fn);
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
  });
  assert.equal(bindings.capture("jira.setEstimate", ["new:1", 2], null).target, "new:1");
  assert.throws(
    () => bindings.capture("jira.createStory", [{ summary: "B" }], "new:3"),
    /expected ref new:2, got "new:3"/,
  );
  assert.throws(
    () => bindings.capture("jira.createStory", [{ summary: "B" }], null),
    /expected ref new:2, got null/,
  );
});

test("a refused create still uses its ref, so later refs keep their numbers", () => {
  const bindings = boarding();
  assert.throws(() => bindings.capture("jira.createStory", [{ summary: 5 }], "new:1"), /summary/);
  assert.equal(bindings.capture("jira.createStory", [{ summary: "B" }], "new:2").ref, "new:2");
  assert.throws(() => bindings.capture("jira.setEstimate", ["new:1", 1], null), /new:1 isn't/);
  assert.equal(bindings.capture("jira.setEstimate", ["new:2", 1], null).target, "new:2");
});

test("in a picked region, a create's epic must be a region item or none", () => {
  const bindings = picked();
  const inside = bindings.capture(
    "jira.createStory",
    [{ summary: "A", epic: "jira:SYN-13" }],
    "new:1",
  );
  assert.deepEqual(inside.args, { summary: "A", epic: "jira:SYN-13" });
  const loose = bindings.capture("jira.createStory", [{ summary: "B", points: 2 }], "new:2");
  assert.deepEqual(loose.args, { summary: "B", points: 2, epic: null });
  assert.throws(
    () => bindings.capture("jira.createStory", [{ summary: "C", epic: "jira:SYN-1" }], "new:3"),
    /epic "jira:SYN-1" isn't in this region/,
  );
});

test("reads proxy live, and only search() reaches outside the region", async () => {
  const bindings = boarding();
  const one = await bindings.read("jira.getItem", ["jira:SYN-13"]);
  assert.equal(one.outsideRegion, false);
  assert.deepEqual(
    { ...(one.value as object), id: "jira:SYN-13", gone: false },
    one.value,
    "keeps its region handle",
  );
  assert.equal((one.value as { summary: string }).summary, summary("SYN-13"));

  const found = await bindings.read("search", ["checkout", 3]);
  assert.equal(found.outsideRegion, true);
  const results = found.value as object[];
  assert.ok(results.length > 0 && results.length <= 3);
  for (const result of results)
    assert.deepEqual(Object.keys(result), ["id", "title", "url", "updatedAt"]);

  await assert.rejects(
    bindings.read("jira.getItem", ["jira:SYN-80"]),
    /"jira:SYN-80" isn't in this region; use search\(\) to look outside it/,
  );
  await assert.rejects(bindings.read("jira.setEstimate", ["jira:SYN-13", 1]), /isn't a read here/);
  await assert.rejects(picked().read("jira.getEpic", []), /isn't a read here/);
});

test("a deleted item reads as a tombstone, not a throw (eval 4)", async () => {
  const bindings = bindingsFor(fixtureRegion("boarding-epic"), { reader: edited });
  const { value } = await bindings.read("jira.listStories", []);
  const views = value as { id: string; gone: boolean; reason?: string }[];
  assert.deepEqual(
    views.find((view) => view.id === "jira:SYN-27"),
    { id: "jira:SYN-27", gone: true, reason: "deleted" },
  );
  assert.ok(views.filter((view) => view.id !== "jira:SYN-27").every((view) => !view.gone));
});

test("listStories is the region's items but its epic, even one that moved epic since", async () => {
  const region = fixtureRegion("checkout-epic");
  const bindings = bindingsFor(region, { reader: edited });
  const { value } = await bindings.read("jira.listStories", []);
  const views = value as { id: string; epic: string | null }[];
  const stories = region.items.map((item) => item.id).filter((id) => id !== "jira:SYN-1");
  assert.deepEqual(views.map((view) => view.id).toSorted(), stories.toSorted());
  assert.equal(views.find((view) => view.id === "jira:SYN-88")?.epic, "jira:SYN-3");
});

test("an item that moved project is followed and keeps its region handle", async () => {
  const reader = movingReader(base, "jira:SYN-13", "jira:FER-7");
  const bindings = bindingsFor(fixtureRegion("boarding-epic"), { reader });
  const { value } = await bindings.read("jira.getItem", ["jira:SYN-13"]);
  const view = value as { id: string; gone: boolean; summary: string };
  assert.deepEqual([view.id, view.gone, view.summary], ["jira:SYN-13", false, summary("SYN-13")]);
});

test("a region with a malformed ID, or an anchor it doesn't hold, is refused", () => {
  const region = fixtureRegion("boarding-epic");
  const evil: Region = {
    ...region,
    items: [...region.items, { id: 'jira:SYN-1" | string', stableId: "1" }],
  };
  assert.throws(() => bindingsFor(evil, { reader: base }), /not a Jira item ID/);
  const lower: Region = { ...region, items: [{ id: "jira:syn-1", stableId: "1" }] };
  assert.throws(() => bindingsFor(lower, { reader: base }), /not a Jira item ID/);
  const unanchored: Region = {
    ...region,
    items: region.items.filter((item) => item.id !== "jira:SYN-2"),
  };
  assert.throws(
    () => bindingsFor(unanchored, { reader: base }),
    /anchor jira:SYN-2 isn't one of its items/,
  );
});
