---
title: Meters and bars
status: drifting
group: Display
order: 42
classes: status-bar, segment, plan-meter, setup-progress, cli-progress, cli-bar, overview-spark
summary: Thin bars that show a share or a progress: items by status, how much of the plan is used, a source being read, an install under way, and a workstream's last 14 days.
---

# Meters and bars

## What it is

A thin horizontal bar, or a small line, that shows an amount at a glance. Oriel has five, each for one job:

| Bar                             | Shows                                             | Element                                      | Height   | Track           | Fill                             |
| ------------------------------- | ------------------------------------------------- | -------------------------------------------- | -------- | --------------- | -------------------------------- |
| **Status bar** (`.status-bar`)  | Items by status category, as counts               | `<span role="img">` of `.segment`s           | 0.375rem | `--todo-soft`   | done, in progress, to do         |
| **Plan meter** (`.plan-meter`)  | How much of a plan window is used (decision 0046) | `<meter>`                                    | 6px      | `--line`        | in progress, then towards danger |
| **Reading** (`.setup-progress`) | A source being read in the first run              | `<progress>`                                 | 0.375rem | the browser's   | `accent-color: --accent`         |
| **Install** (`.cli-bar`)        | Claude Code downloading: going, never how far     | `<span aria-hidden>` with a moving `::after` | 0.375rem | `--accent-soft` | a 35% `--accent` slug            |
| **Spark** (`.overview-spark`)   | A workstream's changes over the last 14 days      | `<svg role="img">` polyline                  | 17px     | none            | an `--in-progress` line          |

A bars block in an answer (`.block-bars`, decision 0030) is a chart, not a meter: one bar per row, ranked, each value written beside it. See [Block](/components/block).

## When to use it

- **Status bar:** beside a group of items, to show how far along it is by count: a Browse cluster's head, a workstream's row on the overview. "Its parts are counts, not estimates" (`StatusBar` in `packages/web/src/window-page.tsx`).
- **Plan meter:** for a fraction of a limit, where more is worse. It's a `<meter>` because it's a measurement, not a task's progress.
- **Reading:** for a task with a known total, as the first run reads a source: `<progress max value>`. With no total yet, the same element with no `value` is the browser's indeterminate bar.
- **Spark:** to show whether something is moving, not how much. It has no axis and no numbers; its label says the total.

## When not to

- Not without the numbers in words nearby. Every bar here sits beside text that says what it shows ("42% used · resets in 2 h", "120 of 400 issues", "12 items"); the bar is a glance, not the only telling.
- Not a hand-made bar for progress. Use `<progress>` (copy `.setup-progress`); `.cli-bar` exists only because the installer gives no measure.
- Not `.status-bar` for points or estimates, and not for anything but the three status categories.
- Not the accent for a meter that isn't the person's move. The plan meter is in progress until it nears the limit, then turns towards danger; the accent bars (reading, install) are the first run's own steps, where the person is waiting on them.
- Not a spinner where a bar fits, or a bar where a word fits. For "Checking…" use a [loading line](/components/states).

## Anatomy and variants

### Status bar

A flex row of segments with a 2px gap, `--radius-lg`, clipped, on a `--todo-soft` track. Each segment's `flex-grow` is its count, so the parts are in proportion. It's an image with a label: "3 done, 2 in progress, 7 to do". With no items it's `.status-bar.empty`, `visibility: hidden`, so it keeps its space in a column.

```html specimen id=status-bar title="Items by status: in a workstream's overview row, and alone"
<div class="ws-stack">
  <ul class="overview-rows">
    <li class="overview-row overview-workstream" data-workstream="01JBX3Z9Y8X7W6V5T4S3R2Q1P0">
      <a
        class="overview-title overview-workstream-name"
        href="/workstreams/01JBX3Z9Y8X7W6V5T4S3R2Q1P0"
        >Checkout v2: phone wallets and saved cards</a
      >
      <svg
        class="overview-spark"
        viewBox="0 0 56 17"
        role="img"
        aria-label="19 changes in the last 14 days"
      >
        <title>19 changes in the last 14 days</title>
        <polyline
          points="0,16 4.31,12.5 8.62,16 12.92,9 17.23,5.5 21.54,16 25.85,16 30.15,12.5 34.46,2 38.77,9 43.08,16 47.38,12.5 51.69,5.5 56,9"
        />
      </svg>
      <span
        class="status-bar"
        role="img"
        aria-label="3 done, 2 in progress, 7 to do"
        title="3 done, 2 in progress, 7 to do"
        ><span class="segment done" style="flex-grow: 3"></span
        ><span class="segment in-progress" style="flex-grow: 2"></span
        ><span class="segment todo" style="flex-grow: 7"></span
      ></span>
      <span class="overview-moved"><strong>4</strong> moved, 1 done</span>
      <span class="overview-last" title="Latest member update or thread activity">today</span>
    </li>
    <li class="overview-row overview-workstream" data-workstream="01JBX3Z9Y8X7W6V5T4S3R2Q1P1">
      <a
        class="overview-title overview-workstream-name"
        href="/workstreams/01JBX3Z9Y8X7W6V5T4S3R2Q1P1"
        >Gift cards</a
      >
      <svg
        class="overview-spark"
        data-quiet="true"
        viewBox="0 0 56 17"
        role="img"
        aria-label="0 changes in the last 14 days"
      >
        <title>0 changes in the last 14 days</title>
        <polyline
          points="0,16 4.31,16 8.62,16 12.92,16 17.23,16 21.54,16 25.85,16 30.15,16 34.46,16 38.77,16 43.08,16 47.38,16 51.69,16 56,16"
        />
      </svg>
      <span class="status-bar" role="img" aria-label="5 to do" title="5 to do"
        ><span class="segment todo" style="flex-grow: 5"></span
      ></span>
      <span class="overview-moved"><span class="overview-quiet">none moved</span></span>
      <span class="overview-last" title="Latest member update or thread activity">9d ago</span>
    </li>
  </ul>
  <span
    class="status-bar"
    role="img"
    aria-label="1 done, 4 in progress, 2 to do"
    title="1 done, 4 in progress, 2 to do"
    ><span class="segment done" style="flex-grow: 1"></span
    ><span class="segment in-progress" style="flex-grow: 4"></span
    ><span class="segment todo" style="flex-grow: 2"></span
  ></span>
</div>
```

The spark sits beside it in the overview row: a 56 × 17 polyline in `--in-progress`, or `--line-strong` when nothing changed (`data-quiet`), labelled "19 changes in the last 14 days" both as `aria-label` and as its `<title>`.

### Plan meter

A native `<meter>` with `appearance: none` and Oriel's colours on WebKit's pseudo-elements: `low=70`, `high=90`, `optimum=0`, so up to 70% is the optimum (`--in-progress`), 70 to 90% is a mix towards danger, and over 90% is `--danger`.

```html specimen id=plan-meter title="How much of the plan is used: under 70%, 70 to 90%, over 90%"
<div class="plan-usage">
  <p>Oriel today: 12 turns · 340K tokens read, 18K written</p>
  <ul class="plan-windows" aria-label="Your plan">
    <li class="plan-window">
      <span class="plan-window-name">This session (5 hours)</span>
      <meter
        class="plan-meter"
        min="0"
        max="100"
        low="70"
        high="90"
        optimum="0"
        value="42"
        aria-label="This session (5 hours): 42% used"
      ></meter>
      <span>42% used · resets in 2 h</span>
    </li>
    <li class="plan-window">
      <span class="plan-window-name">This week</span>
      <meter
        class="plan-meter"
        min="0"
        max="100"
        low="70"
        high="90"
        optimum="0"
        value="78"
        aria-label="This week: 78% used"
      ></meter>
      <span>78% used · resets in 3 days</span>
    </li>
    <li class="plan-window">
      <span class="plan-window-name">This week</span>
      <meter
        class="plan-meter"
        min="0"
        max="100"
        low="70"
        high="90"
        optimum="0"
        value="95"
        aria-label="This week: 95% used"
      ></meter>
      <span>95% used · resets in 3 days</span>
    </li>
  </ul>
  <p>Your whole plan, Oriel and everything else, as Claude Code says.</p>
</div>
```

The app also puts `plan-today`, `plan-window-used` and `plan-note` on the lines here (`PlanUsage` in `packages/web/src/settings-page.tsx`). Nothing in window.css styles them, so the specimen leaves them off; `.plan-usage p` and the grid do the work.

### Reading a source

```html specimen id=setup-progress title="Reading, with a total and before the total is known"
<div class="ws-stack">
  <span class="setup-reading">
    <span id="reading-line" class="cli-line" role="status">Reading SYN: 120 of 400 issues</span>
    <progress
      class="setup-progress"
      max="400"
      value="120"
      aria-labelledby="reading-line"
    ></progress>
  </span>
  <span class="setup-reading">
    <span id="reading-line-2" class="cli-line" role="status">Reading SYN: 40 issues</span>
    <progress class="setup-progress" aria-labelledby="reading-line-2"></progress>
  </span>
</div>
```

`.setup-progress` doesn't reset `appearance`, so it's the browser's own bar, tinted by `accent-color`. That's why it degrades well. The app's `<progress>` has no accessible name; these specimens add `aria-labelledby` pointing at the line above it, and a new one should too.

### Install

```html specimen id=cli-bar title="Installing Claude Code: a bar that moves to show it's going"
<div>
  <span class="cli-line cli-waiting" role="status"
    ><span class="spinner" aria-hidden="true"></span>Downloading from Anthropic… 0:41</span
  >
  <div class="cli-progress">
    <span class="cli-bar" aria-hidden="true"></span>
    <span class="cli-note"
      >Downloading → setting up → checking it's genuine. About 310 MB, usually a minute or two,
      straight from Anthropic.</span
    >
  </div>
</div>
```

"No measure of the download comes from the installer, so the bar moves to show it's going, never how far" (`.cli-bar` in `window.css`). It's hidden from screen readers; the `role="status"` line says the phase and the time.

## States

- **Rest:** as above. None of these is interactive, so hover, focus, active and disabled don't apply.
- **Empty:** a status bar with no items is `.status-bar.empty`, hidden but keeping its space. A quiet spark (`data-quiet`) draws a flat `--line-strong` line. The plan meter isn't drawn when the CLI didn't say: "Claude Code didn't say how much of your plan is used. Check again."
- **Loading:** a `<progress>` with no `value` is indeterminate. The install bar always is.
- **Warning and error:** only the plan meter has them, by its `low` and `high`: a danger mix from 70%, `--danger` over 90%. A failed read or install says so in a line, not on the bar.
- **Motion:** `.cli-bar`'s slug moves on a 1.8s loop, and the spinner beside it turns. **Reduced motion doesn't stop the install bar.** The reduced-motion block sets `.cli-bar { animation: none }`, but the animation is on `.cli-bar::after` in `window.css`, so the slug keeps moving. The fix is one selector: `.cli-bar::after` in that list. The native indeterminate `<progress>` follows the browser's own reduced-motion handling.

## Keyboard and ARIA

- **Status bar:** `role="img"` with an `aria-label` that says the counts in words: "3 done, 2 in progress, 7 to do". The same words are its `title`. Leave out a category with no items.
- **Plan meter:** a native `<meter>` with `aria-label` "This session (5 hours): 42% used". A screen reader gets its value too.
- **Reading:** a native `<progress>`. Name it with `aria-labelledby` to its `role="status"` line (the app doesn't yet). The line announces as it changes; the bar doesn't need to.
- **Install:** `aria-hidden`, with the phase in a `role="status"` line.
- **Spark:** `role="img"`, `aria-label` and `<title>` both "{n} changes in the last 14 days".
- No bar here takes focus.

## Content

- Say the number in words beside the bar, with its unit: "42% used · resets in 2 h", "Reading SYN: 120 of 400 issues", "19 changes in the last 14 days".
- Plan windows are "This session (5 hours)" and "This week". The note under them: "Your whole plan, Oriel and everything else, as Claude Code says." With no plan: "This Claude Code isn't on a subscription plan, so it has no plan limits."
- The install's phases: "Downloading from Anthropic…", "Setting it up…", "Checking it's genuine…", "Updating Claude Code…", each with the time so far ("0:41").
- A status bar's label uses "done", "in progress" and "to do", lower case, in that order.

## Where the app uses it

- `.status-bar` in `window.css`, with its segments, `.segment.done`, `.segment.in-progress` and `.segment.todo` in `window.css`. `StatusBar` in `packages/web/src/window-page.tsx` draws it, used by `Cluster` there and by `WorkstreamRow` in `packages/web/src/overview-page.tsx`.
- `.plan-meter` in `window.css`, laid out by `.plan-usage` in `window.css`; drawn by `PlanUsage` in `packages/web/src/settings-page.tsx`.
- `.setup-progress` in `window.css`, drawn by `ReadingLine` and `Reading` in `packages/web/src/setup-page.tsx`.
- `.cli-bar` and its slug, `.cli-bar::after` in `window.css`; drawn by `ClaudeCodeRow` in `packages/web/src/cli-row.tsx`.
- `.overview-spark` in `window.css`, drawn by `Spark` in `packages/web/src/overview-page.tsx`.
- `.block-bars` in `window.css`, drawn by `BlockBody` in `packages/web/src/block.tsx`.

## Drift

Status **drifting**: five bars, each written once, with no shared track, height or colour rule.

- **Four tracks:** `--todo-soft`, `--line`, `--accent-soft`, and the browser's own. **Three heights:** 0.375rem, 6px and the block's 0.625rem. **Two corners:** `--radius-lg` and `--radius-sm`.
- **Two indeterminate bars:** the native `<progress>` in the first run, and the hand-made `.cli-bar` on the same page, which ignores reduced motion.
- **One nameless control:** the reading `<progress>` has no accessible name.
- **Firefox:** the plan meter styles only WebKit's pseudo-elements (no `::-moz-meter-bar`), so Firefox would draw its own. Settings only opens in the desktop app, so this doesn't reach anyone today; don't copy it into a page the review link can reach.

**Until it's consolidated:** for progress, copy `.setup-progress` (`<progress>`, named), with or without a value. For a share of a limit, copy the plan meter's `<meter>` with `low`, `high` and `optimum`. For a group's status, use `StatusBar`. Don't add a new animated bar; if you must, put it in the reduced-motion list by the selector that animates. See [Motion](/foundations/motion) and [the drift report](/drift).
