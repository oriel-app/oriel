// Google's Drive and Sheets APIs, answered from a fixture held in memory: a
// `fetch` that answers at Google's own addresses, so the tools reach it as
// they reach Google. `--fixture` serves the tools with it, and tests call
// them against it. No network.
//
// It answers what the tools ask, as Google's reference has it:
// - Drive's `files.list`, for spreadsheets by the `q` the tools write, newest
//   first, a page at a time.
//   https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list
// - Drive's `comments.list`, oldest first, a page at a time, with no deleted
//   comment unless asked; like Drive, it wants `fields`.
//   https://developers.google.com/workspace/drive/api/reference/rest/v3/comments/list
// - The Sheets API's `spreadsheets.get`, for the title and the tabs, and
//   with `ranges`, each range's notes and the rows and columns hidden by
//   hand in it, as `includeGridData` with those `fields` gives them.
//   https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get
// - `values.get` and `values.batchGet`, as formatted text by rows, with no
//   empty cells at a row's end and no empty rows at the end.
//   https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get
// - `values.update` and `values.append` (with `INSERT_ROWS`), refused with a
//   `403` on a spreadsheet the account can only view. It computes no
//   formulas: with `USER_ENTERED`, a cell keeps the text as entered.
//   https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/update
//   https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append
// Anything else is a `404`. Every request needs the access token, as
// Google's do, and each is kept in `calls`, so a test can count them.
import {
  type Bounds,
  columnIndex,
  columnLetters,
  formatRange,
  parseCell,
  parseRange,
} from "./a1.ts";
import { driveOrigin, sheetsOrigin, spreadsheetType } from "./google.ts";
import {
  type Fixture,
  type FixtureComment,
  type FixtureReply,
  type FixtureSpreadsheet,
  type FixtureTab,
  gridOf,
} from "./fixture.ts";

export const standInToken = "stand-in-access-token";

export type StandInOptions = {
  // The access token every request must carry.
  token?: string;
  // A write's new `modifiedTime`; without it, a write leaves it as it was.
  now?: () => string;
};

export type StandInCall = { method: string; url: string; body?: unknown };

const statusOf: Record<number, string> = {
  400: "INVALID_ARGUMENT",
  401: "UNAUTHENTICATED",
  403: "PERMISSION_DENIED",
  404: "NOT_FOUND",
};
// Google's error body, as both APIs send it.
// https://cloud.google.com/apis/design/errors#http_mapping
const refuse = (code: number, message: string) =>
  Response.json({ error: { code, message, status: statusOf[code] } }, { status: code });

// The `q` the tools write: spreadsheets not in the bin, and maybe a name.
// A quoted string escapes `'` and `\` with `\`.
// https://developers.google.com/workspace/drive/api/guides/ref-search-terms
const baseQuery = `mimeType='${spreadsheetType}' and trashed=false`;
function nameIn(q: string): string | null | undefined {
  if (q === baseQuery) return null;
  const match = /^ and name contains '((?:[^'\\]|\\.)*)'$/.exec(q.slice(baseQuery.length));
  if (!q.startsWith(baseQuery) || !match) return undefined;
  return (match[1] ?? "").replace(/\\(.)/g, "$1");
}

// "The contains operator only performs prefix matching for a name term":
// `HelloWorld` is found by `Hello` but not `World`, and `Hello World` by
// either, in any case.
const prefixed = (name: string, term: string) => {
  const [n, t] = [name.toLowerCase(), term.toLowerCase()];
  for (let i = 0; i < n.length; i++)
    if ((i === 0 || /[^\p{L}\p{N}]/u.test(n[i - 1] ?? "")) && n.startsWith(t, i)) return true;
  return false;
};

export const spreadsheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

// What a row of cells sends: up to its last cell that holds anything.
const trimmed = (row: readonly string[]) => {
  let end = row.length;
  while (end > 0 && row[end - 1] === "") end--;
  return row.slice(0, end);
};

type Box = Required<Bounds>;

// A comment or a reply as Drive's Comment and Reply have them: its author
// by name only, and no content once deleted.
// https://developers.google.com/workspace/drive/api/reference/rest/v3/comments
const said = (each: FixtureReply) => ({
  author: { kind: "drive#user", displayName: each.author },
  createdTime: each.createdTime,
  ...(each.deleted ? {} : { content: each.content }),
  deleted: each.deleted ?? false,
});
const commentOf = (comment: FixtureComment) => ({
  kind: "drive#comment",
  ...said(comment),
  resolved: comment.resolved ?? false,
  ...(comment.quoted
    ? { quotedFileContent: { mimeType: "text/plain", value: comment.quoted } }
    : {}),
  replies: (comment.replies ?? []).map((reply) => ({ kind: "drive#reply", ...said(reply) })),
});

export function standIn(fixture: Fixture, options: StandInOptions = {}) {
  const token = options.token ?? standInToken;
  const calls: StandInCall[] = [];
  const spreadsheets = structuredClone(fixture.spreadsheets);
  const byId = new Map(spreadsheets.map((s) => [s.id, s]));

  const tabOf = (s: FixtureSpreadsheet, title: string | null) =>
    title === null ? s.tabs[0] : s.tabs.find((t) => t.title === title);

  // A range's tab and box, cut to the tab's grid; null when it names no
  // tab or isn't a range.
  function resolve(s: FixtureSpreadsheet, text: string): { tab: FixtureTab; box: Box } | null {
    const range = parseRange(text);
    const tab = range && tabOf(s, range.tab);
    if (!range || !tab) return null;
    const grid = gridOf(tab);
    const b = range.bounds ?? {};
    const box = {
      startRow: Math.min(b.startRow ?? 0, grid.rows),
      endRow: Math.min(b.endRow ?? grid.rows, grid.rows),
      startColumn: Math.min(b.startColumn ?? 0, grid.columns),
      endColumn: Math.min(b.endColumn ?? grid.columns, grid.columns),
    };
    if (box.startRow >= box.endRow || box.startColumn >= box.endColumn) return null;
    return { tab, box };
  }

  function valueRange(tab: FixtureTab, box: Box) {
    const values = tab.rows
      .slice(box.startRow, box.endRow)
      .map((row) => trimmed(row.slice(box.startColumn, box.endColumn)));
    while (values.length && values.at(-1)?.length === 0) values.pop();
    return {
      range: formatRange(tab.title, box),
      majorDimension: "ROWS",
      ...(values.length ? { values } : {}),
    };
  }

  // A box's notes and the rows and columns in it hidden by hand, as
  // GridData has them: a value or a dimension's metadata a place each,
  // with what's empty or false left out.
  function gridData(tab: FixtureTab, box: Box) {
    const notes = new Map<string, string>();
    for (const [cell, note] of Object.entries(tab.notes ?? {})) {
      const at = parseCell(cell);
      if (at) notes.set(`${at.row},${at.column}`, note);
    }
    const hiddenRows = new Set((tab.hiddenRows ?? []).map((n) => n - 1));
    const hiddenColumns = new Set((tab.hiddenColumns ?? []).map((c) => columnIndex(c)));
    const span = (from: number, to: number) =>
      Array.from({ length: to - from }, (_, i) => from + i);
    return {
      ...(box.startRow ? { startRow: box.startRow } : {}),
      ...(box.startColumn ? { startColumn: box.startColumn } : {}),
      rowData: span(box.startRow, box.endRow).map((r) => ({
        values: span(box.startColumn, box.endColumn).map((c) => {
          const note = notes.get(`${r},${c}`);
          return note === undefined ? {} : { note };
        }),
      })),
      rowMetadata: span(box.startRow, box.endRow).map((r) =>
        hiddenRows.has(r) ? { hiddenByUser: true } : {},
      ),
      columnMetadata: span(box.startColumn, box.endColumn).map((c) =>
        hiddenColumns.has(c) ? { hiddenByUser: true } : {},
      ),
    };
  }

  // Rows inserted at `at`: the notes and hidden rows below move down with
  // their rows, as Google's do.
  function moveDown(tab: FixtureTab, at: number, count: number) {
    if (tab.hiddenRows) tab.hiddenRows = tab.hiddenRows.map((n) => (n - 1 >= at ? n + count : n));
    if (tab.notes)
      tab.notes = Object.fromEntries(
        Object.entries(tab.notes).map(([cell, note]) => {
          const place = parseCell(cell);
          return place && place.row >= at
            ? [`${columnLetters(place.column)}${place.row + count + 1}`, note]
            : [cell, note];
        }),
      );
  }

  const cellText = (value: unknown): string | null =>
    value === null ? null : typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : String(value);

  // Writes rows of values into a tab from a corner, growing its grid to fit.
  // A null leaves its cell as it was.
  function write(tab: FixtureTab, row: number, column: number, values: unknown[][]) {
    for (const [i, line] of values.entries()) {
      const at = row + i;
      while (tab.rows.length <= at) tab.rows.push([]);
      const cells = tab.rows[at] ?? [];
      for (const [j, value] of line.entries()) {
        const text = cellText(value);
        if (text === null) continue;
        while (cells.length < column + j) cells.push("");
        cells[column + j] = text;
      }
      tab.rows[at] = cells;
    }
    const grid = gridOf(tab);
    tab.rowCount = grid.rows;
    tab.columnCount = grid.columns;
  }

  const isRows = (values: unknown): values is unknown[][] =>
    Array.isArray(values) &&
    values.every(
      (row) =>
        Array.isArray(row) &&
        row.every((v) => v === null || ["string", "number", "boolean"].includes(typeof v)),
    );

  const touched = (s: FixtureSpreadsheet) => {
    if (options.now) s.modifiedTime = options.now();
  };

  function comments(url: URL, id: string): Response {
    const s = byId.get(decodeURIComponent(id));
    if (!s) return refuse(404, `File not found: ${decodeURIComponent(id)}.`);
    if (!url.searchParams.get("fields"))
      return refuse(400, "The 'fields' parameter is required for this operation.");
    const size = Math.min(Math.max(Number(url.searchParams.get("pageSize")) || 20, 1), 100);
    const pageToken = url.searchParams.get("pageToken");
    const at = pageToken === null ? 0 : Number(/^c([0-9]+)$/.exec(pageToken)?.[1] ?? Number.NaN);
    if (!Number.isInteger(at)) return refuse(400, "Invalid Value");
    const all = (s.comments ?? [])
      .filter((c) => url.searchParams.get("includeDeleted") === "true" || !c.deleted)
      .toSorted((a, b) => Date.parse(a.createdTime) - Date.parse(b.createdTime));
    return Response.json({
      ...(at + size < all.length ? { nextPageToken: `c${at + size}` } : {}),
      comments: all.slice(at, at + size).map(commentOf),
    });
  }

  function drive(url: URL): Response {
    const commented = /^\/drive\/v3\/files\/([^/]+)\/comments$/.exec(url.pathname);
    if (commented) return comments(url, commented[1] ?? "");
    if (url.pathname !== "/drive/v3/files") return refuse(404, "Not Found");
    const name = nameIn(url.searchParams.get("q") ?? "");
    if (name === undefined) return refuse(400, "Invalid Value");
    if (url.searchParams.get("orderBy") !== "modifiedTime desc")
      return refuse(400, "Invalid Value");
    const size = Math.min(Math.max(Number(url.searchParams.get("pageSize")) || 100, 1), 1000);
    const pageToken = url.searchParams.get("pageToken");
    const at = pageToken === null ? 0 : Number(/^p([0-9]+)$/.exec(pageToken)?.[1] ?? Number.NaN);
    if (!Number.isInteger(at)) return refuse(400, "Invalid Value");
    const found = spreadsheets
      .filter((s) => name === null || prefixed(s.name, name))
      .toSorted((a, b) => Date.parse(b.modifiedTime) - Date.parse(a.modifiedTime));
    const files = found.slice(at, at + size).map((s) => ({
      id: s.id,
      name: s.name,
      modifiedTime: s.modifiedTime,
      webViewLink: spreadsheetUrl(s.id),
    }));
    return Response.json({
      ...(at + size < found.length ? { nextPageToken: `p${at + size}` } : {}),
      files,
    });
  }

  function sheets(method: string, url: URL, body: unknown): Response {
    const match = /^\/v4\/spreadsheets\/([^/]+)(?:\/values(?::batchGet|\/([^/]+)))?$/.exec(
      url.pathname,
    );
    const [, idPart = "", rangePart] = match ?? [];
    const s = byId.get(decodeURIComponent(idPart));
    if (!match || !s) return refuse(404, "Requested entity was not found.");
    const query = url.searchParams;

    if (url.pathname.endsWith("/values:batchGet")) {
      if (method !== "GET") return refuse(404, "Not Found");
      const valueRanges = [];
      for (const text of query.getAll("ranges")) {
        const found = resolve(s, text);
        if (!found) return refuse(400, `Unable to parse range: ${text}`);
        valueRanges.push(valueRange(found.tab, found.box));
      }
      return Response.json({ spreadsheetId: s.id, valueRanges });
    }

    if (rangePart === undefined && query.has("ranges")) {
      if (method !== "GET") return refuse(404, "Not Found");
      const found: { tab: FixtureTab; box: Box }[] = [];
      for (const text of query.getAll("ranges")) {
        const each = resolve(s, text);
        if (!each) return refuse(400, `Unable to parse range: ${text}`);
        found.push(each);
      }
      return Response.json({
        sheets: s.tabs.flatMap((tab) => {
          const boxes = found.filter((each) => each.tab === tab);
          return boxes.length
            ? [
                {
                  properties: { sheetId: tab.sheetId, title: tab.title },
                  data: boxes.map(({ box }) => gridData(tab, box)),
                },
              ]
            : [];
        }),
      });
    }

    if (rangePart === undefined) {
      if (method !== "GET") return refuse(404, "Not Found");
      return Response.json({
        spreadsheetId: s.id,
        properties: { title: s.name },
        sheets: s.tabs.map((tab, index) => {
          const grid = gridOf(tab);
          // Google leaves out what is zero.
          return {
            properties: {
              sheetId: tab.sheetId,
              title: tab.title,
              ...(index ? { index } : {}),
              gridProperties: {
                rowCount: grid.rows,
                columnCount: grid.columns,
                ...(tab.frozenRows ? { frozenRowCount: tab.frozenRows } : {}),
              },
            },
          };
        }),
        spreadsheetUrl: spreadsheetUrl(s.id),
      });
    }

    const decoded = decodeURIComponent(rangePart);
    const appending = decoded.endsWith(":append");
    const text = appending ? decoded.slice(0, -":append".length) : decoded;
    const found = resolve(s, text);
    if (!found) return refuse(400, `Unable to parse range: ${text}`);
    const { tab, box } = found;

    if (method === "GET" && !appending) return Response.json(valueRange(tab, box));

    const writing = (method === "PUT" && !appending) || (method === "POST" && appending);
    if (!writing) return refuse(404, "Not Found");
    const option = query.get("valueInputOption");
    if (option !== "RAW" && option !== "USER_ENTERED")
      return refuse(400, "Invalid valueInputOption");
    if (s.canEdit === false) return refuse(403, "The caller does not have permission");
    const values = (body as { values?: unknown } | null)?.values;
    if (!isRows(values)) return refuse(400, "Invalid values");
    const width = Math.max(0, ...values.map((row) => row.length));
    const counts = (row: number, column: number) => ({
      updatedRange: formatRange(tab.title, {
        startRow: row,
        endRow: row + values.length,
        startColumn: column,
        endColumn: column + width,
      }),
      updatedRows: values.length,
      updatedColumns: width,
      updatedCells: values.reduce((n, line) => n + line.filter((v) => v !== null).length, 0),
    });

    if (!appending) {
      if (values.length > box.endRow - box.startRow || width > box.endColumn - box.startColumn)
        return refuse(400, `Requested writing within range [${text}], but tried writing more`);
      write(tab, box.startRow, box.startColumn, values);
      touched(s);
      return Response.json({ spreadsheetId: s.id, ...counts(box.startRow, box.startColumn) });
    }

    // The table is the block of cells around the range's last cell that
    // holds anything, out to the first empty row and column on each side,
    // as Google finds it: with tables at A1:C2 and B4:D6, appending to the
    // whole tab writes from B7, and to A1:A2 from A3. New rows go in after
    // it, from its first column.
    // https://developers.google.com/workspace/sheets/api/guides/values#append_values
    const filled = (r: number, c: number) => (tab.rows[r]?.[c] ?? "") !== "";
    let seed: [number, number] | null = null;
    for (let r = Math.min(box.endRow, tab.rows.length) - 1; r >= box.startRow && !seed; r--)
      for (let c = box.startColumn; c < box.endColumn && !seed; c++)
        if (filled(r, c)) seed = [r, c];
    let table: Box | null = null;
    if (seed) {
      const t = {
        startRow: seed[0],
        endRow: seed[0] + 1,
        startColumn: seed[1],
        endColumn: seed[1] + 1,
      };
      const any = (rows: [number, number], columns: [number, number]) => {
        for (let r = Math.max(rows[0], 0); r < rows[1]; r++)
          for (let c = Math.max(columns[0], 0); c < columns[1]; c++) if (filled(r, c)) return true;
        return false;
      };
      // One step out, to a side that holds anything, corners included.
      const grow = () => {
        const across: [number, number] = [t.startColumn - 1, t.endColumn + 1];
        const down: [number, number] = [t.startRow - 1, t.endRow + 1];
        if (t.startRow > 0 && any([t.startRow - 1, t.startRow], across)) t.startRow--;
        else if (any([t.endRow, t.endRow + 1], across)) t.endRow++;
        else if (t.startColumn > 0 && any(down, [t.startColumn - 1, t.startColumn]))
          t.startColumn--;
        else if (any(down, [t.endColumn, t.endColumn + 1])) t.endColumn++;
        else return false;
        return true;
      };
      while (grow());
      table = t;
    }
    const at = table ? table.endRow : box.startRow;
    const from = table ? table.startColumn : box.startColumn;
    if (query.get("insertDataOption") === "INSERT_ROWS") {
      const grid = gridOf(tab);
      if (at < tab.rows.length) {
        tab.rows.splice(at, 0, ...values.map(() => []));
        moveDown(tab, at, values.length);
      }
      tab.rowCount = grid.rows + values.length;
    }
    write(tab, at, from, values);
    touched(s);
    const tableRange = table ? { tableRange: formatRange(tab.title, table) } : {};
    return Response.json({
      spreadsheetId: s.id,
      ...tableRange,
      updates: { spreadsheetId: s.id, ...counts(at, from) },
    });
  }

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, url: url.toString(), ...(body === undefined ? {} : { body }) });
    const auth = new Headers(init?.headers).get("authorization");
    if (auth !== `Bearer ${token}`)
      return refuse(
        401,
        "Request had invalid authentication credentials. Expected OAuth 2 access token.",
      );
    if (url.origin === driveOrigin) return method === "GET" ? drive(url) : refuse(404, "Not Found");
    if (url.origin === sheetsOrigin) return sheets(method, url, body);
    return refuse(404, "Not Found");
  };

  return { fetch, calls, spreadsheets };
}

export type StandIn = ReturnType<typeof standIn>;
