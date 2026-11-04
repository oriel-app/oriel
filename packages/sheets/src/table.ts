// A mapped tab's rows as items (decision 0050), from its grid as Google
// gave it: pure, so every edge of a sheet is tested here without a request.
//
// - Columns are found by their headers, so inserting or moving one changes
//   nothing. A mapped column missing from the header row, or in it twice,
//   stops the tab: the sync keeps what the index had and names the column.
// - The table runs from the row under the header to its first blank row, or
//   to the grid's end, by the mapping.
// - A value merged down several rows is that value on each of them; one
//   merged across columns belongs to the leftmost.
// - Rows hidden by hand are skipped unless the mapping reads them; rows a
//   filter hides are read. A hidden column is read only when mapped.
// - A row's key is its key cell as shown, trimmed. Two rows with one key, or
//   a row with none, aren't items until fixed, and are listed by row number.
import type { State } from "@oriel/core";
import { columnLetters } from "./a1.ts";
import { mappedColumns, type TabMapping } from "./mapping.ts";

// A cell as the sheet shows it, the number Google computed for it if any,
// and its note.
export type Cell = { shown: string; number: number | null; note: string | null };

// A tab's grid from its header row down, as far as it was read.
export type Grid = {
  // The 0-based index of the first row in `rows`.
  startRow: number;
  // Rows by their index from `startRow`; a missing cell is empty.
  rows: readonly (readonly (Cell | null)[])[];
  // Row indices hidden by hand, and column indices hidden by hand.
  hiddenRows: ReadonlySet<number>;
  hiddenColumns: ReadonlySet<number>;
  // Merged ranges, 0-based, ends exclusive.
  merges: readonly { startRow: number; endRow: number; startColumn: number; endColumn: number }[];
};

export type RowFields = {
  title: string;
  status?: string | null;
  state?: State | null;
  assignee?: string | null;
  estimate?: number | null;
  link?: string | null;
  // The key the parent column names, before it is found among the rows.
  parent?: string | null;
};

export type TableRow = {
  // Its number as the sheet shows it now, which a sort changes.
  number: number;
  key: string;
  fields: RowFields;
  // Every column read, in column order: its header and what the cell shows,
  // with its note.
  cells: { header: string; value: string; note: string | null }[];
};

export type Table =
  | {
      rows: TableRow[];
      // Row numbers of rows sharing a key, and of rows with none.
      duplicates: number[];
      keyless: number[];
      // Rows hidden by hand that weren't read.
      hidden: number;
      // Whether rows past the cap weren't read.
      capped: boolean;
    }
  | { stopped: string };

const empty = (cell: Cell | null | undefined) => !cell || (cell.shown === "" && cell.note === null);
const clean = (text: string) => text.normalize("NFC").trim();

// What a column is called in a row's content: its header, or its letter when
// it has none.
const label = (header: string, column: number) => header || `Column ${columnLetters(column)}`;

// `most` caps how many of the table's rows are read.
export function tableOf(grid: Grid, mapping: TabMapping, most = Infinity): Table {
  const headerAt = mapping.header - 1 - grid.startRow;
  const headerRow = grid.rows[headerAt] ?? [];
  const headers = Array.from(
    { length: grid.rows.reduce((most, row) => Math.max(most, row.length), headerRow.length) },
    (_, c) => clean(headerRow[c]?.shown ?? ""),
  );
  const columnOf = new Map<string, number>();
  for (const [field, header] of mappedColumns(mapping)) {
    const found = headers.flatMap((h, c) => (h === clean(header) ? [c] : []));
    if (found.length === 0)
      return { stopped: `the ${field} column, "${header}", isn't in the header row` };
    if (found.length > 1)
      return { stopped: `the ${field} column, "${header}", is in the header row twice` };
    columnOf.set(field, found[0] ?? 0);
  }
  const mapped = new Set(columnOf.values());
  const read = headers.flatMap((h, c) =>
    !grid.hiddenColumns.has(c) || mapped.has(c) ? [{ column: c, header: label(h, c) }] : [],
  );

  // Each row's cells with merged values filled down their leftmost column.
  const filled = grid.rows.map((row) => [...row]);
  for (const merge of grid.merges) {
    const top = filled[merge.startRow - grid.startRow]?.[merge.startColumn];
    if (!top) continue;
    for (let r = merge.startRow + 1; r < merge.endRow; r++) {
      const row = filled[r - grid.startRow];
      if (row) row[merge.startColumn] = { ...top, note: null };
    }
  }

  const candidates: TableRow[] = [];
  let hidden = 0;
  let taken = 0;
  let capped = false;
  for (let at = headerAt + 1; at < filled.length; at++) {
    const row = filled[at] ?? [];
    if (row.every(empty)) {
      if (mapping.end === "blank") break;
      continue;
    }
    if (taken === most) {
      capped = true;
      break;
    }
    taken++;
    const index = grid.startRow + at;
    if (grid.hiddenRows.has(index) && !mapping.hidden) {
      hidden++;
      continue;
    }
    const shown = (field: string) => {
      const column = columnOf.get(field);
      return column === undefined ? undefined : clean(row[column]?.shown ?? "");
    };
    const orNull = (field: string) => {
      const value = shown(field);
      return value === undefined ? {} : { [field]: value || null };
    };
    const status = shown("status");
    const estimateColumn = columnOf.get("estimate");
    candidates.push({
      number: index + 1,
      key: shown("key") ?? "",
      fields: {
        title: (shown("title") ?? "").replace(/\s+/g, " ") || "(no title)",
        ...orNull("status"),
        ...(status !== undefined && mapping.states && { state: stateOf(status, mapping) }),
        ...orNull("assignee"),
        ...(estimateColumn !== undefined && { estimate: estimateOf(row[estimateColumn]) }),
        ...(columnOf.has("link") && { link: linkOf(shown("link") ?? "") }),
        ...orNull("parent"),
      },
      cells: read.flatMap(({ column, header }) => {
        const cell = row[column];
        return empty(cell) ? [] : [{ header, value: cell?.shown ?? "", note: cell?.note ?? null }];
      }),
    });
  }

  const byKey = Map.groupBy(candidates, (row) => row.key);
  const keyless = (byKey.get("") ?? []).map((row) => row.number);
  const duplicates = [...byKey]
    .filter(([key, rows]) => key !== "" && rows.length > 1)
    .flatMap(([, rows]) => rows.map((row) => row.number))
    .toSorted((a, b) => a - b);
  return {
    rows: candidates.filter((row) => row.key !== "" && byKey.get(row.key)?.length === 1),
    duplicates,
    keyless,
    hidden,
    capped,
  };
}

// The state a status means, by the mapping's values, ignoring case; null for
// a status that means none.
function stateOf(status: string, mapping: TabMapping): State | null {
  const states = mapping.states;
  if (!states) return null;
  const said = status.toLowerCase();
  const found = (["todo", "in-progress", "done"] as const).find((state) =>
    states[state].some((value) => clean(value).toLowerCase() === said),
  );
  return found ?? null;
}

// A number Google computed, or text that reads as one; null otherwise.
function estimateOf(cell: Cell | null | undefined): number | null {
  if (!cell) return null;
  if (cell.number !== null && Number.isFinite(cell.number)) return cell.number;
  const text = clean(cell.shown);
  const parsed = text === "" ? Number.NaN : Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

// An http(s) link, or null.
function linkOf(text: string): string | null {
  const url = URL.parse(text);
  return url && (url.protocol === "https:" || url.protocol === "http:") ? url.href : null;
}
