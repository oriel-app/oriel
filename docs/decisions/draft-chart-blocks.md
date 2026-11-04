# Draft: chart blocks — a series with a fitted line, a timeline, a spread and a pivot, from history()

Draft from the chart-blocks spike, 2026-11-03. Not accepted. Would amend 0030 and change SPEC §2 (block), §4 and §7.

Adds: none

**Decision (proposed).**

- **Four more block forms, under 0030's guarantee.** The agent names a read, a form and fields; Oriel computes every figure, line and date. A block is still typed data, rendered by Oriel in the theme's tokens.
  - **Series:** rows counted (or a field summed) by week or day, optionally running, optionally with a least-squares line. A running series with a line forecasts when the rest arrive.
  - **Timeline:** a bar per row, or per group (`by`), from a start date to an end date, open bars running to today, today's line, and lateness past a due date when the read has one.
  - **Spread:** a histogram of a number in at most 12 bins of a readable width, with the median and the 90th percentile marked.
  - **Pivot:** a grid of a read's rows by one field, or two, counted or summed, which the person regroups in the window with no model call. Oriel computes every grouping of the read's fields when it builds the block, so regrouping only picks one.
  - Every form takes `where`, equality on declared fields, so the agent never has to filter rows in code before showing them. Its values are the read's own: a row holds each, or the block is refused. The caption says it.
- **One read with dates: `history(of?)`.** Items from the index with when the change log saw each start, finish and change state: an epic's children, a workstream's members, or every item. It reads the index and the change log only, never a source or a model, so its blocks can be pinned.
  - A read with dates declares `time: { asOf, since }`. A chart never reads the machine's clock: today is the read's `asOf`. Before `since`, the start of the change log, Oriel knows that something happened, not when. A date at `since` means "by then".
  - A number can be declared a lower bound (`atLeast`), as days in a state that began before the log are. A spread says its median and 90th percentile are "at least"; a bar shows "≥".
  - Which numbers add up is declared (`sums`); a pivot never offers the sum of days.
- **What the fit may say.** Oriel fits only whole weeks (the current one is still filling), only with 4 whole weeks and 5 events, and forecasts only when R² ≥ 0.6, the line rises and the date is within six months. The range is the weekly rate's 80% interval, from the spread of each week's rise, not from the line's residuals, which a running total makes too small. The caption states the method, R², the rate, the date and range, and "if no more are added". Otherwise it says why there's no line or no forecast.
- **The agent reads the caption.** `show()`'s result for a chart is Oriel's line plus the caption, so the reply quotes Oriel's figures. One system-prompt line: figures go in a block; never forecast or tabulate figures yourself.
- **Pins.** Each chart form pins as 0030 pins: the read, its arguments (IDs) and the spec. A pin draws compact, with its whole caption. A pivot pin keeps the grouping it was pinned with.

**Why.**

- Measured with 7 new eval cases and the 2 existing chart cases, in a world with eight weeks of change log, live on claude-opus-5-5, 31 cases a round. Before the prompt line, the agent read `history()` correctly but answered 4 of 7 questions with its own markdown tables, and twice worked out its own forecast. After it, 4 rounds: the expected form on 28 of 28 chart trials, no tables of its own, and the existing bars cases unchanged (12 of 12). Whole suite 22, 21, 31 and 31 of 31.
- A model writing a forecast is exactly the untrustworthy coarse view SPEC §1 warns about. Oriel's forecast, with its method and range in the caption, is checkable, and refuses when the data can't carry it.
- On a 4,000-item world, `history()` takes about 6 ms warm and the four forms 1 to 16 ms each; the pivot is the heaviest, 11.6 KB with every grouping.

**Rejected.**

- **The agent computing the series and handing Oriel points.** 0030's guarantee holds only if Oriel computes from the read.
- **A pivot regrouped by a server route.** It would need the rows stored or the read rerun per click; precomputed groupings are small (5 fields at most) and need nothing.
- **A pivot regrouped in the browser from raw rows.** The browser can't import core, so the computation would live twice.
- **Pivot replacing bars.** A one-field pivot draws as bars, but the agent picks bars from `window.overview()` for "who's busiest" and a pivot only when asked to break something down by two things. Keep bars; let a bars block offer regrouping later if people ask.
- **Dates from each source (Jira's created, due and resolved).** Truer and older than the change log, but every connector would declare them. Later, as declared date facets.

**Consequences.**

- The module's base rises from 4,829 to about 5,420 bytes (budget 5,450), for `history()` and its type; the system prompt from 2,284 to about 2,400 (budget 2,450). Every cassette is recorded again.
- The change log doesn't record an item's arrival, so an item created after the log began and never moved looks "done by" its last update, and scope never grows on a series. Log arrivals (a story).
- The change log's start is its earliest kept entry, not the first sync. Record the first sync (a story).
- Jira's status names and due dates aren't in the index, so "in review" and slips can't be charted yet.
- Pins rerun `history()` once per look, shared by every pin, and build only the pinned grouping of a pivot, to stay inside the overview's 50 ms.
- The judge in evals sees the captions of the blocks Oriel showed.
- Telemetry: a block shown, by form, already covers the new forms; add a pivot regrouped (by nothing but the count).
