// The figures behind a chart block (decision 0030's guarantee, for time and
// spread): weeks binned from dates, a least-squares line with its R², a
// forecast from it with a range, quantiles, histogram bins and a pivot's
// tables. Every number a chart draws or its caption states comes from here,
// in Oriel's code, from a read's result; none from the agent. Pure, and the
// clock is the read's own `asOf`, never the machine's.
import type { Instant } from "./ids.ts";

export const dayMs = 86_400_000;
const weekMs = 7 * dayMs;

export const chartSteps = ["day", "week"] as const;
export type ChartStep = (typeof chartSteps)[number];
const stepMs = (step: ChartStep) => (step === "day" ? dayMs : weekMs);

// Where the bin holding `at` starts: midnight UTC, or Monday's for a week.
export function binStart(at: number, step: ChartStep): number {
  const day = Math.floor(at / dayMs) * dayMs;
  if (step === "day") return day;
  // 1970-01-01 was a Thursday: Monday is three days on from the epoch's week.
  const sinceMonday = (Math.floor(day / dayMs) + 3) % 7;
  return day - sinceMonday * dayMs;
}

// A date as the caption writes it: "Nov 30".
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDate(at: number | string): string {
  const date = new Date(typeof at === "string" ? Date.parse(at) : at);
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`;
}
const iso = (at: number) => new Date(at).toISOString() as Instant;

// A number as a caption writes it: whole when it is, else to one place.
export function figure(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toLocaleString("en-US") : rounded.toFixed(1);
}

export type Line = { slope: number; intercept: number; r2: number; n: number };

// The least-squares line through the points, and its R²; null with fewer
// than two distinct x, which no line fits. A flat series fits with R² 1 when
// every point is on it and 0 otherwise.
export function leastSquares(points: readonly { x: number; y: number }[]): Line | null {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((sum, p) => sum + p.x, 0) / n;
  const my = points.reduce((sum, p) => sum + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const { x, y } of points) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
    syy += (y - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const residual = points.reduce((sum, p) => sum + (p.y - (intercept + slope * p.x)) ** 2, 0);
  const r2 = syy === 0 ? (residual === 0 ? 1 : 0) : 1 - residual / syy;
  return { slope, intercept, r2, n };
}

// The value below which `q` of the sorted values fall, interpolating between
// neighbours (the usual "type 7").
export function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return Number.NaN;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  const low = sorted[lo] ?? 0;
  return low + ((sorted[hi] ?? low) - low) * (at - lo);
}

// A bin width a person reads easily, 1, 2 or 5 times a power of ten, giving
// at most `most` bins over the range.
export function niceStep(range: number, most: number): number {
  if (range <= 0) return 1;
  const rough = range / most;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((m) => m >= rough) ?? 10 * power;
  return Math.max(step, Number.EPSILON);
}

// What a series needs before Oriel fits a line to it, and forecasts from it.
export const minFitBins = 4;
export const minFitEvents = 5;
export const minForecastR2 = 0.6;
// A forecast further out than this isn't one: it says so instead.
export const maxForecastDays = 182;
// The forecast's range: the rate's 80% interval, ±1.2816 standard errors.
const z80 = 1.2816;

export type SeriesPoint = { at: Instant; value: number };
export type SeriesFit = {
  // Per step, as drawn: the line's value at the first and last bins.
  line: { from: SeriesPoint; to: SeriesPoint };
  r2: number;
  // The rate the line rises by, per step, and how many whole steps it fits.
  rate: number;
  weeks: number;
  // When a running series reaches its total at that rate, with its range,
  // or why there's no forecast.
  forecast: { at: Instant; early: Instant; late: Instant | null; left: number } | null;
  noForecast: string | null;
};

export type Series = {
  points: SeriesPoint[];
  // Rows dated at or before the read's horizon: known to have happened by
  // then, but not when. A running series starts from them.
  before: number;
  // A running series' whole: every row's value, dated or not.
  total: number | null;
  fit: SeriesFit | null;
  // Why the series has no line, when it was asked for one.
  noFit: string | null;
};

// A series of rows' dates, binned by `step` from the read's horizon to its
// `asOf`, counting rows (`weight` 1) or summing a field. Running, each bin
// holds everything up to it, from the rows already dated by the horizon, and
// the total counts every row, dated or not, so what's left is the undated
// rows. With `fit`, a least-squares line over the bins, and for a running
// series a forecast of when it reaches its total at the line's rate.
export function seriesOf(
  rows: readonly { at: number | null; weight: number }[],
  options: { since: number; asOf: number; step: ChartStep; running: boolean; fit: boolean },
): Series {
  const { since, asOf, step, running } = options;
  const first = binStart(since, step);
  const last = binStart(asOf, step);
  const width = stepMs(step);
  const bins = Math.max(1, Math.round((last - first) / width) + 1);
  const values = Array.from({ length: bins }, () => 0);
  let before = 0;
  let total = 0;
  for (const { at, weight } of rows) {
    total += weight;
    if (at === null || at > asOf) continue;
    if (at <= since) {
      before += weight;
      continue;
    }
    const bin = Math.round((binStart(at, step) - first) / width);
    const i = Math.min(Math.max(bin, 0), bins - 1);
    values[i] = (values[i] ?? 0) + weight;
  }
  let sum = before;
  const points = values.map((value, i) => {
    sum += value;
    return { at: iso(first + i * width), value: running ? sum : value };
  });
  const base = { points, before, total: running ? total : null };
  if (!options.fit) return { ...base, fit: null, noFit: null };
  // The bin the read was answered in is still filling, so the line is
  // fitted to the bins before it, and only drawn across it.
  const fitted = asOf < last + width - 1 ? bins - 1 : bins;
  const events = values.slice(0, fitted).reduce((a, b) => a + b, 0);
  const unit = step === "day" ? "days" : "weeks";
  if (fitted < minFitBins)
    return {
      ...base,
      fit: null,
      noFit: `too little history to fit a line: ${fitted} whole ${fitted === 1 ? step : unit}, and a fit needs ${minFitBins}`,
    };
  if (events < minFitEvents && running)
    return {
      ...base,
      fit: null,
      noFit: `too little happened to fit a line: ${figure(events)} since ${shortDate(since)}`,
    };
  const line = leastSquares(points.slice(0, fitted).map((p, i) => ({ x: i, y: p.value })));
  if (!line) return { ...base, fit: null, noFit: "no line fits a single point" };
  const at = (i: number) => ({
    at: iso(first + i * width),
    value: line.intercept + line.slope * i,
  });
  const fit = {
    line: { from: at(0), to: at(bins - 1) },
    r2: line.r2,
    rate: line.slope,
    weeks: fitted,
  };
  if (!running) return { ...base, fit: { ...fit, forecast: null, noForecast: null }, noFit: null };
  return {
    ...base,
    fit: { ...fit, ...forecastOf(values.slice(0, fitted), sum, total, line, asOf, step) },
    noFit: null,
  };
}

// When a running series at `reached` of `total` gets there, from when the
// read was answered, at the line's rate, with a range from the rate's standard error. The
// steps rise by independent amounts, which a running total's own residuals
// don't, so the error comes from each step's rise, not from the line's fit
// to the running total, which would understate it.
function forecastOf(
  rises: readonly number[],
  reached: number,
  total: number,
  line: Line,
  asOf: number,
  step: ChartStep,
): Pick<SeriesFit, "forecast" | "noForecast"> {
  const left = total - reached;
  const none = (why: string) => ({ forecast: null, noForecast: why });
  if (left <= 0) return none("every one is there");
  if (line.slope <= 0) return none("it isn't rising, so no forecast");
  if (line.r2 < minForecastR2)
    return none(`the rate is too uneven to forecast from (R² ${line.r2.toFixed(2)})`);
  const n = rises.length;
  const mean = rises.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rises.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(n - 1, 1));
  const error = sd / Math.sqrt(n);
  const width = stepMs(step);
  // What's left, from when the read was answered, at each rate.
  const after = (rate: number) => asOf + (left / rate) * width;
  const at = after(line.slope);
  if (at - asOf > maxForecastDays * dayMs)
    return none(`at ${figure(line.slope)} a ${step} it wouldn't get there within six months`);
  const fast = line.slope + z80 * error;
  const slow = line.slope - z80 * error;
  const late = slow > 0 ? after(slow) : null;
  return {
    forecast: {
      at: iso(at),
      early: iso(after(fast)),
      late: late === null || late - asOf > maxForecastDays * dayMs ? null : iso(late),
      left,
    },
    noForecast: null,
  };
}

export type Bin = { from: number; to: number; count: number; atLeast: number };
export type Spread = {
  bins: Bin[];
  n: number;
  median: number;
  p90: number;
  min: number;
  max: number;
  // How many values are only lower bounds: the true value is at least it.
  atLeast: number;
};

export const maxSpreadBins = 12;

// Values in at most 12 bins of a width a person reads easily, with the
// median and the 90th percentile. Where some values are only lower bounds,
// so are the quantiles: every true value is at least its bound.
export function spreadOf(values: readonly { value: number; atLeast: boolean }[]): Spread | null {
  if (!values.length) return null;
  const sorted = values.map((v) => v.value).toSorted((a, b) => a - b);
  const min = sorted[0] ?? 0;
  const max = sorted.at(-1) ?? 0;
  const width = niceStep(max - min, maxSpreadBins);
  const start = Math.floor(min / width) * width;
  const count = Math.max(1, Math.floor((max - start) / width) + 1);
  const bins = Array.from({ length: count }, (_, i) => ({
    from: start + i * width,
    to: start + (i + 1) * width,
    count: 0,
    atLeast: 0,
  }));
  for (const { value, atLeast } of values) {
    const bin = bins[Math.min(Math.floor((value - start) / width), count - 1)];
    if (!bin) continue;
    bin.count += 1;
    if (atLeast) bin.atLeast += 1;
  }
  return {
    bins,
    n: values.length,
    median: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    min,
    max,
    atLeast: values.filter((v) => v.atLeast).length,
  };
}

// A pivot's grid: the values of one field down, another's across (or none),
// each cell holding how many rows fall in it and the sum of each measure.
// The most common values first, then by name; past the cap, the rest fold
// into one "Other" row or column, which says how many values it holds.
export const maxPivotRows = 10;
export const maxPivotColumns = 6;
export const otherValue = "Other";
export const blankValue = "—";

export type PivotTable = {
  rows: string[];
  columns: string[];
  // How many values each "Other" folds in, when there is one.
  otherRows: number;
  otherColumns: number;
  // [row][column][measure]: measure 0 is the count, then each sum in order.
  cells: number[][][];
};

const keyOf = (value: unknown): string =>
  value === null || value === undefined || value === ""
    ? blankValue
    : typeof value === "boolean"
      ? value
        ? "yes"
        : "no"
      : String(value);

function ranked(values: readonly string[], cap: number): { kept: string[]; folded: number } {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const order = [...counts]
    .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value]) => value);
  if (order.length <= cap) return { kept: order, folded: 0 };
  return { kept: order.slice(0, cap - 1), folded: order.length - (cap - 1) };
}

export function pivotOf(
  rows: readonly Record<string, unknown>[],
  down: string,
  across: string | null,
  measures: readonly string[],
): PivotTable {
  const downKeys = rows.map((row) => keyOf(row[down]));
  const acrossKeys = rows.map((row) => (across === null ? "" : keyOf(row[across])));
  const r = ranked(downKeys, maxPivotRows);
  const c = across === null ? { kept: [""], folded: 0 } : ranked(acrossKeys, maxPivotColumns);
  const rowNames = r.folded ? [...r.kept, otherValue] : r.kept;
  const columnNames = c.folded ? [...c.kept, otherValue] : c.kept;
  const cells = rowNames.map(() => columnNames.map(() => measures.map(() => 0).concat(0)));
  const place = (names: readonly string[], key: string, folded: number) => {
    const i = names.indexOf(key);
    return i >= 0 ? i : folded ? names.length - 1 : -1;
  };
  rows.forEach((row, i) => {
    const ri = place(rowNames, downKeys[i] ?? "", r.folded);
    const ci = place(columnNames, acrossKeys[i] ?? "", c.folded);
    const cell = cells[ri]?.[ci];
    if (!cell) return;
    cell[0] = (cell[0] ?? 0) + 1;
    measures.forEach((measure, m) => {
      const value = row[measure];
      if (typeof value === "number" && Number.isFinite(value))
        cell[m + 1] = (cell[m + 1] ?? 0) + value;
    });
  });
  return {
    rows: rowNames,
    columns: columnNames,
    otherRows: r.folded,
    otherColumns: c.folded,
    cells,
  };
}
