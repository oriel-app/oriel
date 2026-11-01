// What every turn sends the model before the thread itself: the system prompt
// and the region's module in the run tool. Each source adds to the module
// only in a region holding its items, and within a budget, so connecting a
// source can't silently grow every prompt (OA-26). A budget rises only in a
// reviewed change that says why; at about 4 bytes a token, 1,000 bytes is
// some 250 tokens on every request of every turn.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runTool, systemPrompt } from "@oriel/agent";
import { bindingsFor, type ItemDocs, type Namespaces } from "@oriel/bindings";
import { type ItemId, type Region, sourceKinds, type SourceKind } from "@oriel/core";
import { slackNamespace } from "@oriel/slack";
import { loadJiraFixture } from "./repo.ts";
import { buildWorld, fileId, itemDocs } from "./world.ts";

const fixture = loadJiraFixture();
const world = await buildWorld({
  fixture,
  folder: null,
  region: fixture.regions.find((r) => r.name === "weather-epic") ?? null,
  files: [],
  edited: 0,
  folderEdited: 0,
});

// One item of each source; the module never reads them.
const one: Record<SourceKind, ItemId> = {
  jira: "jira:SYN-3",
  folder: fileId("meeting-notes.md"),
  slack: "slack:C0FW1WEATHR-1788444000.000100",
};

const regionOf = (kinds: readonly SourceKind[]): Region => ({
  ...world.region,
  items: kinds.map((kind) => ({ id: one[kind], stableId: one[kind].split(":")[1] ?? "" })),
  origin: { kind: "picked" },
});

const dts = (kinds: readonly SourceKind[], namespaces: Namespaces, items: ItemDocs) =>
  bindingsFor(regionOf(kinds), { reader: world.reader, namespaces, items }).dts;

// Bytes without the ID lines, which grow with the region, not the source.
const shape = (text: string) => text.replace(/^ {2}\| ".*$\n?/gm, "").length;

const budgets = {
  systemPrompt: 2_800,
  // The run tool's own text, and the module of a region with no namespace or
  // item doc.
  tool: 600,
  base: 1_900,
  // What each source adds: its item doc, its namespace if it has one.
  jira: 3_200,
  folder: 250,
  slack: 400,
};

test("the system prompt and the run tool's own text stay within their budgets", () => {
  assert.ok(systemPrompt.length <= budgets.systemPrompt, `${systemPrompt.length} bytes`);
  const own = runTool("").description.length;
  assert.ok(own <= budgets.tool, `${own} bytes`);
});

test("each source adds to the module within its budget", () => {
  for (const kind of sourceKinds) {
    const base = shape(dts([kind], {}, {}));
    assert.ok(base <= budgets.base, `${kind}: the base is ${base} bytes`);
    const added = shape(dts([kind], world.namespaces, world.items)) - base;
    assert.ok(added > 0, `${kind} says nothing about its items`);
    assert.ok(added <= budgets[kind], `${kind} adds ${added} bytes`);
  }
});

test("Slack's writes, once it is connected, add within their budget", () => {
  // The world above doesn't connect Slack, so its namespace declares nothing
  // there; connected, it offers postMessage and reply (OA-28), in a region
  // holding a Slack conversation only.
  const writes = 500;
  const connected = {
    slack: slackNamespace({ channels: ["C0FW1WEATHR"], author: "U0FWAMARA1" }),
  };
  const added = shape(dts(["slack"], connected, {})) - shape(dts(["slack"], {}, {}));
  assert.ok(added > 0 && added <= writes, `Slack's writes add ${added} bytes`);
});

test("a source adds nothing to the module of a region without its items", () => {
  const slackOnly = dts(["slack"], world.namespaces, itemDocs);
  assert.ok(slackOnly.includes(` * - ${itemDocs.slack}\n`));
  assert.ok(!slackOnly.includes(itemDocs.jira ?? "") && !slackOnly.includes(itemDocs.folder ?? ""));
  for (const kind of sourceKinds) {
    const others = sourceKinds.filter((k) => k !== kind);
    const { [kind]: _namespace, ...namespaces } = world.namespaces;
    const { [kind]: _doc, ...items } = itemDocs;
    assert.equal(
      dts(others, world.namespaces, itemDocs),
      dts(others, namespaces, items),
      `${kind} shows in a region without its items`,
    );
  }
});

test("an item doc is one line and can't close its comment", () => {
  for (const doc of ["", "two\nlines", "ends */ here"])
    assert.throws(
      () => dts(["slack"], {}, { slack: doc }),
      /one line of plain text/,
      JSON.stringify(doc),
    );
});
