# 0053 Chart blocks: a series with a fitted line, a timeline, a spread and a pivot, from history()

Accepted 2026-11-04, from the chart-blocks spike's draft (2026-11-03). Amended by OA-240. Amends 0030. Changes SPEC §1, §2, §7 and §8.

Adds: none

**Decision.**

- **Four more block forms, under 0030's guarantee.** The agent names a read, a form and fields; Oriel computes every figure, line and date. A block is still typed data, rendered by Oriel in the theme's tokens.
  - **Series:** rows counted (or a field summed) by week or day, optionally running, optionally with a least-squares line. A running series with a line forecasts when the rest arrive.
  - **Timeline:** a bar per row, or per group (`by`), from a start date to an end date, open bars running to today, today's line, and lateness past a due date when the read has one. Without a `label`, each bar is its row's item.
  - **Spread:** a histogram of a number in at most 12 bins of a readable width, with the median and the 90th percentile marked.
  - **Pivot:** a grid of a read's rows by one field, or two, counted or summed, which the person regroups in the window with no model call. Oriel computes every grouping of up to 5 of the read's fields when it builds the block, so regrouping only picks one. It is its own form: bars stay, for "who's busiest" from `window.overview()`.
  - Every form takes `where`, equality on declared fields, so the agent never has to filter rows in code before showing them. Its values are the read's own: a row holds each, or the block is refused. The caption says it.
- **One read with dates: `history(of?)`.** Items from the index with when the change log saw each start, finish and change state: an epic's children, a workstream's members, or every item. It reads the index and the change log only, never a source or a model, so its blocks can be pinned. `of` is the agent's text, so an item's ID in it must be a declared kind's.
  - **It holds no content.** An item and its epic are their IDs, and their facets (kind, state, assignee, estimate) and dates; never a title. Oriel draws a label that is an item's ID with the item's name from the index, as a chip draws one (0032). A read that declares itself content-free (`contentFree`) makes no escape-hatch block, though it reads outside the region: its charts drop "Outside this workstream · read-only". A rows, table or bars block of it still carries the label, since it shows each item's title (amended by OA-240 below: no block of it does). This amends 0030, under which every block from a read outside the region was the escape hatch's. Nothing it returns can be read or written through, since `search()`'s hits alone open that door.
  - A read with dates declares `time: { asOf, since }`. A chart never reads the machine's clock: today is the read's `asOf`. Before `since`, the start of the change log, Oriel knows that something happened, not when. A date at `since` means "by then".
  - A number can be declared a lower bound (`atLeast`), as days in a state that began before the log are. A spread says its median and 90th percentile are "at least"; a bar shows "≥".
  - Which numbers add up is declared (`sums`); a pivot never offers the sum of days.
- **What the fit may say.** Oriel fits only whole weeks (the current one is still filling), only with 4 whole weeks and 5 events, and forecasts only when R² ≥ 0.6, the line rises and the date is within six months. The range is the weekly rate's 80% interval, from the spread of each week's rise, not from the line's residuals, which a running total makes too small. The caption states the method, R², the rate, the date and range, and "if no more are added". Otherwise it says why there's no line or no forecast.
- **The agent reads the caption.** `show()`'s result for a chart is Oriel's line plus the caption, so the reply quotes Oriel's figures. One system-prompt line: figures go in a block; never forecast or tabulate figures yourself.
- **Pins.** Each chart form pins as 0030 pins: the read, its arguments (IDs) and the spec, through 0030's `pin.add`, which is still to be built; there is no other way to pin one. A pin draws compact, with its whole caption, in the Pinned strip that Noticed's pins (0052) already draw in, with the same code. A pivot pin keeps the grouping it was pinned with, as the spec's `rows`, `columns` and `value`, and is built with that grouping alone.
- **Charts follow one look.** One series colour, the theme's accent, in the theme's tokens, light and dark; hairline axes; columns square at the baseline with a rounded data end; a dash only for what's projected (the fitted line and the forecast); text in text tokens, never the series colour; each mark's value in its tooltip.

**Why.**

- The spike measured 7 new eval cases and the 2 existing chart cases, in a world with eight weeks of change log, live on claude-opus-5-5. Before the prompt line, the agent read `history()` correctly but answered 4 of 7 questions with its own markdown tables, and twice worked out its own forecast. After it, 4 rounds: the expected form on 28 of 28 chart trials, no tables of its own, and the existing bars cases unchanged.
- Shipped without titles, on a world whose index now holds some 5,000 items, the agent at first declined "break story points down by epic and status" in the window chat: it saw thousands of untitled items and an empty region. `history()`'s doc naming them as the window's items fixed it. In the four rounds on the final text, 38 cases a round: the expected form on 36 of 36 chart trials, and the whole suite 37, 37, 36 and 37 of 38. The judge faults one forecast reply in 3 of 4 rounds for framing Oriel's forecast in figures of its own, such as a rate rounded to "one a week"; that case is marked failing, a target for a climb.
- A model writing a forecast is exactly the untrustworthy coarse view SPEC §1 warns about. Oriel's forecast, with its method and range in the caption, is checkable, and refuses when the data can't carry it.
- The spike's `history()` returned every item's title, and its epic's, to a workstream's agent, outside the region and with no block of rows to show it: a silent reach SPEC §1.6 and §8 forbid. Without content it reaches nothing a `search()` would have to show, and the person still sees each item's name, drawn by Oriel.
- On a 4,000-item world with 3,000 change log entries, one `history()` and four pins built from it (a series, a timeline by epic, a spread and a pivot) take 5.8 ms together, inside the overview's 50 ms; the spike's builders took 93 ms, mostly a pivot computing every grouping and dates checked once per row. A pivot pin is 0.8 KB; the same pivot in the window, with every grouping, 4.8 KB.

**Rejected.**

- **The agent computing the series and handing Oriel points.** 0030's guarantee holds only if Oriel computes from the read.
- **Titles in `history()`, marked as the escape hatch.** Every chart of it would carry "Outside this workstream", and a workstream's agent would read every title in the window unasked.
- **A pivot regrouped by a server route.** It would need the rows stored or the read rerun per click; precomputed groupings are small (5 fields at most) and need nothing.
- **A pivot regrouped in the browser from raw rows.** The browser can't import core, so the computation would live twice.
- **Pivot replacing bars.** A one-field pivot draws as bars, but the agent picks bars from `window.overview()` for "who's busiest" and a pivot only when asked to break something down by two things. Keep bars; let a bars block offer regrouping later if people ask.
- **Dates from each source (Jira's created, due and resolved).** Truer and older than the change log, but every connector would declare them. Later, as declared date facets.

**Consequences.**

- The module's base rises from 4,829 to 5,439 bytes (budget 4,950 to 5,450), for `history()` and its type and show()'s forms; the system prompt from 2,284 to 2,400 (budget 2,450). Every cassette is recorded again.
- The change log doesn't record an item's arrival, so an item created after the log began and never moved looks "done by" its last update, and scope never grows on a series. Log arrivals (a story).
- The change log's start is its earliest kept entry, not the first sync. Record the first sync (a story).
- Jira's status names and due dates aren't in the index, so "in review" and slips can't be charted yet.
- Pins rerun `history()` once per look, shared by every pin, and build only the pinned grouping of a pivot, to stay inside the overview's 50 ms.
- The judge in evals sees the captions of the blocks Oriel showed.
- Telemetry: a block shown, by form, already covers the new forms; `block.regrouped` counts a pivot regrouped, by nothing but that it was.

**Amended by OA-240, 2026-11-05.** No block of a content-free read carries "Outside this workstream · read-only", in any form: rows, table and bars lose it as the charts did. Whether a block is the escape hatch's now follows where its data came from, not its form. A content-free read is Oriel's own computing over the index and change log, never an item reached outside the region, and the titles a rows, table or bars block shows are drawn by Oriel from the index, as a chip draws them (0032); the agent still reads none. A rows block of it also drops its in-workstream markers, with the frame. `base` in packages/core/src/block.ts.
