// The Ferrowick spreadsheets as Sheets' declared fixture (decision 0049):
// `fixtures/sheets/`, read by the real Sheets source through the stand-in for
// Google's APIs, under the mappings a person would approve for them. Its
// edits are the spreadsheets' later versions, in the order they were made.
//
// A case names a spreadsheet by its slug (`sheets:raid`), and a row by its
// spreadsheet, its tab as the fixture first names it, and its key cell
// (`sheets:tracker/Tracker/FW-106`).
import {
  type Instant,
  type ItemId,
  itemId,
  type LoadedFixture,
  type SourceFixture,
} from "@oriel/core";
import { columnIndex, parseBounds } from "./a1.ts";
import { rowKey, type SheetsRecord, spreadsheetKey } from "./attrs.ts";
import {
  applyChange,
  type FixtureSpreadsheet,
  type FixtureTab,
  gridOf as fixtureGridOf,
  loadSheetsFixture,
  type SheetsFixture,
  shown,
  valueOf,
  within,
} from "./fixture.ts";
import { googleReads } from "./google.ts";
import type { SheetsPicks, States, TabMapping } from "./mapping.ts";
import { type SheetsContext, sheetsContextOf } from "./namespace.ts";
import { openSheets, type SheetsWrites } from "./open-connection.ts";
import { sheetsPreview } from "./preview.ts";
import { sheetsSource } from "./source.ts";
import { fixtureGoogle, standInToken } from "./stand-in.ts";
import { type Grid, tableOf } from "./table.ts";

const states = (todo: string[], inProgress: string[], done: string[]): States => ({
  todo,
  "in-progress": inProgress,
  done,
});
const tab = (sheetId: number, fields: Omit<TabMapping, "sheetId" | "header" | "end" | "hidden">) =>
  ({ sheetId, header: 1, end: "blank", hidden: false, ...fields }) satisfies TabMapping;
const sprint = (sheetId: number) =>
  tab(sheetId, {
    key: "Ticket",
    title: "Story",
    status: "Status",
    states: states(["To do"], ["In progress"], ["Done"]),
    assignee: "Owner",
    estimate: "Points",
  });

// The mappings, by spreadsheet slug: a tracker whose Epic column names no
// rows, so it stays content; a RAID log; plain tables; and the archive, past
// the row cap.
export const fixtureMappings: Readonly<Record<string, TabMapping[]>> = {
  tracker: [
    tab(1100, {
      key: "ID",
      title: "Story",
      status: "Status",
      states: states(["To do"], ["In progress", "Blocked"], ["Done"]),
      assignee: "Owner",
      estimate: "Estimate",
      link: "Link",
    }),
    sprint(2141),
    sprint(2142),
    // A status with no states, in Greek.
    tab(3300, { key: "キー", title: "タイトル", status: "Κατάσταση", assignee: "👤 担当" }),
  ],
  raid: [
    tab(4100, {
      key: "Ref",
      title: "Description",
      status: "Status",
      states: states(["Open"], ["In progress", "Waiting"], ["Closed"]),
      assignee: "Owner",
    }),
    tab(4200, { key: "Ref", title: "Decision" }),
  ],
  contacts: [tab(5100, { key: "Phone", title: "Port" })],
  archive: [tab(6100, { key: "ID", title: "Story" })],
};

export function fixturePicks(fixture: SheetsFixture): SheetsPicks {
  return {
    spreadsheets: fixture.spreadsheets.map((s) => ({
      id: s.id,
      tabs: fixtureMappings[s.slug] ?? [],
    })),
  };
}

// The fixture's secret: the stand-in's token, which doesn't run out.
const fixtureSecret = JSON.stringify({ access: standInToken, expiresAt: Number.MAX_SAFE_INTEGER });

export const sheetsDeclaredFixture: SourceFixture<SheetsContext, unknown, SheetsWrites> = {
  load: () => loaded(loadSheetsFixture()),
  // The fixture's account, with its spreadsheets picked and mapped.
  connection: () => {
    const fixture = loadSheetsFixture();
    return { identity: fixture.user.permissionId, options: fixturePicks(fixture) };
  },
  // Opened as Sheets is, through the stand-in for Google's APIs, as the
  // spreadsheets first are, with a token that doesn't run out. A test may
  // give its own stand-in, to edit the spreadsheets as a person would.
  open: (connection, via) =>
    openSheets(
      { ...connection, secret: fixtureSecret },
      { ...via, fetch: via.fetch ?? fixtureGoogle(loadSheetsFixture()).fetch },
    ),
  preview: (connection, via) =>
    sheetsPreview(
      { ...connection, secret: fixtureSecret },
      { ...via, fetch: via.fetch ?? fixtureGoogle(loadSheetsFixture()).fetch },
    ),
};

// Every later version, in the order it was made.
const editsOf = (fixture: SheetsFixture) =>
  fixture.spreadsheets
    .flatMap((s) => s.later.map((version) => ({ id: s.id, version })))
    .toSorted((a, b) => a.version.modifiedTime.localeCompare(b.version.modifiedTime));

// A fixture tab as Google's grid has it. Rows a filter hides are read, so
// the filter changes nothing here.
export function fixtureGrid(tab: FixtureTab): Grid {
  const grid = fixtureGridOf(tab);
  return {
    startRow: 0,
    rows: tab.rows.map((row) =>
      row.map((cell) => {
        const note = typeof cell === "object" && cell !== null ? (cell.note ?? null) : null;
        const text = shown(cell);
        if (text === "" && note === null) return null;
        const held = valueOf(cell);
        return { shown: text, number: typeof held === "number" ? held : null, note };
      }),
    ),
    hiddenRows: new Set((tab.hiddenRows ?? []).map((n) => n - 1)),
    hiddenColumns: new Set((tab.hiddenColumns ?? []).map((c) => columnIndex(c) ?? -1)),
    merges: (tab.merges ?? []).map((range) => within(parseBounds(range) ?? {}, grid)),
  };
}

function loaded(fixture: SheetsFixture): LoadedFixture<SheetsContext> {
  const edits = editsOf(fixture);
  // The spreadsheets after the first `edited` edits.
  const after = (edited: number): FixtureSpreadsheet[] => {
    const copy = structuredClone(fixture.spreadsheets);
    for (const { id, version } of edits.slice(0, edited)) {
      const spreadsheet = copy.find((s) => s.id === id);
      for (const change of version.changes) if (spreadsheet) applyChange(spreadsheet, change);
    }
    return copy;
  };
  // Each item's ID and title, as the source would read it.
  const items = (edited: number) =>
    after(edited).flatMap((s) => [
      [itemId("sheets", spreadsheetKey(s.id)), s.title] as const,
      ...(fixtureMappings[s.slug] ?? []).flatMap((mapping) => {
        const found = s.tabs.find((t) => t.sheetId === mapping.sheetId);
        const table = found && tableOf(fixtureGrid(found), mapping);
        if (!table || "stopped" in table) return [];
        return table.rows.map(
          (row) =>
            [itemId("sheets", rowKey(s.id, mapping.sheetId, row.key)), row.fields.title] as const,
        );
      }),
    ]);
  const titles = new Map<ItemId, string>(
    Array.from({ length: edits.length + 1 }, (_, n) => items(n)).flat(),
  );
  const firstEdit = edits[0]?.version.modifiedTime;
  return {
    edits: edits.length,
    firstEdit: (firstEdit ?? null) as Instant | null,
    regions: [],
    item: (name) => {
      const [slug, tabTitle, ...rest] = name.split("/");
      const spreadsheet = fixture.spreadsheets.find((s) => s.slug === slug);
      if (!spreadsheet)
        return { problem: `no spreadsheet ${JSON.stringify(slug)} in the Sheets fixture` };
      if (tabTitle === undefined) return { id: itemId("sheets", spreadsheetKey(spreadsheet.id)) };
      const found = spreadsheet.tabs.find((t) => t.title === tabTitle);
      if (!found) return { problem: `no tab ${JSON.stringify(tabTitle)} in ${slug}` };
      const id = itemId("sheets", rowKey(spreadsheet.id, found.sheetId, rest.join("/")));
      return titles.has(id)
        ? { id }
        : { problem: `${JSON.stringify(name)} isn't a row the Sheets fixture's mapping reads` };
    },
    // A row and a spreadsheet by their titles.
    called: (id) => titles.get(id) ?? null,
    chips: (edited) => items(edited),
    connect: async (edited) => {
      const standIn = fixtureGoogle(fixture);
      for (const { id } of edits.slice(0, edited)) standIn.advance(id);
      const source = sheetsSource({
        google: googleReads({
          fetch: standIn.fetch,
          credential: { headers: async () => ({ Authorization: `Bearer ${standInToken}` }) },
          wait: async () => {},
          random: () => 0,
        }),
        picks: fixturePicks(fixture),
        log: () => {},
      });
      const records: SheetsRecord[] = [];
      for await (const page of source.sync(null)) records.push(...page.records);
      return {
        records,
        read: (ids) => source.read(ids as ItemId<"sheets">[]),
        // The fixture's connection may propose changes.
        context: sheetsContextOf(fixturePicks(fixture)),
        changes: () => [],
        close: () => {},
      };
    },
  };
}
