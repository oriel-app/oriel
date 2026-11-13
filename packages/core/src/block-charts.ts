// A chart over time takes its clock from the read (`time`), never the machine's, and never draws before what Oriel knows.
import {
  blankValue,
  type ChartStep,
  chartSteps,
  dayMs,
  figure,
  type PivotTable,
  pivotOf,
  type Series,
  seriesOf,
  shortDate,
  type Spread,
  spreadOf,
} from "./chart.ts";
import type { Bound } from "./block.ts";
import { type Instant, isInstant, isItemId, type ItemId } from "./ids.ts";
import {
  array,
  boolean,
  literal,
  nullable,
  number,
  object,
  record,
  refine,
  string,
  union,
  type Validator,
} from "./validate.ts";

export type Lane = {
  label: string;
  id: ItemId | null;
  start: Instant;
  end: Instant | null;
  due: Instant | null;
  earlier: boolean;
  count: number | null;
  ended: number | null;
  late: number | null;
};

export type ChartBlock =
  | {
      form: "series";
      step: ChartStep;
      running: boolean;
      label: string;
      measure: string | null;
      since: Instant;
      asOf: Instant;
      series: Series;
    }
  | { form: "timeline"; since: Instant; asOf: Instant; lanes: Lane[]; undated: number }
  | { form: "spread"; label: string; spread: Spread; missing: number }
  | {
      form: "pivot";
      dims: { field: string; label: string }[];
      measures: { field: string; label: string }[];
      tables: Record<string, PivotTable>;
      initial: { down: string; across: string | null; measure: number };
      n: number;
    };

export type ChartSpec =
  | {
      form: "series";
      at: string;
      value?: string | undefined;
      every?: ChartStep | undefined;
      running?: boolean | undefined;
      fit?: boolean | undefined;
    }
  | {
      form: "timeline";
      label?: string | undefined;
      start: string;
      end: string;
      due?: string | undefined;
      by?: string | undefined;
    }
  | { form: "spread"; value: string }
  | { form: "pivot"; rows: string; columns?: string | undefined; value?: string | undefined };

// A chart shows Oriel's figures, never an item's content, so only these drop the outside label for a content-free read.
export const chartForms: readonly ChartSpec["form"][] = ["series", "timeline", "spread", "pivot"];
export const isChart = <S extends { form: string }>(spec: S): spec is S & ChartSpec =>
  (chartForms as readonly string[]).includes(spec.form);

export type ChartInput = {
  rows: readonly unknown[];
  where: string;
  label: (name: string) => string;
  labels: Readonly<Record<string, string>>;
  time: { since: Instant; asOf: Instant } | null;
  bound: Bound;
  sums: readonly string[] | null;
  field: (row: unknown, name: string) => unknown;
  pinned: boolean;
};

export type ChartBuilt =
  | { ok: true; chart: ChartBlock; more: number; caption: string }
  | { ok: false; why: string };

const refuse = (why: string): ChartBuilt => ({ ok: false, why });
const sentences = (notes: readonly string[]) =>
  notes.map((note) => note.charAt(0).toUpperCase() + note.slice(1)).join(". ");
export const maxLanes = 12;
export const maxPivotInput = 10_000;
const maxDims = 5;
const maxMeasures = 2;
const maxDistinct = 50;

// Rows share few dates, so each is parsed once: a pin reruns on every look of the overview.
const checked = new Map<string, number | "bad">();
const dateOf = (value: unknown): number | null | "bad" => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return "bad";
  let at = checked.get(value);
  if (at === undefined) {
    at = isInstant(value) ? Date.parse(value) : "bad";
    if (checked.size > 10_000) checked.clear();
    checked.set(value, at);
  }
  return at;
};
const iso = (at: number) => new Date(at).toISOString() as Instant;
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function buildChart(spec: ChartSpec, input: ChartInput): ChartBuilt {
  switch (spec.form) {
    case "series":
      return series(spec, input);
    case "timeline":
      return timeline(spec, input);
    case "spread":
      return spread(spec, input);
    case "pivot":
      return pivot(spec, input);
  }
}

function series(spec: Extract<ChartSpec, { form: "series" }>, input: ChartInput): ChartBuilt {
  const { rows, where, label, time } = input;
  if (!time) return refuse(`${where} has no dates to draw over time`);
  const since = Date.parse(time.since);
  const asOf = Date.parse(time.asOf);
  // A sum over time can't say which of its points holds a lower bound.
  const bounded = spec.value === undefined ? null : input.bound(spec.value);
  if (bounded && rows.some(bounded))
    return refuse(
      `${JSON.stringify(spec.value)} in ${where} is only a lower bound in some rows, so it isn't summed over time`,
    );
  const dated: { at: number | null; weight: number }[] = [];
  for (const [i, row] of rows.entries()) {
    const at = dateOf(input.field(row, spec.at));
    if (at === "bad")
      return refuse(`row ${i} of ${where} has no date in ${JSON.stringify(spec.at)}`);
    let weight = 1;
    if (spec.value !== undefined) {
      const value = input.field(row, spec.value);
      if (value === null || value === undefined) continue;
      if (typeof value !== "number" || !Number.isFinite(value))
        return refuse(`row ${i} of ${where} has no number in ${JSON.stringify(spec.value)}`);
      weight = value;
    }
    dated.push({ at, weight });
  }
  if (!dated.length) return refuse(`${where} is empty`);
  const step = spec.every ?? "week";
  const running = spec.running ?? false;
  const built = seriesOf(dated, { since, asOf, step, running, fit: spec.fit ?? false });
  const what = spec.value === undefined ? "rows" : label(spec.value);
  const by = `${label(spec.at)}, ${spec.value === undefined ? "counted" : `${what} summed`} by ${step}${running ? ", running" : ""}, since ${shortDate(since)}`;
  const notes = [by];
  if (built.before)
    notes.push(
      running
        ? `${figure(built.before)} by ${shortDate(since)}, when the change log starts`
        : `${figure(built.before)} by ${shortDate(since)}, when the change log starts, aren't shown`,
    );
  const { fit } = built;
  if (fit) {
    notes.push(
      `least-squares line over ${plural(fit.weeks, `whole ${step}`)}, R² ${fit.r2.toFixed(2)}, ${figure(fit.rate)} a ${step}`,
    );
    if (fit.forecast) {
      const { at, early, late, left } = fit.forecast;
      notes.push(
        `at that rate the ${figure(left)} left get there around ${shortDate(at)} (${shortDate(early)} – ${late ? shortDate(late) : "not within six months"}, 80%), if no more are added`,
      );
    }
    if (fit.noForecast) notes.push(`no forecast: ${fit.noForecast}`);
  }
  if (built.noFit) notes.push(`no line: ${built.noFit}`);
  return {
    ok: true,
    more: 0,
    caption: sentences(notes),
    chart: {
      form: "series",
      step,
      running,
      label: label(spec.at),
      measure: spec.value === undefined ? null : label(spec.value),
      since: time.since,
      asOf: time.asOf,
      series: built,
    },
  };
}

function timeline(spec: Extract<ChartSpec, { form: "timeline" }>, input: ChartInput): ChartBuilt {
  const { rows, where, label, time } = input;
  if (!time) return refuse(`${where} has no dates to draw over time`);
  const since = Date.parse(time.since);
  const asOf = Date.parse(time.asOf);
  type Row = {
    label: string;
    id: ItemId | null;
    start: number;
    end: number | null;
    due: number | null;
  };
  const dated: Row[] = [];
  type Member = Omit<Row, "start"> & { start: number | null };
  let undated = 0;
  const groups = new Map<string, Member[]>();
  const named = spec.label ?? "id";
  if (!Object.hasOwn(input.labels, named))
    return refuse(`${where} holds no items, so name each bar's \`label\``);
  for (const [i, row] of rows.entries()) {
    const dates = [spec.start, spec.end, spec.due].map((name) =>
      name === undefined ? null : dateOf(input.field(row, name)),
    );
    const bad = dates.findIndex((date) => date === "bad");
    if (bad >= 0)
      return refuse(
        `row ${i} of ${where} has no date in ${JSON.stringify([spec.start, spec.end, spec.due][bad])}`,
      );
    const [start, end, due] = dates as (number | null)[];
    const name = input.field(row, named);
    if (name !== null && name !== undefined && typeof name !== "string" && typeof name !== "number")
      return refuse(`row ${i} of ${where} has no text in ${JSON.stringify(named)}`);
    const id = input.field(row, "id");
    const one: Member = {
      label: name === null || name === undefined ? blankValue : String(name),
      id: typeof id === "string" && isItemId(id) ? id : null,
      start: start ?? null,
      end: end ?? null,
      due: due ?? null,
    };
    if (spec.by === undefined) {
      if (one.start === null) undated += 1;
      else dated.push({ ...one, start: one.start });
      continue;
    }
    const group = input.field(row, spec.by);
    const key = group === null || group === undefined ? `No ${label(spec.by)}` : String(group);
    const members = groups.get(key);
    if (members) members.push(one);
    else groups.set(key, [one]);
  }
  const lanes: Lane[] = (
    spec.by === undefined
      ? dated.map((row) => ({ ...row, count: null, ended: null }))
      : [...groups].flatMap(([key, members]) => {
          const starts = members.flatMap((m) => (m.start === null ? [] : [m.start]));
          if (!starts.length) {
            undated += members.length;
            return [];
          }
          const ends = members.flatMap((m) => (m.end === null ? [] : [m.end]));
          const dues = members.flatMap((m) => (m.due === null ? [] : [m.due]));
          return {
            label: key,
            id: null,
            start: Math.min(...starts),
            end: ends.length === members.length ? Math.max(...ends) : null,
            due: dues.length ? Math.max(...dues) : null,
            count: members.length,
            ended: ends.length,
          };
        })
  )
    .map((lane) => {
      const finish = lane.end ?? asOf;
      const late = lane.due !== null && finish > lane.due ? (finish - lane.due) / dayMs : null;
      return {
        ...lane,
        start: iso(lane.start),
        end: lane.end === null ? null : iso(lane.end),
        due: lane.due === null ? null : iso(lane.due),
        earlier: lane.start <= since,
        late: late === null ? null : Math.ceil(late),
      };
    })
    .toSorted((a, b) => a.start.localeCompare(b.start) || a.label.localeCompare(b.label));
  if (!lanes.length)
    return refuse(`no row of ${where} has a date in ${JSON.stringify(spec.start)}`);
  const late = lanes.filter((lane) => lane.late !== null).length;
  const notes = [
    `${label(spec.start)} to ${label(spec.end)}${spec.by === undefined ? "" : `, by ${label(spec.by)}`}, since ${shortDate(since)}; today is the line`,
  ];
  if (lanes.some((lane) => lane.earlier))
    notes.push(
      `a bar from the left edge started by ${shortDate(since)}, when the change log starts`,
    );
  if (spec.due !== undefined)
    notes.push(
      late
        ? `${plural(late, "is", "are")} past ${label(spec.due)}`
        : `none is past ${label(spec.due)}`,
    );
  if (undated)
    notes.push(
      `${plural(undated, "row")} with no ${label(spec.start)} ${undated === 1 ? "isn't" : "aren't"} shown`,
    );
  return {
    ok: true,
    more: Math.max(lanes.length - maxLanes, 0),
    caption: sentences(notes),
    chart: {
      form: "timeline",
      since: time.since,
      asOf: time.asOf,
      lanes: lanes.slice(0, maxLanes),
      undated,
    },
  };
}

function spread(spec: Extract<ChartSpec, { form: "spread" }>, input: ChartInput): ChartBuilt {
  const { rows, where, label } = input;
  const flag = input.bound(spec.value);
  const values: { value: number; atLeast: boolean }[] = [];
  let missing = 0;
  for (const [i, row] of rows.entries()) {
    const value = input.field(row, spec.value);
    if (value === null || value === undefined) {
      missing += 1;
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value))
      return refuse(`row ${i} of ${where} has no number in ${JSON.stringify(spec.value)}`);
    values.push({ value, atLeast: flag?.(row) ?? false });
  }
  const built = spreadOf(values);
  if (!built) return refuse(`${where} has no number in ${JSON.stringify(spec.value)}`);
  const bound = built.atLeast ? "at least " : "";
  const notes = [
    `${label(spec.value)} of ${plural(built.n, "row")}: median ${bound}${figure(built.median)}, 90th percentile ${bound}${figure(built.p90)}`,
  ];
  if (built.atLeast)
    notes.push(
      `${figure(built.atLeast)} began before the change log starts, so each is at least what's shown, and so are the median and the 90th percentile`,
    );
  if (built.n < 10) notes.push(`only ${figure(built.n)}, so the percentiles say little`);
  if (missing)
    notes.push(`${plural(missing, "row")} with none ${missing === 1 ? "isn't" : "aren't"} shown`);
  return {
    ok: true,
    more: 0,
    caption: sentences(notes),
    chart: { form: "spread", label: label(spec.value), spread: built, missing },
  };
}

function pivot(spec: Extract<ChartSpec, { form: "pivot" }>, input: ChartInput): ChartBuilt {
  const { rows, where, labels, label } = input;
  if (rows.length > maxPivotInput)
    return refuse(`${where} has ${rows.length} rows; a pivot takes at most ${maxPivotInput}`);
  if (!rows.length) return refuse(`${where} is empty`);
  const names = input.pinned
    ? [...new Set([spec.rows, spec.columns, spec.value])].flatMap((name) =>
        name === undefined ? [] : [name],
      )
    : Object.keys(labels).filter((name) => name !== "id");
  const flat = rows.map((row) =>
    Object.fromEntries(names.map((name) => [name, input.field(row, name)])),
  );
  const distinct = new Map<string, number>();
  const boundIn = (name: string) => {
    const bounded = input.bound(name);
    return bounded !== null && rows.some(bounded);
  };
  const kinds = new Map(
    names.map((name) => {
      const values = flat.map((row) => row[name]).filter((v) => v !== null && v !== undefined);
      if (values.length && values.every((v) => typeof v === "number" && Number.isFinite(v)))
        return [
          name,
          (input.sums === null || input.sums.includes(name)) && !boundIn(name) ? "measure" : "none",
        ] as const;
      distinct.set(name, new Set(values.map(String)).size);
      return [
        name,
        values.every((v) => typeof v === "string" || typeof v === "boolean") &&
        ((distinct.get(name) ?? 0) <= maxDistinct || name === spec.rows || name === spec.columns)
          ? ("dim" as const)
          : ("none" as const),
      ];
    }),
  );
  const splits = (name: string) => {
    const count = distinct.get(name) ?? 0;
    return count >= 2 && count <= Math.max(2, Math.ceil(rows.length / 2));
  };
  const wanted = (name: string | undefined, kind: "dim" | "measure", what: string) =>
    name === undefined || kinds.get(name) === kind
      ? null
      : `${JSON.stringify(name)} in ${where} isn't ${what}`;
  const wrong =
    wanted(spec.rows, "dim", "a field to group by") ??
    wanted(spec.columns, "dim", "a field to group by") ??
    wanted(spec.value, "measure", "a number to sum");
  if (wrong) return refuse(wrong);
  if (spec.columns !== undefined && spec.columns === spec.rows)
    return refuse("a pivot's rows and columns are two fields");
  const pick = (kind: "dim" | "measure", first: (string | undefined)[], most: number) => {
    const asked = first.flatMap((f) => (f === undefined ? [] : [f]));
    return [...new Set([...asked, ...names])]
      .filter(
        (name) =>
          kinds.get(name) === kind && (kind === "measure" || asked.includes(name) || splits(name)),
      )
      .slice(0, most);
  };
  const dims = pick("dim", [spec.rows, spec.columns], maxDims);
  const measures = pick("measure", [spec.value], maxMeasures);
  const tables: Record<string, PivotTable> = {};
  for (const down of input.pinned ? [spec.rows] : dims)
    for (const across of input.pinned
      ? [spec.columns ?? null]
      : [null, ...dims.filter((d) => d !== down)])
      tables[`${down}|${across ?? ""}`] = pivotOf(flat, down, across, measures);
  const measure = spec.value === undefined ? 0 : measures.indexOf(spec.value) + 1;
  return {
    ok: true,
    more: 0,
    caption: `${spec.value === undefined ? "Count" : `Sum of ${label(spec.value)}`} by ${label(spec.rows)}${spec.columns === undefined ? "" : ` and ${label(spec.columns)}`}, of ${plural(rows.length, "row")}${input.pinned ? "" : "; it can be regrouped in the window from this same read, with no model"}`,
    chart: {
      form: "pivot",
      dims: dims.map((field) => ({ field, label: label(field) })),
      measures: measures.map((field) => ({ field, label: label(field) })),
      tables,
      initial: { down: spec.rows, across: spec.columns ?? null, measure },
      n: rows.length,
    },
  };
}

const instant = refine(string, isInstant, "expected an instant");
const point = object({ at: instant, value: number });
const pivotTable = object({
  rows: array(string),
  columns: array(string),
  otherRows: number,
  otherColumns: number,
  cells: array(array(array(number))),
});
const named = array(object({ field: string, label: string }));
export const builtCharts = (base: Record<string, Validator<unknown>>) =>
  [
    object({
      ...base,
      form: literal("series"),
      step: union(...chartSteps.map((step) => literal(step))),
      running: boolean,
      label: string,
      measure: nullable(string),
      since: instant,
      asOf: instant,
      series: object({
        points: array(point),
        before: number,
        total: nullable(number),
        noFit: nullable(string),
        fit: nullable(
          object({
            line: object({ from: point, to: point }),
            r2: number,
            rate: number,
            weeks: number,
            forecast: nullable(
              object({ at: instant, early: instant, late: nullable(instant), left: number }),
            ),
            noForecast: nullable(string),
          }),
        ),
      }),
    }),
    object({
      ...base,
      form: literal("timeline"),
      since: instant,
      asOf: instant,
      undated: number,
      lanes: array(
        object({
          label: string,
          id: nullable(refine(string, isItemId, "expected an item ID")),
          start: instant,
          end: nullable(instant),
          due: nullable(instant),
          earlier: boolean,
          count: nullable(number),
          ended: nullable(number),
          late: nullable(number),
        }),
      ),
    }),
    object({
      ...base,
      form: literal("spread"),
      label: string,
      missing: number,
      spread: object({
        bins: array(object({ from: number, to: number, count: number, atLeast: number })),
        n: number,
        median: number,
        p90: number,
        min: number,
        max: number,
        atLeast: number,
      }),
    }),
    object({
      ...base,
      form: literal("pivot"),
      dims: named,
      measures: named,
      tables: record(pivotTable),
      initial: object({ down: string, across: nullable(string), measure: number }),
      n: number,
    }),
  ] as const;
