// What every turn sends the model before the thread itself: the system prompt
// and the region's module in the run tool. Each source adds to the module
// only in a region holding its items, and within the budget it declares, so
// connecting a source can't silently grow every prompt (OA-26). A budget
// rises only in a reviewed change that says why; at about 4 bytes a token,
// 1,000 bytes is some 250 tokens on every request of every turn.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runTool, systemPrompt } from "@oriel/agent";
import { bindingsFor, waitingOf } from "@oriel/bindings";
import { readsNow } from "@oriel/core";
import { loadFixtures } from "./fixtures.ts";
import { moduleSize, regionOf, shape } from "./module-size.ts";

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
  // and the chart forms (decision 0053): 5,439. Rose by 15 for show()'s
  // type naming `from` (climbs show-from and show-from-2): 5,448.
  // Fell by 857 in climb module-shrink (OA-241), which said each thing once
  // and moved the actions' Undo rule into their run's result: 4,591. The
  // budget stays, as room for the agent stories that waited on it.
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
  // source.off, in the window chat too (decision 0059), has its own budget:
  // 156 bytes in OA-275, the hub's to approve.
  const turning = 160;
  const start = chat.indexOf("declare const source: {");
  const off = chat.slice(start, chat.indexOf("\n};\n", start) + 4);
  assert.ok(shape(off) <= turning, `source.off adds ${shape(off)} bytes`);
  // window.continue()'s draft, Continue in… (decision 0062), has its own
  // budget too: 131 bytes in OA-332's story, the hub's to approve.
  const continuing = 140;
  const doc = chat.lastIndexOf("  /**", chat.indexOf("  continue(input"));
  const cont = chat.slice(doc, chat.indexOf("\n", chat.indexOf("  continue(input")) + 1);
  assert.match(cont, /^  \/\*\* Drafts, for the user to apply: continues/);
  assert.ok(shape(cont) <= continuing, `window.continue adds ${shape(cont)} bytes`);
  const added = shape(chat.replace(off, "").replace(cont, "")) - shape(plain);
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
  // No waiting connection, no preview and no drafts: only source.off.
  assert.doesNotMatch(chat, /preview\(|configure\(/);
});

test("a Sheets connection's preview and draft, offered in every window chat while one reads, add within their budget, and nothing to the base", async () => {
  // OA-232: the person may ask to change how a connection reads, so the
  // window chat offers Sheets' preview and draft while one reads, not only
  // while one waits. Measured at 1,527 bytes: Sheets' draft type and its doc
  // line, about 87 of them saying `options` is how it reads now.
  const sheetsDrafting = 1_550;
  const sheets = fixtures.get("sheets")?.declaration;
  assert.ok(sheets?.review);
  const region = regionOf([]);
  const reader = { read: async () => [], search: async () => [] };
  const overview = async () => ({ view: null, items: [] });
  const chat = bindingsFor(region, { reader, namespaces: {}, overview }).dts;
  const waiting = waitingOf([
    {
      id: "01JC0NNECT10N0000000000000",
      kind: "sheets",
      source: sheets.name,
      why: readsNow,
      options: {},
      validator: sheets.options,
      draft: {
        validator: sheets.review.draft,
        doc: sheets.review.doc,
        current: sheets.review.current,
      },
      preview: async () => [],
    },
  ]);
  assert.ok(waiting);
  const drafted = bindingsFor(region, { reader, namespaces: {}, overview, waiting }).dts;
  const added = shape(drafted) - shape(chat);
  assert.ok(added > 0 && added <= sheetsDrafting, `Sheets' drafting adds ${added} bytes`);
  // A region's module, outside the window chat, has none of it.
  assert.doesNotMatch(bindingsFor(region, { reader, namespaces: {} }).dts, /declare const source/);
});
