import assert from "node:assert/strict";
import { test } from "node:test";
import { bindingsFor } from "./bindings.ts";
import { fixture, fixtureReader, fixtureRegion, namespaces, snapshotAfter } from "./testing.ts";

const reader = fixtureReader(snapshotAfter(0));
const anyId = /jira:[A-Z][A-Z0-9_]*-[0-9]+/g;

function regionIdUnion(dts: string): string[] {
  const union = /^type RegionId =\n((?: {2}\| "[^"\n]+";?\n)+)/m.exec(dts)?.[1] ?? "";
  return [...union.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
}

// Labels and status names are left out: they are short words ("de", "copy") that turn up inside English.
const sourceText = [
  ...fixture.issues.flatMap((issue) => [
    issue.summary,
    issue.description,
    ...issue.comments.map((comment) => comment.body),
    ...issue.links.map((link) => link.title),
  ]),
  ...fixture.edits.flatMap((edit) => (edit.kind === "setSummary" ? [edit.summary] : [])),
  ...fixture.people.map((person) => person.displayName),
].filter((text) => text.trim());

for (const frozen of fixture.regions) {
  test(`eval 1: ${frozen.name} exposes exactly its IDs`, async () => {
    const region = fixtureRegion(frozen.name);
    const bindings = bindingsFor(region, { reader, namespaces });
    const ids = new Set<string>(frozen.items);

    assert.deepEqual(new Set(regionIdUnion(bindings.dts)), ids);
    assert.equal(regionIdUnion(bindings.dts).length, ids.size);
    assert.deepEqual(new Set(bindings.dts.match(anyId)), ids);
    assert.equal(bindings.shim.match(anyId), null);

    for (const issue of fixture.issues) {
      const id = `jira:${issue.key}`;
      const write = () => bindings.capture("jira.setEstimate", [id, 1], null);
      if (ids.has(id)) assert.equal(write().target, id);
      else assert.throws(write, id);
    }
    const listed = await bindings.read("jira.listItems", []);
    const views = listed.value as { id: string }[];
    assert.deepEqual(new Set(views.map((view) => view.id)), ids);

    for (const text of sourceText) assert.ok(!bindings.dts.includes(text), text);
  });
}
