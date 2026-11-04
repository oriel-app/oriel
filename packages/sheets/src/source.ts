// Google Sheets as a source (decision 0050), read-only for now: only the
// spreadsheets the person picked, and in each only the tabs they mapped. An
// item is a row of a mapped tab, keyed by its key cell, or a spreadsheet
// itself, a doc.
//
// A sync asks Drive for each spreadsheet's `version`, and reads only those
// whose version moved or whose mapping changed since the cursor: an
// unchanged spreadsheet costs one request and changes nothing in the index.
// A spreadsheet it reads is listed in full (`SyncPage.swept`), so its rows
// that are gone, and its tabs no longer mapped, leave the index; a tab whose
// mapping no longer fits its header row, or a spreadsheet that didn't
// answer, keeps what the index had (`SyncPage.held`). One Drive can't find,
// or one in the bin, is gone.
//
// Caps, as the folder's walk has: 5,000 rows a tab, 20 mapped tabs and 50
// spreadsheets a connection, and 50,000 characters an item. What a sync
// didn't read, and why, is in `report()`.
import {
  type Instant,
  instant,
  itemId,
  type ItemId,
  type Log,
  parseItemId,
  type ReadResult,
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
import type { DriveFile, Google, SheetComment, TabInfo } from "./google.ts";
import {
  mappingPrint,
  type SheetsPicks,
  type SpreadsheetPick,
  type TabMapping,
} from "./mapping.ts";
import { type Grid, type TableRow, tableOf } from "./table.ts";

export type SheetsSource = Source<"sheets", SheetsAttrs, SheetsContent> & {
  // What the last sync or read didn't read, and why.
  report(): SheetsReport;
};

export type SheetsSourceOptions = {
  google: Google;
  picks: SheetsPicks;
  // Its connection's prefix, when it isn't the kind's first.
  prefix?: string;
  log: Log;
};

export const maxRows = 5_000;
export const maxTabs = 20;
export const maxSpreadsheets = 50;
// About Google's recommended 2 MB a request, at a generous 100 bytes a cell.
const chunkCells = 20_000;

// Per tab: why its sync stopped, or which rows aren't items yet and what
// wasn't read. Row numbers are as the sheet shows them.
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
    // It isn't there to read, or didn't answer this time.
    problem?: "gone" | "failed";
    tabs: TabReport[];
  }[];
  // Picks past the caps, which weren't read.
  unread: { spreadsheets: number; tabs: number };
};

// What a sync has read, per spreadsheet: its version, its mappings in short,
// and the tabs it mapped.
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

// One spreadsheet as read: each mapped tab's rows, or why it stopped.
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
  // The picks within the caps.
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
  // What was last read of each spreadsheet, by its ID, for reads.
  const cache = new Map<string, Read>();
  const reports = new Map<string, SheetsReport["spreadsheets"][number]>();

  // A mapped tab's grid from its header row down, in chunks of rows, until
  // the table has surely ended or is past the cap.
  async function gridOf(id: string, tab: TabInfo, mapping: TabMapping): Promise<Grid | "gone"> {
    const chunk = Math.max(100, Math.floor(chunkCells / Math.max(tab.columns, 1)));
    const start = mapping.header - 1;
    const grid: Grid & { rows: Grid["rows"][number][] } = {
      startRow: start,
      rows: [],
      hiddenRows: new Set(),
      hiddenColumns: new Set(),
      merges: [],
    };
    const merges = new Map<string, Grid["merges"][number]>();
    let filled = 0;
    for (let from = start; from < tab.rows; from += chunk) {
      const to = Math.min(from + chunk, tab.rows);
      const part = await google.rows(id, tab, from, to);
      if (part === "gone") return part;
      const rows = part.rows;
      for (let r = 0; r < to - from; r++) grid.rows[from - start + r] = [...(rows[r] ?? [])];
      for (const r of part.hiddenRows) (grid.hiddenRows as Set<number>).add(r);
      for (const c of part.hiddenColumns) (grid.hiddenColumns as Set<number>).add(c);
      for (const m of part.merges) merges.set(JSON.stringify(m), m);
      filled += rows.slice(from === start ? 1 : 0).filter((row) => row.some(Boolean)).length;
      // Google leaves out the empty rows at a range's end: nothing follows.
      if (rows.length < to - from) break;
      if (filled > maxRows) break;
      if (
        mapping.end === "blank" &&
        endsIn(rows, from === start ? 1 : 0, from, [...merges.values()])
      )
        break;
    }
    return { ...grid, merges: [...merges.values()] };
  }

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
        // A deleted tab: its rows are gone.
        report.push({
          ...blank,
          title: null,
          stopped: "the tab isn't in the spreadsheet any more",
        });
        continue;
      }
      const grid = await gridOf(pick.id, tab, mapping);
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
        capped: table.capped,
      });
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

  // The spreadsheet's records, and each one's text for Oriel's sync to find
  // references in.
  function recordsOf(
    id: string,
    read: Read,
  ): { records: SheetsRecord[]; texts: Record<string, string> } {
    const updatedAt = instantOf(read.file.modifiedTime);
    const spreadsheet = { id, title: read.title };
    const records: SheetsRecord[] = [];
    const texts: Record<string, string> = {};
    // Rows by their key cell, this tab's first, for a parent column.
    const byKey = (sheetId: number, key: string) => {
      const own = read.tables.get(sheetId);
      const found =
        own && "rows" in own && own.rows.some((r) => r.key === key)
          ? [sheetId]
          : [...read.tables].flatMap(([other, t]) =>
              other !== sheetId && "rows" in t && t.rows.some((r) => r.key === key) ? [other] : [],
            );
      // A name two tabs share names neither.
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
    texts[docStable] = spreadsheetText(spreadsheetContentOf(read)).text;
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

  // Reads the spreadsheet if its version or mapping moved since `known`,
  // and keeps what it read. Null when unchanged.
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

  // What's read of the spreadsheet now: from the cache while its version
  // hasn't moved.
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
          // It keeps what the index had, and is read again next time.
          log("sheets: a spreadsheet didn't read", {
            error: error instanceof Error ? error.message : String(error),
          });
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
        next[pick.id] = { version: file.version, print: read.print };
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
      // Spreadsheets no longer picked leave with their rows.
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
      // Every spreadsheet whose version moved is read again, once, before
      // any row is looked for: a row can be anywhere in its tab.
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

// Whether a blank row ends the table within these rows: one with nothing in
// it that no merge reaches into.
function endsIn(rows: Grid["rows"], from: number, top: number, merges: Grid["merges"]): boolean {
  for (let r = from; r < rows.length; r++) {
    const index = top + r;
    if ((rows[r] ?? []).some(Boolean)) continue;
    if (!merges.some((m) => m.startRow < index && index < m.endRow)) return true;
  }
  return false;
}

function spreadsheetContentOf(read: Read): SpreadsheetContent {
  const tabs = read.tabs.map((t) => t.title);
  const { text } = spreadsheetText({ tabs, comments: read.comments });
  return {
    of: "spreadsheet",
    spreadsheet: { id: read.id, title: read.title },
    tabs,
    comments: read.comments,
    title: read.title,
    text,
  };
}

function rowContentOf(read: Read, tab: TabInfo, row: TableRow): RowContent {
  const { text, note } = rowText(row.cells);
  // Past the cap, the cells the text cut aren't read either.
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
