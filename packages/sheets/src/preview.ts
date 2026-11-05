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
  type ReviewEdit,
  type ReviewOf,
  type ReviewTable,
  string,
  type ToOpen,
  union,
} from "@oriel/core";
import { columnIndex, columnLetters } from "./a1.ts";
import {
  fieldNames,
  type FieldName,
  mappedColumns,
  type SheetsPicks,
  type TabMapping,
} from "./mapping.ts";
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
    const at = table.at ?? null;
    if (!tab)
      return { name: table.name, at, columns: [], rows: [], lines: ["Not read."], reads: null };
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
      at,
      columns: table.columns.map((letter, c) => ({
        at: letter,
        header: text(headers[c]) || null,
        feeds: feeds.get(letter)?.join(" and ") ?? null,
      })),
      rows: body.slice(0, shownRows),
      lines: [
        `Each row from row ${tab.header + 1} is an item, ${ends}.`,
        ...(tab.hidden ? [] : ["Rows hidden by hand aren't read."]),
        ...states,
        "Columns that feed nothing are the item's content.",
      ],
      reads: {
        header: tab.header,
        end: tab.end,
        hidden: tab.hidden,
        fields: Object.fromEntries(lettersOf(tab)),
      },
    };
  });
}

// The draft that reads as the options do now: each mapped tab's headers
// turned back into the letters above them in the preview. A tab whose key
// or title header isn't there is left out, and a field whose header isn't
// is dropped, as the sheet no longer has them.
function current(
  options: Readonly<Record<string, unknown>>,
  tables: readonly PreviewTable[],
): Record<string, unknown> {
  const tabs = picksOf(options).spreadsheets.flatMap((pick) =>
    pick.tabs.flatMap((tab): DraftedTab[] => {
      const at = `${pick.id}/${tab.sheetId}`;
      const headers = tables.find((table) => table.at === at)?.rows[tab.header - 1];
      if (!headers) return [];
      const drafted: Record<string, unknown> = {
        at,
        header: tab.header,
        end: tab.end,
        hidden: tab.hidden,
      };
      for (const [field, header] of mappedColumns(tab)) {
        const c = headers.findIndex((cell) => text(cell) === header.trim());
        if (c >= 0) drafted[field] = columnLetters(c);
      }
      if (tab.states && drafted["status"]) drafted["states"] = tab.states;
      return drafted["key"] && drafted["title"] ? [drafted as DraftedTab] : [];
    }),
  );
  return { tabs };
}

// The fields a column feeding them can't be taken from, as every tab read
// needs them.
const required: readonly FieldName[] = ["key", "title"];

function edit(
  given: Readonly<Record<string, unknown>>,
  change: ReviewEdit,
  tables: readonly PreviewTable[],
): Record<string, unknown> | { problem: string } {
  const draft = draftOf(given) ?? { tabs: [] };
  const table = tables.find((each) => each.at === change.table);
  if (!table?.at) return { problem: "That tab isn't in what Oriel read from the sheet." };
  const tab = draft.tabs.find((each) => each.at === change.table);
  // In the order the preview lists them, as the card draws them.
  const placed = (tabs: DraftedTab[]) => {
    const order = (at: string) => tables.findIndex((each) => each.at === at);
    const next = { tabs: tabs.toSorted((a, b) => order(a.at) - order(b.at)) };
    return sheetsDraft(next).ok ? next : { problem: "Oriel can't read the tab that way." };
  };
  const others = draft.tabs.filter((each) => each !== tab);
  if ("read" in change) {
    if (!change.read) return placed(others);
    if (tab) return placed(draft.tabs);
    // Oriel's guess, under the first header row it finds one under: the
    // first row, or one after a blank row, as a title may sit above the
    // table; never a row of the table itself.
    const blank = (row: readonly (string | null)[] | undefined) =>
      row?.every((cell) => text(cell) === "") ?? false;
    const guessed = table.rows.slice(0, 10).flatMap((row, at): DraftedTab[] => {
      if (at > 0 && (blank(row) || !blank(table.rows[at - 1]))) return [];
      const [under] = (guess([{ ...table, rows: table.rows.slice(at) }])?.["tabs"] ??
        []) as DraftedTab[];
      return under ? [{ ...under, header: at + 1 }] : [];
    })[0];
    if (!guessed)
      return {
        problem: `${table.name}: no column has a value in every row, different in each, to name its rows by. Add one, such as an ID, in the sheet.`,
      };
    return placed([...draft.tabs, guessed]);
  }
  if (!tab) return { problem: `${table.name} isn't read.` };
  if ("field" in change) {
    const field = fieldNames.find((name) => name === change.field);
    if (!field) return { problem: "That isn't a field Oriel reads." };
    const { column } = change;
    if (column === null && required.includes(field))
      return { problem: `Every row needs its ${fieldLabels[field].toLowerCase()}.` };
    if (column !== null && !table.columns.includes(column))
      return { problem: `${table.name} has no column ${column} in what Oriel read.` };
    // A column feeds one field, but a unique name may be key and title.
    const pair = (a: FieldName, b: FieldName) => required.includes(a) && required.includes(b);
    const taken = lettersOf(tab).find(
      ([other, at]) => other !== field && at === column && !pair(field, other),
    );
    if (taken && required.includes(taken[0]))
      return {
        problem: `Column ${column} gives each row its ${fieldLabels[taken[0]].toLowerCase()}. Give that another column first.`,
      };
    const next: Record<string, unknown> = { ...tab };
    if (taken) delete next[taken[0]];
    if (column === null) delete next[field];
    else next[field] = column;
    // Which values mean which state are a status column's own.
    if (next["status"] !== tab.status) delete next["states"];
    return placed([...others, next as DraftedTab]);
  }
  if ("header" in change && change.header > table.rows.length)
    return {
      problem: `${table.name}: Oriel read its first ${table.rows.length} rows, so the header is one of those.`,
    };
  const { table: _, ...set } = change;
  return placed([...others, { ...tab, ...set }]);
}

// What new options do to the rows a connection read (decision 0050): a tab
// no longer read, or with a new key, loses the items it had, which
// workstreams keep as items Oriel no longer has; one whose table now
// begins, ends or skips rows elsewhere loses the rows it no longer covers.
function said(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  tables: readonly PreviewTable[],
): string[] {
  const now: SheetsPicks = picksOf(after);
  return picksOf(before).spreadsheets.flatMap((pick) =>
    pick.tabs.flatMap((tab) => {
      const table = tables.find((each) => each.at === `${pick.id}/${tab.sheetId}`);
      const name = table?.name ?? "A tab";
      // The key's column, by where its header is, as the same column under
      // another header row keeps its rows' keys.
      const keyAt = (mapping: TabMapping) => {
        const c = table?.rows[mapping.header - 1]?.findIndex(
          (cell) => text(cell) === mapping.key.trim(),
        );
        return c === undefined || c < 0 ? mapping.key.trim() : c;
      };
      const next = now.spreadsheets
        .find((each) => each.id === pick.id)
        ?.tabs.find((each) => each.sheetId === tab.sheetId);
      if (!next)
        return [
          `${name} won't be read, so its rows leave the window; workstreams that hold them keep them as items Oriel no longer has.`,
        ];
      if (keyAt(next) !== keyAt(tab))
        return [
          `A new key makes every row of ${name} a new item; workstreams that hold its rows now keep them as items Oriel no longer has.`,
        ];
      if (next.header !== tab.header || next.end !== tab.end || next.hidden !== tab.hidden)
        return [`Rows of ${name} that its table no longer covers leave the window.`];
      return [];
    }),
  );
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
  fields: fieldNames.map((name) => ({
    name,
    label: fieldLabels[name],
    required: required.includes(name),
  })),
  current,
  edit,
  said,
} satisfies ReviewOf;
