// A Google Sheets connection, opened (decision 0049): its options are the
// spreadsheets the person picked and each one's mapped tabs, and its secret
// is Google's tokens. What identifies it is the Google account, by Drive's
// `permissionId`. It is read-only: it gives no writes.
//
// Reading needs the access token while it lasts. Refreshing it needs Oriel's
// Google client, which the stories that sign a person in pass to it; until
// then a connection whose access token has run out reads as signed out.
import {
  type Credential,
  number,
  object,
  type Opened,
  type OpenVia,
  optional,
  refine,
  string,
  type ToOpen,
} from "@oriel/core";
import { sheetsAttrs } from "./attrs.ts";
import { googleReads, SheetsError } from "./google.ts";
import { type SheetsPicks, sheetsPicks } from "./mapping.ts";
import { type SheetsSource, sheetsSource } from "./source.ts";

export type OpenedSheets = Opened & { source: SheetsSource };

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
  const google = googleReads({
    fetch: via.fetch ?? fetch,
    credential: credentialOf(connection.secret, () => Date.parse(via.now())),
    wait: (ms) => new Promise((done) => setTimeout(done, ms)),
    random: Math.random,
    waiting: (ms) => via.log("sheets: Google asked Oriel to wait", { ms }),
  });
  const count = picks.spreadsheets.length;
  return {
    source: sheetsSource({
      google,
      picks,
      ...(connection.prefix === "sheets" ? {} : { prefix: connection.prefix }),
      log: via.log,
    }),
    attrs: sheetsAttrs,
    about: `${count} ${count === 1 ? "spreadsheet" : "spreadsheets"}`,
    scope: undefined,
    context: () => undefined,
    // Its cursor holds each spreadsheet's version: one that hasn't moved
    // costs one request and isn't read again.
    incremental: true,
    problem: sheetsProblem,
  };
}
