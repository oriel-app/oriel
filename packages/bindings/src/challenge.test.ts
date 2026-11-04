// A second look's module (the challenger spike): the region's reads and
// writes, `challenge` and search(), with none of Oriel's own namespaces, no
// blocks and no sketches. Its `items.read()` takes this run's search() hits
// too, read-only; every other module is as it was.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bindingsFor } from "./bindings.ts";
import { fixtureReader, fixtureRegion, namespaces, runGuest, snapshotAfter } from "./testing.ts";

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

test("a second look's module has the region's reads and writes, challenge and search, and nothing of Oriel's", () => {
  const looking = bindingsFor(region, { reader, namespaces, challenge }).dts;
  assert.match(looking, /declare const challenge: \{/);
  assert.match(looking, /setDescription\(/);
  assert.match(looking, /declare function search\(/);
  assert.match(looking, /read\(id: RegionId \| FoundId\)/);
  for (const absent of ["declare const workstream", "declare const thread", "show(", "sketch("])
    assert.ok(!looking.includes(absent), absent);
  // Every other module is as it was, with no trace of it.
  const usual = bindingsFor(region, { reader, namespaces }).dts;
  assert.ok(!usual.includes("challenge"));
  assert.match(usual, /read\(id: RegionId\): Promise<Item \| Gone>/);
});

test("a second look reads the diff, records once per call, and reads a search hit but no other outside item", async () => {
  const bindings = bindingsFor(region, { reader, namespaces, challenge });
  const diff = await bindings.read("challenge.diff", []);
  assert.equal((diff.value as unknown[]).length, 1);
  assert.equal((await bindings.read("challenge.record", [[]])).value, "kept");
  assert.deepEqual(recorded.at(-1), []);
  // Outside the region, unsearched: refused before any read.
  await assert.rejects(bindings.read("items.read", ["jira:SYN-1"]), /isn't in this region/);
  const hits = (await bindings.read("search", ["checkout"])).value as { id: string }[];
  assert.ok(hits.some((hit) => hit.id === "jira:SYN-1"));
  const found = await bindings.read("items.read", ["jira:SYN-1"]);
  assert.equal((found.value as { id: string }).id, "jira:SYN-1");
  assert.equal(found.outsideRegion, true);
  // Without a second look, `challenge` isn't there to call.
  const usual = bindingsFor(region, { reader, namespaces });
  await assert.rejects(usual.read("challenge.diff", []), /isn't a read here/);
});

test("a second look's script runs in the guest, with no show() or sketch() to call", async () => {
  const bindings = bindingsFor(region, { reader, namespaces, challenge });
  const run = await runGuest(
    bindings,
    `const lines = await challenge.diff();
jira.setDescription("jira:SYN-29", "Your fare carries over.");
return { lines: lines.length, show: typeof show, sketch: typeof sketch };`,
  );
  assert.deepEqual(run.outcome, {
    kind: "done",
    value: { lines: 1, show: "undefined", sketch: "undefined" },
  });
  assert.equal(run.mutations.length, 1);
});

test("record() refuses a quote from an item the run can't read, so Oriel's check tests no guesses", async () => {
  const bindings = bindingsFor(region, { reader, namespaces, challenge });
  const outside = [
    { kind: "related", lines: [1], says: "A.", evidence: [{ id: "jira:SYN-1", quote: "x" }] },
  ];
  const before = recorded.length;
  const refused = (await bindings.read("challenge.record", [outside])).value;
  assert.match(
    String(refused),
    /jira:SYN-1 isn't in this workstream, and this run's search\(\) didn't find it/,
  );
  assert.equal(recorded.length, before);
  await bindings.read("search", ["checkout"]);
  assert.equal((await bindings.read("challenge.record", [outside])).value, "kept");
});
