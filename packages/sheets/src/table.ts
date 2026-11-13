import type { State } from "@oriel/core";
import { columnLetters } from "./a1.ts";
import { type FieldName, mappedColumns, type TabMapping } from "./mapping.ts";

export type Cell = {
  shown: string;
  number: number | null;
  note: string | null;
  entered?: Entered;
};

export type Entered = string | number | boolean | { formula: string } | null;

export type Grid = {
  startRow: number;
  rows: readonly (readonly (Cell | null)[])[];
  hiddenRows: ReadonlySet<number>;
  hiddenColumns: ReadonlySet<number>;
  merges: readonly { startRow: number; endRow: number; startColumn: number; endColumn: number }[];
};

export type RowFields = {
  title: string;
  status?: string | null;
  state?: State | null;
  assignee?: string | null;
  estimate?: number | null;
  link?: string | null;
  parent?: string | null;
};

export type TableRow = {
  number: number;
  key: string;
  fields: RowFields;
  cells: { header: string; value: string; note: string | null }[];
};

export type Table =
  | {
      rows: TableRow[];
      columns: Partial<Record<FieldName, number>>;
      // Hidden, keyless and duplicate rows included, since a new row goes after it.
      last: number;
      duplicates: number[];
      keyless: number[];
      hidden: number;
      capped: boolean;
    }
  | { stopped: string };

const empty = (cell: Cell | null | undefined) => !cell || (cell.shown === "" && cell.note === null);
const clean = (text: string) => text.normalize("NFC").trim();

const label = (header: string, column: number) => header || `Column ${columnLetters(column)}`;

export function tableOf(grid: Grid, mapping: TabMapping, most = Infinity): Table {
  const headerAt = mapping.header - 1 - grid.startRow;
  const headerRow = grid.rows[headerAt] ?? [];
  const headers = Array.from(
    { length: grid.rows.reduce((most, row) => Math.max(most, row.length), headerRow.length) },
    (_, c) => clean(headerRow[c]?.shown ?? ""),
  );
  const columnOf = new Map<FieldName, number>();
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
  let last = grid.startRow + headerAt;
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
    last = index;
    if (grid.hiddenRows.has(index) && !mapping.hidden) {
      hidden++;
      continue;
    }
    const shown = (field: FieldName) => {
      const column = columnOf.get(field);
      return column === undefined ? undefined : clean(row[column]?.shown ?? "");
    };
    const orNull = (field: FieldName) => {
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
    columns: Object.fromEntries(columnOf),
    last,
    duplicates,
    keyless,
    hidden,
    capped,
  };
}

function stateOf(status: string, mapping: TabMapping): State | null {
  const states = mapping.states;
  if (!states) return null;
  const said = status.toLowerCase();
  const found = (["todo", "in-progress", "done"] as const).find((state) =>
    states[state].some((value) => clean(value).toLowerCase() === said),
  );
  return found ?? null;
}

function estimateOf(cell: Cell | null | undefined): number | null {
  if (!cell) return null;
  if (cell.number !== null && Number.isFinite(cell.number)) return cell.number;
  const text = clean(cell.shown);
  const parsed = text === "" ? Number.NaN : Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function linkOf(text: string): string | null {
  const url = URL.parse(text);
  return url && (url.protocol === "https:" || url.protocol === "http:") ? url.href : null;
}
