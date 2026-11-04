// Google's Sheets and Drive APIs, as they answer the reads `drive.file`
// allows (decision 0050, as amended by OA-219), served from the fixture for
// unit tests and evals. No network: its `fetch` answers at Google's own
// addresses, so code reaches it as it reaches Google.
//
// It answers:
// - Drive's `files.get`, for a spreadsheet's `version`, name and
//   capabilities.
//   https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get
// - Drive's `about.get`, for the account.
//   https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get
// - Drive's `comments.list`.
//   https://developers.google.com/workspace/drive/api/reference/rest/v3/comments/list
// - The Sheets API's `spreadsheets.get`, with `ranges` and grid data.
//   https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get
//
// Each takes Google's `fields` (fields.ts). Like Google, it leaves out a
// field that is zero, false or empty in the Sheets API's answers: the first
// tab has no `index`, and a range from row 1 no `startRowIndex`. Drive's
// answers keep their `false`s. It keeps no cell formats, so no answer has
// them. It writes nothing: any other method is refused.
//
// Every request needs its access token, as Google does, and each is kept in
// `calls`, so a test can count them.
import { type A1Range, type Bounds, columnIndex, parseBounds, parseRange } from "./a1.ts";
import { type Mask, parseMask, project, type Schema, unknownField } from "./fields.ts";
import {
  applyChange,
  type Box,
  type FixtureCell,
  type FixtureChange,
  type FixtureComment,
  type FixtureSpreadsheet,
  type FixtureTab,
  type FixtureValue,
  gridOf,
  meets,
  type SheetsFixture,
  shown,
  valueOf,
  within,
} from "./fixture.ts";
import { spreadsheetType } from "./oauth.ts";

export const driveOrigin = "https://www.googleapis.com";
export const sheetsOrigin = "https://sheets.googleapis.com";

export type StandInOptions = {
  // The access token every request must carry.
  token?: string;
  // Answers `spreadsheets.get` with every tab even when `ranges` names
  // some, the other way Google's reference leaves open, so a test can show
  // a reader keeps only the tabs it asked for.
  everyTab?: boolean;
};

export type StandInCall = { method: string; url: string };

export const standInToken = "fixture-access-token";

// Google's error bodies. Drive's keeps the older shape, with `errors`; the
// Sheets API's has a `status`.
// https://developers.google.com/workspace/drive/api/guides/handle-errors
// https://cloud.google.com/apis/design/errors#http_mapping
type DriveReason = { reason: string; domain?: string; location?: string; locationType?: string };
const driveError = (code: number, message: string, why: DriveReason) =>
  Response.json(
    { error: { code, message, errors: [{ message, domain: "global", ...why }] } },
    { status: code },
  );
const sheetsStatus: Record<number, string> = {
  400: "INVALID_ARGUMENT",
  401: "UNAUTHENTICATED",
  404: "NOT_FOUND",
  405: "UNIMPLEMENTED",
};
const sheetsError = (code: number, message: string) =>
  Response.json({ error: { code, message, status: sheetsStatus[code] } }, { status: code });

const user: Schema = {
  kind: true,
  displayName: true,
  me: true,
  permissionId: true,
  emailAddress: true,
};
const fileSchema: Schema = {
  kind: true,
  id: true,
  name: true,
  mimeType: true,
  version: true,
  modifiedTime: true,
  trashed: true,
  capabilities: { canEdit: true, canModifyContent: true, canComment: true },
};
const aboutSchema: Schema = { kind: true, user };
const commentAuthor: Schema = { kind: true, displayName: true, me: true };
const reply: Schema = {
  kind: true,
  id: true,
  createdTime: true,
  modifiedTime: true,
  author: commentAuthor,
  htmlContent: true,
  content: true,
  deleted: true,
  action: true,
};
const commentListSchema: Schema = {
  kind: true,
  nextPageToken: true,
  comments: {
    ...reply,
    resolved: true,
    anchor: true,
    quotedFileContent: { mimeType: true, value: true },
    replies: reply,
  },
};
const gridRange: Schema = {
  sheetId: true,
  startRowIndex: true,
  endRowIndex: true,
  startColumnIndex: true,
  endColumnIndex: true,
};
const extendedValue: Schema = {
  numberValue: true,
  stringValue: true,
  boolValue: true,
  formulaValue: true,
  errorValue: { type: true, message: true },
};
const dimension: Schema = { pixelSize: true, hiddenByUser: true, hiddenByFilter: true };
const spreadsheetSchema: Schema = {
  spreadsheetId: true,
  spreadsheetUrl: true,
  properties: { title: true, locale: true, autoRecalc: true, timeZone: true },
  sheets: {
    properties: {
      sheetId: true,
      title: true,
      index: true,
      sheetType: true,
      hidden: true,
      gridProperties: {
        rowCount: true,
        columnCount: true,
        frozenRowCount: true,
        frozenColumnCount: true,
      },
    },
    data: {
      startRow: true,
      startColumn: true,
      rowData: {
        values: {
          userEnteredValue: extendedValue,
          effectiveValue: extendedValue,
          formattedValue: true,
          note: true,
        },
      },
      rowMetadata: dimension,
      columnMetadata: dimension,
    },
    merges: gridRange,
    basicFilter: {
      range: gridRange,
      filterSpecs: { columnIndex: true, filterCriteria: { hiddenValues: true } },
      // A map from a column's index to its criteria.
      criteria: true,
    },
  },
};

// Drops what is zero, false or empty, as the Sheets API's JSON does.
function lean<T extends Record<string, unknown>>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(
      ([, v]) => v !== 0 && v !== false && v !== undefined && !(Array.isArray(v) && !v.length),
    ),
  ) as Partial<T>;
}

const typed = (value: FixtureValue) =>
  typeof value === "string"
    ? { stringValue: value }
    : typeof value === "number"
      ? { numberValue: value }
      : { boolValue: value };

// A cell as Google's CellData has it: what was entered, what it computes
// to, what it shows, and its note.
// https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/cells#CellData
function cellData(cell: FixtureCell | undefined): Record<string, unknown> {
  if (cell === null || cell === undefined) return {};
  const held = valueOf(cell);
  const formula = typeof cell === "object" ? cell.formula : undefined;
  const note = typeof cell === "object" ? cell.note : undefined;
  const data: Record<string, unknown> = {};
  if (formula !== undefined) data.userEnteredValue = { formulaValue: formula };
  else if (held !== null) data.userEnteredValue = typed(held);
  if (held !== null) {
    data.effectiveValue = typed(held);
    data.formattedValue = shown(cell);
  }
  if (note !== undefined) data.note = note;
  return data;
}

const rangeOf = (sheetId: number, box: Partial<Box>) =>
  lean({
    sheetId,
    startRowIndex: box.startRow,
    endRowIndex: box.endRow,
    startColumnIndex: box.startColumn,
    endColumnIndex: box.endColumn,
  });

const boxOf = (tab: FixtureTab, range: string) => within(parseBounds(range) ?? {}, gridOf(tab));

// Rows a filter hides: those below its header whose cell in its column
// shows a hidden value.
function filtered(tab: FixtureTab): Set<number> {
  const hidden = new Set<number>();
  if (!tab.filter) return hidden;
  const box = boxOf(tab, tab.filter.range);
  const column = columnIndex(tab.filter.column) ?? -1;
  for (let r = box.startRow + 1; r < box.endRow; r++)
    if (tab.filter.hiddenValues.includes(shown(tab.rows[r]?.[column]))) hidden.add(r);
  return hidden;
}

// One GridData: the box's rows, each up to its last cell that holds
// anything, and no rows after the last that does; then every row's and
// column's metadata, hidden or not.
// https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/sheets#GridData
function gridData(tab: FixtureTab, box: Box) {
  const byFilter = filtered(tab);
  const byUser = new Set((tab.hiddenRows ?? []).map((n) => n - 1));
  const hiddenColumns = new Set((tab.hiddenColumns ?? []).map((c) => columnIndex(c)));
  const rowData: Record<string, unknown>[] = [];
  for (let r = box.startRow; r < Math.min(box.endRow, tab.rows.length); r++) {
    const row = tab.rows[r] ?? [];
    const values = [];
    for (let c = box.startColumn; c < Math.min(box.endColumn, row.length); c++)
      values.push(cellData(row[c]));
    while (values.length && Object.keys(values.at(-1) ?? {}).length === 0) values.pop();
    rowData.push(values.length ? { values } : {});
  }
  while (rowData.length && Object.keys(rowData.at(-1) ?? {}).length === 0) rowData.pop();
  const rowMetadata = [];
  for (let r = box.startRow; r < box.endRow; r++)
    rowMetadata.push(
      lean({ pixelSize: 21, hiddenByUser: byUser.has(r), hiddenByFilter: byFilter.has(r) }),
    );
  const columnMetadata = [];
  for (let c = box.startColumn; c < box.endColumn; c++)
    columnMetadata.push(lean({ pixelSize: 100, hiddenByUser: hiddenColumns.has(c) }));
  return lean({
    startRow: box.startRow,
    startColumn: box.startColumn,
    rowData,
    rowMetadata,
    columnMetadata,
  });
}

// A tab as Google's Sheet has it. With ranges, only what meets them: their
// grid data, and the merges in them. "Limiting the range returns only the
// portions of the spreadsheet that intersect the requested ranges."
// https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/sheets#Sheet
function sheetOf(
  spreadsheet: FixtureSpreadsheet,
  tab: FixtureTab,
  boxes: Box[] | null,
  data: boolean,
) {
  const grid = gridOf(tab);
  const index = spreadsheet.tabs.indexOf(tab);
  const merges = (tab.merges ?? [])
    .map((range) => boxOf(tab, range))
    .filter((merge) => boxes === null || boxes.some((box) => meets(box, merge)));
  const sheet: Record<string, unknown> = {
    properties: lean({
      sheetId: tab.sheetId,
      title: tab.title,
      index,
      sheetType: "GRID",
      gridProperties: lean({
        rowCount: grid.rows,
        columnCount: grid.columns,
        frozenRowCount: tab.frozenRows,
      }),
    }),
  };
  if (data) {
    const all = { startRow: 0, endRow: grid.rows, startColumn: 0, endColumn: grid.columns };
    sheet.data = (boxes ?? [all]).map((box) => gridData(tab, box));
  }
  if (merges.length) sheet.merges = merges.map((merge) => rangeOf(tab.sheetId, merge));
  if (tab.filter) {
    const column = columnIndex(tab.filter.column) ?? 0;
    const filterCriteria = { hiddenValues: tab.filter.hiddenValues };
    sheet.basicFilter = {
      range: rangeOf(tab.sheetId, boxOf(tab, tab.filter.range)),
      filterSpecs: [lean({ columnIndex: column, filterCriteria })],
      criteria: { [column]: filterCriteria },
    };
  }
  return sheet;
}

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\n", "<br>");

// A comment as Drive's Comment has it. Its author has a name only: "The
// author's email address and permission ID will not be populated."
// https://developers.google.com/workspace/drive/api/reference/rest/v3/comments
function commentOf(comment: FixtureComment, me: string) {
  const author = (name: string) => ({ kind: "drive#user", displayName: name, me: name === me });
  const replies = (comment.replies ?? []).map((r) => ({
    kind: "drive#reply",
    id: r.id,
    createdTime: r.createdTime,
    modifiedTime: r.createdTime,
    author: author(r.author),
    htmlContent: escapeHtml(r.content),
    content: r.content,
    deleted: false,
    ...(r.action ? { action: r.action } : {}),
  }));
  const actions = replies.flatMap((r) => (r.action ? [r.action] : []));
  return {
    kind: "drive#comment",
    id: comment.id,
    createdTime: comment.createdTime,
    // "The last time the comment or any of its replies was modified."
    modifiedTime: replies.at(-1)?.createdTime ?? comment.createdTime,
    author: author(comment.author),
    ...(comment.deleted
      ? {}
      : { htmlContent: escapeHtml(comment.content), content: comment.content }),
    deleted: comment.deleted ?? false,
    resolved: actions.at(-1) === "resolve",
    ...(comment.anchor ? { anchor: comment.anchor } : {}),
    ...(comment.quoted
      ? { quotedFileContent: { mimeType: "text/plain", value: comment.quoted } }
      : {}),
    replies,
  };
}

const commentsPage = 20;
const commentsMost = 100;

export type StandIn = ReturnType<typeof fixtureGoogle>;

export function fixtureGoogle(fixture: SheetsFixture, options: StandInOptions = {}) {
  const token = options.token ?? standInToken;
  const calls: StandInCall[] = [];
  const copy = structuredClone(fixture);
  const files = new Map(copy.spreadsheets.map((s) => [s.id, { spreadsheet: s, next: 0 }]));

  const masked = (
    fields: string | null,
    schema: Schema,
    answer: unknown,
    refuse: (message: string) => Response,
  ) => {
    if (fields === null) return Response.json(answer);
    const mask = parseMask(fields);
    if (!(mask instanceof Map)) return refuse(`Invalid field selection ${mask.invalid}`);
    const unknown = unknownField(mask, schema);
    if (unknown) return refuse(`Invalid field selection ${unknown}`);
    return Response.json(project(answer, mask));
  };

  const drive = (path: string, query: URLSearchParams): Response => {
    const fields = query.get("fields");
    const badField = (message: string) =>
      driveError(400, message, {
        reason: "invalidParameter",
        location: "fields",
        locationType: "parameter",
      });
    const required = () =>
      driveError(400, "The 'fields' parameter is required for this method.", {
        reason: "required",
        location: "fields",
        locationType: "parameter",
      });
    if (path === "/drive/v3/about") {
      // "For all methods of the about … you must set the fields parameter."
      if (fields === null) return required();
      return masked(
        fields,
        aboutSchema,
        { kind: "drive#about", user: { kind: "drive#user", me: true, ...copy.user } },
        badField,
      );
    }
    const match = /^\/drive\/v3\/files\/([^/]+)(\/comments)?$/.exec(path);
    const id = match?.[1] ? decodeURIComponent(match[1]) : null;
    if (!match || id === null) return driveError(404, "Not Found", { reason: "notFound" });
    const file = files.get(id)?.spreadsheet;
    // Under `drive.file`, a file nobody picked is one Drive can't find.
    if (!file) return driveError(404, `File not found: ${id}.`, { reason: "notFound" });
    if (!match[2]) {
      const answer = {
        kind: "drive#file",
        id: file.id,
        name: file.title,
        mimeType: spreadsheetType,
        version: file.version,
        modifiedTime: file.modifiedTime,
        trashed: false,
        capabilities: {
          canEdit: file.canEdit,
          canModifyContent: file.canEdit,
          canComment: file.canEdit,
        },
      };
      // Without `fields`, Drive sends its default few.
      const defaults = "kind,id,name,mimeType";
      return masked(fields ?? defaults, fileSchema, answer, badField);
    }
    if (fields === null) return required();
    const size = Math.min(Math.max(Number(query.get("pageSize")) || commentsPage, 1), commentsMost);
    const pageToken = query.get("pageToken");
    const at = pageToken === null ? 0 : Number(/^c([0-9]+)$/.exec(pageToken)?.[1] ?? Number.NaN);
    if (!Number.isInteger(at))
      return driveError(400, "Invalid Value", {
        reason: "invalid",
        location: "pageToken",
        locationType: "parameter",
      });
    const since = query.get("startModifiedTime");
    const all = file.comments
      .filter((c) => query.get("includeDeleted") === "true" || !c.deleted)
      .map((c) => commentOf(c, copy.user.displayName))
      .filter((c) => since === null || c.modifiedTime >= since);
    const page = all.slice(at, at + size);
    const more = at + size < all.length;
    return masked(
      fields,
      commentListSchema,
      {
        kind: "drive#commentList",
        comments: page,
        ...(more ? { nextPageToken: `c${at + size}` } : {}),
      },
      badField,
    );
  };

  const sheets = (path: string, query: URLSearchParams): Response => {
    const match = /^\/v4\/spreadsheets\/([^/:]+)$/.exec(path);
    if (!match?.[1]) return sheetsError(404, "Requested entity was not found.");
    const file = files.get(decodeURIComponent(match[1]))?.spreadsheet;
    if (!file) return sheetsError(404, "Requested entity was not found.");
    const fields = query.get("fields");
    let mask: Mask | null = null;
    if (fields !== null) {
      const parsed = parseMask(fields);
      if (!(parsed instanceof Map))
        return sheetsError(400, `Invalid field selection ${parsed.invalid}`);
      const unknown = unknownField(parsed, spreadsheetSchema);
      if (unknown) return sheetsError(400, `Invalid field selection ${unknown}`);
      mask = parsed;
    }
    // "This parameter is ignored if a field mask was set in the request."
    const sheetsMask = mask?.get("sheets");
    const data =
      mask === null
        ? query.get("includeGridData") === "true"
        : mask.has("*") ||
          sheetsMask === null ||
          Boolean(sheetsMask?.has("data") || sheetsMask?.has("*"));
    const ranges = query.getAll("ranges");
    let picked: Map<FixtureTab, Box[]> | null = null;
    if (ranges.length) {
      picked = new Map();
      for (const text of ranges) {
        const range: A1Range | null = parseRange(text);
        const tab = range && tabNamed(file, range.tab);
        if (!range || !tab) return sheetsError(400, `Unable to parse range: ${text}`);
        const grid = gridOf(tab);
        const bounds: Bounds = range.bounds ?? {};
        picked.set(tab, [...(picked.get(tab) ?? []), within(bounds, grid)]);
      }
    }
    // With ranges, only the tabs they name. Google's page doesn't say so,
    // and a live read should confirm it; `everyTab` answers the other way.
    const tabs =
      picked && !options.everyTab ? file.tabs.filter((tab) => picked.has(tab)) : file.tabs;
    const answer = {
      spreadsheetId: file.id,
      properties: {
        title: file.title,
        locale: "en_GB",
        autoRecalc: "ON_CHANGE",
        timeZone: "Europe/London",
      },
      sheets: tabs.map((tab) => sheetOf(file, tab, picked?.get(tab) ?? null, data)),
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${file.id}/edit`,
    };
    return Response.json(mask === null ? answer : project(answer, mask));
  };

  const fetchApi = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push({ method: request.method, url: url.href });
    const isDrive = url.origin === driveOrigin && url.pathname.startsWith("/drive/v3/");
    const isSheets = url.origin === sheetsOrigin && url.pathname.startsWith("/v4/");
    if (!isDrive && !isSheets) return new Response("not found", { status: 404 });
    if (request.headers.get("authorization") !== `Bearer ${token}`)
      return isDrive
        ? driveError(401, "Invalid Credentials", {
            reason: "authError",
            location: "Authorization",
            locationType: "header",
          })
        : sheetsError(401, "Request had invalid authentication credentials.");
    if (request.method !== "GET")
      return isDrive
        ? driveError(405, "The fixture's stand-in only reads.", { reason: "methodNotAllowed" })
        : sheetsError(405, "The fixture's stand-in only reads.");
    return isDrive ? drive(url.pathname, url.searchParams) : sheets(url.pathname, url.searchParams);
  };

  const fileFor = (id: string) => {
    const file = files.get(id);
    if (!file) throw new Error(`no spreadsheet ${id} in the fixture`);
    return file;
  };

  return {
    fetch: fetchApi as typeof fetch,
    calls,
    // The spreadsheet's next written version: its changes made, its Drive
    // version moved. Null when it has none left.
    advance(id: string): string | null {
      const file = fileFor(id);
      const next = file.spreadsheet.later[file.next];
      if (!next) return null;
      for (const change of next.changes) {
        const problem = applyChange(file.spreadsheet, change);
        if (problem) throw new Error(problem);
      }
      file.spreadsheet.version = next.version;
      file.spreadsheet.modifiedTime = next.modifiedTime;
      file.next++;
      return next.version;
    },
    // A change a test makes, as a person editing the sheet would: the
    // version moves by one.
    change(id: string, change: FixtureChange, modifiedTime?: string): string {
      const { spreadsheet } = fileFor(id);
      const problem = applyChange(spreadsheet, change);
      if (problem) throw new Error(problem);
      spreadsheet.version = String(BigInt(spreadsheet.version) + 1n);
      if (modifiedTime) spreadsheet.modifiedTime = modifiedTime;
      return spreadsheet.version;
    },
  };
}

// A range's tab: by name, as Google matches it, ignoring case; with no
// name, the first.
function tabNamed(spreadsheet: FixtureSpreadsheet, name: string | null): FixtureTab | undefined {
  if (name === null) return spreadsheet.tabs[0];
  return (
    spreadsheet.tabs.find((tab) => tab.title === name) ??
    spreadsheet.tabs.find((tab) => tab.title.toLowerCase() === name.toLowerCase())
  );
}
