// A Google Sheets connection, opened (decision 0049): its options are the
// spreadsheets the person picked and each one's mapped tabs, and whether it
// is read-only, and its secret is Google's tokens. What identifies it is the
// Google account, by Drive's `permissionId`.
//
// It may propose changes unless its `readOnly` option is on (decision 0049):
// then it gives no writes, so no writer is built and a write is
// unreachable, and its namespace offers nothing. A spreadsheet the person
// can only view is read-only either way.
//
// Reading needs the access token while it lasts. Refreshing it needs Oriel's
// Google client, which the stories that sign a person in pass to it; until
// then a connection whose access token has run out reads as signed out.
import {
  type Credential,
  type IndexRecord,
  number,
  object,
  type Opened,
  type OpenVia,
  readOnlyOf,
  optional,
  refine,
  string,
  type ToOpen,
} from "@oriel/core";
import { sheetsAttrs, sheetsAttrsOf } from "./attrs.ts";
import { googleReads, SheetsError } from "./google.ts";
import { type SheetsPicks, sheetsPicks } from "./mapping.ts";
import { type SheetsContext, sheetsContextOf } from "./namespace.ts";
import { reportLines } from "./report.ts";
import { rowReader } from "./rows.ts";
import { type SheetsSource, sheetsSource } from "./source.ts";

// What a Sheets connection's writer is built from, by its line in
// packages/changeset/src/writers.ts.
export type SheetsWrites = {
  credential: Credential;
  // The spreadsheets and mapped tabs the connection reads: the only ones
  // written to.
  picks: SheetsPicks;
  // Its connection's prefix, which its items' IDs carry.
  prefix: string;
  // How requests reach Google: the global fetch unless given, as the
  // fixture's stand-in gives one.
  fetch?: typeof fetch;
};

export type OpenedSheets = Opened<SheetsContext, unknown, SheetsWrites> & { source: SheetsSource };

// Whether the person set the connection read-only, as core reads every
// connector's `readOnly` option.
export { readOnlyOf };

// A token is printable ASCII, so a header can't refuse it and quote it.
const token = refine(string, (text) => /^[\x21-\x7e]+$/.test(text), "expected a token");
const tokensShape = object({ access: token, refresh: optional(string), expiresAt: number });

// The picks a connection's options hold, or none when they aren't picks.
export function picksOf(options: Readonly<Record<string, unknown>>): SheetsPicks {
  const read = sheetsPicks(options);
  return read.ok ? read.value : { spreadsheets: [] };
}

// Its access token, while it lasts. JSON.parse's own message quotes the
// text, which holds the tokens, so it's never passed on.
function credentialOf(secret: string | null, now: () => number): Credential {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(secret ?? "null") as unknown;
  } catch {
    parsed = null;
  }
  const tokens = tokensShape(parsed);
  return {
    headers: async () => {
      if (!tokens.ok || tokens.value.expiresAt <= now())
        throw new SheetsError("Google Sheets needs signing in again", 401);
      return { Authorization: `Bearer ${tokens.value.access}` };
    },
  };
}

export function sheetsProblem(error: unknown): string {
  if (error instanceof SheetsError && error.status === 401)
    return "Google Sheets needs signing in again before Oriel can read the spreadsheets.";
  return "Google didn't answer, so Oriel couldn't read the spreadsheets.";
}

export async function openSheets(connection: ToOpen, via: OpenVia): Promise<OpenedSheets> {
  const picks = picksOf(connection.options);
  const credential = credentialOf(connection.secret, () => Date.parse(via.now()));
  const google = googleReads({
    fetch: via.fetch ?? fetch,
    credential,
    wait: (ms) => new Promise((done) => setTimeout(done, ms)),
    random: Math.random,
    waiting: (ms) => via.log("sheets: Google asked Oriel to wait", { ms }),
  });
  const count = picks.spreadsheets.length;
  const readOnly = readOnlyOf(connection.options);
  const context = sheetsContextOf(picks);

  const source = sheetsSource({
    google,
    picks,
    ...(connection.prefix === "sheets" ? {} : { prefix: connection.prefix }),
    log: via.log,
  });

  return {
    source,
    report: () => reportLines(source.report()),
    attrs: sheetsAttrs,
    about: `${count} ${count === 1 ? "spreadsheet" : "spreadsheets"}`,
    scope: undefined,
    // Each mapped tab's fields, which its namespace offers to write.
    context: () => (readOnly ? undefined : context),
    ...(readOnly
      ? { fields: rowReader(google, picks, connection.prefix) }
      : {
          writes: {
            credential,
            picks,
            prefix: connection.prefix,
            ...(via.fetch ? { fetch: via.fetch } : {}),
          },
        }),
    // Its cursor holds each spreadsheet's version: one that hasn't moved
    // costs one request and isn't read again.
    incremental: true,
    problem: sheetsProblem,
    names: sheetsNames,
    viewOnly: viewOnlyOf,
  };
}

// The spreadsheets the person can only view, by Drive's `canEdit`, which
// are read-only whatever the connection's option says (decision 0050). A
// title is the spreadsheet's own, shown as text.
function viewOnlyOf(records: readonly IndexRecord[]): { why: string; all: boolean } | null {
  const spreadsheets = records.flatMap((record) => {
    const attrs = sheetsAttrsOf(record);
    return attrs?.of === "spreadsheet" ? [attrs] : [];
  });
  const viewed = spreadsheets.filter((attrs) => !attrs.canEdit);
  if (viewed.length === 0) return null;
  if (viewed.length === spreadsheets.length)
    return {
      why: "You can only view these spreadsheets in Google Sheets, so Oriel only reads them.",
      all: true,
    };
  const titles = viewed.map((attrs) => attrs.spreadsheet.title).join(", ");
  return {
    why: `You can only view ${titles} in Google Sheets, so Oriel only reads ${viewed.length === 1 ? "it" : "them"}.`,
    all: false,
  };
}

// The spreadsheets and tabs its records name, by `<spreadsheet>` and
// `<spreadsheet>/<sheetId>`, for what a change set wrote.
function* sheetsNames(records: readonly IndexRecord[]): Iterable<readonly [string, string]> {
  for (const record of records) {
    const attrs = sheetsAttrsOf(record);
    if (!attrs) continue;
    yield [attrs.spreadsheet.id, attrs.spreadsheet.title];
    if (attrs.of === "row") yield [`${attrs.spreadsheet.id}/${attrs.tab.sheetId}`, attrs.tab.title];
  }
}
