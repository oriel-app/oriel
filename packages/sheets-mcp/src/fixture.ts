// A set of spreadsheets held in memory, for `--fixture <file.json>` and for
// tests: each with its tabs, and each tab's cells as rows of strings, the
// first row first, with its notes and the rows and columns hidden by hand;
// and its comments. A tab's grid is at least 1,000 rows by 26 columns, as a
// new tab in Google's editor is, and grows to fit its rows.
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { columnIndex, parseCell } from "./a1.ts";

export type FixtureTab = {
  sheetId: number;
  title: string;
  // Rows frozen at the top, such as a header row.
  frozenRows?: number;
  rowCount?: number;
  columnCount?: number;
  rows: string[][];
  // Each note by its cell, such as `C3`.
  notes?: Record<string, string>;
  // Row numbers and column letters hidden by hand.
  hiddenRows?: number[];
  hiddenColumns?: string[];
};

export type FixtureReply = {
  author: string;
  content: string;
  // RFC 3339.
  createdTime: string;
  deleted?: boolean;
};

export type FixtureComment = FixtureReply & {
  resolved?: boolean;
  // The text the comment was made on.
  quoted?: string;
  replies?: FixtureReply[];
};

export type FixtureSpreadsheet = {
  id: string;
  name: string;
  // RFC 3339, as Drive writes it.
  modifiedTime: string;
  // False for a spreadsheet the account can only view.
  canEdit?: boolean;
  tabs: FixtureTab[];
  comments?: FixtureComment[];
};

export type Fixture = { spreadsheets: FixtureSpreadsheet[] };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown) => Number.isInteger(value) && (value as number) >= 0;
const isTime = (value: unknown) => typeof value === "string" && !Number.isNaN(Date.parse(value));

// What's wrong with a comment or a reply, or null when nothing is.
function saidProblem(value: unknown, at: string): string | null {
  if (!isObject(value)) return `${at} isn't an object`;
  if (typeof value.author !== "string") return `${at}.author isn't text`;
  if (typeof value.content !== "string") return `${at}.content isn't text`;
  if (!isTime(value.createdTime)) return `${at}.createdTime isn't an RFC 3339 time`;
  for (const name of ["deleted", "resolved"] as const)
    if (value[name] !== undefined && typeof value[name] !== "boolean")
      return `${at}.${name} isn't true or false`;
  if (value.quoted !== undefined && typeof value.quoted !== "string")
    return `${at}.quoted isn't text`;
  return null;
}

// What's wrong with a fixture, or null when nothing is.
export function fixtureProblem(value: unknown): string | null {
  if (!isObject(value) || !Array.isArray(value.spreadsheets))
    return "a fixture is an object with a `spreadsheets` list";
  const ids = new Set<string>();
  for (const [i, s] of value.spreadsheets.entries()) {
    const at = `spreadsheets[${i}]`;
    if (!isObject(s)) return `${at} isn't an object`;
    if (typeof s.id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(s.id))
      return `${at}.id is letters, digits, - and _`;
    if (ids.has(s.id)) return `${at}.id is another spreadsheet's too`;
    ids.add(s.id);
    if (typeof s.name !== "string") return `${at}.name isn't text`;
    if (typeof s.modifiedTime !== "string" || Number.isNaN(Date.parse(s.modifiedTime)))
      return `${at}.modifiedTime isn't an RFC 3339 time`;
    if (s.canEdit !== undefined && typeof s.canEdit !== "boolean")
      return `${at}.canEdit isn't true or false`;
    if (!Array.isArray(s.tabs) || s.tabs.length === 0) return `${at}.tabs is an empty list`;
    const titles = new Set<string>();
    const sheetIds = new Set<number>();
    for (const [j, t] of s.tabs.entries()) {
      const tabAt = `${at}.tabs[${j}]`;
      if (!isObject(t)) return `${tabAt} isn't an object`;
      if (!isCount(t.sheetId) || sheetIds.has(t.sheetId as number))
        return `${tabAt}.sheetId is a whole number of its own`;
      sheetIds.add(t.sheetId as number);
      if (typeof t.title !== "string" || t.title === "" || titles.has(t.title))
        return `${tabAt}.title is a name of its own`;
      titles.add(t.title);
      for (const name of ["frozenRows", "rowCount", "columnCount"] as const)
        if (t[name] !== undefined && !isCount(t[name])) return `${tabAt}.${name} isn't a count`;
      if (
        !Array.isArray(t.rows) ||
        !t.rows.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === "string"))
      )
        return `${tabAt}.rows isn't rows of text`;
      if (
        t.notes !== undefined &&
        (!isObject(t.notes) ||
          !Object.entries(t.notes).every(
            ([cell, note]) => parseCell(cell) && typeof note === "string",
          ))
      )
        return `${tabAt}.notes isn't text by cell, such as \`C3\``;
      if (
        t.hiddenRows !== undefined &&
        (!Array.isArray(t.hiddenRows) || !t.hiddenRows.every((n) => isCount(n) && n > 0))
      )
        return `${tabAt}.hiddenRows isn't row numbers`;
      if (
        t.hiddenColumns !== undefined &&
        (!Array.isArray(t.hiddenColumns) ||
          !t.hiddenColumns.every((c) => typeof c === "string" && columnIndex(c) !== null))
      )
        return `${tabAt}.hiddenColumns isn't column letters`;
    }
    if (s.comments !== undefined) {
      if (!Array.isArray(s.comments)) return `${at}.comments isn't a list`;
      for (const [k, c] of s.comments.entries()) {
        const commentAt = `${at}.comments[${k}]`;
        const problem = saidProblem(c, commentAt);
        if (problem) return problem;
        const replies = (c as Record<string, unknown>).replies;
        if (replies === undefined) continue;
        if (!Array.isArray(replies)) return `${commentAt}.replies isn't a list`;
        for (const [r, reply] of replies.entries()) {
          const replyProblem = saidProblem(reply, `${commentAt}.replies[${r}]`);
          if (replyProblem) return replyProblem;
        }
      }
    }
  }
  return null;
}

export function loadFixture(path: string): Fixture {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  const problem = fixtureProblem(value);
  if (problem) throw new Error(`The fixture ${path} isn't one: ${problem}.`);
  return value as Fixture;
}

// Writes a fixture whole beside it, then moves it over it, so a process
// reading it never sees half of one.
export function saveFixture(path: string, fixture: Fixture): void {
  const temporary = `${path}.${process.pid}.tmp`;
  // `wx` never follows a link left at the temporary name.
  rmSync(temporary, { force: true });
  writeFileSync(temporary, `${JSON.stringify(fixture, null, 2)}\n`, { flag: "wx" });
  renameSync(temporary, path);
}

export const minRows = 1000;
export const minColumns = 26;

export const gridOf = (tab: FixtureTab) => ({
  rows: Math.max(tab.rowCount ?? minRows, tab.rows.length),
  columns: Math.max(tab.columnCount ?? minColumns, ...tab.rows.map((row) => row.length)),
});
