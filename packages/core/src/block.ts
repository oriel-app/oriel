// A block: a table, bars or rows of items in a chat answer, built by Oriel
// from a read's result (decision 0030). The agent asks for one by naming a
// read it ran in the turn, by its name and arguments, which the host
// recorded, and the block's form and the fields it shows. Oriel builds the
// block from the host's own copy of what that read answered, so the model
// never writes a block's numbers, titles or rows. A read a block can use
// declares the lists in its result and their fields, with labels, and a
// block shows only those, under those labels. The spec is the read, its
// arguments and the form and nothing else, so a block can be saved and built
// again by running its read with no model. A block is typed data, never
// HTML: whatever text it holds renders as text.
import { isItemId, type ItemId } from "./ids.ts";
import type { SearchHit } from "./source.ts";
import {
  array,
  boolean,
  type Infer,
  literal,
  number,
  object,
  optional,
  refine,
  string,
  union,
  unknown,
  type Validator,
} from "./validate.ts";

export const blockForms = ["table", "bars", "rows"] as const;
export type BlockForm = (typeof blockForms)[number];

// What a block shows at most before "and N more".
export const maxBars = 10;
export const maxRows = 20;
export const maxColumns = 5;
// Blocks the agent may ask for in a turn. The escape hatch's blocks, which
// Oriel shows unasked for every reach outside the region, don't count.
export const maxBlocksPerTurn = 4;

// What a read a block can use declares of its result: what it is, in a
// person's words, for the caption, and each list in it a block can show, by
// its dotted path ("" for the result itself), with each field's label, by
// its name, dotted for a nested one. A list rows can show has its items' IDs
// in `id`.
export type ResultFields = {
  source: string;
  lists: Readonly<Record<string, Readonly<Record<string, string>>>>;
};

const field = refine(string, (name) => name.trim() !== "", "expected a field's name");
const base = {
  read: refine(string, (name) => name.trim() !== "", "expected a read's name, such as search"),
  args: optional(array(unknown)),
  // The field holding the rows, dotted for a nested one; without it, the
  // read's result is the rows.
  from: optional(field),
};

// What the agent asks for, as `show()` checks it.
export const blockSpec = union(
  object({ ...base, form: literal("bars"), label: field, value: field }),
  object({
    ...base,
    form: literal("table"),
    columns: refine(
      array(field),
      (columns) => columns.length > 0 && columns.length <= maxColumns,
      `expected 1 to ${maxColumns} columns`,
    ),
  }),
  object({ ...base, form: literal("rows") }),
);
export type BlockSpec = Infer<typeof blockSpec>;

// What search() declares of its result: its hits, as rows or a table.
export const searchFields: ResultFields = {
  source: "a search of everything indexed",
  lists: { "": { id: "Item", title: "Title", location: "Where", updatedAt: "Updated" } },
};

// What a refused spec is told: what every block names, and what each form
// takes besides.
export const blockSpecHelp =
  "a block names `read`, a read this turn ran, with its `args` if it took any, and `form`. `from` names the list in the read's result the block shows, when the result isn't that list itself. Bars take `label` and `value`, the fields holding each row's label and its number; Oriel sums the rows that share a label. A table takes `columns`, 1 to 5 of each row's fields. Rows take nothing more: each row's item is in `id`. Only the lists and fields the read declares can be shown; a refusal names them.";

// What a turn shows under the reply, as a run asks: `show` builds a block
// from a read the turn ran, `sketch` shows the agent's HTML in a sandboxed
// frame (decision 0033), and `slices` shows proposed release slices with
// Oriel's figures (the scope-lab spike). Each says what it did, or why not,
// in words for the agent.
export type Shown = {
  show(spec: unknown): string;
  sketch(html: unknown, height: unknown): string;
  slices(input: unknown): string;
};

// What a read declares a block can show, for a refusal: each list and its
// fields, by name.
export function declaredFields(read: string, fields: ResultFields): string {
  const lists = Object.entries(fields.lists).map(
    ([path, labels]) =>
      `${path === "" ? "its result" : `its field ${JSON.stringify(path)}`}: ${Object.keys(labels)
        .map((name) => JSON.stringify(name))
        .join(", ")}`,
  );
  return `${read} declares ${lists.join("; ")}`;
}

export type Cell = string | number | boolean | null;

// A waiting connection's preview (decision 0051): what its connector reads
// live from its source for the agent to draft its options, as tables of
// text, such as a tab's cells under their column letters with its headers
// as the first row, or a workspace's channels. Its rows aren't items, so
// nothing in it can be cited or added to a workstream. Oriel shows it
// unasked, as its own block, whenever a run reads it.
export const maxPreviewRows = 30;
export const maxPreviewTables = 10;
export type PreviewTable = { name: string; columns: string[]; rows: (string | null)[][] };
export const previewTable: Validator<PreviewTable> = object({
  name: string,
  columns: array(string),
  rows: array(array(union(string, literal(null)))),
});
// The read a preview block came from, as a spec: never the agent's to ask
// for, so `show()` takes none.
export type PreviewSpec = { read: string; args?: unknown[]; form: "preview" };

export type Block = {
  spec: BlockSpec | PreviewSpec;
  // Where it came from, in plain words: Oriel's, never the agent's.
  caption: string;
  // How many rows the read gave that the block doesn't show.
  more: number;
  // It came from a read outside the region: the escape hatch, read-only.
  outside: boolean;
} & (
  | { form: "bars"; bars: { label: string; value: number }[] }
  // `columns`: the declared labels of the fields it shows.
  | { form: "table"; columns: string[]; rows: Cell[][] }
  | { form: "rows"; items: ItemId[] }
  | { form: "preview"; tables: PreviewTable[] }
);

// A block as Oriel built it, as it is stored and read back: its spec,
// checked as `show()` checks it, and what it shows.
const cell = union(string, number, boolean, literal(null));
// One stored before `outside` was is from the region, as it then was.
const outsideOf: Validator<boolean> = (input, path) =>
  input === undefined ? { ok: true, value: false } : boolean(input, path);
const builtBase = { spec: blockSpec, caption: string, more: number, outside: outsideOf };
export const builtBlock: Validator<Block> = union(
  object({
    ...builtBase,
    form: literal("bars"),
    bars: array(object({ label: string, value: number })),
  }),
  object({
    ...builtBase,
    form: literal("table"),
    columns: array(string),
    rows: array(array(cell)),
  }),
  object({
    ...builtBase,
    form: literal("rows"),
    items: array(refine(string, isItemId, "expected an item ID")),
  }),
  object({
    spec: object({ read: string, args: optional(array(unknown)), form: literal("preview") }),
    caption: string,
    more: number,
    outside: boolean,
    form: literal("preview"),
    tables: array(previewTable),
  }),
);

// A preview read's block, built from what the connector read: each table
// with at most `maxPreviewRows` rows, its cells as text, and how many rows
// it left out.
export function previewBlock(
  read: string,
  args: readonly unknown[],
  tables: readonly PreviewTable[],
): Block {
  const shown = tables.slice(0, maxPreviewTables);
  const more =
    tables.slice(maxPreviewTables).reduce((sum, table) => sum + table.rows.length, 0) +
    shown.reduce((sum, table) => sum + Math.max(table.rows.length - maxPreviewRows, 0), 0);
  return {
    spec: { read, ...(args.length ? { args: [...args] } : {}), form: "preview" },
    caption: "Read by Oriel from the source, for the agent to draft how Oriel reads it",
    more,
    outside: true,
    form: "preview",
    tables: shown.map((table) => ({
      name: table.name,
      columns: [...table.columns],
      rows: table.rows.slice(0, maxPreviewRows).map((row) => [...row]),
    })),
  };
}

// A read's arguments as a key: trailing missing ones don't count, as the
// guest drops them.
export function readKey(read: string, args: readonly unknown[] = []): string {
  const kept = [...args];
  while (kept.length && (kept.at(-1) === undefined || kept.at(-1) === null)) kept.pop();
  return `${read}(${JSON.stringify(kept).slice(1, -1)})`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The value at a dotted path, through objects' fields and lists' places.
const at = (value: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((inner, key) => {
    if (Array.isArray(inner)) return /^\d+$/.test(key) ? inner[Number(key)] : undefined;
    return isRecord(inner) && Object.hasOwn(inner, key) ? inner[key] : undefined;
  }, value);

// A row's field by its name, dotted for a nested one: undefined where the
// row lacks it, and null where a field on the way is null, as an unassigned
// story's assignee is.
const fieldOf = (row: Record<string, unknown>, name: string): unknown => {
  let value: unknown = row;
  for (const key of name.split(".")) {
    if (value === null) return null;
    if (!isRecord(value) || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
};

const isCell = (value: unknown): value is Cell =>
  value === null ||
  typeof value === "string" ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value));

export type Built = { ok: true; block: Block } | { ok: false; why: string };

// What the host recorded of a read this turn: its answer, whether it reached
// outside the region, and what it declares of its result, if anything.
export type Answered = { value: unknown; outside: boolean; fields: ResultFields | null };

const listed = (names: readonly string[]) => names.map((name) => JSON.stringify(name)).join(", ");

// The block `spec` names, built from the host's copy of its read's answer;
// or why not, in words the agent can act on.
export function buildBlock(spec: BlockSpec, read: Answered): Built {
  const refuse = (why: string): Built => ({ ok: false, why });
  const { fields } = read;
  if (!fields) return refuse(`${spec.read} declares nothing a block can show`);
  const path = spec.from ?? "";
  const labels = Object.hasOwn(fields.lists, path) ? fields.lists[path] : undefined;
  const where = path === "" ? "its result" : `its field ${JSON.stringify(path)}`;
  const lists = Object.keys(fields.lists).map((list) => (list === "" ? "its result" : list));
  if (!labels)
    return refuse(
      `${spec.read} declares no list a block can show in ${where}; it declares ${lists.join(", ")}`,
    );
  const named =
    spec.form === "bars" ? [spec.label, spec.value] : spec.form === "table" ? spec.columns : [];
  const unknown = named.filter((name) => !Object.hasOwn(labels, name));
  if (unknown.length)
    return refuse(
      `${listed(unknown)} isn't a field ${spec.read} declares in ${where}; it declares ${listed(Object.keys(labels))}`,
    );
  if (spec.form === "rows" && !Object.hasOwn(labels, "id"))
    return refuse(`${where} of ${spec.read} holds no items to show as rows`);
  const label = (name: string) => labels[name] ?? name;
  const rows = path === "" ? read.value : at(read.value, path);
  if (!Array.isArray(rows)) return refuse(`${spec.read} returned no list in ${where}`);
  const caption = (what: string) =>
    `Computed by Oriel from ${fields.source}${what ? `: ${what}` : ""}`;
  const base = { spec, outside: read.outside };
  const values = (row: unknown, names: readonly string[]) =>
    isRecord(row) ? names.map((name) => fieldOf(row, name)) : null;

  if (spec.form === "bars") {
    // Rows that share a label are one bar, their values summed, as stories
    // are by their assignee.
    const sums = new Map<string, number>();
    let summed = false;
    for (const [i, row] of rows.entries()) {
      const [name, count] = values(row, [spec.label, spec.value]) ?? [];
      // A row without the field at all, as an item gone from its source, has
      // no bar, nor adds to one; nor does one with no number, as a story
      // with no estimate. One with something else there is the wrong shape.
      if (name === undefined || count === undefined || count === null) continue;
      if (name !== null && typeof name !== "string" && typeof name !== "number")
        return refuse(
          `row ${i} of ${where} has no text or number in ${JSON.stringify(spec.label)}`,
        );
      if (typeof count !== "number" || !Number.isFinite(count))
        return refuse(`row ${i} of ${where} has no number in ${JSON.stringify(spec.value)}`);
      // No label, as a story no one is assigned, is a blank, as in a table.
      const key = name === null ? "—" : String(name);
      summed ||= sums.has(key);
      sums.set(key, (sums.get(key) ?? 0) + count);
    }
    if (!sums.size) return refuse(`${where} is empty`);
    const ranked = [...sums]
      .map(([name, value]) => ({ label: name, value }))
      .toSorted((a, b) => b.value - a.value || a.label.localeCompare(b.label));
    const by = `${label(spec.value)} by ${label(spec.label)}`;
    return {
      ok: true,
      block: {
        ...base,
        form: "bars",
        bars: ranked.slice(0, maxBars),
        more: Math.max(ranked.length - maxBars, 0),
        caption: caption(`${by}${summed ? ", summed" : ""}, highest first`),
      },
    };
  }

  if (spec.form === "table") {
    const table: Cell[][] = [];
    for (const [i, row] of rows.slice(0, maxRows).entries()) {
      // A field a row lacks, as an item gone from its source lacks its
      // title, is a blank cell.
      const cells = values(row, spec.columns)?.map((cell) => (cell === undefined ? null : cell));
      if (!cells) return refuse(`row ${i} of ${where} isn't an object with fields`);
      const bad = cells.findIndex((cell) => !isCell(cell));
      if (bad >= 0)
        return refuse(
          `row ${i} of ${where} has no text, number or yes/no in ${JSON.stringify(spec.columns[bad])}`,
        );
      table.push(cells as Cell[]);
    }
    if (!table.length) return refuse(`${where} is empty`);
    const columns = spec.columns.map(label);
    return {
      ok: true,
      block: {
        ...base,
        form: "table",
        columns,
        rows: table,
        more: Math.max(rows.length - maxRows, 0),
        caption: caption(columns.join(", ")),
      },
    };
  }

  const items: ItemId[] = [];
  for (const [i, row] of rows.slice(0, maxRows).entries()) {
    const id = isRecord(row) ? row["id"] : undefined;
    if (typeof id !== "string" || !isItemId(id))
      return refuse(`row ${i} of ${where} has no item's ID in "id"`);
    items.push(id);
  }
  if (!items.length) return refuse(`${where} is empty`);
  return {
    ok: true,
    block: {
      ...base,
      form: "rows",
      items,
      more: Math.max(rows.length - maxRows, 0),
      caption: caption(path === "" ? "" : label("id")),
    },
  };
}

// The escape hatch's block (decision 0030): what a run reached outside the
// region, which Oriel shows unasked, as search()'s rows. Built as any block
// is.
export function escapeHatchBlock(hits: readonly SearchHit[]): Block | null {
  const built = buildBlock(
    { read: "search", args: undefined, from: undefined, form: "rows" },
    { value: hits, outside: true, fields: searchFields },
  );
  return built.ok ? built.block : null;
}
