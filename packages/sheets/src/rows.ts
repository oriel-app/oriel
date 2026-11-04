// A row found again by its key, as a write and a diff need it (decision
// 0050): rows move, so a row is found by its key cell in its mapped tab,
// read as a sync reads it, never by its number. Its fields are what each
// mapped cell holds as entered, so a value written back is the value that
// was there: text stays text, a number a number. Reads only.
import { createHash } from "node:crypto";
import type { FieldReader, FieldValues, ItemId } from "@oriel/core";
import { parseItemId } from "@oriel/core";
import { rowKey, tabPart } from "./attrs.ts";
import type { Google, TabInfo } from "./google.ts";
import { maxRows, readGrid } from "./grid.ts";
import { type FieldName, type SheetsPicks, type TabMapping } from "./mapping.ts";
import { type Cell, type Entered, type Grid, type TableRow, tableOf } from "./table.ts";

// A mapped tab as read now: its grid with what each cell holds as entered,
// and its table.
export type TabRead = {
  spreadsheet: string;
  tab: TabInfo;
  mapping: TabMapping;
  grid: Grid;
  columns: Partial<Record<FieldName, number>>;
  rows: TableRow[];
  // The 0-based index of the table's last row, and whether rows past the
  // cap weren't read.
  last: number;
  capped: boolean;
};

// A row of a tab read now: its 0-based index in the grid.
export type RowAt = TabRead & { row: TableRow; index: number };

// A field's value as a cell holds it: a formula as its text, which a write
// refuses to touch.
export const valueOf = (entered: Entered | undefined): unknown =>
  entered === undefined || entered === null
    ? null
    : typeof entered === "object"
      ? entered.formula
      : entered;

// A grid row's cells, 0-based, as the grid has them.
export const cellsAt = (grid: Grid, index: number): readonly (Cell | null)[] =>
  grid.rows[index - grid.startRow] ?? [];

// A digest of everything a row holds as entered, and its notes, so any edit
// to it moves it and an edit elsewhere doesn't: a revert's check that nobody
// touched a row Oriel added.
export function cellsDigest(cells: readonly (Cell | null)[]): string {
  const held = cells.map((cell) =>
    cell ? (cell.note === null ? (cell.entered ?? null) : [cell.entered ?? null, cell.note]) : null,
  );
  while (held.length && held.at(-1) === null) held.pop();
  return createHash("sha256").update(JSON.stringify(held)).digest("hex").slice(0, 16);
}

// The row's values for `fields`, from its cells: Oriel's field names, and
// `cells`. A field its tab doesn't map is left out.
export function rowValues(
  columns: Partial<Record<FieldName, number>>,
  cells: readonly (Cell | null)[],
  fields: readonly string[],
): FieldValues {
  return Object.fromEntries(
    fields.flatMap((field) => {
      if (field === "cells") return [[field, cellsDigest(cells)]];
      const column = Object.hasOwn(columns, field) ? columns[field as FieldName] : undefined;
      return column === undefined ? [] : [[field, valueOf(cells[column]?.entered)]];
    }),
  );
}

// Where a row is, from its stable ID: `<spreadsheet>/<sheetId>/<key>`.
export function placeOf(
  stableId: string,
): { spreadsheet: string; sheetId: number; key: string } | null {
  const match = /^([A-Za-z0-9_-]{10,100})\/([0-9]{1,10})\/([0-9a-f]{16})$/.exec(stableId);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return { spreadsheet: match[1], sheetId: Number(match[2]), key: match[3] };
}

export const stableIdOf = (spreadsheet: string, sheetId: number, key: string) =>
  `${tabPart(spreadsheet, sheetId)}${key}`;

// Finds rows in the picked spreadsheets' mapped tabs. `where` remembers
// which tab each key was last found in, so finding it again reads that tab
// alone; a row can't change tabs, since its key hashes its tab's ID.
export function rowFinder(
  google: Google,
  picks: SheetsPicks,
  where: Map<string, { spreadsheet: string; sheetId: number }> = new Map(),
) {
  const mappingOf = (spreadsheet: string, sheetId: number) =>
    picks.spreadsheets.find((s) => s.id === spreadsheet)?.tabs.find((t) => t.sheetId === sheetId);

  // A mapped tab, read now; "gone" when its spreadsheet or tab is, and why
  // it stopped when its mapping no longer fits its header row.
  async function readTab(
    spreadsheet: string,
    sheetId: number,
  ): Promise<TabRead | "gone" | { stopped: string }> {
    const mapping = mappingOf(spreadsheet, sheetId);
    if (!mapping) return "gone";
    const info = await google.tabs(spreadsheet);
    if (info === "gone") return info;
    const tab = info.tabs.find((t) => t.sheetId === sheetId);
    if (!tab) return "gone";
    const grid = await readGrid(google, spreadsheet, tab, mapping, true);
    if (grid === "gone") return grid;
    const table = tableOf(grid, mapping, maxRows);
    if ("stopped" in table) return table;
    for (const row of table.rows)
      where.set(rowKey(spreadsheet, sheetId, row.key), { spreadsheet, sheetId });
    return {
      spreadsheet,
      tab,
      mapping,
      grid,
      columns: table.columns,
      rows: table.rows,
      last: table.last,
      capped: table.capped,
    };
  }

  // The row whose key hashes to `key` in that tab, now.
  const rowIn = (read: TabRead, key: string): RowAt | null => {
    const row = read.rows.find((r) => rowKey(read.spreadsheet, read.tab.sheetId, r.key) === key);
    return row ? { ...read, row, index: row.number - 1 } : null;
  };

  // The row, in the tab `place` names or, without one, wherever it was
  // last found, or else in any mapped tab. "gone" when no mapped tab holds
  // it as an item now.
  async function find(
    key: string,
    place?: { spreadsheet: string; sheetId: number },
  ): Promise<RowAt | "gone" | { stopped: string }> {
    const known = place ?? where.get(key);
    if (known) {
      const read = await readTab(known.spreadsheet, known.sheetId);
      if (read === "gone" || "stopped" in read) return read;
      return rowIn(read, key) ?? "gone";
    }
    for (const spreadsheet of picks.spreadsheets)
      for (const mapping of spreadsheet.tabs) {
        const read = await readTab(spreadsheet.id, mapping.sheetId);
        if (read === "gone" || "stopped" in read) continue;
        const found = rowIn(read, key);
        if (found) return found;
      }
    return "gone";
  }

  return { readTab, find, mappingOf };
}

// How change sets read a row's fields while its connection is read-only,
// so a change set made before can still be shown.
export function rowReader(google: Google, picks: SheetsPicks, prefix: string): FieldReader {
  const finder = rowFinder(google, picks);
  return {
    current: async (id: ItemId, fields: readonly string[]) => {
      const parsed = parseItemId(id);
      if (parsed?.prefix !== prefix) return "gone";
      const found = await finder.find(parsed.key);
      if (found === "gone" || "stopped" in found) return "gone";
      return rowValues(found.columns, cellsAt(found.grid, found.index), fields);
    },
    name: async () => null,
  };
}
