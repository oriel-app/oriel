// Sheets has no conditional write, so each write re-finds its row by key, writes only while the
// cell holds what the diff showed, and reads the row back in case a sort slid another under it.
import {
  type FieldValues,
  type ItemId,
  itemId,
  type Log,
  noteSent,
  parseItemId,
  requestMs,
  SourceRefused,
  type SourceWriter,
  type WriteLimit,
  type WriteResult,
  WriteStalled,
} from "@oriel/core";
import { rowKey } from "./attrs.ts";
import { type Google, googleReads, maxBackoffMs, maxRetries } from "./google.ts";
import { serverGoogle, serverWrites } from "./sheets-mcp.ts";
import { maxRows } from "./grid.ts";
import type { FieldName } from "./mapping.ts";
import type { Cell } from "./table.ts";
import { isSheetsOp, type SheetsArgs, type SheetsOp, sheetsOps } from "./ops.ts";
import { addRowBody, type CellValue, deleteRowBody, editBody } from "./requests.ts";
import {
  cellsAt,
  placeOf,
  rowFinder,
  rowValues,
  stableIdOf,
  type TabRead,
  valueOf,
} from "./rows.ts";
import type { SheetsWrites } from "./open-connection.ts";
import { sheetsOrigin } from "./stand-in.ts";

const requestTimeoutMs = 60_000;
const unsendable =
  "A row added through sheets-mcp can't be taken back: it has no tool to delete one";
const source = "Google Sheets";

// A cell showing a value nobody entered there: an array formula elsewhere
// fills it, and a value written over it would break that formula.
const spilled = (cell: Cell | null | undefined) =>
  cell !== null && cell !== undefined && cell.entered === null && cell.shown !== "";

function said(value: unknown): string {
  if (value === null || value === undefined || value === "") return "nothing";
  const chars = [...String(value).replace(/\s+/g, " ").trim()];
  return `“${chars.length > 60 ? `${chars.slice(0, 59).join("")}…` : chars.join("")}”`;
}

export function sheetsWriter(
  writes: SheetsWrites & {
    wait?: (ms: number) => Promise<void>;
  },
  log: Log,
): SourceWriter<"sheets"> {
  const { picks, prefix } = writes;
  const server = "server" in writes ? writes.server : null;
  const toServer = server && serverWrites(server.write);
  const memory = "memory" in writes ? writes.memory : null;
  const wait = writes.wait ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const where = new Map<string, { spreadsheet: string; sheetId: number }>();

  const reads = (limit?: WriteLimit): Google =>
    server
      ? serverGoogle(server.read)
      : googleReads({
          fetch: (input, init) =>
            memoryOf()(input, {
              ...init,
              signal: AbortSignal.timeout(requestMs(requestTimeoutMs, limit, source)),
            }),
          wait: async (ms) => {
            if (limit && ms > limit.left())
              throw new WriteStalled(
                `${source} asked Oriel to wait longer than it waits on a write`,
              );
            await wait(ms);
          },
          random: Math.random,
        });

  // A `429` is turned away unprocessed, so it goes again; any other refusal changed nothing, since
  // Google applies a batch whole or not at all.
  function memoryOf() {
    if (!memory) throw new Error("Sheets writes through its server");
    return memory;
  }

  const post = async (
    path: string,
    body: unknown,
    limit: WriteLimit | undefined,
    sent: () => void,
  ): Promise<void> => {
    for (let attempt = 0; ; attempt++) {
      let ms: number;
      try {
        ms = requestMs(requestTimeoutMs, limit, source);
      } catch (error) {
        const said = error instanceof Error ? error.message : String(error);
        throw new SourceRefused(said, { sent: attempt > 0, cause: error });
      }
      sent();
      const response = await memoryOf()(new URL(path, sheetsOrigin), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(ms),
      });
      await response.body?.cancel();
      if (response.ok) return;
      if (response.status === 429 && attempt < maxRetries) {
        const ms = Math.min(2 ** attempt * 1000 + Math.floor(Math.random() * 1000), maxBackoffMs);
        if (limit && ms > limit.left())
          throw new SourceRefused(
            `${source} asked Oriel to slow down, and the write ran out of time`,
            {
              sent: true,
            },
          );
        await wait(ms);
        continue;
      }
      if (response.status >= 500)
        throw new Error(`${source} answered ${response.status} to the write`);
      throw new SourceRefused(
        response.status === 403
          ? "Google won't let this account edit the spreadsheet"
          : response.status === 429
            ? `${source} asked Oriel to slow down too often`
            : `${source} refused the write (${response.status})`,
        { sent: true },
      );
    }
  };

  const spreadsheetPath = (id: string, after: string) =>
    `/v4/spreadsheets/${encodeURIComponent(id)}${after}`;

  const editable = async (google: Google, spreadsheet: string) => {
    if (!picks.spreadsheets.some((s) => s.id === spreadsheet))
      throw new Error("Oriel doesn't read that spreadsheet now, so it won't write to it");
    const file = await google.file(spreadsheet);
    if (file === "gone" || file.trashed)
      throw new Error("the spreadsheet isn't in Google Drive any more");
    if (!file.canEdit)
      throw new Error("the person Oriel reads Sheets as can only view that spreadsheet now");
  };

  const target = async (google: Google, id: ItemId<"sheets"> | null, stableId: string | null) => {
    if (id === null || stableId === null) throw new Error("this operation needs a row");
    const parsed = parseItemId(id);
    const place = placeOf(stableId);
    if (parsed?.prefix !== prefix || !place || place.key !== parsed.key)
      throw new Error(`${id} names another row (expected ${stableId})`);
    await editable(google, place.spreadsheet);
    const found = await rowFinder(google, picks, where).find(parsed.key, place);
    if (found === "gone")
      throw new Error(
        "the row isn't in its tab any more, or its key cell changed, so Oriel can't find it",
      );
    if ("stopped" in found) throw new Error(`Oriel can't read the row's tab now: ${found.stopped}`);
    return { ...found, id, stableId, key: parsed.key };
  };

  const rowAt = async (google: Google, at: TabRead, index: number) => {
    const grid = await google.rows(at.spreadsheet, at.tab, index, index + 1, true);
    if (grid === "gone") throw new Error(`${source} lost the spreadsheet as Oriel wrote to it`);
    return cellsAt(grid, index);
  };

  const holds = (at: TabRead, cells: ReturnType<typeof cellsAt>, key: string) => {
    const column = at.columns.key;
    const shown = column === undefined ? "" : (cells[column]?.shown ?? "");
    return rowKey(at.spreadsheet, at.tab.sheetId, shown) === key;
  };

  const setField = async (
    google: Google,
    limit: WriteLimit | undefined,
    sent: () => void,
    request: {
      target: ItemId<"sheets"> | null;
      expectedStableId: string | null;
      seen?: FieldValues;
    },
    { field, value }: SheetsArgs<"setField">,
  ): Promise<WriteResult<"sheets">> => {
    const at = await target(google, request.target, request.expectedStableId);
    const column = at.columns[field];
    if (column === undefined) throw new Error(`the row's tab maps no ${field} column`);
    if (column === at.columns.key)
      throw new Error(`the ${field} cell is the row's key too, and Oriel never changes a key`);
    const cells = cellsAt(at.grid, at.index);
    const entered = cells[column]?.entered;
    if (entered !== null && typeof entered === "object")
      throw new Error(`the ${field} cell holds a formula, and Oriel never writes over one`);
    if (spilled(cells[column]))
      throw new Error(
        `the ${field} cell shows a value a formula elsewhere put there, and Oriel never writes over one`,
      );
    if (
      at.grid.merges.some(
        (m) =>
          m.startRow <= at.index &&
          at.index < m.endRow &&
          m.startColumn <= column &&
          column < m.endColumn,
      )
    )
      throw new Error(
        `the ${field} cell is merged with others, so writing it would change more than this row`,
      );
    const now = valueOf(entered);
    const seen = request.seen ?? {};
    if (Object.hasOwn(seen, field) && seen[field] !== now)
      throw new Error(
        `the ${field} cell holds ${said(now)} now, not ${said(seen[field])} as when you approved this, so Oriel wrote nothing over it`,
      );
    const fields = [field, "cells"];
    const before = rowValues(at.columns, cells, fields);
    if (toServer) {
      sent();
      await toServer.edit(at.spreadsheet, at.tab.title, at.index, column, value);
    } else
      await post(
        spreadsheetPath(at.spreadsheet, "/values:batchUpdate"),
        editBody(at.tab.title, at.index, column, value),
        limit,
        sent,
      );
    const after = await rowAt(google, at, at.index);
    if (!holds(at, after, at.key))
      throw new Error(
        `a sort moved row ${at.index + 1} before the write landed, so the value went into another row: check row ${at.index + 1} of the tab`,
      );
    return {
      item: { id: at.id, stableId: at.stableId },
      before,
      after: rowValues(at.columns, after, fields),
    };
  };

  const addRow = async (
    google: Google,
    limit: WriteLimit | undefined,
    sent: () => void,
    { spreadsheet, sheetId, values }: SheetsArgs<"addRow">,
  ): Promise<WriteResult<"sheets">> => {
    await editable(google, spreadsheet);
    const read = await rowFinder(google, picks, where).readTab(spreadsheet, sheetId);
    if (read === "gone")
      throw new Error("Oriel doesn't read that tab now, so it won't add a row to it");
    if ("stopped" in read) throw new Error(`Oriel can't read the tab now: ${read.stopped}`);
    // A row past the cap couldn't be read back, or reverted.
    if (read.capped || read.last - (read.mapping.header - 1) >= maxRows)
      throw new Error("the tab is past the rows Oriel reads, so it won't add one");
    const given = Object.entries(values).filter(([, v]) => v !== undefined) as [
      FieldName,
      CellValue,
    ][];
    const unmapped = given.find(([field]) => read.columns[field] === undefined);
    if (unmapped) throw new Error(`the tab maps no ${unmapped[0]} column`);
    const key = values.key.normalize("NFC").trim();
    const keyColumn = read.columns.key ?? 0;
    const taken = read.grid.rows.some(
      (row, r) =>
        r > read.mapping.header - 1 - read.grid.startRow &&
        (row[keyColumn]?.shown ?? "").normalize("NFC").trim() === key,
    );
    if (taken) throw new Error("a row in the tab has that key already");
    const clash = given.find(([field, value]) =>
      given.some(
        ([other, v]) =>
          other !== field && read.columns[other] === read.columns[field] && v !== value,
      ),
    );
    if (clash) throw new Error(`the ${clash[0]} column is another field's too, and they differ`);
    const above = cellsAt(read.grid, read.last);
    const filled = given.find(([field]) => spilled(above[read.columns[field] ?? 0]));
    if (filled && read.last > read.mapping.header - 1)
      throw new Error(`a formula fills the ${filled[0]} column, and Oriel never writes over one`);
    const width = Math.max(...given.map(([field]) => read.columns[field] ?? 0)) + 1;
    const cells: CellValue[] = Array.from({ length: width }, () => null);
    for (const [field, value] of given) cells[read.columns[field] ?? 0] = value;
    let index = read.last + 1;
    if (toServer) {
      sent();
      // After the table, where its server's append puts it, which may be
      // past rows a sync skips as blank.
      index = await toServer.append(
        spreadsheet,
        read.tab.title,
        read.mapping.header,
        read.last,
        cells,
      );
      if (index < read.mapping.header || index > read.last + 1)
        throw new Error(
          `the new row went in at row ${index + 1}, outside the table Oriel reads, so check the tab`,
        );
    } else
      await post(
        spreadsheetPath(spreadsheet, ":batchUpdate"),
        addRowBody(sheetId, index, cells, read.last === read.mapping.header - 1),
        limit,
        sent,
      );
    const hash = rowKey(spreadsheet, sheetId, key);
    const id = itemId(prefix, hash) as ItemId<"sheets">;
    const after = await rowAt(google, read, index);
    if (!holds(read, after, hash))
      throw new Error(
        `the new row isn't where Oriel put it, after row ${index}: someone sorted or moved rows as it landed, so check the tab`,
      );
    where.set(hash, { spreadsheet, sheetId });
    return {
      item: { id, stableId: stableIdOf(spreadsheet, sheetId, hash) },
      before: {},
      after: rowValues(read.columns, after, [...given.map(([field]) => field), "cells"]),
    };
  };

  const deleteRow = async (
    google: Google,
    limit: WriteLimit | undefined,
    sent: () => void,
    request: { target: ItemId<"sheets"> | null; expectedStableId: string | null },
  ): Promise<WriteResult<"sheets">> => {
    if (toServer) throw new SourceRefused(unsendable, { sent: false });
    const at = await target(google, request.target, request.expectedStableId);
    const fields = [...Object.keys(at.columns), "cells"];
    const before = rowValues(at.columns, cellsAt(at.grid, at.index), fields);
    await post(
      spreadsheetPath(at.spreadsheet, ":batchUpdate"),
      deleteRowBody(at.tab.sheetId, at.index),
      limit,
      sent,
    );
    const still = await rowFinder(google, picks, where).find(at.key, {
      spreadsheet: at.spreadsheet,
      sheetId: at.tab.sheetId,
    });
    if (still !== "gone" && !("stopped" in still))
      throw new Error(
        `Oriel deleted row ${at.index + 1}, but the row it meant to is still in the tab: a sort moved it first. Restore row ${at.index + 1} from the spreadsheet's version history`,
      );
    return { item: { id: at.id, stableId: at.stableId }, before, after: {} };
  };

  const values = async (id: ItemId<"sheets">, fields: readonly string[]) => {
    const parsed = parseItemId(id);
    if (parsed?.prefix !== prefix) return "gone" as const;
    const found = await rowFinder(reads(), picks, where).find(parsed.key);
    if (found === "gone" || "stopped" in found) return "gone" as const;
    return {
      stableId: stableIdOf(found.spreadsheet, found.tab.sheetId, parsed.key),
      values: rowValues(found.columns, cellsAt(found.grid, found.index), fields),
    };
  };

  return {
    kind: "sheets",
    ...(toServer ? { unsendable: { deleteRow: unsendable } } : {}),
    apply: async ({ op, target: id, expectedStableId, args, seen }, limit) => {
      const google = reads(limit);
      try {
        return await noteSent(async (sent) => {
          if (!isSheetsOp(op)) throw new Error(`not a Sheets operation: ${op}`);
          if ((id === null) !== (expectedStableId === null))
            throw new Error(
              `${op}: a target needs the stable ID to check it against, and only one does`,
            );
          const request = { target: id, expectedStableId, ...(seen ? { seen } : {}) };
          switch (op) {
            case "setField":
              return await setField(google, limit, sent, request, valid("setField", args));
            case "addRow":
              if (id !== null) throw new Error("addRow: a new row has no target");
              return await addRow(google, limit, sent, valid("addRow", args));
            case "deleteRow":
              valid("deleteRow", args);
              return await deleteRow(google, limit, sent, request);
          }
        });
      } catch (error) {
        if (!(error instanceof SourceRefused))
          log("sheets: wrote, but the write may not have landed as asked", {
            op,
            error: error instanceof Error ? error.message : String(error),
          });
        throw error;
      }
    },
    current: async (id, fields) => {
      const found = await values(id, fields);
      return found === "gone" ? found : found.values;
    },
    read: values,
    name: async (id) => {
      const [spreadsheet = "", sheetId] = id.split("/");
      if (!picks.spreadsheets.some((s) => s.id === spreadsheet)) return null;
      const info = await reads().tabs(spreadsheet);
      if (info === "gone") return null;
      if (sheetId === undefined) return info.title;
      return info.tabs.find((t) => String(t.sheetId) === sheetId)?.title ?? null;
    },
  };
}

function valid<O extends SheetsOp>(op: O, args: unknown): SheetsArgs<O> {
  const result = sheetsOps[op].args(args, "$.args");
  if (result.ok) return result.value as SheetsArgs<O>;
  const at = result.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
  throw new Error(`${op}: bad arguments (${at})`);
}

export function sheetsWriterOf(writes: SheetsWrites, log: Log): SourceWriter<"sheets"> {
  return sheetsWriter(writes, log);
}
