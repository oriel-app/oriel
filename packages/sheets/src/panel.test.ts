// What the panel and the overview show of Sheets items, from live reads and
// the index, through the fixture.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type ChangeLogEntry, type IndexRecord, type Instant, instant } from "@oriel/core";
import { rowKey, sheetsPanel, spreadsheetKey } from "./attrs.ts";
import { sheetsDeclaredFixture } from "./declared-fixture.ts";
import { loadSheetsFixture } from "./fixture.ts";
import { sheetsOverview } from "./overview.ts";

const fixture = loadSheetsFixture();
const tracker = fixture.spreadsheets.find((s) => s.slug === "tracker")?.id ?? "";
const raid = fixture.spreadsheets.find((s) => s.slug === "raid")?.id ?? "";

test("a row's panel: its tab and number, short cells as facts, long ones and notes as text", async () => {
  const connection = await sheetsDeclaredFixture.load().connect(0);
  const [alert, banner] = await connection.read([
    `sheets:${rowKey(tracker, 1100, "FW-105")}`,
    `sheets:${rowKey(tracker, 1100, "FW-102")}`,
  ]);
  assert.equal(alert?.status, "ok");
  const view = sheetsPanel(alert?.status === "ok" ? alert.content : null);
  assert.ok(view);
  const facts = view.blocks[0];
  assert.equal(facts?.kind, "facts");
  assert.deepEqual(facts?.kind === "facts" && facts.facts.slice(0, 4), [
    { name: "Tab", value: "Tracker" },
    { name: "Row", value: "6" },
    { name: "ID", value: "FW-105" },
    { name: "Epic", value: "Alerts" },
  ]);
  assert.deepEqual(
    view.blocks.slice(1).map((b) => b.kind === "text" && b.heading),
    ["Notes"],
  );
  const noted = sheetsPanel(banner?.status === "ok" ? banner.content : null);
  assert.deepEqual(noted?.blocks.at(-1), {
    kind: "text",
    heading: "Note on Story",
    text: "Ops set the flag from the admin tool (SYN-26).",
    format: "plain",
  });
  connection.close();
});

test("a spreadsheet's panel: its tabs, then its comments with their replies", async () => {
  const connection = await sheetsDeclaredFixture.load().connect(0);
  const [doc] = await connection.read([`sheets:${spreadsheetKey(raid)}`]);
  const view = sheetsPanel(doc?.status === "ok" ? doc.content : null);
  assert.ok(view);
  const messages = view.blocks[1];
  assert.equal(messages?.kind, "messages");
  assert.deepEqual(
    messages?.kind === "messages" && messages.messages.map((m) => [m.author, m.labels ?? []]),
    [
      ["Farid Haddad", []],
      ["Dara Nikolaidis", ["Reply"]],
      ["Rowan Pike", []],
      ["Ines Carvalho", ["Resolved"]],
      ["Dara Nikolaidis", ["Reply"]],
    ],
  );
  assert.equal(sheetsPanel({ of: "row" }), null);
});

const at = (iso: string): Instant => instant(new Date(iso));

test("the overview: a spreadsheet edited this week, and a row whose status changed this week, unless held", async () => {
  const { records } = await sheetsDeclaredFixture.load().connect(0);
  const doc = records.find((r) => r.id === `sheets:${spreadsheetKey(tracker)}`) as IndexRecord;
  const row = records.find(
    (r) => r.id === `sheets:${rowKey(tracker, 1100, "FW-106")}`,
  ) as IndexRecord;
  const now = at("2026-10-01T12:00:00Z");
  const change: ChangeLogEntry = {
    seq: 1,
    source: "sheets",
    stableId: row.stableId,
    version: 2,
    at: at("2026-09-30T09:00:00Z"),
    facets: { declared: { status: { before: "To do", after: "In progress" } } },
    gone: false,
  };
  const candidates = sheetsOverview({ records, changes: [change], held: () => false, now });
  assert.deepEqual(candidates, [
    {
      subject: { kind: "item", id: doc.id },
      rule: "A spreadsheet edited in the last 7 days",
      weight: 1,
      detail: "edited 2 days ago",
    },
    {
      subject: { kind: "item", id: row.id },
      rule: "A row whose status changed in the last 7 days",
      weight: 1,
      detail: "changed 1 day ago",
    },
  ]);
  assert.deepEqual(sheetsOverview({ records, changes: [change], held: () => true, now }), []);
  const later = at("2026-10-20T12:00:00Z");
  assert.deepEqual(
    sheetsOverview({ records, changes: [change], held: () => false, now: later }),
    [],
  );
});

test("the declared fixture names rows by spreadsheet, tab and key, and refuses one its mapping doesn't read", () => {
  const loaded = sheetsDeclaredFixture.load();
  assert.deepEqual(loaded.item("tracker/Tracker/FW-106"), {
    id: `sheets:${rowKey(tracker, 1100, "FW-106")}`,
  });
  assert.deepEqual(loaded.item("raid"), { id: `sheets:${spreadsheetKey(raid)}` });
  assert.ok("problem" in loaded.item("tracker/Tracker/FW-104"));
  assert.ok("problem" in loaded.item("tracker/Tracker/FW-107"));
  assert.equal(loaded.edits, 3);
  assert.equal(
    loaded.called?.(`sheets:${rowKey(tracker, 1100, "FW-106")}`),
    "SMS alerts under 160 characters",
  );
  // FW-118 exists only after the first edit.
  const chips = (n: number) => new Map(loaded.chips(n));
  assert.ok(!chips(0).has(`sheets:${rowKey(tracker, 1100, "FW-118")}`));
  assert.ok(chips(1).has(`sheets:${rowKey(tracker, 1100, "FW-118")}`));
});
