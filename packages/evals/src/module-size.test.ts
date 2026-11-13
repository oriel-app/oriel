// A budget rises only in a reviewed change that says why: at about 4 bytes a token,
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
  systemPrompt: 2_450,
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
  const window = 1_500;
  const region = regionOf([]);
  const reader = { read: async () => [], search: async () => [] };
  const plain = bindingsFor(region, { reader, namespaces: {} }).dts;
  const chat = bindingsFor(region, {
    reader,
    namespaces: {},
    overview: async () => ({ view: null, items: [] }),
  }).dts;
  const turning = 160;
  const start = chat.indexOf("declare const source: {");
  const off = chat.slice(start, chat.indexOf("\n};\n", start) + 4);
  assert.ok(shape(off) <= turning, `source.off adds ${shape(off)} bytes`);
  const continuing = 140;
  const doc = chat.lastIndexOf("  /**", chat.indexOf("  continue(input"));
  const cont = chat.slice(doc, chat.indexOf("\n", chat.indexOf("  continue(input")) + 1);
  assert.ok(doc > 0 && cont.includes("continue(input"), "window.continue is in the window chat");
  assert.ok(shape(cont) <= continuing, `window.continue adds ${shape(cont)} bytes`);
  const added = shape(chat.replace(off, "").replace(cont, "")) - shape(plain);
  assert.ok(added > 0 && added <= window, `window adds ${added} bytes`);
});

test("a waiting connection's preview and draft add within their own budget, in the window chat only while it waits", async () => {
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
  assert.doesNotMatch(chat, /preview\(|configure\(/);
});

test("a Sheets connection's preview and draft, offered in every window chat while one reads, add within their budget, and nothing to the base", async () => {
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
  assert.doesNotMatch(bindingsFor(region, { reader, namespaces: {} }).dts, /declare const source/);
});
