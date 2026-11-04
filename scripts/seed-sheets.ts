// Writes fixtures/sheets/ into a test Google account, as `pnpm seed:slack`
// fills the test Slack workspace (decisions 0021 and 0050). Only the
// maintainer runs it: it opens Google's sign-in in the default browser,
// signed in as Oriel's desktop client with `drive.file`, which may make
// spreadsheets, since files the app makes are its own.
//
// Each spreadsheet is made at its first written version: its tabs (with
// their sheetIds), cells, notes, merges, hidden rows and columns, filter and
// comments. Google gives it a new file ID, which is printed beside its
// title; nothing else is. Each is marked with its slug in Drive's
// appProperties, so a second run finds what the first made instead of
// making it again. One a run left half made is trashed and made again.
//
// Every spreadsheet is shared with the account `--share` names, the one
// Oriel will sign in as, which then picks them in Google's Picker: as a
// writer, except the one the fixture says can only be viewed, as a reader.
// So the account that seeds and the account that reads must differ, and
// comments are by the account that seeds. Nobody is emailed.
//
// `--next` also makes the next written version of each spreadsheet an
// earlier run made, such as an edited key, a sort or a rename, so a sync can
// see it change. Each run moves it on one version.
//
// Usage: pnpm seed:sheets --share <email> [--next] [--env <path>]
// --env names the .env holding GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
// (default: the repo root's). It is opened checked, only those two are read,
// and nothing in it is printed. The grant is revoked at the end, so nothing
// is left signed in.
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import {
  array,
  number,
  object,
  optional,
  record,
  string,
  type Validator,
} from "../packages/core/src/validate.ts";
import { columnIndex, parseBounds, parseCell } from "../packages/sheets/src/a1.ts";
import {
  type FixtureCell,
  type FixtureChange,
  type FixtureSpreadsheet,
  type FixtureTab,
  gridOf,
  type SheetsFixture,
  within,
} from "../packages/sheets/src/fixture.ts";
import { type Fetch, signIn, spreadsheetType } from "../packages/sheets/src/index.ts";
import { loadSheetsFixture } from "../packages/sheets/src/fixture.ts";
import { liveEnv, openBrowser } from "./sheets-live.ts";

const drive = "https://www.googleapis.com/drive/v3";
const sheets = "https://sheets.googleapis.com/v4/spreadsheets";
const revokeEndpoint = "https://oauth2.googleapis.com/revoke";

// The appProperties keys: which fixture spreadsheet a file is, and which of
// its versions it holds, once it is fully made.
export const marker = "orielFixture";
export const stepKey = "orielStep";

type Request = Record<string, unknown>;

// What a person typed into the cell, as the Sheets API writes it: typed
// values, so text starting with `=` stays text, and `formulaValue` only for
// a formula. A date is a number shown as one.
// https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/cells#CellData
export function entered(cell: FixtureCell | undefined): Request {
  if (cell === null || cell === undefined) return {};
  const typed = (value: string | number | boolean) =>
    typeof value === "string"
      ? { stringValue: value }
      : typeof value === "number"
        ? { numberValue: value }
        : { boolValue: value };
  if (typeof cell !== "object") return { userEnteredValue: typed(cell) };
  const data: Request = {};
  if (cell.formula !== undefined) data.userEnteredValue = { formulaValue: cell.formula };
  else if (cell.value !== undefined) data.userEnteredValue = typed(cell.value);
  if (cell.formatted !== undefined) {
    if (!/^\d{4}-\d\d-\d\d$/.test(cell.formatted))
      throw new Error(`the seed shows numbers only as dates, not as "${cell.formatted}"`);
    data.userEnteredFormat = { numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" } };
  }
  if (cell.note !== undefined) data.note = cell.note;
  return data;
}

const range = (sheetId: number, tab: FixtureTab, text: string) => {
  const box = within(parseBounds(text) ?? {}, gridOf(tab));
  return {
    sheetId,
    startRowIndex: box.startRow,
    endRowIndex: box.endRow,
    startColumnIndex: box.startColumn,
    endColumnIndex: box.endColumn,
  };
};

const cellsFields = "userEnteredValue,note,userEnteredFormat.numberFormat";

// Rows in chunks, so no request nears Google's recommended 2 MB.
const chunkRows = 1000;

// A spreadsheet's first version, as Sheets `batchUpdate` requests, one list
// per call: the tabs, replacing the ones a new spreadsheet has; their cells,
// in chunks; then merges, hidden rows and columns, and filters.
// https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request
export function fillRequests(spreadsheet: FixtureSpreadsheet, existing: number[]): Request[][] {
  const tabs = spreadsheet.tabs.map((tab, index) => {
    const grid = gridOf(tab);
    return {
      addSheet: {
        properties: {
          sheetId: tab.sheetId,
          title: tab.title,
          index,
          gridProperties: {
            rowCount: grid.rows,
            columnCount: grid.columns,
            frozenRowCount: tab.frozenRows ?? 0,
          },
        },
      },
    };
  });
  const gone = existing
    .filter((id) => !spreadsheet.tabs.some((tab) => tab.sheetId === id))
    .map((sheetId) => ({ deleteSheet: { sheetId } }));
  const cells = spreadsheet.tabs.flatMap((tab) =>
    Array.from({ length: Math.ceil(tab.rows.length / chunkRows) }, (_, i) => [
      {
        updateCells: {
          start: { sheetId: tab.sheetId, rowIndex: i * chunkRows, columnIndex: 0 },
          rows: tab.rows
            .slice(i * chunkRows, (i + 1) * chunkRows)
            .map((row) => ({ values: row.map(entered) })),
          fields: cellsFields,
        },
      },
    ]),
  );
  const shape = spreadsheet.tabs.flatMap((tab) => {
    const hide = (dimension: "ROWS" | "COLUMNS", index: number) => ({
      updateDimensionProperties: {
        range: { sheetId: tab.sheetId, dimension, startIndex: index, endIndex: index + 1 },
        properties: { hiddenByUser: true },
        fields: "hiddenByUser",
      },
    });
    return [
      ...(tab.merges ?? []).map((merge) => ({
        mergeCells: { range: range(tab.sheetId, tab, merge), mergeType: "MERGE_ALL" },
      })),
      ...(tab.hiddenRows ?? []).map((row) => hide("ROWS", row - 1)),
      ...(tab.hiddenColumns ?? []).map((column) => hide("COLUMNS", columnIndex(column) ?? 0)),
      ...(tab.filter
        ? [
            {
              setBasicFilter: {
                filter: {
                  range: range(tab.sheetId, tab, tab.filter.range),
                  filterSpecs: [
                    {
                      columnIndex: columnIndex(tab.filter.column),
                      filterCriteria: { hiddenValues: tab.filter.hiddenValues },
                    },
                  ],
                },
              },
            },
          ]
        : []),
    ];
  });
  return [[...tabs, ...gone], ...cells, ...(shape.length ? [shape] : [])];
}

// A later version's changes, as one `batchUpdate`.
export function changeRequests(
  spreadsheet: FixtureSpreadsheet,
  changes: FixtureChange[],
): Request[] {
  return changes.map((change) => {
    const tab = spreadsheet.tabs.find((t) => t.sheetId === change.sheetId);
    if (!tab) throw new Error(`no tab ${change.sheetId}`);
    switch (change.kind) {
      case "set": {
        const at = parseCell(change.cell);
        if (!at) throw new Error(`${change.cell} isn't a cell`);
        return {
          updateCells: {
            start: { sheetId: tab.sheetId, rowIndex: at.row, columnIndex: at.column },
            rows: [{ values: [entered(change.value)] }],
            fields: cellsFields,
          },
        };
      }
      case "sort":
        return {
          sortRange: {
            range: range(tab.sheetId, tab, change.range),
            sortSpecs: [{ dimensionIndex: columnIndex(change.column), sortOrder: "ASCENDING" }],
          },
        };
      case "rename":
        return {
          updateSheetProperties: {
            properties: { sheetId: tab.sheetId, title: change.title },
            fields: "title",
          },
        };
    }
  });
}

export type SeedIo = {
  fetch: Fetch;
  log: (line: string) => void;
  // Waits before a retry; tests pass one that doesn't.
  wait: (ms: number) => Promise<void>;
};

export type SeedOptions = { share: string; next: boolean };

class GoogleRefused extends Error {}

const refusal = object({
  error: object({
    message: optional(string),
    errors: optional(array(object({ reason: optional(string) }))),
  }),
});

// The part of an answer the seed reads, or a refusal that says so.
function read<T>(shape: Validator<T>, answer: unknown, what: string): T {
  const result = shape(answer);
  if (!result.ok) throw new GoogleRefused(`${what} wasn't an answer the seed reads`);
  return result.value;
}

const withId = object({ id: string });
const listed = object({
  files: array(object({ id: string, appProperties: optional(record(string)) })),
});
const sheetIds = object({
  sheets: array(object({ properties: object({ sheetId: optional(number) }) })),
});
const account = object({ user: object({ emailAddress: optional(string) }) });

// Google, as the signed-in account. A `429`, or a `403` for a rate limit,
// is retried with exponential backoff, as Google asks.
// https://developers.google.com/workspace/sheets/api/limits#exponential
function client(token: string, io: SeedIo) {
  return async (method: string, url: string, body?: unknown): Promise<unknown> => {
    for (let attempt = 0; ; attempt++) {
      const response = await io.fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      let json: unknown = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        throw new GoogleRefused(
          `${method} ${new URL(url).pathname} answered ${response.status}, not JSON`,
        );
      }
      const error = refusal(json);
      const limited =
        response.status === 429 ||
        (response.status === 403 &&
          error.ok &&
          (error.value.error.errors ?? []).some((e) => /rateLimitExceeded/i.test(e.reason ?? "")));
      if (limited && attempt < 5) {
        await io.wait(2 ** attempt * 1000 + 250);
        continue;
      }
      if (!response.ok) {
        const message =
          error.ok && error.value.error.message ? `: ${error.value.error.message}` : "";
        throw new GoogleRefused(
          `${method} ${new URL(url).pathname} answered ${response.status}${message}`,
        );
      }
      return json;
    }
  };
}

const q = (slug: string) =>
  `appProperties has { key='${marker}' and value='${slug}' } and trashed=false`;

// Makes or finds each spreadsheet, shares it, and with `next` moves it on a
// version. Returns 0 when every spreadsheet is in place.
export async function seed(
  fixture: SheetsFixture,
  token: string,
  options: SeedOptions,
  io: SeedIo,
): Promise<number> {
  const google = client(token, io);
  const me = read(
    account,
    await google("GET", `${drive}/about?fields=user(emailAddress)`),
    "about.get",
  ).user.emailAddress;
  if (me !== undefined && me.toLowerCase() === options.share.toLowerCase()) {
    io.log("--share names the account you signed in as; Oriel must sign in as another");
    return 1;
  }
  let code = 0;
  for (const spreadsheet of fixture.spreadsheets) {
    try {
      const search = new URLSearchParams({
        q: q(spreadsheet.slug),
        fields: "files(id,appProperties)",
        spaces: "drive",
      });
      const found = read(
        listed,
        await google("GET", `${drive}/files?${search}`),
        "files.list",
      ).files;
      if (found.length > 1) {
        io.log(
          `${spreadsheet.title}: ${found.length} spreadsheets are marked as it; trash all but one: ${found.map((f) => f.id).join(" ")}`,
        );
        code = 1;
        continue;
      }
      let [file] = found;
      let made = "found";
      if (file && file.appProperties?.[stepKey] === undefined) {
        await google("PATCH", `${drive}/files/${file.id}?fields=id`, { trashed: true });
        file = undefined;
        made = "remade";
      }
      if (!file) {
        file = await make(google, spreadsheet);
        if (made === "found") made = "made";
      }
      const step = Number(file.appProperties?.[stepKey] ?? 0);
      await google(
        "POST",
        `${drive}/files/${file.id}/permissions?sendNotificationEmail=false&fields=id`,
        {
          type: "user",
          role: spreadsheet.canEdit ? "writer" : "reader",
          emailAddress: options.share,
        },
      );
      if (options.next && made === "found") {
        const later = spreadsheet.later[step];
        if (later) {
          await google("POST", `${sheets}/${file.id}:batchUpdate`, {
            requests: changeRequests(spreadsheet, later.changes),
          });
          await google("PATCH", `${drive}/files/${file.id}?fields=id`, {
            appProperties: { [stepKey]: String(step + 1) },
          });
          made = `moved to version ${step + 2} of ${spreadsheet.later.length + 1}`;
        } else made = "at its last version";
      }
      io.log(`${spreadsheet.title}  ${file.id}  ${made}`);
    } catch (error) {
      if (!(error instanceof GoogleRefused)) throw error;
      io.log(`${spreadsheet.title}: ${error.message}`);
      code = 1;
    }
  }
  return code;
}

async function make(google: ReturnType<typeof client>, spreadsheet: FixtureSpreadsheet) {
  const created = await google("POST", `${drive}/files?fields=id`, {
    name: spreadsheet.title,
    mimeType: spreadsheetType,
    appProperties: { [marker]: spreadsheet.slug },
  });
  const { id } = read(withId, created, "files.create");
  const tabs = await google("GET", `${sheets}/${id}?fields=sheets.properties.sheetId`);
  // Google leaves out a sheetId of 0.
  const existing = read(sheetIds, tabs, "spreadsheets.get").sheets.map(
    (sheet) => sheet.properties.sheetId ?? 0,
  );
  for (const requests of fillRequests(spreadsheet, existing))
    await google("POST", `${sheets}/${id}:batchUpdate`, { requests });
  const comments = `${drive}/files/${id}/comments`;
  for (const comment of spreadsheet.comments) {
    const posted = await google("POST", `${comments}?fields=id`, {
      content: comment.deleted ? "(deleted)" : comment.content,
      ...(comment.quoted
        ? { quotedFileContent: { mimeType: "text/plain", value: comment.quoted } }
        : {}),
    });
    const made = read(withId, posted, "comments.create");
    for (const reply of comment.replies ?? [])
      await google("POST", `${comments}/${made.id}/replies?fields=id`, {
        content: reply.content,
        ...(reply.action ? { action: reply.action } : {}),
      });
    if (comment.deleted) await google("DELETE", `${comments}/${made.id}`);
  }
  await google("PATCH", `${drive}/files/${id}?fields=id`, { appProperties: { [stepKey]: "0" } });
  return { id, appProperties: { [marker]: spreadsheet.slug, [stepKey]: "0" } };
}

// An address Drive can share with; never printed.
export const emailLike = (text: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);

if (import.meta.main) {
  const { values } = parseArgs({
    options: { env: { type: "string" }, share: { type: "string" }, next: { type: "boolean" } },
  });
  if (!values.share || !emailLike(values.share)) {
    console.error(
      "--share <email> names the account Oriel will sign in as, which must differ from the one you seed as",
    );
    process.exit(1);
  }
  const env = await liveEnv(values.env, new URL("../.env", import.meta.url));
  if ("error" in env) {
    console.error(env.error);
    process.exit(1);
  }
  const fixture = loadSheetsFixture();
  console.log("Sign in, as the account to seed, in the browser tab this opens (5 minutes).");
  const signedIn = await signIn(env, { fetch, open: openBrowser, now: Date.now }, { pick: false });
  if (signedIn.status === "failed") {
    console.error(`sign-in failed: ${signedIn.problem}`);
    process.exit(1);
  }
  try {
    process.exitCode = await seed(
      fixture,
      signedIn.tokens.access,
      { share: values.share, next: values.next ?? false },
      { fetch, log: console.log, wait: (ms) => sleep(ms) },
    );
  } finally {
    const revoked = await fetch(revokeEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: signedIn.tokens.refresh }).toString(),
    }).catch(() => null);
    console.log(`revoke: ${revoked?.status ?? "no answer"}`);
  }
}
