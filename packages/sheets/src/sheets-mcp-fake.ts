// A fake of packages/sheets-mcp's tools over one spreadsheet held in memory,
// for tests of the parser and the writer through it (OA-279): its answers
// in the shapes the server gives, as `fixtures/sheets-mcp/` records them.
// Every call is kept, so a test can say which were made.
import type { ToolAnswer, ToolCall, ToolCaller } from "@oriel/core";
import { columnLetters, parseRange, quoteTab } from "./a1.ts";

export const fakeId = "1FakeSheetsMcpBacklog00";

export type FakeServer = {
  // The tab's rows as text, as the sheet shows them; a cell's formula, by
  // `<row>,<column>` 0-based, shows here as its result.
  rows: string[][];
  formulas: Map<string, string>;
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
        return answer({ range: args.range, values, truncated: false });
      }
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
        // After the table that starts at the range's first row.
        let at = range.bounds.startRow ?? 0;
        while (server.rows[at]?.some((cell) => cell !== "")) at += 1;
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
