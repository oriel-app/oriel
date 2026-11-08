// Google Sheets through packages/sheets-mcp (decision 0059, OA-279): the
// entry Oriel knows the server by, and the parser, both ways. From its tool
// results, the reads a sync, a preview and the writer make (`Google`, as
// google.ts gives them over Google's own APIs); from each captured
// mutation, its write call. Nothing here imports the server: it's a program
// the person's agent runs, and Oriel reads only what its tools answer.
//
// It reads what the direct read does: each cell as it shows, with its
// note, the rows and columns hidden by hand (`read_range` with
// `includeGrid`), and the spreadsheet's comments with their replies
// (`list_comments`), at most as many as google.ts reads. A sign-in that
// wasn't given Drive's read scope can't list comments: then it has none,
// as before. What the tools don't give, Oriel does without: no merges, and
// no Drive version, so a spreadsheet's last change, from its listing,
// stands for it. No tool deletes a row, so a row added through it can't be
// taken back (`unsendable` in writer.ts). An answer it can't read stops
// the sync, naming the server (`ServerUnreadable`): the index stays as it
// was. Every string it gives is the spreadsheet's content, and goes only
// into an item's text.
import { fileURLToPath } from "node:url";
import {
  answerJson,
  answerText,
  narrowed,
  type PickChoice,
  ServerUnreadable,
  SourceRefused,
  type SourceServer,
  type ToolAnswer,
  type ToolCaller,
  WriteStalled,
} from "@oriel/core";
import { columnIndex, columnLetters, parseCell, parseRange, quoteTab } from "./a1.ts";
import {
  type DriveFile,
  type Google,
  type SheetComment,
  SheetsError,
  type TabInfo,
} from "./google.ts";
import { sheetsPicks } from "./mapping.ts";
import type { CellValue } from "./requests.ts";
import { maxSpreadsheets } from "./source.ts";
import type { Cell, Entered, Grid } from "./table.ts";

// Its tools Oriel calls, by what each does.
export const sheetsTools = {
  list: "list_spreadsheets",
  get: "get_spreadsheet",
  read: "read_range",
  comments: "list_comments",
  update: "update_range",
  append: "append_rows",
} as const;

const t = sheetsTools;

// Where this checkout's server is: the command its README adds it to an
// agent with, which is how Oriel knows it, and the only command Claude
// Code may start it by. A person's agent that runs it from anywhere else,
// or with other arguments, isn't running this one.
export const sheetsMcpMain = fileURLToPath(
  new URL("../../sheets-mcp/src/main.ts", import.meta.url),
);

// Oriel's own Sheets server, as Oriel knows it: by its command, since a
// local server can report any name.
export const sheetsServer: SourceServer = {
  name: "sheets-mcp",
  reports: "sheets-mcp",
  at: { command: `node ${sheetsMcpMain}` },
  reads: [t.list, t.get, t.read, t.comments],
  writes: [t.update, t.append],
  instructions: "https://github.com/oriel-app/oriel/blob/main/packages/sheets-mcp/README.md",
  keepsOptions: true,
  // The spreadsheets a connection reads, from those the server lists, most
  // lately changed first, by ID, so a renamed one stays picked. One kept
  // keeps how its tabs read; one picked anew reads none of its tabs yet, so
  // the connection waits for how to read them (decision 0051).
  picks: [
    {
      name: "spreadsheets",
      label: "Spreadsheets",
      many: true,
      most: maxSpreadsheets,
      unpicked: "no spreadsheet yet",
      list: async (read, query) => narrowed(await listedSpreadsheets(read, query), query),
      picked: (options) => picksIn(options).map((pick) => pick.id),
      into: (options, values) => {
        const had = picksIn(options);
        return [...new Set(values)].map(
          (id) => had.find((pick) => pick.id === id) ?? { id, tabs: [] },
        );
      },
    },
  ],
};

// The spreadsheets a connection's options pick, or none.
const picksIn = (options: Readonly<Record<string, unknown>>) => {
  const read = sheetsPicks(options);
  return read.ok ? read.value.spreadsheets : [];
};

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const count = (value: unknown): number | null =>
  Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null;

// The server's words when it isn't signed in to Google, which only say
// that, and are never passed on.
const signedOut = (words: string) =>
  /\b(not signed in|sign-in expired|refused the sign-in|sheets-mcp login)\b/i.test(words);
// When its sign-in wasn't given the scope a read needs, as Drive's for
// comments.
const unscoped = (words: string) => /\bwasn't given the permission\b/i.test(words);
// When it can't find, or can't open, the spreadsheet.
const missing = (words: string) => /\bfound no spreadsheet\b|\bnot found\b/i.test(words);
// Its words for a write it, or Google, turned away unmade: an argument it
// checked, a sign-in, a permission, or a request to slow down. Its others,
// such as Google not answering, may come after the write landed.
const turnedAway = (words: string) =>
  !/\b(couldn't reach|didn't answer|isn't one this server reads)\b/i.test(words) &&
  (signedOut(words) ||
    missing(words) ||
    /\b(refused|can't open or change|must be|isn't A1|too many requests|hasn't turned on|write at most)\b/i.test(
      words,
    ));

// A tool's answer as JSON, or its words when it failed. Its words only
// tell what kind of failure it was.
function bodyOf(tool: string, answer: ToolAnswer): { failed: string } | { body: unknown } {
  if (!isObject(answer) || !Array.isArray(answer.content))
    throw new ServerUnreadable(`${tool} answered with no content`);
  if (answer.isError === true) return { failed: answerText(answer) };
  return { body: answerJson(tool, answer) };
}

// A read's answer, or "gone" when the server says the spreadsheet isn't
// one it can open, or that its sign-in can't read its comments. Not signed
// in is the whole server's, as Google's own 401 is (google.ts).
async function readOf(read: ToolCaller, tool: string, args: Json): Promise<Json | "gone"> {
  const answer = bodyOf(tool, await read({ tool, args }));
  if ("failed" in answer) {
    if (signedOut(answer.failed))
      throw new SheetsError(`${sheetsServer.name} isn't signed in to Google`, 401);
    if (missing(answer.failed)) return "gone";
    // Comments the sign-in can't read are none, as they were before.
    if (tool === t.comments && unscoped(answer.failed)) return "gone";
    throw new ServerUnreadable(`${tool} answered with an error`);
  }
  if (!isObject(answer.body)) throw new ServerUnreadable(`${tool} answered with no object`);
  return answer.body;
}

export type ServerSpreadsheet = { title: string; tabs: TabInfo[] };

// `get_spreadsheet`'s answer: its title and its tabs.
export function readSpreadsheet(body: Json): ServerSpreadsheet {
  const unreadable = () => new ServerUnreadable(`${t.get} gave a spreadsheet Oriel can't read`);
  const title = text(body.title);
  if (title === null || !Array.isArray(body.tabs)) throw unreadable();
  const tabs = body.tabs.map((tab): TabInfo => {
    if (!isObject(tab)) throw unreadable();
    const sheetId = count(tab.sheetId);
    const name = text(tab.title);
    const rows = count(tab.rowCount);
    const columns = count(tab.columnCount);
    if (sheetId === null || name === null || name === "" || rows === null || columns === null)
      throw unreadable();
    return { sheetId, title: name, rows, columns };
  });
  return { title, tabs };
}

type Scalar = string | number | boolean;
const isScalar = (cell: unknown): cell is Scalar =>
  typeof cell === "string" ||
  typeof cell === "boolean" ||
  (typeof cell === "number" && Number.isFinite(cell));

// What `includeGrid` adds: rows hidden by hand, 0-based, columns hidden by
// hand, 0-based, and each note by its 0-based row and column.
export type ServerGrid = {
  hiddenRows: number[];
  hiddenColumns: number[];
  notes: { row: number; column: number; note: string }[];
};

// `read_range`'s answer: its rows, of text as shown, or with FORMULA, of
// text, numbers and true/false as entered, and where to read on when it
// was cut; with `grid`, what `includeGrid` adds, which must be there.
export function readValues(
  body: Json,
  grid = false,
): {
  values: Scalar[][];
  next: string | null;
  truncated: boolean;
  grid: ServerGrid | null;
} {
  const unreadable = () => new ServerUnreadable(`${t.read} gave cells Oriel can't read`);
  const values = body.values;
  if (
    !Array.isArray(values) ||
    !values.every((row) => Array.isArray(row) && row.every(isScalar)) ||
    typeof body.truncated !== "boolean"
  )
    throw unreadable();
  const read = {
    values: values as Scalar[][],
    next: text(body.nextRange),
    truncated: body.truncated,
  };
  if (!grid) return { ...read, grid: null };
  const { hiddenRows, hiddenColumns, notes } = body;
  if (!Array.isArray(hiddenRows) || !Array.isArray(hiddenColumns) || !Array.isArray(notes))
    throw unreadable();
  return {
    ...read,
    grid: {
      hiddenRows: hiddenRows.map((n) => {
        if (count(n) === null || n < 1) throw unreadable();
        return n - 1;
      }),
      hiddenColumns: hiddenColumns.map((letters) => {
        const column = typeof letters === "string" ? columnIndex(letters) : null;
        if (column === null) throw unreadable();
        return column;
      }),
      notes: notes.map((each) => {
        const cell = isObject(each) && typeof each.cell === "string" ? parseCell(each.cell) : null;
        const note = isObject(each) ? text(each.note) : null;
        if (cell === null || note === null) throw unreadable();
        return { ...cell, note };
      }),
    },
  };
}

// `list_comments`' answer: its comments, each with its replies, and the
// page after it.
export function readComments(body: Json): { comments: SheetComment[]; next: string | null } {
  const unreadable = () => new ServerUnreadable(`${t.comments} gave comments Oriel can't read`);
  const said = (each: unknown) => {
    if (!isObject(each)) throw unreadable();
    const author = text(each.author);
    const at = text(each.createdTime);
    const content = text(each.content);
    if (author === null || at === null || content === null) throw unreadable();
    return { author: author || "Someone", at, text: content };
  };
  if (!Array.isArray(body.comments)) throw unreadable();
  const comments = body.comments.map((each): SheetComment => {
    const comment = said(each);
    const { resolved, quoted, replies } = each as Json;
    if (typeof resolved !== "boolean" || !Array.isArray(replies)) throw unreadable();
    if (quoted !== undefined && typeof quoted !== "string") throw unreadable();
    return { ...comment, resolved, quoted: quoted ?? null, replies: replies.map(said) };
  });
  return { comments, next: text(body.nextPageToken) };
}

// A cell as entered, from the server's FORMULA rendering: a formula is
// text that starts with `=`; a number or true/false is itself; a cell a
// formula elsewhere fills is empty.
const enteredOf = (held: Scalar | undefined): Entered =>
  held === undefined || held === ""
    ? null
    : typeof held === "string" && held.startsWith("=")
      ? { formula: held }
      : held;

// How many spreadsheets one listing asks for, and the most pages a sync
// reads to find one spreadsheet's last change, or its comments.
const listPage = 100;
const mostPages = 5;

// The reads a Sheets connection makes, through the server's read tools,
// as google.ts makes them of Google.
export function serverGoogle(read: ToolCaller): Google {
  // A spreadsheet `file` just read, which the `tabs` after it uses once.
  const fresh = new Map<string, ServerSpreadsheet>();

  const spreadsheet = async (id: string): Promise<ServerSpreadsheet | "gone"> => {
    const got = await readOf(read, t.get, { spreadsheetId: id });
    return got === "gone" ? got : readSpreadsheet(got);
  };

  // Its last change, from the listing of spreadsheets named like it, or
  // null when the listing doesn't hold it.
  const modified = async (id: string, title: string): Promise<string | null> => {
    let pageToken: string | null = null;
    for (let page = 0; page < mostPages; page += 1) {
      const got = await readOf(read, t.list, {
        query: title,
        pageSize: listPage,
        ...(pageToken ? { pageToken } : {}),
      });
      if (got === "gone" || !Array.isArray(got.spreadsheets))
        throw new ServerUnreadable(`${t.list} gave no spreadsheets`);
      for (const each of got.spreadsheets) {
        if (!isObject(each)) throw new ServerUnreadable(`${t.list} gave a spreadsheet it can't`);
        const at = text(each.modifiedTime);
        if (each.id === id && at !== null && Number.isFinite(Date.parse(at))) return at;
      }
      pageToken = text(got.nextPageToken);
      if (!pageToken) return null;
    }
    return null;
  };

  // Rows `start` to `end` (0-based, end exclusive) of a tab, every column,
  // rendered one way, read on while the server cuts them: as shown, with
  // the grid, and as entered, without.
  const values = async (
    id: string,
    tab: TabInfo,
    start: number,
    end: number,
    render: "FORMATTED_VALUE" | "FORMULA",
  ): Promise<{ rows: Scalar[][]; grid: ServerGrid }> => {
    const last = columnLetters(Math.max(tab.columns, 1) - 1);
    const rows: Scalar[][] = [];
    const grid: ServerGrid = { hiddenRows: [], hiddenColumns: [], notes: [] };
    const shown = render === "FORMATTED_VALUE";
    let range = `${quoteTab(tab.title)}!A${start + 1}:${last}${end}`;
    for (;;) {
      const got = await readOf(read, t.read, {
        spreadsheetId: id,
        range,
        ...(shown ? { includeGrid: true } : { valueRenderOption: render }),
      });
      if (got === "gone") throw new SheetsError(`${t.read} lost the spreadsheet`, 404);
      const answer = readValues(got, shown);
      rows.push(...answer.values);
      if (answer.grid) {
        // Only what's inside the rows and columns asked for.
        const inside = (row: number) => row >= start && row < end;
        const across = (column: number) => column >= 0 && column < Math.max(tab.columns, 1);
        if (
          !answer.grid.hiddenRows.every(inside) ||
          !answer.grid.hiddenColumns.every(across) ||
          !answer.grid.notes.every((each) => inside(each.row) && across(each.column))
        )
          throw new ServerUnreadable(`${t.read} gave a grid outside the cells it read`);
        grid.hiddenRows.push(...answer.grid.hiddenRows);
        grid.hiddenColumns.push(...answer.grid.hiddenColumns);
        grid.notes.push(...answer.grid.notes);
      }
      if (!answer.truncated) return { rows, grid };
      // Read on from the row after the last it gave, and from nowhere else.
      const next = answer.next === null ? null : parseRange(answer.next);
      if (next?.tab !== tab.title || next.bounds?.startRow !== start + rows.length)
        throw new ServerUnreadable(`${t.read} cut a tab's rows with no way on to the rest`);
      range = answer.next as string;
    }
  };

  return {
    // Its name and last change, which stands for its version. Whether the
    // person may edit it, the server doesn't say: a write it can't make
    // comes back refused.
    async file(id): Promise<DriveFile | "gone"> {
      const got = await spreadsheet(id);
      if (got === "gone") return got;
      fresh.set(id, got);
      const at = await modified(id, got.title);
      return {
        name: got.title,
        // No version the listing gives is one it can't tell from the next,
        // so it's read in full every time.
        version: at ?? "",
        modifiedTime: at ?? "",
        canEdit: true,
        trashed: false,
      };
    },
    // Its comments with their replies, oldest first, at most `most`, as
    // google.ts reads them; none when the sign-in can't read them.
    async comments(id, most = 200): Promise<SheetComment[]> {
      const found: SheetComment[] = [];
      let pageToken: string | null = null;
      for (let page = 0; page < mostPages && found.length < most; page += 1) {
        const got = await readOf(read, t.comments, {
          spreadsheetId: id,
          pageSize: listPage,
          ...(pageToken ? { pageToken } : {}),
        });
        if (got === "gone") return found;
        const answer = readComments(got);
        found.push(...answer.comments);
        pageToken = answer.next;
        if (!pageToken) break;
      }
      return found.slice(0, most);
    },
    async tabs(id) {
      const held = fresh.get(id);
      fresh.delete(id);
      return held ?? spreadsheet(id);
    },
    // Cells as shown, with their notes and the rows and columns hidden by
    // hand, and with `entered`, as entered too. No merges: the server
    // doesn't give them.
    async rows(id, tab, start, end, entered = false): Promise<Grid | "gone"> {
      const { rows: shown, grid } = await values(id, tab, start, end, "FORMATTED_VALUE");
      const formulas = entered ? (await values(id, tab, start, end, "FORMULA")).rows : [];
      const notes = new Map(grid.notes.map((each) => [`${each.row},${each.column}`, each.note]));
      // A note on a cell past a row's last value, or in an empty row past
      // the last, makes that cell one too, as Google's grid has it.
      const height = Math.max(
        shown.length,
        formulas.length,
        ...grid.notes.map((each) => each.row - start + 1),
      );
      const rows: (Cell | null)[][] = Array.from({ length: height }, (_, r) => {
        const width = Math.max(
          shown[r]?.length ?? 0,
          formulas[r]?.length ?? 0,
          ...grid.notes.filter((each) => each.row - start === r).map((each) => each.column + 1),
        );
        return Array.from({ length: width }, (_, c) => {
          const value = String(shown[r]?.[c] ?? "");
          const note = notes.get(`${start + r},${c}`) ?? null;
          const held = entered ? { entered: enteredOf(formulas[r]?.[c]) } : {};
          return value === "" && note === null && !held.entered
            ? null
            : { shown: value, number: null, note, ...held };
        });
      });
      return {
        startRow: start,
        rows,
        hiddenRows: new Set(grid.hiddenRows),
        hiddenColumns: new Set(grid.hiddenColumns),
        merges: [],
      };
    },
  };
}

// The person's most recently changed spreadsheets, by ID, at most `most`.
// The spreadsheets the server lists, whose names `query` narrows, a page
// of 100 at a time, at most 10 pages: each by its ID, its name and when it
// last changed. Its names are source content, which a picker draws as text.
async function listedSpreadsheets(
  read: ToolCaller,
  query: string,
): Promise<(Pick<PickChoice, "value" | "name"> & Partial<PickChoice>)[]> {
  const listed: { value: string; name: string; updatedAt: string | null }[] = [];
  const tokens = new Set<string>();
  let pageToken = "";
  for (let page = 0; page < 10; page++) {
    const got = await readOf(read, t.list, {
      pageSize: 100,
      ...(query.trim() ? { query: query.trim() } : {}),
      ...(pageToken ? { pageToken } : {}),
    });
    if (got === "gone" || !Array.isArray(got.spreadsheets))
      throw new ServerUnreadable(`${t.list} gave no spreadsheets`);
    for (const each of got.spreadsheets as unknown[]) {
      if (!isObject(each)) continue;
      const id = text(each.id);
      if (id === null || !/^[A-Za-z0-9_-]{10,100}$/.test(id)) continue;
      listed.push({ value: id, name: text(each.name) ?? id, updatedAt: text(each.modifiedTime) });
    }
    pageToken = text(got.nextPageToken) ?? "";
    if (!pageToken || tokens.has(pageToken)) break;
    tokens.add(pageToken);
  }
  return listed;
}

export async function recentSpreadsheets(read: ToolCaller, most: number): Promise<string[]> {
  const got = await readOf(read, t.list, { pageSize: most });
  if (got === "gone" || !Array.isArray(got.spreadsheets))
    throw new ServerUnreadable(`${t.list} gave no spreadsheets`);
  return got.spreadsheets.slice(0, most).map((each) => {
    const id = isObject(each) ? text(each.id) : null;
    if (id === null || !/^[A-Za-z0-9_-]{10,100}$/.test(id))
      throw new ServerUnreadable(`${t.list} gave a spreadsheet Oriel can't read`);
    return id;
  });
}

// What a write's answer says it wrote: the range, whose first row is where
// the values went.
function writtenRow(tool: string, body: unknown): number {
  const range = isObject(body) ? text(body.updatedRange) : null;
  const row = range === null ? undefined : parseRange(range)?.bounds?.startRow;
  if (row === undefined) throw new Error(`${tool} didn't say where it wrote, and may have`);
  return row;
}

// The server's writes, from the process with only its write tools, values
// only: `RAW`, so text that looks like a formula stays text. An answer that
// says it turned the write away is a refusal, with nothing written; any
// other failure may have landed.
export function serverWrites(write: ToolCaller) {
  const send = async (tool: string, args: Json): Promise<unknown> => {
    let answer: ToolAnswer;
    try {
      answer = await write({ tool, args: { ...args, valueInputOption: "RAW" } });
    } catch (error) {
      // Never sent, or turned away unprocessed: none of it landed.
      if (error instanceof WriteStalled)
        throw new SourceRefused(error.message, { sent: false, cause: error });
      throw error;
    }
    if (!isObject(answer) || !Array.isArray(answer.content))
      throw new Error(`${tool} answered with no content, and may have written`);
    if (answer.isError === true) {
      const words = answerText(answer);
      if (turnedAway(words))
        throw new SourceRefused(`${sheetsServer.name} refused the write`, { sent: true });
      throw new Error(`${tool} failed, and may have written`);
    }
    return answerJson(tool, answer);
  };
  return {
    // One cell, by its tab's name and its 0-based row and column.
    async edit(id: string, tab: string, row: number, column: number, value: CellValue) {
      await send(t.update, {
        spreadsheetId: id,
        range: `${quoteTab(tab)}!${columnLetters(column)}${row + 1}`,
        values: [[value ?? ""]],
      });
    },
    // A row after the table from its header row, `header` (1 for the
    // first), to its last, `last` (0-based), holding `cells` from column
    // A: the 0-based row it went in. The range ends at the table's last
    // row, so nothing below it, as a notes block, is taken for the table.
    async append(
      id: string,
      tab: string,
      header: number,
      last: number,
      cells: readonly CellValue[],
    ) {
      const width = columnLetters(Math.max(cells.length, 1) - 1);
      const body = await send(t.append, {
        spreadsheetId: id,
        range: `${quoteTab(tab)}!A${header}:${width}${last + 1}`,
        values: [cells.map((value) => value ?? "")],
      });
      return writtenRow(t.append, body);
    },
  };
}

export type ServerWrites = ReturnType<typeof serverWrites>;
