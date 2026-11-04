// The Sheets fixture's shape (decision 0050, SPEC §8): spreadsheets written
// down, as Google keeps them, for unit tests, evals and the seed script. Each
// has its tabs, cells, notes, merges, hidden rows and columns, filter and
// comments, its Drive version, and the versions after it, each a list of
// changes. All names and content are made up.
//
// A cell is what a person entered: text, a number or a boolean, or an object
// for a formula (with the value Google computed), a note, or a number shown
// another way (a date is a number shown as one). Text starting with `=` is
// text; only `formula` is a formula. Rows and columns are as the sheet shows
// them: row 1 is the first, column A the first.
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
import { type Bounds, columnIndex, parseBounds, parseCell } from "./a1.ts";

export type FixtureValue = string | number | boolean;
export type FixtureCell =
  | FixtureValue
  | null
  | { value?: FixtureValue; formula?: string; formatted?: string; note?: string };

export type FixtureTab = {
  // Google's `sheetId`, which survives a rename.
  sheetId: number;
  title: string;
  // The grid's size, when it is bigger than its rows; a new tab's is 1000
  // rows by 26 columns.
  grid?: { rows: number; columns: number };
  frozenRows?: number;
  rows: FixtureCell[][];
  // Ranges such as `B2:B5`. Only a merge's first cell holds anything.
  merges?: string[];
  // Row numbers and column letters hidden by hand.
  hiddenRows?: number[];
  hiddenColumns?: string[];
  // A filter over `range`, its first row the header, hiding the rows whose
  // cell in `column` shows one of `hiddenValues`.
  filter?: { range: string; column: string; hiddenValues: string[] };
};

export type FixtureReply = {
  id: string;
  author: string;
  content: string;
  createdTime: string;
  // A reply can resolve its comment, or reopen it.
  action?: "resolve" | "reopen";
};

export type FixtureComment = {
  id: string;
  // A display name; the account's own is `user.displayName`.
  author: string;
  content: string;
  createdTime: string;
  // A deleted comment keeps no content.
  deleted?: boolean;
  // The text the comment was made on.
  quoted?: string;
  // Where the comment points: opaque, as Google keeps it.
  anchor?: string;
  replies?: FixtureReply[];
};

export type FixtureChange =
  | { kind: "set"; sheetId: number; cell: string; value: FixtureCell }
  // Rows of `range` sorted by `column`, A to Z, as a person sorts a range.
  | { kind: "sort"; sheetId: number; range: string; column: string }
  | { kind: "rename"; sheetId: number; title: string };

export type FixtureVersion = { version: string; modifiedTime: string; changes: FixtureChange[] };

export type FixtureSpreadsheet = {
  // What the seed script marks it with, to find it again.
  slug: string;
  // Its Drive file ID.
  id: string;
  title: string;
  // Drive's `version` and `modifiedTime` as the fixture starts.
  version: string;
  modifiedTime: string;
  // False for a spreadsheet the account can only view.
  canEdit: boolean;
  tabs: FixtureTab[];
  comments: FixtureComment[];
  // Later versions, oldest first.
  later: FixtureVersion[];
};

export type SheetsFixture = {
  // The signed-in account, as Drive's `about.user` has it.
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

const change: Validator<FixtureChange> = union(
  object({ kind: literal("set"), sheetId, cell: string, value: cell }),
  object({ kind: literal("sort"), sheetId, range: string, column: string }),
  object({ kind: literal("rename"), sheetId, title: string }),
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

// What the cell holds, when it holds a value: a formula's is what Google
// computed.
export function valueOf(cell: FixtureCell | undefined): FixtureValue | null {
  if (cell === null || cell === undefined) return null;
  return typeof cell === "object" ? (cell.value ?? null) : cell;
}

// The cell as the sheet shows it.
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

// A range's bounds closed to the grid.
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

// Makes one change to a spreadsheet, as a person would in Google's editor.
// Returns why it can't be made, changing nothing.
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

const trimRow = (row: FixtureCell[]) => {
  const out = [...row];
  while (out.length && isEmpty(out.at(-1))) out.pop();
  return out;
};

// Google's editor takes tab names of up to 100 characters.
const titleFits = (title: string) => title.trim() !== "" && [...title].length <= 100;

// The shape, then what Google itself guarantees: IDs and tab names unique, a
// merge's other cells empty, everything inside its grid, and each later
// version newer and made of changes Google's editor could make.
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
  }
  if ((tab.frozenRows ?? 0) < 0 || (tab.frozenRows ?? 0) > grid.rows)
    problems.push("its frozen rows don't fit its grid");
  return problems;
}
