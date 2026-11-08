// The `sheets` namespace over the fixture's index, and how change sets
// treat each op (decision 0050).
import assert from "node:assert/strict";
import { test } from "node:test";
import { type ItemId, itemId, type NamespaceHost, type NamespaceWrite } from "@oriel/core";
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
  const types = spec.types(scope([fw102, contact, doc, "jira:SYN-1" as ItemId])).join("\n");
  assert.ok(types.includes(JSON.stringify(fw102)));
  assert.ok(!types.includes(contact) && !types.includes(doc));
  // Source content stays out of the `.d.ts`: IDs only, no titles.
  for (const record of connected.records) assert.ok(!types.includes(record.title), record.title);
  assert.ok(writes([fw102]).size > 0);
  // A region with only a view-only row, or a spreadsheet, gets none.
  assert.deepEqual(spec.types(scope([contact, doc])), []);
  assert.deepEqual(spec.fns(scope([contact, doc])), []);
  // A read-only connection gives no context, and offers nothing.
  assert.deepEqual(sheetsNamespace(connected.records, undefined).fns(scope([fw102])), []);
  assert.deepEqual(sheetsNamespace(connected.records, undefined).types(scope([fw102])), []);
});

test("setField refuses a key, an unmapped column, a view-only row and a row outside the region", () => {
  const set = writes([fw102, sprint]).get("setField") as NamespaceWrite;
  const region = host([fw102, sprint, contact]);
  // Sprint 41 maps no link; a header is never a field.
  assert.throws(() => set.build([sprint, "link", "https://x.example"], region));
  assert.throws(() => set.build([fw102, "Status", "Done"], region));
  assert.throws(() => set.build([fw102, "key", "FW-1"], region));
  assert.throws(() => set.build([contact, "title", "x"], region));
  assert.throws(() => set.build([fw102, "title", "x"], host([])));
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

test("an edit's revert writes back what was there", () => {
  const set = spec("setField");
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

test("an added row's revert deletes it", () => {
  const add = spec("addRow");
  const args = { spreadsheet: tracker, sheetId: 1100, values: { key: "FW-110", title: "Night" } };
  assert.deepEqual(add.undo(args, applied({})), { op: "deleteRow", args: {} });
  assert.deepEqual([spec("deleteRow").deletes, spec("deleteRow").revertOnly], [true, true]);
});
