import assert from "node:assert/strict";
import { test } from "node:test";
import { jiraNamespace } from "@oriel/jira";
import { bindingsFor } from "./bindings.ts";
import {
  fixtureReader,
  fixtureRegion,
  namespaces,
  pickedWithEpic,
  snapshotAfter,
} from "./testing.ts";

const snapshot = snapshotAfter(0);
const reader = fixtureReader(snapshot);
const kinds = new Map(snapshot.records.map((record) => [record.id, record.facets.kind]));
// SYN as if its board took no estimates.
const unestimating = {
  jira: jiraNamespace(kinds, { none: new Set(["SYN"]), home: "SYN" }),
};

const refused = /SYN's board takes no estimates/;

test("on a board that takes no estimates, setting or clearing one is refused when captured", () => {
  for (const region of [fixtureRegion("boarding-epic"), fixtureRegion("picked")]) {
    const bindings = bindingsFor(region, { reader, namespaces: unestimating });
    const [id] = region.items;
    assert.ok(id);
    assert.throws(
      () => bindings.capture("jira.setEstimate", [id.id, 3], null),
      new RegExp(
        `jira\\.setEstimate: SYN's board takes no estimates, so ${id.id} can't be estimated`,
      ),
    );
    assert.throws(() => bindings.capture("jira.setEstimate", [id.id, null], null), refused);
    // Its other writes still capture.
    assert.equal(bindings.capture("jira.setSummary", [id.id, "Renamed"], null).op, "setSummary");
  }
});

test("on a board that takes no estimates, a new story is created without points", () => {
  const anchored = bindingsFor(fixtureRegion("boarding-epic"), {
    reader,
    namespaces: unestimating,
  });
  assert.throws(
    () => anchored.capture("jira.createStory", [{ summary: "A", points: 3 }], "new:1"),
    /SYN's board takes no estimates, so create the story without points/,
  );
  assert.equal(
    anchored.capture("jira.createStory", [{ summary: "A", points: null }], "new:2").op,
    "createStory",
  );
  // A story created in this run is in the region's epic, so it takes none.
  assert.throws(() => anchored.capture("jira.setEstimate", ["new:2", 3], null), refused);

  const epics = bindingsFor(pickedWithEpic(), { reader, namespaces: unestimating });
  // A refused create still uses its ref, so the numbering of later ones holds.
  for (const [ref, epic] of [
    ["new:1", "jira:SYN-1"],
    ["new:2", null],
  ] as const)
    assert.throws(
      () => epics.capture("jira.createStory", [{ summary: "A", points: 2, epic }], ref),
      refused,
    );

  const blank = bindingsFor(
    { ...fixtureRegion("picked"), items: [] },
    { reader, namespaces: unestimating },
  );
  assert.equal(blank.capture("jira.createEpic", [{ summary: "E" }], "new:1").op, "createEpic");
  assert.throws(
    () => blank.capture("jira.createStory", [{ summary: "A", points: 1, epic: "new:1" }], "new:2"),
    refused,
  );
});

test("a board that estimates is untouched, and the module the agent sees is the same", () => {
  const region = fixtureRegion("picked");
  const estimating = {
    jira: jiraNamespace(kinds, { none: new Set(), home: "SYN" }),
  };
  const [id] = region.items;
  assert.ok(id);
  assert.equal(
    bindingsFor(region, { reader, namespaces: estimating }).capture(
      "jira.setEstimate",
      [id.id, 3],
      null,
    ).op,
    "setEstimate",
  );
  const dts = bindingsFor(region, { reader, namespaces }).dts;
  assert.equal(bindingsFor(region, { reader, namespaces: unestimating }).dts, dts);
  assert.equal(bindingsFor(region, { reader, namespaces: estimating }).dts, dts);
});
