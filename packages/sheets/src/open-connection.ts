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
// Reading needs the access token while it lasts. Then it is refreshed with
// Oriel's Google client, as the composition root gives it, and kept anew;
// one Google refuses to refresh, or with no client to refresh it with,
// reads as signed out. A mapped column gone from a tab's header row stops
// that tab, and the connection waits for options that fit (decision 0051).
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
  readWhole,
  ServerUnreadable,
  type ToolCaller,
  type ToOpen,
} from "@oriel/core";
import { sheetsAttrs, sheetsAttrsOf } from "./attrs.ts";
import { googleReads, SecretRefused, SheetsError } from "./google.ts";
import { googleClientOf, refresh, type Tokens } from "./oauth.ts";
import { type SheetsPicks, sheetsPicks } from "./mapping.ts";
import { type SheetsContext, sheetsContextOf } from "./namespace.ts";
import { reportLines } from "./report.ts";
import { rowReader } from "./rows.ts";
import { serverGoogle } from "./sheets-mcp.ts";
import { type SheetsReport, type SheetsSource, sheetsSource } from "./source.ts";

// What a Sheets connection's writer is built from, by its line in
// packages/changeset/src/writers.ts.
export type SheetsWrites = {
  // The spreadsheets and mapped tabs the connection reads: the only ones
  // written to.
  picks: SheetsPicks;
  // Its connection's prefix, which its items' IDs carry.
  prefix: string;
} & (
  | {
      credential: Credential;
      // How requests reach Google: the global fetch unless given, as the
      // fixture's stand-in gives one.
      fetch?: typeof fetch;
    }
  // Through sheets-mcp (decision 0059): its reads and its writes, each from
  // its own process.
  | { server: { read: ToolCaller; write: ToolCaller } }
);

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

// A connection's tokens, as its secret keeps them, or null when they aren't;
// a fixture's has no refresh token, and lasts. JSON.parse's own message
// quotes the text, which holds the tokens, so it's never passed on.
export type KeptTokens = Omit<Tokens, "refresh"> & { refresh?: string };
export function tokensOf(secret: string | null): KeptTokens | null {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(secret ?? "null") as unknown;
  } catch {
    parsed = null;
  }
  const tokens = tokensShape(parsed);
  if (!tokens.ok) return null;
  const { access, refresh: refreshToken, expiresAt } = tokens.value;
  return { access, expiresAt, ...(refreshToken === undefined ? {} : { refresh: refreshToken }) };
}

// Refreshed this long before Google says the access token ends, so a read
// started just before then doesn't fail.
const marginMs = 60_000;

// Its access token, refreshed once it has run out, by one refresh at a time
// however many reads ask. A refresh that worked is kept as the connection's
// secret for its next start.
function credentialOf(
  secret: string | null,
  via: OpenVia,
): { credential: Credential; refused: () => boolean } {
  let tokens = tokensOf(secret);
  let refused = false;
  const now = () => Date.parse(via.now());
  const client = googleClientOf(via.client);
  let refreshing: Promise<void> | null = null;
  const renew = async (refreshToken: string, google: NonNullable<typeof client>) => {
    const refreshed = await refresh(google, refreshToken, { fetch: via.fetch ?? fetch, now });
    if (refreshed.status === "signed-out") {
      tokens = null;
      refused = true;
      return;
    }
    if (refreshed.status === "failed") {
      if (refreshed.needsSecret) {
        via.log("sheets: Google refused the token's refresh without the client's secret", {
          problem: refreshed.problem,
        });
        throw new SecretRefused();
      }
      via.log("sheets: the token's refresh failed", { problem: refreshed.problem });
      throw new SheetsError("Google didn't answer a refresh", 0);
    }
    tokens = refreshed.tokens;
    await via
      .keep?.(JSON.stringify(tokens))
      .catch(() => via.log("sheets: the refreshed token couldn't be kept", {}));
  };
  const credential: Credential = {
    headers: async () => {
      const held = tokens;
      if (held?.refresh && client && held.expiresAt - marginMs <= now()) {
        refreshing ??= renew(held.refresh, client).finally(() => (refreshing = null));
        await refreshing;
      }
      const current = tokens;
      if (!current || current.expiresAt <= now())
        throw new SheetsError("Google Sheets needs signing in again", 401);
      return { Authorization: `Bearer ${current.access}` };
    },
  };
  return { credential, refused: () => refused };
}

export function sheetsProblem(error: unknown): string {
  if (error instanceof SecretRefused)
    return "Google refused to refresh the sign-in because this copy of Oriel has no client secret for Google, so Oriel couldn't read the spreadsheets.";
  if (error instanceof SheetsError && error.status === 401)
    return "Google Sheets needs signing in again before Oriel can read the spreadsheets.";
  return "Google didn't answer, so Oriel couldn't read the spreadsheets.";
}

// How a connection reads Google, with its credential.
export function googleOf(connection: ToOpen, via: OpenVia) {
  const { credential, refused } = credentialOf(connection.secret, via);
  const google = googleReads({
    fetch: via.fetch ?? fetch,
    credential,
    wait: (ms) => new Promise((done) => setTimeout(done, ms)),
    random: Math.random,
    waiting: (ms) => via.log("sheets: Google asked Oriel to wait", { ms }),
  });
  return { credential, google, refused };
}

// What reads a connection's spreadsheets, and what its writer writes with:
// Google, with its sign-in, or, while Sheets is on through sheets-mcp
// (decision 0059), the server, which has no sign-in of Oriel's.
function readerOf(connection: ToOpen, via: OpenVia) {
  const server = via.server;
  if (server)
    return {
      google: serverGoogle(server.read),
      with: { server: { read: server.read, write: server.write } },
      refused: () => false,
      problem: (error: unknown) => sheetsServerProblem(error, server.known.name),
      through: `, through ${server.known.name}`,
    };
  const { credential, google, refused } = googleOf(connection, via);
  return {
    google,
    with: { credential, ...(via.fetch ? { fetch: via.fetch } : {}) },
    refused,
    problem: sheetsProblem,
    through: "",
  };
}

// What the person sees when Sheets can't be read through its server, naming
// it. A sync that fails this way keeps the index as it was.
export function sheetsServerProblem(error: unknown, server: string): string {
  if (error instanceof ServerUnreadable)
    return `${server} answered in a way Oriel didn't expect, so Oriel kept the window as it was.`;
  if (error instanceof SheetsError && error.status === 401)
    return `${server} isn't signed in to Google. Run \`sheets-mcp login\`, then sync again.`;
  return `Oriel couldn't read the spreadsheets through ${server}, so the window may be behind them. Try again in a moment.`;
}

export async function openSheets(connection: ToOpen, via: OpenVia): Promise<OpenedSheets> {
  const picks = picksOf(connection.options);
  const reader = readerOf(connection, via);
  const { google, refused } = reader;
  const count = picks.spreadsheets.length;
  const readOnly = readOnlyOf(connection.options);
  const context = sheetsContextOf(picks);

  const read = sheetsSource({
    google,
    picks,
    ...(connection.prefix === "sheets" ? {} : { prefix: connection.prefix }),
    log: via.log,
  });
  // Through a server, a sync reads every spreadsheet before it gives one,
  // so an answer it can't read lands nothing.
  const source: SheetsSource = via.server
    ? { ...read, sync: (cursor) => readWhole(read.sync(cursor)) }
    : read;

  return {
    source,
    report: () => reportLines(source.report()),
    attrs: sheetsAttrs,
    about: `${count} ${count === 1 ? "spreadsheet" : "spreadsheets"}${reader.through}`,
    scope: undefined,
    // Each mapped tab's fields, which its namespace offers to write.
    context: () => (readOnly ? undefined : context),
    ...(readOnly
      ? { fields: rowReader(google, picks, connection.prefix) }
      : {
          writes: { ...reader.with, picks, prefix: connection.prefix },
        }),
    // Its cursor holds each spreadsheet's version: one that hasn't moved
    // costs one request and isn't read again.
    incremental: true,
    problem: reader.problem,
    signedOut: refused,
    unfit: () => unfitOf(source.report()),
    names: sheetsNames,
    viewOnly: viewOnlyOf,
  };
}

// Why the connection's options no longer fit its spreadsheets, from its last
// sync: a mapped column gone from a tab's header row, or in it twice, or a
// mapped tab gone. Titles and headers are the sheet's own, shown as text.
function unfitOf(report: SheetsReport): string | null {
  for (const spreadsheet of report.spreadsheets)
    for (const tab of spreadsheet.tabs)
      if (tab.stopped !== undefined) {
        const where = [spreadsheet.title ?? "A spreadsheet", tab.title].filter(Boolean).join(", ");
        return `${where}: not read, since ${tab.stopped}.`;
      }
  return null;
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
