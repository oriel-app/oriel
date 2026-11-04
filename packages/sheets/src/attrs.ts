// What the index keeps per Sheets item beyond core's fields, what a read
// returns, and how Sheets shows in the window (decision 0050). An item is a
// row of a mapped tab, or a whole picked spreadsheet, a doc. Every title,
// header, cell, note, comment and tab name here is synced content: anyone
// with edit access wrote it.
import { createHash } from "node:crypto";
import {
  array,
  boolean,
  type DetailsOf,
  type IndexRecord,
  literal,
  nullable,
  number,
  object,
  type PanelBlock,
  type PanelOf,
  parseItemId,
  type Presentation,
  string,
  union,
  type Validator,
} from "@oriel/core";

// What an item is, in the declarations' `Item` (see `ItemDocs` in
// bindings): shape only, never source text.
export const sheetsItemDoc =
  "A sheets item is a row of a spreadsheet's mapped tab: its title is its title cell, its text each column read as `Header: value` lines, with cell notes. Or it is a picked spreadsheet itself: its title, its tabs' names and its comments. A row's update time is its spreadsheet's.";

// A fixed-length hash, so no text a person wrote reaches a key: a row's of
// its spreadsheet's ID, its tab's `sheetId` and its key cell, trimmed; a
// spreadsheet's of its ID alone.
export const sheetsKeyShape = /^[0-9a-f]{16}$/;

const hash = (...parts: string[]) =>
  createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16);

export const rowKey = (spreadsheetId: string, sheetId: number, key: string) =>
  hash(spreadsheetId, String(sheetId), key.normalize("NFC").trim());
export const spreadsheetKey = (spreadsheetId: string) => hash(spreadsheetId);

// Stable IDs start with their spreadsheet's ID, then a row's tab's, so a
// sync can list one spreadsheet, or one tab, in full (`SyncPage.swept`).
export const spreadsheetPart = (spreadsheetId: string) => `${spreadsheetId}/`;
export const tabPart = (spreadsheetId: string, sheetId: number) => `${spreadsheetId}/${sheetId}/`;

export const sheetUrl = (spreadsheetId: string, sheetId?: number) =>
  `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit${sheetId === undefined ? "" : `#gid=${sheetId}`}`;

export type SheetsAttrs =
  | {
      of: "row";
      spreadsheet: { id: string; title: string };
      tab: { sheetId: number; title: string };
      // What its status cell shows, when the tab maps one.
      status: string | null;
    }
  | { of: "spreadsheet"; spreadsheet: { id: string; title: string }; canEdit: boolean };

export type SheetsRecord = IndexRecord<"sheets", SheetsAttrs>;

const spreadsheet = object({ id: string, title: string });

export const sheetsAttrs: Validator<SheetsAttrs> = union(
  object({
    of: literal("row"),
    spreadsheet,
    tab: object({ sheetId: number, title: string }),
    status: nullable(string),
  }),
  object({ of: literal("spreadsheet"), spreadsheet, canEdit: boolean }),
);

const said = { author: string, at: string, text: string };

// A row read live: where it is now, and every column read, in order.
export type RowContent = {
  of: "row";
  spreadsheet: { id: string; title: string };
  tab: { sheetId: number; title: string };
  // Its number as the sheet shows it now.
  row: number;
  cells: { header: string; value: string; note: string | null }[];
  // Oriel's words when the row is too long to read whole; null otherwise.
  note: string | null;
  title: string;
  text: string;
};

// A spreadsheet read live: its tabs' names and its comments, oldest first.
export type SpreadsheetContent = {
  of: "spreadsheet";
  spreadsheet: { id: string; title: string };
  tabs: string[];
  comments: {
    author: string;
    at: string;
    text: string;
    resolved: boolean;
    quoted: string | null;
    replies: { author: string; at: string; text: string }[];
  }[];
  // Oriel's words when its comments are too long to read whole; null
  // otherwise.
  note: string | null;
  title: string;
  text: string;
};

export type SheetsContent = RowContent | SpreadsheetContent;

export const sheetsContent: Validator<SheetsContent> = union(
  object({
    of: literal("row"),
    spreadsheet,
    tab: object({ sheetId: number, title: string }),
    row: number,
    cells: array(object({ header: string, value: string, note: nullable(string) })),
    note: nullable(string),
    title: string,
    text: string,
  }),
  object({
    of: literal("spreadsheet"),
    spreadsheet,
    tabs: array(string),
    comments: array(
      object({
        ...said,
        resolved: boolean,
        quoted: nullable(string),
        replies: array(object(said)),
      }),
    ),
    note: nullable(string),
    title: string,
    text: string,
  }),
);

// The most characters one item's text holds; past it, the rest isn't read
// and the item says so.
export const maxItemChars = 50_000;

// A row's text: each column read as `Header: value`, each note under its
// cell. Cut at the cap, with Oriel's note.
export function rowText(cells: RowContent["cells"]): { text: string; note: string | null } {
  const text = cells
    .map(
      (cell) =>
        `${cell.header}: ${cell.value}${cell.note === null ? "" : `\nNote on ${cell.header}: ${cell.note}`}`,
    )
    .join("\n");
  if (text.length <= maxItemChars) return { text, note: null };
  const note = `This row is over ${maxItemChars.toLocaleString("en")} characters, so only its first ${maxItemChars.toLocaleString("en")} are read.`;
  return { text: `${text.slice(0, maxItemChars)}\n\n${note}`, note };
}

// How much of a spreadsheet's text its tabs' names may take.
const tabChars = 10_000;

// A spreadsheet's text: its tabs, then each comment with its replies, as
// many tab names and whole comments as fit the cap. The tabs and comments a
// read returns are those the text holds, and the note says what wasn't read.
export function spreadsheetText(
  content: Pick<SpreadsheetContent, "tabs" | "comments">,
): Pick<SpreadsheetContent, "tabs" | "comments" | "text" | "note"> {
  let listed = 0;
  for (let length = 0; listed < content.tabs.length; listed++) {
    length += (content.tabs[listed] ?? "").length + 2;
    if (length > tabChars) break;
  }
  const tabs = content.tabs.slice(0, listed);
  const head = `Tabs: ${tabs.join(", ")}\n\nComments:`;
  const blocks = content.comments.map((c) =>
    [
      `${c.author}, ${c.at}${c.resolved ? " (resolved)" : ""}:${c.quoted === null ? "" : `\nOn: ${c.quoted}`}\n${c.text}`,
      ...c.replies.map((r) => `${r.author} replied, ${r.at}:\n${r.text}`),
    ].join("\n"),
  );
  let length = head.length;
  let kept = 0;
  for (const block of blocks) {
    if (length + 2 + block.length > maxItemChars) break;
    length += 2 + block.length;
    kept++;
  }
  const all = content.comments.length;
  const cap = maxItemChars.toLocaleString("en");
  const notes = [
    ...(listed < content.tabs.length
      ? [
          `Its tabs' names are long, so only the first ${listed} of ${content.tabs.length} are listed.`,
        ]
      : []),
    ...(kept < all
      ? [`Its comments are over ${cap} characters, so only the first ${kept} of ${all} are read.`]
      : []),
  ];
  const note = notes.length ? notes.join(" ") : null;
  const text = [
    ...(all ? [head, ...blocks.slice(0, kept)] : [`Tabs: ${tabs.join(", ")}\n\nNo comments.`]),
    ...(note === null ? [] : [note]),
  ].join("\n\n");
  return { tabs, comments: content.comments.slice(0, kept), text, note };
}

// A record's Sheets attrs, or null for another source's item.
export function sheetsAttrsOf(record: IndexRecord): SheetsAttrs | null {
  if (parseItemId(record.id)?.kind !== "sheets") return null;
  const parsed = sheetsAttrs(record.attrs);
  return parsed.ok ? parsed.value : null;
}

// A row shows its status as the cell says it, and its tab as a label.
export const sheetsDetails: DetailsOf = (record) => {
  const attrs = sheetsAttrsOf(record);
  if (!attrs) return null;
  if (attrs.of === "spreadsheet") return { type: "spreadsheet", status: "", labels: [] };
  return { type: "row", status: attrs.status ?? "", labels: [attrs.tab.title] };
};

export const sheetsPresentation: Presentation = { name: "Google Sheets", details: sheetsDetails };

// What reads as one short fact; anything longer is a block of its own.
const factChars = 120;

// An item as the panel beside the page shows it, from a live read. A row:
// its tab and number, then its cells, short ones as facts under their
// headers and long ones as text, each note under its cell. A spreadsheet:
// its tabs, then its comments with their replies.
export const sheetsPanel: PanelOf = (content) => {
  const read = sheetsContent(content);
  if (!read.ok) return null;
  const item = read.value;
  if (item.of === "spreadsheet") {
    return {
      title: null,
      blocks: [
        ...(item.note === null ? [] : [{ kind: "note" as const, text: item.note }]),
        { kind: "facts", facts: [{ name: "Tabs", value: item.tabs.join(", ") }] },
        {
          kind: "messages",
          heading: "Comments",
          messages: item.comments.flatMap((c) => [
            {
              author: c.author,
              at: c.at,
              text: c.quoted === null ? c.text : `On “${c.quoted}”: ${c.text}`,
              ...(c.resolved && { labels: ["Resolved"] }),
            },
            ...c.replies.map((r) => ({ ...r, labels: ["Reply"] })),
          ]),
          empty: "No comments.",
        },
      ],
    };
  }
  const short = (value: string) => value.length <= factChars && !value.includes("\n");
  const blocks: PanelBlock[] = [
    ...(item.note === null ? [] : [{ kind: "note" as const, text: item.note }]),
    {
      kind: "facts",
      facts: [
        { name: "Tab", value: item.tab.title },
        { name: "Row", value: String(item.row) },
        ...item.cells
          .filter((cell) => short(cell.value))
          .map((cell) => ({ name: cell.header, value: cell.value })),
      ],
    },
  ];
  for (const cell of item.cells) {
    if (!short(cell.value))
      blocks.push({ kind: "text", heading: cell.header, text: cell.value, format: "plain" });
    if (cell.note !== null)
      blocks.push({
        kind: "text",
        heading: `Note on ${cell.header}`,
        text: cell.note,
        format: "plain",
      });
  }
  return { title: null, blocks };
};
