import {
  type IndexRecord,
  type Opened,
  type OpenVia,
  readOnlyOf,
  readWhole,
  ServerUnreadable,
  type ToolCaller,
  type ToOpen,
} from "@oriel/core";
import { sheetsAttrs, sheetsAttrsOf } from "./attrs.ts";
import { googleReads, SheetsError } from "./google.ts";
import { type SheetsPicks, sheetsPicks } from "./mapping.ts";
import { type SheetsContext, sheetsContextOf } from "./namespace.ts";
import { reportLines } from "./report.ts";
import { rowReader } from "./rows.ts";
import { serverGoogle } from "./sheets-mcp.ts";
import { type SheetsReport, type SheetsSource, sheetsSource } from "./source.ts";

export type SheetsWrites = {
  picks: SheetsPicks;
  prefix: string;
} & ({ memory: typeof fetch } | { server: { read: ToolCaller; write: ToolCaller } });

export type OpenedSheets = Opened<SheetsContext, unknown, SheetsWrites> & { source: SheetsSource };

export { readOnlyOf };

export function picksOf(options: Readonly<Record<string, unknown>>): SheetsPicks {
  const read = sheetsPicks(options);
  return read.ok ? read.value : { spreadsheets: [] };
}

export const memoryProblem = (): string =>
  "Google didn't answer, so Oriel couldn't read the spreadsheets.";

const memoryOf = (via: OpenVia): typeof fetch => {
  if (!via.fetch) throw new Error("Sheets opens only through its source server");
  return via.fetch;
};
export function memoryGoogle(via: OpenVia) {
  return googleReads({
    fetch: memoryOf(via),
    wait: (ms) => new Promise((done) => setTimeout(done, ms)),
    random: Math.random,
    waiting: (ms) => via.log("sheets: Google asked Oriel to wait", { ms }),
  });
}

function readerOf(via: OpenVia) {
  const server = via.server;
  if (server)
    return {
      google: serverGoogle(server.read),
      with: { server: { read: server.read, write: server.write } },
      problem: (error: unknown) => sheetsServerProblem(error, server.known.name),
      through: `, through ${server.known.name}`,
    };
  return {
    google: memoryGoogle(via),
    with: { memory: memoryOf(via) },
    problem: memoryProblem,
    through: "",
  };
}

export function sheetsServerProblem(error: unknown, server: string): string {
  if (error instanceof ServerUnreadable)
    return `${server} answered in a way Oriel didn't expect, so Oriel kept the window as it was.`;
  if (error instanceof SheetsError && error.status === 401)
    return `${server} isn't signed in to Google. Run \`sheets-mcp login\`, then sync again.`;
  return `Oriel couldn't read the spreadsheets through ${server}, so the window may be behind them. Try again in a moment.`;
}

export async function openSheets(connection: ToOpen, via: OpenVia): Promise<OpenedSheets> {
  const picks = picksOf(connection.options);
  const reader = readerOf(via);
  const { google } = reader;
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
    context: () => (readOnly ? undefined : context),
    ...(readOnly
      ? { fields: rowReader(google, picks, connection.prefix) }
      : {
          writes: { ...reader.with, picks, prefix: connection.prefix },
        }),
    incremental: true,
    problem: reader.problem,
    unfit: () => unfitOf(source.report()),
    names: sheetsNames,
    viewOnly: viewOnlyOf,
  };
}

// Titles and headers are the sheet's own, shown as text.
function unfitOf(report: SheetsReport): string | null {
  for (const spreadsheet of report.spreadsheets)
    for (const tab of spreadsheet.tabs)
      if (tab.stopped !== undefined) {
        const where = [spreadsheet.title ?? "A spreadsheet", tab.title].filter(Boolean).join(", ");
        return `${where}: not read, since ${tab.stopped}.`;
      }
  return null;
}

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

function* sheetsNames(records: readonly IndexRecord[]): Iterable<readonly [string, string]> {
  for (const record of records) {
    const attrs = sheetsAttrsOf(record);
    if (!attrs) continue;
    yield [attrs.spreadsheet.id, attrs.spreadsheet.title];
    if (attrs.of === "row") yield [`${attrs.spreadsheet.id}/${attrs.tab.sheetId}`, attrs.tab.title];
  }
}
