// What Oriel reads to help a person map a Sheets connection's tabs while it
// waits for its options (decision 0051), and how a draft of them reads.
//
// The preview is each picked tab's first rows, read live, as the sheet shows
// them: the cells as text under their column letters, the header among them,
// and the tab by its spreadsheet's ID and `sheetId`, never its title. Every
// cell, header and title is the sheet's own words, so it reaches the agent
// only as a run's result.
//
// A draft names each column by its letter and each tab by its table's `at`,
// so no header steers what the card says; Oriel draws the card from the
// sheet, and applying a draft turns each letter into the header above it,
// so the mapping keeps naming the same column when one is inserted or
// moved (decision 0050).
import {
  array,
  boolean,
  type Infer,
  literal,
  maxPreviewRows,
  number,
  object,
  optional,
  type OpenVia,
  type PreviewTable,
  refine,
  type ReviewOf,
  type ReviewTable,
  string,
  type ToOpen,
  union,
} from "@oriel/core";
import { columnIndex, columnLetters } from "./a1.ts";
import { fieldNames, type FieldName, type TabMapping } from "./mapping.ts";
import { googleOf, picksOf } from "./open-connection.ts";
import { maxTabs } from "./source.ts";

// The columns a preview shows, at most: past them a sheet is a database.
const maxColumns = 52;

// A tab's place in its source, as a table's `at` says it.
const placeOf = (at: string): { id: string; sheetId: number } | null => {
  const [, id, sheetId] = /^([A-Za-z0-9_-]{10,100})\/(\d{1,12})$/.exec(at) ?? [];
  return id && sheetId ? { id, sheetId: Number(sheetId) } : null;
};

export async function sheetsPreview(connection: ToOpen, via: OpenVia): Promise<PreviewTable[]> {
  const { google } = googleOf(connection, via);
  const tables: PreviewTable[] = [];
  for (const pick of picksOf(connection.options).spreadsheets) {
    const info = await google.tabs(pick.id);
    if (info === "gone") continue;
    for (const tab of info.tabs) {
      if (tables.length >= maxTabs) return tables;
      const grid = await google.rows(pick.id, tab, 0, Math.min(tab.rows, maxPreviewRows));
      if (grid === "gone") continue;
      const rows = grid.rows.map((row) =>
        row.slice(0, maxColumns).map((cell) => (cell?.shown ? cell.shown : null)),
      );
      const width = Math.max(0, ...rows.map((row) => row.length));
      tables.push({
        name: `${info.title} › ${tab.title}`,
        at: `${pick.id}/${tab.sheetId}`,
        columns: Array.from({ length: width }, (_, c) => columnLetters(c)),
        rows: rows.map((row) => Array.from({ length: width }, (_, c) => row[c] ?? null)),
      });
    }
  }
  return tables;
}

const letter = refine(
  string,
  (text) => /^[A-Z]{1,2}$/.test(text),
  "expected a column's letter, as preview() names it",
);
const values = array(string);
const draftedTab = object({
  at: refine(string, (at) => placeOf(at) !== null, "expected a table's `at`, from preview()"),
  header: refine(number, (n) => Number.isInteger(n) && n >= 1, "expected a row number"),
  end: union(literal("blank"), literal("grid")),
  hidden: boolean,
  key: letter,
  title: letter,
  status: optional(letter),
  states: optional(object({ todo: values, "in-progress": values, done: values })),
  assignee: optional(letter),
  estimate: optional(letter),
  link: optional(letter),
  parent: optional(letter),
});
type DraftedTab = Infer<typeof draftedTab>;
// One as Oriel writes it, with only the fields it maps.
type Drafting = Pick<DraftedTab, "at" | "header" | "end" | "hidden" | "key" | "title">;
export const sheetsDraft = refine(
  object({ tabs: array(draftedTab) }),
  ({ tabs }) =>
    new Set(tabs.map((tab) => tab.at)).size === tabs.length &&
    tabs.every((tab) => !tab.states || tab.status),
  "expected each tab once, and states only with a status",
);
export type SheetsDraft = Infer<typeof sheetsDraft>;

const draftOf = (draft: Readonly<Record<string, unknown>>): SheetsDraft | null => {
  const read = sheetsDraft(draft);
  return read.ok ? read.value : null;
};

const text = (cell: string | null | undefined) => cell?.trim() ?? "";

// Each field the drafted tab maps, with its column's letter.
const lettersOf = (tab: DraftedTab): [FieldName, string][] =>
  fieldNames.flatMap((field) => {
    const at = tab[field];
    return at === undefined ? [] : [[field, at]];
  });

// The drafted tab's data rows, as the preview has them: under its header,
// to its first blank row, or to the preview's end.
const bodyOf = (table: PreviewTable, tab: Pick<DraftedTab, "header" | "end">) => {
  const below = table.rows.slice(tab.header);
  const blank = below.findIndex((row) => row.every((cell) => text(cell) === ""));
  return tab.end === "blank" && blank >= 0 ? below.slice(0, blank) : below;
};

function settle(
  given: Readonly<Record<string, unknown>>,
  tables: readonly PreviewTable[],
  options: Readonly<Record<string, unknown>>,
): Record<string, unknown> | { problem: string } {
  const draft = draftOf(given);
  if (!draft) return { problem: "The draft isn't one Oriel can read." };
  const picks = picksOf(options);
  const mapped = new Map<string, TabMapping[]>();
  for (const tab of draft.tabs) {
    const place = placeOf(tab.at);
    const table = tables.find((each) => each.at === tab.at);
    if (!place || !table || !picks.spreadsheets.some((pick) => pick.id === place.id))
      return { problem: "A tab it maps isn't in the picked spreadsheets any more." };
    const headers = table.rows[tab.header - 1];
    if (!headers) return { problem: `${table.name}: row ${tab.header} isn't in what Oriel read.` };
    const mapping: Record<string, unknown> = {
      sheetId: place.sheetId,
      header: tab.header,
      end: tab.end,
      hidden: tab.hidden,
      ...(tab.states ? { states: tab.states } : {}),
    };
    for (const [field, at] of lettersOf(tab)) {
      const header = text(headers[columnIndex(at) ?? -1]);
      if (header === "")
        return { problem: `${table.name}: column ${at} has no header in row ${tab.header}.` };
      if (headers.filter((cell) => text(cell) === header).length > 1)
        return {
          problem: `${table.name}: column ${at}'s header is in row ${tab.header} twice, so Oriel can't tell them apart.`,
        };
      mapping[field] = header;
    }
    mapped.set(place.id, [...(mapped.get(place.id) ?? []), mapping as TabMapping]);
  }
  return {
    ...options,
    // As the card draws it: a tab the draft leaves out isn't read.
    spreadsheets: picks.spreadsheets.map((pick) => ({
      id: pick.id,
      tabs: mapped.get(pick.id) ?? [],
    })),
  };
}

const isNumber = (cell: string) => /^-?[\d,.]+%?$/.test(cell);

// Oriel's own guess at each tab, calling no model (decision 0051): the first
// row as the header, the first column whose values are all present and
// unique as the key, and the key as the title if it is text, else the first
// text column. A tab with no such key isn't guessed: its person adds one.
function guess(tables: readonly PreviewTable[]): Record<string, unknown> | null {
  const tabs = tables.flatMap((table): Drafting[] => {
    if (!table.at || !placeOf(table.at)) return [];
    const header = 1;
    const headers = table.rows[0] ?? [];
    const body = bodyOf(table, { header, end: "blank" });
    if (body.length === 0) return [];
    const column = (c: number) => body.map((row) => text(row[c]));
    const named = table.columns.flatMap((_, c) => (text(headers[c]) === "" ? [] : [c]));
    const present = (c: number) => column(c).every((cell) => cell !== "");
    const key = named.find((c) => present(c) && new Set(column(c)).size === body.length);
    if (key === undefined) return [];
    const isText = (c: number) => present(c) && !column(c).every(isNumber);
    const title = isText(key) ? key : (named.find(isText) ?? key);
    return [
      {
        at: table.at,
        header,
        end: "blank",
        hidden: false,
        key: columnLetters(key),
        title: columnLetters(title),
      },
    ];
  });
  return tabs.length === 0 ? null : { tabs };
}

const fieldLabels: Record<FieldName, string> = {
  key: "Key",
  title: "Title",
  status: "Status",
  assignee: "Assignee",
  estimate: "Estimate",
  link: "Link",
  parent: "Parent",
};

// How many of a tab's rows the card shows under its columns.
const shownRows = 3;

function draw(
  given: Readonly<Record<string, unknown>>,
  tables: readonly PreviewTable[],
): ReviewTable[] {
  const draft = draftOf(given);
  return tables.map((table) => {
    const tab = draft?.tabs.find((each) => each.at === table.at);
    if (!tab) return { name: table.name, columns: [], rows: [], lines: ["Not read."] };
    const headers = table.rows[tab.header - 1] ?? [];
    const feeds = new Map<string, string[]>();
    for (const [field, at] of lettersOf(tab))
      feeds.set(at, [...(feeds.get(at) ?? []), fieldLabels[field]]);
    const body = bodyOf(table, tab);
    const ends =
      tab.end === "blank"
        ? "to its first blank row, so what's below it isn't read"
        : "to the end of the sheet";
    const said = (values: readonly string[], state: string) =>
      values.length === 0
        ? []
        : [`${values.join(", ")} ${values.length === 1 ? "is" : "are"} ${state}`];
    const states = tab.states
      ? [
          `Status: ${[
            ...said(tab.states.todo, "to do"),
            ...said(tab.states["in-progress"], "in progress"),
            ...said(tab.states.done, "done"),
          ].join("; ")}.`,
        ]
      : [];
    return {
      name: table.name,
      columns: table.columns.map((at, c) => ({
        at,
        header: text(headers[c]) || null,
        feeds: feeds.get(at)?.join(" and ") ?? null,
      })),
      rows: body.slice(0, shownRows),
      lines: [
        `Each row from row ${tab.header + 1} is an item, ${ends}.`,
        ...(tab.hidden ? [] : ["Rows hidden by hand aren't read."]),
        ...states,
        "Columns that feed nothing are the item's content.",
      ],
    };
  });
}

export const sheetsReview = {
  draft: sheetsDraft,
  // Spreadsheets just picked map no tab, as an Undo of the first mapping
  // puts them back: nothing is read from them yet but each one itself.
  waits: (options) => picksOf(options).spreadsheets.every((pick) => pick.tabs.length === 0),
  doc: "Each tab by its table's `at`; each field by its column's letter; the header row by its number, 1 for the first; `end: \"blank\"` stops at the first blank row, so notes below the table aren't read; \"grid\" reads to the sheet's end, skipping blank rows. The key names each row, as an ID column does; rows that share one or have none are listed for the user to fix.",
  settle,
  guess,
  draw,
} satisfies ReviewOf;
