// What a Sheets connection reads (decision 0050): the spreadsheets the person
// picked, and in each the tabs they mapped, each tab's columns named by their
// headers onto Oriel's fields. A tab with no mapping isn't read. The person
// sets a mapping in Settings and the agent drafts the first one (0051); this
// is only its shape.
import { createHash } from "node:crypto";
import {
  array,
  boolean,
  literal,
  number,
  object,
  optional,
  refine,
  string,
  union,
  type Described,
  type Validator,
} from "@oriel/core";
import type { State } from "@oriel/core";

// Which status values, as the cell shows them, mean each state. A status
// column with none, such as RAG, is a status with no state: red isn't a
// stage.
export type States = Readonly<Record<State, readonly string[]>>;

export type TabMapping = {
  // Google's `sheetId`, which survives a rename.
  sheetId: number;
  // The header row's number as the sheet shows it, 1 for the first.
  header: number;
  // Where the table ends: at its first blank row, so a notes block below it
  // isn't items, or at the grid's end, with blank rows skipped.
  end: "blank" | "grid";
  // Whether rows hidden by hand are read. Rows a filter hides always are.
  hidden: boolean;
  // Each field's column, by its header. The key's values name the rows.
  key: string;
  title: string;
  status?: string;
  states?: States;
  assignee?: string;
  estimate?: string;
  link?: string;
  // A column naming another row by its key, in this tab or another mapped
  // one of the same spreadsheet, which becomes its container.
  parent?: string;
};

export type SpreadsheetPick = {
  // Its Drive file ID.
  id: string;
  tabs: TabMapping[];
};

export type SheetsPicks = { spreadsheets: SpreadsheetPick[] };

// The fields a tab maps, in the order a draft and Settings list them.
export const fieldNames = [
  "key",
  "title",
  "status",
  "assignee",
  "estimate",
  "link",
  "parent",
] as const;
export type FieldName = (typeof fieldNames)[number];

const header = refine(string, (text) => text.trim() !== "", "expected a column's header");
const values = array(string);

export const tabMapping: Validator<TabMapping> = object({
  sheetId: refine(number, (n) => Number.isInteger(n) && n >= 0, "expected a sheetId"),
  header: refine(number, (n) => Number.isInteger(n) && n >= 1, "expected a row number"),
  end: union(literal("blank"), literal("grid")),
  hidden: boolean,
  key: header,
  title: header,
  status: optional(header),
  states: optional(object({ todo: values, "in-progress": values, done: values })),
  assignee: optional(header),
  estimate: optional(header),
  link: optional(header),
  parent: optional(header),
});

const spreadsheets = array(
  object({
    id: refine(string, (s) => /^[A-Za-z0-9_-]{10,100}$/.test(s), "expected a Drive file ID"),
    tabs: array(tabMapping),
  }),
);

// What a mapping must hold: one mapping per tab, states only with a status,
// and no column mapped to two fields.
const fits = (picks: SheetsPicks) =>
  new Set(picks.spreadsheets.map((s) => s.id)).size === picks.spreadsheets.length &&
  picks.spreadsheets.every(
    (s) =>
      new Set(s.tabs.map((t) => t.sheetId)).size === s.tabs.length &&
      s.tabs.every((tab) => {
        // A unique name, such as a feature's, may be both key and title.
        const columns = mappedColumns(tab).flatMap(([field, column]) =>
          field === "key" && column.trim() === tab.title.trim() ? [] : [column.trim()],
        );
        return new Set(columns).size === columns.length && (!tab.states || tab.status);
      }),
  );
const fitsSays =
  "expected each spreadsheet and tab once, states only with a status, and each column mapped once";

// The picks, then what a mapping must hold.
export const sheetsPicks: Described<SheetsPicks> = refine(object({ spreadsheets }), fits, fitsSays);

// What a person sets per connection (decision 0049): the picks, and
// whether it may propose changes. Spreadsheets just picked map no tab, so
// the connection waits for its options (decision 0051).
export type SheetsOptions = SheetsPicks & { readOnly?: boolean };
export const sheetsOptions: Described<SheetsOptions> = refine(
  object({ spreadsheets, readOnly: optional(boolean) }),
  fits,
  fitsSays,
);

// Each field the tab maps, with its column's header.
export const mappedColumns = (tab: TabMapping): [FieldName, string][] =>
  fieldNames.flatMap((field) => {
    const column = tab[field];
    return column === undefined ? [] : [[field, column]];
  });

// A spreadsheet's mappings in short: a sync re-reads a spreadsheet whose
// mapping changed, as one whose version moved.
export function mappingPrint(pick: SpreadsheetPick): string {
  const tabs = pick.tabs
    .toSorted((a, b) => a.sheetId - b.sheetId)
    .map((tab) => [
      tab.sheetId,
      tab.header,
      tab.end,
      tab.hidden,
      ...mappedColumns(tab).flat(),
      tab.states
        ? JSON.stringify([tab.states.todo, tab.states["in-progress"], tab.states.done])
        : "",
    ]);
  return createHash("sha256").update(JSON.stringify(tabs)).digest("hex").slice(0, 16);
}
