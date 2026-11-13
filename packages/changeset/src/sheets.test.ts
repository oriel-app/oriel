import assert from "node:assert/strict";
import { test } from "node:test";
import { instant, type ItemId, itemId, ulid, unknown } from "@oriel/core";
import {
  ensureWorkspace,
  indexStore,
  loadMigrations,
  migrate,
  open,
  runStore,
  threadStore,
  workstreamStore,
} from "@oriel/db";
import {
  fixtureGoogle,
  loadSheetsFixture,
  rowKey,
  sheetsDeclaredFixture,
  type SheetsRecord,
} from "@oriel/sheets";
import { specs } from "@oriel/sources";
import { changeSets } from "./change-sets.ts";
import { approve, nth } from "./testing.ts";

const t0 = instant(new Date(Date.UTC(2026, 10, 3, 9)));
const id = (n: number) => ulid(n, new Uint8Array(10));
const fixture = loadSheetsFixture();
const tracker = fixture.spreadsheets.find((s) => s.slug === "tracker")?.id ?? "";
const fw102 = itemId("sheets", rowKey(tracker, 1100, "FW-102")) as ItemId<"sheets">;

async function setup(options: Record<string, unknown> = {}) {
  const standIn = fixtureGoogle(fixture);
  const declared = sheetsDeclaredFixture.connection();
  const opened = await sheetsDeclaredFixture.open(
    {
      id: id(9),
      number: 1,
      prefix: "sheets",
      identity: declared.identity,
      options: { ...declared.options, ...options },
    },
    { fetch: standIn.fetch, log: () => {}, now: () => t0 },
  );
  const records: SheetsRecord[] = [];
  for await (const page of opened.source.sync(null))
    records.push(...(page.records as SheetsRecord[]));

  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = id(0);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const sync = indexStore(db).beginSync(workspaceId, "sheets", unknown, t0);
  sync.apply({ records, gone: [], cursor: null });
  sync.finish(null, t0);
  const tab = records.filter((r) => r.attrs.of === "row" && r.attrs.tab.sheetId === 1100);
  const workstreamId = id(1);
  workstreamStore(db).create(
    { id: workstreamId, workspaceId, name: "Tracker", origin: { kind: "picked" } },
    tab.map((r) => ({ id: r.id, stableId: r.stableId })),
    t0,
  );
  const threadId = id(2);
  threadStore(db).open({ id: threadId, workspaceId, workstreamId }, t0);
  const run = { id: id(3), workspaceId, threadId };
  runStore(db).record(
    {
      ...run,
      snapshot: 1,
      regionVersion: 1,
      systemPromptHash: "p",
      dtsHash: "d",
      model: "model",
      inputTokens: 0,
      outputTokens: 0,
      wallMs: 0,
      coldStartMs: null,
      outcome: "ok",
      startedAt: t0,
    },
    [],
  );
  const sets = changeSets({
    db,
    writerConfig:
      opened.writes === undefined
        ? []
        : [{ prefix: "sheets", kind: "sheets", writes: opened.writes }],
    ...(opened.fields ? { readers: { sheets: opened.fields } } : {}),
    specs,
    reviewBase: new URL("http://localhost:4000/review/"),
    now: () => t0,
    emit: () => {},
    log: () => {},
  });
  const cell = (row: number, column: number) =>
    standIn.spreadsheet(tracker).tabs.find((t) => t.sheetId === 1100)?.rows[row]?.[column];
  return { standIn, sets, run, cell };
}

test("an edit and a new row are shown, approved, applied and reverted", async () => {
  const { sets, run, cell, standIn } = await setup();
  const set = await sets.capture(run, [
    { op: "setField", target: fw102, ref: null, args: { field: "status", value: "In progress" } },
    {
      op: "addRow",
      target: null,
      ref: null,
      args: {
        spreadsheet: tracker,
        sheetId: 1100,
        values: { key: "FW-110", title: "=1+1", estimate: 2 },
      },
    },
  ]);
  const diff = await sets.diff(set.id);
  assert.deepEqual(nth(diff.lines, 0).fields, [
    { name: "status", before: "To do", after: "In progress" },
  ]);
  assert.deepEqual(
    nth(diff.lines, 1).fields.map((f) => [f.name, f.after]),
    [
      ["key", "FW-110"],
      ["title", "=1+1"],
      ["estimate", 2],
    ],
  );
  await approve(sets, set.id);
  const report = await sets.apply(set.id);
  assert.deepEqual(report.failed, []);
  assert.equal(cell(2, 3), "In progress");
  assert.equal(cell(12, 2), "=1+1");
  assert.equal(standIn.spreadsheet(tracker).tabs[0]?.rows[14]?.[0], "Notes");

  const revert = await sets.revert(set.id);
  assert.ok(!("conflicts" in revert), JSON.stringify(revert));
  await approve(sets, revert.id);
  assert.deepEqual((await sets.apply(revert.id)).failed, []);
  assert.equal(cell(2, 3), "To do");
  assert.equal(cell(12, 0), undefined);
  assert.equal(standIn.spreadsheet(tracker).tabs[0]?.rows[13]?.[0], "Notes");
});

test("a cell someone changed after the person approved is a conflict, never an overwrite", async () => {
  const { sets, run, cell, standIn } = await setup();
  const set = await sets.capture(run, [
    { op: "setField", target: fw102, ref: null, args: { field: "status", value: "In progress" } },
  ]);
  await approve(sets, set.id);
  standIn.change(tracker, { kind: "set", sheetId: 1100, cell: "D3", value: "Blocked" });
  const report = await sets.apply(set.id);
  assert.equal(report.failed.length, 1);
  assert.equal(cell(2, 3), "Blocked");
  assert.deepEqual(
    standIn.calls.filter((c) => c.method === "POST"),
    [],
  );
});

test("reverting an edit stops if the cell changed since Oriel wrote it", async () => {
  const { sets, run, cell, standIn } = await setup();
  const set = await sets.capture(run, [
    { op: "setField", target: fw102, ref: null, args: { field: "status", value: "In progress" } },
  ]);
  await approve(sets, set.id);
  await sets.apply(set.id);
  standIn.change(tracker, { kind: "set", sheetId: 1100, cell: "D3", value: "Done" });
  const revert = await sets.revert(set.id);
  assert.ok("conflicts" in revert);
  assert.equal(cell(2, 3), "Done");
});

test("a read-only connection builds no writer: its change sets are shown, never applied", async () => {
  const { sets, run } = await setup({ readOnly: true });
  const set = await sets.capture(run, [
    { op: "setField", target: fw102, ref: null, args: { field: "status", value: "Done" } },
  ]);
  const diff = await sets.diff(set.id);
  assert.deepEqual(nth(diff.lines, 0).fields, [{ name: "status", before: "To do", after: "Done" }]);
  await assert.rejects(approve(sets, set.id), { code: "read-only" });
});

test("reverting an added row stops if someone left a note on it since", async () => {
  const { sets, run, cell, standIn } = await setup();
  const set = await sets.capture(run, [
    {
      op: "addRow",
      target: null,
      ref: null,
      args: { spreadsheet: tracker, sheetId: 1100, values: { key: "FW-110", title: "Night" } },
    },
  ]);
  await approve(sets, set.id);
  assert.deepEqual((await sets.apply(set.id)).failed, []);
  standIn.change(tracker, {
    kind: "set",
    sheetId: 1100,
    cell: "C13",
    value: { value: "Night", note: "Keep this one." },
  });
  const revert = await sets.revert(set.id);
  assert.ok("conflicts" in revert);
  assert.deepEqual(cell(12, 0), "FW-110");
});
