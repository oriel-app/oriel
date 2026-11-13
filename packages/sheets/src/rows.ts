// Rows move, so a row is found by its key cell, never by its number.
import { createHash } from "node:crypto";
import type { FieldReader, FieldValues, ItemId } from "@oriel/core";
import { parseItemId } from "@oriel/core";
import { rowKey, tabPart } from "./attrs.ts";
import type { Google, TabInfo } from "./google.ts";
import { maxRows, readGrid } from "./grid.ts";
import { type FieldName, type SheetsPicks, type TabMapping } from "./mapping.ts";
import { type Cell, type Entered, type Grid, type TableRow, tableOf } from "./table.ts";

export type TabRead = {
  spreadsheet: string;
  tab: TabInfo;
  mapping: TabMapping;
  grid: Grid;
  columns: Partial<Record<FieldName, number>>;
  rows: TableRow[];
  last: number;
  capped: boolean;
};

export type RowAt = TabRead & { row: TableRow; index: number };

export const valueOf = (entered: Entered | undefined): unknown =>
  entered === undefined || entered === null
    ? null
    : typeof entered === "object"
      ? entered.formula
      : entered;

export const cellsAt = (grid: Grid, index: number): readonly (Cell | null)[] =>
  grid.rows[index - grid.startRow] ?? [];

// A revert's check that nobody touched a row Oriel added: notes count too, so any edit moves it.
export function cellsDigest(cells: readonly (Cell | null)[]): string {
  const held = cells.map((cell) =>
    cell ? (cell.note === null ? (cell.entered ?? null) : [cell.entered ?? null, cell.note]) : null,
  );
  while (held.length && held.at(-1) === null) held.pop();
  return createHash("sha256").update(JSON.stringify(held)).digest("hex").slice(0, 16);
}

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

export function placeOf(
  stableId: string,
): { spreadsheet: string; sheetId: number; key: string } | null {
  const match = /^([A-Za-z0-9_-]{10,100})\/([0-9]{1,10})\/([0-9a-f]{16})$/.exec(stableId);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return { spreadsheet: match[1], sheetId: Number(match[2]), key: match[3] };
}

export const stableIdOf = (spreadsheet: string, sheetId: number, key: string) =>
  `${tabPart(spreadsheet, sheetId)}${key}`;

export function rowFinder(
  google: Google,
  picks: SheetsPicks,
  where: Map<string, { spreadsheet: string; sheetId: number }> = new Map(),
) {
  const mappingOf = (spreadsheet: string, sheetId: number) =>
    picks.spreadsheets.find((s) => s.id === spreadsheet)?.tabs.find((t) => t.sheetId === sheetId);

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

  const rowIn = (read: TabRead, key: string): RowAt | null => {
    const row = read.rows.find((r) => rowKey(read.spreadsheet, read.tab.sheetId, r.key) === key);
    return row ? { ...read, row, index: row.number - 1 } : null;
  };

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
