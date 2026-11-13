// Nothing here imports the server: the person's agent runs it. Every string it gives is the
// spreadsheet's content, and goes only into an item's text.
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

export const sheetsTools = {
  list: "list_spreadsheets",
  get: "get_spreadsheet",
  read: "read_range",
  comments: "list_comments",
  update: "update_range",
  append: "append_rows",
} as const;

const t = sheetsTools;

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

const signedOut = (words: string) =>
  /\b(not signed in|sign-in expired|refused the sign-in|sheets-mcp login)\b/i.test(words);
const unscoped = (words: string) => /\bwasn't given the permission\b/i.test(words);
const missing = (words: string) => /\bfound no spreadsheet\b|\bnot found\b/i.test(words);
// Errors such as Google not answering may come after the write landed, so they aren't turned away.
const turnedAway = (words: string) =>
  !/\b(couldn't reach|didn't answer|isn't one this server reads)\b/i.test(words) &&
  (signedOut(words) ||
    missing(words) ||
    /\b(refused|can't open or change|must be|isn't A1|too many requests|hasn't turned on|write at most)\b/i.test(
      words,
    ));

function bodyOf(tool: string, answer: ToolAnswer): { failed: string } | { body: unknown } {
  if (!isObject(answer) || !Array.isArray(answer.content))
    throw new ServerUnreadable(`${tool} answered with no content`);
  if (answer.isError === true) return { failed: answerText(answer) };
  return { body: answerJson(tool, answer) };
}

async function readOf(read: ToolCaller, tool: string, args: Json): Promise<Json | "gone"> {
  const answer = bodyOf(tool, await read({ tool, args }));
  if ("failed" in answer) {
    if (signedOut(answer.failed))
      throw new SheetsError(`${sheetsServer.name} isn't signed in to Google`, 401);
    if (missing(answer.failed)) return "gone";
    if (tool === t.comments && unscoped(answer.failed)) return "gone";
    throw new ServerUnreadable(`${tool} answered with an error`);
  }
  if (!isObject(answer.body)) throw new ServerUnreadable(`${tool} answered with no object`);
  return answer.body;
}

export type ServerSpreadsheet = { title: string; tabs: TabInfo[] };

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

export type ServerGrid = {
  hiddenRows: number[];
  hiddenColumns: number[];
  notes: { row: number; column: number; note: string }[];
};

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

// In FORMULA rendering a formula is text starting with `=`, and a cell a formula elsewhere fills
// is empty.
const enteredOf = (held: Scalar | undefined): Entered =>
  held === undefined || held === ""
    ? null
    : typeof held === "string" && held.startsWith("=")
      ? { formula: held }
      : held;

const listPage = 100;
const mostPages = 5;

export function serverGoogle(read: ToolCaller): Google {
  const fresh = new Map<string, ServerSpreadsheet>();

  const spreadsheet = async (id: string): Promise<ServerSpreadsheet | "gone"> => {
    const got = await readOf(read, t.get, { spreadsheetId: id });
    return got === "gone" ? got : readSpreadsheet(got);
  };

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
      const next = answer.next === null ? null : parseRange(answer.next);
      if (next?.tab !== tab.title || next.bounds?.startRow !== start + rows.length)
        throw new ServerUnreadable(`${t.read} cut a tab's rows with no way on to the rest`);
      range = answer.next as string;
    }
  };

  return {
    // The server doesn't say whether the person may edit it: a write it can't make comes back refused.
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
    // No merges: the server doesn't give them.
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

function writtenRow(tool: string, body: unknown): number {
  const range = isObject(body) ? text(body.updatedRange) : null;
  const row = range === null ? undefined : parseRange(range)?.bounds?.startRow;
  if (row === undefined) throw new Error(`${tool} didn't say where it wrote, and may have`);
  return row;
}

// `RAW`, so text that looks like a formula stays text. Any failure but a refusal may have landed.
export function serverWrites(write: ToolCaller) {
  const send = async (tool: string, args: Json): Promise<unknown> => {
    let answer: ToolAnswer;
    try {
      answer = await write({ tool, args: { ...args, valueInputOption: "RAW" } });
    } catch (error) {
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
    async edit(id: string, tab: string, row: number, column: number, value: CellValue) {
      await send(t.update, {
        spreadsheetId: id,
        range: `${quoteTab(tab)}!${columnLetters(column)}${row + 1}`,
        values: [[value ?? ""]],
      });
    },
    // The range ends at the table's last row, so nothing below it, as a notes block, is taken for
    // the table.
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
