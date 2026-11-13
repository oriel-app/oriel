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

export type States = Readonly<Record<State, readonly string[]>>;

export type TabMapping = {
  // Google's `sheetId`, which survives a rename.
  sheetId: number;
  header: number;
  end: "blank" | "grid";
  hidden: boolean;
  key: string;
  title: string;
  status?: string;
  states?: States;
  assignee?: string;
  estimate?: string;
  link?: string;
  parent?: string;
};

export type SpreadsheetPick = {
  id: string;
  tabs: TabMapping[];
};

export type SheetsPicks = { spreadsheets: SpreadsheetPick[] };

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

const fits = (picks: SheetsPicks) =>
  new Set(picks.spreadsheets.map((s) => s.id)).size === picks.spreadsheets.length &&
  picks.spreadsheets.every(
    (s) =>
      new Set(s.tabs.map((t) => t.sheetId)).size === s.tabs.length &&
      s.tabs.every((tab) => {
        const columns = mappedColumns(tab).flatMap(([field, column]) =>
          field === "key" && column.trim() === tab.title.trim() ? [] : [column.trim()],
        );
        return new Set(columns).size === columns.length && (!tab.states || tab.status);
      }),
  );
const fitsSays =
  "expected each spreadsheet and tab once, states only with a status, and each column mapped once";

export const sheetsPicks: Described<SheetsPicks> = refine(object({ spreadsheets }), fits, fitsSays);

export type SheetsOptions = SheetsPicks & { readOnly?: boolean };
export const sheetsOptions: Described<SheetsOptions> = refine(
  object({ spreadsheets, readOnly: optional(boolean) }),
  fits,
  fitsSays,
);

export const mappedColumns = (tab: TabMapping): [FieldName, string][] =>
  fieldNames.flatMap((field) => {
    const column = tab[field];
    return column === undefined ? [] : [[field, column]];
  });

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
