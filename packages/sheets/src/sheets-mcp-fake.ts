// A fake of packages/sheets-mcp's tools over one spreadsheet held in memory,
// for tests of the parser and the writer through it (OA-279): its answers
// in the shapes the server gives, as `fixtures/sheets-mcp/` records them.
// Every call is kept, so a test can say which were made.
import type { ToolAnswer, ToolCall, ToolCaller } from "@oriel/core";
import { columnIndex, columnLetters, parseRange, quoteTab } from "./a1.ts";
import { type FixtureCell, shown, valueOf } from "./fixture.ts";
import type { StandIn } from "./stand-in.ts";

export const fakeId = "1FakeSheetsMcpBacklog00";

export type FakeServer = {
  // The tab's rows as text, as the sheet shows them; a cell's formula, by
  // `<row>,<column>` 0-based, shows here as its result.
  rows: string[][];
  // Each cell as entered, where it isn't its text: a formula, or a number.
  formulas: Map<string, string | number | boolean>;
  // Each cell's note, by `<row>,<column>` 0-based; the rows and columns
  // hidden by hand, 0-based; and the comments, as `list_comments` gives
  // them.
  notes: Map<string, string>;
  hiddenRows: Set<number>;
  hiddenColumns: Set<number>;
  comments: Record<string, unknown>[];
  calls: ToolCall[];
  read: ToolCaller;
  write: ToolCaller;
};

const answer = (body: unknown): ToolAnswer => ({
  content: [{ type: "text", text: JSON.stringify(body) }],
  structuredContent: body,
});
const failed = (text: string): ToolAnswer => ({ content: [{ type: "text", text }], isError: true });

export function fakeServer(rows: string[][], title = "Backlog"): FakeServer {
  const server: FakeServer = {
    rows: rows.map((row) => [...row]),
    formulas: new Map(),
    notes: new Map(),
    hiddenRows: new Set(),
    hiddenColumns: new Set(),
    comments: [],
    calls: [],
    read: async (call) => {
      server.calls.push(call);
      const { tool, args } = call;
      if (args.spreadsheetId !== undefined && args.spreadsheetId !== fakeId)
        return failed("Google found no spreadsheet with that ID that this account can open.");
      if (tool === "get_spreadsheet")
        return answer({
          id: fakeId,
          title: "Product backlog",
          url: "",
          tabs: [
            {
              sheetId: 0,
              title,
              index: 0,
              rowCount: 1000,
              columnCount: 6,
              frozenRowCount: 1,
            },
          ],
        });
      if (tool === "list_spreadsheets")
        return answer({
          spreadsheets: [
            {
              id: fakeId,
              name: "Product backlog",
              modifiedTime: "2026-11-05T12:00:00.000Z",
              url: "",
            },
          ],
        });
      if (tool === "read_range") {
        const range = parseRange(String(args.range));
        const start = range?.bounds?.startRow ?? 0;
        const end = range?.bounds?.endRow ?? server.rows.length;
        const formula = args.valueRenderOption === "FORMULA";
        const values = server.rows
          .slice(start, end)
          .map((row, r) =>
            row.map((cell, c) =>
              formula ? (server.formulas.get(`${start + r},${c}`) ?? cell) : cell,
            ),
          );
        // As Google leaves them out: empty cells at a row's end, and empty
        // rows at the end.
        for (const row of values) while (row.length && row.at(-1) === "") row.pop();
        while (values.length && values.at(-1)?.length === 0) values.pop();
        if (args.includeGrid !== true)
          return answer({ range: args.range, values, truncated: false });
        const inside = (row: number) => row >= start && row < start + values.length;
        return answer({
          range: args.range,
          values,
          truncated: false,
          hiddenRows: [...server.hiddenRows].filter(inside).map((row) => row + 1),
          hiddenColumns: [...server.hiddenColumns].map(columnLetters),
          notes: [...server.notes]
            .map(([at, note]) => {
              const [row = 0, column = 0] = at.split(",").map(Number);
              return { row, column, note };
            })
            .filter((each) => inside(each.row))
            .map(({ row, column, note }) => ({ cell: `${columnLetters(column)}${row + 1}`, note })),
        });
      }
      if (tool === "list_comments") return answer({ comments: server.comments });
      throw new Error(`the fake has no read tool ${tool}`);
    },
    write: async (call) => {
      server.calls.push(call);
      const { tool, args } = call;
      const values = args.values as (string | number | boolean | null)[][];
      const range = parseRange(String(args.range));
      if (!range?.bounds) return failed("`range` isn't A1 notation.");
      const text = (value: unknown) => (value === null ? "" : String(value));
      if (tool === "update_range") {
        const row = range.bounds.startRow ?? 0;
        const column = range.bounds.startColumn ?? 0;
        const target = (server.rows[row] ??= []);
        while (target.length <= column) target.push("");
        target[column] = text(values[0]?.[0]);
        server.formulas.delete(`${row},${column}`);
        return answer({
          updatedRange: `${quoteTab(title)}!${columnLetters(column)}${row + 1}`,
          updatedRows: 1,
          updatedColumns: 1,
          updatedCells: 1,
        });
      }
      if (tool === "append_rows") {
        // After the table that starts at the range's first row, within it,
        // as Google's append finds it.
        const end = range.bounds.endRow ?? Infinity;
        let at = range.bounds.startRow ?? 0;
        while (at < end && server.rows[at]?.some((cell) => cell !== "")) at += 1;
        server.rows.splice(at, 0, (values[0] ?? []).map(text));
        return answer({
          tableRange: String(args.range),
          updatedRange: `${quoteTab(title)}!A${at + 1}:${columnLetters((values[0]?.length ?? 1) - 1)}${at + 1}`,
          updatedRows: 1,
          updatedColumns: values[0]?.length ?? 0,
          updatedCells: values[0]?.length ?? 0,
        });
      }
      throw new Error(`the fake has no write tool ${tool}`);
    },
  };
  return server;
}

// The Backlog tab, as a person maps it.
export const fakePicks = {
  spreadsheets: [
    {
      id: fakeId,
      tabs: [
        {
          sheetId: 0,
          header: 1,
          end: "blank" as const,
          hidden: false,
          key: "Key",
          title: "Title",
          status: "Status",
          states: { todo: ["To do"], "in-progress": ["In progress"], done: ["Done"] },
          estimate: "Estimate",
        },
      ],
    },
  ],
};

export const fakeRows = (): string[][] => [
  ["Key", "Title", "Status", "Estimate", "Total"],
  ["BL-1", "Sign-in remembers the email", "Done", "2", "2"],
  ["BL-2", "Export as CSV", "To do", "3", "5"],
  ["BL-3", "=Not a formula, as text", "In progress", "", "5"],
];

// packages/sheets-mcp's read tools over the Sheets fixture's stand-in for
// Google, for the spreadsheets `ids` names, as the server answers them for
// its account: for tests of a connection through it to the fixture's
// spreadsheets, where a test changes them as a person would (OA-280).
// Nothing here signs in: the server's sign-in is its own. Every call is
// kept.
export function fixtureServer(
  standIn: StandIn,
  ids: readonly string[],
): { read: ToolCaller; calls: ToolCall[] } {
  const calls: ToolCall[] = [];
  const entered = (cell: FixtureCell | undefined): string | number | boolean => {
    if (typeof cell === "object" && cell?.formula !== undefined) return cell.formula;
    if (typeof cell === "object" && cell?.spilled) return "";
    return valueOf(cell) ?? "";
  };
  const read: ToolCaller = async (call) => {
    calls.push(call);
    const { tool, args } = call;
    if (tool === "list_spreadsheets") {
      const query = typeof args.query === "string" ? args.query.toLowerCase() : "";
      return answer({
        spreadsheets: ids
          .map((id) => standIn.spreadsheet(id))
          .filter((each) => each.title.toLowerCase().includes(query))
          .map((each) => ({
            id: each.id,
            name: each.title,
            modifiedTime: each.modifiedTime,
            url: "",
          })),
      });
    }
    const id = String(args.spreadsheetId ?? "");
    if (!ids.includes(id))
      return failed("Google found no spreadsheet with that ID that this account can open.");
    const spreadsheet = standIn.spreadsheet(id);
    if (tool === "get_spreadsheet")
      return answer({
        id,
        title: spreadsheet.title,
        url: "",
        tabs: spreadsheet.tabs.map((tab, index) => ({
          sheetId: tab.sheetId,
          title: tab.title,
          index,
          rowCount: tab.grid?.rows ?? tab.rows.length,
          columnCount: tab.grid?.columns ?? Math.max(1, ...tab.rows.map((row) => row.length)),
          frozenRowCount: tab.frozenRows ?? 0,
        })),
      });
    if (tool === "read_range") {
      const range = parseRange(String(args.range));
      const tab = spreadsheet.tabs.find((each) => each.title === range?.tab);
      if (!range || !tab) return failed("`range` names no tab of that spreadsheet.");
      const start = range.bounds?.startRow ?? 0;
      const end = Math.min(range.bounds?.endRow ?? tab.rows.length, tab.rows.length);
      const formula = args.valueRenderOption === "FORMULA";
      const values = tab.rows
        .slice(start, end)
        .map((row) => row.map((cell) => (formula ? entered(cell) : shown(cell))));
      // As Google leaves them out: empty cells at a row's end, and empty
      // rows at the end.
      for (const row of values) while (row.length && row.at(-1) === "") row.pop();
      while (values.length && values.at(-1)?.length === 0) values.pop();
      if (args.includeGrid !== true) return answer({ range: args.range, values, truncated: false });
      const inside = (row: number) => row >= start && row < end;
      return answer({
        range: args.range,
        values,
        truncated: false,
        hiddenRows: (tab.hiddenRows ?? []).filter((row) => inside(row - 1)),
        hiddenColumns: (tab.hiddenColumns ?? []).filter((letters) => columnIndex(letters) !== null),
        notes: tab.rows.flatMap((row, r) =>
          inside(r)
            ? row.flatMap((cell, c) =>
                typeof cell === "object" && cell?.note !== undefined
                  ? [{ cell: `${columnLetters(c)}${r + 1}`, note: cell.note }]
                  : [],
              )
            : [],
        ),
      });
    }
    if (tool === "list_comments")
      return answer({
        comments: spreadsheet.comments
          .filter((each) => !each.deleted)
          .map((each) => ({
            author: each.author,
            createdTime: each.createdTime,
            content: each.content,
            // Resolved by its last reply that resolved or reopened it.
            resolved: (each.replies ?? []).reduce(
              (was, reply) =>
                reply.action === "resolve" ? true : reply.action === "reopen" ? false : was,
              false,
            ),
            ...(each.quoted === undefined ? {} : { quoted: each.quoted }),
            replies: (each.replies ?? []).map((reply) => ({
              author: reply.author,
              createdTime: reply.createdTime,
              content: reply.content,
            })),
          })),
      });
    throw new Error(`the fake has no read tool ${tool}`);
  };
  return { read, calls };
}
