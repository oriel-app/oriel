import {
  type Instant,
  instant,
  itemId,
  type ItemId,
  type Log,
  parseItemId,
  type ReadResult,
  ServerUnreadable,
  type Source,
  type SyncPage,
} from "@oriel/core";
import {
  maxItemChars,
  type RowContent,
  rowKey,
  rowText,
  type SheetsAttrs,
  type SheetsContent,
  type SheetsRecord,
  type SpreadsheetContent,
  sheetUrl,
  spreadsheetKey,
  spreadsheetPart,
  spreadsheetText,
  tabPart,
} from "./attrs.ts";
import {
  type DriveFile,
  type Google,
  type SheetComment,
  SheetsError,
  type TabInfo,
} from "./google.ts";
import { mappingPrint, type SheetsPicks, type SpreadsheetPick } from "./mapping.ts";
import { maxRows, readGrid } from "./grid.ts";
import { type TableRow, tableOf } from "./table.ts";

export type SheetsSource = Source<"sheets", SheetsAttrs, SheetsContent> & {
  report(): SheetsReport;
};

export type SheetsSourceOptions = {
  google: Google;
  picks: SheetsPicks;
  prefix?: string;
  log: Log;
};

export { maxRows };
export const maxTabs = 20;
export const maxSpreadsheets = 50;

export type TabReport = {
  sheetId: number;
  title: string | null;
  stopped?: string;
  duplicates: number[];
  keyless: number[];
  hidden: number;
  capped: boolean;
};

export type SheetsReport = {
  spreadsheets: {
    id: string;
    title: string | null;
    problem?: "gone" | "failed";
    tabs: TabReport[];
  }[];
  unread: { spreadsheets: number; tabs: number };
};

type Cursor = Record<string, { version: string; print: string }>;

function parseCursor(text: string | null): Cursor | null {
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const files = (parsed as { files?: unknown }).files;
    if (typeof files !== "object" || files === null) return null;
    return Object.fromEntries(
      Object.entries(files).filter(
        ([, v]) =>
          typeof v === "object" &&
          v !== null &&
          typeof (v as { version?: unknown }).version === "string" &&
          typeof (v as { print?: unknown }).print === "string",
      ),
    ) as Cursor;
  } catch {
    return null;
  }
}

type Read = {
  id: string;
  file: DriveFile;
  title: string;
  tabs: TabInfo[];
  comments: SheetComment[];
  print: string;
  tables: Map<number, { tab: TabInfo; rows: TableRow[] } | { stopped: string }>;
  report: TabReport[];
};

export function sheetsSource(options: SheetsSourceOptions): SheetsSource {
  const { google, log } = options;
  const prefix = options.prefix ?? "sheets";
  let tabsLeft = maxTabs;
  const picks: SpreadsheetPick[] = options.picks.spreadsheets
    .slice(0, maxSpreadsheets)
    .map((pick) => {
      const tabs = pick.tabs.slice(0, Math.max(tabsLeft, 0));
      tabsLeft -= pick.tabs.length;
      return { id: pick.id, tabs };
    });
  const unread = {
    spreadsheets: Math.max(options.picks.spreadsheets.length - maxSpreadsheets, 0),
    tabs:
      options.picks.spreadsheets.reduce((n, s) => n + s.tabs.length, 0) -
      picks.reduce((n, s) => n + s.tabs.length, 0),
  };
  const cache = new Map<string, Read>();
  const reports = new Map<string, SheetsReport["spreadsheets"][number]>();

  async function readSpreadsheet(pick: SpreadsheetPick, file: DriveFile): Promise<Read | "gone"> {
    const info = await google.tabs(pick.id);
    if (info === "gone") return info;
    const tables: Read["tables"] = new Map();
    const report: TabReport[] = [];
    for (const mapping of pick.tabs) {
      const tab = info.tabs.find((t) => t.sheetId === mapping.sheetId);
      const blank = {
        sheetId: mapping.sheetId,
        duplicates: [],
        keyless: [],
        hidden: 0,
        capped: false,
      };
      if (!tab) {
        report.push({
          ...blank,
          title: null,
          stopped: "the tab isn't in the spreadsheet any more",
        });
        continue;
      }
      const grid = await readGrid(google, pick.id, tab, mapping);
      if (grid === "gone") return grid;
      const table = tableOf(grid, mapping, maxRows);
      if ("stopped" in table) {
        tables.set(tab.sheetId, table);
        report.push({ ...blank, title: tab.title, stopped: table.stopped });
        continue;
      }
      tables.set(tab.sheetId, { tab, rows: table.rows });
      report.push({
        sheetId: tab.sheetId,
        title: tab.title,
        duplicates: table.duplicates,
        keyless: table.keyless,
        hidden: table.hidden,
        capped: table.capped || (mapping.end === "grid" && mapping.header + maxRows + 1 < tab.rows),
      });
    }
    // Two key cells whose hashes match, which only someone set on it could make, name neither row.
    const hashes = Map.groupBy(
      [...tables].flatMap(([sheetId, t]) =>
        "rows" in t ? t.rows.map((row) => ({ sheetId, row })) : [],
      ),
      ({ sheetId, row }) => rowKey(pick.id, sheetId, row.key),
    );
    for (const [, same] of hashes) {
      if (same.length < 2) continue;
      for (const { sheetId, row } of same) {
        const table = tables.get(sheetId);
        if (table && "rows" in table) table.rows = table.rows.filter((r) => r !== row);
        report.find((r) => r.sheetId === sheetId)?.duplicates.push(row.number);
      }
    }
    const comments = await google.comments(pick.id);
    return {
      id: pick.id,
      file,
      title: info.title,
      tabs: info.tabs,
      comments,
      print: mappingPrint(pick),
      tables,
      report,
    };
  }

  function recordsOf(
    id: string,
    read: Read,
  ): { records: SheetsRecord[]; texts: Record<string, string> } {
    const updatedAt = instantOf(read.file.modifiedTime);
    const spreadsheet = { id, title: read.title };
    const records: SheetsRecord[] = [];
    const texts: Record<string, string> = {};
    const byKey = (sheetId: number, key: string) => {
      const own = read.tables.get(sheetId);
      const found =
        own && "rows" in own && own.rows.some((r) => r.key === key)
          ? [sheetId]
          : [...read.tables].flatMap(([other, t]) =>
              other !== sheetId && "rows" in t && t.rows.some((r) => r.key === key) ? [other] : [],
            );
      return found.length === 1 && found[0] !== undefined ? found[0] : null;
    };
    const docKey = spreadsheetKey(id);
    const docStable = spreadsheetPart(id);
    records.push({
      id: itemId(prefix, docKey) as ItemId<"sheets">,
      stableId: docStable,
      title: read.title,
      location: sheetUrl(id),
      updatedAt,
      facets: { kind: "doc" },
      attrs: { of: "spreadsheet", spreadsheet, canEdit: read.file.canEdit },
    });
    texts[docStable] = spreadsheetContentOf(read).text;
    for (const [sheetId, table] of read.tables) {
      if (!("rows" in table)) continue;
      for (const row of table.rows) {
        const key = rowKey(id, sheetId, row.key);
        const stableId = `${tabPart(id, sheetId)}${key}`;
        const { fields } = row;
        const parentTab =
          fields.parent === undefined || fields.parent === null || fields.parent === row.key
            ? null
            : byKey(sheetId, fields.parent);
        const parentKey =
          parentTab === null || !fields.parent ? null : rowKey(id, parentTab, fields.parent);
        records.push({
          id: itemId(prefix, key) as ItemId<"sheets">,
          stableId,
          title: fields.title,
          location: sheetUrl(id, sheetId),
          updatedAt,
          facets: {
            kind: fields.state === undefined ? "row" : "task",
            ...(fields.state !== undefined && fields.state !== null && { state: fields.state }),
            ...(fields.assignee !== undefined && {
              people: fields.assignee
                ? [{ role: "assignee", id: fields.assignee, name: fields.assignee }]
                : [],
            }),
            ...(fields.estimate !== undefined && { estimate: fields.estimate }),
            ...(fields.link !== undefined && {
              links: fields.link ? [{ url: fields.link, title: fields.link }] : [],
            }),
            ...(fields.parent !== undefined && {
              container:
                parentTab === null || parentKey === null
                  ? null
                  : {
                      id: itemId(prefix, parentKey),
                      stableId: `${tabPart(id, parentTab)}${parentKey}`,
                    },
            }),
          },
          attrs: {
            of: "row",
            spreadsheet,
            tab: { sheetId, title: table.tab.title },
            status: fields.status ?? null,
          },
        });
        texts[stableId] = rowText(row.cells).text;
      }
    }
    return { records, texts };
  }

  async function fresh(
    pick: SpreadsheetPick,
    known: { version: string; print: string } | undefined,
  ): Promise<{ file: DriveFile; read: Read | null } | "gone"> {
    const file = await google.file(pick.id);
    if (file === "gone" || file.trashed) return "gone";
    const print = mappingPrint(pick);
    if (known && known.version === file.version && known.print === print)
      return { file, read: null };
    const read = await readSpreadsheet(pick, file);
    if (read === "gone") return read;
    cache.set(pick.id, read);
    reports.set(pick.id, { id: pick.id, title: read.title, tabs: read.report });
    return { file, read };
  }

  const gone = (id: string) => {
    cache.delete(id);
    reports.set(id, { id, title: null, problem: "gone", tabs: [] });
  };

  async function current(pick: SpreadsheetPick): Promise<Read | "gone"> {
    const had = cache.get(pick.id);
    const got = await fresh(pick, had && { version: had.file.version, print: had.print });
    if (got === "gone") {
      gone(pick.id);
      return got;
    }
    return got.read ?? had ?? "gone";
  }

  function readRow(id: ItemId<"sheets">, key: string): ReadResult<"sheets", SheetsContent> | null {
    for (const [spreadsheetId, read] of cache) {
      if (key === spreadsheetKey(spreadsheetId))
        return { id, status: "ok", content: spreadsheetContentOf(read) };
      for (const [sheetId, table] of read.tables) {
        if (!("rows" in table)) continue;
        const row = table.rows.find((r) => rowKey(spreadsheetId, sheetId, r.key) === key);
        if (row) return { id, status: "ok", content: rowContentOf(read, table.tab, row) };
      }
    }
    return null;
  }

  return {
    kind: "sheets",
    ...(options.prefix && { prefix: options.prefix }),

    async *sync(cursorText) {
      const known = parseCursor(cursorText) ?? {};
      const next: Cursor = {};
      const picked = new Set(picks.map((p) => p.id));
      for (const pick of picks) {
        let got: Awaited<ReturnType<typeof fresh>>;
        try {
          got = await fresh(pick, known[pick.id]);
        } catch (error) {
          if (
            error instanceof ServerUnreadable ||
            (error instanceof SheetsError && error.status === 401)
          )
            throw error;
          log("sheets: a spreadsheet didn't read", {
            error: error instanceof Error ? error.message : String(error),
          });
          // Kept with no version, so it is read again next time, and goes
          // if it is no longer picked.
          next[pick.id] = { version: "", print: "" };
          reports.set(pick.id, {
            id: pick.id,
            title: cache.get(pick.id)?.title ?? null,
            problem: "failed",
            tabs: [],
          });
          yield { records: [], gone: [], cursor: null, held: [spreadsheetPart(pick.id)] };
          continue;
        }
        if (got === "gone") {
          gone(pick.id);
          yield { records: [], gone: [], cursor: null, swept: [spreadsheetPart(pick.id)] };
          continue;
        }
        const { file, read } = got;
        if (!read) {
          next[pick.id] = { version: file.version, print: mappingPrint(pick) };
          continue;
        }
        // A stopped tab keeps no version, so it's read again next time, across restarts.
        const stopped = read.report.some((tab) => tab.stopped !== undefined);
        next[pick.id] = { version: stopped ? "" : file.version, print: read.print };
        const { records, texts } = recordsOf(pick.id, read);
        const page: SyncPage<"sheets", SheetsAttrs> = {
          records,
          gone: [],
          cursor: null,
          texts,
          swept: [spreadsheetPart(pick.id)],
          held: [...read.tables].flatMap(([sheetId, t]) =>
            "stopped" in t ? [tabPart(pick.id, sheetId)] : [],
          ),
        };
        yield page;
      }
      const tabs = [...reports.values()].flatMap((r) => r.tabs);
      const missed = {
        failed: [...reports.values()].filter((r) => r.problem === "failed").length,
        stopped: tabs.filter((t) => t.stopped).length,
        duplicates: tabs.reduce((n, t) => n + t.duplicates.length, 0),
        keyless: tabs.reduce((n, t) => n + t.keyless.length, 0),
        capped: tabs.filter((t) => t.capped).length,
        spreadsheetsPastCap: unread.spreadsheets,
        tabsPastCap: unread.tabs,
      };
      if (Object.values(missed).some(Boolean)) log("sheets: some of it wasn't read", missed);
      const dropped = Object.keys(known).filter((id) => !picked.has(id));
      for (const id of dropped) {
        cache.delete(id);
        reports.delete(id);
      }
      yield {
        records: [],
        gone: [],
        cursor: JSON.stringify({ files: next }),
        swept: dropped.map(spreadsheetPart),
      };
    },

    async read(ids) {
      const results: ReadResult<"sheets", SheetsContent>[] = [];
      const wanted = ids.flatMap((id) => {
        const parsed = parseItemId(id);
        return parsed?.prefix === prefix ? [{ id, key: parsed.key }] : [];
      });
      if (wanted.length)
        for (const pick of picks) {
          if ((await current(pick)) === "gone") continue;
        }
      for (const { id, key } of wanted)
        results.push(readRow(id, key) ?? { id, status: "gone", reason: "deleted" });
      for (const id of ids)
        if (!wanted.some((w) => w.id === id))
          results.push({ id, status: "gone", reason: "forbidden" });
      return results;
    },

    report: () => ({
      spreadsheets: picks.flatMap((pick) => {
        const report = reports.get(pick.id);
        return report ? [report] : [];
      }),
      unread,
    }),
  };
}

function spreadsheetContentOf(read: Read): SpreadsheetContent {
  return {
    of: "spreadsheet",
    spreadsheet: { id: read.id, title: read.title },
    ...spreadsheetText({ tabs: read.tabs.map((t) => t.title), comments: read.comments }),
    title: read.title,
  };
}

function rowContentOf(read: Read, tab: TabInfo, row: TableRow): RowContent {
  const { text, note } = rowText(row.cells);
  let used = 0;
  const cells =
    note === null
      ? row.cells
      : row.cells.filter((cell) => {
          used += cell.header.length + cell.value.length + (cell.note?.length ?? 0);
          return used <= maxItemChars;
        });
  return {
    of: "row",
    spreadsheet: { id: read.id, title: read.title },
    tab: { sheetId: tab.sheetId, title: tab.title },
    row: row.number,
    cells,
    note,
    title: row.fields.title,
    text,
  };
}

function instantOf(text: string): Instant {
  const at = Date.parse(text);
  return instant(new Date(Number.isNaN(at) ? 0 : at));
}
