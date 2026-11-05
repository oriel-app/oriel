// The chart blocks (decision 0053, under 0030's guarantee): a
// series over time, a timeline, a spread and a pivot. Every figure and line
// here is one Oriel computed from a read and sent as data; this file only
// places them. Thin marks in the theme's tokens, one series colour, hairline
// axes; a dashed line is a projection (the fitted line and the forecast),
// never a grid. Each mark carries its value in a tooltip, and the caption
// under the block says how it was computed. A drawing is hidden from a screen
// reader, which reads a visually hidden table of the same values instead
// (chart-values.ts). `compact` is a pin's: smaller, with fewer labels, the
// same marks.
import { useContext, useState } from "preact/hooks";
import type { ChartBlock } from "@oriel/core/block-charts";
import {
  atLeast,
  dateLabel,
  fitLine,
  forecastRange,
  laneText,
  laneValues,
  named,
  number,
  seriesValues,
  spreadValues,
  timelineValues,
  type ValueTable,
} from "./chart-values.ts";
import { ItemLinksContext } from "./parts.tsx";
import type { BlockView } from "./view.ts";

type Of<F extends ChartBlock["form"]> = Extract<BlockView, { form: F }>;

const day = 86_400_000;

// What a screen reader reads in a drawing's place: its values as a table,
// out of sight.
function Values({ table }: { table: ValueTable }) {
  return (
    <table class="visually-hidden">
      {table.caption && <caption>{table.caption}</caption>}
      <thead>
        <tr>
          {table.head.map((name, j) => (
            <th key={j} scope="col">
              {name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map(([name, ...cells], i) => (
          <tr key={i}>
            <th scope="row">{name}</th>
            {cells.map((cell, j) => (
              <td key={j}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Round ticks from zero up past `top`: 1, 2 or 5 times a power of ten.
function ticks(top: number, most = 4): number[] {
  if (top <= 0) return [0, 1];
  const rough = top / most;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((m) => m >= rough) ?? 10 * power;
  const count = Math.ceil(top / step - 1e-9);
  return Array.from({ length: count + 1 }, (_, i) => i * step);
}

// Dates to label along a time axis: about `most`, a whole number of days
// apart, from the first.
function dateTicks(from: number, to: number, most: number): number[] {
  const span = Math.max(to - from, day);
  const stepDays = Math.max(1, Math.ceil(span / day / most / 7) * 7);
  const out: number[] = [];
  for (let at = from; at <= to + 1; at += stepDays * day) out.push(at);
  return out;
}

// A column from `base` up to `top`: its data end rounded, 4 units at most,
// and square where it meets the baseline.
function column(x: number, top: number, width: number, base: number): string {
  const r = Math.min(4, width / 2, Math.max(base - top, 0));
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + width - r}Q${x + width},${top} ${x + width},${top + r}V${base}Z`;
}

// The drawing's width in its own units, about its width on the page, so
// its text is the page's size; a pin's is narrower.
const widthOf = (compact: boolean | undefined) => (compact ? 420 : 640);

export function SeriesChart({ chart, compact }: { chart: Of<"series">; compact?: boolean }) {
  const { series, running, step } = chart;
  const width = widthOf(compact);
  const height = compact ? 120 : 220;
  const pad = {
    left: compact ? 8 : 36,
    right: compact ? 44 : 56,
    top: 14,
    bottom: compact ? 18 : 26,
  };
  const points = series.points.map((p) => ({ at: Date.parse(p.at), value: p.value }));
  const first = points[0]?.at ?? Date.parse(chart.since);
  const asOf = Date.parse(chart.asOf);
  const forecast = series.fit?.forecast ?? null;
  const end = Math.max(
    asOf,
    points.at(-1)?.at ?? asOf,
    forecast ? Date.parse(forecast.late ?? forecast.at) : 0,
  );
  const fitTop = series.fit ? Math.max(series.fit.line.from.value, series.fit.line.to.value) : 0;
  const top = Math.max(series.total ?? 0, fitTop, ...points.map((p) => p.value), 1);
  const yTicks = ticks(top, compact ? 2 : 4);
  const yMax = yTicks.at(-1) ?? top;
  const x = (at: number) =>
    pad.left + ((at - first) / Math.max(end - first, day)) * (width - pad.left - pad.right);
  const y = (value: number) => pad.top + (1 - value / yMax) * (height - pad.top - pad.bottom);
  const binWidth = step === "day" ? day : 7 * day;
  const thick = Math.min(24, Math.max(2, (x(first + binWidth) - x(first)) * 0.7));
  const fit = fitLine(series);
  const last = points.at(-1);
  // The value now: the running total as the read was answered.
  const reached = last?.value ?? 0;
  const values = seriesValues(chart);
  // A point's tooltip: its row in the table.
  const tip = (i: number) => values.rows[i]?.join(": ");
  return (
    <>
      <svg class="chart" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {!compact &&
          yTicks.map((tick) => (
            <g key={tick} class="chart-grid">
              <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
              <text x={pad.left - 6} y={y(tick)} dy="0.32em" text-anchor="end">
                {number(tick)}
              </text>
            </g>
          ))}
        <line class="chart-axis" x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} />
        {dateTicks(first, end, compact ? 3 : 6).map((at) => (
          <text key={at} class="chart-tick" x={x(at)} y={height - 4} text-anchor="middle">
            {dateLabel(at)}
          </text>
        ))}
        {running && series.total !== null && (
          <g class="chart-total">
            <line x1={pad.left} x2={width - pad.right} y1={y(series.total)} y2={y(series.total)} />
            <text x={width - pad.right + 4} y={y(series.total)} dy="0.32em">
              {number(series.total)} in all
            </text>
          </g>
        )}
        {running ? (
          <>
            <polyline
              class="chart-line"
              points={points.map((p) => `${x(p.at)},${y(p.value)}`).join(" ")}
            />
            {points.map((p, i) => (
              <circle key={p.at} class="chart-hit" cx={x(p.at)} cy={y(p.value)} r={8}>
                <title>{tip(i)}</title>
              </circle>
            ))}
            {last && <circle class="chart-dot" cx={x(last.at)} cy={y(last.value)} r={4} />}
          </>
        ) : (
          points.map((p, i) => (
            <path
              key={p.at}
              class="chart-column"
              d={column(x(p.at + binWidth / 2) - thick / 2, y(p.value), thick, y(0))}
            >
              <title>{tip(i)}</title>
            </path>
          ))
        )}
        {fit && (
          <line class="chart-fit" x1={x(fit.x1)} y1={y(fit.y1)} x2={x(fit.x2)} y2={y(fit.y2)}>
            <title>{`Least-squares line, R² ${series.fit?.r2.toFixed(2)}`}</title>
          </line>
        )}
        {forecast && series.total !== null && (
          <g class="chart-forecast">
            <rect
              class="chart-range"
              x={x(Date.parse(forecast.early))}
              width={Math.max(
                x(Date.parse(forecast.late ?? forecast.at)) - x(Date.parse(forecast.early)),
                2,
              )}
              y={y(series.total) - 5}
              height={10}
              rx={3}
            >
              <title>{forecastRange(forecast)}</title>
            </rect>
            <line
              x1={x(asOf)}
              y1={y(reached)}
              x2={x(Date.parse(forecast.at))}
              y2={y(series.total)}
            />
            <circle class="chart-dot" cx={x(Date.parse(forecast.at))} cy={y(series.total)} r={4} />
            <text x={x(Date.parse(forecast.at))} y={y(series.total) - 10} text-anchor="middle">
              {dateLabel(Date.parse(forecast.at))}
            </text>
          </g>
        )}
        <g class="chart-today">
          <line x1={x(asOf)} x2={x(asOf)} y1={pad.top - 6} y2={y(0)} />
          {!compact && (
            <text x={x(asOf)} y={pad.top - 8} text-anchor="middle">
              today
            </text>
          )}
        </g>
        {last && (
          <text class="chart-end" x={x(last.at) + 8} y={y(last.value)} dy="0.32em">
            {running ? number(reached) : ""}
          </text>
        )}
      </svg>
      <Values table={values} />
    </>
  );
}

export function TimelineChart({ chart, compact }: { chart: Of<"timeline">; compact?: boolean }) {
  const lanes = compact ? chart.lanes.slice(0, 3) : chart.lanes;
  const asOf = Date.parse(chart.asOf);
  const starts = lanes.map((lane) => Date.parse(lane.start));
  const from = Math.min(...starts, asOf);
  const to = Math.max(
    asOf,
    ...lanes.flatMap((lane) => [lane.end, lane.due].flatMap((d) => (d ? [Date.parse(d)] : []))),
  );
  // A little room past the last date, so today's line and an open end show.
  const span = Math.max(to - from, 7 * day) * 1.04;
  const at = (date: number) => `${((date - from) / span) * 100}%`;
  return (
    <div class="chart-timeline" data-compact={compact || undefined}>
      {!compact && (
        <div class="timeline-row timeline-axis" aria-hidden="true">
          <span />
          <span class="timeline-track">
            {dateTicks(from, from + span, 5).map((tick) => (
              <span key={tick} class="timeline-tick" style={{ left: at(tick) }}>
                {dateLabel(tick)}
              </span>
            ))}
          </span>
        </div>
      )}
      {lanes.map((lane, i) => {
        const start = Date.parse(lane.start);
        const end = lane.end ? Date.parse(lane.end) : asOf;
        const due = lane.due ? Date.parse(lane.due) : null;
        const state = lane.end ? "ended" : "open";
        return (
          <div key={i} class="timeline-row" aria-hidden="true">
            <span class="timeline-label">
              <span class="timeline-name">{named(chart, lane.label)}</span>
              {lane.count !== null && (
                <span class="timeline-count">
                  {lane.ended}/{lane.count}
                </span>
              )}
            </span>
            <span class="timeline-track">
              <span class="timeline-today" style={{ left: at(asOf) }} />
              <span
                class="timeline-bar"
                data-state={state}
                data-earlier={lane.earlier || undefined}
                style={{ left: at(start), width: `calc(${at(end)} - ${at(start)})` }}
                title={laneText(laneValues(lane))}
              />
              {due !== null && lane.late !== null && (
                <span
                  class="timeline-late"
                  style={{ left: at(due), width: `calc(${at(end)} - ${at(due)})` }}
                />
              )}
              {due !== null && <span class="timeline-due" style={{ left: at(due) }} />}
            </span>
          </div>
        );
      })}
      <Values table={timelineValues(chart, lanes)} />
    </div>
  );
}

export function SpreadChart({ chart, compact }: { chart: Of<"spread">; compact?: boolean }) {
  const { spread } = chart;
  const width = widthOf(compact);
  const height = compact ? 110 : 200;
  const pad = { left: compact ? 8 : 32, right: 12, top: 22, bottom: compact ? 18 : 26 };
  const from = spread.bins[0]?.from ?? 0;
  const to = spread.bins.at(-1)?.to ?? 1;
  const x = (value: number) =>
    pad.left + ((value - from) / Math.max(to - from, 1e-9)) * (width - pad.left - pad.right);
  const yTicks = ticks(Math.max(...spread.bins.map((bin) => bin.count), 1), compact ? 2 : 4);
  const yMax = yTicks.at(-1) ?? 1;
  const y = (count: number) => pad.top + (1 - count / yMax) * (height - pad.top - pad.bottom);
  const bound = atLeast(spread.atLeast);
  const marks = [
    { value: spread.median, label: `median ${bound}${number(spread.median)}` },
    { value: spread.p90, label: `p90 ${bound}${number(spread.p90)}` },
  ];
  const values = spreadValues(chart);
  return (
    <>
      <svg class="chart" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {!compact &&
          yTicks.map((tick) => (
            <g key={tick} class="chart-grid">
              <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
              <text x={pad.left - 6} y={y(tick)} dy="0.32em" text-anchor="end">
                {number(tick)}
              </text>
            </g>
          ))}
        <line class="chart-axis" x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} />
        {spread.bins.map((bin, i) => {
          const left = x(bin.from) + 1;
          const w = Math.max(x(bin.to) - x(bin.from) - 2, 1);
          const known = bin.count - bin.atLeast;
          return (
            <g key={bin.from}>
              <path class="chart-column" d={column(left, y(bin.count), w, y(0))}>
                <title>{values.rows[i]?.join(": ")}</title>
              </path>
              {bin.atLeast > 0 && (
                <path class="chart-bound" d={column(left, y(bin.count), w, y(known))} />
              )}
            </g>
          );
        })}
        {(compact
          ? spread.bins.filter((_, i) => i === 0 || i === spread.bins.length - 1)
          : spread.bins
        ).map((bin) => (
          <text
            key={bin.from}
            class="chart-tick"
            x={x(bin.from)}
            y={height - 4}
            text-anchor="middle"
          >
            {number(bin.from)}
          </text>
        ))}
        {!compact && (
          <text class="chart-tick" x={x(to)} y={height - 4} text-anchor="middle">
            {number(to)}
          </text>
        )}
        {marks.map((mark, i) => {
          // The median's label to its left and the 90th percentile's to its
          // right, unless that runs off the drawing.
          const at = x(mark.value);
          const room = mark.label.length * 7;
          const left = i === 0 ? at - room > 0 : at + room > width;
          return (
            <g key={mark.label} class="chart-mark">
              <line x1={at} x2={at} y1={pad.top - 4} y2={y(0)} />
              <text x={at + (left ? -4 : 4)} y={pad.top - 8} text-anchor={left ? "end" : "start"}>
                {mark.label}
              </text>
            </g>
          );
        })}
      </svg>
      <Values table={values} />
    </>
  );
}

// A pivot: the person picks what goes down, across and what's shown, and
// the window picks the grid Oriel already computed for it. Down only, it
// reads as ranked bars; with columns, as a table shaded by value.
export function PivotChart({ chart, compact }: { chart: Of<"pivot">; compact?: boolean }) {
  const [down, setDown] = useState(chart.initial.down);
  const [across, setAcross] = useState<string | null>(chart.initial.across);
  const [measure, setMeasure] = useState(chart.initial.measure);
  // Each pick tells telemetry it was regrouped; a page with no panel, as a
  // review link's, has nowhere to tell.
  const links = useContext(ItemLinksContext);
  const regrouped = () => links?.dispatch({ type: "pivotRegrouped" });
  const table =
    chart.tables[`${down}|${across ?? ""}`] ??
    chart.tables[`${chart.initial.down}|${chart.initial.across ?? ""}`];
  if (!table) return null;
  const label = (field: string | null) => chart.dims.find((d) => d.field === field)?.label ?? "";
  const value = (cell: number[] | undefined) => cell?.[measure] ?? 0;
  const rowTotals = table.cells.map((row) => row.reduce((sum, cell) => sum + value(cell), 0));
  const rows = compact ? table.rows.slice(0, 3) : table.rows;
  const top = Math.max(...table.cells.flat().map(value), 0);
  const measures = ["Count", ...chart.measures.map((m) => `Sum of ${m.label}`)];
  const select = (
    name: string,
    current: string,
    options: [string, string][],
    pick: (value: string) => void,
  ) => (
    <label class="pivot-pick">
      <span>{name}</span>
      <select
        value={current}
        onChange={(event) => {
          pick(event.currentTarget.value);
          regrouped();
        }}
      >
        {options.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div class="chart-pivot">
      {!compact && (
        <div class="pivot-picks">
          {select(
            "Rows",
            down,
            chart.dims.map((d) => [d.field, d.label]),
            (picked) => {
              setDown(picked);
              if (picked === across) setAcross(null);
            },
          )}
          {select(
            "Columns",
            across ?? "",
            [
              ["", "None"],
              ...chart.dims
                .filter((d) => d.field !== down)
                .map((d): [string, string] => [d.field, d.label]),
            ],
            (picked) => setAcross(picked === "" ? null : picked),
          )}
          {select(
            "Show",
            String(measure),
            measures.map((m, i): [string, string] => [String(i), m]),
            (picked) => setMeasure(Number(picked)),
          )}
        </div>
      )}
      <p class="pivot-shows">
        {measures[measure]} by {label(down)}
        {across === null ? "" : ` and ${label(across)}`}
      </p>
      {across === null ? (
        <ol class="block-bars">
          {rows.map((name, i) => {
            const total = rowTotals[i] ?? 0;
            return (
              <li key={name}>
                <span class="block-bar-label">
                  {named(chart, name)}
                  {name === "Other" && table.otherRows ? ` (${table.otherRows})` : ""}
                </span>
                <span class="block-bar-track" aria-hidden="true">
                  <span
                    class="block-bar"
                    style={{ width: `${top > 0 ? (Math.max(total, 0) / top) * 100 : 0}%` }}
                  />
                </span>
                <span class="block-bar-value">{number(total)}</span>
              </li>
            );
          })}
        </ol>
      ) : (
        <div class="pivot-scroll">
          <table class="block-table pivot-table">
            <thead>
              <tr>
                <th scope="col">
                  {label(down)} \ {label(across)}
                </th>
                {table.columns.map((column) => (
                  <th key={column} scope="col" class="num">
                    {named(chart, column)}
                    {column === "Other" && table.otherColumns ? ` (${table.otherColumns})` : ""}
                  </th>
                ))}
                <th scope="col" class="num">
                  All
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((name, i) => (
                <tr key={name}>
                  <th scope="row">
                    {named(chart, name)}
                    {name === "Other" && table.otherRows ? ` (${table.otherRows})` : ""}
                  </th>
                  {table.columns.map((column, j) => {
                    const cell = value(table.cells[i]?.[j]);
                    return (
                      <td
                        key={column}
                        class="num"
                        style={
                          cell > 0 && top > 0
                            ? {
                                background: `color-mix(in srgb, var(--accent) ${Math.round(4 + (cell / top) * 22)}%, transparent)`,
                              }
                            : undefined
                        }
                      >
                        {cell === 0 ? "" : number(cell)}
                      </td>
                    );
                  })}
                  <td class="num pivot-total">{number(rowTotals[i] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
