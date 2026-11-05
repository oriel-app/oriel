import assert from "node:assert/strict";
import { test } from "node:test";
import {
  binStart,
  dayMs,
  leastSquares,
  niceStep,
  pivotOf,
  quantile,
  seriesOf,
  spreadOf,
} from "./chart.ts";

const day = (iso: string) => Date.parse(`${iso}T12:00:00.000Z`);

test("a week starts on Monday, in UTC", () => {
  // Sunday Nov 1 2026 is in the week of Monday Oct 26.
  assert.equal(
    new Date(binStart(day("2026-11-01"), "week")).toISOString(),
    "2026-10-26T00:00:00.000Z",
  );
  assert.equal(
    new Date(binStart(day("2026-11-02"), "week")).toISOString(),
    "2026-11-02T00:00:00.000Z",
  );
  assert.equal(
    new Date(binStart(day("2026-11-04"), "day")).toISOString(),
    "2026-11-04T00:00:00.000Z",
  );
});

test("least squares finds an exact line, and R² falls with scatter", () => {
  const exact = leastSquares([0, 1, 2, 3].map((x) => ({ x, y: 2 * x + 1 })));
  assert.ok(exact);
  assert.ok(Math.abs(exact.slope - 2) < 1e-9 && Math.abs(exact.intercept - 1) < 1e-9);
  assert.equal(exact.r2, 1);
  const noisy = leastSquares([0, 3, 1, 4, 2, 5].map((y, x) => ({ x, y })));
  assert.ok(noisy && noisy.r2 < 1 && noisy.r2 > 0);
  assert.equal(leastSquares([{ x: 1, y: 1 }]), null);
  assert.equal(
    leastSquares([
      { x: 1, y: 1 },
      { x: 1, y: 2 },
    ]),
    null,
  );
});

test("quantiles interpolate, and a bin width is one a person reads", () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9.1);
  assert.equal(niceStep(37, 12), 5);
  assert.equal(niceStep(9, 12), 1);
  assert.equal(niceStep(140, 12), 20);
});

// Two done a week for eight whole weeks, from a horizon on a Monday.
const since = Date.parse("2026-09-07T00:00:00.000Z");
const steady = (weeks: number, each: number, open: number) => [
  ...Array.from({ length: weeks * each }, (_, i) => ({
    at: since + Math.floor(i / each) * 7 * dayMs + dayMs,
    weight: 1,
  })),
  ...Array.from({ length: open }, () => ({ at: null, weight: 1 })),
];

test("a running series fits a line and forecasts when the rest arrive, from the read's clock", () => {
  // Answered on the Monday after eight whole weeks: that week is still filling.
  const asOf = since + 8 * 7 * dayMs + 3_600_000;
  const built = seriesOf(steady(8, 2, 6), { since, asOf, step: "week", running: true, fit: true });
  assert.equal(built.points.length, 9);
  assert.deepEqual(
    built.points.map((p) => p.value),
    [2, 4, 6, 8, 10, 12, 14, 16, 16],
  );
  assert.equal(built.total, 22);
  assert.ok(built.fit);
  assert.ok(Math.abs(built.fit.rate - 2) < 1e-9);
  assert.equal(built.fit.r2, 1);
  // Six left at two a week: three weeks on from when it was answered. A
  // steady rate has no error, so the range is the date itself.
  const forecast = built.fit.forecast;
  assert.ok(forecast);
  assert.equal(forecast.left, 6);
  assert.equal(Date.parse(forecast.at), asOf + 21 * dayMs);
  assert.equal(forecast.early, forecast.at);
  assert.equal(forecast.late, forecast.at);
});

test("an uneven rate gives a range, wider on the slow side", () => {
  const asOf = since + 8 * 7 * dayMs;
  const rows = [3, 0, 2, 4, 1, 3, 0, 3].flatMap((n, week) =>
    Array.from({ length: n }, () => ({ at: since + week * 7 * dayMs + dayMs, weight: 1 })),
  );
  const built = seriesOf([...rows, ...Array.from({ length: 8 }, () => ({ at: null, weight: 1 }))], {
    since,
    asOf,
    step: "week",
    running: true,
    fit: true,
  });
  const forecast = built.fit?.forecast;
  assert.ok(forecast?.late);
  const at = Date.parse(forecast.at);
  assert.ok(Date.parse(forecast.early) < at && at < Date.parse(forecast.late));
  assert.ok(Date.parse(forecast.late) - at > at - Date.parse(forecast.early));
});

test("too little history, or too little happening, fits no line, and says why", () => {
  const asOf = since + 2 * 7 * dayMs + dayMs;
  const short = seriesOf(steady(2, 2, 3), { since, asOf, step: "week", running: true, fit: true });
  assert.equal(short.fit, null);
  assert.match(
    short.noFit ?? "",
    /too little history to fit a line: 2 whole weeks, and a fit needs 4/,
  );
  const quiet = seriesOf(
    [
      { at: since + dayMs, weight: 1 },
      { at: null, weight: 1 },
    ],
    {
      since,
      asOf: since + 8 * 7 * dayMs,
      step: "week",
      running: true,
      fit: true,
    },
  );
  assert.match(quiet.noFit ?? "", /too little happened/);
});

test("a line is fitted to whole weeks alone, and needs five events, whatever they weigh", () => {
  // The log starts on a Thursday: its first week is partial, so three whole
  // weeks follow it before the Monday the read was answered on.
  const thursday = since + 3 * dayMs;
  const asOf = since + 4 * 7 * dayMs + 3_600_000;
  const rows = steady(4, 2, 4).map((row) =>
    row.at === null ? row : { ...row, at: Math.max(row.at, thursday + dayMs) },
  );
  const partial = seriesOf(rows, { since: thursday, asOf, step: "week", running: true, fit: true });
  assert.equal(partial.fit, null);
  assert.match(partial.noFit ?? "", /3 whole weeks, and a fit needs 4/);
  // Days aren't weeks.
  const daily = seriesOf(steady(8, 2, 0), {
    since,
    asOf: since + 8 * 7 * dayMs,
    step: "day",
    running: true,
    fit: true,
  });
  assert.match(daily.noFit ?? "", /fitted to whole weeks/);
  // Two events worth eight points each are two events, running or not.
  const heavy = [
    { at: since + 8 * dayMs, weight: 8 },
    { at: since + 30 * dayMs, weight: 8 },
  ];
  for (const running of [true, false]) {
    const built = seriesOf(heavy, {
      since,
      asOf: since + 8 * 7 * dayMs,
      step: "week",
      running,
      fit: true,
    });
    assert.match(built.noFit ?? "", /too little happened to fit a line: 2 in 8 whole weeks/);
  }
});

test("rows dated by the horizon start a running series and are left out of a plain one", () => {
  const asOf = since + 3 * 7 * dayMs;
  const rows = [
    { at: since, weight: 1 },
    { at: since - dayMs, weight: 1 },
    { at: since + dayMs, weight: 1 },
  ];
  const running = seriesOf(rows, { since, asOf, step: "week", running: true, fit: false });
  assert.equal(running.before, 2);
  assert.equal(running.points[0]?.value, 3);
  const plain = seriesOf(rows, { since, asOf, step: "week", running: false, fit: false });
  assert.equal(plain.points[0]?.value, 1);
  assert.equal(plain.total, null);
});

test("a stalled running series isn't forecast, and nor is one past six months", () => {
  const asOf = since + 8 * 7 * dayMs;
  const stalled = seriesOf(
    [...steady(1, 6, 0), ...Array.from({ length: 3 }, () => ({ at: null, weight: 1 }))],
    { since, asOf, step: "week", running: true, fit: true },
  );
  assert.equal(stalled.fit?.forecast, null);
  assert.ok(stalled.fit?.noForecast);
  const slow = seriesOf(steady(8, 1, 200), { since, asOf, step: "week", running: true, fit: true });
  assert.match(slow.fit?.noForecast ?? "", /within six months/);
});

test("a spread bins its values and marks the median and 90th percentile; bounds make them bounds", () => {
  const values = [1, 2, 2, 3, 5, 8, 13, 21, 34, 40].map((value) => ({
    value,
    atLeast: value === 40,
  }));
  const spread = spreadOf(values);
  assert.ok(spread);
  assert.equal(spread.n, 10);
  assert.equal(spread.median, 6.5);
  assert.equal(spread.atLeast, 1);
  assert.equal(
    spread.bins.reduce((sum, bin) => sum + bin.count, 0),
    10,
  );
  assert.ok(spread.bins.length <= 12);
  assert.equal(spreadOf([]), null);
  // Thirteen whole numbers from 0 take a wider bin, not a thirteenth.
  const thirteen = spreadOf(Array.from({ length: 13 }, (_, value) => ({ value, atLeast: false })));
  assert.ok(thirteen && thirteen.bins.length <= 12);
  assert.equal(
    thirteen.bins.reduce((sum, bin) => sum + bin.count, 0),
    13,
  );
});

test("a pivot counts and sums each cell, folding the rarest values into Other", () => {
  const rows = [
    ...Array.from({ length: 12 }, (_, i) => ({ who: `p${i}`, state: "To do", points: 1 })),
    { who: "p0", state: "Done", points: 5 },
    { who: null, state: "Done", points: null },
  ];
  const table = pivotOf(rows, "who", "state", ["points"]);
  assert.equal(table.rows.length, 10);
  assert.equal(table.rows[0], "p0");
  assert.equal(table.rows.at(-1), "Other");
  assert.equal(table.otherRows, 4);
  const done = table.columns.indexOf("Done");
  assert.deepEqual(table.cells[0]?.[done], [1, 5]);
  const total = table.cells.flat().reduce((sum, cell) => sum + (cell[0] ?? 0), 0);
  assert.equal(total, rows.length);
});
