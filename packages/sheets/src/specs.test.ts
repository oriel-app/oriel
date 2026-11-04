// The `sheets` namespace over the fixture's index, and how change sets
// treat each op (decision 0050).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ItemId,
  itemId,
  type LineContext,
  type NamespaceHost,
  type NamespaceWrite,
  type Subject,
} from "@oriel/core";
import { rowKey, spreadsheetKey } from "./attrs.ts";
import { sheetsDeclaredFixture } from "./declared-fixture.ts";
import { loadSheetsFixture } from "./fixture.ts";
import { sheetsNamespace } from "./namespace.ts";
import { sheetsSpecs } from "./specs.ts";

const fixture = loadSheetsFixture();
const idOf = (slug: string) => fixture.spreadsheets.find((s) => s.slug === slug)?.id ?? "";
const tracker = idOf("tracker");
const rowId = (spreadsheet: string, sheetId: number, key: string) =>
  itemId("sheets", rowKey(spreadsheet, sheetId, key));
const fw102 = rowId(tracker, 1100, "FW-102");
const sprint = rowId(tracker, 2141, "00411");
// A row of the contacts spreadsheet, which the account can only view.
const contact = rowId(idOf("contacts"), 5100, "+44 1632 960101");
const doc = itemId("sheets", spreadsheetKey(tracker));

const connected = await sheetsDeclaredFixture.load().connect(0);

// The region's IDs, as a namespace's host sees them.
const host = (ids: readonly string[]): NamespaceHost => ({
  has: (id): id is ItemId => ids.includes(id),
  created: new Map(),
  read: async () => [],
});
const scope = (ids: readonly ItemId[]) => ({ ids, anchor: null });
const writes = (ids: readonly ItemId[]) =>
  new Map(
    sheetsNamespace(connected.records, connected.context)
      .fns(scope(ids))
      .flatMap((fn) => (fn.kind === "write" ? [[fn.name, fn] as const] : [])),
  );

test("the namespace offers writes for rows of spreadsheets the person can edit, and nothing else", () => {
  assert.ok(
    connected.records.some((r) => r.id === contact),
    "the contacts row is synced",
  );
  const spec = sheetsNamespace(connected.records, connected.context);
  const types = spec.types(scope([fw102, contact, doc, "jira:SYN-1" as ItemId]));
  assert.deepEqual(types, [
    "/** This region's spreadsheet rows Oriel may change. */",
    "type SheetsRowId =",
    `  | ${JSON.stringify(fw102)};`,
  ]);
  assert.deepEqual([...writes([fw102]).keys()], ["setField", "addRow"]);
  // A region with only a view-only row, or a spreadsheet, gets none.
  assert.deepEqual(spec.types(scope([contact, doc])), []);
  assert.deepEqual(spec.fns(scope([contact, doc])), []);
  // A read-only connection gives no context, and offers nothing.
  assert.deepEqual(sheetsNamespace(connected.records, undefined).fns(scope([fw102])), []);
  assert.deepEqual(sheetsNamespace(connected.records, undefined).types(scope([fw102])), []);
});

test("setField takes Oriel's field names, for a column the row's tab maps", () => {
  const set = writes([fw102, sprint]).get("setField") as NamespaceWrite;
  const region = host([fw102, sprint, contact]);
  assert.deepEqual(set.build([fw102, "status", "=1+1"], region), {
    target: fw102,
    args: { field: "status", value: "=1+1" },
  });
  assert.deepEqual(set.build([fw102, "estimate", null], region), {
    target: fw102,
    args: { field: "estimate", value: null },
  });
  // Sprint 41 maps no link; a header is never a field.
  assert.throws(
    () => set.build([sprint, "link", "https://x.example"], region),
    /maps no link column/,
  );
  assert.throws(() => set.build([fw102, "Status", "Done"], region), TypeError);
  assert.throws(() => set.build([fw102, "key", "FW-1"], region), TypeError);
  assert.throws(() => set.build([contact, "title", "x"], region), /isn't a row Oriel may change/);
  assert.throws(() => set.build([fw102, "title", "x"], host([])), /isn't a row Oriel may change/);
});

test("addRow adds to the tab of a row in the region, with its spreadsheet and tab in its arguments", () => {
  const add = writes([fw102, sprint]).get("addRow") as NamespaceWrite;
  const region = host([fw102, sprint]);
  assert.deepEqual(
    add.build([fw102, { key: "FW-110", title: "Night-sailing alert sound", estimate: 2 }], region),
    {
      target: null,
      args: {
        spreadsheet: tracker,
        sheetId: 1100,
        values: { key: "FW-110", title: "Night-sailing alert sound", estimate: 2 },
      },
    },
  );
  assert.throws(
    () => add.build([sprint, { key: "00415", title: "x", link: "https://x.example" }], region),
    /maps no link column/,
  );
});

const names: Record<string, string> = {
  [tracker]: "Ferrowick delivery tracker",
  [`${tracker}/1100`]: "Tracker",
};
const context = (subject: Subject = null): LineContext => ({
  subject,
  before: {},
  name: async (id) => names[id] ?? null,
  title: async () => null,
});
const spec = (op: string) => {
  const found = sheetsSpecs.ops[op];
  assert.ok(found, op);
  return found;
};
const applied = (before: Record<string, unknown>) => ({
  item: { id: fw102, stableId: "" },
  before,
  after: {},
});

test("an edit's line names the cell by Oriel's field, and its revert writes back what was there", async () => {
  const set = spec("setField");
  const row: Subject = { kind: "item", id: fw102, title: "Show an at-risk banner" };
  assert.equal(
    await set.describe({ field: "status", value: "In progress" }, context(row)),
    "Set the status cell of the row “Show an at-risk banner” to “In progress”, as a value.",
  );
  assert.equal(
    await set.describe({ field: "link", value: null }, context(row)),
    "Empty the link cell of the row “Show an at-risk banner”.",
  );
  assert.deepEqual(set.after({ field: "estimate", value: 5 }), { estimate: 5 });
  assert.equal(set.idempotent, true);
  assert.deepEqual(set.undo({ field: "status", value: "Done" }, applied({ status: "To do" })), {
    op: "setField",
    args: { field: "status", value: "To do" },
  });
  assert.deepEqual(set.undo({ field: "status", value: "Done" }, applied({ status: null })), {
    op: "setField",
    args: { field: "status", value: null },
  });
  assert.ok("refused" in set.undo({ field: "status", value: "Done" }, applied({})));
  // A row's title can't be emptied, so an empty one isn't put back.
  assert.ok("refused" in set.undo({ field: "title", value: "x" }, applied({ title: null })));
  assert.equal(sheetsSpecs.ops.setField?.args({ field: "title", value: " " }).ok, false);
});

test("an added row's line names its tab, and its revert deletes it", async () => {
  const add = spec("addRow");
  const args = { spreadsheet: tracker, sheetId: 1100, values: { key: "FW-110", title: "Night" } };
  assert.equal(
    await add.describe(args, context()),
    "Add a row after the last of the tab “Tracker” of “Ferrowick delivery tracker”.",
  );
  assert.deepEqual(add.after(args), { key: "FW-110", title: "Night" });
  assert.deepEqual([add.creates, add.makes], [true, "row"]);
  assert.deepEqual(add.undo(args, applied({})), { op: "deleteRow", args: {} });
  assert.equal(
    await add.describe({ ...args, sheetId: 9 }, context()),
    "Add a row after the last of a tab of “Ferrowick delivery tracker”.",
  );
  assert.deepEqual([spec("deleteRow").deletes, spec("deleteRow").revertOnly], [true, true]);
});

test("a revert that stops says why, by the row's title", () => {
  const explain = sheetsSpecs.explain;
  assert.ok(explain);
  const conflict = { mutationId: "m" as never, target: fw102 };
  assert.equal(
    explain({ ...conflict, field: "cells", expected: "a", actual: "b" }, "Night"),
    "the row “Night” was edited since Oriel added it, so deleting it could take someone's edit with it",
  );
  assert.equal(
    explain({ ...conflict, field: "status", expected: "Done", actual: null }, null),
    "a spreadsheet row's status cell is now empty, not “Done”",
  );
  assert.equal(
    explain({ ...conflict, field: "item", expected: "present", actual: "gone" }, "Night"),
    "the row “Night” isn't in the spreadsheet any more, or its key changed",
  );
});
