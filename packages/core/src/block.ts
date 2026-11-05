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
// HTML: whatever text it holds renders as text. The chart forms (a series
// over time, a timeline, a spread, a pivot) are built in block-charts.ts.
import { buildChart, builtCharts, type ChartBlock, isChart } from "./block-charts.ts";
import { chartSteps } from "./chart.ts";
import { isInstant, isItemId, type ItemId } from "./ids.ts";
import type { SearchHit } from "./source.ts";
import {
  array,
  boolean,
  type Infer,
  literal,
  number,
  object,
  optional,
  record,
  refine,
  string,
  union,
  unknown,
  type Validator,
} from "./validate.ts";

export const blockForms = [
  "table",
  "bars",
  "rows",
  "series",
  "timeline",
  "spread",
  "pivot",
] as const;
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
// A read whose rows hold dates says, by dotted path, when it was answered
// (`asOf`) and since when its dates are known (`since`): a date at `since`
// means by then. A chart over time needs both. `atLeast` names, for a
// number field, the yes/no field that says the number is only a lower bound
// (`lowerBound`).
export type ResultFields = {
  source: string;
  lists: Readonly<Record<string, Readonly<Record<string, string>>>>;
  time?: { asOf: string; since: string };
  atLeast?: Readonly<Record<string, string>>;
  // The number fields that add up, which a pivot may sum; without it, all.
  sums?: readonly string[];
  // It holds IDs and facets, never content, so no block of it is the
  // escape hatch, even read from outside the region (decision 0053).
  contentFree?: true;
};

const field = refine(string, (name) => name.trim() !== "", "expected a field's name");
const base = {
  read: refine(string, (name) => name.trim() !== "", "expected a read's name, such as search"),
  args: optional(array(unknown)),
  // The field holding the rows, dotted for a nested one; without it, the
  // read's result is the rows.
  from: optional(field),
  // Only the rows whose fields hold these values, by each field's name.
  where: optional(record(union(string, number, boolean, literal(null)))),
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
  object({
    ...base,
    form: literal("series"),
    at: field,
    value: optional(field),
    every: optional(union(...chartSteps.map((step) => literal(step)))),
    running: optional(boolean),
    fit: optional(boolean),
  }),
  object({
    ...base,
    form: literal("timeline"),
    label: optional(field),
    start: field,
    end: field,
    due: optional(field),
    by: optional(field),
  }),
  object({ ...base, form: literal("spread"), value: field }),
  object({
    ...base,
    form: literal("pivot"),
    rows: field,
    columns: optional(field),
    value: optional(field),
  }),
);
export type BlockSpec = Infer<typeof blockSpec>;

// The keys each form's spec takes, by its form, read from `blockSpec`.
const formKeys = new Map(
  (blockSpec.shape.kind === "union" ? blockSpec.shape.alternatives : []).flatMap((option) =>
    option.kind === "object" && option.fields["form"]?.kind === "literal"
      ? [[option.fields["form"].value, Object.keys(option.fields)] as const]
      : [],
  ),
);

// The keys a spec holds that its form doesn't take, or no form does if it
// names none, which `blockSpec` drops: the agent's guesses, such as `filter`
// for `where`, or a `title`, where Oriel writes the caption.
export function ignoredKeys(input: unknown): string[] {
  if (!isRecord(input)) return [];
  const taken = formKeys.get(input["form"] as BlockForm) ?? [...formKeys.values()].flat();
  return Object.keys(input).filter((key) => !taken.includes(key));
}

// What a spec `blockSpec` refuses lacks or gets wrong, by key, for the form
// it names, so a second try can fix just that.
export function specProblems(input: unknown): string {
  if (!isRecord(input)) return "show() takes one object";
  const form = input["form"];
  if (!formKeys.has(form as BlockForm))
    return `\`form\` is one of ${[...formKeys.keys()].map((name) => `"${name}"`).join(", ")}`;
  const checked = blockSpec(input);
  if (checked.ok) return "";
  const keyOf = (path: string) => /^\$\.([^.[]+)/.exec(path)?.[1] ?? "";
  const keys = [...new Set(checked.issues.map((issue) => keyOf(issue.path)))];
  const missing = keys.filter((key) => input[key] === undefined);
  // One line a field, its alternatives joined, as `every`'s "day" or "week".
  const wrong = new Map<string, string[]>();
  for (const issue of checked.issues)
    if (!missing.includes(keyOf(issue.path)))
      wrong.set(issue.path, [
        ...(wrong.get(issue.path) ?? []),
        issue.message.replace(/^expected /, ""),
      ]);
  return [
    ...(missing.length
      ? [`a ${String(form)} block needs ${missing.map((key) => `\`${key}\``).join(" and ")}`]
      : []),
    ...[...wrong].map(([path, what]) => `\`${path.slice(2)}\` takes ${what.join(" or ")}`),
  ].join("; ");
}

// What search() declares of its result: its hits, as rows or a table.
export const searchFields: ResultFields = {
  source: "a search of everything indexed",
  lists: { "": { id: "Item", title: "Title", location: "Where", updatedAt: "Updated" } },
};

// What a refused spec is told: what every block names, and what each form
// takes besides.
export const blockSpecHelp =
  "a block names `read`, a read this turn ran, with its `args` if it took any, and `form`. `from` names the list in the read's result the block shows, when the result isn't that list itself, and `where` keeps only rows whose fields hold the values it gives, as `{ kind: \"bug\" }`. Bars take `label` and `value`, the fields holding each row's label and its number; Oriel sums the rows that share a label. A table takes `columns`, 1 to 5 of each row's fields. Rows take nothing more: each row's item is in `id`. A series takes `at`, a date field, and counts rows by `every` week or day, or sums `value`; `running: true` adds each to the last, and `fit: true` adds Oriel's least-squares line and, running, a forecast of when the rest arrive. A timeline takes `start` and `end`, and `label` (else each bar is its row's item), `due` and `by` (one bar per group) if wanted. A spread takes `value`, a number, and marks the median and 90th percentile. A pivot takes `rows`, and `columns` and `value` (summed, else counted) if wanted; the person can regroup it. Only the lists and fields the read declares can be shown; a refusal names them.";

// What a turn shows under the reply, as a run asks: `show` builds a block
// from a read the turn ran, and `sketch` shows the agent's HTML in a
// sandboxed frame (decision 0033). Each says what it did, or why not, in
// words for the agent.
export type Shown = {
  show(spec: unknown): string;
  sketch(html: unknown, height: unknown): string;
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

// The one rule for a figure that is only a lower bound: a number field the
// read names in `atLeast`, on a row whose flag there is true. Every form that
// shows such a number marks it as at least what's shown (the window's "≥"),
// and a form that can't say which of its figures it holds doesn't sum it.
export type Bound = (name: string) => ((row: unknown) => boolean) | null;
export const atLeastNote =
  "≥ marks a value that is only a lower bound: it began before the change log starts";
function lowerBound(fields: ResultFields, field: (row: unknown, name: string) => unknown): Bound {
  return (name) => {
    const flag =
      fields.atLeast && Object.hasOwn(fields.atLeast, name) ? fields.atLeast[name] : undefined;
    return flag === undefined ? null : (row) => field(row, flag) === true;
  };
}

// A waiting connection's preview (decision 0051): what its connector reads
// live from its source for the agent to draft its options, as tables of
// text, such as a tab's cells under their column letters with its headers
// as the first row, or a workspace's channels. Its rows aren't items, so
// nothing in it can be cited or added to a workstream. Oriel shows it
// unasked, as its own block, whenever a run reads it.
export const maxPreviewRows = 30;
export const maxPreviewTables = 10;
// `at`: what the table is in its source, by ID, never text anyone wrote,
// which a draft names it by.
export type PreviewTable = {
  name: string;
  at?: string;
  columns: string[];
  rows: (string | null)[][];
};
export const previewTable: Validator<PreviewTable> = object({
  name: string,
  at: optional(string),
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
} &
  // `atLeast`: the value is only a lower bound (`lowerBound`); a table's,
  // each such cell by its place.
  (
    | { form: "bars"; bars: { label: string; value: number; atLeast?: true }[] }
    // `columns`: the declared labels of the fields it shows.
    | {
        form: "table";
        columns: string[];
        rows: Cell[][];
        atLeast?: { row: number; column: number }[];
      }
    | { form: "rows"; items: ItemId[] }
    | { form: "preview"; tables: PreviewTable[] }
    | ChartBlock
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
    bars: array(object({ label: string, value: number, atLeast: optional(literal(true)) })),
  }),
  object({
    ...builtBase,
    form: literal("table"),
    columns: array(string),
    rows: array(array(cell)),
    atLeast: optional(array(object({ row: number, column: number }))),
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
  ...builtCharts(builtBase),
) as Validator<Block>;

// Every label in a block that is an item's ID, as a lane, an epic or a
// table's Item is, which the window names by the item's title in the index
// now (decision 0053): one list for every form, so each names its items the
// same way. Rows hold their items already, and a preview's cells are never
// items (decision 0051).
export function itemLabels(block: Block): ItemId[] {
  const labels = ((): Cell[] => {
    switch (block.form) {
      case "bars":
        return block.bars.map((bar) => bar.label);
      case "table":
        return block.rows.flat();
      case "timeline":
        return block.lanes.map((lane) => lane.label);
      case "pivot":
        return Object.values(block.tables).flatMap((table) => [...table.rows, ...table.columns]);
      case "series":
      case "spread":
      case "rows":
      case "preview":
        return [];
    }
  })();
  return [
    ...new Set(
      labels.filter((label): label is ItemId => typeof label === "string" && isItemId(label)),
    ),
  ];
}

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
  if (!name.includes(".")) return Object.hasOwn(row, name) ? row[name] : undefined;
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

// The fields a spec names, which its read must declare.
function namedFields(spec: BlockSpec): string[] {
  return [...Object.keys(spec.where ?? {}), ...formFields(spec)];
}
function formFields(spec: BlockSpec): string[] {
  const given = (...names: (string | undefined)[]) =>
    names.flatMap((name) => (name === undefined ? [] : [name]));
  switch (spec.form) {
    case "bars":
      return [spec.label, spec.value];
    case "table":
      return spec.columns;
    case "rows":
      return [];
    case "series":
      return given(spec.at, spec.value);
    case "timeline":
      return given(spec.label, spec.start, spec.end, spec.due, spec.by);
    case "spread":
      return [spec.value];
    case "pivot":
      return given(spec.rows, spec.columns, spec.value);
  }
}

// What the host recorded of a read this turn: its answer, whether it reached
// outside the region, and what it declares of its result, if anything.
export type Answered = { value: unknown; outside: boolean; fields: ResultFields | null };

const listed = (names: readonly string[]) => names.map((name) => JSON.stringify(name)).join(", ");

// The block `spec` names, built from the host's copy of its read's answer;
// or why not, in words the agent can act on. `pinned`: built for a pin, as
// the overview reruns it, so a pivot is only the grouping it was pinned
// with (decision 0053).
export function buildBlock(
  spec: BlockSpec,
  read: Answered,
  options: { pinned?: boolean } = {},
): Built {
  const refuse = (why: string): Built => ({ ok: false, why });
  const { fields } = read;
  if (!fields) return refuse(`${spec.read} declares nothing a block can show`);
  // With no `from`, the result itself, or the one list the read declares.
  const declared = Object.keys(fields.lists);
  const path = spec.from ?? (declared.length === 1 ? (declared[0] ?? "") : "");
  const labels = Object.hasOwn(fields.lists, path) ? fields.lists[path] : undefined;
  const where = path === "" ? "its result" : `its field ${JSON.stringify(path)}`;
  // Which `from` names each list it declares, or none for its result.
  if (!labels) {
    const lists = declared.filter((list) => list !== "");
    const result = Object.hasOwn(fields.lists, "") ? "leave `from` out for its result" : "";
    const fix = lists.length
      ? `set \`from\` to one of its lists, ${listed(lists)}${result && `, or ${result}`}`
      : result;
    return refuse(`${spec.read} declares no list a block can show in ${where}; ${fix}`);
  }
  // A field the read doesn't declare, under which it declares exactly one,
  // is that one, as `assignee` is a story's `assignee.name`.
  const resolve = (name: string) => {
    if (Object.hasOwn(labels, name)) return name;
    const under = Object.keys(labels).filter((key) => key.startsWith(`${name}.`));
    return under.length === 1 && under[0] !== undefined ? under[0] : name;
  };
  const asked =
    spec.form === "bars"
      ? { label: resolve(spec.label), value: resolve(spec.value), columns: [] }
      : { label: "", value: "", columns: spec.form === "table" ? spec.columns.map(resolve) : [] };
  const named =
    spec.form === "bars"
      ? [...Object.keys(spec.where ?? {}), asked.label, asked.value]
      : spec.form === "table"
        ? [...Object.keys(spec.where ?? {}), ...asked.columns]
        : namedFields(spec);
  const unknown = named.filter((name) => !Object.hasOwn(labels, name));
  if (unknown.length)
    return refuse(
      `${listed(unknown)} isn't a field ${spec.read} declares in ${where}; it declares ${listed(Object.keys(labels))}`,
    );
  if (spec.form === "rows" && !Object.hasOwn(labels, "id"))
    return refuse(`${where} of ${spec.read} holds no items to show as rows`);
  const label = (name: string) => labels[name] ?? name;
  const all = path === "" ? read.value : at(read.value, path);
  if (!Array.isArray(all)) return refuse(`${spec.read} returned no list in ${where}`);
  const kept = Object.entries(spec.where ?? {});
  const rows = kept.length
    ? all.filter(
        (row) => isRecord(row) && kept.every(([name, value]) => fieldOf(row, name) === value),
      )
    : all;
  if (kept.length && !rows.length)
    return refuse(
      `no row of ${where} has ${kept.map(([name, value]) => `${JSON.stringify(name)} ${JSON.stringify(value)}`).join(" and ")}`,
    );
  // A filter's values are the read's own: a row holds each, or nothing shows.
  const only = kept.length
    ? `, where ${kept.map(([name, value]) => `${label(name)} is ${value === null ? "blank" : String(value)}`).join(" and ")}`
    : "";
  const caption = (what: string) =>
    `Computed by Oriel from ${fields.source}${only}${what ? `: ${what}` : ""}`;
  // Where its data came from, whatever its form: a content-free read is
  // Oriel's own computing, never an item reached outside (decision 0053).
  const base = { spec, outside: read.outside && !fields.contentFree };
  const values = (row: unknown, names: readonly string[]) =>
    isRecord(row) ? names.map((name) => fieldOf(row, name)) : null;
  const field = (row: unknown, name: string) => (isRecord(row) ? fieldOf(row, name) : undefined);
  const bound = lowerBound(fields, field);

  if (isChart(spec)) {
    const since = fields.time ? at(read.value, fields.time.since) : undefined;
    const asOf = fields.time ? at(read.value, fields.time.asOf) : undefined;
    const time =
      typeof since === "string" && isInstant(since) && typeof asOf === "string" && isInstant(asOf)
        ? { since, asOf }
        : null;
    if (fields.time && !time) return refuse(`${spec.read} returned no dates to chart over`);
    const chart = buildChart(spec, {
      rows,
      where,
      label,
      labels,
      time,
      bound,
      sums: fields.sums ?? null,
      field,
      pinned: options.pinned ?? false,
    });
    if (!chart.ok) return refuse(chart.why);
    return {
      ok: true,
      block: { ...base, ...chart.chart, more: chart.more, caption: caption(chart.caption) },
    };
  }

  if (spec.form === "bars") {
    // Rows that share a label are one bar, their values summed, as stories
    // are by their assignee.
    const sums = new Map<string, number>();
    let summed = false;
    // Bars holding a value that is only a lower bound.
    const flag = bound(asked.value);
    const bounded = new Set<string>();
    for (const [i, row] of rows.entries()) {
      const [name, count] = values(row, [asked.label, asked.value]) ?? [];
      // A row without the field at all, as an item gone from its source, has
      // no bar, nor adds to one; nor does one with no number, as a story
      // with no estimate. One with something else there is the wrong shape.
      if (name === undefined || count === undefined || count === null) continue;
      if (name !== null && typeof name !== "string" && typeof name !== "number")
        return refuse(
          `row ${i} of ${where} has no text or number in ${JSON.stringify(asked.label)}`,
        );
      if (typeof count !== "number" || !Number.isFinite(count))
        return refuse(`row ${i} of ${where} has no number in ${JSON.stringify(asked.value)}`);
      // No label, as a story no one is assigned, is a blank, as in a table.
      const key = name === null ? "—" : String(name);
      summed ||= sums.has(key);
      sums.set(key, (sums.get(key) ?? 0) + count);
      if (flag?.(row)) bounded.add(key);
    }
    if (!sums.size) return refuse(`${where} is empty`);
    const ranked = [...sums]
      .map(([name, value]) => ({
        label: name,
        value,
        ...(bounded.has(name) ? { atLeast: true as const } : {}),
      }))
      .toSorted((a, b) => b.value - a.value || a.label.localeCompare(b.label));
    const by = `${label(asked.value)} by ${label(asked.label)}`;
    return {
      ok: true,
      block: {
        ...base,
        form: "bars",
        bars: ranked.slice(0, maxBars),
        more: Math.max(ranked.length - maxBars, 0),
        caption: caption(
          `${by}${summed ? ", summed" : ""}, highest first${bounded.size ? `. ${atLeastNote}` : ""}`,
        ),
      },
    };
  }

  if (spec.form === "table") {
    const table: Cell[][] = [];
    const flags = asked.columns.map(bound);
    const atLeast: { row: number; column: number }[] = [];
    for (const [i, row] of rows.slice(0, maxRows).entries()) {
      // A field a row lacks, as an item gone from its source lacks its
      // title, is a blank cell.
      const cells = values(row, asked.columns)?.map((cell) => (cell === undefined ? null : cell));
      if (!cells) return refuse(`row ${i} of ${where} isn't an object with fields`);
      const bad = cells.findIndex((cell) => !isCell(cell));
      if (bad >= 0)
        return refuse(
          `row ${i} of ${where} has no text, number or yes/no in ${JSON.stringify(asked.columns[bad])}`,
        );
      table.push(cells as Cell[]);
      flags.forEach((flag, column) => {
        if (typeof cells[column] === "number" && flag?.(row)) atLeast.push({ row: i, column });
      });
    }
    if (!table.length) return refuse(`${where} is empty`);
    const columns = asked.columns.map(label);
    return {
      ok: true,
      block: {
        ...base,
        form: "table",
        columns,
        rows: table,
        ...(atLeast.length ? { atLeast } : {}),
        more: Math.max(rows.length - maxRows, 0),
        caption: caption(`${columns.join(", ")}${atLeast.length ? `. ${atLeastNote}` : ""}`),
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
    { read: "search", args: undefined, from: undefined, where: undefined, form: "rows" },
    { value: hits, outside: true, fields: searchFields },
  );
  return built.ok ? built.block : null;
}
