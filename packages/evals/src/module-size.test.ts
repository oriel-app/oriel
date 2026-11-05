// What every turn sends the model before the thread itself: the system prompt
// and the region's module in the run tool. Each source adds to the module
// only in a region holding its items, and within the budget it declares, so
// connecting a source can't silently grow every prompt (OA-26). A budget
// rises only in a reviewed change that says why; at about 4 bytes a token,
// 1,000 bytes is some 250 tokens on every request of every turn.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runTool, systemPrompt } from "@oriel/agent";
import { bindingsFor, typecheck, waitingOf } from "@oriel/bindings";
import { loadFixtures } from "./fixtures.ts";
import { moduleOf, moduleSize, regionOf, shape } from "./module-size.ts";

const fixtures = loadFixtures();
const sizes = new Map(
  await Promise.all(
    [...fixtures].map(async ([kind, fixture]) => [kind, await moduleSize(kind, fixture)] as const),
  ),
);

const budgets = {
  // Rose by 250 to steer the agent to Oriel's own threads (OA-108). Fell
  // from 3,037 bytes to 2,257 in climb oa-144 (OA-144), which moved the rules
  // on a run's writes and Revert to where the agent meets them; about 200
  // bytes of room are left for OA-89 and OA-121.
  systemPrompt: 2_450,
  // The run tool's own text, and the module of a region with no namespace or
  // item doc. The base rose for Oriel's own namespaces in every region
  // (decision 0024): by about 1,600 bytes for their reads (OA-108), then by
  // 950 for their actions, five functions with the registry's docs (OA-69),
  // then by 290 for marking a workstream done and reopening it, whether one
  // is done, and where the user deletes one (decision 0028). Climb oa-144
  // cut 295 bytes of repeats and moved Revert's 157 here from the system
  // prompt, for 4,594, with about 200 bytes of room for OA-89 and OA-121.
  // Rose by 150 for sketch(), one line (decision 0033), and show() saying
  // its bars sum by label: 4,668 to 4,829. Rose by about 610 for history()
  // and the chart forms (decision 0053): 5,439.
  tool: 600,
  base: 5_450,
};

test("the system prompt and the run tool's own text stay within their budgets", () => {
  assert.ok(systemPrompt.length <= budgets.systemPrompt, `${systemPrompt.length} bytes`);
  const own = runTool("").description.length;
  assert.ok(own <= budgets.tool, `${own} bytes`);
});

test("each source adds to the module within the budget it declares", () => {
  for (const [kind, size] of sizes) {
    assert.ok(size.base <= budgets.base, `${kind}: the base is ${size.base} bytes`);
    assert.ok(size.added > 0, `${kind} says nothing about its items`);
    const { budget } = fixtures.get(kind)?.declaration ?? { budget: 0 };
    assert.ok(size.added <= budget, `${kind} adds ${size.added} bytes, over its ${budget}`);
  }
});

test("a source adds nothing to the module of a region without its items", () => {
  const all = [...sizes.values()];
  const namespaces = Object.assign({}, ...all.map((size) => size.namespaces));
  const items = Object.assign({}, ...all.map((size) => size.items));
  for (const [kind, size] of sizes) {
    const others = [...sizes].filter(([k]) => k !== kind).map(([, other]) => other.item);
    const { [kind]: _namespace, ...withoutNamespace } = namespaces;
    const { [kind]: _doc, ...withoutDoc } = items;
    const module = moduleOf(others, namespaces, items);
    assert.equal(module, moduleOf(others, withoutNamespace, withoutDoc), `${kind} shows`);
    assert.ok(moduleOf([size.item], namespaces, items).includes(` * - ${items[kind]}\n`));
  }
});

test("an item doc is one line and can't close its comment", () => {
  const [kind, size] = [...sizes][0] ?? [];
  assert.ok(kind && size);
  for (const doc of ["", "two\nlines", "ends */ here"])
    assert.throws(
      () => moduleOf([size.item], {}, { [kind]: doc }),
      /one line of plain text/,
      JSON.stringify(doc),
    );
});

test("the window chat's window namespace adds within its budget, in its module only", () => {
  // The overview's shape and window.overview(), in a window chat only (decision 0027).
  const window = 1_500;
  const region = regionOf([]);
  const reader = { read: async () => [], search: async () => [] };
  const plain = bindingsFor(region, { reader, namespaces: {} }).dts;
  const chat = bindingsFor(region, {
    reader,
    namespaces: {},
    overview: async () => ({ view: null, items: [] }),
  }).dts;
  const added = shape(chat) - shape(plain);
  assert.ok(added > 0 && added <= window, `window adds ${added} bytes`);
});

test("a waiting connection's preview and draft add within their own budget, in the window chat only while it waits", async () => {
  // source.preview() and source.configure()'s draft, with their types and
  // Slack's options as its validator types them (decision 0051). Their own
  // budget, not the window namespace's: 798 bytes in OA-218.
  const drafting = 850;
  const region = regionOf([]);
  const reader = { read: async () => [], search: async () => [] };
  const overview = async () => ({ view: null, items: [] });
  const chat = bindingsFor(region, { reader, namespaces: {}, overview }).dts;
  const slack = fixtures.get("slack")?.declaration;
  assert.ok(slack);
  const waiting = waitingOf([
    {
      id: "01JC0NNECT10N0000000000000",
      kind: "slack",
      source: slack.name,
      why: "",
      options: {},
      validator: slack.options,
      preview: async () => [],
    },
  ]);
  assert.ok(waiting);
  const drafted = bindingsFor(region, { reader, namespaces: {}, overview, waiting }).dts;
  const added = shape(drafted) - shape(chat);
  assert.ok(added > 0 && added <= drafting, `drafting adds ${added} bytes`);
  // No waiting connection, no source namespace.
  assert.doesNotMatch(chat, /declare const source/);
});

test("a waiting Sheets connection's draft, in its own form, typechecks in the window chat's module", async () => {
  const sheets = fixtures.get("sheets")?.declaration;
  assert.ok(sheets?.review);
  const waiting = waitingOf([
    {
      id: "01JC0NNECT10N0000000000000",
      kind: "sheets",
      source: sheets.name,
      why: "",
      options: {},
      validator: sheets.options,
      draft: { validator: sheets.review.draft, doc: sheets.review.doc },
      preview: async () => [],
    },
  ]);
  assert.ok(waiting);
  const reader = { read: async () => [], search: async () => [] };
  const overview = async () => ({ view: null, items: [] });
  const { dts } = bindingsFor(regionOf([]), { reader, namespaces: {}, overview, waiting });
  const script = [
    "const [waiting] = await source.preview();",
    "source.configure({ connection: waiting.connection, options: { tabs: [{",
    '  at: waiting.tables[0]?.at ?? "", header: 1, end: "blank", hidden: false, key: "A", title: "C",',
    '  status: "D", states: { todo: ["To do"], "in-progress": ["In progress"], done: ["Done"] },',
    "}] } });",
  ].join("\n");
  assert.equal(await typecheck(script, dts), null);
});
