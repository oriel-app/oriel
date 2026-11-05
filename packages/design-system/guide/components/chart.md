---
title: Chart
status: drifting
group: Thread
order: 66
classes: chart, chart-grid, chart-axis, chart-tick, chart-line, chart-dot, chart-hit, chart-column, chart-bound, chart-total, chart-fit, chart-forecast, chart-range, chart-end, chart-today, chart-mark, chart-timeline, timeline-row, timeline-label, timeline-name, timeline-count, timeline-track, timeline-axis, timeline-tick, timeline-bar, timeline-late, timeline-due, timeline-today, pivot-picks, pivot-shows, pivot-pick, pivot-scroll, pivot-table, pivot-total
summary: A block's four chart forms from history() (decision 0053), a series with Oriel's fitted line and forecast, a timeline, a spread and a pivot the person regroups, every figure Oriel's.
---

# Chart

## What it is

A chart is a [block](/components/block) in one of four more forms (decision 0053): a **series** over time, a **timeline**, a **spread** and a **pivot**. As with every block, the agent names a read, a form and fields, and Oriel computes every figure, line and date and draws them in the theme's tokens. The read is usually `history()`: items from the index with what the change log saw of each, IDs and facets only, never a title. Oriel draws an item's or an epic's ID with the name the index has for it now.

- **Series:** rows counted (or a field summed) by week or day. Optionally running, each week adding to the last, and optionally with Oriel's least-squares line. A running series with a line forecasts when the rest arrive, with an 80% range, or says why it won't.
- **Timeline:** a bar per row, or per group (`by`), from a start date to an end date. Open bars run to today, today is a line, and lateness past a due date is marked when the read has one.
- **Spread:** a histogram of one number in at most 12 bins, with the median and the 90th percentile marked.
- **Pivot:** a grid of the read's rows by one field, or two, counted or summed. The person regroups it in the window with no model call: Oriel computed every grouping when it built the block.

"Thin marks in the theme's tokens, one series colour, hairline axes; a dashed line is a projection (the fitted line and the forecast), never a grid. Each mark carries its value in a tooltip, and the caption under the block says how it was computed." (`packages/web/src/charts.tsx`)

A chart never reads the machine's clock: today is the read's `asOf`, and before `since`, the change log's start, Oriel knows that something happened, not when. A date at `since` means "by then", and a figure that is only a lower bound says so: "≥" on a mark, "at least" in the caption.

## When to use it

- **A series** when the question is about time: "Are we going to finish checkout this month?" (running, with a line), "How many stories did we finish each week?" (columns).
- **A timeline** when it's about when each thing started and ended: "When will each epic land?" (`by: "epic"`), "Show checkout on a timeline" (a bar per item).
- **A spread** when it's about how a number is spread out, and its outliers: "How long has work been sitting in progress?"
- **A pivot** when the person asks to break something down by two things: "Who's overloaded?", story points by epic and status. They can regroup it themselves.
- Only from a read that declares its dates (`time`), for a series or a timeline. Oriel refuses one that doesn't, and the agent says why.

## When not to

- Not for one number per label, ranked: that's [bars](/components/block#bars), as for "who's busiest" from `window.overview()`. A pivot down one field draws as bars too, but offers regrouping.
- Not for a forecast the agent worked out. The agent never forecasts or tabulates figures itself (one system-prompt line); the caption is Oriel's, and the reply quotes it.
- Not for anything the person must decide. A chart, like any block, has no buttons; the pivot's pickers only regroup what's there.
- Not for under 4 whole weeks or 5 events, if the point is the line: Oriel draws no line then, and its caption says "no line: …".

## Anatomy and variants

A chart is the body of an `answer-block` figure, with `data-form` its form, and the block's caption under it. The series and the spread are an `<svg class="chart" role="img">`, drawn in its own units about the width of the page (640 wide, 420 for a pin), so its text is the page's size; the timeline and the pivot are HTML.

### Series, running, with a line and a forecast

The running total (`.chart-line`, `--border-thick` in `--accent`) ends in a dot (`.chart-dot`) and its value (`.chart-end`). The rest to arrive is a faint line (`.chart-total`, "40 in all"). Oriel's least-squares line (`.chart-fit`) and the forecast (`.chart-forecast`) are dashed in `--text-muted`: the only dashes in a chart. The forecast's 80% range is an `--accent-soft` pill (`.chart-range`), its date over a dot. Today is a faint upright line (`.chart-today`), labelled "today". Hairline grid lines (`.chart-grid`) carry the counts; dates sit under the axis (`.chart-axis`, `.chart-tick`). Each week has an invisible hit circle (`.chart-hit`) whose tooltip is its value.

```html specimen id=series title="A series: the Accessibility audit's stories done, running, with Oriel's line and forecast"
<figure class="answer-block" data-form="series">
  <svg class="chart" viewBox="0 0 640 220" role="img" aria-label="Done">
    <g class="chart-grid">
      <line x1="36" x2="584" y1="194" y2="194" />
      <text x="30" y="194" dy="0.32em" text-anchor="end">0</text>
    </g>
    <g class="chart-grid">
      <line x1="36" x2="584" y1="149" y2="149" />
      <text x="30" y="149" dy="0.32em" text-anchor="end">10</text>
    </g>
    <g class="chart-grid">
      <line x1="36" x2="584" y1="104" y2="104" />
      <text x="30" y="104" dy="0.32em" text-anchor="end">20</text>
    </g>
    <g class="chart-grid">
      <line x1="36" x2="584" y1="59" y2="59" />
      <text x="30" y="59" dy="0.32em" text-anchor="end">30</text>
    </g>
    <g class="chart-grid">
      <line x1="36" x2="584" y1="14" y2="14" />
      <text x="30" y="14" dy="0.32em" text-anchor="end">40</text>
    </g>
    <line class="chart-axis" x1="36" x2="584" y1="194" y2="194" />
    <text class="chart-tick" x="36" y="216" text-anchor="middle">Sep 7</text>
    <text class="chart-tick" x="136.8" y="216" text-anchor="middle">Sep 28</text>
    <text class="chart-tick" x="237.6" y="216" text-anchor="middle">Oct 19</text>
    <text class="chart-tick" x="338.4" y="216" text-anchor="middle">Nov 9</text>
    <text class="chart-tick" x="439.2" y="216" text-anchor="middle">Nov 30</text>
    <text class="chart-tick" x="540" y="216" text-anchor="middle">Dec 21</text>
    <g class="chart-total">
      <line x1="36" x2="584" y1="14" y2="14" />
      <text x="588" y="14" dy="0.32em">40 in all</text>
    </g>
    <polyline
      class="chart-line"
      points="36,189.5 69.6,176 103.2,167 136.8,149 170.4,135.5 204,126.5 237.6,113 271.2,104 304.8,99.5"
    />
    <circle class="chart-hit" cx="36" cy="189.5" r="8"><title>Week of Sep 7: 1</title></circle>
    <circle class="chart-hit" cx="69.6" cy="176" r="8"><title>Week of Sep 14: 4</title></circle>
    <circle class="chart-hit" cx="103.2" cy="167" r="8"><title>Week of Sep 21: 6</title></circle>
    <circle class="chart-hit" cx="136.8" cy="149" r="8"><title>Week of Sep 28: 10</title></circle>
    <circle class="chart-hit" cx="170.4" cy="135.5" r="8"><title>Week of Oct 5: 13</title></circle>
    <circle class="chart-hit" cx="204" cy="126.5" r="8"><title>Week of Oct 12: 15</title></circle>
    <circle class="chart-hit" cx="237.6" cy="113" r="8"><title>Week of Oct 19: 18</title></circle>
    <circle class="chart-hit" cx="271.2" cy="104" r="8"><title>Week of Oct 26: 20</title></circle>
    <circle class="chart-hit" cx="304.8" cy="99.5" r="8"><title>Week of Nov 2: 21</title></circle>
    <circle class="chart-dot" cx="304.8" cy="99.5" r="4" />
    <line class="chart-fit" x1="36" y1="188.2" x2="304.8" y2="89.2">
      <title>Least-squares line, R² 0.99</title>
    </line>
    <g class="chart-forecast">
      <rect class="chart-range" x="521.1" width="62.9" y="9" height="10" rx="3">
        <title>80% range: Dec 17 to Dec 30</title>
      </rect>
      <line x1="316.2" y1="99.5" x2="548.3" y2="14" />
      <circle class="chart-dot" cx="548.3" cy="14" r="4" />
      <text x="548.3" y="4" text-anchor="middle">Dec 22</text>
    </g>
    <g class="chart-today">
      <line x1="316.2" x2="316.2" y1="8" y2="194" />
      <text x="316.2" y="6" text-anchor="middle">today</text>
    </g>
    <text class="chart-end" x="312.8" y="99.5" dy="0.32em">21</text>
  </svg>
  <figcaption>
    Computed by Oriel from the index and its change log: Done, counted by week, running, since Sep
    7. Least-squares line over 7 whole weeks, R² 0.99, 2.8 a week. At that rate the 19 left get
    there around Dec 22 (Dec 17 – Dec 30, 80%), if no more are added
  </figcaption>
</figure>
```

### Series, by week

Without `running`, each week is a column (`.chart-column`): square at the baseline, its data end rounded, at most 24 units wide.

```html specimen id=columns title="A series: stories done each week"
<figure class="answer-block" data-form="series">
  <svg class="chart" viewBox="0 0 640 220" role="img" aria-label="Done">
    <g class="chart-grid">
      <line x1="36" x2="584" y1="194" y2="194" />
      <text x="30" y="194" dy="0.32em" text-anchor="end">0</text>
    </g>
    <g class="chart-grid">
      <line x1="36" x2="584" y1="134" y2="134" />
      <text x="30" y="134" dy="0.32em" text-anchor="end">2</text>
    </g>
    <g class="chart-grid">
      <line x1="36" x2="584" y1="74" y2="74" />
      <text x="30" y="74" dy="0.32em" text-anchor="end">4</text>
    </g>
    <g class="chart-grid">
      <line x1="36" x2="584" y1="14" y2="14" />
      <text x="30" y="14" dy="0.32em" text-anchor="end">6</text>
    </g>
    <line class="chart-axis" x1="36" x2="584" y1="194" y2="194" />
    <text class="chart-tick" x="36" y="216" text-anchor="middle">Sep 7</text>
    <text class="chart-tick" x="167.4" y="216" text-anchor="middle">Sep 21</text>
    <text class="chart-tick" x="298.9" y="216" text-anchor="middle">Oct 5</text>
    <text class="chart-tick" x="430.3" y="216" text-anchor="middle">Oct 19</text>
    <text class="chart-tick" x="561.7" y="216" text-anchor="middle">Nov 2</text>
    <path class="chart-column" d="M56.9,194V168Q56.9,164 60.9,164H76.9Q80.9,164 80.9,168V194Z">
      <title>Week of Sep 7: 1</title>
    </path>
    <path class="chart-column" d="M122.6,194V18Q122.6,14 126.6,14H142.6Q146.6,14 146.6,18V194Z">
      <title>Week of Sep 14: 6</title>
    </path>
    <path class="chart-column" d="M188.3,194V48Q188.3,44 192.3,44H208.3Q212.3,44 212.3,48V194Z">
      <title>Week of Sep 21: 5</title>
    </path>
    <path class="chart-column" d="M254,194V48Q254,44 258,44H274Q278,44 278,48V194Z">
      <title>Week of Sep 28: 5</title>
    </path>
    <path class="chart-column" d="M319.7,194V48Q319.7,44 323.7,44H339.7Q343.7,44 343.7,48V194Z">
      <title>Week of Oct 5: 5</title>
    </path>
    <path
      class="chart-column"
      d="M385.4,194V108Q385.4,104 389.4,104H405.4Q409.4,104 409.4,108V194Z"
    >
      <title>Week of Oct 12: 3</title>
    </path>
    <path class="chart-column" d="M451.1,194V48Q451.1,44 455.1,44H471.1Q475.1,44 475.1,48V194Z">
      <title>Week of Oct 19: 5</title>
    </path>
    <path class="chart-column" d="M516.8,194V18Q516.8,14 520.8,14H536.8Q540.8,14 540.8,18V194Z">
      <title>Week of Oct 26: 6</title>
    </path>
    <path
      class="chart-column"
      d="M582.6,194V168Q582.6,164 586.6,164H602.6Q606.6,164 606.6,168V194Z"
    >
      <title>Week of Nov 2: 1</title>
    </path>
    <g class="chart-today">
      <line x1="584" x2="584" y1="8" y2="194" />
      <text x="584" y="6" text-anchor="middle">today</text>
    </g>
    <text class="chart-end" x="569.7" y="164" dy="0.32em"></text>
  </svg>
  <figcaption>
    Computed by Oriel from the index and its change log, where Type is story: Done, counted by week,
    since Sep 7
  </figcaption>
</figure>
```

### Timeline

A grid of rows (`.timeline-row`): the label (`.timeline-label`, its name cut with "…", and for a group how many of its rows ended, `.timeline-count`), then the track (`.timeline-track`). A bar (`.timeline-bar`) is solid `--accent` once it ended (`data-state="ended"`); still going, it runs to today in `--accent-soft` with an accent border and a dashed open end (`data-state="open"`). A bar that started by the change log's first day has no start of its own: its left edge is dashed and square (`data-earlier`). Today is a faint line through every track (`.timeline-today`); dates run along the top (`.timeline-axis`, `.timeline-tick`). A due date is a short upright in `--text` (`.timeline-due`), and the time past it a `--danger` stretch (`.timeline-late`).

```html specimen id=timeline title="A timeline by epic: each epic's stories, how many ended"
<figure class="answer-block" data-form="timeline">
  <div class="chart-timeline">
    <div class="timeline-row timeline-axis" aria-hidden="true">
      <span></span
      ><span class="timeline-track"
        ><span class="timeline-tick" style="left: 0%">Sep 7</span
        ><span class="timeline-tick" style="left: 23.2%">Sep 21</span
        ><span class="timeline-tick" style="left: 46.4%">Oct 5</span
        ><span class="timeline-tick" style="left: 69.6%">Oct 19</span
        ><span class="timeline-tick" style="left: 92.8%">Nov 2</span></span
      >
    </div>
    <div class="timeline-row">
      <span class="timeline-label"
        ><span class="timeline-name">Boarding passes and gate scanning</span
        ><span class="timeline-count">3/11</span></span
      ><span class="timeline-track"
        ><span class="timeline-today" style="left: 96.2%"></span
        ><span
          class="timeline-bar"
          data-state="open"
          data-earlier
          style="left: 0%; width: calc(96.2% - 0%)"
          title="started by Sep 7, still going, 3 of 11 ended"
        ></span
      ></span>
    </div>
    <div class="timeline-row">
      <span class="timeline-label"
        ><span class="timeline-name">Weather disruptions and rebooking</span
        ><span class="timeline-count">4/9</span></span
      ><span class="timeline-track"
        ><span class="timeline-today" style="left: 96.2%"></span
        ><span
          class="timeline-bar"
          data-state="open"
          data-earlier
          style="left: 0%; width: calc(96.2% - 0%)"
          title="started by Sep 7, still going, 4 of 9 ended"
        ></span
      ></span>
    </div>
    <div class="timeline-row">
      <span class="timeline-label"
        ><span class="timeline-name">Accessibility audit remediation (WCAG 2.2 AA)</span
        ><span class="timeline-count">21/40</span></span
      ><span class="timeline-track"
        ><span class="timeline-today" style="left: 96.2%"></span
        ><span
          class="timeline-bar"
          data-state="open"
          style="left: 1.7%; width: calc(96.2% - 1.7%)"
          title="started Sep 8, still going, 21 of 40 ended"
        ></span
      ></span>
    </div>
    <div class="timeline-row">
      <span class="timeline-label"
        ><span class="timeline-name">Offline boarding on the pier</span
        ><span class="timeline-count">1/6</span></span
      ><span class="timeline-track"
        ><span class="timeline-today" style="left: 96.2%"></span
        ><span
          class="timeline-bar"
          data-state="open"
          style="left: 3.3%; width: calc(96.2% - 3.3%)"
          title="started Sep 9, still going, 1 of 6 ended"
        ></span
      ></span>
    </div>
    <div class="timeline-row">
      <span class="timeline-label"
        ><span class="timeline-name">Checkout v2: phone wallets and saved cards</span
        ><span class="timeline-count">3/10</span></span
      ><span class="timeline-track"
        ><span class="timeline-today" style="left: 96.2%"></span
        ><span
          class="timeline-bar"
          data-state="open"
          style="left: 5%; width: calc(96.2% - 5%)"
          title="started Sep 10, still going, 3 of 10 ended"
        ></span
      ></span>
    </div>
    <div class="timeline-row">
      <span class="timeline-label"
        ><span class="timeline-name">Vehicle and freight reservations</span
        ><span class="timeline-count">2/8</span></span
      ><span class="timeline-track"
        ><span class="timeline-today" style="left: 96.2%"></span
        ><span
          class="timeline-bar"
          data-state="open"
          style="left: 5%; width: calc(96.2% - 5%)"
          title="started Sep 10, still going, 2 of 8 ended"
        ></span
      ></span>
    </div>
    <div class="timeline-row">
      <span class="timeline-label"
        ><span class="timeline-name">No Epic</span><span class="timeline-count">1/2</span></span
      ><span class="timeline-track"
        ><span class="timeline-today" style="left: 96.2%"></span
        ><span
          class="timeline-bar"
          data-state="open"
          style="left: 21.6%; width: calc(96.2% - 21.6%)"
          title="started Sep 20, still going, 1 of 2 ended"
        ></span
      ></span>
    </div>
    <div class="timeline-row">
      <span class="timeline-label"
        ><span class="timeline-name">Localisation for summer visitors</span
        ><span class="timeline-count">2/8</span></span
      ><span class="timeline-track"
        ><span class="timeline-today" style="left: 96.2%"></span
        ><span
          class="timeline-bar"
          data-state="open"
          style="left: 41.4%; width: calc(96.2% - 41.4%)"
          title="started Oct 2, still going, 2 of 8 ended"
        ></span
      ></span>
    </div>
  </div>
  <figcaption>
    Computed by Oriel from the index and its change log, where Type is story: Started to Done, by
    Epic, since Sep 7; today is the line. A bar from the left edge started by Sep 7, when the change
    log starts
  </figcaption>
</figure>
```

```html specimen id=timeline-items title="A timeline of one epic's stories: ended, still going, and started before the change log"
<figure class="answer-block" data-form="timeline">
  <div class="chart-timeline">
    <div class="timeline-row timeline-axis" aria-hidden="true">
      <span></span
      ><span class="timeline-track"
        ><span class="timeline-tick" style="left: 0%">Sep 7</span
        ><span class="timeline-tick" style="left: 23.2%">Sep 21</span
        ><span class="timeline-tick" style="left: 46.4%">Oct 5</span
        ><span class="timeline-tick" style="left: 69.6%">Oct 19</span
        ><span class="timeline-tick" style="left: 92.8%">Nov 2</span></span
      >
    </div>
    <div class="timeline-row">
      <span class="timeline-label"
        ><span class="timeline-name">Receipt email: include the vehicle registration</span></span
      ><span class="timeline-track"
        ><span class="timeline-today" style="left: 96.2%"></span
        ><span
          class="timeline-bar"
          data-state="ended"
          data-earlier
          style="left: 0%; width: calc(6.6% - 0%)"
          title="started by Sep 7, ended Sep 11"
        ></span
      ></span>
    </div>
    <div class="timeline-row">
      <span class="timeline-label"
        ><span class="timeline-name">Show the fare breakdown before payment</span></span
      ><span class="timeline-track"
        ><span class="timeline-today" style="left: 96.2%"></span
        ><span
          class="timeline-bar"
          data-state="open"
          data-earlier
          style="left: 0%; width: calc(96.2% - 0%)"
          title="started by Sep 7, still going"
        ></span
      ></span>
    </div>
    <div class="timeline-row">
      <span class="timeline-label"
        ><span class="timeline-name">Update the payment declined error message</span></span
      ><span class="timeline-track"
        ><span class="timeline-today" style="left: 96.2%"></span
        ><span
          class="timeline-bar"
          data-state="open"
          style="left: 9.9%; width: calc(96.2% - 9.9%)"
          title="started Sep 13, still going"
        ></span
      ></span>
    </div>
    <div class="timeline-row">
      <span class="timeline-label"><span class="timeline-name">Pay with a phone wallet</span></span
      ><span class="timeline-track"
        ><span class="timeline-today" style="left: 96.2%"></span
        ><span
          class="timeline-bar"
          data-state="ended"
          style="left: 41.4%; width: calc(58% - 41.4%)"
          title="started Oct 2, ended Oct 12"
        ></span
      ></span>
    </div>
    <div class="timeline-row">
      <span class="timeline-label"
        ><span class="timeline-name">Pay with a phone wallet on the website</span></span
      ><span class="timeline-track"
        ><span class="timeline-today" style="left: 96.2%"></span
        ><span
          class="timeline-bar"
          data-state="open"
          style="left: 46.4%; width: calc(96.2% - 46.4%)"
          title="started Oct 5, still going"
        ></span
      ></span>
    </div>
    <div class="timeline-row">
      <span class="timeline-label"
        ><span class="timeline-name"
          >Handle 3-D Secure challenges in the native checkout</span
        ></span
      ><span class="timeline-track"
        ><span class="timeline-today" style="left: 96.2%"></span
        ><span
          class="timeline-bar"
          data-state="open"
          style="left: 61.3%; width: calc(96.2% - 61.3%)"
          title="started Oct 14, still going"
        ></span
      ></span>
    </div>
    <div class="timeline-row">
      <span class="timeline-label"
        ><span class="timeline-name">Retry a payment without losing the selected seats</span></span
      ><span class="timeline-track"
        ><span class="timeline-today" style="left: 96.2%"></span
        ><span
          class="timeline-bar"
          data-state="ended"
          style="left: 66.3%; width: calc(76.3% - 66.3%)"
          title="started Oct 17, ended Oct 23"
        ></span
      ></span>
    </div>
  </div>
  <figcaption>
    Computed by Oriel from the index and its change log, where Type is story: Started to Done, since
    Sep 7; today is the line. A bar from the left edge started by Sep 7, when the change log starts.
    3 rows with no Started aren't shown
  </figcaption>
</figure>
```

```html specimen id=timeline-late title="A due date, and the days past it" nocopy
<figure class="answer-block" data-form="timeline">
  <div class="chart-timeline">
    <div class="timeline-row">
      <span class="timeline-label"
        ><span class="timeline-name">Pay with a phone wallet on the website</span></span
      >
      <span class="timeline-track"
        ><span class="timeline-today" style="left: 96.2%"></span
        ><span
          class="timeline-bar"
          data-state="open"
          style="left: 46.4%; width: calc(96.2% - 46.4%)"
          title="started Oct 5, still going, due Oct 26, 9 days late"
        ></span
        ><span class="timeline-late" style="left: 78.9%; width: calc(96.2% - 78.9%)"></span
        ><span class="timeline-due" style="left: 78.9%"></span
      ></span>
    </div>
    <div class="timeline-row">
      <span class="timeline-label"
        ><span class="timeline-name">Save a card for next time</span></span
      >
      <span class="timeline-track"
        ><span class="timeline-today" style="left: 96.2%"></span
        ><span
          class="timeline-bar"
          data-state="ended"
          style="left: 30%; width: calc(70% - 30%)"
          title="started Sep 26, ended Oct 23, due Nov 2"
        ></span
        ><span class="timeline-due" style="left: 92.8%"></span
      ></span>
    </div>
  </div>
  <figcaption>
    Computed by Oriel from a read with due dates: Started to Done, due by Due, since Sep 7; today is
    the line
  </figcaption>
</figure>
```

`history()` has no due dates today (decision 0053: Jira's due dates aren't in the index), so this one is drawn by hand, from `TimelineChart`'s markup; the others are rendered from the component.

### Spread

Columns over bins of a readable width, touching but for a hairline. A bin holding some lower bounds (days in a state that began before the change log) draws that share lighter (`.chart-bound`, the accent mixed 40% toward `--surface-sunk`). The median and 90th percentile are faint uprights (`.chart-mark`) with their figures, "≥" when they're only lower bounds; the median's label sits to its left and the 90th's to its right, unless that runs off the drawing.

```html specimen id=spread title="A spread: days in progress, with two lower bounds"
<figure class="answer-block" data-form="spread">
  <svg class="chart" viewBox="0 0 640 200" role="img" aria-label="Days in its state">
    <g class="chart-grid">
      <line x1="32" x2="628" y1="174" y2="174" />
      <text x="26" y="174" dy="0.32em" text-anchor="end">0</text>
    </g>
    <g class="chart-grid">
      <line x1="32" x2="628" y1="123.3" y2="123.3" />
      <text x="26" y="123.3" dy="0.32em" text-anchor="end">2</text>
    </g>
    <g class="chart-grid">
      <line x1="32" x2="628" y1="72.7" y2="72.7" />
      <text x="26" y="72.7" dy="0.32em" text-anchor="end">4</text>
    </g>
    <g class="chart-grid">
      <line x1="32" x2="628" y1="22" y2="22" />
      <text x="26" y="22" dy="0.32em" text-anchor="end">6</text>
    </g>
    <line class="chart-axis" x1="32" x2="628" y1="174" y2="174" />
    <g>
      <path
        class="chart-column"
        d="M33,174V152.7Q33,148.7 37,148.7H93.2Q97.2,148.7 97.2,152.7V174Z"
      >
        <title>15–20: 1</title>
      </path>
    </g>
    <g>
      <path
        class="chart-column"
        d="M99.2,174V127.3Q99.2,123.3 103.2,123.3H159.4Q163.4,123.3 163.4,127.3V174Z"
      >
        <title>20–25: 2</title>
      </path>
    </g>
    <g>
      <path
        class="chart-column"
        d="M165.4,174V127.3Q165.4,123.3 169.4,123.3H225.7Q229.7,123.3 229.7,127.3V174Z"
      >
        <title>25–30: 2</title>
      </path>
    </g>
    <g>
      <path
        class="chart-column"
        d="M231.7,174V127.3Q231.7,123.3 235.7,123.3H291.9Q295.9,123.3 295.9,127.3V174Z"
      >
        <title>30–35: 2</title>
      </path>
    </g>
    <g>
      <path class="chart-column" d="M297.9,174V102Q297.9,98 301.9,98H358.1Q362.1,98 362.1,102V174Z">
        <title>35–40: 3</title>
      </path>
    </g>
    <g>
      <path
        class="chart-column"
        d="M364.1,174V152.7Q364.1,148.7 368.1,148.7H424.3Q428.3,148.7 428.3,152.7V174Z"
      >
        <title>40–45: 1</title>
      </path>
    </g>
    <g>
      <path class="chart-column" d="M430.3,174V102Q430.3,98 434.3,98H490.6Q494.6,98 494.6,102V174Z">
        <title>45–50: 3</title>
      </path>
    </g>
    <g>
      <path class="chart-column" d="M496.6,174V102Q496.6,98 500.6,98H556.8Q560.8,98 560.8,102V174Z">
        <title>50–55: 3</title>
      </path>
    </g>
    <g>
      <path class="chart-column" d="M562.8,174V26Q562.8,22 566.8,22H623Q627,22 627,26V174Z">
        <title>55–60: 6, 2 of them at least this</title>
      </path>
      <path class="chart-bound" d="M562.8,72.7V26Q562.8,22 566.8,22H623Q627,22 627,26V72.7Z" />
    </g>
    <text class="chart-tick" x="32" y="196" text-anchor="middle">15</text>
    <text class="chart-tick" x="98.2" y="196" text-anchor="middle">20</text>
    <text class="chart-tick" x="164.4" y="196" text-anchor="middle">25</text>
    <text class="chart-tick" x="230.7" y="196" text-anchor="middle">30</text>
    <text class="chart-tick" x="296.9" y="196" text-anchor="middle">35</text>
    <text class="chart-tick" x="363.1" y="196" text-anchor="middle">40</text>
    <text class="chart-tick" x="429.3" y="196" text-anchor="middle">45</text>
    <text class="chart-tick" x="495.6" y="196" text-anchor="middle">50</text>
    <text class="chart-tick" x="561.8" y="196" text-anchor="middle">55</text>
    <text class="chart-tick" x="628" y="196" text-anchor="middle">60</text>
    <g class="chart-mark">
      <line x1="429.3" x2="429.3" y1="18" y2="174" />
      <text x="425.3" y="14" text-anchor="end">median ≥ 45</text>
    </g>
    <g class="chart-mark">
      <line x1="572.4" x2="572.4" y1="18" y2="174" />
      <text x="568.4" y="14" text-anchor="end">p90 ≥ 55.8</text>
    </g>
  </svg>
  <figcaption>
    Computed by Oriel from the index and its change log, where State is In progress: Days in its
    state of 23 rows: median at least 45, 90th percentile at least 55.8. 2 began before the change
    log starts, so each is at least what's shown, and so are the median and the 90th percentile
  </figcaption>
</figure>
```

### Pivot

Three pickers (`.pivot-picks`, each a `.pivot-pick`, a native `<select>` in a label): **Rows**, **Columns** (or None) and **Show** (Count, or Sum of a field that adds up). Then what it shows, in words (`.pivot-shows`). Down one field, it's [bars](/components/block#bars). Down and across, it's a [block table](/components/block#a-table) (`.pivot-table`), in a scroller (`.pivot-scroll`) so a grid wider than a phone scrolls; each cell is shaded by its value, the accent mixed from 4% to 26%, an empty cell is blank, and the row's total (`.pivot-total`, muted) closes it under **All**. A row or column of what didn't fit is "Other (n)".

```html specimen id=pivot title="A pivot: stories by assignee and state"
<figure class="answer-block" data-form="pivot">
  <div>
    <div class="pivot-picks">
      <label class="pivot-pick"
        ><span>Rows</span
        ><select>
          <option selected value="assignee">Assignee</option>
          <option value="state">State</option>
          <option value="epic">Epic</option>
          <option value="startedAt">Started</option>
          <option value="doneAt">Done</option>
        </select></label
      ><label class="pivot-pick"
        ><span>Columns</span
        ><select>
          <option value="">None</option>
          <option selected value="state">State</option>
          <option value="epic">Epic</option>
          <option value="startedAt">Started</option>
          <option value="doneAt">Done</option>
        </select></label
      ><label class="pivot-pick"
        ><span>Show</span
        ><select>
          <option selected value="0">Count</option>
          <option value="1">Sum of Estimate</option>
        </select></label
      >
    </div>
    <p class="pivot-shows">Count by Assignee and State</p>
    <div class="pivot-scroll">
      <table class="block-table pivot-table">
        <thead>
          <tr>
            <th scope="col">Assignee \ State</th>
            <th scope="col" class="num">To do</th>
            <th scope="col" class="num">Done</th>
            <th scope="col" class="num">In progress</th>
            <th scope="col" class="num">All</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">—</th>
            <td class="num" style="background: color-mix(in srgb, var(--accent) 22%, transparent)">
              8
            </td>
            <td class="num" style="background: color-mix(in srgb, var(--accent) 26%, transparent)">
              10
            </td>
            <td class="num"></td>
            <td class="num pivot-total">18</td>
          </tr>
          <tr>
            <th scope="row">Chen Yuting</th>
            <td class="num" style="background: color-mix(in srgb, var(--accent) 19%, transparent)">
              7
            </td>
            <td class="num" style="background: color-mix(in srgb, var(--accent) 19%, transparent)">
              7
            </td>
            <td class="num" style="background: color-mix(in srgb, var(--accent) 8%, transparent)">
              2
            </td>
            <td class="num pivot-total">16</td>
          </tr>
          <tr>
            <th scope="row">Esme Whitlock</th>
            <td class="num" style="background: color-mix(in srgb, var(--accent) 19%, transparent)">
              7
            </td>
            <td class="num" style="background: color-mix(in srgb, var(--accent) 15%, transparent)">
              5
            </td>
            <td class="num" style="background: color-mix(in srgb, var(--accent) 11%, transparent)">
              3
            </td>
            <td class="num pivot-total">15</td>
          </tr>
          <tr>
            <th scope="row">Amara Okafor</th>
            <td class="num" style="background: color-mix(in srgb, var(--accent) 13%, transparent)">
              4
            </td>
            <td class="num" style="background: color-mix(in srgb, var(--accent) 13%, transparent)">
              4
            </td>
            <td class="num" style="background: color-mix(in srgb, var(--accent) 15%, transparent)">
              5
            </td>
            <td class="num pivot-total">13</td>
          </tr>
          <tr>
            <th scope="row">Bastian Holm</th>
            <td class="num" style="background: color-mix(in srgb, var(--accent) 22%, transparent)">
              8
            </td>
            <td class="num" style="background: color-mix(in srgb, var(--accent) 11%, transparent)">
              3
            </td>
            <td class="num" style="background: color-mix(in srgb, var(--accent) 8%, transparent)">
              2
            </td>
            <td class="num pivot-total">13</td>
          </tr>
          <tr>
            <th scope="row">Farid Haddad</th>
            <td class="num" style="background: color-mix(in srgb, var(--accent) 11%, transparent)">
              3
            </td>
            <td class="num" style="background: color-mix(in srgb, var(--accent) 15%, transparent)">
              5
            </td>
            <td class="num" style="background: color-mix(in srgb, var(--accent) 8%, transparent)">
              2
            </td>
            <td class="num pivot-total">10</td>
          </tr>
          <tr>
            <th scope="row">Dara Nikolaidis</th>
            <td class="num" style="background: color-mix(in srgb, var(--accent) 8%, transparent)">
              2
            </td>
            <td class="num" style="background: color-mix(in srgb, var(--accent) 11%, transparent)">
              3
            </td>
            <td class="num" style="background: color-mix(in srgb, var(--accent) 8%, transparent)">
              2
            </td>
            <td class="num pivot-total">7</td>
          </tr>
          <tr>
            <th scope="row">Greta Lindqvist</th>
            <td class="num"></td>
            <td class="num"></td>
            <td class="num" style="background: color-mix(in srgb, var(--accent) 6%, transparent)">
              1
            </td>
            <td class="num pivot-total">1</td>
          </tr>
          <tr>
            <th scope="row">Hiro Tanabe</th>
            <td class="num" style="background: color-mix(in srgb, var(--accent) 6%, transparent)">
              1
            </td>
            <td class="num"></td>
            <td class="num"></td>
            <td class="num pivot-total">1</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
  <figcaption>
    Computed by Oriel from the index and its change log, where Type is story: Count by Assignee and
    State, of 94 rows; it can be regrouped in the window from this same read, with no model
  </figcaption>
</figure>
```

```html specimen id=pivot-down title="Down one field, it draws as bars"
<figure class="answer-block" data-form="pivot">
  <div>
    <div class="pivot-picks">
      <label class="pivot-pick"
        ><span>Rows</span
        ><select>
          <option selected value="epic">Epic</option>
          <option value="state">State</option>
          <option value="assignee">Assignee</option>
          <option value="startedAt">Started</option>
          <option value="doneAt">Done</option>
        </select></label
      ><label class="pivot-pick"
        ><span>Columns</span
        ><select>
          <option selected value="">None</option>
          <option value="state">State</option>
          <option value="assignee">Assignee</option>
          <option value="startedAt">Started</option>
          <option value="doneAt">Done</option>
        </select></label
      ><label class="pivot-pick"
        ><span>Show</span
        ><select>
          <option selected value="0">Count</option>
          <option value="1">Sum of Estimate</option>
        </select></label
      >
    </div>
    <p class="pivot-shows">Count by Epic</p>
    <ol class="block-bars">
      <li>
        <span class="block-bar-label">Accessibility audit remediation (WCAG 2.2 AA)</span
        ><span class="block-bar-track" aria-hidden="true"
          ><span class="block-bar" style="width: 100%"></span></span
        ><span class="block-bar-value">40</span>
      </li>
      <li>
        <span class="block-bar-label">Boarding passes and gate scanning</span
        ><span class="block-bar-track" aria-hidden="true"
          ><span class="block-bar" style="width: 27.5%"></span></span
        ><span class="block-bar-value">11</span>
      </li>
      <li>
        <span class="block-bar-label">Checkout v2: phone wallets and saved cards</span
        ><span class="block-bar-track" aria-hidden="true"
          ><span class="block-bar" style="width: 25%"></span></span
        ><span class="block-bar-value">10</span>
      </li>
      <li>
        <span class="block-bar-label">Weather disruptions and rebooking</span
        ><span class="block-bar-track" aria-hidden="true"
          ><span class="block-bar" style="width: 22.5%"></span></span
        ><span class="block-bar-value">9</span>
      </li>
      <li>
        <span class="block-bar-label">Vehicle and freight reservations</span
        ><span class="block-bar-track" aria-hidden="true"
          ><span class="block-bar" style="width: 20%"></span></span
        ><span class="block-bar-value">8</span>
      </li>
      <li>
        <span class="block-bar-label">Localisation for summer visitors</span
        ><span class="block-bar-track" aria-hidden="true"
          ><span class="block-bar" style="width: 20%"></span></span
        ><span class="block-bar-value">8</span>
      </li>
      <li>
        <span class="block-bar-label">Offline boarding on the pier</span
        ><span class="block-bar-track" aria-hidden="true"
          ><span class="block-bar" style="width: 15%"></span></span
        ><span class="block-bar-value">6</span>
      </li>
      <li>
        <span class="block-bar-label">—</span
        ><span class="block-bar-track" aria-hidden="true"
          ><span class="block-bar" style="width: 5%"></span></span
        ><span class="block-bar-value">2</span>
      </li>
    </ol>
  </div>
  <figcaption>
    Computed by Oriel from the index and its change log, where Type is story: Count by Epic, of 94
    rows; it can be regrouped in the window from this same read, with no model
  </figcaption>
</figure>
```

### Compact, in a pin

`compact` is a pin's drawing (`data-compact` on the figure): narrower (420 units), shorter, with no grid, no "today" label and fewer dates, a timeline's first 3 bars with no axis, a pivot's first 3 rows with no pickers. The marks are the same. See [Pins](/components/block#pins).

## States

```html specimen id=state-focus title="Focus visible: a pivot's picker" state=focus-visible
<figure class="answer-block" data-form="pivot">
  <div>
    <div class="pivot-picks">
      <label class="pivot-pick"
        ><span>Rows</span
        ><select class="ws-focus-visible">
          <option selected value="assignee">Assignee</option>
          <option value="state">State</option>
          <option value="epic">Epic</option>
        </select></label
      ><label class="pivot-pick"
        ><span>Columns</span
        ><select>
          <option value="">None</option>
          <option selected value="state">State</option>
          <option value="epic">Epic</option>
        </select></label
      ><label class="pivot-pick"
        ><span>Show</span
        ><select>
          <option selected value="0">Count</option>
          <option value="1">Sum of Estimate</option>
        </select></label
      >
    </div>
    <p class="pivot-shows">Count by Assignee and State</p>
  </div>
</figure>
```

- **Rest** is every specimen above. A chart has no hover look: pointing at a mark shows its value in the browser's own tooltip (an SVG `<title>` on a hit circle, column or the range; a `title` on a timeline bar).
- **Focus visible:** only the pivot's pickers take focus, with the global ring. Nothing else in a chart is a tab stop.
- **Lower bounds:** `data-earlier` on a timeline bar, `.chart-bound` in a spread's column, "≥" on a mark or a bar, "at least" in the caption.
- **Compact:** a pin's, above.
- **Disabled, busy, error:** none. A chart shows once its read has finished. One Oriel can't draw (a read with no dates, a sum of a lower bound, too few rows for a line) is refused, and the agent hears why; a line or forecast that can't be drawn is left out and the caption says why ("no line: …", "no forecast: …").
- **Empty:** a read with no rows is refused, so no empty chart shows.

## Keyboard and ARIA

- The SVG forms are `role="img"`, named by `aria-label`, the declared label of what they count ("Done", "Days in its state"). The figure's caption names the figure, so a reader hears how it was computed.
- A timeline's date axis is `aria-hidden`; each bar's dates are in its `title`.
- A pivot's pickers are native `<select>`s, each named by its `<label>`. Picking regroups at once, with no model and no server call; telemetry hears only that it was regrouped (`pivotRegrouped`).
- A pivot's table has `<th scope="col">` for its columns and `<th scope="row">` for its rows; the corner says both fields, "Assignee \ State".
- Bars (a pivot down one field) are an `<ol>`, the track `aria-hidden`, as on the [Block](/components/block) page.

## Content

- The caption is Oriel's and says how: "Computed by Oriel from the index and its change log: Done, counted by week, running, since Sep 7. Least-squares line over 7 whole weeks, R² 0.99, 2.8 a week. At that rate the 19 left get there around Dec 22 (Dec 17 – Dec 30, 80%), if no more are added".
- A forecast always ends "if no more are added". Where there's none, the caption says why: "no forecast: …", "no line: …".
- A lower bound is "≥" beside a figure and "at least" in a sentence: "median ≥ 45", "median at least 45".
- Dates are short, month and day: "Sep 7". Today is "today". A total is "40 in all".
- A pivot says what it shows: "Count by Assignee and State", "Sum of Estimate by Epic". A blank label is "—"; what didn't fit is "Other (n)".
- Labels that are items are the item's name from the index, never the agent's words.

## Where the app uses it

- `SeriesChart`, `TimelineChart`, `SpreadChart` and `PivotChart` in `packages/web/src/charts.tsx`, chosen by `BlockBody` in `packages/web/src/block.tsx`. The shared helpers: `named` (an item's name for its ID) and `atLeast` ("≥ ").
- The figures: `buildChart` in `packages/core/src/block-charts.ts`, over `seriesOf`, `spreadOf` and `pivotOf` in `packages/core/src/chart.ts`. The read: `historyOf` and `historyFields` in `packages/core/src/history.ts`.
- In a thread and the window chat, under the agent's reply; compact in the overview's Pinned strip (`PinnedStrip` in `packages/web/src/noticed-strip.tsx`).
- CSS: `.chart`, `.chart-grid line`, `.chart-axis`, `.chart-line`, `.chart-dot`, `.chart-column`, `.chart-bound`, `.chart-fit`, `.chart-range`, `.chart-timeline`, `.timeline-row`, `.timeline-bar`, `.timeline-late`, `.timeline-due`, `.timeline-today`, `.pivot-picks`, `.pivot-pick select`, `.pivot-scroll` and `.pivot-total` in `window.css`.

## Drift

Status **drifting**:

- **Tooltips of the browser's own.** Every other control's tooltip is Oriel's (`Tooltip` in `packages/web/src/tooltip.tsx`), but a chart's values are in SVG `<title>`s and a timeline bar's `title`: the system's look, a delay of its own, and nothing on keyboard focus or touch. A mark's value can't be reached without a pointer.
- **A thin name.** An SVG chart's name is only its label ("Done"); the series' points and the spread's bins aren't in the accessibility tree except as `<title>`s.
- **A fourth styled select.** `.pivot-pick select` styles a native select of its own, beside the three on the [Select](/components/select) page; see [Customizable selects](/drift#d14-customizable-selects).
- **Literal.** `.timeline-today` is `1px` wide and `.timeline-due` `2px`, where the axes use `--border-thin`. The pivot's wrapper is `<div class="chart-pivot">` with no rule in window.css, so the specimens here leave the class off.

Copy the component, not the markup: a new chart is a form in `BlockBody`, built in core, never an SVG drawn in a page.
