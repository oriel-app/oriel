// Google Sheets opened as the server opens a connection, through its
// declaration's fixture, synced as the server's loop syncs one, into the
// index, and shown in Browse under each grouping and on the overview
// (decision 0050). The flag that makes the connection at start is OA-214's;
// everything after opening is the server's own.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type IndexRecord, instant, type Opened, syncSource, type ToOpen, ulid } from "@oriel/core";
import { ensureWorkspace, indexStore, loadMigrations, migrate, open } from "@oriel/db";
import {
  fixtureGoogle,
  loadSheetsFixture,
  rowKey,
  sheetsDeclaration,
  spreadsheetKey,
} from "@oriel/sheets";
import { recognizerFor } from "@oriel/sources";
import { overviewView } from "./overview.ts";
import { browseView, groupings } from "./window.ts";

const fixture = loadSheetsFixture();
const idOf = (slug: string) => fixture.spreadsheets.find((s) => s.slug === slug)?.id ?? "";
const tracker = idOf("tracker");
const raid = idOf("raid");
const contacts = idOf("contacts");
const now = instant(new Date(Date.UTC(2026, 9, 1, 12)));

async function opened() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), now);
  const workspaceId = ulid(0, new Uint8Array(10));
  ensureWorkspace(db, { id: workspaceId, name: "test" }, now);
  const index = indexStore(db);
  const standIn = fixtureGoogle(fixture);
  const made = sheetsDeclaration.fixture.connection();
  const connection: ToOpen = {
    id: ulid(1, new Uint8Array(10)),
    number: 1,
    prefix: "sheets",
    identity: made.identity,
    options: made.options,
    secret: null,
  };
  const logged: string[] = [];
  const sheets: Opened = await sheetsDeclaration.fixture.open(connection, {
    fetch: standIn.fetch,
    kept: false,
    log: (message) => logged.push(message),
    now: () => now,
  });
  const sync = (full: boolean) =>
    syncSource({
      source: sheets.source,
      attrs: sheets.attrs,
      key: sheetsDeclaration.key,
      facets: sheetsDeclaration.facets,
      recognize: recognizerFor({ jira: { projects: ["SYN"] } }),
      index,
      workspaceId,
      full,
      clock: () => now,
      log: () => {},
    });
  const records = (): IndexRecord[] => index.records(workspaceId, "sheets", sheets.attrs);
  return { sheets, standIn, sync, records, index, workspaceId, logged };
}

const row = (spreadsheet: string, sheetId: number, key: string) =>
  `sheets:${rowKey(spreadsheet, sheetId, key)}`;

test("the fixture's tracker, RAID log and plain table sync into the index, as an incremental connection", async () => {
  const { sheets, sync, records, logged } = await opened();
  assert.equal(sheets.incremental, true);
  assert.equal(sheets.about, "4 spreadsheets");
  await sync(true);
  const ids = new Set(records().map((r) => r.id));
  for (const id of [
    row(tracker, 1100, "FW-101"),
    row(raid, 4100, "R-01"),
    row(contacts, 5100, "+44 1632 960101"),
    `sheets:${spreadsheetKey(contacts)}`,
  ])
    assert.ok(ids.has(id as IndexRecord["id"]), id);
  // The duplicate and blank keys, and the archive past its cap, are counted, never named.
  assert.ok(logged.includes("sheets: some of it wasn't read"));
});

test("Browse shows Sheets rows under each grouping, by their own facets", async () => {
  const { sync, records } = await opened();
  await sync(true);
  const all = records();
  const items = (id: keyof typeof groupings) =>
    new Map(
      browseView(id, groupings[id], all, now, false).clusters.map((c) => [
        c.row.label,
        c.row.count,
      ]),
    );
  // The tracker maps no parent: its Epic column names no rows, so it stays
  // content, and no row is made an epic.
  assert.ok(items("epic").has("No epics in this source"));
  assert.ok((items("assignee").get("Farid Haddad") ?? 0) >= 2);
  assert.ok(items("assignee").has("No assignees in this source"));
  assert.ok(items("stuck").has("No update in 14 days"));
  const view = browseView("assignee", groupings.assignee, all, now, false);
  assert.deepEqual(view.choices?.sources, [{ id: "sheets", name: "Google Sheets" }]);
});

test("the overview ranks a spreadsheet edited this week among what no workstream holds", async () => {
  const { sync, records, index, workspaceId } = await opened();
  await sync(true);
  const view = overviewView({
    records: records(),
    changes: index.changes(workspaceId),
    seen: null,
    workstreams: [],
    threads: [],
    unopened: [],
    clusters: (id) => groupings[id].group(records(), now, () => 0),
    now,
  });
  const subjects = view.candidates.rows.flatMap((c) =>
    c.subject.kind === "item" ? [c.subject.item.id] : [],
  );
  assert.ok(subjects.includes(`sheets:${spreadsheetKey(tracker)}`));
});

test("a later version: the next sync reads only the tracker, and an edited key's old row goes", async () => {
  const { standIn, sync, records } = await opened();
  await sync(true);
  const before = standIn.calls.length;
  const unchanged = await sync(false);
  // One Drive request a spreadsheet, and nothing read.
  assert.equal(standIn.calls.length - before, fixture.spreadsheets.length);
  assert.equal(unchanged.records, 0);
  standIn.advance(tracker);
  const moved = await sync(false);
  assert.equal(moved.gone, 1);
  const ids = new Set<string>(records().map((r) => r.id));
  assert.ok(!ids.has(row(tracker, 1100, "FW-108")));
  assert.ok(ids.has(row(tracker, 1100, "FW-118")));
  assert.ok(ids.has(row(raid, 4100, "R-01")));
});
