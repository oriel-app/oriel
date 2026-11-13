import assert from "node:assert/strict";
import { test } from "node:test";
import { bindingsFor } from "./bindings.ts";
import { fixtureReader, fixtureRegion, namespaces, snapshotAfter } from "./testing.ts";

const reader = fixtureReader(snapshotAfter(0));
const region = fixtureRegion("weather-epic");
const recorded: unknown[] = [];
const challenge = {
  diff: async () => [{ n: 1, change: "A change.", item: "jira:SYN-45", fields: [] }],
  record: async (findings: unknown) => {
    recorded.push(findings);
    return "kept";
  },
};

test("a second look reads the diff, records once per call, and reads a search hit but no other outside item", async () => {
  const bindings = bindingsFor(region, { reader, namespaces, challenge });
  const diff = await bindings.read("challenge.diff", []);
  assert.equal((diff.value as unknown[]).length, 1);
  assert.equal((await bindings.read("challenge.record", [[]])).value, "kept");
  assert.deepEqual(recorded.at(-1), []);
  await assert.rejects(bindings.read("items.read", ["jira:SYN-1"]));
  const hits = (await bindings.read("search", ["checkout"])).value as { id: string }[];
  assert.ok(hits.some((hit) => hit.id === "jira:SYN-1"));
  const found = await bindings.read("items.read", ["jira:SYN-1"]);
  assert.equal((found.value as { id: string }).id, "jira:SYN-1");
  assert.equal(found.outsideRegion, true);
  const usual = bindingsFor(region, { reader, namespaces });
  await assert.rejects(usual.read("challenge.diff", []));
});

test("record() refuses a quote from an item the run can't read, so Oriel's check tests no guesses", async () => {
  const bindings = bindingsFor(region, { reader, namespaces, challenge });
  const outside = [
    { kind: "related", lines: [1], says: "A.", evidence: [{ id: "jira:SYN-1", quote: "x" }] },
  ];
  const before = recorded.length;
  assert.notEqual((await bindings.read("challenge.record", [outside])).value, "kept");
  assert.equal(recorded.length, before);
  await bindings.read("search", ["checkout"]);
  assert.equal((await bindings.read("challenge.record", [outside])).value, "kept");
});
