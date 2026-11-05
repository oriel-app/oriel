// A chart's drawing is hidden from a screen reader, which reads a table of
// its values instead (OA-262). Each table holds every value its chart draws:
// a series' points, whole, line and forecast; a timeline's bars, for the
// lanes drawn; a spread's bins and its two marks. The pivot is a table
// already. Node can't render a .tsx chart, so this checks the tables against
// the chart's data, which the drawing places.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChartBlock, Lane } from "@oriel/core/block-charts";
import { seriesValues, spreadValues, timelineValues } from "../src/chart-values.ts";

type Of<F extends ChartBlock["form"]> = Extract<ChartBlock, { form: F }>;
// An instant as the view carries it.
const on = (date: string) => date as Of<"series">["since"];

const series = (over: Partial<Of<"series">> = {}): Of<"series"> => ({
  form: "series",
  step: "week",
  running: true,
  label: "Done",
  measure: null,
  since: on("2026-09-07T00:00:00.000Z"),
  asOf: on("2026-10-01T00:00:00.000Z"),
  series: {
    points: [
      { at: on("2026-09-07T00:00:00.000Z"), value: 1 },
      { at: on("2026-09-14T00:00:00.000Z"), value: 4 },
      { at: on("2026-09-21T00:00:00.000Z"), value: 6.25 },
    ],
    before: 0,
    total: 40,
    fit: {
      line: {
        from: { at: on("2026-09-07T00:00:00.000Z"), value: 1.2 },
        to: { at: on("2026-09-21T00:00:00.000Z"), value: 6.1 },
      },
      r2: 0.987,
      rate: 2.5,
      weeks: 3,
      forecast: {
        at: on("2026-12-22T00:00:00.000Z"),
        early: on("2026-12-17T00:00:00.000Z"),
        late: null,
        left: 34,
      },
      noForecast: null,
    },
    noFit: null,
  },
  ...over,
});

test("a series' table has a row per point drawn, then its whole, its line and its forecast", () => {
  const table = seriesValues(series());
  assert.equal(table.caption, "Done");
  assert.deepEqual(table.head, ["Week", "Count, running"]);
  assert.deepEqual(table.rows, [
    ["Week of Sep 7", "1"],
    ["Week of Sep 14", "4"],
    ["Week of Sep 21", "6.3"],
    ["In all", "40"],
    ["Least-squares line", "1.2 on Sep 7 to 6.1 on Sep 21, R² 0.99"],
    ["Forecast", "Dec 22, 80% range: Dec 17 to later than six months"],
  ]);
});

test("a series' line, below zero at its start, is given from where it's drawn: zero", () => {
  const base = series();
  const fit = base.series.fit;
  assert.ok(fit);
  const table = seriesValues(
    series({
      series: {
        ...base.series,
        fit: {
          ...fit,
          line: {
            from: { at: on("2026-09-07T00:00:00.000Z"), value: -2 },
            to: { at: on("2026-09-21T00:00:00.000Z"), value: 2 },
          },
        },
      },
    }),
  );
  assert.deepEqual(table.rows[4], ["Least-squares line", "0 on Sep 14 to 2 on Sep 21, R² 0.99"]);
});

test("a series by day, summed and not running, is a row per day and nothing drawn besides", () => {
  const base = series();
  const table = seriesValues(
    series({
      step: "day",
      running: false,
      measure: "Estimate",
      series: { ...base.series, total: null, fit: null },
    }),
  );
  assert.deepEqual(table.head, ["Day", "Sum of Estimate"]);
  assert.deepEqual(table.rows, [
    ["Sep 7", "1"],
    ["Sep 14", "4"],
    ["Sep 21", "6.3"],
  ]);
});

const lane = (over: Partial<Lane>): Lane => ({
  label: "",
  id: null,
  start: on("2026-09-07T00:00:00.000Z"),
  end: null,
  due: null,
  earlier: false,
  count: null,
  ended: null,
  late: null,
  ...over,
});

test("a timeline's table has a row per lane drawn, with only the columns some lane has", () => {
  const chart: Of<"timeline"> & { names: Record<string, string> } = {
    form: "timeline",
    since: on("2026-09-07T00:00:00.000Z"),
    asOf: on("2026-10-01T00:00:00.000Z"),
    undated: 0,
    names: { "jira:SYN-1": "Checkout" },
    lanes: [
      lane({
        label: "jira:SYN-1",
        earlier: true,
        end: on("2026-09-20T00:00:00.000Z"),
        due: on("2026-09-15T00:00:00.000Z"),
        late: 5,
      }),
      lane({ label: "Boarding", start: on("2026-09-10T00:00:00.000Z") }),
      lane({ label: "Not drawn in a pin" }),
    ],
  };
  const table = timelineValues(chart, chart.lanes.slice(0, 2));
  assert.deepEqual(table.head, ["Name", "Started", "Ended", "Due", "Late"]);
  assert.deepEqual(table.rows, [
    ["Checkout", "by Sep 7", "Sep 20", "Sep 15", "5 days"],
    ["Boarding", "Sep 10", "still going", "", ""],
  ]);
  const groups = timelineValues(chart, [lane({ label: "Epic", count: 4, ended: 1 })]);
  assert.deepEqual(groups.head, ["Name", "Started", "Ended", "Rows ended"]);
  assert.deepEqual(groups.rows, [["Epic", "Sep 7", "still going", "1 of 4"]]);
});

test("a spread's table has a row per bin, then the median and the 90th percentile", () => {
  const table = spreadValues({
    form: "spread",
    label: "Days in its state",
    missing: 0,
    spread: {
      bins: [
        { from: 0, to: 5, count: 3, atLeast: 0 },
        { from: 5, to: 10, count: 4, atLeast: 2 },
      ],
      n: 7,
      median: 5,
      p90: 9.25,
      min: 1,
      max: 9,
      atLeast: 2,
    },
  });
  assert.equal(table.caption, "Days in its state");
  assert.deepEqual(table.head, ["Days in its state", "Value"]);
  assert.deepEqual(table.rows, [
    ["0–5", "3 rows"],
    ["5–10", "4 rows, 2 of them at least this"],
    ["Median", "≥ 5"],
    ["90th percentile", "≥ 9.3"],
  ]);
});
