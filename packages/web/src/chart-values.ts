// A chart's values as words (OA-262): what charts.tsx draws for the series,
// the timeline and the spread, as the rows of a table a screen reader can
// walk, and the tooltips on its marks, from the one place. The pivot
// renders as HTML and needs none.
import type { ChartBlock, Lane } from "@oriel/core/block-charts";

type Of<F extends ChartBlock["form"]> = Extract<ChartBlock, { form: F }> & {
  names?: Readonly<Record<string, string>>;
};

// A label as every block shows it: an item's name when it is an item's ID.
export const named = (block: { names?: Readonly<Record<string, string>> }, label: string) =>
  (block.names && Object.hasOwn(block.names, label) ? block.names[label] : undefined) ?? label;
// The mark every block puts before a figure that is only a lower bound.
export const atLeast = (bound: unknown) => (bound ? "≥ " : "");

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dateLabel = (at: number) => {
  const date = new Date(at);
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`;
};
export const number = (value: number) =>
  (Math.round(value * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });

// A table of a chart's values: each row starts with what it is, a header
// for its row, then its figures under `head`'s columns.
export type ValueTable = { caption: string | null; head: string[]; rows: string[][] };

// A series: a row per week or day as drawn, then the whole, the fitted line
// and the forecast, as the drawing shows them.
export function seriesValues(chart: Of<"series">): ValueTable {
  const { series, step, running } = chart;
  const when = (at: number) => (step === "day" ? dateLabel(at) : `Week of ${dateLabel(at)}`);
  const what = chart.measure === null ? "Count" : `Sum of ${chart.measure}`;
  const rows = series.points.map((p) => [when(Date.parse(p.at)), number(p.value)]);
  if (running && series.total !== null) rows.push(["In all", number(series.total)]);
  const fit = fitLine(series);
  if (fit && series.fit)
    rows.push([
      "Least-squares line",
      `${number(fit.y1)} on ${dateLabel(fit.x1)} to ${number(fit.y2)} on ${dateLabel(fit.x2)}, R² ${series.fit.r2.toFixed(2)}`,
    ]);
  const forecast = series.fit?.forecast;
  if (forecast && series.total !== null)
    rows.push(["Forecast", `${dateLabel(Date.parse(forecast.at))}, ${forecastRange(forecast)}`]);
  return {
    caption: chart.label,
    head: [step === "day" ? "Day" : "Week", running ? `${what}, running` : what],
    rows,
  };
}

// The fitted line as drawn: from where it rises above zero, if it starts
// below.
export function fitLine(series: Of<"series">["series"]) {
  if (!series.fit) return null;
  const { from, to } = series.fit.line;
  let x1 = Date.parse(from.at);
  let y1 = from.value;
  const x2 = Date.parse(to.at);
  const y2 = to.value;
  if (y1 < 0 && y2 > 0) {
    x1 += ((0 - y1) / (y2 - y1)) * (x2 - x1);
    y1 = 0;
  }
  return { x1, y1, x2, y2 };
}

export const forecastRange = (forecast: { early: string; late: string | null }) =>
  `80% range: ${dateLabel(Date.parse(forecast.early))} to ${forecast.late ? dateLabel(Date.parse(forecast.late)) : "later than six months"}`;

// A timeline's bar, in words: when it started and ended, when it was due,
// how late, and for a group how many of its rows ended.
export function laneValues(lane: Lane) {
  const start = Date.parse(lane.start);
  return {
    started: lane.earlier ? `by ${dateLabel(start)}` : dateLabel(start),
    ended: lane.end ? dateLabel(Date.parse(lane.end)) : null,
    due: lane.due === null ? null : dateLabel(Date.parse(lane.due)),
    late: lane.late === null ? null : `${lane.late} days`,
    rows: lane.count === null ? null : `${lane.ended} of ${lane.count}`,
  };
}

// The tooltip on a timeline's bar.
export const laneText = (v: ReturnType<typeof laneValues>) =>
  [
    `started ${v.started}`,
    v.ended ? `ended ${v.ended}` : "still going",
    v.due && `due ${v.due}`,
    v.late && `${v.late} late`,
    v.rows && `${v.rows} ended`,
  ]
    .filter(Boolean)
    .join(", ");

// A timeline: a row per lane drawn, with only the columns some lane has.
export function timelineValues(chart: Of<"timeline">, lanes: readonly Lane[]): ValueTable {
  type Values = ReturnType<typeof laneValues>;
  const all: [string, (v: Values) => string][] = [
    ["Started", (v) => v.started],
    ["Ended", (v) => v.ended ?? "still going"],
    ["Due", (v) => v.due ?? ""],
    ["Late", (v) => v.late ?? ""],
    ["Rows ended", (v) => v.rows ?? ""],
  ];
  const values = lanes.map((lane) => ({ name: named(chart, lane.label), ...laneValues(lane) }));
  const columns = all.filter(([, cell]) => values.some((v) => cell(v) !== ""));
  return {
    caption: null,
    head: ["Name", ...columns.map(([name]) => name)],
    rows: values.map((v) => [v.name, ...columns.map(([, cell]) => cell(v))]),
  };
}

// A spread: a row per bin, then the median and the 90th percentile.
export function spreadValues(chart: Of<"spread">): ValueTable {
  const { spread } = chart;
  const bound = atLeast(spread.atLeast);
  return {
    caption: chart.label,
    head: [chart.label, "Rows"],
    rows: [
      ...spread.bins.map((bin) => [
        `${number(bin.from)}–${number(bin.to)}`,
        `${bin.count}${bin.atLeast ? `, ${bin.atLeast} of them at least this` : ""}`,
      ]),
      ["Median", `${bound}${number(spread.median)}`],
      ["90th percentile", `${bound}${number(spread.p90)}`],
    ],
  };
}
