// The reads a Sheets connection makes of Google's APIs (decision 0050), as
// few as it can, in the shapes sheets-mcp's answers are read into
// (`serverGoogle`, decision 0059), and as the fixture's stand-in in memory
// answers them (`fixtureGoogle`), with no sign-in: Drive's `files.get` for a
// spreadsheet's version, name and whether the person may edit it, its
// `comments.list`, and the Sheets API's
// `spreadsheets.get`, first for its tabs and then for each mapped tab's grid
// in chunks of rows. Each asks only the fields it reads.
//
// A `429` waits and goes again, exponentially longer each time, with some
// jitter, as Google asks; while it waits, `waiting` hears how long. Any other
// failure throws a `SheetsError`, whose message names no content.
// https://developers.google.com/workspace/sheets/api/limits#exponential
import {
  array,
  boolean,
  type Infer,
  number,
  object,
  optional,
  string,
  type Validator,
} from "@oriel/core";
import { columnLetters, quoteTab } from "./a1.ts";
import { driveOrigin, sheetsOrigin } from "./stand-in.ts";
import type { Cell, Entered, Grid } from "./table.ts";

export type GoogleReads = {
  // The fixture's stand-in in memory, or one a test made: never the
  // network's.
  fetch: typeof fetch;
  // Waits `ms` before a request goes again; tests pass one that doesn't.
  wait: (ms: number) => Promise<void>;
  // In [0, 1), for the jitter.
  random: () => number;
  // Hears each wait before it starts, so the connection can show it.
  waiting?: (ms: number) => void;
};

export class SheetsError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SheetsError";
    this.status = status;
  }
}

// How many times a `429` goes again, and the longest wait between.
export const maxRetries = 6;
export const maxBackoffMs = 64_000;
const requestMs = 60_000;

export type DriveFile = {
  name: string;
  version: string;
  modifiedTime: string;
  canEdit: boolean;
  trashed: boolean;
};

export type SheetComment = {
  author: string;
  at: string;
  text: string;
  resolved: boolean;
  quoted: string | null;
  replies: { author: string; at: string; text: string }[];
};

export type TabInfo = { sheetId: number; title: string; rows: number; columns: number };

const driveFile = object({
  name: string,
  version: string,
  modifiedTime: string,
  capabilities: optional(object({ canEdit: optional(boolean) })),
  trashed: optional(boolean),
});
const author = optional(object({ displayName: optional(string) }));
const said = {
  author,
  createdTime: string,
  content: optional(string),
  deleted: optional(boolean),
};
const commentPage = object({
  nextPageToken: optional(string),
  comments: optional(
    array(
      object({
        ...said,
        resolved: optional(boolean),
        quotedFileContent: optional(object({ value: optional(string) })),
        replies: optional(array(object(said))),
      }),
    ),
  ),
});
const tabsAnswer = object({
  properties: object({ title: string }),
  sheets: array(
    object({
      properties: object({
        sheetId: optional(number),
        title: string,
        gridProperties: optional(
          object({ rowCount: optional(number), columnCount: optional(number) }),
        ),
      }),
    }),
  ),
});
const range = object({
  sheetId: optional(number),
  startRowIndex: optional(number),
  endRowIndex: optional(number),
  startColumnIndex: optional(number),
  endColumnIndex: optional(number),
});
const hiddenByUser = array(object({ hiddenByUser: optional(boolean) }));
// Google's ExtendedValue: one of its fields is set. An error is a formula's.
const enteredValue = object({
  stringValue: optional(string),
  numberValue: optional(number),
  boolValue: optional(boolean),
  formulaValue: optional(string),
});
const gridAnswer = object({
  sheets: optional(
    array(
      object({
        properties: object({ sheetId: optional(number) }),
        data: optional(
          array(
            object({
              startRow: optional(number),
              startColumn: optional(number),
              rowData: optional(
                array(
                  object({
                    values: optional(
                      array(
                        object({
                          formattedValue: optional(string),
                          effectiveValue: optional(object({ numberValue: optional(number) })),
                          userEnteredValue: optional(enteredValue),
                          note: optional(string),
                        }),
                      ),
                    ),
                  }),
                ),
              ),
              rowMetadata: optional(hiddenByUser),
              columnMetadata: optional(hiddenByUser),
            }),
          ),
        ),
        merges: optional(array(range)),
      }),
    ),
  ),
});

const gridFields = (entered: boolean) =>
  `sheets(properties(sheetId),data(startRow,startColumn,rowData(values(formattedValue,effectiveValue(numberValue),${entered ? "userEnteredValue," : ""}note)),rowMetadata(hiddenByUser),columnMetadata(hiddenByUser)),merges)`;

// What a cell holds as entered: a formula first, since only it is one.
function enteredOf(value: Infer<typeof enteredValue> | undefined): Entered {
  if (!value) return null;
  if (value.formulaValue !== undefined) return { formula: value.formulaValue };
  return value.stringValue ?? value.numberValue ?? value.boolValue ?? null;
}

export function googleReads(io: GoogleReads) {
  const get = async <T>(url: URL, shape: Validator<T>, what: string): Promise<T | "gone"> => {
    for (let attempt = 0; ; attempt++) {
      const response = await io.fetch(url, { signal: AbortSignal.timeout(requestMs) });
      if (response.status === 429 && attempt < maxRetries) {
        await response.body?.cancel();
        const ms = Math.min(2 ** attempt * 1000 + Math.floor(io.random() * 1000), maxBackoffMs);
        io.waiting?.(ms);
        await io.wait(ms);
        continue;
      }
      if (response.status === 404) {
        await response.body?.cancel();
        return "gone";
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new SheetsError(
          response.status === 429
            ? `Google asked Oriel to slow down too often while reading ${what}`
            : `Google answered ${response.status} to reading ${what}`,
          response.status,
        );
      }
      const checked = shape(await response.json());
      if (!checked.ok)
        throw new SheetsError(`Google's answer for ${what} isn't one Oriel reads`, 0);
      return checked.value;
    }
  };

  const fileUrl = (id: string, path = "") =>
    new URL(`/drive/v3/files/${encodeURIComponent(id)}${path}`, driveOrigin);
  const sheetUrl = (id: string) =>
    new URL(`/v4/spreadsheets/${encodeURIComponent(id)}`, sheetsOrigin);

  return {
    // Its version, name and capabilities; "gone" when Drive can't find it,
    // as under `drive.file` for one deleted or no longer shared.
    async file(id: string): Promise<DriveFile | "gone"> {
      const url = fileUrl(id);
      url.searchParams.set("fields", "name,version,modifiedTime,trashed,capabilities(canEdit)");
      const file = await get(url, driveFile, "a spreadsheet's version");
      if (file === "gone") return file;
      return {
        name: file.name,
        version: file.version,
        modifiedTime: file.modifiedTime,
        canEdit: file.capabilities?.canEdit ?? false,
        trashed: file.trashed ?? false,
      };
    },

    // Its comments with their replies, oldest first; a deleted one is left
    // out. Where each points stays opaque (decision 0050).
    async comments(id: string, most = 200): Promise<SheetComment[]> {
      const found: SheetComment[] = [];
      let token: string | undefined;
      do {
        const url = fileUrl(id, "/comments");
        url.searchParams.set(
          "fields",
          "nextPageToken,comments(author(displayName),createdTime,content,deleted,resolved,quotedFileContent(value),replies(author(displayName),createdTime,content,deleted))",
        );
        url.searchParams.set("pageSize", "100");
        if (token) url.searchParams.set("pageToken", token);
        const page = await get(url, commentPage, "a spreadsheet's comments");
        if (page === "gone") return found;
        for (const c of page.comments ?? []) {
          if (c.deleted) continue;
          found.push({
            author: c.author?.displayName ?? "Someone",
            at: c.createdTime,
            text: c.content ?? "",
            resolved: c.resolved ?? false,
            quoted: c.quotedFileContent?.value ?? null,
            replies: (c.replies ?? [])
              .filter((r) => !r.deleted)
              .map((r) => ({
                author: r.author?.displayName ?? "Someone",
                at: r.createdTime,
                text: r.content ?? "",
              })),
          });
        }
        token = page.nextPageToken;
      } while (token && found.length < most);
      return found.slice(0, most);
    },

    // Its title and its tabs, with their sizes.
    async tabs(id: string): Promise<{ title: string; tabs: TabInfo[] } | "gone"> {
      const url = sheetUrl(id);
      url.searchParams.set(
        "fields",
        "properties(title),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))",
      );
      const answer = await get(url, tabsAnswer, "a spreadsheet's tabs");
      if (answer === "gone") return answer;
      return {
        title: answer.properties.title,
        tabs: answer.sheets.map(({ properties: p }) => ({
          sheetId: p.sheetId ?? 0,
          title: p.title,
          rows: p.gridProperties?.rowCount ?? 0,
          columns: p.gridProperties?.columnCount ?? 0,
        })),
      };
    },

    // Rows `start` to `end` (0-based, end exclusive) of one tab, every
    // column: its cells as shown, with notes, which rows and columns are
    // hidden by hand, and the merges that meet it; with `entered`, what
    // each cell holds as entered too, as a writer reads it. Only the tab
    // asked for is kept, whatever else comes back.
    async rows(
      id: string,
      tab: TabInfo,
      start: number,
      end: number,
      entered = false,
    ): Promise<Grid | "gone"> {
      const url = sheetUrl(id);
      const last = columnLetters(Math.max(tab.columns, 1) - 1);
      url.searchParams.set("ranges", `${quoteTab(tab.title)}!A${start + 1}:${last}${end}`);
      url.searchParams.set("fields", gridFields(entered));
      const answer = await get(url, gridAnswer, "a tab's rows");
      if (answer === "gone") return answer;
      const sheet = answer.sheets?.find((s) => (s.properties.sheetId ?? 0) === tab.sheetId);
      const rows: (Cell | null)[][] = [];
      const hiddenRows = new Set<number>();
      const hiddenColumns = new Set<number>();
      for (const data of sheet?.data ?? []) {
        const top = data.startRow ?? 0;
        const left = data.startColumn ?? 0;
        (data.rowData ?? []).forEach((row, r) => {
          const cells: (Cell | null)[] = (rows[top - start + r] ??= []);
          (row.values ?? []).forEach((value, c) => {
            const shown = value.formattedValue ?? "";
            const note = value.note ?? null;
            const held = entered ? { entered: enteredOf(value.userEnteredValue) } : {};
            cells[left + c] =
              shown === "" && note === null && !held.entered
                ? null
                : { shown, number: value.effectiveValue?.numberValue ?? null, note, ...held };
          });
        });
        (data.rowMetadata ?? []).forEach((m, r) => {
          if (m.hiddenByUser) hiddenRows.add(top + r);
        });
        (data.columnMetadata ?? []).forEach((m, c) => {
          if (m.hiddenByUser) hiddenColumns.add(left + c);
        });
      }
      for (let r = 0; r < rows.length; r++) rows[r] ??= [];
      return {
        startRow: start,
        rows,
        hiddenRows,
        hiddenColumns,
        merges: (sheet?.merges ?? [])
          .filter((m) => (m.sheetId ?? 0) === tab.sheetId)
          .map((m) => ({
            startRow: m.startRowIndex ?? 0,
            endRow: m.endRowIndex ?? 0,
            startColumn: m.startColumnIndex ?? 0,
            endColumn: m.endColumnIndex ?? 0,
          })),
      };
    },
  };
}

export type Google = ReturnType<typeof googleReads>;
