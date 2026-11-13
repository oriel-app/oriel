// Text starting with `=` is text; only `formula` is a formula.
import { readFileSync } from "node:fs";
import {
  array,
  boolean,
  type Issue,
  literal,
  number,
  object,
  optional,
  refine,
  type Result,
  string,
  union,
  type Validator,
} from "@oriel/core";
import { type Bounds, columnIndex, columnLetters, parseBounds, parseCell } from "./a1.ts";

export type FixtureValue = string | number | boolean;
export type FixtureCell =
  | FixtureValue
  | null
  | {
      value?: FixtureValue;
      formula?: string;
      formatted?: string;
      note?: string;
      spilled?: true;
    };

export type FixtureTab = {
  // Google's `sheetId`, which survives a rename.
  sheetId: number;
  title: string;
  grid?: { rows: number; columns: number };
  frozenRows?: number;
  rows: FixtureCell[][];
  merges?: string[];
  hiddenRows?: number[];
  hiddenColumns?: string[];
  filter?: { range: string; column: string; hiddenValues: string[] };
};

export type FixtureReply = {
  id: string;
  author: string;
  content: string;
  createdTime: string;
  action?: "resolve" | "reopen";
};

export type FixtureComment = {
  id: string;
  author: string;
  content: string;
  createdTime: string;
  // A deleted comment keeps no content.
  deleted?: boolean;
  quoted?: string;
  anchor?: string;
  replies?: FixtureReply[];
};

export type FixtureChange =
  | { kind: "set"; sheetId: number; cell: string; value: FixtureCell }
  | { kind: "sort"; sheetId: number; range: string; column: string }
  | { kind: "rename"; sheetId: number; title: string }
  | { kind: "insert"; sheetId: number; row: number }
  | { kind: "delete"; sheetId: number; row: number };

export type FixtureVersion = { version: string; modifiedTime: string; changes: FixtureChange[] };

export type FixtureSpreadsheet = {
  slug: string;
  id: string;
  title: string;
  version: string;
  modifiedTime: string;
  canEdit: boolean;
  tabs: FixtureTab[];
  comments: FixtureComment[];
  later: FixtureVersion[];
};

export type SheetsFixture = {
  user: { displayName: string; emailAddress: string; permissionId: string };
  spreadsheets: FixtureSpreadsheet[];
};

const value = union(string, number, boolean);
const cell: Validator<FixtureCell> = union(
  string,
  number,
  boolean,
  literal(null),
  object({
    value: optional(value),
    formula: optional(string),
    formatted: optional(string),
    spilled: optional(literal(true)),
    note: optional(string),
  }),
);
const time = refine(
  string,
  (text) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{3})?Z$/.test(text),
  "expected an RFC 3339 time in UTC",
);
const version = refine(string, (text) => /^[1-9][0-9]{0,17}$/.test(text), "expected a version");
const sheetId = refine(number, (n) => Number.isInteger(n) && n > 0, "expected a positive sheetId");

const rowNumber = refine(number, (n) => Number.isInteger(n) && n >= 1, "expected a row number");
const change: Validator<FixtureChange> = union(
  object({ kind: literal("set"), sheetId, cell: string, value: cell }),
  object({ kind: literal("sort"), sheetId, range: string, column: string }),
  object({ kind: literal("rename"), sheetId, title: string }),
  object({ kind: literal("insert"), sheetId, row: rowNumber }),
  object({ kind: literal("delete"), sheetId, row: rowNumber }),
);

const fixtureShape: Validator<SheetsFixture> = object({
  user: object({ displayName: string, emailAddress: string, permissionId: string }),
  spreadsheets: array(
    object({
      slug: refine(string, (s) => /^[a-z][a-z-]{0,30}$/.test(s), "expected a lowercase slug"),
      id: refine(string, (s) => /^[A-Za-z0-9_-]{20,64}$/.test(s), "expected a Drive file ID"),
      title: string,
      version,
      modifiedTime: time,
      canEdit: boolean,
      tabs: array(
        object({
          sheetId,
          title: string,
          grid: optional(object({ rows: number, columns: number })),
          frozenRows: optional(number),
          rows: array(array(cell)),
          merges: optional(array(string)),
          hiddenRows: optional(array(number)),
          hiddenColumns: optional(array(string)),
          filter: optional(object({ range: string, column: string, hiddenValues: array(string) })),
        }),
      ),
      comments: array(
        object({
          id: string,
          author: string,
          content: string,
          createdTime: time,
          deleted: optional(boolean),
          quoted: optional(string),
          anchor: optional(string),
          replies: optional(
            array(
              object({
                id: string,
                author: string,
                content: string,
                createdTime: time,
                action: optional(union(literal("resolve"), literal("reopen"))),
              }),
            ),
          ),
        }),
      ),
      later: array(object({ version, modifiedTime: time, changes: array(change) })),
    }),
  ),
});

// A new tab is 1000 rows by 26 columns; a bigger one fits its rows.
export function gridOf(tab: FixtureTab): { rows: number; columns: number } {
  return (
    tab.grid ?? {
      rows: Math.max(1000, tab.rows.length),
      columns: Math.max(26, ...tab.rows.map((row) => row.length)),
    }
  );
}

export function valueOf(cell: FixtureCell | undefined): FixtureValue | null {
  if (cell === null || cell === undefined) return null;
  return typeof cell === "object" ? (cell.value ?? null) : cell;
}

export function shown(cell: FixtureCell | undefined): string {
  const held = valueOf(cell);
  if (typeof cell === "object" && cell?.formatted !== undefined) return cell.formatted;
  if (held === null) return "";
  if (typeof held === "boolean") return held ? "TRUE" : "FALSE";
  return String(held);
}

const isEmpty = (cell: FixtureCell | undefined) =>
  cell === null ||
  cell === undefined ||
  (typeof cell === "object" && Object.keys(cell).length === 0);

export function within(bounds: Bounds, grid: { rows: number; columns: number }) {
  return {
    startRow: bounds.startRow ?? 0,
    endRow: Math.min(bounds.endRow ?? grid.rows, grid.rows),
    startColumn: bounds.startColumn ?? 0,
    endColumn: Math.min(bounds.endColumn ?? grid.columns, grid.columns),
  };
}

export type Box = ReturnType<typeof within>;
export const meets = (a: Box, b: Box) =>
  a.startRow < b.endRow &&
  b.startRow < a.endRow &&
  a.startColumn < b.endColumn &&
  b.startColumn < a.endColumn;

const sameTitle = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: false });
// Google's order for a sort: numbers, then text, then booleans, and empty
// cells last.
function compare(a: FixtureValue | null, b: FixtureValue | null): number {
  const rank = (v: FixtureValue | null) =>
    v === null ? 3 : typeof v === "number" ? 0 : typeof v === "string" ? 1 : 2;
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return collator.compare(a, b);
  return Number(a) - Number(b);
}

export function applyChange(spreadsheet: FixtureSpreadsheet, change: FixtureChange): string | null {
  const tab = spreadsheet.tabs.find((t) => t.sheetId === change.sheetId);
  if (!tab) return `no tab ${change.sheetId}`;
  const grid = gridOf(tab);
  const merges = (tab.merges ?? []).map((range) => within(parseBounds(range) ?? {}, grid));
  switch (change.kind) {
    case "rename": {
      const title = change.title;
      if (!titleFits(title)) return `"${title}" isn't a tab name`;
      if (spreadsheet.tabs.some((t) => t !== tab && sameTitle(t.title, title)))
        return `a tab is already called "${title}"`;
      tab.title = title;
      return null;
    }
    case "set": {
      const at = parseCell(change.cell);
      if (!at || at.row >= grid.rows || at.column >= grid.columns)
        return `${change.cell} isn't in the grid`;
      const under = merges.find(
        (m) =>
          meets(m, {
            startRow: at.row,
            endRow: at.row + 1,
            startColumn: at.column,
            endColumn: at.column + 1,
          }) &&
          (m.startRow !== at.row || m.startColumn !== at.column),
      );
      if (under) return `${change.cell} is inside a merge`;
      while (tab.rows.length <= at.row) tab.rows.push([]);
      const row = tab.rows[at.row] ?? [];
      while (row.length <= at.column) row.push(null);
      row[at.column] = change.value;
      return null;
    }
    case "insert":
    case "delete": {
      const at = change.row - 1;
      const inserting = change.kind === "insert";
      if (at > grid.rows || (!inserting && at === grid.rows))
        return `row ${change.row} isn't in the grid`;
      if (!inserting && grid.rows === 1) return "a tab keeps at least one row";
      const by = inserting ? 1 : -1;
      if (at < tab.rows.length) {
        if (inserting) tab.rows.splice(at, 0, []);
        else tab.rows.splice(at, 1);
      }
      while (tab.rows.length && (tab.rows.at(-1) ?? []).length === 0) tab.rows.pop();
      tab.grid = { rows: grid.rows + by, columns: grid.columns };
      const moved = (row: number) => (row > at || (inserting && row === at) ? row + by : row);
      const shift = (range: string): string | null => {
        const box = parseBounds(range);
        if (box?.startRow === undefined || box.endRow === undefined) return range;
        const start = moved(box.startRow);
        const end = box.endRow > at ? box.endRow + by : box.endRow;
        if (end <= start) return null;
        return rangeText({ ...box, startRow: start, endRow: end });
      };
      tab.merges = (tab.merges ?? []).flatMap((range) => {
        const next = shift(range);
        const box = next === null ? null : parseBounds(next);
        return next === null ||
          (box?.endRow ?? 0) -
            (box?.startRow ?? 0) +
            (box?.endColumn ?? 0) -
            (box?.startColumn ?? 0) <=
            2
          ? []
          : [next];
      });
      if (!tab.merges.length) delete tab.merges;
      tab.hiddenRows = (tab.hiddenRows ?? []).flatMap((n) =>
        !inserting && n - 1 === at ? [] : [moved(n - 1) + 1],
      );
      if (!tab.hiddenRows.length) delete tab.hiddenRows;
      if (tab.filter) {
        const range = shift(tab.filter.range);
        if (range === null) delete tab.filter;
        else tab.filter.range = range;
      }
      return null;
    }
    case "sort": {
      const bounds = parseBounds(change.range);
      const by = columnIndex(change.column);
      if (!bounds || by === null) return `${change.range} by ${change.column} isn't a sort`;
      const box = within(bounds, grid);
      if (by < box.startColumn || by >= box.endColumn) return `${change.column} isn't in the range`;
      if (merges.some((m) => meets(m, box))) return "a sorted range can't hold a merge";
      const rows = [];
      for (let r = box.startRow; r < box.endRow; r++) {
        const row = tab.rows[r] ?? [];
        rows.push(
          Array.from(
            { length: box.endColumn - box.startColumn },
            (_, c) => row[box.startColumn + c] ?? null,
          ),
        );
      }
      const sorted = rows.toSorted((a, b) =>
        compare(valueOf(a[by - box.startColumn]), valueOf(b[by - box.startColumn])),
      );
      sorted.forEach((cells, i) => {
        const r = box.startRow + i;
        while (tab.rows.length <= r) tab.rows.push([]);
        const row = tab.rows[r] ?? [];
        while (row.length < box.endColumn) row.push(null);
        row.splice(box.startColumn, cells.length, ...cells);
        tab.rows[r] = trimRow(row);
      });
      while (tab.rows.length && (tab.rows.at(-1) ?? []).length === 0) tab.rows.pop();
      return null;
    }
  }
}

const rangeText = (box: Bounds) =>
  `${columnLetters(box.startColumn ?? 0)}${(box.startRow ?? 0) + 1}:${box.endColumn === undefined ? "" : columnLetters(box.endColumn - 1)}${box.endRow ?? ""}`;

const trimRow = (row: FixtureCell[]) => {
  const out = [...row];
  while (out.length && isEmpty(out.at(-1))) out.pop();
  return out;
};

// Google's editor takes tab names of up to 100 characters.
const titleFits = (title: string) => title.trim() !== "" && [...title].length <= 100;

export function parseSheetsFixture(input: unknown): Result<SheetsFixture> {
  const shaped = fixtureShape(input);
  if (!shaped.ok) return shaped;
  const fixture = shaped.value;
  const issues: Issue[] = [];
  const unique = (values: string[], path: string, what: string) => {
    const seen = new Set<string>();
    values.forEach((v, i) => {
      if (seen.has(v)) issues.push({ path: `${path}[${i}]`, message: `${what} used twice` });
      seen.add(v);
    });
  };
  unique(
    fixture.spreadsheets.map((s) => s.id),
    "$.spreadsheets",
    "a file ID",
  );
  unique(
    fixture.spreadsheets.map((s) => s.slug),
    "$.spreadsheets",
    "a slug",
  );
  fixture.spreadsheets.forEach((spreadsheet, s) => {
    const at = `$.spreadsheets[${s}]`;
    unique(
      spreadsheet.tabs.map((t) => String(t.sheetId)),
      `${at}.tabs`,
      "a sheetId",
    );
    unique(
      spreadsheet.tabs.map((t) => t.title.toLowerCase()),
      `${at}.tabs`,
      "a tab name",
    );
    unique(
      spreadsheet.comments.flatMap((c) => [c.id, ...(c.replies ?? []).map((r) => r.id)]),
      `${at}.comments`,
      "a comment ID",
    );
    spreadsheet.tabs.forEach((tab, t) => {
      const path = `${at}.tabs[${t}]`;
      for (const problem of tabProblems(tab)) issues.push({ path, message: problem });
    });
    spreadsheet.comments.forEach((comment, c) => {
      if (comment.deleted && comment.content)
        issues.push({ path: `${at}.comments[${c}]`, message: "a deleted comment has no content" });
      if ((comment.replies ?? []).some((r) => r.createdTime < comment.createdTime))
        issues.push({
          path: `${at}.comments[${c}]`,
          message: "a reply must come after its comment",
        });
    });
    const copy = structuredClone(spreadsheet);
    let last = BigInt(spreadsheet.version);
    spreadsheet.later.forEach((next, v) => {
      const path = `${at}.later[${v}]`;
      if (BigInt(next.version) <= last)
        issues.push({ path, message: "a later version must be newer" });
      last = BigInt(next.version);
      next.changes.forEach((c, i) => {
        const problem = applyChange(copy, c);
        if (problem) issues.push({ path: `${path}.changes[${i}]`, message: problem });
      });
      for (const tab of copy.tabs)
        for (const problem of tabProblems(tab)) issues.push({ path, message: problem });
    });
  });
  return issues.length ? { ok: false, issues } : shaped;
}

function tabProblems(tab: FixtureTab): string[] {
  const problems: string[] = [];
  const grid = gridOf(tab);
  if (!titleFits(tab.title)) problems.push(`"${tab.title}" isn't a tab name`);
  if (tab.rows.length > grid.rows || tab.rows.some((row) => row.length > grid.columns))
    problems.push("its rows don't fit its grid");
  for (const row of tab.rows)
    for (const cell of row) {
      if (cell === null || typeof cell !== "object") continue;
      if (cell.formula !== undefined && (!cell.formula.startsWith("=") || cell.value === undefined))
        problems.push("a formula starts with = and has the value Google computed");
      if (cell.spilled && (cell.value === undefined || cell.formula !== undefined))
        problems.push("a spilled cell has a value and no formula of its own");
      if (cell.formatted !== undefined && typeof cell.value !== "number")
        problems.push("only a number is shown another way");
    }
  const boxes: Box[] = [];
  for (const range of tab.merges ?? []) {
    const bounds = parseBounds(range);
    const box = bounds && within(bounds, grid);
    if (!box || bounds.endRow === undefined || bounds.endColumn === undefined) {
      problems.push(`the merge ${range} isn't a range of cells`);
      continue;
    }
    if (box.endRow > grid.rows || box.endColumn > grid.columns)
      problems.push(`the merge ${range} is outside the grid`);
    if (boxes.some((other) => meets(other, box)))
      problems.push(`the merge ${range} overlaps another`);
    boxes.push(box);
    for (let r = box.startRow; r < box.endRow; r++)
      for (let c = box.startColumn; c < box.endColumn; c++)
        if ((r !== box.startRow || c !== box.startColumn) && !isEmpty(tab.rows[r]?.[c]))
          problems.push(`only the first cell of the merge ${range} holds anything`);
  }
  if ((tab.hiddenRows ?? []).some((n) => !Number.isInteger(n) || n < 1 || n > grid.rows))
    problems.push("a hidden row isn't in the grid");
  if (
    (tab.hiddenColumns ?? []).some((letters) => {
      const index = columnIndex(letters);
      return index === null || index >= grid.columns;
    })
  )
    problems.push("a hidden column isn't in the grid");
  if (tab.filter) {
    const bounds = parseBounds(tab.filter.range);
    const column = columnIndex(tab.filter.column);
    const box = bounds && within(bounds, grid);
    if (!box || column === null || column < box.startColumn || column >= box.endColumn)
      problems.push("the filter's column isn't in its range");
    else if (boxes.some((merge) => merge.endRow - merge.startRow > 1 && meets(merge, box)))
      problems.push("a filter can't cover a vertical merge");
  }
  if ((tab.frozenRows ?? 0) < 0 || (tab.frozenRows ?? 0) > grid.rows)
    problems.push("its frozen rows don't fit its grid");
  return problems;
}

export const sheetsFixtureDir = new URL("../../../fixtures/sheets/", import.meta.url);

type Account = { user: SheetsFixture["user"]; spreadsheets: string[] };

export function loadSheetsFixture(dir: URL = sheetsFixtureDir): SheetsFixture {
  const read = (name: string): unknown =>
    JSON.parse(readFileSync(new URL(`${name}.json`, dir), "utf8"));
  const account = read("account") as Account;
  const result = parseSheetsFixture({
    user: account.user,
    spreadsheets: (account.spreadsheets ?? []).map(read),
  });
  if (result.ok) return result.value;
  const issues = result.issues.map((issue) => `${issue.path}: ${issue.message}`);
  throw new Error(`invalid Sheets fixture:\n${issues.join("\n")}`);
}
