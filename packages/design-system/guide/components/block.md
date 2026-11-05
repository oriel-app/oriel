---
title: Block
status: drifting
group: Thread
order: 65
classes: answer-block, search-label, block-more, block-bars, block-bar-label, block-bar-track, block-bar, block-bar-value, block-table, num, block-rows, in-region, block-preview, answer-sketch, chip, chip-link, chip-lead, chip-icon, chip-key, chip-name, chip-state
summary: What Oriel draws under the agent's reply from a read's result (bars, a table, rows of items, a waiting connection's preview, and the charts), and the agent's own sketch, framed and captioned; and a block pinned to the overview.
---

# Block

## What it is

A block is a figure under the agent's reply that **Oriel** built from the result of a read the agent ran (decision 0030). The agent asks for one and says which read and which fields; Oriel draws it from the data. So its figures can't be made up, every text in it (a synced title included) renders as text, and its caption, written by Oriel, says where it came from.

There are four forms here, four [charts](/components/chart) from `history()` (a series, a timeline, a spread and a pivot, decision 0053) on a page of their own, and one more thing that sits in the same place:

- **Bars:** one series, ranked, each value labelled.
- **A table:** up to 5 columns and 20 rows.
- **Rows of items:** each item as a [chip](/components/chip), so it looks as it does named in a sentence, and opens in the item panel.
- **A waiting connection's preview** (decision 0051): the source's cells as text, read live so the agent can draft how Oriel reads the source. Nothing in it is an item.
- **A sketch** (decision 0033) isn't a block: it's the agent's own HTML, in a sandboxed frame. Oriel draws its border and caption outside the frame, so no sketch can fake them, and says it isn't checked.

One renderer, `BlockFigure` in `packages/web/src/block.tsx`, draws a block in a thread and in the window chat.

## When to use it

- When an answer is data: who carries the most points, which stories have no estimate, what search found. Show it as a block, and let the reply say what it means in a sentence: "Amara and Yuting carry the most points."
- **Bars** for one number per label, compared: points by assignee, items by status.
- **A table** for several fields per row, read across.
- **Rows** for items the person may open, act on or add to a workstream.
- **A sketch** when the agent wants to show a shape the data can't: a layout, a flow. Never for data.

## When not to

- Not for prose. A list of three things in a sentence is the reply's markdown.
- Not for anything the person must decide. A block has no buttons. A write is a [change set](/components/change-set); a draft is held for the person to apply.
- Not a sketch for figures. A sketch's numbers are the agent's, not Oriel's, and its caption says so; a chart of real data is bars.
- Not more than 4 in one answer (`maxBlocksPerTurn`), and not past the caps: 10 bars, 20 rows, 5 columns (`maxBars`, `maxRows` and `maxColumns` in `packages/core/src/block.ts`). What's cut is counted, as "and 12 more".

## Anatomy and variants

A block is a `<figure class="answer-block">`, with `data-form` its form: `--space-3` padding, `--border-thin` in `--line`, `--radius-lg`, on `--surface-sunk`. Then, in order:

1. A label (`.search-label`, `--derived`, small capitals) only when the block isn't the workstream's own: the escape hatch's **"Outside this workstream · read-only"**, or a preview's **"Read live from the source · not items"**.
2. The body, by form.
3. **"and 12 more"** (`.block-more`), when the read had more than the block shows.
4. The caption (`figcaption`, faint, `--text-xs`): **"Computed by Oriel from {source}: {what}"**.

### Bars

A grid of label, track and value. The track is `aria-hidden`; a reader hears the label and then the value. Nothing grows past the largest, and a value under zero draws no bar. A row with no label reads "—".

```html specimen id=bars title="Bars: story points by assignee"
<figure class="answer-block" data-form="bars">
  <ol class="block-bars">
    <li>
      <span class="block-bar-label">Amara Okafor</span
      ><span class="block-bar-track" aria-hidden="true"
        ><span class="block-bar" style="width: 100%"></span></span
      ><span class="block-bar-value">8</span>
    </li>
    <li>
      <span class="block-bar-label">Chen Yuting</span
      ><span class="block-bar-track" aria-hidden="true"
        ><span class="block-bar" style="width: 100%"></span></span
      ><span class="block-bar-value">8</span>
    </li>
    <li>
      <span class="block-bar-label">Dara Nikolaidis</span
      ><span class="block-bar-track" aria-hidden="true"
        ><span class="block-bar" style="width: 62.5%"></span></span
      ><span class="block-bar-value">5</span>
    </li>
    <li>
      <span class="block-bar-label">—</span
      ><span class="block-bar-track" aria-hidden="true"
        ><span class="block-bar" style="width: 37.5%"></span></span
      ><span class="block-bar-value">3</span>
    </li>
  </ol>
  <figcaption>
    Computed by Oriel from this workstream's stories, read live: Story points by Assignee, summed,
    highest first
  </figcaption>
</figure>
```

### A table

`.block-table`: full width, collapsed borders, `--text-md`. Headers are muted and small. A number is right-aligned in tabular figures (`.num`, on its cell, and on its header when the first row's cell is a number). Nothing is "—"; a yes-or-no is "yes" or "no".

```html specimen id=table title="A table, cut at 20 rows"
<figure class="answer-block" data-form="table">
  <table class="block-table">
    <thead>
      <tr>
        <th scope="col">Key</th>
        <th scope="col">Title</th>
        <th scope="col">Assignee</th>
        <th scope="col" class="num">Estimate</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>SYN-23</td>
        <td>Pay with a phone wallet on the website</td>
        <td>Amara Okafor</td>
        <td class="num">3</td>
      </tr>
      <tr>
        <td>SYN-99</td>
        <td>Save a card for next time</td>
        <td>—</td>
        <td class="num">2</td>
      </tr>
      <tr>
        <td>SYN-104</td>
        <td>Handle 3-D Secure challenges in the native checkout</td>
        <td>Chen Yuting</td>
        <td>—</td>
      </tr>
    </tbody>
  </table>
  <p class="block-more">and 12 more</p>
  <figcaption>
    Computed by Oriel from this workstream's stories, read live: Key, Title, Assignee, Estimate
  </figcaption>
</figure>
```

### Rows of items

Each row is a [chip](/components/chip): the source's icon, the key, the name (cut at a word), and where it stands. A row the thread's workstream holds too says "in this workstream". An item the index no longer has is named "Not in the index". The rows set the panel's list, so the item panel can step through them.

```html specimen id=rows title="Rows of items"
<figure class="answer-block" data-form="rows">
  <ul class="block-rows">
    <li>
      <span
        class="chip"
        data-kind="item"
        data-state="in-progress"
        title="SYN-23: Pay with a phone wallet on the website, in progress"
        ><a
          class="chip-link"
          href="https://synthetic.atlassian.net/browse/SYN-23"
          target="_blank"
          rel="noopener noreferrer"
          ><span class="chip-lead"
            ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
              <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
            ><span class="chip-key">SYN-23</span></span
          >
          <span class="chip-name">Pay with a phone wallet on the website</span
          ><span class="chip-state">In Progress</span></a
        ></span
      >
    </li>
    <li>
      <span
        class="chip"
        data-kind="item"
        data-state="todo"
        title="SYN-99: Save a card for next time, to do"
        ><a
          class="chip-link"
          href="https://synthetic.atlassian.net/browse/SYN-99"
          target="_blank"
          rel="noopener noreferrer"
          ><span class="chip-lead"
            ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
              <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
            ><span class="chip-key">SYN-99</span></span
          >
          <span class="chip-name">Save a card for next time</span
          ><span class="chip-state">To Do</span></a
        ></span
      >
    </li>
  </ul>
  <figcaption>Computed by Oriel from this workstream's stories, read live: Key</figcaption>
</figure>
```

### The escape hatch: outside the workstream

What a read found outside the thread's workstream (`search()`, `window.overview()`) is marked `data-outside`: the border turns **dashed** in `--derived-line`, the fill `--derived-soft`, and the label says **"Outside this workstream · read-only"**. A row the workstream holds too says "in this workstream". A block of `history()`, in any form, never is: it holds IDs, facets and dates, never content, so it is Oriel's own computing, not an item reached outside (decision 0053).

```html specimen id=outside title="Outside this workstream · read-only"
<figure class="answer-block" data-form="rows" data-outside>
  <p class="search-label">Outside this workstream · read-only</p>
  <ul class="block-rows">
    <li>
      <span
        class="chip"
        data-kind="item"
        data-state="in-progress"
        title="SYN-3: Weather disruptions and rebooking, in progress"
        ><a
          class="chip-link"
          href="https://synthetic.atlassian.net/browse/SYN-3"
          target="_blank"
          rel="noopener noreferrer"
          ><span class="chip-lead"
            ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
              <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
            ><span class="chip-key">SYN-3</span></span
          >
          <span class="chip-name">Weather disruptions and rebooking</span
          ><span class="chip-state">In Progress</span></a
        ></span
      >
    </li>
    <li>
      <span
        class="chip"
        data-kind="item"
        data-state="done"
        title="SYN-23: Pay with a phone wallet on the website, done"
        ><a
          class="chip-link"
          href="https://synthetic.atlassian.net/browse/SYN-23"
          target="_blank"
          rel="noopener noreferrer"
          ><span class="chip-lead"
            ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
              <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
            ><span class="chip-key">SYN-23</span></span
          >
          <span class="chip-name">Pay with a phone wallet on the website</span
          ><span class="chip-state">Done</span></a
        ></span
      ><span class="in-region">in this workstream</span>
    </li>
  </ul>
  <figcaption>Computed by Oriel from a search of everything indexed</figcaption>
</figure>
```

### A waiting connection's preview

While a connection waits for the options it reads its source by, the agent may read the source live, to draft them (decision 0051). That read shows as a preview: each table the source has, its cells as text, so nothing in it is an item to cite. It's always `data-outside`, labelled **"Read live from the source · not items"**.

```html specimen id=preview title="A preview: the source's own cells"
<figure class="answer-block" data-form="preview" data-outside>
  <p class="search-label">Read live from the source · not items</p>
  <div class="block-preview">
    <table class="block-table">
      <caption>
        Tracker
      </caption>
      <thead>
        <tr>
          <th scope="col">A</th>
          <th scope="col">B</th>
          <th scope="col">C</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>ID</td>
          <td>Feature</td>
          <td>Owner</td>
        </tr>
        <tr>
          <td>F-1</td>
          <td>Gift card balance at checkout</td>
          <td>Amara Okafor</td>
        </tr>
        <tr>
          <td>F-2</td>
          <td>Saved cards on the website</td>
          <td>—</td>
        </tr>
      </tbody>
    </table>
  </div>
  <figcaption>Read by Oriel from the source, for the agent to draft how Oriel reads it</figcaption>
</figure>
```

### Sketch

The agent's HTML, framed from the sketch origin in an `<iframe sandbox="">` (no token: no scripts, no forms, no links out), at one of three heights, 240, 400 (the default) or 640 pixels; a taller sketch scrolls inside it. The frame's theme sheet withholds the accent, state and button tokens, so a sketch can't draw an exact Approve. Around it, Oriel's own **dotted** `--line-strong` border, which no block has, and its caption: **"Sketched by the agent · not checked against Oriel's data"**.

```html specimen id=sketch title="A sketch, framed and captioned by Oriel"
<figure class="answer-sketch">
  <iframe
    sandbox=""
    srcdoc="<p style='margin:16px;font:15px/1.5 system-ui'>Checkout, on the website: the wallet button above the card form, the saved card under it.</p>"
    data-height="240"
    title="A sketch by the agent"
    referrerpolicy="no-referrer"
  ></iframe>
  <figcaption>Sketched by the agent · not checked against Oriel's data</figcaption>
</figure>
```

The app sets `src` to the sketch origin (`http://127.0.0.1:<sketch port>/sketches/<thread>/<sketch>`); the specimen uses `srcdoc` to stand in for the agent's page.

### Pins

A block can be pinned to the overview (decision 0030): its read, its arguments and its form are kept, and the block is rerun on each look, with no model and no source call. Today a pin comes from a [Noticed](/components/noticed) card's **Pin** (decision 0052); 0030's `pin.add` for the agent isn't built yet.

The Pinned strip is an [overview section](/components/overview-section) under the headlines, its head **Pinned** with "rerun each time you look" (`.noticed-by`). Its pins sit in a grid at least 15rem wide each (`.pinned-blocks`). Each pin (`.pinned-block`) is the block drawn **compact** (`data-compact`, `--space-2` padding, and no "Outside this workstream" label), at its first 3 rows (bars at 5), its whole caption kept, with **Unpin** (`.quiet-action`) under it. A [chart](/components/chart) keeps every mark, in its own compact drawing; a pivot keeps the grouping it was pinned with. A pin whose read names nothing there now says so.

```html specimen id=pins title="The Pinned strip: a running series, a pivot, and a pin whose read is gone"
<section class="overview-section" data-section="pinned" aria-label="Pinned">
  <h2 class="overview-head">Pinned <span class="noticed-by">rerun each time you look</span></h2>
  <div class="pinned-blocks">
    <div class="pinned-block">
      <figure class="answer-block" data-form="series" data-compact>
        <svg class="chart" viewBox="0 0 420 120" role="img" aria-label="Done">
          <line class="chart-axis" x1="8" x2="376" y1="102" y2="102" />
          <text class="chart-tick" x="8" y="116" text-anchor="middle">Sep 7</text>
          <text class="chart-tick" x="143.4" y="116" text-anchor="middle">Oct 19</text>
          <text class="chart-tick" x="278.8" y="116" text-anchor="middle">Nov 30</text>
          <g class="chart-total">
            <line x1="8" x2="376" y1="14" y2="14" />
            <text x="380" y="14" dy="0.32em">40 in all</text>
          </g>
          <polyline
            class="chart-line"
            points="8,99.8 30.6,93.2 53.1,88.8 75.7,80 98.3,73.4 120.8,69 143.4,62.4 165.9,58 188.5,55.8"
          />
          <circle class="chart-hit" cx="8" cy="99.8" r="8"><title>Week of Sep 7: 1</title></circle>
          <circle class="chart-hit" cx="30.6" cy="93.2" r="8">
            <title>Week of Sep 14: 4</title>
          </circle>
          <circle class="chart-hit" cx="53.1" cy="88.8" r="8">
            <title>Week of Sep 21: 6</title>
          </circle>
          <circle class="chart-hit" cx="75.7" cy="80" r="8">
            <title>Week of Sep 28: 10</title>
          </circle>
          <circle class="chart-hit" cx="98.3" cy="73.4" r="8">
            <title>Week of Oct 5: 13</title>
          </circle>
          <circle class="chart-hit" cx="120.8" cy="69" r="8">
            <title>Week of Oct 12: 15</title>
          </circle>
          <circle class="chart-hit" cx="143.4" cy="62.4" r="8">
            <title>Week of Oct 19: 18</title>
          </circle>
          <circle class="chart-hit" cx="165.9" cy="58" r="8">
            <title>Week of Oct 26: 20</title>
          </circle>
          <circle class="chart-hit" cx="188.5" cy="55.8" r="8">
            <title>Week of Nov 2: 21</title>
          </circle>
          <circle class="chart-dot" cx="188.5" cy="55.8" r="4" />
          <line class="chart-fit" x1="8" y1="99.2" x2="188.5" y2="50.8">
            <title>Least-squares line, R² 0.99</title>
          </line>
          <g class="chart-forecast">
            <rect class="chart-range" x="333.7" width="42.3" y="9" height="10" rx="3">
              <title>80% range: Dec 17 to Dec 30</title>
            </rect>
            <line x1="196.2" y1="55.8" x2="352.1" y2="14" />
            <circle class="chart-dot" cx="352.1" cy="14" r="4" />
            <text x="352.1" y="4" text-anchor="middle">Dec 22</text>
          </g>
          <g class="chart-today"><line x1="196.2" x2="196.2" y1="8" y2="102" /></g>
          <text class="chart-end" x="196.5" y="55.8" dy="0.32em">21</text>
        </svg>
        <figcaption>
          Computed by Oriel from the index and its change log: Done, counted by week, running, since
          Sep 7. Least-squares line over 7 whole weeks, R² 0.99, 2.8 a week. At that rate the 19
          left get there around Dec 22 (Dec 17 – Dec 30, 80%), if no more are added
        </figcaption>
      </figure>
      <button type="button" class="quiet-action">Unpin</button>
    </div>
    <div class="pinned-block">
      <figure class="answer-block" data-form="pivot" data-compact>
        <div>
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
                  <td
                    class="num"
                    style="background: color-mix(in srgb, var(--accent) 22%, transparent)"
                  >
                    8
                  </td>
                  <td
                    class="num"
                    style="background: color-mix(in srgb, var(--accent) 26%, transparent)"
                  >
                    10
                  </td>
                  <td class="num"></td>
                  <td class="num pivot-total">18</td>
                </tr>
                <tr>
                  <th scope="row">Chen Yuting</th>
                  <td
                    class="num"
                    style="background: color-mix(in srgb, var(--accent) 19%, transparent)"
                  >
                    7
                  </td>
                  <td
                    class="num"
                    style="background: color-mix(in srgb, var(--accent) 19%, transparent)"
                  >
                    7
                  </td>
                  <td
                    class="num"
                    style="background: color-mix(in srgb, var(--accent) 8%, transparent)"
                  >
                    2
                  </td>
                  <td class="num pivot-total">16</td>
                </tr>
                <tr>
                  <th scope="row">Esme Whitlock</th>
                  <td
                    class="num"
                    style="background: color-mix(in srgb, var(--accent) 19%, transparent)"
                  >
                    7
                  </td>
                  <td
                    class="num"
                    style="background: color-mix(in srgb, var(--accent) 15%, transparent)"
                  >
                    5
                  </td>
                  <td
                    class="num"
                    style="background: color-mix(in srgb, var(--accent) 11%, transparent)"
                  >
                    3
                  </td>
                  <td class="num pivot-total">15</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <figcaption>
          Computed by Oriel from the index and its change log, where Type is story: Count by
          Assignee and State, of 94 rows
        </figcaption>
      </figure>
      <button type="button" class="quiet-action">Unpin</button>
    </div>
    <div class="pinned-block">
      <p class="noticed-none">What this pin read isn't there any more.</p>
      <button type="button" class="quiet-action">Unpin</button>
    </div>
  </div>
</section>
```

The overview holds 4 pins at most. A fifth is refused, "The overview holds 4 pins already; unpin one first." (`maxPins` in `packages/db/src/noticed.ts`), shown as the Noticed strip's problem line, where 0030 asked which to replace.

## States

```html specimen id=state-focus title="Focus and hover: a row's chip" state=focus-visible
<figure class="answer-block" data-form="rows">
  <ul class="block-rows">
    <li>
      <span
        class="chip"
        data-kind="item"
        data-state="in-progress"
        title="SYN-23: Pay with a phone wallet on the website, in progress"
        ><a
          class="chip-link ws-focus-visible"
          href="https://synthetic.atlassian.net/browse/SYN-23"
          target="_blank"
          rel="noopener noreferrer"
          ><span class="chip-lead"
            ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
              <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
            ><span class="chip-key">SYN-23</span></span
          >
          <span class="chip-name">Pay with a phone wallet on the website</span
          ><span class="chip-state">In Progress</span></a
        ></span
      >
    </li>
    <li>
      <span
        class="chip"
        data-kind="item"
        data-state="todo"
        title="SYN-99: Save a card for next time, to do"
        ><a
          class="chip-link ws-hover"
          href="https://synthetic.atlassian.net/browse/SYN-99"
          target="_blank"
          rel="noopener noreferrer"
          ><span class="chip-lead"
            ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
              <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
            ><span class="chip-key">SYN-99</span></span
          >
          <span class="chip-name">Save a card for next time</span
          ><span class="chip-state">To Do</span></a
        ></span
      >
    </li>
  </ul>
  <figcaption>Computed by Oriel from this workstream's stories, read live: Key</figcaption>
</figure>
```

- **Rest** is every specimen above. A block is static: no hover, focus or active of its own. Only a row's chip is interactive: hover turns its name's underline to `currentColor`; focus shows the global ring.
- **Outside** (`data-outside`) is the one variant state: dashed, derived, labelled.
- **Disabled, busy, error** aren't states a block has. It shows when its read has finished. A block the server refuses (a field the read doesn't have, a bar with no number) is never drawn: the agent hears why and says so in words.
- **Empty:** a read with nothing in it is refused ("… is empty"), so no empty block shows.
- **A sketch** is loading or loaded inside its frame; Oriel draws nothing over it.

## Keyboard and ARIA

- `<figure>` with `<figcaption>`: the caption is the figure's name, so a reader hears where it came from.
- Bars are an `<ol>`, ranked. The track is `aria-hidden`; the label and value are text.
- A table has `<th scope="col">`. A preview's tables are named by their `<caption>`.
- A block has no tab stops of its own; a row's chip is a link (Tab), which opens the item in the panel (with ⌘ or a middle click, in its source).
- A sketch's frame is titled "A sketch by the agent". Nothing in it is Oriel's UI; its sandbox gives it no scripts and no focusable forms.

## Content

- The caption is Oriel's, never the agent's, and starts with what computed it: "Computed by Oriel from this workstream's stories, read live: Story points by Assignee, summed, highest first". A preview's: "Read by Oriel from the source, for the agent to draft how Oriel reads it".
- What a table or rows show is named by field labels, not raw field names: Key, Title, Estimate.
- What's cut is counted: "and 12 more", with the number in en-US form ("and 1,240 more").
- The labels are fixed copy: "Outside this workstream · read-only", "Read live from the source · not items", "Sketched by the agent · not checked against Oriel's data", "in this workstream", "Not in the index".

## Where the app uses it

- `BlockFigure`, `BlockBody` and `SketchFigure` in `packages/web/src/block.tsx`. `BlockBody` draws the forms: bars, table, preview and rows here, and the charts through `SeriesChart`, `TimelineChart`, `SpreadChart` and `PivotChart` in `packages/web/src/charts.tsx` (see [Chart](/components/chart)).
- In a thread and the window chat: through `ChatEntryItem` in `packages/web/src/thread-page.tsx`.
- The caps, `maxBars`, `maxRows` and `maxColumns` in `packages/core/src/block.ts`; the captions, made by `buildBlock` there; the escape hatch's source, `searchFields` in `packages/core/src/block.ts`.
- CSS: `.search-label`, `.answer-block`, `.answer-block[data-outside]`, `.answer-sketch`, `.block-more`, `.block-bars`, `.block-table`, `.block-rows`, `.in-region` and `.block-preview` in `window.css`.
- Pins: `PinnedStrip` in `packages/web/src/noticed-strip.tsx`, each a compact `BlockFigure`; CSS `.pinned-blocks`, `.pinned-block` and `.answer-block[data-compact]` in `window.css`. A pin's rows: `topOf` in `packages/web/src/noticed-strip.tsx`.

## Drift

Status **drifting**, in what's around the block more than in the block:

- **One table class, three wrappers.** `.block-table` draws a block's table, a preview's tables (in `.block-preview`), and a draft's tables (`ReviewTables` in `packages/web/src/block.tsx`, in a `.review-tables`), which the connect review step uses again in a wrapper of its own (`ReviewStep` in `packages/web/src/connect-steps.tsx`). The preview and the draft show the same source's cells two ways.
- **Two boxes the same.** `.answer-block` and the host's list under the reply (`.actions-block` in `window.css`) are the same box (line border, `--radius-lg`, `--surface-sunk`), though one is data and the other is what Oriel did.
- **An orphan comment.** "The escape hatch: what came from outside the workstream, read-only." (just above `.brought` in `window.css`) has no rules under it; the escape hatch's look is `[data-outside]` and `.search-label`.
- The sketch placeholder decision 0033 names for places a sketch can't show ("A sketch by the agent, shown in the thread only.") isn't in the code; nothing that reaches those places carries a sketch today.

Copy `BlockFigure` (import it; don't hand-draw a block). For a new table of the source's own cells, use the preview's shape, `.block-preview` with `.block-table`.
