import { type Bounds, columnLetters, formatRange, parseRange } from "./a1.ts";
import { drive, type Google, Refusal, sheets, spreadsheetType } from "./google.ts";

type Schema = Record<string, unknown>;

export type Annotations = {
  title: string;
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint: boolean;
};

export type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Schema;
  outputSchema: Schema;
  annotations: Annotations;
  call(args: Record<string, unknown>, google: Google): Promise<Record<string, unknown>>;
};

export const cellCap = 5000;
const pageMost = 100;
const pageDefault = 25;

const text = (description: string): Schema => ({ type: "string", description });
const spreadsheetId = text(
  "The spreadsheet's ID, from list_spreadsheets or its URL: the part after /d/.",
);
const cell: Schema = { type: ["string", "number", "boolean", "null"] };
const valueRows: Schema = {
  type: "array",
  description:
    "Rows of cell values, the first row first. A null leaves its cell as it is; an empty string empties it.",
  minItems: 1,
  items: { type: "array", items: cell },
};
const valueInputOption: Schema = {
  type: "string",
  enum: ["RAW", "USER_ENTERED"],
  default: "RAW",
  description:
    "RAW, the default, stores each value as given: `=SUM(A1:A3)` stays text. USER_ENTERED reads each value as if typed into the sheet, so it lets a formula through, and `3/4` may become a date.",
};
const renderOption: Schema = {
  type: "string",
  enum: ["FORMATTED_VALUE", "FORMULA"],
  default: "FORMATTED_VALUE",
  description:
    "FORMATTED_VALUE, the default, gives each cell as the sheet shows it. FORMULA gives each as entered: a formula as its text, such as `=SUM(A1:A3)`, and a cell a formula elsewhere fills as empty.",
};
const updated: Schema = {
  updatedRange: text("The cells written, in A1 notation."),
  updatedRows: { type: "integer" },
  updatedColumns: { type: "integer" },
  updatedCells: { type: "integer" },
};
const object = (properties: Schema, required: string[] = Object.keys(properties)): Schema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

function want(args: Record<string, unknown>, name: string, kind: "string"): string;
function want(args: Record<string, unknown>, name: string, kind: "string?"): string | undefined;
function want(args: Record<string, unknown>, name: string, kind: "string" | "string?") {
  const value = args[name];
  if (value === undefined && kind === "string?") return undefined;
  if (typeof value !== "string" || value.trim() === "")
    throw new Refusal(`\`${name}\` must be ${kind === "string" ? "given as " : ""}text.`);
  return value.trim();
}

function wantId(args: Record<string, unknown>): string {
  const id = want(args, "spreadsheetId", "string");
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id))
    throw new Refusal("`spreadsheetId` is letters, digits, - and _ only, as in its URL.");
  return id;
}

function wantRange(args: Record<string, unknown>): string {
  const range = want(args, "range", "string");
  if (!parseRange(range))
    throw new Refusal(
      "`range` isn't A1 notation. Write a tab's name, then `!` and the cells, such as `Backlog!A1:F50` or `'Q3 plan'!A:D`.",
    );
  return range;
}

function wantRows(args: Record<string, unknown>): (string | number | boolean | null)[][] {
  const values = args.values;
  const ok =
    Array.isArray(values) &&
    values.length > 0 &&
    values.every(
      (row) =>
        Array.isArray(row) &&
        row.every((v) => v === null || ["string", "number", "boolean"].includes(typeof v)),
    );
  if (!ok)
    throw new Refusal(
      "`values` must be a list of rows, each a list of text, numbers, true/false or null.",
    );
  const cells = (values as unknown[][]).reduce((n, row) => n + row.length, 0);
  if (cells > cellCap)
    throw new Refusal(
      `That's ${cells.toLocaleString("en")} cells; write at most ${cellCap.toLocaleString("en")} a call, in several calls.`,
    );
  return values as (string | number | boolean | null)[][];
}

function wantRender(args: Record<string, unknown>): string {
  const option = args.valueRenderOption ?? "FORMATTED_VALUE";
  if (option !== "FORMATTED_VALUE" && option !== "FORMULA")
    throw new Refusal("`valueRenderOption` is FORMATTED_VALUE or FORMULA.");
  return option;
}

function wantOption(args: Record<string, unknown>): string {
  const option = args.valueInputOption ?? "RAW";
  if (option !== "RAW" && option !== "USER_ENTERED")
    throw new Refusal("`valueInputOption` is RAW or USER_ENTERED.");
  return option;
}

function wantFlag(args: Record<string, unknown>, name: string): boolean {
  const value = args[name] ?? false;
  if (typeof value !== "boolean") throw new Refusal(`\`${name}\` is true or false.`);
  return value;
}

function wantPageSize(args: Record<string, unknown>): number {
  const size = args.pageSize ?? pageDefault;
  if (!Number.isInteger(size) || (size as number) < 1 || (size as number) > pageMost)
    throw new Refusal(`\`pageSize\` is a whole number from 1 to ${pageMost}.`);
  return size as number;
}

const count = (value: unknown) => (typeof value === "number" ? value : 0);
const str = (value: unknown) => (typeof value === "string" ? value : "");
const strings = (row: unknown) => (Array.isArray(row) ? row.map((v) => String(v ?? "")) : []);
const scalars = (row: unknown) =>
  Array.isArray(row)
    ? row.map((v) => (typeof v === "number" || typeof v === "boolean" ? v : String(v ?? "")))
    : [];

// Drive's search terms quote a string with `'`, and escape `'` and `\`.
// https://developers.google.com/workspace/drive/api/guides/ref-search-terms
const quoted = (value: string) => `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;

const listSpreadsheets: Tool = {
  name: "list_spreadsheets",
  title: "List spreadsheets",
  description:
    "Lists the Google Sheets spreadsheets this account can open, most recently changed first, a page at a time. Give `query` to keep only those whose name contains it. When `nextPageToken` comes back, pass it as `pageToken` for the next page.",
  inputSchema: object(
    {
      query: text(
        "Only spreadsheets with a word in their name that starts with this, in any case, as Drive's `name contains` matches.",
      ),
      pageSize: {
        type: "integer",
        minimum: 1,
        maximum: pageMost,
        default: pageDefault,
        description: "How many to list in one page.",
      },
      pageToken: text("The `nextPageToken` from the page before."),
    },
    [],
  ),
  outputSchema: object(
    {
      spreadsheets: {
        type: "array",
        items: object({
          id: text("The spreadsheet's ID."),
          name: text("Its name."),
          modifiedTime: text("When it last changed, in RFC 3339."),
          url: text("Where it opens in a browser."),
        }),
      },
      nextPageToken: text("Pass as `pageToken` for the next page; absent on the last page."),
    },
    ["spreadsheets"],
  ),
  annotations: { title: "List spreadsheets", readOnlyHint: true, openWorldHint: true },
  async call(args, google) {
    const query = want(args, "query", "string?");
    const pageToken = want(args, "pageToken", "string?");
    const size = wantPageSize(args);
    const q = [`mimeType='${spreadsheetType}'`, "trashed=false"];
    if (query !== undefined) q.push(`name contains ${quoted(query)}`);
    const answer = (await drive(google, "/drive/v3/files", {
      q: q.join(" and "),
      orderBy: "modifiedTime desc",
      pageSize: String(size),
      fields: "nextPageToken,files(id,name,modifiedTime,webViewLink)",
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
      ...(pageToken === undefined ? {} : { pageToken }),
    })) as { files?: Record<string, unknown>[]; nextPageToken?: unknown };
    return {
      spreadsheets: (answer.files ?? []).map((file) => ({
        id: str(file.id),
        name: str(file.name),
        modifiedTime: str(file.modifiedTime),
        url: str(file.webViewLink),
      })),
      ...(typeof answer.nextPageToken === "string" ? { nextPageToken: answer.nextPageToken } : {}),
    };
  },
};

type SheetProperties = {
  sheetId?: number;
  title?: string;
  index?: number;
  gridProperties?: { rowCount?: number; columnCount?: number; frozenRowCount?: number };
};

const getSpreadsheet: Tool = {
  name: "get_spreadsheet",
  title: "Get a spreadsheet",
  description:
    "A spreadsheet's title and its tabs: each tab's sheet ID, title, row and column counts, and, when rows are frozen at its top, how many and the last of them, which is usually the header row.",
  inputSchema: object({ spreadsheetId }),
  outputSchema: object(
    {
      id: text("The spreadsheet's ID."),
      title: text("Its title."),
      url: text("Where it opens in a browser."),
      tabs: {
        type: "array",
        items: object(
          {
            sheetId: { type: "integer", description: "The tab's own ID, which never changes." },
            title: text("The tab's name, as a range names it."),
            index: { type: "integer", description: "Its place among the tabs, from 0." },
            rowCount: { type: "integer" },
            columnCount: { type: "integer" },
            frozenRowCount: { type: "integer", description: "Rows frozen at its top." },
            header: {
              type: "array",
              items: { type: "string" },
              description: "The last frozen row's cells, when any row is frozen.",
            },
          },
          ["sheetId", "title", "index", "rowCount", "columnCount", "frozenRowCount"],
        ),
      },
    },
    ["id", "title", "url", "tabs"],
  ),
  annotations: { title: "Get a spreadsheet", readOnlyHint: true, openWorldHint: true },
  async call(args, google) {
    const id = wantId(args);
    const answer = (await sheets(google, "GET", `/v4/spreadsheets/${encodeURIComponent(id)}`, {
      fields:
        "spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title,index,gridProperties(rowCount,columnCount,frozenRowCount))",
    })) as {
      spreadsheetUrl?: unknown;
      properties?: { title?: unknown };
      sheets?: { properties?: SheetProperties }[];
    };
    const tabs = (answer.sheets ?? []).map(({ properties: p = {} }) => ({
      sheetId: count(p.sheetId),
      title: str(p.title),
      index: count(p.index),
      rowCount: count(p.gridProperties?.rowCount),
      columnCount: count(p.gridProperties?.columnCount),
      frozenRowCount: count(p.gridProperties?.frozenRowCount),
    }));
    const framed = tabs.filter((tab) => tab.frozenRowCount > 0);
    const headers = new Map<number, string[]>();
    if (framed.length) {
      const read = (await sheets(
        google,
        "GET",
        `/v4/spreadsheets/${encodeURIComponent(id)}/values:batchGet`,
        {
          ranges: framed.map((tab) =>
            formatRange(tab.title, {
              startRow: tab.frozenRowCount - 1,
              endRow: tab.frozenRowCount,
              startColumn: 0,
              endColumn: Math.max(tab.columnCount, 1),
            }),
          ),
          majorDimension: "ROWS",
        },
      )) as { valueRanges?: { values?: unknown[] }[] };
      for (const [i, tab] of framed.entries())
        headers.set(tab.sheetId, strings(read.valueRanges?.[i]?.values?.[0]));
    }
    return {
      id,
      title: str(answer.properties?.title),
      url: str(answer.spreadsheetUrl),
      tabs: tabs.map((tab) => {
        const header = headers.get(tab.sheetId);
        return header ? { ...tab, header } : tab;
      }),
    };
  },
};

function nextRange(returned: string, kept: number): string | null {
  const range = parseRange(returned);
  const b = range?.bounds;
  if (!range?.tab || b?.startRow === undefined || b.endRow === undefined) return null;
  if (b.startColumn === undefined || b.endColumn === undefined) return null;
  const startRow = b.startRow + kept;
  if (startRow >= b.endRow) return null;
  return formatRange(range.tab, { ...b, startRow } as Required<typeof b>);
}

async function gridOf(google: Google, id: string, tab: string, box: Required<Bounds>) {
  const answer = (await sheets(google, "GET", `/v4/spreadsheets/${encodeURIComponent(id)}`, {
    ranges: formatRange(tab, box),
    fields:
      "sheets(properties(title),data(startRow,startColumn,rowData(values(note)),rowMetadata(hiddenByUser),columnMetadata(hiddenByUser)))",
  })) as { sheets?: { properties?: { title?: unknown }; data?: GridData[] }[] };
  const hiddenRows = new Set<number>();
  const hiddenColumns = new Set<number>();
  const notes: { cell: string; note: string }[] = [];
  const sheet = (answer.sheets ?? []).find((each) => each.properties?.title === tab);
  for (const data of sheet?.data ?? []) {
    const top = count(data.startRow);
    const left = count(data.startColumn);
    (data.rowData ?? []).forEach((row, r) =>
      (row?.values ?? []).forEach((value, c) => {
        if (typeof value?.note === "string" && value.note !== "" && notes.length < cellCap)
          notes.push({ cell: `${columnLetters(left + c)}${top + r + 1}`, note: value.note });
      }),
    );
    (data.rowMetadata ?? []).forEach((m, r) => {
      if (m?.hiddenByUser === true) hiddenRows.add(top + r + 1);
    });
    (data.columnMetadata ?? []).forEach((m, c) => {
      if (m?.hiddenByUser === true) hiddenColumns.add(left + c);
    });
  }
  return {
    hiddenRows: [...hiddenRows].toSorted((a, b) => a - b),
    hiddenColumns: [...hiddenColumns].toSorted((a, b) => a - b).map(columnLetters),
    notes,
  };
}

type GridData = {
  startRow?: unknown;
  startColumn?: unknown;
  rowData?: { values?: { note?: unknown }[] }[];
  rowMetadata?: { hiddenByUser?: unknown }[];
  columnMetadata?: { hiddenByUser?: unknown }[];
};

const readRange: Tool = {
  name: "read_range",
  title: "Read a range",
  description: `Reads the cells in an A1 range, such as \`Backlog!A1:F50\`, \`'Q3 plan'!A:D\` or a tab's name alone for all of it, as rows of text as the sheet shows them, or, with \`valueRenderOption\` FORMULA, as entered, each formula as its text. Empty cells at a row's end and empty rows at the end are left out. At most ${cellCap.toLocaleString("en")} cells come back; when there are more, \`truncated\` is true and \`nextRange\` is where to read on. With \`includeGrid\`, it also says which of the rows that came back are hidden by hand, which of the range's columns are, and each of those rows' cell notes.`,
  inputSchema: object(
    {
      spreadsheetId,
      range: text("The cells to read, in A1 notation."),
      valueRenderOption: renderOption,
      includeGrid: {
        type: "boolean",
        default: false,
        description:
          "Also give `hiddenRows`, `hiddenColumns` and `notes`, in one more call to Google.",
      },
    },
    ["spreadsheetId", "range"],
  ),
  outputSchema: object(
    {
      range: text("The range Google read, cut to the tab's size, in A1 notation."),
      values: {
        type: "array",
        items: { type: "array", items: { type: ["string", "number", "boolean"] } },
        description: "Rows of text as shown; with FORMULA, numbers and true/false as entered.",
      },
      truncated: {
        type: "boolean",
        description: `Whether rows were left out to keep to ${cellCap.toLocaleString("en")} cells.`,
      },
      nextRange: text("When truncated: the range to read next."),
      note: text("When truncated: what was left out, and how to read on."),
      hiddenRows: {
        type: "array",
        items: { type: "integer" },
        description: "With includeGrid: the rows hidden by hand, by their number in the sheet.",
      },
      hiddenColumns: {
        type: "array",
        items: { type: "string" },
        description: "With includeGrid: the columns hidden by hand, by their letters.",
      },
      notes: {
        type: "array",
        items: object({
          cell: text("The cell the note is on, such as `C3`."),
          note: text("The note's text."),
        }),
        description: `With includeGrid: each cell's note, at most ${cellCap.toLocaleString("en")}.`,
      },
    },
    ["range", "values", "truncated"],
  ),
  annotations: { title: "Read a range", readOnlyHint: true, openWorldHint: true },
  async call(args, google) {
    const id = wantId(args);
    const range = wantRange(args);
    const render = wantRender(args);
    const grid = wantFlag(args, "includeGrid");
    const answer = (await sheets(
      google,
      "GET",
      `/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}`,
      { majorDimension: "ROWS", valueRenderOption: render },
    )) as { range?: unknown; values?: unknown[] };
    const returned = str(answer.range) || range;
    // As entered, a number or true/false stays one, so a client writing it
    // back writes what was there.
    const rows = (answer.values ?? []).map(render === "FORMULA" ? scalars : strings);
    let cells = 0;
    let kept = 0;
    while (kept < rows.length && cells + (rows[kept]?.length ?? 0) <= cellCap)
      cells += rows[kept++]?.length ?? 0;
    const gridFor = async (height: number, width?: number) => {
      if (!grid) return {};
      const range = parseRange(returned);
      const b = range?.bounds;
      if (!range?.tab || b?.startRow === undefined || b.startColumn === undefined)
        throw new Refusal("Google's answer isn't one this server reads.");
      const endColumn = width === undefined ? b.endColumn : b.startColumn + width;
      if (height === 0 || endColumn === undefined)
        return { hiddenRows: [], hiddenColumns: [], notes: [] };
      return gridOf(google, id, range.tab, {
        startRow: b.startRow,
        endRow: b.startRow + height,
        startColumn: b.startColumn,
        endColumn,
      });
    };
    if (kept === rows.length)
      return { range: returned, values: rows, truncated: false, ...(await gridFor(kept)) };
    if (kept === 0) {
      const first = rows[0] ?? [];
      return {
        range: returned,
        values: [first.slice(0, cellCap)],
        truncated: true,
        note: `The first row alone has ${first.length.toLocaleString("en")} cells, so only its first ${cellCap.toLocaleString("en")} came back. Ask for fewer columns, such as up to column ${columnLetters(cellCap - 1)}.`,
        ...(await gridFor(1, Math.min(first.length, cellCap))),
      };
    }
    const next = nextRange(returned, kept);
    return {
      range: returned,
      values: rows.slice(0, kept),
      truncated: true,
      ...(next ? { nextRange: next } : {}),
      note: `Cut at ${cellCap.toLocaleString("en")} cells: the first ${kept.toLocaleString("en")} rows of ${rows.length.toLocaleString("en")} came back. ${next ? `Read on with range \`${next}\`.` : `Read on from row ${kept + 1} of the range.`}`,
      ...(await gridFor(kept)),
    };
  },
};

type Said = {
  author?: { displayName?: unknown };
  createdTime?: unknown;
  content?: unknown;
  deleted?: unknown;
};
const saidOf = (each: Said) =>
  each.deleted === true
    ? null
    : {
        author: str(each.author?.displayName),
        createdTime: str(each.createdTime),
        content: str(each.content),
      };

const listComments: Tool = {
  name: "list_comments",
  title: "List comments",
  description:
    "Lists a spreadsheet's comments, oldest first, each with its replies, a page at a time. A deleted comment or reply is left out; a resolved one is marked. When `nextPageToken` comes back, pass it as `pageToken` for the next page.",
  inputSchema: object(
    {
      spreadsheetId,
      pageSize: {
        type: "integer",
        minimum: 1,
        maximum: pageMost,
        default: pageDefault,
        description: "How many comments to list in one page.",
      },
      pageToken: text("The `nextPageToken` from the page before."),
    },
    ["spreadsheetId"],
  ),
  outputSchema: object(
    {
      comments: {
        type: "array",
        items: object(
          {
            author: text("Who wrote it, by their name."),
            createdTime: text("When, in RFC 3339."),
            content: text("What it says."),
            resolved: { type: "boolean", description: "Whether it was resolved." },
            quoted: text("The text it was made on, when it was made on some."),
            replies: {
              type: "array",
              items: object({
                author: text("Who wrote it, by their name."),
                createdTime: text("When, in RFC 3339."),
                content: text("What it says."),
              }),
            },
          },
          ["author", "createdTime", "content", "resolved", "replies"],
        ),
      },
      nextPageToken: text("Pass as `pageToken` for the next page; absent on the last page."),
    },
    ["comments"],
  ),
  annotations: { title: "List comments", readOnlyHint: true, openWorldHint: true },
  async call(args, google) {
    const id = wantId(args);
    const pageToken = want(args, "pageToken", "string?");
    const size = wantPageSize(args);
    const answer = (await drive(google, `/drive/v3/files/${encodeURIComponent(id)}/comments`, {
      fields:
        "nextPageToken,comments(author(displayName),createdTime,content,deleted,resolved,quotedFileContent(value),replies(author(displayName),createdTime,content,deleted))",
      pageSize: String(size),
      ...(pageToken === undefined ? {} : { pageToken }),
    })) as {
      comments?: (Said & {
        resolved?: unknown;
        quotedFileContent?: { value?: unknown };
        replies?: Said[];
      })[];
      nextPageToken?: unknown;
    };
    return {
      comments: (answer.comments ?? []).flatMap((comment) => {
        const said = comment && saidOf(comment);
        if (!said) return [];
        const quoted = comment.quotedFileContent?.value;
        return [
          {
            ...said,
            resolved: comment.resolved === true,
            ...(typeof quoted === "string" && quoted !== "" ? { quoted } : {}),
            replies: (comment.replies ?? []).flatMap((reply) => {
              const each = reply && saidOf(reply);
              return each ? [each] : [];
            }),
          },
        ];
      }),
      ...(typeof answer.nextPageToken === "string" ? { nextPageToken: answer.nextPageToken } : {}),
    };
  },
};

const updateRange: Tool = {
  name: "update_range",
  title: "Update a range",
  description:
    "Writes rows of values into an A1 range, from its top-left cell, over what was there. The values must fit inside the range. Values are stored as given unless `valueInputOption` is USER_ENTERED, which lets a formula through.",
  inputSchema: object(
    {
      spreadsheetId,
      range: text("The cells to write, in A1 notation, such as `Backlog!C5:D6`."),
      values: valueRows,
      valueInputOption,
    },
    ["spreadsheetId", "range", "values"],
  ),
  outputSchema: object(updated),
  annotations: {
    title: "Update a range",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  async call(args, google) {
    const id = wantId(args);
    const range = wantRange(args);
    const values = wantRows(args);
    const option = wantOption(args);
    const answer = (await sheets(
      google,
      "PUT",
      `/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}`,
      { valueInputOption: option },
      { range, majorDimension: "ROWS", values },
    )) as Record<string, unknown>;
    return {
      updatedRange: str(answer.updatedRange),
      updatedRows: count(answer.updatedRows),
      updatedColumns: count(answer.updatedColumns),
      updatedCells: count(answer.updatedCells),
    };
  },
};

const appendRows: Tool = {
  name: "append_rows",
  title: "Append rows",
  description:
    "Adds rows after the last row of the table in an A1 range, such as `Backlog` or `Backlog!A:F`, inserting new rows so nothing below is written over. Values are stored as given unless `valueInputOption` is USER_ENTERED, which lets a formula through.",
  inputSchema: object(
    {
      spreadsheetId,
      range: text("The table to add to, in A1 notation: a tab's name, or its columns."),
      values: valueRows,
      valueInputOption,
    },
    ["spreadsheetId", "range", "values"],
  ),
  outputSchema: object(
    { tableRange: text("The table the rows went after, before they did."), ...updated },
    ["updatedRange", "updatedRows", "updatedColumns", "updatedCells"],
  ),
  annotations: {
    title: "Append rows",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  async call(args, google) {
    const id = wantId(args);
    const range = wantRange(args);
    const values = wantRows(args);
    const option = wantOption(args);
    const answer = (await sheets(
      google,
      "POST",
      `/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}:append`,
      { valueInputOption: option, insertDataOption: "INSERT_ROWS" },
      { range, majorDimension: "ROWS", values },
    )) as { tableRange?: unknown; updates?: Record<string, unknown> };
    const updates = answer.updates ?? {};
    return {
      ...(typeof answer.tableRange === "string" ? { tableRange: answer.tableRange } : {}),
      updatedRange: str(updates.updatedRange),
      updatedRows: count(updates.updatedRows),
      updatedColumns: count(updates.updatedColumns),
      updatedCells: count(updates.updatedCells),
    };
  },
};

export const tools: readonly Tool[] = [
  listSpreadsheets,
  getSpreadsheet,
  readRange,
  listComments,
  updateRange,
  appendRows,
];
