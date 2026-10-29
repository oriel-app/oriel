// Eval 1 (SPEC §8), binding correctness: for each frozen fixture region R, the
// generated module exposes exactly R's IDs, and nothing of the source's text.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Region } from "@oriel/core";
import { bindingsFor } from "./bindings.ts";
import { fixture, fixtureReader, fixtureRegion, snapshotAfter } from "./testing.ts";

const reader = fixtureReader(snapshotAfter(0));
const anyId = /jira:[A-Z][A-Z0-9_]*-[0-9]+/g;

// The members of `type RegionId = | "…" | "…";`.
function regionIdUnion(dts: string): string[] {
  const union = /^type RegionId =\n((?: {2}\| "[^"\n]+";?\n)+)/m.exec(dts)?.[1] ?? "";
  return [...union.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
}

// Source text the declarations must never carry. Labels and status names are left out:
// they are short words ("de", "copy") that turn up inside English.
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

const shuffled = (region: Region): Region => ({
  ...region,
  items: [...region.items].reverse(),
});

for (const frozen of fixture.regions) {
  test(`eval 1: ${frozen.name} exposes exactly its IDs`, async () => {
    const region = fixtureRegion(frozen.name);
    const bindings = bindingsFor(region, { reader });
    const ids = new Set<string>(frozen.items);

    // The declarations: RegionId is exactly R, and no other ID appears.
    assert.deepEqual(new Set(regionIdUnion(bindings.dts)), ids);
    assert.equal(regionIdUnion(bindings.dts).length, ids.size);
    assert.deepEqual(new Set(bindings.dts.match(anyId)), ids);
    // The stubs bind no IDs: the host applies them.
    assert.equal(bindings.shim.match(anyId), null);

    // The host: writes take exactly R's IDs; reads cover exactly R.
    for (const issue of fixture.issues) {
      const id = `jira:${issue.key}`;
      const write = () => bindings.capture("jira.setEstimate", [id, 1], null);
      if (ids.has(id)) assert.equal(write().target, id);
      else assert.throws(write, /isn't in this region/, id);
    }
    const listed = await bindings.read("jira.listItems", []);
    const views = listed.value as { id: string }[];
    assert.deepEqual(new Set(views.map((view) => view.id)), ids);

    // IDs and types only.
    for (const text of sourceText) assert.ok(!bindings.dts.includes(text), text);

    // Byte-stable, whatever order the region lists its items in.
    const again = bindingsFor(shuffled(region), { reader });
    assert.equal(again.dts, bindings.dts);
    assert.equal(again.shim, bindings.shim);
  });
}

test("eval 1: IDs are in project-then-number order", () => {
  const region = fixtureRegion("boarding-epic");
  const ids = regionIdUnion(bindingsFor(region, { reader }).dts);
  const numbers = ids.map((id) => Number(id.slice(id.lastIndexOf("-") + 1)));
  assert.deepEqual(
    numbers,
    numbers.toSorted((a, b) => a - b),
  );
});
